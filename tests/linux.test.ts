import { expect, mock, test } from 'claude-code/testing'

import {
  autoCopyText, clipToolsOf, clipWayOf, editorArgv, familyOfFc, FIND_SH, GHOSTTY_DEFAULT_FONT, GTK_READ_PY, GTK_WATCH_PY, guiEditorOf, LINUX_EDITORS,
  placeholderCell, schemeOfPortal, SETUP_NOT_MAC, WATCH_PL, WL_WATCH_SH, X11_WATCH_SH, type ClipWay,
} from '../hooks/register'
import { CACHE_SH } from '../hooks/lib/env'
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

test('the automatic copy line: the macOS texts as they were, the Linux way or why it is off', () => {
  const base = { isMac: true, hostOs: 'Darwin', isRemote: false, isOn: true, none: false, drawn: true, running: true, way: null }
  expect(autoCopyText(base)).toBe('on')
  expect(autoCopyText({ ...base, none: true })).toBe('off (no PerlObjCBridge in /usr/bin/perl)')
  expect(autoCopyText({ ...base, isRemote: true })).toBe('off (ssh)')
  expect(autoCopyText({ ...base, running: false })).toBe('off (the watcher does not run)')
  const wl = clipWayOf({ wayland: true, x11: false, desktop: 'sway', found: ALL })
  const linux = { ...base, isMac: false, hostOs: 'Linux', way: wl }
  expect(autoCopyText(linux)).toBe('on, with wl-paste --watch (Wayland)')
  expect(autoCopyText({ ...linux, none: true })).toBe('off (wl-paste --watch (Wayland) stopped: the compositor may not have the data-control protocol)')
  expect(autoCopyText({ ...linux, way: clipWayOf({ wayland: false, x11: true, desktop: '', found: ALL }), none: true })).toBe('off (clipnotify and xclip (X11) stopped)')
  expect(autoCopyText({ ...linux, way: { off: 'no Wayland or X11 display' } })).toBe('off (no Wayland or X11 display)')
  expect(autoCopyText({ ...linux, way: null })).toBe('off (the clipboard tools are not looked up yet)')
  expect(autoCopyText({ ...linux, drawn: false })).toBe('off (no picture yet)')
  expect(autoCopyText({ ...linux, hostOs: 'FreeBSD' })).toBe('off (not macOS or Linux)')
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
// `clip`. `copy` changes the clipboard: each clip child prints a line.
function linuxWorld(on: any, o: { scheme?: number; noPortal?: boolean; env?: Record<string, string>; noTypst?: boolean; jetbrains?: boolean } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, o.env ?? { HOME: '/h', TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1', WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'sway' })
  const files = new Map<string, string>()
  const ran: string[][] = []
  const watchers: { argv: string[]; say: (line: string) => void; dead: boolean; n: number }[] = []
  const w = {
    clock, files, ran, watchers, clipboard: 'old', reads: 0, copies: [] as string[], toasts: [] as string[],
    copy(text: string) {
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
  on('ui.copy', async ($: any, e: any) => {
    w.copies.push(e.text)
    w.copy(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.selection', async () => ({ value: undefined }))
  on('ui.toast', async ($: any, e: any) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drawing'] }) as any)
  return w
}

const message = (requestId: string, text: string) =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40 },
  }) as any

const autoLine = async ($: any) => ((await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? '').split('\n').find((l: string) => l.startsWith('Auto copy:'))

test('Linux on Wayland: the watcher runs wl-paste --watch after clip, and a copy of picture cells is read with wl-paste and written as text', async ($, on) => {
  const w = linuxWorld(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  expect(await autoLine($)).toBe('Auto copy: off (no picture yet)')
  const ui = await $.ui.mount(message('ans-1', SMALL_MD))
  await w.clock.settle()
  await ui.redraw({ text: SMALL_MD, isFirstOfReply: true } as any)
  await w.clock.settle()
  await w.clock.advance(300)
  await w.clock.settle()
  // The size watcher (perl from the PATH), then the one with the notifier.
  expect(w.watchers.map(c => c.argv.slice(3))).toEqual([[], ['clip', '/usr/bin/wl-paste', '--watch', 'sh', '-c', WL_WATCH_SH]])
  expect(await autoLine($)).toBe('Auto copy: on, with wl-paste --watch (Wayland)')
  // The first line (the notifier's start) is not a change: no read.
  expect(w.reads).toBe(0)
  w.copy([cells(1, 0, 97, '● '), cells(2, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.settle()
  expect(w.copies).toEqual(['Copy test\nThe quick brown fox jumps'])
  expect(w.toasts.some(t => t.startsWith('Intelligent UI: copied'))).toBe(true)
  // A copy with no picture cells is read and left as it is.
  w.copy('plain text')
  await w.clock.settle()
  expect(w.copies.length).toBe(1)
  // pbpaste is never run on Linux.
  expect(w.ran.some(argv => argv[0] === 'pbpaste')).toBe(false)
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
})
