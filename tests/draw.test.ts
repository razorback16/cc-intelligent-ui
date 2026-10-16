import { expect, mock, test } from 'claude-code/testing'

import { base64Bytes, canDrawIn, DEFAULT_CELL, fitsInline, INLINE_MAX_BYTES, INLINE_MAX_SIDE, inlineBudget, renderKey, SEGMENT_ROWS } from '../hooks/register'

// ---- Where pictures draw ----------------------------------------------------

const base = { program: '', term: 'xterm-256color', kitty: false, tmux: false, ssh: false, background: false, engineForced: false, modForced: false }

test('tmux and screen draw no pictures, even with the engine forced; only MD_PREVIEW_FORCE tries', () => {
  expect(canDrawIn({ ...base, term: 'xterm-kitty', tmux: true })).toBe(false)
  expect(canDrawIn({ ...base, program: 'ghostty', tmux: true, engineForced: true })).toBe(false)
  expect(canDrawIn({ ...base, term: 'screen-256color', tmux: true, engineForced: true })).toBe(false)
  expect(canDrawIn({ ...base, tmux: true, modForced: true })).toBe(true)
})

test('a background session never draws pictures, not even with MD_PREVIEW_FORCE', () => {
  expect(canDrawIn({ ...base, program: 'ghostty', background: true })).toBe(false)
  expect(canDrawIn({ ...base, term: 'xterm-kitty', background: true, engineForced: true, modForced: true })).toBe(false)
})

test('over ssh, TERM tells: kitty or Ghostty draws, an unknown terminal only when forced', () => {
  expect(canDrawIn({ ...base, ssh: true, term: 'xterm-kitty' })).toBe(true)
  expect(canDrawIn({ ...base, ssh: true, term: 'xterm-ghostty' })).toBe(true)
  expect(canDrawIn({ ...base, ssh: true })).toBe(false)
  expect(canDrawIn({ ...base, ssh: true, program: 'ghostty' })).toBe(false)
  expect(canDrawIn({ ...base, ssh: true, engineForced: true })).toBe(true)
  expect(canDrawIn({ ...base, ssh: true, modForced: true })).toBe(true)
  expect(canDrawIn({ ...base, ssh: true, term: 'xterm-kitty', tmux: true })).toBe(false)
})

// ---- Pages as bytes ---------------------------------------------------------

test('a page goes as bytes only within 4096 px a side and 2 MiB decoded', () => {
  expect(base64Bytes('')).toBe(0)
  expect(base64Bytes('YQ==')).toBe(1)
  expect(base64Bytes('YWI=')).toBe(2)
  expect(base64Bytes('YWJj')).toBe(3)
  expect(fitsInline({ width: 1600, height: 4096 })).toBe(true)
  expect(fitsInline({ width: INLINE_MAX_SIDE + 1, height: 64 })).toBe(false)
  expect(fitsInline({ width: 1600, height: 5000 })).toBe(false)
  expect(fitsInline({ width: 0, height: 64 })).toBe(false)
  const max = 'A'.repeat(Math.ceil(INLINE_MAX_BYTES / 3) * 4 + 4)
  expect(fitsInline({ width: 10, height: 10 }, 'AAAA')).toBe(true)
  expect(fitsInline({ width: 10, height: 10 }, max)).toBe(false)
})

test('over ssh a segment is cut so its page stays under 4096 px tall', () => {
  expect(inlineBudget(DEFAULT_CELL)).toBe(96)
  expect(inlineBudget({ width: 8, height: 16 })).toBe(SEGMENT_ROWS)
  expect(inlineBudget({ width: 40, height: 200 })).toBe(20)
  expect(inlineBudget(DEFAULT_CELL) * DEFAULT_CELL.height).toBeLessThan(INLINE_MAX_SIDE)
})

test('pages cut for ssh have keys of their own; local keys do not change', () => {
  const o = {
    textHash: 'h', columns: 100, cell: DEFAULT_CELL, size: 100, mode: 'dark' as const, termFont: '', columnPt: 6,
    templateStamp: '1', look: { name: 'vscode', dir: '/t', stamp: '0' },
  }
  expect(renderKey({ ...o, inline: false })).toBe(renderKey(o))
  expect(renderKey({ ...o, inline: true })).not.toBe(renderKey(o))
})

// ---- The Image source -------------------------------------------------------

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// `od -An -v -tx1` of a PNG's first 24 bytes: 1600 x 64, and 1600 x 5000.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 00 40'
const TALL = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 13 88'
// The first 33 bytes of the 1600 x 64 PNG, base64.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABkAAAABACAYAAAAAAAAA'

// `stored`: what md-preview kept in its store before (a setting).
function world(on: any, vars: Record<string, string>, head = HEAD, stored: Record<string, unknown> = {}) {
  // md-preview's store in memory (as mock.store), and its writes by key.
  const store = new Map(Object.entries(stored))
  const kept: Record<string, unknown> = {}
  on('store.get', async ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async ($: any, e: any) => {
    store.set(e.key, e.value)
    kept[e.key] = e.value
    return { value: undefined }
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', ...vars })
  const reads: string[] = []
  const files = new Map<string, string>()
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (/md-preview-/.test(cmd)) return ok('/c\nDarwin\n')
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'compile') return ok('')
    if (cmd.includes('od -An')) return ok(`${head}\n@\n`)
    return ok('', 1)
  })
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => {
    if (e.as === 'bytes') {
      reads.push(e.path)
      return { value: { base64: PNG } }
    }
    return files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)
  })
  on('fs.list', async ($: any, e: any, next: any) => (e.path.startsWith('/c/') ? { value: [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] } : next(e)))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', () => ENGINE as any)
  return { clock, reads, kept }
}

const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }
const message = (requestId: string, text: string) =>
  ({
    plugin: 'md-preview', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40 },
  }) as any
const props = (text: string) => ({ text, isFirstOfReply: true }) as any
const images = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Image' ? [tree] : []), ...(tree.children ?? []).flatMap(images)] : []

test('over ssh in kitty, a page goes as PNG bytes, read once', async ($, on) => {
  const { clock, reads } = world(on, { SSH_CONNECTION: '10.0.0.2 50000 10.0.0.1 22', TERM: 'xterm-kitty' })
  const ran = await $.command.run({ command: 'md-preview', args: '' } as any)
  expect(ran.text).toContain('over ssh, sent as bytes')
  const ui = await $.ui.mount(message('ssh-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [image] = images(await ui.drawn())
  expect(image.props.source).toEqual({ png: PNG })
  await ui.redraw(props('Some **bold** text.'))
  expect(images(await ui.drawn())[0].props.source).toEqual({ png: PNG })
  expect(reads.length).toBe(1)
  expect(reads[0]).toMatch(/^\/c\/[0-9a-f]{16}\/a-1\.png$/)
})

test('over ssh, a page over 4096 px tall draws as text', async ($, on) => {
  const { clock, reads } = world(on, { SSH_TTY: '/dev/pts/1', TERM: 'xterm-ghostty' }, TALL)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('ssh-2', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
  expect(reads).toEqual([])
})

test('locally, a page goes as a file name', async ($, on) => {
  const { clock, reads } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('local-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [image] = images(await ui.drawn())
  expect(image.props.source).toMatchObject({ format: 'png' })
  expect(image.props.source.file).toMatch(/^\/c\/[0-9a-f]{16}\/a-1\.png$/)
  expect(reads).toEqual([])
})

test('in tmux with the engine forced, answers stay text', async ($, on) => {
  const { clock } = world(on, { TMUX: '/tmp/tmux-501/default,1,0', TERM: 'tmux-256color', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  const ran = await $.command.run({ command: 'md-preview', args: '' } as any)
  expect(ran.text).toContain('Claude Code draws no pictures here')
  const ui = await $.ui.mount(message('tmux-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
})

// ---- The width setting --------------------------------------------------------

const wide = (requestId: string, text: string) => ({ ...message(requestId, text), viewport: { columns: 300, rows: 40 } })

test('a kept width caps the pictures; width full draws at the terminal width at once, 255 columns at most', async ($, on) => {
  const { clock, kept } = world(on, { TERM: 'xterm-kitty' }, HEAD, { width: 160 })
  const ran = await $.command.run({ command: 'md-preview', args: '' } as any)
  expect(ran.text).toContain('width 160 columns')
  const ui = await $.ui.mount(wide('w-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(first.props.columns).toBe(160)
  const set = await $.command.run({ command: 'md-preview', args: 'width full' } as any)
  expect(set.text).toContain('full (the terminal width)')
  expect(kept.width).toBe('full')
  // Another key (the columns are in it): compiled again, then drawn wider.
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [now] = images(await ui.drawn())
  expect(now.props.columns).toBe(255)
  expect(now.props.source.file).not.toBe(first.props.source.file)
})

test('width with no value shows it; a bad value is refused; a bad kept value is the default', async ($, on) => {
  const { kept } = world(on, { TERM: 'xterm-kitty' }, HEAD, { width: 20 })
  const shown = await $.command.run({ command: 'md-preview', args: 'width' } as any)
  expect(shown.text).toContain('The most columns a picture takes: full (the terminal width)')
  const bad = await $.command.run({ command: 'md-preview', args: 'width 39' } as any)
  expect(bad.text).toContain('Not understood: "width 39"')
  expect(kept.width).toBe(undefined)
  const set = await $.command.run({ command: 'md-preview', args: 'width 400' } as any)
  expect(set.text).toContain('400 columns (a picture is 255 columns at most)')
  expect(kept.width).toBe(400)
})
