// The clipboard of this computer: how a copy reads it and how its changes
// are seen. macOS: pbpaste, and the change count of the watcher's
// PerlObjCBridge (host.ts). Linux: Wayland's wl-paste (its --watch sees each
// change), else X11 (also Xwayland): xclip or xsel to read, clipnotify for
// an event at each change, else GTK 3 from Python (python3-gi, on most GNOME
// desktops) for both. The changes give the /iui grab hint (where no tool sees
// them there is none: the clipboard is never read at intervals).
import type { EngineInterface } from 'claude-code'

import { S } from './state'
import { envGet, processRun } from './api'

// The tools the choice looks for, in the order it prefers them. `gtk` is
// python3 when it can load GTK 3 (gi).
export const CLIP_TOOLS = ['wl-paste', 'xclip', 'xsel', 'clipnotify', 'gtk'] as const
export type ClipTool = (typeof CLIP_TOOLS)[number]

// How the clipboard is read and watched: `read` the argv that prints its
// text; `watch` the notifier's argv (the watcher runs it and gives one
// `clip <n>` line for each line it prints, the first at its start: its
// clipboard then is no new copy); `name` for /iui details. `off`: why the
// /iui grab hint is off.
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

// The /iui grab hint now, for /iui details and dump: the watcher sees each
// clipboard change, and picture cells copied (a native drag over text and
// pictures, the main screen's copy) get a toast that names /iui grab.
// `none`: the watcher printed `clip none`; `way` on Linux.
export function hintText(o: {
  isMac: boolean; hostOs: string; isRemote: boolean; isOn: boolean; none: boolean; drawn: boolean; running: boolean; way: ClipWay | null
}): string {
  if (!o.isMac && o.hostOs !== 'Linux') return 'off (not macOS or Linux)'
  if (o.isRemote) return 'off (ssh)'
  if (!o.isMac && o.way && 'off' in o.way) return `off (${o.way.off})`
  if (!o.isMac && !o.way) return 'off (the clipboard tools are not looked up yet)'
  if (!o.isOn) return 'off (Intelligent UI is off)'
  if (o.none) {
    if (o.isMac || !o.way || 'off' in o.way) return 'off (no PerlObjCBridge in /usr/bin/perl)'
    return `off (${o.way.name} stopped${o.way.wayland ? ': the compositor may not have the data-control protocol' : ''})`
  }
  if (!o.drawn) return 'off (no picture yet)'
  if (!o.running) return 'off (the watcher does not run)'
  return o.isMac || !o.way || !('name' in o.way) ? 'on' : `on, with ${o.way.name}`
}
