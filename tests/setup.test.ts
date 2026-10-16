import { expect, mock, test } from 'claude-code/testing'

import { hasSetup, parseCommand, SETUP_END, SETUP_START, setupBlock, shellRcOf, withoutSetup, withSetup } from '../hooks/register'

test('the setup writes the start file of the login shell', () => {
  expect(shellRcOf({ shell: '/bin/zsh', home: '/h', isMac: true })).toEqual({ path: '/h/.zshrc', kind: 'sh' })
  expect(shellRcOf({ shell: '/bin/zsh', home: '/h', zdotdir: '/z', isMac: true })!.path).toBe('/z/.zshrc')
  expect(shellRcOf({ shell: '/bin/bash', home: '/h', isMac: true })!.path).toBe('/h/.bash_profile')
  expect(shellRcOf({ shell: '/bin/bash', home: '/h', isMac: false })!.path).toBe('/h/.bashrc')
  expect(shellRcOf({ shell: '/opt/homebrew/bin/fish', home: '/h', isMac: true })).toEqual({ path: '/h/.config/fish/conf.d/md-preview.fish', kind: 'fish' })
  expect(shellRcOf({ shell: '/bin/tcsh', home: '/h', isMac: true })).toBe(null)
})

test('the block sets the variable in iTerm2 only, not in tmux or screen', () => {
  const sh = setupBlock('sh')
  expect(sh.startsWith(`${SETUP_START}\n`)).toBe(true)
  expect(sh.endsWith(`${SETUP_END}\n`)).toBe(true)
  expect(sh).toContain('[ "$TERM_PROGRAM" = "iTerm.app" ] && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi')
  expect(setupBlock('fish')).toContain('set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1')
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

test('/md-preview setup and setup remove are commands', () => {
  expect(parseCommand('setup')).toEqual({ kind: 'setup', remove: false })
  expect(parseCommand('Setup Remove')).toEqual({ kind: 'setup', remove: true })
  expect(parseCommand('setup now')).toEqual({ kind: 'bad' })
})

// An iTerm2 session on a Mac with the engine's pictures off and a zsh user.
const iterm = (on: any, files: Record<string, string>, answer: string | null) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', SHELL: '/bin/zsh', TERM_PROGRAM: 'iTerm.app', ITERM_PROFILE: 'Default' })
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
  on('ui.toast', async ($: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.log', async ($: any, e: any) => (logs.push(e.text), { value: undefined }))
  on('process.run', async ($: any, e: any, next: any) =>
    e.argv[0] === 'sh' && /md-preview-/.test(e.argv.join(' '))
      ? { value: { exitCode: 0, stdout: '/tmp/mdp\nDarwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : next(e))
  on('fs.read', async ($: any, e: any, next: any) => (e.path in files ? { value: files[e.path] } : e.path.startsWith('/h/') ? { deny: 'no such file' } : next(e)))
  on('fs.exists', async ($: any, e: any, next: any) => (e.path.startsWith('/h/') ? { value: e.path in files } : next(e)))
  on('fs.write', async ($: any, e: any, next: any) => {
    if (!e.path.startsWith('/h/')) return next(e)
    files[e.path] = e.text
    return { value: undefined }
  })
  return { asked, clock, toasts, logs }
}

test('in iTerm2 with pictures off, the plugin asks once and adds the block on yes', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const { asked, clock, toasts, logs } = iterm(on, files, 'Add the line')
  const shown = await $.command.run({ command: 'md-preview', args: '' } as any)
  expect(shown.text).toContain('run /md-preview setup once')
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('~/.zshrc')
  expect(hasSetup(files['/h/.zshrc']!)).toBe(true)
  expect(Object.keys(files)).toEqual(['/h/.zshrc'])
  expect(toasts.filter(t => /tab/.test(t))).toEqual(['Close this tab and open a new iTerm2 tab to see pictures.'])
  expect(logs.some(l => l.includes('Added the md-preview block to /h/.zshrc') && l.includes('Close this tab'))).toBe(true)
  const again = await $.command.run({ command: 'md-preview', args: 'setup' } as any)
  expect(again.text).toContain('already has the md-preview block')
  expect(again.text).toContain('Close this tab, open a new iTerm2 tab')
  const removed = await $.command.run({ command: 'md-preview', args: 'setup remove' } as any)
  expect(removed.text).toContain('Removed the md-preview block from /h/.zshrc')
  expect(files['/h/.zshrc']).toBe('export A=1\n')
})

test('a dismissed question changes no file', async ($, on) => {
  const files: Record<string, string> = { '/h/.zshrc': 'export A=1\n' }
  const { asked, clock } = iterm(on, files, null)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(files['/h/.zshrc']).toBe('export A=1\n')
})
