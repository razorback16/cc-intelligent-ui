// PNG in plain JS for picture select's highlight (blit.ts): the hooks
// runtime has no zlib, so a page is decoded here once (inflate, unfilter),
// and each frame is a PNG of pieces: one raw deflate piece per page row
// (fixed Huffman, matches one pixel left or one pixel up), each made alone
// and ended on a byte, so any pieces join into one stream. Typst's pages
// are 8-bit RGBA (or RGB), not interlaced; anything else is refused.

// A picture's straight-alpha RGBA pixels, row after row.
export type Rgba = { width: number; height: number; data: Uint8Array }

// ---- Checksums -----------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

// CRC-32 of `bytes` (PNG chunks), going on from `crc`.
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return ~c >>> 0
}

const BASE = 65521
// Adler-32 of `bytes` (a zlib stream's check).
export function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552)
    for (; i < end; i++) b += a += bytes[i]!
    a %= BASE
    b %= BASE
  }
  return ((b << 16) | a) >>> 0
}

// The Adler-32 of two runs joined, from each one's and the second's length
// (zlib's adler32_combine).
export function adlerJoin(a1: number, a2: number, len2: number): number {
  const rem = len2 % BASE
  let s1 = a1 & 0xffff
  let s2 = (rem * s1) % BASE
  s1 += (a2 & 0xffff) + BASE - 1
  s2 += ((a1 >>> 16) & 0xffff) + ((a2 >>> 16) & 0xffff) + BASE - rem
  if (s1 >= BASE) s1 -= BASE
  if (s1 >= BASE) s1 -= BASE
  if (s2 >= BASE * 2) s2 -= BASE * 2
  if (s2 >= BASE) s2 -= BASE
  return ((s2 << 16) | s1) >>> 0
}

// ---- Inflate (RFC 1950, 1951) ------------------------------------------------------

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

// A Huffman decode table: indexed by the next `bits` input bits, each entry
// the symbol << 4 | its code length (0: no code).
type Table = { table: Int32Array; bits: number }

function tableOf(lens: ArrayLike<number>, n: number): Table {
  let bits = 0
  const count = new Uint16Array(16)
  for (let i = 0; i < n; i++) {
    count[lens[i]!]!++
    if (lens[i]! > bits) bits = lens[i]!
  }
  count[0] = 0
  const next = new Uint16Array(16)
  for (let len = 1, code = 0; len < 16; len++) next[len] = code = (code + count[len - 1]!) << 1
  const size = 1 << Math.max(1, bits)
  const table = new Int32Array(size)
  for (let sym = 0; sym < n; sym++) {
    const len = lens[sym]!
    if (!len) continue
    let code = next[len]!++
    let rev = 0
    for (let k = 0; k < len; k++, code >>= 1) rev = (rev << 1) | (code & 1)
    for (let i = rev; i < size; i += 1 << len) table[i] = (sym << 4) | len
  }
  return { table, bits: Math.max(1, bits) }
}

const FIXED_LIT = tableOf(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)), 288)
const FIXED_DIST = tableOf(new Array<number>(32).fill(5), 32)

// A zlib stream inflated into `out` (its size known), in steps: `run(limit)`
// goes on until `limit` bytes are out or the stream ends (true then). Any
// limits give the same bytes. Throws on a stream that is not one.
export class Inflater {
  op = 0
  isDone = false
  private pos = 2
  private bb = 0
  private bc = 0
  private last = 0
  // The block now (null: at a block's header).
  private lit: Table | null = null
  private dist: Table | null = null
  constructor(private readonly src: Uint8Array, readonly out: Uint8Array) {
    if (src.length < 2 || (src[0]! & 0x0f) !== 8 || ((src[0]! << 8) | src[1]!) % 31 !== 0 || src[1]! & 0x20) throw new Error('not a zlib stream')
  }

  run(limit: number): boolean {
    const { src, out } = this
    let { pos, bb, bc, op } = this
    const bitsOf = (n: number) => {
      while (bc < n) {
        bb |= (src[pos++] ?? 0) << bc
        bc += 8
      }
      const v = bb & ((1 << n) - 1)
      bb >>>= n
      bc -= n
      return v
    }
    const symOf = (t: Table) => {
      while (bc < t.bits) {
        bb |= (src[pos++] ?? 0) << bc
        bc += 8
      }
      const e = t.table[bb & ((1 << t.bits) - 1)]!
      const len = e & 15
      if (!len) throw new Error('bad Huffman code')
      bb >>>= len
      bc -= len
      return e >> 4
    }
    const save = () => {
      this.pos = pos
      this.bb = bb
      this.bc = bc
      this.op = op
    }
    while (!this.isDone) {
      if (!this.lit) {
        if (this.last) {
          this.isDone = true
          break
        }
        if (op >= limit) break
        this.last = bitsOf(1)
        const type = bitsOf(2)
        if (type === 0) {
          pos -= bc >> 3
          bb = bc = 0
          const len = src[pos]! | (src[pos + 1]! << 8)
          pos += 4
          if (pos + len > src.length || op + len > out.length) throw new Error('stored block past the end')
          out.set(src.subarray(pos, pos + len), op)
          pos += len
          op += len
          continue
        }
        if (type === 1) {
          this.lit = FIXED_LIT
          this.dist = FIXED_DIST
        } else if (type === 2) {
          const hlit = bitsOf(5) + 257
          const hdist = bitsOf(5) + 1
          const hclen = bitsOf(4) + 4
          const cl = new Uint8Array(19)
          for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]!] = bitsOf(3)
          const clt = tableOf(cl, 19)
          const lens = new Uint8Array(hlit + hdist)
          for (let i = 0; i < hlit + hdist; ) {
            const sym = symOf(clt)
            if (sym < 16) lens[i++] = sym
            else {
              const [rep, prev] = sym === 16 ? [3 + bitsOf(2), i ? lens[i - 1]! : -1] : sym === 17 ? [3 + bitsOf(3), 0] : [11 + bitsOf(7), 0]
              if (prev < 0 || i + rep > hlit + hdist) throw new Error('bad code lengths')
              lens.fill(prev, i, i + rep)
              i += rep
            }
          }
          this.lit = tableOf(lens.subarray(0, hlit), hlit)
          this.dist = tableOf(lens.subarray(hlit), hdist)
        } else throw new Error('bad block type')
      }
      // The hot loop, inlined: refill, look up, consume; it stops at `limit`.
      const lt = this.lit.table
      const lb = this.lit.bits
      const lm = (1 << lb) - 1
      const dt = this.dist!.table
      const db = this.dist!.bits
      const dm = (1 << db) - 1
      let isEnd = false
      while (op < limit) {
        while (bc < lb) {
          bb |= (src[pos++] ?? 0) << bc
          bc += 8
        }
        let e = lt[bb & lm]!
        let n = e & 15
        if (!n) throw new Error('bad Huffman code')
        bb >>>= n
        bc -= n
        const sym = e >> 4
        if (sym < 256) {
          if (op >= out.length) throw new Error('output past the end')
          out[op++] = sym
          continue
        }
        if (sym === 256) {
          isEnd = true
          break
        }
        const li = sym - 257
        if (li >= 29) throw new Error('bad length code')
        let len = LEN_BASE[li]!
        n = LEN_EXTRA[li]!
        while (bc < 15) {
          bb |= (src[pos++] ?? 0) << bc
          bc += 8
        }
        if (n) {
          len += bb & ((1 << n) - 1)
          bb >>>= n
          bc -= n
        }
        while (bc < db) {
          bb |= (src[pos++] ?? 0) << bc
          bc += 8
        }
        e = dt[bb & dm]!
        n = e & 15
        if (!n) throw new Error('bad Huffman code')
        bb >>>= n
        bc -= n
        const di = e >> 4
        if (di >= 30) throw new Error('bad distance code')
        n = DIST_EXTRA[di]!
        while (bc < n) {
          bb |= (src[pos++] ?? 0) << bc
          bc += 8
        }
        const d = DIST_BASE[di]! + (bb & ((1 << n) - 1))
        bb >>>= n
        bc -= n
        if (d > op || op + len > out.length) throw new Error('bad match')
        if (d >= len) {
          out.copyWithin(op, op - d, op - d + len)
          op += len
        } else for (const end = op + len; op < end; op++) out[op] = out[op - d]!
      }
      if (!isEnd) break
      this.lit = this.dist = null
    }
    save()
    return this.isDone
  }
}

// Inflates the zlib stream `src` into `out` (its size known); returns the
// bytes written. Throws on a stream that is not one.
export function inflate(src: Uint8Array, out: Uint8Array): number {
  const z = new Inflater(src, out)
  z.run(Infinity)
  return z.op
}

// ---- Decode ------------------------------------------------------------------------

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0

// A PNG's size, its channels (4 RGBA, 3 RGB) and its IDAT data joined.
// Throws on one that is not 8-bit RGBA or RGB, not interlaced, or is broken.
export function pngParts(png: Uint8Array): { width: number; height: number; channels: number; z: Uint8Array } {
  if (png.length < 33 || SIGNATURE.some((v, i) => png[i] !== v)) throw new Error('not a PNG')
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  for (let i = 8; i + 8 <= png.length; ) {
    const len = u32(png, i)
    const type = String.fromCharCode(png[i + 4]!, png[i + 5]!, png[i + 6]!, png[i + 7]!)
    const data = png.subarray(i + 8, i + 8 + len)
    if (type === 'IHDR') {
      width = u32(data, 0)
      height = u32(data, 4)
      const [depth, color, , , interlace] = data.subarray(8, 13)
      channels = color === 6 ? 4 : color === 2 ? 3 : 0
      if (depth !== 8 || !channels || interlace) throw new Error(`a PNG of depth ${depth}, color type ${color}, interlace ${interlace}`)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    i += 12 + len
  }
  if (!width || !height || !idat.length) throw new Error('no IHDR or IDAT')
  return { width, height, channels, z: concat(idat) }
}

// A PNG's pixels as RGBA, at once. Throws as pngParts.
export function decodePng(png: Uint8Array): Rgba {
  const { width, height, channels, z } = pngParts(png)
  const stride = width * channels
  const filtered = new Uint8Array(height * (stride + 1))
  if (inflate(z, filtered) !== filtered.length) throw new Error('short image data')
  const rows = new Uint8Array(height * stride)
  unfilterRows(filtered, rows, width, channels, 0, height)
  if (channels === 4) return { width, height, data: rows }
  const data = new Uint8Array(width * height * 4)
  rgbaRows(rows, data, width, 0, height)
  return { width, height, data }
}

// The same pixels as decodePng, in steps: a yield after each `step` bytes
// inflated or unfiltered, so a caller can stop between them (pagecache.ts).
export function* decodeSteps(png: Uint8Array, step = DECODE_STEP): Generator<undefined, Rgba, void> {
  const { width, height, channels, z } = pngParts(png)
  const stride = width * channels
  const line = stride + 1
  const filtered = new Uint8Array(height * line)
  const rows = new Uint8Array(height * stride)
  const inflater = new Inflater(z, filtered)
  const batch = Math.max(1, Math.floor(step / line))
  let y = 0
  for (;;) {
    const isEnd = inflater.run(inflater.op + step)
    if (isEnd && inflater.op !== filtered.length) throw new Error('short image data')
    // The rows inflated whole so far.
    const ready = isEnd ? height : Math.floor(inflater.op / line)
    while (y < ready) {
      const y1 = Math.min(ready, y + batch)
      unfilterRows(filtered, rows, width, channels, y, y1)
      y = y1
      yield
    }
    if (isEnd) break
    yield
  }
  if (channels === 4) return { width, height, data: rows }
  const data = new Uint8Array(width * height * 4)
  for (let y0 = 0; y0 < height; y0 += batch) {
    rgbaRows(rows, data, width, y0, Math.min(height, y0 + batch))
    yield
  }
  return { width, height, data }
}
// The bytes of one decode step: about a millisecond or less.
export const DECODE_STEP = 256 * 1024

// RGB rows y0 to y1 (exclusive) of `rows` as opaque RGBA in `data`.
function rgbaRows(rows: Uint8Array, data: Uint8Array, width: number, y0: number, y1: number) {
  for (let p = y0 * width * 3, q = y0 * width * 4, end = y1 * width * 3; p < end; p += 3, q += 4) {
    data[q] = rows[p]!
    data[q + 1] = rows[p + 1]!
    data[q + 2] = rows[p + 2]!
    data[q + 3] = 255
  }
}

// The scanlines y0 to y1 (exclusive) of `f` with their filters undone (PNG
// filter types 0 to 4) into `out`; the rows above y0 are done already.
function unfilterRows(f: Uint8Array, out: Uint8Array, width: number, bpp: number, y0: number, y1: number) {
  const stride = width * bpp
  for (let y = y0; y < y1; y++) {
    const type = f[y * (stride + 1)]!
    const s = y * (stride + 1) + 1
    const o = y * stride
    const u = o - stride
    // The first pixel has no left neighbour (a and c are 0).
    if (type === 0) out.set(f.subarray(s, s + stride), o)
    else if (type === 1) {
      for (let x = 0; x < bpp; x++) out[o + x] = f[s + x]!
      for (let x = bpp; x < stride; x++) out[o + x] = f[s + x]! + out[o + x - bpp]!
    } else if (!y) {
      // The row above is 0: Up is None, Average halves the left, Paeth is Sub.
      for (let x = 0; x < bpp; x++) out[o + x] = f[s + x]!
      for (let x = bpp; x < stride; x++) out[o + x] = f[s + x]! + (type === 2 ? 0 : type === 3 ? out[o + x - bpp]! >> 1 : out[o + x - bpp]!)
    } else if (type === 2) for (let x = 0; x < stride; x++) out[o + x] = f[s + x]! + out[u + x]!
    else if (type === 3) {
      for (let x = 0; x < bpp; x++) out[o + x] = f[s + x]! + (out[u + x]! >> 1)
      for (let x = bpp; x < stride; x++) out[o + x] = f[s + x]! + ((out[o + x - bpp]! + out[u + x]!) >> 1)
    } else if (type === 4) {
      for (let x = 0; x < bpp; x++) out[o + x] = f[s + x]! + out[u + x]!
      for (let x = bpp; x < stride; x++) {
        const a = out[o + x - bpp]!
        const b = out[u + x]!
        const c = out[u + x - bpp]!
        let pa = b - c
        let pb = a - c
        let pc = pa + pb
        if (pa < 0) pa = -pa
        if (pb < 0) pb = -pb
        if (pc < 0) pc = -pc
        out[o + x] = f[s + x]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
    } else throw new Error(`bad filter type ${type}`)
  }
}

// ---- Deflate pieces -------------------------------------------------------------------

// The fixed Huffman codes (bit-reversed, as deflate writes them) and lengths.
const FIXED_CODE = new Uint16Array(288)
const FIXED_BITS = new Uint8Array(288)
for (let sym = 0; sym < 288; sym++) {
  const [len, code] = sym < 144 ? [8, 0x30 + sym] : sym < 256 ? [9, 0x190 + sym - 144] : sym < 280 ? [7, sym - 256] : [8, 0xc0 + sym - 280]
  let rev = 0
  for (let k = 0, c = code; k < len; k++, c >>= 1) rev = (rev << 1) | (c & 1)
  FIXED_CODE[sym] = rev
  FIXED_BITS[sym] = len
}
// For each match length 3 to 258: its code's index (into LEN_BASE).
const LEN_INDEX = new Uint8Array(259)
for (let i = 0; i < 29; i++) for (let l = LEN_BASE[i]!; l < (i < 28 ? LEN_BASE[i + 1]! : 259); l++) LEN_INDEX[l] = i
const reverse5 = (v: number) => ((v & 1) << 4) | ((v & 2) << 2) | (v & 4) | ((v & 8) >> 2) | ((v & 16) >> 4)

// A distance's code bits, written as one: the 5-bit code then its extra bits.
function distBits(d: number): { value: number; bits: number } {
  let i = 29
  while (DIST_BASE[i]! > d) i--
  return { value: reverse5(i) | ((d - DIST_BASE[i]!) << 5), bits: 5 + DIST_EXTRA[i]! }
}

// One piece of a stream: its compressed bytes (no final block, ended on a
// byte), and the Adler-32 and length of what it holds.
export type Piece = { bytes: Uint8Array; adler: number; length: number }

// `raw` (filtered scanlines) as a piece: fixed Huffman blocks whose matches
// are one pixel back (`bpp`) or one scanline up (`line`), never before the
// piece's start, then an empty stored block (a sync flush).
export function deflatePiece(raw: Uint8Array, bpp: number, line: number): Piece {
  const out = new Uint8Array(Math.ceil(raw.length * 1.15) + 64)
  let op = 0
  let bb = 0
  let bc = 0
  const put = (value: number, bits: number) => {
    bb |= value << bc
    bc += bits
    while (bc >= 8) {
      out[op++] = bb & 0xff
      bb >>>= 8
      bc -= 8
    }
  }
  const near = distBits(bpp)
  const up = line <= 32768 ? distBits(line) : null
  // A block holds at most this many symbols (any size is valid; keeps it small).
  put(0b010, 3)
  for (let i = 0; i < raw.length; ) {
    const max = Math.min(258, raw.length - i)
    let best = 0
    let dist = near
    if (i >= bpp && max >= 3) {
      let n = 0
      while (n < max && raw[i + n] === raw[i + n - bpp]) n++
      best = n
    }
    if (up && i >= line && max >= 3 && best < max) {
      let n = 0
      while (n < max && raw[i + n] === raw[i + n - line]) n++
      if (n > best) {
        best = n
        dist = up
      }
    }
    if (best >= 3) {
      const li = LEN_INDEX[best]!
      put(FIXED_CODE[257 + li]!, FIXED_BITS[257 + li]!)
      if (LEN_EXTRA[li]) put(best - LEN_BASE[li]!, LEN_EXTRA[li]!)
      put(dist.value & 0xffff, Math.min(16, dist.bits))
      if (dist.bits > 16) put(dist.value >>> 16, dist.bits - 16)
      i += best
    } else {
      put(FIXED_CODE[raw[i]!]!, FIXED_BITS[raw[i]!]!)
      i++
    }
  }
  put(FIXED_CODE[256]!, FIXED_BITS[256]!)
  // An empty stored block: its header, then up to the byte, LEN 0, NLEN ~0.
  put(0, 3)
  if (bc) put(0, 8 - bc)
  out.set([0, 0, 0xff, 0xff], op)
  op += 4
  return { bytes: out.slice(0, op), adler: adler32(raw), length: raw.length }
}

// ---- Assemble -------------------------------------------------------------------------

const ascii = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0))
const be32 = (v: number) => Uint8Array.of(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)

// One PNG chunk: length, type, data, CRC.
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = ascii(type)
  const out = new Uint8Array(12 + data.length)
  out.set(be32(data.length), 0)
  out.set(t, 4)
  out.set(data, 8)
  out.set(be32(crc32(data, crc32(t))), 8 + data.length)
  return out
}

// The head of an RGBA PNG of `width` x `height` (signature, IHDR, the zlib
// header's IDAT): what every frame starts with.
export function headOf(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  ihdr.set(be32(width), 0)
  ihdr.set(be32(height), 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return concat([Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', Uint8Array.of(0x78, 0x01))])
}

// The tail after the pieces: the final empty block and the Adler-32 of all
// the pieces, then IEND.
export function tailOf(pieces: readonly Piece[]): Uint8Array {
  const adler = pieces.reduce((a, p) => adlerJoin(a, p.adler, p.length), 1)
  const end = new Uint8Array(6)
  end.set([0x03, 0x00], 0)
  end.set(be32(adler), 2)
  return concat([chunk('IDAT', end), chunk('IEND', new Uint8Array(0))])
}

// Uint8Array's base64 methods: the runtime has them, the TypeScript lib not yet.
export const fromBase64 = (text: string) => (Uint8Array as unknown as { fromBase64(t: string): Uint8Array }).fromBase64(text)
export const toBase64 = (bytes: Uint8Array) => (bytes as unknown as { toBase64(): string }).toBase64()

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}
