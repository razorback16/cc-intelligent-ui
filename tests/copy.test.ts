import { expect, mock, test } from 'claude-code/testing'

import {
  codePointsOf, commandSuggestions, decodeSelection, DIACRITICS, hasPlaceholders, isDrawnIn, joinSegments, pageTopsOf, pickPages,
  placeholderCell, isSafePage, positionsOf, screenOf, textOfRun, WATCH_PL, type Drawn, type TextBlock, type Item, type Mark, type OnScreen,
  type Place,
} from '../hooks/register'
import { joinItems } from '../hooks/lib/copy'
import { WATCH_RESTART_MS } from '../hooks/lib/frame'
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
// `noBridge`), pbpaste reading `clipboard`, and the copies, toasts and
// selection the test sees. `copy` is a copy in another app (or a mouse
// copy): the clipboard and its change count change; while `selects`, a copy
// of picture cells is this session's selection too (a mouse copy in
// fullscreen).
function world(on: any, o: { failFirst?: boolean; noBridge?: boolean; env?: Record<string, string> } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, o.env ?? { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  const files = new Map<string, string>()
  const compiles: Record<string, string>[] = []
  const queries: Record<string, string>[] = []
  const kills: string[] = []
  const killers = new Map<string, () => void>()
  const watchers: { argv: string[]; pid: string; say: (line: string) => void; dead: boolean }[] = []
  const w = {
    clock, files, compiles, queries, kills, watchers,
    clipboard: 'nothing yet', count: 40, pastes: 0, copies: [] as string[], toasts: [] as string[],
    selection: undefined as { text: string; requestId?: string } | undefined,
    selects: true,
    gate: null as Promise<void> | null, release: () => {},
    hold() {
      w.gate = new Promise<void>(r => (w.release = r))
    },
    copy(text: string) {
      w.clipboard = text
      if (w.selects && hasPlaceholders(text)) w.selection = { text }
      w.count++
      for (const c of watchers) if (!c.dead && c.argv[3] === 'clip' && !o.noBridge) c.say(`clip ${w.count}`)
    },
  }
  let pids = 5000
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    if (argv[0] === '/usr/bin/perl' && argv[1] === '-e' && argv[2] === WATCH_PL) {
      const pid = String(pids++)
      const lines = [`pid ${pid}`, ...(argv[3] === 'clip' ? [o.noBridge ? 'clip none' : `clip ${w.count}`] : [])]
      let wake = () => {}
      const me = { argv, pid, dead: false, say: (line: string) => (lines.push(line), wake()) }
      watchers.push(me)
      killers.set(pid, () => ((me.dead = true), wake()))
      for (;;) {
        while (lines.length && !me.dead) yield { stream: 'stdout', text: `${lines.shift()}\n` }
        if (me.dead) return { value: { code: null, signal: 'SIGTERM' } }
        await new Promise<void>(r => (wake = r))
      }
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
    if (/cc-intelligent-ui-/.test(cmd)) return ok('/c\nDarwin\n')
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
  on('fs.read', async ($: any, e: any, next: any) => (files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)))
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
  on('ui.toast', async ($: any, e: any) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drawing'] }) as any)
  return w
}

const message = (requestId: string, text: string, isFullscreen: boolean | null = true) =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40, ...(isFullscreen === null ? {} : { isFullscreen }) },
  }) as any
const props = (text: string) => ({ text, isFirstOfReply: true }) as any
const names = (files: Map<string, string>) => [...new Set([...files.keys()].filter(k => k.startsWith('/c/')).map(k => k.replace(/^.*\//, '')))].sort()

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

test('a clipboard change runs pbpaste once and copies; no change, no read; our own write is not read as new', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  // No picture drawn: the watcher has no clipboard part.
  await w.clock.advance(900)
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[]])
  await drawAnswer($, w)
  // The first picture: the watcher again with `clip`, the first one killed.
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip']])
  expect(w.kills).toEqual([w.watchers[0]!.pid])
  // Its first count is only noted; no change, no read.
  await w.clock.advance(900)
  expect(w.pastes).toBe(0)
  // A copy with no placeholders (and no selection of picture cells): no read, never written.
  w.copy('copied in another app')
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(w.copies).toEqual([])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(w.toasts).toContain('Intelligent UI: copied 35 chars of text')
  // One read before the write; our own write changes the count: read
  // once, not copied again.
  expect(w.pastes).toBe(3)
  await w.clock.advance(900)
  expect(w.pastes).toBe(3)
  expect(w.copies.length).toBe(1)
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
  expect(w.pastes).toBe(3)
})

test('/iui details says whether the automatic copy is on', async ($, on) => {
  const w = world(on)
  const details = async () => ((await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? '').split('\n').find(l => l.startsWith('Auto copy:'))
  expect(await details()).toBe('Auto copy: off (no picture yet)')
  await drawAnswer($, w)
  expect(await details()).toBe('Auto copy: on')
  await $.command.run({ command: 'iui', args: 'off' } as any)
  expect(await details()).toBe('Auto copy: off (Intelligent UI is off)')
})

test('with no PerlObjCBridge (clip none) the copy is off: no read, no copy; details says why; grab still copies', async ($, on) => {
  const w = world(on, { noBridge: true })
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.copy(COPY)
  await w.clock.advance(900)
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(w.copies).toEqual([])
  const details = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(details.text).toContain('\nAuto copy: off (no PerlObjCBridge in /usr/bin/perl)')
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
})

test('a $.ui.copy of picture cells is not copied again at its clipboard change', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.selection = { text: COPY, requestId: 'ans-1' }
  await $.command.run({ command: 'cp', args: COPY } as any)
  await w.clock.advance(900)
  await w.clock.settle()
  expect(w.pastes).toBe(1)
  expect(w.copies).toEqual([COPIED])
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied')).length).toBe(0)
})

test('a clipboard with picture cells that is not this session\'s selection is not rewritten (another session\'s copy)', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.selects = false
  // This session has a selection of its own picture cells, and the
  // clipboard has other picture cells (another session's).
  w.selection = { text: cells(2, 0, 97), requestId: 'ans-1' }
  w.copy([cells(1, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.settle()
  expect(w.pastes).toBe(1)
  expect(w.copies).toEqual([])
  // The same copy as the selection, with a last line break: rewritten.
  w.selection = { text: COPY, requestId: 'ans-1' }
  w.copy(`${COPY}\n`)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
})

test('in fullscreen the clipboard is read only with a selection of picture cells; with none it is another session\'s copy', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.selects = false
  // No selection here: another fullscreen session's copy, not even read.
  w.selection = undefined
  w.copy(COPY)
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(w.copies).toEqual([])
  // A selection of text only: a copy of it has no picture cells.
  w.selection = { text: 'my own text', requestId: 'u1' }
  w.copy('my own text')
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(w.copies).toEqual([])
  // This session's own selection: rewritten.
  w.selection = { text: COPY, requestId: 'ans-1' }
  w.copy(`${COPY}\n`)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
})

test('a watcher that starts again does not copy the clipboard that was there before (its first count is only noted)', async ($, on) => {
  const w = world(on)
  // Picture cells on the clipboard before this load (a hot reload).
  w.clipboard = COPY
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  await w.clock.advance(900)
  expect(w.pastes).toBe(0)
  expect(w.copies).toEqual([])
  // A new copy is copied.
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
})

test('a copy that can not be read gives one toast; the same text again gives none', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // Column 150: wider than any picture drawn.
  const text = [cells(1, 0, 150), cells(2, 0, 150)].join('\n')
  w.copy(text)
  await w.clock.settle()
  w.copy(text)
  await w.clock.settle()
  expect(w.pastes).toBe(2)
  expect(w.copies).toEqual([])
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: could not read')).length).toBe(1)
})

test('a clipboard change while a copy is read: the newer clipboard is read after it and is not written over', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.hold()
  w.copy(COPY)
  await w.clock.settle()
  expect(w.queries.length).toBe(1)
  w.copy('copied in another app')
  await w.clock.settle()
  expect(w.pastes).toBe(1)
  w.release()
  await w.clock.settle()
  // One read before the write (not the copy now: no write), one of the newer.
  expect(w.pastes).toBe(3)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe('copied in another app')
})

test('the same copy again while its picture is read: copied once, one toast', async ($, on) => {
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
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPIED)
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied'))).toEqual(['Intelligent UI: copied 35 chars of text'])
  // A copy of it after the write is a new copy: copied again (no probe).
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED, COPIED])
  expect(w.queries.length).toBe(1)
})

test('a newer clipboard that the watcher has not said yet is not written over; it is read next', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // Other picture cells: copied as their own text, not the first copy's.
  w.hold()
  w.copy([cells(2, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.settle()
  w.clipboard = COPY
  w.selection = { text: COPY }
  w.release()
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPIED)
  // Text with no picture cells (a page not probed yet): kept as it is.
  await drawAnswer($, w, 'ans-2', `${SMALL_MD}\n\nEnd.`)
  w.gate = null
  w.hold()
  w.copy(COPY)
  await w.clock.settle()
  expect(w.queries.length).toBe(2)
  w.clipboard = 'copied in another app'
  w.release()
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe('copied in another app')
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied')).length).toBe(1)
  // Its change comes late: one read, the same text, nothing more.
  const pastes = w.pastes
  w.copy('copied in another app')
  await w.clock.settle()
  expect(w.pastes).toBe(pastes + 1)
  expect(w.copies).toEqual([COPIED])
})

test('at an exit the watcher is killed and no child takes its place; a /clear starts it again with no clipboard part', async ($, on) => {
  const w = world(on)
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip']])
  await $.session.end({ reason: 'clear', sessionId: 's1' } as any)
  await w.clock.settle()
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip'], []])
  expect(w.kills).toEqual([w.watchers[0]!.pid, w.watchers[1]!.pid])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2' } as any)
  await w.clock.settle()
  await w.clock.advance(5000)
  expect(w.watchers.length).toBe(3)
  expect(w.kills).toEqual(w.watchers.map(c => c.pid))
})

test('a clip child that ends on its own is started again; its old clipboard is not written', async ($, on) => {
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
  w.copy(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
})

// ---- The main screen: no selection, so no automatic copy ---------------------

const GRAB_TOAST = 'Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard'
const FULLSCREEN_TOAST = 'Intelligent UI works best in fullscreen mode: run /tui fullscreen'

test('main screen: picture cells on the clipboard are never rewritten (their session is not known); one toast names /iui grab', async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  // Another session's cells: no write, no probe, one toast.
  w.copy(COPY)
  await w.clock.settle()
  await w.clock.advance(1000)
  expect(w.pastes).toBe(1)
  expect(w.copies).toEqual([])
  expect(w.queries).toEqual([])
  expect(w.toasts.filter(t => t.includes('/iui grab'))).toEqual([GRAB_TOAST])
  // dump shows them (its read probes the page).
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain('auto copy off on the main screen (use /iui grab)')
  expect(dumped.text).toContain('-> answer ans-1 page 0')
  // The same cells again: no second toast.
  w.copy(COPY)
  await w.clock.settle()
  expect(w.toasts.filter(t => t.includes('/iui grab')).length).toBe(1)
  // Cells that fit no page drawn here (column 150): no toast.
  w.copy([cells(1, 0, 150), cells(2, 0, 150)].join('\n'))
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
  w.copy(COPY)
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
  w.copy('plain text')
  await w.clock.settle()
  const none = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(none.text).toBe('Intelligent UI: no mouse selection and no picture cells on the clipboard; select over a picture and copy first.')
  expect(w.copies).toEqual([COPIED])
})

test('fullscreen or main screen not known yet: the clipboard is never written', async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, null)
  // Even with a selection that is the copy.
  w.selection = { text: COPY, requestId: 'ans-1' }
  w.copy(COPY)
  await w.clock.settle()
  await w.clock.advance(1000)
  expect(w.copies).toEqual([])
  expect(w.queries).toEqual([])
  const details = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(details.text).toContain('\nAuto copy: off (fullscreen or main screen is not known yet)')
  // No advice either: the layout is not known.
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
