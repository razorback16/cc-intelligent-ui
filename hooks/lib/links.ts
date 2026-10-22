// The links, file paths and commands of an answer (pure), for the rows under
// its picture: a picture has no URL text, so the terminal can not click it.
import { blocksOf, FENCE } from './markdown'

export type LinkItem =
  | { kind: 'web'; label: string; href: string }
  | { kind: 'file'; label: string; path: string }
  | { kind: 'command'; label: string; text: string }

// The fence infos of shell commands; in a session block, only the prompt
// lines are commands (the other lines are output).
const SHELL = /^(bash|sh|zsh|shell|console|shell-session)$/i
const SESSION = /^(console|shell-session)$/i
const PROMPT = /^[$%] /

const DEF = /^ {0,3}\[(?!\^)([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/
const CODE = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g
const BLOCK_MATH = /\$\$[\s\S]*?\$\$/g
const INLINE_MATH = /(?<![\\$])\$(?![\s$])(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\d)/g
const INLINE = /\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(?:<([^>\n]*)>|((?:[^\s()]|\([^\s()]*\))*))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g
const REF = /\[((?:[^[\]]|\[[^[\]]*\])*)\](?:\[([^[\]]*)\])?/g
const AUTO = /<((?:https?|mailto):[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[a-z]{2,})>/gi
const BARE = /\bhttps?:\/\/[^\s<>"`]+/gi

// File paths. A path is segments of `[\w.@+-]` joined by `/` (it may start
// with `/`, `./`, `../` or `~/`) whose last segment has an extension, with
// an optional `:line` or `:line:col`. It counts when it has a `/` (and its
// first segment is not a host name such as `example.com`), or when its
// extension is in EXTS (lower case). So `e.g.`, `1.2.3`, `v0.15` and
// `typst.app` are not paths. In bare text, a word such as `Node.js` is a
// name, not a path.
const PATH = String.raw`((?:~\/|\.{1,2}\/|\/)?(?:\.?[\w@+-][\w.@+-]*\/)*\.?[\w@+-][\w.@+-]*\.([A-Za-z][A-Za-z0-9]*))(?::(\d+)(?::(\d+))?)?`
const FILE = new RegExp(`^${PATH}$`)
const BARE_FILE = new RegExp(`(?<![\\w./~@+:-])${PATH}(?![\\w/])`, 'g')
const HOST = /^[\w-]+(?:\.[\w-]+)+$/
const EXTS = new Set(
  ('ts tsx js jsx mjs cjs json jsonc md mdx markdown txt rst adoc py pyi rb go rs java kt kts swift c h cc cpp cxx hpp hh cs fs php ' +
    'sh bash zsh fish ps1 lua pl scala clj ex exs erl hs ml sql html htm css scss sass less vue svelte astro yml yaml toml ini cfg conf ' +
    'xml csv tsv lock log typ tex bib png jpg jpeg gif svg webp pdf ipynb gradle proto graphql dart zig nim tf hcl patch diff').split(' '),
)

// A path and its label (the path with its `:line:col`), or null.
export function fileOf(token: string, bare = false): { path: string; label: string } | null {
  const m = FILE.exec(token)
  if (!m || token.includes('://')) return null
  const path = m[1]!
  if (!path.includes('/')) {
    if (!EXTS.has(m[2]!) || (bare && /^[A-Z][a-z]+\.js$/.test(path))) return null
  } else if (!/^[./~]/.test(path) && HOST.test(path.split('/')[0]!)) return null
  return { path, label: token }
}

const isWeb = (url: string) => /^(https?:\/\/|mailto:)\S/i.test(url)
const refKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()

// The item a link target makes: a web link, a local file (a relative path
// or a file:// URL), or null (an anchor, another scheme).
function targetOf(label: string, url: string): LinkItem | null {
  if (isWeb(url)) return { kind: 'web', label: label || url, href: url }
  const file = fileOf(url.replace(/^file:\/\//i, '').replace(/[?#].*$/, ''))
  return file ? { kind: 'file', ...file } : null
}

// A link text as one plain line: no images, links, code ticks, emphasis
// or escapes.
const labelOf = (md: string) =>
  md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/`+/g, '')
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?=\S)([\s\S]*?\S)[*_](?![\w*])/g, '$1$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

// A bare URL less the punctuation after it: `.,;:!?'"*` and a `)` or `]`
// that closes nothing in the URL.
export function trimUrl(url: string): string {
  const count = (c: string) => url.split(c).length - 1
  for (;;) {
    const last = url.at(-1)!
    if (`.,;:!?'"*`.includes(last)) url = url.slice(0, -1)
    else if (last === ')' && count('(') < count(')')) url = url.slice(0, -1)
    else if (last === ']' && count('[') < count(']')) url = url.slice(0, -1)
    else return url
  }
}

// Whether a line closes a fence that opened with `mark`.
function closes(line: string, mark: string): boolean {
  const m = FENCE.exec(line)
  return !!m && m[2]![0] === mark[0] && m[2]!.length >= mark.length && line.trim() === m[2]
}

// The command of a fenced block (its lines, the fences too) with a shell
// info: prompts dropped, in a session block only the prompt lines (and
// their `\` continuations). Null for another info or an empty block.
function commandOf(info: string, lines: string[]): LinkItem | null {
  if (!SHELL.test(info)) return null
  const open = FENCE.exec(lines[0] ?? '')
  if (!open) return null
  const indent = new RegExp(`^ {0,${open[1]!.length}}`)
  let body = lines.slice(1)
  if (body.length && closes(body.at(-1)!, open[2]!)) body.pop()
  body = body.map(l => l.replace(indent, '').trimEnd())
  if (SESSION.test(info)) {
    let more = false
    body = body.filter(l => {
      const keep = PROMPT.test(l) || more
      more = keep && l.endsWith('\\')
      return keep
    })
  }
  body = body.map(l => l.replace(PROMPT, ''))
  while (body.length && !body[0]!.trim()) body.shift()
  while (body.length && !body.at(-1)!.trim()) body.pop()
  if (!body.length) return null
  const more = body.filter(l => l.trim()).length - 1
  const first = body[0]!.trim()
  return { kind: 'command', label: more ? `${first} (+${more} ${more === 1 ? 'line' : 'lines'})` : first, text: body.join('\n') }
}

type Hit = { at: number; item: LinkItem }

// The items of a block outside a margin fence, in their order: the
// commands of its indented fences, then links, code spans and bare text.
// Each part found is blanked, so a later rule does not see it again.
function textItems(lines: string[], defs: Map<string, string>): LinkItem[] {
  const hits: Hit[] = []
  const text: string[] = []
  let offset = 0
  const put = (line: string) => {
    text.push(line)
    offset += line.length + 1
  }
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]!)
    if (m) {
      let j = i + 1
      while (j < lines.length && !closes(lines[j]!, m[2]!)) j++
      const cmd = commandOf(m[3] ?? '', lines.slice(i, j + 1))
      if (cmd) hits.push({ at: offset, item: cmd })
      for (const l of lines.slice(i, j + 1)) put(' '.repeat(l.length))
      i = j
    } else put(DEF.test(lines[i]!) ? ' '.repeat(lines[i]!.length) : lines[i]!)
  }
  const src = text.join('\n')
  let masked = src
  const hide = (from: number, to: number) => {
    masked = masked.slice(0, from) + masked.slice(from, to).replace(/[^\n]/g, ' ') + masked.slice(to)
  }
  const add = (at: number, item: LinkItem | null) => item && hits.push({ at, item })

  for (const m of src.matchAll(CODE)) {
    const code = m[2]!.replace(/\s+/g, ' ').trim()
    if (code.startsWith('! ')) add(m.index, { kind: 'command', label: code, text: code })
    else {
      const file = fileOf(code)
      if (file) add(m.index, { kind: 'file', ...file })
    }
    hide(m.index, m.index + m[0].length)
  }
  for (const re of [BLOCK_MATH, INLINE_MATH]) for (const m of masked.matchAll(re)) hide(m.index, m.index + m[0].length)
  for (const m of masked.matchAll(INLINE)) {
    const end = m.index + m[0].length
    if (masked[m.index - 1] !== '!') add(m.index, targetOf(labelOf(src.slice(m.index + 1, m.index + 1 + m[1]!.length)), m[2] ?? m[3] ?? ''))
    hide(m.index, end)
  }
  for (const m of masked.matchAll(REF)) {
    if (m[1]!.startsWith('^') || masked[m.index + m[0].length] === '(') continue
    const url = defs.get(refKey(m[2] || m[1]!))
    if (url === undefined) continue
    if (masked[m.index - 1] !== '!') add(m.index, targetOf(labelOf(src.slice(m.index + 1, m.index + 1 + m[1]!.length)), url))
    hide(m.index, m.index + m[0].length)
  }
  for (const m of masked.matchAll(AUTO)) {
    const url = m[1]!
    const href = /^(https?|mailto):/i.test(url) ? url : `mailto:${url}`
    add(m.index, { kind: 'web', label: url, href })
    hide(m.index, m.index + m[0].length)
  }
  for (const m of masked.matchAll(BARE)) {
    const url = trimUrl(m[0])
    add(m.index, { kind: 'web', label: url, href: url })
    hide(m.index, m.index + url.length)
  }
  for (const m of masked.matchAll(BARE_FILE)) {
    const file = fileOf(m[0], true)
    if (file) add(m.index, { kind: 'file', ...file })
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.item)
}

// The web links, file paths and commands of some Markdown, each once (the
// first), in the order they first show.
export function linksOf(md: string): LinkItem[] {
  const blocks = blocksOf(md)
  const defs = new Map<string, string>()
  for (const block of blocks) {
    if (block.fence) continue
    for (const line of block.lines) {
      const m = DEF.exec(line)
      if (m && !defs.has(refKey(m[1]!))) defs.set(refKey(m[1]!), m[2]!)
    }
  }
  const seen = new Set<string>()
  return blocks
    .flatMap(block => {
      if (!block.fence) return textItems(block.lines, defs)
      const cmd = commandOf(block.fence.info, block.lines)
      return cmd ? [cmd] : []
    })
    .filter(item => {
      const key = `${item.kind} ${item.kind === 'web' ? item.href : item.kind === 'file' ? item.path : item.text}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
