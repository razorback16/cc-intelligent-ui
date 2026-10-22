import { expect, mock, test } from 'claude-code/testing'

import { hasNewSetup, hasSetup, SETUP_END, SETUP_START, setupBlock, setupWordsOf, shellRcOf, withoutSetup, withSetup } from '../hooks/register'

test('the setup writes the start file of the login shell', () => {
  expect(shellRcOf({ shell: '/bin/zsh', home: '/h', isMac: true })).toEqual({ path: '/h/.zshrc', kind: 'sh' })
  expect(shellRcOf({ shell: '/bin/zsh', home: '/h', zdotdir: '/z', isMac: true })!.path).toBe('/z/.zshrc')
  expect(shellRcOf({ shell: '/bin/bash', home: '/h', isMac: true })!.path).toBe('/h/.bash_profile')
  expect(shellRcOf({ shell: '/bin/bash', home: '/h', isMac: false })!.path).toBe('/h/.bashrc')
  expect(shellRcOf({ shell: '/opt/homebrew/bin/fish', home: '/h', isMac: true })).toEqual({ path: '/h/.config/fish/conf.d/cc-intelligent-ui.fish', kind: 'fish' })
  expect(shellRcOf({ shell: '/bin/tcsh', home: '/h', isMac: true })).toBe(null)
})

test('the start file: an empty ZDOTDIR or XDG_CONFIG_HOME is not used, a shell with no path works, no shell gives none', () => {
  expect(shellRcOf({ shell: 'zsh', home: '/h', zdotdir: '', isMac: false })!.path).toBe('/h/.zshrc')
  expect(shellRcOf({ shell: '/usr/bin/fish', home: '/h', xdgConfig: '/x', isMac: false })!.path).toBe('/x/fish/conf.d/cc-intelligent-ui.fish')
  expect(shellRcOf({ shell: '/usr/bin/fish', home: '/h', xdgConfig: '', isMac: false })!.path).toBe('/h/.config/fish/conf.d/cc-intelligent-ui.fish')
  expect(shellRcOf({ shell: '', home: '/h', isMac: true })).toBe(null)
  expect(shellRcOf({ shell: '/bin/zsh-5.9', home: '/h', isMac: true })).toBe(null)
})

test('the block sets the variable in iTerm2 and herdr only, not in tmux or screen', () => {
  const sh = setupBlock('sh')
  expect(sh.startsWith(`${SETUP_START}\n`)).toBe(true)
  expect(sh.endsWith(`${SETUP_END}\n`)).toBe(true)
  expect(sh).toContain(
    'if { [ "$TERM_PROGRAM" = "iTerm.app" ] || [ "$TERM_PROGRAM" = "herdr" ]; } && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi',
  )
  const fish = setupBlock('fish')
  expect(fish.startsWith(`${SETUP_START}\n`)).toBe(true)
  expect(fish).toContain(
    'if test "$TERM_PROGRAM" = "iTerm.app" -o "$TERM_PROGRAM" = "herdr"; and not set -q TMUX; and not set -q STY; set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1; end',
  )
})

// The block of 0.3.2 and before: iTerm2 only.
const OLD_SH = `${SETUP_START}\nif [ "$TERM_PROGRAM" = "iTerm.app" ] && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi\n${SETUP_END}\n`
const OLD_FISH = `${SETUP_START}\nif test "$TERM_PROGRAM" = "iTerm.app"; and not set -q TMUX; and not set -q STY; set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1; end\n${SETUP_END}\n`

test('an old block (iTerm2 only) is a block, but not the new one; adding the block replaces it', () => {
  const rc = `export A=1\n\n${OLD_SH}`
  expect(hasSetup(rc)).toBe(true)
  expect(hasNewSetup(rc, 'sh')).toBe(false)
  const now = withSetup(rc, 'sh')
  expect(now).toBe(`export A=1\n\n${setupBlock('sh')}`)
  expect(hasNewSetup(now, 'sh')).toBe(true)
  expect(hasNewSetup(withSetup(OLD_FISH, 'fish'), 'fish')).toBe(true)
  expect(hasNewSetup(OLD_FISH, 'fish')).toBe(false)
  // The sh block is not the fish one.
  expect(hasNewSetup(setupBlock('sh'), 'fish')).toBe(false)
})

test('the words for the terminal: herdr panes, iTerm2 tabs', () => {
  expect(setupWordsOf(true)).toEqual({ app: 'herdr', tab: 'pane' })
  expect(setupWordsOf(false)).toEqual({ app: 'iTerm2', tab: 'tab' })
})

test('adding the block twice keeps one; removing it gives the file back', () => {
  const rc = 'export PATH=/x:$PATH\nalias ll="ls -l"\n'
  const once = withSetup(rc, 'sh')
  expect(hasSetup(once)).toBe(true)
  expect(withSetup(once, 'sh')).toBe(once)
  expect(once.split(SETUP_START).length).toBe(2)
  expect(withoutSetup(once)).toBe('export PATH=/x:$PATH\nalias ll="ls -l"\n')
  expect(withSetup('', 'sh')).toBe(setupBlock('sh'))
  // A start marker with no end marker is left as it is.
  expect(withoutSetup(`a\n${SETUP_START}\nb`)).toBe(`a\n${SETUP_START}\nb`)
})

test('removing the block leaves the lines around it; every block goes; a file with none is the same', () => {
  const block = setupBlock('sh')
  expect(withoutSetup(`a\n\n${block}\nb\n`)).toBe('a\n\nb\n')
  expect(withoutSetup(`${block}b\n`)).toBe('b\n')
  expect(withoutSetup(`a\n\n${block}\nb\n\n${block}`)).toBe('a\n\nb\n')
  expect(withoutSetup('a\nb\n')).toBe('a\nb\n')
  expect(withoutSetup('')).toBe('')
  expect(hasSetup('a\n')).toBe(false)
})

test('a block of the other kind is replaced, not added next to the first', () => {
  const fish = withSetup('set -x A 1\n', 'fish')
  const sh = withSetup(fish, 'sh')
  expect(sh.split(SETUP_START).length).toBe(2)
  expect(sh).not.toContain('set -gx')
  expect(sh.startsWith('set -x A 1\n\n')).toBe(true)
})

// An iTerm2 session on a Mac with the engine's pictures off and a zsh user
// (`os`: another OS, `answer`: the option chosen, any question).
const iterm = (on: any, files: Record<string, string>, answer: string | null, o: { env?: Record<string, string>; stored?: Record<string, unknown>; os?: string } = {}) => {
  const store = new Map(Object.entries(o.stored ?? {}))
  on('store.get', async ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async ($: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', SHELL: '/bin/zsh', TERM_PROGRAM: 'iTerm.app', ITERM_PROFILE: 'Default', ...o.env })
  const asked: string[] = []
  // $.ui.ask runs as a call of the AskUserQuestion tool.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($: any, e: any) => {
    const qs = e.questions
    asked.push(qs[0].question)
    if (answer === null) return { deny: 'dismissed' }
    return { result: { questions: qs, answers: { [qs[0].question]: answer } } }
  })
  const toasts: string[] = []
  const logs: string[] = []
  const mkdirs: string[] = []
  on('ui.toast', async ($: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.log', async ($: any, e: any) => (logs.push(e.text), { value: undefined }))
  on('process.run', async ($: any, e: any, next: any) => {
    if (e.argv[0] === 'mkdir') return mkdirs.push(e.argv.slice(1).join(' ')), { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return e.argv[0] === 'sh' && /cc-intelligent-ui-/.test(e.argv.join(' '))
      ? { value: { exitCode: 0, stdout: `/tmp/mdp\n${o.os ?? 'Darwin'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : next(e)
  })
  on('fs.read', async ($: any, e: any, next: any) => (e.path in files ? { value: files[e.path] } : e.path.startsWith('/h/') ? { deny: 'no such file' } : next(e)))
  on('fs.exists', async ($: any, e: any, next: any) => (e.path.startsWith('/h/') ? { value: e.path in files } : next(e)))
  on('fs.write', async ($: any, e: any, next: any) => {
    if (!e.path.startsWith('/h/')) return next(e)
    files[e.path] = e.text
    return { value: undefined }
  })
  return { asked, clock, toasts, logs, store, mkdirs }
}

test('in iTerm2 with pictures off, the plugin asks once and adds the block on yes', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const { asked, clock, toasts, logs } = iterm(on, files, 'Add the line')
  const shown = await $.command.run({ command: 'iui', args: '' } as any)
  expect(shown.text).toContain('run /iui setup once')
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('~/.zshrc')
  expect(hasSetup(files['/h/.zshrc']!)).toBe(true)
  expect(Object.keys(files)).toEqual(['/h/.zshrc'])
  expect(toasts.filter(t => /tab/.test(t))).toEqual(['Close this tab and open a new iTerm2 tab to see pictures.'])
  expect(logs.some(l => l.includes('Added the Intelligent UI block to /h/.zshrc') && l.includes('Close this tab'))).toBe(true)
  const again = await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(again.text).toContain('already has the Intelligent UI block')
  expect(again.text).toContain('Close this tab, open a new iTerm2 tab')
  const removed = await $.command.run({ command: 'iui', args: 'setup remove' } as any)
  expect(removed.text).toContain('Removed the Intelligent UI block from /h/.zshrc')
  expect(files['/h/.zshrc']).toBe('export A=1\n')
})

test('a dismissed question changes no file', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const { asked, clock } = iterm(on, files, null)
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(files['/h/.zshrc']).toBe('export A=1\n')
})

test('"Never ask" is kept, and later loads do not ask', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const first = iterm(on, files, 'Never ask')
  await $.command.run({ command: 'iui', args: '' } as any)
  await first.clock.settle()
  expect(first.asked.length).toBe(1)
  expect(first.store.get('setup')).toBe('never')
  expect(files['/h/.zshrc']).toBe('export A=1\n')
  expect(first.toasts.filter(t => /tab|transcript/.test(t))).toEqual([])
})

test('a block already there means no question', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': withSetup('export A=1\n', 'sh') }
  const { asked, clock } = iterm(on, files, 'Add the line')
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked).toEqual([])
})

test('a stored "never" means no question', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const { asked, clock } = iterm(on, files, 'Add the line', { stored: { setup: 'never' } })
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked).toEqual([])
  expect(files['/h/.zshrc']).toBe('export A=1\n')
})

test('"Not now" changes no file and is not kept', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const { asked, clock, store } = iterm(on, files, 'Not now')
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(files['/h/.zshrc']).toBe('export A=1\n')
  expect(store.has('setup')).toBe(false)
})

test('the question is asked once per load, not at each /iui', async ($, on) => {
  const { asked, clock } = iterm(on, { '/h/.zshrc': '' }, 'Not now')
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked.length).toBe(1)
})

test('with a shell it does not know, /iui setup changes no file and names the line to add; the question says the start file is unknown', async ($, on) => {
  const files: Record<string, string> = {}
  const { asked, clock } = iterm(on, files, 'Not now', { env: { SHELL: '/bin/tcsh' } })
  const ran = await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(ran.text).toContain('does not know your shell, so it changed no file')
  expect(ran.text).toContain('export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1')
  await clock.settle()
  expect(asked[0]).toContain("your shell's start file")
  expect(files).toEqual({})
})

test('/iui setup remove with no block says so and writes nothing', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  iterm(on, files, 'Not now', { stored: { setup: 'never' } })
  const ran = await $.command.run({ command: 'iui', args: 'setup remove' } as any)
  expect(ran.text).toBe('/h/.zshrc has no Intelligent UI block.')
  expect(files['/h/.zshrc']).toBe('export A=1\n')
})

test('/iui setup makes a start file that does not exist yet, with only the block', async ($, on) => {
  const files: Record<string, string> = {}
  iterm(on, files, 'Not now', { stored: { setup: 'never' } })
  const ran = await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(ran.text).toContain('Added the Intelligent UI block to /h/.zshrc.')
  expect(files['/h/.zshrc']).toBe(setupBlock('sh'))
})

test('for fish, /iui setup makes the conf.d folder first and writes the fish block; XDG_CONFIG_HOME is used', async ($, on) => {
  const files: Record<string, string> = {}
  const { mkdirs } = iterm(on, files, 'Not now', { stored: { setup: 'never' }, env: { SHELL: '/usr/bin/fish', XDG_CONFIG_HOME: '/h/x' } })
  await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(mkdirs).toEqual(['-p /h/x/fish/conf.d'])
  expect(files['/h/x/fish/conf.d/cc-intelligent-ui.fish']).toBe(setupBlock('fish'))
  const removed = await $.command.run({ command: 'iui', args: 'setup remove' } as any)
  expect(removed.text).toContain('Removed the Intelligent UI block from /h/x/fish/conf.d/cc-intelligent-ui.fish.')
  expect(files['/h/x/fish/conf.d/cc-intelligent-ui.fish']).toBe('')
})

test('the question shows the start file with ~ for the home folder, and ZDOTDIR moves it', async ($, on) => {
  const files: Record<string, string> = { '/h/.zsh/.zshrc': '' }
  const { asked, clock } = iterm(on, files, 'Not now', { env: { ZDOTDIR: '/h/.zsh' } })
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked[0]).toContain('~/.zsh/.zshrc')
})

test('a yes with a shell it does not know changes no file; the toast points to the transcript', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': '' }
  const { clock, toasts } = iterm(on, files, 'Add the line', { env: { SHELL: '/bin/tcsh' } })
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  // The shell is not known: the question was asked, a yes changes no file.
  expect(files['/h/.zshrc']).toBe('')
  expect(toasts.filter(t => /transcript|tab/.test(t))).toEqual(['See the transcript for the setup.'])
})

// ---- herdr ------------------------------------------------------------------------

// A herdr pane (in no known terminal) with the engine's pictures off.
const HERDR = { TERM_PROGRAM: 'herdr', TERM_PROGRAM_VERSION: '0.9.5', HERDR_ENV: '1', TERM: 'xterm-256color', ITERM_PROFILE: '' }

test('in herdr with pictures off, the plugin asks once and adds the block on yes; the texts name herdr panes', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const { asked, clock, toasts, logs } = iterm(on, files, 'Add the line', { env: HERDR })
  const shown = await $.command.run({ command: 'iui', args: '' } as any)
  expect(shown.text).toContain('In herdr, run /iui setup once to show pictures.')
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('in herdr Claude Code needs CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1')
  expect(asked[0]).toContain('Add one line to ~/.zshrc that sets it in iTerm2 and herdr only')
  expect(files['/h/.zshrc']).toBe(`export A=1\n\n${setupBlock('sh')}`)
  expect(toasts.filter(t => /pane|tab/.test(t))).toEqual(['Close this pane and open a new herdr pane to see pictures.'])
  expect(logs.some(l => l.includes('Added the Intelligent UI block to /h/.zshrc. Close this pane, open a new herdr pane, and start Claude Code there'))).toBe(true)
  const again = await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(again.text).toBe('/h/.zshrc already has the Intelligent UI block. Close this pane, open a new herdr pane, and start Claude Code there to see pictures.')
  const removed = await $.command.run({ command: 'iui', args: 'setup remove' } as any)
  expect(removed.text).toBe('Removed the Intelligent UI block from /h/.zshrc. New herdr panes show answers as text.')
  expect(files['/h/.zshrc']).toBe('export A=1\n')
})

test('in herdr, an old block (iTerm2 only) is not enough: the question asks to update it, and a yes replaces it', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': `export A=1\n\n${OLD_SH}` }
  const { asked, clock, toasts, logs } = iterm(on, files, 'Update the line', { env: HERDR })
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('Update the Intelligent UI line in ~/.zshrc so that it sets it in herdr too')
  expect(files['/h/.zshrc']).toBe(`export A=1\n\n${setupBlock('sh')}`)
  expect(toasts.filter(t => /pane|tab/.test(t))).toEqual(['Close this pane and open a new herdr pane to see pictures.'])
  expect(logs.some(l => l.startsWith('Updated the Intelligent UI block in /h/.zshrc. Close this pane'))).toBe(true)
})

test('in herdr with the new block already there, no question', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': withSetup('export A=1\n', 'sh') }
  const { asked, clock } = iterm(on, files, 'Add the line', { env: HERDR })
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked).toEqual([])
})

test('in iTerm2, an old block is enough (no question); /iui setup updates it', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': OLD_SH }
  const { asked, clock } = iterm(on, files, 'Add the line')
  await $.command.run({ command: 'iui', args: '' } as any)
  await clock.settle()
  expect(asked).toEqual([])
  expect(files['/h/.zshrc']).toBe(OLD_SH)
  const ran = await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(ran.text).toBe('Updated the Intelligent UI block in /h/.zshrc. Close this tab, open a new iTerm2 tab, and start Claude Code there to see pictures. Undo with /iui setup remove.')
  expect(files['/h/.zshrc']).toBe(setupBlock('sh'))
})

test('in herdr on Linux, /iui setup writes the block to .bashrc for bash (herdr starts no login shell there)', async ($, on) => {
  const files: Record<string, string> = { '/h/.bashrc': 'export A=1\n' }
  const { asked, clock } = iterm(on, files, 'Not now', { os: 'Linux', env: { ...HERDR, SHELL: '/bin/bash' } })
  const shown = await $.command.run({ command: 'iui', args: '' } as any)
  expect(shown.text).toContain('In herdr, run /iui setup once to show pictures.')
  await clock.settle()
  expect(asked.length).toBe(1)
  const ran = await $.command.run({ command: 'iui', args: 'setup' } as any)
  expect(ran.text).toBe('Added the Intelligent UI block to /h/.bashrc. Close this pane, open a new herdr pane, and start Claude Code there to see pictures. Undo with /iui setup remove.')
  expect(files['/h/.bashrc']).toBe(`export A=1\n\n${setupBlock('sh')}`)
})

test('herdr with pictures on (the variable set): no question, no setup line', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': '' }
  const { asked, clock } = iterm(on, files, 'Add the line', { env: { ...HERDR, CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' } })
  const shown = await $.command.run({ command: 'iui', args: '' } as any)
  expect(shown.text).not.toContain('/iui setup once')
  await clock.settle()
  expect(asked).toEqual([])
})

test('herdr in iTerm2 (ITERM_PROFILE kept) asks the herdr question, never the iTerm2 one', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': '' }
  const { asked, clock } = iterm(on, files, 'Not now', { env: { ...HERDR, ITERM_PROFILE: 'Default' } })
  const shown = await $.command.run({ command: 'iui', args: '' } as any)
  expect(shown.text).toContain('In herdr, run /iui setup once')
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('in herdr Claude Code needs')
  expect(asked[0]).not.toContain('in iTerm2 Claude Code needs')
})
