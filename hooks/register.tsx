// md-preview: draws Claude's answers (AssistantMessage blocks) as pictures of
// rendered Markdown, made by Typst from the template in ../render/md.typ.
// The stored message never changes; only its drawing does.
//
// Flow: the render hook makes a key from the text, the width, the cell size,
// the theme and the template. A known key draws its PNGs. An unknown key
// draws the plain text and starts a timer; when the text has been still for
// SETTLE_MS the key is compiled (at most MAX_RUNNING at once), and the `done`
// atom goes up so every reader draws again and finds the PNGs.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { MdPreviewTheme } from '../types'

// ---- Settings -------------------------------------------------------------

// The widest picture, in terminal columns.
export const MAX_COLUMNS = 120
// The bullet column to the left of an answer.
const GUTTER = 2
// Claude Code's own reply bullet: ⏺ on macOS, ● elsewhere.
const bulletOf = (isMac: boolean) => (isMac ? '⏺' : '●')
// The engine's answer row has a blank row above it; ours keeps it.
const MARGIN_TOP = 1
// The template's body text size in pt; the page width is chosen so that this
// text looks as big as the terminal's own (see fontFit).
const BODY_PT = 11
// `/md-preview size`: a percent on top of that match.
export const DEFAULT_SIZE = 100
export const MIN_SIZE = 80
export const MAX_SIZE = 200
// Wait this long after the last change of a block's text before compiling.
const SETTLE_MS = 400
const MAX_RUNNING = 2
// A segment is cut to be about this many rows; an Image is 255 rows at most.
export const SEGMENT_ROWS = 160
const MAX_IMAGE_ROWS = 255
// The cell in device pixels when the tty reports none (tmux, a relay): an
// 8 x 16 point cell at Retina scale 2. A reported cell outside 4 to 64 px
// wide is not trusted.
export const DEFAULT_CELL: Cell = { width: 16, height: 32 }
// Part of every key: bump it when the interface with the template changes.
const TEMPLATE_VERSION = '7'
const COMPILE_TIMEOUT_MS = 20000
const ALT_CHARS = 200
// Where Typst is when the login shell's PATH does not find it. `~` is $HOME.
const TYPST_FALLBACKS = ['/opt/homebrew/bin/typst', '/usr/local/bin/typst', '/usr/bin/typst', '/snap/bin/typst', '~/.cargo/bin/typst', '~/.local/bin/typst']
const NO_TYPST = 'md-preview: install Typst (brew install typst) to see rendered answers'
// Typst downloads a package it doesn't find under --package-path; a proxy
// nobody listens on makes that fail at once, so a live block never fetches.
const NO_NETWORK = 'http://127.0.0.1:9'
// The base every theme merges over (its theme.json and syntax files).
export const BASE_THEME = 'vscode'
// The theme used when none is chosen, or when the chosen one is not usable.
export const DEFAULT_THEME = 'vscode-modern'
// The two modes a theme has syntax colours for.
const MODES = ['dark', 'light'] as const

// What Claude is told while the mod draws its answers (a system prompt
// section, added last).
export const TYPST_PROMPT = `Your replies in this terminal are drawn as rendered Markdown pictures (VS Code preview look), so use Markdown freely: headings, tables, task lists, code blocks, $math$ (LaTeX), images by absolute path.
For anything Markdown can't show well — diagrams, flow charts, plots, coloured tables, complex layouts or math — write a fenced \`\`\`typst block: it is rendered live with Typst 0.15 (full Typst markup; begin code lines with #).
Packages available offline:
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot, chart
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
A \`theme\` dictionary is in scope: theme.fg, theme.muted, theme.link, theme.border, theme.accent, theme.bg, theme.code-bg, theme.red/green/blue/yellow/orange/purple, theme.palette (6 colours), theme.width (content width), theme.dark (bool).
Default strokes in cetz, fletcher and cetz-plot are black and invisible on a dark theme, so always pass theme colours: cetz \`set-style(stroke: theme.fg)\`; fletcher \`diagram(node-stroke: theme.fg, edge-stroke: theme.fg, ...)\`; cetz-plot \`set-style(axes: (stroke: theme.fg, tick: (stroke: theme.fg)), legend: (fill: theme.bg, stroke: theme.border))\`; fills like \`theme.blue.transparentize(70%)\`; size drawings to theme.width at most.
Inside a typst block, #page, #pagebreak and #set page are errors. If a block fails to compile, it is shown as code instead.
The stored text stays Markdown, so keep replies readable as plain text too.`

// ---- State ----------------------------------------------------------------

const isOn = atom({ plugin: 'md-preview', key: 'isOn' } as const, true)
const done = atom({ plugin: 'md-preview', key: 'done' } as const, 0)

export type Cell = { width: number; height: number }
// Per 1 em (render/measure.typ): `adv` the width of "0", `xh` the x-height,
// `avg` the mean advance over a lowercase pangram.
export type FontMetrics = { adv: number; xh: number; avg: number }
// `term` the terminal's font (null when unknown or not installed), `menlo`
// the template's code font, `body` its text font.
export type Metrics = { term: FontMetrics | null; menlo: FontMetrics; body: FontMetrics }
// Measured with Typst on macOS: Menlo and SF Pro Text.
export const DEFAULT_METRICS: Metrics = {
  term: null,
  menlo: { adv: 0.602, xh: 0.547, avg: 0.602 },
  body: { adv: 0.63, xh: 0.526, avg: 0.483 },
}
type Env = {
  typst: string | null
  canDraw: boolean
  cache: string
  cwd: string
  root: string
  isMac: boolean
  stamp: string
  home: string
  // The terminal's font family ('' when not known) and the fonts' metrics.
  termFont: string
  metrics: Metrics
}
type Page = { file: string; width: number; height: number; alt: string }
type Result = { pages: Page[]; columns: number; bulletRow: number; note?: string }
type Job = {
  key: string
  requestId: string
  text: string
  columns: number
  cell: Cell
  theme: MdPreviewTheme
  size: number
  themeDir: string
  env: Env
}
// The active theme: its name, folder, and the mtimes of its files and the
// base theme's, which are part of every key.
export type Look = { name: string; dir: string; stamp: string }

// Module state: lost on a hot reload, which is fine. The PNGs stay on disk
// with a pages.json beside them, so a key compiled before is read back.
let env: Env | null = null
let envLoading: Promise<Env> | null = null
let cell: Cell | null = null
let theme: MdPreviewTheme = 'dark'
let size = DEFAULT_SIZE
let look: Look | null = null
let lastView = ''
let measureTimer: { cancel: () => void } | null = null
const results = new Map<string, Result | 'failed'>()
const timers = new Map<string, { key: string; cancel: () => void }>()
const queue: Job[] = []
const running = new Set<string>()
// The last result drawn per message, so a width change keeps the old picture
// (scaled) until the new one is ready instead of falling back to text.
const shown = new Map<string, { textHash: string; result: Result }>()
// ---- Pure functions (tested) ----------------------------------------------

// FNV-1a over the parts, twice with different offsets: 16 hex digits.
export function hashOf(parts: readonly (string | number)[]): string {
  const s = parts.join('\u0000')
  let a = 0x811c9dc5
  let b = 0x050c5d1f
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

export function themeOf(value: unknown): MdPreviewTheme {
  return typeof value === 'string' && /light/i.test(value) ? 'light' : 'dark'
}

// The columns a picture takes: the viewport less the bullet, MAX_COLUMNS at most.
export function columnsFor(viewportColumns: number | undefined): number {
  return Math.max(20, Math.min(MAX_COLUMNS, (viewportColumns ?? 80) - GUTTER))
}

// How wide a column is in the page's pt so the template's 11 pt body text
// looks as big as the terminal's text, `sizePercent` on top. A terminal em is
// a cell / the advance of its font; the body font is matched to it by
// x-height and average width together (sqrt of the two ratios), since a
// proportional font at the same em looks smaller. Code is set in the
// terminal's font at the terminal's size: `code` is its size / body size.
// The template uses `code` only for a theme that sets "size": "terminal"
// for code; the vscode themes draw code at body size, as VS Code does.
export function fontFit(m: Metrics, sizePercent = 100) {
  const t = m.term ?? m.menlo
  const ratio = Math.sqrt((t.xh / m.body.xh) * (t.avg / m.body.avg))
  const scale = sizePercent / 100
  return {
    columnPt: Math.round(((BODY_PT * t.adv) / (ratio * scale)) * 10000) / 10000,
    code: Math.round((1 / ratio) * 10000) / 10000,
    ratio,
  }
}

// The page width in pt and the ppi that make the PNG exactly as wide as the
// box in device pixels; `rowPt` is one terminal row in the page's pt.
export function sizing(columns: number, px: Cell, columnPt: number) {
  const widthPt = Math.round(columns * columnPt * 100) / 100
  const widthPx = Math.round(columns * px.width)
  const ppi = widthPx / (widthPt / 72)
  return { widthPt, widthPx, ppi, rowPt: (px.height * 72) / ppi }
}

// `/md-preview` arguments: on, off, size <80-200>, or nothing (show state).
export type Command =
  | { kind: 'on' | 'off' | 'show' }
  | { kind: 'size'; percent: number }
  | { kind: 'theme'; name?: string }
  | { kind: 'bad' }
export function parseCommand(args: string): Command {
  const typed = args.trim().split(/\s+/).filter(Boolean)
  const words = typed.map(w => w.toLowerCase())
  if (!words.length) return { kind: 'show' }
  if (words[0] === 'theme') {
    if (typed.length === 1) return { kind: 'theme' }
    if (typed.length === 2 && isThemeName(typed[1]!)) return { kind: 'theme', name: typed[1]! }
    return { kind: 'bad' }
  }
  if (words.length === 1 && (words[0] === 'on' || words[0] === 'off')) return { kind: words[0] }
  if (words[0] === 'size' && words.length === 2 && /^\d+%?$/.test(words[1]!)) {
    const percent = Number.parseInt(words[1]!, 10)
    if (percent >= MIN_SIZE && percent <= MAX_SIZE) return { kind: 'size', percent }
  }
  return { kind: 'bad' }
}

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

// What `/md-preview theme` lists.
export function themeListing(themes: ReadonlyMap<string, ThemeInfo>, problems: readonly ThemeProblem[], active: string, userDir: string): string {
  const lines = [...themes.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `${t.name === active ? '*' : '-'} ${t.name} (${t.isUser ? 'user' : 'built-in'})${t.description ? `: ${t.description}` : ''}`)
  const skipped = problems.map(p => `  skipped ${p.name} (${p.isUser ? 'user' : 'built-in'}): ${p.reason}`)
  return [
    `Themes (* = active):`,
    ...(lines.length ? lines : ['- none found']),
    ...skipped,
    `User themes go in ${userDir}/<name>/theme.json. Switch with /md-preview theme <name>.`,
  ].join('\n')
}

// Every input a picture depends on, as one key.
export function renderKey(o: {
  textHash: string
  columns: number
  cell: Cell
  size: number
  mode: MdPreviewTheme
  termFont: string
  columnPt: number
  templateStamp: string
  look: Look
}): string {
  return hashOf([
    o.textHash, o.columns, o.cell.width, o.cell.height, o.size, o.mode, o.termFont, o.columnPt,
    o.templateStamp, o.look.name, o.look.dir, o.look.stamp, TEMPLATE_VERSION,
  ])
}

// Where the first line of a page's text lies with no top margin, in the
// template's pt (measured from its PNGs at 11 pt body text): the centre of
// its ink, and the top of its ink. By what the answer starts with.
export type FirstLine = 'para' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote' | 'code' | 'table'
const FIRST_LINE: Record<FirstLine, { centre: number; inkTop: number }> = {
  para: { centre: 7.45, inkTop: 2.55 },
  h1: { centre: 20.36, inkTop: 5.82 },
  h2: { centre: 13.09, inkTop: 3.64 },
  h3: { centre: 9.09, inkTop: 2.55 },
  h4: { centre: 7.27, inkTop: 2.18 },
  quote: { centre: 13.45, inkTop: 8.36 },
  code: { centre: 17.09, inkTop: 12.36 },
  table: { centre: 11.27, inkTop: 6.18 },
}

export function firstLineOf(md: string): FirstLine {
  const line = md.split('\n').find(l => l.trim()) ?? ''
  const heading = /^ {0,3}(#{1,6})\s/.exec(line)
  if (heading) return (['h1', 'h2', 'h3'] as const)[heading[1]!.length - 1] ?? 'h4'
  if (/^ {0,3}>/.test(line)) return 'quote'
  if (FENCE.test(line)) return 'code'
  if (/^ {0,3}\|/.test(line)) return 'table'
  return 'para'
}

// The first page's top margin (pt, may be negative) that puts the centre of
// the first line of text on the centre of a terminal row, and which row that
// is: row 0 when the line fits there, else the first row its ink can reach
// without being cut at the picture's top. The bullet is drawn on that row.
export function alignFirstLine(kind: FirstLine, rowPt: number): { topPt: number; bulletRow: number } {
  const { centre, inkTop } = FIRST_LINE[kind]
  const bulletRow = Math.max(0, Math.ceil((centre - inkTop + 0.5) / rowPt - 0.5 - 1e-9))
  return { topPt: Math.round(((bulletRow + 0.5) * rowPt - centre) * 100) / 100, bulletRow }
}

// The rows an Image of this PNG takes when it is drawn `columns` wide. The
// template pads each page to whole rows, so this rounds (no stretch).
export function rowsFor(page: { width: number; height: number }, columns: number, px: Cell): number {
  const scale = Math.min(1, (columns * px.width) / page.width)
  return Math.max(1, Math.min(MAX_IMAGE_ROWS, Math.round((page.height * scale) / px.height)))
}

// The cell in device pixels from `rows cols xpixel ypixel` (TIOCGWINSZ).
// iTerm2 (3.5+), Ghostty, kitty and WezTerm report device pixels already, so
// there is no backing-scale step. Null where the tty reports no pixels or a
// cell that can't be right (under 4 or over 64 px wide).
export function cellOf(stdout: string): Cell | null {
  const [rows, columns, x, y] = stdout.trim().split(/\s+/).map(Number)
  if (!rows || !columns || !x || !y) return null
  const width = x / columns
  const height = y / rows
  return width >= 4 && width <= 64 && height >= 4 ? { width, height } : null
}

// "MesloLGS-NF-Regular 14" (iTerm2's Normal Font) → PostScript name and size.
export function parseFontSpec(spec: string): { name: string; size: number } | null {
  const m = /^\s*(\S.*?)\s+(\d+(?:\.\d+)?)\s*$/.exec(spec)
  return m ? { name: m[1]!, size: Number(m[2]) } : null
}

// The Normal Font of the iTerm2 profile in use: the bookmark named
// ITERM_PROFILE, else the default bookmark. `bookmarks` is the JSON of the
// plist's "New Bookmarks" array.
export function itermFontOf(bookmarks: string, profile: string | undefined, defaultGuid: string): string | null {
  let list: unknown
  try {
    list = JSON.parse(bookmarks)
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  type Mark = { Name?: unknown; Guid?: unknown; 'Normal Font'?: unknown }
  const marks = list.filter((x): x is Mark => !!x && typeof x === 'object')
  const mark = (profile ? marks.find(b => b.Name === profile) : undefined) ?? marks.find(b => b.Guid === defaultGuid.trim())
  const font = mark?.['Normal Font']
  return typeof font === 'string' && font.trim() ? font.trim() : null
}

// The first `font-family = X` of `ghostty +show-config`.
export function ghosttyFontOf(config: string): string | null {
  for (const line of config.split('\n')) {
    const m = /^\s*font-family\s*=\s*(.*?)\s*$/.exec(line)
    const family = m?.[1]?.replace(/^"(.*)"$/, '$1').trim()
    if (family) return family
  }
  return null
}

// The typst command and its environment. Network off (see NO_NETWORK) and a
// package cache of our own, so only the vendored packages load.
export function typstCall(o: {
  typst: string
  root: string
  cache: string
  ppi: number
  inputs: Readonly<Record<string, string | number>>
  out: string
}): { argv: string[]; env: Record<string, string> } {
  const argv = [
    o.typst, 'compile',
    '--root', '/',
    '--package-path', `${o.root}/render/packages`,
    '--format', 'png',
    '--diagnostic-format', 'short',
    '--ppi', o.ppi.toFixed(4),
    ...Object.entries(o.inputs).flatMap(([k, v]) => ['--input', `${k}=${v}`]),
    `${o.root}/render/md.typ`,
    o.out,
  ]
  return { argv, env: noNetworkEnv(o.cache) }
}

export function noNetworkEnv(cache: string): Record<string, string> {
  return {
    HTTPS_PROXY: NO_NETWORK,
    HTTP_PROXY: NO_NETWORK,
    ALL_PROXY: NO_NETWORK,
    https_proxy: NO_NETWORK,
    http_proxy: NO_NETWORK,
    all_proxy: NO_NETWORK,
    NO_PROXY: '',
    no_proxy: '',
    TYPST_PACKAGE_CACHE_PATH: `${cache}/pkg-cache`,
  }
}

// Width and height from a PNG's first 24 bytes (signature, then IHDR).
export function pngSize(bytes: readonly number[]): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((v, i) => bytes[i] !== v)) return null
  const at = (i: number) => ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0
  const width = at(16)
  const height = at(20)
  return width && height ? { width, height } : null
}

// `od -An -v -tx1` output for several files, each followed by a line `@`.
export function parseOd(stdout: string): number[][] {
  return stdout
    .split(/^@$/m)
    .slice(0, -1)
    .map(part => part.split(/\s+/).filter(Boolean).map(hex => Number.parseInt(hex, 16)))
}

// A set flag: anything but empty, 0, false, no or off.
export const isSet = (value: string | undefined) => !!value && !/^(0|false|no|off)$/i.test(value.trim())

// Whether the engine draws pictures here; elsewhere an Image shows only its
// alt, so the text is better. Claude Code turns kitty graphics on by itself
// only for kitty and Ghostty; any other terminal draws only when
// CLAUDE_CODE_FORCE_TERMINAL_IMAGES is set, and tmux or screen only then.
// Over ssh the terminal can't read our files, so only MD_PREVIEW_FORCE draws.
export function canDrawIn(env: { program: string; term: string; kitty: boolean; tmux: boolean; ssh: boolean; engineForced: boolean; modForced: boolean }): boolean {
  if (env.ssh) return env.modForced
  if (env.engineForced || env.modForced) return true
  if (env.tmux) return false
  return /ghostty/i.test(env.program + env.term) || /kitty/i.test(env.term) || env.kitty
}

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)/
export const isTypstInfo = (info: string) => /^(typst|typ)$/i.test(info)
// Any failed compile is tried once more with `safe=1`: the template then
// shows typst fences and math as code and images as alt boxes, which is how
// a bad typst block or an unknown LaTeX command still draws.
export function shouldRetrySafe(exitCode: number): boolean {
  return exitCode !== 0
}

// One block of Markdown: lines between blank lines outside fences, or one
// fenced block that starts at the margin.
export type Block = { lines: string[]; fence?: { mark: string; info: string }; isMath?: boolean }

export function blocksOf(md: string): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  let open: { char: string; len: number } | null = null
  let inMath = false
  const close = () => {
    if (cur && cur.lines.length) blocks.push(cur)
    cur = null
  }
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (open) {
      cur!.lines.push(line)
      const m = FENCE.exec(line)
      if (m && m[2]![0] === open.char && m[2]!.length >= open.len && line.trim() === m[2]) {
        open = null
        if (cur!.fence) close()
      }
      continue
    }
    if (inMath) {
      cur!.lines.push(line)
      if (line.trim() === '$$') inMath = false
      continue
    }
    const m = FENCE.exec(line)
    if (m) {
      open = { char: m[2]![0]!, len: m[2]!.length }
      // A fence at the margin is a block of its own; an indented one (in a
      // list item) stays with the item.
      if (m[1] === '') {
        close()
        cur = { lines: [line], fence: { mark: m[2]!, info: m[3] ?? '' } }
      } else (cur ??= { lines: [] }).lines.push(line)
      continue
    }
    if (line.trim() === '') {
      close()
      continue
    }
    ;(cur ??= { lines: [] }).lines.push(line)
    if (line.trim() === '$$') {
      inMath = true
      cur.isMath = true
    }
  }
  close()
  return blocks
}

// A rough count of the rows a block takes once drawn `columns` wide.
export function rowsOfBlock(block: Block, columns: number): number {
  const isCode = !!block.fence
  const perRow = columns * (isCode ? 1.0 : 1.15)
  let rows = 1
  for (const line of block.lines) {
    rows += Math.ceil(Math.max(1, line.length) / perRow) * (isCode ? 1.1 : 1.3)
    if (/^#{1,2}\s/.test(line)) rows += 1.5
  }
  if (block.fence && isTypstInfo(block.fence.info)) rows += 20
  return rows
}

const LINK_DEF = /^ {0,3}\[(?!\^)[^\]]+\]:\s*\S/
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]]+\]:/

// Splits an answer into segments of about `budget` rows at block boundaries.
// A fence is never split, but a long plain code fence is cut into several
// fences of the same language; a typst fence always stays whole. A block that
// starts indented (a list item's continuation) never starts a segment. Text
// with footnotes stays one segment; link definitions go into every segment.
export function splitSegments(md: string, columns: number, budget = SEGMENT_ROWS): string[] {
  const blocks = blocksOf(md)
  if (!blocks.length) return []
  const outside = blocks.filter(b => !b.fence).flatMap(b => b.lines)
  if (outside.some(line => FOOTNOTE_DEF.test(line))) return [md]
  const defs = outside.filter(line => LINK_DEF.test(line))

  const pieces: Block[] = []
  for (const block of blocks) {
    const { fence } = block
    if (fence && !isTypstInfo(fence.info) && rowsOfBlock(block, columns) > budget && block.lines.length > 2) {
      const body = block.lines.slice(1, -1)
      const per = Math.max(1, Math.floor(budget / Math.max(1.1, rowsOfBlock(block, columns) / block.lines.length)) - 2)
      for (let i = 0; i < body.length; i += per) {
        pieces.push({ lines: [block.lines[0]!, ...body.slice(i, i + per), fence.mark], fence })
      }
    } else pieces.push(block)
  }

  const segments: Block[][] = [[]]
  let used = 0
  for (const piece of pieces) {
    const need = rowsOfBlock(piece, columns)
    const canCut = !/^\s/.test(piece.lines[0] ?? '')
    if (used + need > budget && segments.at(-1)!.length && canCut) {
      segments.push([])
      used = 0
    }
    segments.at(-1)!.push(piece)
    used += need
  }
  const texts = segments.map(seg => seg.map(b => b.lines.join('\n')).join('\n\n'))
  if (texts.length < 2 || !defs.length) return texts
  return texts.map(t => `${t}\n\n${defs.filter(d => !t.includes(d)).join('\n')}`.trimEnd())
}

// The local image paths Markdown names outside code fences.
const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

export function localImages(md: string): string[] {
  const found: string[] = []
  let open: { char: string; len: number } | null = null
  for (const line of md.split('\n')) {
    const m = FENCE.exec(line)
    if (open) {
      if (m && m[2]![0] === open.char && m[2]!.length >= open.len && line.trim() === m[2]) open = null
    } else if (m) open = { char: m[2]![0]!, len: m[2]!.length }
    else for (const ref of line.matchAll(IMAGE)) if (!/^[a-z][a-z0-9+.-]*:/i.test(ref[2]!) || /^file:/i.test(ref[2]!)) found.push(ref[2]!)
  }
  return found
}

// Where an image path leads, as the template resolves it: `file://` dropped,
// `%20` a space, a relative path joined to `base`.
export function imagePathOf(path: string, base: string): string {
  const plain = path.trim().replace(/^file:\/\//i, '').replace(/%20/g, ' ')
  return plain.startsWith('/') ? plain : `${base.replace(/\/+$/, '')}/${plain.replace(/^\.\//, '')}`
}

// A short one-line plain text of some Markdown, for an Image's alt.
export function plainOf(md: string, max = ALT_CHARS): string {
  const flat = md
    .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat || ' '
}

export const firstLine = (text: string) => text.split('\n').find(l => l.trim())?.trim() ?? ''

// ---- Work on the host -----------------------------------------------------

const CELL_SH = `perl -e 'open(T, "</dev/tty") or exit 1; my $w = " " x 8; ioctl(T, ($^O eq "darwin" ? 0x40087468 : 0x5413), $w) or exit 1; print join(" ", unpack("S4", $w))'`
// Makes the cache folder, drops key folders not touched for 2 days, and
// prints the folder and the OS name.
const CACHE_SH = `d="\${TMPDIR:-/tmp}"; d="\${d%/}/md-preview-$(id -u)"; mkdir -p "$d" && chmod 700 "$d" && { find "$d" -mindepth 1 -maxdepth 1 -type d -mtime +2 ! -name pkg-cache -exec rm -rf {} + 2>/dev/null; printf '%s\\n%s\\n' "$d" "$(uname -s)"; }`
const ITERM_BOOKMARKS_SH = `defaults export com.googlecode.iterm2 - | plutil -extract "New Bookmarks" json -o - -`
const ITERM_DEFAULT_SH = `defaults read com.googlecode.iterm2 "Default Bookmark Guid"`
// A PostScript name (argv[0]) to its family name.
const FAMILY_JXA = 'function run(argv) { ObjC.import("AppKit"); var f = $.NSFont.fontWithNameSize(argv[0], 12); return f.isNil() ? "" : f.familyName.js }'
const GHOSTTY_SH = `"\${GHOSTTY_BIN_DIR:+\$GHOSTTY_BIN_DIR/}ghostty" +show-config`
const HEADERS_SH = `for f in "$@"; do head -c 24 "$f" | od -An -v -tx1; echo @; done`

// /md-preview; registered at session start and again in setUp, so it is
// there after a hot reload too.
async function registerCommand($: EngineInterface) {
  await $.command.register({
    name: 'md-preview',
    description: "Draw Claude's answers as rendered Markdown pictures: on, off, size <80-200> (text size in % of the terminal's), theme [name] (list or switch themes)",
    argumentHint: '[on|off|size <percent>|theme [name]]',
  }).catch(() => undefined)
}

// Redraws every reader of `done`; an invalidate where the write is refused.
function refresh($: EngineInterface) {
  void update($, done, n => n + 1).catch(() => $.ui.invalidate('ui.render'))
}

async function findTypst($: EngineInterface): Promise<string | null> {
  for (const flag of ['-lc', '-c']) {
    const got = await $.process.run(['sh', flag, 'command -v typst'], { timeoutMs: 5000 }).catch(() => null)
    const path = got?.exitCode === 0 ? firstLine(got.stdout) : ''
    if (path.startsWith('/')) return path
  }
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  for (const each of TYPST_FALLBACKS) {
    if (each.startsWith('~/') && !home) continue
    const path = each.startsWith('~/') ? `${home}${each.slice(1)}` : each
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return null
}

async function measureCell($: EngineInterface): Promise<Cell | null> {
  const tty = await $.process.run(['sh', '-c', CELL_SH], { timeoutMs: 5000 }).catch(() => null)
  return tty?.exitCode === 0 ? cellOf(tty.stdout) : null
}

// The terminal's font family: iTerm2's profile font, Ghostty's font-family;
// '' elsewhere or when it can't be read.
async function termFontOf($: EngineInterface, program: string, isMac: boolean): Promise<string> {
  if (/^iTerm/i.test(program) && isMac) {
    const profile = await $.env.get('ITERM_PROFILE')
    const [marks, guid] = await Promise.all([
      $.process.run(['sh', '-c', ITERM_BOOKMARKS_SH], { timeoutMs: 5000 }).catch(() => null),
      $.process.run(['sh', '-c', ITERM_DEFAULT_SH], { timeoutMs: 5000 }).catch(() => null),
    ])
    const spec = parseFontSpec(itermFontOf(marks?.stdout ?? '', profile, guid?.stdout ?? '') ?? '')
    if (!spec) return ''
    const named = await $.process.run(['osascript', '-l', 'JavaScript', '-e', FAMILY_JXA, spec.name], { timeoutMs: 5000 }).catch(() => null)
    return named?.exitCode === 0 ? firstLine(named.stdout) : ''
  }
  if (/ghostty/i.test(program)) {
    const shown = await $.process.run(['sh', '-c', GHOSTTY_SH], { timeoutMs: 5000 }).catch(() => null)
    return ghosttyFontOf(shown?.stdout ?? '') ?? ''
  }
  return ''
}

// The argv that measures the fonts: the active theme's body and code fonts
// (theme.typ reads theme.json, which needs `--root /`).
export const measureCall = (typst: string, root: string, family: string, themeDir: string) => [
  typst, 'eval', 'query(<m>).first().value', '--in', `${root}/render/measure.typ`, '--root', '/',
  '--input', `term-font=${family}`, '--input', `theme-dir=${themeDir}`,
]

// The fonts' metrics from render/measure.typ; the macOS defaults when that fails.
async function measureFonts($: EngineInterface, typst: string, root: string, cache: string, family: string, themeDir: string): Promise<Metrics> {
  const argv = measureCall(typst, root, family, themeDir)
  const got = await $.process.run(argv, { timeoutMs: 10000, env: noNetworkEnv(cache) }).catch(() => null)
  try {
    const m = JSON.parse(got?.stdout ?? '') as Metrics
    const ok = (x: FontMetrics | null | undefined) => !!x && x.adv > 0 && x.xh > 0 && x.avg > 0
    if (ok(m.menlo) && ok(m.body)) return { term: ok(m.term) ? m.term : null, menlo: m.menlo, body: m.body }
  } catch {}
  return DEFAULT_METRICS
}

// The built-in themes under render/themes and the user's under
// ~/.claude/md-preview/themes, read fresh each call.
async function scanThemes($: EngineInterface, root: string, home: string) {
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
async function missingSyntax($: EngineInterface, theme: ThemeInfo) {
  const lost: string[] = []
  for (const mode of MODES) {
    const file = theme.syntax[mode]
    if (file && !(await $.fs.exists(`${theme.dir}/${file}`).catch(() => false))) lost.push(file)
  }
  return lost
}

const userThemesOf = (home: string) => `${home || '~'}/.claude/md-preview/themes`

// The mtimes of the files a theme's pictures depend on (themeFiles): a
// change to any of them makes new keys.
async function stampTheme($: EngineInterface, files: readonly string[]): Promise<string> {
  const times: string[] = []
  for (const file of files) {
    const stat = await $.fs.stat(file).catch(() => null)
    times.push(String(stat?.mtimeMs ?? 0))
  }
  return times.join(',')
}

// Picks the stored theme (or the default one), sets `look`, and says when the
// stored one was not usable.
async function applyTheme($: EngineInterface, root: string, home: string, wanted: string) {
  const { themes, problems } = await scanThemes($, root, home)
  const chosen = chooseTheme(themes, wanted, root)
  // theme.typ always merges over the built-in vscode, also when a user theme
  // has that name, so the stamp uses the built-in one.
  const builtIn = themes.get(BASE_THEME)
  const files = themeFiles(themes.get(chosen.name), builtIn?.isUser ? undefined : builtIn, root)
  look = { name: chosen.name, dir: chosen.dir, stamp: await stampTheme($, files) }
  return { themes, problems, chosen }
}

// Once per load: the cache folder, Typst, the terminal and its font, the
// theme, the cell. A failed setup is tried again on the next call.
function setUp($: EngineInterface): Promise<Env> {
  envLoading ??= (async () => {
    await registerCommand($)
    const made = await $.process.run(['sh', '-c', CACHE_SH]).catch(() => null)
    const [made1 = '', os = ''] = (made?.stdout ?? '').split('\n')
    const cache = made1.trim() || '/tmp/md-preview'
    const program = (await $.env.get('TERM_PROGRAM')) ?? ''
    const term = (await $.env.get('TERM')) ?? ''
    const canDraw = canDrawIn({
      program,
      term,
      kitty: !!(await $.env.get('KITTY_WINDOW_ID')),
      tmux: !!(await $.env.get('TMUX')) || /^tmux|^screen/i.test(term),
      ssh: !!(await $.env.get('SSH_CONNECTION')) || !!(await $.env.get('SSH_TTY')),
      engineForced: isSet(await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')),
      modForced: isSet(await $.env.get('MD_PREVIEW_FORCE')),
    })
    const root = $.plugin.root
    const template = await $.fs.stat(`${root}/render/md.typ`).catch(() => null)
    const rows = await $.config.list().catch(() => [])
    theme = themeOf(rows.find(row => row.key === 'theme')?.value)
    const kept = Number(await $.store.get('size').catch(() => undefined))
    size = kept >= MIN_SIZE && kept <= MAX_SIZE ? kept : DEFAULT_SIZE
    if ((await $.store.get('enabled').catch(() => undefined)) === false) await update($, isOn, () => false).catch(() => undefined)
    const isMac = os.trim() === 'Darwin'
    cell = await measureCell($)
    const typst = await findTypst($)
    if (!typst) {
      try {
        $.ui.toast(NO_TYPST, { timeoutMs: 8000 })
      } catch {}
    }
    const termFont = await termFontOf($, program, isMac).catch(() => '')
    const home = (await $.env.get('HOME')) ?? ''
    const stored = await $.store.get('theme-name').catch(() => undefined)
    const wanted = typeof stored === 'string' && stored ? stored : DEFAULT_THEME
    const applied = await applyTheme($, root, home, wanted).catch(() => null)
    if (!applied) look = { name: BASE_THEME, dir: `${root}/render/themes/${BASE_THEME}`, stamp: '0' }
    else if (applied.chosen.isFallback) {
      try {
        $.ui.toast(`md-preview: theme ${wanted} not found, using ${applied.chosen.name}`, { timeoutMs: 8000 })
      } catch {}
    }
    env = {
      typst,
      canDraw,
      cache,
      cwd: await $.session.cwd().catch(() => '/'),
      root,
      isMac,
      stamp: String(template?.mtimeMs ?? 0),
      home,
      termFont,
      metrics: typst ? await measureFonts($, typst, root, cache, termFont, look?.dir ?? `${root}/render/themes/${BASE_THEME}`) : DEFAULT_METRICS,
    }
    refresh($)
    return env
  })().catch((err: unknown) => {
    envLoading = null
    throw err
  })
  return envLoading
}

// A changed viewport may mean a changed font size: measure the cell again,
// at most once a second, and redraw only when it really changed.
function noteViewport($: EngineInterface, view: { columns: number; rows: number }) {
  const seen = `${view.columns}x${view.rows}`
  if (seen === lastView) return
  const isFirst = lastView === ''
  lastView = seen
  if (isFirst || !env) return
  measureTimer?.cancel()
  measureTimer = $.clock.after(1000, () => {
    void measureCell($).then(next => {
      if (next?.width === cell?.width && next?.height === cell?.height) return
      cell = next
      refresh($)
    })
  })
}

async function logDebug($: EngineInterface, cache: string, text: string) {
  const stamp = new Date().toISOString()
  await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', `${cache}/debug.log`], { stdin: `[${stamp}] ${text.trimEnd()}\n` }).catch(() => undefined)
}

// The images that exist, for the template's allow-list: it draws any other
// as its alt, so one bad path doesn't fail the page.
async function existingImages($: EngineInterface, segments: readonly string[], base: string): Promise<string[]> {
  const found: string[] = []
  for (const path of new Set(segments.flatMap(localImages))) {
    const full = imagePathOf(path, base)
    if (await $.fs.exists(full).catch(() => false)) found.push(path, full)
  }
  return found
}

async function runTypst($: EngineInterface, job: Job, segments: readonly string[], dir: string, tag: string, isSafe: boolean) {
  const fit = fontFit(job.env.metrics, job.size)
  const { widthPt, ppi, rowPt } = sizing(job.columns, job.cell, fit.columnPt)
  const { topPt } = alignFirstLine(firstLineOf(segments[0] ?? ''), rowPt)
  const { argv, env: vars } = typstCall({
    typst: job.env.typst!,
    root: job.env.root,
    cache: job.env.cache,
    ppi,
    inputs: {
      theme: job.theme,
      width: widthPt,
      top: topPt,
      row: Math.round(rowPt * 10000) / 10000,
      code: fit.code,
      ...(job.env.termFont ? { 'term-font': job.env.termFont } : {}),
      'theme-dir': job.themeDir,
      doc: `${dir}/doc.json`,
      ...(isSafe ? { safe: 1 } : {}),
    },
    out: `${dir}/${tag}-{0p}.png`,
  })
  return $.process
    .run(argv, { timeoutMs: COMPILE_TIMEOUT_MS, env: vars })
    .catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: `typst did not run: ${String(err)}` }))
}

async function compile($: EngineInterface, job: Job): Promise<Result | 'failed'> {
  const dir = `${job.env.cache}/${job.key}`
  const kept = await $.fs.read(`${dir}/pages.json`).catch(() => null)
  if (kept) return JSON.parse(kept) as Result

  const segments = splitSegments(job.text, job.columns)
  const images = await existingImages($, segments, job.env.cwd)
  await $.fs.write(`${dir}/doc.json`, JSON.stringify({ base: job.env.cwd, segments, images }))

  let tag = 'a'
  let ran = await runTypst($, job, segments, dir, tag, false)
  let note: string | undefined
  if (ran.exitCode !== 0) {
    await logDebug($, job.env.cache, `compile ${job.key} failed:\n${ran.stderr}`)
    if (!shouldRetrySafe(ran.exitCode)) return 'failed'
    note = firstLine(ran.stderr.split('\n').find(l => /error:/i.test(l)) ?? ran.stderr).replace(/^.*error:\s*/i, '')
    tag = 'b'
    ran = await runTypst($, job, segments, dir, tag, true)
    if (ran.exitCode !== 0) {
      await logDebug($, job.env.cache, `compile ${job.key} with safe=1 failed:\n${ran.stderr}`)
      return 'failed'
    }
  }

  const files = (await $.fs.list(dir))
    .filter(f => f.kind === 'file' && f.name.startsWith(`${tag}-`) && f.name.endsWith('.png'))
    .map(f => f.name)
    .sort((x, y) => Number(x.replace(/\D/g, '')) - Number(y.replace(/\D/g, '')))
    .map(name => `${dir}/${name}`)
  if (!files.length) return 'failed'
  const heads = await $.process.run(['sh', '-c', HEADERS_SH, 'sh', ...files])
  const sizes = parseOd(heads.stdout).map(pngSize)
  if (sizes.length !== files.length || sizes.some(s => !s)) {
    await logDebug($, job.env.cache, `compile ${job.key}: could not read PNG sizes`)
    return 'failed'
  }
  const pages = files.map((file, i) => ({ file, ...sizes[i]!, alt: plainOf(segments[i] ?? job.text) }))
  const { rowPt } = sizing(job.columns, job.cell, fontFit(job.env.metrics, job.size).columnPt)
  const { bulletRow } = alignFirstLine(firstLineOf(segments[0] ?? ''), rowPt)
  const result: Result = { pages, columns: job.columns, bulletRow, ...(note ? { note } : {}) }
  await $.fs.write(`${dir}/pages.json`, JSON.stringify(result))
  return result
}

function pump($: EngineInterface) {
  while (running.size < MAX_RUNNING && queue.length) {
    const job = queue.shift()!
    running.add(job.key)
    void compile($, job)
      .catch(async (err: unknown) => {
        await logDebug($, job.env.cache, `compile ${job.key} threw: ${String(err)}`)
        return 'failed' as const
      })
      .then(result => {
        results.set(job.key, result)
        running.delete(job.key)
        refresh($)
        pump($)
      })
  }
}

function enqueue($: EngineInterface, job: Job) {
  if (results.has(job.key) || running.has(job.key)) return
  // A newer text of the same message replaces its job still waiting.
  const stale = queue.findIndex(j => j.requestId === job.requestId || j.key === job.key)
  if (stale >= 0) queue.splice(stale, 1)
  queue.push(job)
  pump($)
}

// Compiles once the message's text has been still for SETTLE_MS.
function schedule($: EngineInterface, job: Job) {
  const was = timers.get(job.requestId)
  if (was?.key === job.key) return
  was?.cancel()
  const timer = $.clock.after(SETTLE_MS, () => {
    timers.delete(job.requestId)
    enqueue($, job)
  })
  timers.set(job.requestId, { key: job.key, cancel: () => timer.cancel() })
}

type Drawn = RenderInput<'AssistantMessage', 'terminal'>

function drawPages($: EngineInterface, e: Drawn, result: Result, columns: number, px: Cell) {
  const { Box, Text, Image } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" marginTop={MARGIN_TOP}>
      <Box width={GUTTER} flexShrink={0} marginTop={result.bulletRow}>
        <Text>{e.props.isFirstOfReply ? bulletOf(env?.isMac ?? true) : ' '}</Text>
      </Box>
      <Box flexDirection="column">
        {result.pages.map((page, i) => {
          const rows = rowsFor(page, columns, px)
          return (
            <Image
              key={`p${i}`}
              source={{ file: page.file, format: 'png', generation: columns * 1000 + rows }}
              columns={columns}
              rows={rows}
              alt={page.alt}
            />
          )
        })}
        {result.note ? <Text dimColor wrap="truncate-end">Typst error: {result.note}</Text> : null}
      </Box>
    </Box>
  )
}

// ---- Hooks ----------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await registerCommand($)
    void setUp($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'md-preview' }, async ($, e) => {
    const asked = parseCommand(e.args)
    if (asked.kind === 'on' || asked.kind === 'off') {
      await update($, isOn, () => asked.kind === 'on')
      await $.store.set('enabled', asked.kind === 'on')
      return { text: `md-preview is ${asked.kind}.` }
    }
    if (asked.kind === 'size') {
      size = asked.percent
      await $.store.set('size', size)
      refresh($)
      return { text: `md-preview draws text at ${size}% of the terminal's text size (100% matches it).` }
    }
    if (asked.kind === 'theme') {
      const ready = await setUp($)
      const was = look
      const wanted = asked.name ?? look?.name ?? DEFAULT_THEME
      const { themes, problems, chosen } = await applyTheme($, ready.root, ready.home, wanted)
      if (asked.name && chosen.isFallback) {
        if (was) look = was
        const names = [...themes.keys()].sort().join(', ') || 'none'
        return { text: `No usable theme named ${asked.name}. Themes: ${names}.\n${themeListing(themes, problems, was?.name ?? DEFAULT_THEME, userThemesOf(ready.home))}` }
      }
      if (asked.name) await $.store.set('theme-name', chosen.name)
      if (look?.name !== was?.name || look?.dir !== was?.dir || look?.stamp !== was?.stamp) {
        // The theme's fonts set the column width and the code size.
        if (ready.typst && look) ready.metrics = await measureFonts($, ready.typst, ready.root, ready.cache, ready.termFont, look.dir)
        refresh($)
      }
      const head = asked.name ? `md-preview uses the theme ${chosen.name}.\n` : ''
      return { text: `${head}${themeListing(themes, problems, chosen.name, userThemesOf(ready.home))}` }
    }
    const state = (await read($, isOn)) ? 'on' : 'off'
    const ready = await setUp($)
    const font = ready.termFont ? `terminal font ${ready.termFont}` : 'terminal font not known (Menlo assumed)'
    const typst = ready.typst ? `Typst: ${ready.typst}` : 'Typst: not found (brew install typst)'
    const terminal = ready.canDraw ? 'this terminal draws pictures' : 'Claude Code draws no pictures here (it does in kitty and Ghostty, elsewhere with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1, never in tmux or over ssh), so answers stay text'
    const usage = `Use /md-preview on, /md-preview off, /md-preview size <${MIN_SIZE}-${MAX_SIZE}>, or /md-preview theme [name].`
    const bad = asked.kind === 'bad' ? `Not understood: "${e.args.trim()}". ` : ''
    return { text: `${bad}md-preview is ${state}, theme ${look?.name ?? DEFAULT_THEME}, text size ${size}%, ${font}. ${typst}; ${terminal}. ${usage}` }
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const set = await next(e)
    if (set.value !== undefined && themeOf(set.value) !== theme) {
      theme = themeOf(set.value)
      refresh($)
    }
    return set
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.surfaces.includes('terminal') || !(await read($, isOn))) return composed
    const ready = env ?? (await setUp($).catch(() => null))
    if (!ready?.typst || !ready.canDraw) return composed
    return { sections: [...composed.sections, { id: 'md-preview:typst', text: TYPST_PROMPT, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary || !e.props.text.trim()) return next(e)
    if (!(await read($, isOn))) return next(e)
    // Read so a finished render draws this message again.
    await read($, done)
    if (!env) {
      void setUp($).catch(() => undefined)
      return next(e)
    }
    if (!env.typst || !env.canDraw) return next(e)
    if (e.viewport) noteViewport($, e.viewport)

    const columns = columnsFor(e.viewport?.columns)
    const px = cell ?? DEFAULT_CELL
    const textHash = hashOf([e.props.text])
    const active = look ?? { name: DEFAULT_THEME, dir: `${env.root}/render/themes/${DEFAULT_THEME}`, stamp: '0' }
    const key = renderKey({
      textHash, columns, cell: px, size, mode: theme, termFont: env.termFont,
      columnPt: fontFit(env.metrics, size).columnPt, templateStamp: env.stamp, look: active,
    })
    const got = results.get(key)
    if (got === 'failed') return next(e)
    if (got) {
      shown.set(e.requestId, { textHash, result: got })
      return drawPages($, e, got, columns, px)
    }
    schedule($, { key, requestId: e.requestId, text: e.props.text, columns, cell: px, theme, size, themeDir: active.dir, env })
    // Same text at another width: the old picture until the new one is ready.
    const was = shown.get(e.requestId)
    return was && was.textHash === textHash ? drawPages($, e, was.result, columns, px) : next(e)
  })
}
