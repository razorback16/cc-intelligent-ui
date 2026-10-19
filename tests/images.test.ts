import { expect, mock, test } from 'claude-code/testing'

import {
  claudeTmpOf, convertBox, convertCall, convertedPath, DEFAULT_CELL, factsAfter, folderOf, imageKindOf, isMarkdownPath, isNoPageError, isPdfPath, lastKnownPage,
  NO_FACTS, pageControls, pageCountOf, pageOf, parsePage, pasteDirOf, pastedImagePath, pastedNumbers, COMMIT_MIN_MS, DEFAULT_HEIGHT, parseCommand, RESIZE_QUIET_MS, PICTURE_MAX_ROWS, PICTURE_ROOM_ROWS, pictureCells,
  pictureRowsFor, projectSlug, renderKey, rowsAfter, sentFiles, sentImages, shortError, type Under,
} from '../hooks/register'

// ---- Pure helpers -----------------------------------------------------------

test('a picture keeps its aspect, is never made larger, and fits the box', () => {
  // 640 x 320 px at 16 x 32 px cells: 40 x 10 cells, its own size.
  expect(pictureCells({ width: 640, height: 320 }, 98, 24, DEFAULT_CELL)).toEqual({ columns: 40, rows: 10 })
  // Too wide: cut to 98 columns, the rows follow.
  expect(pictureCells({ width: 3136, height: 640 }, 98, 24, DEFAULT_CELL)).toEqual({ columns: 98, rows: 10 })
  expect(pictureCells({ width: 2000, height: 838 }, 98, 24, DEFAULT_CELL)).toEqual({ columns: 98, rows: 21 })
  // Too tall: cut to 24 rows, the columns follow.
  expect(pictureCells({ width: 1000, height: 1600 }, 98, 24, DEFAULT_CELL)).toEqual({ columns: 30, rows: 24 })
  // A tiny icon is at least one cell.
  expect(pictureCells({ width: 4, height: 4 }, 98, 24, DEFAULT_CELL)).toEqual({ columns: 1, rows: 1 })
})

test('a picture takes at most half the viewport, within 6 and 24 rows', () => {
  expect(DEFAULT_HEIGHT).toBe('half')
  expect(pictureRowsFor(undefined, 'half')).toBe(PICTURE_MAX_ROWS)
  expect(pictureRowsFor(100, 'half')).toBe(PICTURE_MAX_ROWS)
  expect(pictureRowsFor(30, 'half')).toBe(15)
  expect(pictureRowsFor(8, 'half')).toBe(6)
})

test('height full: the viewport less 16 rows; a number: at most that, never under 6 or over 255', () => {
  expect(PICTURE_ROOM_ROWS).toBe(16)
  expect(pictureRowsFor(40, 'full')).toBe(24)
  expect(pictureRowsFor(100, 'full')).toBe(84)
  expect(pictureRowsFor(20, 'full')).toBe(6)
  expect(pictureRowsFor(undefined, 'full')).toBe(32)
  expect(pictureRowsFor(100, 12)).toBe(12)
  expect(pictureRowsFor(40, 36)).toBe(24)
  expect(pictureRowsFor(10, 12)).toBe(6)
  expect(pictureRowsFor(400, 200)).toBe(200)
  expect(pictureRowsFor(400, 'full')).toBe(255)
})

test('the height command: half, full, 6 to 200 rows, or nothing to show it', () => {
  expect(parseCommand('height')).toEqual({ kind: 'height' })
  expect(parseCommand('height half')).toEqual({ kind: 'height', height: 'half' })
  expect(parseCommand('HEIGHT Full')).toEqual({ kind: 'height', height: 'full' })
  expect(parseCommand('height 6')).toEqual({ kind: 'height', height: 6 })
  expect(parseCommand('height 200')).toEqual({ kind: 'height', height: 200 })
  expect(parseCommand('height 5')).toEqual({ kind: 'bad' })
  expect(parseCommand('height 201')).toEqual({ kind: 'bad' })
  expect(parseCommand('height tall')).toEqual({ kind: 'bad' })
  expect(parseCommand('height 12 rows')).toEqual({ kind: 'bad' })
})

test('only PNG, JPEG, WebP, SVG and PDF attachments are drawn', () => {
  expect(sentImages({
    attachments: [
      { path: '/t/a.png', size: 1, isImage: true, media_type: 'image/png' },
      { path: '/t/b.png', size: 1, isImage: true },
      { path: '/t/c.jpg', size: 1, isImage: true, media_type: 'image/jpeg' },
      { path: '/t/d.pdf', size: 1, isImage: false },
      { size: 1, isImage: true },
      { path: '/t/e.webp', size: 1, isImage: true, media_type: 'image/webp' },
      { path: '/t/f.gif', size: 1, isImage: true, media_type: 'image/gif' },
      { path: '/t/g.svg', size: 1, isImage: true, media_type: 'image/svg+xml' },
      // As Claude Code sends an SVG: not an image, by its media type.
      { path: '/t/h.svg', size: 1, isImage: false, media_type: 'image/svg+xml' },
      { path: '/t/i.SVG', size: 1, isImage: false },
      { path: '/t/j.svg', size: 1, isImage: false, media_type: 'text/plain' },
    ],
  })).toEqual(['/t/a.png', '/t/b.png', '/t/c.jpg', '/t/d.pdf', '/t/e.webp', '/t/g.svg', '/t/h.svg', '/t/i.SVG'])
  expect(sentImages(undefined)).toEqual([])
  expect(sentImages('error text')).toEqual([])
  expect(sentImages({ attachments: 'x' })).toEqual([])
})

test('an image type: by its media type, else by its name; with neither, a PNG to try', () => {
  expect(imageKindOf({ path: '/t/a', media_type: 'image/png' })).toBe('png')
  expect(imageKindOf({ path: '/t/a', media_type: 'IMAGE/JPEG' })).toBe('jpeg')
  expect(imageKindOf({ path: '/t/a', media_type: 'image/jpg' })).toBe('jpeg')
  expect(imageKindOf({ path: '/t/a', media_type: 'image/webp' })).toBe('webp')
  // The media type wins over the name.
  expect(imageKindOf({ path: '/t/a.jpg', media_type: 'image/png' })).toBe('png')
  expect(imageKindOf({ path: '/t/a.png', media_type: 'image/gif' })).toBe(null)
  expect(imageKindOf({ path: '/t/a.png', media_type: 'image/svg+xml' })).toBe('svg')
  expect(imageKindOf({ path: '/t/a.Svg' })).toBe('svg')
  expect(imageKindOf({ path: '/t/a.PNG' })).toBe('png')
  expect(imageKindOf({ path: '/t/a.JPG' })).toBe('jpeg')
  expect(imageKindOf({ path: '/t/a.jpeg' })).toBe('jpeg')
  expect(imageKindOf({ path: '/t/a.WebP' })).toBe('webp')
  expect(imageKindOf({ path: '/t/screenshot' })).toBe('png')
})

test('a Markdown file: .md or .markdown, not an image; all files in their order, each once', () => {
  expect(isMarkdownPath('/t/notes.md')).toBe(true)
  expect(isMarkdownPath('/t/NOTES.Markdown')).toBe(true)
  expect(isMarkdownPath('/t/notes.mdx')).toBe(false)
  expect(isMarkdownPath('/t/md')).toBe(false)
  expect(sentFiles({
    attachments: [
      { path: '/t/notes.md', size: 1, isImage: false },
      { path: '/t/a.jpg', size: 1, isImage: true },
      { path: '/t/b.txt', size: 1, isImage: false },
      { path: '/t/c.png', size: 1, isImage: true, media_type: 'image/png' },
      { path: '/t/notes.md', size: 1, isImage: false },
      { path: '/t/odd.md', size: 1, isImage: true, media_type: 'image/png' },
      { path: '/t/d.webp', size: 1, isImage: true },
    ],
  })).toEqual([
    { path: '/t/notes.md', kind: 'markdown' },
    { path: '/t/a.jpg', kind: 'jpeg' },
    { path: '/t/c.png', kind: 'png' },
    { path: '/t/odd.md', kind: 'png' },
    { path: '/t/d.webp', kind: 'webp' },
  ])
  expect(sentFiles(null)).toEqual([])
})

test('a PDF: by its media type application/pdf, else by its .pdf name; not Markdown; in the attachments order', () => {
  expect(isPdfPath('/t/a.pdf')).toBe(true)
  expect(isPdfPath('/t/A.PDF')).toBe(true)
  expect(isPdfPath('/t/a.pdf.md')).toBe(false)
  expect(isPdfPath('/t/pdf')).toBe(false)
  expect(sentFiles({
    attachments: [
      { path: '/t/notes.md', size: 1, isImage: false },
      // As Claude Code sends a PDF: not an image, its media type.
      { path: '/t/a.pdf', size: 1, isImage: false, media_type: 'application/pdf' },
      { path: '/t/b.png', size: 1, isImage: true },
      { path: '/t/c', size: 1, isImage: false, media_type: ' Application/PDF ' },
      { path: '/t/d.PDF', size: 1, isImage: false },
      // The media type wins over the name.
      { path: '/t/e.pdf', size: 1, isImage: false, media_type: 'text/plain' },
      { path: '/t/f.md', size: 1, isImage: false, media_type: 'application/pdf' },
      { path: '/t/a.pdf', size: 1, isImage: false, media_type: 'application/pdf' },
    ],
  })).toEqual([
    { path: '/t/notes.md', kind: 'markdown' },
    { path: '/t/a.pdf', kind: 'pdf' },
    { path: '/t/b.png', kind: 'png' },
    { path: '/t/c', kind: 'pdf' },
    { path: '/t/d.PDF', kind: 'pdf' },
    { path: '/t/f.md', kind: 'pdf' },
  ])
})

test('the folder of a file, for the relative images of a Markdown file', () => {
  expect(folderOf('/t/docs/notes.md')).toBe('/t/docs')
  expect(folderOf('/notes.md')).toBe('/')
  expect(folderOf('/t//notes.md')).toBe('/t')
})

// The box of a 100 x 40 viewport at 16 x 32 px cells: 98 columns, 20 rows.
const BOX = { width: 1568, height: 640 }

test('a JPEG or WebP is made to fit the space of the picture, each side at most 4096 px', () => {
  expect(convertBox(98, 20, DEFAULT_CELL)).toEqual(BOX)
  expect(convertBox(58, 24, { width: 8, height: 17 })).toEqual({ width: 464, height: 408 })
  expect(convertBox(120, 24, { width: 40, height: 200 })).toEqual({ width: 4096, height: 4096 })
  expect(convertBox(0, 0, DEFAULT_CELL)).toEqual({ width: 1, height: 1 })
})

test('a converted PNG is named by the file, its stat stamp and the box, in a key folder of the cache', () => {
  const one = convertedPath('/c', '/t/a.jpg', '1:1000', BOX)
  expect(one).toMatch(/^\/c\/[0-9a-f]{16}\/image\.png$/)
  expect(convertedPath('/c', '/t/a.jpg', '1:1000', { ...BOX })).toBe(one)
  expect(convertedPath('/c', '/t/a.jpg', '2:1000', BOX)).not.toBe(one)
  expect(convertedPath('/c', '/t/b.jpg', '1:1000', BOX)).not.toBe(one)
  expect(convertedPath('/c', '/t/a.jpg', '1:1000', { width: 928, height: 640 })).not.toBe(one)
  expect(convertedPath('/c', '/t/a.jpg', '1:1000', { width: 1568, height: 768 })).not.toBe(one)
})

test("each page of a PDF has a PNG of its own; with no page the name is as before", () => {
  const one = convertedPath('/c', '/t/a.pdf', '1:1000', BOX, 1)
  expect(one).toMatch(/^\/c\/[0-9a-f]{16}\/image\.png$/)
  expect(convertedPath('/c', '/t/a.pdf', '1:1000', BOX, 1)).toBe(one)
  expect(convertedPath('/c', '/t/a.pdf', '1:1000', BOX, 2)).not.toBe(one)
  expect(convertedPath('/c', '/t/a.pdf', '1:1000', BOX)).not.toBe(one)
  expect(convertedPath('/c', '/t/a.jpg', '1:1000', BOX, undefined)).toBe(convertedPath('/c', '/t/a.jpg', '1:1000', BOX))
})

test('the conversion call: render/convert.typ at 72 ppi, the file and the box as inputs, no network', () => {
  const { argv, env } = convertCall({ typst: '/usr/bin/typst', root: '/r', cache: '/c', file: '/t/a b.webp', box: BOX, out: '/c/k/image.png' })
  expect(argv).toEqual([
    '/usr/bin/typst', 'compile', '--root', '/', '--format', 'png', '--diagnostic-format', 'short', '--ppi', '72',
    '--input', 'f=/t/a b.webp', '--input', 'maxw=1568', '--input', 'maxh=640', '/r/render/convert.typ', '/c/k/image.png',
  ])
  expect(env.TYPST_PACKAGE_CACHE_PATH).toBe('/c/pkg-cache')
  expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:9')
})

test('the conversion call of a PDF page: the page as an input, the errors in the human format (its hint has the page count)', () => {
  const { argv } = convertCall({ typst: '/usr/bin/typst', root: '/r', cache: '/c', file: '/t/a.pdf', box: BOX, out: '/c/k/image.png', page: 3 })
  expect(argv.slice(-6)).toEqual(['--input', 'maxh=640', '--input', 'page=3', '/r/render/convert.typ', '/c/k/image.png'])
  expect(argv.slice(4, 8)).toEqual(['--format', 'png', '--diagnostic-format', 'human'])
})

test("Typst's error for a page that is not there; another error, short", () => {
  const typ = '../../r/render/convert.typ:55:30'
  expect(isNoPageError(`${typ}: error: failed to load PDF (page 4 does not exist)\n`)).toBe(true)
  expect(isNoPageError('error: failed to load PDF (page 99 does not exist in doc.pdf)')).toBe(true)
  expect(isNoPageError(`${typ}: error: failed to load PDF (the PDF could not be loaded)`)).toBe(false)
  expect(isNoPageError('')).toBe(false)
  expect(shortError(`${typ}: error: failed to load PDF (the PDF could not be loaded)\n`)).toBe('the PDF could not be loaded')
  expect(shortError(`warning: x\n${typ}: error: file is encrypted\n  hint: y`)).toBe('file is encrypted')
  expect(shortError('did not run: timeout')).toBe('did not run: timeout')
  expect(shortError('')).toBe('Typst could not read it')
})

// Typst's human format for a page that is not there, with its hint.
const NO_PAGE = (page: number, pages: number) =>
  `error: failed to load PDF (page ${page} does not exist)\n   ┌─ render/convert.typ:55:30\n   │\n   = hint: the document only has ${pages} page${pages === 1 ? '' : 's'}\n`

test('what is known of the pages of a PDF: the highest page made, the first page that is not there, the count, the errors', () => {
  const made = factsAfter(NO_FACTS, 3, null)
  expect(made).toEqual({ made: 3, missing: 0, pages: 0, errors: {} })
  expect(factsAfter(made, 2, null).made).toBe(3)
  // No hint (the short format): only that page and the pages after it are gone.
  const gone = factsAfter(made, 9, 'error: failed to load PDF (page 9 does not exist)')
  expect(gone).toEqual({ made: 3, missing: 9, pages: 0, errors: {} })
  expect(factsAfter(gone, 12, 'error: failed to load PDF (page 12 does not exist)').missing).toBe(9)
  expect(factsAfter(gone, 4, 'error: failed to load PDF (page 4 does not exist)').missing).toBe(4)
  // The hint gives the count: the last page at once.
  expect(pageCountOf(NO_PAGE(300, 3))).toBe(3)
  expect(pageCountOf(NO_PAGE(2, 1))).toBe(1)
  expect(pageCountOf('error: failed to load PDF (page 2 does not exist)')).toBe(0)
  expect(factsAfter(made, 300, NO_PAGE(300, 3))).toEqual({ made: 3, missing: 4, pages: 3, errors: {} })
  // Another error is kept for its page, until that page is made.
  const bad = factsAfter(made, 4, 'error: failed to load PDF (the PDF could not be loaded)')
  expect(bad.errors).toEqual({ 4: 'the PDF could not be loaded' })
  expect(bad.missing).toBe(0)
  expect(factsAfter(bad, 5, null).errors).toEqual({ 4: 'the PDF could not be loaded' })
  expect(factsAfter(bad, 4, null).errors).toEqual({})
})

test('the last page known for a row whose page is gone: the count, else the page before the first missing one when it was made, else 1', () => {
  expect(lastKnownPage({ ...NO_FACTS, pages: 3, missing: 4 })).toBe(3)
  expect(lastKnownPage({ ...NO_FACTS, made: 5, missing: 6 })).toBe(5)
  expect(lastKnownPage({ ...NO_FACTS, made: 0, missing: 300 })).toBe(1)
  expect(lastKnownPage({ ...NO_FACTS, made: 2, missing: 300 })).toBe(1)
})

test('the page shown and its control line: ‹ dim on page 1, › dim on the last page, no line for one page', () => {
  expect(pageOf(1, 0)).toBe(1)
  expect(pageOf(0, 0)).toBe(1)
  expect(pageOf(7, 0)).toBe(7)
  expect(pageOf(7, 5)).toBe(4)
  expect(pageOf(3, 2)).toBe(1)
  // The last page not known: › acts.
  expect(pageControls(1, 0)).toEqual({ back: false, forward: true })
  expect(pageControls(4, 0)).toEqual({ back: true, forward: true })
  // Page 3 of 3 (page 4 is not there).
  expect(pageControls(3, 4)).toEqual({ back: true, forward: false })
  expect(pageControls(2, 4)).toEqual({ back: true, forward: true })
  expect(pageControls(1, 4)).toEqual({ back: false, forward: true })
  // One page: no line.
  expect(pageControls(1, 2)).toBe(null)
})

test('a page number typed: a whole number from 1, spaces around it allowed', () => {
  expect(parsePage('3')).toBe(3)
  expect(parsePage(' 12 \n')).toBe(12)
  expect(parsePage('007')).toBe(7)
  for (const bad of ['', ' ', '0', '-1', '1.5', '2e3', 'x', '3 4', '+3', '99999999999999999999']) expect(parsePage(bad)).toBe(null)
})

test('a PDF page counts its control line, and an error line its row, in the rows after a drawing', () => {
  const picture = { source: { file: '/c/a.png', format: 'png' as const }, columns: 40, rows: 10, alt: 'a.png' }
  const line = { row: 'tu-1\n/t/a.pdf', file: '/t/a.pdf', stamp: '1:1000', page: 2, back: true, forward: true, box: BOX }
  const under: Under[] = [
    picture, { ...picture, pdf: line }, { note: 'PDF: the PDF could not be loaded' }, { note: 'PDF: page 2: boom', pdf: line }, picture,
  ]
  expect(rowsAfter(under, 0, 98)).toBe(10 + 1 + 1 + 2 + 10)
  expect(rowsAfter(under, 1, 98)).toBe(1 + 2 + 10)
})

test('a Markdown file folder is part of the key; with none, the key is as before', () => {
  const o = {
    textHash: 'h', columns: 100, cell: DEFAULT_CELL, size: 100, mode: 'dark' as const, termFont: '', columnPt: 6,
    templateStamp: '1', look: { name: 'vscode', dir: '/t', stamp: '0' },
  }
  expect(renderKey({ ...o, base: undefined })).toBe(renderKey(o))
  expect(renderKey({ ...o, base: '/t/docs' })).not.toBe(renderKey(o))
  expect(renderKey({ ...o, base: '/t/docs' })).not.toBe(renderKey({ ...o, base: '/t/other' }))
})

test('the [Image #N] marks of a prompt, each once', () => {
  expect(pastedNumbers('[Image #5] what is this')).toEqual([5])
  expect(pastedNumbers('[Image #2] and [Image #3], again [Image #2]')).toEqual([2, 3])
  expect(pastedNumbers('no image, [Image #x], [image #4]')).toEqual([])
})

test('the pasted-image path follows Claude Code folder names', () => {
  expect(projectSlug('/Users/subhagato/Development/apps/claude-intelligent-ui')).toBe('-Users-subhagato-Development-apps-claude-intelligent-ui')
  expect(projectSlug('/home/me/my_app.v2')).toBe('-home-me-my-app-v2')
  expect(claudeTmpOf({ uid: '501\n', isMac: true })).toBe('/private/tmp/claude-501')
  expect(claudeTmpOf({ uid: '1000', isMac: false })).toBe('/tmp/claude-1000')
  expect(claudeTmpOf({ tmpdir: '/scratch/', uid: '1000', isMac: false })).toBe('/scratch/claude-1000')
  expect(claudeTmpOf({ uid: '', isMac: true })).toBe('')
  const dir = pasteDirOf('/private/tmp/claude-501', '/Users/subhagato/Development/apps/claude-intelligent-ui', 'f8bb4b84-0e51-456a-9e49-8e5db49500ae')
  expect(pastedImagePath(dir, 5)).toBe('/private/tmp/claude-501/-Users-subhagato-Development-apps-claude-intelligent-ui/f8bb4b84-0e51-456a-9e49-8e5db49500ae/images/5.png')
})

// ---- The render hooks -------------------------------------------------------

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// `od -An -v -tx1` of a PNG's first 24 bytes: 640 x 320.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 02 80 00 00 01 40'
// The first bytes of a JPEG: not a PNG.
const JPEG = 'ff d8 ff e0 00 10 4a 46 49 46 00 01 01 00 00 01 00 01 00 00 ff db 00 43'
// The first 33 bytes of a PNG, base64.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABkAAAABACAYAAAAAAAAA'
const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }
const PASTED = '/private/tmp/claude-501/-w-app/sid-1/images'
// A tall PNG: 640 x 3200 px, 100 rows of 32 px at its own size.
const TALL = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 02 80 00 00 0c 80'

// A Mac with kitty (pictures drawn), uid 501, session sid-1 in /w/app. `files`
// are the files that exist, by path: their first bytes as od prints them.
// `texts` are text files (a Markdown file Claude sends), `mtimes` the files'
// mtimes (1 when not set). `typst`: Typst is found; it makes a PNG of a JPEG
// or WebP (unless `failConvert`, or from run number `failConvertFrom`; `mv`
// moves it, unless `failMove`), and
// compiles Markdown to one page. `pdfs`: the PDFs by path, their page
// count (a run for a page past it fails as Typst's does, with the hint
// that gives the count, unless `noHint`).
// `holdConvert`: a conversion ends only once its file had that many stats
// (other rows reached it while it runs). `holdRun`: conversion number `at`
// (from 1) ends only when `until` settles. `holdCompile`: a Markdown compile
// ends only when this settles.
function world(on: any, o: {
  vars?: Record<string, string>
  // What Intelligent UI kept in its store before (a setting).
  stored?: Record<string, unknown>
  files?: Record<string, string>
  texts?: Record<string, string>
  mtimes?: Record<string, number>
  dirs?: string[]
  projects?: string[]
  typst?: boolean
  failConvert?: boolean
  failConvertFrom?: number
  failMove?: boolean
  holdConvert?: number
  holdRun?: { at: number; until: Promise<void> }
  holdCompile?: Promise<void>
  pdfs?: Record<string, number>
  noHint?: boolean
} = {}) {
  // Intelligent UI's store in memory (as mock.store), and its writes by key;
  // `redrawsAt`: by key, the `done` writes (redraws) made when its write ended.
  const store = new Map(Object.entries(o.stored ?? {}))
  const kept: Record<string, unknown> = {}
  const redrawsAt: Record<string, number> = {}
  let redraws = 0
  on('state.set', async ($: any, e: any, next: any) => {
    if (e.key === 'done') redraws++
    return next(e)
  })
  on('store.get', async ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async ($: any, e: any) => {
    store.set(e.key, e.value)
    kept[e.key] = e.value
    // A write to the host takes a while: what was asked before it lands.
    for (let i = 0; i < 50; i++) await Promise.resolve()
    redrawsAt[e.key] = redraws
    return { value: undefined }
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM: 'xterm-kitty', ...o.vars })
  const files = o.files ?? {}
  const texts = o.texts ?? {}
  const mtimes = o.mtimes ?? {}
  const written = new Map<string, string>()
  const dirs = new Set(o.dirs ?? [])
  const heads: string[] = []
  const reads: string[] = []
  const converts: string[][] = []
  const moves: string[][] = []
  const docs: any[] = []
  const logs: string[] = []
  const stats = new Map<string, number>()
  const waits: { path: string; done: () => void }[] = []
  const statted = (path: string) => {
    stats.set(path, (stats.get(path) ?? 0) + 1)
    for (const w of waits.filter(w => w.path === path && stats.get(path)! >= (o.holdConvert ?? 0))) {
      waits.splice(waits.indexOf(w), 1)
      w.done()
    }
  }
  // The children Intelligent UI spawns: the Frame watcher (it exits 1: no tty)
  // and a Markdown compile through the PID wrapper (typst.ts wrapPid).
  let pids = 4242
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    if (argv[0] === 'sh' && argv[2] === 'echo $$; exec "$@"' && argv[4] === '/usr/bin/typst' && argv[5] === 'compile') {
      yield { stream: 'stdout', text: `${pids++}\n` }
      const doc = argv.find(a => a.startsWith('doc='))!.slice(4)
      docs.push(JSON.parse(written.get(doc)!))
      await o.holdCompile
      return { value: { code: 0, signal: null } }
    }
    return { value: { code: 1, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'kill') return ok('')
    if (/cc-intelligent-ui-/.test(cmd)) return ok('/c\nDarwin\n')
    if (argv[0] === 'id' && argv[1] === '-u') return ok('501\n')
    if (cmd.includes('command -v typst')) return o.typst ? ok('/usr/bin/typst\n') : ok('', 1)
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (argv[0] === 'mv') {
      moves.push(argv)
      if (o.failMove || !(argv[2]! in files)) return ok('', 1)
      files[argv[3]!] = files[argv[2]!]!
      delete files[argv[2]!]
      return ok('')
    }
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'compile' && argv.at(-2)!.endsWith('/render/convert.typ')) {
      converts.push(argv)
      const file = argv.find(a => a.startsWith('f='))!.slice(2)
      if ((stats.get(file) ?? 0) < (o.holdConvert ?? 0)) await new Promise<void>(done => waits.push({ path: file, done }))
      if (o.holdRun?.at === converts.length) await o.holdRun.until
      if (o.failConvert || converts.length >= (o.failConvertFrom ?? Infinity)) return ok('', 1)
      const page = Number(argv.find(a => a.startsWith('page='))?.slice(5) ?? 1)
      if (o.pdfs && page > (o.pdfs[file] ?? Infinity)) {
        const stderr = o.noHint ? `error: failed to load PDF (page ${page} does not exist)\n` : NO_PAGE(page, o.pdfs[file]!)
        return { value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
      }
      files[argv.at(-1)!] = HEAD
      return ok('')
    }
    if (cmd.includes('od -An')) {
      const all = argv.slice(4)
      heads.push(...all)
      return ok(all.map(f => `${files[f] ?? (f.startsWith('/c/') ? HEAD : '')}\n@\n`).join(''))
    }
    if (cmd.includes('debug.log')) {
      logs.push(e.init?.stdin ?? '')
      return ok('')
    }
    return ok('', 1)
  })
  on('session.id', async () => ({ value: 'sid-1' }))
  on('session.cwd', async () => ({ value: '/w/app' }))
  on('session.root', async () => ({ value: '/w/app' }))
  on('fs.stat', async ($: any, e: any, next: any) => {
    statted(e.path)
    const size = e.path in files ? 1000 : e.path in texts ? texts[e.path]!.length : -1
    if (size >= 0) return { value: { kind: 'file', size, mtimeMs: mtimes[e.path] ?? 1, isLink: false } }
    return e.path.startsWith('/t/') || e.path.startsWith('/private/') || e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)
  })
  on('fs.exists', async ($: any, e: any, next: any) => {
    if (e.path.startsWith('/private/')) return { value: dirs.has(e.path) }
    if (e.path.startsWith('/t/')) return { value: e.path in files || e.path in texts }
    // Typst only where `typst` says (not the one on this computer).
    return e.path.endsWith('/typst') ? { value: false } : next(e)
  })
  on('fs.list', async ($: any, e: any, next: any) => {
    if (e.path === '/private/tmp/claude-501') return { value: (o.projects ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 1, isLink: false })) }
    return e.path.startsWith('/c/') ? { value: [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] } : next(e)
  })
  on('fs.write', async ($: any, e: any) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => {
    if (e.as === 'bytes' && e.path in files) return (reads.push(e.path), { value: { base64: PNG } })
    if (e.as !== 'bytes' && e.path in texts) return (reads.push(e.path), { value: texts[e.path] })
    if (written.has(e.path)) return { value: written.get(e.path) }
    return e.path.startsWith('/c/') || e.path.startsWith('/t/') ? { deny: 'ENOENT' } : next(e)
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', () => ENGINE as any)
  return { clock, heads, reads, converts, moves, docs, logs, files, texts, mtimes, written, kept, redrawsAt, redraws: () => redraws }
}

const sent = (output: unknown, isErrored = false, id = 'tu-1') =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'ToolResult', requestId: id,
    props: { tool_use_id: id, tool: 'SendUserFile', output, isErrored }, viewport: { columns: 100, rows: 40 },
  }) as any
const attach = (path: string, isImage = true) => ({ attachments: [{ path, size: 1000, isImage, ...(isImage ? { media_type: 'image/png' } : {}) }] })
// Several attachments: an image by its name (no media type), else a file.
const attachAll = (...paths: string[]) => ({ attachments: paths.map(path => ({ path, size: 1000, isImage: /\.(png|jpe?g|webp)$/i.test(path) })) })
const prompt = (text: string, origin: any = { kind: 'composer' }, id = 'u-1') =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'UserMessage', requestId: id,
    props: { text, origin, isExpanded: true }, viewport: { columns: 100, rows: 40 },
  }) as any
const images = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Image' ? [tree] : []), ...(tree.children ?? []).flatMap(images)] : []
// Sets the mod up (as the first answer would) before a row draws.
const ready = ($: any) => $.command.run({ command: 'iui', args: '' } as any)

test('a PNG Claude sends draws under its row, at its own size', async ($, on) => {
  const { heads } = world(on, { files: { '/t/icon.png': HEAD } })
  await ready($)
  const ui = await $.ui.mount(sent(attach('/t/icon.png')))
  const tree: any = await ui.drawn()
  expect(tree.children[0]).toMatchObject(ENGINE)
  const [image] = images(tree)
  expect(image.props).toMatchObject({ columns: 40, rows: 10, alt: 'icon.png' })
  expect(image.props.source).toMatchObject({ file: '/t/icon.png', format: 'png' })
  // A redraw does not read the header again.
  await ui.redraw(sent(attach('/t/icon.png')).props)
  expect(images(await ui.drawn()).length).toBe(1)
  expect(heads).toEqual(['/t/icon.png'])
})

test('over ssh, a PNG Claude sends goes as bytes', async ($, on) => {
  const { reads } = world(on, { vars: { SSH_CONNECTION: '10.0.0.2 50000 10.0.0.1 22' }, files: { '/t/icon.png': HEAD } })
  await ready($)
  const ui = await $.ui.mount(sent(attach('/t/icon.png')))
  expect(images(await ui.drawn())[0].props.source).toEqual({ png: PNG })
  expect(reads).toEqual(['/t/icon.png'])
})

test('a file that is not an image, a JPEG and a missing file leave the row as it is', async ($, on) => {
  world(on, { files: { '/t/notes.txt': HEAD, '/t/photo.png': JPEG } })
  await ready($)
  const outputs = [attach('/t/notes.txt', false), attach('/t/photo.png'), attach('/t/gone.png')]
  for (const [i, output] of outputs.entries()) {
    const ui = await $.ui.mount(sent(output, false, `tu-${i}`))
    expect(await ui.drawn()).toMatchObject(ENGINE)
    expect(images(await ui.drawn())).toEqual([])
  }
})

test('a JPEG, a WebP and an SVG Claude sends are made PNGs by Typst once, and draw under the row', async ($, on) => {
  const { converts, moves, heads } = world(on, { typst: true, files: { '/t/photo.jpg': JPEG, '/t/shot.webp': '', '/t/chart.svg': '<svg/>' } })
  await ready($)
  const output = { attachments: [
    { path: '/t/photo.jpg', size: 1000, isImage: true, media_type: 'image/jpeg' },
    { path: '/t/shot.webp', size: 1000, isImage: true, media_type: 'image/webp' },
    { path: '/t/chart.svg', size: 1000, isImage: false, media_type: 'image/svg+xml' },
  ] }
  const ui = await $.ui.mount(sent(output))
  const tree: any = await ui.drawn()
  expect(tree.children[0]).toMatchObject(ENGINE)
  const shown = images(tree)
  expect(shown.map(i => i.props.alt)).toEqual(['photo.jpg', 'shot.webp', 'chart.svg'])
  expect(shown[0].props).toMatchObject({ columns: 40, rows: 10 })
  expect(shown[0].props.source.file).toMatch(/^\/c\/[0-9a-f]{16}\/image\.png$/)
  expect(shown[0].props.source.file).not.toBe(shown[1].props.source.file)
  expect(converts.map(argv => argv.find(a => a.startsWith('f=')))).toEqual(['f=/t/photo.jpg', 'f=/t/shot.webp', 'f=/t/chart.svg'])
  // Made to fit the space of the picture: 98 x 20 cells of 16 x 32 px.
  expect(converts[0]).toContain('maxw=1568')
  expect(converts[0]).toContain('maxh=640')
  // Typst writes a part file; only a whole one is moved to image.png.
  const out = shown[0].props.source.file
  expect(converts[0]!.at(-1)).toBe(out.replace(/image\.png$/, 'image.part.png'))
  expect(moves[0]).toEqual(['mv', '-f', converts[0]!.at(-1), out])
  // A redraw converts nothing again, and the JPEG's own bytes are never read as a PNG.
  await ui.redraw(sent(output).props)
  expect(images(await ui.drawn()).length).toBe(3)
  expect(converts.length).toBe(3)
  expect(heads).not.toContain('/t/photo.jpg')
})

// ---- PDFs ---------------------------------------------------------------------

// PDFs as Claude Code sends them: not images, the media type application/pdf.
const pdfs = (...paths: string[]) => ({ attachments: paths.map(path => ({ path, size: 1000, isImage: false, media_type: 'application/pdf' })) })
const all = (tree: any, type: string): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === type ? [tree] : []), ...(tree.children ?? []).flatMap((c: any) => all(c, type))] : []
const textOf = (tree: any): string => (typeof tree === 'string' ? tree : (tree?.children ?? []).map(textOf).join(''))
const pageArgs = (converts: string[][]) => converts.map(argv => `${argv.find(a => a.startsWith('f='))!.slice(2)}#${argv.find(a => a.startsWith('page='))?.slice(5)}`)
// The control line under the picture `i` of a SendUserFile row.
const lineOf = (tree: any, i = 0) => tree.children[1].children[i].children[1]
// A refresh (here a setting): the rows draw anew and see a new stat.
const refreshed = async ($: any, clock: any) => {
  await $.command.run({ command: 'iui', args: 'size 100' } as any)
  await clock.settle()
}
const PANE = {
  plugin: 'cc-intelligent-ui', surface: 'terminal' as const, component: 'Pane' as const, requestId: 'iui-page',
  props: { title: 'Page', isFocused: true, bodyColumns: 24, placement: 'inline' } as any, viewport: { columns: 100, rows: 40 },
}

test('a PDF Claude sends draws its first page with a control line; the next page is made too', async ($, on) => {
  const { converts } = world(on, { typst: true, pdfs: { '/t/doc.pdf': 3 }, files: { '/t/doc.pdf': '' } })
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  const tree: any = await ui.drawn()
  expect(tree.children[0]).toMatchObject(ENGINE)
  const [image] = images(tree)
  expect(image.props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 1))
  expect(image.props.alt).toBe('doc.pdf')
  expect(pageArgs(converts)).toEqual(['/t/doc.pdf#1', '/t/doc.pdf#2'])
  expect(converts[0]).toContain('maxw=1568')
  // One row: ‹ dim (page 1), the page number and › as Buttons; no page count.
  const line = lineOf(tree)
  expect(line.props).toMatchObject({ height: 1 })
  expect(textOf(line)).toBe('‹  1  ›')
  expect(line.children[0]).toMatchObject({ type: 'Text', props: { dimColor: true } })
  expect(all(line, 'Button').map(b => b.props.key)).toEqual(['pdf0-page-number', 'pdf0-page-forward'])
  // A redraw makes nothing again.
  await ui.redraw(sent(pdfs('/t/doc.pdf')).props)
  expect(converts.length).toBe(2)
})

test('› and ‹ turn the pages: the page made ahead draws at once; › is dim on the last page', async ($, on) => {
  const { clock, converts } = world(on, { typst: true, pdfs: { '/t/doc.pdf': 3 }, files: { '/t/doc.pdf': '' } })
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  await ui.press({ key: 'pdf0-page-forward' })
  let tree: any = await ui.drawn()
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 2))
  expect(textOf(lineOf(tree))).toBe('‹  2  ›')
  expect(all(lineOf(tree), 'Button').map(b => b.props.key)).toEqual(['pdf0-page-back', 'pdf0-page-number', 'pdf0-page-forward'])
  await clock.settle()
  expect(pageArgs(converts)).toEqual(['/t/doc.pdf#1', '/t/doc.pdf#2', '/t/doc.pdf#3'])
  await ui.press({ key: 'pdf0-page-forward' })
  await clock.settle()
  tree = await ui.drawn()
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 3))
  // Page 4 is not there: page 3 is the last, › is dim.
  expect(pageArgs(converts)).toEqual(['/t/doc.pdf#1', '/t/doc.pdf#2', '/t/doc.pdf#3', '/t/doc.pdf#4'])
  expect(textOf(lineOf(tree))).toBe('‹  3  ›')
  expect(lineOf(tree).children.at(-1)).toMatchObject({ type: 'Text', props: { dimColor: true } })
  expect(all(lineOf(tree), 'Button').map(b => b.props.key)).toEqual(['pdf0-page-back', 'pdf0-page-number'])
  // Back to page 2: made before, no run.
  await ui.press({ key: 'pdf0-page-back' })
  await clock.settle()
  tree = await ui.drawn()
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 2))
  expect(converts.length).toBe(4)
})

test('a PDF of one page draws its page with no control line', async ($, on) => {
  const { converts } = world(on, { typst: true, pdfs: { '/t/one.pdf': 1 }, files: { '/t/one.pdf': '' } })
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/one.pdf')))
  const tree: any = await ui.drawn()
  expect(images(tree).map(i => i.props.source.file)).toEqual([convertedPath('/c', '/t/one.pdf', '1:1000', BOX, 1)])
  expect(all(tree, 'Button')).toEqual([])
  expect(textOf(tree.children[1])).toBe('')
  expect(pageArgs(converts)).toEqual(['/t/one.pdf#1', '/t/one.pdf#2'])
})

test('a PDF that Typst can not read: the row and one dim line with the error', async ($, on) => {
  world(on, { typst: true, failConvert: true, files: { '/t/locked.pdf': '' } })
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/locked.pdf')))
  const tree: any = await ui.drawn()
  expect(tree.children[0]).toMatchObject(ENGINE)
  expect(images(tree)).toEqual([])
  const [note] = tree.children[1].children
  expect(note).toMatchObject({ type: 'Text', props: { dimColor: true, wrap: 'truncate-end' } })
  expect(textOf(note)).toBe('PDF: boom')
})

test('two PDFs in one result: each its own page and control line', async ($, on) => {
  const { clock } = world(on, { typst: true, pdfs: { '/t/a.pdf': 3, '/t/b.pdf': 3 }, files: { '/t/a.pdf': '', '/t/b.pdf': '' } })
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/a.pdf', '/t/b.pdf')))
  await ui.press({ key: 'pdf1-page-forward' })
  await clock.settle()
  const tree: any = await ui.drawn()
  expect(images(tree).map(i => i.props.source.file)).toEqual([
    convertedPath('/c', '/t/a.pdf', '1:1000', BOX, 1),
    convertedPath('/c', '/t/b.pdf', '1:1000', BOX, 2),
  ])
  expect([textOf(lineOf(tree, 0)), textOf(lineOf(tree, 1))]).toEqual(['‹  1  ›', '‹  2  ›'])
  // Another row of the same PDF keeps its own page.
  const other = await $.ui.mount(sent(pdfs('/t/b.pdf'), false, 'tu-2'))
  expect(textOf(lineOf(await other.drawn()))).toBe('‹  1  ›')
})

test('the page number opens the page field: a page that is not there keeps it open with a note; a page goes there', async ($, on) => {
  const { clock, converts } = world(on, { typst: true, pdfs: { '/t/doc.pdf': 5 }, files: { '/t/doc.pdf': '' } })
  const opens: any[] = []
  const closes: any[] = []
  on('ui.open', async ($: any, e: any) => (opens.push(e), { value: { isPlaced: true } }))
  on('ui.close', async ($: any, e: any) => (closes.push(e), { value: undefined }))
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  await ui.press({ key: 'pdf0-page-number' })
  expect(opens).toMatchObject([{ id: 'iui-page', focus: true, closeOnEscape: true }])
  const field = await $.ui.mount(PANE)
  const input = () => field.drawn().then((tree: any) => all(tree, 'Input')[0])
  expect((await input()).props).toMatchObject({ key: 'page', value: '1', autoFocus: true })
  await field.input({ key: 'page', text: '9' })
  expect(textOf(await field.drawn())).toContain('No page 9')
  expect((await input()).props.value).toBe('9')
  expect(closes).toEqual([])
  // Page 12 is past page 9: known, no run.
  const runs = converts.length
  await field.input({ key: 'page', text: '12' })
  expect(textOf(await field.drawn())).toContain('No page 12')
  expect(converts.length).toBe(runs)
  await field.input({ key: 'page', text: 'two' })
  expect(textOf(await field.drawn())).toContain('Type a page number')
  await field.input({ key: 'page', text: ' 4 ' })
  expect(closes).toMatchObject([{ id: 'iui-page' }])
  await clock.settle()
  const tree: any = await ui.drawn()
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 4))
  expect(textOf(lineOf(tree))).toBe('‹  4  ›')
  expect(pageArgs(converts).filter(p => p === '/t/doc.pdf#4')).toEqual(['/t/doc.pdf#4'])
})

test('a file that got shorter under a row on a high page: one failed run, then its last page (the count in the hint)', async ($, on) => {
  const counts: Record<string, number> = { '/t/doc.pdf': 300 }
  const { clock, converts, mtimes } = world(on, { typst: true, pdfs: counts, files: { '/t/doc.pdf': '' } })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.close', async () => ({ value: undefined }))
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  await ui.press({ key: 'pdf0-page-number' })
  const field = await $.ui.mount(PANE)
  await field.input({ key: 'page', text: '299' })
  await clock.settle()
  expect(textOf(lineOf(await ui.drawn()))).toBe('‹  299  ›')
  counts['/t/doc.pdf'] = 3
  mtimes['/t/doc.pdf'] = 2
  const n = converts.length
  await refreshed($, clock)
  const tree: any = await ui.drawn()
  // Page 299 and the look-ahead for page 300 run side by side; then page 3.
  expect(pageArgs(converts.slice(n))).toEqual(['/t/doc.pdf#299', '/t/doc.pdf#300', '/t/doc.pdf#3'])
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '2:1000', BOX, 3))
  expect(textOf(lineOf(tree))).toBe('‹  3  ›')
  expect(all(lineOf(tree), 'Button').map(b => b.props.key)).toEqual(['pdf0-page-back', 'pdf0-page-number'])
  // The page is stored: ‹ goes to page 2.
  await ui.press({ key: 'pdf0-page-back' })
  await clock.settle()
  expect(textOf(lineOf(await ui.drawn()))).toBe('‹  2  ›')
})

test('a file that got shorter, with no count in the error: page 1 at once', async ($, on) => {
  const counts: Record<string, number> = { '/t/doc.pdf': 300 }
  const { clock, converts, mtimes } = world(on, { typst: true, noHint: true, pdfs: counts, files: { '/t/doc.pdf': '' } })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.close', async () => ({ value: undefined }))
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  await ui.press({ key: 'pdf0-page-number' })
  await (await $.ui.mount(PANE)).input({ key: 'page', text: '299' })
  await clock.settle()
  counts['/t/doc.pdf'] = 3
  mtimes['/t/doc.pdf'] = 2
  const n = converts.length
  await refreshed($, clock)
  const tree: any = await ui.drawn()
  expect(pageArgs(converts.slice(n))).toEqual(['/t/doc.pdf#299', '/t/doc.pdf#300', '/t/doc.pdf#1', '/t/doc.pdf#2'])
  expect(textOf(lineOf(tree))).toBe('‹  1  ›')
})

test('› while the next page is still made: the row waits for that page; past the last page it stays on the last page', async ($, on) => {
  let release = () => {}
  const until = new Promise<void>(done => (release = done))
  // Run 4 is the look-ahead for page 4, made while page 3 shows.
  const { clock, converts } = world(on, { typst: true, pdfs: { '/t/doc.pdf': 3 }, files: { '/t/doc.pdf': '' }, holdRun: { at: 4, until } })
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  await ui.press({ key: 'pdf0-page-forward' })
  await ui.press({ key: 'pdf0-page-forward' })
  let tree: any = await ui.drawn()
  expect(textOf(lineOf(tree))).toBe('‹  3  ›')
  expect(pageArgs(converts)).toEqual(['/t/doc.pdf#1', '/t/doc.pdf#2', '/t/doc.pdf#3', '/t/doc.pdf#4'])
  // Page 4 is not known yet: › still acts.
  const press = ui.press({ key: 'pdf0-page-forward' })
  release()
  await press
  await clock.settle()
  tree = await ui.drawn()
  // The row waited for page 4: it is not there, so page 3 (never page 3's picture with the number 4).
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 3))
  expect(textOf(lineOf(tree))).toBe('‹  3  ›')
  expect(all(lineOf(tree), 'Button').map(b => b.props.key)).toEqual(['pdf0-page-back', 'pdf0-page-number'])
  expect(converts.length).toBe(4)
  // One ‹ goes to page 2.
  await ui.press({ key: 'pdf0-page-back' })
  await clock.settle()
  tree = await ui.drawn()
  expect(textOf(lineOf(tree))).toBe('‹  2  ›')
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 2))
})

test('a page that fails for another reason: its error line and the control line, never the page before; the field says so too', async ($, on) => {
  // From run 3 (the look-ahead for page 3) Typst fails.
  const { clock, converts } = world(on, { typst: true, pdfs: { '/t/doc.pdf': 5 }, files: { '/t/doc.pdf': '' }, failConvertFrom: 3 })
  const closes: any[] = []
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.close', async ($: any, e: any) => (closes.push(e), { value: undefined }))
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  await ui.press({ key: 'pdf0-page-forward' })
  await clock.settle()
  await ui.press({ key: 'pdf0-page-forward' })
  await clock.settle()
  let tree: any = await ui.drawn()
  expect(images(tree)).toEqual([])
  const [box] = tree.children[1].children
  expect(textOf(box.children[0])).toBe('PDF: page 3: boom')
  expect(textOf(box.children[1])).toBe('‹  3  ›')
  // The failed page is not run again.
  expect(pageArgs(converts).filter(p => p === '/t/doc.pdf#3')).toEqual(['/t/doc.pdf#3'])
  await ui.press({ key: 'pdf0-page-back' })
  await clock.settle()
  tree = await ui.drawn()
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '1:1000', BOX, 2))
  // In the field: page 3 keeps it open, with the error.
  await ui.press({ key: 'pdf0-page-number' })
  const field = await $.ui.mount(PANE)
  await field.input({ key: 'page', text: '3' })
  expect(textOf(await field.drawn())).toContain('Page 3: boom')
  expect(closes).toEqual([])
})

test('the field opened from row A, then from row B while A\'s Enter runs: A\'s result is not used', async ($, on) => {
  let release = () => {}
  const until = new Promise<void>(done => (release = done))
  // Runs 1-4 draw the two rows; run 5 is A's page 7.
  const { clock, converts } = world(on, {
    typst: true, pdfs: { '/t/a.pdf': 9, '/t/b.pdf': 9 }, files: { '/t/a.pdf': '', '/t/b.pdf': '' }, holdRun: { at: 5, until },
  })
  const closes: any[] = []
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.close', async ($: any, e: any) => (closes.push(e), { value: undefined }))
  await ready($)
  const a = await $.ui.mount(sent(pdfs('/t/a.pdf'), false, 'tu-a'))
  const b = await $.ui.mount(sent(pdfs('/t/b.pdf'), false, 'tu-b'))
  expect(converts.length).toBe(4)
  const field = await $.ui.mount(PANE)
  await a.press({ key: 'pdf0-page-number' })
  const enter = field.input({ key: 'page', text: '7' })
  while (converts.length < 5) await clock.settle()
  await b.press({ key: 'pdf0-page-number' })
  release()
  await enter
  await clock.settle()
  // The field is B's, still open, with B's page and no note.
  expect(closes).toEqual([])
  const input = all(await field.drawn(), 'Input')[0]
  expect(input.props.value).toBe('1')
  expect(textOf(await field.drawn())).toBe('')
  expect(textOf(lineOf(await a.drawn()))).toBe('‹  1  ›')
  expect(textOf(lineOf(await b.drawn()))).toBe('‹  1  ›')
  // Two Enters: the later one acts.
  await field.input({ key: 'page', text: '5' })
  expect(textOf(lineOf(await b.drawn()))).toBe('‹  5  ›')
})

test('a run of the old file that ends after the file changed does not change what is known of the new file', async ($, on) => {
  let release = () => {}
  const until = new Promise<void>(done => (release = done))
  // Run 3 is the look-ahead for page 3 of the old file.
  const counts: Record<string, number> = { '/t/doc.pdf': 3 }
  const { clock, converts, mtimes } = world(on, { typst: true, pdfs: counts, files: { '/t/doc.pdf': '' }, holdRun: { at: 3, until } })
  await ready($)
  const ui = await $.ui.mount(sent(pdfs('/t/doc.pdf')))
  await ui.press({ key: 'pdf0-page-forward' })
  expect(converts.length).toBe(3)
  // The file now has one page.
  counts['/t/doc.pdf'] = 1
  mtimes['/t/doc.pdf'] = 2
  await refreshed($, clock)
  let tree: any = await ui.drawn()
  expect(images(tree)[0].props.source.file).toBe(convertedPath('/c', '/t/doc.pdf', '2:1000', BOX, 1))
  expect(all(tree, 'Button')).toEqual([])
  const n = converts.length
  // The old run ends (as made): the new file's facts stay.
  counts['/t/doc.pdf'] = 3
  release()
  await clock.settle()
  await refreshed($, clock)
  tree = await ui.drawn()
  expect(all(tree, 'Button')).toEqual([])
  expect(converts.length).toBe(n)
})

test('a JPEG by its name; two rows at once convert it once; a changed file converts again', async ($, on) => {
  // The first row's run ends only after the second row read the file's stat.
  const { converts, mtimes } = world(on, { typst: true, holdConvert: 2, files: { '/t/a.JPG': JPEG } })
  await ready($)
  const [one, two] = await Promise.all([$.ui.mount(sent(attachAll('/t/a.JPG'), false, 'tu-1')), $.ui.mount(sent(attachAll('/t/a.JPG'), false, 'tu-2'))])
  const first = images(await one.drawn())[0].props.source.file
  expect(images(await two.drawn())[0].props.source.file).toBe(first)
  expect(converts.length).toBe(1)
  mtimes['/t/a.JPG'] = 5
  const three = await $.ui.mount(sent(attachAll('/t/a.JPG'), false, 'tu-3'))
  expect(images(await three.drawn())[0].props.source.file).not.toBe(first)
  expect(converts.length).toBe(2)
})

test('a new box: the last PNG draws until the epoch commits; the PNG for the target is made meanwhile and the commit waits for it', async ($, on) => {
  let release = () => {}
  const until = new Promise<void>(done => (release = done))
  const { clock, converts } = world(on, { typst: true, holdRun: { at: 2, until }, files: { '/t/photo.jpg': JPEG } })
  await ready($)
  const wide = await $.ui.mount(sent(attachAll('/t/photo.jpg'), false, 'tu-1'))
  const first = images(await wide.drawn())[0].props.source.file
  expect(converts.length).toBe(1)
  // The transcript gets narrower (58 columns, so another box): nothing runs
  // until it is quiet.
  await wide.unmount()
  const narrow = await $.ui.mount({ ...sent(attachAll('/t/photo.jpg'), false, 'tu-1'), viewport: { columns: 60, rows: 40 } })
  expect(images(await narrow.drawn())[0].props.source.file).toBe(first)
  expect(converts.length).toBe(1)
  // Quiet: the epoch begins; the old PNG draws, the target's is made.
  await clock.advance(RESIZE_QUIET_MS)
  expect(images(await narrow.drawn())[0].props.source.file).toBe(first)
  expect(converts.length).toBe(2)
  expect(converts[1]).toContain('maxw=928')
  // While it runs, a redraw does not run it again, and the epoch waits.
  await clock.advance(COMMIT_MIN_MS)
  await narrow.redraw(sent(attachAll('/t/photo.jpg'), false, 'tu-1').props)
  expect(images(await narrow.drawn())[0].props.source.file).toBe(first)
  expect(images(await narrow.drawn())[0].props.columns).toBe(40)
  expect(converts.length).toBe(2)
  release()
  await clock.settle()
  // The commit drew the row again: its own PNG now.
  const now = images(await narrow.drawn())[0].props.source.file
  expect(now).toBe(convertedPath('/c', '/t/photo.jpg', '1:1000', { width: 928, height: 640 }))
  expect(converts.length).toBe(2)
})

test('a failed run for a new box keeps the last PNG', async ($, on) => {
  // The second run (the new box) fails.
  const { clock, converts, logs } = world(on, { typst: true, failConvertFrom: 2, files: { '/t/photo.jpg': JPEG } })
  await ready($)
  const wide = await $.ui.mount(sent(attachAll('/t/photo.jpg'), false, 'tu-1'))
  const first = images(await wide.drawn())[0].props.source.file
  await wide.unmount()
  const narrow = await $.ui.mount({ ...sent(attachAll('/t/photo.jpg'), false, 'tu-1'), viewport: { columns: 60, rows: 40 } })
  await clock.advance(RESIZE_QUIET_MS)
  await clock.advance(COMMIT_MIN_MS)
  await narrow.redraw(sent(attachAll('/t/photo.jpg'), false, 'tu-1').props)
  expect(images(await narrow.drawn())[0].props.source.file).toBe(first)
  expect(converts.length).toBe(2)
  expect(logs.join('')).toContain('convert /t/photo.jpg failed')
})

test('a sent PNG keeps its generation when the viewport changes; only its box follows', async ($, on) => {
  // 3136 x 640 px: wider than the transcript.
  const WIDE = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 0c 40 00 00 02 80'
  const { clock } = world(on, { files: { '/t/wide.png': WIDE } })
  await ready($)
  const ui = await $.ui.mount(sent(attach('/t/wide.png')))
  const [before] = images(await ui.drawn())
  expect(before.props.columns).toBe(98)
  await ui.unmount()
  const narrow = await $.ui.mount({ ...sent(attach('/t/wide.png')), viewport: { columns: 60, rows: 40 } })
  // Not quiet yet: the box on screen, made smaller to fit the room.
  expect(images(await narrow.drawn())[0].props.columns).toBe(58)
  await clock.advance(RESIZE_QUIET_MS)
  await clock.advance(COMMIT_MIN_MS)
  const [after] = images(await narrow.drawn())
  expect(after.props.columns).toBe(58)
  expect(after.props.source.generation).toBe(before.props.source.generation)
})

test('over ssh, a converted JPEG goes as bytes', async ($, on) => {
  const { reads } = world(on, { typst: true, vars: { SSH_CONNECTION: '10.0.0.2 50000 10.0.0.1 22' }, files: { '/t/photo.jpg': JPEG } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/photo.jpg')))
  expect(images(await ui.drawn())[0].props.source).toEqual({ png: PNG })
  expect(reads.length).toBe(1)
  expect(reads[0]).toMatch(/^\/c\/[0-9a-f]{16}\/image\.png$/)
})

test('with no Typst, or a conversion that fails, a JPEG leaves the row as it is', async ($, on) => {
  const { converts, moves, logs, files } = world(on, { typst: true, failConvert: true, files: { '/t/photo.jpg': JPEG } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/photo.jpg')))
  expect(await ui.drawn()).toMatchObject(ENGINE)
  expect(converts.length).toBe(1)
  expect(logs.join('')).toContain('convert /t/photo.jpg failed')
  // Nothing is moved, so no image.png is there for a later load.
  expect(moves).toEqual([])
  expect(Object.keys(files).filter(f => f.endsWith('/image.png'))).toEqual([])
  // The failure is kept for this stamp: no second run.
  await ui.redraw(sent(attachAll('/t/photo.jpg')).props)
  expect(converts.length).toBe(1)
})

test('a part file that can not be moved draws no picture; an image.png made before is used with no run', async ($, on) => {
  const { converts, logs, files } = world(on, { typst: true, failMove: true, files: { '/t/photo.jpg': JPEG, '/t/old.jpg': JPEG } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/photo.jpg'), false, 'tu-1'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
  expect(converts.length).toBe(1)
  expect(logs.join('')).toContain('convert /t/photo.jpg: could not move')
  expect(Object.keys(files).filter(f => f.endsWith('/image.png'))).toEqual([])
  // An earlier load made the PNG of old.jpg (same stamp): no run, it draws.
  files[convertedPath('/c', '/t/old.jpg', '1:1000', BOX)] = HEAD
  const old = await $.ui.mount(sent(attachAll('/t/old.jpg'), false, 'tu-2'))
  expect(images(await old.drawn())[0].props.source.file).toBe(convertedPath('/c', '/t/old.jpg', '1:1000', BOX))
  expect(converts.length).toBe(1)
})

test('with no Typst, a JPEG and a Markdown file leave the row as it is; a PNG still draws', async ($, on) => {
  const { converts } = world(on, { files: { '/t/photo.jpg': JPEG, '/t/icon.png': HEAD }, texts: { '/t/notes.md': '# Notes' } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/photo.jpg', '/t/notes.md', '/t/icon.png')))
  const shown = images(await ui.drawn())
  expect(shown.map(i => i.props.alt)).toEqual(['icon.png'])
  expect(converts).toEqual([])
})

test('a Markdown file Claude sends draws as pictures under the row, its images by its own folder', async ($, on) => {
  const text = '# Notes\n\n![pic](pic.png) and ![gone](gone.png)'
  const { clock, docs } = world(on, { typst: true, files: { '/t/docs/pic.png': HEAD }, texts: { '/t/docs/notes.md': text } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/docs/notes.md')))
  await clock.settle()
  await ui.redraw(sent(attachAll('/t/docs/notes.md')).props)
  const tree: any = await ui.drawn()
  expect(tree.children[0]).toMatchObject(ENGINE)
  const [page] = images(tree)
  expect(page.props.columns).toBe(98)
  expect(page.props.source.file).toMatch(/^\/c\/[0-9a-f]{16}\/a-1\.png$/)
  expect(docs).toEqual([{ base: '/t/docs', segments: [text], images: ['pic.png', '/t/docs/pic.png'] }])
})

test("a Markdown file's links, files and commands draw under its pages; its relative paths start from its own folder", async ($, on) => {
  const text = '# Notes\n\nSee `pic.png`, `gone.ts` and https://typst.app.\n\n```sh\nnpm test\n```'
  const { clock } = world(on, { typst: true, files: { '/t/docs/pic.png': HEAD }, texts: { '/t/docs/notes.md': text } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/docs/notes.md')))
  await clock.settle()
  await ui.redraw(sent(attachAll('/t/docs/notes.md')).props)
  const tree: any = await ui.drawn()
  const all = (t: any, type: string): any[] =>
    t && typeof t === 'object' ? [...(t.type === type ? [t] : []), ...(t.children ?? []).flatMap((c: any) => all(c, type))] : []
  expect(all(tree, 'Link').map(l => l.props.href)).toEqual(['file:///t/docs/pic.png', 'https://typst.app'])
  const [button] = all(tree, 'Button')
  expect(button.props.key).toMatch(/^file0-link-[0-9a-f]{8}$/)
})

test('the same Markdown in two folders compiles twice; an answer still uses the session folder', async ($, on) => {
  const { clock, docs } = world(on, { typst: true, texts: { '/t/a/n.md': '# Same', '/t/b/n.md': '# Same' } })
  await ready($)
  const a = await $.ui.mount(sent(attachAll('/t/a/n.md'), false, 'tu-a'))
  const b = await $.ui.mount(sent(attachAll('/t/b/n.md'), false, 'tu-b'))
  await clock.settle()
  await a.redraw(sent(attachAll('/t/a/n.md'), false, 'tu-a').props)
  await b.redraw(sent(attachAll('/t/b/n.md'), false, 'tu-b').props)
  expect(images(await a.drawn())[0].props.source.file).not.toBe(images(await b.drawn())[0].props.source.file)
  const answer = { plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AssistantMessage', requestId: 'r-1', props: { text: '# Same', isFirstOfReply: true }, viewport: { columns: 100, rows: 40 } } as any
  await $.ui.mount(answer)
  await clock.settle()
  expect(docs.map(d => d.base)).toEqual(['/t/a', '/t/b', '/w/app'])
})

test('while a Markdown file compiles: an empty space, then for a moment the row alone, then its pictures', async ($, on) => {
  let release = () => {}
  const holdCompile = new Promise<void>(done => (release = done))
  const { clock } = world(on, { typst: true, holdCompile, files: { '/t/one.png': HEAD }, texts: { '/t/notes.md': '# Notes' } })
  await ready($)
  const output = attachAll('/t/notes.md', '/t/one.png')
  const ui = await $.ui.mount(sent(output))
  const blank: any = await ui.drawn()
  expect(blank.children[0]).toMatchObject(ENGINE)
  expect(blank.children[1].children[0]).toMatchObject({ type: 'Box', props: { key: 'blank-0' } })
  expect(images(blank).map(i => i.props.alt)).toEqual(['one.png'])
  // Not ready after 1 s: the Markdown file draws nothing, the image stays.
  await clock.advance(1000)
  await ui.redraw(sent(output).props)
  const text: any = await ui.drawn()
  expect(text.children[1].children.length).toBe(1)
  expect(images(text).map(i => i.props.alt)).toEqual(['one.png'])
  release()
  await clock.settle()
  await ui.redraw(sent(output).props)
  expect(images(await ui.drawn()).map(i => i.props.alt)).toEqual(['Notes', 'one.png'])
})

test('a kept SendUserFile row gives a new onScreen to its Markdown files\' jobs: one known off screen does not hold the commit', async ($, on) => {
  // 3136 x 640 px: its box follows the columns, so it shows the commit.
  const WIDE = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 0c 40 00 00 02 80'
  const o: Parameters<typeof world>[1] = { typst: true, files: { '/t/wide.png': WIDE }, texts: { '/t/notes.md': '# Notes' } }
  const { clock, redraws } = world(on, o)
  await ready($)
  const output = attachAll('/t/wide.png', '/t/notes.md')
  const ui = await $.ui.mount(sent(output))
  await clock.settle()
  await ui.redraw(sent(output).props)
  expect(images(await ui.drawn()).map(i => i.props.columns)).toEqual([98, 98])
  // Narrower: the epoch's compile of the Markdown file is held.
  let release = () => {}
  o.holdCompile = new Promise<void>(done => (release = done))
  await ui.unmount()
  const narrow = await $.ui.mount({ ...sent(output), viewport: { columns: 60, rows: 40 } })
  await clock.advance(RESIZE_QUIET_MS)
  await narrow.redraw(sent(output).props)
  // The old boxes, made smaller to fit the room.
  expect(images(await narrow.drawn()).map(i => i.props.columns)).toEqual([58, 58])
  // Scrolled off screen: the kept row, and its job no longer holds the commit
  // (its one redraw).
  await narrow.redraw({ ...sent(output).props, onScreen: null })
  const before = redraws()
  await clock.advance(COMMIT_MIN_MS)
  expect(redraws()).toBe(before + 1)
  await narrow.redraw(sent(output).props)
  expect(images(await narrow.drawn())[0].props.columns).toBe(58)
  release()
  await clock.settle()
})

test('images and Markdown files draw in the attachments order', async ($, on) => {
  const { clock } = world(on, { typst: true, files: { '/t/one.png': HEAD, '/t/two.jpg': JPEG }, texts: { '/t/notes.md': '# Notes' } })
  await ready($)
  const output = attachAll('/t/one.png', '/t/notes.md', '/t/two.jpg')
  const ui = await $.ui.mount(sent(output))
  await clock.settle()
  await ui.redraw(sent(output).props)
  const shown = images(await ui.drawn())
  expect(shown.length).toBe(3)
  expect(shown[0].props.source.file).toBe('/t/one.png')
  expect(shown[1].props.source.file).toMatch(/\/a-1\.png$/)
  expect(shown[2].props.alt).toBe('two.jpg')
  // Each Image has a key of its own in the tree.
  expect(new Set(shown.map(i => i.props.key)).size).toBe(3)
})

test('a Markdown file that is empty, too large, gone or not Markdown leaves the row as it is', async ($, on) => {
  const { clock, docs, reads } = world(on, {
    typst: true, texts: { '/t/empty.md': ' \n\n', '/t/big.md': `# Big\n${'x'.repeat(256 * 1024)}`, '/t/notes.txt': '# Text' },
  })
  await ready($)
  for (const [i, path] of ['/t/empty.md', '/t/big.md', '/t/gone.md', '/t/notes.txt'].entries()) {
    const ui = await $.ui.mount(sent(attachAll(path), false, `tu-${i}`))
    await clock.settle()
    expect(await ui.drawn()).toMatchObject(ENGINE)
  }
  expect(docs).toEqual([])
  expect(reads).toEqual(['/t/empty.md'])
})

test('a Markdown file is read again only when its stat changes, seen at the next refresh', async ($, on) => {
  const { clock, docs, reads, texts, mtimes } = world(on, { typst: true, texts: { '/t/n.md': '# One' } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/n.md')))
  await clock.settle()
  await ui.redraw(sent(attachAll('/t/n.md')).props)
  expect(reads).toEqual(['/t/n.md'])
  texts['/t/n.md'] = '# Two'
  mtimes['/t/n.md'] = 2
  // A redraw with nothing new (a scroll step) reads no file.
  await ui.redraw(sent(attachAll('/t/n.md')).props)
  await clock.settle()
  expect(reads).toEqual(['/t/n.md'])
  // A refresh (here a setting) draws the row anew: the new stat is seen.
  await $.command.run({ command: 'iui', args: 'size 100' } as any)
  await clock.settle()
  await ui.redraw(sent(attachAll('/t/n.md')).props)
  await clock.settle()
  expect(reads).toEqual(['/t/n.md', '/t/n.md'])
  expect(docs.map(d => d.segments.join(''))).toEqual(['# One', '# Two'])
})

test('an errored SendUserFile call leaves the row as it is', async ($, on) => {
  world(on, { files: { '/t/icon.png': HEAD } })
  await ready($)
  const ui = await $.ui.mount(sent(attach('/t/icon.png'), true))
  expect(await ui.drawn()).toMatchObject(ENGINE)
})

test('an image the user pastes draws under the prompt', async ($, on) => {
  world(on, { files: { [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED] })
  await ready($)
  const ui = await $.ui.mount(prompt('[Image #5] what is this'))
  const tree: any = await ui.drawn()
  expect(tree.children[0]).toMatchObject(ENGINE)
  const [image] = images(tree)
  expect(image.props.source).toMatchObject({ file: `${PASTED}/5.png`, format: 'png' })
  expect(image.props).toMatchObject({ columns: 40, rows: 10 })
})

test('a pasted image is found when the folder name is not the plain slug', async ($, on) => {
  const cut = '/private/tmp/claude-501/-w-app-cut-1a2b/sid-1/images'
  world(on, { files: { [`${cut}/2.png`]: HEAD }, dirs: [cut], projects: ['-other', '-w-app-cut-1a2b'] })
  await ready($)
  const ui = await $.ui.mount(prompt('look: [Image #2]'))
  expect(images(await ui.drawn())[0].props.source.file).toBe(`${cut}/2.png`)
})

test('a pasted image whose file is gone leaves the prompt as it is', async ($, on) => {
  world(on, { dirs: [PASTED] })
  await ready($)
  const ui = await $.ui.mount(prompt('[Image #7] and this'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
})

test('a message from another agent or a notification is not changed', async ($, on) => {
  world(on, { files: { [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED] })
  await ready($)
  for (const input of [prompt('[Image #5]', { kind: 'peer' }, 'u-1'), prompt('[Image #5]', { kind: 'task-notification' }, 'u-2')]) {
    const ui = await $.ui.mount(input)
    expect(await ui.drawn()).toMatchObject(ENGINE)
  }
})

test('with Intelligent UI off, rows stay as they are', async ($, on) => {
  world(on, { files: { '/t/icon.png': HEAD, [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED] })
  await ready($)
  await $.command.run({ command: 'iui', args: 'off' } as any)
  expect(await (await $.ui.mount(sent(attach('/t/icon.png')))).drawn()).toMatchObject(ENGINE)
  expect(await (await $.ui.mount(prompt('[Image #5] hi'))).drawn()).toMatchObject(ENGINE)
})

test('in a terminal that draws no pictures, rows stay as they are', async ($, on) => {
  world(on, { vars: { TERM: 'xterm-256color' }, files: { '/t/icon.png': HEAD, [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED] })
  const shown = await ready($)
  expect(shown.text).toContain('This terminal shows no pictures')
  expect(await (await $.ui.mount(sent(attach('/t/icon.png')))).drawn()).toMatchObject(ENGINE)
  expect(await (await $.ui.mount(prompt('[Image #5] hi'))).drawn()).toMatchObject(ENGINE)
})

// ---- The height setting -------------------------------------------------------

test('a kept height caps sent and pasted images; height full draws them taller at the commit', async ($, on) => {
  const { clock, kept } = world(on, { stored: { height: 12 }, files: { '/t/tall.png': TALL, [`${PASTED}/5.png`]: TALL }, dirs: [PASTED] })
  const ran = await ready($)
  expect(ran.text).toContain('height 12 rows')
  const ui = await $.ui.mount(sent(attach('/t/tall.png')))
  expect(images(await ui.drawn())[0].props.rows).toBe(12)
  const pasted = await $.ui.mount(prompt('[Image #5] tall'))
  expect(images(await pasted.drawn())[0].props.rows).toBe(12)
  const set = await $.command.run({ command: 'iui', args: 'height full' } as any)
  expect(set.text).toContain('full (the terminal height less 16 rows)')
  expect(kept.height).toBe('full')
  // The epoch is open: the box on screen stays.
  await ui.redraw(sent(attach('/t/tall.png')).props)
  expect(images(await ui.drawn())[0].props.rows).toBe(12)
  // It commits: 40 rows less 16.
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(sent(attach('/t/tall.png')).props)
  expect(images(await ui.drawn())[0].props.rows).toBe(24)
  await pasted.redraw(prompt('[Image #5] tall').props)
  expect(images(await pasted.drawn())[0].props.rows).toBe(24)
  // A number is never more than full.
  await $.command.run({ command: 'iui', args: 'height 36' } as any)
  expect(kept.height).toBe(36)
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(sent(attach('/t/tall.png')).props)
  expect(images(await ui.drawn())[0].props.rows).toBe(24)
  // Half, the default: half of 40 rows.
  await $.command.run({ command: 'iui', args: 'height half' } as any)
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(sent(attach('/t/tall.png')).props)
  expect(images(await ui.drawn())[0].props.rows).toBe(20)
})

test('a height command while an epoch is open keeps the image box until the commit', async ($, on) => {
  let release = () => {}
  const until = new Promise<void>(done => (release = done))
  // The second convert (the JPEG for the new height) holds the commit.
  const { clock, converts } = world(on, { typst: true, stored: { height: 12 }, holdRun: { at: 2, until }, files: { '/t/tall.png': TALL, '/t/photo.jpg': JPEG } })
  await ready($)
  const output = attachAll('/t/tall.png', '/t/photo.jpg')
  const ui = await $.ui.mount(sent(output))
  expect(images(await ui.drawn()).map(i => i.props.rows)).toEqual([12, 10])
  // An epoch is open (a new text size), then the height changes.
  await $.command.run({ command: 'iui', args: 'size 90' } as any)
  await $.command.run({ command: 'iui', args: 'height full' } as any)
  await ui.redraw(sent(output).props)
  expect(images(await ui.drawn())[0].props.rows).toBe(12)
  expect(converts[1]).toContain('maxh=768')
  // Past COMMIT_MIN_MS the convert still runs: the box stays.
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(sent(output).props)
  expect(images(await ui.drawn())[0].props.rows).toBe(12)
  // It ends: the epoch commits, the PNG and the JPEG change together.
  release()
  await clock.settle()
  const [png, jpeg] = images(await ui.drawn())
  expect(png.props.rows).toBe(24)
  expect(jpeg.props.source.file).toBe(convertedPath('/c', '/t/photo.jpg', '1:1000', { width: 1568, height: 768 }))
  expect(converts.length).toBe(2)
})

test('in an open epoch a JPEG with no PNG made in this load (a resumed session) is converted once, for the target, and draws at the commit', async ($, on) => {
  let release = () => {}
  const until = new Promise<void>(done => (release = done))
  const { clock, converts } = world(on, { typst: true, holdRun: { at: 1, until }, files: { '/t/photo.jpg': JPEG } })
  await ready($)
  await $.command.run({ command: 'iui', args: 'height full' } as any)
  const ui = await $.ui.mount(sent(attachAll('/t/photo.jpg')))
  // Nothing under the row for it until the commit; only the target's PNG is made.
  expect(images(await ui.drawn()).length).toBe(0)
  expect(converts.length).toBe(1)
  expect(converts[0]).toContain('maxh=768')
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(sent(attachAll('/t/photo.jpg')).props)
  expect(images(await ui.drawn()).length).toBe(0)
  expect(converts.length).toBe(1)
  release()
  await clock.settle()
  expect(images(await ui.drawn())[0].props.source.file).toBe(convertedPath('/c', '/t/photo.jpg', '1:1000', { width: 1568, height: 768 }))
  expect(converts.length).toBe(1)
})

test('a size, width or height command begins its epoch (one redraw) before the setting is stored', async ($, on) => {
  const { redrawsAt, redraws } = world(on)
  await ready($)
  for (const [args, key] of [['size 90', 'size'], ['width 80', 'width'], ['height full', 'height']] as const) {
    const before = redraws()
    await $.command.run({ command: 'iui', args } as any)
    expect(redrawsAt[key]).toBe(before + 1)
  }
})

test('a new height makes a new PNG of a JPEG in the background; the last one draws meanwhile', async ($, on) => {
  let release = () => {}
  const until = new Promise<void>(done => (release = done))
  const { clock, converts } = world(on, { typst: true, holdRun: { at: 2, until }, files: { '/t/photo.jpg': JPEG } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/photo.jpg')))
  const first = images(await ui.drawn())[0].props.source.file
  expect(converts[0]).toContain('maxh=640')
  await $.command.run({ command: 'iui', args: 'height full' } as any)
  await ui.redraw(sent(attachAll('/t/photo.jpg')).props)
  expect(images(await ui.drawn())[0].props.source.file).toBe(first)
  // 24 rows of 32 px.
  expect(converts[1]).toContain('maxh=768')
  // The run ends: the epoch commits, its refresh draws the row again, with the new PNG.
  release()
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  expect(images(await ui.drawn())[0].props.source.file).toBe(convertedPath('/c', '/t/photo.jpg', '1:1000', { width: 1568, height: 768 }))
})

test('a background run that ends while the row draws still draws its PNG', async ($, on) => {
  const { clock, converts } = world(on, { typst: true, files: { '/t/photo.jpg': JPEG } })
  await ready($)
  const ui = await $.ui.mount(sent(attachAll('/t/photo.jpg')))
  const first = images(await ui.drawn())[0].props.source.file
  await $.command.run({ command: 'iui', args: 'height full' } as any)
  await ui.redraw(sent(attachAll('/t/photo.jpg')).props)
  expect(converts.length).toBe(2)
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  const now = images(await ui.drawn())[0].props.source.file
  expect(now).not.toBe(first)
  expect(now).toBe(convertedPath('/c', '/t/photo.jpg', '1:1000', { width: 1568, height: 768 }))
})

test('height with no value shows it; a bad value is refused; a bad kept value is the default', async ($, on) => {
  const { kept } = world(on, { stored: { height: 3 } })
  const shown = await $.command.run({ command: 'iui', args: 'height' } as any)
  expect(shown.text).toContain('The most rows an image or a Typst drawing takes: half (half the terminal, 6 to 24 rows)')
  expect(shown.text).toContain('This applies to images (sent or pasted) and to Typst drawings in answers.')
  const bad = await $.command.run({ command: 'iui', args: 'height 5' } as any)
  expect(bad.text).toContain('Not understood: "height 5"')
  expect(kept.height).toBe(undefined)
  await $.command.run({ command: 'iui', args: 'height 200' } as any)
  expect(kept.height).toBe(200)
})
