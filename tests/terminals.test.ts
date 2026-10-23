import { expect, test } from 'claude-code/testing'

import {
  cmuxAppearanceOf, cmuxConfigOf, cmuxGhosttyConfigPath, cmuxSettingsOf, envOfText, ghosttyBackgroundOf, ghosttyHasColors, ghosttyThemesOf, ghosttyValueOf,
  clientFrontKindOf, frontKindOf, herdrClientChanged, herdrClientOf, herdrClientsOf, herdrHostOf, herdrText, herdrTickOf, herdrTickPick, pickHerdrClient, ttyNameOf, type HerdrClient, isHerdrIn, isItermIn, jsoncOf, keptOsc11, needsSetup, OSC11_MISSES, outerKindOf, type HostMode,
  KITTY_DEFAULT_BG, kittyAutoFileOf, kittyBackgroundOf, kittyConfigDirsOf, kittyEntriesOf, kittyFontOf, kittyIncludePath, kittyLinesOf,
  kittySchemeOfGnome, kittyValueOf,
  RIO_DEFAULT_BG, RIO_DEFAULT_FONT, rioBackgroundOf, rioConfigDirOf, rioFontOf, rioForcedOf, rioThemeNamesOf, rioThemePath, tomlStringsOf,
} from '../hooks/register'
import { HERDR_SCAN_MS } from '../hooks/lib/settings'

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

// ---- herdr ----------------------------------------------------------------------

test('herdr: TERM_PROGRAM, else (no TERM_PROGRAM) HERDR_ENV; another TERM_PROGRAM wins', () => {
  expect(isHerdrIn({ program: 'herdr' })).toBe(true)
  expect(isHerdrIn({ program: 'Herdr', herdrEnv: '1' })).toBe(true)
  expect(isHerdrIn({ program: '', herdrEnv: '1' })).toBe(true)
  expect(isHerdrIn({ program: '', herdrEnv: '0' })).toBe(false)
  expect(isHerdrIn({ program: '' })).toBe(false)
  expect(isHerdrIn({ program: 'iTerm.app' })).toBe(false)
  // tmux in a herdr pane, or a terminal started from one.
  expect(isHerdrIn({ program: 'tmux', herdrEnv: '1' })).toBe(false)
  expect(isHerdrIn({ program: 'ghostty', herdrEnv: '1' })).toBe(false)
})

test("herdr's terminal: Ghostty, then kitty, then iTerm2, by the variables of the terminal that started it", () => {
  expect(herdrHostOf({})).toBe('')
  expect(herdrHostOf({ ghosttyResources: '/Applications/Ghostty.app/Contents/Resources/ghostty' })).toBe('ghostty')
  expect(herdrHostOf({ ghosttyBin: '/Applications/Ghostty.app/Contents/MacOS' })).toBe('ghostty')
  expect(herdrHostOf({ kittyPid: '123' })).toBe('kitty')
  expect(herdrHostOf({ kittyDir: '/Applications/kitty.app/Contents/Resources/kitty' })).toBe('kitty')
  expect(herdrHostOf({ itermProfile: 'Default' })).toBe('iterm')
  expect(herdrHostOf({ ghosttyResources: '/g', kittyPid: '1', itermProfile: 'Default' })).toBe('ghostty')
  expect(herdrHostOf({ kittyPid: '1', itermProfile: 'Default' })).toBe('kitty')
  expect(herdrHostOf({ ghosttyResources: '', kittyPid: '', itermProfile: '' })).toBe('')
})

test('herdr in /iui details: its version, its terminal and where that came from', () => {
  expect(herdrText('0.9.5', 'kitty', 'client')).toBe('herdr 0.9.5 (in kitty, the client you used last)')
  expect(herdrText('0.9.5', 'ghostty')).toBe("herdr 0.9.5 (in Ghostty, from the server's start)")
  expect(herdrText('0.9.5', 'ghostty', 'server')).toBe("herdr 0.9.5 (in Ghostty, from the server's start)")
  expect(herdrText('', 'iterm', 'client')).toBe('herdr (in iTerm2, the client you used last)')
  expect(herdrText('', 'cmux', 'client')).toBe('herdr (in cmux, the client you used last)')
  expect(herdrText('', 'rio', 'client')).toBe('herdr (in Rio, the client you used last)')
  expect(herdrText('0.9.5', 'ghostty', 'front')).toBe('herdr 0.9.5 (in Ghostty, the terminal in front)')
  expect(herdrText('', '', 'client')).toBe('herdr (outer terminal not known)')
  expect(herdrText('', '')).toBe('herdr (outer terminal not known)')
})

test("herdr's terminal from the server's variables: cmux first", () => {
  expect(herdrHostOf({ cmux: true, ghosttyResources: '/g' })).toBe('cmux')
  expect(herdrHostOf({ cmux: false, ghosttyResources: '/g' })).toBe('ghostty')
})

// The output of HERDR_CLIENT_SH, as measured on a Mac (kitty and Ghostty
// clients of one herdr server) and on Linux.
const KITTY_MAC = [
  'pid 54346', 'atime 1792712692', 'tty ttys021', 'cmd /Users/u/.local/bin/herdr',
  'app /Applications/kitty.app/Contents/MacOS/kitty /Users/u/.local/bin/herdr', 'env',
  '/Users/u/.local/bin/herdr USER=u __CFBundleIdentifier=net.kovidgoyal.kitty PATH=/Applications/kitty.app/Contents/MacOS:/usr/bin:/bin HOME=/Users/u ' +
    'SHELL=/bin/zsh LANG=en_US.UTF-8 KITTY_WINDOW_ID=1 TERM=xterm-kitty COLORTERM=truecolor KITTY_PID=54120 ' +
    'KITTY_INSTALLATION_DIR=/Applications/kitty.app/Contents/Resources/kitty',
  '',
].join('\n')
const GHOSTTY_MAC = [
  'pid 50390', 'atime 1792712644', 'tty ttys012', 'cmd herdr', 'app /Applications/Ghostty.app/Contents/MacOS/ghostty -e /Users/u/.local/bin/herdr', 'env',
  'herdr USER=u GHOSTTY_BIN_DIR=/Applications/Ghostty.app/Contents/MacOS TERM=xterm-ghostty TERM_PROGRAM=ghostty TERM_PROGRAM_VERSION=1.3.1 ' +
    'GHOSTTY_RESOURCES_DIR=/Applications/Ghostty.app/Contents/Resources/ghostty COLORFGBG=15;0',
  '',
].join('\n')

test('a herdr client on macOS (ps eww): its command is not a variable, its variables are whole', () => {
  const kitty = herdrClientOf(KITTY_MAC)!
  expect(kitty).toMatchObject({ pid: 54346, atime: 1792712692, tty: 'ttys021', cmd: '/Users/u/.local/bin/herdr', kind: 'kitty' })
  expect(kitty.env.TERM).toBe('xterm-kitty')
  expect(kitty.env.KITTY_INSTALLATION_DIR).toBe('/Applications/kitty.app/Contents/Resources/kitty')
  expect(kitty.env.USER).toBe('u')
  expect(Object.keys(kitty.env).some(k => k.includes('herdr'))).toBe(false)
  const ghostty = herdrClientOf(GHOSTTY_MAC)!
  expect(ghostty).toMatchObject({ pid: 50390, kind: 'ghostty', cmd: 'herdr' })
  expect(ghostty.env.GHOSTTY_BIN_DIR).toBe('/Applications/Ghostty.app/Contents/MacOS')
  expect(ghostty.env.COLORFGBG).toBe('15;0')
})

test('ps eww text: a value with spaces stays whole; the arguments (--session x) are not variables', () => {
  const ps = 'herdr --session work ITERM_PROFILE=My Dark Profile TERM_PROGRAM=iTerm.app PATH=/a b/bin:/c X=a=b'
  const env = { ITERM_PROFILE: 'My Dark Profile', TERM_PROGRAM: 'iTerm.app', PATH: '/a b/bin:/c', X: 'a=b' }
  expect(envOfText(ps, 'herdr --session work')).toEqual(env)
  // The command not known: its first word goes.
  expect(envOfText(`${ps}\n`, '')).toEqual(env)
  expect(envOfText('herdr', 'herdr')).toEqual({})
  expect(envOfText('', '')).toEqual({})
  const iterm = herdrClientOf(['pid 7', 'atime 5', 'tty ttys003', 'cmd herdr --session work', 'app /Applications/iTerm.app/Contents/MacOS/iTermServer-3.5.10 x', 'env', ps].join('\n'))!
  expect(iterm.kind).toBe('iterm')
  expect(iterm.env.ITERM_PROFILE).toBe('My Dark Profile')
})

test('a herdr client on Linux (/proc/<pid>/environ): NUL-separated variables; a value can hold = and newlines', () => {
  const out = 'pid 4242\natime 1792700000\ntty pts/3\ncmd herdr session attach work\napp /usr/bin/kitty\nenv\n' +
    'TERM=xterm-kitty\0KITTY_CONFIG_DIRECTORY=/home/u/kc\0A=b=c\0B=one\ntwo\0'
  const c = herdrClientOf(out)!
  expect(c).toMatchObject({ pid: 4242, tty: 'pts/3', kind: 'kitty', app: '/usr/bin/kitty' })
  expect(c.env).toEqual({ TERM: 'xterm-kitty', KITTY_CONFIG_DIRECTORY: '/home/u/kc', A: 'b=c', B: 'one\ntwo' })
})

test('no herdr client: no output, no pid or no env line is null; no variables read gives the app', () => {
  expect(herdrClientOf('')).toBeNull()
  expect(herdrClientOf('pid x\nenv\nTERM=xterm-kitty')).toBeNull()
  expect(herdrClientOf('pid 12\natime 3\ntty ttys001')).toBeNull()
  const bare = herdrClientOf('pid 12\natime 3\ntty ttys001\ncmd herdr\napp /Applications/Ghostty.app/Contents/MacOS/ghostty\nenv\n')!
  expect(bare.kind).toBe('ghostty')
  // Ghostty with no GHOSTTY_BIN_DIR: its app's folder (GHOSTTY_SH runs that ghostty).
  expect(bare.env).toEqual({ GHOSTTY_BIN_DIR: '/Applications/Ghostty.app/Contents/MacOS' })
})

test("a client's terminal: its app first, then TERM, TERM_PROGRAM and the terminals' variables", () => {
  // kitty started from a Ghostty shell keeps Ghostty's variables: the app (or TERM) says kitty.
  const fromGhostty = { TERM: 'xterm-kitty', TERM_PROGRAM: 'ghostty', GHOSTTY_RESOURCES_DIR: '/g', KITTY_WINDOW_ID: '1' }
  expect(outerKindOf(fromGhostty, '/Applications/kitty.app/Contents/MacOS/kitty')).toBe('kitty')
  expect(outerKindOf(fromGhostty, '')).toBe('kitty')
  expect(outerKindOf({ TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty', KITTY_PID: '9' }, '')).toBe('ghostty')
  expect(outerKindOf({ TERM: 'xterm-ghostty', CMUX_SURFACE_ID: 's' }, '')).toBe('cmux')
  expect(outerKindOf({}, '/Applications/cmux.app/Contents/MacOS/cmux')).toBe('cmux')
  expect(outerKindOf({ TERM_PROGRAM: 'rio' }, '')).toBe('rio')
  expect(outerKindOf({}, '/Applications/rio.app/Contents/MacOS/rio')).toBe('rio')
  expect(outerKindOf({}, '/usr/bin/rio')).toBe('rio')
  expect(outerKindOf({ TERM_PROGRAM: 'iTerm.app' }, '')).toBe('iterm')
  expect(outerKindOf({ LC_TERMINAL: 'iTerm2' }, '')).toBe('iterm')
  expect(outerKindOf({ KITTY_WINDOW_ID: '2' }, '')).toBe('kitty')
  expect(outerKindOf({ GHOSTTY_BIN_DIR: '/b' }, '')).toBe('ghostty')
  // Another terminal (WezTerm) with kitty's variables of the shell that started it: not known.
  expect(outerKindOf({ TERM_PROGRAM: 'WezTerm', KITTY_PID: '9' }, '/Applications/WezTerm.app/Contents/MacOS/wezterm-gui')).toBe('')
  expect(outerKindOf({}, '')).toBe('')
  // An app bundle with spaces in its folder; arguments do not count.
  expect(outerKindOf({}, '/Applications/My Apps/Ghostty.app/Contents/MacOS/ghostty -e herdr')).toBe('ghostty')
  expect(outerKindOf({}, '/usr/bin/foot /Applications/kitty.app/x')).toBe('')
})

test('a change of herdr client: another terminal, profile or config counts; another window of the same does not', () => {
  const kitty = herdrClientOf(KITTY_MAC)!
  const ghostty = herdrClientOf(GHOSTTY_MAC)!
  expect(herdrClientChanged(null, null)).toBe(false)
  expect(herdrClientChanged(null, kitty)).toBe(true)
  expect(herdrClientChanged(kitty, ghostty)).toBe(true)
  expect(herdrClientChanged(kitty, { ...kitty, pid: 1, atime: 2, tty: 'ttys001', env: { ...kitty.env, KITTY_WINDOW_ID: '7', KITTY_PID: '1' } })).toBe(false)
  expect(herdrClientChanged(kitty, { ...kitty, env: { ...kitty.env, KITTY_CONFIG_DIRECTORY: '/other' } })).toBe(true)
  const iterm = { ...kitty, kind: 'iterm' as const, env: { ITERM_PROFILE: 'Dark' } }
  expect(herdrClientChanged(iterm, { ...iterm, env: { ITERM_PROFILE: 'Light' } })).toBe(true)
  expect(herdrClientChanged(ghostty, { ...ghostty, env: { ...ghostty.env, COLORFGBG: '0;15' } })).toBe(true)
})

test("herdr's OSC 11: a missed answer keeps the last one until OSC11_MISSES polls in a row miss", () => {
  expect(OSC11_MISSES).toBe(3)
  const light: HostMode = { mode: 'light', source: 'herdr' }
  const dark: HostMode = { mode: 'dark', source: 'herdr' }
  expect(keptOsc11(null, null)).toEqual({ kept: null, use: null })
  let step = keptOsc11(null, light)
  expect(step).toEqual({ kept: { seen: light, misses: 0 }, use: light })
  step = keptOsc11(step.kept, null)
  expect(step).toEqual({ kept: { seen: light, misses: 1 }, use: light })
  step = keptOsc11(step.kept, null)
  expect(step).toEqual({ kept: { seen: light, misses: 2 }, use: light })
  // The third miss in a row: the other sources count.
  expect(keptOsc11(step.kept, null)).toEqual({ kept: null, use: null })
  // An answer starts again from 0.
  step = keptOsc11(keptOsc11(step.kept, dark).kept, null)
  expect(step).toEqual({ kept: { seen: dark, misses: 1 }, use: dark })
})

test('/iui setup is offered in iTerm2 on a Mac and in herdr (macOS or Linux), with pictures off, not in ssh, tmux, screen or a background session', () => {
  const off = { iterm: false, herdr: false, draws: false, ssh: false, os: 'Darwin', tmux: false, background: false }
  expect(needsSetup({ ...off, iterm: true })).toBe(true)
  expect(needsSetup({ ...off, iterm: true, os: 'Linux' })).toBe(false)
  expect(needsSetup({ ...off, herdr: true })).toBe(true)
  expect(needsSetup({ ...off, herdr: true, os: 'Linux' })).toBe(true)
  expect(needsSetup(off)).toBe(false)
  for (const no of [{ draws: true }, { ssh: true }, { tmux: true }, { background: true }]) {
    expect(needsSetup({ ...off, herdr: true, ...no })).toBe(false)
    expect(needsSetup({ ...off, iterm: true, ...no })).toBe(false)
  }
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

// HERDR_CLIENT_SH on a Mac with an iTerm2 and a Ghostty client (measured):
// iTerm2's tty read last (its answers to herdr's picture uploads), Ghostty in front.
const ITERM_MAC = [
  'pid 57693', 'atime 1792718368.016685000', 'tty ttys012', 'cmd /Users/u/.local/bin/herdr',
  'app /Users/u/Library/Application Support/iTerm2/iTermServer-3.7.6 /Users/u/Library/Application Support/iTerm2/iterm2-daemon-2.socket', 'env',
  '/Users/u/.local/bin/herdr TERM_PROGRAM=iTerm.app TERM=xterm-256color TERM_PROGRAM_VERSION=3.7.6 ITERM_PROFILE=Default COLORFGBG=7;0',
  '',
].join('\n')
const GHOSTTY_MAC2 = GHOSTTY_MAC.replace('atime 1792712644', 'atime 1792718338.716905000')

test('the output of all herdr clients: the app in front, then each client from its pid line', () => {
  const both = herdrClientsOf(`front com.mitchellh.ghostty\n${ITERM_MAC}${GHOSTTY_MAC2}`)
  expect(both.front).toBe('com.mitchellh.ghostty')
  expect(both.clients.map(c => [c.pid, c.kind, c.atime])).toEqual([[57693, 'iterm', 1792718368.016685], [50390, 'ghostty', 1792718338.716905]])
  expect(both.clients[0]!.env.ITERM_PROFILE).toBe('Default')
  expect(both.clients[1]!.env.COLORFGBG).toBe('15;0')
  // No front line (Linux, or lsappinfo failed): null. One client of the old output parses.
  expect(herdrClientsOf(KITTY_MAC)).toMatchObject({ front: null, clients: [{ pid: 54346, kind: 'kitty' }] })
  expect(herdrClientsOf('')).toEqual({ front: null, clients: [] })
  expect(herdrClientsOf('front com.apple.Safari\n')).toEqual({ front: 'com.apple.Safari', clients: [] })
  // Linux: NUL-separated variables, then a new line before the next client.
  const linux = herdrClientsOf('pid 1\natime 5\ntty pts/1\ncmd herdr\napp /usr/bin/kitty\nenv\nTERM=xterm-kitty\0\npid 2\natime 9\ntty pts/2\ncmd herdr\napp /usr/bin/ghostty\nenv\nTERM=xterm-ghostty\0\n')
  expect(linux.clients.map(c => [c.pid, c.kind, c.env.TERM])).toEqual([[1, 'kitty', 'xterm-kitty'], [2, 'ghostty', 'xterm-ghostty']])
})

test('the app in front: its bundle id as a terminal kind; another app is none', () => {
  expect(frontKindOf('com.mitchellh.ghostty')).toBe('ghostty')
  expect(frontKindOf('net.kovidgoyal.kitty')).toBe('kitty')
  expect(frontKindOf('com.googlecode.iterm2')).toBe('iterm')
  expect(frontKindOf('com.cmuxterm.app')).toBe('cmux')
  expect(frontKindOf('com.github.wez.wezterm')).toBe('wezterm')
  expect(frontKindOf('com.raphaelamorim.rio')).toBe('rio')
  expect(frontKindOf('com.apple.Terminal')).toBe('terminal')
  expect(frontKindOf('com.apple.Safari')).toBe('')
  expect(frontKindOf('')).toBe('')
  const base = herdrClientOf(GHOSTTY_MAC)!
  expect(clientFrontKindOf(base)).toBe('ghostty')
  expect(clientFrontKindOf({ ...base, kind: '', app: '/Applications/WezTerm.app/Contents/MacOS/wezterm-gui start' })).toBe('wezterm')
  expect(clientFrontKindOf({ ...base, kind: '', app: '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal' })).toBe('terminal')
  expect(clientFrontKindOf({ ...base, kind: '', app: '/usr/sbin/sshd' })).toBe('')
})

test('the herdr client to follow: the terminal in front first, then the tty read last', () => {
  const iterm = herdrClientOf(ITERM_MAC)!
  const ghostty = herdrClientOf(GHOSTTY_MAC2)!
  const ghostty2: HerdrClient = { ...ghostty, pid: 50391, atime: ghostty.atime + 1 }
  const kitty = herdrClientOf(KITTY_MAC)!
  // iTerm2's tty read last (picture uploads), but Ghostty in front: Ghostty.
  expect(pickHerdrClient([iterm, ghostty], 'ghostty', null)).toEqual({ client: ghostty, by: 'front' })
  expect(pickHerdrClient([iterm, ghostty], 'iterm', ghostty)).toEqual({ client: iterm, by: 'front' })
  // Two clients of the app in front: the tty read last of them.
  expect(pickHerdrClient([iterm, ghostty, ghostty2], 'ghostty', null)).toEqual({ client: ghostty2, by: 'front' })
  // No client in the app in front (a browser, or a terminal with no client): the client of before stays, as read now.
  expect(pickHerdrClient([iterm, ghostty], '', ghostty)).toEqual({ client: ghostty, by: 'kept' })
  expect(pickHerdrClient([iterm, ghostty], 'wezterm', { ...ghostty, atime: 1 })).toEqual({ client: ghostty, by: 'kept' })
  // First read, or the client of before is gone: the tty read last.
  expect(pickHerdrClient([iterm, ghostty], '', null)).toEqual({ client: iterm, by: 'typed' })
  expect(pickHerdrClient([iterm, ghostty], '', kitty)).toEqual({ client: iterm, by: 'typed' })
  // No app in front known (Linux): the tty read last.
  expect(pickHerdrClient([ghostty, iterm, kitty], null, ghostty)).toEqual({ client: iterm, by: 'typed' })
  expect(pickHerdrClient([], 'ghostty', ghostty)).toBeNull()
})

test("herdr's light check output: the app in front and each tty's access time", () => {
  const tick = herdrTickOf('front com.mitchellh.ghostty\natime /dev/ttys012 1792718368.016685000\natime /dev/ttys021 1792718338\n')
  expect(tick.front).toBe('com.mitchellh.ghostty')
  expect([...tick.atimes]).toEqual([['ttys012', 1792718368.016685], ['ttys021', 1792718338]])
  // Linux: no front line; a tty under /dev/pts keeps its folder.
  expect(herdrTickOf('atime /dev/pts/3 1792718338\n')).toEqual({ front: null, atimes: new Map([['pts/3', 1792718338]]) })
  expect(herdrTickOf('')).toEqual({ front: null, atimes: new Map() })
  // A line with no time is not one.
  expect(herdrTickOf('atime /dev/ttys012 \natime /dev/ttys013 x\n').atimes.size).toBe(0)
  expect(ttyNameOf('/dev/ttys003')).toBe('ttys003')
  expect(ttyNameOf('pts/3')).toBe('pts/3')
})

test("herdr's light check: the pick on the clients of the last scan, else a full scan", () => {
  const iterm = herdrClientOf(ITERM_MAC)!
  // iTerm2 on ttys012, Ghostty on ttys013.
  const ghostty: HerdrClient = { ...herdrClientOf(GHOSTTY_MAC2)!, tty: 'ttys013' }
  const kitty = herdrClientOf(KITTY_MAC)!
  const tickOf = (front: string | null, times: Record<string, number>) => ({ front, atimes: new Map(Object.entries(times)) })
  const base = { clients: [iterm, ghostty], was: ghostty, scanFront: 'com.mitchellh.ghostty', ageMs: 1000 }
  // Ghostty in front, as at the scan: the times are new, the pick stays Ghostty, no scan.
  const same = herdrTickPick({ ...base, tick: tickOf('com.mitchellh.ghostty', { ttys012: 50, ttys013: 40 }) })
  expect(same?.pick).toEqual({ client: { ...ghostty, atime: 40 }, by: 'front' })
  expect(same?.clients.map(c => c.atime)).toEqual([50, 40])
  // A browser in front: the client of before stays.
  expect(herdrTickPick({ ...base, tick: tickOf('com.apple.Safari', { ttys012: 50, ttys013: 40 }) })?.pick?.by).toBe('kept')
  // The app in front has another client (iTerm2): a full scan.
  expect(herdrTickPick({ ...base, tick: tickOf('com.googlecode.iterm2', { ttys012: 50, ttys013: 40 }) })).toBeNull()
  // A terminal in front with no client (kitty): a full scan, but not again when the scan saw it in front.
  expect(herdrTickPick({ ...base, tick: tickOf('net.kovidgoyal.kitty', { ttys012: 50, ttys013: 40 }) })).toBeNull()
  expect(herdrTickPick({ ...base, scanFront: 'net.kovidgoyal.kitty', tick: tickOf('net.kovidgoyal.kitty', { ttys012: 50, ttys013: 40 }) })?.pick?.by).toBe('kept')
  // A tty gone, or the tick failed: a full scan.
  expect(herdrTickPick({ ...base, tick: tickOf('com.mitchellh.ghostty', { ttys013: 40 }) })).toBeNull()
  expect(herdrTickPick({ ...base, tick: null })).toBeNull()
  // No scan yet, or the last one HERDR_SCAN_MS ago: a full scan.
  const tick = tickOf('com.mitchellh.ghostty', { ttys012: 50, ttys013: 40 })
  expect(herdrTickPick({ ...base, tick, ageMs: null })).toBeNull()
  expect(herdrTickPick({ ...base, tick, ageMs: HERDR_SCAN_MS })).toBeNull()
  expect(herdrTickPick({ ...base, tick, ageMs: HERDR_SCAN_MS - 1 })).not.toBeNull()
  // Linux (no app in front): the tty read last; another client than before: a full scan.
  expect(herdrTickPick({ ...base, scanFront: null, tick: tickOf(null, { ttys012: 30, ttys013: 40 }) })?.pick?.by).toBe('typed')
  expect(herdrTickPick({ ...base, scanFront: null, tick: tickOf(null, { ttys012: 50, ttys013: 40 }) })).toBeNull()
  // A tty named with /dev/ (an older scan) is found too.
  expect(herdrTickPick({ ...base, clients: [{ ...kitty, tty: '/dev/ttys021' }], was: kitty, scanFront: null, tick: tickOf(null, { ttys021: 9 }) })?.pick?.client.atime).toBe(9)
  // No client at the scan: nothing to follow, and no scan before HERDR_SCAN_MS (unless a new terminal is in front).
  expect(herdrTickPick({ clients: [], was: null, scanFront: null, ageMs: 1000, tick: tickOf(null, {}) })).toEqual({ clients: [], pick: null })
  expect(herdrTickPick({ clients: [], was: null, scanFront: null, ageMs: 1000, tick: tickOf('com.mitchellh.ghostty', {}) })).toBeNull()
})
