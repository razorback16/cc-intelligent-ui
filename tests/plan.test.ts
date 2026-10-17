import { expect, mock, test } from 'claude-code/testing'

import {
  choiceOf, decisionOf, editorArgv, feedbackOf, isPlanQuestion, normalPath, PLAN_ASK_LINE, PLAN_AUTO, PLAN_CLEAR, PLAN_DRAWING, PLAN_EDIT,
  PLAN_HEADER, PLAN_MANUAL, PLAN_QUESTION, PLAN_QUESTION_EDITED, PLAN_REJECTED, planFileOf, planInputOf, planOf, planOptions,
  planShownOf, shortPath, TYPST_PROMPT, verdictOf,
} from '../hooks/register'

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

test('the plan a row shows: the edited text, else the result, else the call', () => {
  expect(planShownOf('# Edited', { plan: '# Done', isAgent: false }, { plan: '# Asked' })).toBe('# Edited')
  expect(planShownOf(undefined, { plan: '# Done', isAgent: false }, { plan: '# Asked' })).toBe('# Done')
  expect(planShownOf(undefined, undefined, { plan: '# Asked' })).toBe('# Asked')
  expect(planShownOf(undefined, { plan: '# Done', isAgent: true }, { plan: '# Asked' })).toBe('')
  expect(planShownOf(undefined, undefined, {})).toBe('')
})

test('a short path', () => {
  expect(shortPath('/h/.claude/plans/p.md', '/h')).toBe('~/.claude/plans/p.md')
  expect(shortPath('/other/p.md', '/h')).toBe('/other/p.md')
  expect(shortPath('/h/p.md', '')).toBe('/h/p.md')
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

test('the editor: VS Code when found, else TextEdit on a local Mac, else none', () => {
  expect(editorArgv({ code: '/usr/local/bin/code', isMac: true, isRemote: false }, '/h/p.md')).toEqual(['/usr/local/bin/code', '--wait', '/h/p.md'])
  expect(editorArgv({ code: '', isMac: true, isRemote: false }, '/h/p.md')).toEqual(['open', '-W', '-t', '/h/p.md'])
  expect(editorArgv({ code: '', isMac: true, isRemote: true }, '/h/p.md')).toBe(null)
  expect(editorArgv({ code: '', isMac: false, isRemote: false }, '/h/p.md')).toBe(null)
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
  raise?: boolean
  onAsk?: () => Promise<void>
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
      if (o.failCompile) {
        yield { stream: 'stderr', text: 'error: boom' }
        return { value: { code: 1, signal: null } }
      }
      const doc = argv.find(a => a.startsWith('doc='))!.slice(4)
      compiled.push(JSON.parse(files.get(doc)!).segments.join('\n\n'))
      return { value: { code: 0, signal: null } }
    }
    return { value: { code: 1, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'kill') return ok('')
    if (/intelligent-ui-/.test(cmd)) return ok('/c\nDarwin\n')
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (cmd.includes('command -v code')) return o.code ? ok('/usr/local/bin/code\n') : ok('', 1)
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
    if (files.has(e.path)) return { value: files.get(e.path) }
    return e.path.startsWith('/c/') || e.path.startsWith('/h/') || e.path.startsWith('/w/') ? { deny: 'ENOENT' } : next(e)
  })
  on('fs.list', async ($: any, e: any, next: any) => {
    if (e.path.startsWith('/c/')) return { value: [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }
    return e.path.startsWith('/h/') || e.path.startsWith('/w/') ? { deny: 'ENOENT' } : next(e)
  })
  on('ui.toast', async () => ({ value: undefined }))
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
  return { clock, compiled, asked, edits, decisions, aborts, commands, submits, files, engineAsks: () => engineAsks }
}

const use = (o: { id?: string; input?: unknown; output?: unknown; isRunning?: boolean; isErrored?: boolean } = {}) =>
  ({
    plugin: 'intelligent-ui', surface: 'terminal', component: 'ToolUse', requestId: o.id ?? 'tu-plan',
    props: {
      tool_use_id: o.id ?? 'tu-plan', tool: 'ExitPlanMode', input: o.input ?? { plan: PLAN, planFilePath: FILE },
      isRunning: o.isRunning ?? true, isErrored: o.isErrored ?? false, isInterrupted: false, output: o.output,
    },
    viewport: { columns: 100, rows: 40 },
  }) as any
const result = (output: unknown, isErrored = false, id = 'tu-plan') =>
  ({
    plugin: 'intelligent-ui', surface: 'terminal', component: 'ToolResult', requestId: id,
    props: { tool_use_id: id, tool: 'ExitPlanMode', output, isErrored }, viewport: { columns: 100, rows: 40 },
  }) as any
const dialog = (question: string, header = PLAN_HEADER, id = 'tu-ask') =>
  ({
    plugin: 'intelligent-ui', surface: 'terminal', component: 'AskUserQuestion', requestId: id,
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
  const got: any = await exitPlan($)
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
  expect(w.compiled).toEqual([EDITED])
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

test('edit: VS Code opens the file, the edited plan is asked again, sent and drawn', async ($, on) => {
  const w = world($, on, { answers: [PLAN_EDIT, PLAN_AUTO], code: true, edit: EDITED })
  await ready($)
  const got: any = await exitPlan($)
  expect(w.edits).toEqual([['/usr/local/bin/code', '--wait', FILE]])
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION, PLAN_QUESTION_EDITED])
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: EDITED, planFilePath: FILE } }])
  expect(got.result.plan).toBe(EDITED)
  // The row draws the edited text, the call's input notwithstanding.
  await $.ui.mount(use())
  await w.clock.settle()
  expect(w.compiled).toEqual([EDITED])
})

test('edit with no VS Code on a Mac uses TextEdit', async ($, on) => {
  const w = world($, on, { answers: [PLAN_EDIT, PLAN_MANUAL], edit: PLAN })
  await ready($)
  await exitPlan($)
  expect(w.edits).toEqual([['open', '-W', '-t', FILE]])
  // The file did not change: the same question, and the plan as it was.
  expect(w.asked.map(q => q.question)).toEqual([PLAN_QUESTION, PLAN_QUESTION])
  expect(w.decisions).toMatchObject([{ behavior: 'allow', updatedInput: { plan: PLAN } }])
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
