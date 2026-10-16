import { expect, mock, test } from 'claude-code/testing'

// The world beneath the mod for one compile: a cache folder, a typst whose
// compile the test lets finish (or fail), and the PNG it "wrote".
const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// The first 24 bytes of a 1600 x 64 PNG, as `od -An -v -tx1` prints them.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 00 40'

function world(on: any, o: { fail?: boolean; slow?: Promise<void> } = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  const compiled: string[] = []
  const files = new Map<string, string>()
  on('process.run', async ($: any, e: any, next: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (/md-preview-/.test(cmd)) return ok('/c\nDarwin\n')
    if (cmd.includes('command -v typst')) return ok('/usr/bin/typst\n')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'compile') {
      const doc = argv.find(a => a.startsWith('doc='))!.slice(4)
      compiled.push(JSON.parse(files.get(doc)!).segments.join('\n\n'))
      if (o.slow) await o.slow
      return o.fail ? ok('', 1) : ok('')
    }
    if (cmd.includes('od -An')) return ok(`${HEAD}\n@\n`)
    if (argv[0] === 'sh' && cmd.includes('debug.log')) return ok('')
    if (argv[0] === 'defaults') return ok('', 1)
    return ok('', 1)
  })
  on('fs.write', async ($: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($: any, e: any, next: any) => (files.has(e.path) ? { value: files.get(e.path) } : e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)))
  on('fs.list', async ($: any, e: any, next: any) => (e.path.startsWith('/c/') ? { value: [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] } : next(e)))
  on('ui.toast', async () => ({ value: undefined }))
  return { clock, compiled }
}

const message = (requestId: string, text: string) =>
  ({
    plugin: 'md-preview', surface: 'terminal', component: 'AssistantMessage', requestId,
    props: { text, isFirstOfReply: true }, viewport: { columns: 100, rows: 40 },
  }) as any
const props = (text: string) => ({ text, isFirstOfReply: true }) as any
const kinds = (tree: any): string[] => (tree && typeof tree === 'object' ? [tree.type, ...(tree.children ?? []).flatMap(kinds)] : [])
const isBlank = (tree: any) => tree.type === 'Box' && !(tree.children ?? []).length
const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }

// A model request the test streams chunk by chunk; `release` ends it.
function request(on: any, more: unknown[] = []) {
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: '# Title' }
    for (const chunk of more) yield chunk
    await gate
    return { turnId: 't', index: 0, answer: '# Title', toolUses: [], stopReason: 'end_turn' }
  })
  return () => release()
}

test('a block draws nothing while it streams, and its picture once the request ends, with no 400 ms wait', async ($, on) => {
  const { clock, compiled } = world(on)
  on('ui.render', () => ENGINE as any)
  const end = request(on)
  // Ready the mod (setUp) before the stream starts.
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const stream = ($ as any).turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  await stream.next()
  const ui = await $.ui.mount(message('live-1', '# Ti'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await ui.redraw(props('# Title\n\nSome'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await clock.advance(1500)
  expect(compiled).toEqual([])
  await ui.redraw(props('# Title\n\nSome text.'))
  expect(isBlank(await ui.drawn())).toBe(true)
  end()
  const done = stream.next()
  await clock.settle()
  await done
  expect(compiled).toEqual(['# Title\n\nSome text.'])
  await ui.redraw(props('# Title\n\nSome text.'))
  expect(kinds(await ui.drawn())).toContain('Image')
})

test('a block whose compile fails draws as text', async ($, on) => {
  const { clock } = world(on, { fail: true })
  on('ui.render', () => ENGINE as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('fail-1', 'Some **bold** text.'))
  await clock.settle()
  await ui.redraw(props('Some **bold** text.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
})

test('with no request seen, a changing block is final after 400 ms still', async ($, on) => {
  const { clock, compiled } = world(on)
  on('ui.render', () => ENGINE as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('reload-1', 'One'))
  await clock.settle()
  // Seen once (resumed, so final at once); a change outside a request is live.
  await ui.redraw(props('One two'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await clock.advance(300)
  await ui.redraw(props('One two three'))
  await clock.advance(300)
  expect(compiled).toEqual(['One'])
  await clock.advance(150)
  expect(compiled).toEqual(['One', 'One two three'])
  await ui.redraw(props('One two three'))
  expect(kinds(await ui.drawn())).toContain('Image')
})

test('a resumed block compiles at once, blank for at most 1 s, then its text until the picture is ready', async ($, on) => {
  let finish!: () => void
  const slow = new Promise<void>(r => (finish = r))
  const { clock, compiled } = world(on, { slow })
  on('ui.render', () => ENGINE as any)
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const ui = await $.ui.mount(message('old-1', 'An old answer.'))
  expect(isBlank(await ui.drawn())).toBe(true)
  await clock.settle()
  expect(compiled).toEqual(['An old answer.'])
  await clock.advance(1000)
  await ui.redraw(props('An old answer.'))
  expect(await ui.drawn()).toMatchObject(ENGINE)
  finish()
  await clock.settle()
  await ui.redraw(props('An old answer.'))
  expect(kinds(await ui.drawn())).toContain('Image')
})

test('a text block is final when its request moves on to a tool call, before the request ends', async ($, on) => {
  const { clock, compiled } = world(on)
  on('ui.render', () => ENGINE as any)
  const end = request(on, [{ kind: 'tool', index: 1, id: 'toolu_1', name: 'Write' }])
  await $.command.run({ command: 'md-preview', args: '' } as any)
  const stream = ($ as any).turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  await stream.next()
  const ui = await $.ui.mount(message('tool-1', 'Let me write the file.'))
  expect(isBlank(await ui.drawn())).toBe(true)
  // The tool chunk: the text block is done though the request goes on.
  await stream.next()
  await clock.settle()
  expect(compiled).toEqual(['Let me write the file.'])
  await ui.redraw(props('Let me write the file.'))
  expect(kinds(await ui.drawn())).toContain('Image')
  end()
  await stream.next()
})
