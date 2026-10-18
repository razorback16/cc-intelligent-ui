// Streaming and the compile queue: a block is blank while its text streams,
// final when its request moves on (or its text is still), then compiled, at
// most MAX_RUNNING at once: rows on screen first, then the newest. No job
// starts during a burst (S.resizing); a job that ends calls jobDone (no
// redraw while an epoch is open: the epoch commits).
import type { EngineInterface } from 'claude-code'

import { BLANK_AFTER_LIVE_MS, MAX_RUNNING, RESULTS_KEPT } from './settings'
import { finalized, keep, live, pending, queue, refresh, results, running, S, type Job } from './state'
import { hashOf } from './draw'
import { noteDesign, recordDesign } from './designs'
import { compile, logDebug } from './typst'
import { extendEpoch, jobDone, jobQueued } from './epoch'
import { clockAfter } from './api'

// The order of enqueue calls: a higher `order` is newer.
let enqueued = 0

// The queue's next job: one on screen first, then one not known (onScreen
// undefined), then one known off screen; among them the newest.
const rankOf = (j: Job) => (j.onScreen === true ? 2 : j.onScreen === false ? 0 : 1)
export function nextJob(jobs: readonly Job[]): number {
  let best = -1
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]!
    const b = jobs[best]
    if (!b || (rankOf(j) !== rankOf(b) ? rankOf(j) > rankOf(b) : (j.order ?? 0) > (b.order ?? 0))) best = i
  }
  return best
}

export function pump($: EngineInterface) {
  if (S.resizing) return
  while (running.size < MAX_RUNNING && queue.length) {
    const job = queue.splice(nextJob(queue), 1)[0]!
    const controller = new AbortController()
    const entry = { job, cancel: () => controller.abort(), signal: controller.signal }
    running.set(job.key, entry)
    void compile($, job, controller.signal)
      .catch(async (err: unknown) => {
        await logDebug($, job.env.cache, `compile ${job.key} threw: ${String(err)}`)
        return 'failed' as const
      })
      .then(async result => {
        // A cancelled compile keeps nothing: no result, no design.
        if (result !== 'cancelled') {
          // A first compile of a final text keeps its design (a job compiles
          // only once its text is final). Any job of the text saves it: the
          // first job may have been replaced in the queue by a later one with
          // the same design (recordDesign does nothing once it is saved).
          if (result !== 'failed' && job.room) {
            await recordDesign($, job.env.designs, job.room.designKey, job.room.design).catch(() => undefined)
          }
          keep(results, job.key, result, RESULTS_KEPT)
        }
        // A new run of the same key may have taken the entry.
        if (running.get(job.key) === entry) running.delete(job.key)
        // A cancelled compile draws nothing new: no redraw.
        if (result !== 'cancelled') jobDone($)
        pump($)
      })
  }
}

// A newer text of the same message replaces its job still waiting; the same
// job again takes its new place (on screen or not, and newest).
export function enqueue($: EngineInterface, job: Job) {
  // A first compile's design is in memory at once, so a render of the same
  // text while it compiles (a resize) uses it too.
  if (job.room?.isNew) noteDesign(job.room.designKey, job.room.design)
  if (results.has(job.key)) return
  // A run cancelled (by beginEpoch) still ends; its key compiles again.
  const runs = running.get(job.key)
  if (runs && !runs.signal.aborted) return
  const stale = queue.findIndex(j => j.requestId === job.requestId || j.key === job.key)
  if (stale >= 0) queue.splice(stale, 1)
  job.epoch = S.epoch
  job.order = ++enqueued
  queue.push(job)
  jobQueued(job)
  // A job of the open epoch: its rows still come, the commit waits for them.
  extendEpoch($)
  pump($)
}

// Marks a live block final: it compiles at once, and stays blank for at most
// BLANK_AFTER_LIVE_MS while it does. `isForGood`: the request moved past it,
// so later text changes do not hide it again.
export function finalize($: EngineInterface, requestId: string, isForGood: boolean) {
  const was = live.get(requestId)
  if (!was) return
  was.still.cancel()
  live.delete(requestId)
  if (isForGood) finalized.add(requestId)
  enqueue($, was.job)
  waitBlank($, requestId, hashOf([was.job.text]), BLANK_AFTER_LIVE_MS)
  refresh($)
}

export function finalizeAll($: EngineInterface) {
  for (const requestId of [...live.keys()]) finalize($, requestId, true)
}

// Keeps a final block blank until its pictures are ready or `ms` passed;
// then its text shows until they are.
export function waitBlank($: EngineInterface, requestId: string, textHash: string, ms: number) {
  if (pending.get(requestId)?.textHash === textHash) return
  pending.get(requestId)?.timer.cancel()
  const entry = { textHash, showText: false, timer: { cancel: () => {} } }
  entry.timer = clockAfter($, ms, () => {
    entry.showText = true
    refresh($)
  })
  pending.set(requestId, entry)
}

export function forget(requestId: string) {
  live.get(requestId)?.still.cancel()
  live.delete(requestId)
  pending.get(requestId)?.timer.cancel()
  pending.delete(requestId)
}
