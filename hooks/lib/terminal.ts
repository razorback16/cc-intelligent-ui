// What the terminal can draw: its columns and cell size, whether the engine
// draws pictures there, and how large a picture sent as bytes (over ssh) can be.
import { S, type Cell } from './state'
import { GUTTER, IMAGE_MAX_COLUMNS, SEGMENT_ROWS, type Width } from './settings'
import { isItermIn } from './terminals'
import type { EnvName } from './api'

// The columns a picture takes: the viewport less the bullet, at most `width`
// (`/iui width`; full: no cap) and IMAGE_MAX_COLUMNS, at least 20.
// `inlineCell`: over ssh, the cell, so a page stays INLINE_MAX_SIDE pixels
// wide at most (a wider page can not go as bytes).
export function columnsFor(viewportColumns: number | undefined, width: Width, inlineCell?: Cell | null): number {
  const caps = [IMAGE_MAX_COLUMNS, ...(width === 'full' ? [] : [width]), ...(inlineCell ? [Math.floor(INLINE_MAX_SIDE / inlineCell.width)] : [])]
  return Math.max(20, Math.min(...caps, (viewportColumns ?? 80) - GUTTER))
}

// The columns a picture has room for now: the viewport at most the tty's,
// less the bullet (as pictureColumns, with no width or ssh cap).
export function roomColumns(view?: { columns: number } | null): number {
  const v = view?.columns ?? S.viewColumns ?? S.frame?.columns
  const tty = S.tty?.columns
  const columns = v === undefined ? tty : tty === undefined ? v : Math.min(v, tty)
  return columnsFor(columns, 'full')
}

// A box at most `room` columns wide, the aspect kept; never larger.
export function fitBox(box: { columns: number; rows: number }, room: number): { columns: number; rows: number } {
  if (box.columns <= room) return { columns: box.columns, rows: box.rows }
  return { columns: room, rows: Math.max(1, Math.round((box.rows * room) / box.columns)) }
}

// The size from `rows cols xpixel ypixel` (TIOCGWINSZ): the rows, the
// columns and the cell in device pixels. iTerm2 (3.5+), Ghostty, kitty and
// WezTerm report device pixels already, so there is no backing-scale step.
// `cell` is null where the tty reports no pixels or a cell that can't be
// right (under 4 or over 64 px wide); the whole is null with no rows or
// columns. `padded`: the pixels include the window padding (Ghostty, cmux),
// so the cell is rounded down to whole pixels (a cell is whole device
// pixels, and the padding is less than one pixel per column or row).
export function sizeOf(stdout: string, padded = false): { rows: number; columns: number; cell: Cell | null } | null {
  const [rows, columns, x, y] = stdout.trim().split(/\s+/).map(Number)
  if (!rows || !columns || !Number.isInteger(rows) || !Number.isInteger(columns)) return null
  if (!x || !y) return { rows, columns, cell: null }
  const width = padded ? Math.floor(x / columns) : x / columns
  const height = padded ? Math.floor(y / rows) : y / rows
  return { rows, columns, cell: width >= 4 && width <= 64 && height >= 4 ? { width, height } : null }
}

// Ghostty, or cmux (Ghostty's engine): its tty pixels include the window
// padding (iTerm2, kitty and WezTerm do not), and it draws its own font when
// its config names none. herdr in Ghostty uses Ghostty's font and config (its
// tty pixels are whole cells, so the round down changes nothing).
export const isGhosttyHere = () => isGhosttyIn(S.termProgram, S.termName) || S.isCmux || S.herdrHost === 'ghostty'

// The terminals by their variables: Ghostty by TERM_PROGRAM or TERM; kitty
// by TERM=xterm-kitty, KITTY_WINDOW_ID or KITTY_PID; cmux by one of its
// CMUX_* variables; Rio by TERM_PROGRAM=rio or TERM=rio.
export const isGhosttyIn = (program: string, term: string) => /ghostty/i.test(program + term)
export const isKittyIn = (env: { term: string; windowId?: string; pid?: string }) => /kitty/i.test(env.term) || !!env.windowId || !!env.pid
export const isCmuxIn = (env: { surface?: string; workspace?: string; socket?: string }) => !!env.surface || !!env.workspace || !!env.socket
export const isRioIn = (program: string, term: string) => /^rio$/i.test(program) || /^rio$/i.test(term)

// A set flag: anything but empty, 0, false, no or off.
export const isSet = (value: string | undefined) => !!value && !/^(0|false|no|off)$/i.test(value.trim())

// herdr (a multiplexer with a terminal of its own per pane): TERM_PROGRAM, or
// HERDR_ENV with no TERM_PROGRAM. Another TERM_PROGRAM (tmux in a pane, a
// terminal started from one) wins.
export function isHerdrIn(env: { program: string; herdrEnv?: string }): boolean {
  if (env.program) return /^herdr$/i.test(env.program)
  return isSet(env.herdrEnv)
}

// The terminal herdr runs in. From the variables it keeps of the terminal
// that started its server (the fallback, when no client is found): cmux's
// CMUX_*, Ghostty's GHOSTTY_*_DIR, kitty's KITTY_PID or
// KITTY_INSTALLATION_DIR, iTerm2's ITERM_PROFILE; '' when none.
export type HerdrHost = 'ghostty' | 'cmux' | 'kitty' | 'iterm' | 'rio' | ''
export function herdrHostOf(env: { cmux?: boolean; ghosttyResources?: string; ghosttyBin?: string; kittyPid?: string; kittyDir?: string; itermProfile?: string }): HerdrHost {
  if (env.cmux) return 'cmux'
  if (env.ghosttyResources || env.ghosttyBin) return 'ghostty'
  if (env.kittyPid || env.kittyDir) return 'kitty'
  if (env.itermProfile) return 'iterm'
  return ''
}

// The variables of the terminal the user sees that the font and mode
// readers use (host.ts outerEnv): under herdr, the client's.
export const OUTER_NAMES = ['COLORFGBG', 'GHOSTTY_BIN_DIR', 'GHOSTTY_RESOURCES_DIR', 'ITERM_PROFILE', 'KITTY_CONFIG_DIRECTORY', 'RIO_CONFIG_HOME'] as const satisfies readonly EnvName[]
export type OuterName = (typeof OUTER_NAMES)[number]

// A herdr client (HERDR_CLIENT_SH): its pid, its tty and the tty's access
// time (the last key typed there), its command, the nearest ancestor with no
// tty (the terminal app), its variables and the terminal they give.
export type HerdrClient = { pid: number; atime: number; tty: string; cmd: string; app: string; env: Record<string, string>; kind: HerdrHost }

// The terminal of a client: by its terminal app's path first (a variable
// can come from another terminal that started this one), then by TERM,
// TERM_PROGRAM (another one, as WezTerm's: not known) and the variables of
// kitty, cmux, Ghostty and iTerm2.
export function outerKindOf(env: Readonly<Record<string, string>>, app: string): HerdrHost {
  // The program: an app bundle's path (its folders can hold spaces), else the first word.
  const path = /^\S*(?: [^ /-][^ ]*)*?\.app\/\S*/.exec(app)?.[0] ?? app.split(' ')[0] ?? ''
  if (/cmux/i.test(path)) return 'cmux'
  if (/ghostty/i.test(path)) return 'ghostty'
  if (/kitty/i.test(path)) return 'kitty'
  if (/iterm/i.test(path)) return 'iterm'
  if (/(^|\/)rio(\.app)?(\/|$)/i.test(path)) return 'rio'
  const program = env.TERM_PROGRAM ?? ''
  const term = env.TERM ?? ''
  const cmux = isCmuxIn({ surface: env.CMUX_SURFACE_ID, workspace: env.CMUX_WORKSPACE_ID, socket: env.CMUX_SOCKET_PATH })
  if (/kitty/i.test(term)) return 'kitty'
  if (isGhosttyIn(program, term)) return cmux ? 'cmux' : 'ghostty'
  if (isRioIn(program, term)) return 'rio'
  if (isItermIn({ program, profile: env.ITERM_PROFILE, session: env.ITERM_SESSION_ID, lcTerminal: env.LC_TERMINAL })) return 'iterm'
  if (program) return ''
  if (isKittyIn({ term, windowId: env.KITTY_WINDOW_ID, pid: env.KITTY_PID })) return 'kitty'
  return herdrHostOf({ cmux, ghosttyResources: env.GHOSTTY_RESOURCES_DIR, ghosttyBin: env.GHOSTTY_BIN_DIR, kittyDir: env.KITTY_INSTALLATION_DIR, itermProfile: env.ITERM_PROFILE })
}

// The variables of a process: NUL-separated (Linux /proc/<pid>/environ), or
// as macOS `ps eww` prints them: its command (`cmd`, as ps prints it with no
// variables), then `NAME=value` words. A value can hold spaces (an iTerm2
// profile name), so a word starts only where a `NAME=` follows a space.
export function envOfText(text: string, cmd: string): Record<string, string> {
  const env: Record<string, string> = {}
  let words: string[]
  if (text.includes('\0')) words = text.split('\0')
  else {
    const line = text.replace(/\n+$/, '')
    const bare = !!cmd && (line === cmd || line.startsWith(`${cmd} `))
    words = (bare ? line.slice(cmd.length) : line).split(/ (?=[A-Za-z_][A-Za-z0-9_]*=)/)
    // Not known where the command ends: its first word is not a variable.
    if (!bare) words.shift()
  }
  for (const word of words) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(word)
    if (m) env[m[1]!] = m[2]!
  }
  return env
}

// HERDR_CLIENT_SH's output (`pid`, `atime`, `tty`, `cmd` and `app` lines,
// then `env` and the variables) as a client; null for none. Ghostty with no
// GHOSTTY_BIN_DIR gets its app's folder (GHOSTTY_SH runs that ghostty).
export function herdrClientOf(stdout: string): HerdrClient | null {
  const at = stdout.indexOf('\nenv\n')
  if (at < 0) return null
  const head = stdout.slice(0, at).split('\n')
  const field = (name: string) => head.find(line => line.startsWith(`${name} `))?.slice(name.length + 1).trim() ?? ''
  const pid = Number(field('pid'))
  if (!Number.isInteger(pid) || pid <= 0) return null
  const cmd = field('cmd')
  const app = field('app')
  const env = envOfText(stdout.slice(at + 5), cmd)
  const kind = outerKindOf(env, app)
  const bin = /^(.*)\/ghostty(?= |$)/.exec(app)?.[1]
  if (kind === 'ghostty' && !env.GHOSTTY_BIN_DIR && bin) env.GHOSTTY_BIN_DIR = bin
  return { pid, atime: Number(field('atime')) || 0, tty: field('tty'), cmd, app, env, kind }
}

// What the font and the mode depend on: the kind and OUTER_NAMES (not the
// pid or the time: another window of the same terminal changes nothing).
export const herdrClientKey = (c: HerdrClient | null) => (c ? JSON.stringify([c.kind, ...OUTER_NAMES.map(name => c.env[name] ?? '')]) : '')
export const herdrClientChanged = (was: HerdrClient | null, now: HerdrClient | null) => herdrClientKey(was) !== herdrClientKey(now)

const HERDR_HOSTS = { ghostty: 'Ghostty', cmux: 'cmux', kitty: 'kitty', iterm: 'iTerm2', rio: 'Rio' } as const
// herdr in /iui details, and where its terminal came from: the client
// typed in last, or the server's variables (the fallback).
export type HerdrFrom = 'client' | 'server'
export const herdrText = (version: string, host: HerdrHost, from: HerdrFrom = 'server') =>
  `herdr${version ? ` ${version}` : ''} (${
    host ? `in ${HERDR_HOSTS[host]}, ${from === 'client' ? 'the client you used last' : "from the server's start"}` : 'outer terminal not known'
  })`

// Whether /iui setup can turn pictures on: they are off, and this is iTerm2
// on a Mac or herdr (macOS or Linux), not over ssh, tmux, screen or a
// background session.
export function needsSetup(o: { iterm: boolean; herdr: boolean; draws: boolean; ssh: boolean; os: string; tmux: boolean; background: boolean }): boolean {
  if (o.draws || o.ssh || o.tmux || o.background) return false
  return (o.iterm && o.os === 'Darwin') || o.herdr
}

// Whether the engine draws pictures here; elsewhere an Image shows only its
// alt, so the text is better. Claude Code turns kitty graphics on by itself
// only for kitty and Ghostty; any other terminal draws only when
// CLAUDE_CODE_FORCE_TERMINAL_IMAGES is set. A background session never
// draws. In tmux or screen the engine draws none even when forced (it does
// not wrap them for passthrough), so only IUI_FORCE tries. Over ssh
// TERM_PROGRAM and KITTY_WINDOW_ID do not come through, so TERM tells; the
// pictures then go as bytes (Env.inline), as the terminal can't read our files.
export function canDrawIn(env: { program: string; term: string; kitty: boolean; tmux: boolean; ssh: boolean; background: boolean; engineForced: boolean; modForced: boolean }): boolean {
  if (env.background) return false
  if (env.tmux) return env.modForced
  if (env.engineForced || env.modForced) return true
  if (env.ssh) return /ghostty|kitty/i.test(env.term)
  return /ghostty/i.test(env.program + env.term) || /kitty/i.test(env.term) || env.kitty
}

// The most an Image's `{ png }` source holds: 2 MiB decoded, 1 to 4096
// pixels a side (the engine refuses the tree past that).
export const INLINE_MAX_BYTES = 2 * 1024 * 1024
export const INLINE_MAX_SIDE = 4096
// The bytes a standard padded base64 text decodes to.
export const base64Bytes = (text: string) => Math.floor((text.length * 3) / 4) - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0)
// Whether a page can go as `{ png }` bytes: by its pixels, and by its bytes once read.
export const fitsInline = (page: { width: number; height: number }, base64?: string) =>
  page.width >= 1 && page.width <= INLINE_MAX_SIDE && page.height >= 1 && page.height <= INLINE_MAX_SIDE &&
  (base64 === undefined || base64Bytes(base64) <= INLINE_MAX_BYTES)
// Over ssh, a segment's budget in rows so that its page stays under
// INLINE_MAX_SIDE pixels tall (with room for the rough row count).
export const inlineBudget = (px: Cell) => Math.max(20, Math.min(SEGMENT_ROWS, Math.floor((INLINE_MAX_SIDE / px.height) * 0.75)))
// herdr skips an image whose RGBA (4 bytes a pixel), sent as base64, is over
// its 30 MiB transfer budget: a page stays under 16 MiB decoded.
export const HERDR_MAX_PAGE_BYTES = 16 * 1024 * 1024
// Under herdr, a segment's budget in rows so that its page (the columns'
// width in device pixels, as sizing makes it) stays under HERDR_MAX_PAGE_BYTES
// (with room for the rough row count).
export const herdrBudget = (columns: number, px: Cell) =>
  Math.max(20, Math.min(SEGMENT_ROWS, Math.floor((HERDR_MAX_PAGE_BYTES / (4 * Math.round(columns * px.width) * px.height)) * 0.75)))
// A segment's budget in rows: the smaller of the ssh and herdr ones that apply.
export const segmentBudget = (env: { inline: boolean; herdr?: boolean }, columns: number, px: Cell) =>
  Math.min(env.inline ? inlineBudget(px) : SEGMENT_ROWS, env.herdr ? herdrBudget(columns, px) : SEGMENT_ROWS)
