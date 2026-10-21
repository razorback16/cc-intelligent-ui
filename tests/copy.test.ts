import { expect, mock, test } from 'claude-code/testing'

import {
  codePointsOf, commandSuggestions, decodeSelection, DIACRITICS, hasPlaceholders, isDrawnIn, joinSegments, pageTopsOf, pickPages,
  placeholderCell, isSafePage, positionsOf, screenOf, SHIM_SETUP, textOfRun, WATCH_PL, type Drawn, type TextBlock, type Item, type Mark, type OnScreen,
  type Place,
} from '../hooks/register'
import { joinItems } from '../hooks/lib/copy'
import { WATCH_RESTART_MS } from '../hooks/lib/frame'
import { ANSWER_SH, ASK_CLEAN_SH, ASK_END_SH, ASK_MAX, ASK_PL, ASK_RESTART_MS, ASK_RESTARTS } from '../hooks/lib/clipboard'
import { HINT_WAIT_MS } from '../hooks/lib/settings'
import { rowsAfter, type Under } from '../hooks/lib/pictures'
import { forgetProbed, noteDrawn, noteDrawnAgain, noteOnScreen, wordsOf } from '../hooks/lib/probe'
import { clip, drawnAnswers, lastKey, results, type Job, type Result } from '../hooks/lib/state'
import { LONG_MARKS, LONG_MD, LONG_PAGE, SMALL_MARKS, SMALL_MD, SMALL_PAGE, SMALL_PPI } from './copy-fixture'

// One screen row of a picture as Claude Code draws it: `lead` (the gutter),
// then the cells of `row` from `from` to `to`.
const cells = (row: number, from: number, to: number, lead = '  ') =>
  lead + Array.from({ length: to - from + 1 }, (_, i) => placeholderCell(row, from + i)).join('')

// ---- The diacritics ---------------------------------------------------------

test("the row/column marks are kitty's 297, in its order", () => {
  expect(DIACRITICS.length).toBe(297)
  expect(new Set(DIACRITICS).size).toBe(297)
  expect(DIACRITICS.slice(0, 18)).toEqual([0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363])
  expect(DIACRITICS.slice(0, 19)).toEqual([773, 781, 782, 784, 786, 829, 830, 831, 838, 842, 843, 844, 848, 849, 850, 855, 859, 867, 868])
  expect(DIACRITICS[296]).toBe(0x1d244)
  expect(placeholderCell(2, 5)).toBe('\u{10EEEE}̎̽')
  expect(hasPlaceholders(`a${placeholderCell(0, 0)}`)).toBe(true)
  expect(hasPlaceholders('plain text')).toBe(false)
})

// ---- Decoding a clipboard ---------------------------------------------------

test('a selection over one picture is one run; the gutter and its bullet are dropped', () => {
  const text = [cells(3, 10, 20, '⏺ '), cells(4, 0, 40), cells(5, 0, 7)].join('\n')
  expect(decodeSelection(text)).toEqual([
    { kind: 'image', lines: [{ row: 3, colStart: 10, colEnd: 20 }, { row: 4, colStart: 0, colEnd: 40 }, { row: 5, colStart: 0, colEnd: 7 }] },
  ])
})

test('text between pictures stays, in order; a row that starts again starts a new run', () => {
  const text = ['> my prompt', '', cells(0, 0, 3), cells(1, 0, 3), cells(0, 0, 2), 'after', ''].join('\n')
  expect(decodeSelection(text)).toEqual([
    { kind: 'text', text: '> my prompt\n' },
    { kind: 'image', lines: [{ row: 0, colStart: 0, colEnd: 3 }, { row: 1, colStart: 0, colEnd: 3 }] },
    { kind: 'image', lines: [{ row: 0, colStart: 0, colEnd: 2 }] },
    { kind: 'text', text: 'after' },
  ])
})

test('a cell with no column mark is the one after the cell before it', () => {
  const bare = '\u{10EEEE}' + String.fromCodePoint(DIACRITICS[6]!)
  expect(decodeSelection(placeholderCell(6, 9) + bare + bare)).toEqual([{ kind: 'image', lines: [{ row: 6, colStart: 9, colEnd: 11 }] }])
})

test('dump shows cells as [row,col] and other characters as code points', () => {
  expect(codePointsOf(`⏺ ${placeholderCell(1, 2)}x`)).toBe('U+23FA U+0020 U+10EEEE[1,2] U+0078')
  expect(codePointsOf(cells(0, 0, 50, ''), 3).split(' ').length).toBe(3)
})

// ---- Positions --------------------------------------------------------------

test('probe marks become pixel boxes; a list number is dropped and an item takes its paragraph', () => {
  const marks: Mark[] = [
    { k: 'b', p: 1, x: 0, y: 0, kind: 'par' },
    { k: 'w', p: 1, x: 0, y: 0, t: 'Hi', w: 10, h: 12 },
    { k: 'w', p: 1, x: 20, y: 30, t: '1.', w: 6, h: 12 },
    { k: 'b', p: 1, x: 30, y: 30, kind: 'item', prefix: '1. ' },
    { k: 'b', p: 1, x: 30, y: 30, kind: 'par' },
    { k: 'w', p: 2, x: 30, y: 30, t: 'one', w: 15, h: 12 },
    { k: 'c', p: 2, x: 10, y: 60, t: 'ab', w: 12, n: 2, a: 8, d: 2 },
  ]
  const got = positionsOf(marks, 144)
  expect(got.blocks).toEqual([{ kind: 'par', prefix: '', first: 0 }, { kind: 'item', prefix: '1. ', first: 1 }])
  expect(got.pages[0]).toEqual([{ i: 0, text: 'Hi', block: 0, x0: 0, x1: 20, y0: 0, y1: 24 }])
  expect(got.pages[1]).toEqual([
    { i: 1, text: 'one', block: 1, x0: 60, x1: 90, y0: 60, y1: 84 },
    { i: 2, text: 'ab', block: 1, x0: 20, x1: 44, y0: 104, y1: 124, adv: 12 },
  ])
})

// A hand-made page: 10 columns of 10 px, 4 rows of 20 px.
const PAGE = { width: 100, height: 80, columns: 10, rows: 4 }
const word = (i: number, text: string, x0: number, row: number, block: number): Item => ({ i, text, x0, x1: x0 + text.length * 6, y0: row * 20 + 2, y1: row * 20 + 18, block })
const BLOCKS: TextBlock[] = [
  { kind: 'par', prefix: '', first: 0 },
  { kind: 'item', prefix: '- ', first: 4 },
  { kind: 'code', prefix: '', first: 5 },
  { kind: 'cell', prefix: '', cx: 0, first: 7 },
  { kind: 'cell', prefix: '', cx: 1, first: 8 },
]
const ITEMS: Item[] = [
  word(0, 'alpha', 0, 0, 0), word(1, 'beta', 40, 0, 0), word(2, 'well-', 70, 0, 0), word(3, 'known', 0, 1, 0),
  word(4, 'item', 40, 1, 1),
  { i: 5, text: 'let x = 1', x0: 0, x1: 90, y0: 42, y1: 58, block: 2, adv: 10 },
  { i: 6, text: 'x++', x0: 0, x1: 30, y0: 52, y1: 58, block: 2, adv: 10 },
  word(7, 'k', 0, 3, 3), word(8, 'v', 50, 3, 4),
]

test('a word is in when its centre is in a selected cell; the first line from its column, the last to its column', () => {
  // "beta" spans x 40-64: centre 52, column 5.
  expect(textOfRun([{ row: 0, colStart: 5, colEnd: 9 }], ITEMS, BLOCKS, PAGE)).toBe('beta well-')
  expect(textOfRun([{ row: 0, colStart: 6, colEnd: 9 }], ITEMS, BLOCKS, PAGE)).toBe('well-')
  // A line broken after a hyphen joins with no space; a new block is a new line with its prefix.
  expect(textOfRun([{ row: 0, colStart: 0, colEnd: 9 }, { row: 1, colStart: 0, colEnd: 9 }], ITEMS, BLOCKS, PAGE)).toBe('alpha beta well-known\n- item')
})

test('code lines are cut by characters; table cells join with a tab', () => {
  expect(textOfRun([{ row: 2, colStart: 4, colEnd: 9 }], ITEMS, BLOCKS, PAGE)).toBe('x = 1')
  expect(textOfRun([{ row: 2, colStart: 0, colEnd: 9 }, { row: 3, colStart: 0, colEnd: 9 }], ITEMS, BLOCKS, PAGE)).toBe('let x = 1\nx++\nk\tv')
  // The two code lines lie in one row (y centres 50 and 55): both, one per line.
  expect(textOfRun([{ row: 2, colStart: 0, colEnd: 1 }], ITEMS, BLOCKS, PAGE)).toBe('le\nx+')
})

// ---- Which page -------------------------------------------------------------

// An answer drawn at `columns`, its pages `rows` tall (at their own box).
const drawn = (id: string, seq: number, rows: number[], columns = 80): Drawn => ({
  id, seq, dir: `/c/${id}`, pages: rows.map((r, i) => ({ file: `/c/${id}/a-${i + 1}.png`, width: columns * 16, height: r * 32, columns, rows: r })),
})

test('a run goes to the drawing the selection names, else to the newest it fits', () => {
  const runs = decodeSelection([cells(2, 0, 50), cells(3, 0, 50)].join('\n'))
  const answers = [drawn('old', 1, [10]), drawn('new', 2, [10]), drawn('short', 3, [3])]
  expect(pickPages(runs, answers)).toEqual([{ id: 'new', page: 0 }])
  expect(pickPages(runs, answers, 'old')).toEqual([{ id: 'old', page: 0 }])
  // A plan and a sent file by the call's tool_use_id.
  expect(pickPages(runs, [...answers, drawn('plan:tu1', 0, [10])], 'tu1')).toEqual([{ id: 'plan:tu1', page: 0 }])
  expect(pickPages(runs, [...answers, drawn('file:tu2:a.md', 0, [10])], 'tu2')).toEqual([{ id: 'file:tu2:a.md', page: 0 }])
  expect(isDrawnIn('file:tu2:a.md', 'tu2')).toBe(true)
  expect(isDrawnIn('file:tu22:a.md', 'tu2')).toBe(false)
  // Too wide for an answer drawn at 40 columns.
  expect(pickPages(runs, [drawn('narrow', 9, [10], 40)])).toEqual([null])
})

test('runs one after another are consecutive pages of one answer', () => {
  const text = [cells(8, 0, 9), cells(9, 0, 9), cells(0, 0, 9), cells(1, 0, 9)].join('\n')
  const segments = decodeSelection(text)
  expect(segments.length).toBe(2)
  // Page 0 has 10 rows, so the first run ends on its last row.
  expect(pickPages(segments, [drawn('two', 1, [10, 5]), drawn('one', 2, [20])])).toEqual([{ id: 'two', page: 0 }, { id: 'two', page: 1 }])
  expect(joinSegments([{ kind: 'text', text: 'a' }, ...segments], [null, 'x', 'y'])).toBe('a\nx\ny')
})

test('a page drawn smaller than it was compiled for fits by its drawn box', () => {
  // Compiled 98 x 16, drawn 49 x 8 (an old page in an open epoch).
  const small: Drawn = { id: 's', seq: 1, dir: '/c/s', pages: [{ file: '/c/s/a-1.png', width: 1568, height: 512, columns: 49, rows: 8 }] }
  expect(pickPages(decodeSelection(cells(7, 0, 48)), [small])).toEqual([{ id: 's', page: 0 }])
  expect(pickPages(decodeSelection(cells(2, 0, 60)), [small])).toEqual([null])
  expect(pickPages(decodeSelection(cells(9, 0, 10)), [small])).toEqual([null])
})

// ---- Which page: the rows on screen ----------------------------------------------

// An answer under its top margin (1 row), with its message's rows on screen.
const seen = (d: Drawn, onScreen: OnScreen | null | undefined, place: Place = { top: 1, below: 0 }): Drawn => ({ ...d, place, onScreen })
// The answer of the bug: 2 pages of 40 and 42 rows at 212 columns (83 rows
// with the margin); rows 5 and 6 fit both pages.
const BUG = drawn('ans', 1, [40, 42], 212)
const ROWS_5_6 = decodeSelection([cells(5, 0, 50), cells(6, 0, 50)].join('\n'))

test('the rows on screen say which page a run is: the one of the two that is on screen', () => {
  expect(pageTopsOf(seen(BUG, { first: 41, last: 82, of: 83 }))).toEqual([1, 41])
  // Page 2 on screen (its rows 5 and 6 are message rows 46 and 47).
  expect(pickPages(ROWS_5_6, [seen(BUG, { first: 41, last: 82, of: 83 })])).toEqual([{ id: 'ans', page: 1 }])
  expect(pickPages(ROWS_5_6, [seen(BUG, { first: 30, last: 70, of: 83 })])).toEqual([{ id: 'ans', page: 1 }])
  // Page 1 on screen.
  expect(pickPages(ROWS_5_6, [seen(BUG, { first: 0, last: 40, of: 83 })])).toEqual([{ id: 'ans', page: 0 }])
  // One selected row on screen is enough.
  expect(pickPages(ROWS_5_6, [seen(BUG, { first: 47, last: 82, of: 83 })])).toEqual([{ id: 'ans', page: 1 }])
  // The root's margin outside the rows counted: the pages from row 0.
  expect(pageTopsOf(seen(BUG, { first: 40, last: 81, of: 82 }))).toEqual([0, 40])
  expect(pickPages(ROWS_5_6, [seen(BUG, { first: 40, last: 81, of: 82 })])).toEqual([{ id: 'ans', page: 1 }])
  // A Typst error line under the pages, and a plan or a sent file with the
  // engine's row above (no top): the top from the bottom.
  expect(pageTopsOf(seen(BUG, { first: 0, last: 9, of: 84 }, { top: 1, below: 1 }))).toEqual([1, 41])
  expect(pageTopsOf(seen(BUG, { first: 0, last: 9, of: 90 }, { below: 0 }))).toEqual([8, 48])
})

test('with no rows on screen known, or of another layout, a run goes to the first page that fits, as before', () => {
  expect(pickPages(ROWS_5_6, [BUG])).toEqual([{ id: 'ans', page: 0 }])
  expect(pickPages(ROWS_5_6, [seen(BUG, undefined)])).toEqual([{ id: 'ans', page: 0 }])
  // `of` of the row drawn as text before (too short or too tall for these pages).
  for (const onScreen of [{ first: 10, last: 19, of: 20 }, { first: 41, last: 89, of: 90 }]) {
    expect(pageTopsOf(seen(BUG, onScreen))).toBeUndefined()
    expect(pickPages(ROWS_5_6, [seen(BUG, onScreen)])).toEqual([{ id: 'ans', page: 0 }])
  }
  // Rows on screen out of date (no page on screen fits): as before.
  expect(pickPages(decodeSelection(cells(41, 0, 50)), [seen(BUG, { first: 0, last: 20, of: 83 })])).toEqual([{ id: 'ans', page: 1 }])
  expect(pickPages(ROWS_5_6, [seen(BUG, null)])).toEqual([{ id: 'ans', page: 0 }])
  expect(screenOf({ first: 1, last: 2, of: 3 })).toEqual({ first: 1, last: 2, of: 3 })
  expect(screenOf(null)).toBeNull()
  expect(screenOf(undefined)).toBeUndefined()
  expect(screenOf({ first: 1 })).toBeUndefined()
})

test('a chain over the page break still goes to the two pages, with either part on screen', () => {
  const chain = decodeSelection([cells(38, 0, 50), cells(39, 0, 50), cells(0, 0, 50), cells(1, 0, 50)].join('\n'))
  const pages = [{ id: 'ans', page: 0 }, { id: 'ans', page: 1 }]
  expect(pickPages(chain, [seen(BUG, { first: 20, last: 60, of: 83 })])).toEqual(pages)
  expect(pickPages(chain, [seen(BUG, { first: 41, last: 82, of: 83 })])).toEqual(pages)
  expect(pickPages(chain, [seen(BUG, { first: 0, last: 39, of: 83 })])).toEqual(pages)
})

test('two placements on screen (pages shorter than the viewport): the first is taken', () => {
  const short = drawn('ans', 1, [10, 12])
  expect(pickPages(decodeSelection([cells(2, 0, 50), cells(3, 0, 50)].join('\n')), [seen(short, { first: 0, last: 22, of: 23 })])).toEqual([
    { id: 'ans', page: 0 },
  ])
})

test('among placements on screen, the selection row first, then the newest', () => {
  const page2 = { first: 41, last: 82, of: 83 }
  const old = seen(drawn('old', 1, [40, 42], 212), page2)
  const now = seen(drawn('new', 2, [40, 42], 212), page2)
  expect(pickPages(ROWS_5_6, [old, now])).toEqual([{ id: 'new', page: 1 }])
  expect(pickPages(ROWS_5_6, [old, now], 'old')).toEqual([{ id: 'old', page: 1 }])
  // The newest off screen: the older one on screen.
  expect(pickPages(ROWS_5_6, [old, seen(now, null)])).toEqual([{ id: 'old', page: 1 }])
  // The newest with no rows on screen known keeps its first page, as before.
  expect(pickPages(ROWS_5_6, [old, seen(now, undefined)])).toEqual([{ id: 'new', page: 0 }])
  // The selection's row wins even off screen (its rows on screen out of date).
  expect(pickPages(ROWS_5_6, [old, seen(now, null)], 'new')).toEqual([{ id: 'new', page: 0 }])
})

test("a sent file's pages have the rows of the pictures and files after it under them", () => {
  const picture = { source: { file: '/p.png' }, columns: 20, rows: 7, alt: '' } as Under
  const result = { pages: [{ file: '/a-1.png', width: 1600, height: 640, alt: '', columns: 100, rows: 20 }], bulletRow: 0, note: 'boom' }
  const pages = { id: 'file:t:a.md', drawing: { kind: 'pages', result } } as Under
  const blank = { id: 'file:t:b.md', drawing: { kind: 'blank' } } as Under
  // At 50 columns the page draws 10 rows, and its error line 1.
  expect(rowsAfter([pages, picture, blank, pages], 0, 50)).toBe(7 + 10 + 1)
  expect(rowsAfter([pages, picture], 1, 50)).toBe(0)
})

test("a sent file's link rows are under its pages too, and under the pages of each file before it", () => {
  const result = { pages: [{ file: '/a-1.png', width: 1600, height: 640, alt: '', columns: 100, rows: 20 }], bulletRow: 0 }
  const links = [{ kind: 'web', label: 'x', href: 'https://x.org' }, { kind: 'command', label: 'ls', text: 'ls' }] as const
  const linked = { id: 'file:t:a.md', drawing: { kind: 'pages', result }, links } as Under
  const blank = { id: 'file:t:b.md', drawing: { kind: 'blank' }, links } as Under
  // Its own 2 link rows; then the next file's 10 page rows and 2 link rows.
  expect(rowsAfter([linked, linked], 0, 50)).toBe(2 + 10 + 2)
  expect(rowsAfter([linked, linked], 1, 50)).toBe(2)
  // A blank draws no link rows.
  expect(rowsAfter([linked, blank], 0, 50)).toBe(2)
})

// ---- A real probe -----------------------------------------------------------

const REAL = positionsOf(SMALL_MARKS as unknown as Mark[], SMALL_PPI)
const ALL_COLUMNS = (row: number) => ({ row, colStart: 0, colEnd: 97 })
const TEXT = 'Copy test\nThe quick brown fox jumps over the lazy dog, then keeps running across the wide green field until the well-known path ends.\n- first item\n- second item\necho hello world\nls -la'

test("a real probe: the whole picture copies as the answer's text", () => {
  const all = Array.from({ length: SMALL_PAGE.rows }, (_, row) => ALL_COLUMNS(row))
  expect(textOfRun(all, REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe(TEXT)
})

test('a real probe: a selection from mid-paragraph into the code block', () => {
  // Rows: heading 1, paragraph 3 and 5, items 7 and 9, code 12 and 13.
  const lines = [{ row: 3, colStart: 30, colEnd: 97 }, ...[4, 5, 6, 7, 8, 9, 10, 11].map(ALL_COLUMNS), { row: 12, colStart: 0, colEnd: 14 }]
  expect(textOfRun(lines, REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe(
    'the lazy dog, then keeps running across the wide green field until the well-known path ends.\n- first item\n- second item\necho hello ',
  )
  // Part of the second item: no prefix.
  expect(textOfRun([{ row: 9, colStart: 10, colEnd: 97 }], REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe('item')
})

test('a real probe on a page drawn at half its box: a cell is twice as large', () => {
  const half = { ...SMALL_PAGE, columns: 49, rows: 8 }
  // "jumps" has its centre at x 339 px: column 21 of 16 px, column 10 of 32 px.
  expect(textOfRun([{ row: 0, colStart: 0, colEnd: 48 }, { row: 1, colStart: 0, colEnd: 10 }], REAL.pages[0]!, REAL.blocks, half)).toBe(
    'Copy test\nThe quick brown fox jumps',
  )
  expect(textOfRun(Array.from({ length: 8 }, (_, row) => ({ row, colStart: 0, colEnd: 48 })), REAL.pages[0]!, REAL.blocks, half)).toBe(TEXT)
})

test('a real probe through the clipboard: decode, pick, read', () => {
  // "jumps" is columns 18-23, its centre in column 21.
  const clipboard = [cells(1, 0, 97, '⏺ '), '', cells(3, 0, 21)].join('\n')
  const segments = decodeSelection(clipboard)
  const answer: Drawn = { id: 'r1', seq: 1, dir: '/c/k', pages: [{ file: '/c/k/a-1.png', ...SMALL_PAGE }] }
  const picks = pickPages(segments, [answer])
  expect(picks).toEqual([{ id: 'r1', page: 0 }, null, { id: 'r1', page: 0 }])
  const texts = segments.map((s, i) => (s.kind === 'image' && picks[i] ? textOfRun(s.lines, REAL.pages[0]!, REAL.blocks, SMALL_PAGE) : null))
  expect(joinSegments(segments, texts)).toBe('Copy test\n\nThe quick brown fox jumps')
})

const LONG = positionsOf(LONG_MARKS as unknown as Mark[], SMALL_PPI)
const longRows = (rows: number[]) => textOfRun(rows.map(ALL_COLUMNS), LONG.pages[0]!, LONG.blocks, LONG_PAGE)

test('a real probe: a long path, a long URL that wraps and CJK text are on their own rows', () => {
  const [path, cjk, url] = LONG_MD.trim().split('\n\n')
  // Rows: the path's line 0, the CJK line 3, the URL's lines 5 and 6, "end." 8.
  expect(longRows([0])).toBe(path)
  expect(longRows([1, 2])).toBe('')
  expect(longRows([3])).toBe(cjk)
  expect(longRows([5, 6, 7, 8])).toBe(url)
  expect(longRows(Array.from({ length: LONG_PAGE.rows }, (_, row) => row))).toBe(LONG_MD.trim().replace(/\n\n/g, '\n'))
  // Each character of a long word or CJK text by its own centre.
  expect(textOfRun([{ row: 0, colStart: 0, colEnd: 9 }], LONG.pages[0]!, LONG.blocks, LONG_PAGE)).toBe('Path /Users')
  expect(textOfRun([{ row: 3, colStart: 0, colEnd: 3 }], LONG.pages[0]!, LONG.blocks, LONG_PAGE)).toBe('中文')
  // The URL's second line alone: its characters, no space.
  expect(longRows([6])).toMatch(/^a+\/x$/)
  // Every box is inside the page.
  expect(LONG.pages[0]!.every(i => i.x1 <= LONG_PAGE.width && i.y1 <= LONG_PAGE.height)).toBe(true)
})

test('invisible marks and list markers of other themes are dropped', () => {
  const marks: Mark[] = [
    { k: 'b', p: 1, x: 0, y: 0, kind: 'par' },
    { k: 'w', p: 1, x: 0, y: 0, t: 'with', w: 20, h: 12 },
    // The strut before inline code, and a long word with its break chances.
    { k: 'w', p: 1, x: 24, y: 0, t: '‍', w: 0, h: 12 },
    { k: 'w', p: 1, x: 24, y: 1, t: 'co​de', w: 20, h: 11 },
    // The paragraph's last word, then a list with a "•" marker.
    { k: 'w', p: 1, x: 0, y: 20, t: 'end', w: 15, h: 12 },
    { k: 'w', p: 1, x: 10, y: 40, t: '•', w: 4, h: 12 },
    { k: 'b', p: 1, x: 20, y: 40, kind: 'item', prefix: '- ' },
    { k: 'w', p: 1, x: 20, y: 40, t: 'one', w: 15, h: 12 },
  ]
  const got = positionsOf(marks, 72)
  expect(got.pages[0]!.map(i => i.text)).toEqual(['with', 'code', 'end', 'one'])
})

// A real probe on Linux (Ubuntu 24.04, theme claude-code, row grid on, ppi
// 275): the body font is Noto Sans, its space 0.26 of the size, its
// ascender to descender 1.36; on the grid a line is 2 rows (22.254 pt). A
// fifth of either is more than the space.
const NOTO_LINE: Mark[] = [
  { k: 'w', p: 1, x: 20.9, y: 1541.09, s: 11, t: '-', w: 3.542, h: 22.254 },
  { k: 'b', p: 1, x: 30.492, y: 1541.09, s: 11, kind: 'item', prefix: '- ' },
  ...([[30.492, 'Geometric', 57.354], [90.706, 'resizing', 43.01], [136.576, 'keeps', 30.316], [169.752, 'inserts', 34.892], [207.504, 'at', 10.142],
    [248.123, 'amortized,', 55.55], [306.533, 'even', 24.574], [333.967, 'though', 37.785], [374.612, 'a', 6.171], [383.643, 'single', 30.712],
    [417.215, 'rehash', 35.563], [455.638, 'costs', 26.444], [510.908, '.', 2.948]] as const).map(([x, t, w]): Mark => ({ k: 'w', p: 1, x, y: 1541.09, s: 11, t, w, h: 22.254 })),
]
const joinAll = (marks: Mark[], ppi = 275) => {
  const got = positionsOf(marks, ppi)
  return joinItems(got.pages[0]!.map(item => ({ item, text: item.text })), got.blocks)
}

test('a space is found from the text size, not the line height: Noto Sans on the row grid and without it', () => {
  expect(joinAll(NOTO_LINE)).toBe('- Geometric resizing keeps inserts at amortized, even though a single rehash costs .')
  // Without the grid the line is the font's 1.36 of the size (14.982 pt).
  expect(joinAll(NOTO_LINE.map(m => (m.h ? { ...m, h: 14.982 } : m)))).toBe('- Geometric resizing keeps inserts at amortized, even though a single rehash costs .')
  // The pieces of one word ("**bo**ld") touch; a glued character joins.
  const word = (x: number, t: string, w: number, more: Partial<Mark> = {}): Mark => ({ k: 'w', p: 1, x, y: 0, s: 11, t, w, h: 22.254, ...more })
  const par: Mark = { k: 'b', p: 1, x: 0, y: 0, s: 11, kind: 'par' }
  expect(joinAll([par, word(0, 'bo', 12.6), word(12.6, 'ld', 9.5), word(24.96, 'and', 19)])).toBe('bold and')
  expect(joinAll([par, word(0, '中', 11), word(11, '文', 11, { g: 1 }), word(24, 'x', 6)])).toBe('中文 x')
})

test('the padding beside inline code is not a space; a space next to it is', () => {
  // Theme vscode: 3 px of padding (2.357 pt), as wide as a space of 0.21 of the size.
  const word = (x: number, t: string, w: number, code = false): Mark => ({ k: 'w', p: 1, x, y: 0, s: 11, t, w, h: 15, ...(code ? { pad: 2.357 } : {}) })
  const par: Mark = { k: 'b', p: 1, x: 0, y: 0, s: 11, kind: 'par' }
  // "a `list` b", "`x`y", "x`y`", "`b`," and "`a == b`" (the spaces of code are its own).
  expect(joinAll([par, word(0, 'a', 6), word(11.217, 'list', 26.49, true), word(42.924, 'b', 6)])).toBe('a list b')
  expect(joinAll([par, word(0, 'x', 6.6, true), word(8.957, 'y', 6)])).toBe('xy')
  expect(joinAll([par, word(0, 'x', 6), word(8.357, 'y', 6.6, true)])).toBe('xy')
  expect(joinAll([par, word(0, 'b', 6.6, true), word(8.957, ',', 3.3)])).toBe('b,')
  expect(joinAll([par, word(0, 'a', 6.6, true), word(12.9, '==', 13.2, true), word(32.4, 'b', 6.6, true)])).toBe('a == b')
  // Noto Sans (a space of 2.86 pt) on the grid's 2 rows.
  const noto = (x: number, t: string, w: number, code = false): Mark => ({ ...word(x, t, w, code), h: 22.254 })
  expect(joinAll([par, noto(0, 'forbids', 36), noto(41.217, 'list', 26.49, true), noto(72.924, 'as', 11)])).toBe('forbids list as')
})

// ---- The drawings noted and their words -----------------------------------

const noted = (name: string): Result => ({
  bulletRow: 0, pages: [{ file: `/c/${name}/a-1.png`, width: 1000, height: 500, columns: 60, rows: 20 }, { file: `/c/${name}/a-2.png`, width: 1000, height: 500, columns: 60, rows: 20 }] as any,
})

// Runs `fn` with the drawings and keys of this module empty, then empties them.
async function withDrawn(fn: () => Promise<void> | void) {
  try {
    drawnAnswers.clear()
    lastKey.clear()
    results.clear()
    forgetProbed()
    await fn()
  } finally {
    drawnAnswers.clear()
    lastKey.clear()
    results.clear()
    forgetProbed()
  }
}

test('a drawing is noted at the box it is drawn at, with the rows under its pages; the same drawing again keeps its seq and takes the new place', () =>
  withDrawn(() => {
    noteDrawn('ans-1', { ...noted('k1'), note: 'Typst error' }, 30, { top: 1, after: 2 })
    const first = drawnAnswers.get('ans-1')!
    expect(first.dir).toBe('/c/k1')
    expect(first.pages.map(p => [p.columns, p.rows])).toEqual([[30, 10], [30, 10]])
    expect(first.place).toEqual({ top: 1, below: 3 })
    const seq = first.seq
    // Same files and boxes: the place changes, the seq does not.
    noteDrawn('ans-1', noted('k1'), 30, { after: 1 })
    expect(drawnAnswers.get('ans-1')!.seq).toBe(seq)
    expect(drawnAnswers.get('ans-1')!.place).toEqual({ below: 1 })
    // Another room is a new drawing, drawn after.
    noteDrawn('ans-1', noted('k1'), 40, {})
    expect(drawnAnswers.get('ans-1')!.seq).toBe(seq + 1)
    expect(clip.seq).toBe(seq + 1)
  }))

test('a drawing keeps the Job of the key it was drawn from, only when that key is its folder', () =>
  withDrawn(() => {
    const job = { env: { cache: '/c' } } as Job
    lastKey.set('ans-1', { key: 'k1', textHash: 'h', job })
    noteDrawn('ans-1', noted('k1'), 60)
    expect(drawnAnswers.get('ans-1')!.job).toBe(job)
    lastKey.set('ans-2', { key: 'other', textHash: 'h', job })
    noteDrawn('ans-2', noted('k2'), 60)
    expect(drawnAnswers.get('ans-2')!.job).toBeUndefined()
  }))

test('a memo hit notes a drawing again only when it was forgotten and the result of its key is a drawing', () =>
  withDrawn(() => {
    noteDrawnAgain('ans-1', 60)
    expect(drawnAnswers.has('ans-1')).toBe(false)
    lastKey.set('ans-1', { key: 'k1', textHash: 'h', job: { env: { cache: '/c' } } as Job })
    results.set('k1', 'failed')
    noteDrawnAgain('ans-1', 60)
    expect(drawnAnswers.has('ans-1')).toBe(false)
    results.set('k1', noted('k1'))
    noteDrawnAgain('ans-1', 60, { top: 1 })
    expect(drawnAnswers.get('ans-1')!.place).toEqual({ top: 1, below: 0 })
    // Already noted: kept as it is.
    const kept = drawnAnswers.get('ans-1')
    noteDrawnAgain('ans-1', 60, { top: 5 })
    expect(drawnAnswers.get('ans-1')).toBe(kept)
  }))

test('the rows on screen are kept on a drawing noted, null when outside the viewport, and dropped when the surface says none', () =>
  withDrawn(() => {
    noteOnScreen('none', { first: 0, last: 1, of: 2 })
    expect(drawnAnswers.has('none')).toBe(false)
    noteDrawn('ans-1', noted('k1'), 60)
    noteOnScreen('ans-1', { first: 3, last: 9, of: 44 })
    expect(drawnAnswers.get('ans-1')!.onScreen).toEqual({ first: 3, last: 9, of: 44 })
    noteOnScreen('ans-1', null)
    expect(drawnAnswers.get('ans-1')!.onScreen).toBeNull()
    noteOnScreen('ans-1', 'junk')
    expect(drawnAnswers.get('ans-1')!.onScreen).toBeUndefined()
  }))

test('the words of a page: none with no Job or no such page; a drawing with no probe file gives none and is not kept', () =>
  withDrawn(async () => {
    const fail$ = { fs: { read: async () => { throw new Error('ENOENT') } } } as any
    noteDrawn('ans-1', noted('k1'), 60)
    const d = drawnAnswers.get('ans-1')!
    expect(await wordsOf(fail$, d, 0)).toBe(null)
    const job = { env: { cache: '/c', typst: '/usr/bin/typst' } } as Job
    expect(await wordsOf(fail$, { ...d, job }, 5)).toBe(null)
    // A failure is not kept: the next copy runs the probe again.
    let reads = 0
    const reading$ = { fs: { read: async () => (reads++, { value: 'not json' }) } } as any
    expect(await wordsOf(reading$, { ...d, job }, 0)).toBe(null)
    expect(await wordsOf(reading$, { ...d, job }, 0)).toBe(null)
    expect(reads).toBe(2)
  }))

// ---- The command ------------------------------------------------------------

test('/iui grab and dump are commands with typeahead rows; dump with nothing seen says so', async $ => {
  const rows = commandSuggestions('/iui gra', 'gra', 5, { themes: [], active: 'claude-code', size: 100 })
  expect(rows).toEqual([{ text: 'grab', description: 'copy the text of the pictures you last selected (or copied, on the main screen)' }])
  expect(commandSuggestions('/iui du', 'du', 5, { themes: [], active: 'claude-code', size: 100 }).map(r => r.text)).toEqual(['dump'])
  const ran = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(ran.text).toContain('Intelligent UI: no clipboard text with picture cells seen yet')
})

// ---- The pipeline: the watcher's clip lines, pbpaste, the probe of a page ------

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// The first 24 bytes of a 1568 x 512 PNG (the fixture's page), as `od` prints them.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 20 00 00 02 00'
const WRAP = 'echo $$; exec "$@"'
const inputsOf = (argv: readonly string[]) => Object.fromEntries(argv.flatMap((a, i) => (argv[i - 1] === '--input' ? [a.split(/=(.*)/s).slice(0, 2)] : [])))

// The world beneath the mod: a cache at /c, a typst whose compile writes a
// 1568 x 512 page per segment and whose query of page n gives the fixture's
// marks on page n (`hold` holds the next query until `release`; a kill ends
// it), the watcher (WATCH_PL: its PID, then with `clip` the change count at
// its start and at each change of the clipboard; `clip none` with
// `noBridge`), pbpaste reading `clipboard`, the shims (pbcopy found, perl,
// the FIFO ASK: IUI_COPY_ASK and PATH set, `envSets`), the ask reader
// (ASK_PL: its PID, then `ask <id>` lines) and the copies, toasts and
// selection the test sees. `copy` is Claude Code's own copy (copy on select
// in fullscreen, /copy, $.ui.copy): the terminal's OSC 52 write of the text
// (a clipboard change), then pbcopy through its shim: picture cells go to
// ask/<id> and the id to the reader; the answer (ANSWER_SH), or the cells
// when the shim gives up after 1.5 s (it leaves its mark), go on the
// clipboard. `copies` are the texts the mod put there. While `selects`, a
// copy of picture cells is this session's selection too. `foreign` is a copy
// with no ask (another session's, the terminal's own on the main screen,
// another app's); `change` is one more change with the same text.
// `tty`: the tty size line its read gives (none: no read), `version`
// Claude Code's (picture select); `strips` the strip cuts run.
function world(on: any, o: { failFirst?: boolean; noBridge?: boolean; env?: Record<string, string>; tty?: string; version?: string } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  const vars: Record<string, string | undefined> = { PATH: '/usr/bin:/bin', ...(o.env ?? { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }) }
  const envSets: [string, string | undefined][] = []
  on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
  on('env.set', async ($: any, e: any) => {
    envSets.push([e.name, e.value])
    vars[e.name] = e.value
    return { value: {} }
  })
  const files = new Map<string, string>()
  const compiles: Record<string, string>[] = []
  const queries: Record<string, string>[] = []
  const kills: string[] = []
  const killers = new Map<string, () => void>()
  type Child = { argv: string[]; pid: string; say: (line: string) => void; dead: boolean; end: (code: number) => void }
  const watchers: Child[] = []
  const readers: Child[] = []
  const waits = new Map<string, (text: string) => void>()
  const w = {
    clock, files, compiles, queries, kills, watchers, readers, vars, envSets,
    ended: [] as string[][], answers: [] as string[], late: [] as string[], cleaned: [] as string[], asks: 0, reads: [] as string[],
    clipboard: 'nothing yet', count: 40, pastes: 0, copies: [] as string[], toasts: [] as string[], strips: [] as string[][], traces: [] as string[],
    selection: undefined as { text: string; requestId?: string } | undefined,
    selects: true,
    gate: null as Promise<void> | null, release: () => {},
    hold() {
      w.gate = new Promise<void>(r => (w.release = r))
    },
    copy(text: string) {
      if (w.selects && hasPlaceholders(text)) w.selection = { text }
      w.foreign(text)
      void w.shim(text)
    },
    // pbcopy through its shim: an ask for picture cells while a reader runs.
    async shim(text: string) {
      let out = text
      const reader = readers.find(c => !c.dead)
      if (hasPlaceholders(text) && reader) {
        const id = `4242-${++w.asks}-7`
        const request = `${ASK_DIR}/${id}`
        files.set(request, text)
        const answered = new Promise<string | null>(r => waits.set(id, r))
        reader.say(`ask ${id}`)
        const got = await Promise.race([answered, clock.sleep(1500).then(() => null)])
        waits.delete(id)
        files.delete(request)
        if (got === null) files.set(`${request}.answer`, '')
        // An empty answer: the shim keeps its own bytes.
        else if (got) out = got
      }
      if (out !== text) w.copies.push(out)
      w.foreign(out)
    },
    foreign(text: string) {
      w.clipboard = text
      w.change()
    },
    change() {
      w.count++
      for (const c of watchers) if (!c.dead && c.argv[3] === 'clip' && !o.noBridge) c.say(`clip ${w.count}`)
    },
  }
  let pids = 5000
  // A long-lived child: its PID, then the lines it is told; a kill ends it.
  async function* child(list: Child[], argv: string[], first: string[]) {
    const pid = String(pids++)
    const lines = [`pid ${pid}`, ...first]
    let wake = () => {}
    let code: number | null = null
    const me: Child = { argv, pid, dead: false, say: line => (lines.push(line), wake()), end: c => ((code = c), (me.dead = true), wake()) }
    list.push(me)
    killers.set(pid, () => ((me.dead = true), wake()))
    for (;;) {
      while (lines.length && !me.dead) yield { stream: 'stdout', text: `${lines.shift()}\n` }
      if (me.dead) return { value: { code, signal: code === null ? 'SIGTERM' : null } }
      await new Promise<void>(r => (wake = r))
    }
  }
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    if (argv[0] === '/usr/bin/perl' && argv[1] === '-e' && argv[2] === WATCH_PL) {
      return yield* child(watchers, argv, argv[3] === 'clip' ? [o.noBridge ? 'clip none' : `clip ${w.count}`] : [])
    }
    if (argv[0] === '/usr/bin/perl' && argv[1] === '-e' && argv[2] === ASK_PL) {
      expect(argv.slice(3)).toEqual([ASK])
      return yield* child(readers, argv, [])
    }
    if (argv[0] !== 'sh' || argv[2] !== WRAP || argv[4] !== '/usr/bin/typst') return { value: { code: 2, signal: null } }
    const pid = String(pids++)
    let killed = false
    const dead = new Promise<void>(r => killers.set(pid, () => ((killed = true), r())))
    yield { stream: 'stdout', text: `${pid}\n` }
    const typst = argv.slice(4)
    if (typst[1] === 'compile') {
      compiles.push(inputsOf(typst))
      const fail = o.failFirst && compiles.length === 1
      if (fail) yield { stream: 'stderr', text: 'error: boom' }
      return { value: { code: fail ? 1 : 0, signal: null } }
    }
    if (typst[1] !== 'query') return { value: { code: 1, signal: null } }
    expect(typst.slice(-3)).toEqual(['<mdpos>', '--field', 'value'])
    const inputs = inputsOf(typst)
    queries.push(inputs)
    if (w.gate) await Promise.race([w.gate, dead])
    if (killed) return { value: { code: null, signal: 'SIGTERM' } }
    yield { stream: 'stdout', text: JSON.stringify(SMALL_MARKS.map(m => ({ ...m, p: Number(inputs.page) }))) }
    return { value: { code: 0, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'kill') {
      kills.push(argv[1]!)
      killers.get(argv[1]!)?.()
      return ok('')
    }
    // The answer: to the shim that waits, else refused (its mark).
    if (argv[0] === 'sh' && argv[2] === ANSWER_SH) {
      const request = argv[4]!
      const text: string = e.init?.stdin ?? ''
      const to = waits.get(request.slice(ASK_DIR.length + 1))
      if (!to || files.has(`${request}.answer`)) {
        w.late.push(text)
        return ok('', 1)
      }
      w.answers.push(text)
      to(text)
      return ok('')
    }
    // After a refused answer: the request and the mark go.
    if (argv[0] === 'sh' && argv[2] === ASK_CLEAN_SH) {
      files.delete(argv[4]!)
      files.delete(`${argv[4]}.answer`)
      w.cleaned.push(argv[4]!)
      return ok('')
    }
    if (argv[0] === 'sh' && argv[2] === ASK_END_SH) {
      w.ended.push(argv.slice(4))
      return ok('')
    }
    if (/cc-intelligent-ui-/.test(cmd)) return ok('/c\nDarwin\n')
    if (o.tty && argv[0] === 'sh' && cmd.includes('ioctl(T')) return ok(o.tty)
    if (argv[0] === 'sh' && argv.some(a => a.endsWith('/render/strips.typ'))) {
      w.strips.push(argv)
      return ok('')
    }
    if (argv[0] === 'sh' && cmd.includes('debug.log')) {
      w.traces.push(e.init?.stdin ?? '')
      return ok('')
    }
    if (argv[1]?.endsWith(SHIM_SETUP) && argv[2] === 'find') return ok(`pid 4242\npbcopy /usr/bin/pbcopy\nperl /usr/bin/perl\nask ${ASK}\n`)
    if (argv[1]?.endsWith(SHIM_SETUP) && argv[2] === 'install') {
      for (const f of argv.slice(5)) {
        files.set(f, files.get(`${f}${argv[4]}`) ?? '')
        files.delete(`${f}${argv[4]}`)
      }
      return ok('')
    }
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (cmd.includes('od -An')) return ok(argv.filter(a => a.endsWith('.png')).map(() => `${HEAD}\n@\n`).join(''))
    if (argv[0] === 'pbpaste') {
      w.pastes++
      return ok(w.clipboard)
    }
    return ok('', 1)
  })
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', async ($: any, e: any, next: any) =>
    e.path.startsWith(`${ASK_DIR}/`) && files.has(e.path) ? { value: { kind: 'file', size: files.get(e.path)!.length, mtimeMs: 1, isLink: false } } : next(e))
  on('fs.read', async ($: any, e: any, next: any) => {
    w.reads.push(e.path)
    return e.path.endsWith('/hooks/clip-shim.sh') ? { value: SHIM_STUB } : files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)
  })
  // One page per segment of the folder's doc.json.
  on('fs.list', async ($: any, e: any, next: any) => {
    if (!e.path.startsWith('/c/')) return next(e)
    const tag = o.failFirst && compiles.length > 1 ? 'b' : 'a'
    const segments = (JSON.parse(files.get(`${e.path}/doc.json`) ?? '{"segments":[""]}') as { segments: string[] }).segments
    return { value: segments.map((_, i) => ({ name: `${tag}-${i + 1}.png`, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) }
  })
  on('ui.copy', async ($: any, e: any) => {
    w.copies.push(e.text)
    w.copy(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.selection', async () => ({ value: w.selection }))
  on('session.version', async () => ({ value: { version: o.version ?? '2.1.306', base: o.version ?? '2.1.306' } }))
  on('ui.toast', async ($: any, e: any) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drawing'] }) as any)
  return w
}

// The shim template, as setUp reads it (the real one: tests/shim-test.sh).
const SHIM_STUB = 'tool=@TOOL@ real=@REAL@ dir=@DIR@ perl=@PERL@'
// The FIFO of this process (Claude Code's pid from the shim find: 4242) and the ask folder.
const ASK = '/c/ask-4242'
const ASK_DIR = '/c/ask'

const message = (requestId: string, text: string, isFullscreen: boolean | null = true) =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40, ...(isFullscreen === null ? {} : { isFullscreen }) },
  }) as any
const props = (text: string) => ({ text, isFirstOfReply: true }) as any
const names = (files: Map<string, string>) => [...new Set([...files.keys()].filter(k => k.startsWith('/c/') && !k.startsWith('/c/shims-') && !k.startsWith(`${ASK_DIR}/`)).map(k => k.replace(/^.*\//, '')))].sort()

// Draws `text` (SMALL_MD) as answer `id` (98 columns: the fixture's),
// compiled; the watcher has its clipboard part (its first count noted).
async function drawAnswer($: any, w: ReturnType<typeof world>, id = 'ans-1', text = SMALL_MD, isFullscreen: boolean | null = true) {
  const ui = await $.ui.mount(message(id, text, isFullscreen))
  await w.clock.settle()
  await ui.redraw(props(text))
  await w.clock.settle()
  await w.clock.advance(300)
  await w.clock.settle()
  return ui
}

// The heading row and the start of the paragraph, as a mouse copy takes them.
const COPY = [cells(1, 0, 97, '⏺ '), cells(2, 0, 97), cells(3, 0, 21)].join('\n')
const COPIED = 'Copy test\nThe quick brown fox jumps'

test('a compile writes no probe file and runs no probe; a copy probes only its page, with the PNG compile inputs', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.compiles.length).toBe(1)
  expect(names(w.files)).toEqual(['doc.json', 'pages.json'])
  expect(w.queries).toEqual([])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  // The PNG compile's inputs, probe=1 and page=1.
  expect(w.queries).toEqual([{ ...w.compiles[0], probe: '1', page: '1' }])
  // Nothing is written for it.
  expect(names(w.files)).toEqual(['doc.json', 'pages.json'])
})

test("an answer's link rows are under its pages: the page on screen is found above them", async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  const long = Array.from({ length: 240 }, (_, i) => `Paragraph ${i} with a few words in it.`).join('\n\n')
  const text = `${long}\n\nSee https://typst.app/docs.\n\n\`\`\`sh\nbrew install typst\n\`\`\``
  const ui = await drawAnswer($, w, 'ans-1', text)
  const pages = (JSON.parse(w.files.get([...w.files.keys()].find(k => k.endsWith('/doc.json'))!)!) as { segments: string[] }).segments.length
  // 16 rows a page under the top margin, then 2 link rows: page 2 is rows 17 to 32.
  const of = 1 + 16 * pages + 2
  await ui.redraw({ ...props(text), onScreen: { first: 17, last: 32, of } })
  await w.clock.settle()
  w.copy([cells(2, 0, 97), cells(3, 0, 97)].join('\n'))
  await w.clock.settle()
  expect(w.queries.map(q => q.page)).toEqual(['2'])
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain(`-> answer ans-1 page 1 (rows 17-32 of ${of} on screen, page top 17)`)
})

test('a compile retried in safe mode gives the probe safe=1 (its page files say so)', async ($, on) => {
  const w = world(on, { failFirst: true })
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.compiles.map(c => c.safe)).toEqual([undefined, '1'])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.queries).toEqual([{ ...w.compiles[1], probe: '1', page: '1' }])
  expect(w.copies).toEqual([COPIED])
  expect(isSafePage('/c/k/b-1.png')).toBe(true)
  expect(isSafePage('/c/k/d-12.png')).toBe(true)
  expect(isSafePage('/c/k/a-1.png')).toBe(false)
  expect(isSafePage('/c/k/c-3.png')).toBe(false)
})

test('a copy over two pages of a long answer probes those two pages only', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  const long = Array.from({ length: 240 }, (_, i) => `Paragraph ${i} with a few words in it.`).join('\n\n')
  await drawAnswer($, w, 'ans-1', long)
  const pages = (JSON.parse(w.files.get([...w.files.keys()].find(k => k.endsWith('/doc.json'))!)!) as { segments: string[] }).segments.length
  expect(pages).toBeGreaterThan(2)
  // The last row of page 1, then the first two rows of page 2.
  w.copy([cells(15, 0, 97, '⏺ '), cells(0, 0, 97), cells(1, 0, 97)].join('\n'))
  await w.clock.settle()
  expect(w.queries.map(q => q.page)).toEqual(['1', '2'])
  expect(w.copies.length).toBe(1)
  expect(w.copies[0]).toContain('Copy test')
})

test('a copy goes to the page on screen: the rows on screen of the last draw (a memo hit) reach the pick and dump', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  const long = Array.from({ length: 240 }, (_, i) => `Paragraph ${i} with a few words in it.`).join('\n\n')
  const ui = await drawAnswer($, w, 'ans-1', long)
  const pages = (JSON.parse(w.files.get([...w.files.keys()].find(k => k.endsWith('/doc.json'))!)!) as { segments: string[] }).segments.length
  expect(pages).toBeGreaterThan(2)
  // 16 rows a page under the top margin: page 2 is rows 17 to 32.
  const of = 1 + 16 * pages
  const compiles = w.compiles.length
  await ui.redraw({ ...props(long), onScreen: { first: 17, last: 32, of } })
  await w.clock.settle()
  expect(w.compiles.length).toBe(compiles)
  const rows = [cells(2, 0, 97), cells(3, 0, 97)].join('\n')
  w.copy(rows)
  await w.clock.settle()
  expect(w.queries.map(q => q.page)).toEqual(['2'])
  expect(w.copies.length).toBe(1)
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain(`-> answer ans-1 page 1 (rows 17-32 of ${of} on screen, page top 17)`)
  // Scrolled up to page 1: the same rows are page 1's.
  await ui.redraw({ ...props(long), onScreen: { first: 0, last: 16, of } })
  await w.clock.settle()
  w.copy(rows)
  await w.clock.settle()
  expect(w.queries.map(q => q.page)).toEqual(['2', '1'])
  expect(w.copies.length).toBe(2)
})

test('positions are kept in memory: copies of the same page share one probe run, and a later copy runs none', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // A slow probe: no toast until the copy is done.
  const before = w.toasts.length
  w.hold()
  w.copy(COPY)
  await w.clock.settle()
  expect(w.queries.length).toBe(1)
  await w.clock.advance(1000)
  expect(w.toasts.length).toBe(before)
  // /iui grab of the same page meanwhile waits for the same run.
  w.selection = { text: COPY, requestId: 'ans-1' }
  const grabbed = $.command.run({ command: 'iui', args: 'grab' } as any)
  await w.clock.settle()
  expect(w.queries.length).toBe(1)
  w.release()
  await w.clock.settle()
  expect((await grabbed).text).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read, row ans-1).')
  expect(w.copies).toEqual([COPIED, COPIED])
  // Known now: no probe and no toast for the next copy.
  const toasts = w.toasts.length
  w.gate = null
  w.selection = undefined
  w.copy([cells(1, 0, 97), cells(2, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.settle()
  await w.clock.advance(1000)
  expect(w.queries.length).toBe(1)
  expect(w.copies.length).toBe(3)
  expect(w.toasts.slice(toasts)).toEqual(['Intelligent UI: copied 35 chars of text'])
})

test("a copy of picture cells gets its text through the shim's ask; the watcher reads each change once and never writes", async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  // No picture drawn: the watcher has no clipboard part, and no ask reader runs.
  await w.clock.advance(900)
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[]])
  expect(w.readers.length).toBe(0)
  await drawAnswer($, w)
  expect(w.readers.length).toBe(1)
  // The first picture: the watcher again with `clip`, the first one killed.
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip']])
  expect(w.kills).toEqual([w.watchers[0]!.pid])
  // Its first count is only noted; no change, no read.
  await w.clock.advance(900)
  expect(w.pastes).toBe(0)
  // A copy with no placeholders: one read, never written.
  w.foreign('copied in another app')
  await w.clock.settle()
  expect(w.pastes).toBe(1)
  w.copy(COPY)
  await w.clock.settle()
  // The shim got the text; the mod wrote nothing itself.
  expect(w.answers).toEqual([COPIED])
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPIED)
  expect(w.toasts).toContain('Intelligent UI: copied 35 chars of text')
  // The OSC 52 write of the cells and the shim's write: read, no hint.
  await w.clock.advance(3000)
  const pastes = w.pastes
  expect(pastes).toBeGreaterThan(1)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
  // The request and the answer are gone.
  expect([...w.files.keys()].filter(k => k.startsWith(`${ASK_DIR}/`))).toEqual([])
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain('U+10EEEE[1,0]')
  expect(dumped.text).toContain('-> answer ans-1 page 0')
  expect(dumped.text).toContain('auto copy on')
  expect(w.files.has('/c/copy-debug.json')).toBe(true)
  // Off: the watcher again with no clipboard part; no reads.
  await $.command.run({ command: 'iui', args: 'off' } as any)
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip'], []])
  await w.clock.settle()
  expect(w.kills).toEqual([w.watchers[0]!.pid, w.watchers[1]!.pid])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.pastes).toBe(pastes)
})

test('/iui details says whether the automatic copy is on', async ($, on) => {
  const w = world(on)
  const details = async () => ((await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? '').split('\n').find(l => l.startsWith('Auto copy:'))
  expect(await details()).toBe('Auto copy: off (no picture yet)')
  await drawAnswer($, w)
  expect(await details()).toBe('Auto copy: on')
  await $.command.run({ command: 'iui', args: 'off' } as any)
  expect(await details()).toBe('Auto copy: off (Intelligent UI is off)')
  // The shims were set up once: the FIFO, then PATH with the folder first.
  expect(w.envSets).toEqual([['IUI_COPY_ASK', ASK], ['PATH', '/c/shims-4242:/usr/bin:/bin']])
  expect(w.files.get('/c/shims-4242/pbcopy')).toBe(`tool='pbcopy' real='/usr/bin/pbcopy' dir='/c/shims-4242' perl='/usr/bin/perl'`)
})

test('with no PerlObjCBridge (clip none) the shim still gets the text; no read, no hint; details says so; grab still copies', async ($, on) => {
  const w = world(on, { noBridge: true })
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.copy(COPY)
  await w.clock.advance(900)
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(w.copies).toEqual([COPIED])
  const details = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(details.text).toContain('\nAuto copy: on (no /iui grab hint: no PerlObjCBridge in /usr/bin/perl)')
  // No new watcher for it: once is enough.
  await drawAnswer($, w, 'ans-2')
  expect(w.watchers.length).toBe(2)
  w.selection = { text: COPY, requestId: 'ans-1' }
  const grabbed = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(grabbed.text).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read, row ans-1).')
})

// Another plugin's `$.ui.copy`, from its command `cp` (args: the text).
const COPIER = {
  name: 'copier',
  register: (on: any) => {
    on('command.run', { command: 'cp' }, async ($: any, e: any) => ({ text: JSON.stringify(await $.ui.copy({ text: e.args })) }))
  },
}

test('a copy of picture cells through $.ui.copy is rewritten to their text; other copies pass as they are', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  const got = await $.command.run({ command: 'cp', args: [cells(1, 0, 97), cells(2, 0, 97), cells(3, 0, 21)].join('\n') } as any)
  expect(JSON.parse(got.text!)).toEqual({ isCopied: true })
  expect(w.copies).toEqual([COPIED])
  await $.command.run({ command: 'cp', args: 'plain text' } as any)
  expect(w.copies[1]).toBe('plain text')
  // The text went through the shim: no ask.
  await w.clock.settle()
  expect(w.answers).toEqual([])
})

test('a $.ui.copy of picture cells is not copied again at its clipboard change', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.selection = { text: COPY, requestId: 'ans-1' }
  await $.command.run({ command: 'cp', args: COPY } as any)
  await w.clock.advance(900)
  await w.clock.settle()
  expect(w.pastes).toBe(2)
  expect(w.copies).toEqual([COPIED])
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied')).length).toBe(0)
})

const GRAB_HINT = 'Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard'

test("another session's copy of the same cells (no ask here) is never rewritten, even with this session's old selection of them; one hint", async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // This session copied these cells a while ago (answered then).
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  await w.clock.advance(60000)
  // The selection stays; another session copies the same cells.
  expect(w.selection?.text).toBe(COPY)
  w.foreign(COPY)
  await w.clock.settle()
  // A shim of this session could still ask: no hint yet.
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPY)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([GRAB_HINT])
  // Its OSC 52 write of the same text: no second hint.
  w.change()
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.toasts.filter(t => t === GRAB_HINT).length).toBe(1)
  expect(w.copies).toEqual([COPIED])
})

test('cells the watcher sees before their ask comes (a slow shim start): the ask in the wait stops the hint', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // The OSC 52 write only, then pbcopy's shim 300 ms later.
  w.foreign(COPY)
  await w.clock.advance(300)
  void w.shim(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
  expect(w.clipboard).toBe(COPIED)
  // A copy that changes in the wait: no hint for the old one.
  w.foreign(COPY.replace(cells(3, 0, 21), cells(3, 0, 20)))
  await w.clock.advance(500)
  w.foreign('copied in another app')
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
})

test("the selection gives the row (its requestId) only when it is that copy", async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  // Two answers that both fit the cells: with no row, the newer one.
  await drawAnswer($, w)
  await drawAnswer($, w, 'ans-2', `${SMALL_MD}\n\nEnd.`)
  w.selects = false
  const picked = async () => ((await $.command.run({ command: 'iui', args: 'dump' } as any)).text ?? '').match(/-> answer (\S+) page/)?.[1]
  // A selection of other cells (and a row) does not name this copy's row.
  w.selection = { text: cells(9, 0, 9), requestId: 'ans-1' }
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(await picked()).toBe('ans-2')
  // The selection of this copy (a last line break less): its row.
  w.selection = { text: COPY, requestId: 'ans-1' }
  w.copy(`${COPY}\n`)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED, COPIED])
  expect(await picked()).toBe('ans-1')
})

test('cells that can not be read: an empty answer at once (no wait; the shim keeps its cells), one toast for each copy', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // Column 150: wider than any picture drawn.
  const text = [cells(1, 0, 150), cells(2, 0, 150)].join('\n')
  w.copy(text)
  await w.clock.settle()
  expect(w.answers).toEqual([''])
  expect(w.clipboard).toBe(text)
  expect(w.copies).toEqual([])
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: could not read')).length).toBe(1)
  // No /iui grab hint for it: its own shim asked.
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
  w.copy(text)
  await w.clock.settle()
  expect(w.answers).toEqual(['', ''])
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: could not read')).length).toBe(2)
})

test('a request over ASK_MAX bytes is not read: an empty answer at once', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.reads.length = 0
  const big = `${COPY}${' '.repeat(ASK_MAX)}`
  void w.shim(big)
  await w.clock.settle()
  expect(w.answers).toEqual([''])
  expect(w.reads.filter(p => p.startsWith(`${ASK_DIR}/`))).toEqual([])
  expect(w.clipboard).toBe(big)
  expect(w.copies).toEqual([])
})

test('a throw while the text is read (a bad selection): an empty answer all the same', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.selects = false
  w.selection = { text: 5 } as any
  void w.shim(COPY)
  await w.clock.settle()
  expect(w.answers).toEqual([''])
  expect(w.clipboard).toBe(COPY)
  expect(w.copies).toEqual([])
})

test('a bad id is never read or answered; an id with no request file gets an empty answer', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.reads.length = 0
  w.files.set('/c/secret', COPY)
  w.files.set(`${ASK_DIR}/.hidden`, COPY)
  for (const id of ['../secret', '.hidden', '..', 'a/b', 'x'.repeat(200), '4242-1-1']) w.readers[0]!.say(`ask ${id}`)
  await w.clock.settle()
  expect(w.reads.filter(p => p.startsWith('/c/'))).toEqual([])
  expect(w.answers).toEqual([])
  // Only 4242-1-1 (no shim waits for it): refused, its files go.
  expect(w.late).toEqual([''])
  expect(w.cleaned).toEqual([`${ASK_DIR}/4242-1-1`])
  expect(w.copies).toEqual([])
  expect(w.toasts.filter(t => t.includes('not ready'))).toEqual([])
})

const NOT_READY = 'Intelligent UI: the picture text was not ready in time; /iui grab copies it'

test('a late answer (the shim gave up at 1.5 s) writes nothing: the cells stay, one toast names /iui grab', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // A slow probe: the shim gives up and writes the cells, with its mark.
  w.hold()
  w.copy(COPY)
  await w.clock.settle()
  await w.clock.advance(1500)
  expect(w.clipboard).toBe(COPY)
  expect([...w.files.keys()].filter(k => k.startsWith(`${ASK_DIR}/`))).toEqual([`${ASK_DIR}/4242-1-7.answer`])
  w.release()
  await w.clock.settle()
  // The answer meets the mark: no write, the files go, one toast.
  expect(w.late).toEqual([COPIED])
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe(COPY)
  expect([...w.files.keys()].filter(k => k.startsWith(`${ASK_DIR}/`))).toEqual([])
  expect(w.toasts.filter(t => t === NOT_READY)).toEqual([NOT_READY])
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied'))).toEqual([])
  // Its own shim asked for these cells: no /iui grab hint as well.
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
  // /iui grab then copies the text.
  expect((await $.command.run({ command: 'iui', args: 'grab' } as any)).text).toContain('copied')
  expect(w.copies).toEqual([COPIED])
})

test('session A in fullscreen keeps an old selection equal to the cells; the same cells come on the clipboard not through its shim: no write by A, at most one hint', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // An old selection of A, with the text of these cells.
  w.selection = { text: COPY }
  await w.clock.advance(60000)
  // Another session copies identical cells (no ask comes to A).
  w.foreign(COPY)
  await w.clock.settle()
  await w.clock.advance(HINT_WAIT_MS)
  w.change()
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.copies).toEqual([])
  expect(w.answers).toEqual([])
  expect(w.clipboard).toBe(COPY)
  expect(w.toasts.filter(t => t === GRAB_HINT).length).toBeLessThanOrEqual(1)
})

test('the same copy again while its picture is read: one probe, each copy gets the text', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.hold()
  w.copy(COPY)
  await w.clock.settle()
  w.copy(COPY)
  await w.clock.settle()
  w.release()
  await w.clock.settle()
  expect(w.queries.length).toBe(1)
  expect(w.copies).toEqual([COPIED, COPIED])
  expect(w.clipboard).toBe(COPIED)
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied')).length).toBe(2)
})

test('a watcher that starts again gives no hint for the clipboard that was there before (its first count is only noted)', async ($, on) => {
  const w = world(on)
  // Picture cells on the clipboard before this load (a hot reload).
  w.clipboard = COPY
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  await w.clock.advance(3000)
  expect(w.pastes).toBe(0)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
  // A new copy is answered.
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
})

test('the ask reader that ends on its own is started again, ASK_RESTARTS times at most; a FIFO that is not safe (exit 3) is final', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  const details = async () => ((await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? '').split('\n').find(l => l.startsWith('Auto copy:'))
  for (let i = 0; i < ASK_RESTARTS; i++) {
    w.readers.at(-1)!.end(0)
    await w.clock.settle()
    expect(await details()).toBe('Auto copy: off (the ask reader does not run)')
    await w.clock.advance(ASK_RESTART_MS)
    expect(w.readers.length).toBe(i + 2)
    expect(await details()).toBe('Auto copy: on')
  }
  // The new reader gets the asks.
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  // The cap: no more.
  w.readers.at(-1)!.end(0)
  await w.clock.advance(ASK_RESTART_MS * 3)
  expect(w.readers.length).toBe(ASK_RESTARTS + 1)
  // No reader: the shim writes the cells at once (its FIFO open fails).
  w.copy(COPY)
  await w.clock.settle()
  expect(w.clipboard).toBe(COPY)
  expect(w.copies).toEqual([COPIED])
})

test('an unsafe FIFO (the reader exits 3) is not read again', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.readers[0]!.end(3)
  await w.clock.advance(ASK_RESTART_MS * 3)
  expect(w.readers.length).toBe(1)
})

test('at an exit the watcher and the ask reader are killed, no child takes their place, the FIFO and the requests go; a /clear keeps the reader', async ($, on) => {
  const w = world(on)
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip']])
  await $.session.end({ reason: 'clear', sessionId: 's1' } as any)
  await w.clock.settle()
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip'], []])
  // The process goes on: the reader and its FIFO stay.
  expect(w.ended).toEqual([])
  expect(w.readers.map(c => c.dead)).toEqual([false])
  expect(w.kills).toEqual([w.watchers[0]!.pid, w.watchers[1]!.pid])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(w.copies).toEqual([COPIED])
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2' } as any)
  await w.clock.settle()
  await w.clock.advance(5000)
  expect(w.watchers.length).toBe(3)
  expect(w.readers.length).toBe(1)
  expect(w.kills).toEqual([...w.watchers.map(c => c.pid), w.readers[0]!.pid])
  expect(w.ended).toEqual([[ASK, ASK_DIR, '4242', '/c/shims-4242']])
})

test('a clip child that ends on its own is started again; its old clipboard gets no hint', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  const first = w.watchers[1]!
  first.dead = true
  first.say('')
  await w.clock.settle()
  // Picture cells put on the clipboard while no child watched: the count of
  // the new child at its start is only noted.
  w.clipboard = COPY
  w.count++
  await w.clock.advance(WATCH_RESTART_MS)
  await w.clock.settle()
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip'], ['clip']])
  expect(w.pastes).toBe(0)
  // The new child sees a later copy of another session.
  w.foreign([cells(1, 0, 97), cells(2, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([GRAB_HINT])
})

// ---- The main screen: the terminal copies, so no automatic copy ------------

const FULLSCREEN_TOAST = 'Intelligent UI works best in fullscreen mode: run /tui fullscreen'

test('main screen: picture cells on the clipboard are never rewritten (their session is not known); one toast names /iui grab', async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  // The terminal's own copy (or another session's): no ask, so no write,
  // no probe, one toast at once.
  w.foreign(COPY)
  await w.clock.settle()
  await w.clock.advance(1000)
  expect(w.pastes).toBe(1)
  expect(w.copies).toEqual([])
  expect(w.queries).toEqual([])
  expect(w.toasts.filter(t => t.includes('/iui grab'))).toEqual([GRAB_HINT])
  // dump shows them (its read probes the page).
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain('auto copy off on the main screen (use /iui grab)')
  expect(dumped.text).toContain('-> answer ans-1 page 0')
  // The same cells again: no second toast.
  w.foreign(COPY)
  await w.clock.settle()
  expect(w.toasts.filter(t => t.includes('/iui grab')).length).toBe(1)
  // Cells that fit no page drawn here (column 150): no toast.
  w.foreign([cells(1, 0, 150), cells(2, 0, 150)].join('\n'))
  await w.clock.settle()
  expect(w.toasts.filter(t => t.includes('/iui grab')).length).toBe(1)
  expect(w.copies).toEqual([])
  expect(w.queries.length).toBe(1)
})

test('main screen: /iui grab with no selection reads the clipboard and writes its text; a second grab says it is there', async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  w.foreign(COPY)
  await w.clock.settle()
  const grabbed = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(grabbed.text).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read).')
  expect(w.copies).toEqual([COPIED])
  // Our own write is not read back as new: no toast, no copy.
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(w.toasts.filter(t => t.includes('/iui grab')).length).toBe(1)
  const again = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(again.text).toBe('Intelligent UI: the clipboard has the text already.')
  expect(w.copies).toEqual([COPIED])
  w.foreign('plain text')
  await w.clock.settle()
  const none = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(none.text).toBe('Intelligent UI: no mouse selection and no picture cells on the clipboard; select over a picture and copy first.')
  expect(w.copies).toEqual([COPIED])
})

test('main screen: /copy or $.ui.copy of picture cells gets their text (the ui.copy hook), with no hint', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  await $.command.run({ command: 'cp', args: COPY } as any)
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPIED)
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([])
})

// The ask says whose copy it is, so a write is safe before the layout is known.
test('fullscreen or main screen not known yet: a copy through the shim gets its text, another one gets the hint', async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, null)
  w.foreign(COPY)
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.copies).toEqual([])
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([GRAB_HINT])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  const details = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(details.text).toContain('\nAuto copy: on')
  // No advice: the layout is not known.
  expect(w.toasts).not.toContain(FULLSCREEN_TOAST)
})

test('the fullscreen advice: once on the main screen, never in fullscreen', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  await drawAnswer($, w, 'ans-2', `${SMALL_MD}\n\nEnd.`, false)
  expect(w.toasts.filter(t => t === FULLSCREEN_TOAST).length).toBe(1)
})

test('the fullscreen advice is not shown in fullscreen', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.toasts).not.toContain(FULLSCREEN_TOAST)
})

test('the fullscreen advice is not shown where no picture draws (tmux)', async ($, on) => {
  const w = world(on, { env: { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', TMUX: '/tmp/tmux-501/default,1,0' } })
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  expect(w.compiles).toEqual([])
  expect(w.toasts).not.toContain(FULLSCREEN_TOAST)
})

test('the fullscreen advice is not shown with Intelligent UI off', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: 'off' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  expect(w.toasts).not.toContain(FULLSCREEN_TOAST)
})

// ---- Picture select -----------------------------------------------------------

// The tty of the fixture's page: 100 columns (98 for the picture) of 16 x 32 px.
const TTY = '40 100 1600 1280'
const tree = (node: any): any[] => (node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(tree)] : [])
const stripImages = (drawn: any) => tree(drawn).filter(n => n.type === 'Image' && /\.strips\//.test(n.props.source?.file ?? ''))
// The selected rows drawn: each strip's row (its Box in the flow, its
// marginTop the rows after the row before), and its Box's columns.
const selectedOf = (drawn: any) => {
  let next = 0
  return tree(drawn)
    .filter(n => n.type === 'Box' && n.props.overflow === 'hidden' && n.props.height === 1 && n.props.backgroundColor)
    .map(n => {
      const row = next + n.props.marginTop
      next = row + 1
      return { row, x0: n.props.marginLeft, x1: n.props.marginLeft + n.props.width - 1 }
    })
}

test('picture select: a drag over a page draws its rows over it and copies their text on the up', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  const client = tree(await ui.drawn()).find(n => n.type === 'Client')
  expect(client?.props).toMatchObject({ key: 'sel0', width: 98, height: 16, props: { id: 'ans-1', page: 0 } })
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await w.clock.settle()
  // The page's strips are cut at the down: rows of 32 px.
  expect(w.strips.length).toBe(1)
  expect(w.strips[0]).toContain('row=32')
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 21, y: 3, button: 'left', in: 'sel0' })
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(w.toasts).toContain(`Intelligent UI: copied ${COPIED.length} chars of text`)
  const drawn = await ui.drawn()
  expect(selectedOf(drawn)).toEqual([{ row: 1, x0: 0, x1: 97 }, { row: 2, x0: 0, x1: 97 }, { row: 3, x0: 0, x1: 21 }])
  expect(stripImages(drawn).map(n => n.props.source.file.replace(/^.*\//, ''))).toEqual(['s-02.png', 's-03.png', 's-04.png'])
  expect(stripImages(drawn).every(n => n.props.columns === 98 && n.props.rows === 1)).toBe(true)
  // The rows, then the Client, pulled up over the page in the flow: no
  // absolute Box (the engine moves one scrolled above the screen to row 0).
  const page = tree(drawn).find(n => n.type === 'Box' && n.props.flexDirection === 'column' && n.props.width === 98 && n.props.height === 16)
  expect(page.children.map((c: any) => c.props.marginTop)).toEqual([undefined, -16, -16])
  expect(page.children[2].children[0].type).toBe('Client')
  expect(tree(page).some(n => n.props?.position === 'absolute')).toBe(false)
  // A click with no drag clears it, and copies nothing.
  await ui.pointer({ type: 'down', x: 5, y: 5, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 5, y: 5, button: 'left', in: 'sel0' })
  await w.clock.settle()
  expect(selectedOf(await ui.drawn())).toEqual([])
  expect(w.copies).toEqual([COPIED])
  // The strips are cut once.
  expect(w.strips.length).toBe(1)
})

test('picture select: with IUI_DEBUG, each post writes a trace line (the post, its region, the rows selected)', async ($, on) => {
  const w = world(on, { tty: TTY, env: { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', IUI_DEBUG: '1' } })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await w.clock.settle()
  const lines = w.traces.filter(t => t.includes('select: '))
  expect(lines.length).toBe(2)
  expect(lines[0]).toContain('select: down #')
  // The kit gives a Client the terminal's size, the engine its region's.
  expect(lines[0]).toMatch(/ans-1 page 0 anchor 0,1 head 0,1 size \d+x\d+ drawn 98x16 onScreen /)
  expect(lines[0]).toContain('rows none')
  expect(lines[1]).toContain('anchor 0,1 head 10,2 size ')
  expect(lines[1]).toContain('rows p0 1..2 (2)')
})

test('picture select: with no IUI_DEBUG, a post writes no trace line', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await w.clock.settle()
  expect(w.traces.filter(t => t.includes('select: '))).toEqual([])
})

test('picture select: none before Claude Code 2.1.305', async ($, on) => {
  const old = world(on, { tty: TTY, version: '2.1.304' })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, old)
  expect(tree(await ui.drawn()).some(n => n.type === 'Client')).toBe(false)
})

test('picture select: none on the main screen', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  expect(tree(await ui.drawn()).some(n => n.type === 'Client')).toBe(false)
})

test('picture select: /iui select off takes the Client away', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  expect(tree(await ui.drawn()).some(n => n.type === 'Client')).toBe(true)
  await $.command.run({ command: 'iui', args: 'select off' } as any)
  await w.clock.settle()
  await ui.redraw(props(SMALL_MD))
  await w.clock.settle()
  expect(tree(await ui.drawn()).some(n => n.type === 'Client')).toBe(false)
})
