// One Markdown text through the answer pipeline: its key, the compiled
// pages, and the states before they are ready (blank while it streams or
// compiles, then the engine's text). The AssistantMessage hook, the plan
// (its ExitPlanMode rows) and the Markdown files Claude sends all draw
// through it.
import type { EngineInterface } from 'claude-code'

import { BLANK_AFTER_LIVE_MS, BLANK_RESUMED_MS, DEFAULT_CELL, DEFAULT_THEME, LIVE_STILL_MS, SETTLE_MS } from './settings'
import { finalized, lastText, live, pending, results, S, shown, type Cell, type Env, type Job, type Result } from './state'
import { fontFit, hashOf, inlineOf, renderKey } from './draw'
import { enqueue, finalize, forget, waitBlank } from './stream'

// `pages`: draw these (with `bytes` over ssh); `blank`: draw an empty box;
// `text`: draw the engine's own row.
export type Drawing = { kind: 'pages'; result: Result; px: Cell; bytes?: string[] } | { kind: 'blank' } | { kind: 'text' }

// `id` keys the text's place (its message, its row), `columns` is
// the picture width. `canStream`: the text may still grow (an answer); a
// plan is final when it is drawn, so it never waits as live. `base`: the
// folder relative images start from (a Markdown file's); else the session's.
export async function pagesOf($: EngineInterface, o: { id: string; text: string; columns: number; env: Env; canStream: boolean; base?: string }): Promise<Drawing> {
  const { id, text, columns, env, base } = o
  const px = S.cell ?? DEFAULT_CELL
  const textHash = hashOf([text])
  const active = S.look ?? { name: DEFAULT_THEME, dir: `${env.root}/render/themes/${DEFAULT_THEME}`, stamp: '0' }
  const key = renderKey({
    textHash, columns, cell: px, size: S.size, mode: S.theme, termFont: env.termFont,
    columnPt: fontFit(env.metrics, S.size).columnPt, templateStamp: env.stamp, look: active, inline: env.inline, base,
  })
  const seen = lastText.get(id)
  const changed = seen !== text
  lastText.set(id, text)
  const got = results.get(key)
  if (got === 'failed') {
    forget(id)
    return { kind: 'text' }
  }
  if (got) {
    forget(id)
    shown.set(id, { textHash, result: got })
    if (!env.inline) return { kind: 'pages', result: got, px }
    const bytes = await inlineOf($, got)
    return bytes ? { kind: 'pages', result: got, px, bytes } : { kind: 'text' }
  }
  const job: Job = { key, requestId: id, text, columns, cell: px, theme: S.theme, size: S.size, themeDir: active.dir, env, ...(base ? { base } : {}) }
  // Live: its text streams (inside a request we saw, or changing since we
  // last drew it). Drawn blank; final at the request's next block or end,
  // or once still for LIVE_STILL_MS (SETTLE_MS when no request was seen).
  const isLive = o.canStream && (live.has(id) || (changed && !finalized.has(id) && (S.stepsLive > 0 || seen !== undefined)))
  if (isLive) {
    const was = live.get(id)
    if (!was || changed) {
      was?.still.cancel()
      const still = $.clock.after(S.stepsLive > 0 ? LIVE_STILL_MS : SETTLE_MS, () => finalize($, id, false))
      live.set(id, { job, still })
    } else live.set(id, { job, still: was.still })
    pending.get(id)?.timer.cancel()
    pending.delete(id)
    return { kind: 'blank' }
  }
  // Final and not drawn yet: compile at once. Same text at another width:
  // the old picture until the new one is ready; else blank for a moment,
  // then the text.
  enqueue($, job)
  const was = shown.get(id)
  if (was && was.textHash === textHash) {
    if (!env.inline) return { kind: 'pages', result: was.result, px }
    const bytes = await inlineOf($, was.result)
    if (bytes) return { kind: 'pages', result: was.result, px, bytes }
  }
  waitBlank($, id, textHash, finalized.has(id) ? BLANK_AFTER_LIVE_MS : BLANK_RESUMED_MS)
  return pending.get(id)?.showText ? { kind: 'text' } : { kind: 'blank' }
}
