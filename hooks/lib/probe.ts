// The pages a copy reads (copy.ts) and the words on them: each answer, plan
// and Markdown file Claude sent is noted as drawn (its pages at the box they
// are drawn at), and the probe (runProbe) makes a key folder's
// positions.json from its probe.json: at once when a copy needs it, else
// ahead, one at a time, only while nothing compiles, waits or is in an open
// epoch. A job enqueued or an epoch begun stops the probe ahead.
import type { EngineInterface } from 'claude-code'

import { PROBE_AHEAD, PROBE_IDLE_MS } from './settings'
import { clip, DRAWN_KEPT, drawnAnswers, epochOpen, keep, lastKey, positionsByDir, queue, results, running, S, type Result } from './state'
import { fitBox } from './terminal'
import { runProbe, type ProbeJob } from './typst'
import { traceDebug } from './log'
import type { DrawnPage, Positions } from './copy'

// Notes the pages of `id` as drawn now, each at fitBox(page, room), as
// drawPages draws it. A redraw with the same pages at the same boxes keeps
// its place, so `seq` is when it was first drawn so. A new one arms the
// probe ahead.
export function noteDrawn($: EngineInterface, id: string, result: Result, room: number) {
  const pages: DrawnPage[] = result.pages.map(p => ({ file: p.file, width: p.width, height: p.height, ...fitBox(p, room) }))
  const dir = result.pages[0]?.file.replace(/\/[^/]*$/, '') ?? ''
  const was = drawnAnswers.get(id)
  const same = (p: DrawnPage, i: number) => {
    const now = pages[i]
    return !!now && p.file === now.file && p.columns === now.columns && p.rows === now.rows
  }
  if (was && was.dir === dir && was.pages.length === pages.length && was.pages.every(same)) return
  keep(drawnAnswers, id, { id, seq: ++clip.seq, dir, pages }, DRAWN_KEPT)
  probeLater($)
}

// A memo hit (the same drawing as before): noted again only when it went
// past DRAWN_KEPT, from the result the row last drew (lastKey).
export function noteDrawnAgain($: EngineInterface, id: string, room: number) {
  if (drawnAnswers.has(id)) return
  const result = results.get(lastKey.get(id)?.key ?? '')
  if (result && result !== 'failed') noteDrawn($, id, result, room)
}

// ---- Positions ----------------------------------------------------------------

// The probes that run now by folder: a copy of the same folder waits for
// it (and runs its own when it was cancelled).
const inflight = new Map<string, Promise<Positions | null | 'cancelled'>>()
// The probe ahead: its timer, and the run with its cancel. Folders whose
// probe failed are not probed ahead again (bounded: cleared when full).
let idleTimer: { cancel: () => void } | null = null
let idle: { dir: string; cancel: () => void } | null = null
const failed = new Set<string>()

// A folder's positions: kept, positions.json, else the probe (probe.json).
async function load($: EngineInterface, dir: string, signal?: AbortSignal): Promise<Positions | null | 'cancelled'> {
  const kept = await $.fs.read(`${dir}/positions.json`).catch(() => null)
  try {
    const got = kept ? (JSON.parse(kept) as Positions) : null
    if (got && Array.isArray(got.pages) && Array.isArray(got.blocks)) return got
  } catch {}
  const job = await $.fs.read(`${dir}/probe.json`).catch(() => null)
  let probe: ProbeJob
  try {
    probe = JSON.parse(job ?? '') as ProbeJob
    if (!Array.isArray(probe.argv) || !(probe.ppi > 0)) return null
  } catch {
    return null
  }
  if (signal?.aborted) return 'cancelled'
  return runProbe($, dir, probe, signal)
}

async function positionsRun($: EngineInterface, dir: string, signal?: AbortSignal): Promise<Positions | null | 'cancelled'> {
  const known = positionsByDir.get(dir)
  if (known) return known
  const ahead = inflight.get(dir)
  if (ahead) {
    const got = await ahead
    return got === 'cancelled' && !signal?.aborted ? positionsRun($, dir, signal) : got
  }
  const run = load($, dir, signal)
  inflight.set(dir, run)
  const got = await run.catch(() => null)
  if (inflight.get(dir) === run) inflight.delete(dir)
  if (got && got !== 'cancelled') keep(positionsByDir, dir, got, DRAWN_KEPT)
  return got
}

// A folder's word positions for a copy, now; null when there are none.
export async function positionsFor($: EngineInterface, dir: string): Promise<Positions | null> {
  const got = await positionsRun($, dir)
  return got === 'cancelled' ? null : got
}

// ---- The probe ahead ------------------------------------------------------------

const isIdle = () => !S.resizing && !epochOpen() && !queue.length && !running.size

// Arms the probe ahead: PROBE_IDLE_MS after the last call (a drawing noted,
// the last job ended, an epoch committed, a burst ended).
export function probeLater($: EngineInterface) {
  idleTimer?.cancel()
  idleTimer = $.clock.after(PROBE_IDLE_MS, () => {
    idleTimer = null
    probeNext($)
  })
}

// Stops the probe ahead (a job enqueued, an epoch begun): its timer, and its
// run (killed; the folder is probed again later).
export function stopProbe() {
  idleTimer?.cancel()
  idleTimer = null
  idle?.cancel()
}

// One probe ahead, while idle: the newest drawing (of the PROBE_AHEAD
// newest) with no positions yet; when it ends, the next one.
function probeNext($: EngineInterface) {
  if (idle || !isIdle()) return
  const next = [...drawnAnswers.values()]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, PROBE_AHEAD)
    .find(d => d.dir && !positionsByDir.has(d.dir) && !failed.has(d.dir) && !inflight.has(d.dir))
  if (!next) return
  const controller = new AbortController()
  const entry = { dir: next.dir, cancel: () => controller.abort() }
  idle = entry
  void positionsRun($, next.dir, controller.signal)
    .catch(() => null)
    .then(got => {
      if (idle === entry) idle = null
      traceDebug($, `probe ahead ${next.dir}: ${got === 'cancelled' ? 'cancelled' : got ? 'done' : 'failed'}`)
      // Cancelled: again once idle (a job that ended meanwhile armed it while
      // this run held the slot).
      if (got === 'cancelled') {
        if (isIdle()) probeLater($)
        return
      }
      if (!got) {
        if (failed.size >= DRAWN_KEPT * 4) failed.clear()
        failed.add(next.dir)
      }
      probeNext($)
    })
}
