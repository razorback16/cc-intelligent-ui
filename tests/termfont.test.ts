import { expect, mock, test } from 'claude-code/testing'

import { fcPatternOf, KITTY_MAC_FONT, PROGRAM_FONTS_PL, PROGRAM_FONTS_SH, RIO_DEFAULT_FONT, RIO_OLD_FONT } from '../hooks/register'
import { S } from '../hooks/lib/state'

// The terminal font that the pictures use: the one the terminal draws. A
// font that a terminal carries in its program is copied out for Typst; a
// font that it does not find is the one it draws in its place.

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error' : '', isStdoutTruncated: false, isStderrTruncated: false } })
const FONTS_DIR = '/h/.cache/cc-intelligent-ui/fonts/rio-1'
// render/measure.typ's answer when Typst does not have the terminal font.
const NO_TERM = JSON.stringify({ term: null, menlo: { adv: 0.6, xh: 0.55, avg: 0.6 }, body: { adv: 0.6, xh: 0.52, avg: 0.48 } })
// fontconfig's loose match: no case, no spaces.
const loose = (s: string) => s.replace(/\\(.)/g, '$1').replace(/\s/g, '').toLowerCase()
// The argument after the one that holds `marker` (a script's first argument).
const argAfter = (argv: string[], marker: string) => argv[argv.findIndex(a => a.includes(marker)) + 1] ?? ''

type World = { ran: string[][]; fontPaths: string[]; copies: () => string[][] }
// A Mac or Linux with Typst. `run` answers a command first (undefined: the
// world's answer); `families` are the installed ones (CoreText or
// fontconfig), `proportional` those of them with no fixed-pitch style,
// `names` the families of full or PostScript names; `nearest` is
// fontconfig's nearest font; `files` are under /h; `copied` is the folder
// of a copy out of a program, 'none' when the program has no such font
// (unset: no program).
function world(on: any, o: {
  isMac: boolean
  env: Record<string, string>
  families?: string[]
  proportional?: string[]
  names?: Record<string, string>
  nearest?: string
  files?: Record<string, string>
  copied?: string
  measure?: string
  run?: (argv: string[]) => ReturnType<typeof ok> | undefined
}): World {
  S.fontPaths = ''
  mock.store(on)
  mock.clock(on)
  mock.env(on, { HOME: '/h', ...o.env })
  const ran: string[][] = []
  const fontPaths: string[] = []
  const families = o.families ?? []
  const nearest = o.nearest ?? 'DejaVu Sans Mono'
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    ran.push(argv)
    const own = o.run?.(argv)
    if (own) return own
    if (/cc-intelligent-ui-/.test(cmd)) return ok(`/c\n${o.isMac ? 'Darwin' : 'Linux'}\n/h/.cache/cc-intelligent-ui/designs\n`)
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') {
      // The fonts Typst gets besides the system's.
      fontPaths.push(e.init?.env?.TYPST_FONT_PATHS ?? '')
      return ok(o.measure ?? '{}')
    }
    if (argv.includes(PROGRAM_FONTS_SH)) return o.copied === 'none' ? ok('', 3) : o.copied ? ok(`${o.copied}\n`) : ok('', 2)
    if (argv[0] === 'osascript' && cmd.includes('availableMembersOfFontFamily')) {
      const family = argAfter(argv, 'availableMembersOfFontFamily')
      if (!families.some(f => f.toLowerCase() === family.toLowerCase())) return ok('no\n')
      return ok(argv.includes('mono') && o.proportional?.includes(family) ? 'proportional\n' : 'yes\n')
    }
    if (argv[0] === 'osascript' && cmd.includes('availableFontFamilies')) {
      const found = families.find(f => f.toLowerCase() === argv.at(-1)!.toLowerCase())
      return ok(found ? `=${found}\n` : 'no\n')
    }
    if (argv[0] === 'osascript' && cmd.includes('fontWithNameSize')) return ok(`${o.names?.[argAfter(argv, 'fontWithNameSize')] ?? ''}\n`)
    if (argv[0] === 'fc-list' && argv[1] === ':') return ok(families.map(f => fcPatternOf(f)).join('\n'))
    // A full or PostScript name: its family; a family: the installed ones it matches loosely.
    if (argv[0] === 'fc-list' && argv.at(-1) === 'family' && argv[1]!.startsWith(':')) return ok(o.names?.[argv[1]!.replace(/^:\w+=/, '').replace(/\\(.)/g, '$1')] ?? '')
    if (argv[0] === 'fc-list' && argv.at(-1) === 'family') return ok(families.filter(f => loose(f) === loose(argv[1]!)).map(f => fcPatternOf(f)).join('\n'))
    if (argv[0] === 'fc-list' && argv[1] === '-q') return ok('', families.some(f => loose(f) === loose(argv[2]!)) ? 0 : 1)
    if (argv[0] === 'fc-match' && argv[1] === 'monospace') return ok('DejaVu Sans Mono')
    if (argv[0] === 'fc-match') {
      const asked = argv[1]!.replace(/:spacing=mono$/, '')
      return ok(families.find(f => loose(f) === loose(asked)) ?? nearest)
    }
    return ok('', 1)
  })
  const files = o.files ?? {}
  on('fs.read', async ($: any, e: any, next: any) => (e.path in files ? { value: files[e.path] } : e.path.startsWith('/h/') || e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)))
  on('fs.exists', async ($: any, e: any, next: any) => (e.path.startsWith('/h/') ? { value: e.path in files } : e.path === '/usr/bin/typst' ? { value: true } : next(e)))
  return { ran, fontPaths, copies: () => ran.filter(argv => argv.includes(PROGRAM_FONTS_SH)) }
}
const details = async ($: any) => (await $.command.run({ command: 'iui', args: 'details' } as any)).text as string
// A test that leaves S.fontPaths empty after it (pure.test.ts expects it so).
const fontTest = (name: string, fn: ($: any, on: any) => Promise<void>) =>
  test(name, async ($, on) => {
    try {
      await fn($, on)
    } finally {
      S.fontPaths = ''
    }
  })

// ---- Rio ----------------------------------------------------------------------

for (const isMac of [true, false]) {
  const os = isMac ? 'macOS' : 'Linux'
  fontTest(`Rio on ${os} with no font in its config: a copy of the Cascadia Code NF in its program`, async ($, on) => {
    const w = world(on, { isMac, env: { TERM_PROGRAM: 'rio' }, copied: FONTS_DIR, families: ['Cascadia Code'] })
    expect(await details($)).toContain(`terminal font ${RIO_DEFAULT_FONT}.`)
    expect(w.fontPaths.at(-1)).toBe(FONTS_DIR)
    const [argv] = w.copies()
    expect(argv).toContain(PROGRAM_FONTS_PL)
    expect(argv).toContain('Cascadia Code NF')
    // The app's bundle is rio.app (lowercase).
    expect(argv).toContain('/Applications/rio.app/Contents/MacOS/rio')
    expect(argv).toContain(isMac ? '/usr/bin/perl' : 'perl')
  })

  fontTest(`Rio on ${os} with a font that is not installed: Rio draws its own font`, async ($, on) => {
    world(on, { isMac, env: { TERM_PROGRAM: 'rio' }, copied: FONTS_DIR, files: { '/h/.config/rio/config.toml': '[fonts]\nfamily = "Iosevka"\n' } })
    expect(await details($)).toContain(`terminal font ${RIO_DEFAULT_FONT}.`)
  })

  fontTest(`Rio on ${os} with a font that is installed: that font, and no copy`, async ($, on) => {
    const w = world(on, { isMac, env: { TERM_PROGRAM: 'rio' }, copied: FONTS_DIR, families: ['Iosevka'], files: { '/h/.config/rio/config.toml': '[fonts.regular]\nfamily = "Iosevka"\n' } })
    expect(await details($)).toContain('terminal font Iosevka.')
    expect(w.copies()).toEqual([])
    expect(w.fontPaths.every(p => p === '')).toBe(true)
  })
}

fontTest("Rio on Linux finds a family by its exact name only (its font database), not by fontconfig's loose match", async ($, on) => {
  world(on, { isMac: false, env: { TERM_PROGRAM: 'rio' }, copied: FONTS_DIR, families: ['IoSevka Term'], files: { '/h/.config/rio/config.toml': '[fonts]\nfamily = "iosevkaterm"\n' } })
  expect(await details($)).toContain(`terminal font ${RIO_DEFAULT_FONT}.`)
})

for (const isMac of [true, false]) {
  fontTest(`Rio on ${isMac ? 'macOS' : 'Linux'} finds a family in any case (Rio compares lower case): the installed name`, async ($, on) => {
    const w = world(on, { isMac, env: { TERM_PROGRAM: 'rio' }, copied: FONTS_DIR, families: ['Iosevka Term'], files: { '/h/.config/rio/config.toml': '[fonts]\nfamily = "iosevka term"\n' } })
    expect(await details($)).toContain('terminal font Iosevka Term.')
    expect(w.copies()).toEqual([])
  })
}

for (const term of ['ghostty', 'kitty']) {
  fontTest(`${term} on Linux with a family in another case and spacing: the name fontconfig has, for Typst`, async ($, on) => {
    const files: Record<string, string> = term === 'kitty' ? { '/h/.config/kitty/kitty.conf': 'font_family iosevkaterm\n' } : {}
    const env: Record<string, string> = term === 'kitty' ? { TERM: 'xterm-kitty' } : { TERM_PROGRAM: 'ghostty' }
    world(on, { isMac: false, env, families: ['Iosevka Term'], files, run: shows('font-family = iosevkaterm\n') })
    expect(await details($)).toContain('terminal font Iosevka Term.')
  })
}

fontTest('Rio with no Cascadia Code NF in its program (a Rio up to 0.4): Cascadia Code', async ($, on) => {
  world(on, { isMac: true, env: { TERM_PROGRAM: 'rio' }, copied: 'none' })
  expect(RIO_OLD_FONT).toBe('Cascadia Code')
  expect(await details($)).toContain('terminal font Cascadia Code.')
})

fontTest("Rio with no program found: the system's Cascadia Code (the same letters)", async ($, on) => {
  world(on, { isMac: false, env: { TERM_PROGRAM: 'rio' }, families: ['Cascadia Code'] })
  expect(await details($)).toContain('terminal font Cascadia Code.')
})

fontTest("the copied font goes after the user's own TYPST_FONT_PATHS", async ($, on) => {
  const w = world(on, { isMac: false, env: { TERM_PROGRAM: 'rio', TYPST_FONT_PATHS: '/u/fonts' }, copied: FONTS_DIR })
  await details($)
  expect(w.fontPaths.at(-1)).toBe(`/u/fonts:${FONTS_DIR}`)
})

fontTest('a terminal font that Typst does not have: /iui details says so', async ($, on) => {
  world(on, { isMac: false, env: { TERM_PROGRAM: 'rio' }, measure: NO_TERM })
  expect(await details($)).toContain(`terminal font ${RIO_DEFAULT_FONT} (Typst does not have this font, so the pictures use the theme's fonts)`)
})

fontTest('a terminal font that Typst has: no note', async ($, on) => {
  world(on, { isMac: false, env: { TERM_PROGRAM: 'rio' }, copied: FONTS_DIR, measure: JSON.stringify({ ...JSON.parse(NO_TERM), term: { adv: 0.6, xh: 0.5, avg: 0.6 } }) })
  const text = await details($)
  expect(text).toContain(`terminal font ${RIO_DEFAULT_FONT}.`)
  expect(text).not.toContain('Typst does not have')
})

// ---- Ghostty and cmux ---------------------------------------------------------

const shows = (config: string) => (argv: string[]) => (argv.join(' ').includes('+show-config') ? ok(config) : undefined)

fontTest('Ghostty on macOS with a font-family that is not installed: its own JetBrains Mono', async ($, on) => {
  const w = world(on, { isMac: true, env: { TERM_PROGRAM: 'ghostty' }, copied: '/h/.cache/cc-intelligent-ui/fonts/ghostty-1', run: shows('font-family = Iosevka\n') })
  expect(await details($)).toContain('terminal font JetBrains Mono.')
  expect(w.copies()[0]).toContain('JetBrains Mono')
})

fontTest("Ghostty on Linux with a font-family that is not installed: fontconfig's nearest font, as Ghostty draws", async ($, on) => {
  const w = world(on, { isMac: false, env: { TERM_PROGRAM: 'ghostty' }, nearest: 'Noto Sans Mono', copied: '/h/f', run: shows('font-family = Iosevka\n') })
  expect(await details($)).toContain('terminal font Noto Sans Mono.')
  expect(w.copies()).toEqual([])
})

for (const isMac of [true, false]) {
  fontTest(`Ghostty on ${isMac ? 'macOS' : 'Linux'} with a font-family list: the first family of it that is installed`, async ($, on) => {
    world(on, { isMac, env: { TERM_PROGRAM: 'ghostty' }, families: ['Iosevka', 'Menlo'], run: shows('font-family = Nope\nfont-family = Iosevka\nfont-family = Menlo\n') })
    expect(await details($)).toContain('terminal font Iosevka.')
  })
}

fontTest('Ghostty with a font-family that is installed: that font', async ($, on) => {
  world(on, { isMac: true, env: { TERM_PROGRAM: 'ghostty' }, families: ['Iosevka'], run: shows('font-family = Iosevka\n') })
  expect(await details($)).toContain('terminal font Iosevka.')
})

fontTest("cmux: a font-family in cmux's own config counts", async ($, on) => {
  world(on, {
    isMac: true,
    env: { TERM_PROGRAM: 'ghostty', CMUX_SURFACE_ID: 'S1' },
    families: ['Fira Code'],
    files: { '/h/Library/Application Support/com.cmuxterm.app/config.ghostty': 'font-family = "Fira Code"\n' },
    run: shows('font-size = 13\n'),
  })
  expect(await details($)).toContain('terminal font Fira Code.')
})

// ---- herdr ----------------------------------------------------------------------

fontTest("herdr in Ghostty (GHOSTTY_RESOURCES_DIR kept): Ghostty's font-family; the details name herdr and Ghostty", async ($, on) => {
  world(on, {
    isMac: true,
    env: { TERM_PROGRAM: 'herdr', TERM_PROGRAM_VERSION: '0.9.5', HERDR_ENV: '1', TERM: 'xterm-256color', GHOSTTY_RESOURCES_DIR: '/R', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' },
    families: ['Iosevka'],
    run: shows('font-family = Iosevka\n'),
  })
  const text = await details($)
  expect(text).toContain('terminal font Iosevka.')
  expect(text).toContain('terminal herdr 0.9.5 (in Ghostty): this terminal draws pictures.')
})

fontTest("herdr in kitty (KITTY_INSTALLATION_DIR kept): kitty's font_family", async ($, on) => {
  world(on, {
    isMac: true,
    env: { TERM_PROGRAM: 'herdr', HERDR_ENV: '1', TERM: 'xterm-256color', KITTY_INSTALLATION_DIR: '/K', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' },
    families: ['Iosevka'],
    files: { '/h/.config/kitty/kitty.conf': 'font_family Iosevka\n' },
  })
  const text = await details($)
  expect(text).toContain('terminal font Iosevka.')
  expect(text).toContain('terminal herdr (in kitty): ')
})

fontTest('herdr in a terminal it does not know: no font, as before; the details say so', async ($, on) => {
  const w = world(on, { isMac: true, env: { TERM_PROGRAM: 'herdr', HERDR_ENV: '1', TERM: 'xterm-256color', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }, run: shows('font-family = Iosevka\n') })
  const text = await details($)
  expect(text).toContain('terminal font not known (Menlo assumed)')
  expect(text).toContain('terminal herdr (outer terminal not known): this terminal draws pictures.')
  expect(w.ran.some(argv => argv.join(' ').includes('+show-config'))).toBe(false)
})

fontTest('herdr with pictures off: the details point to /iui setup', async ($, on) => {
  world(on, { isMac: true, env: { TERM_PROGRAM: 'herdr', HERDR_ENV: '1', TERM: 'xterm-256color', GHOSTTY_BIN_DIR: '/B' }, run: shows('font-family = Iosevka\n') })
  // The setup question (pictures are off in herdr) is dismissed.
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'dismissed' }))
  const text = await details($)
  expect(text).toContain('terminal herdr (in Ghostty): Claude Code draws no pictures in herdr until CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 is set when it starts (run /iui setup)')
})

// ---- kitty ----------------------------------------------------------------------

const kittyConf = (line: string) => ({ '/h/.config/kitty/kitty.conf': `${line}\n` })

fontTest('kitty on macOS with no font_family: Menlo, as kitty draws', async ($, on) => {
  world(on, { isMac: true, env: { TERM: 'xterm-kitty' } })
  expect(KITTY_MAC_FONT).toBe('Menlo')
  expect(await details($)).toContain('terminal font Menlo.')
})

fontTest('kitty on macOS with a font_family that is not installed: Menlo', async ($, on) => {
  world(on, { isMac: true, env: { TERM: 'xterm-kitty' }, files: kittyConf('font_family Iosevka') })
  expect(await details($)).toContain('terminal font Menlo.')
})

fontTest('kitty on macOS with a font_family that is not fixed-pitch: Menlo (kitty looks only at fixed-pitch fonts)', async ($, on) => {
  world(on, { isMac: true, env: { TERM: 'xterm-kitty' }, families: ['Helvetica'], proportional: ['Helvetica'], files: kittyConf('font_family Helvetica') })
  expect(await details($)).toContain('terminal font Menlo.')
})

fontTest("kitty on Linux with a font_family that is not installed: fontconfig's monospace match, as kitty draws", async ($, on) => {
  const w = world(on, { isMac: false, env: { TERM: 'xterm-kitty' }, files: kittyConf('font_family Iosevka') })
  expect(await details($)).toContain('terminal font DejaVu Sans Mono.')
  expect(w.ran.some(argv => argv[0] === 'fc-match' && argv.includes('Iosevka:spacing=mono'))).toBe(true)
})

for (const isMac of [true, false]) {
  fontTest(`kitty on ${isMac ? 'macOS' : 'Linux'} with a full name in font_family: its family, as kitty finds it`, async ($, on) => {
    world(on, { isMac, env: { TERM: 'xterm-kitty' }, names: { 'JetBrains Mono Light': 'JetBrains Mono' }, files: kittyConf('font_family JetBrains Mono Light') })
    expect(await details($)).toContain('terminal font JetBrains Mono.')
  })
}

test('a family as a fontconfig pattern: its special characters escaped', () => {
  expect(fcPatternOf('JetBrains Mono')).toBe('JetBrains Mono')
  expect(fcPatternOf('M+ 1m-x:y,z\\')).toBe('M+ 1m\\-x\\:y\\,z\\\\')
})

// ---- iTerm2 -----------------------------------------------------------------------

const itermWorld = (on: any, o: { marks: string | null; names?: Record<string, string> }) =>
  world(on, {
    isMac: true,
    env: { TERM_PROGRAM: 'iTerm.app', ITERM_PROFILE: 'Default' },
    ...(o.names ? { names: o.names } : {}),
    run: argv => {
      const cmd = argv.join(' ')
      if (cmd.includes('TabStyle')) return undefined
      if (cmd.includes('"New Bookmarks"')) return o.marks === null ? ok('', 1) : ok(o.marks)
      if (cmd.includes('Default Bookmark Guid')) return ok('G1\n')
      return undefined
    },
  })
const profile = (font?: string) => JSON.stringify([{ Name: 'Default', Guid: 'G1', ...(font === undefined ? {} : { 'Normal Font': font }) }])
const fontAsks = (w: World) => w.ran.filter(argv => argv[0] === 'osascript' && argv.join(' ').includes('fontWithNameSize'))

fontTest('iTerm2: a Normal Font with settings after its size is read as iTerm2 reads it', async ($, on) => {
  const w = itermWorld(on, { marks: profile('JetBrainsMono-Regular 13 {"featureSettings":[]}'), names: { 'JetBrainsMono-Regular': 'JetBrains Mono' } })
  expect(await details($)).toContain('terminal font JetBrains Mono.')
  expect(fontAsks(w)[0]!.slice(-2)).toEqual(['JetBrainsMono-Regular', 'user'])
})

for (const font of ['Gone-Regular 12', '', 'nosize', undefined]) {
  fontTest(`iTerm2: a profile font that is not installed, empty or bad (${JSON.stringify(font)}) gives the user's fixed-pitch font, as iTerm2 draws`, async ($, on) => {
    // The script gives the user's font for a name it does not find.
    const w = itermWorld(on, { marks: profile(font), names: { 'Gone-Regular': 'Menlo', '': 'Menlo' } })
    expect(await details($)).toContain('terminal font Menlo.')
    expect(fontAsks(w)[0]!.join(' ')).toContain('userFixedPitchFontOfSize')
    expect(fontAsks(w)[0]!.at(-1)).toBe('user')
  })
}

for (const [why, marks] of [['the read fails', null], ['not JSON', 'not json'], ['no profile', JSON.stringify([{ Name: 'Other', Guid: 'G2', 'Normal Font': 'Monaco 12' }])]] as const) {
  fontTest(`iTerm2: its settings can not be used (${why}): the font is not known`, async ($, on) => {
    const w = itermWorld(on, { marks, names: { '': 'Menlo' } })
    expect(await details($)).toContain('terminal font not known (Menlo assumed)')
    expect(fontAsks(w)).toEqual([])
  })
}
