import { expect, mock, test } from 'claude-code/testing'

import { fcPatternOf, HERDR_CLIENT_SH, HERDR_TICK_SH, KITTY_MAC_FONT, PROGRAM_FONTS_PL, PROGRAM_FONTS_SH, RIO_DEFAULT_FONT, RIO_OLD_FONT } from '../hooks/register'
import { S } from '../hooks/lib/state'
import { HERDR_SCAN_MS } from '../hooks/lib/settings'

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

type World = { ran: string[][]; envs: (Record<string, string> | undefined)[]; fontPaths: string[]; copies: () => string[][]; clock: ReturnType<typeof mock.clock> }
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
  stored?: Record<string, unknown>
}): World {
  S.fontPaths = ''
  mock.store(on, o.stored)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', ...o.env })
  const ran: string[][] = []
  const envs: (Record<string, string> | undefined)[] = []
  const fontPaths: string[] = []
  const families = o.families ?? []
  const nearest = o.nearest ?? 'DejaVu Sans Mono'
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    ran.push(argv)
    envs.push(e.init?.env)
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
  return { ran, fontPaths, copies: () => ran.filter(argv => argv.includes(PROGRAM_FONTS_SH)), clock, envs }
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
  expect(text).toContain("terminal herdr 0.9.5 (in Ghostty, from the server's start): this terminal draws pictures.")
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
  expect(text).toContain("terminal herdr (in kitty, from the server's start): ")
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
  expect(text).toContain("terminal herdr (in Ghostty, from the server's start): Claude Code draws no pictures in herdr until CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 is set when it starts (run /iui setup)")
})

// The herdr client the user typed in last (HERDR_CLIENT_SH's output): the
// server was started from Ghostty (its variables are in the pane), the
// client is kitty or Ghostty.
const HERDR_SERVER_ENV = { TERM_PROGRAM: 'herdr', TERM_PROGRAM_VERSION: '0.9.5', HERDR_ENV: '1', TERM: 'xterm-256color', GHOSTTY_RESOURCES_DIR: '/R', GHOSTTY_BIN_DIR: '/B', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }
const kittyClient = 'pid 54346\natime 20\ntty ttys021\ncmd herdr\napp /Applications/kitty.app/Contents/MacOS/kitty herdr\nenv\nherdr TERM=xterm-kitty KITTY_WINDOW_ID=1 KITTY_CONFIG_DIRECTORY=/h/kc\n'
const ghosttyClient = 'pid 50390\natime 10\ntty ttys012\ncmd herdr\napp /Applications/Ghostty.app/Contents/MacOS/ghostty -e herdr\nenv\nherdr TERM=xterm-ghostty TERM_PROGRAM=ghostty GHOSTTY_BIN_DIR=/G\n'
const clientIs = (out: () => string) => (argv: string[]) => (argv[2] === HERDR_CLIENT_SH ? ok(out()) : undefined)
// The light check (HERDR_TICK_SH): the app in front (null: none read) and a time for each tty asked.
const tickIs = (front: () => string | null) => (argv: string[]) =>
  argv[2] === HERDR_TICK_SH ? ok(`${front() ? `front ${front()}\n` : ''}${argv.slice(5).map(tty => `atime ${tty} 10\n`).join('')}`) : undefined
const scansOf = (w: World) => w.ran.filter(argv => argv[2] === HERDR_CLIENT_SH).length

fontTest("herdr: the client you typed in last (kitty) wins over the server's variables (Ghostty)", async ($, on) => {
  const w = world(on, {
    isMac: true,
    env: HERDR_SERVER_ENV,
    families: ['Iosevka', 'Fira Code'],
    files: { '/h/kc/kitty.conf': 'font_family Fira Code\n' },
    run: argv => clientIs(() => kittyClient)(argv) ?? shows('font-family = Iosevka\n')(argv),
  })
  const text = await details($)
  expect(text).toContain('terminal font Fira Code.')
  expect(text).toContain('terminal herdr 0.9.5 (in kitty, the client you used last): this terminal draws pictures.')
  expect(w.ran.some(argv => argv.join(' ').includes('+show-config'))).toBe(false)
})

fontTest("herdr: no client found (the check fails): the server's variables, as before", async ($, on) => {
  world(on, {
    isMac: true,
    env: HERDR_SERVER_ENV,
    families: ['Iosevka'],
    run: argv => (argv[2] === HERDR_CLIENT_SH ? ok('', 1) : shows('font-family = Iosevka\n')(argv)),
  })
  const text = await details($)
  expect(text).toContain('terminal font Iosevka.')
  expect(text).toContain("terminal herdr 0.9.5 (in Ghostty, from the server's start): ")
})

fontTest("herdr in Ghostty: Ghostty's +show-config runs with the client's GHOSTTY_BIN_DIR", async ($, on) => {
  const w = world(on, { isMac: true, env: HERDR_SERVER_ENV, families: ['Iosevka'], run: argv => clientIs(() => ghosttyClient)(argv) ?? shows('font-family = Iosevka\n')(argv) })
  expect(await details($)).toContain('terminal font Iosevka.')
  const seen = w.ran.flatMap((argv, i) => (argv.join(' ').includes('+show-config') ? [w.envs[i]?.GHOSTTY_BIN_DIR] : []))
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.every(dir => dir === '/G')).toBe(true)
})

fontTest('herdr: the check each second runs no full scan; a new client (Ghostty to kitty) is seen by the full scan each 10 s: the font is read and measured again', async ($, on) => {
  let client = ghosttyClient
  const w = world(on, {
    isMac: true,
    env: HERDR_SERVER_ENV,
    families: ['Iosevka', 'Fira Code'],
    files: { '/h/kc/kitty.conf': 'font_family Fira Code\n' },
    run: argv => clientIs(() => client)(argv) ?? tickIs(() => null)(argv) ?? shows('font-family = Iosevka\n')(argv),
  })
  const first = await details($)
  expect(first).toContain('terminal font Iosevka.')
  expect(first).toContain('(in Ghostty, the client you used last)')
  const measured = w.fontPaths.length
  const scanned = scansOf(w)
  // Each second the light check (the known client's tty), no full scan; nothing is read again.
  await w.clock.advance(3000)
  const ticks = w.ran.filter(argv => argv[2] === HERDR_TICK_SH)
  expect(ticks.length).toBe(3)
  expect(ticks[0]!.slice(4)).toEqual(['Darwin', '/dev/ttys012'])
  expect(scansOf(w)).toBe(scanned)
  expect(w.fontPaths.length).toBe(measured)
  // kitty's client is new: the light check does not see it, the full scan at 10 s does.
  client = kittyClient
  await w.clock.advance(HERDR_SCAN_MS - 4000)
  expect(scansOf(w)).toBe(scanned)
  await w.clock.advance(1000)
  expect(scansOf(w)).toBe(scanned + 1)
  const later = await details($)
  expect(later).toContain('terminal font Fira Code.')
  expect(later).toContain('(in kitty, the client you used last)')
  expect(w.fontPaths.length).toBeGreaterThan(measured)
})

// The herdr checks run since `from` (ran index): light checks and full scans.
const checksSince = (w: World, from: number) => w.ran.slice(from).filter(argv => argv[2] === HERDR_TICK_SH || argv[2] === HERDR_CLIENT_SH).length
// A test that leaves the poll state as it found it.
const pollTest = (name: string, fn: ($: any, on: any) => Promise<void>) =>
  fontTest(name, async ($, on) => {
    try {
      await fn($, on)
    } finally {
      S.isOff = false
      S.hostEnded = false
    }
  })

pollTest('herdr: no check each second while the mod is off; /iui on starts it again', async ($, on) => {
  const w = world(on, { isMac: true, env: HERDR_SERVER_ENV, families: ['Iosevka'], run: argv => clientIs(() => ghosttyClient)(argv) ?? tickIs(() => null)(argv) ?? shows('font-family = Iosevka\n')(argv) })
  await details($)
  let from = w.ran.length
  await w.clock.advance(3000)
  expect(checksSince(w, from)).toBe(3)
  await $.command.run({ command: 'iui', args: 'off' } as any)
  from = w.ran.length
  await w.clock.advance(5000)
  expect(checksSince(w, from)).toBe(0)
  await $.command.run({ command: 'iui', args: 'on' } as any)
  from = w.ran.length
  await w.clock.advance(2000)
  expect(checksSince(w, from)).toBe(2)
})

pollTest('herdr: the mod off when it starts (the stored setting): no check each second', async ($, on) => {
  const w = world(on, { isMac: true, env: HERDR_SERVER_ENV, families: ['Iosevka'], stored: { enabled: false }, run: argv => clientIs(() => ghosttyClient)(argv) ?? tickIs(() => null)(argv) ?? shows('font-family = Iosevka\n')(argv) })
  await details($)
  const from = w.ran.length
  await w.clock.advance(5000)
  expect(checksSince(w, from)).toBe(0)
})

pollTest("herdr with pictures off (no CLAUDE_CODE_FORCE_TERMINAL_IMAGES): no check each second", async ($, on) => {
  const { CLAUDE_CODE_FORCE_TERMINAL_IMAGES: _, ...env } = HERDR_SERVER_ENV
  const w = world(on, { isMac: true, env, families: ['Iosevka'], run: argv => clientIs(() => ghosttyClient)(argv) ?? tickIs(() => null)(argv) ?? shows('font-family = Iosevka\n')(argv) })
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'dismissed' }))
  await details($)
  const from = w.ran.length
  await w.clock.advance(5000)
  expect(checksSince(w, from)).toBe(0)
})

pollTest('herdr: the end of the session stops the check each second', async ($, on) => {
  const w = world(on, { isMac: true, env: HERDR_SERVER_ENV, families: ['Iosevka'], run: argv => clientIs(() => ghosttyClient)(argv) ?? tickIs(() => null)(argv) ?? shows('font-family = Iosevka\n')(argv) })
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  await details($)
  await ($ as any).session.end({ reason: 'prompt_input_exit', sessionId: 's1' })
  const from = w.ran.length
  await w.clock.advance(5000)
  expect(checksSince(w, from)).toBe(0)
})

fontTest('herdr: a terminal in front with no known client makes a full scan at the next second, and only once while it stays in front', async ($, on) => {
  let client = ghosttyClient
  let front: string | null = 'com.mitchellh.ghostty'
  const w = world(on, {
    isMac: true,
    env: HERDR_SERVER_ENV,
    families: ['Iosevka', 'Fira Code'],
    files: { '/h/kc/kitty.conf': 'font_family Fira Code\n' },
    run: argv => clientIs(() => `front ${front}\n${client}`)(argv) ?? tickIs(() => front)(argv) ?? shows('font-family = Iosevka\n')(argv),
  })
  expect(await details($)).toContain('(in Ghostty, the terminal in front)')
  const scanned = scansOf(w)
  // kitty comes in front with a new client: the next check scans and follows it.
  client = kittyClient
  front = 'net.kovidgoyal.kitty'
  await w.clock.advance(1000)
  expect(scansOf(w)).toBe(scanned + 1)
  const later = await details($)
  expect(later).toContain('terminal font Fira Code.')
  expect(later).toContain('(in kitty, the terminal in front)')
  // WezTerm in front, with no client: one scan; then the client of before stays, with no scan each second.
  front = 'com.github.wez.wezterm'
  await w.clock.advance(1000)
  expect(scansOf(w)).toBe(scanned + 2)
  await w.clock.advance(3000)
  expect(scansOf(w)).toBe(scanned + 2)
  expect(await details($)).toContain('(in kitty, the terminal in front)')
})

const itermClient = 'pid 50400\natime 30\ntty ttys013\ncmd herdr\napp /Applications/iTerm.app/Contents/MacOS/iTerm2\nenv\nherdr TERM=xterm-256color TERM_PROGRAM=iTerm.app\n'

fontTest('herdr: a change of client to iTerm2 and back turns flip mode on and off, and redraws even with the same font', async ($, on) => {
  let client = ghosttyClient
  let front = 'com.mitchellh.ghostty'
  let redraws = 0
  on('state.set', async ($: any, e: any, next: any) => {
    if (e.key === 'done') redraws++
    return next(e)
  })
  const w = world(on, { isMac: true, env: HERDR_SERVER_ENV, families: ['Iosevka'], run: argv => clientIs(() => `front ${front}\n${client}`)(argv) ?? tickIs(() => front)(argv) ?? shows('font-family = Iosevka\n')(argv) })
  expect(await details($)).not.toContain('upside down')
  await w.clock.advance(3000)
  const before = redraws
  // iTerm2's font is not read here (no profile), so the font stays: only flip mode changes.
  client = itermClient
  front = 'com.googlecode.iterm2'
  await w.clock.advance(1000)
  const flipped = await details($)
  expect(flipped).toContain("(in iTerm2, the terminal in front; pages and pictures stored upside down by rows, for iTerm2's placement bug)")
  expect(flipped).toContain('terminal font Iosevka.')
  expect(redraws).toBeGreaterThan(before)
  const during = redraws
  client = ghosttyClient
  front = 'com.mitchellh.ghostty'
  await w.clock.advance(1000)
  expect(await details($)).not.toContain('upside down')
  expect(redraws).toBeGreaterThan(during)
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
