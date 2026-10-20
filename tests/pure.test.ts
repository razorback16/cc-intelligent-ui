import { expect, test } from 'claude-code/testing'

import {
  alignFirstLine, DEFAULT_METRICS, DEFAULT_SIZE, firstLineOf, fontFit, ghosttyFontOf, itermFontOf, parseFontSpec, typstCall,
  blocksOf, canDrawIn, columnsFor, DEFAULT_CELL, hashOf, imagePathOf, isSet, localImages, DEFAULT_WIDTH, IMAGE_MAX_COLUMNS,
  parseOd, plainOf, pngSize, shouldRetrySafe, sizeOf, sizing, splitSegments, themeOf, TYPST_PROMPT,
  escapeControls, luminanceOf, modeOfLuminance, OSC11_PL, parseOsc11, pickProfile, itermAppearanceOf, itermModeOf,
  GHOSTTY_DEFAULT_BG, ghosttyBackgroundOf, ghosttyThemePaths, ghosttyThemesOf, ghosttyValueOf, hexColorOf,
  modeLine, modeOfColorFgBg, modeOfGnome, modeOfMacAppearance, resolveMode, settingOf,
  BASE_THEME, DEFAULT_THEME, chooseTheme, isSyntaxPath, isThemeName, measureCall, pickThemes, renderKey, themeEntry, themeFiles, themeListing,
  needsRoom, nextJob, pageRowsOf, resultOf, roomInputs, rowsOfBlock, splitInTwo, typstInputs,
  composeFrame, fitBox, pictureColumns, roomColumns, scaledBulletRow,
  firstLine, gridText, heightText, isTypstInfo, widthText,
} from '../hooks/register'
import { DRAWING_ROWS } from '../hooks/lib/settings'
import { noNetworkEnv, wrapPid } from '../hooks/lib/typst'
import { S, type Env, type Job } from '../hooks/lib/state'
import { placeFirstLine } from '../hooks/lib/draw'
import { DEFAULT_GRID, gridFirstRow, gridOf, gridRowsOf } from '../hooks/lib/grid'

const para = (i: number) => `Paragraph ${i} ${'word '.repeat(40)}`.trim()
const fence = (info: string, lines: number) => ['```' + info, ...Array.from({ length: lines }, (_, i) => `line ${i}`), '```'].join('\n')
const words = (s: string) => s.split(/\s+/).filter(Boolean)

test('a short answer is one segment', () => {
  expect(splitSegments('# Title\n\nSome text.', 100)).toEqual(['# Title\n\nSome text.'])
  expect(splitSegments('   \n\n', 100)).toEqual([])
})

test('a long answer is cut at blank lines and keeps every word', () => {
  const md = Array.from({ length: 120 }, (_, i) => para(i)).join('\n\n')
  const segments = splitSegments(md, 80)
  expect(segments.length).toBeGreaterThan(1)
  expect(words(segments.join('\n\n'))).toEqual(words(md))
  for (const s of segments) expect(s.startsWith('Paragraph')).toBe(true)
})

test('a blank line inside a code fence never cuts it', () => {
  const md = ['Intro', '', '```js', 'a()', '', 'b()', '```', '', 'After'].join('\n')
  const blocks = blocksOf(md)
  expect(blocks.length).toBe(3)
  expect(blocks[1]!.lines).toEqual(['```js', 'a()', '', 'b()', '```'])
  expect(blocks[1]!.fence?.info).toBe('js')
})

test('a long code fence is cut into fences of the same language', () => {
  const md = `Before\n\n${fence('python', 400)}\n\nAfter`
  const segments = splitSegments(md, 80)
  expect(segments.length).toBeGreaterThan(2)
  const fenced = segments.filter(s => s.includes('line '))
  for (const s of fenced) {
    const open = (s.match(/^```python$/gm) ?? []).length
    const shut = (s.match(/^```$/gm) ?? []).length
    expect(open).toBe(shut)
    expect(open).toBeGreaterThan(0)
  }
  const all = segments.join('\n')
  for (let i = 0; i < 400; i++) expect(all.includes(`line ${i}\n`) || all.endsWith(`line ${i}`)).toBe(true)
})

test('a typst fence is never cut, however long', () => {
  for (const info of ['typst', 'typ']) {
    const md = `Before\n\n${fence(info, 400)}\n\nAfter`
    const segments = splitSegments(md, 80)
    const holding = segments.filter(s => s.includes('line '))
    expect(holding.length).toBe(1)
    expect(holding[0]!.includes(fence(info, 400))).toBe(true)
  }
})

test('a typst fence with blank lines inside stays whole', () => {
  const body = ['```typst', '#let a = 1', '', '#a', '```'].join('\n')
  const md = `${Array.from({ length: 60 }, (_, i) => para(i)).join('\n\n')}\n\n${body}\n\n${para(99)}`
  const segments = splitSegments(md, 80)
  expect(segments.some(s => s.includes(body))).toBe(true)
})

test('a typst fence counts as its room rows, not its source lines', () => {
  const md = `Before\n\n${fence('typst', 200)}\n\nAfter`
  expect(splitSegments(md, 80, undefined, 100, 24)).toEqual([md])
  // Four drawings with text between them: one page, as they are drawn.
  const four = Array.from({ length: 4 }, (_, i) => `${para(i)}\n\n${fence('typst', 60)}`).join('\n\n')
  expect(splitSegments(four, 80, undefined, 100, 24)).toEqual([four])
})

test('the room rows given are used for a typst fence', () => {
  const block = blocksOf(fence('typst', 200))[0]!
  expect(rowsOfBlock(block, 80, 100, 40)).toBe(42)
  // The margins follow the text size; the drawing does not.
  expect(rowsOfBlock(block, 80, 200, 40)).toBe(44)
  const md = `${fence('typst', 5)}\n\n${fence('typst', 5)}`
  expect(splitSegments(md, 80, undefined, 100, 100).length).toBe(2)
  expect(splitSegments(md, 80, undefined, 100, 24).length).toBe(1)
})

test('a typst fence without a room counts as DRAWING_ROWS', () => {
  const block = blocksOf(fence('typst', 200))[0]!
  expect(rowsOfBlock(block, 80)).toBe(DRAWING_ROWS + 2)
  const md = `Before\n\n${fence('typst', 200)}\n\nAfter`
  expect(splitSegments(md, 80)).toEqual(splitSegments(md, 80, undefined, 100, DRAWING_ROWS))
  expect(splitInTwo(md, 80)).toEqual(splitInTwo(md, 80, 100, DRAWING_ROWS))
})

test('an indented continuation never starts a segment', () => {
  const md = Array.from({ length: 80 }, (_, i) => `- item ${i} ${'word '.repeat(30)}\n\n    more of item ${i}`).join('\n\n')
  for (const s of splitSegments(md, 80)) expect(/^\s/.test(s)).toBe(false)
})

test('footnotes keep the answer in one segment; link definitions go to every segment', () => {
  const long = Array.from({ length: 120 }, (_, i) => para(i)).join('\n\n')
  expect(splitSegments(`${long}\n\nSee[^1].\n\n[^1]: A note.`, 80).length).toBe(1)
  const segments = splitSegments(`${long}\n\n[docs]: https://example.com`, 80)
  expect(segments.length).toBeGreaterThan(1)
  for (const s of segments) expect(s.includes('[docs]: https://example.com')).toBe(true)
})

test('the hash is stable and tells inputs apart', () => {
  expect(hashOf(['abc', 100])).toBe(hashOf(['abc', 100]))
  expect(hashOf(['abc', 100])).not.toBe(hashOf(['abc', 101]))
  expect(hashOf(['ab', 'c'])).not.toBe(hashOf(['a', 'bc']))
  expect(hashOf(['x'])).toMatch(/^[0-9a-f]{16}$/)
})

test('the theme follows the setting', () => {
  expect(themeOf('light')).toBe('light')
  expect(themeOf('light-daltonized')).toBe('light')
  expect(themeOf('dark-ansi')).toBe('dark')
  expect(themeOf(undefined)).toBe('dark')
  expect(themeOf(true)).toBe('dark')
})

const near = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps)

const MESLO = { adv: 0.60205, xh: 0.546875, avg: 0.60205 }
const SF = { adv: 0.62988, xh: 0.526367, avg: 0.482785 }

test('the body font is matched to the terminal font by x-height and width', () => {
  const fit = fontFit({ term: MESLO, menlo: MESLO, body: SF })
  // Body text is about 1.14 times the terminal em, so it looks as big.
  near(fit.ratio, 1.1379, 1e-3)
  near(fit.code, 1 / fit.ratio, 1e-4)
  // A column is a terminal cell: 11 pt body / ratio = em; em * advance = cell.
  near(fit.columnPt, (11 * MESLO.adv) / fit.ratio, 1e-3)
  // The size setting is on top: 130% narrows the column by 1.3.
  near(fontFit({ term: MESLO, menlo: MESLO, body: SF }, 130).columnPt, fit.columnPt / 1.3, 1e-3)
  // No terminal font known: Menlo's metrics stand in.
  near(fontFit({ term: null, menlo: MESLO, body: SF }).columnPt, fit.columnPt, 1e-9)
  near(fontFit(DEFAULT_METRICS).ratio, 1.1379, 2e-3)
  expect(DEFAULT_SIZE).toBe(100)
})

test('size math: the PNG is exactly as wide as the box', () => {
  expect(columnsFor(100, 'full')).toBe(98)
  expect(columnsFor(undefined, 'full')).toBe(78)
  const s = sizing(100, { width: 16, height: 32 }, 6.6)
  expect(s.widthPt).toBe(660)
  expect(s.widthPx).toBe(1600)
  expect(Math.round((s.widthPt / 72) * s.ppi)).toBe(1600)
  near(s.rowPt, 13.2)
  const odd = sizing(97, { width: 16.6, height: 34 }, 5.8197)
  expect(Math.round((odd.widthPt / 72) * odd.ppi)).toBe(odd.widthPx)
  // Example: 120 columns of a 17 x 34 px cell.
  expect(sizing(120, { width: 17, height: 34 }, 5.82).widthPx).toBe(2040)
})

test('the width: full by default (the viewport less the bullet), a cap when set, 20 to 255 columns', () => {
  expect(DEFAULT_WIDTH).toBe('full')
  expect(columnsFor(200, DEFAULT_WIDTH)).toBe(198)
  expect(columnsFor(200, 120)).toBe(120)
  expect(columnsFor(100, 120)).toBe(98)
  expect(columnsFor(200, 40)).toBe(40)
  // An Image is 255 columns at most, also for a larger cap.
  expect(columnsFor(400, 'full')).toBe(IMAGE_MAX_COLUMNS)
  expect(columnsFor(400, 400)).toBe(IMAGE_MAX_COLUMNS)
  // A narrow terminal still gets 20 columns.
  expect(columnsFor(10, 'full')).toBe(20)
  expect(columnsFor(10, 40)).toBe(20)
  // Over ssh a page is 4096 px wide at most: 256 columns of 16 px, 204 of 20 px.
  expect(columnsFor(400, 'full', { width: 16, height: 32 })).toBe(IMAGE_MAX_COLUMNS)
  expect(columnsFor(400, 'full', { width: 20, height: 40 })).toBe(204)
  expect(columnsFor(150, 'full', { width: 20, height: 40 })).toBe(148)
  expect(columnsFor(400, 'full', null)).toBe(IMAGE_MAX_COLUMNS)
})

test('the first line of an answer is told by how it starts', () => {
  expect(firstLineOf('\n\nSome text')).toBe('para')
  expect(firstLineOf('# Title')).toBe('h1')
  expect(firstLineOf('## Part')).toBe('h2')
  expect(firstLineOf('### Part')).toBe('h3')
  expect(firstLineOf('###### Small')).toBe('h4')
  expect(firstLineOf('#hashtag')).toBe('para')
  expect(firstLineOf('> quote')).toBe('quote')
  expect(firstLineOf('```js\nx\n```')).toBe('code')
  expect(firstLineOf('| a | b |')).toBe('table')
  expect(firstLineOf('- item')).toBe('para')
})

test('the first line of text is centred on the bullet row', () => {
  // 11 pt rows: a paragraph fits row 0, pulled up a little.
  expect(alignFirstLine('para', 11)).toEqual({ topPt: -1.95, bulletRow: 0 })
  // A big heading is taller than a row: it centres on row 1, its ink not cut.
  const h1 = alignFirstLine('h1', 11)
  expect(h1.bulletRow).toBe(1)
  near(h1.topPt, -3.86, 0.01)
  const inkTop = { para: 2.55, h1: 5.82, h2: 3.64, h3: 2.55, h4: 2.18, quote: 8.36, code: 12.36, table: 6.18 }
  for (const kind of ['para', 'h1', 'h2', 'h3', 'h4', 'quote', 'code', 'table'] as const) {
    for (const rowPt of [9, 11, 13.2, 16]) {
      const { topPt, bulletRow } = alignFirstLine(kind, rowPt)
      expect(bulletRow).toBeGreaterThanOrEqual(0)
      expect(bulletRow).toBeLessThan(3)
      // No ink above the picture's top.
      expect(inkTop[kind] + topPt).toBeGreaterThan(0)
    }
  }
  // A theme's padding over a quote or code block moves its first line by what it pads more.
  for (const kind of ['quote', 'code'] as const) {
    const padded = { ...DEFAULT_GRID, pad: { ...DEFAULT_GRID.pad, [kind]: DEFAULT_GRID.pad[kind] + 2 } }
    const { topPt, bulletRow } = alignFirstLine(kind, 11)
    const moved = alignFirstLine(kind, 11, padded)
    expect(moved.bulletRow).toBe(bulletRow)
    near(moved.topPt, topPt - 2, 0.001)
  }
})

test('with the row grid, no top margin and the bullet on the row of the first line\'s ink centre', () => {
  const grid = { metrics: DEFAULT_GRID, code: 0.8785 }
  // The rows of a 36 px cell at /iui size 100, 117, 125, 150 and 200%, and
  // the row of the first line in the template's pictures at those sizes.
  const rowsPt = [13.091, 11.1888, 10.4726, 8.7273, 6.5455]
  const drawn: Record<string, number[]> = {
    '# Title': [1, 1, 2, 2, 2],
    '## Part': [1, 1, 1, 1, 2],
    '### Part': [1, 1, 1, 1, 1],
    '#### Part': [0, 1, 1, 1, 1],
    '##### Part': [0, 0, 0, 1, 1],
    '###### Part': [0, 0, 0, 1, 1],
    'Some text': [0, 1, 1, 1, 1],
    '- item': [0, 1, 1, 1, 1],
    '> quote': [0, 2, 2, 2, 2],
    '```\ncode\n```': [1, 2, 2, 2, 3],
    '| a | b |\n|---|---|': [0, 1, 1, 1, 2],
  }
  for (const [md, rows] of Object.entries(drawn)) {
    rowsPt.forEach((rowPt, i) => expect([md, placeFirstLine(md, rowPt, grid)]).toEqual([md, { topPt: 0, bulletRow: rows[i] }]))
  }
  // A "grid" table (claude-code): the half row above its box and its
  // padding of whole rows and a half put its first line one row lower.
  const boxed = { metrics: { ...DEFAULT_GRID, pad: { ...DEFAULT_GRID.pad, table: 7.8571 }, tableStyle: 'grid' as const }, code: 0.8785 }
  rowsPt.forEach((rowPt, i) => expect(placeFirstLine('| a | b |\n|---|---|', rowPt, boxed)).toEqual({ topPt: 0, bulletRow: [1, 2, 2, 2, 3][i] }))
  // Grid off: the margin and row of before.
  for (const md of Object.keys(drawn)) expect(placeFirstLine(md, 11)).toEqual(alignFirstLine(firstLineOf(md), 11))
})

test('a line box of n rows has its ink centre on row floor(n / 2), under the padding in whole rows', () => {
  const row = 10
  const g = (body: number, pad = 0) => ({ ...DEFAULT_GRID, body, pad: { quote: pad, code: pad, table: pad } })
  // n = 1, 2, 3, 4: an even box is half a row down, so its centre is in row n / 2.
  expect([9, 19, 29, 39].map(need => gridFirstRow('para', 0, row, g(need), 1))).toEqual([0, 1, 1, 2])
  expect(gridRowsOf(20, row)).toBe(2)
  expect(gridRowsOf(20.005, row)).toBe(2)
  expect(gridRowsOf(20.02, row)).toBe(3)
  // Padding rounds to the nearest whole rows.
  expect(gridFirstRow('quote', 0, row, g(19, 14), 1)).toBe(1 + 1)
  expect(gridFirstRow('table', 0, row, g(9, 4), 1)).toBe(0)
  // Code: the code font's need per pt at the theme's size, or at `code` for "terminal".
  const code = { ...DEFAULT_GRID, body: 9, code: 1.5, pad: { ...DEFAULT_GRID.pad, code: 0 } }
  expect(gridFirstRow('code', 0, row, code, 0.5)).toBe(1)
  expect(gridFirstRow('code', 0, row, { ...code, codeSize: null }, 0.5)).toBe(0)
  // Body text of 2 rows: the page starts half a row down, so code lines of
  // an odd number of rows are half a row down in it (one row lower). A
  // heading's line box starts the page.
  expect(gridFirstRow('code', 0, row, { ...code, body: 19, codeSize: null }, 0.5)).toBe(1)
  expect(gridFirstRow('h1', 1, row, { ...DEFAULT_GRID, body: 19, heading: [29, 20, 20, 9, 9, 9] }, 1)).toBe(1)
})

test('the grid numbers of the font measure are read, and a bad one is refused', () => {
  const measured = {
    body: 11.2836, heading: [31.8, 20.4, 14.2, 11.4, 9.9, 9.7], code: 1.0775, 'code-size': null,
    pad: { quote: 6.05, code: 12.57, table: 3.93 }, 'table-style': 'rules',
  }
  expect(gridOf(measured)).toEqual({
    body: 11.2836, heading: [31.8, 20.4, 14.2, 11.4, 9.9, 9.7], code: 1.0775, codeSize: null, pad: { quote: 6.05, code: 12.57, table: 3.93 }, tableStyle: 'rules',
  })
  expect(gridOf({ ...measured, 'table-style': 'grid' })?.tableStyle).toBe('grid')
  expect(gridOf({ ...measured, 'code-size': 1 })?.codeSize).toBe(1)
  expect(gridOf(undefined)).toBe(null)
  expect(gridOf({ ...measured, heading: [1, 2] })).toBe(null)
  expect(gridOf({ ...measured, body: '11' })).toBe(null)
  expect(gridOf({ ...measured, pad: { quote: 1 } })).toBe(null)
  expect(gridOf({ ...measured, 'code-size': 'terminal' })).toBe(null)
  expect(gridOf({ ...measured, 'table-style': 'box' })).toBe(null)
  expect(gridOf({ ...measured, 'table-style': undefined })).toBe(null)
})

test('pages are padded to whole rows, so rows round; a page keeps the box it was compiled for', () => {
  const px = { width: 16, height: 32 }
  expect(pageRowsOf(320, px)).toBe(10)
  expect(pageRowsOf(321, px)).toBe(10)
  expect(pageRowsOf(319, px)).toBe(10)
  expect(pageRowsOf(10, px)).toBe(1)
  // Not capped here: a page over 255 rows is cut in two by compile.
  expect(pageRowsOf(100000, px)).toBe(3125)
  expect(DEFAULT_CELL.height / DEFAULT_CELL.width).toBe(2)
  // A kept pages.json without the box (an older format) is not used.
  const page = { file: '/c/k/a-1.png', width: 1600, height: 320, alt: 'x', columns: 100, rows: 10 }
  expect(resultOf(JSON.stringify({ pages: [page], bulletRow: 0 }))).toMatchObject({ pages: [page] })
  expect(resultOf(JSON.stringify({ pages: [{ ...page, columns: undefined, rows: undefined }], bulletRow: 0 }))).toBe(null)
  expect(resultOf('not json')).toBe(null)
})

test('a text needs the room height only with a live Typst block or a local image', () => {
  expect(needsRoom('# Title\n\nSome text.')).toBe(false)
  expect(needsRoom('```js\nx()\n```')).toBe(false)
  expect(needsRoom('```typst\n#rect()\n```')).toBe(true)
  expect(needsRoom('Text\n\n```typ\n#rect()\n```')).toBe(true)
  // In a list item too (the template draws it live there as well).
  expect(needsRoom('- item\n\n  ```typst\n  #rect()\n  ```')).toBe(true)
  expect(needsRoom('See ![a plot](./plot.png).')).toBe(true)
  expect(needsRoom('See ![a plot](https://x.org/plot.png).')).toBe(false)
  expect(needsRoom('```md\n![a plot](./plot.png)\n```')).toBe(false)
})

test('the room height is in the key only when it is given (a text that needs it)', () => {
  const o = {
    textHash: 'h', columns: 100, cell: DEFAULT_CELL, size: 100, mode: 'dark' as const, termFont: '', columnPt: 6,
    templateStamp: '1', look: { name: 'vscode', dir: '/t', stamp: '0' },
  }
  const room = { heightPt: 300, design: { widthPt: 596, heightPt: 300 }, designKey: 'd', isNew: true }
  const plain = renderKey(o)
  expect(renderKey({ ...o, room: undefined })).toBe(plain)
  const roomed = renderKey({ ...o, room })
  expect(roomed).not.toBe(plain)
  // Whether the design is new is not in the key: the same space either way.
  expect(renderKey({ ...o, room: { ...room, isNew: false, designKey: 'e' } })).toBe(roomed)
  expect(renderKey({ ...o, room: { ...room, heightPt: 200 } })).not.toBe(roomed)
  expect(renderKey({ ...o, room: { ...room, design: { widthPt: 500, heightPt: 300 } } })).not.toBe(roomed)
})

test('the grid is in the key only when it is on, so the keys with it off stay', () => {
  const o = {
    textHash: 'h', columns: 100, cell: DEFAULT_CELL, size: 100, mode: 'dark' as const, termFont: '', columnPt: 6,
    templateStamp: '1', look: { name: 'vscode', dir: '/t', stamp: '0' },
  }
  const plain = renderKey(o)
  expect(renderKey({ ...o, grid: false })).toBe(plain)
  expect(renderKey({ ...o, grid: true })).not.toBe(plain)
})

test('with the grid on, the template gets grid=1 and top=0; with it off, no grid input', () => {
  const env = { metrics: DEFAULT_METRICS, termFont: '' } as Env
  const job = { key: 'k', requestId: 'r', text: '# Title', columns: 100, cell: DEFAULT_CELL, theme: 'dark', size: 100, grid: false, themeDir: '/t', env, epoch: 0 } as Job
  const off = typstInputs(job, ['# Title'], '/c/k', false)
  expect('grid' in off.inputs).toBe(false)
  expect(off.inputs.top).toBe(alignFirstLine('h1', sizing(100, DEFAULT_CELL, fontFit(DEFAULT_METRICS).columnPt).rowPt).topPt)
  const on = typstInputs({ ...job, grid: true }, ['# Title'], '/c/k', false)
  expect(on.inputs.grid).toBe(1)
  expect(on.inputs.top).toBe(0)
  // Only grid and top change; the ppi is the same.
  expect({ ...on.inputs, grid: undefined, top: off.inputs.top }).toEqual({ ...off.inputs, grid: undefined })
  expect(on.ppi).toBe(off.ppi)
})

test('the room goes to the template in pt: the design page width and room height', () => {
  expect(roomInputs(undefined)).toEqual({})
  // A first render: the design is the space now, so the factor is 1 (design-w = width).
  const width = 600
  const room = { heightPt: 352.123, design: { widthPt: width, heightPt: 352.123 }, designKey: 'd', isNew: true }
  expect(roomInputs(room)).toEqual({ height: 352.12, 'design-w': width, 'design-h': 352.12 })
})

test('rows are counted at the text size: at 200% a long answer is cut into more segments', () => {
  const md = Array.from({ length: 60 }, (_, i) => para(i)).join('\n\n')
  const at100 = splitSegments(md, 100)
  const at200 = splitSegments(md, 100, undefined, 200)
  expect(at200.length).toBeGreaterThanOrEqual(at100.length * 2)
  expect(words(at200.join('\n\n'))).toEqual(words(md))
})

test('a segment too tall for an Image is cut in two by the same rules; one block stays whole', () => {
  const md = Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n')
  const two = splitInTwo(md, 100)
  expect(two.length).toBe(2)
  expect(words(two.join('\n\n'))).toEqual(words(md))
  expect(splitInTwo(para(1), 100)).toEqual([para(1)])
})

test('the queue takes a job on screen first, then the newest', () => {
  const job = (key: string, order: number, onScreen?: boolean) => ({ key, order, ...(onScreen ? { onScreen } : {}) }) as any
  expect(nextJob([])).toBe(-1)
  expect(nextJob([job('a', 1), job('b', 3), job('c', 2)])).toBe(1)
  expect(nextJob([job('a', 1, true), job('b', 3), job('c', 2, true)])).toBe(2)
  expect(nextJob([job('a', 5), job('b', 4, true)])).toBe(1)
  // Known off screen: after any other, the newest of them first.
  const off = (key: string, order: number) => ({ key, order, onScreen: false }) as any
  expect(nextJob([job('a', 1), off('b', 9)])).toBe(0)
  expect(nextJob([off('a', 1), off('b', 2)])).toBe(1)
})

test('a compile runs through a shell that prints its PID, then becomes typst', () => {
  expect(wrapPid(['/usr/bin/typst', 'compile', 'a b.typ'])).toEqual(['sh', '-c', 'echo $$; exec "$@"', 'sh', '/usr/bin/typst', 'compile', 'a b.typ'])
})

test('the cell comes from the tty in device pixels, with no scale step', () => {
  // iTerm2 on Retina, 14 pt Meslo: 2040 x 1700 px for 120 x 50 cells.
  expect(sizeOf('50 120 2040 1700')).toEqual({ rows: 50, columns: 120, cell: { width: 17, height: 34 } })
  // Ghostty on Retina reports device pixels too.
  expect(sizeOf('40 200 3200 1360')).toEqual({ rows: 40, columns: 200, cell: { width: 16, height: 34 } })
  expect(sizeOf('50 200 0 0')).toEqual({ rows: 50, columns: 200, cell: null })
  expect(sizeOf('')).toBe(null)
  // Not believable: under 4 or over 64 px a cell.
  expect(sizeOf('50 200 600 1700')?.cell).toBe(null)
  expect(sizeOf('50 20 1700 1700')?.cell).toBe(null)
})

test('Ghostty pixels include the window padding: the cell is rounded down to whole pixels', () => {
  // 183 x 42 cells of 16 x 34 px, with 8 px and 14 px of padding.
  expect(sizeOf('42 183 2936 1442', true)?.cell).toEqual({ width: 16, height: 34 })
  // Without the flag the padding goes into the cell.
  expect(sizeOf('42 183 2936 1442')?.cell?.width).toBe(2936 / 183)
  // Exact pixels stay exact.
  expect(sizeOf('40 200 3200 1360', true)?.cell).toEqual({ width: 16, height: 34 })
})

test('the terminal font is read from iTerm2 and Ghostty settings', () => {
  expect(parseFontSpec('MesloLGS-NF-Regular 14')).toEqual({ name: 'MesloLGS-NF-Regular', size: 14 })
  expect(parseFontSpec('Menlo-Regular 12.5')).toEqual({ name: 'Menlo-Regular', size: 12.5 })
  expect(parseFontSpec('nosize')).toBe(null)
  const marks = JSON.stringify([
    { Name: 'Default', Guid: 'G1', 'Normal Font': 'MesloLGS-NF-Regular 14' },
    { Name: 'Work', Guid: 'G2', 'Normal Font': 'Menlo-Regular 12' },
  ])
  expect(itermFontOf(marks, 'Work', 'G1\n')).toBe('Menlo-Regular 12')
  expect(itermFontOf(marks, undefined, 'G1\n')).toBe('MesloLGS-NF-Regular 14')
  expect(itermFontOf(marks, 'Gone', 'G1')).toBe('MesloLGS-NF-Regular 14')
  expect(itermFontOf('not json', 'Work', 'G1')).toBe(null)
  expect(ghosttyFontOf('theme = x\nfont-family = \nfont-family = "JetBrains Mono"\nfont-family = Menlo')).toBe('JetBrains Mono')
  expect(ghosttyFontOf('font-size = 13')).toBe(null)
})

test('typst also reads the font folder of the font that Ghostty carries, when there is one', () => {
  const call = () => typstCall({ typst: 't', root: '/mod', cache: '/tmp/c', ppi: 144, inputs: {}, out: '/tmp/o.png' })
  expect(call().env.TYPST_FONT_PATHS).toBe(undefined)
  S.fontPaths = '/home/u/.cache/cc-intelligent-ui/fonts/ghostty-1'
  try {
    expect(call().env.TYPST_FONT_PATHS).toBe('/home/u/.cache/cc-intelligent-ui/fonts/ghostty-1')
  } finally {
    S.fontPaths = ''
  }
})

test('typst runs with the network off and its own package cache', () => {
  const { argv, env } = typstCall({
    typst: '/opt/homebrew/bin/typst', root: '/mod', cache: '/tmp/c', ppi: 210.5,
    inputs: { theme: 'dark', width: 698.4, 'term-font': 'MesloLGS NF', doc: '/tmp/c/k/doc.json' },
    out: '/tmp/c/k/a-{0p}.png',
  })
  expect(argv.slice(0, 2)).toEqual(['/opt/homebrew/bin/typst', 'compile'])
  expect(argv.includes('--package-path')).toBe(true)
  expect(argv[argv.indexOf('--package-path') + 1]).toBe('/mod/render/packages')
  expect(argv[argv.indexOf('--ppi') + 1]).toBe('210.5000')
  expect(argv.includes('term-font=MesloLGS NF')).toBe(true)
  expect(argv.slice(-2)).toEqual(['/mod/render/md.typ', '/tmp/c/k/a-{0p}.png'])
  expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:9')
  expect(env.HTTP_PROXY).toBe('http://127.0.0.1:9')
  expect(env.ALL_PROXY).toBe('http://127.0.0.1:9')
  expect(env.TYPST_PACKAGE_CACHE_PATH).toBe('/tmp/c/pkg-cache')
})

test('PNG headers are read', () => {
  const od = [
    '           89  50  4e  47  0d  0a  1a  0a  00  00  00  0d  49  48  44  52',
    '           00  00  06  d1  00  00  05  8f',
    '@',
    '           89  50  4e  47  0d  0a  1a  0a  00  00  00  0d  49  48  44  52',
    '           00  00  00  10  00  00  00  20',
    '@',
    '',
  ].join('\n')
  const heads = parseOd(od)
  expect(heads.length).toBe(2)
  expect(pngSize(heads[0]!)).toEqual({ width: 0x6d1, height: 0x58f })
  expect(pngSize(heads[1]!)).toEqual({ width: 16, height: 32 })
  expect(pngSize([1, 2, 3])).toBe(null)
  expect(pngSize(new Array(24).fill(0))).toBe(null)
})

test('any failed compile is retried with safe=1', () => {
  expect(shouldRetrySafe(1)).toBe(true)
  expect(shouldRetrySafe(2)).toBe(true)
  expect(shouldRetrySafe(0)).toBe(false)
})

test('local images are found outside code and resolved as the template does', () => {
  const md = '![chart](out/a.png)\n\n```md\n![x](gone.png)\n```\n\n![](https://x.dev/i.png) ![b](file:///tmp/b%20c.png) ![c](./d.png "t")'
  expect(localImages(md)).toEqual(['out/a.png', 'file:///tmp/b%20c.png', './d.png'])
  expect(imagePathOf('out/a.png', '/repo/')).toBe('/repo/out/a.png')
  expect(imagePathOf('./d.png', '/repo')).toBe('/repo/d.png')
  expect(imagePathOf('file:///tmp/b%20c.png', '/repo')).toBe('/tmp/b c.png')
})

test('the alt is one short plain line', () => {
  const alt = plainOf('# Hello\n\n- **bold** and `code`\n- [link](https://x.dev)\n\n' + 'more '.repeat(100))
  expect(alt.startsWith('Hello bold and code link more')).toBe(true)
  expect(alt.length).toBeLessThanOrEqual(200)
  expect(alt.includes('\n')).toBe(false)
  expect(plainOf('')).toBe(' ')
})

test('pictures draw where Claude Code draws them: kitty and Ghostty, or forced', () => {
  const base = { program: '', term: 'xterm-256color', kitty: false, tmux: false, ssh: false, background: false, engineForced: false, modForced: false }
  expect(canDrawIn({ ...base, program: 'ghostty' })).toBe(true)
  expect(canDrawIn({ ...base, term: 'xterm-ghostty' })).toBe(true)
  expect(canDrawIn({ ...base, term: 'xterm-kitty' })).toBe(true)
  expect(canDrawIn({ ...base, kitty: true })).toBe(true)
  expect(canDrawIn({ ...base, program: 'iTerm.app' })).toBe(false)
  expect(canDrawIn({ ...base, program: 'iTerm.app', engineForced: true })).toBe(true)
  expect(canDrawIn({ ...base, program: 'WezTerm' })).toBe(false)
  expect(canDrawIn({ ...base, program: 'WezTerm', engineForced: true })).toBe(true)
  expect(canDrawIn({ ...base, program: 'WarpTerminal' })).toBe(false)
  expect(canDrawIn({ ...base, program: 'Apple_Terminal' })).toBe(false)
  expect(canDrawIn({ ...base, program: 'ghostty', tmux: true })).toBe(false)
  expect(canDrawIn({ ...base, program: 'ghostty', tmux: true, engineForced: true })).toBe(false)
  expect(canDrawIn({ ...base, program: 'ghostty', ssh: true })).toBe(false)
  expect(canDrawIn({ ...base, program: 'iTerm.app', ssh: true, engineForced: true })).toBe(true)
  expect(canDrawIn({ ...base, ssh: true, modForced: true })).toBe(true)
  expect(canDrawIn({ ...base, modForced: true })).toBe(true)
})

test('a flag is set unless empty, 0, false, no or off', () => {
  expect(isSet('1')).toBe(true)
  expect(isSet('true')).toBe(true)
  expect(isSet(undefined)).toBe(false)
  expect(isSet('')).toBe(false)
  expect(isSet('0')).toBe(false)
  expect(isSet('false')).toBe(false)
})

test('Claude is told about typst blocks', () => {
  expect(TYPST_PROMPT.includes('```typst')).toBe(true)
  expect(TYPST_PROMPT.includes('#import "@preview/cetz:0.5.2"')).toBe(true)
  expect(TYPST_PROMPT.includes('#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge')).toBe(true)
  expect(TYPST_PROMPT.includes('LaTeX math (`$…$` inline, `$$…$$` for display)')).toBe(true)
  expect(TYPST_PROMPT.includes('Make your answers visual where a picture explains more than words')).toBe(true)
  expect(TYPST_PROMPT.includes('Each typst block compiles alone')).toBe(true)
  expect(TYPST_PROMPT.includes('theme.code-bg')).toBe(true)
  expect(TYPST_PROMPT.includes('break a long label with `\\`')).toBe(true)
  expect(TYPST_PROMPT.endsWith('keep replies readable as plain text too.')).toBe(true)
})

test('each typst example in the prompt imports what it uses', () => {
  const blocks = [...TYPST_PROMPT.matchAll(/```typst\n([\s\S]*?)```/g)].map(m => m[1]!)
  expect(blocks.length).toBe(3)
  for (const b of blocks) {
    if (/\b(diagram|node|edge)\(/.test(b)) expect(b.includes('#import "@preview/fletcher:0.5.8"')).toBe(true)
    if (b.includes('cetz.')) expect(b.includes('#import "@preview/cetz:0.5.2"')).toBe(true)
    if (b.includes('plot.')) expect(b.includes('#import "@preview/cetz-plot:0.1.4"')).toBe(true)
  }
})


test('a theme name is a plain word, not a hidden file', () => {
  expect(isThemeName('.hidden')).toBe(false)
  expect(isThemeName('nord')).toBe(true)
})

test('a theme folder is usable only with a theme.json object', () => {
  expect(themeEntry('nord', '/u/nord', true, '{"name":"Nord","description":"Cold"}')).toEqual({
    name: 'nord', dir: '/u/nord', isUser: true, title: 'Nord', description: 'Cold', syntax: {},
  })
  expect(themeEntry('bare', '/u/bare', true, '{}')).toMatchObject({ title: 'bare', description: '' })
  for (const bad of ['{"name":', '[]', '3', 'null', '"x"']) expect('reason' in themeEntry('x', '/u/x', true, bad)).toBe(true)
  expect('reason' in themeEntry('a b', '/u/a b', true, '{}')).toBe(true)
})

test('a user theme replaces the built-in one of its name; a broken one is only reported', () => {
  const found = [
    themeEntry('nord', '/home/.claude/cc-intelligent-ui/themes/nord', true, '{"description":"mine"}'),
    themeEntry('vscode', '/mod/render/themes/vscode', false, '{"name":"VS Code"}'),
    themeEntry('nord', '/mod/render/themes/nord', false, '{"description":"built-in"}'),
    themeEntry('vscode', '/home/.claude/cc-intelligent-ui/themes/vscode', true, '{not json'),
    themeEntry('solar', '/home/.claude/cc-intelligent-ui/themes/solar', true, '[1]'),
  ]
  const { themes, problems } = pickThemes(found)
  expect([...themes.keys()].sort()).toEqual(['nord', 'vscode'])
  expect(themes.get('nord')).toMatchObject({ isUser: true, description: 'mine' })
  expect(themes.get('vscode')).toMatchObject({ isUser: false, dir: '/mod/render/themes/vscode' })
  expect(problems.map(p => p.name).sort()).toEqual(['solar', 'vscode'])
  const listing = themeListing(themes, problems, 'nord', '/home/.claude/cc-intelligent-ui/themes', '/home')
  expect(listing).toContain('- nord (yours, in use): mine')
  expect(listing).toContain('- vscode\n')
  expect(listing).toContain('- solar (yours): not usable')
  expect(listing).toContain('~/.claude/cc-intelligent-ui/themes/<name>/theme.json')
  // Shown as Markdown: a line that starts with `* ` would turn into a bullet.
  expect(listing.split('\n').some(l => l.startsWith('* '))).toBe(false)
})

test('a missing theme falls back to the base theme, even before it is on disk', () => {
  const { themes } = pickThemes([themeEntry('nord', '/u/nord', true, '{}')])
  expect(chooseTheme(themes, 'nord', '/mod')).toEqual({ name: 'nord', dir: '/u/nord', isFallback: false })
  expect(chooseTheme(themes, 'gone', '/mod')).toEqual({ name: BASE_THEME, dir: `/mod/render/themes/${BASE_THEME}`, isFallback: true })
  expect(chooseTheme(themes, BASE_THEME, '/mod')).toMatchObject({ name: BASE_THEME, isFallback: false })
})

test('a missing theme falls back to the default theme when it is there', () => {
  const { themes } = pickThemes([
    themeEntry(BASE_THEME, `/mod/render/themes/${BASE_THEME}`, false, '{}'),
    themeEntry(DEFAULT_THEME, `/mod/render/themes/${DEFAULT_THEME}`, false, '{}'),
  ])
  expect(DEFAULT_THEME).toBe('claude-code')
  expect(chooseTheme(themes, 'gone', '/mod')).toEqual({ name: DEFAULT_THEME, dir: `/mod/render/themes/${DEFAULT_THEME}`, isFallback: true })
  expect(chooseTheme(themes, DEFAULT_THEME, '/mod')).toMatchObject({ name: DEFAULT_THEME, isFallback: false })
  expect(chooseTheme(themes, BASE_THEME, '/mod')).toMatchObject({ name: BASE_THEME, isFallback: false })
})

test('the picture key changes with the theme, its folder and its files', () => {
  const base = {
    textHash: 'abc', columns: 98, cell: { width: 16, height: 32 }, size: 100, mode: 'dark' as const,
    termFont: 'MesloLGS NF', columnPt: 6.6, templateStamp: '1',
    look: { name: 'vscode', dir: '/mod/render/themes/vscode', stamp: '1,2,3,1,2,3' },
  }
  const key = renderKey(base)
  expect(renderKey({ ...base })).toBe(key)
  expect(renderKey({ ...base, look: { ...base.look, name: 'nord' } })).not.toBe(key)
  expect(renderKey({ ...base, look: { ...base.look, dir: '/u/vscode' } })).not.toBe(key)
  expect(renderKey({ ...base, look: { ...base.look, stamp: '1,2,4,1,2,3' } })).not.toBe(key)
  expect(renderKey({ ...base, mode: 'light' })).not.toBe(key)
})

test('a theme names its syntax files inside its own folder', () => {
  expect(themeEntry('a', '/u/a', true, '{"syntax":{"dark":"d.tmTheme","light":"sub/l.tmTheme"}}')).toMatchObject({
    syntax: { dark: 'd.tmTheme', light: 'sub/l.tmTheme' },
  })
  expect(themeEntry('a', '/u/a', true, '{"syntax":{"dark":"d.tmTheme"}}')).toMatchObject({ syntax: { dark: 'd.tmTheme' } })
  for (const bad of ['"x"', '[]', '{"dark":3}', '{"dark":"../x.tmTheme"}', '{"light":"/etc/x.tmTheme"}', '{"dark":""}', '{"dark":"a/../../b"}']) {
    expect('reason' in themeEntry('a', '/u/a', true, `{"syntax":${bad}}`)).toBe(true)
  }
  expect(isSyntaxPath('./dark.tmTheme')).toBe(true)
  expect(isSyntaxPath('..x.tmTheme')).toBe(true)
})

test('the stamp follows the syntax files a theme really uses', () => {
  const vscode = themeEntry('vscode', '/mod/render/themes/vscode', false, '{"syntax":{"dark":"dark.tmTheme","light":"light.tmTheme"}}') as any
  const modern = themeEntry('vscode-modern', '/mod/render/themes/vscode-modern', false, '{}') as any
  const half = themeEntry('half', '/u/half', true, '{"syntax":{"light":"mine.tmTheme"}}') as any
  expect(themeFiles(vscode, vscode, '/mod')).toEqual([
    '/mod/render/themes/vscode/theme.json', '/mod/render/themes/vscode/theme.json',
    '/mod/render/themes/vscode/dark.tmTheme', '/mod/render/themes/vscode/light.tmTheme',
  ])
  expect(themeFiles(modern, vscode, '/mod')).toEqual([
    '/mod/render/themes/vscode-modern/theme.json', '/mod/render/themes/vscode/theme.json',
    '/mod/render/themes/vscode/dark.tmTheme', '/mod/render/themes/vscode/light.tmTheme',
  ])
  expect(themeFiles(half, vscode, '/mod').slice(2)).toEqual(['/mod/render/themes/vscode/dark.tmTheme', '/u/half/mine.tmTheme'])
  expect(themeFiles(undefined, undefined, '/mod')[2]).toBe('/mod/render/themes/vscode/dark.tmTheme')
})

test('the font measure reads the active theme, with the root at /', () => {
  const argv = measureCall('typst', '/mod', 'MesloLGS NF', '/u/nord')
  expect(argv.slice(0, 5)).toEqual(['typst', 'eval', 'query(<m>).first().value', '--in', '/mod/render/measure.typ'])
  expect(argv[argv.indexOf('--root') + 1]).toBe('/')
  expect(argv).toContain('theme-dir=/u/nord')
  expect(argv).toContain('term-font=MesloLGS NF')
})

test('the Claude Code theme setting is fixed light, fixed dark, or auto', () => {
  for (const v of ['light', 'light-daltonized', 'light-ansi']) expect(settingOf(v)).toBe('light')
  for (const v of ['dark', 'dark-daltonized', 'dark-ansi', undefined, '', true]) expect(settingOf(v)).toBe('dark')
  for (const v of ['auto', 'system', 'something-new']) expect(settingOf(v)).toBe('auto')
})

test('the OS appearance is read from macOS, GNOME and COLORFGBG', () => {
  expect(modeOfMacAppearance(0, 'Dark\n')).toBe('dark')
  expect(modeOfMacAppearance(1, '')).toBe('light')
  expect(modeOfMacAppearance(0, '')).toBe('light')
  expect(modeOfGnome("'prefer-dark'\n")).toBe('dark')
  expect(modeOfGnome("'prefer-light'")).toBe('light')
  expect(modeOfGnome("'default'")).toBe('light')
  expect(modeOfGnome('No such key')).toBe(null)
  expect(modeOfColorFgBg('15;0')).toBe('dark')
  expect(modeOfColorFgBg('0;15')).toBe('light')
  expect(modeOfColorFgBg('0;default;7')).toBe('light')
  expect(modeOfColorFgBg('7;8')).toBe('dark')
  expect(modeOfColorFgBg('0;11')).toBe(null)
  expect(modeOfColorFgBg('')).toBe(null)
  expect(modeOfColorFgBg(undefined)).toBe(null)
})

test("iTerm2's appearance and its profile's background give the mode", () => {
  expect(itermAppearanceOf('1\n')).toBe('dark')
  expect(itermAppearanceOf('3')).toBe('dark')
  expect(itermAppearanceOf('0')).toBe('light')
  expect(itermAppearanceOf('2')).toBe('light')
  for (const v of ['4', '5', '6', '']) expect(itermAppearanceOf(v)).toBe(null)
  const dark = { 'Red Component': 0.11, 'Green Component': 0.15, 'Blue Component': 0.17 }
  const white = { 'Red Component': 1, 'Green Component': 1, 'Blue Component': 1 }
  const marks = JSON.stringify([
    { Name: 'Default', Guid: 'G1', 'Use Separate Colors for Light and Dark Mode': true, 'Background Color': dark, 'Background Color (Dark)': dark, 'Background Color (Light)': white },
    { Name: 'Paper', Guid: 'G2', 'Background Color': white },
  ])
  // Separate colours: the set for iTerm2's appearance (the OS's, when it follows it).
  expect(itermModeOf(marks, 'Default', 'G1', 'dark')).toBe('dark')
  expect(itermModeOf(marks, 'Default', 'G1', 'light')).toBe('light')
  expect(itermModeOf(marks, 'Default', 'G1', null)).toBe(null)
  // One set of colours: the appearance does not matter.
  expect(itermModeOf(marks, 'Paper', 'G1', 'dark')).toBe('light')
  expect(itermModeOf(marks, undefined, 'G2\n', null)).toBe('light')
  expect(itermModeOf(marks, 'Gone', 'nope', 'dark')).toBe(null)
  expect(itermModeOf('not json', 'Default', 'G1', 'dark')).toBe(null)
})

test("Ghostty's background comes from its config, its theme, or its default", () => {
  expect(hexColorOf('#282c34')).toEqual({ r: 0x28 / 255, g: 0x2c / 255, b: 0x34 / 255 })
  expect(hexColorOf('FFFFFF')).toEqual({ r: 1, g: 1, b: 1 })
  expect(hexColorOf('black')).toBe(null)
  expect(ghosttyValueOf('background = #111111\nfont-family = "A B"\nbackground = #222222', 'background')).toBe('#222222')
  expect(ghosttyValueOf('font-family = "A B"', 'font-family')).toBe('A B')
  expect(ghosttyValueOf('', 'theme')).toBe('')
  expect(ghosttyThemesOf('light:3024 Day,dark:Rose Pine')).toEqual({ light: '3024 Day', dark: 'Rose Pine' })
  expect(ghosttyThemesOf(' dark: Rose Pine , light: Rose Pine Dawn ')).toEqual({ light: 'Rose Pine Dawn', dark: 'Rose Pine' })
  expect(ghosttyThemesOf('Rose Pine')).toBe(null)
  expect(ghosttyThemesOf('light:Only')).toBe(null)
  const where = { home: '/h', resources: '/R' }
  expect(ghosttyThemePaths('Nord', where)).toEqual([
    '/h/.config/ghostty/themes/Nord', '/h/Library/Application Support/com.mitchellh.ghostty/themes/Nord', '/R/themes/Nord',
    '/Applications/Ghostty.app/Contents/Resources/ghostty/themes/Nord', '/usr/share/ghostty/themes/Nord', '/usr/local/share/ghostty/themes/Nord',
  ])
  expect(ghosttyThemePaths('Nord', { ...where, xdgConfig: '/x' })[0]).toBe('/x/ghostty/themes/Nord')
  expect(ghosttyThemePaths('/t/Mine', where)).toEqual(['/t/Mine'])
  expect(ghosttyThemePaths('~/t/Mine', where)).toEqual(['/h/t/Mine'])
  // No theme, no background: the default. A single theme: show-config merged it in.
  expect(ghosttyBackgroundOf('font-size = 13', null, {})).toBe(GHOSTTY_DEFAULT_BG)
  expect(ghosttyBackgroundOf('theme = Rose Pine Dawn\nbackground = #faf4ed', null, {})).toBe('#faf4ed')
  // light:A,dark:B: the shown background is one theme's; the OS picks the theme.
  const pair = 'theme = light:3024 Day,dark:Rose Pine\nbackground = #f7f7f7'
  const bgs = { light: '#f7f7f7', dark: '#191724' }
  expect(ghosttyBackgroundOf(pair, 'dark', bgs)).toBe('#191724')
  expect(ghosttyBackgroundOf(pair, 'light', bgs)).toBe('#f7f7f7')
  expect(ghosttyBackgroundOf(pair, null, bgs)).toBe(null)
  // A background of the config's own wins over both themes.
  expect(ghosttyBackgroundOf('theme = light:3024 Day,dark:Rose Pine\nbackground = #112233', 'light', bgs)).toBe('#112233')
})

test('auto draws as the OS is; a fixed setting ignores the OS', () => {
  const lightMac = { mode: 'light' as const, source: 'macOS' as const }
  expect(resolveMode('auto', lightMac)).toBe('light')
  expect(resolveMode('auto', null)).toBe('dark')
  expect(resolveMode('dark', lightMac)).toBe('dark')
  expect(resolveMode('light', null)).toBe('light')
  expect(modeLine('light', 'auto', 'auto', lightMac)).toBe('mode light (auto, from macOS)')
  expect(modeLine('dark', 'auto', 'auto', null)).toBe('mode dark (auto, OS appearance not known, dark assumed)')
  expect(modeLine('dark', 'dark', 'dark-ansi', null)).toBe('mode dark (Claude Code theme dark-ansi)')
})

test('the iTerm2 profile for the font is the one ITERM_PROFILE names, else the default one', () => {
  const marks = [{ Name: 'Default', Guid: 'G1' }, { Name: 'tmux', Guid: 'G2' }, 'not a profile']
  expect(pickProfile(marks, 'tmux', 'G1')?.Guid).toBe('G2')
  expect(pickProfile(marks, 'gone', 'G1')?.Name).toBe('Default')
  expect(pickProfile(marks, undefined, ' G2\n')?.Name).toBe('tmux')
  expect(pickProfile(marks, 'gone', 'G9')).toBe(null)
})

test("the terminal's OSC 11 answer is read with BEL or ST and 1-4 hex digits", () => {
  expect(parseOsc11('\x1b]11;rgb:ffff/ffff/ffff\x07')).toEqual({ r: 1, g: 1, b: 1 })
  expect(parseOsc11('\x1b]11;rgb:28/2c/34\x1b\\')).toEqual({ r: 0x28 / 255, g: 0x2c / 255, b: 0x34 / 255 })
  expect(parseOsc11('junk\x1b]11;rgb:1d1d/2525/2a2a\x07more')).toEqual({ r: 0x1d1d / 65535, g: 0x2525 / 65535, b: 0x2a2a / 65535 })
  expect(parseOsc11('\x1b]11;rgb:f/0/8\x07')).toEqual({ r: 1, g: 0, b: 8 / 15 })
  expect(parseOsc11('\x1b]11;rgba:ffff/ffff/ffff/ffff\x07')).toEqual({ r: 1, g: 1, b: 1 })
  for (const bad of ['', 'rgb:ffff/ffff/ffff', '\x1b]11;rgb:ffff/ffff\x07', '\x1b]11;rgb:fffff/0/0\x07', '\x1b]11;rgb:ffff/ffff/ffff', '\x1b]10;rgb:ffff/ffff/ffff\x07']) {
    expect(parseOsc11(bad)).toBe(null)
  }
})

test('luminance gives the mode: light above 0.4', () => {
  const near1 = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-3)
  near1(luminanceOf({ r: 1, g: 1, b: 1 }), 1)
  near1(luminanceOf({ r: 0.5, g: 0.5, b: 0.5 }), 0.214)
  expect(modeOfLuminance(luminanceOf(parseOsc11('\x1b]11;rgb:ffff/ffff/ffff\x07')!))).toBe('light')
  expect(modeOfLuminance(luminanceOf(parseOsc11('\x1b]11;rgb:1d1d/2525/2a2a\x07')!))).toBe('dark')
  expect(modeOfLuminance(luminanceOf({ r: 0.75, g: 0.75, b: 0.75 }))).toBe('light')
})

test('the probe output is shown with its control characters spelled out', () => {
  expect(escapeControls('\x1b]11;rgb:ffff/ffff/ffff\x07')).toBe('\\e]11;rgb:ffff/ffff/ffff\\a')
  expect(escapeControls('a\x1b\\\x01')).toBe('a\\e\\\\x01')
  expect(OSC11_PL).toContain('O_NONBLOCK')
  expect(OSC11_PL).not.toContain('stty')
})

// ---- The room of a picture ----------------------------------------------------

test('a box wider than its room is drawn at the room, the aspect kept; a box that fits is never grown', () => {
  expect(fitBox({ columns: 211, rows: 40 }, 118)).toEqual({ columns: 118, rows: 22 })
  expect(fitBox({ columns: 200, rows: 1 }, 50)).toEqual({ columns: 50, rows: 1 })
  expect(fitBox({ columns: 98, rows: 12 }, 118)).toEqual({ columns: 98, rows: 12 })
  expect(fitBox({ columns: 118, rows: 12 }, 118)).toEqual({ columns: 118, rows: 12 })
})

test('the bullet row scales with the page; at factor 1 it stays', () => {
  expect(scaledBulletRow(0, 0.5)).toBe(0)
  expect(scaledBulletRow(2, 1)).toBe(2)
  expect(scaledBulletRow(2, 0.56)).toBe(1)
  expect(scaledBulletRow(3, 0.5)).toBe(1)
})

test('a picture of the target always fits the room of the same viewport', () => {
  for (const columns of [10, 22, 60, 100, 120, 213, 257, 300, 400]) {
    for (const width of ['full', 40, 100, 160] as const) {
      const frame = composeFrame(null, { columns, rows: 40 })
      expect(columnsFor(frame.columns, width)).toBeLessThanOrEqual(roomColumns({ columns }))
      expect(pictureColumns(frame, true)).toBeLessThanOrEqual(roomColumns({ columns }))
    }
  }
})

// ---- Markdown blocks and text ------------------------------------------------

test('a ~~~ fence is a block; a closing mark needs the same char, as many marks, and nothing after it', () => {
  const tilde = blocksOf('~~~sh\nls\n~~~')
  expect(tilde).toEqual([{ lines: ['~~~sh', 'ls', '~~~'], fence: { mark: '~~~', info: 'sh' } }])
  // A ``` line in a ~~~ fence, a shorter mark and a mark with an info do not close it.
  const open = ['````md', '```', 'x', '```js', '````'].join('\n')
  expect(blocksOf(`${open}\n\nAfter`).map(b => b.lines.length)).toEqual([5, 1])
  expect(blocksOf('~~~\n```\n~~~').length).toBe(1)
})

test('a fence that never closes runs to the end of the text', () => {
  const blocks = blocksOf('Intro\n\n```js\na()\n\nb()')
  expect(blocks.length).toBe(2)
  expect(blocks[1]!.lines).toEqual(['```js', 'a()', '', 'b()'])
})

test('an indented fence stays in its list item; a fence at the margin is a block of its own', () => {
  const item = blocksOf('- item\n  ```js\n  x\n\n  y\n  ```\n- next')
  expect(item.length).toBe(1)
  expect(item[0]!.fence).toBe(undefined)
  expect(item[0]!.lines.length).toBe(7)
  expect(blocksOf('text\n```\nx\n```\nmore').map(b => !!b.fence)).toEqual([false, true, false])
})

test('a $$ math block keeps its blank lines and is marked', () => {
  const blocks = blocksOf('$$\na = 1\n\nb = 2\n$$\n\nAfter')
  expect(blocks.length).toBe(2)
  expect(blocks[0]).toEqual({ lines: ['$$', 'a = 1', '', 'b = 2', '$$'], isMath: true })
  expect(blocks[1]!.isMath).toBe(undefined)
})

test('line ends of any kind (CRLF, CR) give the same blocks as LF', () => {
  const lf = blocksOf('a\nb\n\nc')
  expect(blocksOf('a\r\nb\r\n\r\nc')).toEqual(lf)
  expect(blocksOf('a\rb\r\rc')).toEqual(lf)
  expect(blocksOf('')).toEqual([])
})

test('a typst info is typst or typ in any case, nothing longer', () => {
  for (const info of ['typst', 'typ', 'Typst', 'TYP']) expect(isTypstInfo(info)).toBe(true)
  for (const info of ['', 'typescript', 'typst2', 'ty']) expect(isTypstInfo(info)).toBe(false)
})

test('rows of a block: a heading of level 1 or 2 takes more; code rows are shorter than text rows; size scales it', () => {
  const rows = (md: string, size?: number) => rowsOfBlock(blocksOf(md)[0]!, 100, size)
  near(rows('text'), 1 + 1.3)
  near(rows('# Title'), 1 + 1.3 + 1.5)
  near(rows('## Title'), rows('# Title'))
  near(rows('### Title'), rows('text'))
  near(rows('```\nx\n```'), 1 + 3 * 1.1)
  near(rows('text', 200), 1 + 1.3 * 2)
  // An empty line counts as one character, so it takes a row.
  near(rowsOfBlock({ lines: ['', ''] }, 100), 1 + 2 * 1.3)
})

test('a long line wraps into rows at the column count', () => {
  const rows = (n: number, columns: number) => rowsOfBlock({ lines: ['x'.repeat(n)] }, columns)
  expect(rows(114, 100)).toBe(1 + 1.3)
  expect(rows(116, 100)).toBe(1 + 2 * 1.3)
  expect(rows(116, 50)).toBe(1 + 3 * 1.3)
})

test('a short code fence of 2 lines is not cut, however long its lines', () => {
  const md = `${'x'.repeat(5000)}\n\n\`\`\`\n\`\`\``
  expect(splitSegments(md, 80, 5).join('').includes('```\n```')).toBe(true)
  expect(splitSegments(`\`\`\`\n${'x'.repeat(5000)}\n\`\`\``, 80, 5)[0]!.startsWith('```\n')).toBe(true)
})

test('footnotes in a code fence do not join the answer; link definitions in a fence are not repeated', () => {
  const long = Array.from({ length: 120 }, (_, i) => para(i)).join('\n\n')
  expect(splitSegments(`${long}\n\n\`\`\`md\n[^1]: A note.\n\`\`\``, 80).length).toBeGreaterThan(1)
  const segments = splitSegments(`${long}\n\n\`\`\`md\n[docs]: https://example.com\n\`\`\``, 80)
  expect(segments.filter(s => s.endsWith('[docs]: https://example.com\n```')).length).toBe(1)
  expect(segments.every(s => !s.endsWith('\n\n'))).toBe(true)
})

test('a link definition already in a segment is not added to it again', () => {
  const long = Array.from({ length: 120 }, (_, i) => para(i)).join('\n\n')
  const segments = splitSegments(`${long}\n\n[docs]: https://example.com`, 80)
  for (const s of segments) expect(s.split('[docs]: https://example.com').length - 1).toBe(1)
})

test('images: angle brackets, a title, several on a line, and URLs with a scheme other than file are not local', () => {
  expect(localImages('![a](<a.png>) ![b](c.png "t")')).toEqual(['a.png', 'c.png'])
  expect(localImages('![](data:image/png;base64,AA) ![](http://x/y.png) ![](FILE:///a.png)')).toEqual(['FILE:///a.png'])
  expect(localImages('![x](~~~)\n~~~\n![y](z.png)\n~~~\n![w](w.png)')).toEqual(['~~~', 'w.png'])
  expect(imagePathOf('  a.png ', '/repo//')).toBe('/repo/a.png')
  expect(imagePathOf('FILE:///a%20b.png', '/repo')).toBe('/a b.png')
})

test('the alt: an image gives its alt, a fence line is dropped, quotes, numbers and tags are stripped, and a long text ends with …', () => {
  expect(plainOf('![a chart](x.png) and [a link](u)')).toBe('a chart and a link')
  expect(plainOf('```js\ncode()\n```')).toBe('code()')
  expect(plainOf('> quote\n\n1. one\n2) two\n\n<b>tag</b>')).toBe('quote one two tag')
  expect(plainOf('~~gone~~ __x__ | a | b |')).toBe('gone x a b')
  expect(plainOf('abcdefghij', 5)).toBe('abcd…')
  expect(plainOf('abcde', 5)).toBe('abcde')
  expect(plainOf('```\n```')).toBe(' ')
})

test('the first line is the first line with text, trimmed', () => {
  expect(firstLine('\n  \n  Hello  \nWorld')).toBe('Hello')
  expect(firstLine('')).toBe('')
  expect(firstLine(' \n\t')).toBe('')
})

test('a text with an image in a fence only does not need the room; a typst fence with ~~~ does', () => {
  expect(needsRoom('```md\n![x](a.png)\n```')).toBe(false)
  expect(needsRoom('~~~typst\n#circle()\n~~~')).toBe(true)
  expect(needsRoom('```typescript\nx\n```')).toBe(false)
})

// ---- Settings text and the grid numbers --------------------------------------

test('the settings as words', () => {
  expect(widthText('full')).toBe('full (the terminal width)')
  expect(widthText(120)).toBe('120 columns')
  expect(heightText('half')).toBe('half (half the terminal, 6 to 24 rows)')
  expect(heightText('full')).toBe('full (the terminal height less 16 rows)')
  expect(heightText(30)).toBe('30 rows')
  expect(gridText(true)).toBe('on (each line of text on whole terminal rows)')
  expect(gridText(false)).toBe('off')
})

test('a grid number must be a finite number of 0 or more; the code size must be over 0', () => {
  const ok = {
    body: 1, heading: [1, 1, 1, 1, 1, 1], code: 1, 'code-size': 1, pad: { quote: 0, code: 0, table: 0 }, 'table-style': 'rules',
  }
  expect(gridOf(ok)).not.toBe(null)
  expect(gridOf({ ...ok, body: -1 })).toBe(null)
  expect(gridOf({ ...ok, body: NaN })).toBe(null)
  expect(gridOf({ ...ok, code: Infinity })).toBe(null)
  expect(gridOf({ ...ok, heading: [1, 1, 1, 1, 1, -1] })).toBe(null)
  expect(gridOf({ ...ok, heading: [1, 1, 1, 1, 1, 1, 1] })).toBe(null)
  expect(gridOf({ ...ok, 'code-size': 0 })).toBe(null)
  expect(gridOf({ ...ok, 'code-size': undefined })).toBe(null)
  expect(gridOf({ ...ok, pad: undefined })).toBe(null)
  expect(gridOf({ ...ok, pad: { ...ok.pad, table: -1 } })).toBe(null)
  expect(gridOf(null)).toBe(null)
  expect(gridOf('grid')).toBe(null)
})

test('grid rows: at least 1, and a small excess over whole rows is not a row', () => {
  expect(gridRowsOf(0, 10)).toBe(1)
  expect(gridRowsOf(10, 10)).toBe(1)
  expect(gridRowsOf(10.0009, 10)).toBe(1)
  expect(gridRowsOf(10.1, 10)).toBe(2)
  expect(gridRowsOf(25, 10)).toBe(3)
})

// ---- Themes ------------------------------------------------------------------

test('a theme name and description that are not strings are empty; the title is the folder name then', () => {
  expect(themeEntry('t', '/u/t', true, '{"name":3,"description":null}')).toMatchObject({ title: 't', description: '' })
  expect(themeEntry('t', '/u/t', true, '{"name":""}')).toMatchObject({ title: 't' })
})

test('a theme folder name with a bad character gives a reason; "syntax": null is not an object', () => {
  expect(themeEntry('a b', '/u/a b', false, '{}')).toEqual({
    name: 'a b', dir: '/u/a b', isUser: false, reason: 'the folder name has characters other than letters, digits, ., _ and -',
  })
  expect(themeEntry('a', '/u/a', true, '{"syntax":null}')).toMatchObject({ reason: '"syntax" is not an object of file names' })
  expect(themeEntry('a', '/u/a', true, '{"syntax":{"dark":"../x"}}')).toMatchObject({ reason: expect.stringContaining('"syntax.dark"') })
  expect(themeEntry('a', '/u/a', true, '{"syntax":{"sepia":"x.tmTheme"}}')).toMatchObject({ syntax: {} })
})

test('a syntax path is a non-empty relative name inside the folder', () => {
  for (const bad of [undefined, null, 3, '', '  ', '/x', '..', 'a/../b', 'a\\b']) expect(isSyntaxPath(bad)).toBe(false)
  for (const ok of ['x.tmTheme', 'sub/x.tmTheme', 'a..b']) expect(isSyntaxPath(ok)).toBe(true)
})

test('the theme names: a letter or digit first, then letters, digits, ., _ and -', () => {
  for (const ok of ['a', '9', 'Sun.Light', 'a_b-c']) expect(isThemeName(ok)).toBe(true)
  for (const bad of ['', '-a', '_a', 'a b', 'a/b', 'é']) expect(isThemeName(bad)).toBe(false)
})

test('the theme list is sorted by name, tells when there are none, and shows the folder as given without a home', () => {
  const { themes, problems } = pickThemes([themeEntry('b', '/m/b', false, '{}'), themeEntry('a', '/m/a', false, '{"description":"first"}')])
  const lines = themeListing(themes, problems, 'zzz', '/u/themes').split('\n')
  expect(lines).toEqual(['Themes:', '- a: first', '- b', '', 'Change it with /iui theme <name>. Your own themes go in /u/themes/<name>/theme.json.'])
  expect(themeListing(new Map(), [], 'x', '/u/themes')).toContain('Themes:\n- none found\n')
  expect(themeListing(new Map(), [], 'x', '/home/me/t', '/home/me')).toContain('~/t/<name>/theme.json')
  expect(themeListing(new Map(), [], 'x', '/homer/t', '/home')).toContain('/homer/t/')
  expect(themeListing(new Map(), [{ name: 'p', dir: '/m/p', isUser: false, reason: 'bad' }], 'x', '/u')).toContain('- p: not usable, bad')
})

test('a built-in problem is listed without "(yours)"; a user theme of the base name does not replace the base for the fallback', () => {
  const { themes, problems } = pickThemes([
    themeEntry('x', '/m/x', false, '[]'),
    themeEntry(BASE_THEME, '/u/vscode', true, '{}'),
  ])
  expect(problems.map(p => p.name)).toEqual(['x'])
  expect(chooseTheme(themes, 'gone', '/mod')).toEqual({ name: BASE_THEME, dir: '/u/vscode', isFallback: true })
})

test('the stamp files: a base theme with its own syntax files is used for a mode the theme does not name', () => {
  const base = themeEntry('vscode', '/mod/render/themes/vscode', false, '{"syntax":{"dark":"d2.tmTheme"}}') as any
  const own = themeEntry('own', '/u/own', true, '{}') as any
  expect(themeFiles(own, base, '/mod')).toEqual([
    '/u/own/theme.json', '/mod/render/themes/vscode/theme.json', '/mod/render/themes/vscode/d2.tmTheme', '/mod/render/themes/vscode/light.tmTheme',
  ])
})

test('the room is the smaller of the viewport and the tty, less the bullet; one of them alone is used', () => {
  const saved = { tty: S.tty, view: S.viewColumns, frame: S.frame }
  try {
    S.frame = null
    S.viewColumns = null
    S.tty = null
    expect(roomColumns({ columns: 100 })).toBe(98)
    S.tty = { columns: 80, rows: 24, cell: { width: 16, height: 32 } } as any
    expect(roomColumns({ columns: 100 })).toBe(78)
    expect(roomColumns({ columns: 60 })).toBe(58)
    expect(roomColumns(null)).toBe(78)
    S.viewColumns = 70
    expect(roomColumns()).toBe(68)
  } finally {
    S.tty = saved.tty
    S.viewColumns = saved.view
    S.frame = saved.frame
  }
})

test('typst gets no network in either case of the proxy variables, and its package cache; fonts only when set', () => {
  const saved = S.fontPaths
  try {
    S.fontPaths = ''
    const env = noNetworkEnv('/c')
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) expect(env[k]).toBe('http://127.0.0.1:9')
    expect(env.NO_PROXY).toBe('')
    expect(env.no_proxy).toBe('')
    expect(env.TYPST_PACKAGE_CACHE_PATH).toBe('/c/pkg-cache')
    expect('TYPST_FONT_PATHS' in env).toBe(false)
    S.fontPaths = '/f1:/f2'
    expect(noNetworkEnv('/c').TYPST_FONT_PATHS).toBe('/f1:/f2')
  } finally {
    S.fontPaths = saved
  }
})
