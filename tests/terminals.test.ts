import { expect, test } from 'claude-code/testing'

import {
  cmuxAppearanceOf, cmuxConfigOf, cmuxGhosttyConfigPath, cmuxSettingsOf, ghosttyBackgroundOf, ghosttyHasColors, ghosttyThemesOf, ghosttyValueOf, isItermIn, jsoncOf,
  KITTY_DEFAULT_BG, kittyAutoFileOf, kittyBackgroundOf, kittyConfigDirsOf, kittyEntriesOf, kittyFontOf, kittyIncludePath, kittyLinesOf,
  kittySchemeOfGnome, kittyValueOf,
  RIO_DEFAULT_BG, RIO_DEFAULT_FONT, rioBackgroundOf, rioConfigDirOf, rioFontOf, rioForcedOf, rioThemeNamesOf, rioThemePath, tomlStringsOf,
} from '../hooks/register'

// ---- kitty ------------------------------------------------------------------

test('kitty config lines: key and value, comments and blank lines skipped, the last value wins', () => {
  const lines = kittyLinesOf('# a comment\n\nfont_family   JetBrains Mono\n  background #1e1e2e  \nbackground #ffffff\n9bad x\nnovalue\n')
  expect(lines).toEqual([['font_family', 'JetBrains Mono'], ['background', '#1e1e2e'], ['background', '#ffffff']])
  expect(kittyValueOf(lines, 'background')).toBe('#ffffff')
  expect(kittyValueOf(lines, 'foreground')).toBe('')
})

test('a kitty include: relative to the file that has it, ~ and ${KITTY_OS} expanded', () => {
  const o = { home: '/h', vars: { KITTY_OS: 'macos' } }
  expect(kittyIncludePath('current-theme.conf', '/h/.config/kitty', o)).toBe('/h/.config/kitty/current-theme.conf')
  expect(kittyIncludePath('themes/x.conf', '/h/.config/kitty/', o)).toBe('/h/.config/kitty/themes/x.conf')
  expect(kittyIncludePath('~/k.conf', '/d', o)).toBe('/h/k.conf')
  expect(kittyIncludePath('/abs/k.conf', '/d', o)).toBe('/abs/k.conf')
  expect(kittyIncludePath('${KITTY_OS}.conf', '/d', o)).toBe('/d/macos.conf')
  expect(kittyIncludePath('$KITTY_OS.conf', '/d', o)).toBe('/d/macos.conf')
  expect(kittyIncludePath('${UNKNOWN}.conf', '/d', o)).toBe('/d/${UNKNOWN}.conf')
})

test('kitty includes are read in place, each file once (no loops); other include kinds are skipped', async () => {
  const files: Record<string, string> = {
    '/k/kitty.conf': 'background #111111\ninclude current-theme.conf\nglobinclude kitty.d/*.conf\nfont_size 12\ninclude sub/a.conf\n',
    '/k/current-theme.conf': 'background #eeeeee\n',
    '/k/sub/a.conf': 'include b.conf\ninclude /k/kitty.conf\n',
    '/k/sub/b.conf': 'foreground #000000\ninclude a.conf\n',
  }
  const read: string[] = []
  const entries = await kittyEntriesOf('/k/kitty.conf', async p => (read.push(p), files[p] ?? null), { home: '/h' })
  expect(entries).toEqual([['background', '#111111'], ['background', '#eeeeee'], ['globinclude', 'kitty.d/*.conf'], ['font_size', '12'], ['foreground', '#000000']])
  expect(read).toEqual(['/k/kitty.conf', '/k/current-theme.conf', '/k/sub/a.conf', '/k/sub/b.conf'])
  expect(kittyValueOf(entries, 'background')).toBe('#eeeeee')
  // A missing file is nothing.
  expect(await kittyEntriesOf('/none', async () => null, { home: '/h' })).toEqual([])
})

test('kitty reads at most 32 files; a chain of includes stops there', async () => {
  const read: string[] = []
  const entries = await kittyEntriesOf('/k/0.conf', async p => {
    read.push(p)
    const n = Number(/(\d+)\.conf$/.exec(p)![1])
    return `font_size ${n}\ninclude ${n + 1}.conf\n`
  }, { home: '/h' })
  expect(read.length).toBe(32)
  expect(entries.length).toBe(32)
  expect(kittyValueOf(entries, 'font_size')).toBe('31')
})

test('kitty config lines: tabs and indents split the key, a key needs a letter first, # lines are comments even when indented', () => {
  expect(kittyLinesOf('\tbackground\t#101010\n   # background #ffffff\n1x y\nforeground#000')).toEqual([['background', '#101010']])
})

test('a kitty include of ~ alone is the home folder, and a trailing-slash folder gets one slash', () => {
  expect(kittyIncludePath('~', '/d', { home: '/h' })).toBe('/h')
  expect(kittyIncludePath('a.conf', '/d//', { home: '/h' })).toBe('/d/a.conf')
  expect(kittyIncludePath('  b.conf  ', '/d', { home: '/h' })).toBe('/d/b.conf')
})

test('kitty config folders: KITTY_CONFIG_DIRECTORY alone, else XDG, ~/.config, and on macOS ~/Library/Preferences', () => {
  expect(kittyConfigDirsOf({ kittyDir: '/x', xdgConfig: '/xdg', home: '/h', isMac: true })).toEqual(['/x'])
  expect(kittyConfigDirsOf({ home: '/h', isMac: false })).toEqual(['/h/.config/kitty'])
  expect(kittyConfigDirsOf({ xdgConfig: '/xdg', home: '/h', isMac: true })).toEqual(['/xdg/kitty', '/h/.config/kitty', '/h/Library/Preferences/kitty'])
  expect(kittyConfigDirsOf({ xdgConfig: '/h/.config', home: '/h', isMac: false })).toEqual(['/h/.config/kitty'])
})

test('kitty font_family: a family, family="…" style=…, postscript_name=…, or the system font', () => {
  expect(kittyFontOf('JetBrains Mono')).toEqual({ family: 'JetBrains Mono' })
  expect(kittyFontOf('family="JetBrains Mono" style=Light')).toEqual({ family: 'JetBrains Mono' })
  expect(kittyFontOf("family='Fira Code' features=+zero")).toEqual({ family: 'Fira Code' })
  expect(kittyFontOf('family=Iosevka')).toEqual({ family: 'Iosevka' })
  expect(kittyFontOf('postscript_name=FiraCode-Retina')).toEqual({ postscript: 'FiraCode-Retina' })
  expect(kittyFontOf('monospace')).toBe(null)
  expect(kittyFontOf('auto')).toBe(null)
  expect(kittyFontOf('family=monospace')).toBe(null)
  expect(kittyFontOf('')).toBe(null)
})

test('kitty auto themes: the file for the OS scheme, GNOME default is no preference', () => {
  expect(kittyAutoFileOf('dark')).toBe('dark-theme.auto.conf')
  expect(kittyAutoFileOf('no-preference')).toBe('no-preference-theme.auto.conf')
  expect(kittySchemeOfGnome("'prefer-dark'\n")).toBe('dark')
  expect(kittySchemeOfGnome("'prefer-light'")).toBe('light')
  expect(kittySchemeOfGnome("'default'")).toBe('no-preference')
  expect(kittySchemeOfGnome('')).toBe(null)
})

test("kitty's background: the auto theme's, else kitty.conf's, else #000000", () => {
  const conf: [string, string][] = [['background', '#fafafa']]
  expect(kittyBackgroundOf(conf, null)).toEqual({ bg: '#fafafa', detail: 'config background' })
  expect(kittyBackgroundOf([], null)).toEqual({ bg: KITTY_DEFAULT_BG, detail: 'default background' })
  expect(kittyBackgroundOf(conf, { file: 'dark-theme.auto.conf', entries: [['background', '#1e1e2e']] })).toEqual({ bg: '#1e1e2e', detail: 'dark-theme.auto.conf background' })
  // The auto file resets colours to kitty's defaults first.
  expect(kittyBackgroundOf(conf, { file: 'light-theme.auto.conf', entries: [] }).bg).toBe(KITTY_DEFAULT_BG)
})

// ---- Rio --------------------------------------------------------------------

test('the TOML reader: tables, dotted and quoted keys, strings, inline tables, comments', () => {
  const toml = [
    '# Rio',
    'theme = "dracula" # a comment',
    "force-theme = 'light'",
    'line-height = 1.2',
    'confirm-before-quit = true',
    '[fonts]',
    'size = 14',
    'family = "Iosevka Term"',
    '[fonts.regular]',
    'family = "JetBrains Mono"',
    'style = "Normal"',
    '[ "adaptive-theme" ]',
    'light = "belafonte-day"',
    'dark = "belafonte-night"',
    '[colors]',
    'background = "#0F0D0E"',
    'say = "a \\"b\\""',
    '[navigation]',
    'mode = "Tab"',
    'bold = { family = "X Bold", style = \'Bold\' }',
    'renderer.backend = "Metal"',
  ].join('\n')
  const v = tomlStringsOf(toml)
  expect(v.theme).toBe('dracula')
  expect(v['force-theme']).toBe('light')
  expect(v['line-height']).toBe(undefined)
  expect(v['confirm-before-quit']).toBe(undefined)
  expect(v['fonts.family']).toBe('Iosevka Term')
  expect(v['fonts.size']).toBe(undefined)
  expect(v['fonts.regular.family']).toBe('JetBrains Mono')
  expect(v['adaptive-theme.light']).toBe('belafonte-day')
  expect(v['adaptive-theme.dark']).toBe('belafonte-night')
  expect(v['colors.background']).toBe('#0F0D0E')
  expect(v['colors.say']).toBe('a "b"')
  expect(v['navigation.bold.family']).toBe('X Bold')
  expect(v['navigation.bold.style']).toBe('Bold')
  expect(v['navigation.renderer.backend']).toBe('Metal')
})

test('the TOML reader: array tables count as tables, numbers and arrays are skipped, a bad line is skipped', () => {
  const v = tomlStringsOf(['[[keyboard.bindings]]', 'key = "q"', 'with = \'literal \\n\'', 'list = ["a", "b"]', 'not a line', '= "x"', 'ok = "y" # c'].join('\n'))
  expect(v).toEqual({ 'keyboard.bindings.key': 'q', 'keyboard.bindings.with': 'literal \\n', 'keyboard.bindings.ok': 'y' })
  expect(tomlStringsOf('')).toEqual({})
})

test('Rio config folder and theme files', () => {
  expect(rioConfigDirOf({ rioHome: '/r', xdgConfig: '/xdg', home: '/h', isMac: false })).toBe('/r')
  expect(rioConfigDirOf({ xdgConfig: '/xdg', home: '/h', isMac: false })).toBe('/xdg/rio')
  // macOS: no XDG.
  expect(rioConfigDirOf({ xdgConfig: '/xdg', home: '/h', isMac: true })).toBe('/h/.config/rio')
  expect(rioConfigDirOf({ home: '/h', isMac: false })).toBe('/h/.config/rio')
  expect(rioThemePath('/c', 'dracula')).toBe('/c/themes/dracula.toml')
  expect(rioThemePath('/c', 'dracula.toml')).toBe('/c/themes/dracula.toml')
  expect(rioThemePath('/c', 'sub/x')).toBe('/c/themes/sub/x.toml')
  expect(rioThemePath('/c', '/abs/t')).toBe('/abs/t.toml')
  expect(rioThemeNamesOf({ theme: 'a', 'adaptive-theme.light': 'l', 'adaptive-theme.dark': 'd' })).toEqual(['a', 'l', 'd'])
  expect(rioThemeNamesOf({ 'adaptive-theme.light': 'l' })).toEqual([])
  expect(rioForcedOf({ 'force-theme': 'dark' })).toBe('dark')
  expect(rioForcedOf({ 'force-theme': 'auto' })).toBe(null)
})

test("Rio's background: adaptive theme (force-theme, else the OS), else theme, else [colors], else the default", () => {
  const themes = { day: '[colors]\nbackground = "#FFFFFF"\n', night: '[colors]\nbackground = "#191724"\n', plain: '[colors]\nforeground = "#000000"\n', gone: null }
  const adaptive = { theme: 'night', 'adaptive-theme.light': 'day', 'adaptive-theme.dark': 'night', 'colors.background': '#ffffff' }
  expect(rioBackgroundOf(adaptive, 'light', themes)).toEqual({ bg: '#FFFFFF', detail: 'theme day background' })
  expect(rioBackgroundOf(adaptive, 'dark', themes)).toEqual({ bg: '#191724', detail: 'theme night background' })
  expect(rioBackgroundOf({ ...adaptive, 'force-theme': 'dark' }, 'light', themes).detail).toBe('theme night background')
  // The OS not known: the plain theme.
  expect(rioBackgroundOf(adaptive, null, themes).detail).toBe('theme night background')
  // One adaptive file missing: adaptive is off.
  expect(rioBackgroundOf({ ...adaptive, 'adaptive-theme.light': 'gone' }, 'light', themes).detail).toBe('theme night background')
  // A theme with no background: Rio's default (the config's colours are replaced).
  expect(rioBackgroundOf({ theme: 'plain', 'colors.background': '#ffffff' }, null, themes)).toEqual({ bg: RIO_DEFAULT_BG, detail: 'theme plain background' })
  // A theme not found: the config's colours.
  expect(rioBackgroundOf({ theme: 'gone', 'colors.background': '#ffffff80' }, null, themes)).toEqual({ bg: '#ffffff', detail: 'config background' })
  expect(rioBackgroundOf({}, 'light', themes)).toEqual({ bg: RIO_DEFAULT_BG, detail: 'default background' })
})

test("Rio's font: [fonts] family, else [fonts.regular] family, else the Cascadia Code NF it carries", () => {
  expect(rioFontOf({ 'fonts.family': 'Iosevka', 'fonts.regular.family': 'JetBrains Mono' })).toBe('Iosevka')
  expect(rioFontOf({ 'fonts.regular.family': 'JetBrains Mono' })).toBe('JetBrains Mono')
  // The family name of the font in Rio's program, as Typst lists it.
  expect(RIO_DEFAULT_FONT).toBe('Cascadia Code NF')
  expect(rioFontOf({})).toBe(RIO_DEFAULT_FONT)
  // Rio's default name, in any case and spacing, is always its own font.
  for (const family of ['cascadiacode', 'Cascadia Code', 'CASCADIA CODE ']) expect(rioFontOf({ 'fonts.family': family })).toBe(RIO_DEFAULT_FONT)
  expect(rioFontOf({ 'fonts.family': 'Cascadia Mono' })).toBe('Cascadia Mono')
})

// ---- iTerm2 and cmux ------------------------------------------------------------

test('iTerm2: TERM_PROGRAM, else (no TERM_PROGRAM) ITERM_PROFILE, ITERM_SESSION_ID or LC_TERMINAL', () => {
  expect(isItermIn({ program: 'iTerm.app' })).toBe(true)
  expect(isItermIn({ program: '', profile: 'Default' })).toBe(true)
  expect(isItermIn({ program: '', session: 'w0t0p0:ABC' })).toBe(true)
  expect(isItermIn({ program: '', lcTerminal: 'iTerm2' })).toBe(true)
  expect(isItermIn({ program: '' })).toBe(false)
  expect(isItermIn({ program: '', lcTerminal: 'other' })).toBe(false)
  // Another terminal started from iTerm2 keeps its variables: TERM_PROGRAM wins.
  expect(isItermIn({ program: 'ghostty', profile: 'Default', lcTerminal: 'iTerm2' })).toBe(false)
})

test('JSONC: comments and trailing commas go, strings stay', () => {
  const text = '{\n  "$schema": "https://x/y.json", // a comment\n  /* block\n  */ "app": { "appearance": "light", },\n  "s": "a // b /* c */",\n}'
  expect(jsoncOf(text)).toEqual({ $schema: 'https://x/y.json', app: { appearance: 'light' }, s: 'a // b /* c */' })
  expect(jsoncOf('{ bad')).toBe(null)
  expect(jsoncOf('')).toBe(null)
})

test("cmux settings: app.appearance and terminal.adaptiveDefaultTheme, nested or dotted; the file's appearance wins", () => {
  expect(cmuxSettingsOf({ app: { appearance: 'dark' }, terminal: { adaptiveDefaultTheme: false } })).toEqual({ appearance: 'dark', adaptive: false })
  expect(cmuxSettingsOf({ 'app.appearance': 'light' })).toEqual({ appearance: 'light' })
  expect(cmuxSettingsOf({ app: { appearance: 'blue' }, terminal: { adaptiveDefaultTheme: 'yes' } })).toEqual({})
  expect(cmuxSettingsOf(null)).toEqual({})
  expect(cmuxAppearanceOf(undefined, 'dark\n')).toBe('dark')
  expect(cmuxAppearanceOf(undefined, 'system\n')).toBe('system')
  expect(cmuxAppearanceOf(undefined, '')).toBe('system')
  expect(cmuxAppearanceOf('light', 'dark')).toBe('light')
})

test('cmux appearance: the saved value is read in any case, a word it does not know is system', () => {
  expect(cmuxAppearanceOf(undefined, ' Light\n')).toBe('light')
  expect(cmuxAppearanceOf(undefined, 'DARK')).toBe('dark')
  expect(cmuxAppearanceOf(undefined, 'sepia')).toBe('system')
  expect(cmuxSettingsOf({ 'terminal.adaptiveDefaultTheme': true })).toEqual({ adaptive: true })
  expect(cmuxSettingsOf({ app: 'x', terminal: null })).toEqual({})
  expect(cmuxSettingsOf([])).toEqual({})
})

test('JSONC: a comment marker inside a string stays, an unclosed block comment is not valid, a trailing comma in an array goes', () => {
  expect(jsoncOf('{"u": "http://x/y", "a": [1, 2,],}')).toEqual({ u: 'http://x/y', a: [1, 2] })
  expect(jsoncOf('{"a": 1 /* open')).toBe(null)
  expect(jsoncOf('// only a comment')).toBe(null)
  expect(jsoncOf('{"a": "x,}"}')).toEqual({ a: 'x,}' })
})

test('Ghostty colours of your own: a theme, background, foreground or palette', () => {
  expect(ghosttyHasColors('font-family = Menlo\n')).toBe(false)
  expect(ghosttyHasColors('theme = Night\n')).toBe(true)
  expect(ghosttyHasColors('background = #ffffff\n')).toBe(true)
  expect(ghosttyHasColors('foreground = #000000\n')).toBe(true)
  expect(ghosttyHasColors('palette = 0=#000000\n')).toBe(true)
})

test("cmux's own Ghostty config: its theme wins; one theme name becomes a light:dark pair", () => {
  expect(cmuxGhosttyConfigPath('/Users/me')).toBe('/Users/me/Library/Application Support/com.cmuxterm.app/config.ghostty')
  const shown = 'font-family = Menlo\n'
  expect(cmuxConfigOf(shown, '')).toBe(shown)
  expect(cmuxConfigOf(shown, '  \n')).toBe(shown)
  const block = (theme: string) => `# cmux themes start\ntheme = ${theme}\n# cmux themes end\n`
  // A pair as written.
  const pair = cmuxConfigOf(shown, block('light:Apple System Colors Light,dark:Dracula'))
  expect(ghosttyThemesOf(ghosttyValueOf(pair, 'theme'))).toEqual({ light: 'Apple System Colors Light', dark: 'Dracula' })
  expect(ghosttyHasColors(pair)).toBe(true)
  // One name: both modes, so the background comes from the theme file.
  const one = cmuxConfigOf(shown, block('Dracula'))
  expect(ghosttyThemesOf(ghosttyValueOf(one, 'theme'))).toEqual({ light: 'Dracula', dark: 'Dracula' })
  expect(ghosttyBackgroundOf(one, 'light', { light: '#282a36', dark: '#282a36' })).toBe('#282a36')
  // Over the Ghostty config's theme.
  const over = cmuxConfigOf('theme = Night\nbackground = #000000\n', block('light:A,dark:B'))
  expect(ghosttyValueOf(over, 'theme')).toBe('light:A,dark:B')
  // No theme there: the Ghostty config as shown, with its other values.
  expect(ghosttyHasColors(cmuxConfigOf(shown, 'font-size = 13\n'))).toBe(false)
})
