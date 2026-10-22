// The pages a copy reads (copy.ts) and the words on them: each answer, plan
// and Markdown file Claude sent is noted as drawn (its pages at the box they
// are drawn at, and the Job that drew them), and a copy probes only the
// pages it reads (probePage: `typst query` of that page, with the PNG
// compile's own inputs). The positions are kept in memory only (the
// PROBED_KEPT pages read last); nothing is written.
import type { EngineInterface } from 'claude-code'

import { PROBED_KEPT } from './settings'
import { clip, DRAWN_KEPT, drawnAnswers, keep, lastKey, results, type Job, type Result } from './state'
import { fitBox } from './terminal'
import { isSafePage, probePage } from './typst'
import { screenOf, type Button, type Drawn, type DrawnPage, type Item, type TextBlock } from './copy'
import { targetsOf, type PageTarget } from './targets'
import type { ShownLink } from './draw'

// Notes the pages of `id` as drawn now, each at fitBox(page, room), as
// drawPages draws it, with the Job of the key the row drew last (lastKey:
// the result drawn is that key's). A redraw with the same pages at the same
// boxes keeps its place, so `seq` is when it was first drawn so. `at`: the
// rows above the pages in their message when the layout says (`top`), and
// the rows drawn under them besides a Typst error line (`after`); see Place.
export function noteDrawn(id: string, result: Result, room: number, at: { top?: number; after?: number } = {}) {
  const pages: DrawnPage[] = result.pages.map(p => ({ file: p.file, width: p.width, height: p.height, ...fitBox(p, room) }))
  const dir = result.pages[0]?.file.replace(/\/[^/]*$/, '') ?? ''
  const was = drawnAnswers.get(id)
  const same = (p: DrawnPage, i: number) => {
    const now = pages[i]
    return !!now && p.file === now.file && p.columns === now.columns && p.rows === now.rows
  }
  const place = { ...(at.top !== undefined ? { top: at.top } : {}), below: (result.note ? 1 : 0) + (at.after ?? 0) }
  if (was && was.dir === dir && was.pages.length === pages.length && was.pages.every(same)) {
    was.place = place
    return
  }
  const last = lastKey.get(id)
  const job = last && `${last.job.env.cache}/${last.key}` === dir ? last.job : undefined
  keep(drawnAnswers, id, { id, seq: ++clip.seq, dir, pages, place, ...(job ? { job } : {}) }, DRAWN_KEPT)
}

// A memo hit (the same drawing as before): noted again only when it went
// past DRAWN_KEPT, from the result the row last drew (lastKey).
export function noteDrawnAgain(id: string, room: number, at: { top?: number; after?: number } = {}) {
  if (drawnAnswers.has(id)) return
  const result = results.get(lastKey.get(id)?.key ?? '')
  if (result && result !== 'failed') noteDrawn(id, result, room, at)
}

// The rows of its message on screen (e.props.onScreen) of a drawing noted,
// at each draw of its row: no redraw, nothing kept changes.
export function noteOnScreen(id: string, onScreen: unknown) {
  const d = drawnAnswers.get(id)
  if (d) d.onScreen = screenOf(onScreen)
}

// ---- Positions ----------------------------------------------------------------

// The words of one page, the blocks they are in, and its code blocks' copy buttons.
export type PageWords = { items: Item[]; blocks: TextBlock[]; buttons?: Button[] }

// The pages probed, by `<folder>#<page>` (the PROBED_KEPT read last), and
// the probes that run now (a copy of the same page waits for the same run).
const probed = new Map<string, PageWords>()
const inflight = new Map<string, Promise<PageWords | null>>()

const pageKey = (d: Drawn, page: number) => `${d.dir}#${page}`

// The words of a page when they are probed already (no probe runs).
export const knownWords = (d: Drawn, page: number): PageWords | undefined => probed.get(pageKey(d, page))

// The words of page `page` (0-based) of a drawing, for a copy: kept, else
// its probe (one run per page at a time). Null when the drawing has no Job
// or the probe fails (a failure is not kept: the next copy probes again).
export async function wordsOf($: EngineInterface, d: Drawn & { job?: Job }, page: number): Promise<PageWords | null> {
  const key = pageKey(d, page)
  const known = probed.get(key)
  if (known) {
    keep(probed, key, known, PROBED_KEPT)
    return known
  }
  const running = inflight.get(key)
  if (running) return running
  const drawn = d.pages[page]
  if (!d.job || !drawn) return null
  const run = probePage($, d.job, d.dir, { page, pages: d.pages.length, isSafe: isSafePage(drawn.file) })
    .then(got => (got ? { items: got.pages[page] ?? [], blocks: got.blocks, buttons: got.buttons[page] ?? [] } : null))
    .catch(() => null)
  inflight.set(key, run)
  const got = await run
  if (inflight.get(key) === run) inflight.delete(key)
  if (got) keep(probed, key, got, PROBED_KEPT)
  return got
}

// The click targets of the pages whose words are known (targets.ts), by
// page key and box, with the links they were made from.
const targeted = new Map<string, { links: readonly ShownLink[]; targets: PageTarget[] }>()

// A page's click targets once its words are known (undefined: not yet), made once.
export function knownTargets(d: Drawn, page: number, links: readonly ShownLink[]): PageTarget[] | undefined {
  const words = probed.get(pageKey(d, page))
  const box = d.pages[page]
  if (!words || !box) return undefined
  const key = `${pageKey(d, page)}|${box.columns}x${box.rows}`
  const kept = targeted.get(key)
  if (kept?.links === links) return kept.targets
  const targets = targetsOf(words, box, links)
  keep(targeted, key, { links, targets }, PROBED_KEPT)
  return targets
}

// Forgets the pages probed (for tests).
export function forgetProbed() {
  probed.clear()
  inflight.clear()
  targeted.clear()
}
