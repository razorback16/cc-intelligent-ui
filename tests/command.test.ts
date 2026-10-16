import { expect, mock, test } from 'claude-code/testing'

import { commandSuggestions, type ThemeInfo } from '../hooks/register'

const theme = (name: string, isUser = false, description = ''): ThemeInfo => ({ name, dir: `/t/${name}`, isUser, title: name, description, syntax: {} })
const themes = [theme('vscode-modern', false, 'default look'), theme('vscode'), theme('nord', true, 'my nord'), theme('github-light')]
const o = { themes, active: 'vscode-modern', size: 100 }
// The token at the end of `text`, as the engine gives it.
const at = (text: string) => {
  const token = /\S+$/.exec(text)?.[0] ?? ''
  return commandSuggestions(text, token, text.length - token.length, o)
}

test('the first word completes as a subcommand', () => {
  expect(at('/md-preview t').map(r => r.text)).toEqual(['theme'])
  expect(at('/md-preview o').map(r => r.text)).toEqual(['on', 'off'])
  expect(at('/md-preview S').map(r => r.text)).toEqual(['size', 'setup'])
  expect(at('/md-preview x')).toEqual([])
  expect(at('/md-preview t')[0]!.description).toBe('list the themes, or switch to one')
})

test('right after theme or size, rows hold the word and its argument', () => {
  const rows = at('/md-preview theme')
  expect(rows.map(r => r.text)).toEqual(['theme github-light', 'theme nord', 'theme vscode', 'theme vscode-modern'])
  expect(rows.map(r => r.label)).toEqual(['github-light', 'nord', 'vscode', 'vscode-modern'])
  expect(rows[3]!.description).toBe('built-in, active: default look')
  expect(rows[1]!.description).toBe('user: my nord')
  expect(at('/md-preview size').map(r => r.text)).toContain('size 150')
})

test('a theme name or size completes after its word', () => {
  expect(at('/md-preview theme vs').map(r => r.text)).toEqual(['vscode', 'vscode-modern'])
  expect(at('/md-preview theme N').map(r => r.text)).toEqual(['nord'])
  expect(at('/md-preview size 1').map(r => r.text)).toEqual(['100', '110', '120', '125', '150', '175'])
  expect(at('/md-preview size 10')[0]!.description).toBe('current')
  expect(at('/md-preview theme nord extra')).toEqual([])
})

test('other prompts and the command name itself get no rows', () => {
  expect(at('/md-preview')).toEqual([])
  expect(at('/md-previewx t')).toEqual([])
  expect(at('tell me about /md-preview t')).toEqual([])
  expect(at('/other theme')).toEqual([])
})

test('the hook adds theme rows from the themes found at start', async ($, on) => {
  mock.store(on)
  mock.env(on, { HOME: '/fake-home' })
  // The engine's core answers no rows.
  on('prompt.autocomplete', async () => ({ suggestions: [] }))
  on('fs.list', async ($: any, e: any, next: any) =>
    e.path.endsWith('/render/themes') ? { value: ['vscode', 'vscode-modern', 'nord'].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } : next(e))
  on('fs.read', async ($: any, e: any, next: any) =>
    /\/render\/themes\/[^/]+\/theme\.json$/.test(e.path) ? { value: '{"description":"d"}' } : next(e))
  const text = '/md-preview theme n'
  const got = await ($ as any).prompt.autocomplete({ text, cursor: text.length, token: 'n', start: text.length - 1 })
  expect(got.suggestions.map((r: any) => r.text)).toEqual(['nord'])
  const other = await ($ as any).prompt.autocomplete({ text: 'hello', cursor: 5, token: 'hello', start: 0 })
  expect(other.suggestions).toEqual([])
})
