// The epoch: one for each new target (a settled resize, a font size change,
// a setting, the light or dark mode). It stops the compiles of the old
// target, and its pictures swap in all at once: a job of the open epoch that
// ends does not redraw; the epoch commits (S.shown = S.frame, with the
// height setting of the target, one redraw) when its jobs on screen are done. A burst (a drag not quiet yet) holds the
// jobs and the commit.
import type { EngineInterface } from 'claude-code'

import { COMMIT_MAX_MS, COMMIT_MIN_MS } from './settings'
import { converting, epochOpen, queue, refresh, running, S, type Frame, type Job } from './state'
import { traceDebug } from './log'
import { clockAfter } from './api'

// The open epoch: `ready` once COMMIT_MIN_MS passed with no new activity
// (a row drawn, a job enqueued: extendEpoch), `overdue` once COMMIT_MAX_MS
// passed since it began (it commits with jobs still running). A new epoch
// has new flags and cancels the old timers.
let ready = false
let overdue = false
let minTimer: { cancel: () => void } | null = null
let maxTimer: { cancel: () => void } | null = null
// For the trace: when the open epoch began, and the jobs enqueued in it.
let begunAt = 0
let jobsIn = 0

// Begins a new epoch for `frame` (else the target now): stops every compile
// that runs (it does not wait for them), empties the queue, sets the target
// and redraws once. The rows draw their old pictures and enqueue the target.
export function beginEpoch($: EngineInterface, frame?: Frame | null) {
  S.resizing = false
  S.missed = false
  const cancelled = running.size
  const dropped = queue.length
  for (const { cancel } of running.values()) {
    try {
      cancel()
    } catch {}
  }
  queue.length = 0
  const target = frame ?? S.frame
  if (target) S.frame = { ...target }
  const epoch = ++S.epoch
  begunAt = Date.now()
  jobsIn = 0
  const f = S.frame
  traceDebug($, `epoch ${epoch} begin: target ${f ? `${f.columns}x${f.rows} cell ${f.cell.width}x${f.cell.height}` : 'none'}; cancelled ${cancelled} running, dropped ${dropped} queued`)
  ready = false
  overdue = false
  maxTimer?.cancel()
  maxTimer = clockAfter($, COMMIT_MAX_MS, () => {
    if (S.epoch !== epoch) return
    overdue = true
    maybeCommit($)
  })
  armReady($)
  refresh($)
}

// The rows of the open epoch still come (each draws again after the
// epoch's redraw, after round trips to the host): its COMMIT_MIN_MS starts
// again, so a row drawn late still swaps at the commit. COMMIT_MAX_MS still
// counts from the begin. Nothing once it is ready.
export function extendEpoch($: EngineInterface) {
  if (epochOpen() && !ready) armReady($)
}

// A job was enqueued (for the trace).
export function jobQueued(job: Job) {
  if (job.epoch === S.epoch && epochOpen()) jobsIn++
}

// (Re)starts the open epoch's COMMIT_MIN_MS timer.
function armReady($: EngineInterface) {
  const epoch = S.epoch
  minTimer?.cancel()
  minTimer = clockAfter($, COMMIT_MIN_MS, () => {
    if (S.epoch !== epoch) return
    ready = true
    maybeCommit($)
  })
}

// A burst began: no job starts and the epoch does not commit until
// releaseJobs.
export function holdJobs() {
  S.resizing = true
}

// The burst ended with no new target: a job that ended during it redraws
// now (with no epoch open), and a commit that came due happens now.
export function releaseJobs($: EngineInterface) {
  S.resizing = false
  if (S.missed && !epochOpen()) refresh($)
  S.missed = false
  maybeCommit($)
}

// A job ended (its result is stored): during a burst it is noted; in an open
// epoch the epoch may commit; else its row redraws.
export function jobDone($: EngineInterface) {
  if (S.resizing) S.missed = true
  else if (epochOpen()) maybeCommit($)
  else refresh($)
}

// A job holds the commit when it is of the open epoch and its row is not
// known to be off screen.
const holds = (job: Job) => job.epoch === S.epoch && job.onScreen !== false

// Commits the open epoch when no burst runs and it is overdue, or it is
// ready and no job of it on screen waits or runs and no JPEG, WebP, SVG or
// PDF page converts.
function maybeCommit($: EngineInterface) {
  if (S.resizing || !epochOpen()) return
  if (!overdue) {
    if (!ready || converting.size > 0 || queue.some(holds)) return
    for (const { job } of running.values()) if (holds(job)) return
  }
  if (S.debug) {
    const left = (jobs: Iterable<Job>) => [...jobs].filter(job => job.epoch === S.epoch).length
    traceDebug($, `epoch ${S.epoch} commit after ${Date.now() - begunAt} ms (${overdue ? 'overdue' : 'ready'}): ${jobsIn} jobs queued, ${left(queue)} waiting, ${left([...running.values()].map(r => r.job))} running, ${converting.size} converting`)
  }
  S.shown = S.frame
  S.shownHeight = S.height
  S.shownEpoch = S.epoch
  refresh($)
}
