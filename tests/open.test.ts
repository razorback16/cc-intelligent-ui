import { expect, test } from 'claude-code/testing'

import {
  autoOf, DETACH_SH, detachedArgv, editorNow, EDITOR_NAMES, extOf, findAuto, findOnPath, openArgv, openedText, opensPlain, parseEditor, pathsOf, useOf, type Use,
} from '../hooks/lib/open'
import type { Target } from '../hooks/lib/targets'
import { S } from '../hooks/lib/state'

const FILE: Target = { kind: 'file', path: '/w/hooks/lib/copy.ts', line: 42, column: 5 }
const LINE: Target = { kind: 'file', path: '/w/a.py', line: 7 }
const BARE: Target = { kind: 'file', path: '/w/README.md' }
const known = (name: string) => ({ kind: 'known' as const, name, bin: `/bin/${name}` })
const argv = (target: Target, use: Use, isMac = true) => openArgv(target, { isMac, use })

// ---- The argv ---------------------------------------------------------------

test('a web link opens with open on macOS and xdg-open on Linux, whatever the editor', () => {
  const web: Target = { kind: 'web', href: 'https://x.dev/a?b=1' }
  expect(argv(web, known('code'))).toEqual(['open', 'https://x.dev/a?b=1'])
  expect(argv(web, known('code'), false)).toEqual(['xdg-open', 'https://x.dev/a?b=1'])
  expect(argv({ kind: 'web', href: 'mailto:a@b.co' }, { kind: 'app' })).toEqual(['open', 'mailto:a@b.co'])
})

test('a command or code is not opened', () => {
  expect(argv({ kind: 'command', text: 'ls' }, known('code'))).toBe(null)
  expect(argv({ kind: 'code', text: 'x' }, { kind: 'app' })).toBe(null)
})

test('VS Code and its kin take -g path:line:column', () => {
  for (const name of ['code', 'code-insiders', 'codium', 'cursor', 'windsurf']) {
    expect(argv(FILE, known(name))).toEqual([`/bin/${name}`, '-g', '/w/hooks/lib/copy.ts:42:5'])
  }
  expect(argv(LINE, known('code'))).toEqual(['/bin/code', '-g', '/w/a.py:7'])
  expect(argv(BARE, known('code'))).toEqual(['/bin/code', '-g', '/w/README.md'])
})

test('zed and subl take path:line:column', () => {
  for (const name of ['zed', 'zeditor', 'subl']) expect(argv(FILE, known(name))).toEqual([`/bin/${name}`, '/w/hooks/lib/copy.ts:42:5'])
  expect(argv(LINE, known('zed'))).toEqual(['/bin/zed', '/w/a.py:7'])
  expect(argv(BARE, known('subl'))).toEqual(['/bin/subl', '/w/README.md'])
})

test('JetBrains IDEs take --line and --column before the path', () => {
  for (const name of ['idea', 'webstorm', 'pycharm', 'goland', 'clion', 'rider']) {
    expect(argv(FILE, known(name))).toEqual([`/bin/${name}`, '--line', '42', '--column', '5', '/w/hooks/lib/copy.ts'])
  }
  expect(argv(LINE, known('pycharm'))).toEqual(['/bin/pycharm', '--line', '7', '/w/a.py'])
  expect(argv(BARE, known('idea'))).toEqual(['/bin/idea', '/w/README.md'])
})

const at = (path: string): Target => ({ kind: 'file', path })
const APP: Use = { kind: 'app' }
// Files a plain `open` or `xdg-open` could run, follow or launch.
const RUN = ['/w/scripts/setup.command', '/w/run.tool', '/w/Go.terminal', '/w/a.webloc', '/w/a.fileloc', '/w/a.inetloc', '/w/x.jar', '/w/Tool.app', '/w/a.desktop', '/w/a.exe', '/w/a.pkg', '/w/setup', '/w/.bashrc', '/w/a.unknownext']

test('the system app opens code and text with no line: open -t (the text editor) on macOS, xdg-open on Linux', () => {
  expect(argv(FILE, APP)).toEqual(['open', '-t', '/w/hooks/lib/copy.ts'])
  expect(argv(FILE, APP, false)).toEqual(['xdg-open', '/w/hooks/lib/copy.ts'])
  for (const path of ['/w/README.md', '/w/NOTES.MD', '/w/a.txt', '/w/a.json', '/w/c.yaml', '/w/c.toml', '/w/d.csv', '/w/x.log', '/w/m.rs']) {
    expect(argv(at(path), APP)).toEqual(['open', '-t', path])
    expect(argv(at(path), APP, false)).toEqual(['xdg-open', path])
  }
})

test('the system app opens a picture or a PDF with a plain open (open, xdg-open)', () => {
  for (const path of ['/w/shot.png', '/w/a.JPG', '/w/a.jpeg', '/w/a.gif', '/w/a.webp', '/w/a.svg', '/w/doc.pdf']) {
    expect(argv(at(path), APP)).toEqual(['open', path])
    expect(argv(at(path), APP, false)).toEqual(['xdg-open', path])
  }
})

test('the system app does not open a file it could run (.command, .app, .fileloc, .desktop, no extension, unknown): null, so it copies', () => {
  for (const path of RUN) {
    expect(argv(at(path), APP)).toBe(null)
    expect(argv(at(path), APP, false)).toBe(null)
  }
  // A missed editor setting that fell back to the system app: the same.
  expect(argv(at('/w/scripts/setup.command'), { kind: 'app', missed: 'code' })).toBe(null)
})

test('on Linux xdg-open does not open scripts, notebooks or web pages (an app may run them); on macOS open -t does', () => {
  for (const path of ['/w/a.sh', '/w/a.bash', '/w/a.zsh', '/w/a.fish', '/w/a.ps1', '/w/a.py', '/w/a.rb', '/w/a.pl', '/w/a.js', '/w/a.html', '/w/a.ipynb']) {
    expect(argv(at(path), APP, false)).toBe(null)
    expect(argv(at(path), APP)).toEqual(['open', '-t', path])
  }
})

test('an editor takes any file as an argument: a .command opens in it as text', () => {
  expect(argv(at('/w/scripts/setup.command'), known('code'))).toEqual(['/bin/code', '-g', '/w/scripts/setup.command'])
  expect(argv(at('/w/setup'), { kind: 'command', words: ['hx', '{path}'], bin: '/bin/hx' }, false)).toEqual(['/bin/hx', '/w/setup'])
})

test('a plain open runs nothing only for pictures, PDFs and plain text or code', () => {
  for (const path of ['/w/a.png', '/w/a.pdf', '/w/a.md', '/w/a.ts', '/w/a.json']) expect(opensPlain(path)).toBe(true)
  for (const path of [...RUN, '/w/a.sh', '/w/a.py', '/w/a.html']) expect(opensPlain(path)).toBe(false)
  expect([extOf('/w/a.B/C'), extOf('/w/x.tar.GZ'), extOf('/w/a.')]).toEqual(['', 'gz', ''])
})

test('a command puts in its placeholders; a word whose placeholder has no value is left out', () => {
  const nvim: Use = { kind: 'command', words: ['nvim-qt', '+{line}', '{path}'], bin: '/opt/bin/nvim-qt' }
  expect(argv(FILE, nvim)).toEqual(['/opt/bin/nvim-qt', '+42', '/w/hooks/lib/copy.ts'])
  expect(argv(BARE, nvim)).toEqual(['/opt/bin/nvim-qt', '/w/README.md'])
  const col: Use = { kind: 'command', words: ['ed', '--at={line},{column}', '{path}:{line}:{column}'], bin: '/bin/ed' }
  expect(argv(FILE, col)).toEqual(['/bin/ed', '--at=42,5', '/w/hooks/lib/copy.ts:42:5'])
  // In the path's word only the placeholder with no value goes (and its `:`).
  expect(argv(LINE, col)).toEqual(['/bin/ed', '/w/a.py:7'])
  expect(argv(BARE, col)).toEqual(['/bin/ed', '/w/README.md'])
  // A `$` in a path is put in as it is.
  expect(argv({ kind: 'file', path: "/w/$&'x.ts" }, nvim)).toEqual(['/opt/bin/nvim-qt', "/w/$&'x.ts"])
})

test('an opener runs detached: the argv as the fixed script\'s arguments, never in it', () => {
  const argv = ['open', "/w/a b/$(rm -rf ~)'x.ts"]
  expect(detachedArgv(argv)).toEqual(['sh', '-c', DETACH_SH, 'sh', ...argv])
  expect(DETACH_SH).not.toContain('rm')
  // A program still running after about 2 s (20 polls of 0.1 s) counts as opened; one that ends gives its exit code.
  expect(DETACH_SH).toContain('[ "$i" -ge 20 ] && exit 0')
  expect(DETACH_SH.endsWith('wait "$p"')).toBe(true)
})

// ---- The setting ------------------------------------------------------------

test('the setting: auto (also empty), default, a known editor, or a command with {path}', () => {
  expect(parseEditor('auto')).toEqual({ kind: 'auto' })
  expect(parseEditor('  ')).toEqual({ kind: 'auto' })
  expect(parseEditor('default')).toEqual({ kind: 'default' })
  expect(parseEditor(' zed ')).toEqual({ kind: 'known', name: 'zed' })
  expect(parseEditor('nvim-qt  +{line} {path}')).toEqual({ kind: 'command', words: ['nvim-qt', '+{line}', '{path}'] })
  // One word that is no known editor: a command that takes the path.
  expect(parseEditor('nosuch')).toEqual({ kind: 'command', words: ['nosuch', '{path}'] })
  expect(parseEditor('/opt/hx')).toEqual({ kind: 'command', words: ['/opt/hx', '{path}'] })
  // More words with no {path}, or a placeholder in the program: none.
  expect(parseEditor('nvim +{line}')).toBe(null)
  expect(parseEditor('{path}')).toBe(null)
  expect(parseEditor('{path} x')).toBe(null)
})

test('auto takes the first known editor on the PATH, in the table order', () => {
  expect(EDITOR_NAMES.slice(0, 6)).toEqual(['code', 'code-insiders', 'codium', 'cursor', 'windsurf', 'zed'])
  const has = (...names: string[]) => (name: string) => names.includes(name)
  expect(autoOf(has('subl', 'zed', 'code'))).toBe('code')
  expect(autoOf(has('rider', 'zed'))).toBe('zed')
  expect(autoOf(has('cursor', 'codium'))).toBe('codium')
  expect(autoOf(has('nvim'))).toBe('')
})

test('the program for a setting: on the PATH, else auto, else the system app; a miss is named', () => {
  const paths: Record<string, string> = { zed: '/bin/zed', hx: '/bin/hx' }
  const pathOf = (name: string) => paths[name] ?? ''
  expect(useOf({ kind: 'auto' }, pathOf, 'zed')).toEqual(known('zed'))
  expect(useOf({ kind: 'auto' }, pathOf, '')).toEqual({ kind: 'app' })
  expect(useOf({ kind: 'default' }, pathOf, 'zed')).toEqual({ kind: 'app' })
  expect(useOf({ kind: 'known', name: 'zed' }, pathOf, '')).toEqual(known('zed'))
  expect(useOf({ kind: 'known', name: 'code' }, pathOf, 'zed')).toEqual({ ...known('zed'), missed: 'code' })
  expect(useOf({ kind: 'known', name: 'code' }, pathOf, '')).toEqual({ kind: 'app', missed: 'code' })
  expect(useOf({ kind: 'command', words: ['hx', '{path}'] }, pathOf, 'zed')).toEqual({ kind: 'command', words: ['hx', '{path}'], bin: '/bin/hx' })
  expect(useOf({ kind: 'command', words: ['/opt/hx', '{path}'] }, pathOf, 'zed')).toEqual({ kind: 'command', words: ['/opt/hx', '{path}'], bin: '/opt/hx' })
  expect(useOf({ kind: 'command', words: ['nosuch', '{path}'] }, pathOf, 'zed')).toEqual({ ...known('zed'), missed: 'nosuch' })
})

test("the toast names the link, or the file and the program (and a setting's program not on the PATH)", () => {
  expect(openedText({ kind: 'web', href: 'https://x.dev' }, { kind: 'app' })).toBe('Intelligent UI: opened the link')
  expect(openedText(FILE, known('code'))).toBe('Intelligent UI: opened copy.ts in code')
  expect(openedText(FILE, { ...known('zed'), missed: 'code' })).toBe('Intelligent UI: opened copy.ts in zed (code is not on the PATH)')
  expect(openedText(FILE, { kind: 'app' })).toBe('Intelligent UI: opened copy.ts in the default app')
  expect(openedText(FILE, { kind: 'app', missed: 'code' })).toBe('Intelligent UI: opened copy.ts in the default app (code is not on the PATH)')
  expect(openedText(FILE, { kind: 'command', words: ['/opt/bin/hx', '{path}'], bin: '/opt/bin/hx' })).toBe('Intelligent UI: opened copy.ts in hx')
})

// ---- The PATH ---------------------------------------------------------------

// A fake `$` whose shell finds `on` (name to path) for `sh -lc` (`login`) or `sh -c`.
function fake(o: { login?: Record<string, string>; plain?: Record<string, string> }) {
  const runs: string[][] = []
  const $ = {
    process: {
      run: async (argv: string[]) => {
        runs.push(argv)
        const on = (argv[1] === '-lc' ? o.login : o.plain) ?? {}
        const names = argv.slice(4)
        const stdout = names.flatMap(n => (on[n] ? [`${n} ${on[n]}`] : [])).join('\n')
        return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      },
    },
  } as any
  S.onPath = new Map()
  S.autoEditor = null
  S.editor = 'auto'
  return { $, runs }
}

test('the lookup passes the names to the shell as arguments; -c looks for those -lc did not find', async () => {
  const w = fake({ login: { zed: '/l/zed' }, plain: { code: '/p/code', subl: 'subl' } })
  const got = await pathsOf(w.$, ['code', 'zed', 'subl', 'a;rm', '-x'])
  expect([...got]).toEqual([['code', '/p/code'], ['zed', '/l/zed'], ['subl', ''], ['a;rm', ''], ['-x', '']])
  expect(w.runs.map(a => [a[1], ...a.slice(3)])).toEqual([['-lc', 'sh', 'code', 'zed', 'subl'], ['-c', 'sh', 'code', 'subl']])
  expect(w.runs.every(a => !a[2]!.includes('code'))).toBe(true)
})

test('a path is looked up once per session', async () => {
  const w = fake({ login: { zed: '/l/zed' } })
  expect(await findOnPath(w.$, 'zed')).toBe('/l/zed')
  expect(await findOnPath(w.$, 'zed')).toBe('/l/zed')
  expect(await findOnPath(w.$, 'nosuch')).toBe('')
  expect(await findOnPath(w.$, 'nosuch')).toBe('')
  expect(w.runs.length).toBe(3)
})

test("auto's choice: all known editors in one lookup, the first found, cached", async () => {
  const w = fake({ login: { subl: '/l/subl', cursor: '/l/cursor', rider: '/l/rider' } })
  expect(await findAuto(w.$)).toBe('cursor')
  expect(w.runs[0]!.slice(4)).toEqual([...EDITOR_NAMES])
  const looked = w.runs.length
  expect(await findAuto(w.$)).toBe('cursor')
  expect(w.runs.length).toBe(looked)
  const none = fake({})
  expect(await findAuto(none.$)).toBe('')
  expect(S.autoEditor).toBe('')
})

test('the program now, for each setting', async () => {
  const w = fake({ login: { zed: '/l/zed', hx: '/l/hx' } })
  expect(await editorNow(w.$)).toEqual({ kind: 'known', name: 'zed', bin: '/l/zed' })
  S.editor = 'code'
  expect(await editorNow(w.$)).toEqual({ kind: 'known', name: 'zed', bin: '/l/zed', missed: 'code' })
  S.editor = 'hx -g {path}'
  expect(await editorNow(w.$)).toEqual({ kind: 'command', words: ['hx', '-g', '{path}'], bin: '/l/hx' })
  S.editor = 'default'
  expect(await editorNow(w.$)).toEqual({ kind: 'app' })
  // A setting that is none: auto.
  S.editor = 'hx +{line}'
  expect(await editorNow(w.$)).toEqual({ kind: 'known', name: 'zed', bin: '/l/zed' })
  const none = fake({})
  S.editor = 'default'
  expect(await editorNow(none.$)).toEqual({ kind: 'app' })
  expect(none.runs).toEqual([])
  S.editor = 'auto'
})
