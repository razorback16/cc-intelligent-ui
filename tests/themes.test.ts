import { expect, mock, test } from 'claude-code/testing'

// A theme tree in memory: built-in themes under the mod's render/themes, user
// themes under $HOME/.claude/cc-intelligent-ui/themes.
const HOME = '/fake-home'
const USER = `${HOME}/.claude/cc-intelligent-ui/themes`
const files: Record<string, string> = {
  'render/themes/vscode/theme.json': '{"name":"VS Code","description":"built-in look"}',
  'render/themes/vscode-modern/theme.json': '{"name":"VS Code Modern","description":"modern look"}',
  'render/themes/claude-code/theme.json': '{"name":"Claude Code","description":"default look"}',
  'render/themes/nord/theme.json': '{"description":"built-in nord"}',
  [`${USER}/nord/theme.json`]: '{"description":"my nord"}',
  [`${USER}/Broken/theme.json`]: '{"name":',
  [`${USER}/Sun.Light/theme.json`]: '{"description":"bright"}',
  [`${USER}/Lost/theme.json`]: '{"syntax":{"dark":"gone.tmTheme"}}',
  [`${USER}/Own/theme.json`]: '{"description":"own colours","syntax":{"dark":"own.tmTheme"}}',
  [`${USER}/Own/own.tmTheme`]: '<plist/>',
}
const fileOf = (path: string) => Object.keys(files).find(f => (f.startsWith('/') ? path === f : path.endsWith(`/${f}`)))
const dirsIn = (path: string) => {
  const base = path.endsWith('/render/themes') ? 'render/themes' : path === USER ? USER : null
  if (!base) return null
  const names = new Set(Object.keys(files).filter(f => f.startsWith(`${base}/`)).map(f => f.slice(base.length + 1).split('/')[0]!))
  return [...names].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
}

const withThemes = (on: any, stored: Record<string, unknown> = {}) => {
  mock.env(on, { HOME })
  on('fs.list', async ($: any, e: any, next: any) => {
    const entries = dirsIn(e.path)
    return entries ? { value: entries } : next(e)
  })
  on('fs.exists', async ($: any, e: any, next: any) => (e.path.startsWith(`${USER}/`) ? { value: !!fileOf(e.path) } : next(e)))
  on('fs.read', async ($: any, e: any, next: any) => {
    const f = fileOf(e.path)
    return f ? { value: files[f]! } : next(e)
  })
  // The mod's store, in memory, for the test to read.
  const kept: Record<string, unknown> = { ...stored }
  on('store.get', async ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', async ($: any, e: any) => {
    kept[e.key] = e.value
    return { value: undefined }
  })
  return kept
}

test('/iui theme lists built-in and user themes; a user theme wins and a broken one is reported', async ($, on) => {
  withThemes(on)
  const ran = await $.command.run({ command: 'iui', args: 'theme' } as any)
  expect(ran.text).toContain('- claude-code (in use): default look')
  expect(ran.text).toContain('- vscode-modern: modern look')
  expect(ran.text).toContain('- vscode: built-in look')
  expect(ran.text).toContain('- nord (yours): my nord')
  expect(ran.text).toContain('- Sun.Light (yours): bright')
  expect(ran.text).toContain('- Broken (yours): not usable, theme.json is not valid JSON')
  expect(ran.text).toContain('Your own themes go in ~/.claude/cc-intelligent-ui/themes/<name>/theme.json.')
  expect(ran.text).toContain('- Lost (yours): not usable, theme.json names syntax files that do not exist: gone.tmTheme')
  expect(ran.text).toContain('- Own (yours): own colours')
})

test('/iui theme <name> switches and stores the name as typed; an unknown one is refused', async ($, on) => {
  const store = withThemes(on)
  const set = await $.command.run({ command: 'iui', args: 'theme Sun.Light' } as any)
  expect(set.text).toContain('Theme set to Sun.Light.')
  expect(set.text).toContain('- Sun.Light (yours, in use)')
  expect(store['theme-name']).toBe('Sun.Light')
  const shown = await $.command.run({ command: 'iui', args: '' } as any)
  expect(shown.text).toContain('theme Sun.Light')
  const bad = await $.command.run({ command: 'iui', args: 'theme sun.light' } as any)
  expect(bad.text).toContain('No usable theme named sun.light.')
  const broken = await $.command.run({ command: 'iui', args: 'theme Broken' } as any)
  expect(broken.text).toContain('No usable theme named Broken.')
  expect(store['theme-name']).toBe('Sun.Light')
})

test('a stored theme that is gone falls back to claude-code, with one toast', async ($, on) => {
  withThemes(on, { 'theme-name': 'gone' })
  const toasts: string[] = []
  on('ui.toast', async ($: any, e: any) => {
    toasts.push(String(e.text ?? e.message ?? JSON.stringify(e)))
    return { value: undefined }
  })
  const ran = await $.command.run({ command: 'iui', args: 'theme' } as any)
  expect(ran.text).toContain('- claude-code (in use)')
  expect(toasts.filter(t => t.includes('Intelligent UI: theme gone not found, using claude-code')).length).toBe(1)
})
