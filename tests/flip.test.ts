import { expect, test } from 'claude-code/testing'

import { encodeSteps, flipPng, flipRows, herdrBand, itermRowOf, padRows, reverseBands, WRITE_PL } from '../hooks/lib/flip'
import { frameOf, framesOf, framesSteps, rgbOf } from '../hooks/lib/frames'
import { decodePng, fromBase64, toBase64, type Rgba } from '../hooks/lib/png'
import { compile, forgetTouches } from '../hooks/lib/typst'
import { DEFAULT_METRICS, type Env, type Job } from '../hooks/lib/state'
import { flipOf, herdrText, renderKey, type HerdrClient } from '../hooks/register'

// A picture whose pixel at (x, y) tells its row: R = y, G = y >> 8, B = x, A = 255 - (y & 15).
const imageOf = (width: number, height: number): Rgba => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([y & 255, y >> 8, x & 255, 255 - (y & 15)], (y * width + x) * 4)
  return { width, height, data }
}
const rowOf = (img: Rgba, y: number) => [...img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4)]
const encode = (img: Rgba) => {
  const steps = encodeSteps(img)
  for (;;) {
    const got = steps.next()
    if (got.done) return got.value
  }
}

// What herdr in iTerm2 shows on row k: the source rect herdr sends, read from the bottom.
const shownRows = (stored: Rgba, k: number, rows: number) => {
  const { y, h } = herdrBand(k, stored.height, rows)
  const at = itermRowOf(y, h, stored.height)
  return Array.from({ length: h }, (_, i) => rowOf(stored, at + i))
}
// What a right terminal (Ghostty, kitty) shows on row k of the picture as it is.
const rightRows = (img: Rgba, k: number, rows: number) => {
  const { y, h } = herdrBand(k, img.height, rows)
  return Array.from({ length: h }, (_, i) => rowOf(img, y + i))
}

test("herdr's band of each row: y = floor(k·H/R), h = floor(H/R), at least 1, at most to the bottom", () => {
  expect([0, 1, 2, 3].map(k => herdrBand(k, 320, 4))).toEqual([{ y: 0, h: 80 }, { y: 80, h: 80 }, { y: 160, h: 80 }, { y: 240, h: 80 }])
  expect([0, 1, 2, 3].map(k => herdrBand(k, 95, 4))).toEqual([{ y: 0, h: 23 }, { y: 23, h: 23 }, { y: 47, h: 23 }, { y: 71, h: 23 }])
  expect([0, 1, 2, 3, 4].map(k => herdrBand(k, 3, 5))).toEqual([{ y: 0, h: 1 }, { y: 0, h: 1 }, { y: 1, h: 1 }, { y: 1, h: 1 }, { y: 2, h: 1 }])
})

test('iTerm2 reads a source rect from the bottom: the 800 x 320 test of 4 bands shows ROW 4 for y=0 and ROW 1 for y=240', () => {
  expect(itermRowOf(0, 80, 320)).toBe(240)
  expect(itermRowOf(240, 80, 320)).toBe(0)
})

test('a picture stored with flipRows shows each row right in herdr in iTerm2, for any height and rows', () => {
  for (const [height, rows] of [[320, 4], [97, 7], [95, 4], [100, 1], [3, 5], [61, 60], [34 * 12 + 1, 12], [34 * 12 - 1, 12]] as const) {
    const img = imageOf(3, height)
    const stored = flipRows(img, rows)
    for (let k = 0; k < rows; k++) expect(shownRows(stored, k, rows)).toEqual(rightRows(img, k, rows))
  }
})

test('padRows makes a picture rows × B tall (B = round(H / R)): rows cut, or the last one repeated', () => {
  const tall = padRows(imageOf(2, 37), 4)
  expect(tall.height).toBe(36)
  expect(rowOf(tall, 35)).toEqual(rowOf(imageOf(2, 37), 35))
  const short = padRows(imageOf(2, 35), 4)
  expect(short.height).toBe(36)
  expect(rowOf(short, 35)).toEqual(rowOf(short, 34))
  expect(rowOf(short, 34)).toEqual(rowOf(imageOf(2, 35), 34))
  const same = imageOf(2, 36)
  expect(padRows(same, 4)).toBe(same)
  expect(padRows(imageOf(2, 1), 3).height).toBe(3)
})

test('for a page rows × B tall, flipRows reverses the bands, and reverseBands is that move and its own inverse', () => {
  const img = imageOf(4, 5 * 7)
  const flipped = flipRows(img, 5)
  const reversed = { ...img, data: img.data.slice() }
  expect(reverseBands(reversed, 5)).toBe(true)
  expect([...reversed.data]).toEqual([...flipped.data])
  for (let y = 0; y < 7; y++) expect(rowOf(flipped, y)).toEqual(rowOf(img, 4 * 7 + y))
  expect(reverseBands(reversed, 5)).toBe(true)
  expect([...reversed.data]).toEqual([...img.data])
  expect(reverseBands({ ...img, data: img.data.slice() }, 4)).toBe(false)
})

test('flipPng: a page is padded then flipped; a picture keeps its height; both decode to the moved rows', () => {
  const img = imageOf(5, 41)
  const page = flipPng(encode(img), 4, true)
  expect([page.width, page.height]).toEqual([5, 40])
  expect([...decodePng(page.png).data]).toEqual([...flipRows(padRows(img, 4), 4).data])
  const picture = flipPng(encode(img), 6, false)
  expect(picture.height).toBe(41)
  expect([...decodePng(picture.png).data]).toEqual([...flipRows(img, 6).data])
})

test('picture select on a flipped page: the frames read its rows in order, and a frame is stored flipped as the page is', () => {
  const img = padRows(imageOf(6, 3 * 10), 3)
  const box = { columns: 3, rows: 3 }
  const color = rgbOf('#264f78')
  const steps = framesSteps(flipPng(encode(img), 3, true).png, { ...box, flip: true }, color)
  let got = steps.next()
  while (!got.done) got = steps.next()
  const f = got.value
  expect(f.flip).toBe(true)
  // The pixels as on the page, so the words' places and the tint stay in page coordinates.
  expect([...f.img.data]).toEqual([...img.data])
  const sel = [{ row: 0, x0: 1, x1: 2 }, { row: 2, x0: 0, x1: 2 }]
  const plain = decodePng(frameOf(framesOf(img, box, color), sel))
  expect([...decodePng(frameOf(f, sel)).data]).toEqual([...flipRows(plain, 3).data])
  // A page not stored flipped draws its frames in order.
  expect(framesOf(img, box, color).flip).toBeUndefined()
})

const client = (kind: HerdrClient['kind']): HerdrClient => ({ pid: 1, atime: 0, tty: '/dev/ttys001', cmd: 'herdr', app: '', env: {}, kind })

test('flip mode: herdr, not over ssh, and the client typed in last is iTerm2', () => {
  expect(flipOf({ herdr: true, inline: false, client: client('iterm') })).toBe(true)
  expect(flipOf({ herdr: true, inline: false, client: client('ghostty') })).toBe(false)
  expect(flipOf({ herdr: true, inline: false, client: client('kitty') })).toBe(false)
  // herdr --remote: over ssh, and no client is found.
  expect(flipOf({ herdr: true, inline: true, client: client('iterm') })).toBe(false)
  expect(flipOf({ herdr: true, inline: false, client: null })).toBe(false)
  expect(flipOf({ herdr: false, inline: false, client: client('iterm') })).toBe(false)
  expect(flipOf({ inline: false, client: client('iterm') })).toBe(false)
})

test('/iui details names flip mode in the herdr part', () => {
  expect(herdrText('0.9.5', 'iterm', 'client', true)).toBe("herdr 0.9.5 (in iTerm2, the client you used last; pages and pictures stored upside down by rows, for iTerm2's placement bug)")
  expect(herdrText('0.9.5', 'iterm', 'client')).toBe('herdr 0.9.5 (in iTerm2, the client you used last)')
})

test('the render key has the flip mode: iTerm2 and Ghostty under herdr draw other files', () => {
  const o = {
    textHash: 'abc', columns: 80, cell: { width: 16, height: 34 }, size: 100, mode: 'dark' as const, termFont: 'Menlo', columnPt: 7,
    templateStamp: 's', look: { name: 'vscode', dir: '/t', stamp: '1' }, herdr: true,
  }
  expect(renderKey({ ...o, flip: false })).toBe(renderKey(o))
  expect(renderKey({ ...o, flip: true })).not.toBe(renderKey(o))
})

// A host whose typst makes one page (`png`): its bytes read back, the PNGs perl writes kept by path.
function host(png: Uint8Array) {
  const written = new Map<string, Uint8Array>()
  const texts = new Map<string, string>()
  const od = [...png.subarray(0, 24)].map(b => b.toString(16).padStart(2, '0')).join(' ')
  const $ = {
    fs: {
      read: async (path: string, o?: { as?: string }) => {
        if (o?.as === 'bytes' && path.endsWith('.png')) return { base64: toBase64(written.get(path) ?? png) }
        if (!texts.has(path)) throw new Error('ENOENT')
        return texts.get(path)!
      },
      write: async (path: string, text: string) => void texts.set(path, text),
      exists: async () => false,
      list: async () => [{ name: 'a-1.png', kind: 'file', size: 1, mtimeMs: 1, isLink: false }],
    },
    process: {
      run: async (argv: string[], init?: { stdin?: string }) => {
        if (argv[0] === '/usr/bin/perl' && argv[2] === WRITE_PL) written.set(argv[3]!, fromBase64(init!.stdin!))
        if (argv.join(' ').includes('od -An')) return { exitCode: 0, stdout: `${od}\n@\n`, stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      spawn: () =>
        (async function* () {
          yield { stream: 'stdout' as const, text: '4242\n' }
          return { code: 0, signal: null }
        })(),
    },
    // Only the slices' clock.after(0) runs (not the compile's timeout).
    clock: { after: (ms: number, fn: () => void) => (ms === 0 && void Promise.resolve().then(fn), { cancel() {} }) },
  } as any
  return { $, written, texts }
}

const ENV: Env = {
  typst: '/usr/bin/typst', canDraw: true, inline: false, herdr: true, cache: '/c', cwd: '/w', root: '/r', isMac: true, stamp: '1', home: '/h',
  claudeTmp: '', termFont: 'Menlo', designs: '/d', metrics: DEFAULT_METRICS,
}
const jobOf = (key: string, flip: boolean): Job => ({
  key, requestId: 'r', text: 'Some answer.', columns: 2, cell: { width: 8, height: 10 }, theme: 'dark', size: 100, grid: false, themeDir: '/r/render/themes/vscode',
  env: ENV, epoch: 0, ...(flip ? { flip } : {}),
})

test('a compile in flip mode stores each page rows × B tall with its bands reversed, in place, and notes it in pages.json', async () => {
  forgetTouches()
  const img = imageOf(16, 41)
  const h = host(encode(img))
  const result = await compile(h.$, jobOf('kf', true))
  if (typeof result !== 'object') throw new Error(`compile: ${result}`)
  const page = result.pages[0]!
  expect([page.file, page.width, page.height, page.rows, page.flip]).toEqual(['/c/kf/a-1.png', 16, 40, 4, true])
  expect([...decodePng(h.written.get('/c/kf/a-1.png')!).data]).toEqual([...flipRows(padRows(img, 4), 4).data])
  expect(JSON.parse(h.texts.get('/c/kf/pages.json')!).pages[0].flip).toBe(true)
  // Not in flip mode: the page as Typst made it.
  const plain = await compile(host(encode(img)).$, jobOf('kp', false))
  if (typeof plain !== 'object') throw new Error(`compile: ${plain}`)
  expect([plain.pages[0]!.height, plain.pages[0]!.flip]).toEqual([41, undefined])
  forgetTouches()
})

test('a compile in flip mode whose page can not be stored fails, so the text shows', async () => {
  forgetTouches()
  // A PNG head that says 16 x 41, then no image data.
  const head = encode(imageOf(16, 41)).subarray(0, 24)
  const bad = new Uint8Array(40)
  bad.set(head)
  const g = host(bad)
  expect(await compile(g.$, jobOf('kb', true))).toBe('failed')
  expect(g.texts.has('/c/kb/pages.json')).toBe(false)
  forgetTouches()
})
