// Picture select: a mouse selection over the pictures of an answer, a plan
// or a Markdown file Claude sent. Since Claude Code 2.1.305 its own
// selection skips an Image's cells (no highlight, no text), so a Client
// (hooks/sel.tsx) over each page takes the pointer and posts the selection;
// the hooks module draws it over the page and copies its text on the
// button's up. The highlight is "clip, do not crop": each selected row is
// the page's own row (a strip PNG, strips.ts) on the selection colour, cut
// to the selected columns. The pure parts are here, with the selection now.
import type { EngineInterface } from 'claude-code'

import type { IuiTheme } from '../../types'
import { SELECT_SINCE } from './settings'
import { S, type Cell } from './state'
import { compareVersions } from './updates'
import { joinSegments, pageTopsOf, textOfRun, type Drawn, type Item, type RunLine, type TextBlock } from './copy'
import { invalidate } from './api'

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
// post taken, its redraws (`gen`: the overlay colour toggles with it), and
// a Client that failed (`isBroken`: no select until a reload).
export const picked = { now: null as Selection | null, seq: 0, gen: 0, isBroken: false }

// Draws the selection again (its colour one step off: selectColor).
export function redrawSelection($: EngineInterface) {
  picked.gen++
  invalidate($, 'ui.render')
}

// The selection's part of a drawing's memo: its redraw count while the
// selection is on it, '' otherwise.
export const selStamp = (id: string) => (picked.now?.id === id ? `sel${picked.gen}` : '')

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

// The selected rows as the overlay draws them, in the flow of a Box over
// the page: each row `top` rows under the end of the one before (the first
// under the page's top). Not absolute Boxes: the engine moves an absolute
// Box whose top is above the screen down to row 0, children and pointer
// too, so a page scrolled part away had its rows and its Client too high.
export function overlayRows(rows: readonly SelRow[]): (SelRow & { top: number })[] {
  let next = 0
  return rows.map(r => {
    const top = r.row - next
    next = r.row + 1
    return { ...r, top }
  })
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

// The strips of a page drawn at `box` in cells of `cell`: one PNG per cell
// row, `rowPx` tall, each drawn as a 1-row Image of `box.columns`. The
// terminal fits an image in its box with the aspect kept, so a strip shows
// its row of the page only when both are at one scale with no space above
// or below: the page is exactly `box.rows` x rowPx (a whole number) and
// fills its box's height (its width at most the box's at that scale).
// Null otherwise (a page drawn smaller, a cell of a fraction of a pixel):
// that page has no select.
export function stripPlan(page: { width: number; height: number }, box: Box, cell: Cell): { rowPx: number; rows: number } | null {
  if (box.rows < 1 || box.columns < 1 || page.width < 1) return null
  const rowPx = page.height / box.rows
  if (!Number.isInteger(rowPx)) return null
  return page.width * cell.height <= rowPx * box.columns * cell.width + 1e-6 ? { rowPx, rows: box.rows } : null
}

// The strips' folder of a page (beside it in its key folder, so the cache
// cleanup takes them with it), and the file of row `row` (0-based) as
// Typst names its pages: 1-based, padded to the count's digits.
export const stripDir = (file: string) => file.replace(/\.png$/, '') + '.strips'
export const stripFile = (file: string, rows: number, row: number) => `${stripDir(file)}/s-${String(row + 1).padStart(String(rows).length, '0')}.png`

// The selection's background: VS Code's selection colour of the mode, one
// step off on every other redraw (the engine repaints an overlay whole only
// when it changes).
export const selectColor = (mode: IuiTheme, gen: number) => (mode === 'light' ? (gen % 2 ? '#add6ff' : '#add6fe') : gen % 2 ? '#264f78' : '#264f79')

// Whether Claude Code is a version whose selection skips pictures
// (SELECT_SINCE or newer; a dev build by its release). Before it, its own
// selection copies them, and a Client over a picture would take that away.
export function needsSelect(version: string): boolean {
  const release = /^\d+\.\d+\.\d+/.exec(version.trim())?.[0]
  return !!release && (compareVersions(release, SELECT_SINCE) ?? -1) >= 0
}

// Whether a drawing's pages take picture select now: `/iui select` on, in
// fullscreen (on the main screen the terminal selects), pages drawn from
// files (not as bytes over ssh), the Client element there and a Claude Code
// that needs it, with the tty's cell known (the strips' scale).
export function selectOn(o: { hasClient: boolean; isFullscreen?: boolean }): Cell | null {
  if (!S.select || picked.isBroken || !o.hasClient || o.isFullscreen !== true || !S.env?.canDraw || S.env.inline || !needsSelect(S.engine)) return null
  return S.tty?.cell ?? null
}
