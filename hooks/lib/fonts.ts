// The lean font set: a compile of plain text loads only the theme's Latin
// fonts and the terminal font, from a folder of links, and not every system
// font. Typst reads all system fonts at each start (about 70 ms on macOS);
// the lean set takes about 10 ms. The PNG does not change: for ASCII text,
// Typst takes each glyph from the first font of the list that has it, and
// that font is in the lean set. A glyph that no listed font has (Typst then
// looks in all fonts) can come only from other text: emoji, CJK, symbols,
// math. Such a text compiles with all fonts.
import type { EngineInterface } from 'claude-code'

import { leanDirs, type Env, type LeanFonts } from './state'
import { FENCE, isTypstInfo } from './markdown'
import { hashOf } from './draw'
import { logDebug } from './log'
import { fsExists, processRun } from './api'

// The CJK and emoji fonts: large to read, and plain text never needs them.
export const SKIPPED_FONTS = /emoji|cjk|pingfang|hiragino|gothic|han sans|han serif|yahei|jhenghei|meiryo|malgun|simsun|simhei|wenquanyi|droid sans fallback/i

// One font face of `typst fonts --variants`: its file (null: in Typst
// itself; a variable font's ` (Variable)` mark is cut) and its variant
// (`Normal, Weight: 400, Stretch: 100%`).
export type Face = { file: string | null; variant: string }

// `typst fonts --variants` as faces by family (lower case, as Typst
// matches a family name).
export function fontListOf(stdout: string): Map<string, Face[]> {
  const families = new Map<string, Face[]>()
  let faces: Face[] | null = null
  let file: string | null = null
  for (const line of stdout.split('\n')) {
    if (line && !/^\s/.test(line)) {
      const family = line.trim().toLowerCase()
      faces = families.get(family) ?? []
      families.set(family, faces)
      continue
    }
    const at = /^\s+[├└]\S*\s+(.*)$/.exec(line)
    if (at) {
      file = at[1] === '(Embedded)' ? null : at[1]!.replace(/\s+\(Variable\)\s*$/, '').trim()
      continue
    }
    const style = /^\s+\S*\s+Style:\s*(.*)$/.exec(line)
    if (style && faces) faces.push({ file, variant: style[1]!.trim() })
  }
  return families
}

// Whether `typst fonts --variants` lists a bold face of a family: a weight
// of 600 or more (a variable font: its top weight). Null when the family is
// not listed.
export function hasBoldFace(stdout: string, family: string): boolean | null {
  const want = family.trim().toLowerCase()
  let inFamily = false
  let seen = false
  let bold = false
  for (const line of stdout.split('\n')) {
    if (line && !/^\s/.test(line)) {
      inFamily = line.trim().toLowerCase() === want
      seen ||= inFamily
      continue
    }
    const m = inFamily ? /Weight:\s*(\d+)(?:-(\d+))?/.exec(line) : null
    if (m && Number(m[2] ?? m[1]) >= 600) bold = true
  }
  return seen ? bold : null
}

// The font files of the lean set, in the order of the list: the faces of
// the terminal font and of each body and code font that is not skipped.
// Null when the lean set can draw differently: the first font of a list
// that is installed is a skipped one, a list has no installed font, or a
// family has the same variant in two files (Typst takes the first one it
// read, and the two reads go in a different order).
export function leanFiles(list: ReadonlyMap<string, readonly Face[]>, termFont: string, fonts: LeanFonts): string[] | null {
  const has = (family: string) => (list.get(family.toLowerCase())?.length ?? 0) > 0
  // The code font list with and without the terminal font (a theme can
  // turn it off).
  for (const each of [fonts.body, fonts.code, [termFont, ...fonts.code].filter(Boolean)]) {
    const first = each.find(has)
    if (!first || (first !== termFont && SKIPPED_FONTS.test(first))) return null
  }
  const files: string[] = []
  const seen = new Set<string>()
  for (const family of [termFont, ...fonts.body, ...fonts.code]) {
    const key = family.toLowerCase()
    if (!family || seen.has(key) || (family !== termFont && SKIPPED_FONTS.test(family))) continue
    seen.add(key)
    const where = new Map<string, string>()
    for (const face of list.get(key) ?? []) {
      if (!face.file) continue
      const other = where.get(face.variant)
      if (other !== undefined && other !== face.file) return null
      where.set(face.variant, face.file)
      if (!files.includes(face.file)) files.push(face.file)
    }
  }
  return files.length ? files : null
}

// The lean folder of a set of files: in the cache, by the files.
export const leanDirOf = (cache: string, files: readonly string[]) => `${cache}/fonts-${hashOf(files)}`

// Makes the lean folder: one link for each file (named by its place, so two
// files of one name do not clash). A folder that is there is kept (its name
// says its files). Made in a temporary folder first, so a compile never
// sees a half folder; when another session made it first, ours goes.
export const LEAN_SH = [
  'd=$1; shift; [ -d "$d" ] && exit 0',
  't="$d.$$"; rm -rf "$t"; mkdir -p "$t" || exit 1',
  'i=0; for f in "$@"; do i=$((i+1)); ln -s "$f" "$t/$i-${f##*/}" || { rm -rf "$t"; exit 1; }; done',
  'mv "$t" "$d" 2>/dev/null; rm -rf "$t" "$d/${t##*/}"; [ -d "$d" ]',
].join('\n')

// Plain text for the lean set: ASCII only, no live Typst block (its code
// can name any font or symbol), no image (an image alt has an emoji), no
// HTML entity or <img>, and no math outside code (a math symbol that the
// math font does not have comes from any font). Math is `$`; the `$` of
// code (fenced blocks, code spans) does not count.
export function isPlain(md: string): boolean {
  if (!/^[\x20-\x7e\t\n\r]*$/.test(md)) return false
  if (/!\[|<img|&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(md)) return false
  const prose: string[] = []
  let open: { char: string; len: number } | null = null
  for (const line of md.split(/\r\n?|\n/)) {
    const m = FENCE.exec(line)
    if (open) {
      if (m && m[2]![0] === open.char && m[2]!.length >= open.len && line.trim() === m[2]) open = null
    } else if (m) {
      if (isTypstInfo(m[3] ?? '')) return false
      open = { char: m[2]![0]!, len: m[2]!.length }
    } else prose.push(line)
  }
  const text = prose.join('\n')
  // A code span: a run of backticks to the same run, in one line (a span
  // over lines can be two paragraphs). With an escaped backtick, no span
  // is cut out (each `$` counts).
  const outside = text.includes('\\`') ? text : text.replace(/(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g, '')
  return !outside.includes('$')
}

// The lean folder for a compile of `segments`: '' when the text is not
// plain, the theme's lists are not, or the folder is not made yet. The
// first call for a set of fonts starts the make (in the background), so
// that compile uses all fonts. `vars`: the environment of a compile.
export async function leanFontsFor($: EngineInterface, env: Env, segments: readonly string[], vars: Record<string, string>): Promise<string> {
  const fonts = env.metrics.fonts
  if (!env.typst || !fonts?.plain || !segments.every(isPlain)) return ''
  const want = JSON.stringify([env.typst, env.termFont, fonts.body, fonts.code])
  const dir = leanDirs.get(want)
  if (dir === undefined) {
    leanDirs.set(want, '')
    void makeLean($, env, env.typst, fonts, want, vars)
    return ''
  }
  if (!dir) return ''
  // The cleanup at start removes the folders not used for 2 days: one gone
  // is made again.
  if (!(await fsExists($, dir).catch(() => false))) {
    leanDirs.delete(want)
    return ''
  }
  return dir
}

// Lists the fonts as a compile sees them (its environment), then links the
// files of the lean set. A failure is kept: no lean set for these fonts in
// this session.
async function makeLean($: EngineInterface, env: Env, typst: string, fonts: LeanFonts, want: string, vars: Record<string, string>) {
  const listed = await processRun($, [typst, 'fonts', '--variants'], { timeoutMs: 10000, env: vars }).catch(() => null)
  const files = listed?.exitCode === 0 ? leanFiles(fontListOf(listed.stdout), env.termFont, fonts) : null
  if (!files) {
    await logDebug($, env.cache, 'lean fonts: not used (the font list does not allow it)')
    return
  }
  const dir = leanDirOf(env.cache, files)
  const made = await processRun($, ['sh', '-c', LEAN_SH, 'sh', dir, ...files], { timeoutMs: 10000 }).catch(() => null)
  if (made?.exitCode !== 0) {
    await logDebug($, env.cache, `lean fonts: the folder ${dir} was not made:\n${made?.stderr ?? ''}`)
    return
  }
  if (leanDirs.get(want) === '') leanDirs.set(want, dir)
}
