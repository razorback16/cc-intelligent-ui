// The update check: at most once a day, the version in this mod's
// plugin.json on GitHub against the version installed; a newer one is told
// in a toast and in /iui. Claude Code finds a plugin update by that version,
// but its auto-update is off for a third-party marketplace, so without this
// a user does not learn of a new version.
import type { EngineInterface } from 'claude-code'

import { S } from './state'
import { isSet } from './terminal'
import { delay, nowMs, getenv, cat, http, pluginRoot, surf, load, save, toast, type EnvName } from './api'

// The manifest of the newest release (a release changes its `version`).
export const UPDATE_URL = 'https://raw.githubusercontent.com/razorback16/cc-intelligent-ui/main/.claude-plugin/plugin.json'
export const MARKETPLACE = 'razorback16'
export const PLUGIN_ID = `cc-intelligent-ui@${MARKETPLACE}`
// One check in this time at most; the toast of one version as often.
export const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000
// A fetch with no answer in this time is a failure.
export const UPDATE_FETCH_MS = 10000
export const UPDATE_TOAST_MS = 12000
// Claude Code's variables that stop its own update checks and other traffic
// that is not needed: any one set stops this check too.
export const UPDATE_ENV: readonly EnvName[] = ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_UPDATES', 'DISABLE_AUTOUPDATER']

// The numbers of a dotted version (`1.2.3`, `v1.2.3`, 1 to 4 parts); null
// for any other text (`1.2.3-beta`, '').
export function parseVersion(text: unknown): number[] | null {
  if (typeof text !== 'string') return null
  const m = /^v?(\d+(?:\.\d+){0,3})$/.exec(text.trim())
  return m ? m[1]!.split('.').map(Number) : null
}

// Less than, equal to or more than 0 as `a` is older than, the same as or
// newer than `b` (a missing part is 0); null when one does not parse.
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}
export const isNewer = (latest: string, own: string) => (compareVersions(latest, own) ?? 0) > 0

// The version in the text of this mod's plugin.json (no `v`); null when the
// text is not JSON, names another plugin, or has no version that parses.
export function versionOf(text: string): string | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const { name, version } = json as { name?: unknown; version?: unknown }
  if (name !== undefined && name !== 'cc-intelligent-ui') return null
  return parseVersion(version) ? String(version).trim().replace(/^v/, '') : null
}

// The last check in the store (`update-check`): when it ran, and the newest
// version a check found ('' none yet).
export type Checked = { at: number; latest: string }
export function checkedOf(value: unknown): Checked | null {
  if (!value || typeof value !== 'object') return null
  const { at, latest } = value as { at?: unknown; latest?: unknown }
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return { at, latest: parseVersion(latest) ? String(latest).trim().replace(/^v/, '') : '' }
}
// A check is due with none stored, UPDATE_EVERY_MS after the last one, or
// when the clock went back.
export const isDue = (checked: Checked | null, now: number) => !checked || now - checked.at >= UPDATE_EVERY_MS || now < checked.at

// The last toast in the store (`update-told`): its version and time. A
// version is told once a day at most (many sessions a day do not each show
// it); a newer version is told at once.
export type Told = { version: string; at: number }
export function toldOf(value: unknown): Told | null {
  if (!value || typeof value !== 'object') return null
  const { version, at } = value as { version?: unknown; at?: unknown }
  return typeof version === 'string' && typeof at === 'number' && Number.isFinite(at) ? { version, at } : null
}
export const shouldTell = (told: Told | null, latest: string, now: number) =>
  !told || told.version !== latest || now - told.at >= UPDATE_EVERY_MS || now < told.at

export const UPDATE_STEPS = `claude plugin marketplace update ${MARKETPLACE}, then claude plugin update ${PLUGIN_ID}, then /reload-plugins`
export const updateToast = (latest: string, own: string) =>
  `Intelligent UI ${latest} is available (you have ${own}): run ${UPDATE_STEPS}`

// A time in the past, in words.
export function agoText(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / 3600000)
  if (hours < 1) return 'less than 1 hour ago'
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.floor(hours / 24)} days ago`
}

// The state of the check, in words (/iui details, /iui updates). `on`: the
// setting; `off`: the variable that stops the check ('' none); `own`: the
// version installed ('' not known).
export type UpdateState = { on: boolean; off: string; own: string; checked: Checked | null; now: number }
export function updateLine(o: UpdateState): string {
  if (!o.on) return 'off'
  if (o.off) return `off (${o.off} is set)`
  if (!o.own) return 'on, the version installed is not known'
  const latest = o.checked?.latest ?? ''
  if (latest && isNewer(latest, o.own)) return `on, ${latest} is available (you have ${o.own})`
  if (!o.checked) return `on, not checked yet (you have ${o.own})`
  const ago = agoText(o.now - o.checked.at)
  return latest ? `on, up to date (${o.own}, checked ${ago})` : `on, no version found yet (you have ${o.own}, last try ${ago})`
}
// The line of the /iui reply when a newer version is known; '' otherwise.
export function updateNotice(o: UpdateState): string {
  const latest = o.checked?.latest ?? ''
  if (!o.on || o.off || !o.own || !latest || !isNewer(latest, o.own)) return ''
  return `Intelligent UI ${latest} is available (you have ${o.own}). To update: ${UPDATE_STEPS}.`
}

// The setting, the variables, the version installed and the last check,
// read once per load. Never rejects.
export function loadUpdates($: EngineInterface): Promise<void> {
  S.updatesLoading ??= (async () => {
    S.updates = (await load($, 'updates').catch(() => undefined)) !== false
    S.updatesOff = ''
    for (const name of UPDATE_ENV) {
      if (!isSet(await getenv($, name).catch(() => undefined))) continue
      S.updatesOff = name
      break
    }
    const manifest = await cat($, `${pluginRoot($)}/.claude-plugin/plugin.json`).catch(() => '')
    S.ownVersion = versionOf(manifest) ?? ''
    S.updateChecked = checkedOf(await load($, 'update-check').catch(() => undefined))
  })().catch(() => {
    S.updatesLoading = null
  })
  return S.updatesLoading
}

// The version on GitHub now; null on any failure (no network, a status not
// 2xx, no answer in UPDATE_FETCH_MS, a text that is not this mod's
// plugin.json).
export async function fetchLatest($: EngineInterface): Promise<string | null> {
  let late = (_: null) => {}
  const timeout = new Promise<null>(resolve => (late = resolve))
  let timer: { cancel: () => void } | undefined
  try {
    timer = delay($, UPDATE_FETCH_MS, () => late(null))
    const got = await Promise.race([http($, UPDATE_URL).catch(() => null), timeout])
    return got?.ok ? versionOf(got.text) : null
  } catch {
    return null
  } finally {
    timer?.cancel()
  }
}

// The toast for a newer version than the one installed (shouldTell).
async function tellUpdate($: EngineInterface, now: number) {
  const latest = S.updateChecked?.latest ?? ''
  if (!latest || !isNewer(latest, S.ownVersion)) return
  if (!shouldTell(toldOf(await load($, 'update-told').catch(() => undefined)), latest, now)) return
  await save($, 'update-told', { version: latest, at: now }).catch(() => undefined)
  toast($, updateToast(latest, S.ownVersion), { timeoutMs: UPDATE_TOAST_MS })
}

// Once per load, after the start (the end of setUp, or a turn's start, or
// /iui updates on): with the check on and a terminal that shows a toast, the
// version on GitHub when a check is due (isDue), then the toast when it is
// newer. The time of a check is stored before its fetch, so a failed fetch
// is not tried again for UPDATE_EVERY_MS either. Nothing waits for it; it
// never rejects.
export async function checkUpdates($: EngineInterface): Promise<void> {
  if (S.updateDone || S.updateBusy) return
  S.updateBusy = true
  try {
    await loadUpdates($)
    if (!S.updates || S.updatesOff || !S.ownVersion) return
    if ((await getenv($, 'CLAUDE_CODE_SESSION_KIND').catch(() => undefined)) === 'bg') {
      S.updateDone = true
      return
    }
    // None in a -p run; tried again at the next turn.
    const surfaces = await surf($).catch(() => [] as readonly string[])
    if (!surfaces.includes('terminal')) return
    S.updateDone = true
    const now = await nowMs($)
    if (isDue(S.updateChecked, now)) {
      S.updateChecked = { at: now, latest: S.updateChecked?.latest ?? '' }
      await save($, 'update-check', S.updateChecked).catch(() => undefined)
      const found = await fetchLatest($)
      if (found) {
        S.updateChecked = { at: now, latest: found }
        await save($, 'update-check', S.updateChecked).catch(() => undefined)
      }
    }
    await tellUpdate($, now)
  } catch {
  } finally {
    S.updateBusy = false
  }
}
