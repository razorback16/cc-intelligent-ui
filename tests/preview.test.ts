import { expect, mock, test } from 'claude-code/testing'

import { encodeSteps, flipRows, WRITE_PL } from '../hooks/lib/flip'
import { decodePng, fromBase64, toBase64, type Rgba } from '../hooks/lib/png'
import { HERDR_CLIENT_SH } from '../hooks/lib/host'
import { FILL_SH } from '../hooks/lib/typst'
import { fillFitOf } from '../hooks/lib/composer'
import { cellPixels, DEFAULT_CELL, fillCall, filledPath, previewLayout } from '../hooks/register'

// The previews of pasted images (the band above the prompt box): a new
// session, a clear during a paste, herdr in iTerm2 with no Typst, and how a
// filled copy fits its box. images.test.ts has the rest.

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'error: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } })
// `od -An -v -tx1` of a PNG's first 24 bytes: 640 x 320.
const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 02 80 00 00 01 40'
// A tall PNG: 640 x 3200 px.
const TALL = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 02 80 00 00 0c 80'
// A one-line screenshot: 3000 x 36 px.
const WIDE = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 0b b8 00 00 00 24'
// The first 33 bytes of a PNG, base64.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABkAAAABACAYAAAAAAAAA'
const ENGINE = { type: 'Text', props: {}, children: ['engine drawing'] }
const PASTED = '/private/tmp/claude-501/-w-app/sid-1/images'
const NEW = '/private/tmp/claude-501/-w-app/sid-2/images'
const ITERM = '/Applications/iTerm.app/Contents/MacOS/iTerm2'

// A small RGBA picture (each row its own colour) as a PNG, and its pixels.
const ROWS_IMG: Rgba = (() => {
  const data = new Uint8Array(8 * 20 * 4)
  for (let y = 0; y < 20; y++) for (let x = 0; x < 8; x++) data.set([y * 12, x * 30, 255 - y, 255], (y * 8 + x) * 4)
  return { width: 8, height: 20, data }
})()
const ROWS_PNG = (() => {
  const steps = encodeSteps(ROWS_IMG)
  for (;;) {
    const got = steps.next()
    if (got.done) return toBase64(got.value)
  }
})()

// A Mac with kitty (pictures drawn), uid 501, in /w/app. `files`: the files
// that exist, by path (their first bytes as od prints them); `dirs`: the
// folders. `typst`: Typst is found (a fill makes the copy). `herdr`: the
// terminal app of the herdr client. `bytes`: what a read of any PNG gives
// (else PNG). `sid`: the session id now.
function world(on: any, o: { files?: Record<string, string>; dirs?: string[]; typst?: boolean; herdr?: string; bytes?: string; sid?: () => string } = {}) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/h', TERM: 'xterm-kitty', ...(o.herdr ? { TERM_PROGRAM: 'herdr' } : {}) })
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  const files = o.files ?? {}
  const dirs = new Set(o.dirs ?? [])
  const fills: string[][] = []
  const pngs = new Map<string, Uint8Array>()
  on('process.spawn', async function* () {
    return { value: { code: 1, signal: null } }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    const cmd = argv.join(' ')
    if (argv[0] === 'kill') return ok('')
    if (o.herdr && argv[0] === 'sh' && argv[2] === HERDR_CLIENT_SH) return ok(`pid 77\natime 5\ntty /dev/ttys003\ncmd herdr\napp ${o.herdr}\nenv\nherdr TERM=xterm-256color\n`)
    if (argv[0] === '/usr/bin/perl' && argv[2] === WRITE_PL) return (pngs.set(argv[3]!, fromBase64(e.init.stdin)), ok(''))
    if (/cc-intelligent-ui-/.test(cmd)) return ok('/c\nDarwin\n')
    if (argv[0] === 'id' && argv[1] === '-u') return ok('501\n')
    if (cmd.includes('command -v typst')) return o.typst ? ok('/usr/bin/typst\n') : ok('', 1)
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'eval') return ok('{}')
    if (argv[0] === 'mv') {
      if (!(argv[2]! in files)) return ok('', 1)
      files[argv[3]!] = files[argv[2]!]!
      delete files[argv[2]!]
      return ok('')
    }
    if (argv[0] === 'sh' && argv[2] === FILL_SH) return ok('')
    if (argv[0] === 'rm' && argv[1] === '-rf') return ok('')
    if (argv[0] === '/usr/bin/typst' && argv[1] === 'compile' && argv.at(-2)!.endsWith('/fill.typ')) {
      fills.push(argv)
      files[argv.at(-1)!] = HEAD
      return ok('')
    }
    if (cmd.includes('od -An')) return ok(argv.slice(4).map(f => `${files[f] ?? ''}\n@\n`).join(''))
    if (cmd.includes('debug.log')) return ok('')
    return ok('', 1)
  })
  on('session.id', async () => ({ value: o.sid?.() ?? 'sid-1' }))
  on('session.cwd', async () => ({ value: '/w/app' }))
  on('session.root', async () => ({ value: '/w/app' }))
  on('fs.stat', async ($: any, e: any, next: any) => {
    if (e.path in files) return { value: { kind: 'file', size: 1000, mtimeMs: 1, isLink: false } }
    return e.path.startsWith('/private/') || e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)
  })
  on('fs.exists', async ($: any, e: any, next: any) => {
    if (e.path.startsWith('/private/')) return { value: dirs.has(e.path) }
    return e.path.endsWith('/typst') ? { value: false } : next(e)
  })
  on('fs.list', async ($: any, e: any, next: any) => (e.path === '/private/tmp/claude-501' ? { value: [] } : next(e)))
  on('fs.write', async () => ({ value: undefined }))
  on('fs.read', async ($: any, e: any, next: any) => {
    if (e.as === 'bytes' && e.path in files) return { value: { base64: o.bytes ?? PNG } }
    return e.path.startsWith('/c/') ? { deny: 'ENOENT' } : next(e)
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', () => ENGINE as any)
  return { clock, fills, pngs, files }
}

const images = (tree: any): any[] =>
  tree && typeof tree === 'object' ? [...(tree.type === 'Image' ? [tree] : []), ...(tree.children ?? []).flatMap(images)] : []
const alts = (tree: any): string[] => images(tree).map(i => i.props.alt)
// Sets the mod up (as the first answer would) before a row draws.
const ready = ($: any) => $.command.run({ command: 'iui', args: '' } as any)
const band = () =>
  ({
    plugin: 'cc-intelligent-ui', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 95, scroll: { offset: 0, bodyRows: 19 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  }) as any
// The editor beneath the mod: an edit is its splice, a change the box as given.
function editor(on: any) {
  on('prompt.edit', async ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.change', async ($: any, e: any) => ({ text: e.text }))
}
// A paste (or a key) at the end of `text`.
const typed = (text: string, inputText: string) => ({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText }) as any
const CLEAR = { text: '', cursor: 0, origin: { kind: 'clear' } }

test('after /clear (a new session), a new [Image #1] previews its own file, not the last session\'s #1', async ($, on) => {
  let id = 'sid-1'
  world(on, { sid: () => id, files: { [`${PASTED}/1.png`]: HEAD, [`${NEW}/1.png`]: TALL }, dirs: [PASTED, NEW] })
  editor(on)
  await ready($)
  const prompt = ($ as any).prompt
  const ui = await $.ui.mount(band())
  await prompt.edit(typed('', '[Image #1]'))
  expect(images(await ui.drawn())[0].props.source.file).toBe(`${PASTED}/1.png`)
  // The draft is cleared, then /clear starts a new session: its images are numbered from #1 again.
  await prompt.change(CLEAR)
  expect(await ui.drawn()).toMatchObject(ENGINE)
  id = 'sid-2'
  await prompt.edit(typed('', '[Image #1]'))
  const [image] = images(await ui.drawn())
  expect(image.props.source.file).toBe(`${NEW}/1.png`)
  expect([image.props.columns, image.props.rows]).toEqual([2, 5])
})

test('a clear of the box that comes while a paste\'s edit is still answered: no preview; the next paste shows again', async ($, on) => {
  world(on, { files: { [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED] })
  // The editor beneath the mod: the paste's answer comes late.
  let release = () => {}
  let pending = () => {}
  const isPending = new Promise<void>(r => (pending = r))
  const gate = new Promise<void>(r => (release = r))
  let held = false
  on('prompt.edit', async ($: any, e: any) => {
    if (e.inputText === '[Image #5]' && !held) {
      held = true
      pending()
      await gate
    }
    return { text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }
  })
  on('prompt.change', async ($: any, e: any) => ({ text: e.text }))
  await ready($)
  const prompt = ($ as any).prompt
  const ui = await $.ui.mount(band())
  const paste = prompt.edit(typed('', '[Image #5]'))
  await isPending
  await prompt.change(CLEAR)
  release()
  await paste
  expect(alts(await ui.drawn())).toEqual([])
  // A later paste is noted as before.
  await prompt.edit(typed('', '[Image #5]'))
  expect(alts(await ui.drawn())).toEqual(['[Image #5]'])
})

test('in herdr in iTerm2 with no Typst, a pasted image previews from the image itself, stored flipped by rows for its box', async ($, on) => {
  const { pngs, fills } = world(on, { herdr: ITERM, files: { [`${PASTED}/5.png`]: HEAD }, dirs: [PASTED], bytes: ROWS_PNG })
  editor(on)
  await ready($)
  const ui = await $.ui.mount(band())
  await ($ as any).prompt.edit(typed('', '[Image #5]'))
  const [image] = images(await ui.drawn())
  expect(fills.length).toBe(0)
  expect(image.props).toMatchObject({ columns: 20, rows: 5, alt: '[Image #5]' })
  expect(image.props.source.file).toMatch(/^\/c\/[0-9a-f]{16}\/flip\.png$/)
  expect([...decodePng(pngs.get(image.props.source.file)!).data]).toEqual([...flipRows(ROWS_IMG, 5).data])
})

test('a filled copy covers its box only when that cuts at most half a cell, else it contains the image', () => {
  // A one-line screenshot: one row of 92 columns; a cover would cut 45% of it.
  const wide = { width: 3000, height: 36 }
  const laid = previewLayout([wide], DEFAULT_CELL, 95, 20, [3])!
  const box = cellPixels(laid.boxes[0]!, DEFAULT_CELL)
  expect(box).toEqual({ width: 1472, height: 32 })
  expect(fillFitOf(wide, box, DEFAULT_CELL)).toBe('contain')
  // A picture of the box's shape, and one a few pixels off it: cover.
  expect(fillFitOf({ width: 640, height: 320 }, { width: 320, height: 160 }, DEFAULT_CELL)).toBe('cover')
  expect(fillFitOf({ width: 1000, height: 700 }, { width: 224, height: 160 }, DEFAULT_CELL)).toBe('cover')
  // More than half a cell cut on a side: contain.
  expect(fillFitOf({ width: 100, height: 50 }, { width: 96, height: 64 }, DEFAULT_CELL)).toBe('contain')
  // The fit is an input of fill.typ (none for cover), and part of the key.
  const call = (fit?: 'cover' | 'contain') => fillCall({ typst: '/t', run: '/c/k/r-1', cache: '/c', box, fit, out: '/o.png' }).argv
  expect(call('contain')).toEqual(expect.arrayContaining(['fit=contain']))
  expect(call('cover')).toEqual(call())
  const p = { file: '/t/5.png', stamp: '1:1000', bytes: 1000, ...wide }
  expect(filledPath('/c', p, box, 'contain')).not.toBe(filledPath('/c', p, box))
  expect(filledPath('/c', p, box, 'cover')).toBe(filledPath('/c', p, box))
})

test('a pasted one-line screenshot is filled with fit contain; a normal picture with no fit input (cover)', async ($, on) => {
  const { clock, fills } = world(on, { typst: true, files: { [`${PASTED}/5.png`]: WIDE, [`${PASTED}/6.png`]: HEAD }, dirs: [PASTED] })
  editor(on)
  await ready($)
  const ui = await $.ui.mount(band())
  await ($ as any).prompt.edit(typed('', '[Image #5] [Image #6]'))
  await ui.drawn()
  await clock.settle()
  expect(fills.length).toBe(2)
  const of = (n: number) => fills.find(argv => argv.includes(`maxw=${n === 5 ? 1472 : 320}`))!
  expect(of(5)).toContain('fit=contain')
  expect(of(6).some(a => a.startsWith('fit='))).toBe(false)
})
