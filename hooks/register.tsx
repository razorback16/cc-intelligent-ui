// Intelligent UI: draws Claude's answers (AssistantMessage blocks) as pictures
// of rendered Markdown, made by Typst from the template in ../render/md.typ.
// The stored message never changes; only its drawing does.
//
// Flow: the render hook makes a key from the text, the width, the cell size,
// the theme and the template. A known key draws its PNGs. A block whose text
// is still streaming ("live") draws nothing; it is final when its model
// request (`turn.step`) moves on to another block or ends, or, with no step
// seen, when its text has been still for SETTLE_MS. A final block's key is
// compiled at once (at most MAX_RUNNING at once), and the `done` atom goes up
// so every reader draws again and finds the PNGs.
//
// The work is in ./lib, one topic per module: settings, state (the shared
// mutable state `S`), markdown, terminal, terminals, mode, themes, command,
// setup, host, typst, draw, stream, answer (one text through the pipeline),
// env, images, pictures, plan (the plan approval flow), copy (the text under
// a mouse copy of the pictures), probe (the drawn pages, and the words of a
// page a copy reads) and updates (the daily check for a new version). This
// file joins them to the hooks, and gives the tests the names they import.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderViewport } from 'claude-code'

import {
  DEFAULT_THEME, gridText, heightText, IMAGE_MAX_COLUMNS, MARGIN_TOP, MAX_HEIGHT, MAX_SIZE, MAX_WIDTH, MIN_HEIGHT, MIN_SIZE, MIN_WIDTH, RESULTS_KEPT, TYPST_PROMPT,
  typstHintOf, widthText,
} from './lib/settings'
import { clip, drawnAnswers, editedPlans, keep, queue, refresh, running, S, subagentPlans, writesLive, type Env } from './lib/state'
import { beginEpoch } from './lib/epoch'
import { escapeControls, luminanceOf, modeLine, modeOfLuminance, parseOsc11, settingOf } from './lib/mode'
import { applyTheme, themeListing, userThemesOf } from './lib/themes'
import { commandSuggestions, parseCommand, registerCommand } from './lib/command'
import { runSetup } from './lib/setup'
import { pollHost, PROBE_RUNS, probeOsc11, showMode, USE_OSC11, watchHost } from './lib/host'
import { measureFonts } from './lib/typst'
import { drawPages, linksFor, type ShownLink } from './lib/draw'
import { finalizeAll } from './lib/stream'
import { noteDrawn, noteDrawnAgain, noteOnScreen, wordsOf } from './lib/probe'
import { codePointsOf, decodeSelection, hasPlaceholders, joinSegments, pageTopsOf, pickPages, textOfRun, type Pick, type Segment } from './lib/copy'
import { pagesOf, type Drawing } from './lib/answer'
import { autoCopyText, clipboardNow, clipWatchArgs, clipWayReady } from './lib/clipboard'
import { setUp } from './lib/env'
import { frameFor, noteView, stopWatch, watchFrame, watchState } from './lib/frame'
import { roomColumns } from './lib/terminal'
import { onScreenOf, pastedImagePath, pastedNumbers, sentFiles } from './lib/images'
import { pasteDir, rowsAfter, sentOf, shownOf, underRow, type Shown, type Under } from './lib/pictures'
import { checkUpdates, loadUpdates, updateLine, updateNotice, type UpdateState } from './lib/updates'
import { clockNow, fsWrite, sessionSurfaces, storeSet, uiCopy, uiResolve, uiSelection, uiToast } from './lib/api'
import {
  currentPlan, decidePlan, decisionOf, drawAskLine, drawPlanResult, drawPlanUse, isPlanQuestion, planFileOf, planInputOf, planOf,
  planShownOf, scheduleClear, type PlanVerdict,
} from './lib/plan'

// The names this module exported before the split (the tests import them).
export {
  BASE_THEME, DEFAULT_CELL, DEFAULT_HEIGHT, DEFAULT_SIZE, DEFAULT_THEME, DEFAULT_WIDTH, gridText, heightText, IMAGE_MAX_COLUMNS, MAX_HEIGHT, MAX_SIZE, MAX_WIDTH,
  MIN_HEIGHT, MIN_SIZE, MIN_WIDTH, PICTURE_MAX_ROWS, PICTURE_MIN_ROWS, PICTURE_ROOM_ROWS, SEGMENT_ROWS, TYPST_PROMPT, widthText, type Height, type Width,
  COMMIT_MAX_MS, COMMIT_MIN_MS, DESIGNS_KEPT_DAYS, RESIZE_QUIET_MS, RESULTS_KEPT, TOUCH_FLUSH_MS,
} from './lib/settings'
export { DEFAULT_METRICS, keep, type Cell, type Design, type FontMetrics, type Frame, type Look, type Metrics, type Room } from './lib/state'
export {
  composeFrame, followWatcher, frameChange, frameFor, frameOfLine, lineSplitter, noteTty, pictureColumns, quietTimer, shownFor, watchLineOf, type View,
  type WatchLine,
} from './lib/frame'
export { designKey, designPath, designText, loadDesign, parseDesign, recordDesign } from './lib/designs'
export {
  blocksOf, firstLine, imagePathOf, isTypstInfo, localImages, needsRoom, plainOf, rowsOfBlock, splitInTwo, splitSegments, type Block,
} from './lib/markdown'
export * from './lib/terminal'
export * from './lib/mode'
export * from './lib/terminals'
export {
  chooseTheme, isSyntaxPath, isThemeName, pickThemes, themeEntry, themeFiles, themeListing,
  type ThemeInfo, type ThemeProblem, type ThemeSyntax,
} from './lib/themes'
export { commandSuggestions, parseCommand, type Command, type Suggestion } from './lib/command'
export { hasSetup, SETUP_END, SETUP_NOT_MAC, SETUP_START, setupBlock, shellRcOf, withoutSetup, withSetup, type ShellRc } from './lib/setup'
export { OSC11_PL, perlFor, WATCH_PL } from './lib/host'
export {
  convertCall, isSafePage, measureCall, noNetworkEnv, pageRowsOf, parseOd, pngSize, probeCall, resultOf, roomInputs, shouldRetrySafe, typstCall, typstInputs,
} from './lib/typst'
export {
  alignFirstLine, fileHref, firstLineOf, fontFit, hashOf, renderKey, resolveLinks, scaledBulletRow, sizing, type FirstLine, type ShownLink,
} from './lib/draw'
export { nextJob } from './lib/stream'
export * from './lib/images'
export * from './lib/copy'
export { autoCopyText, CLIP_TOOLS, clipToolsOf, clipWayOf, FIND_SH, GTK_READ_PY, GTK_WATCH_PY, WL_WATCH_SH, X11_WATCH_SH, type ClipTool, type ClipWay } from './lib/clipboard'
export {
  agoText, checkedOf, compareVersions, isDue, isNewer, parseVersion, shouldTell, toldOf, UPDATE_EVERY_MS, UPDATE_FETCH_MS, UPDATE_STEPS, UPDATE_TOAST_MS,
  UPDATE_URL, updateLine, updateNotice, updateToast, versionOf,
} from './lib/updates'
export {
  choiceOf, decisionOf, editorArgv, feedbackOf, guiEditorOf, LINUX_EDITORS, isPlanQuestion, normalPath, PLAN_ASK_LINE, PLAN_AUTO, PLAN_CLEAR, PLAN_DRAWING, PLAN_EDIT,
  PLAN_FEEDBACK, PLAN_HEADER, PLAN_IMPLEMENT, PLAN_MANUAL, PLAN_QUESTION, PLAN_QUESTION_EDITED, PLAN_REJECTED, planFileOf, planInputOf,
  planOf, planOptions, planShownOf, shortPath, verdictOf, type PlanChoice, type PlanVerdict,
} from './lib/plan'

// The atoms the hooks read and write (a copy of each in this file: see state.ts).
const isOn = atom({ plugin: 'cc-intelligent-ui', key: 'isOn' } as const, true)
const done = atom({ plugin: 'cc-intelligent-ui', key: 'done' } as const, 0)

// ---- Pictures under rows ----------------------------------------------------

// The env to draw pictures with: Intelligent UI on, in a terminal that draws;
// null otherwise (no Typst needed), with the `done` value read. Here and not
// in pictures.tsx, as it reads the atoms. The sizes come from the Frame
// (frameFor, shownFor); the viewport is noted for it (a change is settled
// with the tty's).
async function pictureEnv($: EngineInterface, e: { viewport?: RenderViewport }): Promise<{ env: Env; done: number } | null> {
  if (!(await read($, isOn))) return null
  if (e.viewport) noteView($, e.viewport)
  // Read so the end of setUp, a compile and a commit draw this row again.
  const now = await read($, done)
  if (!S.env) {
    void setUp($).catch(() => undefined)
    return null
  }
  return S.env.canDraw ? { env: S.env, done: now } : null
}

// The env to draw Markdown pictures with (an answer, a plan): as
// pictureEnv, and Typst found.
async function answerEnv($: EngineInterface, e: { viewport?: RenderViewport }): Promise<{ env: Env; done: number } | null> {
  const ready = await pictureEnv($, e)
  return ready?.env.typst ? ready : null
}

// ---- Rows drawn before ----------------------------------------------------------

// What a drawn row depends on besides its own inputs: `done` (every result
// stored, setting, theme, mode and commit redraws through it), the epochs
// (the target and shown Frames change only with them, but at setFrame and
// at the first viewport noted, both before a row is kept), the env, and the
// viewport's columns (the room: the engine draws every row again once a
// width change settles; a scroll keeps them).
const stampOf = (ready: { env: Env; done: number }, view?: RenderViewport) =>
  `${ready.done}|${S.epoch}|${S.shownEpoch}|${ready.env.inline ? 1 : 0}|${view?.columns ?? ''}|${roomColumns(view)}`

// Each row's last drawing, by its requestId: a redraw with the same inputs
// and the same stamp (a scroll step, a new onScreen) returns the same thing,
// with no hash, no file and no process. Only drawn pictures are kept (a
// blank or a text row runs the pipeline again: its timers move it on).
// `text` the row's text (a string kept as given, so the compare is mostly
// one pointer), `extra` its other inputs.
type Memo<T> = { text: string; extra: string; stamp: string; onScreen: boolean | undefined; value: T }
// An answer's tree is kept with its link rows' count (the copy counts them
// under its pages), a plan's drawing with its link rows.
const answers = new Map<string, Memo<{ tree: RenderElement; links: number }>>()
const plans = new Map<string, Memo<{ drawing: Drawing; links: ShownLink[] }>>()
const unders = new Map<string, Memo<Under[]>>()
const pasted = new Map<string, Memo<Shown[]>>()

// The kept value when the inputs and the stamp are the same. A new onScreen
// is given to the row's jobs that wait or run (their order and whether they
// hold the commit), with nothing drawn again. `isJob`: which jobs are the
// row's, by their requestId (by default the row's id).
type MemoKey = { text: string; extra: string; stamp: string; onScreen: boolean | undefined }
function memoOf<T>(memo: Map<string, Memo<T>>, id: string, k: MemoKey, isJob = (requestId: string) => requestId === id): T | undefined {
  const kept = memo.get(id)
  if (!kept || kept.text !== k.text || kept.extra !== k.extra || kept.stamp !== k.stamp) return undefined
  const { onScreen } = k
  if (kept.onScreen !== onScreen) {
    kept.onScreen = onScreen
    for (const job of queue) if (isJob(job.requestId)) job.onScreen = onScreen
    for (const { job } of running.values()) if (isJob(job.requestId)) job.onScreen = onScreen
  }
  return kept.value
}

function memoSet<T>(memo: Map<string, Memo<T>>, id: string, k: MemoKey, value: T) {
  keep(memo, id, { ...k, value }, RESULTS_KEPT)
}

// A plan's drawing (both its rows: ToolUse and ToolResult) and the link
// rows under its pages, kept while it is drawn pages (memoOf).
async function planDrawing(
  $: EngineInterface, e: { viewport?: RenderViewport; props: { onScreen?: unknown } }, toolUseId: string, plan: string, ready: { env: Env; done: number },
): Promise<{ drawing: Drawing; links: ShownLink[] }> {
  const id = `plan:${toolUseId}`
  const onScreen = onScreenOf(e.props.onScreen)
  const k = { text: plan, extra: '', stamp: stampOf(ready, e.viewport), onScreen }
  const kept = memoOf(plans, id, k)
  if (kept) return kept
  const drawing = await pagesOf($, { id, text: plan, frame: frameFor(e.viewport), env: ready.env, canStream: false, onScreen })
  if (drawing.kind !== 'pages') {
    plans.delete(id)
    return { drawing, links: [] }
  }
  const drawn = { drawing, links: await linksFor($, plan, ready.env.cwd) }
  memoSet(plans, id, k, drawn)
  return drawn
}

// Intelligent UI's own plan question: only on the main loop of a session drawn
// in a terminal, with Intelligent UI on, Typst found and a terminal that draws
// (the plan's pictures need all of them). Null otherwise: the engine's
// dialog asks, as with no mod.
async function planEnv($: EngineInterface): Promise<Env | null> {
  if (!(await read($, isOn))) return null
  const surfaces = await sessionSurfaces($).catch(() => [] as readonly string[])
  if (!surfaces.includes('terminal')) return null
  const ready = S.env ?? (await setUp($).catch(() => null))
  return ready?.typst && ready.canDraw ? ready : null
}

// ---- Copy -----------------------------------------------------------------
// A mouse copy over a picture puts kitty placeholder cells on the clipboard,
// and no hook sees that copy. The watcher (lib/frame.ts) prints a line when
// the clipboard changes (macOS: its change count; Linux: a notifier's
// line, lib/clipboard.ts); at a change the clipboard is read once (pbpaste,
// wl-paste, xclip, xsel or GTK) and, when it holds placeholders, written again with
// the words under them (see lib/copy.ts; the drawn pages and the words of
// a page are in lib/probe.ts). No timer reads the clipboard or the
// selection.

// Notes a drawing for a copy (noteDrawn, noteDrawnAgain) and turns on the
// watcher's clipboard part; a failure never stops the row from drawing.
function noteCopy($: EngineInterface, note: () => void) {
  try {
    note()
    watchClipboard($)
  } catch {}
}

type CopyRead = { text: string; segments: Segment[]; picks: Pick[]; runs: number; resolved: number }

// The text for a clipboard (or selection) text with placeholders. A page
// not probed yet is probed now, with no toast: only the copy has one.
async function readCopy($: EngineInterface, raw: string, requestId?: string): Promise<CopyRead> {
  const segments = decodeSelection(raw)
  const picks = pickPages(segments, [...drawnAnswers.values()], requestId)
  const texts: (string | null)[] = []
  let resolved = 0
  for (const [i, seg] of segments.entries()) {
    const pick = picks[i]
    const d = pick ? drawnAnswers.get(pick.id) : undefined
    const page = pick && d ? d.pages[pick.page] : undefined
    if (seg.kind !== 'image' || !pick || !d || !page) {
      texts.push(null)
      continue
    }
    const words = await wordsOf($, d, pick.page)
    const text = words ? textOfRun(seg.lines, words.items, words.blocks, page) : ''
    if (text) resolved++
    texts.push(text || null)
  }
  const runs = segments.filter(seg => seg.kind === 'image').length
  const read = { text: joinSegments(segments, texts), segments, picks, runs, resolved }
  clip.last = { requestId: requestId ?? null, ...read, drawn: [...drawnAnswers.values()].map(({ job: _, ...d }) => d) }
  return read
}

// Writes the text read for `raw` (placeholders) to the clipboard, once:
// our own write is never read back as new. Just before the write the
// clipboard is read again: a newer copy (made while the picture was read,
// or one the watcher has not seen yet) is not written over; it is read
// next (readClipboard), even when it is the same text again.
async function copyRead($: EngineInterface, raw: string, requestId?: string) {
  clip.raw = raw
  clip.rawRow = requestId
  const read = await readCopy($, raw, requestId)
  if (!read.resolved) {
    // Not read again from the clipboard (one toast).
    clip.seen = raw
    uiToast($, 'Intelligent UI: could not read the selected picture (/iui dump says why)')
    return
  }
  if ((await clipboardNow($)) !== raw) {
    clip.seen = ''
    clip.again = true
    return
  }
  clip.wrote = read.text
  clip.seen = read.text
  await uiCopy($, { text: read.text })
  uiToast($, `Intelligent UI: copied ${read.text.length} chars of text`)
}

// A selection and a clipboard text are the same copy (a copy can end in
// line breaks that the selection does not have, or the other way).
const sameCopy = (a: string, b: string) => a.replace(/\r\n/g, '\n').replace(/\s+$/, '') === b.replace(/\r\n/g, '\n').replace(/\s+$/, '')

// A watcher line `clip <count>` (null: `clip none`, no PerlObjCBridge or
// the Linux notifier ended: the automatic copy stays off). The first count
// of a child (at its start) is only noted: the clipboard then is no new copy (after a hot reload, it can
// be an old copy of picture cells).
function clipChanged($: EngineInterface, count: number | null, first: boolean) {
  if (count === null) {
    clip.none = true
    return
  }
  clip.count = count
  if (!first) void readClipboard($).catch(() => undefined)
}

// The clipboard changed: one read (clipboardNow). Placeholders that are not our
// own write are read and written back as text. A clipboard with no
// placeholders is never touched. When this session has a selection
// (fullscreen), the clipboard is rewritten only when it is that selection:
// another session's copy is that session's to read. A change while a read
// runs (a probe can take a second) reads once more after it.
async function readClipboard($: EngineInterface) {
  if (clip.busy) {
    clip.again = true
    return
  }
  clip.busy = true
  try {
    do {
      clip.again = false
      const text = await clipboardNow($)
      if (text === null || text === clip.seen) continue
      clip.seen = text
      if (text === clip.wrote || !hasPlaceholders(text)) continue
      const selected = await uiSelection($).catch(() => undefined)
      if (selected && !sameCopy(selected.text, text)) continue
      await copyRead($, text, selected?.requestId)
    } while (clip.again)
  } finally {
    clip.busy = false
  }
}

// The watcher's clipboard part: on macOS, or on Linux with a tool that sees
// the changes (lib/clipboard.ts), on this computer (over ssh the clipboard
// read is the remote one's), only while Intelligent UI is on (its callers
// draw, or read the atom) and a picture is drawn. It is a new child (the
// flag is an argument): its first count is only noted. A child that runs
// is kept; one that ended is started again (watchFrame caps it). With no
// PerlObjCBridge (or a notifier that ended) the child goes on as it is
// (size only).
function watchClipboard($: EngineInterface) {
  if (!S.env || S.isRemote || !drawnAnswers.size || clip.none || clipWatchArgs(S.env.isMac) === null) return
  watchFrame($, (count, first) => clipChanged($, count, first))
}

// Intelligent UI off, or a /clear (the process goes on): the watcher again
// with no clipboard part (no reads).
function stopClipboard($: EngineInterface) {
  if (watchState()?.clip && !clip.none) watchFrame($, null)
}

// The automatic copy now, for /iui details and dump.
function autoCopyOf(isOn: boolean): string {
  const now = watchState()
  return autoCopyText({
    isMac: !!S.env?.isMac, hostOs: S.hostOs, isRemote: S.isRemote, isOn, none: clip.none, drawn: drawnAnswers.size > 0,
    running: !!now?.clip && !now.ended, way: S.clipWay,
  })
}

// The update check's state now, for /iui, /iui details and /iui updates.
async function updateState($: EngineInterface): Promise<UpdateState> {
  await loadUpdates($)
  const now = await clockNow($).catch(() => Date.now())
  return { on: S.updates, off: S.updatesOff, own: S.ownVersion, checked: S.updateChecked, now }
}

// /iui grab: the last mouse selection, read and copied.
async function grab($: EngineInterface): Promise<string> {
  const selected = await uiSelection($).catch(() => undefined)
  if (!selected) return 'Intelligent UI: no mouse selection (it needs fullscreen mode; select over a picture first).'
  if (!hasPlaceholders(selected.text)) return `Intelligent UI: the selection has no picture cells; it is ${selected.text.length} chars of text already.`
  clip.raw = selected.text
  clip.rawRow = selected.requestId
  const read = await readCopy($, selected.text, selected.requestId)
  if (!read.resolved) return `Intelligent UI: found ${read.runs} picture run(s) but could not read them (see /iui dump).`
  clip.wrote = read.text
  clip.seen = read.text
  const copied = await uiCopy($, { text: read.text })
  return copied.isCopied
    ? `Intelligent UI: copied ${read.text.length} chars (${read.resolved} of ${read.runs} picture runs read${selected.requestId ? `, row ${selected.requestId}` : ''}).`
    : `Intelligent UI: the copy failed: ${copied.reason}.`
}

// For dump: the rows of a pick's message on screen and its page's top row
// there (pageTopsOf), which chose the page.
function screenText(pick: { id: string; page: number }): string {
  const d = drawnAnswers.get(pick.id)
  if (!d || d.onScreen === undefined) return ' (rows on screen not known)'
  if (d.onScreen === null) return ' (off screen)'
  const tops = pageTopsOf(d)
  const top = tops ? `page top ${tops[pick.page]}` : 'page tops not known'
  return ` (rows ${d.onScreen.first}-${d.onScreen.last} of ${d.onScreen.of} on screen, ${top})`
}

// /iui dump: the last placeholder text seen, as code points, how it was
// read, and the same in full in <cache>/copy-debug.json. `on`: Intelligent
// UI is on.
async function dump($: EngineInterface, on: boolean): Promise<string> {
  await clipWayReady()
  const auto = autoCopyOf(on)
  if (!clip.raw) return `Intelligent UI: no clipboard text with picture cells seen yet (auto copy ${auto}; ${drawnAnswers.size} pictures drawn).`
  const read = await readCopy($, clip.raw, clip.rawRow)
  const runs = read.segments
    .map((seg, i) => {
      if (seg.kind === 'text') return `text: ${JSON.stringify(seg.text.slice(0, 60))}`
      const rows = seg.lines.map(l => `${l.row}:${l.colStart}-${l.colEnd}`).join(' ')
      const pick = read.picks[i]
      return `run rows ${rows} -> ${pick ? `answer ${pick.id} page ${pick.page}${screenText(pick)}` : 'no page fits'}`
    })
    .join('\n')
  const cache = S.env?.cache ?? ''
  if (cache) {
    const full = { raw: clip.raw, codePoints: codePointsOf(clip.raw, 100000), ...(clip.last as object) }
    await fsWrite($, `${cache}/copy-debug.json`, JSON.stringify(full, null, 1)).catch(() => undefined)
  }
  return [
    `Intelligent UI: last clipboard with picture cells (${Array.from(clip.raw).length} code points; auto copy ${auto}):`,
    codePointsOf(clip.raw, 40),
    runs,
    `Read as ${read.text.length} chars: ${JSON.stringify(read.text.slice(0, 200))}`,
    cache ? `Full dump: ${cache}/copy-debug.json` : '',
  ].filter(Boolean).join('\n')
}

// ---- Hooks ----------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await registerCommand($)
    void setUp($).catch(() => undefined)
    return next(e)
  })

  // A /clear or a resume: the process goes on, with no clipboard reads until
  // the next picture. Any other end (/exit): the watcher stops, and no new
  // child starts.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') stopClipboard($)
    else stopWatch()
    return next(e)
  }).catch(($, e, next) => next(e))

  // A copy with placeholders (a copy of picture cells, when the engine sends
  // one through `$.ui.copy`): the words under them instead. Our own copies
  // hold no placeholders and pass on as they are.
  on('ui.copy', async ($, e, next) => {
    if (!hasPlaceholders(e.text) || !drawnAnswers.size) return next(e)
    const selected = await uiSelection($).catch(() => undefined)
    clip.raw = e.text
    clip.rawRow = selected?.text === e.text ? selected.requestId : undefined
    const read = await readCopy($, e.text, clip.rawRow)
    if (!read.resolved) return next(e)
    // The clipboard change of this write is not read again.
    clip.wrote = read.text
    clip.seen = read.text
    return next({ ...e, text: read.text })
  }).catch(($, e, next) => next(e))

  // Typeahead for /iui arguments; the theme list is the last scan's.
  on('prompt.autocomplete', async ($, e, next) => {
    const got = await next(e)
    if (!/^\s*\/iui\s/.test(e.text)) return got
    if (!S.themeChoices.length) await setUp($).catch(() => null)
    await loadUpdates($)
    const mine = commandSuggestions(e.text, e.token, e.start, {
      themes: S.themeChoices, active: S.look?.name ?? DEFAULT_THEME, size: S.size, width: S.width, height: S.height, grid: S.grid, updates: S.updates,
    })
    return mine.length ? { suggestions: [...got.suggestions, ...mine] } : got
  })

  on('command.run', { command: 'iui' }, async ($, e) => {
    const asked = parseCommand(e.args)
    if (asked.kind === 'grab') return { text: await grab($) }
    if (asked.kind === 'dump') return { text: await dump($, await read($, isOn)) }
    if (asked.kind === 'on' || asked.kind === 'off') {
      await update($, isOn, () => asked.kind === 'on')
      // On: the clipboard part starts with the next picture drawn.
      if (asked.kind === 'off') stopClipboard($)
      await storeSet($, 'enabled', asked.kind === 'on')
      return { text: `Intelligent UI is ${asked.kind}.` }
    }
    if (asked.kind === 'size') {
      // The epoch begins with the setting, so no row draws it with no epoch
      // open (the store write waits for the host).
      S.size = asked.percent
      beginEpoch($)
      await storeSet($, 'size', S.size)
      return { text: `Intelligent UI draws text at ${S.size}% of the terminal's text size (100% matches it).` }
    }
    if (asked.kind === 'width') {
      if (asked.width === undefined) await setUp($).catch(() => null)
      else {
        S.width = asked.width
        beginEpoch($)
        await storeSet($, 'width', S.width)
      }
      const most = typeof S.width === 'number' && S.width > IMAGE_MAX_COLUMNS ? ` (a picture is ${IMAGE_MAX_COLUMNS} columns at most)` : ''
      const head = asked.width === undefined ? 'The most columns a picture takes' : 'Intelligent UI pictures now take at most'
      return { text: `${head}: ${widthText(S.width)}${most}. Use /iui width <${MIN_WIDTH}-${MAX_WIDTH}> for a cap, or /iui width full (the default) for no cap.` }
    }
    if (asked.kind === 'height') {
      if (asked.height === undefined) await setUp($).catch(() => null)
      else {
        S.height = asked.height
        beginEpoch($)
        await storeSet($, 'height', S.height)
      }
      const head = asked.height === undefined ? 'The most rows an image or a Typst drawing takes' : 'Intelligent UI images and Typst drawings now take at most'
      return { text: `${head}: ${heightText(S.height)}. This applies to images (sent or pasted) and to Typst drawings in answers. Use /iui height half (the default), /iui height full, or /iui height <${MIN_HEIGHT}-${MAX_HEIGHT}> (never more than full).` }
    }
    if (asked.kind === 'grid') {
      if (asked.grid === undefined) await setUp($).catch(() => null)
      else {
        S.grid = asked.grid
        beginEpoch($)
        await storeSet($, 'grid', S.grid)
      }
      const head = asked.grid === undefined ? 'The row grid is' : 'The row grid is now'
      return { text: `${head} ${gridText(S.grid)}. With the grid on, a mouse selection over a picture covers the lines it copies. Use /iui grid on (the default), or /iui grid off.` }
    }
    if (asked.kind === 'updates') {
      await loadUpdates($)
      if (asked.on !== undefined) {
        S.updates = asked.on
        await storeSet($, 'updates', S.updates)
        // On: the check of this load, if it did not run (it waits 24 h after the last one).
        if (S.updates) void checkUpdates($)
      }
      const head = asked.on === undefined ? 'Update checks' : 'Update checks are now'
      return { text: `${head}: ${updateLine(await updateState($))}. When on, Intelligent UI gets its plugin.json from GitHub once a day at most (one GET, no data sent) and shows a toast when a new version is available. Use /iui updates on (the default), or /iui updates off.` }
    }
    if (asked.kind === 'setup') {
      await setUp($).catch(() => null)
      return { text: await runSetup($, asked.remove) }
    }
    if (asked.kind === 'probe') {
      // A debug check: does the terminal's OSC 11 answer reach the mod?
      const lines: string[] = []
      for (let i = 1; i <= PROBE_RUNS; i++) {
        const got = await probeOsc11($)
        const bg = got ? parseOsc11(got.reply) : null
        const what = !got ? 'could not open /dev/tty' : !got.reply ? 'no answer in 300 ms' : `"${escapeControls(got.reply)}"`
        const mode = bg ? ` -> luminance ${luminanceOf(bg).toFixed(3)}, ${modeOfLuminance(luminanceOf(bg))}` : got?.reply ? ' -> not an OSC 11 answer' : ''
        lines.push(`${i}: ${what}${mode}`)
      }
      return { text: `OSC 11 probe (the terminal's background), ${PROBE_RUNS} runs:\n${lines.join('\n')}\nThe poll uses it: ${USE_OSC11 ? 'yes' : 'no (off)'}.` }
    }
    if (asked.kind === 'theme') {
      const ready = await setUp($)
      const was = S.look
      const wanted = asked.name ?? S.look?.name ?? DEFAULT_THEME
      const { themes, problems, chosen } = await applyTheme($, ready.root, ready.home, wanted)
      if (asked.name && chosen.isFallback) {
        if (was) S.look = was
        const names = [...themes.keys()].sort().join(', ') || 'none'
        return { text: `No usable theme named ${asked.name}. Themes: ${names}.\n${themeListing(themes, problems, was?.name ?? DEFAULT_THEME, userThemesOf(ready.home))}` }
      }
      if (S.look?.name !== was?.name || S.look?.dir !== was?.dir || S.look?.stamp !== was?.stamp) {
        // The theme's fonts set the column width and the code size.
        if (ready.typst && S.look) ready.metrics = await measureFonts($, ready.typst, ready.root, ready.cache, ready.termFont, S.look.dir)
        beginEpoch($)
      }
      if (asked.name) await storeSet($, 'theme-name', chosen.name)
      const head = asked.name ? `Intelligent UI uses the theme ${chosen.name}.\n` : ''
      return { text: `${head}${themeListing(themes, problems, chosen.name, userThemesOf(ready.home))}` }
    }
    const state = (await read($, isOn)) ? 'on' : 'off'
    const ready = await setUp($)
    const bad = asked.kind === 'bad' ? `Not understood: "${e.args.trim()}".\n` : ''
    const theme = S.look?.name ?? DEFAULT_THEME
    if (asked.kind === 'details') {
      const font = ready.termFont ? `terminal font ${ready.termFont}` : `terminal font not known (${ready.isMac ? 'Menlo' : "the theme's code font"} assumed)`
      const typst = ready.typst ? `Typst: ${ready.typst}` : `Typst: not found (${typstHintOf(ready.isMac)})`
      const terminal = ready.canDraw
        ? `this terminal draws pictures${ready.inline ? ' (over ssh, sent as bytes)' : ''}`
        : 'Claude Code draws no pictures here (it does in kitty and Ghostty, in iTerm2 3.6+ and Rio 0.5.27+ with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1, over ssh when TERM names kitty or Ghostty or with that variable; never in tmux, screen or a background session; not in WezTerm, Warp, Konsole or others), so answers stay text'
      await clipWayReady()
      const auto = `Auto copy: ${autoCopyOf(state === 'on')}`
      const updates = `Update checks: ${updateLine(await updateState($))}`
      return { text: `Intelligent UI is ${state}, theme ${theme}, ${modeLine(S.theme, S.setting, S.settingRaw, S.host)}, text size ${S.size}%, width ${widthText(S.width)}, image and drawing height ${heightText(S.height)}, row grid ${S.grid ? 'on' : 'off'}, ${font}. ${typst}; ${terminal}.\n${auto}\n${updates}` }
    }
    // The short state: what is set, and only the problems that keep pictures away.
    const sized = (v: number | 'full' | 'half', unit: string) => (typeof v === 'number' ? `${v} ${unit}` : v)
    const lines = [`Intelligent UI is ${state}: theme ${theme}, ${S.theme}, text ${S.size}%, width ${sized(S.width, 'columns')}, height ${sized(S.height, 'rows')}, grid ${S.grid ? 'on' : 'off'}.`]
    if (S.setupNeeded) lines.push('In iTerm2, run /iui setup once to show pictures.')
    else if (!ready.canDraw) {
      const where = ready.isMac ? 'kitty, Ghostty and iTerm2 3.6+' : 'kitty and Ghostty, and in Rio with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1'
      lines.push(`This terminal shows no pictures, so answers stay text. Pictures show in ${where}.`)
    }
    if (!ready.typst) lines.push(`Typst is not installed, so answers stay text. Install it: ${typstHintOf(ready.isMac)}`)
    const notice = updateNotice(await updateState($))
    if (notice) lines.push(notice)
    lines.push('Change: /iui on | off | size | width | height | grid | updates | theme. More: /iui details')
    return { text: bad + lines.join('\n') }
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const set = await next(e)
    if (set.value === undefined) return set
    S.settingRaw = typeof set.value === 'string' ? set.value : ''
    S.setting = settingOf(set.value)
    // Not awaited: the setting is saved at once; the OS read redraws later.
    if (S.setting === 'auto') void pollHost($).catch(() => undefined)
    else showMode($)
    watchHost($)
    return set
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.surfaces.includes('terminal') || !(await read($, isOn))) return composed
    const ready = S.env ?? (await setUp($).catch(() => null))
    if (!ready?.typst || !ready.canDraw) return composed
    return { sections: [...composed.sections, { id: 'cc-intelligent-ui:typst', text: TYPST_PROMPT, scope: 'session' as const }] }
  })

  // A main-loop model request: its text blocks are final when the next block
  // (another text block, a tool call, thinking, the stop) starts, and all of
  // them when the request ends, fails or is aborted.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    S.stepsLive++
    let textIndex = -1
    let isDone = false
    // Never let Intelligent UI's own work break Claude's stream.
    const settleAll = () => {
      try {
        finalizeAll($)
      } catch {}
    }
    const stream = next(e)
    try {
      for (;;) {
        const step = await stream.next()
        if (step.done) {
          isDone = true
          return step.value
        }
        const chunk = step.value
        if (chunk.kind === 'text') {
          if (textIndex >= 0 && chunk.index !== textIndex) settleAll()
          textIndex = chunk.index
        } else if (chunk.kind !== 'engine' && textIndex >= 0) {
          settleAll()
          textIndex = -1
        }
        yield chunk
      }
    } finally {
      // Closed early (Esc, an error below): close the stream beneath too, as
      // `yield*` would.
      if (!isDone) {
        try {
          await stream.return?.(undefined as never)
        } catch {}
      }
      S.stepsLive = Math.max(0, S.stepsLive - 1)
      settleAll()
    }
  })

  // Esc: the cut block is final too (the step's own end also says so).
  on('turn.abort', async ($, e, next) => {
    const aborted = await next(e)
    try {
      finalizeAll($)
    } catch {}
    return aborted
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary || !e.props.text.trim()) return next(e)
    const ready = await answerEnv($, e)
    if (!ready) return next(e)
    const bullet = !!e.props.isFirstOfReply
    const onScreen = onScreenOf(e.props.onScreen)
    const k = { text: e.props.text, extra: bullet ? 'bullet' : '', stamp: stampOf(ready, e.viewport), onScreen }
    const kept = memoOf(answers, e.requestId, k)
    // Its pages are under the top margin (drawPages) with its link rows
    // under them; the rows on screen at each draw, a memo hit too.
    if (kept) {
      noteCopy($, () => {
        noteDrawnAgain(e.requestId, roomColumns(e.viewport), { top: MARGIN_TOP, after: kept.links })
        noteOnScreen(e.requestId, e.props.onScreen)
      })
      return kept.tree
    }
    const drawing = await pagesOf($, { id: e.requestId, text: e.props.text, frame: frameFor(e.viewport), env: ready.env, canStream: true, onScreen })
    if (drawing.kind === 'pages') {
      const links = await linksFor($, e.props.text, ready.env.cwd)
      const tree = drawPages($, e, drawing.result, drawing.bytes, { bullet, links })
      const { result } = drawing
      noteCopy($, () => {
        noteDrawn(e.requestId, result, roomColumns(e.viewport), { top: MARGIN_TOP, after: links.length })
        noteOnScreen(e.requestId, e.props.onScreen)
      })
      memoSet(answers, e.requestId, k, { tree, links: links.length })
      return tree
    }
    answers.delete(e.requestId)
    if (drawing.kind === 'text') return next(e)
    const { Box } = uiResolve($, e)
    return <Box />
  })

  // The files Claude sends with SendUserFile, under the result row that lists
  // them: PNG, JPEG and WebP images, and Markdown files drawn as an answer is
  // (they need Typst). Its ToolUse row draws no attachments, and the tool is
  // never in a ToolGroup, so only ToolResult is hooked and no picture draws
  // twice.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.tool !== 'SendUserFile' || e.props.isErrored) return next(e)
    let under: Under[] = []
    try {
      const files = sentFiles(e.props.output)
      const ready = files.length ? await pictureEnv($, e) : null
      if (ready) {
        const markdown = files.some(f => f.kind === 'markdown') && ready.env.typst ? ready.env : null
        const id = e.props.tool_use_id
        const onScreen = onScreenOf(e.props.onScreen)
        const k = { text: files.map(f => `${f.kind}:${f.path}`).join('\n'), extra: '', stamp: stampOf(ready, e.viewport), onScreen }
        // Its jobs: one per Markdown file (pagesOf's id `file:<id>:<path>`).
        const kept = memoOf(unders, id, k, requestId => requestId.startsWith(`file:${id}:`))
        // Each Markdown file's pages with the rows drawn after them (rowsAfter)
        // and the row's rows on screen, at each draw.
        const room = roomColumns(e.viewport)
        if (kept) {
          under = kept
          kept.forEach((u, i) => {
            if (!('drawing' in u)) return
            noteCopy($, () => {
              noteDrawnAgain(u.id, room, { after: rowsAfter(kept, i, room) })
              noteOnScreen(u.id, e.props.onScreen)
            })
          })
        } else {
          under = await sentOf($, e, { ready: ready.env, markdown, files, id, at: { done: ready.done, row: e.requestId } })
          if (under.length && under.every(u => !('drawing' in u) || u.drawing.kind === 'pages')) memoSet(unders, id, k, under)
          else unders.delete(id)
          const drawn = under
          drawn.forEach((u, i) => {
            if (!('drawing' in u) || u.drawing.kind !== 'pages') return
            const { result } = u.drawing
            noteCopy($, () => {
              noteDrawn(u.id, result, room, { after: rowsAfter(drawn, i, room) })
              noteOnScreen(u.id, e.props.onScreen)
            })
          })
        }
      }
    } catch {
      under = []
    }
    const row = await next(e)
    if (!under.length) return row
    try {
      return underRow($, e, row, under)
    } catch {
      return row
    }
  })

  // The images the user pasted (`[Image #N]`), under the prompt row. Only the
  // user's own prompts: a notification's or another agent's row stays as is.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin?.kind !== 'composer' || e.props.from || e.props.task) return next(e)
    const numbers = pastedNumbers(e.props.text)
    if (!numbers.length) return next(e)
    let shown: Shown[] = []
    try {
      const ready = await pictureEnv($, e)
      const k = { text: e.props.text, extra: '', stamp: ready ? stampOf(ready, e.viewport) : '', onScreen: undefined }
      const kept = ready ? memoOf(pasted, e.requestId, k, () => false) : undefined
      if (kept) shown = kept
      else if (ready) {
        const dir = await pasteDir($, ready.env)
        if (dir) shown = await shownOf($, e, ready.env, numbers.map(n => pastedImagePath(dir, n)), { done: ready.done, row: e.requestId })
        if (shown.length) memoSet(pasted, e.requestId, k, shown)
        else pasted.delete(e.requestId)
      }
    } catch {
      shown = []
    }
    const row = await next(e)
    if (!shown.length) return row
    try {
      return underRow($, e, row, shown)
    } catch {
      return row
    }
  })

  // ---- The plan --------------------------------------------------------------

  // The main loop's running turn, which "clear context" ends.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) S.mainTurnId = e.turnId
    // The update check, when the end of setUp could not run it (no terminal yet).
    void checkUpdates($)
    // The clipboard part, if it is not on (a picture drawn while it was off).
    if (await read($, isOn)) watchClipboard($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The ExitPlanMode row, above the question: the engine's row, then the plan
  // as pictures, through the answers' pipeline at an answer's width (the
  // edited text once edited in Intelligent UI's flow). A rejected, aborted or
  // subagent call, and a plan that fails to compile, stay as the engine draws.
  on('ui.render', { component: 'ToolUse', props: { tool: 'ExitPlanMode' } }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isErrored || e.props.isInterrupted || subagentPlans.has(e.props.tool_use_id)) return row
    try {
      const plan = planShownOf(editedPlans.get(e.props.tool_use_id), e.props.output, e.props.input)
      const ready = plan ? await answerEnv($, e) : null
      if (!ready) return row
      const { drawing, links } = await planDrawing($, e, e.props.tool_use_id, plan, ready)
      // Its pages can be copied as an answer's, by the call's id (the row's
      // requestId can be an answer's own). The engine's row is above them:
      // their place is read from the bottom (pageTopsOf), under them its
      // link rows.
      if (drawing.kind === 'pages') {
        const { result } = drawing
        const id = `plan:${e.props.tool_use_id}`
        noteCopy($, () => {
          noteDrawn(id, result, roomColumns(e.viewport), { after: links.length })
          noteOnScreen(id, e.props.onScreen)
        })
      }
      return drawPlanUse($, e, row, drawing, links)
    } catch {
      return row
    }
  })

  // The approved plan's result row: the engine's repeats the plan as text
  // under its header, so while the ToolUse row draws the pictures this row
  // keeps the header alone. An errored call (a rejected plan), an empty plan
  // and a subagent's stay as the engine draws them.
  on('ui.render', { component: 'ToolResult', props: { tool: 'ExitPlanMode' } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored) return next(e)
    let drawn: RenderElement | null = null
    try {
      const plan = planOf(e.props.output) ? planShownOf(editedPlans.get(e.props.tool_use_id), e.props.output, undefined) : ''
      const ready = plan ? await answerEnv($, e) : null
      const drawing = ready ? (await planDrawing($, e, e.props.tool_use_id, plan, ready)).drawing : null
      const filePath = (e.props.output as { filePath?: unknown }).filePath
      if (drawing && drawing.kind !== 'text') drawn = drawPlanResult($, e, typeof filePath === 'string' ? filePath : undefined)
    } catch {
      drawn = null
    }
    return drawn ?? next(e)
  })

  // One dim line above the mod's own question (the dialog takes at most 12
  // rows around it, so the plan is in the row above). Any other question
  // stays as the engine draws it.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const dialog = await next(e)
    if (e.surface !== 'terminal' || !isPlanQuestion(e.props.questions, S.planAsking)) return dialog
    try {
      return drawAskLine($, e, dialog)
    } catch {
      return dialog
    }
  })

  // The main loop's Write and Edit calls while they run: the plan waits for
  // a write of its file that Claude sent with ExitPlanMode in one message.
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const file = !e.agentId && typeof e.file_path === 'string' ? e.file_path : ''
    if (!file) return next(e)
    writesLive.set(file, (writesLive.get(file) ?? 0) + 1)
    try {
      return await next(e)
    } finally {
      const left = (writesLive.get(file) ?? 1) - 1
      if (left > 0) writesLive.set(file, left)
      else writesLive.delete(file)
    }
  }).catch(($, e, next) => next(e))

  // The main loop's ExitPlanMode: the mod asks first (the engine shows its
  // dialog while PermissionRequest hooks run, so a question asked there waits
  // behind it). The person's words deny the call (Claude revises the plan);
  // a verdict waits for the PermissionRequest below, and is dropped once the
  // call resolves, so it never reaches a later call. No env, no plan, or a
  // failure: no verdict, and the engine's dialog asks.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    if (e.agentId) {
      subagentPlans.add(e.tool_use_id)
      return next(e)
    }
    S.planVerdict = null
    let verdict: PlanVerdict | null = null
    try {
      const ready = await planEnv($)
      const callPlan = ready ? planInputOf(e) : ''
      if (ready && callPlan) {
        const id = e.tool_use_id
        const file = planFileOf(e)
        const plan = await currentPlan($, file, callPlan)
        if (plan !== callPlan) {
          editedPlans.set(id, plan)
          refresh($)
        }
        const outcome = await decidePlan($, {
          plan, callPlan, file, isMac: ready.isMac, isRemote: S.isRemote,
          onEdited: text => {
            editedPlans.set(id, text)
            refresh($)
          },
        })
        if (outcome.kind === 'feedback') return { deny: outcome.message }
        verdict = outcome.verdict
      }
    } catch {
      verdict = null
    }
    S.planVerdict = verdict
    const turnId = S.mainTurnId
    let got: Awaited<ReturnType<typeof next>>
    try {
      got = await next(e)
    } finally {
      S.planVerdict = null
    }
    // The call has run: a failure to schedule changes nothing of its result.
    try {
      if (verdict?.kind === 'allow' && verdict.clear && got && typeof got === 'object' && !('deny' in got)) scheduleClear($, verdict.plan, turnId)
    } catch {}
    return got
  }).catch(($, e, next) => next(e))

  // The PermissionRequest of that call: Intelligent UI's verdict at once (the
  // engine's dialog never shows), else the engine's flow.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.tool_name !== 'ExitPlanMode' || e.agent_id || !S.planVerdict) return next(e)
    const verdict = S.planVerdict
    S.planVerdict = null
    return { decision: decisionOf(verdict, e.tool_input) }
  }).catch(($, e, next) => next(e))
}
