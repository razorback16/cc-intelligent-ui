import { expect, mock, test } from 'claude-code/testing'

import { commandSuggestions, parseCommand, type ThemeInfo } from '../hooks/register'

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
  expect(at('/iui g').map(r => r.text)).toEqual(['grid', 'grab'])
  expect(at('/iui o').map(r => r.text)).toEqual(['on', 'off'])
  expect(at('/iui S').map(r => r.text)).toEqual(['size', 'setup'])
  expect(at('/iui x')).toEqual([])
  expect(at('/iui t')[0]!.description).toBe('list the themes, or switch to one')
})

test('right after theme or size, rows hold the word and its argument', () => {
  const rows = at('/iui theme')
  expect(rows.map(r => r.text)).toEqual(['theme github-light', 'theme nord', 'theme vscode', 'theme vscode-modern'])
  expect(rows.map(r => r.label)).toEqual(['github-light', 'nord', 'vscode', 'vscode-modern'])
  expect(rows[3]!.description).toBe('in use: default look')
  expect(rows[1]!.description).toBe('yours: my nord')
  expect(at('/iui size').map(r => r.text)).toContain('size 150')
  const widths = at('/iui width')
  expect(widths.map(r => r.text)).toEqual(['width 80', 'width 100', 'width 120', 'width 160', 'width 200', 'width full'])
  // full is the default; with no width given, it is in use.
  expect(widths.at(-1)!.description).toBe('in use')
  const heights = at('/iui height')
  expect(heights.map(r => r.text)).toEqual(['height half', 'height full', 'height 12', 'height 24', 'height 36'])
  expect(heights.map(r => r.label)).toEqual(['half', 'full', '12 rows', '24 rows', '36 rows'])
  // half is the default; with no height given, it is in use.
  expect(heights[0]!.description).toBe('in use')
  expect(heights[1]!.description).toBe('the terminal height less 16 rows')
  const grids = at('/iui grid')
  expect(grids.map(r => r.text)).toEqual(['grid on', 'grid off'])
  // on is the default; with no grid given, it is in use.
  expect(grids.map(r => r.description)).toEqual(['in use', undefined])
})

test('a theme name or size completes after its word', () => {
  expect(at('/iui theme vs').map(r => r.text)).toEqual(['vscode', 'vscode-modern'])
  expect(at('/iui theme N').map(r => r.text)).toEqual(['nord'])
  expect(at('/iui size 1').map(r => r.text)).toEqual(['100', '110', '120', '125', '150', '175'])
  expect(at('/iui size 10')[0]!.description).toBe('in use')
  expect(at('/iui theme nord extra')).toEqual([])
  expect(at('/iui width 1').map(r => r.text)).toEqual(['100', '120', '160'])
  expect(at('/iui width f').map(r => r.label)).toEqual(['full'])
  const set = (text: string) => commandSuggestions(text, /\S+$/.exec(text)![0], text.lastIndexOf(' ') + 1, { ...o, width: 160 })
  expect(set('/iui width 16')[0]!.description).toBe('in use')
  expect(set('/iui width f')[0]!.description).toBe('the default')
  expect(at('/iui height f').map(r => r.text)).toEqual(['full'])
  expect(at('/iui height 2').map(r => r.text)).toEqual(['24'])
  const tall = (text: string) => commandSuggestions(text, /\S+$/.exec(text)![0], text.lastIndexOf(' ') + 1, { ...o, height: 24 })
  expect(tall('/iui height 2')[0]!.description).toBe('in use')
  expect(tall('/iui height h')[0]!.description).toBe('the default: half the terminal')
  expect(at('/iui grid o').map(r => r.text)).toEqual(['on', 'off'])
  expect(at('/iui grid of').map(r => r.label)).toEqual(['off'])
  const gridded = (text: string) => commandSuggestions(text, /\S+$/.exec(text)![0], text.lastIndexOf(' ') + 1, { ...o, grid: false })
  expect(gridded('/iui grid o').map(r => r.description)).toEqual(['the default', 'in use'])
  expect(at('/iui grid on extra')).toEqual([])
})

test('the command name itself offers the subcommands, as rows that hold it', () => {
  const rows = at('/iui')
  expect(rows.map(r => r.label)).toEqual(['on', 'off', 'size', 'width', 'height', 'grid', 'updates', 'theme', 'setup', 'details', 'grab', 'dump'])
  expect(rows.find(r => r.label === 'theme')!.text).toBe('/iui theme')
  expect(at('  /iui').map(r => r.text)).toContain('/iui grid')
  expect(at('tell me /iui')).toEqual([])
})

test('other prompts get no rows', () => {
  expect(at('/iuix t')).toEqual([])
  expect(at('tell me about /iui t')).toEqual([])
  expect(at('/other theme')).toEqual([])
})

const BAD = { kind: 'bad' }
const parses: [string, object][] = [
  // nothing, on, off
  ['', { kind: 'show' }],
  [' on ', { kind: 'on' }],
  ['OFF', { kind: 'off' }],
  // width: 40 to 400, full, or nothing to show it
  ['width', { kind: 'width' }],
  ['width full', { kind: 'width', width: 'full' }],
  ['WIDTH Full', { kind: 'width', width: 'full' }],
  ['width 40', { kind: 'width', width: 40 }],
  ['width 160', { kind: 'width', width: 160 }],
  ['width 400', { kind: 'width', width: 400 }],
  ['width 39', BAD],
  ['width 401', BAD],
  ['width 12.5', BAD],
  ['width wide', BAD],
  ['width 120 full', BAD],
  // height: half, full, 6 to 200 rows, or nothing to show it
  ['height', { kind: 'height' }],
  ['height half', { kind: 'height', height: 'half' }],
  ['HEIGHT Full', { kind: 'height', height: 'full' }],
  ['height 6', { kind: 'height', height: 6 }],
  ['height 200', { kind: 'height', height: 200 }],
  ['height 5', BAD],
  ['height 201', BAD],
  ['height tall', BAD],
  ['height 12 rows', BAD],
  // size: 80 to 200 percent
  ['size 130', { kind: 'size', percent: 130 }],
  ['size 80%', { kind: 'size', percent: 80 }],
  ['size 200', { kind: 'size', percent: 200 }],
  ['size 79', BAD],
  ['size 201', BAD],
  ['size', BAD],
  ['size big', BAD],
  ['bigger', BAD],
  // grid: on, off, or nothing to show it
  ['grid', { kind: 'grid' }],
  ['grid on', { kind: 'grid', grid: true }],
  ['GRID Off', { kind: 'grid', grid: false }],
  ['grid yes', BAD],
  ['grid on off', BAD],
  // theme: a name kept as typed
  ['theme', { kind: 'theme' }],
  ['THEME', { kind: 'theme' }],
  ['theme vscode', { kind: 'theme', name: 'vscode' }],
  ['theme My.Dark_Theme-2', { kind: 'theme', name: 'My.Dark_Theme-2' }],
  ['theme a b', BAD],
  ['theme ../up', BAD],
  ['theme a/b', BAD],
  // the words without arguments
  ['probe', { kind: 'probe' }],
  ['details', { kind: 'details' }],
  ['probe 3', BAD],
  ['grab', { kind: 'grab' }],
  ['dump', { kind: 'dump' }],
  ['grab now', BAD],
  // setup
  ['setup', { kind: 'setup', remove: false }],
  ['Setup Remove', { kind: 'setup', remove: true }],
  ['setup now', BAD],
  // updates
  ['updates', { kind: 'updates' }],
  ['Updates ON', { kind: 'updates', on: true }],
  ['updates off', { kind: 'updates', on: false }],
  ['updates maybe', BAD],
  ['updates on now', BAD],
]

test('each command line parses to its command, or to bad', () => {
  for (const [line, want] of parses) expect(parseCommand(line)).toEqual(want)
})

test('a word with extra words, a sign or a fraction is not understood', () => {
  for (const args of ['on now', 'off x', 'details x', 'dump now', 'grab 1', 'probe 3', 'setup remove now', 'setup add', 'size 90.5', 'size -90', 'size 1e2', 'size 100 %', 'theme a b', 'updates 1']) {
    expect(parseCommand(args)).toEqual({ kind: 'bad' })
  }
  expect(parseCommand('SETUP REMOVE')).toEqual({ kind: 'setup', remove: true })
  expect(parseCommand('\t size \t 150 ')).toEqual({ kind: 'size', percent: 150 })
})

test('a size row takes a % after the number, and marks the one in use and the terminal size', () => {
  expect(at('/iui size 15%').map(r => r.text)).toEqual(['150'])
  expect(at('/iui size 12').map(r => [r.label, r.description])).toEqual([['120%', undefined], ['125%', undefined]])
  const sized = (text: string, size: number) => commandSuggestions(text, /\S+$/.exec(text)![0], text.lastIndexOf(' ') + 1, { ...o, size })
  expect(sized('/iui size 1', 125).filter(r => r.description).map(r => [r.text, r.description])).toEqual([['100', 'the terminal text size'], ['125', 'in use']])
  expect(sized('/iui size', 80)[0]).toEqual({ text: 'size 80', label: '80%', description: 'in use' })
})

test('right after the command name and a space, every subcommand is offered by its bare name', () => {
  const rows = commandSuggestions('/iui ', '', 5, o)
  expect(rows.map(r => r.text)).toEqual(['on', 'off', 'size', 'width', 'height', 'grid', 'updates', 'theme', 'setup', 'details', 'grab', 'dump'])
  expect(rows.every(r => r.description)).toBe(true)
})

test('a subcommand word matches in any case, and the command name does not', () => {
  expect(at('/iui THEME').map(r => r.label)).toEqual(['github-light', 'nord', 'vscode', 'vscode-modern'])
  expect(at('/iui Up').map(r => r.text)).toEqual(['updates'])
  expect(at('/IUI t')).toEqual([])
})

test('a subcommand with no value to offer gets no rows after it', () => {
  for (const text of ['/iui on ', '/iui setup r', '/iui details x', '/iui dump d']) expect(at(text)).toEqual([])
  expect(at('/iui grab g')).toEqual([])
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

// ---- The command run ----------------------------------------------------------

type Out = { exitCode: number; stdout: string }
// A Mac session; the store is kept by key. `sh`: what setUp's probe prints
// (the cache folder, the OS, then Typst's path when it is found).
function world(on: any, o: { stored?: Record<string, unknown>; env?: Record<string, string>; sh?: string } = {}) {
  const store = new Map(Object.entries(o.stored ?? {}))
  on('store.get', async ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async ($: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM: 'xterm-kitty', ...o.env })
  on('process.run', async ($: any, e: any, next: any) =>
    e.argv[0] === 'sh' && /cc-intelligent-ui-/.test(e.argv.join(' '))
      ? { value: { exitCode: 0, stdout: o.sh ?? '/tmp/mdp\nDarwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as Out }
      : next(e))
  return { store, clock }
}
const run = async ($: any, args: string) => (await $.command.run({ command: 'iui', args })).text as string

test('on and off say so, keep the setting, and a later show agrees', async ($, on) => {
  const { store } = world(on)
  expect(await run($, 'off')).toBe('Intelligent UI is off.')
  expect(store.get('enabled')).toBe(false)
  expect(await run($, '')).toMatch(/^Intelligent UI is off: /)
  expect(await run($, 'ON')).toBe('Intelligent UI is on.')
  expect(store.get('enabled')).toBe(true)
  expect(await run($, '')).toMatch(/^Intelligent UI is on: /)
})

test('size says the percent and keeps it; a size out of range is not understood and keeps nothing', async ($, on) => {
  const { store } = world(on)
  expect(await run($, 'size 125%')).toBe("Intelligent UI draws text at 125% of the terminal's text size (100% matches it).")
  expect(store.get('size')).toBe(125)
  const bad = await run($, 'size 201')
  expect(bad).toContain('Not understood: "size 201".')
  expect(store.get('size')).toBe(125)
  expect(await run($, '')).toContain('text 125%')
})

test('width, height and grid with a value keep it; the reply names the new value', async ($, on) => {
  const { store } = world(on)
  expect(await run($, 'width 120')).toContain('Intelligent UI pictures now take at most: 120 columns.')
  expect(store.get('width')).toBe(120)
  expect(await run($, 'height 24')).toContain('Intelligent UI images and Typst drawings now take at most: 24 rows.')
  expect(store.get('height')).toBe(24)
  expect(await run($, 'grid off')).toContain('The row grid is now off.')
  expect(store.get('grid')).toBe(false)
  const state = await run($, '')
  expect(state).toContain('width 120 columns, height 24 rows, grid off.')
})

test('width, height and grid with no value show the setting and keep nothing', async ($, on) => {
  const { store } = world(on, { stored: { width: 160, height: 'full', grid: false } })
  expect(await run($, 'width')).toContain('The most columns a picture takes: 160 columns.')
  expect(await run($, 'height')).toContain('The most rows an image or a Typst drawing takes: full')
  expect(await run($, 'grid')).toContain('The row grid is off.')
  expect([...store.keys()].sort()).toEqual(['grid', 'height', 'width'])
  expect(store.get('width')).toBe(160)
})

test('a word that is not a subcommand gets the not-understood line, then the state', async ($, on) => {
  world(on)
  const text = await run($, '  bigger please ')
  expect(text.startsWith('Not understood: "bigger please".\nIntelligent UI is on: theme ')).toBe(true)
  expect(text).toContain('Change: /iui on | off | size | width | height | grid | updates | theme. More: /iui details')
})

test('the state tells when Typst is not found, and when the terminal shows no pictures', async ($, on) => {
  world(on, { env: { TERM: 'xterm-256color' } })
  const text = await run($, '')
  expect(text).toContain('Typst is not installed, so answers stay text.')
  expect(text).toContain('This terminal shows no pictures, so answers stay text.')
})

// A version 0.2.0 is installed, and the check of the day already ran: 99.0.0 is the newest.
function updated(on: any, stored: Record<string, unknown> = {}) {
  const w = world(on, { stored: { 'update-check': { at: 1_800_000_000_000, latest: '99.0.0' }, ...stored } })
  on('fs.read', async ($: any, e: any, next: any) =>
    e.path.endsWith('/.claude-plugin/plugin.json') ? { value: '{"name":"cc-intelligent-ui","version":"0.2.0"}' } : next(e))
  on('ui.toast', async () => ({ value: undefined }))
  return w
}

test('the state has the update notice when a newer version is known', async ($, on) => {
  updated(on)
  expect(await run($, '')).toContain('Intelligent UI 99.0.0 is available (you have 0.2.0). To update: ')
})

test('the state has no update notice when updates are off', async ($, on) => {
  updated(on, { updates: false })
  expect(await run($, '')).not.toContain('is available')
})

test('the command is registered as iui at the session start, with a hint that names every subcommand', async ($, on) => {
  world(on)
  const specs: any[] = []
  on('command.register', async ($: any, e: any) => (specs.push(e), { value: undefined } as any))
  await ($ as any).session.start({ source: 'startup' }).catch(() => undefined)
  expect(specs.length).toBeGreaterThan(0)
  const spec = specs[0]
  expect(spec.name).toBe('iui')
  for (const word of ['on', 'off', 'size', 'width', 'height', 'grid', 'updates', 'theme', 'grab', 'dump']) {
    expect(spec.argumentHint).toContain(word)
    expect(spec.description).toContain(word)
  }
})
