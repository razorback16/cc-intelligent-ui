import { expect, test } from 'claude-code/testing'

import { pathWith, SHIM_SETUP, SHIM_TOOLS, shimFindOf, shimText, shQuote } from '../hooks/register'
import { setUpShims } from '../hooks/lib/clipboard'
import { S } from '../hooks/lib/state'

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const TEMPLATE = 'tool=@TOOL@\nreal=@REAL@\ndir=@DIR@\nperl=@PERL@\n'

test('a shim is the template with the tool, the real tool, the folder and perl, each quoted for sh', () => {
  expect(shQuote("it's")).toBe(`'it'\\''s'`)
  expect(shimText(TEMPLATE, 'xclip', '/usr/bin/xclip', "/t/a'b/shims-1", '/usr/bin/perl'))
    .toBe(`tool='xclip'\nreal='/usr/bin/xclip'\ndir='/t/a'\\''b/shims-1'\nperl='/usr/bin/perl'\n`)
  // A `$` in a path stays as it is.
  expect(shimText('@REAL@', 'pbcopy', '/x/$HOME', '/d', '/p')).toBe(`'/x/$HOME'`)
  expect(SHIM_TOOLS).toEqual({ mac: ['pbcopy'], linux: ['wl-copy', 'xclip', 'xsel'] })
})

test("the find script's output: the pid, only absolute tools outside the shim folders, perl, and the FIFO in the cache folder", () => {
  const out = 'pid 123\nwl-copy /usr/bin/wl-copy\nxclip /c/shims-7/xclip\nxsel xsel\nfoo /usr/bin/foo\nperl /usr/bin/perl\nask /c/ask-123\n'
  expect(shimFindOf('xclip /c/shims/xclip\n', SHIM_TOOLS.linux, '/c').found).toEqual({})
  expect(shimFindOf(out, SHIM_TOOLS.linux, '/c')).toEqual({ pid: '123', found: { 'wl-copy': '/usr/bin/wl-copy' }, perl: '/usr/bin/perl', ask: '/c/ask-123' })
  expect(shimFindOf('', SHIM_TOOLS.mac, '/c')).toEqual({ pid: '', found: {}, perl: '', ask: '' })
  // A FIFO outside the cache folder, or not of a pid: none.
  for (const ask of ['/tmp/ask-1', '/c/ask-', '/c/ask-1/x', '/c/x/ask-1', 'perl']) expect(shimFindOf(`ask ${ask}\n`, SHIM_TOOLS.mac, '/c').ask).toBe('')
  expect(shimFindOf('perl perl\n', SHIM_TOOLS.mac, '/c').perl).toBe('')
  expect(SHIM_SETUP).toBe('hooks/clip-shim-setup.sh')
})

test('PATH gets the shim folder first, once', () => {
  expect(pathWith('/usr/bin:/bin', '/c/shims')).toBe('/c/shims:/usr/bin:/bin')
  expect(pathWith('/c/shims:/usr/bin:/bin', '/c/shims')).toBe(null)
  // Not first, or twice: moved to the front, once.
  expect(pathWith('/usr/bin:/c/shims:/bin', '/c/shims')).toBe('/c/shims:/usr/bin:/bin')
  expect(pathWith('/c/shims:/usr/bin:/c/shims', '/c/shims')).toBe('/c/shims:/usr/bin')
  expect(pathWith('', '/c/shims')).toBe('/c/shims')
})

// A computer for setUpShims (a $ of its own): `found` the tools the find
// script prints, the files in `files`, PATH in `vars`; `runs` and `sets`
// keep the calls.
function shimWorld(o: {
  found: string[]; files?: Record<string, string>; chmodFails?: boolean; denyPath?: boolean; path?: string; unsafe?: 'find' | 'install'; noPerl?: boolean; noAsk?: boolean
  noPid?: boolean
}) {
  const files = new Map<string, string>(Object.entries(o.files ?? {}))
  const vars: Record<string, string | undefined> = { PATH: o.path ?? '/usr/bin:/bin' }
  const runs: string[][] = []
  const sets: [string, string | undefined][] = []
  const run = async (argv: string[]) => {
    runs.push(argv)
    if (o.unsafe === argv[2]) return ok('unsafe /c\n', 3).value
    if (argv[1]?.endsWith(SHIM_SETUP) && argv[2] === 'find') {
      return ok(`${o.noPid ? '' : 'pid 99\n'}${o.found.map(t => `${t} /usr/bin/${t}\n`).join('')}${o.noPerl ? '' : 'perl /usr/bin/perl\n'}${o.noAsk ? '' : 'ask /c/ask-99\n'}`).value
    }
    if (argv[1]?.endsWith(SHIM_SETUP) && argv[2] === 'install') {
      if (o.chmodFails) return ok('', 1).value
      for (const f of argv.slice(5)) {
        if (f.startsWith('-')) files.delete(f.slice(1))
        else {
          files.set(f, files.get(`${f}${argv[4]}`)!)
          files.delete(`${f}${argv[4]}`)
        }
      }
      return ok('').value
    }
    return ok('', 1).value
  }
  const $ = {
    plugin: { root: '/p' },
    process: { run },
    env: {
      get: async (name: string) => vars[name],
      set: async (name: string, value: string | undefined) => {
        sets.push([name, value])
        if (o.denyPath && name === 'PATH') return { deny: 'held by the organization' }
        vars[name] = value
        return {}
      },
    },
    fs: {
      read: async (path: string) => {
        if (path === '/p/hooks/clip-shim.sh') return TEMPLATE
        if (files.has(path)) return files.get(path)
        throw new Error('ENOENT')
      },
      write: async (path: string, text: string) => void files.set(path, text),
      exists: async (path: string) => files.has(path),
    },
    session: { id: async () => 'sess-1' },
  } as any
  return { $, files, vars, runs, sets }
}

const shimsOf = (files: Map<string, string>) => [...files.keys()].filter(k => k.startsWith('/c/shims-99/')).sort()

test('macOS: the pbcopy shim, then IUI_COPY_ASK and PATH; again (a hot reload): nothing written or set', async () => {
  const w = shimWorld({ found: ['pbcopy'] })
  expect(await setUpShims(w.$, '/c', true)).toEqual({ tools: ['pbcopy'] })
  expect(w.runs[0]).toEqual(['sh', '/p/hooks/clip-shim-setup.sh', 'find', '/c', 'pbcopy'])
  // The shims folder of this process (pid 99), with the perl that find gave.
  expect(shimsOf(w.files)).toEqual(['/c/shims-99/pbcopy'])
  expect(w.files.get('/c/shims-99/pbcopy')).toBe(shimText(TEMPLATE, 'pbcopy', '/usr/bin/pbcopy', '/c/shims-99', '/usr/bin/perl'))
  // The FIFO first, so the first shim run has it.
  expect(w.sets).toEqual([['IUI_COPY_ASK', '/c/ask-99'], ['PATH', '/c/shims-99:/usr/bin:/bin']])
  expect(S.askFifo).toBe('/c/ask-99')
  expect(S.shimDir).toBe('/c/shims-99')
  const runs = w.runs.length
  expect(await setUpShims(w.$, '/c', true)).toEqual({ tools: ['pbcopy'] })
  // Only the find: the shim is the same, PATH and the FIFO are set.
  expect(w.runs.length).toBe(runs + 1)
  expect(w.sets.length).toBe(2)
  expect(w.vars.PATH).toBe('/c/shims-99:/usr/bin:/bin')
})

test('a find with no pid: off, nothing written or set', async () => {
  const w = shimWorld({ found: ['pbcopy'], noPid: true })
  expect(await setUpShims(w.$, '/c', true)).toEqual({ off: 'the shim folder could not be made' })
  expect(w.files.size).toBe(0)
  expect(w.sets).toEqual([])
})

test('no perl, or no FIFO: off with the reason; PATH and IUI_COPY_ASK not set', async () => {
  for (const [o, off] of [[{ noPerl: true }, 'no perl'], [{ noAsk: true }, 'the ask FIFO could not be made']] as const) {
    const w = shimWorld({ found: ['pbcopy'], ...o })
    expect(await setUpShims(w.$, '/c', true)).toEqual({ off })
    expect(w.sets).toEqual([])
    expect(S.askFifo).toBe('')
  }
})

test('Linux: a shim for each write tool found, none for the others; the shim of a tool that is gone goes', async () => {
  // Another process's shims folder is not touched.
  const w = shimWorld({ found: ['wl-copy', 'xsel'], files: { '/c/shims-99/xclip': 'old', '/c/shims-5/xclip': 'other' } })
  expect(await setUpShims(w.$, '/c', false)).toEqual({ tools: ['wl-copy', 'xsel'] })
  expect(w.runs[0]!.slice(4)).toEqual(['wl-copy', 'xclip', 'xsel'])
  expect(shimsOf(w.files)).toEqual(['/c/shims-99/wl-copy', '/c/shims-99/xsel'])
  expect(w.files.get('/c/shims-5/xclip')).toBe('other')
  expect(w.runs[1]!.slice(2)).toEqual(['install', '/c', '.new-99', '/c/shims-99/wl-copy', '-/c/shims-99/xclip', '/c/shims-99/xsel'])
})

test('Linux with no write tool: no shim, PATH not changed, off with the reason; S.askFifo stays empty', async () => {
  const w = shimWorld({ found: [] })
  expect(await setUpShims(w.$, '/c', false)).toEqual({ off: 'no wl-copy, xclip or xsel: Claude Code copies with its own addon' })
  expect(w.sets).toEqual([])
  expect(S.askFifo).toBe('')
})

test('a chmod that fails: off, with no FIFO', async () => {
  const w = shimWorld({ found: ['pbcopy'], chmodFails: true })
  expect(await setUpShims(w.$, '/c', true)).toEqual({ off: 'the clipboard shims could not be installed' })
  expect(w.sets).toEqual([])
  expect(S.askFifo).toBe('')
})

test('a PATH write the engine holds: off, with the reason', async () => {
  const w = shimWorld({ found: ['pbcopy'], denyPath: true })
  expect(await setUpShims(w.$, '/c', true)).toEqual({ off: 'PATH not set: held by the organization' })
  expect(S.askFifo).toBe('')
})

test('over ssh no shim is made and PATH is not changed; details say why', async ($, on) => {
  const runs: string[][] = []
  const sets: string[] = []
  on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', PATH: '/usr/bin', SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' } as Record<string, string>)[e.name] }))
  on('env.set', async ($: any, e: any) => (sets.push(e.name), { value: {} }))
  on('process.run', async ($: any, e: any) => (runs.push(e.argv), /cc-intelligent-ui-/.test(e.argv.join(' ')) ? ok('/c\nDarwin\n') : ok('', 1)))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('\nAuto copy: off (ssh)')
  expect(runs.some(argv => argv[1]?.endsWith(SHIM_SETUP) && argv[2] === 'find')).toBe(false)
  expect(sets).toEqual([])
})

test('a cache or shims folder that is not private (exit 3 at find or at install): no shims, PATH and IUI_COPY_ASK as they were', async () => {
  for (const unsafe of ['find', 'install'] as const) {
    const w = shimWorld({ found: ['pbcopy'], unsafe })
    expect(await setUpShims(w.$, '/c', true)).toEqual({ off: 'the cache folder is not private' })
    expect(w.sets).toEqual([])
    expect(w.vars.PATH).toBe('/usr/bin:/bin')
    expect(S.askFifo).toBe('')
  }
})

test('no private cache folder (the cache script failed): no shim step, PATH not changed; details say why', async ($, on) => {
  const runs: string[][] = []
  const sets: string[] = []
  on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', PATH: '/usr/bin', TERM_PROGRAM: 'ghostty', IUI_COPY_SHIM: '1' } as Record<string, string>)[e.name] }))
  on('env.set', async ($: any, e: any) => (sets.push(e.name), { value: {} }))
  // The cache script gives only the OS name: the shared fallback is for Typst only.
  on('process.run', async ($: any, e: any) => (runs.push(e.argv), /cc-intelligent-ui-/.test(e.argv.join(' ')) ? ok('\nDarwin\n\n') : ok('', 1)))
  const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
  expect(ran.text).toContain('\nAuto copy: off (the cache folder is not private)')
  expect(runs.some(argv => argv[1]?.endsWith(SHIM_SETUP))).toBe(false)
  expect(sets).toEqual([])
})

for (const [what, vars, off] of [
  ['a background session', { TERM_PROGRAM: 'ghostty', CLAUDE_CODE_SESSION_KIND: 'bg' }, 'a background session'],
  ['a terminal with no pictures', { TERM_PROGRAM: 'Apple_Terminal' }, 'no pictures in this terminal'],
] as const) {
  test(`${what}: no shims, PATH not changed; details say why`, async ($, on) => {
    const runs: string[][] = []
    const sets: string[] = []
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h', PATH: '/usr/bin', IUI_COPY_SHIM: '1', ...vars } as Record<string, string>)[e.name] }))
    on('env.set', async ($: any, e: any) => (sets.push(e.name), { value: {} }))
    on('process.run', async ($: any, e: any) => (runs.push(e.argv), /cc-intelligent-ui-/.test(e.argv.join(' ')) ? ok('/c\nDarwin\n') : ok('', 1)))
    const ran = await $.command.run({ command: 'iui', args: 'details' } as any)
    expect(ran.text).toContain(`\nAuto copy: off (${off})`)
    expect(runs.some(argv => argv[1]?.endsWith(SHIM_SETUP))).toBe(false)
    expect(sets).toEqual([])
  })
}
