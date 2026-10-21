import { expect, mock, test } from 'claude-code/testing'

import {
  autoCopyText, clipToolsOf, clipWayOf, editorArgv, familyOfFc, FIND_SH, GHOSTTY_DEFAULT_FONT, GTK_READ_PY, GTK_WATCH_PY, guiEditorOf, LINUX_EDITORS,
  placeholderCell, schemeOfPortal, SETUP_NOT_MAC, WATCH_PL, WL_WATCH_SH, X11_WATCH_SH, type ClipWay, type ShimState,
} from '../hooks/register'
import { CACHE_SH } from '../hooks/lib/env'
import { ANSWER_SH, ASK_END_SH, ASK_PL, clipboardNow, clipWatchArgs, clipWayReady, findClipWay, SHIM_SETUP } from '../hooks/lib/clipboard'
import { ASKED_MS, HINT_WAIT_MS } from '../hooks/lib/settings'
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

test('the automatic copy line: the shims and the ask reader say on or off; the watcher only the /iui grab hint', () => {
  const base = {
    isMac: true, hostOs: 'Darwin', isRemote: false, isOn: true, isFullscreen: true as boolean | null, none: false, drawn: true, asking: true, way: null,
    shims: { tools: ['pbcopy'] } as ShimState | null,
  }
  expect(autoCopyText(base)).toBe('on')
  // Only fullscreen copies by itself: the main screen has /iui grab.
  expect(autoCopyText({ ...base, isFullscreen: false })).toBe('off on the main screen (use /iui grab)')
  expect(autoCopyText({ ...base, isFullscreen: false, isOn: false })).toBe('off (Intelligent UI is off)')
  // The layout not known yet: the ask says whose copy it is, so it is on.
  expect(autoCopyText({ ...base, isFullscreen: null })).toBe('on')
  // The shims: not set up yet, or off with the reason.
  expect(autoCopyText({ ...base, shims: null })).toBe('off (the clipboard shims are not set up yet)')
  expect(autoCopyText({ ...base, shims: { off: 'no pbcopy' } })).toBe('off (no pbcopy)')
  expect(autoCopyText({ ...base, shims: { off: 'no perl' } })).toBe('off (no perl)')
  expect(autoCopyText({ ...base, shims: { off: 'no pbcopy' }, isRemote: true })).toBe('off (ssh)')
  expect(autoCopyText({ ...base, isFullscreen: null, drawn: false })).toBe('off (no picture yet)')
  expect(autoCopyText({ ...base, asking: false })).toBe('off (the ask reader does not run)')
  expect(autoCopyText({ ...base, none: true })).toBe('on (no /iui grab hint: no PerlObjCBridge in /usr/bin/perl)')
  expect(autoCopyText({ ...base, isRemote: true })).toBe('off (ssh)')
  const wl = clipWayOf({ wayland: true, x11: false, desktop: 'sway', found: ALL })
  const linux = { ...base, isMac: false, hostOs: 'Linux', way: wl }
  expect(autoCopyText(linux)).toBe('on, with wl-paste --watch (Wayland)')
  expect(autoCopyText({ ...linux, none: true })).toBe('on (no /iui grab hint: wl-paste --watch (Wayland) stopped: the compositor may not have the data-control protocol)')
  expect(autoCopyText({ ...linux, way: clipWayOf({ wayland: false, x11: true, desktop: '', found: ALL }), none: true })).toBe('on (no /iui grab hint: clipnotify and xclip (X11) stopped)')
  expect(autoCopyText({ ...linux, way: { off: 'no Wayland or X11 display' } })).toBe('on (no /iui grab hint: no Wayland or X11 display)')
  expect(autoCopyText({ ...linux, way: null })).toBe('on')
  const addon = { off: 'no wl-copy, xclip or xsel: Claude Code copies with its own addon' }
  expect(autoCopyText({ ...linux, shims: addon })).toBe('off (no wl-copy, xclip or xsel: Claude Code copies with its own addon)')
  expect(autoCopyText({ ...linux, drawn: false })).toBe('off (no picture yet)')
  expect(autoCopyText({ ...linux, isFullscreen: false })).toBe('off on the main screen (use /iui grab)')
  expect(autoCopyText({ ...linux, hostOs: 'FreeBSD' })).toBe('off (not macOS or Linux)')
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
// `clip`. The clipboard write tools found are `writers` (wl-copy by default),
// with perl and the FIFO L_ASK; the ask reader is `perl` too. `copy` is
// Claude Code's own copy: the OSC 52 write, then the shim, whose ask for
// picture cells the reader gets and the mod answers (ANSWER_SH). `foreign`
// is a copy with no ask (another session's, the terminal's): each changes
// the clipboard, and each clip child prints a line.
function linuxWorld(on: any, o: { scheme?: number; noPortal?: boolean; env?: Record<string, string>; noTypst?: boolean; jetbrains?: boolean; writers?: string[] } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  const vars: Record<string, string | undefined> = {
    PATH: '/usr/local/bin:/usr/bin', IUI_COPY_SHIM: '1', ...(o.env ?? { HOME: '/h', TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1', WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'sway' }),
  }
  on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
  on('env.set', async ($: any, e: any) => {
    vars[e.name] = e.value
    return { value: {} }
  })
  const files = new Map<string, string>()
  const ran: string[][] = []
  const watchers: { argv: string[]; say: (line: string) => void; dead: boolean; n: number }[] = []
  const readers: { argv: string[]; say: (line: string) => void; dead: boolean }[] = []
  const waits = new Map<string, (text: string) => void>()
  const w = {
    clock, files, ran, watchers, readers, vars, clipboard: 'old', reads: 0, asks: 0, copies: [] as string[], toasts: [] as string[], ended: [] as string[][],
    selection: undefined as { text: string } | undefined,
    copy(text: string) {
      // A mouse copy of picture cells in fullscreen is this session's selection.
      if (text.includes('\u{10EEEE}')) w.selection = { text }
      w.foreign(text)
      void w.shim(text)
    },
    async shim(text: string) {
      let out = text
      const reader = readers.find(c => !c.dead)
      if (text.includes('\u{10EEEE}') && reader) {
        const id = `77-${++w.asks}-1`
        files.set(`/c/ask/${id}`, text)
        const answered = new Promise<string | null>(r => waits.set(id, r))
        reader.say(`ask ${id}`)
        out = (await Promise.race([answered, clock.sleep(1500).then(() => null)])) ?? text
        waits.delete(id)
        files.delete(`/c/ask/${id}`)
      }
      if (out !== text) w.copies.push(out)
      w.foreign(out)
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
    if (argv[0] === 'perl' && argv[1] === '-e' && argv[2] === ASK_PL && argv[3] === L_ASK) {
      const pid = String(pids++)
      const lines = [`pid ${pid}`]
      let wake = () => {}
      const me = { argv, dead: false, say: (line: string) => (lines.push(line), wake()) }
      readers.push(me)
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
    if (argv[0] === 'sh' && argv[1]?.endsWith(SHIM_SETUP) && argv[2] === 'find') {
      return ok(`pid 77\n${(o.writers ?? ['wl-copy']).map(t => `${t} /usr/bin/${t}\n`).join('')}perl /usr/bin/perl\nask ${L_ASK}\n`)
    }
    if (argv[0] === 'sh' && argv[2] === ANSWER_SH) {
      const to = waits.get(argv[4]!.slice('/c/ask/'.length))
      if (!to) return ok('', 1)
      to(e.init?.stdin ?? '')
      return ok('')
    }
    if (argv[0] === 'sh' && argv[2] === ASK_END_SH) {
      w.ended.push(argv.slice(4))
      return ok('')
    }
    if (argv[0] === 'sh' && argv[1]?.endsWith(SHIM_SETUP) && argv[2] === 'install') {
      for (const f of argv.slice(5)) files.set(f, files.get(`${f}${argv[4]}`) ?? '')
      return ok('')
    }
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
  on('fs.stat', async ($: any, e: any, next: any) =>
    e.path.startsWith('/c/ask/') && files.has(e.path) ? { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } } : next(e))
  on('fs.read', async ($: any, e: any, next: any) => (e.path.endsWith('/hooks/clip-shim.sh') ? { value: 'tool=@TOOL@ real=@REAL@' } : files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') || e.path.startsWith('/h/') ? { deny: 'ENOENT' } : next(e)))
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
  on('ui.selection', async () => ({ value: w.selection }))
  on('ui.toast', async ($: any, e: any) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drawing'] }) as any)
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  return w
}

// The FIFO of this process (pid 77).
const L_ASK = '/c/ask-77'

const message = (requestId: string, text: string, isFullscreen = true) =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40, isFullscreen },
  }) as any

const autoLine = async ($: any) => ((await $.command.run({ command: 'iui', args: 'details' } as any)).text ?? '').split('\n').find((l: string) => l.startsWith('Auto copy:'))

test('Linux on Wayland: the reader (perl) gets the asks of the wl-copy shim, and the watcher runs wl-paste --watch after clip for the hint', async ($, on) => {
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
  expect(w.readers.map(c => c.argv[0])).toEqual(['perl'])
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
  // Another session's copy of picture cells (no ask here, none of them lately): never written, one hint after the wait.
  await w.clock.advance(ASKED_MS)
  w.foreign([cells(1, 0, 97), cells(2, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.copies.length).toBe(1)
  expect(w.toasts).toContain('Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard')
  // pbpaste is never run on Linux.
  expect(w.ran.some(argv => argv[0] === 'pbpaste')).toBe(false)
  // The wl-copy shim only (the tool found), its folder first on PATH.
  expect([...w.files.keys()].filter(k => k.startsWith('/c/shims') && !k.includes('.new-'))).toEqual(['/c/shims-77/wl-copy'])
  expect(w.vars.PATH).toBe('/c/shims-77:/usr/local/bin:/usr/bin')
  expect(w.vars.IUI_COPY_ASK).toBe(L_ASK)
  // The end of the session: the FIFO, the requests and the shims of pid 77 go.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1' } as any)
  await w.clock.settle()
  expect(w.ended).toEqual([[L_ASK, '/c/ask', '77', '/c/shims-77']])
  expect(w.readers.map(c => c.dead)).toEqual([true])
})

test('Linux with no wl-copy, xclip or xsel: Claude Code copies with its addon, so no shim, no automatic copy; the hint and /iui grab stay', async ($, on) => {
  const w = linuxWorld(on, { writers: [] })
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('ans-1', SMALL_MD))
  await w.clock.settle()
  await ui.redraw({ text: SMALL_MD, isFirstOfReply: true } as any)
  await w.clock.settle()
  await w.clock.advance(300)
  await w.clock.settle()
  expect(await autoLine($)).toBe('Auto copy: off (no wl-copy, xclip or xsel: Claude Code copies with its own addon)')
  expect(w.vars.PATH).toBe('/usr/local/bin:/usr/bin')
  expect(w.vars.IUI_COPY_ASK).toBeUndefined()
  expect(w.readers).toEqual([])
  w.copy([cells(1, 0, 97), cells(2, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.advance(HINT_WAIT_MS)
  expect(w.copies).toEqual([])
  expect(w.toasts).toContain('Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard')
  w.selection = undefined
  const grabbed = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(grabbed.text).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read).')
})

test('Linux on Wayland, main screen: a copy of picture cells is not changed; /iui grab reads it with wl-paste and writes its text', async ($, on) => {
  const w = linuxWorld(on)
  await $.command.run({ command: 'iui', args: '' } as any)
  const ui = await $.ui.mount(message('ans-1', SMALL_MD, false))
  await w.clock.settle()
  await ui.redraw({ text: SMALL_MD, isFirstOfReply: true } as any)
  await w.clock.settle()
  await w.clock.advance(300)
  await w.clock.settle()
  expect(await autoLine($)).toBe('Auto copy: off on the main screen (use /iui grab)')
  // The terminal's own copy: no ask, the hint at once.
  w.foreign([cells(1, 0, 97, '● '), cells(2, 0, 97), cells(3, 0, 21)].join('\n'))
  await w.clock.settle()
  expect(w.copies).toEqual([])
  expect(w.toasts).toContain('Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard')
  const grabbed = await $.command.run({ command: 'iui', args: 'grab' } as any)
  expect(grabbed.text).toBe('Intelligent UI: copied 35 chars (1 of 1 picture runs read).')
  expect(w.copies).toEqual(['Copy test\nThe quick brown fox jumps'])
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
