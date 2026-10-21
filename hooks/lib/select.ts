// Picture select: a mouse selection over the pictures of an answer, a plan
// or a Markdown file Claude sent. Claude Code's own selection copies an
// Image's cells as kitty placeholders (2.1.305 and newer skip them), so a
// Client (hooks/sel.tsx) over each page takes the pointer and posts the
// selection; the hooks module shows it on the page and copies its text on
// the button's up. The highlight swaps the page's picture (blit.ts); the page's
// layout never changes. The pure parts are here, with the selection now.
import type { EngineInterface } from 'claude-code'

import { SELECT_SINCE } from './settings'
import { drawnAnswers, S } from './state'
import { compareVersions } from './updates'
import { joinSegments, pageTopsOf, textOfRun, type Drawn, type Item, type RunLine, type TextBlock } from './copy'
import { endFold, foldNew, FRAME_MS, pokeFold, showSelection, startFold } from './blit'
import { clockAfter } from './api'

export type Point = { x: number; y: number }
export type SelectPhase = 'down' | 'move' | 'up' | 'clear'
// A post of the Client (hooks/sel.tsx): the drawing's id (drawnAnswers),
// the page whose region posted, the anchor (where the button went down)
// and the head (the pointer now) in that region's cells, and the post's
// order (one count for every instance). `size`: the region's columns and
// rows as the Client has them (for the trace).
export type SelectPost = { id: string; page: number; anchor: Point; head: Point; phase: SelectPhase; seq: number; size?: Box }
// The selection: anchor and head in the drawing's rows (the page tops
// added), `isUp` once the button came up.
export type Selection = { id: string; anchor: Point; head: Point; isUp: boolean }
// One selected row of a page: its row in the page and its first and last
// columns (inclusive).
export type SelRow = { row: number; x0: number; x1: number }
type Box = { columns: number; rows: number }

// The one selection over the pictures (null: none), the order of the last
// post taken, and a Client that failed (`isBroken`: no select until a reload).
export const picked = { now: null as Selection | null, seq: 0, isBroken: false }

// Shows the selection now on the pages (blit.ts), at most once a frame: the
// posts between fold into one, the newest.
let fold = foldNew()
export function redrawSelection($: EngineInterface) {
  const next = pokeFold(fold, performance.now(), FRAME_MS)
  if (next.kind === 'wait') clockAfter($, next.ms, () => void runSelection($))
  else if (next.kind === 'run') void runSelection($)
}

async function runSelection($: EngineInterface) {
  startFold(fold, performance.now())
  await showSelection($, selectedNow()).catch(() => undefined)
  if (endFold(fold)) redrawSelection($)
}

// The selection's drawing, its pages and their selected rows (none: null).
function selectedNow() {
  const sel = picked.now
  const d = sel ? drawnAnswers.get(sel.id) : undefined
  return sel && d ? { id: sel.id, pages: d.pages, rows: selectedRows(sel, d.pages) } : null
}

// Forgets the fold (for tests).
export function forgetRedraws() {
  fold = foldNew()
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const pointOf = (v: unknown): Point | null => {
  const p = v as Partial<Point> | null
  return p && isInt(p.x) && isInt(p.y) ? { x: p.x, y: p.y } : null
}

// A Client's post as a SelectPost; null when it is not one (data from code).
export function postOf(data: unknown): SelectPost | null {
  const d = data as Partial<Record<keyof SelectPost, unknown>> | null
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !isInt(d.page) || d.page < 0 || !isInt(d.seq)) return null
  const anchor = pointOf(d.anchor)
  const head = pointOf(d.head)
  const phase = d.phase
  if (!anchor || !head || (phase !== 'down' && phase !== 'move' && phase !== 'up' && phase !== 'clear')) return null
  const size = d.size as Partial<Box> | null | undefined
  const known = size && isInt(size.columns) && isInt(size.rows) ? { size: { columns: size.columns, rows: size.rows } } : {}
  return { id: d.id, page: d.page, anchor, head, phase, seq: d.seq, ...known }
}

// The row each page starts at in its drawing (the pages one under the other).
export function topsOf(pages: readonly Box[]): number[] {
  let at = 0
  return pages.map(p => (at += p.rows) - p.rows)
}

// The selection after a post: a down, a move or an up selects from its
// anchor to its head (a down on another picture drops the old one); a
// clear (a click with no drag) leaves none. `tops`: the drawing's page tops.
export function selectionAfter(post: SelectPost, tops: readonly number[]): Selection | null {
  const top = tops[post.page]
  if (post.phase === 'clear' || top === undefined) return null
  const at = (p: Point) => ({ x: p.x, y: p.y + top })
  return { id: post.id, anchor: at(post.anchor), head: at(post.head), isUp: post.phase === 'up' }
}

// The selected cells of each page in stream order: the first row from the
// first point's column to its end, the rows between whole, the last row to
// the last point's column. A point above the drawing is its first cell, one
// below it its last. Anchor and head on one cell select nothing.
export function selectedRows(sel: { anchor: Point; head: Point }, pages: readonly Box[]): SelRow[][] {
  const out = pages.map((): SelRow[] => [])
  const total = pages.reduce((n, p) => n + p.rows, 0)
  if (!total || (sel.anchor.x === sel.head.x && sel.anchor.y === sel.head.y)) return out
  const before = (p: Point, q: Point) => p.y < q.y || (p.y === q.y && p.x < q.x)
  const [first, last] = before(sel.head, sel.anchor) ? [sel.head, sel.anchor] : [sel.anchor, sel.head]
  const inside = (p: Point): Point => (p.y < 0 ? { x: 0, y: 0 } : p.y >= total ? { x: Number.MAX_SAFE_INTEGER, y: total - 1 } : p)
  const a = inside(first)
  const b = inside(last)
  topsOf(pages).forEach((top, i) => {
    const { columns, rows } = pages[i]!
    const clamp = (x: number) => Math.max(0, Math.min(columns - 1, x))
    for (let y = Math.max(a.y, top); y <= Math.min(b.y, top + rows - 1); y++) {
      const x0 = y === a.y ? clamp(a.x) : 0
      const x1 = y === b.y ? clamp(b.x) : columns - 1
      if (x1 >= x0) out[i]!.push({ row: y - top, x0, x1 })
    }
  })
  return out
}

// The rows of a page scrolled away above the viewport: the message's first
// row on screen less the page's top in the message, 0 to the page's rows.
// Undefined when either is not known.
export function rowsAbove(first: number | undefined, top: number | undefined, rows: number): number | undefined {
  return first === undefined || top === undefined ? undefined : Math.max(0, Math.min(rows, first - top))
}

// The IUI_DEBUG trace of a post: the post as the Client sent it (its
// region's size), the drawing's last onScreen, the page's top in the
// message and its rows scrolled away (the Client's y counts from the
// page's top, scrolled or not: no offset is added), and the rows selected.
export function selectTrace(post: SelectPost, d: Drawn | undefined, sel: Selection | null): string {
  const p = (q: Point) => `${q.x},${q.y}`
  const size = post.size ? `${post.size.columns}x${post.size.rows}` : '?'
  const head = `select: ${post.phase} #${post.seq} ${post.id} page ${post.page} anchor ${p(post.anchor)} head ${p(post.head)} size ${size}`
  if (!d) return `${head} (no drawing)`
  const box = d.pages[post.page]
  const on = d.onScreen === undefined ? '?' : d.onScreen === null ? 'off' : `${d.onScreen.first}-${d.onScreen.last}/${d.onScreen.of}`
  const top = pageTopsOf(d)?.[post.page]
  const above = rowsAbove(d.onScreen?.first, top, box?.rows ?? 0)
  const drawn = box ? `${box.columns}x${box.rows}` : '?'
  const rows = sel ? selectedRows(sel, d.pages).flatMap((lines, i) => lines.length ? [`p${i} ${lines[0]!.row}..${lines[lines.length - 1]!.row} (${lines.length})`] : []) : []
  return `${head} drawn ${drawn} onScreen ${on} top ${top ?? '?'} above ${above ?? '?'} rows ${rows.join(', ') || 'none'}`
}

// The selection's runs, page by page: the lines a copy of the same cells
// decodes to (decodeSelection), so its text is read the same way.
export function runsOf(rows: readonly (readonly SelRow[])[]): { page: number; lines: RunLine[] }[] {
  return rows.flatMap((lines, page) => (lines.length ? [{ page, lines: lines.map(l => ({ row: l.row, colStart: l.x0, colEnd: l.x1 })) }] : []))
}

// The text of the runs, as a copy of their cells reads it: each page's
// words under its run (textOfRun), joined by new lines (joinSegments).
// Null when a page's words are not known.
export function textOfRuns(
  runs: readonly { page: number; lines: RunLine[] }[], words: (page: number) => { items: Item[]; blocks: TextBlock[] } | null,
  pages: readonly { width: number; height: number; columns: number; rows: number }[],
): string | null {
  const texts: (string | null)[] = []
  for (const run of runs) {
    const got = words(run.page)
    const page = pages[run.page]
    if (!got || !page) return null
    texts.push(textOfRun(run.lines, got.items, got.blocks, page) || null)
  }
  return joinSegments(runs.map(run => ({ kind: 'image', lines: run.lines })), texts)
}

// Whether Claude Code has what picture select uses (SELECT_SINCE or newer;
// a dev build by its release): the Client, ui.message, ui.blit and ui.copy.
export function needsSelect(version: string): boolean {
  const release = /^\d+\.\d+\.\d+/.exec(version.trim())?.[0]
  return !!release && (compareVersions(release, SELECT_SINCE) ?? -1) >= 0
}

// Whether a drawing's pages take picture select now: `/iui select` on, in
// fullscreen (on the main screen the terminal selects), pages drawn from
// files (not as bytes over ssh), the Client element there and a Claude Code
// that needs it.
export function selectOn(o: { hasClient: boolean; isFullscreen?: boolean }): boolean {
  return S.select && !picked.isBroken && o.hasClient && o.isFullscreen === true && !!S.env?.canDraw && !S.env.inline && needsSelect(S.engine)
}
