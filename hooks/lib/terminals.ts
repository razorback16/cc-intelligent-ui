// The terminals' own settings (iTerm2, Ghostty, kitty, Rio, cmux): their
// backgrounds and fonts from their config files and profiles (pure; the
// reads on the host are in host.ts).
import type { IuiTheme } from '../../types'
import { luminanceOf, modeOfLuminance, type Rgb } from './mode'

// An iTerm2 profile ("New Bookmarks" entry): the one named as ITERM_PROFILE
// says, else the default one.
export type ItermMark = Record<string, unknown>
export function pickProfile(marks: readonly unknown[], profile: string | undefined, defaultGuid: string): ItermMark | null {
  const list = marks.filter((x): x is ItermMark => !!x && typeof x === 'object' && !Array.isArray(x))
  return (profile ? list.find(b => b.Name === profile) : undefined) ?? list.find(b => b.Guid === defaultGuid.trim()) ?? null
}

// iTerm2's own appearance (Settings > Appearance > Theme, the
// TabStyleWithAutomaticOption default): 0 and 2 light, 1 and 3 dark;
// Automatic (4), Minimal (5), Compact (6) or no value follow the OS (null).
export function itermAppearanceOf(stdout: string): IuiTheme | null {
  const v = stdout.trim()
  if (v === '0' || v === '2') return 'light'
  if (v === '1' || v === '3') return 'dark'
  return null
}

// An iTerm2 colour ({ "Red Component": 0..1, … }), or null.
function itermColorOf(value: unknown): Rgb | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  const [r, g, b] = [c['Red Component'], c['Green Component'], c['Blue Component']]
  return typeof r === 'number' && typeof g === 'number' && typeof b === 'number' ? { r, g, b } : null
}

// The mode of the iTerm2 profile's background: the profile named as
// ITERM_PROFILE says, else the default one. A profile with separate colours
// for light and dark mode uses the set `appearance` gives (the OS's when
// iTerm2 follows it; null when that is not known). `bookmarks` is the JSON of
// the plist's "New Bookmarks" array.
export function itermModeOf(bookmarks: string, profile: string | undefined, defaultGuid: string, appearance: IuiTheme | null): IuiTheme | null {
  let list: unknown
  try {
    list = JSON.parse(bookmarks)
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  const mark = pickProfile(list, profile, defaultGuid)
  if (!mark) return null
  const separate = mark['Use Separate Colors for Light and Dark Mode'] === true
  if (separate && !appearance) return null
  const key = separate ? `Background Color (${appearance === 'dark' ? 'Dark' : 'Light'})` : 'Background Color'
  const bg = itermColorOf(mark[key]) ?? itermColorOf(mark['Background Color'])
  return bg ? modeOfLuminance(luminanceOf(bg)) : null
}

// "MesloLGS-NF-Regular 14" (iTerm2's Normal Font) → PostScript name and size.
// As iTerm2 reads it: the name to the first space, the size, then any
// settings (`{"featureSettings":…}`), which are skipped.
export function parseFontSpec(spec: string): { name: string; size: number } | null {
  const m = /^\s*(\S+) +(\d+(?:\.\d+)?)(?:\s|$)/.exec(spec)
  return m ? { name: m[1]!, size: Number(m[2]) } : null
}

// The Normal Font of the iTerm2 profile in use: the bookmark named
// ITERM_PROFILE, else the default bookmark. `bookmarks` is the JSON of the
// plist's "New Bookmarks" array. Null when that is not JSON or has no such
// profile; '' when the profile has no font.
export function itermFontOf(bookmarks: string, profile: string | undefined, defaultGuid: string): string | null {
  let list: unknown
  try {
    list = JSON.parse(bookmarks)
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  const mark = pickProfile(list, profile, defaultGuid)
  if (!mark) return null
  const font = mark['Normal Font']
  return typeof font === 'string' ? font.trim() : ''
}

// Ghostty's background when its config sets none and no theme.
export const GHOSTTY_DEFAULT_BG = '#282c34'

// `#rrggbb` or `rrggbb` in 0..1, or null (X11 colour names are not known).
export function hexColorOf(text: string): Rgb | null {
  const m = /^\s*#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\s*$/i.exec(text)
  return m ? { r: parseInt(m[1]!, 16) / 255, g: parseInt(m[2]!, 16) / 255, b: parseInt(m[3]!, 16) / 255 } : null
}

// The last value of `key = value` in a Ghostty config or theme file, or ''.
export function ghosttyValueOf(config: string, key: string): string {
  let value = ''
  for (const line of config.split('\n')) {
    const m = /^\s*([\w-]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && m[1] === key) value = m[2]!.replace(/^"(.*)"$/, '$1')
  }
  return value
}

// Ghostty's `theme`: one name, or `light:A,dark:B` (in either order).
export function ghosttyThemesOf(value: string): { light: string; dark: string } | null {
  const pair: Record<string, string> = {}
  for (const part of value.split(',')) {
    const m = /^\s*(light|dark)\s*:\s*(.*?)\s*$/i.exec(part)
    if (m && m[2]) pair[m[1]!.toLowerCase()] = m[2]
  }
  return pair.light && pair.dark ? { light: pair.light, dark: pair.dark } : null
}

// The files a Ghostty theme name can be: an absolute path as is, else the
// user's themes folder, then the themes Ghostty ships.
export function ghosttyThemePaths(name: string, o: { xdgConfig?: string; home: string; resources?: string }): string[] {
  if (name.startsWith('/')) return [name]
  if (name.startsWith('~/')) return [`${o.home}${name.slice(1)}`]
  const config = o.xdgConfig || `${o.home}/.config`
  return [
    `${config}/ghostty/themes/${name}`,
    `${o.home}/Library/Application Support/com.mitchellh.ghostty/themes/${name}`,
    ...(o.resources ? [`${o.resources}/themes/${name}`] : []),
    `/Applications/Ghostty.app/Contents/Resources/ghostty/themes/${name}`,
    `/usr/share/ghostty/themes/${name}`,
    `/usr/local/share/ghostty/themes/${name}`,
  ]
}

// The background Ghostty draws, from `ghostty +show-config` (which prints the
// values that differ from the defaults, a single theme's colours merged in).
// With `light:A,dark:B` the shown background is one theme's, so the one for
// `appearance` is taken from `themeBg` (each theme file's background) unless
// the config sets a background of its own (it then matches neither theme).
// Null when the appearance is needed but not known.
export function ghosttyBackgroundOf(config: string, appearance: IuiTheme | null, themeBg: { light?: string; dark?: string }): string | null {
  const shown = ghosttyValueOf(config, 'background')
  const pair = ghosttyThemesOf(ghosttyValueOf(config, 'theme'))
  if (!pair) return shown || GHOSTTY_DEFAULT_BG
  const same = (a?: string, b?: string) => !!a && !!b && a.replace('#', '').toLowerCase() === b.replace('#', '').toLowerCase()
  const fromTheme = !shown || same(shown, themeBg.light) || same(shown, themeBg.dark)
  if (!fromTheme) return shown
  if (!appearance) return null
  return themeBg[appearance] || null
}

// The font Ghostty carries and draws when no font-family is set.
export const GHOSTTY_DEFAULT_FONT = 'JetBrains Mono'

// fontconfig's `%{family}` (fc-match -f): the first of its names, which
// can be a list (`Noto Sans Mono,Noto Sans Mono Regular`).
export const familyOfFc = (stdout: string) => (stdout.split(',')[0] ?? '').trim()

// Ghostty's `font-family` list: `ghostty +show-config` (with cmux's own
// config after it). An empty value clears the list.
export function ghosttyFontsOf(config: string): string[] {
  let list: string[] = []
  for (const line of config.split('\n')) {
    const m = /^\s*font-family\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const family = m[1]!.replace(/^"(.*)"$/, '$1').trim()
    list = family ? [...list, family] : []
  }
  return list
}

// The first font of Ghostty's `font-family` list, or null.
export const ghosttyFontOf = (config: string): string | null => ghosttyFontsOf(config)[0] ?? null

// The font kitty draws on macOS for `monospace` and for a font it does not find.
export const KITTY_MAC_FONT = 'Menlo'

// kitty's background when no config or auto theme sets one.
export const KITTY_DEFAULT_BG = '#000000'
// At most this many kitty config files are read (kitty.conf and its includes).
const KITTY_MAX_FILES = 32
export type KittyEntries = [key: string, value: string][]

// The `key value` lines of a kitty config file, in order. A comment is a
// line that starts with `#`.
export function kittyLinesOf(text: string): KittyEntries {
  const out: KittyEntries = []
  for (const raw of text.split('\n')) {
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*)\s+(.+)$/.exec(raw.trim())
    if (m) out.push([m[1]!, m[2]!.trim()])
  }
  return out
}

// The last value of `key` in kitty config entries, or ''.
export function kittyValueOf(entries: KittyEntries, key: string): string {
  let value = ''
  for (const [k, v] of entries) if (k === key) value = v
  return value
}

// The file an `include` names: `~` is the home folder, `$X` / `${X}` come
// from `vars` (others stay), and a relative path starts at the folder of the
// file that has the line.
export function kittyIncludePath(value: string, dir: string, o: { home: string; vars?: Readonly<Record<string, string>> }): string {
  const vars = o.vars ?? {}
  let path = value.trim().replace(/\$(?:\{(\w+)\}|(\w+))/g, (all: string, a?: string, b?: string) => vars[a ?? b ?? ''] ?? all)
  if (path === '~' || path.startsWith('~/')) path = `${o.home}${path.slice(1)}`
  return path.startsWith('/') ? path : `${dir.replace(/\/+$/, '')}/${path}`
}

// A kitty config file with its `include` files in place (as kitty reads
// them: each file once, so no loops). `globinclude`, `envinclude` and
// `geninclude` are skipped. `readText` gives null for a file it can't read.
export async function kittyEntriesOf(
  path: string,
  readText: (path: string) => Promise<string | null>,
  o: { home: string; vars?: Readonly<Record<string, string>> },
  seen = new Set<string>(),
): Promise<KittyEntries> {
  if (seen.has(path) || seen.size >= KITTY_MAX_FILES) return []
  seen.add(path)
  const text = await readText(path)
  if (text === null) return []
  const dir = path.replace(/\/[^/]*$/, '') || '/'
  const out: KittyEntries = []
  for (const [key, value] of kittyLinesOf(text)) {
    if (key === 'include') out.push(...(await kittyEntriesOf(kittyIncludePath(value, dir, o), readText, o, seen)))
    else out.push([key, value])
  }
  return out
}

// The folders kitty looks in for kitty.conf, in order: KITTY_CONFIG_DIRECTORY
// alone when set; else XDG_CONFIG_HOME's, ~/.config's, and on macOS
// ~/Library/Preferences's.
export function kittyConfigDirsOf(o: { kittyDir?: string; xdgConfig?: string; home: string; isMac: boolean }): string[] {
  if (o.kittyDir) return [o.kittyDir]
  const dirs = [...(o.xdgConfig ? [`${o.xdgConfig}/kitty`] : []), `${o.home}/.config/kitty`, ...(o.isMac ? [`${o.home}/Library/Preferences/kitty`] : [])]
  return [...new Set(dirs)]
}

// kitty's `font_family`: a family name, `family="…" style=…` (kitty 0.36+),
// or `postscript_name=…`. Null for the system's monospace font (`monospace`,
// `auto`, or no value).
export function kittyFontOf(value: string): { family: string } | { postscript: string } | null {
  const v = value.trim()
  const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, '$2').trim()
  const isSystem = (s: string) => !s || /^(monospace|auto)$/i.test(s)
  if (/^[a-z_]+=/.test(v)) {
    const pairs: Record<string, string> = {}
    for (const m of v.matchAll(/([a-z_]+)=("[^"]*"|'[^']*'|\S+)/g)) pairs[m[1]!] = unquote(m[2]!)
    if (pairs.family !== undefined) return isSystem(pairs.family) ? null : { family: pairs.family }
    return pairs.postscript_name ? { postscript: pairs.postscript_name } : null
  }
  const name = unquote(v)
  return isSystem(name) ? null : { family: name }
}

// The OS colour scheme as kitty sees it, from GNOME's `color-scheme`:
// 'default' is no preference. Null for anything else.
export function kittySchemeOfGnome(stdout: string): 'dark' | 'light' | 'no-preference' | null {
  const v = stdout.trim().replace(/^'|'$/g, '')
  return v === 'prefer-dark' ? 'dark' : v === 'prefer-light' ? 'light' : v === 'default' ? 'no-preference' : null
}

// The auto theme file kitty (0.38+) uses for an OS colour scheme, when it
// exists in the config folder. Its colours replace all others.
export const kittyAutoFileOf = (scheme: 'dark' | 'light' | 'no-preference') => `${scheme}-theme.auto.conf`

// The background kitty draws: the auto theme file's (kitty's defaults
// first, then the file) when one applies, else kitty.conf's with its
// includes, else kitty's default.
export function kittyBackgroundOf(conf: KittyEntries, auto: { file: string; entries: KittyEntries } | null): { bg: string; detail: string } {
  if (auto) return { bg: kittyValueOf(auto.entries, 'background') || KITTY_DEFAULT_BG, detail: `${auto.file} background` }
  const own = kittyValueOf(conf, 'background')
  return { bg: own || KITTY_DEFAULT_BG, detail: own ? 'config background' : 'default background' }
}

// Rio's background when neither its config nor a theme sets one.
export const RIO_DEFAULT_BG = '#0f0d0e'
// The font Rio carries and draws when the config names none (or one that
// it does not find): Cascadia Code NF, by its family name.
export const RIO_DEFAULT_FONT = 'Cascadia Code NF'
// The font a Rio up to 0.4 carries (no `fvar`, so it is not copied out).
export const RIO_OLD_FONT = 'Cascadia Code'

// The string values of a TOML file by dotted path (`[fonts.regular]` then
// `family = "X"` is `fonts.regular.family`). Only what Rio's few keys need:
// tables, dotted and quoted keys, one-line strings, one-line inline tables
// of strings, and `#` comments. Other values are skipped.
export function tomlStringsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const KEY = String.raw`(?:[\w-]+|"[^"]*"|'[^']*')`
  const pathOf = (key: string) => [...key.matchAll(new RegExp(KEY, 'g'))].map(m => m[0].replace(/^(["'])(.*)\1$/, '$2')).join('.')
  const stringOf = (value: string) => {
    const m = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(value)
    if (!m) return null
    return m[2] ?? m[1]!.replace(/\\(["\\])/g, '$1')
  }
  const head = new RegExp(String.raw`^\[\[?\s*(${KEY}(?:\s*\.\s*${KEY})*)\s*\]\]?\s*(?:#.*)?$`)
  const entry = new RegExp(String.raw`^(${KEY}(?:\s*\.\s*${KEY})*)\s*=\s*(.*)$`)
  const pair = new RegExp(String.raw`(${KEY})\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')`, 'g')
  let table = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const h = head.exec(line)
    if (h) {
      table = pathOf(h[1]!)
      continue
    }
    const m = entry.exec(line)
    if (!m) continue
    const key = [table, pathOf(m[1]!)].filter(Boolean).join('.')
    const value = m[2]!
    if (value.startsWith('{')) {
      for (const p of value.matchAll(pair)) {
        const s = stringOf(p[2]!)
        if (s !== null) out[`${key}.${pathOf(p[1]!)}`] = s
      }
    } else {
      const s = stringOf(value)
      if (s !== null) out[key] = s
    }
  }
  return out
}

// Rio's config folder: RIO_CONFIG_HOME, else (not on macOS) XDG_CONFIG_HOME's
// rio, else ~/.config/rio.
export function rioConfigDirOf(o: { rioHome?: string; xdgConfig?: string; home: string; isMac: boolean }): string {
  if (o.rioHome) return o.rioHome
  return `${!o.isMac && o.xdgConfig ? o.xdgConfig : `${o.home}/.config`}/rio`
}

// A Rio theme's file: `themes/<name>` in the config folder, with its
// extension made `.toml` (as Rio does).
export function rioThemePath(dir: string, name: string): string {
  const file = `${name.replace(/(\/[^/.]+|^[^/.]+)\.[^./]*$/, '$1')}.toml`
  return file.startsWith('/') ? file : `${dir}/themes/${file}`
}

// The theme names a Rio config uses: `theme`, and both `[adaptive-theme]`
// names when the config has the two.
export function rioThemeNamesOf(config: Readonly<Record<string, string>>): string[] {
  const { theme, 'adaptive-theme.light': light, 'adaptive-theme.dark': dark } = config
  return [...new Set([...(theme ? [theme] : []), ...(light && dark ? [light, dark] : [])])]
}

// Rio's `force-theme`, when it is dark or light.
export const rioForcedOf = (config: Readonly<Record<string, string>>): IuiTheme | null => {
  const v = config['force-theme']
  return v === 'dark' || v === 'light' ? v : null
}

// The background Rio draws. With both `[adaptive-theme]` files found, the one
// for `force-theme`, else for `appearance` (the OS); else the `theme` file's;
// else the config's `[colors] background`. A theme file replaces all the
// config's colours. `themes` holds each file's text by name (null: not found).
export function rioBackgroundOf(config: Readonly<Record<string, string>>, appearance: IuiTheme | null, themes: Readonly<Record<string, string | null>>): { bg: string; detail: string } {
  // #rrggbbaa: the alpha is dropped.
  const opaque = (bg: string) => bg.replace(/^(#?[0-9a-f]{6})[0-9a-f]{2}$/i, '$1')
  const has = (name: string | undefined): name is string => !!name && typeof themes[name] === 'string'
  const bgOf = (name: string) => ({ bg: opaque(tomlStringsOf(themes[name]!)['colors.background'] || RIO_DEFAULT_BG), detail: `theme ${name} background` })
  const { 'adaptive-theme.light': light, 'adaptive-theme.dark': dark, theme } = config
  const which = rioForcedOf(config) ?? appearance
  if (has(light) && has(dark) && which) return bgOf(which === 'dark' ? dark : light)
  if (has(theme)) return bgOf(theme)
  const own = config['colors.background']
  return { bg: opaque(own || RIO_DEFAULT_BG), detail: own ? 'config background' : 'default background' }
}

// Rio's font: `[fonts] family` (it sets every style), else `[fonts.regular]
// family`, else the one Rio carries (also for `cascadiacode`, its default
// name, in any case and spacing: Rio then never looks in the system).
export function rioFontOf(config: Readonly<Record<string, string>>): string {
  const family = (config['fonts.family'] || config['fonts.regular.family'] || '').trim()
  return !family || family.replace(/ /g, '').toLowerCase() === 'cascadiacode' ? RIO_DEFAULT_FONT : family
}

// iTerm2: TERM_PROGRAM says so; with no TERM_PROGRAM (it is not always
// passed on), ITERM_PROFILE, ITERM_SESSION_ID or LC_TERMINAL=iTerm2 say so.
// Another TERM_PROGRAM always wins.
export function isItermIn(env: { program: string; profile?: string; session?: string; lcTerminal?: string }): boolean {
  if (env.program) return /^iTerm/i.test(env.program)
  return !!env.profile || !!env.session || /^iTerm2$/i.test(env.lcTerminal ?? '')
}

// A JSONC file (JSON with // and /* */ comments and trailing commas) as a
// value; null when it is not valid.
export function jsoncOf(text: string): unknown {
  const plain = text
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => (m.startsWith('"') ? m : ''))
    .replace(/"(?:[^"\\]|\\.)*"|,(\s*[}\]])/g, (m, tail?: string) => tail ?? m)
  try {
    return JSON.parse(plain)
  } catch {
    return null
  }
}

export type CmuxAppearance = 'system' | 'light' | 'dark'
// The cmux settings Intelligent UI needs, from cmux.json: `app.appearance` and
// `terminal.adaptiveDefaultTheme` (nested objects, or dotted keys).
export function cmuxSettingsOf(json: unknown): { appearance?: CmuxAppearance; adaptive?: boolean } {
  const at = (path: string): unknown => {
    if (!json || typeof json !== 'object') return undefined
    const flat = (json as Record<string, unknown>)[path]
    if (flat !== undefined) return flat
    let v: unknown = json
    for (const part of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined
    return v
  }
  const appearance = at('app.appearance')
  const adaptive = at('terminal.adaptiveDefaultTheme')
  return {
    ...(appearance === 'system' || appearance === 'light' || appearance === 'dark' ? { appearance } : {}),
    ...(typeof adaptive === 'boolean' ? { adaptive } : {}),
  }
}

// cmux's appearance: cmux.json's value wins over the one saved in Settings
// (`defaults read com.cmuxterm.app appearanceMode`); else system.
export function cmuxAppearanceOf(file: CmuxAppearance | undefined, saved: string): CmuxAppearance {
  const v = saved.trim().toLowerCase()
  return file ?? (v === 'light' || v === 'dark' ? v : 'system')
}

// cmux's own Ghostty config: its themes picker (Settings > Themes, `cmux
// themes`) writes `theme = …` there, and cmux loads it after the Ghostty
// config files. `ghostty +show-config` does not read it.
export const cmuxGhosttyConfigPath = (home: string) => `${home}/Library/Application Support/com.cmuxterm.app/config.ghostty`

// The config cmux draws with: `ghostty +show-config`, then cmux's own config
// (its values win, as the last value of a key does). One theme name there
// becomes `light:X,dark:X`: +show-config did not merge its colours in, so
// ghosttyBackgroundOf reads its background from the theme file.
export function cmuxConfigOf(shown: string, own: string): string {
  if (!own.trim()) return shown
  const theme = ghosttyValueOf(own, 'theme')
  if (!theme || ghosttyThemesOf(theme)) return `${shown}\n${own}`
  return `${shown}\n${own}\ntheme = light:${theme},dark:${theme}`
}

// Whether `ghostty +show-config` shows colours of the user's own (a theme,
// a background, a foreground or a palette). cmux then uses them; else its
// adaptive default theme follows cmux's appearance.
export function ghosttyHasColors(config: string): boolean {
  return ['theme', 'background', 'foreground', 'palette'].some(key => ghosttyValueOf(config, key) !== '')
}
