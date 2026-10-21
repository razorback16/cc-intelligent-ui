import { expect, test } from 'claude-code/testing'

import { fontListOf, hasBoldFace, isPlain, LEAN_SH, leanDirOf, leanFiles, leanFontsFor } from '../hooks/lib/fonts'
import { compile, forgetTouches, leanFontsOf, measureFonts, probeCall, typstCall } from '../hooks/lib/typst'
import { DEFAULT_METRICS, fauxBoldOf, leanDirs, type Env, type Job, type LeanFonts } from '../hooks/lib/state'
import { DEFAULT_CELL } from '../hooks/lib/settings'

// `typst fonts --variants` as Typst 0.15 prints it.
const LISTING = [
  'Apple Color Emoji',
  '  └ /System/Library/Fonts/Apple Color Emoji.ttc',
  '      Style: Normal, Weight: 400, Stretch: 100%',
  'DejaVu Sans Mono',
  '  ├ (Embedded)',
  '  │   Style: Normal, Weight: 700, Stretch: 100%',
  '  └ (Embedded)',
  '      Style: Normal, Weight: 400, Stretch: 100%',
  'Helvetica',
  '  ├ /System/Library/Fonts/Helvetica.ttc',
  '  │   Style: Normal, Weight: 400, Stretch: 100%',
  '  └ /System/Library/Fonts/Helvetica.ttc',
  '      Style: Normal, Weight: 400, Stretch: 100%',
  'Menlo',
  '  ├ /System/Library/Fonts/Menlo.ttc',
  '  │   Style: Normal, Weight: 400, Stretch: 100%',
  '  └ /System/Library/Fonts/Menlo.ttc',
  '      Style: Normal, Weight: 700, Stretch: 100%',
  'MesloLGS NF',
  '  ├ /Users/me/Library/Fonts/MesloLGS NF Regular.ttf',
  '  │   Style: Normal, Weight: 400, Stretch: 100%',
  '  └ /Users/me/Library/Fonts/MesloLGS NF Bold.ttf',
  '      Style: Normal, Weight: 700, Stretch: 100%',
  'PingFang SC',
  '  └ /System/Library/AssetsV2/PingFang.ttc',
  '      Style: Normal, Weight: 400, Stretch: 100%',
  'SF Pro Text',
  '  ├ /Library/Fonts/SF-Pro-Text-Regular.otf',
  '  │   Style: Normal, Weight: 400, Stretch: 100%',
  '  └ /Library/Fonts/SF-Pro-Text-Bold.otf',
  '      Style: Normal, Weight: 700, Stretch: 100%',
  '',
].join('\n')

const FONTS: LeanFonts = {
  body: ['SF Pro Text', 'Helvetica', 'Noto Sans', 'PingFang SC', 'Apple Color Emoji'],
  code: ['Menlo', 'SF Mono', 'DejaVu Sans Mono', 'PingFang SC', 'Apple Color Emoji'],
  plain: true,
}

test('the font list reads each family with its files and variants', () => {
  const list = fontListOf(LISTING)
  expect(list.get('menlo')).toEqual([
    { file: '/System/Library/Fonts/Menlo.ttc', variant: 'Normal, Weight: 400, Stretch: 100%' },
    { file: '/System/Library/Fonts/Menlo.ttc', variant: 'Normal, Weight: 700, Stretch: 100%' },
  ])
  expect(list.get('dejavu sans mono')).toEqual([
    { file: null, variant: 'Normal, Weight: 700, Stretch: 100%' },
    { file: null, variant: 'Normal, Weight: 400, Stretch: 100%' },
  ])
  expect(list.get('apple color emoji')?.length).toBe(1)
  expect([...list.keys()].length).toBe(7)
})

test('a variable font is read by its file, without the (Variable) mark', () => {
  const list = fontListOf([
    'JetBrains Mono',
    '  ├ /c/fonts/ghostty-1/JetBrainsMono-1.ttf (Variable)',
    '  │   Style: Normal',
    '  │   Stretch: 100%',
    '  │   Weight: 100-800 (Default: 400)',
    '  └ /c/fonts/ghostty-1/JetBrainsMono-2.ttf (Variable)',
    '      Style: Italic',
    '      Stretch: 100%',
    '      Weight: 100-800 (Default: 400)',
    '',
  ].join('\n'))
  expect(list.get('jetbrains mono')).toEqual([
    { file: '/c/fonts/ghostty-1/JetBrainsMono-1.ttf', variant: 'Normal' },
    { file: '/c/fonts/ghostty-1/JetBrainsMono-2.ttf', variant: 'Italic' },
  ])
  // The lean set links the two files first, as the terminal font.
  const both = new Map([...fontListOf(LISTING), ...list])
  expect(leanFiles(both, 'JetBrains Mono', FONTS)?.slice(0, 2)).toEqual(['/c/fonts/ghostty-1/JetBrainsMono-1.ttf', '/c/fonts/ghostty-1/JetBrainsMono-2.ttf'])
})

// Monaco has one face (no bold); a variable font has a range of weights.
const MONACO = ['Monaco', '  └ /System/Library/Fonts/Monaco.ttf', '      Style: Normal, Weight: 400, Stretch: 100%', ''].join('\n')
const VARIABLE = (top: number) => ['Cascadia Code NF', '  └ /c/fonts/rio-1/rio-1.ttf (Variable)', '      Style: Normal', '      Stretch: 100%', `      Weight: 200-${top} (Default: 400)`, ''].join('\n')

test('a bold face is a weight of 600 or more; null when Typst does not list the family', () => {
  expect(hasBoldFace(LISTING, 'Menlo')).toBe(true)
  expect(hasBoldFace(LISTING, 'dejavu sans mono')).toBe(true)
  expect(hasBoldFace(LISTING, 'Helvetica')).toBe(false)
  expect(hasBoldFace(LISTING + MONACO, 'Monaco')).toBe(false)
  expect(hasBoldFace(VARIABLE(700), 'Cascadia Code NF')).toBe(true)
  expect(hasBoldFace(VARIABLE(500), 'Cascadia Code NF')).toBe(false)
  expect(hasBoldFace(LISTING, 'Monaco')).toBe(null)
  expect(hasBoldFace('', 'Menlo')).toBe(null)
})

const METRICS = JSON.stringify({ term: { adv: 0.6, xh: 0.55, avg: 0.6 }, menlo: { adv: 0.6, xh: 0.55, avg: 0.6 }, body: { adv: 0.6, xh: 0.52, avg: 0.48 } })
// The measure and the font list in the same time, with the same font paths.
const measured = async (family: string, listing: string | null) => {
  const ran: { argv: string[]; env?: Record<string, string> }[] = []
  const run = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '' })
  const $ = {
    process: {
      run: async (argv: string[], init?: { env?: Record<string, string> }) => {
        ran.push({ argv, env: init?.env })
        if (argv[1] === 'eval') return run(METRICS)
        if (argv[1] === 'fonts') return listing === null ? run('', 1) : run(listing)
        return run('', 1)
      },
    },
  }
  return { m: await measureFonts($ as any, '/usr/bin/typst', '/r', '/c', family, '/t'), ran }
}

test('the measure keeps whether the terminal font has a bold face; a fake bold only when it has none', async () => {
  const monaco = await measured('Monaco', LISTING + MONACO)
  expect(monaco.m.termBold).toBe(false)
  expect(fauxBoldOf(monaco.m)).toBe(true)
  // The list sees the same fonts as the measure (the same font paths).
  const [measure, list] = [monaco.ran.find(r => r.argv[1] === 'eval')!, monaco.ran.find(r => r.argv[1] === 'fonts')!]
  expect(list.argv).toEqual(['/usr/bin/typst', 'fonts', '--variants'])
  expect(list.env).toEqual(measure.env)
  expect((await measured('Menlo', LISTING)).m.termBold).toBe(true)
  // Not listed, or the list fails: not known, so no fake bold.
  for (const listing of [LISTING, null]) {
    const m = (await measured('Monaco', listing)).m
    expect('termBold' in m).toBe(false)
    expect(fauxBoldOf(m)).toBe(false)
  }
  // No terminal font: no list.
  expect((await measured('', LISTING)).ran.some(r => r.argv[1] === 'fonts')).toBe(false)
  // Typst does not have the font (no term metrics): no fake bold.
  expect(fauxBoldOf({ ...DEFAULT_METRICS, term: null, termBold: false })).toBe(false)
})

test('the lean set has the terminal font and the Latin fonts, not the CJK and emoji fonts', () => {
  expect(leanFiles(fontListOf(LISTING), 'MesloLGS NF', FONTS)).toEqual([
    '/Users/me/Library/Fonts/MesloLGS NF Regular.ttf',
    '/Users/me/Library/Fonts/MesloLGS NF Bold.ttf',
    '/Library/Fonts/SF-Pro-Text-Regular.otf',
    '/Library/Fonts/SF-Pro-Text-Bold.otf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Menlo.ttc',
  ])
  // No terminal font: the theme's fonts only.
  expect(leanFiles(fontListOf(LISTING), '', FONTS)).not.toContain('/Users/me/Library/Fonts/MesloLGS NF Regular.ttf')
})

test('no lean set when it could draw differently', () => {
  const list = fontListOf(LISTING)
  // The first installed body font is a CJK font: plain text would use it.
  expect(leanFiles(list, '', { ...FONTS, body: ['Noto Sans', 'PingFang SC', 'Helvetica'] })).toBeNull()
  // No body font is installed (Typst then takes any font).
  expect(leanFiles(list, '', { ...FONTS, body: ['Inter', 'Noto Sans'] })).toBeNull()
  // One variant in two files: Typst takes the one it read first.
  const twice = `${LISTING}SF Pro Text\n  └ /Users/me/Library/Fonts/SF-Pro-Text-Regular.otf\n      Style: Normal, Weight: 400, Stretch: 100%\n`
  expect(leanFiles(fontListOf(twice), '', FONTS)).toBeNull()
  // The same variant twice in one file (a collection) is no problem.
  expect(leanFiles(list, '', FONTS)).toContain('/System/Library/Fonts/Helvetica.ttc')
  // A code list of embedded fonts only is installed.
  expect(leanFiles(list, '', { ...FONTS, code: ['DejaVu Sans Mono'] })).not.toBeNull()
})

test('a terminal font that is a skipped name is kept when it is the first installed font', () => {
  const list = fontListOf(LISTING)
  expect(leanFiles(list, 'PingFang SC', FONTS)).toContain('/System/Library/AssetsV2/PingFang.ttc')
  expect(leanFiles(list, '', { body: ['PingFang SC'], code: ['Menlo'], plain: true })).toBeNull()
})

test('a font list with no files gives no lean set', () => {
  expect(leanFiles(fontListOf(''), '', FONTS)).toBeNull()
  expect(leanFiles(fontListOf('DejaVu Sans Mono\n  └ (Embedded)\n      Style: Normal\n'), '', { body: ['DejaVu Sans Mono'], code: ['DejaVu Sans Mono'], plain: true })).toBeNull()
})

test('the lean folder is named by its files', () => {
  expect(leanDirOf('/c', ['/a.ttf'])).toBe(leanDirOf('/c', ['/a.ttf']))
  expect(leanDirOf('/c', ['/a.ttf'])).not.toBe(leanDirOf('/c', ['/b.ttf']))
  expect(leanDirOf('/c', ['/a.ttf']).startsWith('/c/fonts-')).toBe(true)
  expect(LEAN_SH).toContain('ln -s')
})

test('only plain text uses the lean set', () => {
  for (const md of [
    '# Title\n\nSome **bold** text, `code` and [a link](https://x.y).',
    '- [x] done\n- [ ] not\n\n| a | b |\n|--|--|\n| 1 | 2 |',
    '```sh\necho $HOME\n```',
    'Run `echo $PATH` now.',
    'Run ``a ` $b`` now.',
    '```js\nconst a = `$x`\n```\n\nText.',
  ]) expect(isPlain(md)).toBe(true)
  for (const md of [
    'café',
    'Done ✅',
    'An arrow → here',
    'Math $x^2$ here',
    '$$\n\\Box\n$$',
    '```typst\n#circle()\n```',
    '~~~typ\n#circle()\n~~~',
    '![alt](pic.png)',
    '<img src="a.png">',
    'An entity &rarr; and &#8594;',
    // An escaped backtick: no code span is cut out.
    'Not code \\` $x$ \\`',
    // Two backticks open; one closes: no span, so $x$ is math.
    '``$x$`',
    // A code span does not go over lines here.
    'One `a\n$x$ b` two',
  ]) expect(isPlain(md)).toBe(false)
})

test('the lean folder goes into the compile and probe calls only when given', () => {
  const o = { typst: '/t', root: '/r', cache: '/c', ppi: 144, inputs: { theme: 'dark' }, out: '/o/a-{0p}.png' }
  expect(typstCall(o).argv).not.toContain('--ignore-system-fonts')
  const lean = typstCall({ ...o, fonts: '/c/fonts-1' }).argv
  expect(lean.slice(lean.indexOf('--ignore-system-fonts'), lean.indexOf('--ignore-system-fonts') + 3)).toEqual(['--ignore-system-fonts', '--font-path', '/c/fonts-1'])
  expect(probeCall({ ...o, fonts: '/c/fonts-1' }).argv).toContain('/c/fonts-1')
  expect(probeCall(o).argv).not.toContain('--ignore-system-fonts')
})

test('the measure gives the font lists only when they are lists of names', () => {
  expect(leanFontsOf(FONTS)).toEqual(FONTS)
  expect(leanFontsOf({ body: ['A'], code: [1], plain: true })).toBeUndefined()
  expect(leanFontsOf({ body: ['A'], code: ['B'] })).toBeUndefined()
  expect(leanFontsOf(undefined)).toBeUndefined()
})

// ---- On the host ------------------------------------------------------------

const HEAD = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 06 40 00 00 00 40'

const envOf = (fonts?: LeanFonts): Env => ({
  typst: '/usr/bin/typst', canDraw: true, inline: false, cache: '/c', cwd: '/w', root: '/r', isMac: true, stamp: '1', home: '/h',
  claudeTmp: '', termFont: 'MesloLGS NF', designs: '/d', metrics: { ...DEFAULT_METRICS, ...(fonts ? { fonts } : {}) },
})
let keys = 0
const jobOf = (env: Env, text: string): Job => ({
  key: `k${++keys}`, requestId: 'r', text, columns: 100, cell: DEFAULT_CELL, theme: 'dark', size: 100, grid: true, themeDir: '/r/render/themes/vscode', env, epoch: 0,
})

// A host with typst (an engine of its own: these modules are this test's
// copy, not the plugin's). `fails(argv)` says when a compile fails. It
// notes the argv of each compile, the font lists asked for, and the
// folders made.
function host(fails: (argv: string[]) => boolean = () => false) {
  const compiles: string[][] = []
  const made: string[] = []
  const listEnvs: Record<string, string>[] = []
  let listed = 0
  const files = new Map<string, string>()
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
      exists: async (path: string) => made.includes(path),
      list: async () => [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }],
    },
    process: {
      run: async (argv: string[], init?: { env?: Record<string, string> }) => {
        if (argv[0] === '/usr/bin/typst' && argv[1] === 'fonts') return listed++, listEnvs.push(init?.env ?? {}), run(LISTING)
        if (argv[0] === 'sh' && argv[2] === LEAN_SH) return made.push(argv[4]!), run('')
        if (argv.join(' ').includes('od -An')) return run(argv.filter(a => a.endsWith('.png')).map(() => `${HEAD}\n@\n`).join(''))
        return run('')
      },
      spawn: (request: { argv: string[] }) => {
        const argv = request.argv.slice(4)
        compiles.push(argv)
        const fail = fails(argv)
        return (async function* () {
          yield { stream: 'stdout' as const, text: '4242\n' }
          if (fail) yield { stream: 'stderr' as const, text: 'error: boom' }
          return { code: fail ? 1 : 0, signal: null }
        })()
      },
    },
    clock: { after: () => ({ cancel() {} }) },
  } as any
  return { $, compiles, made, listEnvs, listed: () => listed }
}

// Lets the make of the lean folder (in the background) end.
async function made() {
  for (let i = 0; i < 1000 && ![...leanDirs.values()].some(Boolean); i++) await Promise.resolve()
}

const isLean = (argv: string[]) => argv.includes('--ignore-system-fonts')
const reset = () => {
  leanDirs.clear()
  forgetTouches()
}

test('the first plain compile makes the lean folder; the next ones use it', async () => {
  reset()
  const h = host()
  const $ = h.$
  const env = envOf(FONTS)
  expect(await compile($, jobOf(env, 'First answer.'))).not.toBe('failed')
  expect(isLean(h.compiles[0]!)).toBe(false)
  // The make runs in the background: wait for it.
  await made()
  expect(h.made.length).toBe(1)
  expect([...leanDirs.values()]).toEqual([h.made[0]!])
  expect(await compile($, jobOf(env, 'Second answer.'))).not.toBe('failed')
  expect(isLean(h.compiles[1]!)).toBe(true)
  expect(h.compiles[1]).toContain(h.made[0]!)
  // Text that is not plain uses all fonts.
  expect(await compile($, jobOf(env, 'Math $x$.'))).not.toBe('failed')
  expect(isLean(h.compiles[2]!)).toBe(false)
  expect(h.listed()).toBe(1)
  // The fonts are listed as a compile sees them.
  expect(h.listEnvs[0]!.TYPST_PACKAGE_CACHE_PATH).toBe('/c/pkg-cache')
  reset()
})

test('a lean compile that fails runs again with all fonts', async () => {
  reset()
  const h = host(isLean)
  const $ = h.$
  const env = envOf(FONTS)
  await compile($, jobOf(env, 'Warm up.'))
  await made()
  const result = await compile($, jobOf(env, 'Plain text.'))
  expect(result).not.toBe('failed')
  expect(typeof result === 'object' && result.note).toBeFalsy()
  expect(h.compiles.slice(1).map(isLean)).toEqual([true, false])
  reset()
})

test('no lean set without the font lists, with a theme that is not plain, or when its folder is gone', async () => {
  reset()
  const h = host()
  const $ = h.$
  expect(await leanFontsFor($, envOf(), ['Text.'], {})).toBe('')
  expect(await leanFontsFor($, envOf({ ...FONTS, plain: false }), ['Text.'], {})).toBe('')
  expect(h.listed()).toBe(0)
  const env = envOf(FONTS)
  expect(await leanFontsFor($, env, ['Text.'], {})).toBe('')
  await made()
  expect(await leanFontsFor($, env, ['Text.'], {})).toBe(h.made[0]!)
  // The cleanup removed it: all fonts, and the next call makes it again.
  h.made.length = 0
  expect(await leanFontsFor($, env, ['Text.'], {})).toBe('')
  expect(await leanFontsFor($, env, ['Text.'], {})).toBe('')
  await made()
  expect(h.made.length).toBe(1)
  expect(await leanFontsFor($, env, ['Text.'], {})).toBe(h.made[0]!)
  reset()
})

test('each set of fonts keeps its own folder', async () => {
  reset()
  const h = host()
  const a = envOf(FONTS)
  const b = { ...envOf(FONTS), termFont: '' }
  expect(await leanFontsFor(h.$, a, ['Text.'], {})).toBe('')
  expect(await leanFontsFor(h.$, b, ['Text.'], {})).toBe('')
  for (let i = 0; i < 1000 && [...leanDirs.values()].filter(Boolean).length < 2; i++) await Promise.resolve()
  expect(h.made.length).toBe(2)
  expect(h.made[0]).not.toBe(h.made[1])
  expect(await leanFontsFor(h.$, a, ['Text.'], {})).toBe(h.made[0]!)
  expect(await leanFontsFor(h.$, b, ['Text.'], {})).toBe(h.made[1]!)
  expect(await leanFontsFor(h.$, a, ['Text.'], {})).toBe(h.made[0]!)
  expect(h.listed()).toBe(2)
  reset()
})

test('a font list that does not allow the lean set is asked once, and all fonts are used', async () => {
  reset()
  const h = host()
  const env = envOf({ ...FONTS, body: ['PingFang SC', 'Helvetica'] })
  for (let i = 0; i < 3; i++) {
    expect(await leanFontsFor(h.$, env, ['Text.'], {})).toBe('')
    for (let j = 0; j < 200; j++) await Promise.resolve()
  }
  expect(h.listed()).toBe(1)
  expect(h.made.length).toBe(0)
  reset()
})
