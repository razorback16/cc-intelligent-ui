// What the terminal can draw: its columns and cell size, whether the engine
// draws pictures there, and how large a picture sent as bytes (over ssh) can be.
import { S, type Cell } from './state'
import { GUTTER, IMAGE_MAX_COLUMNS, SEGMENT_ROWS, type Width } from './settings'

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
// its config names none.
export const isGhosttyHere = () => /ghostty/i.test(S.termProgram + S.termName) || S.isCmux

// A set flag: anything but empty, 0, false, no or off.
export const isSet = (value: string | undefined) => !!value && !/^(0|false|no|off)$/i.test(value.trim())

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
