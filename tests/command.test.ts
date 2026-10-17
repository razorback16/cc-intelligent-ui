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
  expect(at('/iui t').map(r => r.text)).toEqual(['theme'])
  expect(at('/iui w').map(r => r.text)).toEqual(['width'])
  expect(at('/iui h').map(r => r.text)).toEqual(['height'])
  expect(at('/iui o').map(r => r.text)).toEqual(['on', 'off'])
  expect(at('/iui S').map(r => r.text)).toEqual(['size', 'setup'])
  expect(at('/iui x')).toEqual([])
  expect(at('/iui t')[0]!.description).toBe('list the themes, or switch to one')
})

test('right after theme or size, rows hold the word and its argument', () => {
  const rows = at('/iui theme')
  expect(rows.map(r => r.text)).toEqual(['theme github-light', 'theme nord', 'theme vscode', 'theme vscode-modern'])
  expect(rows.map(r => r.label)).toEqual(['github-light', 'nord', 'vscode', 'vscode-modern'])
  expect(rows[3]!.description).toBe('built-in, active: default look')
  expect(rows[1]!.description).toBe('user: my nord')
  expect(at('/iui size').map(r => r.text)).toContain('size 150')
  const widths = at('/iui width')
  expect(widths.map(r => r.text)).toEqual(['width 80', 'width 100', 'width 120', 'width 160', 'width 200', 'width full'])
  // full is the default; with no width given, it is current.
  expect(widths.at(-1)!.description).toBe('current')
  const heights = at('/iui height')
  expect(heights.map(r => r.text)).toEqual(['height half', 'height full', 'height 12', 'height 24', 'height 36'])
  expect(heights.map(r => r.label)).toEqual(['half', 'full', '12 rows', '24 rows', '36 rows'])
  // half is the default; with no height given, it is current.
  expect(heights[0]!.description).toBe('current')
  expect(heights[1]!.description).toBe('the terminal height less 16 rows')
})

test('a theme name or size completes after its word', () => {
  expect(at('/iui theme vs').map(r => r.text)).toEqual(['vscode', 'vscode-modern'])
  expect(at('/iui theme N').map(r => r.text)).toEqual(['nord'])
  expect(at('/iui size 1').map(r => r.text)).toEqual(['100', '110', '120', '125', '150', '175'])
  expect(at('/iui size 10')[0]!.description).toBe('current')
  expect(at('/iui theme nord extra')).toEqual([])
  expect(at('/iui width 1').map(r => r.text)).toEqual(['100', '120', '160'])
  expect(at('/iui width f').map(r => r.label)).toEqual(['full'])
  const set = (text: string) => commandSuggestions(text, /\S+$/.exec(text)![0], text.lastIndexOf(' ') + 1, { ...o, width: 160 })
  expect(set('/iui width 16')[0]!.description).toBe('current')
  expect(set('/iui width f')[0]!.description).toBe('the default')
  expect(at('/iui height f').map(r => r.text)).toEqual(['full'])
  expect(at('/iui height 2').map(r => r.text)).toEqual(['24'])
  const tall = (text: string) => commandSuggestions(text, /\S+$/.exec(text)![0], text.lastIndexOf(' ') + 1, { ...o, height: 24 })
  expect(tall('/iui height 2')[0]!.description).toBe('current')
  expect(tall('/iui height h')[0]!.description).toBe('the default: half the terminal')
})

test('other prompts and the command name itself get no rows', () => {
  expect(at('/iui')).toEqual([])
  expect(at('/iuix t')).toEqual([])
  expect(at('tell me about /iui t')).toEqual([])
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
  const text = '/iui theme n'
  const got = await ($ as any).prompt.autocomplete({ text, cursor: text.length, token: 'n', start: text.length - 1 })
  expect(got.suggestions.map((r: any) => r.text)).toEqual(['nord'])
  const other = await ($ as any).prompt.autocomplete({ text: 'hello', cursor: 5, token: 'hello', start: 0 })
  expect(other.suggestions).toEqual([])
})
