import { expect, test } from 'claude-code/testing'

import { compile, forgetTouches, probePage, rootPathOf, STAGE_SH, stageArgs, svgLinksOf } from '../hooks/lib/typst'
import { DEFAULT_METRICS, leanDirs, type Env, type Job } from '../hooks/lib/state'
import { DEFAULT_CELL } from '../hooks/lib/settings'

// Typst's root for answer text: a run folder of its own (STAGE_SH), never `/`.

const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 00 40'

const env: Env = {
  typst: '/usr/bin/typst', canDraw: true, inline: false, cache: '/c', cwd: '/w', root: '/r', isMac: true, stamp: '1', home: '/h',
  claudeTmp: '', termFont: '', designs: '/d', metrics: DEFAULT_METRICS,
}
let keys = 0
const jobOf = (text: string): Job => ({
  key: `k${++keys}`, requestId: 'r', text, columns: 100, cell: DEFAULT_CELL, theme: 'dark', size: 100, grid: true, themeDir: '/h/.claude/cc-intelligent-ui/themes/mine', env, epoch: 0,
})

// A host with typst: notes each process (argv, stdin) in order, and each
// typst argv. `fails(argv)` says when typst fails; `stage` the exit code of
// STAGE_SH; `exists` the files there are.
function host(o: { fails?: (argv: string[]) => boolean; stage?: number; exists?: string[]; files?: Record<string, string> } = {}) {
  const runs: { argv: string[]; stdin?: string }[] = []
  const typst: string[][] = []
  const files = new Map<string, string>(Object.entries(o.files ?? {}))
  const run = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '' })
  const $ = {
    fs: {
      read: async (path: string) => {
        if (!files.has(path)) throw new Error('ENOENT')
        return files.get(path)!
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
      exists: async (path: string) => (o.exists ?? []).includes(path),
      list: async () => ['a-1.png', 'b-1.png'].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 1, isLink: false })),
    },
    process: {
      run: async (argv: string[], init?: { stdin?: string }) => {
        runs.push({ argv, ...(init?.stdin !== undefined ? { stdin: init.stdin } : {}) })
        if (argv[2] === STAGE_SH) return run('', o.stage ?? 0)
        if (argv.join(' ').includes('od -An')) return run(argv.filter(a => a.endsWith('.png')).map(() => `${HEAD}\n@\n`).join(''))
        return run('')
      },
      spawn: (request: { argv: string[] }) => {
        const argv = request.argv.slice(4)
        typst.push(argv)
        runs.push({ argv })
        const fail = o.fails?.(argv) ?? false
        return (async function* () {
          yield { stream: 'stdout' as const, text: argv[1] === 'query' ? '4242\n[]' : '4242\n' }
          if (fail) yield { stream: 'stderr' as const, text: 'error: boom' }
          return { code: fail ? 1 : 0, signal: null }
        })()
      },
    },
    clock: { after: () => ({ cancel() {} }) },
  } as any
  return { $, runs, typst, files }
}

const reset = () => {
  leanDirs.clear()
  forgetTouches()
}
const rootOf = (argv: string[]) => argv[argv.indexOf('--root') + 1]!
const stages = (h: ReturnType<typeof host>) => h.runs.filter(r => r.argv[2] === STAGE_SH)
// Lets the removal of a run folder (not waited for) start.
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test('a compile runs typst in a new run folder of its key folder, never with the root at /', async () => {
  reset()
  const h = host({ exists: ['/w/pic.png'] })
  const job = jobOf('A picture ![p](pic.png) and a block:\n\n```typst\n#read("/etc/hosts")\n```')
  expect(await compile(h.$, job)).not.toBe('failed')
  await settle()
  expect(h.typst.length).toBe(1)
  const argv = h.typst[0]!
  const run = rootOf(argv)
  expect(argv).toContain('--root')
  expect(run).not.toBe('/')
  expect(run.startsWith(`/c/${job.key}/r-`)).toBe(true)
  // The template is the copy in the run folder (at its own path there).
  expect(argv).toContain(`${run}/r/render/md.typ`)
  expect(argv).not.toContain('/r/render/md.typ')
  // The inputs keep their paths: the run folder has the files there.
  expect(argv).toContain(`doc=/c/${job.key}/doc.json`)
  expect(argv).toContain(`theme-dir=${job.themeDir}`)
  // The folder is made first, with the doc JSON (as written) and the image.
  const [stage] = stages(h)
  expect(stage!.argv.slice(4)).toEqual([run, '/r', `/c/${job.key}/doc.json`, job.themeDir, '/w/pic.png'])
  expect(stage!.stdin).toBe(h.files.get(`/c/${job.key}/doc.json`))
  expect(h.runs.indexOf(stage!)).toBeLessThan(h.runs.findIndex(r => r.argv === argv))
  // It goes after the run.
  expect(h.runs.some(r => r.argv.join(' ') === `rm -rf ${run}`)).toBe(true)
  reset()
})

test('the safe retry and the probe each run in a run folder of their own', async () => {
  reset()
  const h = host({ fails: argv => !argv.includes('safe=1') })
  const job = jobOf('Some text.')
  const result = await compile(h.$, job)
  expect(result).not.toBe('failed')
  expect(h.typst.length).toBe(2)
  const [first, safe] = h.typst.map(rootOf)
  expect(first).not.toBe(safe)
  await probePage(h.$, job, `/c/${job.key}`, { page: 0, pages: 1, isSafe: true })
  const probe = h.typst[2]!
  expect(probe[1]).toBe('query')
  expect(rootOf(probe).startsWith(`/c/${job.key}/r-`)).toBe(true)
  expect(new Set(h.typst.map(rootOf)).size).toBe(3)
  // No typst run anywhere has the root at /.
  for (const argv of h.typst) expect(rootOf(argv)).not.toBe('/')
  // The probe's folder has the doc JSON the compile wrote.
  expect(stages(h)[2]!.stdin).toBe(h.files.get(`/c/${job.key}/doc.json`))
  reset()
})

test('a doc of more than one segment keeps its seams in the run folder, for the compile and the probe', async () => {
  reset()
  const h = host()
  const job = jobOf(Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`.trim()).join('\n\n'))
  await compile(h.$, job)
  const written = JSON.parse(h.files.get(`/c/${job.key}/doc.json`)!)
  expect(written.segments.length).toBeGreaterThan(1)
  expect(Array.isArray(written.seams)).toBe(true)
  expect(JSON.parse(stages(h)[0]!.stdin!).seams).toEqual(written.seams)
  await probePage(h.$, job, `/c/${job.key}`, { page: 0, pages: written.segments.length, isSafe: false })
  expect(JSON.parse(stages(h).at(-1)!.stdin!).seams).toEqual(written.seams)
  reset()
})

test('two compiles of the same key at once never share a run folder', async () => {
  reset()
  const h = host()
  const job = jobOf('Same text.')
  await Promise.all([compile(h.$, job), compile(h.$, { ...job })])
  const roots = h.typst.map(rootOf)
  expect(roots.length).toBe(2)
  expect(roots[0]).not.toBe(roots[1])
  reset()
})

test('when the run folder can not be made, typst still gets that folder as its root (it then fails), never /', async () => {
  reset()
  const h = host({ stage: 1, fails: () => true })
  expect(await compile(h.$, jobOf('Text.'))).toBe('failed')
  expect(h.typst.length).toBe(2)
  for (const argv of h.typst) expect(rootOf(argv).startsWith('/c/k')).toBe(true)
  reset()
})

test('paths in the root are resolved by name; a path above the root is none', () => {
  expect(rootPathOf('/a/./b//c/../d.png')).toBe('/a/b/d.png')
  expect(rootPathOf('/a/b/')).toBe('/a/b')
  expect(rootPathOf('/../etc/hosts')).toBe(null)
  expect(rootPathOf('/a/../../etc/hosts')).toBe(null)
  expect(rootPathOf('/')).toBe('/')
})

test('the run folder gets each allowed image once, by its full path in the root', () => {
  const images = ['pic.png', '/w/pic.png', './pic.png', '/w/./pic.png', 'x/../../up.png', '/w/x/../../up.png', '/../bad.png', '/../bad.png']
  expect(stageArgs('/c/k/r-1', '/r/', '/c/k/doc.json', '/t//mine', images)).toEqual(['/c/k/r-1', '/r', '/c/k/doc.json', '/t/mine', '/w/pic.png', '/up.png'])
  expect(stageArgs('/c/k/r-1', '/r', '/c/k/doc.json', '/t', [], ['/w/a.png', '/w/a.png'])).toEqual(['/c/k/r-1', '/r', '/c/k/doc.json', '/t', '/w/a.png'])
})

test("an SVG's linked images: relative image paths only, from the SVG's folder", () => {
  const svg = [
    '<image href="a.png"/>', '<image xlink:href=\'../up/b.JPG\'/>', '<image href="/etc/x.png"/>', '<image href="data:image/png;base64,AA"/>',
    '<image href="https://x/y.png"/>', '<use href="#z"/>', '<image href="notes.txt"/>', '<image href="../../../../../x.png"/>',
  ].join('')
  expect(svgLinksOf(svg, '/w/pics/s.svg')).toEqual(['/w/pics/a.png', '/w/up/b.JPG'])
})

test('an allowed SVG gets the images it links to in the run folder', async () => {
  reset()
  const h = host({ exists: ['/w/s.svg'], files: { '/w/s.svg': '<svg><image href="pic.png"/></svg>' } })
  await compile(h.$, jobOf('![s](s.svg)'))
  expect(stages(h)[0]!.argv.slice(8)).toEqual(['/w/s.svg', '/w/pic.png'])
  reset()
})
