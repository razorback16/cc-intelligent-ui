import { expect, mock, test } from 'claude-code/testing'

// What the engine would draw: the test stands beneath the plugin.
const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }

const message = (requestId: string, props: Record<string, unknown>) =>
  ({
    plugin: 'md-preview',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId,
    props: { text: '# Hello\n\nSome **bold** text.', isFirstOfReply: true, ...props },
    viewport: { columns: 100, rows: 40 },
  }) as any

test('with the mod off, an answer draws as the engine draws it', async ($, on) => {
  mock.store(on)
  on('ui.render', () => ENGINE as any)
  const ran = await $.command.run({ command: 'md-preview', args: 'off' } as any)
  expect(ran.text).toBe('md-preview is off.')
  const mounted = await $.ui.mount(message('off-1', {}))
  expect(await mounted.drawn()).toMatchObject(ENGINE)
})

test('a summary block and an empty block draw as the engine draws them', async ($, on) => {
  on('ui.render', () => ENGINE as any)
  for (const [id, props] of [['sum-1', { isSummary: true }], ['empty-1', { text: '  \n' }]] as const) {
    const mounted = await $.ui.mount(message(id, props))
    expect(await mounted.drawn()).toMatchObject(ENGINE)
  }
})
