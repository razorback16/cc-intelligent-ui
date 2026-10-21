// The Frame: the terminal's columns, rows and cell, the one source of truth
// for every size. A small watcher prints the tty size (TIOCGWINSZ) at each
// SIGWINCH that changed it (and, once a picture is drawn, the clipboard's
// changes: clipboard.ts, register.tsx); the render hooks note the viewport (the
// transcript can be narrower than the tty). Both restart one quiet timer:
// during a burst no job starts, and once it is quiet one tty read settles
// it. A changed Frame begins an epoch (epoch.ts), so a drag or a font size
// change compiles once and its pictures swap in one redraw.
import type { EngineInterface } from 'claude-code'

import { BASE_THEME, DEFAULT_CELL, RESIZE_QUIET_MS } from './settings'
import { DEFAULT_METRICS, S, type Frame, type Metrics } from './state'
import { beginEpoch, holdJobs, releaseJobs } from './epoch'
import { pump } from './stream'
import { columnsFor, isGhosttyHere, sizeOf } from './terminal'
import { CELL_SH, perlFor, termFontOf, WATCH_PL } from './host'
import { clipWatchArgs } from './clipboard'
import { measureFonts } from './typst'
import { clockAfter, processRun, spawn } from './api'

export type { Cell, Frame } from './state'

// The viewport a render hook gives: its columns and rows.
export type View = { columns: number; rows: number }

// One tty size `rows cols xpixel ypixel` (a read, a watcher's size line) as
// a Frame; null when it is not 4 whole numbers or its cell can not be right
// (the rule of sizeOf: no pixels, or a cell under 4 or over 64 px wide).
export function frameOfLine(line: string): Frame | null {
  if (!/^\d+ \d+ \d+ \d+$/.test(line.trim())) return null
  const size = sizeOf(line, isGhosttyHere())
  return size?.cell ? { columns: size.columns, rows: size.rows, cell: size.cell } : null
}

// One watcher line (WATCH_PL): `pid <n>`, `size <rows> <cols> <xpixel>
// <ypixel>` (a Frame, null when bad: frameOfLine), `clip <count>` or `clip
// none` (count null: no PerlObjCBridge). Null for any other line.
export type WatchLine = { pid: string } | { size: Frame | null } | { clip: number | null }
export function watchLineOf(line: string): WatchLine | null {
  const m = /^(pid|size|clip) (.*)$/.exec(line.trim())
  if (!m) return null
  const [, tag, value] = m as unknown as [string, string, string]
  if (tag === 'size') return { size: frameOfLine(value) }
  if (/^\d+$/.test(value)) return tag === 'pid' ? { pid: value } : { clip: Number(value) }
  return tag === 'clip' && value === 'none' ? { clip: null } : null
}

// What changed from `a` to `b`: the cell (a font size change), else the
// columns, else the rows. No `a` (the first read) is a cell change.
export function frameChange(a: Frame | null, b: Frame): 'none' | 'cell' | 'columns' | 'rows' {
  if (!a || a.cell.width !== b.cell.width || a.cell.height !== b.cell.height) return 'cell'
  if (a.columns !== b.columns) return 'columns'
  if (a.rows !== b.rows) return 'rows'
  return 'none'
}

// Joins a child's output pieces into lines: each call gives the lines that
// the piece ends, and keeps the rest for the next piece.
export function lineSplitter(): (piece: string) => string[] {
  let rest = ''
  return piece => {
    const lines = (rest + piece).split('\n')
    rest = lines.pop() ?? ''
    return lines.map(line => line.replace(/\r$/, ''))
  }
}

// The target Frame (S.frame): keys and compiles use it. With no Frame yet:
// the viewport (else 80 x 48) and DEFAULT_CELL.
export function frameFor(view?: View): Frame {
  return S.frame ?? composeFrame(null, view ?? null)
}

// The Frame whose pictures are on screen (S.shown): a picture drawn now
// sizes from it, so all of them swap together when the epoch commits.
export function shownFor(view?: View): Frame {
  return S.shown ?? frameFor(view)
}

// The columns a Markdown picture (an answer, a plan, a sent file) takes in
// `frame`: columnsFor with /iui width; over ssh (`inline`) also at
// most what a `{ png }` source can be wide in its cell.
export const pictureColumns = (frame: Frame, inline: boolean): number =>
  columnsFor(frame.columns, S.width, inline ? frame.cell : null)

// The Frame of a tty read and a viewport: the tty's with its columns at
// most the viewport's. With no tty: the viewport (else 80 x 48) and
// DEFAULT_CELL.
export function composeFrame(tty: Frame | null, view: View | null): Frame {
  if (!tty) return { columns: view?.columns ?? 80, rows: view?.rows ?? 48, cell: DEFAULT_CELL }
  return view && view.columns < tty.columns ? { ...tty, columns: view.columns } : tty
}

// The last viewport a render hook noted; null before the first.
const viewNow = (): View | null => (S.viewColumns === null ? null : { columns: S.viewColumns, rows: S.viewRows ?? 48 })

// One read of the tty size as a Frame; null when it fails (no tty, no
// pixels).
export async function readFrame($: EngineInterface): Promise<Frame | null> {
  const tty = await processRun($, ['sh', '-c', CELL_SH], { timeoutMs: 5000 }).catch(() => null)
  return tty?.exitCode === 0 ? frameOfLine(tty.stdout) : null
}

// Sets the tty's Frame at once, as the target and the Frame on screen
// (setUp's first read, before anything draws: no epoch), with the height
// setting read; a later change is settled first (noteTty).
export function setFrame(frame: Frame | null) {
  S.shownHeight = S.height
  if (!frame) return
  S.tty = frame
  S.frame = S.shown = composeFrame(frame, viewNow())
}

// The quiet timer, with the clock given: the first input of a burst calls
// `onStart`; each input waits `ms` again; when none came for `ms`,
// `onQuiet`. Its `stale()` is true once a newer input came (that input's
// quiet settles instead).
export function quietTimer(o: {
  ms: number
  after: (ms: number, fn: () => void) => { cancel: () => void }
  onStart: () => void
  onQuiet: (stale: () => boolean) => void
}): () => void {
  let wait: { cancel: () => void } | null = null
  let inputs = 0
  return () => {
    inputs++
    if (!wait) o.onStart()
    wait?.cancel()
    wait = o.after(o.ms, () => {
      wait = null
      const seen = inputs
      o.onQuiet(() => inputs !== seen)
    })
  }
}

// The one quiet timer of the tty and the viewport (started with the module).
let poke: (() => void) | null = null
function burst($: EngineInterface) {
  poke ??= quietTimer({
    ms: RESIZE_QUIET_MS,
    after: (ms, fn) => clockAfter($, ms, fn),
    onStart: holdJobs,
    onQuiet: stale => void settle($, stale),
  })
  poke()
}

// A font change found while a newer input came: the next settle begins an
// epoch for it even when its Frame is the same.
let refonted = false

// The burst is quiet: one tty read (none with no tty), the Frame of it and
// the viewport, and the compare. A new cell (a font size change) reads the
// fonts first, so it is one epoch. A changed Frame or font begins an epoch;
// else the held jobs go on (pump). When a newer input came during a read,
// it stops: that input's quiet settles.
async function settle($: EngineInterface, stale: () => boolean) {
  try {
    const tty = S.tty ? ((await readFrame($).catch(() => null)) ?? S.tty) : null
    if (stale()) return
    S.tty = tty
    const target = composeFrame(tty, viewNow())
    const change = frameChange(S.frame, target)
    if (change === 'cell' && S.frame) {
      refonted = (await refont($).catch(() => false)) || refonted
      if (stale()) return
    }
    if (change !== 'none' || refonted) {
      refonted = false
      beginEpoch($, target)
    } else releaseJobs($)
  } catch {
    if (stale()) return
    releaseJobs($)
  }
  pump($)
}

// A new tty value from the watcher; a bad one (null) and the value known
// (the watcher's first line) are dropped.
export function noteTty($: EngineInterface, frame: Frame | null) {
  if (!frame || (S.tty && frameChange(S.tty, frame) === 'none')) return
  S.tty = frame
  burst($)
}

// The viewport, from a render hook. The first one applies at once (nothing
// was drawn with a viewport yet); a change is settled with the tty's, so the
// hooks draw the settled Frame until then. With a tty, only its columns
// count (the rows are the tty's).
export function noteView($: EngineInterface, view: View) {
  if (view.columns === S.viewColumns && (S.tty || view.rows === S.viewRows)) return
  const first = S.viewColumns === null || !S.frame
  const counts = first || !S.tty || view.columns !== S.viewColumns
  S.viewColumns = view.columns
  S.viewRows = view.rows
  if (first) S.frame = S.shown = composeFrame(S.tty, view)
  else if (counts) burst($)
}

// The watcher's child now (one at a time): whether it reads the clipboard,
// whether it ended (`final`: with no tty and no bridge, or it could not
// start; never again), and its stop (a kill by its PID; its later lines are
// dropped). A hot reload kills the child with the old module. Where the
// clip lines go (register.tsx): a change count, or null for `clip none`,
// and whether it is the first line of its child (the count at its start).
let watcher: { clip: boolean; ended: boolean; final?: boolean; stop: () => void } | null = null
let clipTo: ((count: number | null, first: boolean) => void) | null = null

// The watcher now, for /iui details: null when none was started.
export const watchState = (): { clip: boolean; ended: boolean } | null => (watcher ? { clip: watcher.clip, ended: watcher.ended } : null)

// The children that ended on their own and were started again, at most
// WATCH_RESTARTS per load: a perl that dies at once is not started in a loop.
let restarts = 0
export const WATCH_RESTARTS = 3
export const WATCH_RESTART_MS = 1000

// Starts the watcher (setUp: no `clip`, the clipboard part as it is), or
// starts it again when the clipboard part turns on (`clip`: where its lines
// go) or off (null): the arguments of a child are fixed at its start. The
// old child is stopped first; the new one prints the size again (the value
// known: no burst, no epoch). A clip child that ends on its own is started
// again (WATCH_RESTARTS times at most), and so is any child that ended, at
// the next call that wants it; until then a viewport change still reads
// the tty once it is quiet. True when a child was started.
export function watchFrame($: EngineInterface, clip?: ((count: number | null, first: boolean) => void) | null): boolean {
  if (clip !== undefined) clipTo = clip
  const isClip = !!clipTo
  // Nothing to change: the child runs as wanted, or none runs (setUp did
  // not start one) and the clipboard part is off.
  if (watcher && watcher.clip === isClip) {
    if (!watcher.ended || watcher.final || restarts >= WATCH_RESTARTS) return false
    restarts++
  }
  if (!watcher && clip !== undefined && !isClip) return false
  watcher?.stop()
  // The stop: a kill once its PID is known (its first line).
  let pid = ''
  let stopped = false
  let counted = false
  const kill = () => {
    if (stopped && pid) void Promise.resolve(processRun($, ['kill', pid], { timeoutMs: 5000 })).catch(() => undefined)
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    kill()
  }
  const me: NonNullable<typeof watcher> = { clip: isClip, ended: false, stop }
  watcher = me
  try {
    const isMac = S.hostOs === 'Darwin'
    const child = spawn($, { argv: [perlFor(isMac), '-e', WATCH_PL, ...(isClip ? ['clip', ...(clipWatchArgs(isMac) ?? [])] : [])] })
    void followWatcher(child, line => {
      if ('pid' in line) {
        pid = line.pid
        kill()
      } else if (stopped) return
      else if ('size' in line) noteTty($, line.size)
      else if (me.clip) {
        clipTo?.(line.clip, !counted)
        counted = true
      }
    }).then(got => {
      me.ended = true
      if (got === 'no tty') me.final = true
      // A clip child that ended on its own (no stop): again after
      // WATCH_RESTART_MS, while it is still the child now.
      if (stopped || me.final || !me.clip) return
      try {
        clockAfter($, WATCH_RESTART_MS, () => {
          if (watcher === me) watchFrame($)
        })
      } catch {}
    }).catch(() => undefined)
  } catch {
    me.ended = me.final = true
  }
  return true
}

// The session ends (not a /clear): the child is killed and none takes its
// place.
export function stopWatch() {
  watcher?.stop()
  if (watcher) watcher = { clip: watcher.clip, ended: true, stop: () => {} }
  restarts = WATCH_RESTARTS
}

// Reads the watcher's pieces as lines, each to `note` (other lines are
// dropped), until it ends: 'no tty' when it exits 1, else 'failed' (it did
// not start: the first pull rejects; or it ended in another way).
export async function followWatcher(
  child: AsyncIterator<{ stream: 'stdout' | 'stderr'; text: string }, { code: number | null } | undefined>,
  note: (line: WatchLine) => void,
): Promise<'no tty' | 'failed'> {
  const lines = lineSplitter()
  try {
    for (;;) {
      const got = await child.next()
      if (got.done) return got.value?.code === 1 ? 'no tty' : 'failed'
      if (got.value.stream !== 'stdout') continue
      for (const line of lines(got.value.text)) {
        const read = watchLineOf(line)
        if (read) note(read)
      }
    }
  } catch {
    return 'failed'
  }
}

// The cell changed: read the terminal's font and the fonts' metrics again.
// True when either changed (the caller begins the epoch). A failed read
// ('' or the defaults of measureFonts) keeps the value known. One read at a
// time; a change while it runs reads once more.
let fonting: Promise<boolean> | null = null
let fontAgain = false
export function refont($: EngineInterface): Promise<boolean> {
  if (fonting) {
    fontAgain = true
    return fonting
  }
  fonting = (async () => {
    let changed = false
    do {
      fontAgain = false
      const env = S.env
      if (!env) return changed
      const termFont = (await termFontOf($, env.isMac).catch(() => '')) || env.termFont
      const themeDir = S.look?.dir ?? `${env.root}/render/themes/${BASE_THEME}`
      const read = env.typst ? await measureFonts($, env.typst, env.root, env.cache, termFont, themeDir).catch(() => DEFAULT_METRICS) : env.metrics
      const metrics = read === DEFAULT_METRICS ? env.metrics : read
      if (termFont === env.termFont && sameMetrics(metrics, env.metrics)) continue
      env.termFont = termFont
      env.metrics = metrics
      changed = true
    } while (fontAgain)
    return changed
  })().finally(() => {
    fonting = null
  })
  return fonting
}

const sameMetrics = (a: Metrics, b: Metrics) => JSON.stringify(a) === JSON.stringify(b)
