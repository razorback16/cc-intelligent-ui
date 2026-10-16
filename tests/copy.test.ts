import { expect, mock, test } from 'claude-code/testing'

import {
  codePointsOf, decodeSelection, DIACRITICS, hasPlaceholders, joinSegments, parseCommand, pickPages, placeholderCell, positionsOf, textOfRun,
  type Drawn, type TextBlock, type Item, type Mark,
} from '../hooks/register'
import { SMALL_MARKS, SMALL_MD, SMALL_PAGE, SMALL_PPI } from './copy-fixture'

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
const PAGE = { width: 100, height: 80, rows: 4 }
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
  expect(textOfRun([{ row: 0, colStart: 5, colEnd: 9 }], ITEMS, BLOCKS, PAGE, 10)).toBe('beta well-')
  expect(textOfRun([{ row: 0, colStart: 6, colEnd: 9 }], ITEMS, BLOCKS, PAGE, 10)).toBe('well-')
  // A line broken after a hyphen joins with no space; a new block is a new line with its prefix.
  expect(textOfRun([{ row: 0, colStart: 0, colEnd: 9 }, { row: 1, colStart: 0, colEnd: 9 }], ITEMS, BLOCKS, PAGE, 10)).toBe('alpha beta well-known\n- item')
})

test('code lines are cut by characters; table cells join with a tab', () => {
  expect(textOfRun([{ row: 2, colStart: 4, colEnd: 9 }], ITEMS, BLOCKS, PAGE, 10)).toBe('x = 1')
  expect(textOfRun([{ row: 2, colStart: 0, colEnd: 9 }, { row: 3, colStart: 0, colEnd: 9 }], ITEMS, BLOCKS, PAGE, 10)).toBe('let x = 1\nx++\nk\tv')
  // The two code lines lie in one row (y centres 50 and 55): both, one per line.
  expect(textOfRun([{ row: 2, colStart: 0, colEnd: 1 }], ITEMS, BLOCKS, PAGE, 10)).toBe('le\nx+')
})

// ---- Which page -------------------------------------------------------------

const drawn = (id: string, seq: number, rows: number[], columns = 80): Drawn => ({
  id, seq, columns, dir: `/c/${id}`, pages: rows.map((r, i) => ({ file: `/c/${id}/a-${i + 1}.png`, width: columns * 16, height: r * 32, rows: r })),
})

test('a run goes to the answer the selection names, else to the newest it fits', () => {
  const runs = decodeSelection([cells(2, 0, 50), cells(3, 0, 50)].join('\n'))
  const answers = [drawn('old', 1, [10]), drawn('new', 2, [10]), drawn('short', 3, [3])]
  expect(pickPages(runs, answers)).toEqual([{ id: 'new', page: 0 }])
  expect(pickPages(runs, answers, 'old')).toEqual([{ id: 'old', page: 0 }])
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

// ---- A real probe -----------------------------------------------------------

const REAL = positionsOf(SMALL_MARKS as unknown as Mark[], SMALL_PPI)
const ALL_COLUMNS = (row: number) => ({ row, colStart: 0, colEnd: 97 })

test("a real probe: the whole picture copies as the answer's text", () => {
  const all = Array.from({ length: SMALL_PAGE.rows }, (_, row) => ALL_COLUMNS(row))
  expect(textOfRun(all, REAL.pages[0]!, REAL.blocks, SMALL_PAGE, 98)).toBe(
    'Copy test\nThe quick brown fox jumps over the lazy dog, then keeps running across the wide green field until the well-known path ends.\n- first item\n- second item\necho hello world\nls -la',
  )
})

test('a real probe: a selection from mid-paragraph into the code block', () => {
  // Rows: heading 1, paragraph 4 and 5, items 8 and 9, code 12 and 14.
  const lines = [{ row: 4, colStart: 30, colEnd: 97 }, ...[5, 6, 7, 8, 9, 10, 11].map(ALL_COLUMNS), { row: 12, colStart: 0, colEnd: 14 }]
  expect(textOfRun(lines, REAL.pages[0]!, REAL.blocks, SMALL_PAGE, 98)).toBe(
    'the lazy dog, then keeps running across the wide green field until the well-known path ends.\n- first item\n- second item\necho hello ',
  )
  // Part of the second item: no prefix.
  expect(textOfRun([{ row: 9, colStart: 10, colEnd: 97 }], REAL.pages[0]!, REAL.blocks, SMALL_PAGE, 98)).toBe('item')
})

test('a real probe through the clipboard: decode, pick, read', () => {
  // "jumps" is columns 18-23, its centre in column 21.
  const clipboard = [cells(1, 0, 97, '⏺ '), '', cells(4, 0, 21)].join('\n')
  const segments = decodeSelection(clipboard)
  const answer = { id: 'r1', seq: 1, columns: 98, dir: '/c/k', pages: [{ file: '/c/k/a-1.png', ...SMALL_PAGE }] }
  const picks = pickPages(segments, [answer])
  expect(picks).toEqual([{ id: 'r1', page: 0 }, null, { id: 'r1', page: 0 }])
  const texts = segments.map((s, i) => (s.kind === 'image' && picks[i] ? textOfRun(s.lines, REAL.pages[0]!, REAL.blocks, SMALL_PAGE, 98) : null))
  expect(joinSegments(segments, texts)).toBe('Copy test\n\nThe quick brown fox jumps')
})

// ---- The command ------------------------------------------------------------

test('/md-preview grab and dump are commands; dump with nothing seen says so', async $ => {
  expect(parseCommand('grab')).toEqual({ kind: 'grab' })
  expect(parseCommand('dump')).toEqual({ kind: 'dump' })
  const ran = await $.command.run({ command: 'md-preview', args: 'dump' } as any)
  expect(ran.text).toContain('no clipboard text with picture cells seen yet')
})

// ---- The clipboard watcher --------------------------------------------------

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
// The first 24 bytes of a 1568 x 512 PNG (the fixture's page), as `od` prints them.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 20 00 00 02 00'

test('a mouse copy of a drawn answer is read from the clipboard and written back as text, once', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  const files = new Map<string, string>()
  let clipboard = 'nothing yet'
  let pastes = 0
  const copies: string[] = []
  const toasts: string[] = []
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (/md-preview-/.test(cmd)) return ok('/c\nDarwin\n')
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'compile') return ok('')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'query') {
      expect(argv).toContain('probe=1')
      expect(argv.slice(-3)).toEqual(['<mdpos>', '--field', 'value'])
      return ok(JSON.stringify(SMALL_MARKS))
    }
    if (cmd.includes('od -An')) return ok(`${HEAD}\n@\n`)
    if (argv[0] === 'pbpaste') {
      pastes++
      return ok(clipboard)
    }
    return ok('', 1)
  })
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => (files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)))
  on('fs.list', async ($: any, e: any, next: any) => (e.path.startsWith('/c/') ? { value: [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] } : next(e)))
  on('ui.copy', async ($: any, e: any) => {
    copies.push(e.text)
    clipboard = e.text
    return { value: { isCopied: true } }
  })
  on('ui.selection', async () => ({ value: undefined }))
  on('ui.toast', async ($: any, e: any) => {
    toasts.push(String(e.text ?? e.message ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drawing'] }) as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const props = { text: SMALL_MD, isFirstOfReply: true }
  const ui = await $.ui.mount({ plugin: 'md-preview', surface: 'terminal', component: 'AssistantMessage', requestId: 'ans-1', props, viewport: { columns: 100, rows: 40 } } as any)
  await clock.settle()
  await ui.redraw(props as any)
  await clock.settle()
  // The probe ran after the PNGs, by itself.
  expect([...files.keys()].some(k => k.endsWith('/positions.json'))).toBe(true)
  expect([...files.keys()].some(k => k.endsWith('/probe.json'))).toBe(true)

  // A clipboard with no placeholders is never written.
  await clock.advance(300)
  expect(pastes).toBeGreaterThan(0)
  expect(copies).toEqual([])

  // The heading row and the start of the paragraph, as a mouse copy takes them.
  clipboard = [cells(1, 0, 97, '⏺ '), cells(2, 0, 97), cells(3, 0, 97), cells(4, 0, 21)].join('\n')
  await clock.advance(300)
  await clock.settle()
  expect(copies).toEqual(['Copy test\nThe quick brown fox jumps'])
  expect(toasts).toContain('md-preview: copied 35 chars of text')
  // Our own write is not read again.
  await clock.advance(900)
  expect(copies.length).toBe(1)

  const dumped = await $.command.run({ command: 'md-preview', args: 'dump' } as any)
  expect(dumped.text).toContain('U+10EEEE[1,0]')
  expect(dumped.text).toContain('-> answer ans-1 page 0')
  expect(files.has('/c/copy-debug.json')).toBe(true)
})
