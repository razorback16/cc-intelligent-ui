import { expect, mock, test } from 'claude-code/testing'

import {
  alignFirstLine, scaledBulletRow, base64Bytes, canDrawIn, COMMIT_MIN_MS, DEFAULT_CELL, fileHref, fitsInline, herdrBudget, HERDR_MAX_PAGE_BYTES, INLINE_MAX_BYTES,
  INLINE_MAX_SIDE, inlineBudget, renderKey, RESIZE_QUIET_MS, resolveLinks, SEGMENT_ROWS, segmentBudget, sizing, WATCH_PL,
} from '../hooks/register'
import { TABLE_GRID } from './table-fixture'
// This file's own copy of the drawing code, called with a fake `$`.
import { drawPages, linksFor } from '../hooks/lib/draw'

// ---- Where pictures draw ----------------------------------------------------

const base = { program: '', term: 'xterm-256color', kitty: false, tmux: false, ssh: false, background: false, engineForced: false, modForced: false }

test('tmux and screen draw no pictures, even with the engine forced; only IUI_FORCE tries', () => {
  expect(canDrawIn({ ...base, term: 'xterm-kitty', tmux: true })).toBe(false)
  expect(canDrawIn({ ...base, program: 'ghostty', tmux: true, engineForced: true })).toBe(false)
  expect(canDrawIn({ ...base, term: 'screen-256color', tmux: true, engineForced: true })).toBe(false)
  expect(canDrawIn({ ...base, tmux: true, modForced: true })).toBe(true)
})

test('a background session never draws pictures, not even with IUI_FORCE', () => {
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

test('under herdr a segment is cut so its page stays under 16 MiB of RGBA', () => {
  // The page is as wide as its columns in device pixels (sizing).
  expect(sizing(187, { width: 16, height: 34 }, 6).widthPx).toBe(2992)
  // A wide page on a Retina screen: 41 rows fit, 30 with the room for the rough count.
  expect(herdrBudget(187, { width: 16, height: 34 })).toBe(30)
  expect(herdrBudget(187, { width: 16, height: 34 }) * 34 * 2992 * 4 / 0.75).toBeLessThanOrEqual(HERDR_MAX_PAGE_BYTES)
  // A small page keeps the normal budget; a large one at least 20 rows, when 20 rows fit.
  expect(herdrBudget(80, { width: 8, height: 16 })).toBe(SEGMENT_ROWS)
  expect(herdrBudget(255, { width: 20, height: 40 })).toBe(20)
  // A huge cell: 20 rows would be 65 MiB (herdr sends none of it), so only the rows that fit.
  expect(herdrBudget(255, { width: 40, height: 80 })).toBe(5)
  expect(herdrBudget(255, { width: 400, height: 800 })).toBe(1)
  // The budget never passes HERDR_MAX_PAGE_BYTES (a row of 16 MiB or more: 1 row).
  for (const columns of [20, 80, 187, 255]) {
    for (const width of [7, 16, 24, 32, 40, 60]) {
      const px = { width, height: width * 2 }
      const row = 4 * Math.round(columns * px.width) * px.height
      if (row <= HERDR_MAX_PAGE_BYTES) expect(herdrBudget(columns, px) * row).toBeLessThanOrEqual(HERDR_MAX_PAGE_BYTES)
    }
  }
  // The cell width counts as sizing rounds it.
  expect(herdrBudget(100, { width: 15.5, height: 30 })).toBe(Math.floor((HERDR_MAX_PAGE_BYTES / (4 * 1550 * 30)) * 0.75))
})

test('the segment budget: the smaller of the ssh and herdr ones that apply', () => {
  const big = { width: 16, height: 34 }
  expect(segmentBudget({ inline: false }, 187, big)).toBe(SEGMENT_ROWS)
  expect(segmentBudget({ inline: false, herdr: false }, 187, big)).toBe(SEGMENT_ROWS)
  expect(segmentBudget({ inline: false, herdr: true }, 187, big)).toBe(herdrBudget(187, big))
  expect(segmentBudget({ inline: true }, 187, big)).toBe(inlineBudget(big))
  // Over ssh into herdr: the herdr budget (30) is under the ssh one (90).
  expect(inlineBudget(big)).toBe(90)
  expect(segmentBudget({ inline: true, herdr: true }, 187, big)).toBe(30)
  // A narrow page: the ssh budget is the smaller one.
  expect(segmentBudget({ inline: true, herdr: true }, 40, big)).toBe(inlineBudget(big))
})

test('pages cut for herdr have keys of their own; other keys do not change', () => {
  const o = {
    textHash: 'h', columns: 100, cell: DEFAULT_CELL, size: 100, mode: 'dark' as const, termFont: '', columnPt: 6,
    templateStamp: '1', look: { name: 'vscode', dir: '/t', stamp: '0' },
  }
  expect(renderKey({ ...o, herdr: false })).toBe(renderKey(o))
  expect(renderKey({ ...o, herdr: true })).not.toBe(renderKey(o))
  expect(renderKey({ ...o, herdr: true })).not.toBe(renderKey({ ...o, inline: true }))
})

test('pages cut for ssh have keys of their own; local keys do not change', () => {
  const o = {
    textHash: 'h', columns: 100, cell: DEFAULT_CELL, size: 100, mode: 'dark' as const, termFont: '', columnPt: 6,
    templateStamp: '1', look: { name: 'vscode', dir: '/t', stamp: '0' },
  }
  expect(renderKey({ ...o, inline: false })).toBe(renderKey(o))
  expect(renderKey({ ...o, inline: true })).not.toBe(renderKey(o))
})

test('a fake bold has keys of its own; the other keys do not change', () => {
  const o = {
    textHash: 'h', columns: 100, cell: DEFAULT_CELL, size: 100, mode: 'dark' as const, termFont: 'Monaco', columnPt: 6,
    templateStamp: '1', look: { name: 'vscode', dir: '/t', stamp: '0' },
  }
  expect(renderKey({ ...o, fauxBold: false })).toBe(renderKey(o))
  expect(renderKey({ ...o, fauxBold: true })).not.toBe(renderKey(o))
})

// ---- The Image source -------------------------------------------------------

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// `od -An -v -tx1` of a PNG's first 24 bytes: 1600 x 64, and 1600 x 5000.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 00 40'
const TALL = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 13 88'
// The first 33 bytes of the 1600 x 64 PNG, base64.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABkAAAABACAYAAAAAAAAA'

// The tty, for a world with one: `line` what a read of its size prints
// (none: the read fails); `emit` sets a new one and the Frame watcher prints
// it (as at a SIGWINCH). `watcher`: the watcher's exit code at once instead
// (1: no tty). `metrics` what a font measure prints (by its count, from 1).
// With no tty, the watcher exits 1 at once.
type Tty = { line?: string; watcher?: number; metrics?: (n: number) => string }

// The PID wrapper Intelligent UI runs Typst through (typst.ts wrapPid).
const WRAP = 'echo $$; exec "$@"'

// `stored`: what Intelligent UI kept in its store before (a setting); `design`:
// the text of every design file (none: they are missing).
function world(on: any, vars: Record<string, string>, head = HEAD, stored: Record<string, unknown> = {}, design?: string, tty?: Tty) {
  // Intelligent UI's store in memory (as mock.store), and its writes by key.
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
  // Each compile's inputs; `hold` makes the compiles wait until `release`
  // (with `only`: the compiles whose text has it). `kills`: the PIDs killed.
  const compiles: Record<string, string>[] = []
  let gate: Promise<void> | null = null
  let gated: string | undefined
  let open = () => {}
  const hold = (only?: string) => {
    gated = only
    gate = new Promise<void>(r => (open = r))
  }
  const release = () => {
    gate = null
    open()
  }
  const kills: string[] = []
  // What went to the debug log, a write each.
  const logs: string[] = []
  const killers = new Map<string, () => void>()
  let pids = 4242
  // Every call Intelligent UI makes to a process or a file (counted by kind).
  const calls: string[] = []
  // The tty: its size reads (each one's time), and a new size.
  const sizeReads: number[] = []
  const watchers: Array<(line: string) => void> = []
  const emit = (line: string) => {
    tty!.line = line
    for (const say of watchers) say(line)
  }
  let measures = 0
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    calls.push(`spawn ${argv[0]}`)
    if (argv[0] === '/usr/bin/perl' && argv[2] === WATCH_PL) {
      if (!tty || tty.watcher !== undefined) return { value: { code: tty?.watcher ?? 1, signal: null } }
      // The watcher prints its PID, then the size at its start and at each change.
      const lines: string[] = ['pid 777', ...(tty.line ? [`size ${tty.line}`] : [])]
      let wake = () => {}
      watchers.push(line => {
        lines.push(`size ${line}`)
        wake()
      })
      for (;;) {
        while (lines.length) yield { stream: 'stdout', text: `${lines.shift()}\n` }
        await new Promise<void>(r => (wake = r))
      }
    }
    if (argv[0] === 'sh' && argv[2] === WRAP && argv[4] === '/usr/bin/typst' && argv[5] === 'compile') {
      const typst = argv.slice(4)
      const pid = String(pids++)
      let killed = false
      const dead = new Promise<void>(r => killers.set(pid, () => ((killed = true), r())))
      yield { stream: 'stdout', text: `${pid}\n` }
      compiles.push(Object.fromEntries(typst.flatMap((a, i) => (typst[i - 1] === '--input' ? [a.split(/=(.*)/s).slice(0, 2)] : []))))
      const doc = files.get(typst.find(a => a.startsWith('doc='))?.slice(4) ?? '') ?? ''
      if (gate && (gated === undefined || doc.includes(gated))) await Promise.race([gate, dead])
      killers.delete(pid)
      return { value: killed ? { code: null, signal: 'SIGTERM' } : { code: 0, signal: null } }
    }
    return { value: { code: 1, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    calls.push(`run ${argv[0]}`)
    if (argv[0] === 'kill') {
      kills.push(argv[1]!)
      killers.get(argv[1]!)?.()
      return ok('')
    }
    if (tty && argv[0] === 'sh' && cmd.includes('ioctl(T')) {
      sizeReads.push(clock.now())
      return tty.line ? ok(tty.line) : ok('', 1)
    }
    if (tty?.metrics && argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok(tty.metrics(++measures))
    if (cmd.includes('debug.log')) {
      logs.push(e.init?.stdin ?? '')
      return ok('')
    }
    if (/cc-intelligent-ui-/.test(cmd)) return ok('/c\nDarwin\n')
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (cmd.includes('od -An')) return ok(`${head}\n@\n`)
    return ok('', 1)
  })
  on('fs.write', async ($: any, e: any) => {
    calls.push('fs.write')
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => {
    calls.push('fs.read')
    if (e.as === 'bytes') {
      reads.push(e.path)
      return { value: { base64: PNG } }
    }
    if (e.path.includes('/designs/')) return design === undefined ? { deny: 'ENOENT' } : { value: design }
    return files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)
  })
  on('fs.exists', async ($: any, e: any, next: any) => {
    calls.push('fs.exists')
    // The project's files (the link rows' paths): the ones written.
    if (e.path.startsWith('/w/app/')) return { value: files.has(e.path) }
    return e.path.includes('/designs/') ? { value: design !== undefined || files.has(e.path) } : next(e)
  })
  on('fs.list', async ($: any, e: any, next: any) => {
    calls.push('fs.list')
    return e.path.startsWith('/c/') ? { value: [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] } : next(e)
  })
  on('fs.stat', async ($: any, e: any, next: any) => {
    calls.push('fs.stat')
    return next(e)
  })
  const toasts: string[] = []
  on('ui.toast', async ($: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('ui.render', () => ENGINE as any)
  return { clock, reads, kept, compiles, files, hold, release, emit, sizeReads, kills, calls, logs, toasts }
}

const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }
const message = (requestId: string, text: string) =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40 },
  }) as any
const props = (text: string) => ({ text, isFirstOfReply: true }) as any
const images = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Image' ? [tree] : []), ...(tree.children ?? []).flatMap(images)] : []

test('over ssh in kitty, a page goes as PNG bytes, read once', async ($, on) => {
  const { clock, reads } = world(on, { SSH_CONNECTION: '10.0.0.2 50000 10.0.0.1 22', TERM: 'xterm-kitty' })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
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
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('ssh-2', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
  expect(reads).toEqual([])
})

test('locally, a page goes as a file name', async ($, on) => {
  const { clock, reads } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'iui', args: '' } as any)
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
  const ran = await $.command.run({ command: 'iui', args: '' } as any)
  expect(ran.text).toContain('This terminal shows no pictures')
  const ui = await $.ui.mount(message('tmux-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
})

// ---- The width setting --------------------------------------------------------

const wide = (requestId: string, text: string) => ({ ...message(requestId, text), viewport: { columns: 300, rows: 40 } })

test('a kept width caps the pictures; width full draws at the terminal width once its epoch commits, 255 columns at most', async ($, on) => {
  const { clock, kept } = world(on, { TERM: 'xterm-kitty' }, HEAD, { width: 160 })
  const ran = await $.command.run({ command: 'iui', args: '' } as any)
  expect(ran.text).toContain('width 160 columns')
  const ui = await $.ui.mount(wide('w-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(first.props.columns).toBe(160)
  const set = await $.command.run({ command: 'iui', args: 'width full' } as any)
  expect(set.text).toContain('full (the terminal width)')
  expect(kept.width).toBe('full')
  // Another key (the columns are in it): compiled again, then drawn wider
  // when the epoch commits.
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(props('Some **bold** text.'))
  const [now] = images(await ui.drawn())
  expect(now.props.columns).toBe(255)
  expect(now.props.source.file).not.toBe(first.props.source.file)
})

test('width with no value shows it; a bad value is refused; a bad kept value is the default', async ($, on) => {
  const { kept } = world(on, { TERM: 'xterm-kitty' }, HEAD, { width: 20 })
  const shown = await $.command.run({ command: 'iui', args: 'width' } as any)
  expect(shown.text).toContain('The most columns a picture takes: full (the terminal width)')
  const bad = await $.command.run({ command: 'iui', args: 'width 39' } as any)
  expect(bad.text).toContain('Not understood: "width 39"')
  expect(kept.width).toBe(undefined)
  const set = await $.command.run({ command: 'iui', args: 'width 400' } as any)
  expect(set.text).toContain('400 columns (a picture is 255 columns at most)')
  expect(kept.width).toBe(400)
})

// ---- The grid setting ---------------------------------------------------------

const boxes = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Box' ? [tree] : []), ...(tree.children ?? []).flatMap(boxes)] : []
// The reply bullet's row: the gutter Box's top margin.
const bulletRowOf = (tree: any) => boxes(tree).find(b => b.props.width === 2)?.props.marginTop

test('grid on is kept and begins an epoch: another key, compiled with grid=1 and top=0; grid off goes back to the key of before', async ($, on) => {
  const { clock, kept, compiles, logs } = world(on, { TERM: 'xterm-kitty', IUI_DEBUG: '1' }, HEAD, { grid: false })
  const ran = await $.command.run({ command: 'iui', args: '' } as any)
  expect(ran.text).toContain('grid off.')
  const ui = await $.ui.mount(message('g-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(compiles.length).toBe(1)
  expect(compiles[0]!.grid).toBe(undefined)
  const begun = () => logs.filter(l => / epoch \d+ begin/.test(l)).length
  const before = begun()
  const set = await $.command.run({ command: 'iui', args: 'grid on' } as any)
  expect(set.text).toContain('The row grid is now on (each line of text on whole terminal rows)')
  expect(kept.grid).toBe(true)
  expect(begun()).toBe(before + 1)
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(props('Some **bold** text.'))
  const [now] = images(await ui.drawn())
  expect(compiles.length).toBe(2)
  expect(compiles[1]!.grid).toBe('1')
  expect(compiles[1]!.top).toBe('0')
  expect(now.props.source.file).not.toBe(first.props.source.file)
  const status = await $.command.run({ command: 'iui', args: '' } as any)
  expect(status.text).toContain('grid on.')
  const details = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(details.text).toContain('row grid on')
  // Off: the key of before, in memory, so nothing compiles.
  await $.command.run({ command: 'iui', args: 'grid off' } as any)
  expect(kept.grid).toBe(false)
  expect(begun()).toBe(before + 2)
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(2)
  expect(images(await ui.drawn())[0].props.source.file).toBe(first.props.source.file)
})

test('a kept grid on draws a heading on the grid, its bullet on the row of its text; grid with no value shows it', async ($, on) => {
  const { clock, compiles } = world(on, { TERM: 'xterm-kitty' }, HEAD, { grid: true })
  const shown = await $.command.run({ command: 'iui', args: 'grid' } as any)
  expect(shown.text).toContain('The row grid is on (each line of text on whole terminal rows)')
  const ui = await $.ui.mount(message('g-2', '# Title'))
  await clock.settle()
  await ui.redraw(props('# Title'))
  expect(compiles[0]).toMatchObject({ grid: '1', top: '0' })
  // An h1 of 3 rows: its text in row 1.
  expect(bulletRowOf(await ui.drawn())).toBe(1)
})

test('with the grid on, the bullet row comes from the grid numbers that the font measure gives', async ($, on) => {
  // Body text that needs 2 rows (a large size): its line is half a row down, its text in row 1.
  const measured = (body: number) => JSON.stringify({
    term: null, menlo: { adv: 0.602, xh: 0.547, avg: 0.602 }, body: { adv: 0.63, xh: 0.526, avg: 0.483 },
    grid: { body, heading: [31.8, 20.4, 14.2, 11.4, 9.9, 9.7], code: 1.0775, 'code-size': 1, pad: { quote: 6.05, code: 12.57, table: 3.93 }, 'table-style': 'rules' },
  })
  const { clock, compiles } = world(on, { TERM: 'xterm-kitty' }, HEAD, { grid: true }, undefined, { metrics: () => measured(20) })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('g-4', 'Some text.'))
  await clock.settle()
  await ui.redraw(props('Some text.'))
  expect(compiles[0]).toMatchObject({ grid: '1', top: '0' })
  expect(bulletRowOf(await ui.drawn())).toBe(1)
})

test('with the grid on, a page that starts with a "grid" table has its bullet one row lower, on its first line', async ($, on) => {
  // A measure of table.style "grid" with padding 5 px, at rows of 11.63 pt:
  // the box's half row and the cell's half row put the first line in row 1
  // ("rules": row 0).
  const measured = (style: string, table: number) => JSON.stringify({
    term: null, menlo: { adv: 0.602, xh: 0.547, avg: 0.602 }, body: { adv: 0.63, xh: 0.526, avg: 0.483 },
    grid: { body: 11.2836, heading: [31.8, 20.4, 14.2, 11.4, 9.9, 9.7], code: 1.0775, 'code-size': 1, pad: { quote: 6.05, code: 12.57, table }, 'table-style': style },
  })
  const table = '| a | b |\n|---|---|\n| 1 | 2 |'
  const { clock, compiles } = world(on, { TERM: 'xterm-kitty' }, HEAD, { grid: true }, undefined, { metrics: () => measured('grid', 3.93) })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('g-5', table))
  await clock.settle()
  await ui.redraw(props(table))
  expect(compiles[0]).toMatchObject({ grid: '1', top: '0' })
  expect(compiles[0]!.row).toBe('11.6331')
  expect(bulletRowOf(await ui.drawn())).toBe(1)
})

test('a heading with the grid off keeps its bullet row and top margin', async ($, on) => {
  const { clock, compiles } = world(on, { TERM: 'xterm-kitty' }, HEAD, { grid: false })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('g-3', '# Title'))
  await clock.settle()
  await ui.redraw(props('# Title'))
  expect(compiles[0]!.grid).toBe(undefined)
  expect(Number(compiles[0]!.top)).not.toBe(0)
  // An h1 is taller than a row: its bullet is on row 1.
  const { bulletRow } = alignFirstLine('h1', Number(compiles[0]!.row))
  expect(bulletRow).toBe(1)
  expect(bulletRowOf(await ui.drawn())).toBe(bulletRow)
})

test('with the grid off, a page that starts with a "grid" table (claude-code) has the top margin of its padding', async ($, on) => {
  // claude-code's measure (10 px, its box), at rows of 11.63 pt: its line
  // is lower than vscode's (margin -5.45, row 0), so a margin that puts it
  // on row 1 and keeps the box's top rule.
  const measured = JSON.stringify({
    term: null, menlo: { adv: 0.602, xh: 0.547, avg: 0.602 }, body: { adv: 0.63, xh: 0.526, avg: 0.483 }, grid: TABLE_GRID['claude-code'],
  })
  const table = '| a | b |\n|---|---|\n| 1 | 2 |'
  const { clock, compiles } = world(on, { TERM: 'xterm-kitty' }, HEAD, { grid: false }, undefined, { metrics: () => measured })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('g-6', table))
  await clock.settle()
  await ui.redraw(props(table))
  expect(compiles[0]!.grid).toBe(undefined)
  expect(compiles[0]!.row).toBe('11.6331')
  expect(Number(compiles[0]!.top)).toBe(2.25)
  expect(bulletRowOf(await ui.drawn())).toBe(1)
})

test('a bad kept grid is on (the default); a bad value is refused and not kept', async ($, on) => {
  const { kept } = world(on, { TERM: 'xterm-kitty' }, HEAD, { grid: 'yes' })
  const shown = await $.command.run({ command: 'iui', args: 'grid' } as any)
  expect(shown.text).toContain('The row grid is on (each line of text on whole terminal rows)')
  const bad = await $.command.run({ command: 'iui', args: 'grid maybe' } as any)
  expect(bad.text).toContain('Not understood: "grid maybe"')
  expect(kept.grid).toBe(undefined)
})

// ---- The box of a page ---------------------------------------------------------

test('while a new size compiles, the old picture draws at its own box, never stretched', async ($, on) => {
  const { clock, hold, release } = world(on, { TERM: 'xterm-kitty' }, HEAD, { width: 160 })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(wide('box-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(first.props.columns).toBe(160)
  expect(first.props.source.generation).toBe(undefined)
  hold()
  await $.command.run({ command: 'iui', args: 'width full' } as any)
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(props('Some **bold** text.'))
  const [stale] = images(await ui.drawn())
  expect(stale.props.source.file).toBe(first.props.source.file)
  expect(stale.props.columns).toBe(160)
  expect(stale.props.rows).toBe(first.props.rows)
  release()
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [now] = images(await ui.drawn())
  expect(now.props.columns).toBe(255)
  expect(now.props.source.file).not.toBe(first.props.source.file)
})

test('the pages column never shrinks: the layout never squeezes a page (fitBox sizes it)', async ($, on) => {
  const { clock } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('shrink-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const tree: any = await ui.drawn()
  const column = tree.children.find((c: any) => c.type === 'Box' && images(c).length && c.props.flexDirection === 'column')
  expect(column.props.flexShrink).toBe(0)
})

// ---- The Frame -------------------------------------------------------------------

// A tty of 120 columns and 40 rows, cell 16 x 32; the same with cell 19 x 38.
const TTY = '40 120 1920 1280'
const TTY_BIG_FONT = '40 120 2280 1520'
const sized = (requestId: string, text: string, columns: number, rows = 40) => ({ ...message(requestId, text), viewport: { columns, rows } })

test('after the viewport gets narrower, nothing compiles until it is quiet; meanwhile the old picture fits the room, its aspect kept', async ($, on) => {
  const { clock, compiles } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, undefined, { line: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(sized('f-1', 'Some **bold** text.', 120))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(first.props.columns).toBe(118)
  expect(compiles.length).toBe(1)
  // The engine draws the row again at 100 columns at once.
  await ui.unmount()
  const narrow = await $.ui.mount(sized('f-1', 'Some **bold** text.', 100))
  await clock.settle()
  await narrow.redraw(props('Some **bold** text.'))
  const [stale] = images(await narrow.drawn())
  expect(compiles.length).toBe(1)
  expect(stale.props.source.file).toBe(first.props.source.file)
  expect(stale.props.columns).toBe(98)
  expect(stale.props.rows).toBe(Math.max(1, Math.round((first.props.rows * 98) / 118)))
  // Quiet: one compile at the new width; it shows when the epoch commits.
  await clock.advance(RESIZE_QUIET_MS)
  expect(compiles.length).toBe(2)
  await clock.advance(COMMIT_MIN_MS)
  await narrow.redraw(props('Some **bold** text.'))
  const [now] = images(await narrow.drawn())
  expect(compiles.length).toBe(2)
  expect(now.props.columns).toBe(98)
  expect(now.props.source.file).not.toBe(first.props.source.file)
  // A page of the target is never drawn smaller.
  expect(now.props.source.generation).toBe(undefined)
})

// The bullet's row in a drawn answer (the gutter Box's marginTop).
const bulletOf = (tree: any): number => tree.children.find((c: any) => c.type === 'Box' && !images(c).length).props.marginTop

test('an old page wider than the room after a narrowing draws at the room, its aspect kept and its bullet scaled', async ($, on) => {
  const { clock, hold } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, undefined, { line: '40 213 3408 1360' })
  await $.command.run({ command: 'iui', args: '' } as any)
  const text = '# A title\n\nSome **bold** text.'
  const ui = await $.ui.mount(sized('room-1', text, 213))
  await clock.settle()
  await ui.redraw(props(text))
  const tree: any = await ui.drawn()
  const [first] = images(tree)
  expect(first.props.columns).toBe(211)
  const bullet = bulletOf(tree)
  expect(bullet).toBeGreaterThan(0)
  // Narrower, and the new compile held past the commit's wait.
  hold()
  await ui.unmount()
  const narrow = await $.ui.mount(sized('room-1', text, 120))
  await narrow.redraw(props(text))
  await clock.advance(RESIZE_QUIET_MS)
  await clock.advance(COMMIT_MIN_MS)
  await narrow.redraw(props(text))
  const small: any = await narrow.drawn()
  const [old] = images(small)
  expect(old.props.source.file).toBe(first.props.source.file)
  expect(old.props.columns).toBe(118)
  expect(old.props.rows).toBe(Math.max(1, Math.round((first.props.rows * 118) / 211)))
  expect(old.props.source.generation).toBe(118 * 1000 + old.props.rows)
  expect(bulletOf(small)).toBe(scaledBulletRow(bullet, 118 / 211))
})

test('an old page narrower than the room draws at its own box', async ($, on) => {
  const { clock, hold } = world(on, { TERM: 'xterm-kitty' }, HEAD, { width: 160 })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(wide('own-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(first.props.columns).toBe(160)
  hold()
  await ui.unmount()
  const narrower = await $.ui.mount(sized('own-1', 'Some **bold** text.', 200))
  await narrower.redraw(props('Some **bold** text.'))
  const [old] = images(await narrower.drawn())
  expect(old.props).toEqual(first.props)
})

test('the row memo misses when the viewport columns change, and hits when only onScreen changes', async ($, on) => {
  const { clock, calls } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('memo-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(first.props.columns).toBe(98)
  // The engine draws every row again at the new width, before it is quiet:
  // a new tree, its page fit to the room.
  await ui.unmount()
  const narrow = await $.ui.mount(sized('memo-1', 'Some **bold** text.', 80))
  const [fit] = images(await narrow.drawn())
  expect(fit.props.columns).toBe(78)
  const before = calls.length
  for (const onScreen of [{ first: 0, last: 3, of: 9 }, null, undefined]) {
    await narrow.redraw({ ...props('Some **bold** text.'), onScreen })
    expect(images(await narrow.drawn())[0].props).toEqual(fit.props)
  }
  expect(calls.slice(before)).toEqual([])
})

// The epoch trace lines a size change writes to the debug log.
async function traceOf($: any, on: any, vars: Record<string, string>): Promise<string[]> {
  const { clock, logs } = world(on, vars)
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('trace-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  await $.command.run({ command: 'iui', args: 'size 120' } as any)
  await ui.redraw(props('Some **bold** text.'))
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  return logs.filter(l => / epoch \d+ /.test(l))
}

test('with IUI_DEBUG, an epoch writes one trace line at its begin and one at its commit', async ($, on) => {
  const trace = await traceOf($, on, { TERM: 'xterm-kitty', IUI_DEBUG: '1' })
  expect(trace.length).toBe(2)
  expect(trace[0]).toMatch(/epoch \d+ begin: target 100x40 cell \d+(\.\d+)?x\d+(\.\d+)?; cancelled 0 running, dropped 0 queued/)
  expect(trace[1]).toMatch(/epoch \d+ commit after \d+ ms \(ready\): 1 jobs queued, 0 waiting, 0 running, 0 converting/)
})

test('with no IUI_DEBUG, an epoch writes no trace line', async ($, on) => {
  expect(await traceOf($, on, { TERM: 'xterm-kitty' })).toEqual([])
})

test('a drag (5 watcher lines in a row) compiles nothing and reads no tty until it is quiet, then once', async ($, on) => {
  const { clock, compiles, emit, sizeReads } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, undefined, { line: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(sized('drag-1', 'Some **bold** text.', 200))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(first.props.columns).toBe(118)
  expect(compiles.length).toBe(1)
  const reads = sizeReads.length
  for (const columns of [115, 110, 105, 100, 95]) {
    emit(`40 ${columns} ${columns * 16} 1280`)
    await clock.advance(RESIZE_QUIET_MS - 50)
    await ui.redraw(props('Some **bold** text.'))
    expect(compiles.length).toBe(1)
    expect(sizeReads.length).toBe(reads)
    expect(images(await ui.drawn())[0].props.source.file).toBe(first.props.source.file)
  }
  await clock.advance(50)
  expect(sizeReads.length).toBe(reads + 1)
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(2)
  expect(images(await ui.drawn())[0].props.columns).toBe(93)
})

test('two rows, one compile held: both keep the old picture, then both swap in one redraw', async ($, on) => {
  const { clock, compiles, hold, release } = world(on, { TERM: 'xterm-kitty' }, HEAD, { width: 160 })
  // The `done` writes (each one a redraw of every row), counted from the
  // width command.
  let redraws = 0
  on('state.set', async ($: any, e: any, next: any) => {
    if (e.key === 'done') redraws++
    return next(e)
  })
  await $.command.run({ command: 'iui', args: '' } as any)
  const a = await $.ui.mount(wide('two-a', 'First **answer**.'))
  const b = await $.ui.mount(wide('two-b', 'Second **answer**.'))
  await clock.settle()
  await a.redraw(props('First **answer**.'))
  await b.redraw(props('Second **answer**.'))
  const oldA = images(await a.drawn())[0].props.source.file
  const oldB = images(await b.drawn())[0].props.source.file
  expect(compiles.length).toBe(2)
  redraws = 0
  hold('Second')
  await $.command.run({ command: 'iui', args: 'width full' } as any)
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  await a.redraw(props('First **answer**.'))
  await b.redraw(props('Second **answer**.'))
  // A's new picture is ready, but the epoch waits for B's.
  expect(compiles.length).toBe(4)
  expect(images(await a.drawn())[0].props.source.file).toBe(oldA)
  expect(images(await b.drawn())[0].props.source.file).toBe(oldB)
  release()
  await clock.settle()
  // The commit's one refresh drew both rows again (no redraw by the test).
  const nowA = images(await a.drawn())[0].props
  const nowB = images(await b.drawn())[0].props
  expect(nowA.source.file).not.toBe(oldA)
  expect(nowB.source.file).not.toBe(oldB)
  expect([nowA.columns, nowB.columns]).toEqual([255, 255])
  // One redraw at the begin of the epoch, one at its commit.
  expect(redraws).toBe(2)
})

test('a font size change with the same columns compiles once, with a new key', async ($, on) => {
  const { clock, compiles, emit } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, undefined, { line: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(sized('f-2', 'Some **bold** text.', 120))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const [first] = images(await ui.drawn())
  expect(compiles.length).toBe(1)
  // The watcher prints the new size at the SIGWINCH; nothing until quiet.
  emit(TTY_BIG_FONT)
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(1)
  await clock.advance(RESIZE_QUIET_MS)
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(props('Some **bold** text.'))
  const [now] = images(await ui.drawn())
  // The fonts measured again give the same metrics: no second wave.
  await clock.advance(1000)
  await ui.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(2)
  expect(now.props.source.file).not.toBe(first.props.source.file)
  expect(now.props.columns).toBe(118)
})

test('a font size change that changes the font metrics is still one compile wave, with the new metrics', async ($, on) => {
  const other = '{"term":null,"menlo":{"adv":0.6,"xh":0.5,"avg":0.6},"body":{"adv":0.6,"xh":0.5,"avg":0.5}}'
  const { clock, compiles, emit } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, undefined, { line: TTY, metrics: n => (n === 1 ? '{}' : other) })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(sized('f-3', 'Some **bold** text.', 120))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(1)
  emit(TTY_BIG_FONT)
  await clock.advance(RESIZE_QUIET_MS)
  await clock.advance(COMMIT_MIN_MS)
  await ui.redraw(props('Some **bold** text.'))
  await clock.advance(1000)
  await ui.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(2)
  expect(compiles[1]!.code).not.toBe(compiles[0]!.code)
})

test('a height change only compiles a message with a Typst block again, not a plain one', async ($, on) => {
  const { clock, compiles, emit } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, undefined, { line: TTY })
  await $.command.run({ command: 'iui', args: '' } as any)
  const diagram = await $.ui.mount(sized('h-1', DIAGRAM, 120))
  const plain = await $.ui.mount(sized('h-2', 'Some **bold** text.', 120))
  await clock.settle()
  await diagram.redraw(props(DIAGRAM))
  await plain.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(2)
  const before = compiles.find(c => c.height !== undefined)!
  emit('50 120 1920 1600')
  await clock.advance(RESIZE_QUIET_MS)
  await clock.advance(COMMIT_MIN_MS)
  await diagram.redraw(props(DIAGRAM))
  await plain.redraw(props('Some **bold** text.'))
  expect(compiles.length).toBe(3)
  expect(Number(compiles[2]!.height)).toBeGreaterThan(Number(before.height))
  // Same design: the first one.
  expect(compiles[2]!['design-h']).toBe(before['design-h'])
})

test('a watcher that exits 1 (no tty) starts no reads', async ($, on) => {
  const { clock, sizeReads } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, undefined, { watcher: 1 })
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.advance(30000)
  expect(sizeReads.length).toBe(1)
})

// ---- The room of a drawing ------------------------------------------------------

const DIAGRAM = 'A plot:\n\n```typst\n#rect(width: theme.width, height: theme.height)\n```'

test('a first render of a diagram: the design is the space now (factor 1), kept once the compile ends', async ($, on) => {
  const { clock, compiles, files } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('room-1', DIAGRAM))
  await clock.settle()
  await ui.redraw(props(DIAGRAM))
  expect(images(await ui.drawn()).length).toBe(1)
  const [inputs] = compiles
  expect(Number(inputs!.height)).toBeGreaterThan(0)
  const kept = [...files].filter(([path]) => path.includes('/designs/'))
  expect(kept.length).toBe(1)
  expect(kept[0]![1]).toBe(`${inputs!.width} ${inputs!.height}`)
  // A plain answer gets no room: its key does not follow the rows.
  const plain = await $.ui.mount(message('room-2', 'Some **bold** text.'))
  await clock.settle()
  await plain.redraw(props('Some **bold** text.'))
  expect(compiles[1]!.height).toBe(undefined)
  expect(compiles[1]!['design-w']).toBe(undefined)
})

test('a first render at any width sends design-w equal to width (factor exactly 1)', async ($, on) => {
  const { clock, compiles } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'iui', args: '' } as any)
  for (const [i, columns] of [117, 83, 251].entries()) {
    // A plain row settles the new viewport first (it has no design).
    const settle = await $.ui.mount({ ...message(`room-pre-${i}`, `Plain ${i}.`), viewport: { columns, rows: 37 } })
    await clock.advance(RESIZE_QUIET_MS)
    await clock.advance(COMMIT_MIN_MS)
    await settle.unmount()
    const ui = await $.ui.mount({ ...message(`room-w-${i}`, `${DIAGRAM}\n\n${i}`), viewport: { columns, rows: 37 } })
    await clock.settle()
    await ui.redraw(props(`${DIAGRAM}\n\n${i}`))
    await ui.unmount()
    const inputs = compiles.filter(c => c['design-w'] !== undefined)[i]!
    expect(Number(inputs.width)).toBeGreaterThan(0)
    expect(inputs['design-w']).toBe(inputs.width)
    expect(inputs['design-h']).toBe(inputs.height)
  }
})

test('a resize while the first compile runs: the compile is killed, the next uses the same design, one design file', async ($, on) => {
  const { clock, compiles, files, hold, release, kills } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'iui', args: '' } as any)
  hold()
  const ui = await $.ui.mount(sized('race-1', DIAGRAM, 100))
  await clock.settle()
  await ui.unmount()
  const resized = await $.ui.mount(sized('race-1', DIAGRAM, 90))
  await clock.settle()
  expect(compiles.length).toBe(1)
  // Quiet: the epoch kills the compile at 100 columns and compiles at 90.
  await clock.advance(RESIZE_QUIET_MS)
  expect(kills.length).toBe(1)
  expect(compiles.length).toBe(2)
  release()
  await clock.settle()
  await clock.advance(COMMIT_MIN_MS)
  await resized.redraw(props(DIAGRAM))
  expect(images(await resized.drawn()).length).toBe(1)
  expect(compiles.length).toBe(2)
  expect(compiles[1]!['design-w']).toBe(compiles[0]!['design-w'])
  expect(compiles[1]!['design-w']).toBe(compiles[0]!.width)
  expect(compiles[1]!.width).not.toBe(compiles[0]!.width)
  expect([...files.keys()].filter(path => path.includes('/designs/')).length).toBe(1)
})

test('a diagram with a kept design scales from it, and the design is not written again', async ($, on) => {
  const { clock, compiles, files } = world(on, { TERM: 'xterm-kitty' }, HEAD, {}, '500 200')
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('room-3', DIAGRAM))
  await clock.settle()
  await ui.redraw(props(DIAGRAM))
  expect(images(await ui.drawn()).length).toBe(1)
  expect(compiles[0]!['design-w']).toBe('500')
  expect(compiles[0]!['design-h']).toBe('200')
  expect([...files.keys()].filter(path => path.includes('/designs/'))).toEqual([])
})

// ---- Link rows --------------------------------------------------------------

// The elements of a type in a drawn tree, outermost first.
const all = (tree: any, type: string): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === type ? [tree] : []), ...(tree.children ?? []).flatMap((c: any) => all(c, type))] : []
const textOf = (tree: any): string => (typeof tree === 'string' ? tree : (tree?.children ?? []).map(textOf).join(''))

test('a file path is made absolute and kept only when it is a file; ~/ is the home folder; the href is encoded', async () => {
  const asked: string[] = []
  const $ = { fs: { exists: async (path: string) => (asked.push(path), path !== '/w/app/gone.ts') } } as any
  const items = [
    { kind: 'web', label: 'Docs', href: 'https://typst.app/docs' },
    { kind: 'file', label: 'src/a b.ts:42', path: 'src/a b.ts' },
    { kind: 'file', label: 'gone.ts', path: 'gone.ts' },
    { kind: 'file', label: '~/x#1.md', path: '~/x#1.md' },
    { kind: 'file', label: '/abs/y.md', path: '/abs/y.md' },
    { kind: 'command', label: 'npm test', text: 'npm test' },
  ] as const
  const shown = await resolveLinks($, items, '/w/app/', '/h')
  expect(shown).toEqual([
    items[0],
    { kind: 'file', label: 'src/a b.ts:42', path: '/w/app/src/a b.ts', href: 'file:///w/app/src/a%20b.ts' },
    { kind: 'file', label: '~/x#1.md', path: '/h/x#1.md', href: 'file:///h/x%231.md' },
    { kind: 'file', label: '/abs/y.md', path: '/abs/y.md', href: 'file:///abs/y.md' },
    items[5],
  ])
  // Each path is checked once.
  await resolveLinks($, items, '/w/app', '/h')
  expect(asked).toEqual(['/w/app/src/a b.ts', '/w/app/gone.ts', '/h/x#1.md', '/abs/y.md'])
  expect(fileHref('/a/b?c.md')).toBe('file:///a/b%3Fc.md')
})

const LINKED = [
  'See [Typst docs](https://typst.app/docs) and https://github.com/o/r/pull/42.',
  '',
  'The copy is in `hooks/lib/copy.ts:42`; `hooks/lib/gone.ts` is not.',
  '',
  '```bash',
  '$ brew install typst',
  '```',
  '',
  '```sh',
  'npm test',
  'npm run lint',
  '```',
].join('\n')

test('an answer draws its links, files and commands under its pages, one dim row each; a press copies the command', async ($, on) => {
  const { clock, files, toasts } = world(on, { TERM: 'xterm-kitty' })
  files.set('/w/app/hooks/lib/copy.ts', '')
  on('session.cwd', async () => ({ value: '/w/app' }))
  const copies: string[] = []
  on('ui.copy', async ($: any, e: any) => (copies.push(`${e.surface}:${e.text}`), { value: { isCopied: true } }))
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('links-1', LINKED))
  await clock.settle()
  await ui.redraw(props(LINKED))
  const tree: any = await ui.drawn()
  // The column of the pages: the page, then one row per item.
  const column = tree.children.at(-1)
  expect(column.children.length).toBe(images(tree).length + 5)
  const rows = column.children.slice(images(tree).length)
  expect(rows.map(textOf)).toEqual([
    '↗ Typst docs  https://typst.app/docs',
    '↗ https://github.com/o/r/pull/42',
    '↗ hooks/lib/copy.ts:42',
    '$ brew install typst',
    '$ npm test (+1 line)',
  ])
  for (const row of rows.slice(0, 3)) expect(row.props).toMatchObject({ dimColor: true, wrap: 'truncate-end' })
  expect(all(tree, 'Link').map(l => l.props.href)).toEqual(['https://typst.app/docs', 'https://github.com/o/r/pull/42', 'file:///w/app/hooks/lib/copy.ts'])
  const buttons = all(tree, 'Button')
  expect(buttons.length).toBe(2)
  for (const b of buttons) expect(b.props).toMatchObject({ plain: true, dimColor: true })
  expect(buttons[0].props.key).toMatch(/^link-[0-9a-f]{8}$/)
  // A command row is one row: a Box one row high, its text cut at the end.
  expect(rows[4].props).toMatchObject({ height: 1, overflow: 'hidden' })
  expect(all(rows[4], 'Text')[0].props).toMatchObject({ wrap: 'truncate-end' })
  await ui.press({ key: buttons[1].props.key })
  expect(copies).toEqual(['terminal:npm test\nnpm run lint'])
  expect(toasts).toContain('Copied')
})

test('a press on a command row that cannot copy toasts the reason, or none', async ($, on) => {
  const { clock, toasts } = world(on, { TERM: 'xterm-kitty' })
  let reply: any = { isCopied: false, reason: 'no clipboard' }
  on('ui.copy', async () => (reply instanceof Error ? { deny: reply.message } : { value: reply }))
  await $.command.run({ command: 'iui', args: '' } as any)
  const text = 'Run:\n\n```sh\nnpm test\n```'
  const ui = await $.ui.mount(message('links-3', text))
  await clock.settle()
  await ui.redraw(props(text))
  const [button] = all(await ui.drawn(), 'Button')
  await ui.press({ key: button.props.key })
  reply = new Error('boom')
  await ui.press({ key: button.props.key })
  expect(toasts.filter(t => t.startsWith('Could not copy'))).toEqual(['Could not copy: no clipboard', 'Could not copy'])
})

test('the link rows of a text are none when a file check throws', async () => {
  const $ = { fs: { exists: () => { throw new Error('gone') } } } as any
  expect(await linksFor($, 'See `src/never-checked.ts`.', '/w')).toEqual([])
})

test('a page with a note draws it under the pages, and with gutter 0 draws no bullet column', () => {
  const $ = { ui: { resolve: () => ({ Box: 'Box', Text: 'Text', Image: 'Image' }) } } as any
  const page = { file: '/c/k/a-1.png', width: 1568, height: 64, alt: 'x', columns: 98, rows: 2 }
  const e = { viewport: { columns: 100, rows: 40 } } as any
  const noted: any = drawPages($, e, { pages: [page], bulletRow: 0, note: 'bad font' })
  expect(textOf(noted)).toContain('Typst error: bad font')
  expect(all(noted, 'Box').some(b => b.props.width === 2)).toBe(true)
  const bare: any = drawPages($, e, { pages: [page], bulletRow: 0 }, undefined, { gutter: 0 })
  expect(textOf(bare)).not.toContain('Typst error')
  expect(all(bare, 'Box').some(b => b.props.width !== undefined)).toBe(false)
  expect(images(bare).length).toBe(1)
})

test('an answer with no links draws as before: no row under its pages', async ($, on) => {
  const { clock } = world(on, { TERM: 'xterm-kitty' })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('links-2', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  const tree: any = await ui.drawn()
  expect(tree.children.at(-1).children.length).toBe(1)
  expect(all(tree, 'Link')).toEqual([])
  expect(all(tree, 'Button')).toEqual([])
})
