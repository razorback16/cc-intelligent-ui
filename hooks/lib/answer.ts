// One Markdown text through the answer pipeline: its key, the compiled
// pages, and the states before they are ready (blank while it streams or
// compiles, then the engine's text). The AssistantMessage hook, the plan
// (its ExitPlanMode rows) and the Markdown files Claude sends all draw
// through it.
import type { EngineInterface } from 'claude-code'

import { BLANK_AFTER_LIVE_MS, BLANK_RESUMED_MS, DEFAULT_THEME, LIVE_STILL_MS, RESULTS_KEPT, SETTLE_MS } from './settings'
import { epochOpen, fauxBoldOf, finalized, keep, lastKey, lastText, live, pending, results, S, type Env, type Frame, type Job, type Result, type Room } from './state'
import { fontFit, hashOf, inlineOf, renderKey, sizing } from './draw'
import { needsRoom } from './markdown'
import { pictureColumns } from './frame'
import { pictureRowsFor } from './images'
import { designInMemory, designKey, loadDesign } from './designs'
import { resultOf, touchLater } from './typst'
import { enqueue, finalize, forget, waitBlank } from './stream'
import { extendEpoch } from './epoch'
import { clockAfter, fsRead } from './api'

// `pages`: draw these (with `bytes` over ssh); `blank`: draw an empty box;
// `text`: draw the engine's own row.
export type Drawing = { kind: 'pages'; result: Result; bytes?: string[] } | { kind: 'blank' } | { kind: 'text' }

export type PagesInput = {
  // Keys the text's place (its message, its row).
  id: string
  text: string
  // The terminal now (frameFor): the picture's columns, its cell, the rows
  // a drawing has room for.
  frame: Frame
  env: Env
  // The text may still grow (an answer); a plan is final when it is drawn,
  // so it never waits as live.
  canStream: boolean
  // The folder relative images start from (a Markdown file's); else the session's.
  base?: string
  // Its row is on screen (e.props.onScreen): true compiles first; false is
  // known off screen (its job does not hold an epoch's commit); undefined:
  // not known.
  onScreen?: boolean | undefined
}

const pt = (v: number) => Math.round(v * 100) / 100

// The keys whose folder was touched in this load (bounded). Not the same as
// touchLater's set: that one empties at each flush, this one stops a redraw
// from noting the key again after it.
const TOUCHED_KEPT = 4096
const touched = new Set<string>()

// Per id: its text's hash and whether it needs a room, so a redraw of the
// same text (a scroll) does not hash or scan it again. Bounded as `results`.
const texts = new Map<string, { text: string; textHash: string; hasRoom: boolean }>()
function textOf(id: string, text: string) {
  const was = texts.get(id)
  if (was && was.text === text) return was
  const now = { text, textHash: hashOf([text]), hasRoom: needsRoom(text) }
  keep(texts, id, now, RESULTS_KEPT)
  return now
}

// The room for a text's drawings, when it needs one: the room height now,
// and its design (kept on disk; when missing, the space now, factor 1). A
// text that is still live reads no file (it changes at each piece): the
// design in memory, else the space now, recorded only once a final compile
// of that text succeeds.
async function roomOf($: EngineInterface, o: { hasRoom: boolean; textHash: string; base?: string; env: Env; rows: number; widthPt: number; rowPt: number; isLive: boolean }): Promise<Room | undefined> {
  if (!o.hasRoom) return undefined
  const heightPt = pt(pictureRowsFor(o.rows, S.height) * o.rowPt)
  const key = designKey(o.textHash, o.base)
  const kept = o.isLive ? (designInMemory(key) ?? null) : await loadDesign($, o.env.designs, key).catch(() => null)
  const design = kept ?? { widthPt: pt(o.widthPt), heightPt }
  return { heightPt, design, designKey: key, isNew: !kept }
}

// A key compiled in an earlier load (S.onDisk): its pages.json read at once,
// with no queue and no blank. Null when it can not be read.
async function fromDisk($: EngineInterface, env: Env, key: string): Promise<Result | null> {
  if (!S.onDisk.has(key)) return null
  const dir = `${env.cache}/${key}`
  const text = await fsRead($, `${dir}/pages.json`).catch(() => null)
  const got = text ? resultOf(text) : null
  if (!got) {
    S.onDisk.delete(key)
    return null
  }
  touchLater($, dir)
  keep(results, key, got, RESULTS_KEPT)
  return got
}

export async function pagesOf($: EngineInterface, o: PagesInput): Promise<Drawing> {
  const { id, text, env, base, frame } = o
  // A row drawn in an open epoch: its rows still come (extendEpoch).
  if (epochOpen()) extendEpoch($)
  const { cell, rows } = frame
  const columns = pictureColumns(frame, env.inline)
  const { textHash, hasRoom } = textOf(id, text)
  const active = S.look ?? { name: DEFAULT_THEME, dir: `${env.root}/render/themes/${DEFAULT_THEME}`, stamp: '0' }
  const { columnPt } = fontFit(env.metrics, S.size)
  const { widthPt, rowPt } = sizing(columns, cell, columnPt)
  // Live (see below), as known before the design is read.
  const liveNow = () => {
    const seen = lastText.get(id)
    return o.canStream && (live.has(id) || (seen !== text && !finalized.has(id) && (S.stepsLive > 0 || seen !== undefined)))
  }
  const room = await roomOf($, { hasRoom, textHash, base, env, rows, widthPt, rowPt, isLive: liveNow() })
  const key = renderKey({
    textHash, columns, cell, size: S.size, mode: S.theme, termFont: env.termFont,
    columnPt, templateStamp: env.stamp, look: active, inline: env.inline, base, room, grid: S.grid, fauxBold: fauxBoldOf(env.metrics),
  })
  const seen = lastText.get(id)
  const changed = seen !== text
  lastText.set(id, text)
  const job: Job = {
    key, requestId: id, text, columns, cell, theme: S.theme, size: S.size, grid: S.grid, themeDir: active.dir, env, epoch: S.epoch,
    ...(base ? { base } : {}), ...(room ? { room } : {}), ...(o.onScreen !== undefined ? { onScreen: o.onScreen } : {}),
  }
  // The picture drawn last for the same text, at another key.
  const was = lastKey.get(id)
  const old = was && was.textHash === textHash && was.key !== key ? results.get(was.key) : undefined
  // An epoch is open: the row keeps its old picture (at its own box) until
  // the commit, so all rows swap in one redraw. The target compiles now
  // (or is read from disk); a result for it, even 'failed', waits.
  if (epochOpen() && old && old !== 'failed') {
    if (!results.has(key) && !(await fromDisk($, env, key))) {
      forget(id)
      enqueue($, job)
    }
    const drawing = await withBytes($, env, old)
    if (drawing.kind === 'pages') return drawing
  }
  const inMemory = results.get(key)
  const got = inMemory ?? (await fromDisk($, env, key))
  if (got === 'failed') {
    forget(id)
    return { kind: 'text' }
  }
  if (got) {
    // A key in use: its folder is touched once per load (the 2-day cleanup
    // goes by use); fromDisk and compile touch the folders they read.
    if (inMemory && !touched.has(key)) {
      if (touched.size >= TOUCHED_KEPT) touched.clear()
      touched.add(key)
      touchLater($, `${env.cache}/${key}`)
    }
    forget(id)
    // Its Job as it draws, for the probe of a copy: no text (the probe reads
    // doc.json), and its env as now (a font read later changes the env).
    keep(lastKey, id, { key, textHash, job: { ...job, text: '', env: { ...env } } }, RESULTS_KEPT)
    return withBytes($, env, got)
  }
  // Live: its text streams (inside a request we saw, or changing since we
  // last drew it). Drawn blank; final at the request's next block or end,
  // or once still for LIVE_STILL_MS (SETTLE_MS when no request was seen).
  const isLive = o.canStream && (live.has(id) || (changed && !finalized.has(id) && (S.stepsLive > 0 || seen !== undefined)))
  if (isLive) {
    const was = live.get(id)
    if (!was || changed) {
      was?.still.cancel()
      const still = clockAfter($, S.stepsLive > 0 ? LIVE_STILL_MS : SETTLE_MS, () => finalize($, id, false))
      live.set(id, { job, still })
    } else live.set(id, { job, still: was.still })
    pending.get(id)?.timer.cancel()
    pending.delete(id)
    return { kind: 'blank' }
  }
  // Final and not drawn yet: compile at once. Same text at another size:
  // the old picture (at its own box) until the new one is ready; else blank
  // for a moment, then the text.
  enqueue($, job)
  if (old && old !== 'failed') {
    const drawing = await withBytes($, env, old)
    if (drawing.kind === 'pages') return drawing
  }
  waitBlank($, id, textHash, finalized.has(id) ? BLANK_AFTER_LIVE_MS : BLANK_RESUMED_MS)
  return pending.get(id)?.showText ? { kind: 'text' } : { kind: 'blank' }
}

// The pages to draw: over ssh with their bytes (the text when a page can not go).
async function withBytes($: EngineInterface, env: Env, result: Result): Promise<Drawing> {
  if (!env.inline) return { kind: 'pages', result }
  const bytes = await inlineOf($, result)
  return bytes ? { kind: 'pages', result, bytes } : { kind: 'text' }
}
