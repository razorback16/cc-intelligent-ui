// A page ready for picture select's frames (blit.ts): its pixels, the
// cells' pixel edges and the deflate piece of each plain cell row (png.ts),
// made at once (framesOf) or in steps (framesSteps, for pagecache.ts).
// Pure: no hooks call here.
import type { IuiTheme } from '../../types'
import { chunk, concat, decodeSteps, deflatePiece, headOf, tailOf, type Piece, type Rgba } from './png'
import type { SelRow } from './select'

export type Rgb = readonly [number, number, number]

// VS Code's selection colour of the mode.
export const selectColor = (mode: IuiTheme) => (mode === 'light' ? '#add6ff' : '#264f78')
export const rgbOf = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb

// The pixel edges of `cells` cells over `px` pixels: cell i is pixels
// edges[i] to edges[i + 1] (exclusive). Each edge is rounded once, so the
// cells tile the picture with no gap or overlap, whatever the ratio.
export function edgesOf(px: number, cells: number): number[] {
  return Array.from({ length: cells + 1 }, (_, i) => Math.round((i * px) / cells))
}

// One channel of a page pixel of alpha `a` over the opaque colour channel `c`.
export const over = (p: number, a: number, c: number) => Math.floor((p * a + c * (255 - a) + 127) / 255)

// Pixel rows y0 to y1 (exclusive) of `img` as PNG scanlines (filter 0),
// pixels x0 to x1 (exclusive) over the colour.
export function bandOf(img: Rgba, y0: number, y1: number, x0: number, x1: number, color: Rgb): Uint8Array {
  const stride = img.width * 4
  const out = new Uint8Array((y1 - y0) * (stride + 1))
  const [r, g, b] = color
  for (let y = y0; y < y1; y++) {
    const o = (y - y0) * (stride + 1) + 1
    out.set(img.data.subarray(y * stride, (y + 1) * stride), o)
    for (let p = o + x0 * 4, end = o + x1 * 4; p < end; p += 4) {
      const a = out[p + 3]!
      if (a === 255) continue
      out[p] = over(out[p]!, a, r)
      out[p + 1] = over(out[p + 1]!, a, g)
      out[p + 2] = over(out[p + 2]!, a, b)
      out[p + 3] = 255
    }
  }
  return out
}

// A piece with its IDAT chunk (the CRC is made once).
export type Chunked = { piece: Piece; chunk: Uint8Array }
const chunked = (raw: Uint8Array, line: number): Chunked => {
  const piece = deflatePiece(raw, 4, line)
  return { piece, chunk: chunk('IDAT', piece.bytes) }
}

// A decoded page ready for frames: its pixels, the cells' pixel edges, the
// plain row pieces, and the tinted ones made so far.
export type Frames = { img: Rgba; xs: number[]; ys: number[]; color: Rgb; head: Uint8Array; plain: Chunked[]; tint: (Chunked | undefined)[] }

export function framesOf(img: Rgba, box: { columns: number; rows: number }, color: Rgb): Frames {
  const steps = framesFrom(img, box, color)
  for (;;) {
    const got = steps.next()
    if (got.done) return got.value
  }
}

// The same Frames from a PNG's bytes, in steps: the decode's (decodeSteps),
// then a yield after each plain row piece. The Frames are yielded once they
// can make frames; the steps after it make the tinted piece of each row.
export function* framesSteps(png: Uint8Array, box: { columns: number; rows: number }, color: Rgb): Generator<Frames | undefined, Frames, void> {
  const img = yield* decodeSteps(png)
  const f = yield* framesFrom(img, box, color)
  yield f
  const line = img.width * 4 + 1
  for (let r = 0; r < box.rows; r++) {
    f.tint[r] ??= chunked(bandOf(img, f.ys[r]!, f.ys[r + 1]!, 0, img.width, color), line)
    yield
  }
  return f
}

function* framesFrom(img: Rgba, box: { columns: number; rows: number }, color: Rgb): Generator<undefined, Frames, void> {
  const xs = edgesOf(img.width, box.columns)
  const ys = edgesOf(img.height, box.rows)
  const line = img.width * 4 + 1
  const plain: Chunked[] = []
  for (let r = 0; r < box.rows; r++) {
    plain.push(chunked(bandOf(img, ys[r]!, ys[r + 1]!, 0, 0, color), line))
    yield
  }
  return { img, xs, ys, color, head: headOf(img.width, img.height), plain, tint: [] }
}

// The bytes a page's Frames hold (the pixels and the pieces).
export const bytesOf = (f: Frames) => f.img.data.length + [...f.plain, ...f.tint].reduce((n, p) => n + (p ? p.chunk.length + p.piece.bytes.length : 0), 0)

// The frame PNG of a page with `rows` selected (cells x0 to x1, inclusive).
export function frameOf(f: Frames, rows: readonly SelRow[]): Uint8Array {
  const line = f.img.width * 4 + 1
  const columns = f.xs.length - 1
  const at = new Map(rows.map(r => [r.row, r]))
  const parts = f.plain.map((plain, r) => {
    const sel = at.get(r)
    if (!sel || sel.x1 < sel.x0) return plain
    const [y0, y1] = [f.ys[r]!, f.ys[r + 1]!]
    if (sel.x0 <= 0 && sel.x1 >= columns - 1) return (f.tint[r] ??= chunked(bandOf(f.img, y0, y1, 0, f.img.width, f.color), line))
    return chunked(bandOf(f.img, y0, y1, f.xs[Math.max(0, sel.x0)]!, f.xs[Math.min(columns, sel.x1 + 1)]!, f.color), line)
  })
  return concat([f.head, ...parts.map(p => p.chunk), tailOf(parts.map(p => p.piece))])
}

