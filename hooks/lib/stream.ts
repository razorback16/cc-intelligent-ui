// Streaming and the compile queue: a block is blank while its text streams,
// final when its request moves on (or its text is still), then compiled, at
// most MAX_RUNNING at once.
import type { EngineInterface } from 'claude-code'

import { BLANK_AFTER_LIVE_MS, MAX_RUNNING } from './settings'
import { finalized, live, pending, queue, refresh, results, running, type Job } from './state'
import { hashOf } from './draw'
import { compile, logDebug } from './typst'

export function pump($: EngineInterface) {
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

export function enqueue($: EngineInterface, job: Job) {
  if (results.has(job.key) || running.has(job.key)) return
  // A newer text of the same message replaces its job still waiting.
  const stale = queue.findIndex(j => j.requestId === job.requestId || j.key === job.key)
  if (stale >= 0) queue.splice(stale, 1)
  queue.push(job)
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
  entry.timer = $.clock.after(ms, () => {
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
