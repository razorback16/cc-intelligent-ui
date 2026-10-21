// The plan of plan mode: Intelligent UI's own approval flow for the main loop's
// ExitPlanMode, and the plan drawn as pictures in its transcript row.
//
// The engine's approval dialog cannot be drawn by a plugin, so the mod asks
// first: the `tool.call` hook on ExitPlanMode asks its own question (decidePlan)
// before the engine raises PermissionRequest, and keeps the verdict. The
// PermissionRequest hook then answers with it at once (decisionOf), so the
// engine's dialog never shows. An allow is honoured for this tool only with
// `updatedInput`, and its `setMode` ends plan mode. The rendered plan is in
// the ExitPlanMode ToolUse row, which the engine draws above the question.
import type { EngineInterface, PermissionRequestDecision, RenderComponent, RenderElement, RenderViewport, ResolveInput } from 'claude-code'

import { GUTTER, bulletOf } from './settings'
import { S, writesLive } from './state'
import { firstLine } from './markdown'
import type { Drawing } from './answer'
import { drawPages, type ShownLink } from './draw'
import { clockAfter, commandRun, envGet, fsRead, processRun, submit, turnAbort, uiAsk, uiResolve } from './api'

// The question's chip and its two wordings.
export const PLAN_HEADER = 'Plan'
export const PLAN_QUESTION = 'Approve this plan?'
export const PLAN_QUESTION_EDITED = 'Approve the edited plan?'
// The options, in order (4 is the most the dialog takes).
export const PLAN_AUTO = 'Yes, auto-accept edits'
export const PLAN_MANUAL = 'Yes, manually approve edits'
export const PLAN_CLEAR = 'Yes, clear context + auto-accept'
export const PLAN_EDIT = 'Edit the plan'
// The line above Intelligent UI's question (the dialog takes 12 rows at most
// around it, so the plan itself is in the ToolUse row above).
export const PLAN_ASK_LINE = 'Intelligent UI: the rendered plan is above'
// The line in the ToolUse row while the plan's pictures compile.
export const PLAN_DRAWING = 'Intelligent UI: drawing the plan...'
// What the model reads when the person rejects the plan (Esc) or types changes.
export const PLAN_REJECTED = 'The user rejected the plan.'
export const PLAN_FEEDBACK = 'The user wants changes to the plan:'
// The prompt that starts the new context of "clear context".
export const PLAN_IMPLEMENT = 'Implement this plan:'
// How long an editor may keep the plan file open (10 minutes, process.run's most).
export const EDIT_TIMEOUT_MS = 600000
// How long the plan waits for a Write or Edit of its file still running.
export const PLAN_WRITE_WAIT_MS = 5000
export const PLAN_WRITE_POLL_MS = 25
// The delay before "clear context" acts: `$.command.run` rejects inside a hook
// the turn waits on, so it runs detached once the call has resolved.
export const CLEAR_DELAY_MS = 50

// ---- Pure helpers -------------------------------------------------------------

// A path with `.`, `..` and repeated `/` resolved (no file system call).
export function normalPath(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop()
      else if (!isAbsolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  return (isAbsolute ? '/' : '') + parts.join('/')
}

// The plan an ExitPlanMode result shows, or null: none, an empty one, a
// subagent's or a teammate's (sent to its lead, not approved here).
export function planOf(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null
  const o = output as { plan?: unknown; isAgent?: unknown; awaitingLeaderApproval?: unknown }
  if (o.isAgent === true || o.awaitingLeaderApproval === true) return null
  return typeof o.plan === 'string' && o.plan.trim() ? o.plan : null
}

// The plan an ExitPlanMode call carries (the engine adds it to the call, and
// to the row's input, before it asks), or '' when there is none.
export function planInputOf(input: unknown): string {
  const plan = input && typeof input === 'object' ? (input as { plan?: unknown }).plan : undefined
  return typeof plan === 'string' && plan.trim() ? plan : ''
}

// The plan file an ExitPlanMode call names, or ''.
export function planFileOf(input: unknown): string {
  const file = input && typeof input === 'object' ? (input as { planFilePath?: unknown }).planFilePath : undefined
  return typeof file === 'string' && file.startsWith('/') ? file : ''
}

// The plan a row of the call shows: '' for a subagent's or a teammate's
// result; else the result's (the approved text, also an edit in the
// engine's dialog), else the text the mod read or edited, else the call's.
export function planShownOf(edited: string | undefined, output: unknown, input: unknown): string {
  if (output && typeof output === 'object') {
    const o = output as { isAgent?: unknown; awaitingLeaderApproval?: unknown }
    if (o.isAgent === true || o.awaitingLeaderApproval === true) return ''
  }
  return planOf(output) ?? (edited?.trim() ? edited : planInputOf(input))
}

// A path as the person reads it: `~/...` under the home folder.
export function shortPath(path: string, home: string): string {
  const h = normalPath(home)
  return home && h !== '/' && path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path
}

// The question's options: the edit option only when an editor can open the file.
export const planOptions = (canEdit: boolean): string[] => [PLAN_AUTO, PLAN_MANUAL, PLAN_CLEAR, ...(canEdit ? [PLAN_EDIT] : [])]

// What an answer means. Any other answer (the dialog's "Type something",
// "Chat about this") is the person's words about the plan.
export type PlanChoice = { kind: 'auto' | 'manual' | 'clear' | 'edit' } | { kind: 'feedback'; text: string }
export function choiceOf(answer: string, canEdit: boolean): PlanChoice {
  if (answer === PLAN_AUTO) return { kind: 'auto' }
  if (answer === PLAN_MANUAL) return { kind: 'manual' }
  if (answer === PLAN_CLEAR) return { kind: 'clear' }
  if (answer === PLAN_EDIT && canEdit) return { kind: 'edit' }
  return { kind: 'feedback', text: answer.trim() }
}

// The deny reason the model reads for the person's words: it stays in plan
// mode and revises.
export const feedbackOf = (text: string) => (text ? `${PLAN_FEEDBACK} ${text}` : `${PLAN_FEEDBACK.slice(0, -1)}.`)

// The verdict the mod's question gave, kept for the PermissionRequest that
// follows: approve (in a mode, with the plan, edited or not; `clear` starts a
// new context once the call resolves), or reject and stop the turn (Esc).
export type PlanVerdict =
  | { kind: 'allow'; mode: 'acceptEdits' | 'default'; plan: string; isEdited: boolean; clear: boolean }
  | { kind: 'deny'; message: string }

export function verdictOf(choice: PlanChoice, plan: string, isEdited: boolean): PlanVerdict | null {
  if (choice.kind === 'auto' || choice.kind === 'clear') return { kind: 'allow', mode: 'acceptEdits', plan, isEdited, clear: choice.kind === 'clear' }
  if (choice.kind === 'manual') return { kind: 'allow', mode: 'default', plan, isEdited, clear: false }
  return null
}

// The PermissionRequest decision of a verdict. An allow carries the input
// (the engine honours an allow of this tool only with `updatedInput`), the
// edited plan in it, and the mode that ends plan mode.
export function decisionOf(verdict: PlanVerdict, toolInput: unknown): PermissionRequestDecision {
  if (verdict.kind === 'deny') return { behavior: 'deny', message: verdict.message, interrupt: true }
  const input = toolInput && typeof toolInput === 'object' ? { ...(toolInput as Record<string, unknown>) } : {}
  if (verdict.isEdited) input.plan = verdict.plan
  return { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: verdict.mode, destination: 'session' }] }
}

// The editor that opens the plan file and waits until it is closed: VS Code
// (`code --wait`) when it is on the PATH, else TextEdit on a Mac (`open -W`
// waits until TextEdit quits), else on Linux a GUI editor that waits
// (`gui`: its path and flag, LINUX_EDITORS). Not over ssh, where TextEdit
// or the GUI editor is the remote computer's. A mod has no terminal, so no
// terminal editor; xdg-open does not wait, so it is not used.
export function editorArgv(o: { code: string; isMac: boolean; isRemote: boolean; gui?: readonly string[] }, file: string): string[] | null {
  if (o.code) return [o.code, '--wait', file]
  if (o.isMac && !o.isRemote) return ['open', '-W', '-t', file]
  if (!o.isMac && !o.isRemote && o.gui?.length) return [...o.gui, file]
  return null
}

// The GUI editors on Linux that can wait until the file is closed, in the
// order they are looked for, with the flag that makes them wait.
export const LINUX_EDITORS: readonly (readonly [string, string])[] = [
  ['codium', '--wait'], ['zed', '--wait'], ['zeditor', '--wait'], ['subl', '--wait'], ['kate', '--block'], ['gedit', '--wait'], ['gvim', '-f'],
]
// Prints `name path` for the first editor of LINUX_EDITORS on the PATH.
const GUI_EDITOR_SH = `for c in ${LINUX_EDITORS.map(([name]) => name).join(' ')}; do p=$(command -v "$c" 2>/dev/null) && { echo "$c $p"; break; }; done`

// The editor of GUI_EDITOR_SH's output: its path and its flag; [] for none.
export function guiEditorOf(stdout: string): string[] {
  const m = /^(\S+) (\/.*)$/.exec(firstLine(stdout))
  const flag = m ? LINUX_EDITORS.find(([name]) => name === m[1])?.[1] : undefined
  return m && flag ? [m[2]!, flag] : []
}

// ---- The flow -----------------------------------------------------------------

// The `code` command's path ('' when none), looked up once per load.
async function findCode($: EngineInterface): Promise<string> {
  if (S.planCode !== null) return S.planCode
  let found = ''
  for (const flag of ['-lc', '-c']) {
    const got = await processRun($, ['sh', flag, 'command -v code'], { timeoutMs: 5000 }).catch(() => null)
    const path = got?.exitCode === 0 ? firstLine(got.stdout) : ''
    if (path.startsWith('/')) {
      found = path
      break
    }
  }
  S.planCode = found
  return found
}

// On Linux with a display (X11 or Wayland), a GUI editor that waits
// ([] when none), looked up once per load.
async function findGuiEditor($: EngineInterface): Promise<string[]> {
  if (S.planGui !== null) return S.planGui
  let found: string[] = []
  if ((await envGet($, 'WAYLAND_DISPLAY')) || (await envGet($, 'DISPLAY'))) {
    for (const flag of ['-lc', '-c']) {
      const got = await processRun($, ['sh', flag, GUI_EDITOR_SH], { timeoutMs: 5000 }).catch(() => null)
      found = got?.exitCode === 0 ? guiEditorOf(got.stdout) : []
      if (found.length) break
    }
  }
  S.planGui = found
  return found
}

// What the mod's question decided: a verdict for the PermissionRequest, or
// the person's words (a deny of the call: Claude revises the plan).
export type PlanOutcome = { kind: 'verdict'; verdict: PlanVerdict } | { kind: 'feedback'; message: string }

// Asks the mod's question about the plan, as often as the person edits it.
// `plan` is the text to ask about, `callPlan` the one the call carried (an
// approval sends `plan` when they differ). `onEdited` gets each edited text
// (the ToolUse row draws it). Esc (the ask rejects; in a terminal session
// that is a dismissal) rejects the plan.
export async function decidePlan(
  $: EngineInterface,
  o: { plan: string; callPlan: string; file: string; isMac: boolean; isRemote: boolean; onEdited: (plan: string) => void },
): Promise<PlanOutcome> {
  const code = o.file ? await findCode($) : ''
  const gui = o.file && !code && !o.isMac && !o.isRemote ? await findGuiEditor($) : []
  const argv = o.file ? editorArgv({ code, isMac: o.isMac, isRemote: o.isRemote, gui }, o.file) : null
  const canEdit = !!argv
  let plan = o.plan
  let isEdited = false
  for (;;) {
    const question = isEdited ? PLAN_QUESTION_EDITED : PLAN_QUESTION
    let answer: string
    S.planAsking = question
    try {
      answer = await uiAsk($, question, { header: PLAN_HEADER, options: planOptions(canEdit) })
    } catch {
      return { kind: 'verdict', verdict: { kind: 'deny', message: PLAN_REJECTED } }
    } finally {
      S.planAsking = ''
    }
    const choice = choiceOf(answer, canEdit)
    if (choice.kind === 'feedback') return { kind: 'feedback', message: feedbackOf(choice.text) }
    if (choice.kind !== 'edit') return { kind: 'verdict', verdict: verdictOf(choice, plan, plan !== o.callPlan)! }
    await processRun($, argv!, { timeoutMs: EDIT_TIMEOUT_MS }).catch(() => null)
    const text = await fsRead($, o.file).catch(() => null)
    if (typeof text === 'string' && text.trim() && text !== plan) {
      plan = text
      isEdited = text !== o.plan
      o.onEdited(plan)
    }
  }
}

// The plan file's text once no Write or Edit of it is still running (at most
// PLAN_WRITE_WAIT_MS): Claude may write the plan and call ExitPlanMode in one
// message, and the call then carries the file as it was before the write.
// 2.1.306 reads it again for the call, but the row's input stays the streamed copy.
// `fallback` when the file can't be read.
export async function currentPlan($: EngineInterface, file: string, fallback: string): Promise<string> {
  if (!file) return fallback
  for (let waited = 0; (writesLive.get(file) ?? 0) > 0 && waited < PLAN_WRITE_WAIT_MS; waited += PLAN_WRITE_POLL_MS) {
    await new Promise<void>(resolve => clockAfter($, PLAN_WRITE_POLL_MS, resolve))
  }
  const text = await fsRead($, file).catch(() => null)
  return typeof text === 'string' && text.trim() ? text : fallback
}

// "Clear context": once the approved call has resolved, ends the turn, runs
// /clear and sends the plan as the new context's first prompt. Detached, as
// `$.command.run` rejects inside a hook the turn waits on.
export function scheduleClear($: EngineInterface, plan: string, turnId: string) {
  clockAfter($, CLEAR_DELAY_MS, async () => {
    if (turnId) await turnAbort($, { turnId }).catch(() => undefined)
    await commandRun($, { command: 'clear' }).catch(() => undefined)
    await submit($, { text: `${PLAN_IMPLEMENT}\n\n${plan}`, asUser: true }).catch(() => undefined)
  })
}

// ---- Drawing ------------------------------------------------------------------

type Terminal = ResolveInput<RenderComponent, 'terminal'> & { viewport?: RenderViewport }

// The ExitPlanMode ToolUse row: the engine's row, then the plan's pages and
// their link rows (a dim line while they compile; the engine's row alone
// when they fail). `id`: the drawing's (picture select).
export function drawPlanUse($: EngineInterface, e: Terminal, row: RenderElement, drawing: Drawing, links: readonly ShownLink[] = [], id?: string): RenderElement {
  if (drawing.kind === 'text') return row
  const { Box, Text } = uiResolve($, e)
  return (
    <Box flexDirection="column">
      {row}
      {drawing.kind === 'pages' ? (
        drawPages($, e, drawing.result, drawing.bytes, { bullet: true, links, ...(id ? { id } : {}) })
      ) : (
        <Box marginTop={1} marginLeft={GUTTER}>
          <Text dimColor>{PLAN_DRAWING}</Text>
        </Box>
      )}
    </Box>
  )
}

// The approved plan's result row without the plan (the ToolUse row above
// draws it): the engine's header and the plan file's path.
export function drawPlanResult($: EngineInterface, e: Terminal, filePath?: string): RenderElement {
  const { Box, Text } = uiResolve($, e)
  const saved = filePath ? shortPath(filePath, S.env?.home ?? '') : ''
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Box width={GUTTER} flexShrink={0}>
          <Text>{bulletOf(S.env?.isMac ?? true)}</Text>
        </Box>
        <Text>User approved Claude's plan</Text>
      </Box>
      {saved ? (
        <Box marginLeft={GUTTER}>
          <Text dimColor wrap="truncate-end">{`Plan saved to: ${saved} · /plan to edit`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// The line Intelligent UI adds above its own question.
export function drawAskLine($: EngineInterface, e: ResolveInput<'AskUserQuestion', 'terminal'>, dialog: RenderElement): RenderElement {
  const { Box, Text } = uiResolve($, e)
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{PLAN_ASK_LINE}</Text>
      {dialog}
    </Box>
  )
}

// Whether an AskUserQuestion dialog is the mod's plan question now asked.
export function isPlanQuestion(questions: unknown, asking: string): boolean {
  if (!asking || !Array.isArray(questions) || questions.length !== 1) return false
  const q = questions[0] as { question?: unknown; header?: unknown } | null
  return !!q && q.question === asking && q.header === PLAN_HEADER
}
