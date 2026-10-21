import { expect, test } from 'claude-code/testing'

import { bandOf, edgesOf, endFold, foldNew, frameOf, framesOf, over, pokeFold, rgbOf, selectColor, sigOf, startFold } from '../hooks/lib/blit'
import { framesSteps } from '../hooks/lib/frames'
import {
  adler32, adlerJoin, chunk, concat, crc32, DECODE_STEP, decodePng, decodeSteps, deflatePiece, fromBase64, headOf, inflate, Inflater, pngParts, tailOf, type Rgba,
} from '../hooks/lib/png'

// ---- PNG ---------------------------------------------------------------------------

// A 64 x 10 RGBA PNG made by zlib (dynamic Huffman blocks, two IDAT chunks),
// row y with filter y % 5 (None, Sub, Up, Average, Paeth); its pixels are pixelOf.
const FIXTURE = [
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAKCAYAAAAEqljUAAACYUlEQVR42uXVf0yUBRzH8TuPh+sePO7Bu1MOumNwwnHKxQ71iE6CSw67mKgRIh',
  'oSirIbihKRomH5o1SmdlhgJhlOcIgTNNFJKS11KlObutL5I01HGtOc5NTynPZ2ydYfzj8q/5Lt2YvPvnx4GBsfZDI+lHLBGBwgvqRXaXKel3Tv',
  'mA2G6kEDTS12u/nwi6mxv6aMtQnphQlRoyoSU97wDX9z4iZXxeT96bXeixnbZ8nGHJsdmf3b/LQJ4ofefMtyX2HaJ+3egs+7SuavDylb25Q6Z1',
  'draeWPOxsW/r7n9BLNfml53GFPtefE4tppp79bu+hnWX39FVfjnuuLm8/c6my9c09q0yly2+1iQ0dmSM++4tDUQ0sjqo82xnSd2GtLOnVhqO/c',
  'PWf3RcMraZcdnvVXs8bIbszKKbi1YtL+u81TrQ8OTvcFdJX9qZLPLQw2LTiudS5NDR3/8TZjee3AqFVfrLG0NkhxRzYvs3d/FeAIbF/gNMvVck',
  'GhlPuNSoXGqBRQiSoMQjVqMAS1qMcBaMBwNGIERqIZo9GCVhyMNoxHOw7BYZiISejEZExBF45AN45ED2bgKByNYzELszEHc3Ei5mE+FuAUnIpF',
  '6MVinIEzsRTLsBxnYwXOw0q/sc/DX4BaruHp4fErnrWsCOsjBopyvyT2kUmiAgN0kihgIFmJz5FVfp8okoPIfclqDCZr0EcOwX4yn6hFHVmP/b',
  'mvxlCyAcPI4XyfOrKRbCJH+KWqenIkOYpsxgZyNMaQLdhEtuIg8maM0/lEG7aQ43ErdzsmkLfj0E8lcRjv2UlOJO/inoRfk53Q35KvAAACYklE',
  'QVS4m5yMHfy8KX4p4O8/AZFHePT89I/Pe5+nc1f/b99feMLd9sS+zCUYNK8G6uJGq8yeccGmaXl6YVGhSVZfbNXsedshnqlwu+58MG64bok3w7',
  '5yfnpmTY2tuK4ldumGzsTG5ssJe7cJ3gu7YgrvfespMxwoKXEcrcnO+qFjzKyz3fkrLvWf0Nztrj54493lXXc2rZXfP19rEvSVzr6Zc8Zrly0p',
  'DzuwcFWk0N4am952JH7Zvm7H9x2ByfpGc9qk+tSMTa15r99unpvrvrj6rdpzbUXdV4+XvHz5ennN0aD3rh+KXeQ55a7aeGJytaB6/7NpAXVfdm',
  'rbN74QfHJLza2bbfdvSN94H9j2nrz7WqfbXnRsZ9ziU1bn+vPrHB2/6I1nr60M/eOmyqK/+1FUgjwz0NTv4X8BpaKHEUQlqjAI1ahxMYKoJetx',
  'ABowHI0YwT0SzeRotKAVB6MN47nbcQh5GCZiEjoxGVO4u3AE2Y0j0YMZOApHcx+LWeRszMFcnIh5mM+9AKeQp2IRerEYZ+BM7qVYRi7H2ViB87',
  'BS6B3B3nF49lQ4hQHBolxkBDWMIAMRYGAETYygmRGMZQR3MIKXJFG8wgheYwR7GMHbjCBDomFYfDZGUPSJ/ehr6evo6+n3N0tVq+mH0jfQD7vi',
  'E8Pp19E30jfRj6BfTz+S90fRNzNwDfSj6cfwfgv9JvpW+oN4/2b6cT2MIP0W+vH0t25hBOkn0N/O+4eukcQd63yiYwMj2MQI0k+azAgWMYLTpa',
  'rdpYwg/Q76KbLeEfQ/GorH+e/u6v/Yfxp39WO+/i/KnT1vncz3VAAAAABJRU5ErkJggg==',
].join('')
const pixelOf = (x: number, y: number) => [(x * 7 + y * 13) & 255, (x * x + y) & 255, ((x ^ y) * 5) & 255, (x * 29 + y * 3) & 255]
const toHex = (b: Uint8Array) => Array.from(b, v => v.toString(16).padStart(2, '0')).join('')
const imageOf = (width: number, height: number, at: (x: number, y: number) => number[]): Rgba => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(at(x, y), (y * width + x) * 4)
  return { width, height, data }
}

test('a PNG of every filter and dynamic Huffman blocks decodes to its pixels', () => {
  const img = decodePng(fromBase64(FIXTURE))
  expect([img.width, img.height]).toEqual([64, 10])
  expect([...img.data]).toEqual([...imageOf(64, 10, pixelOf).data])
})

test('a PNG that is not 8-bit RGBA or RGB, or not a PNG, is refused', () => {
  const png = fromBase64(FIXTURE)
  const gray = png.slice()
  gray[25] = 0
  expect(() => decodePng(gray)).toThrow('color type 0')
  expect(() => decodePng(new Uint8Array(40))).toThrow('not a PNG')
})

test('the checksums: CRC-32 and Adler-32 as zlib makes them; two Adler-32 runs join as one', () => {
  const bytes = Uint8Array.from('The quick brown fox', c => c.charCodeAt(0))
  expect(crc32(bytes)).toBe(0xb74574de)
  expect(adler32(bytes)).toBe(0x452e0714)
  const [a, b] = [bytes.subarray(0, 7), bytes.subarray(7)]
  expect(adlerJoin(adler32(a), adler32(b), b.length)).toBe(adler32(bytes))
  const big = new Uint8Array(100_000).map((_, i) => (i * 31) & 255)
  expect(adlerJoin(adler32(big.subarray(0, 40_000)), adler32(big.subarray(40_000)), 60_000)).toBe(adler32(big))
})

test('deflate pieces join into one stream: each alone, ended on a byte, inflated as they were', () => {
  const line = 4 * 50 + 1
  const raws = [0, 1, 2].map(k => new Uint8Array(line * 3).map((_, i) => (i % line === 0 ? 0 : i % 7 < 3 ? 9 : (i * k) & 255)))
  const pieces = raws.map(raw => deflatePiece(raw, 4, line))
  // Long runs come out small.
  expect(deflatePiece(new Uint8Array(line * 30), 4, line).bytes.length).toBeLessThan(line)
  const stream = concat([Uint8Array.of(0x78, 0x01), ...pieces.map(p => p.bytes), Uint8Array.of(0x03, 0x00)])
  const out = new Uint8Array(line * 9)
  expect(inflate(stream, out)).toBe(out.length)
  expect([...out]).toEqual([...concat(raws)])
})

// A PNG of `channels` (3: RGB, 4: RGBA) pixels, row y with filter y % 5,
// in zlib stored blocks of `block` bytes, in two IDAT chunks.
function storedPng(width: number, height: number, channels: number, at: (x: number, y: number) => number[], block: number): Uint8Array {
  const stride = width * channels
  const px = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px.set(at(x, y).slice(0, channels), y * stride + x * channels)
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const f = y % 5
    raw[y * (stride + 1)] = f
    for (let i = 0; i < stride; i++) {
      const o = y * stride + i
      const [a, b, c] = [i >= channels ? px[o - channels]! : 0, y ? px[o - stride]! : 0, y && i >= channels ? px[o - stride - channels]! : 0]
      const [pa, pb, pc] = [Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c)]
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!
      raw[y * (stride + 1) + 1 + i] = (px[o]! - pred) & 255
    }
  }
  const parts = [Uint8Array.of(0x78, 0x01)]
  for (let i = 0; i < raw.length; i += block) {
    const n = Math.min(block, raw.length - i)
    parts.push(Uint8Array.of(i + n >= raw.length ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255), raw.subarray(i, i + n))
  }
  const a = adler32(raw)
  parts.push(Uint8Array.of(a >>> 24, (a >>> 16) & 255, (a >>> 8) & 255, a & 255))
  const z = concat(parts)
  const ihdr = Uint8Array.of(0, 0, 0, width, 0, 0, 0, height, 8, channels === 4 ? 6 : 2, 0, 0, 0)
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
  return concat([sig, chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, 40)), chunk('IDAT', z.subarray(40)), chunk('IEND', new Uint8Array(0))])
}

// A 50 x 12 RGBA PNG of one piece (fixed Huffman blocks), as frames are.
const FIXED_PNG = (() => {
  const line = 50 * 4 + 1
  const raw = new Uint8Array(12 * line)
  for (let y = 0; y < 12; y++) for (let x = 0; x < 50; x++) raw.set(pixelOf(x >> 2, y), y * line + 1 + x * 4)
  const piece = deflatePiece(raw, 4, line)
  return concat([headOf(50, 12), chunk('IDAT', piece.bytes), tailOf([piece])])
})()

const drain = <T>(steps: Generator<undefined, T, void>): T => {
  for (;;) {
    const got = steps.next()
    if (got.done) return got.value
  }
}

test('a decode in steps gives the pixels of a decode at once, at any step (dynamic, fixed and stored blocks; RGBA and RGB)', () => {
  const pngs = [fromBase64(FIXTURE), FIXED_PNG, storedPng(40, 12, 3, pixelOf, 100), storedPng(33, 9, 4, pixelOf, 7)]
  expect([...decodePng(pngs[2]!).data]).toEqual([...imageOf(40, 12, (x, y) => [...pixelOf(x, y).slice(0, 3), 255]).data])
  expect([...decodePng(pngs[3]!).data]).toEqual([...imageOf(33, 9, pixelOf).data])
  for (const png of pngs) {
    const one = decodePng(png)
    for (const step of [1, 13, 256, 5000, DECODE_STEP]) {
      const got = drain(decodeSteps(png, step))
      expect([got.width, got.height]).toEqual([one.width, one.height])
      expect(toHex(got.data)).toBe(toHex(one.data))
    }
  }
  // The inflate goes on from where it stopped, whatever the limits.
  for (const png of pngs) {
    const { z, width, height, channels } = pngParts(png)
    const once = new Uint8Array(height * (width * channels + 1))
    expect(inflate(z, once)).toBe(once.length)
    for (const limit of [1, 3, 97]) {
      const z2 = new Inflater(z, new Uint8Array(once.length))
      let runs = 0
      while (!z2.run(z2.op + limit)) runs++
      expect(runs).toBeGreaterThan(0)
      expect(toHex(z2.out)).toBe(toHex(once))
    }
  }
  // A stream cut short: the steps say so, as the decode at once does.
  const cut = storedPng(40, 12, 3, pixelOf, 100)
  const short = concat([cut.subarray(0, 33), chunk('IDAT', pngParts(cut).z.subarray(0, 300)), chunk('IEND', new Uint8Array(0))])
  expect(() => decodePng(short)).toThrow()
  expect(() => drain(decodeSteps(short, 64))).toThrow()
})

test("a page's frames in steps: ready with its plain rows, then its tinted rows; the same frames as made at once", () => {
  const box = { columns: 10, rows: 4 }
  for (const png of [fromBase64(FIXTURE), FIXED_PNG]) {
    const one = framesOf(decodePng(png), box, COLOR)
    const steps = framesSteps(png, box, COLOR)
    let ready: ReturnType<typeof framesOf> | undefined
    let got: ReturnType<typeof framesOf> | undefined
    for (;;) {
      const s = steps.next()
      if (s.done) {
        got = s.value
        break
      }
      if (s.value && !ready) {
        ready = s.value
        // Ready: the plain rows made, no tinted row yet.
        expect(ready.plain.length).toBe(4)
        expect(ready.tint.filter(Boolean).length).toBe(0)
      }
    }
    expect(got).toBe(ready)
    expect(got!.plain.map(p => toHex(p.chunk))).toEqual(one.plain.map(p => toHex(p.chunk)))
    // Done: each row's tinted piece, as a whole row selected makes it.
    expect(got!.tint.filter(Boolean).length).toBe(4)
    const rows = [{ row: 0, x0: 3, x1: 9 }, { row: 1, x0: 0, x1: 9 }, { row: 2, x0: 0, x1: 9 }, { row: 3, x0: 0, x1: 4 }]
    expect(toHex(frameOf(got!, rows))).toBe(toHex(frameOf(one, rows)))
  }
})

// ---- Cells to pixels -------------------------------------------------------------

test('cell edges: whole pixels a cell are exact; any other ratio tiles the picture with no gap or overlap', () => {
  // Ghostty, 16 x 36 px cells: 212 columns, 53 rows.
  expect(edgesOf(3392, 212).slice(0, 4)).toEqual([0, 16, 32, 48])
  expect(edgesOf(1908, 53).at(-1)).toBe(1908)
  expect(edgesOf(100, 3)).toEqual([0, 33, 67, 100])
  // A page drawn smaller than its own cells (150 columns for 3392 px).
  const xs = edgesOf(3392, 150)
  expect(xs[0]).toBe(0)
  expect(xs.at(-1)).toBe(3392)
  for (let i = 0; i < 150; i++) expect(xs[i + 1]! - xs[i]!).toBeGreaterThanOrEqual(22)
})

// ---- The frame ---------------------------------------------------------------------

// 8 x 4 px, 4 columns and 2 rows of 2 x 2 px cells: alpha by column 0, 128, 255, 64.
const ALPHA = [0, 128, 255, 64]
const SMALL = imageOf(8, 4, (x, y) => [10 * x, 20 * y, 200, ALPHA[x >> 1]!])
const COLOR = rgbOf('#264f78')

test('the selection colour is VS Code\'s of the mode', () => {
  expect(selectColor('dark')).toBe('#264f78')
  expect(selectColor('light')).toBe('#add6ff')
  expect(rgbOf('#264f78')).toEqual([0x26, 0x4f, 0x78])
})

test('a pixel over the colour: straight alpha over an opaque colour, rounded', () => {
  expect(over(200, 0, 0x26)).toBe(0x26)
  expect(over(200, 255, 0x26)).toBe(200)
  expect(over(200, 128, 0)).toBe(100)
  expect(over(0, 128, 255)).toBe(127)
})

test('a frame: the selected cells over the colour (opaque), every other pixel as it was', () => {
  const f = framesOf(SMALL, { columns: 4, rows: 2 }, COLOR)
  // Row 0 columns 1 to 2, row 1 whole.
  const img = decodePng(frameOf(f, [{ row: 0, x0: 1, x1: 2 }, { row: 1, x0: 0, x1: 3 }]))
  expect([img.width, img.height]).toEqual([8, 4])
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const p = [...img.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)]
      const was = [...SMALL.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)]
      const isSelected = y >= 2 || (x >= 2 && x < 6)
      const a = was[3]!
      expect(p).toEqual(isSelected ? [over(was[0]!, a, COLOR[0]), over(was[1]!, a, COLOR[1]), over(was[2]!, a, COLOR[2]), 255] : was)
    }
  }
})

test('a frame with no rows selected is the page as it is (a clear)', () => {
  const f = framesOf(SMALL, { columns: 4, rows: 2 }, COLOR)
  expect([...decodePng(frameOf(f, [])).data]).toEqual([...SMALL.data])
  // A whole row's tinted piece is made once and kept.
  frameOf(f, [{ row: 1, x0: 0, x1: 3 }])
  const kept = f.tint[1]
  frameOf(f, [{ row: 0, x0: 2, x1: 3 }, { row: 1, x0: 0, x1: 3 }])
  expect(f.tint[1]).toBe(kept)
  expect(f.tint[0]).toBe(undefined)
})

test('a band is the rows as filter-0 scanlines, its pixels from x0 to x1 over the colour', () => {
  const band = bandOf(SMALL, 1, 3, 2, 4, COLOR)
  expect(band.length).toBe(2 * 33)
  expect(band[0]).toBe(0)
  expect([...band.subarray(1, 9)]).toEqual([...SMALL.data.subarray(32, 40)])
  expect([...band.subarray(9, 13)]).toEqual([over(20, 128, 0x26), over(20, 128, 0x4f), over(200, 128, 0x78), 255])
})

test('a frame is a PNG whose head and tail are its own: the right size, the Adler-32 of all its rows', () => {
  const f = framesOf(SMALL, { columns: 4, rows: 2 }, COLOR)
  expect([...f.head.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(headOf(8, 4)).toEqual(f.head)
  const tail = tailOf(f.plain.map(p => p.piece))
  const all = concat([bandOf(SMALL, 0, 2, 0, 0, COLOR), bandOf(SMALL, 2, 4, 0, 0, COLOR)])
  const adler = tail.subarray(10, 14)
  expect(((adler[0]! << 24) | (adler[1]! << 16) | (adler[2]! << 8) | adler[3]!) >>> 0).toBe(adler32(all))
})

test('what a page shows: nothing selected is its own PNG, else the colour and the rows', () => {
  expect(sigOf([], '#264f78')).toBe('')
  expect(sigOf([{ row: 2, x0: 3, x1: 9 }, { row: 3, x0: 0, x1: 4 }], '#264f78')).toBe('#264f78|2:3-9,3:0-4')
})

// ---- Throttle ----------------------------------------------------------------------

test('the fold: pokes while a frame is made fold into one more run; a run starts at most once a gap', () => {
  const f = foldNew()
  expect(pokeFold(f, 0, 16)).toEqual({ kind: 'run' })
  startFold(f, 0)
  // Five pokes while it runs: folded, one more run after it.
  for (let i = 0; i < 5; i++) expect(pokeFold(f, 3, 16)).toEqual({ kind: 'fold' })
  expect(endFold(f)).toBe(true)
  // The run took 5 ms: the next waits out the gap since its start.
  expect(pokeFold(f, 5, 16)).toEqual({ kind: 'wait', ms: 11 })
  // While it waits, a poke folds into it.
  expect(pokeFold(f, 8, 16)).toEqual({ kind: 'fold' })
  startFold(f, 16)
  expect(endFold(f)).toBe(false)
  // A poke after the gap runs at once.
  expect(pokeFold(f, 40, 16)).toEqual({ kind: 'run' })
})
