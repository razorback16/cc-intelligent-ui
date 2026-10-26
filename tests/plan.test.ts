import { expect, mock, test } from 'claude-code/testing'

import {
  choiceOf, decisionOf, editorArgv, editorWaits, feedbackOf, isPlanQuestion, normalPath, PLAN_ASK_LINE, PLAN_AUTO, PLAN_CLEAR, PLAN_DONE,
  PLAN_DRAW_WAIT_MS, PLAN_DRAWING, PLAN_EDIT, PLAN_EDITED_UNDRAWN, PLAN_EDITING, PLAN_FEEDBACK, PLAN_HEADER, PLAN_MANUAL, PLAN_QUESTION, PLAN_QUESTION_EDITED,
  PLAN_REJECTED, PLAN_REOPEN, planFileOf, planInputOf, planOf, planOptions,
  planShownOf, shortPath, TYPST_PROMPT, verdictOf,
} from '../hooks/register'
// This file's own copy of the flow, driven with a fake `$`: the plugin's module is another one.
import { currentPlan, decidePlan, scheduleClear } from '../hooks/lib/plan'
import { S } from '../hooks/lib/state'

// ---- Pure helpers -----------------------------------------------------------

test('paths are made plain with no file system call', () => {
  expect(normalPath('/h//.claude/./plans/../plans/p.md')).toBe('/h/.claude/plans/p.md')
  expect(normalPath('/../a')).toBe('/a')
  expect(normalPath('a/../../b')).toBe('../b')
})

test('the plan and the plan file an ExitPlanMode call carries', () => {
  expect(planInputOf({ plan: '# Plan', planFilePath: '/h/.claude/plans/p.md' })).toBe('# Plan')
  expect(planInputOf({ plan: '  \n' })).toBe('')
  expect(planInputOf({ allowedPrompts: [] })).toBe('')
  expect(planInputOf(undefined)).toBe('')
  expect(planFileOf({ planFilePath: '/h/.claude/plans/p.md' })).toBe('/h/.claude/plans/p.md')
  expect(planFileOf({ planFilePath: 'p.md' })).toBe('')
  expect(planFileOf({})).toBe('')
})

test('the plan of an ExitPlanMode result: a non-empty one of the main loop only', () => {
  expect(planOf({ plan: '# Plan\n\n1. Do it', isAgent: false })).toBe('# Plan\n\n1. Do it')
  expect(planOf({ plan: '  \n', isAgent: false })).toBe(null)
  expect(planOf({ plan: null, isAgent: false })).toBe(null)
  expect(planOf({ plan: '# Plan', isAgent: true })).toBe(null)
  expect(planOf({ plan: '# Plan', isAgent: false, awaitingLeaderApproval: true })).toBe(null)
  expect(planOf('User rejected the plan')).toBe(null)
  expect(planOf(undefined)).toBe(null)
})

test('the plan a row shows: the result, else the edited text, else the call', () => {
  // The result is the approved text: an edit in the engine's dialog wins over the text read at the call.
  expect(planShownOf('# Edited', { plan: '# Done', isAgent: false }, { plan: '# Asked' })).toBe('# Done')
  expect(planShownOf('# Edited', undefined, { plan: '# Asked' })).toBe('# Edited')
  expect(planShownOf('# Edited', { plan: '', isAgent: false }, { plan: '# Asked' })).toBe('# Edited')
  // A subagent's or a teammate's plan: never drawn, also with a text kept for its call.
  expect(planShownOf('# Edited', { plan: '# Done', isAgent: true }, { plan: '# Asked' })).toBe('')
  expect(planShownOf('# Edited', { plan: '# Done', isAgent: false, awaitingLeaderApproval: true }, { plan: '# Asked' })).toBe('')
  expect(planShownOf(undefined, { plan: '# Done', isAgent: false }, { plan: '# Asked' })).toBe('# Done')
  expect(planShownOf(undefined, undefined, { plan: '# Asked' })).toBe('# Asked')
  expect(planShownOf(undefined, { plan: '# Done', isAgent: true }, { plan: '# Asked' })).toBe('')
  expect(planShownOf(undefined, undefined, {})).toBe('')
})

test('a short path', () => {
  expect(shortPath('/h/.claude/plans/p.md', '/h')).toBe('~/.claude/plans/p.md')
  expect(shortPath('/other/p.md', '/h')).toBe('/other/p.md')
  expect(shortPath('/h/p.md', '')).toBe('/h/p.md')
  expect(shortPath('/h/p.md', '/h/')).toBe('~/p.md')
  expect(shortPath('/h', '/h')).toBe('/h')
  expect(shortPath('/hx/p.md', '/h')).toBe('/hx/p.md')
  expect(shortPath('/h/p.md', '/')).toBe('/h/p.md')
})

test('a path with a trailing slash, a root, an empty path and dots', () => {
  expect(normalPath('/')).toBe('/')
  expect(normalPath('')).toBe('')
  expect(normalPath('/a/')).toBe('/a')
  expect(normalPath('../../a')).toBe('../../a')
  expect(normalPath('a/..')).toBe('')
})

test('the question: four options, the edit option only with an editor; any other answer is feedback', () => {
  expect(planOptions(true)).toEqual([PLAN_AUTO, PLAN_MANUAL, PLAN_CLEAR, PLAN_EDIT])
  expect(planOptions(false)).toEqual([PLAN_AUTO, PLAN_MANUAL, PLAN_CLEAR])
  expect(choiceOf(PLAN_AUTO, true)).toEqual({ kind: 'auto' })
  expect(choiceOf(PLAN_MANUAL, true)).toEqual({ kind: 'manual' })
  expect(choiceOf(PLAN_CLEAR, true)).toEqual({ kind: 'clear' })
  expect(choiceOf(PLAN_EDIT, true)).toEqual({ kind: 'edit' })
  expect(choiceOf(PLAN_EDIT, false)).toEqual({ kind: 'feedback', text: PLAN_EDIT })
  expect(choiceOf(' add tests ', true)).toEqual({ kind: 'feedback', text: 'add tests' })
  expect(feedbackOf('add tests')).toBe('The user wants changes to the plan: add tests')
  expect(feedbackOf('')).toBe('The user wants changes to the plan.')
})

test('a verdict becomes the PermissionRequest decision', () => {
  const input = { plan: '# Plan', planFilePath: '/h/p.md' }
  const auto = verdictOf({ kind: 'auto' }, '# Plan', false)!
  expect(decisionOf(auto, input)).toEqual({
    behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
  })
  const manual = verdictOf({ kind: 'manual' }, '# Edited', true)!
  expect(decisionOf(manual, input)).toEqual({
    behavior: 'allow', updatedInput: { ...input, plan: '# Edited' }, updatedPermissions: [{ type: 'setMode', mode: 'default', destination: 'session' }],
  })
  expect(verdictOf({ kind: 'clear' }, '# Plan', false)).toMatchObject({ kind: 'allow', mode: 'acceptEdits', clear: true })
  expect(verdictOf({ kind: 'edit' }, '# Plan', false)).toBe(null)
  expect(decisionOf({ kind: 'deny', message: PLAN_REJECTED }, input)).toEqual({ behavior: 'deny', message: 'The user rejected the plan.', interrupt: true })
})

test('the editor: VS Code when found, else the text editor on a local Mac, else none', () => {
  expect(editorArgv({ code: '/usr/local/bin/code', isMac: true, isRemote: false }, '/h/p.md')).toEqual(['/usr/local/bin/code', '--wait', '/h/p.md'])
  // Not `open -W`: it waits until the whole app quits, not until the window closes.
  expect(editorArgv({ code: '', isMac: true, isRemote: false }, '/h/p.md')).toEqual(['open', '-t', '/h/p.md'])
  expect(editorWaits(['open', '-t', '/h/p.md'])).toBe(false)
  expect(editorWaits(['/usr/local/bin/code', '--wait', '/h/p.md'])).toBe(true)
  expect(editorWaits(['/usr/bin/gedit', '--wait', '/h/p.md'])).toBe(true)
  expect(editorArgv({ code: '', isMac: true, isRemote: true }, '/h/p.md')).toBe(null)
  expect(editorArgv({ code: '', isMac: false, isRemote: false }, '/h/p.md')).toBe(null)
})

test('the editor on Linux: a GUI editor that waits, never over ssh, VS Code first', () => {
  const gui = ['/usr/bin/gedit', '--wait']
  expect(editorArgv({ code: '', isMac: false, isRemote: false, gui }, '/h/p.md')).toEqual(['/usr/bin/gedit', '--wait', '/h/p.md'])
  expect(editorArgv({ code: '', isMac: false, isRemote: true, gui }, '/h/p.md')).toBe(null)
  expect(editorArgv({ code: '', isMac: false, isRemote: false, gui: [] }, '/h/p.md')).toBe(null)
  expect(editorArgv({ code: '/usr/bin/code', isMac: false, isRemote: false, gui }, '/h/p.md')).toEqual(['/usr/bin/code', '--wait', '/h/p.md'])
  expect(editorArgv({ code: '', isMac: true, isRemote: false, gui }, '/h/p.md')).toEqual(['open', '-t', '/h/p.md'])
})

test('only the question Intelligent UI asks now is the plan question', () => {
  const q = (question: string, header = PLAN_HEADER) => [{ question, header, options: [], multiSelect: false }]
  expect(isPlanQuestion(q(PLAN_QUESTION), PLAN_QUESTION)).toBe(true)
  expect(isPlanQuestion(q(PLAN_QUESTION), '')).toBe(false)
  expect(isPlanQuestion(q(PLAN_QUESTION, 'Other'), PLAN_QUESTION)).toBe(false)
  expect(isPlanQuestion(q('Which one?'), PLAN_QUESTION)).toBe(false)
  expect(isPlanQuestion([...q(PLAN_QUESTION), ...q(PLAN_QUESTION)], PLAN_QUESTION)).toBe(false)
})

test('Claude is told that a plan is drawn like an answer', () => {
  expect(TYPST_PROMPT).toContain('A plan (the plan file you write in plan mode) is drawn the same way when ExitPlanMode asks for approval')
  expect(TYPST_PROMPT).not.toContain('do not use typst blocks')
  expect(TYPST_PROMPT.endsWith('keep replies readable as plain text too.')).toBe(true)
})

// ---- The hooks ----------------------------------------------------------------

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// The first 24 bytes of a 1600 x 64 PNG, as `od -An -v -tx1` prints them.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 00 40'
// The same PNG's first bytes in base64, as a read of a page's bytes gives them (over ssh).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABkAAAABACAYAAAAAAAAA'
const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }
const PLANS = '/h/.claude/plans'
const FILE = `${PLANS}/p.md`
const PLAN = '# Plan\n\n1. Read the code.\n2. Change it.'
const EDITED = '# Plan\n\n1. Read the code.\n2. Change it.\n3. Test it.'

// A Mac terminal that draws (forced), with Typst, session sid-1 in /w/app.
// `answers` answer the mod's questions in order (null: Esc). The engine's
// ExitPlanMode raises PermissionRequest as the engine does: Intelligent UI's
// decision, else the engine's dialog (`engineAsks`, which approves).
function world($: any, on: any, o: {
  vars?: Record<string, string>
  answers?: (string | null)[]
  code?: boolean
  surfaces?: string[]
  edit?: string
  failCompile?: boolean
  // The text whose compile fails (the others draw).
  failText?: string
  // Over ssh, the bytes of a page can not be read (it can not go as `{ png }`).
  noBytes?: boolean
  raise?: boolean
  onAsk?: () => Promise<void>
  hold?: Promise<void>
  before?: (id: string) => Promise<void>
} = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', ...o.vars })
  const compiled: string[] = []
  const asked: any[] = []
  const edits: string[][] = []
  const decisions: any[] = []
  const aborts: string[] = []
  const commands: string[] = []
  const submits: any[] = []
  let engineAsks = 0
  const answers = [...(o.answers ?? [])]
  const files = new Map<string, string>([[FILE, PLAN]])
  // The children Intelligent UI spawns: the Frame watcher (it exits 1: no tty)
  // and a compile through the PID wrapper (typst.ts wrapPid).
  let pids = 4242
  on('process.spawn', async function* ($: any, e: any) {
    const argv: string[] = e.argv
    if (argv[0] === 'sh' && argv[2] === 'echo $$; exec "$@"' && argv[4] === '/usr/bin/typst' && argv[5] === 'compile') {
      yield { stream: 'stdout', text: `${pids++}\n` }
      const doc = argv.find(a => a.startsWith('doc='))!.slice(4)
      const text = JSON.parse(files.get(doc)!).segments.join('\n\n')
      if (o.failCompile || text === o.failText) {
        yield { stream: 'stderr', text: 'error: boom' }
        return { value: { code: 1, signal: null } }
      }
      await o.hold
      compiled.push(text)
      return { value: { code: 0, signal: null } }
    }
    return { value: { code: 1, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'kill') return ok('')
    if (/cc-intelligent-ui-/.test(cmd)) return ok('/c\nDarwin\n')
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === 'sh' && argv.at(-1) === 'code') return o.code ? ok('code /usr/local/bin/code\n') : ok('', 1)
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (cmd.includes('od -An')) return ok(`${HEAD}\n@\n`)
    if (argv.includes(FILE)) {
      edits.push(argv)
      if (o.edit !== undefined) files.set(FILE, o.edit)
      return ok('')
    }
    return ok('', 1)
  })
  on('session.id', async () => ({ value: 'sid-1' }))
  on('session.cwd', async () => ({ value: '/w/app' }))
  on('session.root', async () => ({ value: '/w/app' }))
  on('session.surfaces', async () => ({ value: o.surfaces ?? ['terminal'] }))
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => {
    if (e.as === 'bytes' && e.path.startsWith('/c/')) return o.noBytes ? { deny: 'EACCES' } : { value: { base64: PNG } }
    if (files.has(e.path)) return { value: files.get(e.path) }
    return e.path.startsWith('/c/') || e.path.startsWith('/h/') || e.path.startsWith('/w/') ? { deny: 'ENOENT' } : next(e)
  })
  on('fs.list', async ($: any, e: any, next: any) => {
    if (e.path.startsWith('/c/')) return { value: [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }
    return e.path.startsWith('/h/') || e.path.startsWith('/w/') ? { deny: 'ENOENT' } : next(e)
  })
  const toasts: string[] = []
  on('ui.toast', async ($: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('turn.abort', async ($: any, e: any) => (aborts.push(e.turnId), { value: undefined }))
  on('command.run', { command: 'clear' }, async ($: any, e: any) => (commands.push(e.command), { text: '' }))
  on('prompt.submit', async ($: any, e: any) => (submits.push(e), { text: e.text }))
  // $.ui.ask runs as a call of the AskUserQuestion tool.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($: any, e: any) => {
    const qs = e.questions
    asked.push(qs[0])
    await o.onAsk?.()
    const answer = answers.shift()
    if (answer === null || answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: qs, answers: { [qs[0].question]: answer } } }
  })
  on('classic.PermissionRequest', async () => {
    engineAsks++
    return {}
  })
  on('tool.call', { tool: 'ExitPlanMode' }, async (_: any, e: any) => {
    if (o.raise === false) return { result: { plan: e.plan, isAgent: false, filePath: FILE } }
    // The engine's own work before PermissionRequest (PreToolUse hooks, tool.check).
    await o.before?.(e.tool_use_id)
    const got: any = await $.classic.PermissionRequest({
      tool_name: 'ExitPlanMode', tool_input: { plan: e.plan, planFilePath: e.planFilePath }, permission_mode: 'plan',
      ...(e.agentId ? { agent_id: e.agentId } : {}),
    })
    decisions.push(got.decision)
    if (got.decision?.behavior === 'deny') return { deny: got.decision.message }
    return { result: { plan: got.decision?.updatedInput?.plan ?? e.plan, isAgent: false, filePath: FILE } }
  })
  // The dialog is the engine's own node (a dialog tree must hold it once).
  on('ui.render', ($: any, e: any) => (e.component === 'AskUserQuestion' ? { type: 'engine', ref: 0 } : ENGINE))
  return { clock, compiled, asked, edits, decisions, aborts, commands, submits, files, toasts, engineAsks: () => engineAsks }
}

const use = (o: { id?: string; input?: unknown; output?: unknown; isRunning?: boolean; isErrored?: boolean } = {}) =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'ToolUse', requestId: o.id ?? 'tu-plan',
    props: {
      tool_use_id: o.id ?? 'tu-plan', tool: 'ExitPlanMode', input: o.input ?? { plan: PLAN, planFilePath: FILE },
      isRunning: o.isRunning ?? true, isErrored: o.isErrored ?? false, isInterrupted: false, output: o.output,
    },
    viewport: { columns: 100, rows: 40 },
  }) as any
const result = (output: unknown, isErrored = false, id = 'tu-plan') =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'ToolResult', requestId: id,
    props: { tool_use_id: id, tool: 'ExitPlanMode', output, isErrored }, viewport: { columns: 100, rows: 40 },
  }) as any
const dialog = (question: string, header = PLAN_HEADER, id = 'tu-ask') =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AskUserQuestion', requestId: id,
    props: { tool: 'AskUserQuestion', questions: [{ question, header, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }], multiSelect: false }] },
    viewport: { columns: 100, rows: 40 },
  }) as any
const approved = { plan: PLAN, isAgent: false, filePath: FILE }
const images = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Image' ? [tree] : []), ...(tree.children ?? []).flatMap(images)] : []
const texts = (tree: any): string[] =>
  typeof tree === 'string' ? [tree] : tree && typeof tree === 'object' ? (tree.children ?? []).flatMap(texts) : []
// Sets the mod up (as the first answer would) before a row draws.
const ready = ($: any) => $.command.run({ command: 'iui', args: '' } as any)
// ExitPlanMode as the engine calls it: the plan and its file on the envelope.
const exitPlan = ($: any, more: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'tu-plan', plan: PLAN, planFilePath: FILE, ...more } as any)
const setMode = (mode: string) => [{ type: 'setMode', mode, destination: 'session' }]

test('the ExitPlanMode row draws the plan as pictures under the engine row, at an answer width', async ($, on) => {
  const { clock, compiled } = world($, on)
  await ready($)
  const ui = await $.ui.mount(use())
  await clock.settle()
  expect(compiled).toEqual([PLAN])
  await ui.redraw(use().props)
  const tree: any = await ui.drawn()
  expect(tree.children[0]).toMatchObject(ENGINE)
  const [image] = images(tree)
  expect(image.props.columns).toBe(98)
  expect(image.props.source).toMatchObject({ format: 'png' })
  expect(texts(tree).join('\n')).not.toContain(PLAN_DRAWING)
})

test("the plan's links and commands draw under its pictures", async ($, on) => {
  const { clock } = world($, on)
  await ready($)
  const plan = `${PLAN}\n\nRead https://typst.app/docs first.\n\n\`\`\`sh\nnpm test\n\`\`\``
  const row = use({ input: { plan, planFilePath: FILE } })
  const ui = await $.ui.mount(row)
  await clock.settle()
  await ui.redraw(row.props)
  const tree: any = await ui.drawn()
  expect(images(tree).length).toBe(1)
  expect(texts(tree)).toContain('https://typst.app/docs')
  expect((await ui.findAll({ type: 'Button' })).length).toBe(1)
})

test('a redraw of the plan row with a new onScreen draws the engine row again and compiles nothing', async ($, on) => {
  let rows = 0
  on('ui.render', { component: 'ToolUse' }, async ($: any, e: any, next: any) => (rows++, next(e)))
  const { clock, compiled } = world($, on)
  await ready($)
  const ui = await $.ui.mount(use())
  await clock.settle()
  await ui.redraw(use().props)
  const [first] = images(await ui.drawn())
  const seen = rows
  for (const onScreen of [{ first: 0, last: 4, of: 9 }, null, undefined]) {
    await ui.redraw({ ...use().props, onScreen })
    const tree: any = await ui.drawn()
    expect(tree.children[0]).toMatchObject(ENGINE)
    expect(images(tree)[0].props).toEqual(first.props)
  }
  expect(rows).toBe(seen + 3)
  expect(compiled).toEqual([PLAN])
})

test('a plan that fails to compile, a rejected call and a subagent call keep the engine row', async ($, on) => {
  const { clock } = world($, on, { failCompile: true })
  await ready($)
  const ui = await $.ui.mount(use())
  await clock.settle()
  await clock.advance(5000)
  await ui.redraw(use().props)
  expect(await ui.drawn()).toMatchObject(ENGINE)
  expect(await (await $.ui.mount(use({ id: 'tu-2', isErrored: true, isRunning: false }))).drawn()).toMatchObject(ENGINE)
  await exitPlan($, { tool_use_id: 'tu-sub', agentId: 'agent-1' })
  expect(await (await $.ui.mount(use({ id: 'tu-sub' }))).drawn()).toMatchObject(ENGINE)
  expect(await (await $.ui.mount(use({ id: 'tu-3', output: { plan: PLAN, isAgent: true }, isRunning: false }))).drawn()).toMatchObject(ENGINE)
})

test('the approved result keeps the header alone, as the ToolUse row draws the plan', async ($, on) => {
  const { clock } = world($, on)
  await ready($)
  await $.ui.mount(use())
  await clock.settle()
  const tree: any = await (await $.ui.mount(result(approved))).drawn()
  const shown = texts(tree).join('\n')
  expect(shown).toContain("User approved Claude's plan")
  expect(shown).toContain('Plan saved to: ~/.claude/plans/p.md · /plan to edit')
  expect(shown).not.toContain('Read the code.')
  expect(images(tree)).toEqual([])
})

test('an errored, empty or subagent result stays as the engine draws it', async ($, on) => {
  const { clock, compiled } = world($, on)
  await ready($)
  const rows = [
    result(approved, true, 'tu-1'),
    result({ plan: '', isAgent: false }, false, 'tu-2'),
    result({ plan: null, isAgent: false }, false, 'tu-3'),
    result({ plan: PLAN, isAgent: true }, false, 'tu-4'),
  ]
  for (const row of rows) expect(await (await $.ui.mount(row)).drawn()).toMatchObject(ENGINE)
  await clock.settle()
  expect(compiled).toEqual([])
})

test('approve with auto-accept: the PermissionRequest allows with the input and acceptEdits, no engine dialog', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO], code: true })
  await ready($)
  // The engine draws the row before the call: the question waits for its pictures, compiled once.
  await $.ui.mount(use())
  const got: any = await exitPlan($)
  expect(w.compiled).toEqual([PLAN])
  expect(w.asked).toMatchObject([{ question: PLAN_QUESTION, header: PLAN_HEADER }])
  expect(w.asked[0].options.map((x: any) => x.label)).toEqual([PLAN_AUTO, PLAN_MANUAL, PLAN_CLEAR, PLAN_EDIT])
  expect(w.decisions).toEqual([{ behavior: 'allow', updatedInput: { plan: PLAN, planFilePath: FILE }, updatedPermissions: setMode('acceptEdits') }])
  expect(w.engineAsks()).toBe(0)
  expect(got.result.plan).toBe(PLAN)
  expect(w.aborts).toEqual([])
})

test('approve with manual edits: the mode is default; with no editor the edit option is left out', async ($, on) => {
  const w = world($, on, { answers: [PLAN_MANUAL], vars: { SSH_CONNECTION: '1 2 3 4' } })
  await ready($)
  await exitPlan($)
  expect(w.asked[0].options.map((x: any) => x.label)).toEqual([PLAN_AUTO, PLAN_MANUAL, PLAN_CLEAR])
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedPermissions: setMode('default') }])
})

test('typed words deny the call with feedback, and no verdict is left', async ($, on) => {
  const w = world($, on, { answers: ['Also add tests'] })
  await ready($)
  const got: any = await exitPlan($)
  expect(JSON.stringify(got)).toContain('The user wants changes to the plan: Also add tests')
  expect(w.decisions).toEqual([])
  await $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: { plan: PLAN }, permission_mode: 'plan' } as any)
  expect(w.engineAsks()).toBe(1)
})

test('Esc rejects the plan: the PermissionRequest denies and interrupts', async ($, on) => {
  const w = world($, on, { answers: [null] })
  await ready($)
  const got: any = await exitPlan($)
  expect(w.decisions).toEqual([{ behavior: 'deny', message: PLAN_REJECTED, interrupt: true }])
  expect(JSON.stringify(got)).toContain(PLAN_REJECTED)
  expect(w.engineAsks()).toBe(0)
})

test('a plan whose pictures fail to compile is not asked about: the engine dialog shows its text', async ($, on) => {
  const w = world($, on, { failCompile: true, answers: [PLAN_AUTO] })
  await ready($)
  const got: any = await exitPlan($)
  expect(w.asked).toEqual([])
  expect(w.engineAsks()).toBe(1)
  expect(w.decisions).toEqual([undefined])
  expect(got.result.plan).toBe(PLAN)
})

test('over ssh, a plan whose pages can not go as bytes is not asked about', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO], noBytes: true, vars: { SSH_CONNECTION: '1 2 3 4' } })
  await ready($)
  await exitPlan($)
  expect(w.asked).toEqual([])
  expect(w.engineAsks()).toBe(1)
})

test("the question waits until the plan's pictures are drawn", async ($, on) => {
  let release!: () => void
  const w = world($, on, { answers: [PLAN_AUTO], hold: new Promise<void>(r => (release = r)) })
  await ready($)
  const call = exitPlan($)
  await w.clock.advance(3000)
  expect(w.asked).toEqual([])
  release()
  await call
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION])
  expect(w.decisions).toMatchObject([{ behavior: 'allow' }])
  expect(w.engineAsks()).toBe(0)
})

test('pictures that never come: no question, the engine dialog asks once the wait ends', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO], hold: new Promise<void>(() => undefined) })
  await ready($)
  let isDone = false
  const call = exitPlan($).then(() => (isDone = true))
  await w.clock.advance(5000)
  expect(isDone).toBe(false)
  await w.clock.advance(PLAN_DRAW_WAIT_MS)
  await call
  expect(w.asked).toEqual([])
  expect(w.engineAsks()).toBe(1)
})

test('a plan written in the same message waits for the write, then the new text is asked, sent and drawn', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO], code: true })
  // Claude's Write of the plan file, still running when ExitPlanMode starts.
  on('tool.call', { tool: 'Write' }, async (_: any, e: any) => {
    await w.clock.sleep(100)
    w.files.set(e.file_path, EDITED)
    return { result: { type: 'update', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: PLAN } }
  })
  await ready($)
  const writing = $.tool.call({ tool: 'Write', file_path: FILE, content: EDITED } as any)
  await w.clock.settle()
  // The call carries the file as it was before the write.
  const call = exitPlan($)
  await w.clock.settle()
  expect(w.asked).toEqual([])
  await w.clock.advance(100)
  await writing
  const got: any = await call
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION])
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: EDITED, planFilePath: FILE } }])
  expect(got.result.plan).toBe(EDITED)
  await $.ui.mount(use())
  await w.clock.settle()
  expect([...new Set(w.compiled)]).toEqual([EDITED])
})

test("an Edit in the same message: the row draws the file, not the message's older copy", async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO] })
  await ready($)
  // The Edit has run; the engine reads the file again for the call, but the row keeps the streamed input.
  w.files.set(FILE, EDITED)
  const got: any = await exitPlan($, { plan: EDITED })
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: EDITED } }])
  expect(got.result.plan).toBe(EDITED)
  await $.ui.mount(use({ input: { plan: PLAN, planFilePath: FILE } }))
  await w.clock.settle()
  expect([...new Set(w.compiled)]).toEqual([EDITED])
})

test("a teammate's or a subagent's result draws no plan, also after a call kept its text", async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO, PLAN_AUTO] })
  await ready($)
  await exitPlan($, { tool_use_id: 'tu-a' })
  await exitPlan($, { tool_use_id: 'tu-b' })
  // The calls' questions waited for the plan's pictures; the result rows compile nothing.
  w.compiled.length = 0
  const rows = [
    use({ id: 'tu-a', output: { plan: PLAN, isAgent: false, awaitingLeaderApproval: true }, isRunning: false }),
    use({ id: 'tu-b', output: { plan: PLAN, isAgent: true }, isRunning: false }),
  ]
  for (const row of rows) expect(await (await $.ui.mount(row)).drawn()).toMatchObject(ENGINE)
  await w.clock.settle()
  expect(w.compiled).toEqual([])
})

test("the result's plan wins over the text read at the call (an edit in the engine's dialog)", async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO] })
  await ready($)
  await exitPlan($)
  await $.ui.mount(use({ output: { plan: EDITED, isAgent: false, filePath: FILE }, isRunning: false }))
  await w.clock.settle()
  expect(w.compiled).toEqual([PLAN, EDITED])
})

test('the plan waits at most 5 s for a write that does not end', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO] })
  on('tool.call', { tool: 'Write' }, async () => new Promise(() => undefined))
  await ready($)
  void $.tool.call({ tool: 'Write', file_path: FILE, content: EDITED } as any)
  await w.clock.settle()
  const call = exitPlan($)
  await w.clock.advance(4900)
  expect(w.asked).toEqual([])
  await w.clock.advance(200)
  const got: any = await call
  expect(w.asked.length).toBe(1)
  expect(got.result.plan).toBe(PLAN)
})

test('an edit whose pictures fail is still asked, with a toast, and the approval sends the edited plan', async ($, on) => {
  const w = world($, on, { answers: [PLAN_EDIT, PLAN_AUTO], code: true, edit: EDITED, failText: EDITED })
  await ready($)
  const got: any = await exitPlan($)
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION, PLAN_QUESTION_EDITED])
  expect(w.toasts).toContain(PLAN_EDITED_UNDRAWN)
  expect(w.engineAsks()).toBe(0)
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: EDITED, planFilePath: FILE } }])
  expect(got.result.plan).toBe(EDITED)
})

test('edit: VS Code opens the file, the edited plan is asked again, sent and drawn', async ($, on) => {
  const w = world($, on, { answers: [PLAN_EDIT, PLAN_AUTO], code: true, edit: EDITED })
  await ready($)
  const got: any = await exitPlan($)
  expect(w.edits).toEqual([['/usr/local/bin/code', '--wait', FILE]])
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION, PLAN_QUESTION_EDITED])
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: EDITED, planFilePath: FILE } }])
  expect(got.result.plan).toBe(EDITED)
  // Each text is asked once its pictures are drawn; the row draws the edited text, the call's input notwithstanding.
  await $.ui.mount(use())
  await w.clock.settle()
  expect([...new Set(w.compiled)]).toEqual([PLAN, EDITED])
})

test('edit with no VS Code on a Mac opens the text editor, and the file is read when the person is done', async ($, on) => {
  const w = world($, on, { answers: [PLAN_EDIT, PLAN_DONE, PLAN_MANUAL], edit: PLAN })
  await ready($)
  await exitPlan($)
  // `open` returns at once (no -W: it would wait until the app quits).
  expect(w.edits).toEqual([['open', '-t', FILE]])
  // The file did not change: the same question, and the plan as it was.
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION, PLAN_EDITING, PLAN_QUESTION])
  expect(w.asked[1].options.map((x: any) => x.label)).toEqual([PLAN_DONE, PLAN_REOPEN])
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: PLAN } }])
})

test('on a Mac the file can be opened again; Esc is done, and the edited plan is asked', async ($, on) => {
  const w = world($, on, { answers: [PLAN_EDIT, PLAN_REOPEN, null, PLAN_AUTO], edit: EDITED })
  await ready($)
  const got: any = await exitPlan($)
  expect(w.edits).toEqual([['open', '-t', FILE], ['open', '-t', FILE]])
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION, PLAN_EDITING, PLAN_EDITING, PLAN_QUESTION_EDITED])
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: EDITED } }])
  expect(got.result.plan).toBe(EDITED)
})

test('clear context: once approved, the turn ends, /clear runs and the plan is sent', async ($, on) => {
  const w = world($, on, { answers: [PLAN_CLEAR] })
  await ready($)
  await $.turn.start({ text: 'plan it', turnId: 'turn-1' } as any).catch(() => undefined)
  await exitPlan($)
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedPermissions: setMode('acceptEdits') }])
  expect(w.commands).toEqual([])
  await w.clock.advance(100)
  await w.clock.settle()
  expect(w.aborts).toEqual(['turn-1'])
  expect(w.commands).toEqual(['clear'])
  expect(w.submits).toMatchObject([{ text: `Implement this plan:\n\n${PLAN}`, origin: { kind: 'plugin', asUser: true } }])
})

test('with Intelligent UI off, the engine dialog asks and the row stays as the engine draws it', async ($, on) => {
  const off = world($, on, { answers: [PLAN_AUTO] })
  await ready($)
  await $.command.run({ command: 'iui', args: 'off' } as any)
  const got: any = await exitPlan($)
  expect(got.result.plan).toBe(PLAN)
  expect(off.asked).toEqual([])
  expect(off.engineAsks()).toBe(1)
  expect(await (await $.ui.mount(use())).drawn()).toMatchObject(ENGINE)
})

test('in a terminal that draws no pictures, the engine dialog asks', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO], vars: { CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '', TERM: 'xterm-256color' } })
  await ready($)
  await exitPlan($)
  expect(w.asked).toEqual([])
  expect(w.engineAsks()).toBe(1)
})

test('with no terminal surface, the engine dialog asks', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO], surfaces: [] })
  await ready($)
  await exitPlan($)
  expect(w.asked).toEqual([])
  expect(w.engineAsks()).toBe(1)
})

test('a subagent ExitPlanMode is not asked about', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO] })
  await ready($)
  await exitPlan($, { tool_use_id: 'tu-sub', agentId: 'agent-1' })
  expect(w.asked).toEqual([])
  expect(w.engineAsks()).toBe(1)
})

test('a call with no plan is not asked about', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO] })
  await ready($)
  await exitPlan($, { plan: '' })
  expect(w.asked).toEqual([])
  expect(w.engineAsks()).toBe(1)
})

test('a verdict whose PermissionRequest never came does not reach a later call', async ($, on) => {
  const w = world($, on, { answers: [PLAN_AUTO], raise: false })
  await ready($)
  await exitPlan($)
  expect(w.asked.length).toBe(1)
  await $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: { plan: PLAN }, permission_mode: 'plan' } as any)
  expect(w.engineAsks()).toBe(1)
})

// ExitPlanMode is concurrency safe: two calls may run at once, and a
// PermissionRequest does not say which call it is for.
const ticks = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

test('two calls at once: the second asks nothing, and no verdict is used while both run', async ($, on) => {
  const gates: Record<string, () => void> = {}
  const waits: Record<string, Promise<void>> = { A: new Promise(r => (gates.A = r)), B: new Promise(r => (gates.B = r)) }
  const w = world($, on, { answers: [null, PLAN_AUTO], before: id => waits[id] ?? Promise.resolve() })
  await ready($)
  // A is rejected (Esc), and waits for its PermissionRequest; B begins.
  const a = exitPlan($, { tool_use_id: 'A' })
  await w.clock.settle()
  const b = exitPlan($, { tool_use_id: 'B' })
  await ticks()
  expect(w.asked.length).toBe(1)
  gates.A!()
  await ticks()
  gates.B!()
  await a.catch(() => undefined)
  await b.catch(() => undefined)
  // A's verdict reaches no call: the engine's dialog asks for each.
  expect(w.decisions).toEqual([undefined, undefined])
  expect(w.engineAsks()).toBe(2)
  // Both ended: a call on its own is asked about and its verdict used again.
  await exitPlan($, { tool_use_id: 'C' })
  expect(w.asked.length).toBe(2)
  expect(w.decisions[2]).toEqual({ behavior: 'allow', updatedInput: { plan: PLAN, planFilePath: FILE }, updatedPermissions: setMode('acceptEdits') })
  expect(w.engineAsks()).toBe(2)
})

test('a call that begins while the question is open asks nothing; once it ends, the verdict is used', async ($, on) => {
  let second: Promise<unknown> | null = null
  const w = world($, on, {
    answers: [PLAN_AUTO],
    onAsk: async () => {
      if (second) return
      second = exitPlan($, { tool_use_id: 'B' })
      await second
    },
  })
  await ready($)
  const got: any = await exitPlan($, { tool_use_id: 'A' })
  expect(second).not.toBe(null)
  expect(w.asked.length).toBe(1)
  // B: the engine's dialog; A: the verdict, as B ended before A's PermissionRequest.
  expect(w.decisions).toEqual([undefined, { behavior: 'allow', updatedInput: { plan: PLAN, planFilePath: FILE }, updatedPermissions: setMode('acceptEdits') }])
  expect(w.engineAsks()).toBe(1)
  expect(got.result.plan).toBe(PLAN)
})

test('a call that begins while the question is open and still runs at the PermissionRequest: the engine asks for both', async ($, on) => {
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  let second: Promise<unknown> | null = null
  const w = world($, on, {
    answers: [null],
    before: id => (id === 'B' ? gate : Promise.resolve()),
    onAsk: async () => {
      if (second) return
      second = exitPlan($, { tool_use_id: 'B' })
      await ticks()
    },
  })
  await ready($)
  // A is rejected (Esc) while B runs: the deny is not used, the engine asks.
  await exitPlan($, { tool_use_id: 'A' })
  expect(w.decisions).toEqual([undefined])
  release()
  await second
  expect(w.asked.length).toBe(1)
  expect(w.decisions).toEqual([undefined, undefined])
  expect(w.engineAsks()).toBe(2)
})

test('the line above the dialog is for the Intelligent UI question alone', async ($, on) => {
  let during: any = null
  let other: any = null
  // Draws the dialogs while Intelligent UI's question is asked.
  const w = world($, on, {
    answers: [PLAN_AUTO],
    onAsk: async () => {
      during = await (await $.ui.mount(dialog(PLAN_QUESTION))).drawn()
      other = await (await $.ui.mount(dialog('Which one?', 'Pick', 'tu-ask-2'))).drawn()
    },
  })
  await ready($)
  await exitPlan($)
  expect(w.asked.length).toBe(1)
  expect(texts(during)[0]).toBe(PLAN_ASK_LINE)
  expect(during.children[1]).toMatchObject({ type: 'engine' })
  expect(other).toMatchObject({ type: 'engine' })
  // Once answered, the same question draws as the engine's.
  expect(await (await $.ui.mount(dialog(PLAN_QUESTION, PLAN_HEADER, 'tu-ask-3'))).drawn()).toMatchObject({ type: 'engine' })
})

test('while the plan compiles the row shows the drawing line, then the pictures', async ($, on) => {
  let release!: () => void
  const hold = new Promise<void>(r => (release = r))
  const { clock } = world($, on, { hold })
  await ready($)
  const ui = await $.ui.mount(use())
  await clock.settle()
  await ui.redraw(use().props)
  const waiting: any = await ui.drawn()
  expect(waiting.children[0]).toMatchObject(ENGINE)
  expect(texts(waiting)).toContain(PLAN_DRAWING)
  expect(images(waiting)).toEqual([])
  release()
  await clock.settle()
  await ui.redraw(use().props)
  const done: any = await ui.drawn()
  expect(texts(done)).not.toContain(PLAN_DRAWING)
  expect(images(done).length).toBe(1)
})

test('an approved result with no plan file shows the header alone', async ($, on) => {
  const { clock } = world($, on)
  await ready($)
  await $.ui.mount(use())
  await clock.settle()
  const shown = texts(await (await $.ui.mount(result({ plan: PLAN, isAgent: false }))).drawn()).join('\n')
  expect(shown).toContain("User approved Claude's plan")
  expect(shown).not.toContain('Plan saved to')
})

// ---- The flow with a fake `$` ------------------------------------------------------

// `answers`: the replies to the question in order (an Error rejects). `run` answers a process
// by its argv (default: it fails); `files` is the file system, which `run` may change.
function fake(o: {
  answers?: (string | Error)[]
  run?: (argv: string[], files: Record<string, string>) => { exitCode: number; stdout: string } | Error | undefined
  files?: Record<string, string>
  env?: Record<string, string>
} = {}) {
  const asked: string[] = []
  const options: string[][] = []
  const during: string[] = []
  const runs: string[][] = []
  const files = { ...o.files }
  const answers = [...(o.answers ?? [])]
  const $ = {
    ui: {
      ask: async (question: string, opts: { options: string[] }) => {
        asked.push(question)
        options.push(opts.options)
        during.push(S.planAsking)
        const answer = answers.shift()
        if (answer === undefined || answer instanceof Error) throw answer ?? new Error('dismissed')
        return answer
      },
    },
    process: {
      run: async (argv: string[]) => {
        runs.push(argv)
        const got = o.run?.(argv, files) ?? { exitCode: 1, stdout: '' }
        if (got instanceof Error) throw got
        return { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...got }
      },
    },
    fs: {
      read: async (path: string) => {
        if (!(path in files)) throw new Error('ENOENT')
        return files[path]!
      },
    },
    env: { get: async (name: string) => o.env?.[name] },
  } as any
  S.planCode = null
  S.planGui = null
  S.planAsking = ''
  return { $, asked, options, during, runs, files }
}
const CODE = '/usr/bin/code'
const hasCode = (argv: string[]) => (argv[0] === 'sh' && argv.at(-1) === 'code' ? { exitCode: 0, stdout: `code ${CODE}\n` } : undefined)
const plain = (file = FILE) => ({ plan: PLAN, callPlan: PLAN, file, isMac: false, isRemote: false, onEdited: () => undefined, isDrawn: async () => true })

test('with no plan file there is no editor: the edit answer is feedback', async () => {
  const w = fake({ answers: [PLAN_EDIT] })
  const got = await decidePlan(w.$, plain(''))
  expect(got).toEqual({ kind: 'feedback', message: `${PLAN_FEEDBACK} ${PLAN_EDIT}` })
  expect(w.options[0]).toEqual([PLAN_AUTO, PLAN_MANUAL, PLAN_CLEAR])
  expect(w.runs).toEqual([])
})

test('a rejected ask denies the plan and clears the question', async () => {
  const w = fake({ answers: [new Error('dismissed')] })
  const got = await decidePlan(w.$, plain(''))
  expect(got).toEqual({ kind: 'verdict', verdict: { kind: 'deny', message: PLAN_REJECTED } })
  expect(w.during).toEqual([PLAN_QUESTION])
  expect(S.planAsking).toBe('')
})

test('an empty or blank file after an edit is ignored, and the question repeats', async () => {
  const edited: string[] = []
  const w = fake({
    answers: [PLAN_EDIT, PLAN_EDIT, PLAN_AUTO],
    files: { [FILE]: PLAN },
    run: (argv, files) => {
      if (argv[0] === CODE && argv[1] === '--wait') {
        files[FILE] = files[FILE] === PLAN ? '' : '  \n'
        return { exitCode: 0, stdout: '' }
      }
      return hasCode(argv)
    },
  })
  const got = await decidePlan(w.$, { ...plain(), onEdited: p => edited.push(p) })
  expect(w.asked).toEqual([PLAN_QUESTION, PLAN_QUESTION, PLAN_QUESTION])
  expect(edited).toEqual([])
  expect(got).toMatchObject({ kind: 'verdict', verdict: { kind: 'allow', plan: PLAN, isEdited: false } })
})

test('an editor process that rejects leaves the plan as it was', async () => {
  const w = fake({
    answers: [PLAN_EDIT, PLAN_MANUAL],
    files: { [FILE]: PLAN },
    run: argv => (argv[0] === CODE && argv[1] === '--wait' ? new Error('spawn failed') : hasCode(argv)),
  })
  const got = await decidePlan(w.$, plain())
  expect(w.asked).toEqual([PLAN_QUESTION, PLAN_QUESTION])
  expect(got).toMatchObject({ kind: 'verdict', verdict: { kind: 'allow', mode: 'default', plan: PLAN, isEdited: false } })
})

test('editing back to the original text is not an edit', async () => {
  const edited: string[] = []
  const w = fake({
    answers: [PLAN_EDIT, PLAN_EDIT, PLAN_AUTO],
    files: { [FILE]: PLAN },
    run: (argv, files) => {
      if (argv[0] === CODE && argv[1] === '--wait') {
        files[FILE] = files[FILE] === PLAN ? EDITED : PLAN
        return { exitCode: 0, stdout: '' }
      }
      return hasCode(argv)
    },
  })
  const got = await decidePlan(w.$, { ...plain(), onEdited: p => edited.push(p) })
  expect(w.asked).toEqual([PLAN_QUESTION, PLAN_QUESTION_EDITED, PLAN_QUESTION])
  expect(edited).toEqual([EDITED, PLAN])
  expect(got).toMatchObject({ kind: 'verdict', verdict: { kind: 'allow', plan: PLAN, isEdited: false } })
})

test('an edited plan whose pictures do not draw is still asked (the engine dialog would drop the edit)', async () => {
  const drawn: string[] = []
  const w = fake({
    answers: [PLAN_EDIT, PLAN_AUTO],
    files: { [FILE]: PLAN },
    run: (argv, files) => (argv[0] === CODE ? ((files[FILE] = EDITED), { exitCode: 0, stdout: '' }) : hasCode(argv)),
  })
  const got = await decidePlan(w.$, { ...plain(), isDrawn: async p => (drawn.push(p), p === PLAN) })
  expect(drawn).toEqual([PLAN, EDITED])
  expect(w.asked).toEqual([PLAN_QUESTION, PLAN_QUESTION_EDITED])
  expect(got).toMatchObject({ kind: 'verdict', verdict: { kind: 'allow', plan: EDITED, isEdited: true } })
})

test('a plan that differs from the call plan gives an edited verdict', async () => {
  const w = fake({ answers: [PLAN_AUTO] })
  const got = await decidePlan(w.$, { ...plain(''), plan: EDITED })
  expect(got).toMatchObject({ kind: 'verdict', verdict: { kind: 'allow', mode: 'acceptEdits', plan: EDITED, isEdited: true } })
})

test('the code command: -lc fails, -c finds it, and the path is cached', async () => {
  const w = fake({
    answers: [PLAN_AUTO, PLAN_AUTO],
    run: argv => (argv[1] === '-c' ? hasCode(argv) : { exitCode: 1, stdout: '' }),
  })
  await decidePlan(w.$, plain())
  expect(w.options[0]).toContain(PLAN_EDIT)
  expect(w.runs.map(a => a[1])).toEqual(['-lc', '-c'])
  expect(S.planCode).toBe(CODE)
  await decidePlan(w.$, plain())
  expect(w.runs.length).toBe(2)
})

test('a code path that is not absolute is refused, and the refusal is cached', async () => {
  const w = fake({ answers: [PLAN_AUTO, PLAN_AUTO], run: () => ({ exitCode: 0, stdout: 'code code\n' }) })
  await decidePlan(w.$, plain())
  expect(w.options[0]).not.toContain(PLAN_EDIT)
  expect(S.planCode).toBe('')
  const looked = w.runs.length
  await decidePlan(w.$, plain())
  expect(w.runs.length).toBe(looked)
})

test('on Linux a GUI editor is looked for only with a display, and the result is cached', async () => {
  const gedit = (argv: string[]) => (argv[2]?.includes('gedit') ? { exitCode: 0, stdout: 'gedit /usr/bin/gedit\n' } : undefined)
  const none = fake({ answers: [PLAN_AUTO], run: gedit })
  await decidePlan(none.$, plain())
  expect(none.options[0]).not.toContain(PLAN_EDIT)
  expect(none.runs.some(a => a[2]?.includes('gedit'))).toBe(false)
  expect(S.planGui).toEqual([])
  for (const name of ['DISPLAY', 'WAYLAND_DISPLAY']) {
    const w = fake({ answers: [PLAN_AUTO, PLAN_AUTO], run: gedit, env: { [name]: ':0' } })
    await decidePlan(w.$, plain())
    expect(w.options[0]).toContain(PLAN_EDIT)
    expect(S.planGui).toEqual(['/usr/bin/gedit', '--wait'])
    const looked = w.runs.length
    await decidePlan(w.$, plain())
    expect(w.runs.length).toBe(looked)
  }
})

test('the GUI editor is not looked for on a Mac, over ssh or when VS Code is found', async () => {
  const mac = fake({ answers: [PLAN_AUTO], env: { DISPLAY: ':0' } })
  await decidePlan(mac.$, { ...plain(), isMac: true })
  expect(S.planGui).toBe(null)
  const remote = fake({ answers: [PLAN_AUTO], env: { DISPLAY: ':0' } })
  await decidePlan(remote.$, { ...plain(), isRemote: true })
  expect(S.planGui).toBe(null)
  const code = fake({ answers: [PLAN_AUTO], env: { DISPLAY: ':0' }, run: hasCode })
  await decidePlan(code.$, plain())
  expect(S.planGui).toBe(null)
})

test('the current plan: the file, else the fallback when it is missing, unreadable or blank', async () => {
  const read = (files: Record<string, string>) => ({ fs: { read: async (p: string) => (p in files ? files[p]! : Promise.reject(new Error('EACCES'))) } }) as any
  expect(await currentPlan(read({ [FILE]: EDITED }), FILE, PLAN)).toBe(EDITED)
  expect(await currentPlan(read({ [FILE]: EDITED }), '', PLAN)).toBe(PLAN)
  expect(await currentPlan(read({}), FILE, PLAN)).toBe(PLAN)
  expect(await currentPlan(read({ [FILE]: ' \n' }), FILE, PLAN)).toBe(PLAN)
})

test('clear context: no abort without a turn id, and no step failure stops the next', async () => {
  const run = (o: { abort?: boolean; command?: boolean; submit?: boolean } = {}) => {
    const calls: string[] = []
    let later!: () => Promise<void>
    const fail = (name: string, is?: boolean) => async () => {
      calls.push(name)
      if (is) throw new Error(name)
      return undefined
    }
    const $ = {
      clock: { after: (_: number, fn: () => Promise<void>) => ((later = fn), { cancel: () => undefined }) },
      turn: { abort: fail('abort', o.abort) },
      command: { run: fail('clear', o.command) },
      prompt: { submit: fail('submit', o.submit) },
    } as any
    return { $, calls, fire: () => later() }
  }
  const empty = run()
  scheduleClear(empty.$, PLAN, '')
  await empty.fire()
  expect(empty.calls).toEqual(['clear', 'submit'])
  const broken = run({ abort: true, command: true, submit: true })
  scheduleClear(broken.$, PLAN, 'turn-1')
  await broken.fire()
  expect(broken.calls).toEqual(['abort', 'clear', 'submit'])
})
