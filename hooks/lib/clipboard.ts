// The clipboard of this computer: how a copy reads it and how its changes
// are seen. macOS: pbpaste, and the change count of the watcher's
// PerlObjCBridge (host.ts). Linux: Wayland's wl-paste (its --watch sees each
// change), else X11 (also Xwayland): xclip or xsel to read, clipnotify for
// an event at each change, else GTK 3 from Python (python3-gi, on most GNOME
// desktops) for both. The changes give the /iui grab hint (where no tool sees
// them there is none: the clipboard is never read at intervals). The shims
// (below) ask this session's mod for the text of a copy of picture cells.
import type { EngineInterface } from 'claude-code'

import { S } from './state'
import { lineSplitter } from './frame'
import { perlFor } from './host'
import { clockAfter, envGet, envSet, fsExists, fsRead, fsStat, fsWrite, pluginRoot, processRun, spawn } from './api'

// The tools the choice looks for, in the order it prefers them. `gtk` is
// python3 when it can load GTK 3 (gi).
export const CLIP_TOOLS = ['wl-paste', 'xclip', 'xsel', 'clipnotify', 'gtk'] as const
export type ClipTool = (typeof CLIP_TOOLS)[number]

// How the clipboard is read and watched: `read` the argv that prints its
// text; `watch` the notifier's argv (the watcher runs it and gives one
// `clip <n>` line for each line it prints, the first at its start: its
// clipboard then is no new copy); `name` for /iui details. `off`: why the
// automatic copy is off (`read`, when set, still serves the ui.copy hook).
export type ClipWay = { name: string; read: string[]; watch: string[]; wayland: boolean } | { off: string }

// The Wayland notifier's command: wl-paste runs it at each change (and once
// at its start) with the new data on stdin, which it reads to the end so the
// app that copied does not get a broken pipe. A copy that a password manager
// marks as sensitive gives no line, so it is never read.
export const WL_WATCH_SH = 'cat >/dev/null; [ "$CLIPBOARD_STATE" = sensitive ] || echo'
// The X11 notifier: a line at its start, then one at each change of the
// CLIPBOARD selection. clipnotify 1.0.3+ prints them itself (-l); an older
// one does not know the flags, watches PRIMARY too, and exits at the first
// change, so the loop runs it again. It ends when clipnotify fails (no X
// display). `$0` is clipnotify's path.
export const X11_WATCH_SH = 'echo; while "$0" -s clipboard -l; do echo; done'
// GTK 3 on X11 (GDK_BACKEND=x11: through Xwayland on a Wayland desktop, where
// an app sees the clipboard events with no focus): the watch prints a line
// at its start and at each owner change of CLIPBOARD; the read prints the
// text (exit 1 for none). Both exit 1 with no display.
export const GTK_WATCH_PY = [
  'import sys, gi',
  'gi.require_version("Gtk", "3.0")',
  'from gi.repository import Gtk, Gdk',
  'if Gdk.Display.get_default() is None: sys.exit(1)',
  'def say(*_):',
  '    try:',
  '        sys.stdout.write("\\n"); sys.stdout.flush()',
  '    except BrokenPipeError:',
  '        sys.exit(0)',
  'Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).connect("owner-change", say)',
  'say()',
  'Gtk.main()',
].join('\n')
export const GTK_READ_PY = [
  'import sys, gi',
  'gi.require_version("Gtk", "3.0")',
  'from gi.repository import Gtk, Gdk',
  'if Gdk.Display.get_default() is None: sys.exit(1)',
  't = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text()',
  'if t is None: sys.exit(1)',
  'sys.stdout.write(t)',
].join('\n')
const GTK_ENV = ['/usr/bin/env', 'GDK_BACKEND=x11', 'PYTHONIOENCODING=utf-8']

// The way to read and watch the clipboard on Linux, from the session
// (WAYLAND_DISPLAY, DISPLAY, the desktop) and the tools found (their paths).
// Wayland: wl-paste, whose --watch needs the data-control protocol. GNOME
// does not have it (and its wl-paste read shows a window), so on GNOME the
// X11 ways through Xwayland come first. X11: xclip, xsel or GTK to read, and
// clipnotify or GTK to see the changes (X11 has no other event for them).
export function clipWayOf(o: { wayland: boolean; x11: boolean; desktop: string; found: Partial<Record<ClipTool, string>> }): ClipWay {
  const { found } = o
  const wl = o.wayland && found['wl-paste'] ? found['wl-paste'] : ''
  const gtk = found.gtk ? { read: [...GTK_ENV, found.gtk, '-c', GTK_READ_PY], watch: [...GTK_ENV, found.gtk, '-c', GTK_WATCH_PY] } : null
  const reader = found.xclip ? { tool: 'xclip', read: [found.xclip, '-o', '-selection', 'clipboard', '-t', 'UTF8_STRING'] }
    : found.xsel ? { tool: 'xsel', read: [found.xsel, '-o', '-b'] }
    : gtk ? { tool: 'GTK', read: gtk.read } : null
  const watcher = found.clipnotify ? { tool: 'clipnotify', watch: ['sh', '-c', X11_WATCH_SH, found.clipnotify] } : gtk ? { tool: 'GTK', watch: gtk.watch } : null
  const isGnome = /gnome/i.test(o.desktop)
  const waylandWay = () =>
    ({ name: 'wl-paste --watch (Wayland)', read: [wl, '-n', '-t', 'text'], watch: [wl, '--watch', 'sh', '-c', WL_WATCH_SH], wayland: true })
  const x11Way = () => {
    if (!o.x11 || !reader || !watcher) return null
    const name = watcher.tool === reader.tool ? watcher.tool : `${watcher.tool} and ${reader.tool}`
    return { name: `${name} (X11${o.wayland ? ', Xwayland' : ''})`, read: reader.read, watch: watcher.watch, wayland: false }
  }
  if (wl && !isGnome) return waylandWay()
  const viaX = x11Way()
  if (viaX) return viaX
  if (wl) return waylandWay()
  if (!o.wayland && !o.x11) return { off: 'no Wayland or X11 display' }
  if (o.x11 && reader) return { off: `no clipnotify and no GTK 3 for Python: X11 has no clipboard event for ${reader.tool}` }
  return { off: o.wayland ? 'no wl-paste (install wl-clipboard)' : 'no xclip, xsel or GTK 3 for Python, and no clipnotify' }
}

// Prints `tool path` for each clipboard tool on the PATH, and `gtk <python3>`
// when there is no clipnotify and python3 loads GTK 3.
const GTK_CHECK_PY = 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk'
export const FIND_SH = [
  `for c in ${CLIP_TOOLS.filter(c => c !== 'gtk').join(' ')}; do p=$(command -v "$c" 2>/dev/null) && echo "$c $p"; done`,
  `command -v clipnotify >/dev/null 2>&1 || { p=$(command -v python3 2>/dev/null) && "$p" -c '${GTK_CHECK_PY}' >/dev/null 2>&1 && echo "gtk $p"; }`,
].join('; ')

// The tools of `FIND_SH`'s output, by name; only absolute paths.
export function clipToolsOf(stdout: string): Partial<Record<ClipTool, string>> {
  const found: Partial<Record<ClipTool, string>> = {}
  for (const line of stdout.split('\n')) {
    const m = /^(\S+) (\/.*)$/.exec(line.trim())
    if (m && (CLIP_TOOLS as readonly string[]).includes(m[1]!)) found[m[1] as ClipTool] = m[2]!
  }
  return found
}

// Linux, on this computer (setUp, not awaited: GTK loads in 0.1-0.3 s):
// finds the tools once and sets S.clipWay. A copy needs it only after the
// first picture; /iui details and dump wait for it (clipWayReady).
let finding: Promise<unknown> | null = null
export const clipWayReady = (): Promise<unknown> => finding ?? Promise.resolve()
export function findClipWay($: EngineInterface): Promise<ClipWay> {
  const p = lookUp($)
  finding = p.catch(() => undefined)
  return p
}
async function lookUp($: EngineInterface): Promise<ClipWay> {
  const got = await processRun($, ['sh', '-c', FIND_SH], { timeoutMs: 5000 }).catch(() => null)
  S.clipWay = clipWayOf({
    wayland: !!(await envGet($, 'WAYLAND_DISPLAY')),
    x11: !!(await envGet($, 'DISPLAY')),
    desktop: (await envGet($, 'XDG_CURRENT_DESKTOP')) ?? '',
    found: clipToolsOf(got?.stdout ?? ''),
  })
  return S.clipWay
}

// The clipboard now as text: pbpaste (UTF-8) on macOS, else the way found
// on Linux; null when it can not be read (no tool, or no text in it).
export async function clipboardNow($: EngineInterface): Promise<string | null> {
  if (S.env?.isMac) {
    const got = await processRun($, ['pbpaste'], { timeoutMs: 2000, env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } }).catch(() => null)
    return got && got.exitCode === 0 ? got.stdout : null
  }
  const way = S.clipWay
  if (!way || !('read' in way)) return null
  const got = await processRun($, way.read, { timeoutMs: 2000 }).catch(() => null)
  return got && got.exitCode === 0 ? got.stdout : null
}

// The watcher's arguments after `clip`: none on macOS (its PerlObjCBridge),
// the notifier on Linux; null where the changes can not be seen.
export function clipWatchArgs(isMac: boolean): string[] | null {
  if (isMac) return []
  const way = S.clipWay
  return way && 'watch' in way ? way.watch : null
}

// ---- The shims: Claude Code's own clipboard writes ---------------------------
// Claude Code copies with pbcopy, wl-copy, xclip or xsel, found by name on
// PATH. A shim folder of this process (<cache>/shims-<pid>) first on PATH
// sends each write of picture cells to the mod of its session, which gives
// their text (hooks/clip-shim.sh).
export const SHIM_TOOLS = { mac: ['pbcopy'], linux: ['wl-copy', 'xclip', 'xsel'] } as const
export type ShimState = { tools: string[] } | { off: string }

// The setup script (in the plugin): `find` and `install`, each after it
// checks that the cache folder and the shims folder are private (exit 3).
export const SHIM_SETUP = 'hooks/clip-shim-setup.sh'

export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// The shim of one tool: the template with its name, the real tool, the folder and perl.
export const shimText = (template: string, tool: string, real: string, dir: string, perl: string) =>
  template.split('@TOOL@').join(shQuote(tool)).split('@REAL@').join(shQuote(real)).split('@DIR@').join(shQuote(dir))
    .split('@PERL@').join(shQuote(perl))

// The `find` output: the pid, the tools found (absolute, not in a shims
// folder), perl, and the FIFO for the asks ('' when it was not made).
export function shimFindOf(stdout: string, tools: readonly string[], cache: string): { pid: string; found: Record<string, string>; perl: string; ask: string } {
  let pid = ''
  let perl = ''
  let ask = ''
  const found: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const m = /^(\S+) (.+)$/.exec(line.trim())
    if (!m) continue
    const [, key, value] = m as unknown as [string, string, string]
    if (key === 'pid' && /^\d+$/.test(value)) pid = value
    else if (key === 'perl' && value.startsWith('/')) perl = value
    else if (key === 'ask' && value.startsWith(`${cache}/ask-`) && /^\d+$/.test(value.slice(cache.length + 5))) ask = value
    else if (tools.includes(key) && value.startsWith('/') && !value.startsWith(`${cache}/shims`)) found[key] = value
  }
  return { pid, found, perl, ask }
}

// PATH with the folder first, once; null when it is so already.
export function pathWith(path: string, dir: string): string | null {
  const parts = path ? path.split(':') : []
  if (parts[0] === dir && !parts.slice(1).includes(dir)) return null
  return [dir, ...parts.filter(p => p !== dir)].join(':')
}

// setUp, on this computer (macOS or Linux): the shims of the tools found,
// IUI_COPY_ASK and PATH (once per process: a hot reload finds them set).
export async function setUpShims($: EngineInterface, cache: string, isMac: boolean): Promise<ShimState> {
  S.askFifo = ''
  S.shimDir = ''
  S.shims = await shimsFor($, cache, isMac).catch(() => ({ off: 'the clipboard shims could not be set up' }))
  return S.shims
}
export const NOT_PRIVATE = 'the cache folder is not private'
// No shims, PATH as it is: no private cache folder (CACHE_SH failed), or no
// pictures here (a terminal with no pictures, a background session).
export function noShims(off = NOT_PRIVATE): ShimState {
  S.askFifo = ''
  S.shimDir = ''
  S.shims = { off }
  return S.shims
}
async function shimsFor($: EngineInterface, cache: string, isMac: boolean): Promise<ShimState> {
  const setup = `${pluginRoot($)}/${SHIM_SETUP}`
  const tools = isMac ? SHIM_TOOLS.mac : SHIM_TOOLS.linux
  const path = await envGet($, 'PATH')
  if (!path) return { off: 'no PATH' }
  const got = await processRun($, ['sh', setup, 'find', cache, ...tools], { timeoutMs: 5000 })
  if (got.exitCode === 3) return { off: NOT_PRIVATE }
  if (got.exitCode !== 0) return { off: 'the shim folder could not be made' }
  const { pid, found, perl, ask } = shimFindOf(got.stdout, tools, cache)
  if (!pid) return { off: 'the shim folder could not be made' }
  const dir = `${cache}/shims-${pid}`
  const names = tools.filter(t => found[t])
  if (!names.length) return { off: isMac ? 'no pbcopy' : 'no wl-copy, xclip or xsel: Claude Code copies with its own addon' }
  if (!perl) return { off: 'no perl' }
  if (!ask) return { off: 'the ask FIFO could not be made' }
  const template = await fsRead($, `${pluginRoot($)}/hooks/clip-shim.sh`)
  const suffix = `.new-${pid || 'x'}`
  const args: string[] = []
  for (const tool of tools) {
    const file = `${dir}/${tool}`
    const real = found[tool]
    if (!real) {
      if (await fsExists($, file).catch(() => false)) args.push(`-${file}`)
      continue
    }
    const text = shimText(template, tool, real, dir, perl)
    if ((await fsRead($, file).catch(() => null)) === text) continue
    await fsWrite($, `${file}${suffix}`, text)
    args.push(file)
  }
  if (args.length) {
    const put = await processRun($, ['sh', setup, 'install', cache, suffix, ...args], { timeoutMs: 5000 })
    if (put.exitCode === 3) return { off: NOT_PRIVATE }
    if (put.exitCode !== 0) return { off: 'the clipboard shims could not be installed' }
  }
  // One FIFO per Claude Code process (a nested one has its own).
  if ((await envGet($, 'IUI_COPY_ASK')) !== ask) {
    const set = await envSet($, 'IUI_COPY_ASK', ask)
    if (set.deny) return { off: `IUI_COPY_ASK not set: ${set.deny}` }
  }
  const next = pathWith(path, dir)
  if (next !== null) {
    const set = await envSet($, 'PATH', next)
    if (set.deny) return { off: `PATH not set: ${set.deny}` }
  }
  S.askFifo = ask
  S.shimDir = dir
  return { tools: names }
}

// ---- The asks: a shim wants the text of the picture cells it copies ----------
// The shim writes the cells to <cache>/ask/<id> and the id to the FIFO
// <cache>/ask-<pid>; the reader (ASK_PL) prints `ask <id>`, the mod answers.

// The reader: prints `pid <n>`, then `ask <id>` for each id line of the FIFO
// (open to read and write, so a writer that closes is no end of file). Exit 3
// when the FIFO is not a FIFO of this user; exit 0 when the parent dies.
export const ASK_PL = [
  'my $fifo = shift; my $parent = getppid(); $| = 1;',
  '$SIG{PIPE} = sub { exit 0 };',
  'print "pid $$\\n" or exit 0;',
  'my @l = lstat($fifo); exit 3 unless @l && -p _ && $l[4] == $>;',
  'open(my $f, "+<", $fifo) or exit 3;',
  'my @s = stat($f); exit 3 unless -p _ && $s[0] == $l[0] && $s[1] == $l[1];',
  'my $buf = "";',
  'while (1) {',
  '  my $r = ""; vec($r, fileno($f), 1) = 1;',
  '  my $n = select($r, undef, undef, 2);',
  '  exit 0 if getppid() != $parent;',
  '  next unless $n && $n > 0;',
  '  sysread($f, $buf, 4096, length $buf) or exit 0;',
  '  while ($buf =~ s/^([^\\n]*)\\n//) { my $id = $1; if ($id =~ /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/) { print "ask $id\\n" or exit 0; } }',
  '  $buf = "" if length $buf > 4096;',
  '}',
].join(' ')
// A request id: no path, no dot first.
export const ASK_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/
// The answer to <request> (stdin): mode 600, a temp file, then a link, which
// never replaces the mark of a shim that gave up (then exit 1).
export const ANSWER_SH = 'umask 077; cat >"$1.tmp" || { rm -f "$1.tmp"; exit 1; }; ln "$1.tmp" "$1.answer" 2>/dev/null; r=$?; rm -f "$1.tmp"; exit "$r"'
// After a give-up: the request and the shim's mark.
export const ASK_CLEAN_SH = 'rm -f -- "$1" "$1.answer"'
// The end of the session: the FIFO, this process's request files and its shims folder.
export const ASK_END_SH = 'rm -f -- "$1" "$2/$3"-*; rm -rf -- "$4"'
// A request larger than this is not read (the shim does not ask for one).
export const ASK_MAX = 4 << 20
export const ASK_RESTARTS = 3
export const ASK_RESTART_MS = 1000

const askDir = () => `${S.askFifo.slice(0, S.askFifo.lastIndexOf('/'))}/ask`

// The reader's child now, its restarts (at most ASK_RESTARTS per load) and
// where its ids go (register.tsx).
let asker: { ended: boolean; final: boolean; stop: () => void } | null = null
let askRestarts = 0
let askTo: ((id: string) => void) | null = null
export const asking = () => !!asker && !asker.ended

// Starts the reader of the FIFO (at the first picture: before it, a shim
// finds no reader and copies at once), or again when it ended on its own
// (after ASK_RESTART_MS, ASK_RESTARTS times at most). True when one started.
export function listenAsks($: EngineInterface, to?: (id: string) => void): boolean {
  if (to) askTo = to
  if (!S.askFifo || asker?.final) return false
  if (asker) {
    if (!asker.ended || askRestarts >= ASK_RESTARTS) return false
    askRestarts++
  }
  let pid = ''
  let stopped = false
  const kill = () => {
    if (stopped && pid) void Promise.resolve(processRun($, ['kill', pid], { timeoutMs: 5000 })).catch(() => undefined)
  }
  const me = {
    ended: false,
    final: false,
    stop: () => {
      if (stopped) return
      stopped = true
      kill()
    },
  }
  asker = me
  try {
    const child = spawn($, { argv: [perlFor(S.hostOs === 'Darwin'), '-e', ASK_PL, S.askFifo] })
    void followAsks(child, line => {
      const m = /^(pid|ask) (\S+)$/.exec(line)
      if (m?.[1] === 'pid') {
        pid = m[2]!
        kill()
      } else if (m && !stopped) askTo?.(m[2]!)
    }).then(code => {
      me.ended = true
      if (code === 3) me.final = true
      if (stopped || me.final) return
      try {
        clockAfter($, ASK_RESTART_MS, () => {
          if (asker === me) listenAsks($)
        })
      } catch {}
    }).catch(() => undefined)
  } catch {
    me.ended = me.final = true
  }
  return true
}

// The reader's lines, each to `note`, until it ends: its exit code (null
// when it did not start or a signal ended it).
async function followAsks(
  child: AsyncIterator<{ stream: 'stdout' | 'stderr'; text: string }, { code: number | null } | undefined>,
  note: (line: string) => void,
): Promise<number | null> {
  const lines = lineSplitter()
  try {
    for (;;) {
      const got = await child.next()
      if (got.done) return got.value?.code ?? null
      if (got.value.stream === 'stdout') for (const line of lines(got.value.text)) note(line)
    }
  } catch {
    return null
  }
}

// The cells of request `id`: a file in <cache>/ask (never a link), ASK_MAX
// bytes at most; null for a bad id, no such file or a larger one.
export async function askRequest($: EngineInterface, id: string): Promise<string | null> {
  if (!S.askFifo || !ASK_ID.test(id)) return null
  const path = `${askDir()}/${id}`
  const stat = await fsStat($, path).catch(() => null)
  if (stat?.kind !== 'file' || stat.isLink || stat.size > ASK_MAX) return null
  return fsRead($, path).catch(() => null)
}

// Answers request `id` with `text`: false when the shim gave up (or the write failed).
export async function answerAsk($: EngineInterface, id: string, text: string): Promise<boolean> {
  if (!S.askFifo || !ASK_ID.test(id)) return false
  const got = await processRun($, ['sh', '-c', ANSWER_SH, 'sh', `${askDir()}/${id}`], { stdin: text, timeoutMs: 5000 }).catch(() => null)
  return got?.exitCode === 0
}

// After a give-up of the shim of request `id` (its mark): removes its files.
export async function askGaveUp($: EngineInterface, id: string) {
  if (!S.askFifo || !ASK_ID.test(id)) return
  await processRun($, ['sh', '-c', ASK_CLEAN_SH, 'sh', `${askDir()}/${id}`], { timeoutMs: 5000 }).catch(() => undefined)
}

// The session ends (not a /clear or a resume): the reader stops, and the
// FIFO, this process's request files and its shims folder go.
export async function endAsks($: EngineInterface) {
  asker?.stop()
  asker = { ended: true, final: true, stop: () => {} }
  const fifo = S.askFifo
  if (!fifo) return
  const dir = S.shimDir
  S.askFifo = ''
  S.shimDir = ''
  await processRun($, ['sh', '-c', ASK_END_SH, 'sh', fifo, `${fifo.slice(0, fifo.lastIndexOf('/'))}/ask`, fifo.slice(fifo.lastIndexOf('-') + 1), dir], { timeoutMs: 5000 })
    .catch(() => undefined)
}

// The automatic copy now, for /iui details and dump: the shims and the
// reader of their asks (`asking`). `isFullscreen`: null before a render hook
// says; on the main screen the terminal copies, not Claude Code. The watcher
// (`none`: it printed `clip none`; `way` on Linux) only gives the /iui grab
// hint for the other copies.
export function autoCopyText(o: {
  isMac: boolean; hostOs: string; isRemote: boolean; isOn: boolean; isFullscreen: boolean | null; none: boolean; drawn: boolean; asking: boolean; way: ClipWay | null
  shims: ShimState | null
}): string {
  if (!o.isMac && o.hostOs !== 'Linux') return 'off (not macOS or Linux)'
  if (o.isRemote) return 'off (ssh)'
  if (!o.shims) return 'off (the clipboard shims are not set up yet)'
  if ('off' in o.shims) return `off (${o.shims.off})`
  if (!o.isOn) return 'off (Intelligent UI is off)'
  if (o.isFullscreen === false) return 'off on the main screen (use /iui grab)'
  if (!o.drawn) return 'off (no picture yet)'
  if (!o.asking) return 'off (the ask reader does not run)'
  const hint = hintOffOf(o)
  if (hint) return `on (no /iui grab hint: ${hint})`
  return o.isMac || !o.way || !('name' in o.way) ? 'on' : `on, with ${o.way.name}`
}

// Why the watcher gives no /iui grab hint; '' when it does.
function hintOffOf(o: { isMac: boolean; none: boolean; way: ClipWay | null }): string {
  if (!o.isMac && o.way && 'off' in o.way) return o.way.off
  if (!o.none) return ''
  if (o.isMac || !o.way || 'off' in o.way) return 'no PerlObjCBridge in /usr/bin/perl'
  return `${o.way.name} stopped${o.way.wayland ? ': the compositor may not have the data-control protocol' : ''}`
}
