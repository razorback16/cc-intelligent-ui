import { expect, mock, test } from 'claude-code/testing'

import {
  codePointsOf, commandSuggestions, decodeSelection, DIACRITICS, hasPlaceholders, isDrawnIn, joinSegments, pageTopsOf, pickPages,
  placeholderCell, isSafePage, positionsOf, READ_PL, screenOf, textOfRun, WATCH_PL, type Drawn, type TextBlock, type Item, type Mark, type OnScreen,
  type Place,
} from '../hooks/register'
import * as registerModule from '../hooks/register'
import * as clipboardModule from '../hooks/lib/clipboard'
import * as settingsModule from '../hooks/lib/settings'
import { joinItems } from '../hooks/lib/copy'
import { WATCH_RESTART_MS } from '../hooks/lib/frame'
import { rowsAfter, type Under } from '../hooks/lib/pictures'
import { forgetProbed, noteDrawn, noteDrawnAgain, noteOnScreen, wordsOf } from '../hooks/lib/probe'
import { clip, drawnAnswers, lastKey, results, type Job, type Result } from '../hooks/lib/state'
import { forgetBlits, over, rgbOf, WRITE_PL } from '../hooks/lib/blit'
import { forgetRedraws } from '../hooks/lib/select'
import { chunk, concat, decodePng, deflatePiece, fromBase64, headOf, tailOf, toBase64 } from '../hooks/lib/png'
import { LONG_MARKS, LONG_MD, LONG_PAGE, MATH_MARKS, MATH_MD, MATH_PAGE, SMALL_MARKS, SMALL_MD, SMALL_PAGE, SMALL_PPI, TARGETS_MARKS, TARGETS_MD, TARGETS_PAGE } from './copy-fixture'

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
  // The item keeps its number's centre (`mx`): (20 + 3) pt at 2 px/pt.
  expect(got.blocks).toEqual([{ kind: 'par', prefix: '', first: 0 }, { kind: 'item', prefix: '1. ', mx: 46, first: 1 }])
  expect(got.pages[0]).toEqual([{ i: 0, text: 'Hi', block: 0, x0: 0, x1: 20, y0: 0, y1: 24 }])
  expect(got.pages[1]).toEqual([
    { i: 1, text: 'one', block: 1, x0: 60, x1: 90, y0: 60, y1: 84 },
    { i: 2, text: 'ab', block: 1, x0: 20, x1: 44, y0: 104, y1: 124, adv: 12 },
  ])
})

test("a word keeps its link's URL and its inline code's text", () => {
  const marks: Mark[] = [
    { k: 'b', p: 1, x: 0, y: 0, kind: 'par' },
    { k: 'w', p: 1, x: 0, y: 0, t: 'docs', w: 10, h: 12, href: 'https://x.io' },
    { k: 'w', p: 1, x: 20, y: 0, t: 'a.ts', w: 10, h: 12, code: 'a.ts', pad: 1 },
    { k: 'b', p: 1, x: 0, y: 20, kind: 'item', prefix: '- ' },
    { k: 'b', p: 1, x: 0, y: 20, kind: 'code' },
    { k: 'c', p: 1, x: 0, y: 30, t: 'ls', w: 12, n: 2, a: 8, d: 2 },
    { k: 'b', p: 1, x: 0, y: 40, kind: 'code' },
    { k: 'c', p: 1, x: 0, y: 50, t: 'x', w: 6, n: 1, a: 8, d: 2 },
  ]
  const got = positionsOf(marks, 72)
  expect(got.blocks).toEqual([
    { kind: 'par', prefix: '', first: 0 },
    { kind: 'item', prefix: '- ', mx: 0, first: 2 },
    { kind: 'code', prefix: '', first: 3 },
  ])
  expect(got.pages[0]!.map(w => [w.text, w.href, w.code])).toEqual([
    ['docs', 'https://x.io', undefined],
    ['a.ts', undefined, 'a.ts'],
    ['ls', undefined, undefined],
    ['x', undefined, undefined],
  ])
  expect(got.pages[0]![1]).toEqual({ i: 1, text: 'a.ts', block: 0, x0: 20, x1: 30, y0: 0, y1: 12, pad: 1, code: 'a.ts' })
})

test("a code block's copy tag is a button in pixels, on its page; no word, so the copy of the text does not change", () => {
  const marks: Mark[] = [
    { k: 'b', p: 1, x: 0, y: 0, kind: 'code' },
    { k: 't', p: 2, x: 100, y: 4, s: 11, kind: 'copy', w: 30, h: 12, code: 'ls\npwd', lang: 'sh' },
    { k: 'c', p: 2, x: 0, y: 30, t: 'ls', w: 12, n: 2, a: 8, d: 2 },
    { k: 't', p: 2, x: 100, y: 50, kind: 'copy', w: 30, h: 12, code: 'x' },
    // Another tag kind, or one with no code: dropped.
    { k: 't', p: 2, x: 0, y: 0, kind: 'other', w: 1, h: 1, code: 'y' },
    { k: 't', p: 2, x: 0, y: 0, kind: 'copy', w: 1, h: 1 },
  ]
  const got = positionsOf(marks, 144)
  expect(got.buttons).toEqual([[], [{ x0: 200, y0: 8, x1: 260, y1: 32, code: 'ls\npwd', lang: 'sh' }, { x0: 200, y0: 100, x1: 260, y1: 124, code: 'x' }]])
  expect(got.pages).toEqual([[], [{ i: 0, text: 'ls', block: 0, x0: 0, x1: 24, y0: 44, y1: 64, adv: 12 }]])
  expect(got.blocks).toEqual([{ kind: 'code', prefix: '', first: 0 }])
  // One line break at the end goes ("\n" or "\r\n"), not more, and no other space.
  const code = (c: string) => positionsOf([{ k: 't', p: 1, x: 0, y: 0, kind: 'copy', w: 1, h: 1, code: c }], 72).buttons[0]![0]!.code
  expect([code('ls\n'), code('ls\r\n'), code('ls\n\n'), code('ls  \n'), code('\tls '), code('\n')]).toEqual(['ls', 'ls', 'ls\n', 'ls  ', '\tls ', ''])
  // An old probe (no tags): no buttons.
  expect(positionsOf(marks.filter(m => m.k !== 't'), 144).buttons).toEqual([])
  // The text of the fixture's page (its probe has a tag) is the same with no tag.
  const all = Array.from({ length: TARGETS_PAGE.rows }, (_, row) => ({ row, colStart: 0, colEnd: 97 }))
  const textOf = (ms: readonly object[]) => {
    const p = positionsOf(ms as unknown as Mark[], SMALL_PPI)
    return textOfRun(all, p.pages[0]!, p.blocks, TARGETS_PAGE)
  }
  expect(TARGETS_MARKS.some(m => m.k === 't')).toBe(true)
  expect(textOf(TARGETS_MARKS)).toBe(textOf(TARGETS_MARKS.filter(m => m.k !== 't')))
  // A list item whose first content is a code block: the tag is not its body (the marker test).
  const item: Mark[] = [
    { k: 'w', p: 1, x: 0, y: 0, t: '-', w: 4, h: 12 },
    { k: 'b', p: 1, x: 10, y: 0, kind: 'item', prefix: '- ' },
    { k: 't', p: 1, x: 200, y: 0, kind: 'copy', w: 30, h: 12, code: 'a' },
    { k: 'c', p: 1, x: 10, y: 20, t: 'a', w: 6, n: 1, a: 8, d: 2 },
  ]
  expect(positionsOf(item, 72).pages[0]!.map(w => w.text)).toEqual(['a'])
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
  // Rows: heading 1, paragraph 3 and 5, items 7 and 9, the code's header 11, code 14 and 15.
  const lines = [{ row: 3, colStart: 30, colEnd: 97 }, ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(ALL_COLUMNS), { row: 14, colStart: 0, colEnd: 14 }]
  expect(textOfRun(lines, REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe(
    'the lazy dog, then keeps running across the wide green field until the well-known path ends.\n- first item\n- second item\necho hello ',
  )
  // Part of the second item: no prefix.
  expect(textOfRun([{ row: 9, colStart: 10, colEnd: 97 }], REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe('item')
})

test('a real probe: an item from its first word copies no marker; with the marker, the prefix', () => {
  // The "-" is in column 4, "second" starts in column 5.
  expect(textOfRun([{ row: 9, colStart: 5, colEnd: 97 }], REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe('second item')
  expect(textOfRun([{ row: 9, colStart: 4, colEnd: 97 }], REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe('- second item')
  // From the first item's first word on: the second item's marker is selected.
  expect(textOfRun([{ row: 7, colStart: 5, colEnd: 97 }, ALL_COLUMNS(8), ALL_COLUMNS(9)], REAL.pages[0]!, REAL.blocks, SMALL_PAGE)).toBe(
    'first item\n- second item',
  )
})

test('a numbered item from its first word copies no number', () => {
  const marks: Mark[] = [
    { k: 'w', p: 1, x: 20, y: 0, s: 11, t: '12.', w: 12, h: 12 },
    { k: 'b', p: 1, x: 40, y: 0, s: 11, kind: 'item', prefix: '12. ' },
    { k: 'w', p: 1, x: 40, y: 0, s: 11, t: 'twelve', w: 30, h: 12 },
  ]
  const got = positionsOf(marks, 72)
  const page = { width: 100, height: 20, columns: 10, rows: 1 }
  expect(textOfRun([{ row: 0, colStart: 4, colEnd: 9 }], got.pages[0]!, got.blocks, page)).toBe('twelve')
  expect(textOfRun([{ row: 0, colStart: 2, colEnd: 9 }], got.pages[0]!, got.blocks, page)).toBe('12. twelve')
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

const MATH = positionsOf(MATH_MARKS as unknown as Mark[], SMALL_PPI)

test('a real probe: inline math copies as its LaTeX source; display math copies nothing', () => {
  // Rows: the paragraph's lines 0 and 2, the display math 4-6.
  const all = Array.from({ length: MATH_PAGE.rows }, (_, row) => ALL_COLUMNS(row))
  expect(textOfRun(all, MATH.pages[0]!, MATH.blocks, MATH_PAGE)).toBe(MATH_MD.split('\n\n')[0])
  // The first equation is columns 9-19, its centre in column 14.
  expect(textOfRun([{ row: 0, colStart: 14, colEnd: 30 }], MATH.pages[0]!, MATH.blocks, MATH_PAGE)).toBe('$e^{i\\pi} + 1 = 0$ and the area')
  expect(textOfRun([{ row: 0, colStart: 15, colEnd: 30 }], MATH.pages[0]!, MATH.blocks, MATH_PAGE)).toBe('and the area')
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

// ---- The pipeline: the watcher's clip lines, the read, the probe of a page ----

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// The first 24 bytes of a 1568 x 512 PNG (the fixture's page), as `od` prints them.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 20 00 00 02 00'
const WRAP = 'echo $$; exec "$@"'
const inputsOf = (argv: readonly string[]) => Object.fromEntries(argv.flatMap((a, i) => (argv[i - 1] === '--input' ? [a.split(/=(.*)/s).slice(0, 2)] : [])))

// The world beneath the mod: a cache at /c, a typst whose compile writes a
// 1568 x 512 page per segment and whose query of page n gives the fixture's
// marks on page n (`hold` holds the next query until `release`; a kill ends
// it; `holdReads` the clipboard reads until `releaseReads`), the watcher (WATCH_PL: its PID, then with `clip` the change count at
// its start and at each change of the clipboard; `clip none` with
// `noBridge`), the read (READ_PL) giving `clipboard` (exit 3 for a
// password manager's copy: `concealed`), and the copies, toasts and
// selection the test sees. `copy` is a native copy (a drag over text and
// pictures, the main screen's terminal copy): while `selects`, picture cells
// are this session's selection too; the text goes on the clipboard, one
// change. `foreign` is a copy of another session or app (no selection);
// `change` is one more change with the same text. `copies` are the texts
// the mod put on the clipboard ($.ui.copy). `ran` and `spawned` are the
// processes run and spawned, `envSets` the env vars set.
// `tty`: the tty size line its read gives (none: no read), `version`
// Claude Code's (picture select); `frames` the highlight's frame files
// written, `blits` the blits asked (`deny`: each refused with it), `logs`
// the debug log lines. `noPerl`: perl can not start; `beforeWrite` runs
// before each frame write; `refused`: the cache folder sweep refuses that folder.
function world(
  on: any,
  o: {
    failFirst?: boolean; noBridge?: boolean; env?: Record<string, string>; tty?: string; version?: string; deny?: string; noPerl?: boolean; beforeWrite?: () => Promise<void>
    refused?: string; marks?: readonly object[]
  } = {},
) {
  forgetBlits()
  forgetRedraws()
  mock.store(on)
  const clock = mock.clock(on)
  const vars: Record<string, string | undefined> = { PATH: '/usr/bin:/bin', ...(o.env ?? { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }) }
  const envSets: [string, string | undefined][] = []
  on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
  on('env.set', async ($: any, e: any) => {
    envSets.push([e.name, e.value])
    return { value: {} }
  })
  const files = new Map<string, string>()
  const compiles: Record<string, string>[] = []
  const queries: Record<string, string>[] = []
  const kills: string[] = []
  const killers = new Map<string, () => void>()
  type Child = { argv: string[]; pid: string; say: (line: string) => void; dead: boolean }
  const watchers: Child[] = []
  const w = {
    clock, files, compiles, queries, kills, watchers, vars, envSets,
    ran: [] as string[][], spawned: [] as string[][], reads: [] as string[],
    clipboard: 'nothing yet', secret: false, count: 40, pastes: 0, copies: [] as string[], toasts: [] as string[], traces: [] as string[], logs: [] as string[],
    frames: [] as { path: string; old: string[]; png: Uint8Array }[], blits: [] as any[], writes: 0, selectionReads: 0,
    selection: undefined as { text: string; requestId?: string } | undefined,
    selects: true,
    gate: null as Promise<void> | null, release: () => {},
    hold() {
      w.gate = new Promise<void>(r => (w.release = r))
    },
    readGate: null as Promise<void> | null, releaseReads: () => {},
    holdReads() {
      w.readGate = new Promise<void>(r => (w.releaseReads = r))
    },
    copy(text: string) {
      if (w.selects && hasPlaceholders(text)) w.selection = { text }
      w.foreign(text)
    },
    foreign(text: string) {
      w.clipboard = text
      w.secret = false
      w.change()
    },
    // A password manager's copy (concealed): the clipboard read gives exit 3.
    concealed(text: string) {
      w.clipboard = text
      w.secret = true
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
    const me: Child = { argv, pid, dead: false, say: line => (lines.push(line), wake()) }
    list.push(me)
    killers.set(pid, () => ((me.dead = true), wake()))
    for (;;) {
      while (lines.length && !me.dead) yield { stream: 'stdout', text: `${lines.shift()}\n` }
      if (me.dead) return { value: { code: null, signal: 'SIGTERM' } }
      await new Promise<void>(r => (wake = r))
    }
  }
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    w.spawned.push(argv)
    if (argv[0] === '/usr/bin/perl' && argv[1] === '-e' && argv[2] === WATCH_PL) {
      return yield* child(watchers, argv, argv[3] === 'clip' ? [o.noBridge ? 'clip none' : `clip ${w.count}`] : [])
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
    yield { stream: 'stdout', text: JSON.stringify((o.marks ?? SMALL_MARKS).map(m => ({ ...m, p: Number(inputs.page) }))) }
    return { value: { code: 0, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    w.ran.push(argv)
    if (argv[0] === 'kill') {
      kills.push(argv[1]!)
      killers.get(argv[1]!)?.()
      return ok('')
    }
    if (/cc-intelligent-ui-/.test(cmd)) return ok(o.refused ? `\nDarwin\n\n${o.refused}\n` : '/c\nDarwin\n')
    if (o.tty && argv[0] === 'sh' && cmd.includes('ioctl(T')) return ok(o.tty)
    if (argv[0] === '/usr/bin/perl' && argv[2] === WRITE_PL) {
      w.writes++
      if (o.noPerl) return { deny: 'spawn /usr/bin/perl ENOENT' }
      await o.beforeWrite?.()
      w.frames.push({ path: argv[3]!, old: argv.slice(4), png: fromBase64(e.init?.stdin ?? '') })
      return ok('')
    }
    if (argv[0] === 'sh' && cmd.includes('debug.log')) {
      w.traces.push(e.init?.stdin ?? '')
      return ok('')
    }
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (cmd.includes('od -An')) return ok(argv.filter(a => a.endsWith('.png')).map(() => `${HEAD}\n@\n`).join(''))
    if (argv[0] === '/usr/bin/perl' && argv[2] === READ_PL) {
      w.pastes++
      if (w.readGate) await w.readGate
      // A password manager's copy: exit 3, its text not read.
      return w.secret ? ok('', 3) : ok(w.clipboard)
    }
    return ok('', 1)
  })
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => {
    w.reads.push(e.path)
    if (e.as === 'bytes' && /^\/c\/.*\.png$/.test(e.path)) return { value: { base64: PAGE_PNG } }
    return files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)
  })
  // One page per segment of the folder's doc.json.
  on('fs.list', async ($: any, e: any, next: any) => {
    if (!e.path.startsWith('/c/')) return next(e)
    const tag = o.failFirst && compiles.length > 1 ? 'b' : 'a'
    const segments = (JSON.parse(files.get(`${e.path}/doc.json`) ?? '{"segments":[""]}') as { segments: string[] }).segments
    return { value: segments.map((_, i) => ({ name: `${tag}-${i + 1}.png`, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) }
  })
  // The mod's write: its text on the clipboard, one change.
  on('ui.copy', async ($: any, e: any) => {
    w.copies.push(e.text)
    w.foreign(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.selection', async () => {
    w.selectionReads++
    return { value: w.selection }
  })
  on('ui.blit', async ($: any, e: any) => {
    w.blits.push(e)
    return { value: o.deny ? { deny: o.deny } : {} }
  })
  on('ui.log', async ($: any, e: any) => {
    w.logs.push(String(e.text))
    return { value: undefined }
  })
  on('session.version', async () => ({ value: { version: o.version ?? '2.1.306', base: o.version ?? '2.1.306' } }))
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

// Picture select off: its prefetch of a page's words and PNG is not in the probes counted.
const selectOff = ($: any) => $.command.run({ command: 'iui', args: 'select off' } as any)
const grab = async ($: any): Promise<string | undefined> => (await $.command.run({ command: 'iui', args: 'grab' } as any)).text
const detailLines = async ($: any) =>
  ((await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? '').split('\n').filter((l: string) => l.startsWith('Picture select:') || l.startsWith('/iui grab hint:'))

// The heading row and the start of the paragraph, as a mouse copy takes them.
const COPY = [cells(1, 0, 97, '⏺ '), cells(2, 0, 97), cells(3, 0, 21)].join('\n')
const COPIED = 'Copy test\nThe quick brown fox jumps'
const GRABBED = 'Intelligent UI: copied 35 chars (1 of 1 picture runs read).'
const GRAB_HINT = 'Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard'
const hints = (w: ReturnType<typeof world>) => w.toasts.filter(t => t === GRAB_HINT).length
const long = Array.from({ length: 240 }, (_, i) => `Paragraph ${i} with a few words in it.`).join('\n\n')
const pagesOf = (w: ReturnType<typeof world>) => (JSON.parse(w.files.get([...w.files.keys()].find(k => k.endsWith('/doc.json'))!)!) as { segments: string[] }).segments.length

test('a compile writes no probe file and runs no probe, nor does the hint; /iui grab probes only its page, with the PNG compile inputs', async ($, on) => {
  const w = world(on)
  await selectOff($)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.compiles.length).toBe(1)
  expect(names(w.files)).toEqual(['doc.json', 'pages.json'])
  expect(w.queries).toEqual([])
  // A native copy: the hint picks the page with no probe.
  w.copy(COPY)
  await w.clock.settle()
  expect(hints(w)).toBe(1)
  expect(w.queries).toEqual([])
  expect(await grab($)).toBe(GRABBED)
  expect(w.copies).toEqual([COPIED])
  // The PNG compile's inputs, probe=1 and page=1.
  expect(w.queries).toEqual([{ ...w.compiles[0], probe: '1', page: '1' }])
  // Nothing is written for it.
  expect(names(w.files)).toEqual(['doc.json', 'pages.json'])
})

test("an answer's link rows are under its pages: the page on screen is found above them", async ($, on) => {
  const w = world(on)
  await selectOff($)
  await $.command.run({ command: 'iui', args: '' } as any)
  const text = `${long}\n\nSee https://typst.app/docs.\n\n\`\`\`sh\nbrew install typst\n\`\`\``
  const ui = await drawAnswer($, w, 'ans-1', text)
  // 16 rows a page under the top margin, then 2 link rows: page 2 is rows 17 to 32.
  const of = 1 + 16 * pagesOf(w) + 2
  await ui.redraw({ ...props(text), onScreen: { first: 17, last: 32, of } })
  await w.clock.settle()
  w.copy([cells(2, 0, 97), cells(3, 0, 97)].join('\n'))
  await w.clock.settle()
  expect(await grab($)).toContain('Intelligent UI: copied')
  expect(w.queries.map(q => q.page)).toEqual(['2'])
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain(`-> answer ans-1 page 1 (rows 17-32 of ${of} on screen, page top 17)`)
})

test('a compile retried in safe mode gives the probe safe=1 (its page files say so)', async ($, on) => {
  const w = world(on, { failFirst: true })
  await selectOff($)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.compiles.map(c => c.safe)).toEqual([undefined, '1'])
  w.selection = { text: COPY }
  expect(await grab($)).toBe(GRABBED)
  expect(w.queries).toEqual([{ ...w.compiles[1], probe: '1', page: '1' }])
  expect(w.copies).toEqual([COPIED])
  expect(isSafePage('/c/k/b-1.png')).toBe(true)
  expect(isSafePage('/c/k/d-12.png')).toBe(true)
  expect(isSafePage('/c/k/a-1.png')).toBe(false)
  expect(isSafePage('/c/k/c-3.png')).toBe(false)
})

test('a grab over two pages of a long answer probes those two pages only', async ($, on) => {
  const w = world(on)
  await selectOff($)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', long)
  expect(pagesOf(w)).toBeGreaterThan(2)
  // The last row of page 1, then the first two rows of page 2.
  w.selection = { text: [cells(15, 0, 97, '⏺ '), cells(0, 0, 97), cells(1, 0, 97)].join('\n') }
  expect(await grab($)).toMatch(/^Intelligent UI: copied \d+ chars \([12] of 2 picture runs read\)\.$/)
  expect(w.queries.map(q => q.page)).toEqual(['1', '2'])
  expect(w.copies.length).toBe(1)
  expect(w.copies[0]).toContain('Copy test')
})

test('a grab goes to the page on screen: the rows on screen of the last draw (a memo hit) reach the pick and dump', async ($, on) => {
  const w = world(on)
  await selectOff($)
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w, 'ans-1', long)
  const pages = pagesOf(w)
  expect(pages).toBeGreaterThan(2)
  // 16 rows a page under the top margin: page 2 is rows 17 to 32.
  const of = 1 + 16 * pages
  const compiles = w.compiles.length
  await ui.redraw({ ...props(long), onScreen: { first: 17, last: 32, of } })
  await w.clock.settle()
  expect(w.compiles.length).toBe(compiles)
  w.selection = { text: [cells(2, 0, 97), cells(3, 0, 97)].join('\n') }
  expect(await grab($)).toContain('Intelligent UI: copied')
  expect(w.queries.map(q => q.page)).toEqual(['2'])
  expect(w.copies.length).toBe(1)
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain(`-> answer ans-1 page 1 (rows 17-32 of ${of} on screen, page top 17)`)
  // Scrolled up to page 1: the same rows are page 1's.
  await ui.redraw({ ...props(long), onScreen: { first: 0, last: 16, of } })
  await w.clock.settle()
  expect(await grab($)).toContain('Intelligent UI: copied')
  expect(w.queries.map(q => q.page)).toEqual(['2', '1'])
  expect(w.copies.length).toBe(2)
})

test('positions are kept in memory: grabs of the same page share one probe run, and a later grab runs none', async ($, on) => {
  const w = world(on)
  await selectOff($)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // A slow probe: nothing is copied until it is done.
  w.hold()
  w.selection = { text: COPY, requestId: 'ans-1' }
  const first = grab($)
  await w.clock.settle()
  expect(w.queries.length).toBe(1)
  // A second grab meanwhile waits for the same run.
  const second = grab($)
  await w.clock.settle()
  await w.clock.advance(1000)
  expect(w.queries.length).toBe(1)
  expect(w.copies).toEqual([])
  w.release()
  await w.clock.settle()
  // The newer grab copies; the older one copies nothing.
  expect(await first).toBe('Intelligent UI: a newer copy came first; this one copied nothing.')
  expect(await second).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read, row ans-1).')
  expect(w.copies).toEqual([COPIED])
  // Known now: no probe for the next grab.
  w.gate = null
  w.selection = { text: [cells(1, 0, 97), cells(2, 0, 97), cells(3, 0, 21)].join('\n') }
  expect(await grab($)).toBe(GRABBED)
  expect(w.queries.length).toBe(1)
  expect(w.copies).toEqual([COPIED, COPIED])
})

test('the watcher: its first count is only noted, each change is read once, the clipboard is never written; off stops its clipboard part', async ($, on) => {
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
  // A copy with no placeholders: one read, no hint.
  w.foreign('copied in another app')
  await w.clock.settle()
  expect(w.pastes).toBe(1)
  expect(hints(w)).toBe(0)
  // Picture cells: one read, one hint.
  w.copy(COPY)
  await w.clock.settle()
  expect(w.pastes).toBe(2)
  expect(hints(w)).toBe(1)
  // The same text again (the terminal's second write): read, no second hint.
  w.change()
  await w.clock.advance(3000)
  expect(w.pastes).toBe(3)
  expect(hints(w)).toBe(1)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe(COPY)
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain('U+10EEEE[1,0]')
  expect(dumped.text).toContain('-> answer ans-1 page 0')
  expect(dumped.text).toContain('code points; grab hint on):')
  expect(w.files.has('/c/copy-debug.json')).toBe(true)
  // Off: the watcher again with no clipboard part; no reads.
  await $.command.run({ command: 'iui', args: 'off' } as any)
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip'], []])
  await w.clock.settle()
  expect(w.kills).toEqual([w.watchers[0]!.pid, w.watchers[1]!.pid])
  w.copy(COPY.replace(cells(3, 0, 21), cells(3, 0, 20)))
  await w.clock.settle()
  expect(w.pastes).toBe(3)
  expect(hints(w)).toBe(1)
})

test('/iui details says whether picture select is on, and whether the /iui grab hint is', async ($, on) => {
  const w = world(on)
  expect((await detailLines($))[1]).toBe('/iui grab hint: off (no picture yet)')
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(await detailLines($)).toEqual(['Picture select: on', '/iui grab hint: on'])
  await selectOff($)
  expect(await detailLines($)).toEqual(['Picture select: off (/iui select off)', '/iui grab hint: on'])
  await $.command.run({ command: 'iui', args: 'off' } as any)
  expect((await detailLines($))[1]).toBe('/iui grab hint: off (Intelligent UI is off)')
})

test('/iui details: picture select off before Claude Code 2.1.298', async ($, on) => {
  const w = world(on, { version: '2.1.297' })
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(await detailLines($)).toEqual(['Picture select: off (Claude Code 2.1.297; it needs 2.1.298 or newer)', '/iui grab hint: on'])
})

test('with no PerlObjCBridge (clip none): no read, no hint; details says so; no new watcher for it; /iui grab still copies', async ($, on) => {
  const w = world(on, { noBridge: true })
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.copy(COPY)
  await w.clock.advance(900)
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(hints(w)).toBe(0)
  expect(w.copies).toEqual([])
  expect((await detailLines($))[1]).toBe('/iui grab hint: off (no PerlObjCBridge in /usr/bin/perl)')
  // No new watcher for it: once is enough.
  await drawAnswer($, w, 'ans-2')
  expect(w.watchers.length).toBe(2)
  w.selection = { text: COPY, requestId: 'ans-1' }
  expect(await grab($)).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read, row ans-1).')
  expect(w.copies).toEqual([COPIED])
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
  expect(w.copies).toEqual([COPIED, 'plain text'])
})

test('a $.ui.copy of picture cells: its clipboard change is read once and gets no hint', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.selection = { text: COPY, requestId: 'ans-1' }
  await $.command.run({ command: 'cp', args: COPY } as any)
  await w.clock.advance(900)
  await w.clock.settle()
  expect(w.pastes).toBe(1)
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPIED)
  expect(hints(w)).toBe(0)
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied')).length).toBe(0)
})

test('native copies in fullscreen: one hint for cells that fit a page drawn here, never a write; none for the same text again, our own write, plain text or cells that fit no page', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.copy(COPY)
  await w.clock.settle()
  expect(hints(w)).toBe(1)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe(COPY)
  // Another session's copy of the same cells, with this session's old selection of them: the same text, no write, no second hint.
  expect(w.selection?.text).toBe(COPY)
  w.foreign(COPY)
  await w.clock.settle()
  expect(hints(w)).toBe(1)
  expect(w.copies).toEqual([])
  // /iui grab's own write: not hinted.
  expect(await grab($)).toBe(GRABBED)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(hints(w)).toBe(1)
  // Plain text, then cells that fit no page drawn here (column 150): no hint.
  w.foreign('copied in another app')
  await w.clock.settle()
  w.copy([cells(1, 0, 150), cells(2, 0, 150)].join('\n'))
  await w.clock.settle()
  expect(hints(w)).toBe(1)
  // Other cells that fit: one hint again.
  w.copy(cells(5, 0, 40))
  await w.clock.settle()
  expect(hints(w)).toBe(2)
  expect(w.copies).toEqual([COPIED])
})

test('the selection gives a $.ui.copy its row (its requestId) only when it is that copy', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  // Two answers that both fit the cells: with no row, the newer one.
  await drawAnswer($, w)
  await drawAnswer($, w, 'ans-2', `${SMALL_MD}\n\nEnd.`)
  const picked = async () => ((await $.command.run({ command: 'iui', args: 'dump' } as any)).text ?? '').match(/-> answer (\S+) page/)?.[1]
  // A selection of other cells (and a row) does not name this copy's row.
  w.selection = { text: cells(9, 0, 9), requestId: 'ans-1' }
  await $.command.run({ command: 'cp', args: COPY } as any)
  expect(w.copies).toEqual([COPIED])
  expect(await picked()).toBe('ans-2')
  // The selection of this copy: its row.
  w.selection = { text: COPY, requestId: 'ans-1' }
  await $.command.run({ command: 'cp', args: COPY } as any)
  expect(w.copies).toEqual([COPIED, COPIED])
  expect(await picked()).toBe('ans-1')
})

test('cells that fit no page: no hint; /iui grab says it could not read them; $.ui.copy passes them as they are', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  // Column 150: wider than any picture drawn.
  const text = [cells(1, 0, 150), cells(2, 0, 150)].join('\n')
  w.copy(text)
  await w.clock.settle()
  expect(hints(w)).toBe(0)
  expect(await grab($)).toBe('Intelligent UI: found 1 picture run(s) but could not read them (see /iui dump).')
  expect(w.copies).toEqual([])
  await $.command.run({ command: 'cp', args: text } as any)
  await w.clock.settle()
  expect(w.copies).toEqual([text])
  expect(hints(w)).toBe(0)
})

test('a watcher that starts again gives no hint for the clipboard that was there before (its first count is only noted)', async ($, on) => {
  const w = world(on)
  // Picture cells on the clipboard before this load (a hot reload).
  w.clipboard = COPY
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  await w.clock.advance(3000)
  expect(w.pastes).toBe(0)
  expect(hints(w)).toBe(0)
  // A new copy gets the hint.
  w.copy(COPY)
  await w.clock.settle()
  expect(hints(w)).toBe(1)
  expect(w.copies).toEqual([])
})

test('at an exit the watcher is killed and no child takes its place; a /clear stops only its clipboard part', async ($, on) => {
  const w = world(on)
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip']])
  await $.session.end({ reason: 'clear', sessionId: 's1' } as any)
  await w.clock.settle()
  // The process goes on: the watcher again with no clipboard part.
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip'], []])
  expect(w.kills).toEqual([w.watchers[0]!.pid, w.watchers[1]!.pid])
  w.copy(COPY)
  await w.clock.settle()
  expect(w.pastes).toBe(0)
  expect(hints(w)).toBe(0)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2' } as any)
  await w.clock.settle()
  await w.clock.advance(5000)
  expect(w.watchers.length).toBe(3)
  expect(w.kills).toEqual(w.watchers.map(c => c.pid))
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
  await w.clock.settle()
  expect(w.toasts.filter(t => t === GRAB_HINT)).toEqual([GRAB_HINT])
})

test('nothing of the shim is left: no env var set, no shim script run or read, no perl child but the watcher, none of its exports', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  w.copy(COPY)
  await w.clock.settle()
  expect(await grab($)).toBe(GRABBED)
  // No PATH or IUI_COPY_ASK change.
  expect(w.envSets).toEqual([])
  expect(w.vars.PATH).toBe('/usr/bin:/bin')
  expect([...w.ran, ...w.spawned].some(argv => argv.some(a => /clip-shim|IUI_COPY|ask-\d|shims-/.test(a)))).toBe(false)
  expect(w.reads.some(p => p.includes('clip-shim'))).toBe(false)
  expect([...w.files.keys()].filter(k => /\/(shims-|ask)/.test(k))).toEqual([])
  // The perl children: the watcher only (a size one, then one with `clip`).
  const perls = w.spawned.filter(argv => /perl$/.test(argv[0]!))
  expect(perls.length).toBe(2)
  expect(perls.every(argv => argv[1] === '-e' && argv[2] === WATCH_PL)).toBe(true)
  const gone = ['SHIM_SETUP', 'shimText', 'shimFindOf', 'pathWith', 'setUpShims', 'autoCopyText', 'ASK_PL', 'ANSWER_SH', 'ASK_CLEAN_SH', 'ASK_END_SH', 'ASK_MAX', 'listenAsks']
  expect(Object.keys(registerModule).filter(k => gone.includes(k))).toEqual([])
  expect(Object.keys(clipboardModule).filter(k => gone.includes(k))).toEqual([])
  expect(Object.keys(settingsModule).filter(k => ['HINT_WAIT_MS', 'ASKED_MS', 'USE_COPY_SHIM'].includes(k))).toEqual([])
})

// ---- The main screen: the terminal copies, so only the hint ----------------

const FULLSCREEN_TOAST = 'Intelligent UI works best in fullscreen mode: run /tui fullscreen'

test('main screen: picture cells on the clipboard are never rewritten (their session is not known); one toast names /iui grab', async ($, on) => {
  const w = world(on)
  w.selects = false
  await selectOff($)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  // The terminal's own copy (or another session's): no write, no probe, one toast at once.
  w.foreign(COPY)
  await w.clock.settle()
  await w.clock.advance(1000)
  expect(w.pastes).toBe(1)
  expect(w.copies).toEqual([])
  expect(w.queries).toEqual([])
  expect(w.toasts.filter(t => t.includes('/iui grab'))).toEqual([GRAB_HINT])
  // dump shows them (its read probes the page).
  const dumped = await $.command.run({ command: 'iui', args: 'dump' } as any)
  expect(dumped.text).toContain('code points; grab hint on):')
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
  expect(await detailLines($)).toEqual(['Picture select: off (/iui select off)', '/iui grab hint: on'])
})

test('main screen: picture select says to use fullscreen or /iui grab', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  expect(await detailLines($)).toEqual(['Picture select: off on the main screen (use /tui fullscreen, or /iui grab)', '/iui grab hint: on'])
})

test('main screen: /iui grab with no selection reads the clipboard and writes its text; a second grab says it is there', async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  w.foreign(COPY)
  await w.clock.settle()
  expect(await grab($)).toBe(GRABBED)
  expect(w.copies).toEqual([COPIED])
  // Our own write is not read back as new: no toast, no copy.
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(w.toasts.filter(t => t.includes('/iui grab')).length).toBe(1)
  expect(await grab($)).toBe('Intelligent UI: the clipboard has the text already.')
  expect(w.copies).toEqual([COPIED])
  w.foreign('plain text')
  await w.clock.settle()
  expect(await grab($)).toBe('Intelligent UI: no mouse selection and no picture cells on the clipboard; select over a picture and copy first.')
  expect(w.copies).toEqual([COPIED])
})

test('main screen: /copy or $.ui.copy of picture cells gets their text (the ui.copy hook), with no hint', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  await $.command.run({ command: 'cp', args: COPY } as any)
  await w.clock.advance(1000)
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPIED)
  expect(hints(w)).toBe(0)
})

test('fullscreen or main screen not known yet: a native copy gets the hint, a $.ui.copy its text; no advice', { plugins: [COPIER] }, async ($, on) => {
  const w = world(on)
  w.selects = false
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, null)
  w.foreign(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([])
  expect(hints(w)).toBe(1)
  await $.command.run({ command: 'cp', args: COPY } as any)
  await w.clock.settle()
  expect(w.copies).toEqual([COPIED])
  expect(hints(w)).toBe(1)
  expect(await detailLines($)).toEqual(['Picture select: on in fullscreen (the screen is not known yet)', '/iui grab hint: on'])
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

test('the fullscreen advice is not shown where no picture draws (tmux); picture select is off there', async ($, on) => {
  const w = world(on, { env: { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', TMUX: '/tmp/tmux-501/default,1,0' } })
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  expect(w.compiles).toEqual([])
  expect(w.toasts).not.toContain(FULLSCREEN_TOAST)
  expect((await detailLines($))[0]).toBe('Picture select: off (no pictures drawn from files here)')
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
// The fixture's page, 1568 x 512 px (98 x 16 cells of 16 x 32): ink (opaque)
// on every third pixel, the rest transparent.
const pagePixel = (x: number, y: number) => ((x + y) % 3 ? [0, 0, 0, 0] : [200, 210, 220, 255])
const PAGE_PNG = (() => {
  const line = 1568 * 4 + 1
  const raw = new Uint8Array(512 * line)
  for (let y = 0; y < 512; y++) for (let x = 0; x < 1568; x++) raw.set(pagePixel(x, y), y * line + 1 + x * 4)
  const piece = deflatePiece(raw, 4, line)
  return toBase64(concat([headOf(1568, 512), chunk('IDAT', piece.bytes), tailOf([piece])]))
})()
// Whether a frame's cell (row, column) is the selection's: a transparent
// pixel of it is the colour (an opaque one is the same either way).
const cellOf = (png: Uint8Array, row: number, col: number) => {
  const img = decodePng(png)
  const y = row * 32 + 2
  const x = col * 16 + ((col * 16 + y) % 3 ? 0 : 1)
  const p = [...img.data.subarray((y * 1568 + x) * 4, (y * 1568 + x) * 4 + 4)]
  const was = pagePixel(x, y)
  const c = rgbOf('#264f78')
  if (p.join() === was.join()) return 'page'
  return p.join() === [over(was[0]!, was[3]!, c[0]), over(was[1]!, was[3]!, c[1]), over(was[2]!, was[3]!, c[2]), 255].join() ? 'selected' : 'other'
}
// The page Box of the drawing: the Image, then the Client pulled up over it.
const pageBox = (drawn: any) => tree(drawn).find(n => n.type === 'Box' && n.props.flexDirection === 'column' && n.props.width === 98 && n.props.height === 16)
const settle = async (w: ReturnType<typeof world>) => {
  for (let i = 0; i < 4; i++) {
    await w.clock.settle()
    await w.clock.advance(20)
  }
  await w.clock.settle()
}

test('picture select: a drag swaps the page\'s picture for a frame of its selected cells, copies their text on the up; a click puts the page back', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  const before = await ui.drawn()
  const client = tree(before).find(n => n.type === 'Client')
  expect(client?.props).toMatchObject({ key: 'sel0', width: 98, height: 16, props: { id: 'ans-1', page: 0 } })
  // The Image and the Client over it, in the flow: no absolute Box (the
  // engine moves one scrolled above the screen to row 0), no overlay.
  const page = pageBox(before)
  expect(page.children.map((c: any) => c.type)).toEqual(['Image', 'Box'])
  expect(page.children.map((c: any) => c.props.marginTop)).toEqual([undefined, -16])
  expect(page.children[0].props.key).toBe('p0')
  expect(tree(page).some(n => n.props?.position === 'absolute' || n.props?.backgroundColor)).toBe(false)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await settle(w)
  // A down selects nothing yet: no frame.
  expect(w.frames).toEqual([])
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 21, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.copies).toEqual([COPIED])
  expect(w.toasts).toContain(`Intelligent UI: copied ${COPIED.length} chars of text`)
  // The last blit: the Image p0 under the message's requestId, its newest frame file.
  const last = w.blits.at(-1)
  expect(last).toMatchObject({ requestId: 'ans-1', key: 'p0', source: { format: 'png' } })
  const frame = w.frames.at(-1)!
  expect(last.source.file).toBe(frame.path)
  expect(frame.path).toMatch(/^\/c\/select-[0-9a-z]+\/f-\d+\.png$/)
  // Rows 1 and 2 whole, row 3 to column 21; the rest of the page as it is.
  expect([cellOf(frame.png, 1, 0), cellOf(frame.png, 1, 97), cellOf(frame.png, 2, 50), cellOf(frame.png, 3, 21)]).toEqual(['selected', 'selected', 'selected', 'selected'])
  expect([cellOf(frame.png, 0, 5), cellOf(frame.png, 3, 22), cellOf(frame.png, 4, 0), cellOf(frame.png, 15, 97)]).toEqual(['page', 'page', 'page', 'page'])
  // The layout never changes with the selection.
  expect(JSON.stringify(pageBox(await ui.drawn()))).toBe(JSON.stringify(page))
  // A click with no drag clears it: the page's own PNG back, nothing copied.
  const frames = w.frames.length
  await ui.pointer({ type: 'down', x: 5, y: 5, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 5, y: 5, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.blits.at(-1)).toMatchObject({ requestId: 'ans-1', key: 'p0', source: { file: drawnAnswers.get('ans-1')?.pages[0]?.file ?? w.blits.at(-1).source.file, format: 'png' } })
  expect(w.blits.at(-1).source.file).toMatch(/^\/c\/[0-9a-f]+\/a-1\.png$/)
  expect(w.frames.length).toBe(frames)
  expect(w.copies).toEqual([COPIED])
  // The page is read (decoded) once.
  expect(w.reads.filter(r => r.endsWith('/a-1.png')).length).toBe(1)
})

test('picture select: a page drawn is built and its words probed in the background, before any down; the copy at the up runs no probe', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  expect(w.reads.filter(r => r.endsWith('/a-1.png')).length).toBe(1)
  expect(w.queries.map(q => q.page)).toEqual(['1'])
  // No frame or blit until a selection.
  expect(w.frames).toEqual([])
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 21, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.copies).toEqual([COPIED])
  expect(w.queries.length).toBe(1)
  expect(w.reads.filter(r => r.endsWith('/a-1.png')).length).toBe(1)
})

test('picture select: with the background probe still running, the copy at the up waits for it and gets the same text', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  w.hold()
  const ui = await drawAnswer($, w)
  expect(w.queries.length).toBe(1)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 21, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.copies).toEqual([])
  w.release()
  await settle(w)
  expect(w.copies).toEqual([COPIED])
  // One probe run for the background and the copy.
  expect(w.queries.length).toBe(1)
})

test('picture select: only the pages on screen are built and probed; a page that comes on screen is, once', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const off = { ...props(long), onScreen: null }
  const ui = await $.ui.mount({ ...message('ans-1', long), props: off })
  await w.clock.settle()
  await ui.redraw(off)
  await settle(w)
  await w.clock.advance(300)
  await settle(w)
  const pages = pagesOf(w)
  expect(pages).toBeGreaterThan(2)
  const pngReads = () => w.reads.filter(r => /\/a-\d+\.png$/.test(r)).map(r => r.replace(/^.*\//, ''))
  expect(pngReads()).toEqual([])
  expect(w.queries).toEqual([])
  // 16 rows a page under the top margin: page 2 is rows 17 to 32.
  const of = 1 + 16 * pages
  await ui.redraw({ ...props(long), onScreen: { first: 17, last: 32, of } })
  await settle(w)
  expect(pngReads()).toEqual(['a-2.png'])
  expect(w.queries.map(q => q.page)).toEqual(['2'])
  // Scrolled up to page 1, then back: page 1 once, page 2 not again.
  await ui.redraw({ ...props(long), onScreen: { first: 0, last: 16, of } })
  await settle(w)
  await ui.redraw({ ...props(long), onScreen: { first: 17, last: 32, of } })
  await settle(w)
  expect(pngReads()).toEqual(['a-2.png', 'a-1.png'])
  expect(w.queries.map(q => q.page)).toEqual(['2', '1'])
})

test('picture select: a fast drag folds into few frames, the last one the newest selection', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'sel0' })
  await settle(w)
  for (let i = 1; i <= 15; i++) await ui.pointer({ type: 'move', x: 5 * i, y: i, button: 'left', in: 'sel0' })
  await settle(w)
  // Fifteen moves, far fewer frames; the last shows rows 0 to 15 (to column 75).
  expect(w.frames.length).toBeGreaterThan(0)
  expect(w.frames.length).toBeLessThan(15)
  const png = w.frames.at(-1)!.png
  expect([cellOf(png, 14, 97), cellOf(png, 15, 75), cellOf(png, 15, 76)]).toEqual(['selected', 'selected', 'page'])
  expect(w.blits.at(-1).source.file).toBe(w.frames.at(-1)!.path)
  // Old frame files go once four newer ones are there and 2 s have passed.
  for (let i = 0; i < 6; i++) {
    await ui.pointer({ type: 'move', x: 3 + i, y: 2, button: 'left', in: 'sel0' })
    await settle(w)
  }
  expect(w.frames.flatMap(f => f.old)).toEqual([])
  await w.clock.advance(3000)
  await ui.pointer({ type: 'move', x: 30, y: 2, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.frames.at(-1)!.old.length).toBeGreaterThan(0)
})

test('picture select: a blit the engine refuses is logged once and shows no highlight; the copy still works', async ($, on) => {
  const w = world(on, { tty: TTY, deny: 'no Image of its own is mounted under key "p0"' })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await settle(w)
  await ui.pointer({ type: 'move', x: 15, y: 2, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 21, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  // One refused blit: the page is not tried again until the next down.
  expect(w.blits.length).toBe(1)
  expect(w.logs.filter(l => l.includes('refused')).length).toBe(1)
  expect(w.copies).toEqual([COPIED])
})

test('picture select: with IUI_DEBUG, each post writes a trace line (the post, its region, the rows selected), each blit its times', async ($, on) => {
  const w = world(on, { tty: TTY, env: { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', IUI_DEBUG: '1' } })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await settle(w)
  const lines = w.traces.filter(t => /select: (down|move|up|clear) /.test(t))
  expect(lines.length).toBe(2)
  expect(lines[0]).toContain('select: down #')
  // The kit gives a Client the terminal's size, the engine its region's.
  expect(lines[0]).toMatch(/ans-1 page 0 anchor 0,1 head 0,1 size \d+x\d+ drawn 98x16 onScreen /)
  expect(lines[0]).toContain('rows none')
  expect(lines[1]).toContain('anchor 0,1 head 10,2 size ')
  expect(lines[1]).toContain('rows p0 1..2 (2)')
  const blit = w.traces.find(t => t.includes('select: blit '))
  expect(blit).toMatch(/select: blit ans-1 page 0 rows 1\.\.2 \(2\) wait \d+ms frame \d+ms write \d+ms \d+ bytes blit \d+ms/)
  // The page's cache, built when it was drawn: its build and its words.
  expect(w.traces.some(t => /select: cache start [0-9a-f]+\/a-1\.png \(read \d+ms, 0 queued\)/.test(t))).toBe(true)
  const built = w.traces.find(t => t.includes('select: cache built '))
  expect(built).toMatch(/select: cache built [0-9a-f]+\/a-1\.png 1568x512 ready in \d+ms, done in \d+ms \(read \d+ms, \d+ slices, max [\d.]+ms, p95 [\d.]+ms\); 1 pages kept, \d+ MB, 0 queued/)
  expect(w.traces.some(t => /select: words ans-1 page 0 \d+ words in \d+ms \(background\)/.test(t))).toBe(true)
  // The up: its copy, with the words there already.
  await ui.pointer({ type: 'up', x: 21, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.traces.find(t => t.includes('select: copy '))).toMatch(/select: copy 35 chars \d+ms after the up \(text \d+ms, words cached\); no native selection/)
})

test('picture select: with no IUI_DEBUG, a post writes no trace line', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await w.clock.settle()
  expect(w.traces.filter(t => t.includes('select: '))).toEqual([])
})

test('picture select: none before Claude Code 2.1.298', async ($, on) => {
  const old = world(on, { tty: TTY, version: '2.1.297' })
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

// A drag over rows 1 to 3 (to column 21): COPIED.
const drag = async (ui: any) => {
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 21, y: 3, button: 'left', in: 'sel0' })
}
// The last blit: the page's own PNG, or its newest frame.
const isPlain = (w: ReturnType<typeof world>) => /^\/c\/[0-9a-f]+\/a-1\.png$/.test(w.blits.at(-1)?.source.file ?? '')
const isFrame = (w: ReturnType<typeof world>) => !!w.frames.length && w.blits.at(-1)?.source.file === w.frames.at(-1)!.path
const hasClient = async (ui: any) => tree(await ui.drawn()).some(n => n.type === 'Client')

test('picture select: typing in the prompt takes the selection down; a bare cursor move and another plugin\'s fill do not', async ($, on) => {
  const w = world(on, { tty: TTY })
  on('prompt.edit', async ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.change', async ($: any, e: any) => ({ text: e.text }))
  await $.command.run({ command: 'iui', args: '' } as any)
  const prompt = ($ as any).prompt
  const ui = await drawAnswer($, w)
  await drag(ui)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  const blits = w.blits.length
  await prompt.edit({ origin: { kind: 'composer' }, text: 'ab', cursor: 2, start: 1, end: 1, inputText: '' } as any)
  await prompt.change({ text: 'x', cursor: 1, origin: { kind: 'plugin', name: 'other' } })
  await settle(w)
  expect(w.blits.length).toBe(blits)
  // A key typed: the page's own PNG back; the edit is the engine's as it was.
  const edited = await prompt.edit({ origin: { kind: 'composer' }, text: 'ab', cursor: 2, start: 2, end: 2, inputText: 'c' })
  expect(edited).toMatchObject({ text: 'abc', cursor: 3 })
  await settle(w)
  expect(isPlain(w)).toBe(true)
  // A recalled history entry: the same.
  await drag(ui)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  await prompt.change({ text: 'old', cursor: 3, origin: { kind: 'history' } })
  await settle(w)
  expect(isPlain(w)).toBe(true)
})

test('picture select: a new native selection takes it down (read every 250 ms while it shows); one made before it does not; no reads with none shown', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  w.selection = { text: 'made before' }
  await drag(ui)
  await settle(w)
  await w.clock.advance(600)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  expect(w.selectionReads).toBeGreaterThan(1)
  w.selection = { text: 'a new one', requestId: 'ans-0' }
  await w.clock.advance(300)
  await settle(w)
  expect(isPlain(w)).toBe(true)
  // None shows now: the timer is gone.
  const reads = w.selectionReads
  await w.clock.advance(2000)
  await settle(w)
  expect(w.selectionReads).toBe(reads)
})

test('picture select: a move with no button while the button is down (its up lost) ends the drag where it was: copied, not extended', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 10, y: 2, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 21, y: 3, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'move', x: 40, y: 8, in: 'sel0' })
  await settle(w)
  expect(w.copies).toEqual([COPIED])
  const frames = w.frames.length
  await ui.pointer({ type: 'move', x: 50, y: 9, in: 'sel0' })
  await settle(w)
  expect(w.frames.length).toBe(frames)
  expect(cellOf(w.frames.at(-1)!.png, 3, 22)).toBe('page')
})

test('picture select: a down is taken whatever its order (a reloaded Client counts from 0 again)', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await drag(ui)
  await settle(w)
  const post = (phase: string, seq: number, head: { x: number; y: number }) => ui.post({ id: 'ans-1', page: 0, anchor: { x: 0, y: 1 }, head, phase, seq }, { in: 'sel0' })
  await post('down', 1, { x: 0, y: 1 })
  await post('move', 2, { x: 10, y: 2 })
  await settle(w)
  const png = w.frames.at(-1)!.png
  expect([cellOf(png, 2, 10), cellOf(png, 2, 11), cellOf(png, 3, 0)]).toEqual(['selected', 'page', 'page'])
})

test('picture select: a slow copy never lands after a newer one: only the last up copies', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  w.hold()
  const ui = await drawAnswer($, w)
  await drag(ui)
  await settle(w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 8, y: 1, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.copies).toEqual([])
  w.release()
  await settle(w)
  expect(w.copies.length).toBe(1)
  expect(w.copies[0]).not.toBe(COPIED)
  expect(COPIED.startsWith(w.copies[0]!)).toBe(true)
})

test('picture select: the same row drawn on the main screen, then in fullscreen, gets its Client (no memo hit)', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const main = await drawAnswer($, w, 'ans-1', SMALL_MD, false)
  expect(await hasClient(main)).toBe(false)
  await main.unmount()
  const full = await drawAnswer($, w, 'ans-1', SMALL_MD, true)
  expect(await hasClient(full)).toBe(true)
})

test('picture select: /iui select off and /iui off let the page cache go', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const pngReads = () => w.reads.filter(r => r.endsWith('/a-1.png')).length
  const ui = await drawAnswer($, w)
  expect(pngReads()).toBe(1)
  // Off, then on: the page is built again (read again) at the next draw.
  await $.command.run({ command: 'iui', args: 'select off' } as any)
  await $.command.run({ command: 'iui', args: 'select on' } as any)
  await w.clock.settle()
  await ui.redraw(props(SMALL_MD))
  await settle(w)
  expect(pngReads()).toBe(2)
  await $.command.run({ command: 'iui', args: 'off' } as any)
  await $.command.run({ command: 'iui', args: 'on' } as any)
  await w.clock.settle()
  await ui.redraw(props(SMALL_MD))
  await settle(w)
  expect(pngReads()).toBe(3)
  // The drag still works on the page built again.
  await drag(ui)
  await settle(w)
  expect(w.copies).toEqual([COPIED])
  expect(isFrame(w)).toBe(true)
})

test('picture select: a frame of a page file the row no longer draws is not blitted; the new file gets its own frame', async ($, on) => {
  let release = () => {}
  let isHeld = false
  const w = world(on, {
    tty: TTY,
    // The first frame write is held; the test draws the row again meanwhile (one clock mover at a time).
    beforeWrite: () => (isHeld ? Promise.resolve() : ((isHeld = true), new Promise<void>(r => (release = r)))),
  })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  const other = `${SMALL_MD}\n\nOne more line.`
  await drag(ui)
  await settle(w)
  expect(w.writes).toBe(1)
  expect(w.frames).toEqual([])
  // The row is drawn again with a new page file while the first frame is written.
  await ui.redraw(props(other))
  await w.clock.settle()
  await w.clock.advance(1000)
  await w.clock.settle()
  await ui.redraw(props(other))
  await w.clock.settle()
  release()
  await settle(w)
  expect(w.compiles.length).toBe(2)
  const stale = w.frames[0]!.path
  expect(w.blits.some(b => b.source.file === stale)).toBe(false)
  expect(new Set(w.reads.filter(r => r.endsWith('/a-1.png'))).size).toBe(2)
  expect(isFrame(w)).toBe(true)
})

test('picture select: with no perl the first frame write fails, is logged once and none is tried again; the copy still works', async ($, on) => {
  const w = world(on, { tty: TTY, noPerl: true })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w)
  await drag(ui)
  await settle(w)
  await drag(ui)
  await settle(w)
  expect(w.writes).toBe(1)
  expect(w.logs.filter(l => l.includes('could not be written')).length).toBe(1)
  expect(w.copies).toEqual([COPIED, COPIED])
})

// ---- Picture select: links, files and commands --------------------------------

// TARGETS_MD drawn as `ans-1` (its probe the fixture's TARGETS_MARKS), with
// src/a.ts a file in the session's folder /w. Its targets (targets.test.ts):
// the link "the docs" row 3 columns 4 to 11, the bare URL row 3 16 to 45,
// `! ls -la` row 4 50 to 58, src/a.ts row 6 5 to 13, the bash block's copy
// button row 8 8 to 15 (its code rows 11 and 12: no target).
async function drawTargets($: any, on: any, o: { env?: Record<string, string>; marks?: readonly object[]; noBridge?: boolean } = {}, isFullscreen: boolean | null = true) {
  const w = world(on, { tty: TTY, marks: TARGETS_MARKS, ...o })
  on('session.cwd', async () => ({ value: '/w' }))
  on('fs.exists', async ($: any, e: any) => ({ value: e.path === '/w/src/a.ts' }))
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await drawAnswer($, w, 'ans-1', TARGETS_MD, isFullscreen)
  await settle(w)
  return { w, ui }
}
const hover = (ui: any, x: number, y: number) => ui.pointer({ type: 'move', x, y, in: 'sel0' })
const click = async (ui: any, x: number, y: number, o: { button?: 'left' | 'right'; ctrl?: true } = {}) => {
  const ev = { x, y, button: o.button ?? 'left', ...(o.ctrl ? { ctrl: o.ctrl } : {}), in: 'sel0' }
  await ui.pointer({ type: 'down', ...ev })
  await ui.pointer({ type: 'up', ...ev })
}

test('picture select: the link rows are not drawn under pages that take it, and the copy counts none of them', async ($, on) => {
  const { w, ui } = await drawTargets($, on, { env: { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', IUI_DEBUG: '1' } })
  expect(tree(await ui.drawn()).some(n => n.type === 'Link' || n.type === 'Button')).toBe(false)
  // The message: the top margin and the page's 16 rows, nothing under them: the page's top is row 1.
  await ui.redraw({ ...props(TARGETS_MD), onScreen: { first: 0, last: 16, of: 17 } })
  await settle(w)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.traces.find(t => t.includes('select: down #'))).toContain(' top 1 above 0 ')
})

test('picture select: on the main screen the link rows are drawn as before', async ($, on) => {
  const { ui } = await drawTargets($, on, {}, false)
  const drawn = await ui.drawn()
  expect(tree(drawn).filter(n => n.type === 'Link').map(n => n.props.href)).toEqual(['https://example.com', 'https://typst.app/docs/reference', 'file:///w/src/a.ts'])
  expect(tree(drawn).filter(n => n.type === 'Button').length).toBe(2)
})

test('picture select: a hover over a link tints its cells; off it, or a leave, puts the page back', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  expect(w.blits).toEqual([])
  // Over a word that is no target: nothing.
  await hover(ui, 1, 3)
  await settle(w)
  expect(w.blits).toEqual([])
  await hover(ui, 6, 3)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  const png = w.frames.at(-1)!.png
  expect([cellOf(png, 3, 4), cellOf(png, 3, 11)]).toEqual(['selected', 'selected'])
  expect([cellOf(png, 3, 3), cellOf(png, 3, 12), cellOf(png, 2, 6), cellOf(png, 4, 6)]).toEqual(['page', 'page', 'page', 'page'])
  // Within the same target: no new frame.
  const frames = w.frames.length
  await hover(ui, 9, 3)
  await settle(w)
  expect(w.frames.length).toBe(frames)
  await hover(ui, 13, 3)
  await settle(w)
  expect(isPlain(w)).toBe(true)
  await hover(ui, 20, 3)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  await ui.pointer({ type: 'leave', x: 20, y: 3, in: 'sel0' })
  await settle(w)
  expect(isPlain(w)).toBe(true)
})

test('picture select: a down takes the hover tint down, and no hover tints while a selection shows', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  await hover(ui, 6, 3)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  // A drag that starts on the link selects text.
  await ui.pointer({ type: 'down', x: 6, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  expect(isPlain(w)).toBe(true)
  await ui.pointer({ type: 'move', x: 20, y: 3, button: 'left', in: 'sel0' })
  await ui.pointer({ type: 'up', x: 30, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  expect(w.copies.length).toBe(1)
  const blits = w.blits.length
  await hover(ui, 52, 4)
  await settle(w)
  expect(w.blits.length).toBe(blits)
})

test('picture select: a click copies a link, a file\'s path or a command; a click off them clears as before', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  await click(ui, 6, 3)
  await settle(w)
  await click(ui, 30, 3)
  await settle(w)
  await click(ui, 8, 6)
  await settle(w)
  await click(ui, 52, 4)
  await settle(w)
  expect(w.copies).toEqual(['https://example.com', 'https://typst.app/docs/reference', '/w/src/a.ts', 'ls -la'])
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied the '))).toEqual([
    'Intelligent UI: copied the link', 'Intelligent UI: copied the link', 'Intelligent UI: copied the path', 'Intelligent UI: copied the command',
  ])
  // No target (a code block is none): nothing copied.
  await click(ui, 1, 3)
  await click(ui, 60, 8)
  await click(ui, 5, 10)
  await settle(w)
  expect(w.copies.length).toBe(4)
})

test('picture select: a click whose page still reads its words copies nothing after a newer click on a ready page', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  await hover(ui, 52, 4)
  await settle(w)
  // A second drawing (one more line: its own folder), its words held.
  w.hold()
  const slow = await drawAnswer($, w, 'ans-2', `${TARGETS_MD}\n\nOne more line.`)
  await click(slow, 6, 3)
  await settle(w)
  await click(ui, 52, 4)
  await settle(w)
  expect(w.copies).toEqual(['ls -la'])
  w.release()
  await settle(w)
  expect(w.copies).toEqual(['ls -la'])
  expect(w.clipboard).toBe('ls -la')
  expect(w.toasts.filter(t => t.startsWith('Intelligent UI: copied the '))).toEqual(['Intelligent UI: copied the command'])
})

test('picture select: an up whose page still reads its words copies nothing after a newer click', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  await hover(ui, 52, 4)
  await settle(w)
  w.hold()
  const slow = await drawAnswer($, w, 'ans-2', `${TARGETS_MD}\n\nOne more line.`)
  await slow.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'sel0' })
  await slow.pointer({ type: 'move', x: 20, y: 3, button: 'left', in: 'sel0' })
  await slow.pointer({ type: 'up', x: 30, y: 3, button: 'left', in: 'sel0' })
  await settle(w)
  await click(ui, 52, 4)
  await settle(w)
  w.release()
  await settle(w)
  expect(w.copies).toEqual(['ls -la'])
  expect(w.clipboard).toBe('ls -la')
})

test("picture select: a click on a code block's copy button copies its whole code; a hover tints the button", async ($, on) => {
  const { w, ui } = await drawTargets($, on, { env: { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', IUI_DEBUG: '1' } })
  // The button: row 8, columns 8 to 15.
  await hover(ui, 11, 8)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  const png = w.frames.at(-1)!.png
  expect([cellOf(png, 8, 8), cellOf(png, 8, 15)]).toEqual(['selected', 'selected'])
  expect([cellOf(png, 8, 7), cellOf(png, 8, 16), cellOf(png, 9, 11)]).toEqual(['page', 'page', 'page'])
  await click(ui, 11, 8)
  await settle(w)
  expect(w.copies).toEqual(['echo hello\nls -la'])
  expect(w.toasts).toContain('Intelligent UI: copied the code')
  expect(w.traces.some(t => t.includes('select: hover ans-1 page 0 target 4 (code) rows 8:8-15'))).toBe(true)
  expect(w.traces.some(t => t.includes('select: click ans-1 page 0 at 11,8 target code'))).toBe(true)
  // The code's text is no target; the other targets copy as before.
  await click(ui, 5, 11)
  await click(ui, 52, 4)
  await settle(w)
  expect(w.copies).toEqual(['echo hello\nls -la', 'ls -la'])
})

test('picture select: a ctrl+click copies as a plain click does; a right click is dropped', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  await click(ui, 6, 3, { button: 'right' })
  await click(ui, 6, 3, { button: 'right', ctrl: true })
  await settle(w)
  expect(w.copies).toEqual([])
  await click(ui, 6, 3, { ctrl: true })
  await settle(w)
  expect(w.copies).toEqual(['https://example.com'])
})

test('picture select: after a click on a target its tint shows again; a leave then takes it down', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  await click(ui, 6, 3)
  await settle(w)
  expect(isFrame(w)).toBe(true)
  expect(cellOf(w.frames.at(-1)!.png, 3, 4)).toBe('selected')
  // The same cell again: no new post, no new frame.
  const frames = w.frames.length
  await hover(ui, 6, 3)
  await settle(w)
  expect(w.frames.length).toBe(frames)
  await ui.pointer({ type: 'leave', x: 6, y: 3, in: 'sel0' })
  await settle(w)
  expect(isPlain(w)).toBe(true)
})

test('picture select: a hover that replaced an up in its frame carries it: the copy is made', async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  const at = (x: number, y: number) => ({ x, y })
  const up = { id: 'ans-1', page: 0, anchor: at(0, 1), head: at(21, 3), phase: 'up', seq: 102 }
  await ui.post({ id: 'ans-1', page: 0, anchor: at(0, 1), head: at(0, 1), phase: 'down', seq: 101 }, { in: 'sel0' })
  await ui.post({ id: 'ans-1', page: 0, anchor: at(6, 3), head: at(6, 3), phase: 'hover', seq: 103, end: up }, { in: 'sel0' })
  // The same up again (a later hover): not copied twice.
  await ui.post({ id: 'ans-1', page: 0, anchor: at(7, 3), head: at(7, 3), phase: 'hover', seq: 104, end: up }, { in: 'sel0' })
  await settle(w)
  expect(w.copies.length).toBe(1)
  expect(w.copies[0]).toContain('Targets')
})

test('picture select: with IUI_DEBUG, a click writes its target; a hover its target', async ($, on) => {
  const { w, ui } = await drawTargets($, on, { env: { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', IUI_DEBUG: '1' } })
  await hover(ui, 6, 3)
  await settle(w)
  await click(ui, 6, 3)
  await settle(w)
  await click(ui, 1, 3)
  await settle(w)
  expect(w.traces.some(t => t.includes('select: hover ans-1 page 0 target 0 (web) rows 3:4-11'))).toBe(true)
  expect(w.traces.some(t => t.includes('select: click ans-1 page 0 at 6,3 target web'))).toBe(true)
  expect(w.traces.some(t => t.includes('select: click ans-1 page 0 at 1,3 target none'))).toBe(true)
})

test('no private cache folder: nothing is drawn (no shared folder instead); /iui, its details and a toast say why', async ($, on) => {
  const refused = '/t/cc-intelligent-ui-501'
  const w = world(on, { tty: TTY, refused })
  const why = `the cache folder ${refused} is a link, not a folder, or not yours`
  expect((await $.command.run({ command: 'iui', args: '' } as any)).text).toContain(`No pictures: ${why}. See /iui details.`)
  const ui = await $.ui.mount(message('ans-1', SMALL_MD))
  await settle(w)
  await ui.redraw(props(SMALL_MD))
  await settle(w)
  expect(tree(await ui.drawn()).some(n => n.type === 'Image' || n.type === 'Client')).toBe(false)
  expect(w.compiles).toEqual([])
  const details = (await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? ''
  expect(details).toContain(`Intelligent UI draws no pictures: ${why}`)
  expect((await detailLines($))[0]).toBe(`Picture select: off (${why})`)
  expect(w.toasts).toContain(`Intelligent UI: no pictures, ${why} (see /iui details)`)
  // The old shared folder is never used.
  expect([...w.ran.flat(), ...w.reads, ...w.files.keys()].some(t => t.includes('/tmp/cc-intelligent-ui'))).toBe(false)
})

// ---- The newest copy wins -----------------------------------------------------
// A copy that still reads its words when a newer copy came (ours, another
// plugin's $.ui.copy, Claude Code's copy on select, another app's) copies nothing.

test('picture select: an up whose words are still read copies nothing after a native selection (the watcher sees its copy)', async ($, on) => {
  const w = world(on, { tty: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  w.hold()
  const ui = await drawAnswer($, w)
  await drag(ui)
  await settle(w)
  expect(w.copies).toEqual([])
  // Claude Code's own selection: it copies on select, past every hook.
  w.selection = { text: 'native text', requestId: 'ans-0' }
  w.foreign('native text')
  await w.clock.advance(600)
  await settle(w)
  expect(isPlain(w)).toBe(true)
  w.release()
  await settle(w)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe('native text')
})

test('picture select: an up whose words are still read copies nothing after a native selection, with no watcher and no poll in between', async ($, on) => {
  const w = world(on, { tty: TTY, noBridge: true })
  await $.command.run({ command: 'iui', args: '' } as any)
  w.hold()
  const ui = await drawAnswer($, w)
  await drag(ui)
  await settle(w)
  // The native selection comes just before the words: no poll ran, no clipboard change is seen.
  w.selection = { text: 'native text', requestId: 'ans-0' }
  w.foreign('native text')
  w.release()
  await settle(w)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe('native text')
})

test('picture select: a click whose words are still read copies nothing after a native selection (no poll runs for a click)', async ($, on) => {
  const { w } = await drawTargets($, on, { noBridge: true })
  w.hold()
  const slow = await drawAnswer($, w, 'ans-2', `${TARGETS_MD}\n\nOne more line.`)
  await click(slow, 6, 3)
  await settle(w)
  expect(w.copies).toEqual([])
  w.selection = { text: 'native text', requestId: 'ans-0' }
  w.foreign('native text')
  w.release()
  await settle(w)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe('native text')
  // A native selection made before the click does not stop it.
  await click(slow, 6, 3)
  await settle(w)
  expect(w.copies).toEqual(['https://example.com'])
})

test('picture select: a click whose words are still read copies nothing after a copy in another app; a password manager\'s copy too', async ($, on) => {
  const { w } = await drawTargets($, on)
  w.hold()
  const slow = await drawAnswer($, w, 'ans-2', `${TARGETS_MD}\n\nOne more line.`)
  await click(slow, 6, 3)
  await settle(w)
  w.foreign('copied in another app')
  await settle(w)
  w.release()
  await settle(w)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe('copied in another app')
  // A password manager's copy: never read (exit 3), and a newer copy still.
  w.hold()
  const slower = await drawAnswer($, w, 'ans-3', `${TARGETS_MD}\n\nTwo more lines.\n\nHere.`)
  await click(slower, 6, 3)
  await settle(w)
  w.concealed('hunter2')
  await settle(w)
  w.release()
  await settle(w)
  expect(w.copies).toEqual([])
  expect(w.clipboard).toBe('hunter2')
})

test('a $.ui.copy of picture cells whose words are still read is refused after a newer click', { plugins: [COPIER] }, async ($, on) => {
  const { w, ui } = await drawTargets($, on)
  w.hold()
  // A newer drawing (its own folder): its words held. The cells fit it first (the newest).
  await drawAnswer($, w, 'ans-2', `${TARGETS_MD}\n\nOne more line.`)
  const cp = $.command.run({ command: 'cp', args: [cells(1, 0, 97), cells(2, 0, 97), cells(3, 0, 21)].join('\n') } as any)
  await settle(w)
  await click(ui, 6, 3)
  await settle(w)
  expect(w.copies).toEqual(['https://example.com'])
  w.release()
  expect(JSON.parse((await cp).text!)).toEqual({ isCopied: false, reason: 'refused' })
  await settle(w)
  expect(w.copies).toEqual(['https://example.com'])
  expect(w.clipboard).toBe('https://example.com')
})

test('another plugin\'s $.ui.copy cancels a click whose words are still read; its clipboard change is no copy from outside', { plugins: [COPIER] }, async ($, on) => {
  const { w } = await drawTargets($, on)
  w.hold()
  const slow = await drawAnswer($, w, 'ans-2', `${TARGETS_MD}\n\nOne more line.`)
  await click(slow, 6, 3)
  await settle(w)
  await $.command.run({ command: 'cp', args: 'plain text' } as any)
  await settle(w)
  w.release()
  await settle(w)
  expect(w.copies).toEqual(['plain text'])
  expect(w.clipboard).toBe('plain text')
  // Its clipboard change read only after a newer click started: that click still copies.
  w.holdReads()
  await $.command.run({ command: 'cp', args: 'more text' } as any)
  w.hold()
  const slower = await drawAnswer($, w, 'ans-3', `${TARGETS_MD}\n\nTwo more lines.\n\nHere.`)
  await click(slower, 6, 3)
  await settle(w)
  w.releaseReads()
  await settle(w)
  w.release()
  await settle(w)
  expect(w.copies).toEqual(['plain text', 'more text', 'https://example.com'])
  expect(w.clipboard).toBe('https://example.com')
})

test('/iui grab that copies nothing (no selection, no picture cells) does not cancel a click whose words are still read', async ($, on) => {
  const { w } = await drawTargets($, on)
  w.hold()
  const slow = await drawAnswer($, w, 'ans-2', `${TARGETS_MD}\n\nOne more line.`)
  await click(slow, 6, 3)
  await settle(w)
  // The same text the clipboard had: no change seen.
  const said = await grab($)
  expect(said).toContain('no picture cells')
  w.release()
  await settle(w)
  expect(w.copies).toEqual(['https://example.com'])
  expect(w.clipboard).toBe('https://example.com')
})

test('a password manager\'s copy is never read: no hint, no /iui grab, nothing in dump; the read looks at the marks first', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w)
  const pastes = w.pastes
  w.concealed(COPY)
  await w.clock.settle()
  // One read, which gives exit 3 (no text).
  expect(w.pastes).toBe(pastes + 1)
  expect(hints(w)).toBe(0)
  expect(await grab($)).toBe('Intelligent UI: no mouse selection, and the clipboard can not be read (see /iui details).')
  expect((await $.command.run({ command: 'iui', args: 'dump' } as any)).text).toContain('no clipboard text with picture cells seen yet')
  expect(w.copies).toEqual([])
  // The perl read: the concealed and transient types (nspasteboard.org) before the text, and a change during the read drops it.
  for (const type of ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType']) {
    expect(READ_PL.indexOf(type)).toBeGreaterThan(-1)
    expect(READ_PL.indexOf(type)).toBeLessThan(READ_PL.indexOf('stringForType_'))
  }
  expect(READ_PL).toContain('exit 3 if $secret{$t->objectAtIndex_($i)->UTF8String}')
  expect(READ_PL.indexOf('exit 3 if $pb->changeCount != $n')).toBeGreaterThan(READ_PL.indexOf('stringForType_'))
  expect(READ_PL.indexOf('exit 3 if $pb->changeCount != $n')).toBeLessThan(READ_PL.indexOf('print $u'))
  // The same cells copied the usual way: the hint.
  w.foreign(COPY)
  await w.clock.settle()
  expect(hints(w)).toBe(1)
})
