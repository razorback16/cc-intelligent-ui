import { expect, mock, test } from 'claude-code/testing'

import { DEFAULT_CELL, DEFAULT_METRICS, DEFAULT_THEME, fontFit, hashOf, nextJob, renderKey } from '../hooks/register'
// This file's own copy of the pipeline (the plugin's module is another one),
// driven with this test's `$`: pagesOf and the queue and results it fills
// are module state, which register.tsx does not export.
import { epochOpen, lastKey, queue, results, running, S, type Env } from '../hooks/lib/state'
import { pagesOf } from '../hooks/lib/answer'
import { beginEpoch } from '../hooks/lib/epoch'
import { forgetTouches } from '../hooks/lib/typst'
import { COMMIT_MIN_MS, TOUCH_FLUSH_MS } from '../hooks/lib/settings'

// The world beneath the mod for one compile: a cache folder, a typst whose
// compile the test lets finish (or fail), and the PNG it "wrote".
const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// The first 24 bytes of a 1600 x 64 PNG, as `od -An -v -tx1` prints them.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 00 40'
// 1600 x 9000: over 255 rows of 32 px.
const TALL = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 23 28'

// `tall`: the first run's pages are TALL (the split retry's are not).
function world(on: any, o: { fail?: boolean; slow?: Promise<void>; tall?: boolean } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  const compiled: string[] = []
  // The segments of each compile.
  const counts: number[] = []
  const files = new Map<string, string>()
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (/md-preview-/.test(cmd)) return ok('/c\nDarwin\n')
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (argv[0] === 'kill') return ok('')
    if (cmd.includes('od -An')) {
      const pngs = argv.filter(a => a.endsWith('.png'))
      return ok(pngs.map(f => `${o.tall && /\/a-\d+\.png$/.test(f) ? TALL : HEAD}\n@\n`).join(''))
    }
    if (argv[0] === 'sh' && cmd.includes('debug.log')) return ok('')
    if (argv[0] === 'defaults') return ok('', 1)
    return ok('', 1)
  })
  // Typst runs through the PID wrapper (wrapPid): its first stdout line is
  // the PID. Any other child (the tty watcher) ends at once.
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    if (argv[0] !== 'sh' || argv[2] !== 'echo $$; exec "$@"' || argv[4] !== '/usr/bin/typst' || argv[5] !== 'compile') {
      return { value: { code: 2, signal: null } }
    }
    yield { stream: 'stdout', text: '4242\n' }
    const doc = argv.find(a => a.startsWith('doc='))!.slice(4)
    const { segments } = JSON.parse(files.get(doc)!)
    compiled.push(segments.join('\n\n'))
    counts.push(segments.length)
    if (o.slow) await o.slow
    if (o.fail) yield { stream: 'stderr', text: 'error: boom' }
    return { value: { code: o.fail ? 1 : 0, signal: null } }
  })
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => (files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)))
  const png = (name: string) => ({ name, kind: 'file', size: 1, mtimeMs: 1, isLink: false })
  on('fs.list', async ($: any, e: any, next: any) => (e.path.startsWith('/c/') ? { value: ['a-1.png', 'c-1.png', 'c-2.png'].map(png) } : next(e)))
  on('fs.exists', async ($: any, e: any, next: any) => (e.path.includes('/designs/') ? { value: files.has(e.path) } : next(e)))
  on('ui.toast', async () => ({ value: undefined }))
  const designs = () => [...files.keys()].filter(path => path.includes('/designs/'))
  return { clock, compiled, counts, files, designs }
}

const message = (requestId: string, text: string) =>
  ({
    plugin: 'md-preview', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40 },
  }) as any
const props = (text: string) => ({ text, isFirstOfReply: true }) as any
const kinds = (tree: any): string[] => (tree && typeof tree === 'object' ? [tree.type, ...(tree.children ?? []).flatMap(kinds)] : [])
const isBlank = (tree: any) => tree.type === 'Box' && !(tree.children ?? []).length
const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }
const images = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Image' ? [tree] : []), ...(tree.children ?? []).flatMap(images)] : []

// A model request the test streams chunk by chunk; `release` ends it.
function request(on: any, more: unknown[] = []) {
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: '# Title' }
    for (const chunk of more) yield chunk
    await gate
    return { turnId: 't', index: 0, answer: '# Title', toolUses: [], stopReason: 'end_turn' }
  })
  return () => release()
}

test('a block draws nothing while it streams, and its picture once the request ends, with no 400 ms wait', async ($, on) => {
  const { clock, compiled } = world(on)
  on('ui.render', () => ENGINE as any)
  const end = request(on)
  // Ready the mod (setUp) before the stream starts.
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const stream = ($ as any).turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  await stream.next()
  const ui = await $.ui.mount(message('live-1', '# Ti'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await ui.redraw(props('# Title\n\nSome'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await clock.advance(1500)
  expect(compiled).toEqual([])
  await ui.redraw(props('# Title\n\nSome text.'))
  expect(isBlank(await ui.drawn())).toBe(true)
  end()
  const done = stream.next()
  await clock.settle()
  await done
  expect(compiled).toEqual(['# Title\n\nSome text.'])
  await ui.redraw(props('# Title\n\nSome text.'))
  expect(kinds(await ui.drawn())).toContain('Image')
})

test('a block whose compile fails draws as text', async ($, on) => {
  const { clock } = world(on, { fail: true })
  on('ui.render', () => ENGINE as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('fail-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
})

test('with no request seen, a changing block is final after 400 ms still', async ($, on) => {
  const { clock, compiled } = world(on)
  on('ui.render', () => ENGINE as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('reload-1', 'One'))
  await clock.settle()
  // Seen once (resumed, so final at once); a change outside a request is live.
  await ui.redraw(props('One two'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await clock.advance(300)
  await ui.redraw(props('One two three'))
  await clock.advance(300)
  expect(compiled).toEqual(['One'])
  await clock.advance(150)
  expect(compiled).toEqual(['One', 'One two three'])
  await ui.redraw(props('One two three'))
  expect(kinds(await ui.drawn())).toContain('Image')
})

test('a resumed block compiles at once, blank for at most 1 s, then its text until the picture is ready', async ($, on) => {
  let finish!: () => void
  const slow = new Promise<void>(r => (finish = r))
  const { clock, compiled } = world(on, { slow })
  on('ui.render', () => ENGINE as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('old-1', 'An old answer.'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await clock.settle()
  expect(compiled).toEqual(['An old answer.'])
  await clock.advance(1000)
  await ui.redraw(props('An old answer.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
  finish()
  await clock.settle()
  await ui.redraw(props('An old answer.'))
  expect(kinds(await ui.drawn())).toContain('Image')
})

test('a text block is final when its request moves on to a tool call, before the request ends', async ($, on) => {
  const { clock, compiled } = world(on)
  on('ui.render', () => ENGINE as any)
  const end = request(on, [{ kind: 'tool', index: 1, id: 'toolu_1', name: 'Write' }])
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const stream = ($ as any).turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  await stream.next()
  const ui = await $.ui.mount(message('tool-1', 'Let me write the file.'))
  expect(isBlank(await ui.drawn())).toBe(true)
  // The tool chunk: the text block is done though the request goes on.
  await stream.next()
  await clock.settle()
  expect(compiled).toEqual(['Let me write the file.'])
  await ui.redraw(props('Let me write the file.'))
  expect(kinds(await ui.drawn())).toContain('Image')
  end()
  await stream.next()
})

test('a diagram keeps its design only after its final text compiled, never while it streams', async ($, on) => {
  const { clock, compiled, designs } = world(on)
  on('ui.render', () => ENGINE as any)
  const end = request(on)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const stream = ($ as any).turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  await stream.next()
  const text = '# Title\n\n```typst\n#rect(width: theme.width)\n```'
  const ui = await $.ui.mount(message('design-1', '# Title\n\n```typst\n#rect('))
  await ui.redraw(props(text))
  await clock.advance(1500)
  expect(compiled).toEqual([])
  expect(designs()).toEqual([])
  end()
  const done = stream.next()
  await clock.settle()
  await done
  expect(compiled).toEqual([text])
  expect(designs().length).toBe(1)
})

test('a page over 255 rows: its segment is cut in two and compiled once more', async ($, on) => {
  const { clock, counts } = world(on, { tall: true })
  on('ui.render', () => ENGINE as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`.trim()).join('\n\n')
  const ui = await $.ui.mount(message('tall-1', text))
  await clock.settle()
  await ui.redraw(props(text))
  expect(counts).toEqual([1, 2])
  const pages = images(await ui.drawn())
  expect(pages.length).toBe(2)
  expect(pages.map(p => p.props.source.file.replace(/^.*\//, ''))).toEqual(['c-1.png', 'c-2.png'])
  for (const p of pages) expect(p.props.rows).toBeLessThanOrEqual(255)
})

// ---- The pipeline on its own ----------------------------------------------------

const ENV: Env = {
  typst: '/usr/bin/typst', canDraw: true, inline: false, cache: '/c', cwd: '/w', root: '/mod', isMac: true, stamp: '1', home: '/h',
  claudeTmp: '', termFont: '', metrics: DEFAULT_METRICS, designs: '/h/designs',
}
const FRAME = { columns: 100, rows: 40, cell: DEFAULT_CELL }
// The key pagesOf makes for a plain text in FRAME with the defaults.
const keyOf = (text: string) =>
  renderKey({
    textHash: hashOf([text]), columns: 98, cell: DEFAULT_CELL, size: 100, mode: 'dark', termFont: '', columnPt: fontFit(DEFAULT_METRICS, 100).columnPt,
    templateStamp: '1', look: { name: DEFAULT_THEME, dir: `/mod/render/themes/${DEFAULT_THEME}`, stamp: '0' }, inline: false,
  })
const PAGE = { file: '', width: 1568, height: 64, alt: 'x', columns: 98, rows: 2 }

// A `$` of the plugin's kind for this copy: pages.json of any key reads
// back, every process fails (and is noted), the clock runs only at `advance`.
function pipeline() {
  const runs: string[][] = []
  const clock = fakeClock()
  const $ = {
    fs: {
      read: async (path: string) => {
        const m = /^\/c\/([0-9a-f]{16})\/pages\.json$/.exec(path)
        if (!m) throw new Error('ENOENT')
        return JSON.stringify({ pages: [{ ...PAGE, file: `/c/${m[1]}/a-1.png` }], bulletRow: 0 })
      },
    },
    process: {
      run: async (argv: string[]) => {
        runs.push(argv)
        return { exitCode: 1, stdout: '', stderr: '' }
      },
    },
    clock: clock.clock,
  } as any
  fresh()
  // No compile starts: the queue is only read.
  const signal = new AbortController().signal
  running.set('x', { job: {} as any, cancel: () => {}, signal }).set('y', { job: {} as any, cancel: () => {}, signal })
  return { $, runs, advance: clock.advance }
}

// The module state of this copy as at a first render: no jobs, no results,
// the epoch closed, FRAME shown.
function fresh() {
  forgetTouches()
  queue.length = 0
  results.clear()
  running.clear()
  lastKey.clear()
  S.onDisk = new Set()
  S.resizing = false
  S.missed = false
  S.frame = FRAME
  S.shown = FRAME
  S.shownEpoch = S.epoch
}

// A clock whose timers run only at `advance` (in order of their time).
function fakeClock() {
  let now = 0
  let timers: Array<{ at: number; fn: () => void; isOff: boolean }> = []
  return {
    clock: {
      after: (ms: number, fn: () => void) => {
        const t = { at: now + ms, fn, isOff: false }
        timers.push(t)
        return { cancel: () => (t.isOff = true) }
      },
    },
    advance: (ms: number) => {
      now += ms
      for (;;) {
        const due = timers.filter(t => !t.isOff && t.at <= now).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers = timers.filter(t => t !== due)
        due.fn()
      }
    },
  }
}

// Lets the promise chains run (a compile is many awaits).
const drain = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

// A `$` that compiles for real through this copy's queue: an in-memory fs,
// typst through the PID wrapper with spawn (each run waits until the test
// ends it, or `kill <pid>` kills it), and a count of the redraws.
function compiler() {
  const files = new Map<string, string>()
  const clock = fakeClock()
  const runs: { argv: string[]; key: string; end: (code: number | null) => void }[] = []
  const kills: string[] = []
  let redraws = 0
  let pid = 1000
  const $ = {
    fs: {
      read: async (path: string) => {
        if (!files.has(path)) throw new Error('ENOENT')
        return files.get(path)!
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
      exists: async (path: string) => files.has(path),
      list: async () => [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }],
    },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === 'kill') {
          kills.push(argv[1]!)
          runs.find(r => r.argv.includes(`pid=${argv[1]}`))?.end(null)
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        if (argv.join(' ').includes('od -An')) return { exitCode: 0, stdout: `${HEAD}\n@\n`, stderr: '' }
        return { exitCode: 1, stdout: '', stderr: '' }
      },
      spawn: (request: { argv: string[] }) => {
        const argv = [...request.argv, `pid=${++pid}`]
        const key = /\/c\/([0-9a-f]{16})\//.exec(argv.find(a => a.startsWith('doc=')) ?? '')?.[1] ?? ''
        let end!: (code: number | null) => void
        const ended = new Promise<number | null>(r => (end = r))
        runs.push({ argv, key, end })
        const mine = pid
        return (async function* () {
          yield { stream: 'stdout' as const, text: `${mine}\n` }
          const code = await ended
          return { code, signal: code === null ? 'SIGTERM' : null }
        })()
      },
    },
    state: {
      get: async () => {
        throw new Error('no store')
      },
    },
    ui: {
      invalidate: () => {
        redraws++
      },
    },
    clock: clock.clock,
  } as any
  fresh()
  return { $, runs, kills, files, advance: clock.advance, redraws: () => redraws }
}

test('a key found on disk at setUp (a reopened session) draws at once: no queue, no blank; its folder is touched', async () => {
  const { $, runs, advance } = pipeline()
  const key = keyOf('An old answer.')
  S.onDisk = new Set([key])
  const drawing = await pagesOf($, { id: 'disk-1', text: 'An old answer.', frame: FRAME, env: ENV, canStream: true })
  expect(drawing).toMatchObject({ kind: 'pages', result: { pages: [{ file: `/c/${key}/a-1.png`, columns: 98, rows: 2 }] } })
  expect(queue.length).toBe(0)
  expect(results.has(key)).toBe(true)
  // Touched later, in one batch (no process in a render path).
  expect(runs.some(argv => argv[0] === 'touch')).toBe(false)
  advance(TOUCH_FLUSH_MS)
  expect(runs).toContainEqual(['touch', '-c', `/c/${key}`])
  // Not on disk: it waits in the queue, blank.
  S.onDisk = new Set()
  const other = await pagesOf($, { id: 'disk-2', text: 'A new answer.', frame: FRAME, env: ENV, canStream: true, onScreen: true })
  expect(other.kind).toBe('blank')
  expect(queue.map(j => [j.key, j.onScreen])).toEqual([[keyOf('A new answer.'), true]])
})

test('the queue: rows on screen first, then the newest; a job enqueued again takes its new place', async () => {
  const { $ } = pipeline()
  S.onDisk = new Set()
  const draw = (id: string, onScreen?: boolean) => pagesOf($, { id, text: `Text of ${id}.`, frame: FRAME, env: ENV, canStream: false, onScreen })
  await draw('a', true)
  await draw('b')
  await draw('c')
  expect(queue[nextJob(queue)]!.requestId).toBe('a')
  // Scrolled away, then drawn again: now only the newest.
  await draw('a')
  expect(queue.length).toBe(3)
  expect(queue[nextJob(queue)]!.requestId).toBe('a')
  await draw('b')
  expect(queue[nextJob(queue)]!.requestId).toBe('b')
  await draw('c', true)
  await draw('b')
  expect(queue[nextJob(queue)]!.requestId).toBe('c')
})

test('a cancelled compile is killed by its PID, keeps nothing, frees its slot, and its key compiles again', async () => {
  const { $, runs, kills } = compiler()
  const draw = (id: string) => pagesOf($, { id, text: `Text of ${id}.`, frame: FRAME, env: ENV, canStream: false, onScreen: true })
  await draw('k1')
  await draw('k2')
  await draw('k3')
  await drain()
  // Two run (MAX_RUNNING), through the PID wrapper; one waits.
  expect(runs.length).toBe(2)
  expect(runs[0]!.argv.slice(0, 6)).toEqual(['sh', '-c', 'echo $$; exec "$@"', 'sh', '/usr/bin/typst', 'compile'])
  expect(queue.length).toBe(1)
  // A new epoch stops both and empties the queue.
  beginEpoch($)
  expect(queue.length).toBe(0)
  // The key of k1 is wanted again while its killed run still ends.
  await draw('k1')
  expect(queue.map(j => j.key)).toEqual([keyOf('Text of k1.')])
  await drain()
  expect(kills.length).toBe(2)
  expect(results.has(keyOf('Text of k1.'))).toBe(false)
  expect(results.has(keyOf('Text of k2.'))).toBe(false)
  // Its slot is free: k1 runs again, in the new epoch.
  expect(runs.length).toBe(3)
  expect(runs[2]!.key).toBe(keyOf('Text of k1.'))
  expect(running.get(keyOf('Text of k1.'))?.job.epoch).toBe(S.epoch)
  runs[2]!.end(0)
  await drain()
  expect(results.get(keyOf('Text of k1.'))).toMatchObject({ pages: [{ columns: 98 }] })
  expect(running.size).toBe(0)
})

test('in an open epoch a row keeps its old picture; no redraw as jobs end; all swap at the commit', async () => {
  const { $, runs, advance, redraws } = compiler()
  const text = 'An answer.'
  const draw = (id: string, t: string, frame: typeof FRAME) => pagesOf($, { id, text: t, frame, env: ENV, canStream: false, onScreen: true })
  // The first picture, with no epoch open: its row redraws when it ends.
  await draw('e1', text, FRAME)
  await drain()
  runs[0]!.end(0)
  await drain()
  expect(redraws()).toBe(1)
  const first = await draw('e1', text, FRAME)
  expect(first).toMatchObject({ kind: 'pages', result: { pages: [{ columns: 98 }] } })
  // A new target, 80 columns.
  const narrow = { ...FRAME, columns: 80 }
  beginEpoch($, narrow)
  expect(epochOpen()).toBe(true)
  await drain()
  // Its own one redraw (the rows draw their old pictures and enqueue).
  expect(redraws()).toBe(2)
  const before = redraws()
  const held = await draw('e1', text, narrow)
  expect(held).toEqual(first)
  // A new row (no old picture) waits blank.
  expect((await draw('n1', 'A new answer.', narrow)).kind).toBe('blank')
  await drain()
  expect(runs.length).toBe(3)
  runs[1]!.end(0)
  runs[2]!.end(0)
  await drain()
  // Both done: no redraw for a job; the epoch is not ready yet.
  expect(redraws()).toBe(before)
  expect(await draw('e1', text, narrow)).toEqual(first)
  // A row with no old picture draws its target as soon as it is there.
  expect(await draw('n1', 'A new answer.', narrow)).toMatchObject({ kind: 'pages', result: { pages: [{ columns: 78 }] } })
  // COMMIT_MIN_MS: the commit, one redraw; then the target.
  advance(COMMIT_MIN_MS)
  expect(epochOpen()).toBe(false)
  await drain()
  expect(redraws()).toBe(before + 1)
  expect(await draw('e1', text, narrow)).toMatchObject({ kind: 'pages', result: { pages: [{ columns: 78 }] } })
})

test('in an open epoch a failed target waits too: the old picture until the commit, then the text', async () => {
  const { $, runs, advance } = compiler()
  const text = 'Another answer.'
  const draw = (frame: typeof FRAME) => pagesOf($, { id: 'f1', text, frame, env: ENV, canStream: false, onScreen: true })
  await draw(FRAME)
  await drain()
  runs[0]!.end(0)
  await drain()
  const first = await draw(FRAME)
  expect(first.kind).toBe('pages')
  const narrow = { ...FRAME, columns: 80 }
  beginEpoch($, narrow)
  await draw(narrow)
  await drain()
  // The run and its safe retry fail.
  runs[1]!.end(1)
  await drain()
  runs[2]!.end(1)
  await drain()
  expect(await draw(narrow)).toEqual(first)
  advance(COMMIT_MIN_MS)
  expect(await draw(narrow)).toEqual({ kind: 'text' })
})


test('a cancelled compile does not redraw, even when it ends after the epoch committed', async () => {
  const { $, runs, kills, advance, redraws } = compiler()
  await pagesOf($, { id: 'c1', text: 'Text of c1.', frame: FRAME, env: ENV, canStream: false, onScreen: true })
  await drain()
  expect(runs.length).toBe(1)
  // A new epoch stops it; nothing of the epoch waits, so it commits before
  // the killed run's end is read.
  beginEpoch($)
  expect(kills.length).toBe(1)
  advance(COMMIT_MIN_MS)
  expect(epochOpen()).toBe(false)
  await drain()
  expect(running.size).toBe(0)
  // The begin and the commit only.
  expect(redraws()).toBe(2)
})

test('a row drawn late in an epoch (150 ms after its begin) still swaps at the commit, with one redraw', async () => {
  const { $, runs, advance, redraws } = compiler()
  const draw = (id: string, frame: typeof FRAME) => pagesOf($, { id, text: `Text of ${id}.`, frame, env: ENV, canStream: false, onScreen: true })
  const ids = ['l1', 'l2', 'l3']
  for (const [i, id] of ids.entries()) {
    await draw(id, FRAME)
    await drain()
    runs[i]!.end(0)
    await drain()
  }
  const firsts = await Promise.all(ids.map(id => draw(id, FRAME)))
  expect(firsts.every(d => d.kind === 'pages')).toBe(true)
  const narrow = { ...FRAME, columns: 80 }
  beginEpoch($, narrow)
  await drain()
  const before = redraws()
  // l1 draws at once; its job ends at 50 ms.
  expect(await draw('l1', narrow)).toEqual(firsts[0])
  await drain()
  advance(50)
  runs[3]!.end(0)
  await drain()
  // l2 draws at 80 ms (the rows come after round trips to the host).
  advance(30)
  expect(await draw('l2', narrow)).toEqual(firsts[1])
  await drain()
  runs[4]!.end(0)
  await drain()
  // At 100 ms nothing waits, but the epoch is not ready: its last row came at 80 ms.
  advance(20)
  expect(epochOpen()).toBe(true)
  // l3 draws at 150 ms: its old picture still, and its job holds the commit.
  advance(50)
  expect(await draw('l3', narrow)).toEqual(firsts[2])
  await drain()
  runs[5]!.end(0)
  await drain()
  expect(redraws()).toBe(before)
  advance(COMMIT_MIN_MS - 1)
  expect(epochOpen()).toBe(true)
  advance(1)
  expect(epochOpen()).toBe(false)
  await drain()
  // The commit's one redraw; all three swap.
  expect(redraws()).toBe(before + 1)
  for (const id of ids) expect(await draw(id, narrow)).toMatchObject({ kind: 'pages', result: { pages: [{ columns: 78 }] } })
})
