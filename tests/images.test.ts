import { expect, mock, test } from 'claude-code/testing'

import {
  claudeTmpOf, DEFAULT_CELL, pasteDirOf, pastedImagePath, pastedNumbers, PICTURE_MAX_ROWS, pictureCells, pictureRowsFor,
  projectSlug, sentImages,
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
  expect(pictureRowsFor(undefined)).toBe(PICTURE_MAX_ROWS)
  expect(pictureRowsFor(100)).toBe(PICTURE_MAX_ROWS)
  expect(pictureRowsFor(30)).toBe(15)
  expect(pictureRowsFor(8)).toBe(6)
})

test('only image attachments that can be PNGs are drawn', () => {
  expect(sentImages({
    attachments: [
      { path: '/t/a.png', size: 1, isImage: true, media_type: 'image/png' },
      { path: '/t/b.png', size: 1, isImage: true },
      { path: '/t/c.jpg', size: 1, isImage: true, media_type: 'image/jpeg' },
      { path: '/t/d.pdf', size: 1, isImage: false },
      { size: 1, isImage: true },
    ],
  })).toEqual(['/t/a.png', '/t/b.png'])
  expect(sentImages(undefined)).toEqual([])
  expect(sentImages('error text')).toEqual([])
  expect(sentImages({ attachments: 'x' })).toEqual([])
})

test('the [Image #N] marks of a prompt, each once', () => {
  expect(pastedNumbers('[Image #5] what is this')).toEqual([5])
  expect(pastedNumbers('[Image #2] and [Image #3], again [Image #2]')).toEqual([2, 3])
  expect(pastedNumbers('no image, [Image #x], [image #4]')).toEqual([])
})

test('the pasted-image path follows Claude Code folder names', () => {
  expect(projectSlug('/Users/subhagato/Development/apps/claude-md-preview')).toBe('-Users-subhagato-Development-apps-claude-md-preview')
  expect(projectSlug('/home/me/my_app.v2')).toBe('-home-me-my-app-v2')
  expect(claudeTmpOf({ uid: '501\n', isMac: true })).toBe('/private/tmp/claude-501')
  expect(claudeTmpOf({ uid: '1000', isMac: false })).toBe('/tmp/claude-1000')
  expect(claudeTmpOf({ tmpdir: '/scratch/', uid: '1000', isMac: false })).toBe('/scratch/claude-1000')
  expect(claudeTmpOf({ uid: '', isMac: true })).toBe('')
  const dir = pasteDirOf('/private/tmp/claude-501', '/Users/subhagato/Development/apps/claude-md-preview', 'f8bb4b84-0e51-456a-9e49-8e5db49500ae')
  expect(pastedImagePath(dir, 5)).toBe('/private/tmp/claude-501/-Users-subhagato-Development-apps-claude-md-preview/f8bb4b84-0e51-456a-9e49-8e5db49500ae/images/5.png')
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

// A Mac with kitty (pictures drawn), uid 501, session sid-1 in /w/app. `files`
// are the files that exist, by path: their first bytes as od prints them.
function world(on: any, o: { vars?: Record<string, string>; files?: Record<string, string>; dirs?: string[]; projects?: string[] } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM: 'xterm-kitty', ...o.vars })
  const files = o.files ?? {}
  const dirs = new Set(o.dirs ?? [])
  const heads: string[] = []
  const reads: string[] = []
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (/md-preview-/.test(cmd)) return ok('/c\nDarwin\n')
    if (argv[0] === 'id' && argv[1] === '-u') return ok('501\n')
    if (cmd.includes('od -An')) {
      const file = argv.at(-1)!
      heads.push(file)
      return ok(`${files[file] ?? ''}\n@\n`)
    }
    return ok('', 1)
  })
  on('session.id', async () => ({ value: 'sid-1' }))
  on('session.cwd', async () => ({ value: '/w/app' }))
  on('session.root', async () => ({ value: '/w/app' }))
  on('fs.stat', async ($: any, e: any, next: any) =>
    e.path in files ? { value: { kind: 'file', size: 1000, mtimeMs: 1, isLink: false } } : e.path.startsWith('/t/') || e.path.startsWith('/private/') ? { deny: 'ENOENT' } : next(e))
  on('fs.exists', async ($: any, e: any, next: any) => (e.path.startsWith('/private/') ? { value: dirs.has(e.path) } : next(e)))
  on('fs.list', async ($: any, e: any, next: any) =>
    e.path === '/private/tmp/claude-501' ? { value: (o.projects ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 1, isLink: false })) } : next(e))
  on('fs.read', async ($: any, e: any, next: any) => (e.as === 'bytes' && e.path in files ? (reads.push(e.path), { value: { base64: PNG } }) : next(e)))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', () => ENGINE as any)
  return { clock, heads, reads }
}

const sent = (output: unknown, isErrored = false, id = 'tu-1') =>
  ({
    plugin: 'md-preview', surface: 'terminal', component: 'ToolResult', requestId: id,
    props: { tool_use_id: id, tool: 'SendUserFile', output, isErrored }, viewport: { columns: 100, rows: 40 },
  }) as any
const attach = (path: string, isImage = true) => ({ attachments: [{ path, size: 1000, isImage, ...(isImage ? { media_type: 'image/png' } : {}) }] })
const prompt = (text: string, origin: any = { kind: 'composer' }, id = 'u-1') =>
  ({
    plugin: 'md-preview', surface: 'terminal', component: 'UserMessage', requestId: id,
    props: { text, origin, isExpanded: true }, viewport: { columns: 100, rows: 40 },
  }) as any
const images = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Image' ? [tree] : []), ...(tree.children ?? []).flatMap(images)] : []
// Sets the mod up (as the first answer would) before a row draws.
const ready = ($: any) => $.command.run({ command: 'md-preview', args: '' } as any)

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

test('with md-preview off, rows stay as they are', async ($, on) => {
  world(on, { files: { '/t/icon.png': HEAD, [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED] })
  await ready($)
  await $.command.run({ command: 'md-preview', args: 'off' } as any)
  expect(await (await $.ui.mount(sent(attach('/t/icon.png')))).drawn()).toMatchObject(ENGINE)
  expect(await (await $.ui.mount(prompt('[Image #5] hi'))).drawn()).toMatchObject(ENGINE)
})

test('in a terminal that draws no pictures, rows stay as they are', async ($, on) => {
  world(on, { vars: { TERM: 'xterm-256color' }, files: { '/t/icon.png': HEAD, [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED] })
  const shown = await ready($)
  expect(shown.text).toContain('Claude Code draws no pictures here')
  expect(await (await $.ui.mount(sent(attach('/t/icon.png')))).drawn()).toMatchObject(ENGINE)
  expect(await (await $.ui.mount(prompt('[Image #5] hi'))).drawn()).toMatchObject(ENGINE)
})
