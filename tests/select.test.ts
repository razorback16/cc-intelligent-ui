import { expect, test } from 'claude-code/testing'

import { decodeSelection, placeholderCell, positionsOf, textOfRun, type Mark } from '../hooks/register'
import {
  needsSelect, overlayRows, postOf, rowsAbove, runsOf, selectColor, selectedRows, selectionAfter, selectTrace, stripDir, stripFile, stripPlan, textOfRuns, topsOf,
  type SelectPost,
} from '../hooks/lib/select'
import { stripsCall } from '../hooks/lib/strips'
import { SMALL_MARKS, SMALL_PAGE, SMALL_PPI } from './copy-fixture'

// ---- The posts --------------------------------------------------------------

const post = (o: Partial<SelectPost> = {}): SelectPost => ({ id: 'ans-1', page: 0, anchor: { x: 2, y: 1 }, head: { x: 7, y: 3 }, phase: 'move', seq: 1, ...o })

test('a post is read only when it is whole: an id, a page, two points of whole cells, a phase and an order', () => {
  expect(postOf(post())).toEqual(post())
  expect(postOf({ ...post(), extra: 1 })).toEqual(post())
  expect(postOf(null)).toBe(null)
  expect(postOf('down')).toBe(null)
  expect(postOf({ ...post(), id: 3 })).toBe(null)
  expect(postOf({ ...post(), page: -1 })).toBe(null)
  expect(postOf({ ...post(), anchor: { x: 1.5, y: 0 } })).toBe(null)
  expect(postOf({ ...post(), head: null })).toBe(null)
  expect(postOf({ ...post(), phase: 'drag' })).toBe(null)
  expect(postOf({ ...post(), seq: '1' })).toBe(null)
})

test('a post selects in the drawing\'s rows (its page\'s top added); a clear leaves none', () => {
  const tops = topsOf([{ columns: 98, rows: 16 }, { columns: 98, rows: 10 }, { columns: 98, rows: 4 }])
  expect(tops).toEqual([0, 16, 26])
  expect(selectionAfter(post({ phase: 'down', head: { x: 2, y: 1 } }), tops)).toEqual({ id: 'ans-1', anchor: { x: 2, y: 1 }, head: { x: 2, y: 1 }, isUp: false })
  // Page 1's region: its rows from 16; a head past its edge goes on into page 2.
  expect(selectionAfter(post({ page: 1, head: { x: 7, y: 12 } }), tops)).toEqual({ id: 'ans-1', anchor: { x: 2, y: 17 }, head: { x: 7, y: 28 }, isUp: false })
  expect(selectionAfter(post({ phase: 'up' }), tops)?.isUp).toBe(true)
  expect(selectionAfter(post({ phase: 'clear' }), tops)).toBe(null)
  // A page the drawing does not have.
  expect(selectionAfter(post({ page: 3 }), tops)).toBe(null)
})

test('a post keeps its region\'s size when it is whole cells; a bad one is dropped, the post kept', () => {
  expect(postOf({ ...post(), size: { columns: 98, rows: 16 } })).toEqual(post({ size: { columns: 98, rows: 16 } }))
  expect(postOf({ ...post(), size: { columns: 98 } })).toEqual(post())
  expect(postOf({ ...post(), size: { columns: 98, rows: 1.5 } })).toEqual(post())
  expect(postOf({ ...post(), size: null })).toEqual(post())
})

// ---- Scrolled pages -------------------------------------------------------------

test('the overlay rows are in the flow: each row\'s marginTop is the rows after the one before', () => {
  expect(overlayRows([])).toEqual([])
  expect(overlayRows([{ row: 0, x0: 3, x1: 9 }])).toEqual([{ row: 0, x0: 3, x1: 9, top: 0 }])
  // Rows 5, 6 and 7: 5 rows down, then each under the one before.
  expect(overlayRows([{ row: 5, x0: 4, x1: 97 }, { row: 6, x0: 0, x1: 97 }, { row: 7, x0: 0, x1: 20 }]).map(r => r.top)).toEqual([5, 0, 0])
  // A gap (rows that are not selected) is the margin; out of order still lands on its row.
  expect(overlayRows([{ row: 2, x0: 0, x1: 1 }, { row: 9, x0: 0, x1: 1 }]).map(r => r.top)).toEqual([2, 6])
  expect(overlayRows([{ row: 9, x0: 0, x1: 1 }, { row: 2, x0: 0, x1: 1 }]).map(r => r.top)).toEqual([9, -8])
  // Each row's top: the sum of the margins and rows before it.
  let at = 0
  const rows = [3, 4, 10, 15].map(row => ({ row, x0: 0, x1: 1 }))
  expect(overlayRows(rows).map(r => (at += r.top + 1) - 1)).toEqual([3, 4, 10, 15])
})

test('the rows of a page above the viewport: the message\'s first row on screen less the page\'s top, 0 to its rows', () => {
  // Page at row 1 of the message (the top margin), 16 rows.
  expect(rowsAbove(0, 1, 16)).toBe(0)
  expect(rowsAbove(1, 1, 16)).toBe(0)
  expect(rowsAbove(8, 1, 16)).toBe(7)
  // All of it scrolled away.
  expect(rowsAbove(40, 1, 16)).toBe(16)
  // The second page, at row 17: the first one is scrolled away first.
  expect(rowsAbove(10, 17, 10)).toBe(0)
  expect(rowsAbove(20, 17, 10)).toBe(3)
  expect(rowsAbove(undefined, 1, 16)).toBe(undefined)
  expect(rowsAbove(3, undefined, 16)).toBe(undefined)
})

test('the trace line of a post: the post, its region, onScreen, the page\'s top and rows above, and the rows selected', () => {
  const pages = [{ file: '/c/p-1.png', width: 1568, height: 512, columns: 98, rows: 16 }, { file: '/c/p-2.png', width: 1568, height: 320, columns: 98, rows: 10 }]
  // The answer's pages over its one link row, 8 rows of it scrolled away.
  const d = { id: 'ans-1', seq: 1, dir: '/c', pages, place: { top: 1, below: 1 }, onScreen: { first: 8, last: 27, of: 28 } }
  const p = post({ page: 0, anchor: { x: 2, y: 9 }, head: { x: 7, y: 11 }, size: { columns: 98, rows: 16 } })
  const sel = selectionAfter(p, topsOf(pages))
  expect(selectTrace(p, d, sel)).toBe('select: move #1 ans-1 page 0 anchor 2,9 head 7,11 size 98x16 drawn 98x16 onScreen 8-27/28 top 1 above 7 rows p0 9..11 (3)')
  // Page 1, its top at row 17: nothing of it above.
  const q = post({ page: 1, anchor: { x: 0, y: 0 }, head: { x: 3, y: 2 } })
  expect(selectTrace(q, d, selectionAfter(q, topsOf(pages)))).toBe('select: move #1 ans-1 page 1 anchor 0,0 head 3,2 size ? drawn 98x10 onScreen 8-27/28 top 17 above 0 rows p1 0..2 (3)')
  expect(selectTrace(p, { ...d, onScreen: null }, null)).toContain('onScreen off top ? above ? rows none')
  expect(selectTrace(p, undefined, null)).toBe('select: move #1 ans-1 page 0 anchor 2,9 head 7,11 size 98x16 (no drawing)')
})

// ---- Stream order -------------------------------------------------------------

const PAGE = { columns: 10, rows: 5 }
const sel = (ax: number, ay: number, hx: number, hy: number) => ({ anchor: { x: ax, y: ay }, head: { x: hx, y: hy } })

test('stream order: the first row from the anchor to its end, the rows between whole, the last row to the head', () => {
  expect(selectedRows(sel(3, 1, 6, 3), [PAGE])).toEqual([[{ row: 1, x0: 3, x1: 9 }, { row: 2, x0: 0, x1: 9 }, { row: 3, x0: 0, x1: 6 }]])
  // One row: from the anchor to the head.
  expect(selectedRows(sel(3, 2, 6, 2), [PAGE])).toEqual([[{ row: 2, x0: 3, x1: 6 }]])
})

test('stream order: a drag up or to the left selects the same cells as the drag the other way', () => {
  expect(selectedRows(sel(6, 3, 3, 1), [PAGE])).toEqual(selectedRows(sel(3, 1, 6, 3), [PAGE]))
  expect(selectedRows(sel(6, 2, 3, 2), [PAGE])).toEqual([[{ row: 2, x0: 3, x1: 6 }]])
})

test('anchor and head on one cell select nothing (a click)', () => {
  expect(selectedRows(sel(4, 2, 4, 2), [PAGE])).toEqual([[]])
})

test('a head past the edges: left and right are the row\'s ends, above is the first cell, below the last', () => {
  expect(selectedRows(sel(3, 1, 40, 1), [PAGE])).toEqual([[{ row: 1, x0: 3, x1: 9 }]])
  expect(selectedRows(sel(3, 1, -5, 2), [PAGE])).toEqual([[{ row: 1, x0: 3, x1: 9 }, { row: 2, x0: 0, x1: 0 }]])
  expect(selectedRows(sel(3, 1, 5, -4), [PAGE])).toEqual([[{ row: 0, x0: 0, x1: 9 }, { row: 1, x0: 0, x1: 3 }]])
  expect(selectedRows(sel(3, 3, 0, 9), [PAGE])).toEqual([[{ row: 3, x0: 3, x1: 9 }, { row: 4, x0: 0, x1: 9 }]])
})

test('a selection over two pages: each page gets its own rows', () => {
  const pages = [PAGE, { columns: 8, rows: 3 }]
  expect(selectedRows(sel(4, 3, 2, 6), pages)).toEqual([
    [{ row: 3, x0: 4, x1: 9 }, { row: 4, x0: 0, x1: 9 }],
    [{ row: 0, x0: 0, x1: 7 }, { row: 1, x0: 0, x1: 2 }],
  ])
  expect(selectedRows(sel(1, 5, 30, 7), pages)).toEqual([[], [{ row: 0, x0: 1, x1: 7 }, { row: 1, x0: 0, x1: 7 }, { row: 2, x0: 0, x1: 7 }]])
})

// ---- The text ------------------------------------------------------------------

const REAL = positionsOf(SMALL_MARKS as unknown as Mark[], SMALL_PPI)
// The cells as Claude Code's own copy puts them on the clipboard (one line a row).
const cellsOf = (rows: { row: number; x0: number; x1: number }[]) =>
  rows.map(r => Array.from({ length: r.x1 - r.x0 + 1 }, (_, i) => placeholderCell(r.row, r.x0 + i)).join('')).join('\n')

test('a selection reads as a copy of the same cells: the same runs, the same text', () => {
  // From the heading's start to "jumps" (its centre in column 21) in the paragraph.
  const rows = selectedRows(sel(0, 1, 21, 3), [SMALL_PAGE])
  const runs = runsOf(rows)
  const decoded = decodeSelection(cellsOf(rows[0]!))
  expect(decoded).toEqual([{ kind: 'image', lines: runs[0]!.lines }])
  const text = textOfRuns(runs, () => ({ items: REAL.pages[0]!, blocks: REAL.blocks }), [SMALL_PAGE])
  expect(text).toBe('Copy test\nThe quick brown fox jumps')
  expect(text).toBe(textOfRun(runs[0]!.lines, REAL.pages[0]!, REAL.blocks, SMALL_PAGE))
})

test('a selection over two pages is the text of each, one line apart; a page with no words read is no text', () => {
  const pages = [SMALL_PAGE, SMALL_PAGE]
  // Page 0 from "the lazy dog" (row 3, column 30) to its end, page 1 its heading.
  const runs = runsOf(selectedRows(sel(30, 3, 97, 17), pages))
  expect(runs.map(r => r.page)).toEqual([0, 1])
  const words = () => ({ items: REAL.pages[0]!, blocks: REAL.blocks })
  expect(textOfRuns(runs, words, pages)).toBe(
    'the lazy dog, then keeps running across the wide green field until the well-known path ends.\n- first item\n- second item\necho hello world\nls -la\nCopy test',
  )
  expect(textOfRuns(runs, page => (page === 1 ? null : words()), pages)).toBe(null)
  expect(textOfRuns([], words, pages)).toBe('')
})

// ---- The strips ------------------------------------------------------------------

test('strips: the page must be exactly rows x rowPx (a whole number) at the cell\'s aspect', () => {
  // Ghostty, 16 x 36 px cells: 212 columns of 16 px, 53 rows of 36 px.
  expect(stripPlan({ width: 3392, height: 1908 }, { columns: 212, rows: 53 }, { width: 16, height: 36 })).toEqual({ rowPx: 36, rows: 53 })
  expect(stripPlan({ width: 1568, height: 512 }, { columns: 98, rows: 16 }, { width: 16, height: 32 })).toEqual({ rowPx: 32, rows: 16 })
  // A page not a whole number of rows (a page cut at the most rows an Image takes).
  expect(stripPlan({ width: 3392, height: 1909 }, { columns: 212, rows: 53 }, { width: 16, height: 36 })).toBe(null)
  // A page wider than its box at that scale: the terminal would fit it by
  // its width, with space above and below (strips would not line up).
  expect(stripPlan({ width: 3408, height: 1908 }, { columns: 212, rows: 53 }, { width: 16, height: 36 })).toBe(null)
  // A cell of a fraction of a pixel (16.062 px a column): the page rounded up is wider than its box.
  expect(stripPlan({ width: 3406, height: 1855 }, { columns: 212, rows: 53 }, { width: 16.062, height: 35 })).toBe(null)
  // A page drawn smaller (an old one in an open epoch): its rows are not whole.
  expect(stripPlan({ width: 3392, height: 1908 }, { columns: 150, rows: 38 }, { width: 16, height: 36 })).toBe(null)
  // A page narrower than its box at that scale: space at the side only, the same for the strips.
  expect(stripPlan({ width: 3380, height: 1908 }, { columns: 212, rows: 53 }, { width: 16, height: 36 })).toEqual({ rowPx: 36, rows: 53 })
})

test('strips: each row is a page of its own, named as Typst numbers pages (1-based, padded to the count)', () => {
  expect(stripDir('/c/k/a-1.png')).toBe('/c/k/a-1.strips')
  expect(stripFile('/c/k/a-1.png', 53, 0)).toBe('/c/k/a-1.strips/s-01.png')
  expect(stripFile('/c/k/a-1.png', 53, 52)).toBe('/c/k/a-1.strips/s-53.png')
  expect(stripFile('/c/k/b-2.png', 120, 7)).toBe('/c/k/b-2.strips/s-008.png')
  expect(stripFile('/c/k/a-1.png', 9, 3)).toBe('/c/k/a-1.strips/s-4.png')
  const { argv, env } = stripsCall({ typst: '/usr/bin/typst', root: '/p', cache: '/c', file: '/c/k/a-1.png', width: 3392, height: 1908, rowPx: 36 })
  expect(argv.slice(0, 5)).toEqual(['sh', '-c', 'mkdir -p "$1" && shift && exec "$@"', 'sh', '/c/k/a-1.strips'])
  expect(argv.slice(5)).toEqual([
    '/usr/bin/typst', 'compile', '--root', '/', '--format', 'png', '--diagnostic-format', 'short', '--ppi', '72',
    '--input', 'src=/c/k/a-1.png', '--input', 'w=3392', '--input', 'h=1908', '--input', 'row=36', '/p/render/strips.typ', '/c/k/a-1.strips/s-{0p}.png',
  ])
  expect(env.TYPST_PACKAGE_CACHE_PATH).toBe('/c/pkg-cache')
})

// ---- The gate and the colour ---------------------------------------------------

test('picture select is for Claude Code 2.1.305 and newer (a dev build by its release)', () => {
  expect(needsSelect('2.1.305')).toBe(true)
  expect(needsSelect('2.1.306')).toBe(true)
  expect(needsSelect('2.2.0')).toBe(true)
  expect(needsSelect('2.1.306-dev')).toBe(true)
  expect(needsSelect('2.1.304')).toBe(false)
  expect(needsSelect('2.0.999')).toBe(false)
  expect(needsSelect('')).toBe(false)
  expect(needsSelect('dev')).toBe(false)
})

test('the selection colour is one step off on every other redraw, in both modes', () => {
  expect(selectColor('dark', 1)).toBe('#264f78')
  expect(selectColor('dark', 2)).toBe('#264f79')
  expect(selectColor('light', 1)).toBe('#add6ff')
  expect(selectColor('light', 2)).toBe('#add6fe')
})
