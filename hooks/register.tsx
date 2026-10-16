// md-preview: draws Claude's answers (AssistantMessage blocks) as pictures of
// rendered Markdown, made by Typst from the template in ../render/md.typ.
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
// env, images, pictures, plan (the plan approval flow) and copy (the text
// under a mouse copy of the pictures). This file joins them to the hooks,
// and gives the tests the names they import.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderViewport } from 'claude-code'

import { CLIP_POLL_MS, DEFAULT_THEME, MAX_SIZE, MIN_SIZE, TYPST_PROMPT } from './lib/settings'
import {
  clip, DRAWN_KEPT, drawnAnswers, editedPlans, positionsByDir, refresh, S, subagentPlans, writesLive, type Cell, type Env, type Result,
} from './lib/state'
import { columnsFor } from './lib/terminal'
import { escapeControls, luminanceOf, modeLine, modeOfLuminance, parseOsc11, settingOf } from './lib/mode'
import { applyTheme, themeListing, userThemesOf } from './lib/themes'
import { commandSuggestions, parseCommand, registerCommand } from './lib/command'
import { runSetup } from './lib/setup'
import { pollHost, PROBE_RUNS, probeOsc11, showMode, USE_OSC11, watchHost } from './lib/host'
import { measureFonts, runProbe, type ProbeJob } from './lib/typst'
import { drawPages, rowsFor } from './lib/draw'
import { codePointsOf, decodeSelection, hasPlaceholders, joinSegments, pickPages, textOfRun, type Pick, type Positions, type Segment } from './lib/copy'
import { finalizeAll } from './lib/stream'
import { pagesOf } from './lib/answer'
import { noteViewport, setUp } from './lib/env'
import { pastedImagePath, pastedNumbers, sentFiles } from './lib/images'
import { pasteDir, sentOf, shownOf, underRow, type Shown, type Under } from './lib/pictures'
import {
  currentPlan, decidePlan, decisionOf, drawAskLine, drawPlanResult, drawPlanUse, isPlanQuestion, planFileOf, planInputOf, planOf,
  planShownOf, scheduleClear, type PlanVerdict,
} from './lib/plan'

// The names this module exported before the split (the tests import them).
export {
  BASE_THEME, DEFAULT_CELL, DEFAULT_SIZE, DEFAULT_THEME, MAX_COLUMNS, MAX_SIZE, MIN_SIZE, PICTURE_MAX_ROWS, SEGMENT_ROWS, TYPST_PROMPT,
} from './lib/settings'
export { DEFAULT_METRICS, type Cell, type FontMetrics, type Look, type Metrics } from './lib/state'
export {
  blocksOf, firstLine, imagePathOf, isTypstInfo, localImages, plainOf, rowsOfBlock, splitSegments, type Block,
} from './lib/markdown'
export * from './lib/terminal'
export * from './lib/mode'
export * from './lib/terminals'
export {
  chooseTheme, isSyntaxPath, isThemeName, pickThemes, themeEntry, themeFiles, themeListing,
  type ThemeInfo, type ThemeProblem, type ThemeSyntax,
} from './lib/themes'
export { commandSuggestions, parseCommand, type Command, type Suggestion } from './lib/command'
export { hasSetup, SETUP_END, SETUP_START, setupBlock, shellRcOf, withoutSetup, withSetup, type ShellRc } from './lib/setup'
export { OSC11_PL } from './lib/host'
export { convertCall, measureCall, noNetworkEnv, parseOd, pngSize, probeCall, shouldRetrySafe, typstCall } from './lib/typst'
export { alignFirstLine, firstLineOf, fontFit, hashOf, renderKey, rowsFor, sizing, type FirstLine } from './lib/draw'
export * from './lib/images'
export * from './lib/copy'
export {
  choiceOf, decisionOf, editorArgv, feedbackOf, isPlanQuestion, normalPath, PLAN_ASK_LINE, PLAN_AUTO, PLAN_CLEAR, PLAN_DRAWING, PLAN_EDIT,
  PLAN_FEEDBACK, PLAN_HEADER, PLAN_IMPLEMENT, PLAN_MANUAL, PLAN_QUESTION, PLAN_QUESTION_EDITED, PLAN_REJECTED, planFileOf, planInputOf,
  planOf, planOptions, planShownOf, shortPath, verdictOf, type PlanChoice, type PlanVerdict,
} from './lib/plan'

// The atoms the hooks read and write (a copy of each in this file: see state.ts).
const isOn = atom({ plugin: 'md-preview', key: 'isOn' } as const, true)
const done = atom({ plugin: 'md-preview', key: 'done' } as const, 0)

// ---- Pictures under rows ----------------------------------------------------

// The env to draw pictures with: md-preview on, in a terminal that draws;
// null otherwise (no Typst needed). Here and not in pictures.tsx, as it
// reads the atoms.
async function pictureEnv($: EngineInterface, e: { viewport?: RenderViewport }): Promise<Env | null> {
  if (!(await read($, isOn))) return null
  // Read so the end of setUp draws this row again.
  await read($, done)
  if (!S.env) {
    void setUp($).catch(() => undefined)
    return null
  }
  if (!S.env.canDraw) return null
  if (e.viewport) noteViewport($, e.viewport)
  return S.env
}

// The env to draw Markdown pictures with (an answer, a plan): as
// pictureEnv, and Typst found. Reading `done` draws the reader again when a
// render finishes.
async function answerEnv($: EngineInterface, e: { viewport?: RenderViewport }): Promise<Env | null> {
  const ready = await pictureEnv($, e)
  return ready?.typst ? ready : null
}

// md-preview's own plan question: only on the main loop of a session drawn
// in a terminal, with md-preview on, Typst found and a terminal that draws
// (the plan's pictures need all of them). Null otherwise: the engine's
// dialog asks, as with no mod.
async function planEnv($: EngineInterface): Promise<Env | null> {
  if (!(await read($, isOn))) return null
  const surfaces = await $.session.surfaces().catch(() => [] as readonly string[])
  if (!surfaces.includes('terminal')) return null
  const ready = S.env ?? (await setUp($).catch(() => null))
  return ready?.typst && ready.canDraw ? ready : null
}

// ---- Copy -----------------------------------------------------------------
// A mouse copy over a picture puts kitty placeholder cells on the clipboard,
// and no hook sees that copy, so the clipboard is read afterwards (pbpaste,
// every CLIP_POLL_MS on macOS) and, when it holds placeholders, written
// again with the words under them (see lib/copy.ts).

// An answer's pages as drawn: kept by requestId, newest last. A redraw with
// the same pages keeps its place, so `seq` is when it was first drawn so.
function noteDrawn(id: string, result: Result, columns: number, px: Cell) {
  const pages = result.pages.map(p => ({ file: p.file, width: p.width, height: p.height, rows: rowsFor(p, columns, px) }))
  const dir = result.pages[0]?.file.replace(/\/[^/]*$/, '') ?? ''
  const was = drawnAnswers.get(id)
  if (was && was.dir === dir && was.columns === columns && was.pages.every((p, i) => p.rows === pages[i]?.rows)) return
  drawnAnswers.delete(id)
  drawnAnswers.set(id, { id, seq: ++clip.seq, columns, dir, pages })
  for (const old of drawnAnswers.keys()) {
    if (drawnAnswers.size <= DRAWN_KEPT) break
    drawnAnswers.delete(old)
  }
}

// An answer folder's word positions: positions.json, else the probe run now
// (from probe.json: a key compiled before this load, or a probe not done yet).
async function positionsFor($: EngineInterface, dir: string): Promise<Positions | null> {
  const known = positionsByDir.get(dir)
  if (known) return known
  let got: Positions | null = null
  const kept = await $.fs.read(`${dir}/positions.json`).catch(() => null)
  try {
    if (kept) got = JSON.parse(kept) as Positions
  } catch {}
  if (!got) {
    const probe = await $.fs.read(`${dir}/probe.json`).catch(() => null)
    try {
      if (probe) got = await runProbe($, dir, JSON.parse(probe) as ProbeJob)
    } catch {}
  }
  if (got) positionsByDir.set(dir, got)
  return got
}

type CopyRead = { text: string; segments: Segment[]; picks: Pick[]; runs: number; resolved: number }

// The text for a clipboard (or selection) text with placeholders.
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
    const positions = await positionsFor($, d.dir)
    const text = positions ? textOfRun(seg.lines, positions.pages[pick.page] ?? [], positions.blocks, page, d.columns) : ''
    if (text) resolved++
    texts.push(text || null)
  }
  const runs = segments.filter(seg => seg.kind === 'image').length
  const read = { text: joinSegments(segments, texts), segments, picks, runs, resolved }
  clip.last = { requestId: requestId ?? null, ...read, drawn: [...drawnAnswers.values()].map(d => ({ id: d.id, seq: d.seq, columns: d.columns, dir: d.dir, pages: d.pages.map(p => ({ rows: p.rows, width: p.width, height: p.height })) })) }
  return read
}

// One clipboard read: placeholders that are not our own write are read and
// written back as text. Never touches a clipboard with no placeholders.
async function clipTick($: EngineInterface) {
  if (clip.busy) return
  clip.busy = true
  try {
    const got = await $.process.run(['pbpaste'], { timeoutMs: 2000, env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } }).catch(() => null)
    if (!got || got.exitCode !== 0) return
    const text = got.stdout
    if (text === clip.seen) return
    clip.seen = text
    if (text === clip.wrote || !hasPlaceholders(text)) return
    clip.raw = text
    const selected = await $.ui.selection().catch(() => undefined)
    const read = await readCopy($, text, selected && hasPlaceholders(selected.text) ? selected.requestId : undefined)
    if (!read.resolved) {
      $.ui.toast('md-preview: could not read the selected picture (/md-preview dump says why)')
      return
    }
    clip.wrote = read.text
    clip.seen = read.text
    await $.ui.copy({ text: read.text })
    $.ui.toast(`md-preview: copied ${read.text.length} chars of text`)
  } finally {
    clip.busy = false
  }
}

// The watcher: on macOS, on this computer (over ssh pbpaste reads the remote
// one's clipboard). One per load: a hot reload drops the old load's timers.
// A timer whose period was refused stops; one silent for 10 periods is
// started again (`ticked` is when it last ran).
function watchClipboard($: EngineInterface) {
  if (!S.env?.isMac || S.isRemote) return
  if (clip.watch && Date.now() - clip.ticked < 10 * CLIP_POLL_MS) return
  clip.watch?.cancel()
  clip.ticked = Date.now()
  try {
    clip.watch = $.clock.every(CLIP_POLL_MS, () => {
      clip.ticked = Date.now()
      void clipTick($).catch(() => undefined)
    })
  } catch {
    clip.watch = null
  }
}

// /md-preview grab: the last mouse selection, read and copied.
async function grab($: EngineInterface): Promise<string> {
  const selected = await $.ui.selection().catch(() => undefined)
  if (!selected) return 'md-preview: no mouse selection (it needs fullscreen mode; select over a picture first).'
  if (!hasPlaceholders(selected.text)) return `md-preview: the selection has no picture cells; it is ${selected.text.length} chars of text already.`
  clip.raw = selected.text
  const read = await readCopy($, selected.text, selected.requestId)
  if (!read.resolved) return `md-preview: found ${read.runs} picture run(s) but could not read them (see /md-preview dump).`
  clip.wrote = read.text
  clip.seen = read.text
  const copied = await $.ui.copy({ text: read.text })
  return copied.isCopied
    ? `md-preview: copied ${read.text.length} chars (${read.resolved} of ${read.runs} picture runs read${selected.requestId ? `, row ${selected.requestId}` : ''}).`
    : `md-preview: the copy failed: ${'reason' in copied ? String(copied.reason) : 'unknown'}.`
}

// /md-preview dump: the last placeholder text seen, as code points, how
// it was read, and the same in full in <cache>/copy-debug.json.
async function dump($: EngineInterface): Promise<string> {
  if (!clip.raw) return `md-preview: no clipboard text with picture cells seen yet (watcher ${clip.watch ? 'on' : 'off'}; ${drawnAnswers.size} answers drawn).`
  const read = await readCopy($, clip.raw)
  const runs = read.segments
    .map((seg, i) => {
      if (seg.kind === 'text') return `text: ${JSON.stringify(seg.text.slice(0, 60))}`
      const rows = seg.lines.map(l => `${l.row}:${l.colStart}-${l.colEnd}`).join(' ')
      const pick = read.picks[i]
      return `run rows ${rows} -> ${pick ? `answer ${pick.id} page ${pick.page}` : 'no page fits'}`
    })
    .join('\n')
  const cache = S.env?.cache ?? ''
  if (cache) await $.fs.write(`${cache}/copy-debug.json`, JSON.stringify({ raw: clip.raw, codePoints: codePointsOf(clip.raw, 100000), ...(clip.last as object) }, null, 1)).catch(() => undefined)
  return [
    `md-preview: last clipboard with picture cells (${Array.from(clip.raw).length} code points; watcher ${clip.watch ? 'on' : 'off'}):`,
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
    void setUp($).then(() => watchClipboard($)).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    clip.watch?.cancel()
    clip.watch = null
    return next(e)
  })

  // Typeahead for /md-preview arguments; the theme list is the last scan's.
  on('prompt.autocomplete', async ($, e, next) => {
    const got = await next(e)
    if (!/^\s*\/md-preview\s/.test(e.text)) return got
    if (!S.themeChoices.length) await setUp($).catch(() => null)
    const mine = commandSuggestions(e.text, e.token, e.start, { themes: S.themeChoices, active: S.look?.name ?? DEFAULT_THEME, size: S.size })
    return mine.length ? { suggestions: [...got.suggestions, ...mine] } : got
  })

  on('command.run', { command: 'md-preview' }, async ($, e) => {
    const asked = parseCommand(e.args)
    if (asked.kind === 'grab') return { text: await grab($) }
    if (asked.kind === 'dump') return { text: await dump($) }
    if (asked.kind === 'on' || asked.kind === 'off') {
      await update($, isOn, () => asked.kind === 'on')
      await $.store.set('enabled', asked.kind === 'on')
      return { text: `md-preview is ${asked.kind}.` }
    }
    if (asked.kind === 'size') {
      S.size = asked.percent
      await $.store.set('size', S.size)
      refresh($)
      return { text: `md-preview draws text at ${S.size}% of the terminal's text size (100% matches it).` }
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
      if (asked.name) await $.store.set('theme-name', chosen.name)
      if (S.look?.name !== was?.name || S.look?.dir !== was?.dir || S.look?.stamp !== was?.stamp) {
        // The theme's fonts set the column width and the code size.
        if (ready.typst && S.look) ready.metrics = await measureFonts($, ready.typst, ready.root, ready.cache, ready.termFont, S.look.dir)
        refresh($)
      }
      const head = asked.name ? `md-preview uses the theme ${chosen.name}.\n` : ''
      return { text: `${head}${themeListing(themes, problems, chosen.name, userThemesOf(ready.home))}` }
    }
    const state = (await read($, isOn)) ? 'on' : 'off'
    const ready = await setUp($)
    const font = ready.termFont ? `terminal font ${ready.termFont}` : 'terminal font not known (Menlo assumed)'
    const typst = ready.typst ? `Typst: ${ready.typst}` : 'Typst: not found (brew install typst)'
    const terminal = ready.canDraw
      ? `this terminal draws pictures${ready.inline ? ' (over ssh, sent as bytes)' : ''}`
      : 'Claude Code draws no pictures here (it does in kitty and Ghostty, in iTerm2 3.6+ and Rio 0.5.27+ with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1, over ssh when TERM names kitty or Ghostty or with that variable; never in tmux, screen or a background session; not in WezTerm, Warp, Konsole or others), so answers stay text'
    const tried = S.setupNeeded ? ' In iTerm2, run /md-preview setup once to show pictures.' : ''
    const usage = `Use /md-preview on, /md-preview off, /md-preview size <${MIN_SIZE}-${MAX_SIZE}>, or /md-preview theme [name].`
    const bad = asked.kind === 'bad' ? `Not understood: "${e.args.trim()}". ` : ''
    return { text: `${bad}md-preview is ${state}, theme ${S.look?.name ?? DEFAULT_THEME}, ${modeLine(S.theme, S.setting, S.settingRaw, S.host)}, text size ${S.size}%, ${font}. ${typst}; ${terminal}.${tried} ${usage}` }
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
    return { sections: [...composed.sections, { id: 'md-preview:typst', text: TYPST_PROMPT, scope: 'session' as const }] }
  })

  // A main-loop model request: its text blocks are final when the next block
  // (another text block, a tool call, thinking, the stop) starts, and all of
  // them when the request ends, fails or is aborted.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    S.stepsLive++
    let textIndex = -1
    let isDone = false
    // Never let md-preview's own work break Claude's stream.
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
    const columns = columnsFor(e.viewport?.columns)
    const drawing = await pagesOf($, { id: e.requestId, text: e.props.text, columns, env: ready, canStream: true })
    if (drawing.kind === 'pages') {
      try {
        noteDrawn(e.requestId, drawing.result, columns, drawing.px)
        watchClipboard($)
      } catch {}
      return drawPages($, e, drawing.result, columns, drawing.px, drawing.bytes, { bullet: !!e.props.isFirstOfReply })
    }
    if (drawing.kind === 'text') return next(e)
    const { Box } = $.ui.resolve(e)
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
      const markdown = ready && files.some(f => f.kind === 'markdown') ? await answerEnv($, e) : null
      if (ready) under = await sentOf($, e, { ready, markdown, files, id: e.props.tool_use_id })
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
      const dir = ready ? await pasteDir($, ready) : ''
      if (ready && dir) shown = await shownOf($, e, ready, numbers.map(n => pastedImagePath(dir, n)))
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
    watchClipboard($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The ExitPlanMode row, above the question: the engine's row, then the plan
  // as pictures, through the answers' pipeline at an answer's width (the
  // edited text once edited in md-preview's flow). A rejected, aborted or
  // subagent call, and a plan that fails to compile, stay as the engine draws.
  on('ui.render', { component: 'ToolUse', props: { tool: 'ExitPlanMode' } }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isErrored || e.props.isInterrupted || subagentPlans.has(e.props.tool_use_id)) return row
    try {
      const plan = planShownOf(editedPlans.get(e.props.tool_use_id), e.props.output, e.props.input)
      const ready = plan ? await answerEnv($, e) : null
      if (!ready) return row
      const columns = columnsFor(e.viewport?.columns)
      const drawing = await pagesOf($, { id: `plan:${e.props.tool_use_id}`, text: plan, columns, env: ready, canStream: false })
      // Its pages can be copied as an answer's: kept by the call's id, as the
      // row's requestId can be an answer's own.
      if (drawing.kind === 'pages') {
        try {
          noteDrawn(`plan:${e.props.tool_use_id}`, drawing.result, columns, drawing.px)
          watchClipboard($)
        } catch {}
      }
      return drawPlanUse($, e, row, drawing, columns)
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
      const columns = columnsFor(e.viewport?.columns)
      const drawing = ready ? await pagesOf($, { id: `plan:${e.props.tool_use_id}`, text: plan, columns, env: ready, canStream: false }) : null
      const filePath = (e.props.output as { filePath?: unknown }).filePath
      if (drawing && drawing.kind !== 'text') drawn = drawPlanResult($, e, typeof filePath === 'string' ? filePath : undefined)
    } catch {
      drawn = null
    }
    return drawn ?? next(e)
  })

  // One dim line above md-preview's own question (the dialog takes at most 12
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

  // The main loop's ExitPlanMode: md-preview asks first (the engine shows its
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

  // The PermissionRequest of that call: md-preview's verdict at once (the
  // engine's dialog never shows), else the engine's flow.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.tool_name !== 'ExitPlanMode' || e.agent_id || !S.planVerdict) return next(e)
    const verdict = S.planVerdict
    S.planVerdict = null
    return { decision: decisionOf(verdict, e.tool_input) }
  }).catch(($, e, next) => next(e))
}
