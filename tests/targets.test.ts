import { expect, test } from 'claude-code/testing'

import { positionsOf, targetAt, targetsOf, textOfRun, type Button, type Item, type Mark, type ShownLink, type TextBlock } from '../hooks/register'
import { LONG_MARKS, LONG_MD, LONG_PAGE, SMALL_PPI, TARGETS_MARKS, TARGETS_PAGE } from './copy-fixture'

const file = (label: string, path: string): ShownLink => ({ kind: 'file', label, path, href: `file://${path}` })
const LINKS = [file('src/a.ts', '/w/src/a.ts'), file('hooks/lib/copy.ts', '/w/hooks/lib/copy.ts')]

// ---- A real probe -----------------------------------------------------------

const REAL = positionsOf(TARGETS_MARKS as unknown as Mark[], SMALL_PPI)
const WORDS = { items: REAL.pages[0]!, blocks: REAL.blocks }

test('a real probe: links, a bare URL, inline code, a bare path are targets; a bash block is none', () => {
  // Rows: paragraph 3 (its inline code 4), paragraph 6, the code's button 8, code 11 and 12.
  expect(targetsOf(WORDS, TARGETS_PAGE, LINKS)).toEqual([
    { target: { kind: 'web', href: 'https://example.com' }, rows: [{ row: 3, x0: 4, x1: 11 }] },
    { target: { kind: 'web', href: 'https://typst.app/docs/reference' }, rows: [{ row: 3, x0: 16, x1: 45 }] },
    { target: { kind: 'command', text: 'ls -la' }, rows: [{ row: 4, x0: 50, x1: 58 }] },
    { target: { kind: 'file', path: '/w/src/a.ts' }, rows: [{ row: 6, x0: 5, x1: 13 }] },
    { target: { kind: 'file', path: '/w/hooks/lib/copy.ts' }, rows: [{ row: 6, x0: 30, x1: 44 }] },
  ])
})

test("a real probe: a target's cells copy as its words", () => {
  const copied = targetsOf(WORDS, TARGETS_PAGE, LINKS).map(t =>
    textOfRun(t.rows.map(r => ({ row: r.row, colStart: r.x0, colEnd: r.x1 })), WORDS.items, WORDS.blocks, TARGETS_PAGE),
  )
  expect(copied).toEqual(['the docs', 'https://typst.app/docs/reference.', '! ls -la', 'src/a.ts', 'hooks/lib/copy.ts'])
})

test('a real probe: a bare file that does not exist (no ShownLink) is no target, in inline code a command; an anchor link is none', () => {
  const got = targetsOf(WORDS, TARGETS_PAGE, [file('other.ts', '/w/other.ts')]).map(t => t.target)
  expect(got.map(t => t.kind)).toEqual(['web', 'web', 'command', 'command'])
  expect(got[3]).toEqual({ kind: 'command', text: 'src/a.ts' })
})

test("a real probe with a code block's copy button: a code target over its box, in order; the words' targets as before", () => {
  const got = positionsOf(TARGETS_MARKS as unknown as Mark[], SMALL_PPI)
  const words = { items: got.pages[0]!, blocks: got.blocks, buttons: got.buttons[0]! }
  expect(words.items).toEqual(WORDS.items)
  const targets = targetsOf(words, TARGETS_PAGE, LINKS)
  expect(targets.map(t => t.target.kind)).toEqual(['web', 'web', 'command', 'file', 'file', 'code'])
  expect(targets[5]).toEqual({ target: { kind: 'code', text: 'echo hello\nls -la', lang: 'bash' }, rows: [{ row: 8, x0: 8, x1: 15 }] })
  expect(targetAt(targets, 8, 8)).toBe(5)
  expect(targetAt(targets, 15, 8)).toBe(5)
  expect(targetAt(targets, 16, 8)).toBe(-1)
  expect(targetAt(targets, 11, 9)).toBe(-1)
})

test('a real probe: a long path and a long URL that wraps (a character a word)', () => {
  const long = positionsOf(LONG_MARKS as unknown as Mark[], SMALL_PPI)
  const path = '/Users/someone/Development/apps/very/long/path/to/file.ts'
  const got = targetsOf({ items: long.pages[0]!, blocks: long.blocks }, LONG_PAGE, [file(path, path)])
  expect(got.map(t => t.target)).toEqual([
    { kind: 'file', path },
    { kind: 'web', href: /https:\S+\/x/.exec(LONG_MD)![0] },
  ])
  expect(got[1]!.rows).toEqual([{ row: 5, x0: 15, x1: 95 }, { row: 6, x0: 0, x1: 93 }])
})

test('targetAt finds the target whose cells hold a cell', () => {
  const targets = targetsOf(WORDS, TARGETS_PAGE, LINKS)
  expect(targetAt(targets, 4, 3)).toBe(0)
  expect(targetAt(targets, 11, 3)).toBe(0)
  expect(targetAt(targets, 12, 3)).toBe(-1)
  expect(targetAt(targets, 30, 6)).toBe(4)
  expect(targetAt(targets, 8, 10)).toBe(-1)
  expect(targetAt([], 0, 0)).toBe(-1)
})

// ---- Hand-made words --------------------------------------------------------

// A page of 10 columns of 10 px, 4 rows of 20 px; a word 6 px a character.
const PAGE = { width: 100, height: 80, columns: 10, rows: 4 }
const word = (i: number, text: string, x0: number, row: number, more: Partial<Item> = {}): Item => ({
  i, text, x0, x1: x0 + text.length * 6, y0: row * 20 + 2, y1: row * 20 + 18, block: 0, em: 20, ...more,
})
const PAR: TextBlock[] = [{ kind: 'par', prefix: '', first: 0 }]
const of = (items: Item[], blocks = PAR, links: readonly ShownLink[] = []) => targetsOf({ items, blocks }, PAGE, links)

test('a link is one target over its words, on each row it is on; a link to a file is that file', () => {
  const href = 'https://x.dev/a'
  const items = [word(0, 'see', 0, 0), word(1, 'the', 30, 0, { href }), word(2, 'long', 60, 0, { href }), word(3, 'guide', 0, 1, { href })]
  expect(of(items)).toEqual([{ target: { kind: 'web', href }, rows: [{ row: 0, x0: 3, x1: 7 }, { row: 1, x0: 0, x1: 2 }] }])
  const docs = [word(0, 'docs', 0, 0, { href: 'docs/usage.md#top' })]
  expect(of(docs, PAR, [file('docs/usage.md', '/w/docs/usage.md')])).toEqual([{ target: { kind: 'file', path: '/w/docs/usage.md' }, rows: [{ row: 0, x0: 0, x1: 1 }] }])
  expect(of(docs)).toEqual([])
})

test('only http, https and mailto links are web targets; links next to each other are two', () => {
  expect(of([word(0, 'mail', 0, 0, { href: 'mailto:a@b.co' })]).map(t => t.target)).toEqual([{ kind: 'web', href: 'mailto:a@b.co' }])
  expect(of([word(0, 'ftp', 0, 0, { href: 'ftp://x.org/a' })])).toEqual([])
  const two = [word(0, 'one', 0, 0, { href: 'https://a.io' }), word(1, 'two', 30, 0, { href: 'https://b.io' })]
  expect(of(two).map(t => t.target)).toEqual([{ kind: 'web', href: 'https://a.io' }, { kind: 'web', href: 'https://b.io' }])
})

test('inline code in a link is the link; other inline code is a command (its text, less a `! ` before it)', () => {
  const href = 'https://x.dev'
  expect(of([word(0, 'api', 0, 0, { href, code: 'api' }), word(1, 'docs', 30, 0, { href })]).map(t => t.target)).toEqual([{ kind: 'web', href }])
  const cmd = [word(0, '!', 0, 0, { code: '! npm  test' }), word(1, 'npm', 12, 0, { code: '! npm  test' }), word(2, 'test', 40, 0, { code: '! npm  test' })]
  expect(of(cmd)).toEqual([{ target: { kind: 'command', text: 'npm test' }, rows: [{ row: 0, x0: 0, x1: 5 }] }])
  expect(of([word(0, 'npm', 0, 0, { code: 'npm' })]).map(t => t.target)).toEqual([{ kind: 'command', text: 'npm' }])
  expect(of([word(0, '!', 0, 0, { code: '!' })]).map(t => t.target)).toEqual([{ kind: 'command', text: '!' }])
})

test('a bare path takes the punctuation around it off; a bare word that is a name is not a path', () => {
  const links = [file('a/b.ts:12', '/w/a/b.ts')]
  // "(a/" "b.ts:12)," with no space between: one token.
  const items = [word(0, '(a/', 0, 0), word(1, 'b.ts:12),', 18, 0)]
  expect(of(items, PAR, links).map(t => t.target)).toEqual([{ kind: 'file', path: '/w/a/b.ts' }])
  expect(of([word(0, 'Node.js', 0, 0)], PAR, [file('Node.js', '/w/Node.js')])).toEqual([])
  // A space between: two tokens, neither a path.
  expect(of([word(0, 'a/', 0, 0), word(1, 'b.ts:12', 30, 0)], PAR, links)).toEqual([])
})

test('the text of a code block is no target, also a shell block', () => {
  const line = (i: number, text: string, row: number): Item => ({ i, text, x0: 10, x1: 10 + text.length * 5, y0: row * 20 + 4, y1: row * 20 + 16, block: 0, adv: 5 })
  expect(of([line(0, '$ make build', 0), line(1, 'https://x.dev', 1)], [{ kind: 'code', prefix: '', first: 0 }])).toEqual([])
})

// A button's box: x0..x1, y0..y1 in px.
const button = (x0: number, y0: number, x1: number, y1: number, more: Partial<Button> = {}): Button => ({ x0, y0, x1, y1, code: 'make\nmake test', ...more })
const withButtons = (items: Item[], buttons: Button[], blocks = PAR) => targetsOf({ items, blocks, buttons }, PAGE, [])

test("a copy button is a code target: the cells whose centres are in its box, its code and language", () => {
  // Centres of columns 6 to 8 (65, 75, 85) and row 0 (10) are in the box.
  expect(withButtons([], [button(62, 2, 88, 18, { lang: 'sh' })])).toEqual([
    { target: { kind: 'code', text: 'make\nmake test', lang: 'sh' }, rows: [{ row: 0, x0: 6, x1: 8 }] },
  ])
  // No language: none kept.
  expect(withButtons([], [button(62, 2, 88, 18)])[0]!.target).toEqual({ kind: 'code', text: 'make\nmake test' })
  // A box smaller than a cell, over no centre: the cell of its centre.
  expect(withButtons([], [button(71, 21, 78, 28)])[0]!.rows).toEqual([{ row: 1, x0: 7, x1: 7 }])
})

test('a copy button that is taller than a row takes each row whose centre is in it; one off the page none', () => {
  // Rows 1 and 2 (centres 30, 50); columns 7 to 9 (the last one clamped).
  expect(withButtons([], [button(70, 22, 120, 58)])[0]!.rows).toEqual([{ row: 1, x0: 7, x1: 9 }, { row: 2, x0: 7, x1: 9 }])
  expect(withButtons([], [button(10, 90, 30, 110)])).toEqual([])
})

test('copy buttons go in order with the other targets, by their first row and column', () => {
  const href = 'https://x.dev'
  const items = [word(0, 'see', 0, 0, { href }), word(1, 'npm', 0, 2, { code: 'npm' })]
  const got = withButtons(items, [button(62, 22, 88, 38, { code: 'a' }), button(62, 62, 88, 78, { code: 'b' })])
  expect(got.map(t => t.target)).toEqual([
    { kind: 'web', href }, { kind: 'code', text: 'a' }, { kind: 'command', text: 'npm' }, { kind: 'code', text: 'b' },
  ])
  // On the row of a target, right of it: after it; left of it: before it.
  expect(withButtons(items, [button(62, 2, 88, 18, { code: 'c' })]).map(t => t.target.kind)).toEqual(['web', 'code', 'command'])
  const right = [word(0, 'see', 70, 0, { href })]
  expect(withButtons(right, [button(2, 2, 28, 18, { code: 'c' })]).map(t => t.target.kind)).toEqual(['code', 'web'])
  expect(targetAt(got, 7, 1)).toBe(1)
  expect(targetAt(got, 0, 2)).toBe(2)
  expect(targetAt(got, 8, 3)).toBe(3)
})

test('the cells scale with the box the page is drawn at', () => {
  const href = 'https://x.dev'
  const items = [word(0, 'the', 30, 0, { href }), word(1, 'link', 60, 1, { href })]
  // Cells of 20 x 40 px: both words on row 0.
  expect(targetsOf({ items, blocks: PAR }, { ...PAGE, columns: 5, rows: 2 }, [])[0]!.rows).toEqual([{ row: 0, x0: 1, x1: 3 }])
})
