// Picture select's page cache: each page that takes picture select is made
// ready for its frames (frames.ts: decoded, its plain row pieces) and its
// words are probed (probe.ts) in the background, when it is drawn or comes
// on screen, so the first highlight and the copy at the button's up wait
// for nothing. The hooks have no thread, worker or timer of their own (only
// `$.clock`; `$.process` is a process whose pixels would come back as
// base64): a build runs in slices of SLICE_MS at most, each after a
// `clock.after(0)`, so render hooks run between them. One build at a time:
// a page a down asks for first, then the pages on screen, the newest
// drawing first; a build that a down puts aside is paused and goes on
// later; a page that leaves the screen is dropped (its build too). The
// pages built stay in memory (FRAMES_KEPT_BYTES at most; the ones off
// screen go first). Nothing is written to disk: the pixels are the most of
// it, and a text write of them would cost more than the decode.
import type { EngineInterface } from 'claude-code'

import type { DrawnPage, Drawn } from './copy'
import { pageTopsOf } from './copy'
import { bytesOf, framesSteps, rgbOf, type Frames } from './frames'
import { fromBase64 } from './png'
import { knownWords, wordsOf } from './probe'
import type { Job } from './state'
import { traceDebug } from './log'
import { clockAfter, fsRead, uiLog } from './api'

// A slice's budget, and a page a down waits for.
export const SLICE_MS = 4
export const PROMOTED_SLICE_MS = 8
// The pages built kept (their pixels and pieces), by bytes: about two of the tallest.
export const FRAMES_KEPT_BYTES = 128 * 1024 * 1024
// The pages whose words the background probed and got none: not probed again
// in the background (a copy still tries).
const WORDS_TRIED_KEPT = 256

// A page to build: its drawing (`id`, `seq`: newer is larger) and index,
// whether it is on screen, `promoted` (0: no down asked; else the order of
// the ask, the last one first) and its build put aside, if any.
export type Want = { key: string; page: DrawnPage; color: string; id: string; index: number; seq: number; onScreen: boolean; promoted: number; paused?: Build }
export type Build = {
  want: Want; steps: Generator<Frames | undefined, Frames, void> | null; png: Uint8Array | null; slices: number[]; started: number
  readMs: number; readyMs: number; stepMs: number; isCancelled: boolean; isReady: boolean
}

export const keyOf = (page: DrawnPage, color: string) => `${page.file}|${page.columns}x${page.rows}|${color}`

// The next page to build: the last one a down asked for, then the pages on
// screen, the newest drawing first, its pages in order.
export function nextWant(wants: Iterable<Want>): Want | undefined {
  let best: Want | undefined
  const before = (a: Want, b: Want) =>
    a.promoted !== b.promoted ? a.promoted > b.promoted : a.onScreen !== b.onScreen ? a.onScreen : a.seq !== b.seq ? a.seq > b.seq : a.index < b.index
  for (const w of wants) if (!best || before(w, best)) best = w
  return best
}

// The keys to drop so the rest fit `budget` bytes: `kept` in use order (the
// oldest first), the ones off screen before the ones on screen; `keep` never.
export function evictKeys(kept: readonly { key: string; bytes: number; onScreen: boolean }[], budget: number, keep: string): string[] {
  let bytes = kept.reduce((n, k) => n + k.bytes, 0)
  const out: string[] = []
  for (const k of [...kept.filter(k => !k.onScreen), ...kept.filter(k => k.onScreen)]) {
    if (bytes <= budget) break
    if (k.key === keep) continue
    bytes -= k.bytes
    out.push(k.key)
  }
  return out
}

// One slice of `steps`: steps until `budget` ms have gone, never one that
// the last step's time says would go past it (one step at least). `each`
// gets each value yielded; `done` the result when the steps end.
export function sliceOf<T>(
  steps: Generator<T | undefined, T, void>, budget: number, b: { stepMs: number }, each: (value: T) => void, now = () => performance.now(),
): { done?: T; ms: number } {
  const t0 = now()
  for (;;) {
    const t = now()
    const got = steps.next()
    const end = now()
    b.stepMs = end - t
    if (got.done) return { done: got.value, ms: end - t0 }
    if (got.value) each(got.value)
    if (end - t0 + b.stepMs >= budget) return { ms: end - t0 }
  }
}

// The value at `p` (0 to 1) of the sorted numbers.
export const quantile = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0

// The pages of `d` on screen now: by its rows on screen and its page tops;
// all of them when the tops are not known, none when it is off screen.
export function pagesOnScreen(d: Drawn): number[] {
  if (d.onScreen === null) return []
  const tops = pageTopsOf(d)
  const all = d.pages.map((_, i) => i)
  if (!tops || !d.onScreen) return all
  const { first, last } = d.onScreen
  return all.filter(i => tops[i]! <= last && tops[i]! + d.pages[i]!.rows - 1 >= first)
}

// The cache: the pages built (in use order; null: it can not be), the
// pages to build, the pages on screen, the build now and who waits for a
// page; the words to probe, and the ones the background got none for.
export const pages = {
  frames: new Map<string, Frames | null>(),
  wants: new Map<string, Want>(),
  screen: new Set<string>(),
  build: null as Build | null,
  waiters: new Map<string, ((f: Frames | null) => void)[]>(),
  promotions: 0,
  isPumping: false,
  words: [] as { key: string; d: Drawn & { job?: Job }; page: number }[],
  wordsTried: new Set<string>(),
  isProbing: false,
}

// Forgets everything (for tests).
export function forgetPages() {
  pages.frames.clear()
  pages.wants.clear()
  pages.screen.clear()
  pages.waiters.clear()
  pages.build = null
  pages.promotions = 0
  pages.isPumping = false
  pages.words = []
  pages.wordsTried.clear()
  pages.isProbing = false
}

const ms = (t: number) => `${Math.round(t)}ms`
const nameOf = (file: string) => file.split('/').slice(-2).join('/')

// A page's frames when they are built (null: they can not be; undefined: not yet).
export function framesKnown(page: DrawnPage, color: string): Frames | null | undefined {
  const key = keyOf(page, color)
  const got = pages.frames.get(key)
  if (got !== undefined) {
    pages.frames.delete(key)
    pages.frames.set(key, got)
  }
  return got
}

// The pages of drawing `d` now (drawn, or a new onScreen): the ones on
// screen are queued (with their words); the others leave the queue, and a
// build of one stops (not one a down asked for). Never waits.
export function notePages($: EngineInterface, d: Drawn & { job?: Job }, color: string) {
  const on = new Set(pagesOnScreen(d))
  d.pages.forEach((page, index) => {
    const key = keyOf(page, color)
    const wordsKey = `${d.dir}#${index}`
    if (!on.has(index)) {
      pages.screen.delete(key)
      const want = pages.wants.get(key)
      if (want && !want.promoted) {
        pages.wants.delete(key)
        if (want.paused) traceDebug($, `select: cache stop ${nameOf(page.file)} (off screen, paused) after ${want.paused.slices.length} slices`)
      }
      const b = pages.build
      if (b && b.want.key === key && !b.want.promoted && !b.isCancelled) {
        b.isCancelled = true
        traceDebug($, `select: cache stop ${nameOf(page.file)} (off screen) after ${b.slices.length} slices`)
      }
      pages.words = pages.words.filter(w => w.key !== wordsKey)
      return
    }
    pages.screen.add(key)
    if (!pages.frames.has(key) && pages.build?.want.key !== key) {
      const want = pages.wants.get(key)
      if (want) Object.assign(want, { page, id: d.id, index, seq: d.seq, onScreen: true })
      else pages.wants.set(key, { key, page, color, id: d.id, index, seq: d.seq, onScreen: true, promoted: 0 })
    }
    if (d.job && !knownWords(d, index) && !pages.wordsTried.has(wordsKey) && !pages.words.some(w => w.key === wordsKey)) pages.words.push({ key: wordsKey, d, page: index })
  })
  kick($)
  probeNext($)
}

// A page's frames, built first now (a down): at once when they are there,
// else when its build (to the front of the queue) is done. `waitMs` the wait.
export async function needFrames($: EngineInterface, page: DrawnPage, color: string, at?: { id: string; index: number; seq: number }): Promise<{ frames: Frames | null; waitMs: number }> {
  const known = framesKnown(page, color)
  if (known !== undefined) return { frames: known, waitMs: 0 }
  const t = performance.now()
  const key = keyOf(page, color)
  const promoted = ++pages.promotions
  const b = pages.build
  if (b && b.want.key === key) b.want.promoted = promoted
  else {
    // The build now is put aside: paused (on screen), else dropped.
    if (b && !b.isCancelled) {
      pages.build = null
      if (!b.isReady && (pages.screen.has(b.want.key) || b.want.promoted)) {
        b.want.paused = b
        pages.wants.set(b.want.key, b.want)
        traceDebug($, `select: cache pause ${nameOf(b.want.page.file)} after ${b.slices.length} slices`)
      } else b.isCancelled = true
    }
    const want = pages.wants.get(key)
    if (want) Object.assign(want, { onScreen: true, promoted, ...(at ? { id: at.id, index: at.index, seq: at.seq } : {}) })
    else pages.wants.set(key, { key, page, color, id: at?.id ?? '', index: at?.index ?? 0, seq: at?.seq ?? 0, onScreen: true, promoted })
    traceDebug($, `select: cache first ${nameOf(page.file)} (a down; ${pages.wants.size} queued)`)
  }
  const frames = await new Promise<Frames | null>(done => {
    pages.waiters.set(key, [...(pages.waiters.get(key) ?? []), done])
    kick($)
  })
  return { frames, waitMs: performance.now() - t }
}

// The next slice, after the hooks' other work.
function later($: EngineInterface) {
  try {
    clockAfter($, 0, () => void slice($).catch(() => (pages.isPumping = false)))
  } catch {
    pages.isPumping = false
  }
}

function kick($: EngineInterface) {
  if (pages.isPumping) return
  pages.isPumping = true
  later($)
}

// One slice: the next build begun (its PNG read) or taken up again, or
// SLICE_MS of the build now.
async function slice($: EngineInterface) {
  let b = pages.build
  if (b?.isCancelled) b = pages.build = null
  if (!b) {
    const want = nextWant(pages.wants.values())
    if (!want) {
      pages.isPumping = false
      return
    }
    pages.wants.delete(want.key)
    if (want.paused) {
      b = pages.build = want.paused
      want.paused = undefined
      traceDebug($, `select: cache resume ${nameOf(want.page.file)} after ${b.slices.length} slices${want.promoted ? ', asked by a down' : ''}`)
    } else {
      const started = performance.now()
      b = pages.build = { want, steps: null, png: null, slices: [], started, readMs: 0, readyMs: 0, stepMs: 0, isCancelled: false, isReady: false }
      try {
        const { base64 } = await fsRead($, want.page.file, { as: 'bytes' })
        if (!b.isCancelled) b.png = fromBase64(base64)
      } catch (err) {
        fail($, b, err)
      }
      b.readMs = performance.now() - started
      if (b.png) traceDebug($, `select: cache start ${nameOf(want.page.file)} (read ${ms(b.readMs)}${want.promoted ? ', asked by a down' : ''}, ${pages.wants.size} queued)`)
      later($)
      return
    }
  }
  const build = b
  try {
    build.steps ??= framesSteps(build.png!, build.want.page, rgbOf(build.want.color))
    const got = sliceOf(build.steps, build.want.promoted ? PROMOTED_SLICE_MS : SLICE_MS, build, f => ready($, build, f))
    build.slices.push(got.ms)
    if (got.done) {
      if (pages.build === build) pages.build = null
      built($, build, got.done)
    }
  } catch (err) {
    if (build.isReady) {
      if (pages.build === build) pages.build = null
    } else fail($, build, err)
  }
  later($)
}

// The cache within its budget: the oldest pages off screen go first.
function evict(keep: string) {
  const kept = [...pages.frames].map(([k, f]) => ({ key: k, bytes: f ? bytesOf(f) : 0, onScreen: pages.screen.has(k) }))
  for (const k of evictKeys(kept, FRAMES_KEPT_BYTES, keep)) pages.frames.delete(k)
}

// A build's frames are ready (or can not be: null): kept and given to who
// waits; its tinted rows go on.
function ready($: EngineInterface, b: Build, frames: Frames | null) {
  b.isReady = true
  b.readyMs = performance.now() - b.started
  const { key } = b.want
  pages.frames.delete(key)
  pages.frames.set(key, frames)
  evict(key)
  const waiters = pages.waiters.get(key) ?? []
  pages.waiters.delete(key)
  for (const done of waiters) done(frames)
}

// A build that failed: no frames for the page (not tried again).
function fail($: EngineInterface, b: Build, err: unknown) {
  if (pages.build === b) pages.build = null
  pages.wants.delete(b.want.key)
  ready($, b, null)
  const why = `no highlight for ${b.want.page.file}: ${err instanceof Error ? err.message : String(err)}`
  traceDebug($, `select: ${why}`)
  void Promise.resolve(uiLog($, `Intelligent UI: picture select: ${why}`, { to: 'debug' })).catch(() => undefined)
}

// A build done (its tinted rows too): the cache within its budget again, and its trace.
function built($: EngineInterface, b: Build, frames: Frames) {
  evict(b.want.key)
  const sorted = [...b.slices].sort((x, y) => x - y)
  let bytes = 0
  for (const f of pages.frames.values()) bytes += f ? bytesOf(f) : 0
  traceDebug($,
    `select: cache built ${nameOf(b.want.page.file)} ${frames.img.width}x${frames.img.height} ready in ${ms(b.readyMs)}, done in ${ms(performance.now() - b.started)} ` +
    `(read ${ms(b.readMs)}, ${b.slices.length} slices, max ${(sorted.at(-1) ?? 0).toFixed(1)}ms, p95 ${quantile(sorted, 0.95).toFixed(1)}ms` +
    `${b.want.promoted ? ', asked by a down' : ''}); ${pages.frames.size} pages kept, ${(bytes / (1 << 20)).toFixed(0)} MB, ${pages.wants.size} queued`)
}

// The words of the pages queued, one probe at a time (a typst process: it
// does not hold the hooks), the newest drawing first.
function probeNext($: EngineInterface) {
  if (pages.isProbing || !pages.words.length) return
  pages.words.sort((a, b) => b.d.seq - a.d.seq || a.page - b.page)
  const next = pages.words.shift()!
  if (knownWords(next.d, next.page)) return probeNext($)
  pages.isProbing = true
  const t = performance.now()
  void wordsOf($, next.d, next.page)
    .then(got => {
      if (!got) {
        if (pages.wordsTried.size >= WORDS_TRIED_KEPT) pages.wordsTried.clear()
        pages.wordsTried.add(next.key)
      }
      traceDebug($, `select: words ${next.d.id} page ${next.page} ${got ? `${got.items.length} words` : 'none'} in ${ms(performance.now() - t)} (background)`)
    })
    .catch(() => undefined)
    .finally(() => {
      pages.isProbing = false
      probeNext($)
    })
}
