import { expect, mock, test } from 'claude-code/testing'

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
  expect(ran.text).toContain('terminal herdr (in iTerm2): ')
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
