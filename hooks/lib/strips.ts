// Picture select's strips (select.ts): a page cut into one PNG per row by
// Typst (render/strips.typ, about 0.2 s a page), once, the first time a
// selection reaches it. They are kept beside the page in its key folder
// (stripDir), so the cache cleanup takes them with it, and a folder cut
// before is used at once. A PNG's rows can not be cut out of its bytes (its
// filters run across rows), so Typst draws each row again, pixel for pixel.
import type { EngineInterface } from 'claude-code'

import { COMPILE_TIMEOUT_MS } from './settings'
import { keep, type Env } from './state'
import { stripDir, stripFile } from './select'
import { logDebug, noNetworkEnv } from './typst'
import { fsExists, processRun } from './api'

// The Typst run that cuts `file` (`width` x `height` px) into rows of
// `rowPx`, into its strips' folder (made first).
export function stripsCall(o: { typst: string; root: string; cache: string; file: string; width: number; height: number; rowPx: number }): { argv: string[]; env: Record<string, string> } {
  const argv = [
    'sh', '-c', 'mkdir -p "$1" && shift && exec "$@"', 'sh', stripDir(o.file),
    o.typst, 'compile',
    '--root', '/',
    '--format', 'png',
    '--diagnostic-format', 'short',
    '--ppi', '72',
    '--input', `src=${o.file}`,
    '--input', `w=${o.width}`,
    '--input', `h=${o.height}`,
    '--input', `row=${o.rowPx}`,
    `${o.root}/render/strips.typ`,
    `${stripDir(o.file)}/s-{0p}.png`,
  ]
  return { argv, env: noNetworkEnv(o.cache) }
}

// The pages whose strips are there (true) or failed (false), and the cuts
// that run now, by `<file>@<rowPx>`.
const STRIPS_KEPT = 256
const cut = new Map<string, boolean>()
const cutting = new Map<string, Promise<boolean>>()

const keyOf = (file: string, rowPx: number) => `${file}@${rowPx}`

// Whether a page's strips are there (cut in this load, or found).
export const hasStrips = (file: string, rowPx: number) => cut.get(keyOf(file, rowPx)) === true

// Cuts a page's strips once (a run that failed is not tried again in this
// load); `done` runs when they are there. Never throws.
export function cutStrips($: EngineInterface, env: Env, page: { file: string; width: number; height: number }, plan: { rowPx: number; rows: number }, done: () => void) {
  const key = keyOf(page.file, plan.rowPx)
  if (cut.has(key) || cutting.has(key) || !env.typst) return
  const typst = env.typst
  const run = (async () => {
    if (await fsExists($, stripFile(page.file, plan.rows, plan.rows - 1)).catch(() => false)) return true
    const { argv, env: vars } = stripsCall({ typst, root: env.root, cache: env.cache, file: page.file, width: page.width, height: page.height, rowPx: plan.rowPx })
    const ran = await processRun($, argv, { env: vars, timeoutMs: COMPILE_TIMEOUT_MS })
    if (ran.exitCode !== 0) await logDebug($, env.cache, `strips of ${page.file} failed:\n${ran.stderr}`)
    return ran.exitCode === 0
  })().catch(() => false)
  cutting.set(key, run)
  void run.then(isCut => {
    cutting.delete(key)
    keep(cut, key, isCut, STRIPS_KEPT)
    if (isCut) done()
  })
}

// Forgets the strips cut (for tests).
export function forgetStrips() {
  cut.clear()
  cutting.clear()
}
