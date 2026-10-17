// Themes: a theme folder's theme.json, the built-in and user themes, the one
// to draw with, what `/iui theme` lists, and the scan on the host.
import type { EngineInterface } from 'claude-code'

import { BASE_THEME, DEFAULT_THEME, MODES } from './settings'
import { S } from './state'

// A theme folder's name: letters, digits, `.`, `_`, `-`.
export const isThemeName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)

// `syntax`: the tmTheme file theme.json names for a mode, relative to the
// theme folder; a mode it does not name uses the base theme's file.
export type ThemeSyntax = Partial<Record<(typeof MODES)[number], string>>
export type ThemeInfo = { name: string; dir: string; isUser: boolean; title: string; description: string; syntax: ThemeSyntax }
export type ThemeProblem = { name: string; dir: string; isUser: boolean; reason: string }

// One theme folder from its theme.json text: usable, or why not.
export function themeEntry(name: string, dir: string, isUser: boolean, json: string): ThemeInfo | ThemeProblem {
  if (!isThemeName(name)) return { name, dir, isUser, reason: 'the folder name has characters other than letters, digits, ., _ and -' }
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (err) {
    return { name, dir, isUser, reason: `theme.json is not valid JSON (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { name, dir, isUser, reason: 'theme.json is not a JSON object' }
  const field = (key: string) => {
    const v = (data as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : ''
  }
  const named = (data as Record<string, unknown>).syntax
  const syntax: ThemeSyntax = {}
  if (named !== undefined) {
    if (!named || typeof named !== 'object' || Array.isArray(named)) return { name, dir, isUser, reason: '"syntax" is not an object of file names' }
    for (const mode of MODES) {
      const file = (named as Record<string, unknown>)[mode]
      if (file === undefined) continue
      if (!isSyntaxPath(file)) return { name, dir, isUser, reason: `"syntax.${mode}" must be a file name in the theme folder (no "/" at the start, no "..")` }
      syntax[mode] = file
    }
  }
  return { name, dir, isUser, title: field('name') || name, description: field('description'), syntax }
}

// A tmTheme path in theme.json: relative to the theme folder and inside it.
export const isSyntaxPath = (file: unknown): file is string =>
  typeof file === 'string' && file.trim() !== '' && !file.startsWith('/') && !file.includes('\\') && !file.split('/').includes('..')

// The files a theme's pictures depend on: its theme.json, the base
// theme.json it merges over, and for each mode the tmTheme it names, else
// the base theme's. A missing `theme` (not found yet) counts as the base.
export function themeFiles(theme: ThemeInfo | undefined, base: ThemeInfo | undefined, root: string): string[] {
  const baseDir = base?.dir ?? `${root}/render/themes/${BASE_THEME}`
  const files = [`${theme?.dir ?? baseDir}/theme.json`, `${baseDir}/theme.json`]
  for (const mode of MODES) {
    const own = theme?.syntax[mode]
    files.push(own ? `${theme!.dir}/${own}` : `${baseDir}/${base?.syntax[mode] ?? `${mode}.tmTheme`}`)
  }
  return files
}

// Built-in themes, then user themes: a usable user theme replaces the
// built-in of the same name; a broken one is only reported.
export function pickThemes(found: readonly (ThemeInfo | ThemeProblem)[]): { themes: Map<string, ThemeInfo>; problems: ThemeProblem[] } {
  const themes = new Map<string, ThemeInfo>()
  const problems: ThemeProblem[] = []
  for (const isUser of [false, true]) {
    for (const one of found) {
      if (one.isUser !== isUser) continue
      if ('reason' in one) problems.push(one)
      else themes.set(one.name, one)
    }
  }
  return { themes, problems }
}

// The theme to draw with: the wanted one, else the default theme, else the
// base theme (`isFallback`). The base theme's own folder is used even before
// it is found on disk.
export function chooseTheme(themes: ReadonlyMap<string, ThemeInfo>, wanted: string, root: string): { name: string; dir: string; isFallback: boolean } {
  const got = themes.get(wanted)
  if (got) return { name: got.name, dir: got.dir, isFallback: false }
  const fallback = themes.get(DEFAULT_THEME)
  if (fallback) return { name: fallback.name, dir: fallback.dir, isFallback: true }
  const base = themes.get(BASE_THEME)
  return { name: BASE_THEME, dir: base?.dir ?? `${root}/render/themes/${BASE_THEME}`, isFallback: wanted !== BASE_THEME }
}

// What `/iui theme` lists.
export function themeListing(themes: ReadonlyMap<string, ThemeInfo>, problems: readonly ThemeProblem[], active: string, userDir: string): string {
  const lines = [...themes.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `${t.name === active ? '*' : '-'} ${t.name} (${t.isUser ? 'user' : 'built-in'})${t.description ? `: ${t.description}` : ''}`)
  const skipped = problems.map(p => `  skipped ${p.name} (${p.isUser ? 'user' : 'built-in'}): ${p.reason}`)
  return [
    `Themes (* = active):`,
    ...(lines.length ? lines : ['- none found']),
    ...skipped,
    `User themes go in ${userDir}/<name>/theme.json. Switch with /iui theme <name>.`,
  ].join('\n')
}

// The built-in themes under render/themes and the user's under
// ~/.claude/intelligent-ui/themes, read fresh each call.
export async function scanThemes($: EngineInterface, root: string, home: string) {
  const found: (ThemeInfo | ThemeProblem)[] = []
  for (const [base, isUser] of [[`${root}/render/themes`, false], [userThemesOf(home), true]] as const) {
    const entries = await $.fs.list(base).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'file') continue
      const dir = `${base}/${entry.name}`
      const json = await $.fs.read(`${dir}/theme.json`).catch(() => null)
      if (json === null) continue
      const one = themeEntry(entry.name, dir, isUser, json)
      const lost = 'reason' in one ? [] : await missingSyntax($, one)
      found.push(lost.length ? { name: one.name, dir, isUser, reason: `theme.json names syntax files that do not exist: ${lost.join(', ')}` } : one)
    }
  }
  return pickThemes(found)
}

// The syntax files a theme names that are not on disk (they fail the compile).
export async function missingSyntax($: EngineInterface, theme: ThemeInfo) {
  const lost: string[] = []
  for (const mode of MODES) {
    const file = theme.syntax[mode]
    if (file && !(await $.fs.exists(`${theme.dir}/${file}`).catch(() => false))) lost.push(file)
  }
  return lost
}

export const userThemesOf = (home: string) => `${home || '~'}/.claude/intelligent-ui/themes`

// The mtimes of the files a theme's pictures depend on (themeFiles): a
// change to any of them makes new keys.
export async function stampTheme($: EngineInterface, files: readonly string[]): Promise<string> {
  const times: string[] = []
  for (const file of files) {
    const stat = await $.fs.stat(file).catch(() => null)
    times.push(String(stat?.mtimeMs ?? 0))
  }
  return times.join(',')
}

// Picks the stored theme (or the default one), sets `look`, and says when the
// stored one was not usable.
export async function applyTheme($: EngineInterface, root: string, home: string, wanted: string) {
  const { themes, problems } = await scanThemes($, root, home)
  S.themeChoices = [...themes.values()]
  const chosen = chooseTheme(themes, wanted, root)
  // theme.typ always merges over the built-in vscode, also when a user theme
  // has that name, so the stamp uses the built-in one.
  const builtIn = themes.get(BASE_THEME)
  const files = themeFiles(themes.get(chosen.name), builtIn?.isUser ? undefined : builtIn, root)
  S.look = { name: chosen.name, dir: chosen.dir, stamp: await stampTheme($, files) }
  return { themes, problems, chosen }
}
