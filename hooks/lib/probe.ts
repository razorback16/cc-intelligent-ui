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
import type { Drawn, DrawnPage, Item, TextBlock } from './copy'

// Notes the pages of `id` as drawn now, each at fitBox(page, room), as
// drawPages draws it, with the Job of the key the row drew last (lastKey:
// the result drawn is that key's). A redraw with the same pages at the same
// boxes keeps its place, so `seq` is when it was first drawn so.
export function noteDrawn(id: string, result: Result, room: number) {
  const pages: DrawnPage[] = result.pages.map(p => ({ file: p.file, width: p.width, height: p.height, ...fitBox(p, room) }))
  const dir = result.pages[0]?.file.replace(/\/[^/]*$/, '') ?? ''
  const was = drawnAnswers.get(id)
  const same = (p: DrawnPage, i: number) => {
    const now = pages[i]
    return !!now && p.file === now.file && p.columns === now.columns && p.rows === now.rows
  }
  if (was && was.dir === dir && was.pages.length === pages.length && was.pages.every(same)) return
  const last = lastKey.get(id)
  const job = last && `${last.job.env.cache}/${last.key}` === dir ? last.job : undefined
  keep(drawnAnswers, id, { id, seq: ++clip.seq, dir, pages, ...(job ? { job } : {}) }, DRAWN_KEPT)
}

// A memo hit (the same drawing as before): noted again only when it went
// past DRAWN_KEPT, from the result the row last drew (lastKey).
export function noteDrawnAgain(id: string, room: number) {
  if (drawnAnswers.has(id)) return
  const result = results.get(lastKey.get(id)?.key ?? '')
  if (result && result !== 'failed') noteDrawn(id, result, room)
}

// ---- Positions ----------------------------------------------------------------

// The words of one page and the blocks they are in.
export type PageWords = { items: Item[]; blocks: TextBlock[] }

// The pages probed, by `<folder>#<page>` (the PROBED_KEPT read last), and
// the probes that run now (a copy of the same page waits for the same run).
const probed = new Map<string, PageWords>()
const inflight = new Map<string, Promise<PageWords | null>>()

const pageKey = (d: Drawn, page: number) => `${d.dir}#${page}`

// Whether page `page` of a drawing is known (no probe needs to run).
export const isProbed = (d: Drawn, page: number) => probed.has(pageKey(d, page))

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
    .then(got => (got ? { items: got.pages[page] ?? [], blocks: got.blocks } : null))
    .catch(() => null)
  inflight.set(key, run)
  const got = await run
  if (inflight.get(key) === run) inflight.delete(key)
  if (got) keep(probed, key, got, PROBED_KEPT)
  return got
}

// Forgets the pages probed (for tests).
export function forgetProbed() {
  probed.clear()
  inflight.clear()
}
