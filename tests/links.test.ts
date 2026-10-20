import { expect, test } from 'claude-code/testing'

import { linksOf } from '../hooks/lib/links'

const web = (label: string, href = label) => ({ kind: 'web', label, href })
const file = (path: string, label = path) => ({ kind: 'file', label, path })
const command = (label: string, text = label) => ({ kind: 'command', label, text })

test('a Markdown link is a web link; its label is plain text', () => {
  expect(linksOf('See [Typst docs](https://typst.app/docs).')).toEqual([web('Typst docs', 'https://typst.app/docs')])
  expect(linksOf('[**The** `api` _guide_](https://x.dev/a "Title")')).toEqual([web('The api guide', 'https://x.dev/a')])
  expect(linksOf('[mail](mailto:a@b.co) and <https://a.io/x> and <me@b.co>')).toEqual([
    web('mail', 'mailto:a@b.co'),
    web('https://a.io/x'),
    web('me@b.co', 'mailto:me@b.co'),
  ])
})

test('an image is not a link, but a link around an image is', () => {
  expect(linksOf('![a cat](https://x.io/cat.png)')).toEqual([])
  expect(linksOf('[![CI](https://x.io/badge.svg)](https://x.io/ci)')).toEqual([web('CI', 'https://x.io/ci')])
})

test('anchors, other schemes and relative links are not web links', () => {
  expect(linksOf('[top](#intro) [ftp](ftp://x.org/a) [js](javascript:alert)')).toEqual([])
  expect(linksOf('[the docs](docs/a.md#setup)')).toEqual([file('docs/a.md')])
})

test('reference links use their definitions; a footnote is not a link', () => {
  const md = 'Read [the guide][g], [Docs][] and [home].\n\nA note[^1].\n\n[g]: https://x.io/guide "Guide"\n[docs]: <https://x.io/docs>\n[Home]: https://x.io\n[^1]: Some note text.'
  expect(linksOf(md)).toEqual([web('the guide', 'https://x.io/guide'), web('Docs', 'https://x.io/docs'), web('home', 'https://x.io')])
  expect(linksOf('A [label][nope] with no definition.')).toEqual([])
})

test('a bare URL loses the punctuation after it and a ) that closes nothing', () => {
  expect(linksOf('Go to https://x.io/a, then https://x.io/b.')).toEqual([web('https://x.io/a'), web('https://x.io/b')])
  expect(linksOf('(see https://x.io/c)')).toEqual([web('https://x.io/c')])
  expect(linksOf('https://en.wikipedia.org/wiki/Rust_(language)!')).toEqual([web('https://en.wikipedia.org/wiki/Rust_(language)')])
  expect(linksOf('"https://x.io/q?a=1";')).toEqual([web('https://x.io/q?a=1')])
})

test('no links from fences, inline code or math', () => {
  expect(linksOf('```js\nfetch("https://x.io/api")\n```')).toEqual([])
  expect(linksOf('Run `curl https://x.io/api` now.')).toEqual([])
  expect(linksOf('$a = [b](https://x.io)$ and\n\n$$\nhttps://x.io/m\n$$')).toEqual([])
  expect(linksOf('~~~\nsee hooks/lib/copy.ts:42\n~~~')).toEqual([])
})

test('a file path in inline code or bare text, with a line and a column', () => {
  expect(linksOf('Look at `hooks/lib/copy.ts:42` and src/app.py:10:5.')).toEqual([
    file('hooks/lib/copy.ts', 'hooks/lib/copy.ts:42'),
    file('src/app.py', 'src/app.py:10:5'),
  ])
  expect(linksOf('Edit /abs/x.md, ./a/b.tsx and README.md; also `.github/ci.yml`.')).toEqual([
    file('/abs/x.md'),
    file('./a/b.tsx'),
    file('README.md'),
    file('.github/ci.yml'),
  ])
})

test('versions, abbreviations, domains and names are not file paths', () => {
  expect(linksOf('Version 1.2.3 (or v0.15), e.g. on typst.app with Node.js at 3.5 p.m.')).toEqual([])
  expect(linksOf('`1.2.3` `e.g.` `typst.app` `example.com/a/b.md` `done.`')).toEqual([])
  expect(linksOf('Clone github.com/o/r/blob/main/x.ts today.')).toEqual([])
})

test('a shell fence is one command, prompts dropped; the label shows the first line', () => {
  expect(linksOf('```bash\n$ brew install typst\n```')).toEqual([command('brew install typst')])
  expect(linksOf('```sh\nnpm i\n\nnpm test\n% npm run build\n```')).toEqual([command('npm i (+2 lines)', 'npm i\n\nnpm test\nnpm run build')])
  expect(linksOf('```ZSH\ncd a\nls\n```')).toEqual([command('cd a (+1 line)', 'cd a\nls')])
  expect(linksOf('```bash\n\n```\n\n```python\nprint(1)\n```')).toEqual([])
})

test('a console block keeps only its prompt lines', () => {
  const md = '```console\n$ npm test\n> ok 12 tests\n3 passed\n$ git push \\\n  origin main\nTo github.com\n```'
  expect(linksOf(md)).toEqual([command('npm test (+2 lines)', 'npm test\ngit push \\\n  origin main')])
  expect(linksOf('```shell-session\nno prompt here\n```')).toEqual([])
})

test('a fence inside a list item is a command too', () => {
  expect(linksOf('1. Install:\n   ```bash\n   $ npm i\n   ```\n2. Done, see https://x.io')).toEqual([command('npm i'), web('https://x.io')])
})

test('inline code that starts with ! is a command as written', () => {
  expect(linksOf('Type `! git status` in the prompt; `!x` is not.')).toEqual([command('! git status')])
})

test('each item once, the first, in the order of the text', () => {
  const md = [
    'Open README.md and [the site](https://x.io).',
    '',
    '```bash',
    'npm test',
    '```',
    '',
    'Again: https://x.io, `README.md:3` and',
    '',
    '```sh',
    '$ npm test',
    '```',
  ].join('\n')
  expect(linksOf(md)).toEqual([file('README.md'), web('the site', 'https://x.io'), command('npm test')])
})

test('a file:// link is a local file; a query or fragment is cut; an empty label shows the URL', () => {
  expect(linksOf('[x](file:///abs/a.md#top) [y](docs/b.ts?raw=1)')).toEqual([file('/abs/a.md'), file('docs/b.ts')])
  expect(linksOf('[](https://x.io/e)')).toEqual([web('https://x.io/e')])
})

test('an image written as a reference is not a link', () => {
  expect(linksOf('![logo][g] and ![logo]\n\n[g]: https://x.io/logo.png\n[logo]: https://x.io/l.png')).toEqual([])
})

test('a ~ path and a ../ path are files; a URL with a path is not', () => {
  expect(linksOf('See ~/notes/a.md and ../up/b.json.')).toEqual([file('~/notes/a.md'), file('../up/b.json')])
  expect(linksOf('https://x.io/docs/a.md')).toEqual([web('https://x.io/docs/a.md')])
})

test('a fence that never closes still gives its command; a ~~~ shell fence works', () => {
  expect(linksOf('```bash\nnpm i')).toEqual([command('npm i')])
  expect(linksOf('~~~sh\nls\n~~~')).toEqual([command('ls')])
})

test('a console block: output lines between prompts are dropped', () => {
  expect(linksOf('```console\n$ a\nout\n$ b\n```')).toEqual([command('a (+1 line)', 'a\nb')])
})
