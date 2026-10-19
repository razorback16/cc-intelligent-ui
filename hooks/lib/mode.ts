// Light or dark: Claude Code's theme setting, the OS appearance, COLORFGBG,
// a colour's luminance and the terminal's OSC 11 answer (pure; the reads on
// the host are in host.ts).
import type { IuiTheme } from '../../types'

export function themeOf(value: unknown): IuiTheme {
  return typeof value === 'string' && /light/i.test(value) ? 'light' : 'dark'
}

// Claude Code's theme setting: dark, light, dark-daltonized, light-ansi, …
// are fixed; `auto`, or any other text, follows the OS. No value is Claude
// Code's default, dark.
export type ThemeSetting = IuiTheme | 'auto'
export function settingOf(value: unknown): ThemeSetting {
  if (typeof value !== 'string' || !value.trim()) return 'dark'
  if (/light/i.test(value)) return 'light'
  if (/dark/i.test(value)) return 'dark'
  return 'auto'
}

// The OS appearance, and where it was read.
export type HostMode = {
  mode: IuiTheme
  source: 'terminal' | 'iTerm2' | 'Ghostty' | 'cmux' | 'kitty' | 'Rio' | 'macOS' | 'GNOME' | 'desktop portal' | 'COLORFGBG'
  detail?: string
}

// `defaults read -g AppleInterfaceStyle`: "Dark" in dark mode; in light mode
// the key does not exist and the command fails.
export function modeOfMacAppearance(exitCode: number, stdout: string): IuiTheme {
  return exitCode === 0 && /^\s*dark\s*$/i.test(stdout) ? 'dark' : 'light'
}

// `gsettings get org.gnome.desktop.interface color-scheme`: 'prefer-dark',
// 'prefer-light' or 'default'; null for anything else.
export function modeOfGnome(stdout: string): IuiTheme | null {
  const v = stdout.trim().replace(/^'|'$/g, '')
  if (v === 'prefer-dark') return 'dark'
  if (v === 'prefer-light' || v === 'default') return 'light'
  return null
}

// The freedesktop portal's `org.freedesktop.appearance color-scheme`
// (Settings.Read), as gdbus prints it (`(<<uint32 1>>,)`) or busctl (`v v u
// 1`): 1 dark, 2 light, 0 no preference; null for anything else.
export function schemeOfPortal(stdout: string): 'dark' | 'light' | 'no-preference' | null {
  const m = /(?:\buint32|\bu)\s+(\d+)\b/.exec(stdout)
  const v = m ? Number(m[1]) : -1
  return v === 1 ? 'dark' : v === 2 ? 'light' : v === 0 ? 'no-preference' : null
}

// COLORFGBG, "fg;bg" or "fg;x;bg": the last field is the background colour
// index. 0-6 and 8 are dark, 7 and 15 light; anything else is not known.
export function modeOfColorFgBg(value: string | undefined): IuiTheme | null {
  const last = (value ?? '').split(';').pop()?.trim() ?? ''
  if (!/^\d+$/.test(last)) return null
  const bg = Number(last)
  if ((bg >= 0 && bg <= 6) || bg === 8) return 'dark'
  if (bg === 7 || bg === 15) return 'light'
  return null
}

// The mode to draw: a fixed setting as set; auto as the OS is, dark when it
// was never read.
export function resolveMode(setting: ThemeSetting, seen: HostMode | null): IuiTheme {
  return setting === 'auto' ? (seen?.mode ?? 'dark') : setting
}

// What the status line says about the mode.
export function modeLine(mode: IuiTheme, setting: ThemeSetting, raw: string, seen: HostMode | null): string {
  if (setting !== 'auto') return `mode ${mode} (Claude Code theme ${raw || mode})`
  return `mode ${mode} (auto, ${seen ? `from ${seen.source}${seen.detail ? `: ${seen.detail}` : ''}` : 'OS appearance not known, dark assumed'})`
}

export type Rgb = { r: number; g: number; b: number }
// Relative luminance of an sRGB colour (components 0..1).
export function luminanceOf(c: Rgb): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}
export const modeOfLuminance = (l: number): IuiTheme => (l > 0.4 ? 'light' : 'dark')

// A terminal's answer to OSC 11 (`ESC ] 11 ; ?`), the query Claude Code
// itself sends: `ESC ] 11 ; rgb:R/G/B` with 1-4 hex digits per channel,
// ended by BEL or ST (`ESC \`). The colour in 0..1, or null.
export function parseOsc11(text: string): Rgb | null {
  const m = /\x1b\]11;rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\/[0-9a-f]{1,4})?(?:\x07|\x1b\\)/i.exec(text)
  if (!m) return null
  const part = (h: string) => parseInt(h, 16) / (16 ** h.length - 1)
  return { r: part(m[1]!), g: part(m[2]!), b: part(m[3]!) }
}

// Control characters shown as text (\e, \a, \xNN), for /iui probe.
export const escapeControls = (text: string) =>
  text.replace(/[\x00-\x1f\x7f]/g, c => (c === '\x1b' ? '\\e' : c === '\x07' ? '\\a' : `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`))
