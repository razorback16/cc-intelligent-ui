// A click's target opened (register.tsx clickAt): a web link in the
// browser, a file in an editor at its line and column, or in the system's
// app for it when that runs nothing (appArgv). The pure parts: the known
// editors, the `/iui editor` setting, the program a click uses and its argv.
// And the PATH lookups, cached in S.
// No argument goes through a shell.
import type { EngineInterface } from 'claude-code'

import { exec } from './api'
import { EXTS } from './links'
import { S } from './state'
import type { Target } from './targets'

// How long the program that opens a target may run (it is killed after).
export const OPEN_TIMEOUT_MS = 5000
// Runs its arguments in the background: one that exits within about 2 s
// gives its exit code, one still running then counts as opened and is left to run.
export const DETACH_SH = '"$@" </dev/null >/dev/null 2>&1 & p=$!; i=0; while kill -0 "$p" 2>/dev/null; do i=$((i+1)); [ "$i" -ge 20 ] && exit 0; sleep 0.1; done; wait "$p"'

// An opener's argv run through DETACH_SH (the argv as its arguments, never in the script).
export function detachedArgv(argv: readonly string[]): string[] {
  return ['sh', '-c', DETACH_SH, 'sh', ...argv]
}

// How an editor takes a line and a column: `-g path:line:column` (goto),
// `path:line:column` (suffix) or `--line N --column M path` (flags).
export type EditorForm = 'goto' | 'suffix' | 'flags'
// The known editors in the order `auto` looks for them, with their form.
export const EDITORS: readonly (readonly [string, EditorForm])[] = [
  ['code', 'goto'], ['code-insiders', 'goto'], ['codium', 'goto'], ['cursor', 'goto'], ['windsurf', 'goto'],
  ['zed', 'suffix'], ['zeditor', 'suffix'], ['subl', 'suffix'],
  ['idea', 'flags'], ['webstorm', 'flags'], ['pycharm', 'flags'], ['goland', 'flags'], ['clion', 'flags'], ['rider', 'flags'],
]
export const EDITOR_NAMES: readonly string[] = EDITORS.map(([name]) => name)

// The `/iui editor` setting: `auto`, the system app (`default`), a known
// editor, or a command (its words, with `{path}` and maybe `{line}` and `{column}`).
export type Editor = { kind: 'auto' } | { kind: 'default' } | { kind: 'known'; name: string } | { kind: 'command'; words: string[] }

// The setting as an Editor, split on spaces; null when it is none (more
// than one word and no `{path}`, or a placeholder in the first word). One
// word that is no known editor is a command that takes the path.
export function parseEditor(value: string): Editor | null {
  const words = value.trim().split(/\s+/).filter(Boolean)
  const one = words.length === 1 ? words[0]! : ''
  if (!words.length || one === 'auto') return { kind: 'auto' }
  if (one === 'default') return { kind: 'default' }
  if (one && EDITOR_NAMES.includes(one)) return { kind: 'known', name: one }
  if (/[{}]/.test(words[0]!)) return null
  if (one) return { kind: 'command', words: [one, '{path}'] }
  return words.some(w => w.includes('{path}')) ? { kind: 'command', words } : null
}

// The program a click opens a file with: a known editor or a command at its
// path (`bin`), or the system app. `missed`: the setting's program, which is
// not on the PATH (the click fell back to auto's choice).
export type Use =
  | { kind: 'known'; name: string; bin: string; missed?: string }
  | { kind: 'command'; words: string[]; bin: string }
  | { kind: 'app'; missed?: string }

// auto's choice: the first known editor on the PATH ('' none).
export function autoOf(has: (name: string) => boolean): string {
  return EDITOR_NAMES.find(has) ?? ''
}

// The program for a setting. `pathOf`: a program's path on the PATH ('' none);
// `auto`: auto's choice ('' none). A command's first word counts when it is absolute.
export function useOf(editor: Editor, pathOf: (name: string) => string, auto: string): Use {
  const fallback = (missed?: string): Use => {
    const bin = auto ? pathOf(auto) : ''
    const use: Use = bin ? { kind: 'known', name: auto, bin } : { kind: 'app' }
    return missed ? { ...use, missed } : use
  }
  if (editor.kind === 'auto') return fallback()
  if (editor.kind === 'default') return { kind: 'app' }
  if (editor.kind === 'known') {
    const bin = pathOf(editor.name)
    return bin ? { kind: 'known', name: editor.name, bin } : fallback(editor.name)
  }
  const first = editor.words[0]!
  const bin = first.startsWith('/') ? first : pathOf(first)
  return bin ? { kind: 'command', words: editor.words, bin } : fallback(first)
}

type Place = { path: string; line?: number; column?: number }

// A known editor's argv for a file (its line and column where known).
function knownArgv(form: EditorForm, bin: string, f: Place): string[] {
  const at = f.line ? `:${f.line}${f.column ? `:${f.column}` : ''}` : ''
  if (form === 'goto') return [bin, '-g', f.path + at]
  if (form === 'suffix') return [bin, f.path + at]
  const line = f.line ? ['--line', String(f.line)] : []
  const column = f.line && f.column ? ['--column', String(f.column)] : []
  return [bin, ...line, ...column, f.path]
}

// A command's argv for a file: its first word the program's path, the
// placeholders put in. A word with a placeholder that has no value is left
// out (`+{line}` with no line); in the path's word, only that placeholder
// goes (with the `:` before it).
function commandArgv(words: readonly string[], bin: string, f: Place): string[] {
  const values: Record<string, string> = { path: f.path, line: f.line ? String(f.line) : '', column: f.line && f.column ? String(f.column) : '' }
  return words.flatMap((w, i) => {
    if (i === 0) return [bin]
    const word = w.includes('{path}') ? w.replace(/:?\{(line|column)\}/g, (m, key: string) => (values[key] ? m : '')) : w
    if ([...word.matchAll(/\{(path|line|column)\}/g)].some(m => !values[m[1]!])) return []
    return [word.replace(/\{(path|line|column)\}/g, (_, key: string) => values[key]!)]
  })
}

// The file types the system app opens, by extension (lower case). A plain
// `open` or `xdg-open` runs some files (on macOS a .command, .tool or
// .terminal file, an .app, the URL of a .webloc or .fileloc, a .jar; on
// Linux a .desktop file or a script), so only these open; another file
// copies its path. Pictures and PDFs: a plain open, in their viewer.
export const VIEW_EXTS: ReadonlySet<string> = new Set('png jpg jpeg gif webp svg pdf'.split(' '))
// Text and code (links.ts EXTS less pictures): on macOS `open -t`, the text editor, which runs nothing.
export const TEXT_EXTS: ReadonlySet<string> = new Set([...EXTS].filter(ext => !VIEW_EXTS.has(ext)))
// Text that a default app may run or show as a web page (scripts, notebooks, HTML).
const RUNS = new Set('sh bash zsh fish ps1 py pyi rb pl php lua js mjs cjs html htm xml ipynb'.split(' '))
// The files a plain open does not run (Linux has no `-t`): pictures, PDFs, and text and code less RUNS.
export const PLAIN_EXTS: ReadonlySet<string> = new Set([...VIEW_EXTS, ...[...TEXT_EXTS].filter(ext => !RUNS.has(ext))])

// A path's extension in lower case ('' none).
export const extOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1]!.toLowerCase() ?? ''
// Whether a plain open (`open`, `xdg-open`, a terminal's file:// link) of a file runs nothing.
export const opensPlain = (path: string) => PLAIN_EXTS.has(extOf(path))

// The system app's argv for a file: a picture or PDF in its viewer; text
// or code in the text editor on macOS (`open -t`), with xdg-open on Linux
// when it is in PLAIN_EXTS. Null for any other file (it copies).
function appArgv(path: string, isMac: boolean): string[] | null {
  const ext = extOf(path)
  if (VIEW_EXTS.has(ext)) return [isMac ? 'open' : 'xdg-open', path]
  if (isMac) return TEXT_EXTS.has(ext) ? ['open', '-t', path] : null
  return PLAIN_EXTS.has(ext) ? ['xdg-open', path] : null
}

// The argv that opens a target: a web link with the system's opener (`open`
// on macOS, `xdg-open` on Linux), a file with `use` (the system app: with no
// line, and only the types of appArgv). Null for a command, code or a file
// the system app does not open (those copy).
export function openArgv(target: Target, o: { isMac: boolean; use: Use }): string[] | null {
  const opener = o.isMac ? 'open' : 'xdg-open'
  if (target.kind === 'web') return [opener, target.href]
  if (target.kind !== 'file') return null
  const { use } = o
  if (use.kind === 'app') return appArgv(target.path, o.isMac)
  if (use.kind === 'command') return commandArgv(use.words, use.bin, target)
  const form = EDITORS.find(([name]) => name === use.name)?.[1] ?? 'suffix'
  return knownArgv(form, use.bin, target)
}

// The name of the program `use` opens with, for the toast.
export function useName(use: Use): string {
  return use.kind === 'known' ? use.name : use.kind === 'command' ? use.words[0]!.split('/').pop()! : 'the default app'
}

// The toast of an open: the link, or the file's name and the program (and
// the setting's program that is not on the PATH).
export function openedText(target: Target, use: Use): string {
  if (target.kind !== 'file') return 'Intelligent UI: opened the link'
  const missed = use.kind !== 'command' && use.missed ? ` (${use.missed} is not on the PATH)` : ''
  return `Intelligent UI: opened ${target.path.split('/').pop()} in ${useName(use)}${missed}`
}

// ---- The PATH ---------------------------------------------------------------

// A name the lookup takes: a plain program name (no path, no option).
const NAME = /^\w[\w.+-]*$/
// Prints `name path` for each of its arguments that `command -v` finds.
const LOOKUP_SH = 'for c in "$@"; do p=$(command -v "$c" 2>/dev/null) && echo "$c $p"; done; :'

// The paths of programs on the PATH by name ('' none, also for a name that
// is not plain), with no cache: the login shell's PATH first (`sh -lc`),
// then sh's own for those not found. Only an absolute path counts. The
// names go to the shell as arguments.
export async function pathsOf($: EngineInterface, names: readonly string[]): Promise<Map<string, string>> {
  const found = new Map(names.map(name => [name, ''] as [string, string]))
  for (const flag of ['-lc', '-c']) {
    const left = names.filter(name => !found.get(name) && NAME.test(name))
    if (!left.length) break
    const got = await exec($, ['sh', flag, LOOKUP_SH, 'sh', ...left], { timeoutMs: 5000 }).catch(() => null)
    if (got?.exitCode !== 0) continue
    for (const line of got.stdout.split('\n')) {
      const m = /^(\S+) (\/.*)$/.exec(line.replace(/\r$/, ''))
      if (m && found.get(m[1]!) === '') found.set(m[1]!, m[2]!)
    }
  }
  return found
}

// The paths of programs on the PATH, each looked up once per session (S.onPath).
export async function findOnPaths($: EngineInterface, names: readonly string[]): Promise<Map<string, string>> {
  const left = names.filter(name => !S.onPath.has(name))
  if (left.length) for (const [name, path] of await pathsOf($, left)) S.onPath.set(name, path)
  return new Map(names.map(name => [name, S.onPath.get(name) ?? ''] as [string, string]))
}

export async function findOnPath($: EngineInterface, name: string): Promise<string> {
  return (await findOnPaths($, [name])).get(name) ?? ''
}

// auto's choice, looked up once per session (S.autoEditor; all known editors in one lookup).
export async function findAuto($: EngineInterface): Promise<string> {
  if (S.autoEditor !== null) return S.autoEditor
  const paths = await findOnPaths($, EDITOR_NAMES)
  S.autoEditor = autoOf(name => !!paths.get(name))
  return S.autoEditor
}

// The program a click opens a file with now, for S.editor (a setting that is none: auto).
export async function editorNow($: EngineInterface): Promise<Use> {
  const editor = parseEditor(S.editor) ?? { kind: 'auto' }
  if (editor.kind === 'default') return { kind: 'app' }
  const auto = await findAuto($)
  const first = editor.kind === 'command' ? editor.words[0]! : editor.kind === 'known' ? editor.name : ''
  const paths = await findOnPaths($, [first, auto].filter(name => name && !name.startsWith('/')))
  return useOf(editor, name => paths.get(name) ?? '', auto)
}
