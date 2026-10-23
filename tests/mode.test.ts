import { expect, mock, test } from 'claude-code/testing'

import { HERDR_CLIENT_SH, HERDR_TICK_SH } from '../hooks/register'
import { S } from '../hooks/lib/state'

// Claude Code's theme on auto, on a Mac in light mode: the OS read gives light.
test('with the theme on auto, the mode comes from the OS appearance, read every 3 s', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  let osDark = false
  mock.env(on, { HOME: '/fake-home' })
  const reads: string[] = []
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  on('config.set', async ($: any, e: any) => ({ value: e.value }))
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(argv.join(' '))) return { value: { exitCode: 0, stdout: '/tmp/mdp\nDarwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) {
      reads.push('macOS')
      return { value: osDark
        ? { exitCode: 0, stdout: 'Dark\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 1, stdout: '', stderr: 'does not exist', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return next(e)
  })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode light (auto, from macOS)')
  expect(reads.length).toBe(1)
  // The OS goes dark: the next poll, 3 s on, sees it; one read per period.
  osDark = true
  await clock.advance(3000)
  expect(reads.length).toBe(2)
  const later = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(later.text).toContain('mode dark (auto, from macOS)')
  await clock.advance(6000)
  expect(reads.length).toBe(4)
  // A fixed theme stops the polling; auto starts it again, with one read at once.
  await $.config.set({ key: 'theme', value: 'light-daltonized' } as any)
  await clock.advance(9000)
  expect(reads.length).toBe(4)
  const fixed = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(fixed.text).toContain('mode light (Claude Code theme light-daltonized)')
  await $.config.set({ key: 'theme', value: 'auto' } as any)
  await clock.settle()
  expect(reads.length).toBe(5)
  await clock.advance(3000)
  expect(reads.length).toBe(6)
  const again = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(again.text).toContain('mode dark (auto, from macOS)')
})

// /iui probe asks the terminal 5 times and shows each raw answer.
test('/iui probe shows the raw OSC 11 answers and the mode they give', async ($, on) => {
  mock.store(on)
  mock.env(on, { HOME: '/fake-home' })
  const answers = ['\x1b]11;rgb:ffff/ffff/ffff\x07', '', 'x', null, '\x1b]11;rgb:1d1d/2525/2a2a\x1b\\']
  let i = 0
  on('process.run', async ($: any, e: any, next: any) => {
    if (e.argv[0] !== 'perl' || !String(e.argv[2]).includes('11;?')) return next(e)
    const a = answers[i++]
    return { value: { exitCode: a === null ? 1 : 0, stdout: a ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const ran = await $.command.run({ command: 'iui', args: 'probe' } as any)
  expect(i).toBe(5)
  expect(ran.text).toContain('1: "\\e]11;rgb:ffff/ffff/ffff\\a" -> luminance 1.000, light')
  expect(ran.text).toContain('2: no answer in 300 ms')
  expect(ran.text).toContain('3: "x" -> not an OSC 11 answer')
  expect(ran.text).toContain('4: could not open /dev/tty')
  expect(ran.text).toContain('5: "\\e]11;rgb:1d1d/2525/2a2a\\e\\" -> luminance 0.018, dark')
  expect(ran.text).toContain(', dark')
  expect(ran.text).toContain('The poll uses it: no (off).')
})

// iTerm2 set to Dark on a Mac in light mode, a profile with separate colours:
// the terminal is dark, so the mode is dark (the OS is not asked first).
test('with the theme on auto, a dark iTerm2 profile on a light Mac draws dark', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/fake-home', TERM_PROGRAM: 'iTerm.app', ITERM_PROFILE: 'Default', COLORFGBG: '0;15' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const dark = { 'Red Component': 0.11, 'Green Component': 0.15, 'Blue Component': 0.17 }
  const white = { 'Red Component': 1, 'Green Component': 1, 'Blue Component': 1 }
  const marks = JSON.stringify([{ Name: 'Default', Guid: 'G1', 'Use Separate Colors for Light and Dark Mode': true, 'Background Color': dark, 'Background Color (Dark)': dark, 'Background Color (Light)': white }])
  let style = '1\n'
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'sh' && cmd.includes('TabStyleWithAutomaticOption')) return ok(`${style}@\nG1\n@\n${marks}\n`)
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('', 1)
    return next(e)
  })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from iTerm2: profile Default background)')
  // iTerm2 on Automatic follows the light Mac: the profile's light colours.
  style = '4\n'
  await clock.advance(3000)
  const later = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(later.text).toContain('mode light (auto, from iTerm2: profile Default background)')
})

// Ghostty on a light Mac: no theme is Ghostty's dark default; a light:A,dark:B
// theme follows the OS; COLORFGBG (Ghostty sets none) is not needed.
test('with the theme on auto, Ghostty draws as its background is', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty', GHOSTTY_RESOURCES_DIR: '/R' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  let config = 'font-family = Menlo\n'
  let osDark = false
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'sh' && cmd.includes('+show-config')) return ok(config)
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return osDark ? ok('Dark\n') : ok('', 1)
    return next(e)
  })
  const files: Record<string, string> = { '/R/themes/Day': 'background = #f7f7f7\n', '/h/.config/ghostty/themes/Night': 'background = #191724\n' }
  on('fs.read', async ($: any, e: any, next: any) => (e.path in files ? { value: files[e.path] } : e.path.includes('ghostty') || e.path.startsWith('/R/') ? { deny: 'no such file' } as any : next(e)))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from Ghostty: default background)')
  config = 'theme = light:Day,dark:Night\nbackground = #f7f7f7\n'
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode light (auto, from Ghostty: theme Day background)')
  osDark = true
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode dark (auto, from Ghostty: theme Night background)')
})

// herdr in Ghostty on a light Mac: herdr's TERM_PROGRAM hides Ghostty, but
// its GHOSTTY_RESOURCES_DIR is kept, so Ghostty's dark config counts.
test('with the theme on auto, herdr in Ghostty draws as the Ghostty background is', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  mock.env(on, { HOME: '/h', TERM_PROGRAM: 'herdr', HERDR_ENV: '1', TERM: 'xterm-256color', GHOSTTY_RESOURCES_DIR: '/R', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'sh' && cmd.includes('+show-config')) return ok('background = #1d1f21\n')
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('', 1)
    return next(e)
  })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from Ghostty: config background)')
})

// herdr in iTerm2 on a light Mac: ITERM_PROFILE is kept, so the profile counts.
test('with the theme on auto, herdr in iTerm2 draws as the iTerm2 profile is', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  mock.env(on, { HOME: '/h', TERM_PROGRAM: 'herdr', HERDR_ENV: '1', TERM: 'xterm-256color', ITERM_PROFILE: 'Default', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const dark = { 'Red Component': 0.11, 'Green Component': 0.15, 'Blue Component': 0.17 }
  const marks = JSON.stringify([{ Name: 'Default', Guid: 'G1', 'Background Color': dark }])
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'sh' && cmd.includes('TabStyleWithAutomaticOption')) return ok(`0\n@\nG1\n@\n${marks}\n`)
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('', 1)
    return next(e)
  })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from iTerm2: profile Default background)')
  expect(ran.text).toContain("terminal herdr (in iTerm2, from the server's start): ")
})

// herdr in Ghostty (the server's variables), with pictures, the theme on
// auto: `answers` are herdr's OSC 11 replies in turn ('' or none left: no
// answer), `config` Ghostty's +show-config, `run` answers a command first.
const herdrOk = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
function herdrWorld(on: any, o: {
  answers?: string[]
  config?: () => string
  env?: Record<string, string>
  stored?: Record<string, unknown>
  setting?: string
  run?: (argv: string[]) => ReturnType<typeof herdrOk> | undefined
}) {
  S.keyAt = Number.NEGATIVE_INFINITY
  mock.store(on, o.stored)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM_PROGRAM: 'herdr', HERDR_ENV: '1', TERM: 'xterm-256color', GHOSTTY_RESOURCES_DIR: '/R', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', ...o.env })
  on('config.list', async () => ({ value: [{ key: 'theme', value: o.setting ?? 'auto' }] as any }))
  on('config.set', async ($: any, e: any) => ({ value: e.value }))
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'dismissed' }))
  on('prompt.edit', async ($: any, e: any) => ({ text: e.text + e.inputText, cursor: e.text.length + e.inputText.length }))
  const w = { probes: 0, clock }
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    const own = o.run?.(argv)
    if (own) return own
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return herdrOk('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'perl' && cmd.includes('11;?')) return herdrOk(o.answers?.[w.probes++] ?? '')
    if (argv[0] === 'sh' && cmd.includes('+show-config')) return herdrOk(o.config?.() ?? 'background = #1d1f21\n')
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return herdrOk('', 1)
    return next(e)
  })
  return w
}
const modeOf = async ($: any) => (await $.command.run({ command: 'iui', args: 'details' } as any)).text as string
const typeKey = async ($: any) => ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' })
const WHITE = '\x1b]11;rgb:ffff/ffff/ffff\x1b\\'
const BLACK = '\x1b]11;rgb:0000/0000/0000\x07'
const HERDR_LIGHT = 'mode light (auto, from herdr: OSC 11 background of the terminal in front)'

// herdr answers OSC 11 with the background of the terminal in front: it is
// the first source of auto. The probe reads the tty that Claude Code reads
// (a key or a mouse report can go to it), so it runs at the start, not on
// a timer: the answer stays while the terminal's config (or the OS) gives
// the mode it gave then, and a change there wins.
test('with the theme on auto, herdr asks OSC 11 at the start only, keeps the answer while the config stays, and follows a change of the config', async ($, on) => {
  let config = 'background = #1d1f21\n'
  const w = herdrWorld(on, { answers: [WHITE], config: () => config })
  expect(await modeOf($)).toContain(HERDR_LIGHT)
  expect(w.probes).toBe(1)
  // No timed probe: 30 s of polls (each 1 s, the mode each 3 s) ask nothing.
  await w.clock.advance(30000)
  expect(w.probes).toBe(1)
  expect(await modeOf($)).toContain(HERDR_LIGHT)
  // Ghostty's config changes (a theme that follows the OS): it wins at the next mode read.
  config = 'background = #fafafa\n'
  await w.clock.advance(3000)
  expect(await modeOf($)).toContain('mode light (auto, from Ghostty: config background)')
  config = 'background = #1d1f21\n'
  await w.clock.advance(3000)
  expect(await modeOf($)).toContain('mode dark (auto, from Ghostty: config background)')
  expect(w.probes).toBe(1)
})

// A missed answer (Claude Code read it): tried again at the next polls, 3 times at most.
test('under herdr, a missed OSC 11 answer is asked at most 3 times, then the config counts', async ($, on) => {
  const w = herdrWorld(on, { answers: [] })
  expect(await modeOf($)).toContain('mode dark (auto, from Ghostty: config background)')
  await w.clock.advance(10000)
  expect(w.probes).toBe(3)
  await w.clock.advance(20000)
  expect(w.probes).toBe(3)
  expect(await modeOf($)).toContain('mode dark (auto, from Ghostty: config background)')
})

// The start probe waits until 2 s pass with no key in the prompt box.
test('under herdr, the start OSC 11 probe waits for 2 s with no key in the prompt', async ($, on) => {
  try {
    const w = herdrWorld(on, { answers: [WHITE] })
    await typeKey($)
    await w.clock.settle()
    expect(await modeOf($)).toContain('mode dark (auto, from Ghostty: config background)')
    expect(w.probes).toBe(0)
    // A key each 500 ms for 6 s: no probe.
    for (let i = 0; i < 12; i++) {
      await typeKey($)
      await w.clock.advance(500)
    }
    expect(w.probes).toBe(0)
    // 2 s with no key: the next poll asks, once.
    await w.clock.advance(3000)
    expect(w.probes).toBe(1)
    expect(await modeOf($)).toContain(HERDR_LIGHT)
    await w.clock.advance(9000)
    expect(w.probes).toBe(1)
  } finally {
    S.keyAt = Number.NEGATIVE_INFINITY
  }
})

// Where the mod draws no herdr pictures, or is off, or the theme was not
// auto at the start (/config is a dialog: a key there is not seen), no probe.
for (const [why, o] of [
  ['Claude Code draws no pictures (setup not done)', { env: { CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '' } }],
  ['the mod is stored off', { stored: { enabled: false } }],
] as const) {
  test(`under herdr with the theme on auto, no OSC 11 probe when ${why}`, async ($, on) => {
    try {
      const w = herdrWorld(on, { answers: [WHITE], ...o })
      await modeOf($)
      await w.clock.advance(9000)
      expect(w.probes).toBe(0)
      expect(await modeOf($)).toContain('mode dark (auto, from Ghostty: config background)')
    } finally {
      S.isOff = false
    }
  })
}

test('under herdr, the theme set to auto later asks no OSC 11 (a dialog can be open), not even at the next polls', async ($, on) => {
  const w = herdrWorld(on, { answers: [WHITE], setting: 'dark' })
  await modeOf($)
  await $.config.set({ key: 'theme', value: 'auto' } as any)
  await w.clock.advance(9000)
  expect(w.probes).toBe(0)
  expect(await modeOf($)).toContain('mode dark (auto, from Ghostty: config background)')
})

// A new herdr client (another terminal in front) is asked again, once.
test('under herdr, a new client in front is asked OSC 11 again, once', async ($, on) => {
  const ghostty = 'pid 50390\natime 10\ntty ttys012\ncmd herdr\napp /Applications/Ghostty.app/Contents/MacOS/ghostty -e herdr\nenv\nherdr TERM=xterm-ghostty TERM_PROGRAM=ghostty GHOSTTY_BIN_DIR=/G\n'
  const kitty = 'pid 54346\natime 20\ntty ttys021\ncmd herdr\napp /Applications/kitty.app/Contents/MacOS/kitty herdr\nenv\nherdr TERM=xterm-kitty KITTY_WINDOW_ID=1\n'
  let front = 'com.mitchellh.ghostty'
  const w = herdrWorld(on, {
    answers: [BLACK, WHITE],
    run: argv =>
      argv[2] === HERDR_CLIENT_SH ? herdrOk(`front ${front}\n${ghostty}${kitty}`)
      : argv[2] === HERDR_TICK_SH ? herdrOk(`front ${front}\n${argv.slice(5).map(tty => `atime ${tty} 10\n`).join('')}`)
      : undefined,
  })
  expect(await modeOf($)).toContain('mode dark (auto, from herdr: OSC 11 background of the terminal in front)')
  await w.clock.advance(5000)
  expect(w.probes).toBe(1)
  front = 'net.kovidgoyal.kitty'
  await w.clock.advance(1000)
  expect(w.probes).toBe(2)
  expect(await modeOf($)).toContain(HERDR_LIGHT)
  await w.clock.advance(9000)
  expect(w.probes).toBe(2)
})

// herdr --remote: the pane is over ssh (the mod runs on the remote
// computer), but herdr's OSC 11 answer is still the user's terminal; it
// stays while COLORFGBG (the only other source there) does not change.
test('with the theme on auto, a remote herdr pane takes the OSC 11 background at the start, before COLORFGBG', async ($, on) => {
  const w = herdrWorld(on, {
    answers: [BLACK],
    env: { GHOSTTY_RESOURCES_DIR: '', SSH_CONNECTION: '1 2 3 4', COLORFGBG: '0;15' },
    run: argv => (argv[0] === 'sh' && /cc-intelligent-ui-/.test(argv.join(' ')) ? herdrOk('/tmp/mdp\nLinux\n') : undefined),
  })
  expect(await modeOf($)).toContain('mode dark (auto, from herdr: OSC 11 background of the terminal in front)')
  await w.clock.advance(9000)
  expect(await modeOf($)).toContain('mode dark (auto, from herdr: OSC 11 background of the terminal in front)')
  expect(w.probes).toBe(1)
})

// herdr with no hint of its terminal: as before, COLORFGBG, then the OS.
test('with the theme on auto, herdr in a terminal it does not know follows the OS', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  mock.env(on, { HOME: '/h', TERM_PROGRAM: 'herdr', HERDR_ENV: '1', TERM: 'xterm-256color', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const ran: string[] = []
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    ran.push(cmd)
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('', 1)
    return next(e)
  })
  const got = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(got.text).toContain('mode light (auto, from macOS)')
  expect(ran.some(c => c.includes('+show-config') || c.includes('TabStyleWithAutomaticOption'))).toBe(false)
})

// kitty on a light Mac: kitty.conf's included theme is dark; once auto theme
// files exist, the one for the OS scheme is used.
test('with the theme on auto, kitty draws as its config or auto theme is', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  let osDark = false
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(argv.join(' '))) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return osDark ? ok('Dark\n') : ok('', 1)
    return next(e)
  })
  const files: Record<string, string> = {
    '/h/.config/kitty/kitty.conf': 'font_family family="JetBrains Mono" style=Regular\ninclude current-theme.conf\n',
    '/h/.config/kitty/current-theme.conf': 'background #1e1e2e\n',
  }
  const inKitty = (path: string) => path.includes('kitty')
  on('fs.exists', async ($: any, e: any, next: any) => (inKitty(e.path) ? { value: e.path in files } : next(e)))
  on('fs.read', async ($: any, e: any, next: any) => (e.path in files ? { value: files[e.path] } : inKitty(e.path) ? ({ deny: 'no such file' } as any) : next(e)))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from kitty: config background)')
  expect(ran.text).toContain('terminal font JetBrains Mono')
  files['/h/.config/kitty/dark-theme.auto.conf'] = 'background #191724\n'
  files['/h/.config/kitty/light-theme.auto.conf'] = 'background #fafafa\n'
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode light (auto, from kitty: light-theme.auto.conf background)')
  osDark = true
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode dark (auto, from kitty: dark-theme.auto.conf background)')
})

// Rio on a dark Mac with an [adaptive-theme]: the OS picks the theme file;
// force-theme wins over the OS.
test('with the theme on auto, Rio draws as its adaptive theme is', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM_PROGRAM: 'rio', TERM: 'xterm-256color' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(argv.join(' '))) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('Dark\n')
    return next(e)
  })
  const files: Record<string, string> = {
    '/h/.config/rio/config.toml': '[fonts]\nfamily = "Iosevka"\n\n[adaptive-theme]\nlight = "day"\ndark = "night"\n',
    '/h/.config/rio/themes/day.toml': '[colors]\nbackground = "#FFFFFF"\n',
    '/h/.config/rio/themes/night.toml': '[colors]\nbackground = "#191724"\n',
  }
  on('fs.read', async ($: any, e: any, next: any) => (e.path in files ? { value: files[e.path] } : e.path.includes('/rio/') ? ({ deny: 'no such file' } as any) : next(e)))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from Rio: theme night background)')
  expect(ran.text).toContain('terminal font Iosevka')
  files['/h/.config/rio/config.toml'] = 'force-theme = "light"\n' + files['/h/.config/rio/config.toml']
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode light (auto, from Rio: theme day background)')
})

// Over ssh the configs and the OS here are the remote computer's: auto uses
// only COLORFGBG, else dark, and the terminal font is not read.
for (const colorFgBg of [undefined, '0;15']) {
  test(`with the theme on auto over ssh, kitty's config and the OS are not read (COLORFGBG ${colorFgBg ?? 'not set'})`, async ($, on) => {
    mock.store(on)
    mock.clock(on)
    mock.env(on, { HOME: '/h', TERM: 'xterm-kitty', SSH_CONNECTION: '10.0.0.2 50000 10.0.0.1 22', ...(colorFgBg ? { COLORFGBG: colorFgBg } : {}) })
    on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
    const asked: string[] = []
    const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    on('process.run', async ($: any, e: any, next: any) => {
      const argv: string[] = e.argv
      if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(argv.join(' '))) return ok('/tmp/mdp\nDarwin\n')
      if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) {
        asked.push('macOS')
        return ok('', 1)
      }
      return next(e)
    })
    on('fs.exists', async ($: any, e: any, next: any) => (e.path.includes('kitty') ? (asked.push(e.path), { value: false }) : next(e)))
    on('fs.read', async ($: any, e: any, next: any) => (e.path.includes('kitty') ? (asked.push(e.path), { deny: 'no such file' } as any) : next(e)))
    const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
    expect(ran.text).toContain(colorFgBg ? 'mode light (auto, from COLORFGBG)' : 'mode dark (auto, OS appearance not known, dark assumed)')
    expect(ran.text).toContain('terminal font not known (Menlo assumed)')
    expect(asked).toEqual([])
  })
}

// cmux (Ghostty inside) with no colours in the Ghostty config: its adaptive
// default theme follows cmux's appearance; turned off, Ghostty's dark default.
// A theme in cmux's own config (its themes picker) wins.
test('with the theme on auto, cmux draws as its appearance is', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty', CMUX_SURFACE_ID: 'S1', GHOSTTY_RESOURCES_DIR: '/r' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  let saved = 'system\n'
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'sh' && cmd.includes('+show-config')) return ok('font-family = Menlo\n')
    if (argv[0] === 'defaults' && argv.includes('com.cmuxterm.app')) return ok(saved)
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('', 1)
    return next(e)
  })
  let cmuxJson: string | null = null
  let cmuxConfig: string | null = null
  const files: Record<string, string> = { '/r/themes/Paper': 'background = #fafafa\n', '/r/themes/Ink': 'background = #101010\n' }
  on('fs.read', async ($: any, e: any, next: any) => {
    if (e.path === '/h/.config/cmux/cmux.json') return cmuxJson === null ? ({ deny: 'no such file' } as any) : { value: cmuxJson }
    if (e.path === '/h/Library/Application Support/com.cmuxterm.app/config.ghostty') return cmuxConfig === null ? ({ deny: 'no such file' } as any) : { value: cmuxConfig }
    if (e.path in files) return { value: files[e.path] }
    if (e.path.startsWith('/h/') || e.path.startsWith('/r/')) return { deny: 'no such file' } as any
    return next(e)
  })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode light (auto, from cmux: adaptive default theme, appearance system)')
  saved = 'dark\n'
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode dark (auto, from cmux: adaptive default theme, appearance dark)')
  saved = 'system\n'
  cmuxJson = '{\n  // off\n  "terminal": { "adaptiveDefaultTheme": false, },\n}'
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode dark (auto, from Ghostty: default background)')
  // The cmux themes picker writes cmux's own config: one theme, then a
  // light:dark pair that follows cmux's appearance (system: the OS, light).
  cmuxJson = null
  cmuxConfig = '# cmux themes start\ntheme = Paper\n# cmux themes end\n'
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode light (auto, from cmux: theme Paper background)')
  cmuxConfig = '# cmux themes start\ntheme = light:Ink,dark:Paper\n# cmux themes end\n'
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode dark (auto, from cmux: theme Ink background)')
  saved = 'dark\n'
  await clock.advance(3000)
  expect((await $.command.run({ command: 'iui', args: 'details' } as any)).text).toContain('mode light (auto, from cmux: theme Paper background)')
})

// iTerm2 whose TERM_PROGRAM did not come through: ITERM_PROFILE says iTerm2.
test('with the theme on auto, iTerm2 with no TERM_PROGRAM is found by ITERM_PROFILE', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  mock.env(on, { HOME: '/fake-home', TERM: 'xterm-256color', ITERM_PROFILE: 'Default', LC_TERMINAL_VERSION: '3.7.5' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'auto' }] as any }))
  const dark = { 'Red Component': 0.11, 'Green Component': 0.15, 'Blue Component': 0.17 }
  const marks = JSON.stringify([{ Name: 'Default', Guid: 'G1', 'Background Color': dark }])
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(cmd)) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'sh' && cmd.includes('TabStyleWithAutomaticOption')) return ok(`1\n@\nG1\n@\n${marks}\n`)
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('', 1)
    return next(e)
  })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from iTerm2: profile Default background)')
})

// A fixed theme (or none) never asks the OS or the terminal.
for (const [theme, mode, shown] of [
  [undefined, 'dark', 'dark'], ['dark', 'dark', 'dark'], ['light', 'light', 'light'], ['dark-daltonized', 'dark', 'dark-daltonized'],
  ['light-ansi', 'light', 'light-ansi'], ['', 'dark', 'dark'],
] as const) {
  test(`with the theme ${theme === undefined ? 'not set' : JSON.stringify(theme)}, the mode is ${mode} and no OS read is made`, async ($, on) => {
    mock.store(on)
    mock.clock(on)
    mock.env(on, { HOME: '/fake-home' })
    on('config.list', async () => ({ value: (theme === undefined ? [] : [{ key: 'theme', value: theme }]) as any }))
    const asked: string[] = []
    on('process.run', async ($: any, e: any, next: any) => {
      const argv: string[] = e.argv
      if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(argv.join(' '))) return { value: { exitCode: 0, stdout: '/tmp/mdp\nDarwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (argv[0] === 'defaults') asked.push('macOS')
      return next(e)
    })
    const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
    expect(ran.text).toContain(`mode ${mode} (Claude Code theme ${shown})`)
    expect(asked).toEqual([])
  })
}

test('a theme setting that names no mode (a custom theme) follows the OS like auto', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  mock.env(on, { HOME: '/fake-home' })
  on('config.list', async () => ({ value: [{ key: 'theme', value: 'custom:night-owl' }] as any }))
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'sh' && /cc-intelligent-ui-/.test(argv.join(' '))) return ok('/tmp/mdp\nDarwin\n')
    if (argv[0] === 'defaults' && argv.includes('AppleInterfaceStyle')) return ok('Dark\n')
    return next(e)
  })
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('mode dark (auto, from macOS)')
})
