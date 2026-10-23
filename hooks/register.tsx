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
import type { EngineInterface, Register, RenderElement, RenderSurface, RenderViewport } from 'claude-code'

import {
  DEFAULT_THEME, gridText, heightText, IMAGE_MAX_COLUMNS, MARGIN_TOP, MAX_HEIGHT, MAX_WIDTH, MIN_HEIGHT, MIN_WIDTH, RESULTS_KEPT, TYPST_PROMPT,
  SELECT_SINCE, selectText, typstHintOf, widthText,
} from './lib/settings'
import { clip, DEFAULT_METRICS, drawnAnswers, editedPlans, keep, queue, refresh, running, S, settingsSet, subagentPlans, writesLive, type Env, type Job } from './lib/state'
import { beginEpoch } from './lib/epoch'
import { escapeControls, luminanceOf, modeLine, modeOfLuminance, parseOsc11, settingOf } from './lib/mode'
import { applyTheme, themeListing, userThemesOf } from './lib/themes'
import { commandSuggestions, parseCommand, registerCommand } from './lib/command'
import { runSetup } from './lib/setup'
import { pollHost, PROBE_RUNS, probeOsc11, showMode, USE_OSC11, watchHost } from './lib/host'
import { measureFonts } from './lib/typst'
import { drawPages, linkRowsOf, linksFor, takesSelect, type ShownLink } from './lib/draw'
import {
  clickLinks, hovered, litOf, needsSelect, picked, postOf, redrawSelection, runsOf, sameLit, selectedRows, selectionAfter, selectTrace, stopNative, textOfRuns,
  topsOf, watchNative, type Hover, type SelectPost, type Selection,
} from './lib/select'
import { targetAt, type Target } from './lib/targets'
import { blits, selectColor } from './lib/blit'
import { forgetPages, needFrames, notePages } from './lib/pagecache'
import { traceDebug } from './lib/log'
import { finalizeAll } from './lib/stream'
import { knownTargets, knownWords, noteDrawn, noteDrawnAgain, noteOnScreen, wordsOf, type PageWords } from './lib/probe'
import { codePointsOf, decodeSelection, hasPlaceholders, joinSegments, pageTopsOf, pickPages, textOfRun, type Drawn, type Pick, type Segment } from './lib/copy'
import { pagesOf, type Drawing } from './lib/answer'
import { clipboardNow, clipboardRead, clipWatchArgs, clipWayReady, hintText } from './lib/clipboard'
import { setUp } from './lib/env'
import { frameFor, noteView, stopWatch, watchFrame, watchState } from './lib/frame'
import { roomColumns } from './lib/terminal'
import { onScreenOf, pastedImagePath, pastedNumbers, sentFiles } from './lib/images'
import { drawPageField, pasteDir, pdfPagesOf, rowsAfter, sentOf, shownOf, underRow, type Shown, type Under } from './lib/pictures'
import { checkUpdates, loadUpdates, updateLine, updateNotice, type UpdateState } from './lib/updates'
import { nowMs, write, surf, save, copy, uiSelection, toast } from './lib/api'
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
export { fcPatternOf, OSC11_PL, perlFor, PROGRAM_FONTS_PL, PROGRAM_FONTS_SH, WATCH_PL } from './lib/host'
export {
  convertCall, isSafePage, measureCall, noNetworkEnv, pageRowsOf, parseOd, pngSize, probeCall, resultOf, roomInputs, shouldRetrySafe, typstCall, typstInputs,
} from './lib/typst'
export {
  alignFirstLine, fileHref, firstLineOf, fontFit, hashOf, renderKey, resolveLinks, scaledBulletRow, sizing, type FirstLine, type ShownLink,
} from './lib/draw'
export { nextJob } from './lib/stream'
export * from './lib/images'
export { rowsAfter, type Under } from './lib/pictures'
export * from './lib/copy'
export { targetAt, targetsOf, type PageTarget, type Target } from './lib/targets'
export {
  CLIP_TOOLS, clipToolsOf, clipWayOf, FIND_SH, GTK_READ_PY, GTK_WATCH_PY, hintText, READ_PL, SECRET_TARGET, SECRET_TYPES, WL_READ_SH, WL_WATCH_SH, X11_WATCH_SH, XCLIP_READ_SH,
  type ClipTool, type ClipWay,
} from './lib/clipboard'
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
  if (typeof e.viewport?.isFullscreen === 'boolean') S.isFullscreen = e.viewport.isFullscreen
  // Read so the end of setUp, a compile and a commit draw this row again.
  const now = await read($, done)
  if (!S.env) {
    void setUp($).catch(() => undefined)
    return null
  }
  if (S.env.canDraw && S.isFullscreen === false) tellFullscreen($)
  return S.env.canDraw ? { env: S.env, done: now } : null
}

// Once a session, where pictures draw on the main screen: fullscreen gives
// picture select (a mouse drag over a picture copies its text).
function tellFullscreen($: EngineInterface) {
  if (S.fullscreenTold) return
  S.fullscreenTold = true
  toast($, 'Intelligent UI works best in fullscreen mode: run /tui fullscreen', { timeoutMs: 12000 })
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
// width change settles; a scroll keeps them), and picture select's state
// (a Client failed, fullscreen or not: its Client is there or not).
const stampOf = (ready: { env: Env; done: number }, view?: RenderViewport) =>
  `${ready.done}|${S.epoch}|${S.shownEpoch}|${ready.env.inline ? 1 : 0}|${view?.columns ?? ''}|${roomColumns(view)}|` +
  `${S.select ? 1 : 0}${picked.isBroken ? 1 : 0}${view?.isFullscreen === true ? 1 : 0}`

// Each row's last drawing, by its requestId: a redraw with the same inputs
// and the same stamp (a scroll step, a new onScreen) returns the same thing,
// with no hash, no file and no process. Only drawn pictures are kept (a
// blank or a text row runs the pipeline again: its timers move it on).
// `text` the row's text (a string kept as given, so the compare is mostly
// one pointer), `extra` its other inputs.
type Memo<T> = { text: string; extra: string; stamp: string; onScreen: boolean | undefined; value: T }
// An answer's tree is kept with the link rows drawn under its pages (the
// copy counts them; none where they take picture select), a plan's drawing
// with its link rows.
type AnswerMemo = { tree: RenderElement; after: number }
const answers = new Map<string, Memo<AnswerMemo>>()
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
  const surfaces = await surf($).catch(() => [] as readonly string[])
  if (!surfaces.includes('terminal')) return null
  const ready = S.env ?? (await setUp($).catch(() => null))
  return ready?.typst && ready.canDraw ? ready : null
}

// ---- Copy -----------------------------------------------------------------
// Picture select (below) copies the text of a drag over the pictures. A
// copy that still puts kitty placeholder cells on the clipboard (the main
// screen's, a native drag over text and pictures) is seen by the watcher
// (lib/frame.ts), which prints a line when the clipboard changes: the
// clipboard is read once (perl on macOS, wl-paste, xclip or GTK; never a
// password manager's copy), and cells that fit a page drawn here get a
// toast that names /iui grab, which reads them (see lib/copy.ts; the drawn
// pages and the words of a page are in lib/probe.ts). The clipboard is
// never written but by a copy the person asked for, and never over a newer
// copy (isNewest). No timer reads the clipboard; the selection is read
// every 250 ms only while a picture selection shows (watchNative).

// Notes a drawing for a copy (noteDrawn, noteDrawnAgain), turns on the
// watcher's clipboard part and queues its pages for picture select's
// cache; a failure never stops the row from drawing.
function noteCopy($: EngineInterface, id: string, note: () => void) {
  try {
    note()
    watchClipboard($)
    queueSelect($, id)
  } catch {}
}

// A drawing whose pages take picture select (drawn with its Client): its
// pages on screen to the cache (lib/pagecache.ts), the others out of it.
function queueSelect($: EngineInterface, id: string) {
  const d = drawnAnswers.get(id)
  if (d && S.select && S.isFullscreen !== false && !picked.isBroken && blits.sites.has(id)) notePages($, d, selectColor(S.theme))
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

// A watcher line `clip <count>` (null: `clip none`, no PerlObjCBridge or
// the Linux notifier ended: the /iui grab hint stays off). The first count
// of a child (at its start) is only noted: the clipboard then is no new copy
// (after a hot reload, it can be an old copy of picture cells).
function clipChanged($: EngineInterface, count: number | null, first: boolean) {
  if (count === null) {
    clip.none = true
    return
  }
  clip.count = count
  if (!first) void readClipboard($).catch(() => undefined)
}

// Picture cells on the clipboard (a native copy: their session is not
// known), never written. Cells that fit a page drawn here get one toast that
// names /iui grab.
function hintGrab($: EngineInterface, text: string) {
  if (!pickPages(decodeSelection(text), [...drawnAnswers.values()]).some(Boolean)) return
  clip.raw = text
  clip.rawRow = undefined
  if (S.debug) traceDebug($, `select: native copy seen: ${decodeSelection(text).filter(seg => seg.kind === 'image').length} picture run(s) on the clipboard`)
  toast($, 'Intelligent UI: picture cells copied; /iui grab puts their text on the clipboard')
}

// The clipboard changed: one read (clipboardRead). A clipboard with no
// placeholders, and our own write, are never touched. A new text that no
// recent $.ui.copy wrote (another app's copy, Claude Code's copy on select, a
// password manager's: null) is a newer copy; a failed read is none. A change
// while a read runs reads once more after it.
async function readClipboard($: EngineInterface) {
  if (clip.busy) {
    clip.again = true
    return
  }
  clip.busy = true
  try {
    do {
      clip.again = false
      const text = await clipboardRead($)
      if (text === undefined || text === clip.seen) continue
      clip.seen = text
      if (text === null || !copiedTexts.includes(text)) copies++
      if (text === null || text === clip.wrote || !hasPlaceholders(text)) continue
      hintGrab($, text)
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

// The /iui grab hint now, for /iui details and dump.
function hintOf(isOn: boolean): string {
  const now = watchState()
  return hintText({
    isMac: !!S.env?.isMac, hostOs: S.hostOs, isRemote: S.isRemote, isOn, none: clip.none, drawn: drawnAnswers.size > 0,
    running: !!now?.clip && !now.ended, way: S.clipWay,
  })
}

// The update check's state now, for /iui, /iui details and /iui updates.
async function updateState($: EngineInterface): Promise<UpdateState> {
  await loadUpdates($)
  const now = await nowMs($).catch(() => Date.now())
  return { on: S.updates, off: S.updatesOff, own: S.ownVersion, checked: S.updateChecked, now }
}

// The newest copy (a grab, a click, an up, any $.ui.copy, or a copy from
// outside that the watcher sees): an older one that still reads its text
// when a newer one starts copies nothing. `copiedTexts`: the texts of the
// last 4 $.ui.copy calls (their changes, even read late, are no copy from outside).
let copies = 0
const copiedTexts: string[] = []
function noteCopied(text: string) {
  copiedTexts.push(text)
  if (copiedTexts.length > 4) copiedTexts.shift()
}

// A copy's turn: its number and the native selection when it began.
type Turn = { n: number; native: Promise<string> }
const nativeKey = (s: { text: string; requestId?: string } | undefined) => (s ? `${s.requestId ?? ''}|${s.text}` : '')
function nativeNow($: EngineInterface): Promise<string> {
  try {
    // A failed read is no selection, as grab and the ui.copy hook take it.
    return Promise.resolve(uiSelection($)).then(nativeKey, () => nativeKey(undefined))
  } catch {
    return Promise.resolve(nativeKey(undefined))
  }
}
const takeTurn = ($: EngineInterface, native?: Promise<string>): Turn => ({ n: ++copies, native: native ?? nativeNow($) })

// Whether a copy is still the newest when its text is read: no newer copy
// came, and no new native selection (Claude Code copies that itself, past
// every hook; no poll runs for a click).
async function isNewest($: EngineInterface, turn: Turn): Promise<boolean> {
  if (turn.n !== copies) return false
  const [was, now] = await Promise.all([turn.native, nativeNow($)])
  return turn.n === copies && was === now
}

// /iui grab: the last mouse selection, read and copied. With no selection
// (the main screen), the picture cells on the clipboard: the command says
// that the copy is this session's.
async function grab($: EngineInterface): Promise<string> {
  const selected = await uiSelection($).catch(() => undefined)
  let raw = selected?.text
  if (raw === undefined) {
    const now = await clipboardNow($)
    if (now === null) return 'Intelligent UI: no mouse selection, and the clipboard can not be read (see /iui details).'
    if (clip.wrote && now === clip.wrote) return 'Intelligent UI: the clipboard has the text already.'
    if (!hasPlaceholders(now)) return 'Intelligent UI: no mouse selection and no picture cells on the clipboard; select over a picture and copy first.'
    raw = now
  }
  if (!hasPlaceholders(raw)) return `Intelligent UI: the selection has no picture cells; it is ${raw.length} chars of text already.`
  const row = selected?.requestId
  clip.raw = raw
  clip.rawRow = row
  // Only a grab that copies takes a turn.
  const turn = takeTurn($, Promise.resolve(nativeKey(selected)))
  const read = await readCopy($, raw, row)
  if (!(await isNewest($, turn))) return 'Intelligent UI: a newer copy came first; this one copied nothing.'
  if (!read.resolved) return `Intelligent UI: found ${read.runs} picture run(s) but could not read them (see /iui dump).`
  clip.wrote = read.text
  clip.seen = read.text
  const copied = await copy($, { text: read.text })
  return copied.isCopied
    ? `Intelligent UI: copied ${read.text.length} chars (${read.resolved} of ${read.runs} picture runs read${row ? `, row ${row}` : ''}).`
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
  const hint = hintOf(on)
  if (!clip.raw) return `Intelligent UI: no clipboard text with picture cells seen yet (grab hint ${hint}; ${drawnAnswers.size} pictures drawn).`
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
    await write($, `${cache}/copy-debug.json`, JSON.stringify(full, null, 1)).catch(() => undefined)
  }
  return [
    `Intelligent UI: last clipboard with picture cells (${Array.from(clip.raw).length} code points; grab hint ${hint}):`,
    codePointsOf(clip.raw, 40),
    runs,
    `Read as ${read.text.length} chars: ${JSON.stringify(read.text.slice(0, 200))}`,
    cache ? `Full dump: ${cache}/copy-debug.json` : '',
  ].filter(Boolean).join('\n')
}

// ---- Picture select -------------------------------------------------------
// The Client over each page (hooks/sel.tsx) posts the selection; the pages
// show it (a blit of each page's picture, lib/blit.ts) and its text is
// copied on the button's up, read as a copy of its cells is (wordsOf, textOfRun).
// See lib/select.ts.

// A Client's post: the selection after it, shown (once a frame at most, the
// newest selection). A down puts its page first in the cache (lib/pagecache.ts)
// and probes its words if they are not there, for the drag's frames and the
// copy at the up, lets a page whose blit was refused try again, and takes
// the hover's tint down. A down is always taken (a reloaded sel.tsx counts
// from 0 again). A hover or a leave moves the tint (hoverAt), after the up
// or clear it carries; a clear (a click) on a target copies it.
function onSelect($: EngineInterface, post: SelectPost, surface: RenderSurface) {
  if (post.end) onSelect($, post.end, surface)
  if (post.seq <= picked.seq && post.phase !== 'down') return
  picked.seq = post.seq
  const d = drawnAnswers.get(post.id)
  if (post.phase === 'hover' || post.phase === 'leave') {
    // A leave of a page the pointer is no longer on (it is on another page) changes nothing.
    const at = hovered.at
    if (post.phase === 'leave' && at && (at.id !== post.id || at.page !== post.page)) return
    hoverAt($, post.phase === 'hover' && d ? { id: post.id, page: post.page, x: post.head.x, y: post.head.y } : null)
    return
  }
  const was = picked.now
  picked.now = d ? selectionAfter(post, topsOf(d.pages)) : null
  if (S.debug) traceDebug($, selectTrace(post, d, picked.now))
  const page = d?.pages[post.page]
  if (post.phase === 'down') {
    blits.refused.clear()
    hovered.at = null
    hovered.lit = null
    if (d && page && S.env) {
      void needFrames($, page, selectColor(S.theme), { id: d.id, index: post.page, seq: d.seq }).catch(() => undefined)
      void wordsOf($, d, post.page).catch(() => undefined)
    }
  }
  if (was || picked.now) redrawSelection($)
  watchNative($, () => clearSelection($))
  // The copy waits for the page's words when they are not there: the next posts do not.
  if (post.phase === 'up' && d && picked.now) void copySelection($, d, picked.now, surface).catch(() => undefined)
  if (post.phase === 'clear' && d) {
    void clickAt($, d, post, surface).catch(() => undefined)
    // The pointer is still there: its target tinted again.
    hoverAt($, { id: post.id, page: post.page, x: post.head.x, y: post.head.y })
  }
}

// No links of a drawing known (its pages drawn with no picture select yet).
const NO_LINKS: readonly ShownLink[] = []

// The pointer over a page with no button down (null: off it): the target
// under it tinted, while no selection shows. A new page's words are probed
// when they are not known (the tint once they are); the tint's blit asks for
// the page's frames (needFrames), as a down does.
function hoverAt($: EngineInterface, at: Hover | null) {
  const was = hovered.at
  hovered.at = at
  const d = at ? drawnAnswers.get(at.id) : undefined
  if (at && d && (was?.id !== at.id || was.page !== at.page) && !knownWords(d, at.page)) {
    void wordsOf($, d, at.page).then(() => lightHover($), () => undefined)
  }
  lightHover($)
}

// The hover's target tinted (none while a selection shows), redrawn when it changed.
function lightHover($: EngineInterface) {
  const at = hovered.at
  const d = at ? drawnAnswers.get(at.id) : undefined
  const targets = at && d && !picked.now ? knownTargets(d, at.page, clickLinks.get(at.id) ?? NO_LINKS) : undefined
  const lit = at && targets ? litOf(at, targets) : null
  if (sameLit(lit, hovered.lit)) return
  hovered.lit = lit
  if (S.debug) traceDebug($, lit ? `select: hover ${lit.id} page ${lit.page} target ${lit.index} (${targets?.[lit.index]?.target.kind}) rows ${lit.rows.map(r => `${r.row}:${r.x0}-${r.x1}`).join(',')}` : 'select: hover none')
  redrawSelection($)
}

// A click (a clear) on a target of the page copies its text (a link's URL,
// a file's path, a command, a code block's code). The page's words are probed first when they
// are not known; a newer copy while they are (or a new native selection): the newer one copies.
async function clickAt($: EngineInterface, d: Drawn & { job?: Job }, post: SelectPost, surface: RenderSurface) {
  const turn = takeTurn($)
  const links = () => clickLinks.get(d.id) ?? NO_LINKS
  let targets = knownTargets(d, post.page, links())
  if (!targets) {
    await wordsOf($, d, post.page)
    if (!(await isNewest($, turn))) return
    targets = knownTargets(d, post.page, links())
  }
  const target = targets?.[targetAt(targets, post.anchor.x, post.anchor.y)]?.target
  if (S.debug) traceDebug($, `select: click ${d.id} page ${post.page} at ${post.anchor.x},${post.anchor.y} target ${target ? target.kind : 'none'}`)
  if (target) await copyTarget($, target, surface)
}

// A target's text on the clipboard (clickAt), with its toast.
async function copyTarget($: EngineInterface, target: Target, surface: RenderSurface) {
  const text = target.kind === 'web' ? target.href : target.kind === 'file' ? target.path : target.text
  const name = target.kind === 'web' ? 'link' : target.kind === 'file' ? 'path' : target.kind === 'code' ? 'code' : 'command'
  // The clipboard change of this text is not read again.
  clip.wrote = text
  clip.seen = text
  const copied = await copy($, { text, surface })
  toast($, copied.isCopied ? `Intelligent UI: copied the ${name}` : `Intelligent UI: the copy failed: ${copied.reason}`)
}

// The text of a selection's cells, page by page, as a copy of those cells
// reads it (textOfRuns); null when a page's words can not be read.
// `probed`: the pages whose words were not there yet (a probe ran or ran on).
async function selectionText($: EngineInterface, d: Drawn & { job?: Job }, sel: Omit<Selection, 'id' | 'isUp'>, probed: number[] = []): Promise<string | null> {
  const runs = runsOf(selectedRows(sel, d.pages))
  const words = new Map<number, PageWords | null>()
  for (const run of runs) {
    const known = knownWords(d, run.page)
    if (!known) probed.push(run.page)
    words.set(run.page, known ?? (await wordsOf($, d, run.page)))
  }
  return textOfRuns(runs, page => words.get(page) ?? null, d.pages)
}

// The button came up: the selection's text on the clipboard, with the
// toast of a copy. No text under it: nothing is copied; a newer up while
// its words are read (or any newer copy, or a new native selection): the newer one copies.
async function copySelection($: EngineInterface, d: Drawn & { job?: Job }, sel: Selection, surface: RenderSurface) {
  const t = performance.now()
  const turn = takeTurn($)
  const probed: number[] = []
  const text = await selectionText($, d, sel, probed)
  if (!(await isNewest($, turn))) return
  const read = performance.now() - t
  if (text === null) {
    toast($, 'Intelligent UI: could not read the selected picture')
    return
  }
  if (!text) return
  // The clipboard change of this text is not read again.
  clip.wrote = text
  clip.seen = text
  const copied = await copy($, { text, surface })
  toast($, copied.isCopied ? `Intelligent UI: copied ${text.length} chars of text` : `Intelligent UI: the copy failed: ${copied.reason}`)
  if (S.debug) void traceCopy($, text, performance.now() - t, read, probed)
}

// The trace of a copy: the time from the up to the copy, whether the words
// were there, and whether Claude Code has a selection of its own with
// picture cells (a native selection: it copies them itself).
async function traceCopy($: EngineInterface, text: string, total: number, read: number, probed: readonly number[]) {
  const native = await uiSelection($).catch(() => undefined)
  const seen = native && hasPlaceholders(native.text) ? `native selection seen (${Array.from(native.text).length} code points with picture cells)` : 'no native selection'
  const words = probed.length ? `words probed for page ${probed.join(', ')}` : 'words cached'
  traceDebug($, `select: copy ${text.length} chars ${Math.round(total)}ms after the up (text ${Math.round(read)}ms, ${words}); ${seen}`)
}

// Picture select now, for /iui details: on, or why it is off.
function selectState(): string {
  if (S.cacheProblem) return `off (${S.cacheProblem})`
  if (!S.select) return 'off (/iui select off)'
  if (picked.isBroken) return 'off until a reload (its Client failed: see the debug log)'
  if (!needsSelect(S.engine)) return `off (Claude Code ${S.engine || 'of an unknown version'}; it needs ${SELECT_SINCE} or newer)`
  if (S.env && (!S.env.canDraw || S.env.inline)) return 'off (no pictures drawn from files here)'
  if (S.isFullscreen === false) return 'off on the main screen (use /tui fullscreen, or /iui grab)'
  return S.isFullscreen === null ? 'on in fullscreen (the screen is not known yet)' : 'on'
}

// No selection drawn, and no hover tint (a new turn, typing in the prompt,
// a native selection, Intelligent UI or select off).
function clearSelection($: EngineInterface) {
  stopNative()
  hovered.at = null
  if (!picked.now && !hovered.lit) return
  picked.now = null
  hovered.lit = null
  redrawSelection($)
}

// Intelligent UI or picture select off: no selection, and the page cache
// let go (its pages, its build, its pump).
function releaseSelect($: EngineInterface) {
  clearSelection($)
  forgetPages()
}

// `/iui theme [name]`, one at a time (`themeRuns`): an older one still
// reading the themes or measuring fonts would write its look, metrics,
// epoch and stored name over a newer one's.
let themeRuns: Promise<unknown> = Promise.resolve()
function runTheme($: EngineInterface, name: string | undefined): Promise<string> {
  const run = themeRuns.then(() => setTheme($, name))
  themeRuns = run.catch(() => undefined)
  return run
}

async function setTheme($: EngineInterface, name: string | undefined): Promise<string> {
  const ready = await setUp($)
  const was = S.look
  const wanted = name ?? S.look?.name ?? DEFAULT_THEME
  const { themes, problems, chosen } = await applyTheme($, ready.root, ready.home, wanted)
  if (name && chosen.isFallback) {
    if (was) S.look = was
    return `No usable theme named ${name}.\n\n${themeListing(themes, problems, was?.name ?? DEFAULT_THEME, userThemesOf(ready.home), ready.home)}`
  }
  if (S.look?.name !== was?.name || S.look?.dir !== was?.dir || S.look?.stamp !== was?.stamp) {
    // The theme's fonts set the column width and the code size.
    if (ready.typst && S.look) ready.metrics = await measureFonts($, ready.typst, ready.root, ready.cache, ready.termFont, S.look.dir)
    beginEpoch($)
  }
  if (name) await save($, 'theme-name', chosen.name)
  const head = name ? `Theme set to ${chosen.name}.\n\n` : ''
  return `${head}${themeListing(themes, problems, chosen.name, userThemesOf(ready.home), ready.home)}`
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
  // hold no placeholders and pass on as they are. Any copy is the newest:
  // one with placeholders whose words are read when a newer one came is refused.
  on('ui.copy', async ($, e, next) => {
    noteCopied(e.text)
    if (!hasPlaceholders(e.text) || !drawnAnswers.size) {
      copies++
      return next(e)
    }
    if (S.debug) traceDebug($, 'select: native copy seen: a $.ui.copy with picture cells (read as their text)')
    const selection = $.ui.selection().catch(() => undefined)
    const turn = takeTurn($, selection.then(nativeKey))
    const selected = await selection
    clip.raw = e.text
    clip.rawRow = selected?.text === e.text ? selected.requestId : undefined
    const read = await readCopy($, e.text, clip.rawRow)
    if (!(await isNewest($, turn))) return { value: { isCopied: false, reason: 'refused' } }
    if (!read.resolved) return next(e)
    // The clipboard change of this write is not read again.
    clip.wrote = read.text
    clip.seen = read.text
    noteCopied(read.text)
    return next({ ...e, text: read.text })
  }).catch(($, e, next) => next(e))

  // Picture select's posts (hooks/sel.tsx); any other post passes on.
  on('ui.message', async ($, e, next) => {
    const post = e.surface === 'terminal' ? postOf(e.data) : null
    if (!post) return next(e)
    try {
      onSelect($, post, e.surface)
    } catch {}
    return {}
  }).catch(($, e, next) => next(e))

  // A Client that failed: picture select is off until a reload (the engine
  // draws the row again, with no Client).
  on('ui.fault', async ($, e, next) => {
    if (e.module.endsWith('sel.tsx')) {
      picked.isBroken = true
      releaseSelect($)
      // The rows drawn again with no Client.
      refresh($)
      void Promise.resolve($.ui.log(`Intelligent UI: picture select is off (${e.phase}: ${e.reason})`, { to: 'debug' })).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Typing in the main prompt takes a picture selection down (a key that
  // edits, not a bare cursor move); the edit passes on as it is.
  on('prompt.edit', async ($, e, next) => {
    if (picked.now && (e.inputText || e.end > e.start)) clearSelection($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A change of the prompt box no edit carried (a recalled entry, an undo, a
  // clear): the same, but not another plugin's fill. Observe only.
  on('prompt.change', async ($, e, next) => {
    if (picked.now && e.origin.kind !== 'plugin' && e.origin.kind !== 'app') clearSelection($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Typeahead for /iui arguments; the theme list is the last scan's.
  on('prompt.autocomplete', async ($, e, next) => {
    const got = await next(e)
    if (!/^\s*\/iui(\s|$)/.test(e.text)) return got
    if (!S.themeChoices.length) await setUp($).catch(() => null)
    await loadUpdates($)
    const mine = commandSuggestions(e.text, e.token, e.start, {
      themes: S.themeChoices, active: S.look?.name ?? DEFAULT_THEME, size: S.size, width: S.width, height: S.height, grid: S.grid, updates: S.updates, select: S.select,
    })
    return mine.length ? { suggestions: [...got.suggestions, ...mine] } : got
  })

  on('command.run', { command: 'iui' }, async ($, e) => {
    const asked = parseCommand(e.args)
    if (asked.kind === 'grab') return { text: await grab($) }
    if (asked.kind === 'dump') return { text: await dump($, await read($, isOn)) }
    if (asked.kind === 'on' || asked.kind === 'off') {
      settingsSet.add('enabled')
      await update($, isOn, () => asked.kind === 'on')
      // On: the clipboard part starts with the next picture drawn.
      if (asked.kind === 'off') {
        stopClipboard($)
        releaseSelect($)
      }
      await $.store.set('enabled', asked.kind === 'on')
      return { text: `Intelligent UI is ${asked.kind}.` }
    }
    if (asked.kind === 'size') {
      // The epoch begins with the setting, so no row draws it with no epoch
      // open (the store write waits for the host).
      S.size = asked.percent
      settingsSet.add('size')
      beginEpoch($)
      await $.store.set('size', S.size)
      return { text: `Intelligent UI draws text at ${S.size}% of the terminal's text size (100% matches it).` }
    }
    if (asked.kind === 'width') {
      if (asked.width === undefined) await setUp($).catch(() => null)
      else {
        S.width = asked.width
        settingsSet.add('width')
        beginEpoch($)
        await $.store.set('width', S.width)
      }
      const most = typeof S.width === 'number' && S.width > IMAGE_MAX_COLUMNS ? ` (a picture is ${IMAGE_MAX_COLUMNS} columns at most)` : ''
      const head = asked.width === undefined ? 'The most columns a picture takes' : 'Intelligent UI pictures now take at most'
      return { text: `${head}: ${widthText(S.width)}${most}. Use /iui width <${MIN_WIDTH}-${MAX_WIDTH}> for a cap, or /iui width full (the default) for no cap.` }
    }
    if (asked.kind === 'height') {
      if (asked.height === undefined) await setUp($).catch(() => null)
      else {
        S.height = asked.height
        settingsSet.add('height')
        beginEpoch($)
        await $.store.set('height', S.height)
      }
      const head = asked.height === undefined ? 'The most rows an image or a Typst drawing takes' : 'Intelligent UI images and Typst drawings now take at most'
      return { text: `${head}: ${heightText(S.height)}. This applies to images (sent or pasted) and to Typst drawings in answers. Use /iui height half (the default), /iui height full, or /iui height <${MIN_HEIGHT}-${MAX_HEIGHT}> (never more than full).` }
    }
    if (asked.kind === 'grid') {
      if (asked.grid === undefined) await setUp($).catch(() => null)
      else {
        S.grid = asked.grid
        settingsSet.add('grid')
        beginEpoch($)
        await $.store.set('grid', S.grid)
      }
      const head = asked.grid === undefined ? 'The row grid is' : 'The row grid is now'
      return { text: `${head} ${gridText(S.grid)}. With the grid on, a mouse selection over a picture covers the lines it copies. Use /iui grid on (the default), or /iui grid off.` }
    }
    if (asked.kind === 'select') {
      if (asked.on === undefined) await setUp($).catch(() => null)
      else {
        S.select = asked.on
        settingsSet.add('select')
        if (!S.select) releaseSelect($)
        refresh($)
        await $.store.set('select', S.select)
      }
      const head = asked.on === undefined ? 'Picture select is' : 'Picture select is now'
      return { text: `${head} ${selectText(S.select)}. When on, a mouse drag over a picture selects its text and copies it. Use /iui select on (the default), or /iui select off.` }
    }
    if (asked.kind === 'updates') {
      await loadUpdates($)
      if (asked.on !== undefined) {
        S.updates = asked.on
        await $.store.set('updates', S.updates)
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
    if (asked.kind === 'theme') return { text: await runTheme($, asked.name) }
    const state = (await read($, isOn)) ? 'on' : 'off'
    const ready = await setUp($)
    const bad = asked.kind === 'bad' ? `Not understood: "${e.args.trim()}".\n` : ''
    const theme = S.look?.name ?? DEFAULT_THEME
    if (asked.kind === 'details') {
      // A measure with no term metrics: Typst does not have the font (it would fall back).
      const missing = !!ready.typst && ready.metrics !== DEFAULT_METRICS && !ready.metrics.term
      const font = !ready.termFont
        ? `terminal font not known (${ready.isMac ? 'Menlo' : "the theme's code font"} assumed)`
        : `terminal font ${ready.termFont}${missing ? " (Typst does not have this font, so the pictures use the theme's fonts)" : ''}`
      const typst = ready.typst ? `Typst: ${ready.typst}` : `Typst: not found (${typstHintOf(ready.isMac)})`
      const terminal = S.cacheProblem
        ? `Intelligent UI draws no pictures: ${S.cacheProblem} (it never uses a shared folder instead)`
        : ready.canDraw
        ? `this terminal draws pictures${ready.inline ? ' (over ssh, sent as bytes)' : ''}`
        : 'Claude Code draws no pictures here (it does in kitty and Ghostty, in iTerm2 3.6+ and Rio 0.5.27+ with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1, over ssh when TERM names kitty or Ghostty or with that variable; never in tmux, screen or a background session; not in WezTerm, Warp, Konsole or others), so answers stay text'
      await clipWayReady()
      const auto = `Picture select: ${selectState()}\n/iui grab hint: ${hintOf(state === 'on')}`
      const updates = `Update checks: ${updateLine(await updateState($))}`
      return { text: `Intelligent UI is ${state}, theme ${theme}, ${modeLine(S.theme, S.setting, S.settingRaw, S.host)}, text size ${S.size}%, width ${widthText(S.width)}, image and drawing height ${heightText(S.height)}, row grid ${S.grid ? 'on' : 'off'}, picture select ${S.select ? 'on' : 'off'}, ${font}. ${typst}; ${terminal}.\n${auto}\n${updates}` }
    }
    // The short state: what is set, and only the problems that keep pictures away.
    const sized = (v: number | 'full' | 'half', unit: string) => (typeof v === 'number' ? `${v} ${unit}` : v)
    const lines = [`Intelligent UI is ${state}: theme ${theme}, ${S.theme}, text ${S.size}%, width ${sized(S.width, 'columns')}, height ${sized(S.height, 'rows')}, grid ${S.grid ? 'on' : 'off'}.`]
    if (S.cacheProblem) lines.push(`No pictures: ${S.cacheProblem}. See /iui details.`)
    else if (S.setupNeeded) lines.push('In iTerm2, run /iui setup once to show pictures.')
    else if (!ready.canDraw) {
      const where = ready.isMac ? 'kitty, Ghostty and iTerm2 3.6+' : 'kitty and Ghostty, and in Rio with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1'
      lines.push(`This terminal shows no pictures, so answers stay text. Pictures show in ${where}.`)
    }
    if (!ready.typst) lines.push(`Typst is not installed, so answers stay text. Install it: ${typstHintOf(ready.isMac)}`)
    const notice = updateNotice(await updateState($))
    if (notice) lines.push(notice)
    lines.push('Change: /iui on | off | size | width | height | grid | select | updates | theme. More: /iui details')
    return { text: bad + lines.join('\n') }
  }).catch(($, e, next) => next(e))

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
      noteCopy($, e.requestId, () => {
        noteDrawnAgain(e.requestId, roomColumns(e.viewport), { top: MARGIN_TOP, after: kept.after })
        noteOnScreen(e.requestId, e.props.onScreen)
      })
      return kept.tree
    }
    const drawing = await pagesOf($, { id: e.requestId, text: e.props.text, frame: frameFor(e.viewport), env: ready.env, canStream: true, onScreen })
    if (drawing.kind === 'pages') {
      const links = await linksFor($, e.props.text, ready.env.cwd)
      const tree = drawPages($, e, drawing.result, drawing.bytes, { bullet, links, id: e.requestId })
      const { result } = drawing
      const after = linkRowsOf(links, takesSelect($, e, drawing.bytes))
      noteCopy($, e.requestId, () => {
        noteDrawn(e.requestId, result, roomColumns(e.viewport), { top: MARGIN_TOP, after })
        noteOnScreen(e.requestId, e.props.onScreen)
      })
      memoSet(answers, e.requestId, k, { tree, after })
      return tree
    }
    answers.delete(e.requestId)
    if (drawing.kind === 'text') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // The files Claude sends with SendUserFile, under the result row that lists
  // them: PNG, JPEG, WebP and SVG images, one page of each PDF (with a control
  // line to turn the pages), and Markdown files drawn as an answer is (all
  // but a PNG need Typst). Its ToolUse row draws no attachments, and the tool is
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
        const k = { text: files.map(f => `${f.kind}:${f.path}`).join('\n'), extra: pdfPagesOf(id, files), stamp: stampOf(ready, e.viewport), onScreen }
        // Its jobs: one per Markdown file (pagesOf's id `file:<id>:<path>`).
        const kept = memoOf(unders, id, k, requestId => requestId.startsWith(`file:${id}:`))
        // Each Markdown file's pages with the rows drawn after them (rowsAfter:
        // no link rows where they take picture select) and the row's rows on
        // screen, at each draw.
        const room = roomColumns(e.viewport)
        const isSelect = takesSelect($, e)
        if (kept) {
          under = kept
          kept.forEach((u, i) => {
            if (!('drawing' in u)) return
            noteCopy($, u.id, () => {
              noteDrawnAgain(u.id, room, { after: rowsAfter(kept, i, room, isSelect) })
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
            noteCopy($, u.id, () => {
              noteDrawn(u.id, result, room, { after: rowsAfter(drawn, i, room, isSelect) })
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

  // The page field of a PDF under a SendUserFile row (pictures.tsx askPage):
  // the pane PAGE_PANE, named as a literal so the validator reads it.
  on('ui.render', { component: 'Pane', requestId: 'iui-page' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    return drawPageField($, e)
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
    if (e.agentId === undefined) clearSelection($)
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
      // `done` first: a plan set (and refreshed) after this read draws the row again.
      const ready = await answerEnv($, e)
      const plan = ready ? planShownOf(editedPlans.get(e.props.tool_use_id), e.props.output, e.props.input) : ''
      if (!ready || !plan) return row
      const { drawing, links } = await planDrawing($, e, e.props.tool_use_id, plan, ready)
      // Its pages can be copied as an answer's, by the call's id (the row's
      // requestId can be an answer's own). The engine's row is above them:
      // their place is read from the bottom (pageTopsOf), under them its
      // link rows (none where they take picture select).
      if (drawing.kind === 'pages') {
        const { result } = drawing
        const id = `plan:${e.props.tool_use_id}`
        const after = linkRowsOf(links, takesSelect($, e, drawing.bytes))
        noteCopy($, id, () => {
          noteDrawn(id, result, roomColumns(e.viewport), { after })
          noteOnScreen(id, e.props.onScreen)
        })
      }
      return drawPlanUse($, e, row, drawing, links, `plan:${e.props.tool_use_id}`)
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
  // failure: no verdict, and the engine's dialog asks. The engine may run
  // two calls at once, and a PermissionRequest does not say which call it
  // is for: a call that begins while another runs asks nothing (the
  // engine's dialog asks), and no verdict is used while two run.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    if (e.agentId) {
      subagentPlans.add(e.tool_use_id)
      return next(e)
    }
    S.plansLive++
    try {
      if (S.plansLive > 1) return await next(e)
      S.planVerdict = null
      let verdict: PlanVerdict | null = null
      try {
        const ready = await planEnv($)
        const callPlan = ready ? planInputOf(e) : ''
        if (ready && callPlan) {
          const id = e.tool_use_id
          const file = planFileOf(e)
          const plan = await currentPlan($, file, callPlan)
          // Always: the row's input is the message's copy, read before an Edit in the same message.
          editedPlans.set(id, plan)
          refresh($)
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
    } finally {
      S.plansLive--
    }
  }).catch(($, e, next) => next(e))

  // The PermissionRequest of that call: Intelligent UI's verdict at once (the
  // engine's dialog never shows), else the engine's flow (also while two
  // calls run: the verdict may be the other call's).
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.tool_name !== 'ExitPlanMode' || e.agent_id || !S.planVerdict || S.plansLive !== 1) return next(e)
    const verdict = S.planVerdict
    S.planVerdict = null
    return { decision: decisionOf(verdict, e.tool_input) }
  }).catch(($, e, next) => next(e))
}
