// herdr in iTerm2 (flip mode): herdr draws each row of a picture (Claude
// Code's kitty placeholders, one virtual placement of R rows) as a kitty
// placement of its own with a source rectangle: row k shows source rows y =
// floor(k·H/R), h = floor(H/R) (herdr's ghostty-vt,
// kitty_virtual_placement_geometry). iTerm2 measures that rectangle's y from
// the image's bottom: rows [y, y + h) show rows [H − y − h, H − y). So in
// flip mode each PNG is stored with every row's band moved to the rows
// iTerm2 reads for it (flipRows). A page is first made R × B pixels tall (B
// whole: padRows), so the move is a reversal of its bands, its own inverse
// (reverseBands), and picture select's frames are their row pieces in
// reverse order (frames.ts).
import type { EngineInterface } from 'claude-code'

import { chunk, concat, decodeSteps, deflatePiece, fromBase64, headOf, tailOf, toBase64, type Piece, type Rgba } from './png'
import { delay, cat, exec, nowMs } from './api'

// The source rows herdr places for row k of a picture `height` pixels tall drawn `rows` rows tall.
export function herdrBand(k: number, height: number, rows: number): { y: number; h: number } {
  const y = Math.floor((k * height) / rows)
  return { y, h: Math.max(1, Math.min(Math.floor(height / rows), height - y)) }
}

// The first row iTerm2 shows for a source rectangle of rows [y, y + h).
export const itermRowOf = (y: number, h: number, height: number) => height - y - h

// The picture stored so that herdr in iTerm2 shows it right when drawn
// `rows` rows tall: each row's band (herdrBand) at the rows iTerm2 reads for
// it. The bands never overlap; rows that no band covers stay as they are.
export function flipRows(img: Rgba, rows: number): Rgba {
  const stride = img.width * 4
  const data = img.data.slice()
  for (let k = 0; k < rows; k++) {
    const { y, h } = herdrBand(k, img.height, rows)
    data.set(img.data.subarray(y * stride, (y + h) * stride), itermRowOf(y, h, img.height) * stride)
  }
  return { width: img.width, height: img.height, data }
}

// The picture `rows` × B pixels tall, B = round(height / rows) (1 at least):
// the last row repeated when it is shorter; when it is taller, row k is the
// band herdr shows for it (herdrBand), so the rows it drops are spread, as
// on a right terminal, and the bottom is never cut.
export function padRows(img: Rgba, rows: number): Rgba {
  const band = Math.max(1, Math.round(img.height / rows))
  const height = rows * band
  if (height === img.height) return img
  const stride = img.width * 4
  const data = new Uint8Array(height * stride)
  if (height > img.height) {
    data.set(img.data)
    for (let y = img.height; y < height; y++) data.copyWithin(y * stride, (img.height - 1) * stride, img.height * stride)
  } else {
    for (let k = 0; k < rows; k++) {
      const y = Math.floor((k * img.height) / rows)
      data.set(img.data.subarray(y * stride, (y + band) * stride), k * band * stride)
    }
  }
  return { width: img.width, height, data }
}

// The bands of a picture R × B pixels tall in reverse order, in place:
// flipRows of it, and its inverse. False (nothing done) when the height is
// not a whole number of bands.
export function reverseBands(img: Rgba, rows: number): boolean {
  if (rows < 1 || img.height % rows) return false
  const band = (img.height / rows) * img.width * 4
  const tmp = new Uint8Array(band)
  for (let a = 0, b = rows - 1; a < b; a++, b--) {
    tmp.set(img.data.subarray(a * band, (a + 1) * band))
    img.data.copyWithin(a * band, b * band, (b + 1) * band)
    img.data.set(tmp, b * band)
  }
  return true
}

// The rows of one deflate piece: few, so a step stays short.
const PIECE_ROWS = 16

// A picture as an RGBA PNG (filter 0, png.ts's deflate pieces), a yield after each piece.
export function* encodeSteps(img: Rgba): Generator<undefined, Uint8Array, void> {
  const stride = img.width * 4
  const line = stride + 1
  const pieces: Piece[] = []
  const chunks: Uint8Array[] = []
  for (let y0 = 0; y0 < img.height; y0 += PIECE_ROWS) {
    const y1 = Math.min(img.height, y0 + PIECE_ROWS)
    const raw = new Uint8Array((y1 - y0) * line)
    for (let y = y0; y < y1; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), (y - y0) * line + 1)
    const piece = deflatePiece(raw, 4, line)
    pieces.push(piece)
    chunks.push(chunk('IDAT', piece.bytes))
    yield
  }
  return concat([headOf(img.width, img.height), ...chunks, tailOf(pieces)])
}

// A PNG stored for flip mode, in steps: decoded, made `rows` × B tall when
// `isPage` (padRows), its bands moved (flipRows), encoded; with its size.
// `tall`: the height its rows map to (copy.ts), the PNG's own when padRows
// dropped rows (they were spread over the page, as herdr does).
export function* flipSteps(png: Uint8Array, rows: number, isPage: boolean): Generator<undefined, Rgba & { png: Uint8Array; tall: number }, void> {
  const made = yield* decodeSteps(png)
  const img = isPage ? padRows(made, rows) : made
  yield
  const flipped = flipRows(img, rows)
  yield
  return { ...flipped, png: yield* encodeSteps(flipped), tall: Math.max(made.height, img.height) }
}

// The same at once (tests).
export function flipPng(png: Uint8Array, rows: number, isPage: boolean): Rgba & { png: Uint8Array; tall: number } {
  const steps = flipSteps(png, rows, isPage)
  for (;;) {
    const got = steps.next()
    if (got.done) return got.value
  }
}

// ---- Files -------------------------------------------------------------------------

// Writes stdin's base64 to the file (its folder made, a temporary name of
// this process, then renamed), and deletes the older frames named after it (blit.ts).
export const WRITE_PL = 'use MIME::Base64; local $/; my $b = <STDIN>; my ($f, @old) = @ARGV; my ($d) = $f =~ m{^(.*)/}; mkdir($d, 0700) unless -d $d; my $t = "$f.$$.tmp"; open(my $o, ">:raw", $t) or die "$!\\n"; print $o decode_base64($b); close($o) or die "$!\\n"; rename($t, $f) or die "$!\\n"; unlink(@old)'

// A slice of the steps: the hooks run between slices (clock.after(0)).
const SLICE_MS = 8

// The time a slice reads (a test can set it).
export const sliceClock = { now: () => performance.now() }

// The engine's time; NaN when it can not be read.
async function engineNow($: EngineInterface): Promise<number> {
  try {
    return await nowMs($)
  } catch {
    return NaN
  }
}

// Runs `steps` in slices; null when `signal` stopped them. No yield while
// the engine's clock stands still (a test's: it fires no clock.after(0)
// while a draw is awaited).
async function runSliced<T>($: EngineInterface, steps: Generator<undefined, T, void>, signal?: AbortSignal): Promise<T | null> {
  let at = await engineNow($)
  for (;;) {
    const t0 = sliceClock.now()
    for (;;) {
      const got = steps.next()
      if (got.done) return got.value
      if (sliceClock.now() - t0 >= SLICE_MS) break
    }
    if (signal?.aborted) return null
    const now = await engineNow($)
    if (now === at) continue
    at = now
    await new Promise<void>(done => delay($, 0, done))
    if (signal?.aborted) return null
  }
}

// Stores the PNG `src` for flip mode (flipSteps) in `out` (`perl` writes
// it, as blit.ts's frames; `out` may be `src`): its size, or null when it
// fails or `signal` stopped it.
export async function flipFile(
  $: EngineInterface, o: { src: string; out: string; rows: number; isPage: boolean; perl: string; signal?: AbortSignal },
): Promise<{ width: number; height: number } | null> {
  try {
    const { base64 } = await cat($, o.src, { as: 'bytes' })
    const made = await runSliced($, flipSteps(fromBase64(base64), o.rows, o.isPage), o.signal)
    if (!made) return null
    const ran = await exec($, [o.perl, '-e', WRITE_PL, o.out], { stdin: toBase64(made.png) })
    return ran.exitCode === 0 ? { width: made.width, height: made.tall } : null
  } catch {
    return null
  }
}
