// Typst on the host: finding it, measuring the fonts, and compiling an
// answer's segments to PNG pages (with a retry in safe mode).
import type { EngineInterface } from 'claude-code'

import { COMPILE_TIMEOUT_MS, NO_NETWORK, SEGMENT_ROWS, TYPST_FALLBACKS } from './settings'
import { DEFAULT_METRICS, type FontMetrics, type Job, type Metrics, type Result } from './state'
import { firstLine, imagePathOf, localImages, plainOf, splitSegments } from './markdown'
import { inlineBudget } from './terminal'
import { alignFirstLine, firstLineOf, fontFit, sizing } from './draw'
import { HEADERS_SH } from './host'

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

// Any failed compile is tried once more with `safe=1`: the template then
// shows typst fences and math as code and images as alt boxes, which is how
// a bad typst block or an unknown LaTeX command still draws.
export function shouldRetrySafe(exitCode: number): boolean {
  return exitCode !== 0
}

export async function findTypst($: EngineInterface): Promise<string | null> {
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

// The argv that measures the fonts: the active theme's body and code fonts
// (theme.typ reads theme.json, which needs `--root /`).
export const measureCall = (typst: string, root: string, family: string, themeDir: string) => [
  typst, 'eval', 'query(<m>).first().value', '--in', `${root}/render/measure.typ`, '--root', '/',
  '--input', `term-font=${family}`, '--input', `theme-dir=${themeDir}`,
]

// The fonts' metrics from render/measure.typ; the macOS defaults when that fails.
export async function measureFonts($: EngineInterface, typst: string, root: string, cache: string, family: string, themeDir: string): Promise<Metrics> {
  const argv = measureCall(typst, root, family, themeDir)
  const got = await $.process.run(argv, { timeoutMs: 10000, env: noNetworkEnv(cache) }).catch(() => null)
  try {
    const m = JSON.parse(got?.stdout ?? '') as Metrics
    const ok = (x: FontMetrics | null | undefined) => !!x && x.adv > 0 && x.xh > 0 && x.avg > 0
    if (ok(m.menlo) && ok(m.body)) return { term: ok(m.term) ? m.term : null, menlo: m.menlo, body: m.body }
  } catch {}
  return DEFAULT_METRICS
}

export async function logDebug($: EngineInterface, cache: string, text: string) {
  const stamp = new Date().toISOString()
  await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', `${cache}/debug.log`], { stdin: `[${stamp}] ${text.trimEnd()}\n` }).catch(() => undefined)
}

// The images that exist, for the template's allow-list: it draws any other
// as its alt, so one bad path doesn't fail the page.
export async function existingImages($: EngineInterface, segments: readonly string[], base: string): Promise<string[]> {
  const found: string[] = []
  for (const path of new Set(segments.flatMap(localImages))) {
    const full = imagePathOf(path, base)
    if (await $.fs.exists(full).catch(() => false)) found.push(path, full)
  }
  return found
}

export async function runTypst($: EngineInterface, job: Job, segments: readonly string[], dir: string, tag: string, isSafe: boolean) {
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

export async function compile($: EngineInterface, job: Job): Promise<Result | 'failed'> {
  const dir = `${job.env.cache}/${job.key}`
  const kept = await $.fs.read(`${dir}/pages.json`).catch(() => null)
  if (kept) return JSON.parse(kept) as Result

  const segments = splitSegments(job.text, job.columns, job.env.inline ? inlineBudget(job.cell) : SEGMENT_ROWS)
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
