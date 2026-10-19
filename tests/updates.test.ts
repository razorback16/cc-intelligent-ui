import { expect, mock, test } from 'claude-code/testing'

import {
  agoText, checkedOf, commandSuggestions, compareVersions, isDue, isNewer, parseCommand, parseVersion, shouldTell, toldOf, UPDATE_EVERY_MS,
  UPDATE_FETCH_MS, UPDATE_STEPS, UPDATE_TOAST_MS, UPDATE_URL, updateLine, updateNotice, updateToast, versionOf,
} from '../hooks/register'

const HOUR = 60 * 60 * 1000
const NOW = 1_800_000_000_000

test('versions compare as dotted numbers; other text does not parse', () => {
  expect(parseVersion('0.2.0')).toEqual([0, 2, 0])
  expect(parseVersion(' v1.10.3 ')).toEqual([1, 10, 3])
  expect(parseVersion('2')).toEqual([2])
  for (const bad of ['', '1.2.3-beta', '1..2', 'x.y.z', '1.2.3.4.5', 3, null, undefined]) expect(parseVersion(bad)).toBe(null)
  expect(compareVersions('0.3.0', '0.2.0')! > 0).toBe(true)
  expect(compareVersions('0.10.0', '0.9.9')! > 0).toBe(true)
  expect(compareVersions('1.0', '1.0.0')).toBe(0)
  expect(compareVersions('0.2.0', '0.2.1')! < 0).toBe(true)
  expect(compareVersions('0.3.0-rc1', '0.2.0')).toBe(null)
  expect(isNewer('0.3.0', '0.2.0')).toBe(true)
  expect(isNewer('0.2.0', '0.2.0')).toBe(false)
  expect(isNewer('0.1.9', '0.2.0')).toBe(false)
  expect(isNewer('next', '0.2.0')).toBe(false)
})

test('the version of a plugin.json: only this mod, only a version that parses', () => {
  expect(versionOf('{"name":"cc-intelligent-ui","version":"0.3.0"}')).toBe('0.3.0')
  expect(versionOf('{"version":"v0.3.0"}')).toBe('0.3.0')
  expect(versionOf('{"name":"other","version":"9.0.0"}')).toBe(null)
  expect(versionOf('{"name":"cc-intelligent-ui","version":"0.3.0-beta"}')).toBe(null)
  expect(versionOf('{"name":"cc-intelligent-ui"}')).toBe(null)
  expect(versionOf('404: Not Found')).toBe(null)
  expect(versionOf('[]')).toBe(null)
  expect(versionOf('null')).toBe(null)
})

test('a check is due 24 h after the last one; a version is told once a day', () => {
  expect(isDue(null, NOW)).toBe(true)
  expect(isDue({ at: NOW - 23 * HOUR, latest: '0.3.0' }, NOW)).toBe(false)
  expect(isDue({ at: NOW - UPDATE_EVERY_MS, latest: '0.3.0' }, NOW)).toBe(true)
  // The clock went back: due.
  expect(isDue({ at: NOW + HOUR, latest: '' }, NOW)).toBe(true)
  expect(checkedOf({ at: NOW, latest: '0.3.0' })).toEqual({ at: NOW, latest: '0.3.0' })
  expect(checkedOf({ at: NOW, latest: 'junk' })).toEqual({ at: NOW, latest: '' })
  expect(checkedOf({ at: 'now' })).toBe(null)
  expect(checkedOf('x')).toBe(null)
  expect(toldOf({ version: '0.3.0', at: NOW })).toEqual({ version: '0.3.0', at: NOW })
  expect(toldOf({ version: 3, at: NOW })).toBe(null)
  expect(shouldTell(null, '0.3.0', NOW)).toBe(true)
  expect(shouldTell({ version: '0.3.0', at: NOW - HOUR }, '0.3.0', NOW)).toBe(false)
  expect(shouldTell({ version: '0.3.0', at: NOW - UPDATE_EVERY_MS }, '0.3.0', NOW)).toBe(true)
  expect(shouldTell({ version: '0.3.0', at: NOW - HOUR }, '0.4.0', NOW)).toBe(true)
})

test('the toast, the details line and the /iui notice', () => {
  expect(updateToast('0.3.0', '0.2.0')).toBe(
    'Intelligent UI 0.3.0 is available (you have 0.2.0): run claude plugin marketplace update razorback16, then claude plugin update cc-intelligent-ui@razorback16, then /reload-plugins')
  expect(UPDATE_STEPS).toBe('claude plugin marketplace update razorback16, then claude plugin update cc-intelligent-ui@razorback16, then /reload-plugins')
  const o = { on: true, off: '', own: '0.2.0', checked: { at: NOW - 3 * HOUR, latest: '0.3.0' }, now: NOW }
  expect(updateLine(o)).toBe('on, 0.3.0 is available (you have 0.2.0)')
  expect(updateLine({ ...o, checked: { at: NOW - 3 * HOUR, latest: '0.2.0' } })).toBe('on, up to date (0.2.0, checked 3 hours ago)')
  expect(updateLine({ ...o, checked: { at: NOW - 3 * HOUR, latest: '' } })).toBe('on, no version found yet (you have 0.2.0, last try 3 hours ago)')
  expect(updateLine({ ...o, checked: null })).toBe('on, not checked yet (you have 0.2.0)')
  expect(updateLine({ ...o, on: false })).toBe('off')
  expect(updateLine({ ...o, off: 'DISABLE_UPDATES' })).toBe('off (DISABLE_UPDATES is set)')
  expect(updateLine({ ...o, own: '' })).toBe('on, the version installed is not known')
  expect(updateNotice(o)).toBe(`Intelligent UI 0.3.0 is available (you have 0.2.0). To update: ${UPDATE_STEPS}.`)
  expect(updateNotice({ ...o, on: false })).toBe('')
  expect(updateNotice({ ...o, off: 'DISABLE_AUTOUPDATER' })).toBe('')
  expect(updateNotice({ ...o, own: '0.3.0' })).toBe('')
  expect(agoText(10 * 60 * 1000)).toBe('less than 1 hour ago')
  expect(agoText(HOUR)).toBe('1 hour ago')
  expect(agoText(72 * HOUR)).toBe('3 days ago')
})

test('/iui updates [on|off] is a command, with typeahead rows', () => {
  expect(parseCommand('updates')).toEqual({ kind: 'updates' })
  expect(parseCommand('Updates ON')).toEqual({ kind: 'updates', on: true })
  expect(parseCommand('updates off')).toEqual({ kind: 'updates', on: false })
  expect(parseCommand('updates maybe')).toEqual({ kind: 'bad' })
  expect(parseCommand('updates on now')).toEqual({ kind: 'bad' })
  const o = { themes: [], active: 'claude-code', size: 100 }
  const at = (text: string, more = {}) => {
    const token = /\S+$/.exec(text)?.[0] ?? ''
    return commandSuggestions(text, token, text.length - token.length, { ...o, ...more })
  }
  expect(at('/iui u').map(r => r.text)).toEqual(['updates'])
  expect(at('/iui u')[0]!.description).toBe('look for a new version once a day, on or off')
  const rows = at('/iui updates')
  expect(rows.map(r => r.text)).toEqual(['updates on', 'updates off'])
  // on is the default; with no value given, it is in use.
  expect(rows.map(r => r.description)).toEqual(['in use', undefined])
  expect(at('/iui updates of', { updates: false }).map(r => [r.text, r.description])).toEqual([['off', 'in use']])
  expect(at('/iui updates o', { updates: false }).map(r => r.description)).toEqual(['the default', 'in use'])
  expect(at('/iui updates on extra')).toEqual([])
})

type Answer = { status: number; text: string } | 'throw' | 'never'

// A session in a terminal with version `own` installed; GitHub answers
// `answer`. The store, the fetches and the toasts are kept.
function world(on: any, o: { answer?: Answer; own?: string; stored?: Record<string, unknown>; env?: Record<string, string>; surfaces?: string[] } = {}) {
  const store = new Map(Object.entries(o.stored ?? {}))
  on('store.get', async ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async ($: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/h', ...o.env })
  on('session.surfaces', async () => ({ value: o.surfaces ?? ['terminal'] }))
  on('fs.read', async ($: any, e: any, next: any) =>
    e.path.endsWith('/.claude-plugin/plugin.json') ? { value: JSON.stringify({ name: 'cc-intelligent-ui', version: o.own ?? '0.2.0' }) } : next(e))
  const fetched: string[] = []
  const answer = o.answer ?? { status: 200, text: '{"name":"cc-intelligent-ui","version":"0.3.0"}' }
  on('http.fetch', async ($: any, e: any) => {
    fetched.push(e.url)
    if (answer === 'throw') throw new Error('offline')
    if (answer === 'never') {
      await clock.sleep(10 * UPDATE_FETCH_MS)
      return { value: { status: 200, ok: true, headers: {}, text: '{"version":"9.9.9"}' } }
    }
    return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: answer.text } }
  })
  const toasts: { text: string; timeoutMs?: number }[] = []
  on('ui.toast', async ($: any, e: any) => (toasts.push({ text: e.text, timeoutMs: e.timeoutMs }), { value: undefined }))
  return { store, clock, fetched, toasts }
}

// A turn starts (the check's moment when setUp could not run it), and all it
// started settles.
async function turn($: any, w: { clock: { settle: () => Promise<void> } }) {
  await $.turn.start({ text: 'hi', turnId: 't1' }).catch(() => undefined)
  await w.clock.settle()
}

const updatesReply = async ($: any, args = 'updates') => (await $.command.run({ command: 'iui', args })).text as string

test('a due check fetches the manifest once, keeps the version, and shows one long toast', async ($, on) => {
  const w = world(on)
  await turn($, w)
  await turn($, w)
  expect(w.fetched).toEqual([UPDATE_URL])
  expect(w.store.get('update-check')).toEqual({ at: NOW, latest: '0.3.0' })
  expect(w.store.get('update-told')).toEqual({ version: '0.3.0', at: NOW })
  expect(w.toasts).toEqual([{ text: updateToast('0.3.0', '0.2.0'), timeoutMs: UPDATE_TOAST_MS }])
  expect(UPDATE_TOAST_MS).toBe(12000)
  expect(await updatesReply($)).toContain('Update checks: on, 0.3.0 is available (you have 0.2.0).')
})

test('in the 24 h window the stored version is used with no fetch; the toast once a day', async ($, on) => {
  const w = world(on, { stored: { 'update-check': { at: NOW - 2 * HOUR, latest: '0.3.0' } } })
  await turn($, w)
  expect(w.fetched).toEqual([])
  expect(w.toasts.map(t => t.text)).toEqual([updateToast('0.3.0', '0.2.0')])
})

test('a version told in the last 24 h is not told again', async ($, on) => {
  const w = world(on, { stored: { 'update-check': { at: NOW - 2 * HOUR, latest: '0.3.0' }, 'update-told': { version: '0.3.0', at: NOW - HOUR } } })
  await turn($, w)
  expect(w.fetched).toEqual([])
  expect(w.toasts).toEqual([])
})

test('24 h after the last check, it fetches again', async ($, on) => {
  const w = world(on, { stored: { 'update-check': { at: NOW - UPDATE_EVERY_MS, latest: '0.2.0' } }, answer: { status: 200, text: '{"version":"0.4.0"}' } })
  await turn($, w)
  expect(w.fetched).toEqual([UPDATE_URL])
  expect(w.store.get('update-check')).toEqual({ at: NOW, latest: '0.4.0' })
  expect(w.toasts.map(t => t.text)).toEqual([updateToast('0.4.0', '0.2.0')])
})

test('up to date: no toast, and the details say when it checked', async ($, on) => {
  const w = world(on, { own: '0.3.0' })
  await turn($, w)
  expect(w.fetched.length).toBe(1)
  expect(w.toasts).toEqual([])
  expect(await updatesReply($)).toContain('Update checks: on, up to date (0.3.0, checked less than 1 hour ago).')
})

for (const [name, answer] of [
  ['no network', 'throw'],
  ['a 404', { status: 404, text: '404: Not Found' }],
  ['a text that is not JSON', { status: 200, text: '<html>' }],
  ['another plugin', { status: 200, text: '{"name":"other","version":"9.0.0"}' }],
  ['a version that does not parse', { status: 200, text: '{"name":"cc-intelligent-ui","version":"latest"}' }],
] as const) {
  test(`a failed fetch (${name}) shows nothing, and waits 24 h too`, async ($, on) => {
    const w = world(on, { answer })
    await turn($, w)
    expect(w.fetched.length).toBe(1)
    expect(w.toasts).toEqual([])
    expect(w.store.get('update-check')).toEqual({ at: NOW, latest: '' })
    expect(await updatesReply($)).toContain('Update checks: on, no version found yet (you have 0.2.0, last try less than 1 hour ago).')
  })
}

test('a failed fetch keeps the version found before', async ($, on) => {
  const w = world(on, { answer: 'throw', stored: { 'update-check': { at: NOW - 2 * UPDATE_EVERY_MS, latest: '0.3.0' } } })
  await turn($, w)
  expect(w.fetched.length).toBe(1)
  expect(w.store.get('update-check')).toEqual({ at: NOW, latest: '0.3.0' })
  expect(w.toasts.map(t => t.text)).toEqual([updateToast('0.3.0', '0.2.0')])
})

test('a fetch with no answer in time is a failure', async ($, on) => {
  const w = world(on, { answer: 'never' })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any).catch(() => undefined)
  await w.clock.settle()
  expect(w.fetched.length).toBe(1)
  await w.clock.advance(UPDATE_FETCH_MS)
  expect(w.store.get('update-check')).toEqual({ at: NOW, latest: '' })
  await w.clock.advance(10 * UPDATE_FETCH_MS)
  expect(w.store.get('update-check')).toEqual({ at: NOW, latest: '' })
  expect(w.toasts).toEqual([])
})

test('/iui updates off: no fetch and no toast; on stores it and checks', async ($, on) => {
  const w = world(on, { stored: { updates: false, 'update-check': { at: NOW - HOUR, latest: '0.3.0' } } })
  await turn($, w)
  expect(w.fetched).toEqual([])
  expect(w.toasts).toEqual([])
  expect(await updatesReply($)).toMatch(/^Update checks: off\. /)
  expect(await updatesReply($, 'updates on')).toContain('Update checks are now: on, 0.3.0 is available (you have 0.2.0).')
  await w.clock.settle()
  expect(w.store.get('updates')).toBe(true)
  // Checked 1 h ago: no fetch, but the toast.
  expect(w.fetched).toEqual([])
  expect(w.toasts.length).toBe(1)
  expect(await updatesReply($, 'updates off')).toContain('Update checks are now: off.')
  expect(w.store.get('updates')).toBe(false)
})

test('the setting off from the start: the check never fetches', async ($, on) => {
  const w = world(on, { stored: { updates: false } })
  await turn($, w)
  await turn($, w)
  expect(w.fetched).toEqual([])
  expect(w.store.has('update-check')).toBe(false)
})

for (const name of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_UPDATES', 'DISABLE_AUTOUPDATER']) {
  test(`${name} stops the check`, async ($, on) => {
    const w = world(on, { env: { [name]: '1' }, stored: { 'update-check': { at: NOW - HOUR, latest: '0.3.0' } } })
    await turn($, w)
    expect(w.fetched).toEqual([])
    expect(w.toasts).toEqual([])
    expect(await updatesReply($)).toContain(`Update checks: off (${name} is set).`)
  })
}

test('a variable set to 0 does not stop the check', async ($, on) => {
  const w = world(on, { env: { DISABLE_UPDATES: '0' } })
  await turn($, w)
  expect(w.fetched).toEqual([UPDATE_URL])
})

test('with no terminal (a -p run) there is no check', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await turn($, w)
  expect(w.fetched).toEqual([])
})

test('a background session does not check', async ($, on) => {
  const w = world(on, { env: { CLAUDE_CODE_SESSION_KIND: 'bg' } })
  await turn($, w)
  expect(w.fetched).toEqual([])
})
