import { expect, test } from 'claude-code/testing'

// This file's own copy of the modules: the epoch and the state it reads.
import { beginEpoch, extendEpoch, holdJobs, jobDone, releaseJobs } from '../hooks/lib/epoch'
import { COMMIT_MAX_MS, COMMIT_MIN_MS, DEFAULT_CELL } from '../hooks/lib/settings'
import { converting, epochOpen, queue, running, S, type Frame, type Job } from '../hooks/lib/state'

const frame = (columns: number, rows = 40): Frame => ({ columns, rows, cell: DEFAULT_CELL })

// A timer in memory: `advance` runs each wait that comes due, in order.
function fakeClock() {
  let now = 0
  let waits: Array<{ due: number; fn: () => void; live: boolean }> = []
  return {
    after: (ms: number, fn: () => void) => {
      const wait = { due: now + ms, fn, live: true }
      waits.push(wait)
      return { cancel: () => void (wait.live = false) }
    },
    advance: async (ms: number) => {
      const end = now + ms
      for (;;) {
        const next = waits.filter(w => w.live && w.due <= end).sort((a, b) => a.due - b.due)[0]
        if (!next) break
        now = next.due
        next.live = false
        next.fn()
      }
      now = end
      waits = waits.filter(w => w.live)
      await flush()
    },
  }
}
// Lets the redraws asked for (a promise each) arrive.
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

// A `$` with the clock in memory; each refresh ends as an invalidate here
// (the `done` write is refused for this `$`), counted in `redraws`.
const clock = fakeClock()
const seen = { redraws: 0 }
const $ = { clock: { after: clock.after }, ui: { invalidate: () => void seen.redraws++ } } as any
const redraws = async () => {
  await flush()
  return seen.redraws
}

// A fresh start: the old epoch's timers ran out, nothing open, waiting or
// running, the Frame on screen is the target.
async function fresh() {
  await clock.advance(COMMIT_MAX_MS * 2)
  S.shownEpoch = S.epoch
  S.frame = S.shown = frame(100)
  S.resizing = S.missed = false
  queue.length = 0
  running.clear()
  converting.clear()
  await flush()
  seen.redraws = 0
}

// A running entry's signal (never aborted here).
const SIGNAL = new AbortController().signal

const job = (key: string, o: { epoch?: number; onScreen?: boolean } = {}) =>
  ({ key, requestId: key, text: key, epoch: o.epoch ?? S.epoch, onScreen: o.onScreen }) as unknown as Job

test('a new epoch cancels the compiles that run, empties the queue, sets the target and redraws once', async () => {
  await fresh()
  const cancelled: string[] = []
  running.set('a', { job: job('a'), cancel: () => cancelled.push('a'), signal: SIGNAL })
  running.set('b', { job: job('b'), cancel: () => cancelled.push('b'), signal: SIGNAL })
  queue.push(job('c'), job('d'))
  const target = frame(80)
  beginEpoch($, target)
  expect(cancelled).toEqual(['a', 'b'])
  expect(queue.length).toBe(0)
  expect(S.frame).toEqual(target)
  // A copy: the caller's object is not the target.
  expect(S.frame).not.toBe(target)
  expect(epochOpen()).toBe(true)
  expect(S.shown).toEqual(frame(100))
  expect(await redraws()).toBe(1)
})

test('an epoch with no jobs commits COMMIT_MIN_MS after it began, not before', async () => {
  await fresh()
  beginEpoch($, frame(80))
  await clock.advance(COMMIT_MIN_MS - 1)
  expect(epochOpen()).toBe(true)
  expect(S.shown).toEqual(frame(100))
  await clock.advance(1)
  expect(epochOpen()).toBe(false)
  expect(S.shown).toEqual(frame(80))
  // One redraw at the begin, one at the commit.
  expect(await redraws()).toBe(2)
})

test('activity in the epoch (a row, a job) starts COMMIT_MIN_MS again; COMMIT_MAX_MS still counts from the begin', async () => {
  await fresh()
  beginEpoch($, frame(80))
  await clock.advance(COMMIT_MIN_MS - 10)
  extendEpoch($)
  await clock.advance(COMMIT_MIN_MS - 10)
  expect(epochOpen()).toBe(true)
  await clock.advance(10)
  expect(epochOpen()).toBe(false)
  // Once committed, nothing to extend: no timer, no redraw.
  extendEpoch($)
  await clock.advance(COMMIT_MIN_MS)
  expect(await redraws()).toBe(2)
  // Activity with no end: the epoch commits at COMMIT_MAX_MS.
  beginEpoch($, frame(70))
  for (let t = 0; t < COMMIT_MAX_MS; t += COMMIT_MIN_MS / 2) {
    expect(epochOpen()).toBe(true)
    extendEpoch($)
    await clock.advance(COMMIT_MIN_MS / 2)
  }
  expect(epochOpen()).toBe(false)
  expect(S.shown).toEqual(frame(70))
})

test('with no Frame given, an epoch keeps the target (a mode or a setting changed)', async () => {
  await fresh()
  S.frame = frame(90)
  beginEpoch($)
  expect(S.frame).toEqual(frame(90))
  await clock.advance(COMMIT_MIN_MS)
  expect(S.shown).toEqual(frame(90))
})

test('a job of the epoch on screen (or not known) holds the commit; its end commits, with one redraw for all', async () => {
  await fresh()
  beginEpoch($, frame(80))
  const a = job('a', { onScreen: true })
  const b = job('b')
  queue.push(a)
  running.set('b', { job: b, cancel: () => {}, signal: SIGNAL })
  await clock.advance(COMMIT_MIN_MS)
  expect(epochOpen()).toBe(true)
  // `a` starts: it holds the commit while it runs.
  queue.length = 0
  running.set('a', { job: a, cancel: () => {}, signal: SIGNAL })
  running.delete('b')
  jobDone($)
  expect(epochOpen()).toBe(true)
  running.delete('a')
  jobDone($)
  expect(epochOpen()).toBe(false)
  expect(S.shown).toEqual(frame(80))
  // The begin and the commit: the jobs that ended did not redraw.
  expect(await redraws()).toBe(2)
})

test('a job known off screen and a job of an old epoch do not hold the commit', async () => {
  await fresh()
  const old = S.epoch
  beginEpoch($, frame(80))
  queue.push(job('off', { onScreen: false }))
  running.set('old', { job: job('old', { epoch: old }), cancel: () => {}, signal: SIGNAL })
  await clock.advance(COMMIT_MIN_MS)
  expect(epochOpen()).toBe(false)
  expect(S.shown).toEqual(frame(80))
})

test('a JPEG or WebP convert holds the commit', async () => {
  await fresh()
  beginEpoch($, frame(80))
  converting.set('x', Promise.resolve(null))
  await clock.advance(COMMIT_MIN_MS)
  expect(epochOpen()).toBe(true)
  converting.delete('x')
  jobDone($)
  expect(epochOpen()).toBe(false)
})

test('at COMMIT_MAX_MS the epoch commits with its jobs still running', async () => {
  await fresh()
  beginEpoch($, frame(80))
  running.set('slow', { job: job('slow', { onScreen: true }), cancel: () => {}, signal: SIGNAL })
  await clock.advance(COMMIT_MAX_MS - 1)
  expect(epochOpen()).toBe(true)
  await clock.advance(1)
  expect(epochOpen()).toBe(false)
  expect(S.shown).toEqual(frame(80))
})

test('a new epoch has new timers: the old one\'s do not commit it early', async () => {
  await fresh()
  beginEpoch($, frame(80))
  await clock.advance(COMMIT_MIN_MS / 2)
  beginEpoch($, frame(70))
  await clock.advance(COMMIT_MIN_MS / 2)
  expect(epochOpen()).toBe(true)
  await clock.advance(COMMIT_MIN_MS / 2)
  expect(epochOpen()).toBe(false)
  expect(S.shown).toEqual(frame(70))
})

test('a burst holds the commit; a commit that came due during it happens at its release', async () => {
  await fresh()
  beginEpoch($, frame(80))
  holdJobs()
  await clock.advance(COMMIT_MIN_MS)
  expect(epochOpen()).toBe(true)
  releaseJobs($)
  expect(epochOpen()).toBe(false)
  expect(S.shown).toEqual(frame(80))
})

test('the COMMIT_MAX_MS commit that came due during a burst happens at its release', async () => {
  await fresh()
  beginEpoch($, frame(80))
  running.set('slow', { job: job('slow', { onScreen: true }), cancel: () => {}, signal: SIGNAL })
  await clock.advance(COMMIT_MIN_MS)
  holdJobs()
  await clock.advance(COMMIT_MAX_MS)
  expect(epochOpen()).toBe(true)
  releaseJobs($)
  expect(epochOpen()).toBe(false)
})

test('a burst that begins a new epoch drops the old one\'s flags', async () => {
  await fresh()
  beginEpoch($, frame(80))
  holdJobs()
  await clock.advance(COMMIT_MIN_MS)
  // The quiet found a new Frame.
  beginEpoch($, frame(70))
  expect(S.resizing).toBe(false)
  expect(epochOpen()).toBe(true)
  await clock.advance(COMMIT_MIN_MS)
  expect(S.shown).toEqual(frame(70))
})

test('a job that ends with no epoch open redraws; during a burst it redraws once at the release', async () => {
  await fresh()
  jobDone($)
  expect(await redraws()).toBe(1)
  holdJobs()
  jobDone($)
  jobDone($)
  expect(S.missed).toBe(true)
  expect(await redraws()).toBe(1)
  releaseJobs($)
  expect(S.missed).toBe(false)
  expect(await redraws()).toBe(2)
  // A burst with no job that ended: no redraw.
  holdJobs()
  releaseJobs($)
  expect(await redraws()).toBe(2)
})

test('a cancel that throws does not stop the new epoch: the others are cancelled, the queue emptied', async () => {
  await fresh()
  const cancelled: string[] = []
  running.set('a', { job: job('a'), cancel: () => void cancelled.push('a'), signal: SIGNAL })
  running.set('bad', { job: job('bad'), cancel: () => { throw new Error('gone') }, signal: SIGNAL })
  running.set('c', { job: job('c'), cancel: () => void cancelled.push('c'), signal: SIGNAL })
  queue.push(job('d'))
  beginEpoch($, frame(80))
  expect(cancelled).toEqual(['a', 'c'])
  expect(queue.length).toBe(0)
  expect(epochOpen()).toBe(true)
})

test('a commit shows the target with its height setting and epoch; before it the old ones stay', async () => {
  await fresh()
  S.height = 'half'
  S.shownHeight = 'half'
  const before = S.shownEpoch
  S.height = 24
  beginEpoch($, frame(80))
  expect(S.shownHeight).toBe('half')
  expect(S.shownEpoch).toBe(before)
  await clock.advance(COMMIT_MIN_MS)
  expect(S.shownHeight).toBe(24)
  expect(S.shownEpoch).toBe(S.epoch)
  expect(S.epoch).toBe(before + 1)
})

test('a new epoch forgets a job that ended during a burst: no redraw at the release but the commit\'s', async () => {
  await fresh()
  holdJobs()
  jobDone($)
  expect(S.missed).toBe(true)
  beginEpoch($, frame(80))
  expect(S.missed).toBe(false)
  expect(await redraws()).toBe(1)
  await clock.advance(COMMIT_MIN_MS)
  expect(await redraws()).toBe(2)
})

test('a job that ends during a burst in an open epoch does not redraw at the release; the commit does', async () => {
  await fresh()
  beginEpoch($, frame(80))
  holdJobs()
  jobDone($)
  expect(S.missed).toBe(true)
  releaseJobs($)
  expect(S.missed).toBe(false)
  // The begin only: the epoch is not ready yet, and the job's end made no redraw.
  expect(epochOpen()).toBe(true)
  expect(await redraws()).toBe(1)
  await clock.advance(COMMIT_MIN_MS)
  expect(await redraws()).toBe(2)
})

test('a job that ends in an open epoch before it is ready only waits: no redraw, no early commit', async () => {
  await fresh()
  beginEpoch($, frame(80))
  jobDone($)
  expect(epochOpen()).toBe(true)
  expect(await redraws()).toBe(1)
})

test('with no target at all, an epoch begins and commits with the target still none', async () => {
  await fresh()
  S.frame = null
  S.shown = null
  beginEpoch($)
  expect(S.frame).toBe(null)
  await clock.advance(COMMIT_MIN_MS)
  expect(epochOpen()).toBe(false)
  expect(S.shown).toBe(null)
})
