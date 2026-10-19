// Typst on the host: finding it, measuring the fonts, and compiling an
// answer's segments to PNG pages (with a retry in safe mode).
import type { EngineInterface } from 'claude-code'

import { COMPILE_TIMEOUT_MS, MAX_IMAGE_ROWS, NO_NETWORK, SEGMENT_ROWS, TOUCH_FLUSH_MS, TYPST_FALLBACKS } from './settings'
import { DEFAULT_METRICS, type Cell, type FontMetrics, type Job, type LeanFonts, type Metrics, type Page, type Result } from './state'
import { firstLine, imagePathOf, localImages, plainOf, splitInTwo, splitSegments } from './markdown'
import { inlineBudget } from './terminal'
import { fontFit, placeFirstLine, sizing } from './draw'
import { DEFAULT_GRID, gridOf } from './grid'
import { HEADERS_SH } from './host'
import { logDebug } from './log'
import { positionsOf, type Mark, type Positions } from './copy'
import { leanFontsFor } from './fonts'
import { clockAfter, envGet, fsExists, fsList, fsRead, fsWrite, processRun, processSpawn } from './api'

// The typst command and its environment. Network off (see NO_NETWORK) and a
// package cache of our own, so only the vendored packages load. `fonts`:
// the lean font folder (fonts.ts) in place of all system fonts.
export function typstCall(o: {
  typst: string
  root: string
  cache: string
  ppi: number
  inputs: Readonly<Record<string, string | number>>
  out: string
  fonts?: string
}): { argv: string[]; env: Record<string, string> } {
  const argv = [
    o.typst, 'compile',
    '--root', '/',
    '--package-path', `${o.root}/render/packages`,
    ...fontArgs(o.fonts),
    '--format', 'png',
    '--diagnostic-format', 'short',
    '--ppi', o.ppi.toFixed(4),
    ...Object.entries(o.inputs).flatMap(([k, v]) => ['--input', `${k}=${v}`]),
    `${o.root}/render/md.typ`,
    o.out,
  ]
  return { argv, env: noNetworkEnv(o.cache) }
}

// The arguments that load only the fonts of a lean folder (and Typst's own).
export const fontArgs = (fonts?: string) => (fonts ? ['--ignore-system-fonts', '--font-path', fonts] : [])

// The typst command that makes a PNG of a JPEG, WebP or SVG (render/convert.typ)
// that fits `box` (in pixels), never larger than its own pixel size: at 72
// ppi, 1 pt is 1 pixel. For a PDF, `page` is the page (it fits the box,
// larger too), and the errors are in the human format: only it has the
// hint with the page count of a page that does not exist.
export function convertCall(o: {
  typst: string
  root: string
  cache: string
  file: string
  box: { width: number; height: number }
  out: string
  page?: number
}): { argv: string[]; env: Record<string, string> } {
  const argv = [
    o.typst, 'compile',
    '--root', '/',
    '--format', 'png',
    '--diagnostic-format', o.page ? 'human' : 'short',
    '--ppi', '72',
    '--input', `f=${o.file}`,
    '--input', `maxw=${o.box.width}`,
    '--input', `maxh=${o.box.height}`,
    ...(o.page ? ['--input', `page=${o.page}`] : []),
    `${o.root}/render/convert.typ`,
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

// Any failed compile is tried once more with `safe=1`: the template then
// shows typst fences and math as code and images as alt boxes, which is how
// a bad typst block or an unknown LaTeX command still draws.
export function shouldRetrySafe(exitCode: number): boolean {
  return exitCode !== 0
}

export async function findTypst($: EngineInterface): Promise<string | null> {
  for (const flag of ['-lc', '-c']) {
    const got = await processRun($, ['sh', flag, 'command -v typst'], { timeoutMs: 5000 }).catch(() => null)
    const path = got?.exitCode === 0 ? firstLine(got.stdout) : ''
    if (path.startsWith('/')) return path
  }
  const home = (await envGet($, 'HOME').catch(() => undefined)) ?? ''
  for (const each of TYPST_FALLBACKS) {
    if (each.startsWith('~/') && !home) continue
    const path = each.startsWith('~/') ? `${home}${each.slice(1)}` : each
    if (await fsExists($, path).catch(() => false)) return path
  }
  return null
}

// The argv that measures the fonts: the active theme's body and code fonts
// (theme.typ reads theme.json, which needs `--root /`).
export const measureCall = (typst: string, root: string, family: string, themeDir: string) => [
  typst, 'eval', 'query(<m>).first().value', '--in', `${root}/render/measure.typ`, '--root', '/',
  '--input', `term-font=${family}`, '--input', `theme-dir=${themeDir}`,
]

// The theme's font lists of a measure, when they are lists of names.
export function leanFontsOf(v: unknown): LeanFonts | undefined {
  const f = v as Partial<LeanFonts> | null | undefined
  const names = (x: unknown): x is string[] => Array.isArray(x) && x.every(n => typeof n === 'string')
  return f && names(f.body) && names(f.code) && typeof f.plain === 'boolean' ? { body: f.body, code: f.code, plain: f.plain } : undefined
}

// The fonts' metrics from render/measure.typ; the macOS defaults when that fails.
export async function measureFonts($: EngineInterface, typst: string, root: string, cache: string, family: string, themeDir: string): Promise<Metrics> {
  const argv = measureCall(typst, root, family, themeDir)
  const got = await processRun($, argv, { timeoutMs: 10000, env: noNetworkEnv(cache) }).catch(() => null)
  try {
    const m = JSON.parse(got?.stdout ?? '') as Metrics
    const ok = (x: FontMetrics | null | undefined) => !!x && x.adv > 0 && x.xh > 0 && x.avg > 0
    const fonts = leanFontsOf(m.fonts)
    if (ok(m.menlo) && ok(m.body)) return { term: ok(m.term) ? m.term : null, menlo: m.menlo, body: m.body, grid: gridOf(m.grid) ?? DEFAULT_GRID, ...(fonts ? { fonts } : {}) }
  } catch {}
  return DEFAULT_METRICS
}

export { logDebug } from './log'

// The images that exist, for the template's allow-list: it draws any other
// as its alt, so one bad path doesn't fail the page.
export async function existingImages($: EngineInterface, segments: readonly string[], base: string): Promise<string[]> {
  const found: string[] = []
  for (const path of new Set(segments.flatMap(localImages))) {
    const full = imagePathOf(path, base)
    if (await fsExists($, full).catch(() => false)) found.push(path, full)
  }
  return found
}

// The template's inputs for the room of a drawing (pt): the room height, and
// the design's page width and room height.
export function roomInputs(room: Job['room']): Record<string, number> {
  if (!room) return {}
  const pt = (v: number) => Math.round(v * 100) / 100
  return { height: pt(room.heightPt), 'design-w': pt(room.design.widthPt), 'design-h': pt(room.design.heightPt) }
}

// The rows a page of `height` pixels takes in cells of `cell` (the template
// pads each page to whole rows, so this rounds).
export const pageRowsOf = (height: number, cell: Cell) => Math.max(1, Math.round(height / cell.height))

// A kept pages.json as a Result; null when it is not one (an older format).
export function resultOf(text: string): Result | null {
  try {
    const r = JSON.parse(text) as Result
    const isPage = (p: Page) => !!p && typeof p.file === 'string' && p.columns > 0 && p.rows > 0
    return Array.isArray(r.pages) && r.pages.length > 0 && r.pages.every(isPage) ? r : null
  } catch {
    return null
  }
}

// Paths in use (key folders, design files): their mtime is set to now, so
// the cleanups go by use. touchLater only notes the path (no process in a
// render path); one `touch -c` runs per TOUCH_FLUSH_MS for at most
// TOUCH_BATCH paths, the rest wait for the next run.
export const TOUCH_BATCH = 200
const TOUCH_KEPT = 4096
// The paths not touched yet (empty after each flush; answer.ts keeps the
// keys touched in this load, so a redraw does not note them again).
const toTouch = new Set<string>()
let touchTimer: { cancel: () => void } | null = null

export function touchLater($: EngineInterface, path: string) {
  if (toTouch.size >= TOUCH_KEPT && !toTouch.has(path)) return
  toTouch.add(path)
  if (touchTimer) return
  touchTimer = clockAfter($, TOUCH_FLUSH_MS, () => {
    touchTimer = null
    const paths = [...toTouch].slice(0, TOUCH_BATCH)
    for (const each of paths) toTouch.delete(each)
    if (paths.length) void Promise.resolve(processRun($, ['touch', '-c', ...paths], { timeoutMs: 5000 })).catch(() => undefined)
    if (toTouch.size) touchLater($, toTouch.values().next().value!)
  })
}

// Clears the paths not touched yet and the timer (for tests).
export function forgetTouches() {
  touchTimer?.cancel()
  touchTimer = null
  toTouch.clear()
}

// A command with a PID line first: `sh` writes its own PID, then becomes
// the command (exec keeps the PID), so `kill <pid>` stops the command.
export const wrapPid = (argv: readonly string[]): string[] => ['sh', '-c', 'echo $$; exec "$@"', 'sh', ...argv]

// How a run ended: `isCancelled` when `signal` stopped it (its output does
// not count).
export type Ran = { exitCode: number; stdout: string; stderr: string; isCancelled?: boolean }

// Runs `argv` through wrapPid with $.process.spawn: its stdout (less the PID
// line) and stderr, and its exit code (1 when a signal ended it). `signal`
// and the timeout (`timeoutMs`, on $.clock) kill it by its PID; a timeout
// ends with exit 1 and stderr `timed out`.
export async function runKillable(
  $: EngineInterface,
  argv: readonly string[],
  o: { env?: Record<string, string>; signal?: AbortSignal; timeoutMs: number },
): Promise<Ran> {
  if (o.signal?.aborted) return { exitCode: 1, stdout: '', stderr: 'cancelled', isCancelled: true }
  let pid = ''
  let head = ''
  let stdout = ''
  let stderr = ''
  let why: 'cancel' | 'timeout' | null = null
  let isKillSent = false
  const killNow = () => {
    if (!why || !pid || isKillSent) return
    isKillSent = true
    void Promise.resolve(processRun($, ['kill', pid], { timeoutMs: 5000 })).catch(() => undefined)
  }
  const stop = (reason: 'cancel' | 'timeout') => {
    if (why) return
    why = reason
    killNow()
  }
  const onAbort = () => stop('cancel')
  o.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = clockAfter($, o.timeoutMs, () => stop('timeout'))
  let code: number | null = 1
  try {
    const child = processSpawn($, { argv: wrapPid(argv), ...(o.env ? { env: o.env } : {}) })
    for (;;) {
      const got = await child.next()
      if (got.done) {
        code = got.value?.code ?? 1
        break
      }
      const { stream, text } = got.value
      if (stream === 'stderr') stderr += text
      else if (pid) stdout += text
      else {
        head += text
        const at = head.indexOf('\n')
        if (at >= 0) {
          pid = head.slice(0, at).trim()
          stdout += head.slice(at + 1)
          head = ''
          if (!/^\d+$/.test(pid)) pid = ''
          killNow()
        }
      }
    }
  } catch (err: unknown) {
    stderr += `${stderr ? '\n' : ''}typst did not run: ${String(err)}`
    code = 1
  } finally {
    timer.cancel()
    o.signal?.removeEventListener('abort', onAbort)
  }
  // A cancel that came after typst ended (before its end was read) drops a
  // whole result too: the key compiles again (rare, and accepted).
  if (why === 'cancel') return { exitCode: 1, stdout, stderr, isCancelled: true }
  if (why === 'timeout') return { exitCode: 1, stdout, stderr: 'timed out' }
  return { exitCode: code, stdout, stderr }
}

// The first page's top margin and bullet row of a job's text.
function firstLinePlace(job: Job, segments: readonly string[]) {
  const fit = fontFit(job.env.metrics, job.size)
  const { rowPt } = sizing(job.columns, job.cell, fit.columnPt)
  const grid = job.grid ? { metrics: job.env.metrics.grid ?? DEFAULT_GRID, code: fit.code } : undefined
  return placeFirstLine(segments[0] ?? '', rowPt, grid)
}

// The template's inputs for a job and its ppi (the PNG compile and the
// probe share them). With the row grid, `grid` is 1 and `top` 0.
export function typstInputs(job: Job, segments: readonly string[], dir: string, isSafe: boolean) {
  const fit = fontFit(job.env.metrics, job.size)
  const { widthPt, ppi, rowPt } = sizing(job.columns, job.cell, fit.columnPt)
  const { topPt } = firstLinePlace(job, segments)
  const inputs: Record<string, string | number> = {
    theme: job.theme,
    width: widthPt,
    top: topPt,
    row: Math.round(rowPt * 10000) / 10000,
    ...(job.grid ? { grid: 1 } : {}),
    code: fit.code,
    ...(job.env.termFont ? { 'term-font': job.env.termFont } : {}),
    'theme-dir': job.themeDir,
    doc: `${dir}/doc.json`,
    ...roomInputs(job.room),
    ...(isSafe ? { safe: 1 } : {}),
  }
  return { inputs, ppi }
}

// The lean font folder for a job's segments ('' none: all fonts), noted as in use.
async function leanFor($: EngineInterface, job: Job, segments: readonly string[]): Promise<string> {
  const fonts = await leanFontsFor($, job.env, segments, noNetworkEnv(job.env.cache)).catch(() => '')
  if (fonts) touchLater($, fonts)
  return fonts
}

// Runs a typst command with the lean fonts, else with all fonts. A lean
// run that fails (not one that was cancelled or timed out) runs once more
// with all fonts, so the lean set never makes a failure of its own.
async function runFonts($: EngineInterface, job: Job, fonts: string, run: (fonts?: string) => Promise<Ran>): Promise<Ran> {
  if (!fonts) return run()
  const ran = await run(fonts)
  if (ran.exitCode === 0 || ran.isCancelled || ran.stderr === 'timed out') return ran
  await logDebug($, job.env.cache, `typst for ${job.key} with the lean fonts failed (now with all fonts):\n${ran.stderr}`)
  return run()
}

export async function runTypst($: EngineInterface, job: Job, segments: readonly string[], dir: string, tag: string, isSafe: boolean, signal?: AbortSignal): Promise<Ran> {
  const { inputs, ppi } = typstInputs(job, segments, dir, isSafe)
  return runFonts($, job, await leanFor($, job, segments), fonts => {
    const { argv, env: vars } = typstCall({ typst: job.env.typst!, root: job.env.root, cache: job.env.cache, ppi, inputs, out: `${dir}/${tag}-{0p}.png`, ...(fonts ? { fonts } : {}) })
    return runKillable($, argv, { env: vars, timeoutMs: COMPILE_TIMEOUT_MS, ...(signal ? { signal } : {}) })
  })
}

// ---- The probe: where the words are ---------------------------------------

// `typst query` of the template's <mdpos> marks with probe=1: the PNG
// compile's own inputs (and `page`), root, package path, fonts and env (no
// ppi, format or out).
export function probeCall(o: { typst: string; root: string; cache: string; inputs: Readonly<Record<string, string | number>>; fonts?: string }): { argv: string[]; env: Record<string, string> } {
  const argv = [
    o.typst, 'query',
    '--root', '/',
    '--package-path', `${o.root}/render/packages`,
    ...fontArgs(o.fonts),
    '--diagnostic-format', 'short',
    ...Object.entries({ ...o.inputs, probe: 1 }).flatMap(([k, v]) => ['--input', `${k}=${v}`]),
    `${o.root}/render/md.typ`,
    '<mdpos>',
    '--field', 'value',
  ]
  return { argv, env: noNetworkEnv(o.cache) }
}

// A drawn page's file says how it was compiled: `b` and `d` (the split
// retry) are the safe mode's tags.
export const isSafePage = (file: string) => /\/[bd]-\d+\.png$/.test(file)

// The word positions of page `page` (0-based) of a key folder: the probe
// of that page only (page=<n>), with the inputs of the PNG compile, built
// from the Job that drew it and the segments in its doc.json. Null when it
// fails, or when doc.json does not hold one segment per page drawn (a split
// retry that failed keeps the pages of the first compile).
export async function probePage(
  $: EngineInterface, job: Job, dir: string, o: { page: number; pages: number; isSafe: boolean },
): Promise<Positions | null> {
  let segments: unknown
  try {
    segments = (JSON.parse((await fsRead($, `${dir}/doc.json`)) as string) as { segments?: unknown }).segments
  } catch {
    return null
  }
  if (!Array.isArray(segments) || segments.length !== o.pages || !job.env.typst) return null
  const typst = job.env.typst
  const { inputs, ppi } = typstInputs(job, segments as string[], dir, o.isSafe)
  const ran = await runFonts($, job, await leanFor($, job, segments as string[]), fonts => {
    const { argv, env } = probeCall({ typst, root: job.env.root, cache: job.env.cache, inputs: { ...inputs, page: o.page + 1 }, ...(fonts ? { fonts } : {}) })
    return runKillable($, argv, { env, timeoutMs: COMPILE_TIMEOUT_MS })
  })
  if (ran.exitCode !== 0) {
    await logDebug($, job.env.cache, `probe ${dir} page ${o.page + 1} failed:\n${ran.stderr}`)
    return null
  }
  try {
    return positionsOf(JSON.parse(ran.stdout) as Mark[], ppi)
  } catch {
    return null
  }
}

// The pages of one run: its PNGs (by tag) in order, with their sizes and
// the box each takes. Null when there are none or a size can not be read.
async function pagesOfRun($: EngineInterface, job: Job, dir: string, tag: string, segments: readonly string[]): Promise<Page[] | null> {
  const files = (await fsList($, dir))
    .filter(f => f.kind === 'file' && f.name.startsWith(`${tag}-`) && f.name.endsWith('.png'))
    .map(f => f.name)
    .sort((x, y) => Number(x.replace(/\D/g, '')) - Number(y.replace(/\D/g, '')))
    .map(name => `${dir}/${name}`)
  if (!files.length) return null
  const heads = await processRun($, ['sh', '-c', HEADERS_SH, 'sh', ...files])
  const sizes = parseOd(heads.stdout).map(pngSize)
  if (sizes.length !== files.length || sizes.some(s => !s)) {
    await logDebug($, job.env.cache, `compile ${job.key}: could not read PNG sizes`)
    return null
  }
  return files.map((file, i) => ({
    file, ...sizes[i]!, alt: plainOf(segments[i] ?? job.text), columns: job.columns, rows: pageRowsOf(sizes[i]!.height, job.cell),
  }))
}

// Compiles a job's text to its pages (kept in its key folder). `signal`
// stops it: a run killed by it, or a retry not begun, is 'cancelled' (not a
// result: nothing is kept).
export async function compile($: EngineInterface, job: Job, signal?: AbortSignal): Promise<Result | 'failed' | 'cancelled'> {
  const dir = `${job.env.cache}/${job.key}`
  const kept = await fsRead($, `${dir}/pages.json`).catch(() => null)
  const keptResult = kept ? resultOf(kept) : null
  if (keptResult) {
    touchLater($, dir)
    return keptResult
  }
  if (signal?.aborted) return 'cancelled'

  const { rowPt } = sizing(job.columns, job.cell, fontFit(job.env.metrics, job.size).columnPt)
  // The room height of a drawing in rows (less the pt rounding); unknown
  // without a room (the default applies).
  const roomRows = job.room ? Math.ceil(job.room.heightPt / rowPt - 0.01) : undefined
  let segments = splitSegments(job.text, job.columns, job.env.inline ? inlineBudget(job.cell) : SEGMENT_ROWS, job.size, roomRows)
  const base = job.base ?? job.env.cwd
  const images = await existingImages($, segments, base)
  await fsWrite($, `${dir}/doc.json`, JSON.stringify({ base, segments, images }))

  let tag = 'a'
  let isSafe = false
  let ran = await runTypst($, job, segments, dir, tag, false, signal)
  let note: string | undefined
  if (ran.isCancelled) return 'cancelled'
  if (ran.exitCode !== 0) {
    if (signal?.aborted) return 'cancelled'
    await logDebug($, job.env.cache, `compile ${job.key} failed:\n${ran.stderr}`)
    if (!shouldRetrySafe(ran.exitCode)) return 'failed'
    note = firstLine(ran.stderr.split('\n').find(l => /error:/i.test(l)) ?? ran.stderr).replace(/^.*error:\s*/i, '')
    tag = 'b'
    isSafe = true
    ran = await runTypst($, job, segments, dir, tag, true, signal)
    if (ran.isCancelled) return 'cancelled'
    if (ran.exitCode !== 0) {
      await logDebug($, job.env.cache, `compile ${job.key} with safe=1 failed:\n${ran.stderr}`)
      return 'failed'
    }
  }

  let pages = await pagesOfRun($, job, dir, tag, segments)
  if (!pages) return 'failed'
  // A page taller than an Image can be (the row estimate was short): its
  // segment is cut in two and the whole text compiled once more. If that
  // fails, the first pages stay (drawn at most MAX_IMAGE_ROWS tall).
  if (pages.some(p => p.rows > MAX_IMAGE_ROWS)) {
    const cut = segments.flatMap((seg, i) => (pages![i]!.rows > MAX_IMAGE_ROWS ? splitInTwo(seg, job.columns, job.size, roomRows) : [seg]))
    if (cut.length > segments.length) {
      if (signal?.aborted) return 'cancelled'
      await fsWrite($, `${dir}/doc.json`, JSON.stringify({ base, segments: cut, images }))
      const again = await runTypst($, job, cut, dir, isSafe ? 'd' : 'c', isSafe, signal)
      if (again.isCancelled) return 'cancelled'
      const split = again.exitCode === 0 ? await pagesOfRun($, job, dir, isSafe ? 'd' : 'c', cut) : null
      if (split) {
        pages = split
        segments = cut
      } else await logDebug($, job.env.cache, `compile ${job.key}: the split retry failed:\n${again.stderr}`)
    }
    pages = pages.map(p => ({ ...p, rows: Math.min(MAX_IMAGE_ROWS, p.rows) }))
  }
  const { bulletRow } = firstLinePlace(job, segments)
  const result: Result = { pages, bulletRow, ...(note ? { note } : {}) }
  await fsWrite($, `${dir}/pages.json`, JSON.stringify(result))
  return result
}
