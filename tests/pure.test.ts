import { expect, test } from 'claude-code/testing'

import {
  alignFirstLine, DEFAULT_METRICS, DEFAULT_SIZE, firstLineOf, fontFit, ghosttyFontOf, itermFontOf, parseCommand, parseFontSpec, typstCall,
  blocksOf, canDrawIn, columnsFor, DEFAULT_CELL, hashOf, imagePathOf, isSet, localImages, DEFAULT_WIDTH, IMAGE_MAX_COLUMNS,
  parseOd, plainOf, pngSize, shouldRetrySafe, sizeOf, sizing, splitSegments, themeOf, TYPST_PROMPT,
  escapeControls, luminanceOf, modeOfLuminance, OSC11_PL, parseOsc11, pickProfile, itermAppearanceOf, itermModeOf,
  GHOSTTY_DEFAULT_BG, ghosttyBackgroundOf, ghosttyThemePaths, ghosttyThemesOf, ghosttyValueOf, hexColorOf,
  modeLine, modeOfColorFgBg, modeOfGnome, modeOfMacAppearance, resolveMode, settingOf,
  BASE_THEME, DEFAULT_THEME, chooseTheme, isSyntaxPath, isThemeName, measureCall, pickThemes, renderKey, themeEntry, themeFiles, themeListing,
  needsRoom, nextJob, pageRowsOf, resultOf, roomInputs, splitInTwo,
  composeFrame, fitBox, pictureColumns, roomColumns, scaledBulletRow,
} from '../hooks/register'
import { wrapPid } from '../hooks/lib/typst'

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

test('the width command: a value of 40 to 400, full, or nothing to show it', () => {
  expect(parseCommand('width')).toEqual({ kind: 'width' })
  expect(parseCommand('width full')).toEqual({ kind: 'width', width: 'full' })
  expect(parseCommand('WIDTH Full')).toEqual({ kind: 'width', width: 'full' })
  expect(parseCommand('width 40')).toEqual({ kind: 'width', width: 40 })
  expect(parseCommand('width 160')).toEqual({ kind: 'width', width: 160 })
  expect(parseCommand('width 400')).toEqual({ kind: 'width', width: 400 })
  expect(parseCommand('width 39')).toEqual({ kind: 'bad' })
  expect(parseCommand('width 401')).toEqual({ kind: 'bad' })
  expect(parseCommand('width 12.5')).toEqual({ kind: 'bad' })
  expect(parseCommand('width wide')).toEqual({ kind: 'bad' })
  expect(parseCommand('width 120 full')).toEqual({ kind: 'bad' })
})

test('the size command takes 80 to 200 percent', () => {
  expect(parseCommand('')).toEqual({ kind: 'show' })
  expect(parseCommand(' on ')).toEqual({ kind: 'on' })
  expect(parseCommand('OFF')).toEqual({ kind: 'off' })
  expect(parseCommand('size 130')).toEqual({ kind: 'size', percent: 130 })
  expect(parseCommand('size 80%')).toEqual({ kind: 'size', percent: 80 })
  expect(parseCommand('size 200')).toEqual({ kind: 'size', percent: 200 })
  expect(parseCommand('size 79')).toEqual({ kind: 'bad' })
  expect(parseCommand('size 201')).toEqual({ kind: 'bad' })
  expect(parseCommand('size')).toEqual({ kind: 'bad' })
  expect(parseCommand('size big')).toEqual({ kind: 'bad' })
  expect(parseCommand('bigger')).toEqual({ kind: 'bad' })
  expect(parseCommand('probe')).toEqual({ kind: 'probe' })
  expect(parseCommand('details')).toEqual({ kind: 'details' })
  expect(parseCommand('probe 3')).toEqual({ kind: 'bad' })
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
  expect(TYPST_PROMPT.includes('$math$ (LaTeX)')).toBe(true)
  expect(TYPST_PROMPT.includes('theme.code-bg')).toBe(true)
  expect(TYPST_PROMPT.endsWith('keep replies readable as plain text too.')).toBe(true)
})


test('the theme command lists, or switches to a name kept as typed', () => {
  expect(parseCommand('theme')).toEqual({ kind: 'theme' })
  expect(parseCommand('THEME')).toEqual({ kind: 'theme' })
  expect(parseCommand('theme vscode')).toEqual({ kind: 'theme', name: 'vscode' })
  expect(parseCommand('theme My.Dark_Theme-2')).toEqual({ kind: 'theme', name: 'My.Dark_Theme-2' })
  expect(parseCommand('theme a b')).toEqual({ kind: 'bad' })
  expect(parseCommand('theme ../up')).toEqual({ kind: 'bad' })
  expect(parseCommand('theme a/b')).toEqual({ kind: 'bad' })
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
    themeEntry('nord', '/home/.claude/intelligent-ui/themes/nord', true, '{"description":"mine"}'),
    themeEntry('vscode', '/mod/render/themes/vscode', false, '{"name":"VS Code"}'),
    themeEntry('nord', '/mod/render/themes/nord', false, '{"description":"built-in"}'),
    themeEntry('vscode', '/home/.claude/intelligent-ui/themes/vscode', true, '{not json'),
    themeEntry('solar', '/home/.claude/intelligent-ui/themes/solar', true, '[1]'),
  ]
  const { themes, problems } = pickThemes(found)
  expect([...themes.keys()].sort()).toEqual(['nord', 'vscode'])
  expect(themes.get('nord')).toMatchObject({ isUser: true, description: 'mine' })
  expect(themes.get('vscode')).toMatchObject({ isUser: false, dir: '/mod/render/themes/vscode' })
  expect(problems.map(p => p.name).sort()).toEqual(['solar', 'vscode'])
  const listing = themeListing(themes, problems, 'nord', '/home/.claude/intelligent-ui/themes')
  expect(listing).toContain('* nord (user): mine')
  expect(listing).toContain('- vscode (built-in)')
  expect(listing).toContain('skipped solar (user)')
  expect(listing).toContain('/home/.claude/intelligent-ui/themes/<name>/theme.json')
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
    '/Applications/Ghostty.app/Contents/Resources/ghostty/themes/Nord', '/usr/share/ghostty/themes/Nord',
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
