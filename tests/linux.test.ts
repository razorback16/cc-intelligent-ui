import { expect, mock, test } from 'claude-code/testing'

import {
  clipToolsOf, clipWayOf, editorArgv, familyOfFc, FIND_SH, GHOSTTY_DEFAULT_FONT, GTK_READ_PY, GTK_WATCH_PY, guiEditorOf, hintText, LINUX_EDITORS,
  placeholderCell, schemeOfPortal, SETUP_NOT_MAC, WATCH_PL, WL_WATCH_SH, X11_WATCH_SH, type ClipWay,
} from '../hooks/register'
import { CACHE_SH } from '../hooks/lib/env'
import { clipboardNow, clipWatchArgs, clipWayReady, findClipWay } from '../hooks/lib/clipboard'
import { S } from '../hooks/lib/state'
import { SMALL_MARKS, SMALL_MD } from './copy-fixture'

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })

// ---- The clipboard: which way on Linux -----------------------------------------

const ALL = { 'wl-paste': '/usr/bin/wl-paste', xclip: '/usr/bin/xclip', xsel: '/usr/bin/xsel', clipnotify: '/usr/local/bin/clipnotify', gtk: '/usr/bin/python3' }

test('the tools found: `name path` lines, absolute paths only', () => {
  expect(clipToolsOf('wl-paste /usr/bin/wl-paste\nxclip /usr/bin/xclip\ngtk /usr/bin/python3\nxsel xsel\nother /bin/x\n')).toEqual({
    'wl-paste': '/usr/bin/wl-paste', xclip: '/usr/bin/xclip', gtk: '/usr/bin/python3',
  })
  expect(clipToolsOf('')).toEqual({})
  // GTK is checked only when there is no clipnotify.
  expect(FIND_SH).toContain('command -v clipnotify >/dev/null 2>&1 || {')
  expect(FIND_SH).toContain('echo "gtk $p"')
})

test('Wayland (not GNOME): wl-paste reads, and its --watch sees each change', () => {
  const way = clipWayOf({ wayland: true, x11: true, desktop: 'KDE', found: ALL })
  expect(way).toEqual({
    name: 'wl-paste --watch (Wayland)', read: ['/usr/bin/wl-paste', '-n', '-t', 'text'],
    watch: ['/usr/bin/wl-paste', '--watch', 'sh', '-c', WL_WATCH_SH], wayland: true,
  })
  // The data goes to the end, and a sensitive copy gives no line.
  expect(WL_WATCH_SH).toBe('cat >/dev/null; [ "$CLIPBOARD_STATE" = sensitive ] || echo')
})

test('GNOME on Wayland (no data-control): the X11 tools through Xwayland come first, wl-paste last', () => {
  expect(clipWayOf({ wayland: true, x11: true, desktop: 'ubuntu:GNOME', found: ALL })).toEqual({
    name: 'clipnotify and xclip (X11, Xwayland)', read: ['/usr/bin/xclip', '-o', '-selection', 'clipboard', '-t', 'UTF8_STRING'],
    watch: ['sh', '-c', X11_WATCH_SH, '/usr/local/bin/clipnotify'], wayland: false,
  })
  // Only GTK (a GNOME desktop with no other tool): GTK reads and watches.
  const gtk = clipWayOf({ wayland: true, x11: true, desktop: 'GNOME', found: { gtk: '/usr/bin/python3' } }) as Extract<ClipWay, { name: string }>
  expect(gtk.name).toBe('GTK (X11, Xwayland)')
  expect(gtk.read).toEqual(['/usr/bin/env', 'GDK_BACKEND=x11', 'PYTHONIOENCODING=utf-8', '/usr/bin/python3', '-c', GTK_READ_PY])
  expect(gtk.watch).toEqual(['/usr/bin/env', 'GDK_BACKEND=x11', 'PYTHONIOENCODING=utf-8', '/usr/bin/python3', '-c', GTK_WATCH_PY])
  // No X tool: wl-paste (its --watch can fail; then the copy is off).
  expect(clipWayOf({ wayland: true, x11: true, desktop: 'GNOME', found: { 'wl-paste': '/w' } })).toMatchObject({ name: 'wl-paste --watch (Wayland)', wayland: true })
})

test('X11: clipnotify or GTK sees the changes; xclip, xsel or GTK reads', () => {
  expect(clipWayOf({ wayland: false, x11: true, desktop: 'XFCE', found: { xsel: '/x/xsel', clipnotify: '/x/cn' } })).toMatchObject({
    name: 'clipnotify and xsel (X11)', read: ['/x/xsel', '-o', '-b'],
  })
  expect(clipWayOf({ wayland: false, x11: true, desktop: '', found: { xclip: '/x/xclip', gtk: '/p' } })).toMatchObject({
    name: 'GTK and xclip (X11)', read: ['/x/xclip', '-o', '-selection', 'clipboard', '-t', 'UTF8_STRING'],
  })
  // wl-paste is not used with no Wayland display.
  expect(clipWayOf({ wayland: false, x11: true, desktop: '', found: { 'wl-paste': '/w', xclip: '/x/xclip' } })).toEqual({
    off: 'no clipnotify and no GTK 3 for Python: X11 has no clipboard event for xclip',
  })
  expect(clipWayOf({ wayland: false, x11: true, desktop: '', found: {} })).toEqual({ off: 'no xclip, xsel or GTK 3 for Python, and no clipnotify' })
  expect(clipWayOf({ wayland: true, x11: false, desktop: 'sway', found: { xclip: '/x' } })).toEqual({ off: 'no wl-paste (install wl-clipboard)' })
  expect(clipWayOf({ wayland: false, x11: false, desktop: '', found: ALL })).toEqual({ off: 'no Wayland or X11 display' })
  // clipnotify 1.0.3+ loops by itself (-l); an older one exits at each change.
  expect(X11_WATCH_SH).toBe('echo; while "$0" -s clipboard -l; do echo; done')
})

test('the GTK scripts: X11 events, a line at the start, a text read that fails with no text', () => {
  expect(GTK_WATCH_PY).toContain('Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).connect("owner-change", say)')
  expect(GTK_WATCH_PY).toContain('sys.stdout.write("\\n"); sys.stdout.flush()')
  expect(GTK_WATCH_PY).toContain('if Gdk.Display.get_default() is None: sys.exit(1)')
  expect(GTK_READ_PY).toContain('.wait_for_text()')
  expect(GTK_READ_PY).toContain('if t is None: sys.exit(1)')
})

test('the /iui grab hint line: on when the watcher sees the changes, else off with the reason', () => {
  const base = { isMac: true, hostOs: 'Darwin', isRemote: false, isOn: true, none: false, drawn: true, running: true, way: null as ClipWay | null }
  expect(hintText(base)).toBe('on')
  expect(hintText({ ...base, isMac: false, hostOs: 'FreeBSD' })).toBe('off (not macOS or Linux)')
  expect(hintText({ ...base, isRemote: true })).toBe('off (ssh)')
  expect(hintText({ ...base, isOn: false })).toBe('off (Intelligent UI is off)')
  expect(hintText({ ...base, none: true })).toBe('off (no PerlObjCBridge in /usr/bin/perl)')
  expect(hintText({ ...base, drawn: false })).toBe('off (no picture yet)')
  expect(hintText({ ...base, running: false })).toBe('off (the watcher does not run)')
  // ssh first, then Intelligent UI off, then the bridge, then no picture.
  expect(hintText({ ...base, isRemote: true, isOn: false, none: true })).toBe('off (ssh)')
  expect(hintText({ ...base, isOn: false, none: true, drawn: false })).toBe('off (Intelligent UI is off)')
  expect(hintText({ ...base, none: true, drawn: false })).toBe('off (no PerlObjCBridge in /usr/bin/perl)')
  const wl = clipWayOf({ wayland: true, x11: false, desktop: 'sway', found: ALL })
  const linux = { ...base, isMac: false, hostOs: 'Linux', way: wl }
  expect(hintText(linux)).toBe('on, with wl-paste --watch (Wayland)')
  expect(hintText({ ...linux, none: true })).toBe('off (wl-paste --watch (Wayland) stopped: the compositor may not have the data-control protocol)')
  expect(hintText({ ...linux, way: clipWayOf({ wayland: false, x11: true, desktop: '', found: ALL }), none: true })).toBe('off (clipnotify and xclip (X11) stopped)')
  expect(hintText({ ...linux, way: { off: 'no Wayland or X11 display' } })).toBe('off (no Wayland or X11 display)')
  expect(hintText({ ...linux, way: null })).toBe('off (the clipboard tools are not looked up yet)')
  // On Linux: ssh first, then the way, then Intelligent UI off.
  expect(hintText({ ...linux, isRemote: true, way: null })).toBe('off (ssh)')
  expect(hintText({ ...linux, way: { off: 'no wl-paste (install wl-clipboard)' }, isOn: false })).toBe('off (no wl-paste (install wl-clipboard))')
  expect(hintText({ ...linux, drawn: false })).toBe('off (no picture yet)')
  expect(hintText({ ...linux, running: false })).toBe('off (the watcher does not run)')
  expect(hintText({ ...linux, isOn: false })).toBe('off (Intelligent UI is off)')
})

// A $ whose process.run answers `got` (or throws) and whose env.get reads `env`; `argvs` keeps each call.
const fake$ = (got: { exitCode: number; stdout: string } | Error, env: Record<string, string> = {}) => {
  const argvs: string[][] = []
  const $ = {
    process: { run: async (argv: string[]) => (argvs.push(argv), got instanceof Error ? Promise.reject(got) : { stderr: '', ...got }) },
    env: { get: async (name: string) => env[name] },
  } as any
  return { $, argvs }
}

// Runs `fn` with S.env and S.clipWay as given, then puts them back.
async function withClip<T>(isMac: boolean, clipWay: ClipWay | null, fn: () => Promise<T> | T): Promise<T> {
  const was = { env: S.env, clipWay: S.clipWay }
  try {
    S.env = { isMac } as any
    S.clipWay = clipWay
    return await fn()
  } finally {
    S.env = was.env
    S.clipWay = was.clipWay
  }
}

const WL_WAY = clipWayOf({ wayland: true, x11: false, desktop: 'sway', found: ALL })

test('the watcher arguments after clip: none on macOS, the notifier on Linux, null where changes can not be seen', async () => {
  await withClip(true, null, () => expect(clipWatchArgs(true)).toEqual([]))
  await withClip(false, WL_WAY, () => expect(clipWatchArgs(false)).toEqual(['/usr/bin/wl-paste', '--watch', 'sh', '-c', WL_WATCH_SH]))
  await withClip(false, { off: 'no Wayland or X11 display' }, () => expect(clipWatchArgs(false)).toBe(null))
  await withClip(false, null, () => expect(clipWatchArgs(false)).toBe(null))
})

test('the clipboard now: pbpaste on macOS (UTF-8), the way found on Linux; null when it can not be read', async () => {
  const mac = fake$({ exitCode: 0, stdout: 'héllo' })
  expect(await withClip(true, null, () => clipboardNow(mac.$))).toBe('héllo')
  expect(mac.argvs).toEqual([['pbpaste']])
  const lin = fake$({ exitCode: 0, stdout: 'text' })
  expect(await withClip(false, WL_WAY, () => clipboardNow(lin.$))).toBe('text')
  expect(lin.argvs).toEqual([['/usr/bin/wl-paste', '-n', '-t', 'text']])
  // A read that fails, throws, or has no tool to run.
  expect(await withClip(true, null, () => clipboardNow(fake$({ exitCode: 1, stdout: 'x' }).$))).toBe(null)
  expect(await withClip(false, WL_WAY, () => clipboardNow(fake$(new Error('timeout')).$))).toBe(null)
  const none = fake$({ exitCode: 0, stdout: 'x' })
  expect(await withClip(false, { off: 'no wl-paste' }, () => clipboardNow(none.$))).toBe(null)
  expect(await withClip(false, null, () => clipboardNow(none.$))).toBe(null)
  expect(none.argvs).toEqual([])
})

test('looking up the clipboard way sets S.clipWay from the display, the desktop and the tools found; clipWayReady waits for it', async () => {
  const found = fake$({ exitCode: 0, stdout: 'xclip /usr/bin/xclip\nclipnotify /usr/bin/clipnotify\n' }, { DISPLAY: ':0', XDG_CURRENT_DESKTOP: 'XFCE' })
  const was = S.clipWay
  try {
    const way = findClipWay(found.$)
    await clipWayReady()
    expect(await way).toMatchObject({ name: 'clipnotify and xclip (X11)', wayland: false })
    expect(S.clipWay).toBe(await way)
    expect(found.argvs).toEqual([['sh', '-c', FIND_SH]])
    // The tools can not be looked up: no tool, so the way is off.
    const failed = findClipWay(fake$(new Error('boom'), { DISPLAY: ':0' }).$)
    await clipWayReady()
    expect(await failed).toEqual({ off: 'no xclip, xsel or GTK 3 for Python, and no clipnotify' })
  } finally {
    S.clipWay = was
  }
})

// ---- Light or dark: the desktop portal ---------------------------------------------

test("the portal's color-scheme, as gdbus and busctl print it (Read and ReadOne)", () => {
  expect(schemeOfPortal('(<<uint32 1>>,)\n')).toBe('dark')
  expect(schemeOfPortal('(<<uint32 2>>,)\n')).toBe('light')
  expect(schemeOfPortal('(<<uint32 0>>,)\n')).toBe('no-preference')
  expect(schemeOfPortal('(<uint32 1>,)\n')).toBe('dark')
  expect(schemeOfPortal('v v u 1\n')).toBe('dark')
  expect(schemeOfPortal('v u 2\n')).toBe('light')
  expect(schemeOfPortal('v v u 0\n')).toBe('no-preference')
  expect(schemeOfPortal('(<<uint32 7>>,)')).toBe(null)
  expect(schemeOfPortal('Error: GDBus.Error:org.freedesktop.portal.Error.NotFound')).toBe(null)
  expect(schemeOfPortal('')).toBe(null)
})

// ---- Fonts and the plan editor ----------------------------------------------------

test("fontconfig's family: the first of its names", () => {
  expect(familyOfFc('DejaVu Sans Mono')).toBe('DejaVu Sans Mono')
  expect(familyOfFc('Noto Sans Mono,Noto Sans Mono Regular')).toBe('Noto Sans Mono')
  expect(familyOfFc('')).toBe('')
  expect(GHOSTTY_DEFAULT_FONT).toBe('JetBrains Mono')
})

test('the plan editor on Linux: code, else a GUI editor that waits, never over ssh', () => {
  expect(guiEditorOf('kate /usr/bin/kate\n')).toEqual(['/usr/bin/kate', '--block'])
  expect(guiEditorOf('gedit /usr/bin/gedit')).toEqual(['/usr/bin/gedit', '--wait'])
  expect(guiEditorOf('gvim /usr/bin/gvim')).toEqual(['/usr/bin/gvim', '-f'])
  expect(guiEditorOf('xdg-open /usr/bin/xdg-open')).toEqual([])
  expect(guiEditorOf('')).toEqual([])
  expect(LINUX_EDITORS.map(([name]) => name)).not.toContain('xdg-open')
  const gui = ['/usr/bin/kate', '--block']
  expect(editorArgv({ code: '/usr/bin/code', isMac: false, isRemote: false, gui }, '/h/p.md')).toEqual(['/usr/bin/code', '--wait', '/h/p.md'])
  expect(editorArgv({ code: '', isMac: false, isRemote: false, gui }, '/h/p.md')).toEqual(['/usr/bin/kate', '--block', '/h/p.md'])
  expect(editorArgv({ code: '', isMac: false, isRemote: true, gui }, '/h/p.md')).toBe(null)
  expect(editorArgv({ code: '', isMac: false, isRemote: false, gui: [] }, '/h/p.md')).toBe(null)
  // macOS does not change: TextEdit, never a GUI editor of the list.
  expect(editorArgv({ code: '', isMac: true, isRemote: false, gui }, '/h/p.md')).toEqual(['open', '-W', '-t', '/h/p.md'])
})

// ---- A Linux session ---------------------------------------------------------------

const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 20 00 00 02 00'
const WRAP = 'echo $$; exec "$@"'
const inputsOf = (argv: readonly string[]) => Object.fromEntries(argv.flatMap((a, i) => (argv[i - 1] === '--input' ? [a.split(/=(.*)/s).slice(0, 2)] : [])))
const cells = (row: number, from: number, to: number, lead = '  ') =>
  lead + Array.from({ length: to - from + 1 }, (_, i) => placeholderCell(row, from + i)).join('')

// A Linux computer in kitty on Wayland (sway): uname says Linux, the tools
// are wl-paste only, the portal says `scheme`, kitty's config names no font
// (fontconfig gives one), and the watcher is `perl` with the notifier after
// `clip`. `copy` is a native copy (in fullscreen picture cells are this
// session's selection too), `foreign` another session's or the terminal's:
// each changes the clipboard, and each clip child prints a line. `copies`
// are the texts the mod put on the clipboard; `envSets` the env vars set.
function linuxWorld(on: any, o: { scheme?: number; noPortal?: boolean; env?: Record<string, string>; noTypst?: boolean; jetbrains?: boolean } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  const vars: Record<string, string | undefined> = {
    PATH: '/usr/local/bin:/usr/bin', ...(o.env ?? { HOME: '/h', TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1', WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'sway' }),
  }
  const envSets: string[] = []
  on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
  on('env.set', async ($: any, e: any) => {
    envSets.push(e.name)
    return { value: {} }
  })
  const files = new Map<string, string>()
  const ran: string[][] = []
  const watchers: { argv: string[]; say: (line: string) => void; dead: boolean; n: number }[] = []
  const w = {
    clock, files, ran, watchers, vars, envSets, clipboard: 'old', reads: 0, copies: [] as string[], toasts: [] as string[],
    selection: undefined as { text: string } | undefined,
    copy(text: string) {
      // A mouse copy of picture cells in fullscreen is this session's selection.
      if (text.includes('\u{10EEEE}')) w.selection = { text }
      w.foreign(text)
    },
    foreign(text: string) {
      w.clipboard = text
      for (const c of watchers) if (!c.dead && c.argv[3] === 'clip') c.say(`clip ${c.n++}`)
    },
  }
  let pids = 7000
  const killers = new Map<string, () => void>()
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    if (argv[0] === 'perl' && argv[1] === '-e' && argv[2] === WATCH_PL) {
      const pid = String(pids++)
      const lines = [`pid ${pid}`]
      let wake = () => {}
      const me = { argv, dead: false, n: 0, say: (line: string) => (lines.push(line), wake()) }
      // The notifier's first line, at its start.
      if (argv[3] === 'clip') me.say(`clip ${me.n++}`)
      watchers.push(me)
      killers.set(pid, () => ((me.dead = true), wake()))
      for (;;) {
        while (lines.length && !me.dead) yield { stream: 'stdout', text: `${lines.shift()}\n` }
        if (me.dead) return { value: { code: null, signal: 'SIGTERM' } }
        await new Promise<void>(r => (wake = r))
      }
    }
    if (argv[0] !== 'sh' || argv[2] !== WRAP || argv[4] !== '/usr/bin/typst') return { value: { code: 2, signal: null } }
    yield { stream: 'stdout', text: `${pids++}\n` }
    const typst = argv.slice(4)
    if (typst[1] === 'compile') return { value: { code: 0, signal: null } }
    const inputs = inputsOf(typst)
    yield { stream: 'stdout', text: JSON.stringify(SMALL_MARKS.map(m => ({ ...m, p: Number(inputs.page) }))) }
    return { value: { code: 0, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    ran.push(argv)
    if (argv[0] === 'kill') {
      killers.get(argv[1]!)?.()
      return ok('')
    }
    if (/cc-intelligent-ui-/.test(cmd)) return ok('/c\nLinux\n/h/.cache/cc-intelligent-ui/designs\n')
    if (cmd.includes('command -v typst')) return o.noTypst ? ok('', 1) : ok('/usr/bin/typst\n')
    if (argv[0] === 'sh' && argv[2] === FIND_SH) return ok('wl-paste /usr/bin/wl-paste\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (cmd.includes('od -An')) return ok(argv.filter(a => a.endsWith('.png')).map(() => `${HEAD}\n@\n`).join(''))
    if (argv[0] === 'gdbus') return o.noPortal ? ok('', 1) : ok(`(<<uint32 ${o.scheme ?? 1}>>,)\n`)
    if (argv[0] === 'busctl') return ok('', 1)
    if (argv[0] === 'gsettings') return ok("'prefer-light'\n")
    if (argv[0] === 'fc-match' && argv[1] === 'monospace') return ok('DejaVu Sans Mono')
    if (argv[0] === 'fc-list' && argv[2] === 'JetBrains Mono') return ok('', o.jetbrains ? 0 : 1)
    if (cmd === '/usr/bin/wl-paste -n -t text') {
      w.reads++
      return ok(w.clipboard)
    }
    return ok('', 1)
  })
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => (files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') || e.path.startsWith('/h/') ? { deny: 'ENOENT' } : next(e)))
  on('fs.exists', async ($: any, e: any, next: any) => (o.noTypst || e.path.startsWith('/h/') ? { value: false } : next(e)))
  on('fs.list', async ($: any, e: any, next: any) => {
    if (!e.path.startsWith('/c/')) return next(e)
    const segments = (JSON.parse(files.get(`${e.path}/doc.json`) ?? '{"segments":[""]}') as { segments: string[] }).segments
    return { value: segments.map((_, i) => ({ name: `a-${i + 1}.png`, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) }
  })
  // The mod's write: its text on the clipboard, one change.
  on('ui.copy', async ($: any, e: any) => {
    w.copies.push(e.text)
    w.foreign(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.selection', async () => ({ value: w.selection }))
  on('ui.toast', async ($: any, e: any) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drawing'] }) as any)
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  return w
}

const message = (requestId: string, text: string, isFullscreen = true) =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40, isFullscreen },
  }) as any

const hintLine = async ($: any) => ((await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? '').split('\n').find((l: string) => l.startsWith('/iui grab hint:'))
const GRAB_HINT = 'Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard'
const COPY = [cells(1, 0, 97, '● '), cells(2, 0, 97), cells(3, 0, 21)].join('\n')
const COPIED = 'Copy test\nThe quick brown fox jumps'

// Draws SMALL_MD as answer ans-1; the watcher has its clipboard part.
async function drawAnswer($: any, w: ReturnType<typeof linuxWorld>, isFullscreen = true) {
  const ui = await $.ui.mount(message('ans-1', SMALL_MD, isFullscreen))
  await w.clock.settle()
  await ui.redraw({ text: SMALL_MD, isFirstOfReply: true } as any)
  await w.clock.settle()
  await w.clock.advance(300)
  await w.clock.settle()
  return ui
}

test('Linux on Wayland: the watcher runs wl-paste --watch after clip; picture cells copied get the /iui grab hint, and no shim is set up', async ($, on) => {
  const w = linuxWorld(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  expect(await hintLine($)).toBe('/iui grab hint: off (no picture yet)')
  await drawAnswer($, w)
  // The size watcher (perl from the PATH), then the one with the notifier.
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip', '/usr/bin/wl-paste', '--watch', 'sh', '-c', WL_WATCH_SH]])
  expect(await hintLine($)).toBe('/iui grab hint: on, with wl-paste --watch (Wayland)')
  // The first line (the notifier's start) is not a change: no read.
  expect(w.reads).toBe(0)
  // A native copy of picture cells: one read, one hint, never written.
  w.copy(COPY)
  await w.clock.settle()
  expect(w.reads).toBe(1)
  expect(w.toasts.filter(t => t === GRAB_HINT).length).toBe(1)
  expect(w.copies).toEqual([])
  // A copy with no picture cells is read and left as it is.
  w.copy('plain text')
  await w.clock.settle()
  expect(w.reads).toBe(2)
  expect(w.toasts.filter(t => t === GRAB_HINT).length).toBe(1)
  // /iui grab copies the text of the selection.
  expect((await $.command.run({ command: 'iui', args: 'grab' } as any)).text).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read).')
  expect(w.copies).toEqual([COPIED])
  // pbpaste is never run on Linux.
  expect(w.ran.some(argv => argv[0] === 'pbpaste')).toBe(false)
  // No shim: no env var set, no shim files, no ask reader.
  expect(w.envSets).toEqual([])
  expect(w.vars.PATH).toBe('/usr/local/bin:/usr/bin')
  expect([...w.files.keys()].filter(k => /\/(shims-|ask)/.test(k))).toEqual([])
  expect(w.ran.some(argv => argv.some(a => a.includes('clip-shim')))).toBe(false)
  // The end of the session: the watchers stop.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1' } as any)
  await w.clock.settle()
  expect(w.watchers.map(c => c.dead)).toEqual([true, true])
})

test('Linux on Wayland, main screen: a copy of picture cells is not changed; /iui grab reads it with wl-paste and writes its text', async ($, on) => {
  const w = linuxWorld(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  await drawAnswer($, w, false)
  expect(await hintLine($)).toBe('/iui grab hint: on, with wl-paste --watch (Wayland)')
  // The terminal's own copy: the hint at once.
  w.foreign(COPY)
  await w.clock.settle()
  expect(w.copies).toEqual([])
  expect(w.toasts).toContain(GRAB_HINT)
  const reads = w.reads
  const grabbed = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(grabbed.text).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read).')
  expect(w.reads).toBe(reads + 2)
  expect(w.copies).toEqual([COPIED])
  expect(w.clipboard).toBe(COPIED)
  expect(w.toasts.filter(t => t === GRAB_HINT).length).toBe(1)
})

test('Linux, auto, in kitty: kitty\'s config comes first; the font is fontconfig\'s monospace', async ($, on) => {
  const w = linuxWorld(on, { scheme: 1 })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  // kitty's config has no background: kitty's default (dark) comes first.
  expect(ran.text).toContain('(auto, from kitty')
  expect(ran.text).toContain('terminal font DejaVu Sans Mono')
  expect(w.ran.some(argv => argv[0] === 'osascript' || argv[0] === 'defaults')).toBe(false)
})

test('Linux with no terminal config: the portal, else gsettings, gives the OS mode', async ($, on) => {
  linuxWorld(on, { scheme: 2, env: { HOME: '/h', TERM: 'xterm-256color', WAYLAND_DISPLAY: 'wayland-1', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' } })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode light (auto, from desktop portal)')
  expect(ran.text).toContain('terminal font DejaVu Sans Mono')
})

test('Linux with no portal: GNOME gsettings gives the OS mode', async ($, on) => {
  const w = linuxWorld(on, { noPortal: true, env: { HOME: '/h', TERM: 'xterm-256color', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' } })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode light (auto, from GNOME)')
  // gdbus and busctl failed once each; the next check reads gsettings only.
  const before = w.ran.filter(a => a[0] === 'gdbus' || a[0] === 'busctl').length
  expect(before).toBe(2)
  await w.clock.advance(3000)
  await w.clock.settle()
  expect(w.ran.filter(a => a[0] === 'gdbus' || a[0] === 'busctl').length).toBe(2)
  expect(w.ran.filter(a => a[0] === 'gsettings').length).toBeGreaterThan(1)
})

test("Ghostty on Linux with no font-family: its JetBrains Mono when fontconfig has it, else fontconfig's monospace", async ($, on) => {
  linuxWorld(on, { jetbrains: true, env: { HOME: '/h', TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('terminal font JetBrains Mono')
})

test("Ghostty on Linux with no font-family and no JetBrains Mono: fontconfig's monospace", async ($, on) => {
  linuxWorld(on, { env: { HOME: '/h', TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('terminal font DejaVu Sans Mono')
})

test('/iui setup on Linux changes no file and says why', async ($, on) => {
  const w = linuxWorld(on)
  const ran = await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(ran.text).toBe(SETUP_NOT_MAC)
  expect([...w.files.keys()].some(k => /zshrc|bashrc|fish/.test(k))).toBe(false)
})

test('/iui on Linux with no Typst names a Linux way to install it', async ($, on) => {
  linuxWorld(on, { noTypst: true })
  const ran = await $.command.run({ command: 'iui', args: '' } as any)
  expect(ran.text).toContain('Install it: cargo install --locked typst-cli')
  expect(ran.text).not.toContain('brew install typst')
})

test('the cache folder: TMPDIR, else /tmp (Linux often has no TMPDIR); the designs in XDG_CACHE_HOME, else ~/.cache', () => {
  expect(CACHE_SH).toContain('d="${TMPDIR:-/tmp}"; d="${d%/}/cc-intelligent-ui-$(id -u)"')
  expect(CACHE_SH).toContain('g="${XDG_CACHE_HOME:-$HOME/.cache}/cc-intelligent-ui/designs"')
  expect(CACHE_SH).toContain('"$(uname -s)"')
  // A folder that is not private is never used. No shim or ask folder is swept.
  expect(CACHE_SH).toContain('[ ! -L "$d" ] && [ -d "$d" ] && [ -O "$d" ] && chmod 700 "$d"')
  // A refused folder: no cache line, the OS, then that folder (for /iui details).
  expect(CACHE_SH).toContain(`|| printf '\\n%s\\n\\n%s\\n' "$(uname -s)" "$d"`)
  expect(CACHE_SH).not.toMatch(/ask|shims/)
})
