// Picture select's highlight (select.ts): each page stays one keyed Image
// whose layout never changes, and a selection swaps its picture with
// `$.ui.blit` (one small command to the terminal, the same image id). The
// frame is the page with the selected cells over the selection colour: in
// a selected cell each page pixel (straight alpha) over the opaque colour,
// elsewhere the page as it is. A clear swaps the page's own PNG back.
//
// The page is decoded once, the first time a selection reaches it (png.ts:
// the hooks have no zlib), and kept in memory (FRAMES_KEPT_BYTES at most).
// Its rows are deflate pieces made once (plain, and tinted the first time a
// whole row is selected); a frame makes only the selection's first and last
// rows (partly selected) and joins the pieces: about 1.5 MB for a page of
// 3392 x 4284. The hooks can write only text, so perl writes the frame
// (base64 on its stdin) to a file of its own, which the terminal reads.
import type { EngineInterface } from 'claude-code'

import type { IuiTheme } from '../../types'
import { drawnAnswers, S } from './state'
import { chunk, concat, decodePng, deflatePiece, fromBase64, headOf, tailOf, toBase64, type Piece, type Rgba } from './png'
import type { DrawnPage } from './copy'
import type { SelRow } from './select'
import { perlFor } from './host'
import { traceDebug } from './log'
import { clockAfter, clockNow, fsRead, processRun, uiBlit, uiLog } from './api'

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
type Chunked = { piece: Piece; chunk: Uint8Array }
const chunked = (raw: Uint8Array, line: number): Chunked => {
  const piece = deflatePiece(raw, 4, line)
  return { piece, chunk: chunk('IDAT', piece.bytes) }
}

// A decoded page ready for frames: its pixels, the cells' pixel edges, the
// plain row pieces, and the tinted ones made so far.
export type Frames = { img: Rgba; xs: number[]; ys: number[]; color: Rgb; head: Uint8Array; plain: Chunked[]; tint: (Chunked | undefined)[] }

export function framesOf(img: Rgba, box: { columns: number; rows: number }, color: Rgb): Frames {
  const xs = edgesOf(img.width, box.columns)
  const ys = edgesOf(img.height, box.rows)
  const line = img.width * 4 + 1
  const plain = Array.from({ length: box.rows }, (_, r) => chunked(bandOf(img, ys[r]!, ys[r + 1]!, 0, 0, color), line))
  return { img, xs, ys, color, head: headOf(img.width, img.height), plain, tint: [] }
}

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

// What a page shows, as a string: '' its own PNG, else the colour and rows.
export const sigOf = (rows: readonly SelRow[], color: string) => (rows.length ? `${color}|${rows.map(r => `${r.row}:${r.x0}-${r.x1}`).join(',')}` : '')

// ---- Throttle -------------------------------------------------------------------------

// The fold of the blits: a run (a frame made and blitted) at most at once
// and at most once a gap, so the posts between fold into one run that reads
// the newest selection. `last` is the last run's start.
export type Fold = { isRunning: boolean; isDirty: boolean; last: number }
export const foldNew = (): Fold => ({ isRunning: false, isDirty: false, last: -Infinity })

// A poke: `run` now, `wait` that long then run (the fold counts as running
// meanwhile), or `fold` into the run that goes on (one more run after it).
export function pokeFold(f: Fold, now: number, gapMs: number): { kind: 'run' } | { kind: 'wait'; ms: number } | { kind: 'fold' } {
  if (f.isRunning) {
    f.isDirty = true
    return { kind: 'fold' }
  }
  f.isRunning = true
  const ms = f.last + gapMs - now
  return ms > 0 ? { kind: 'wait', ms } : { kind: 'run' }
}

// A run starts (at `now`), and ends: whether a poke came while it ran.
export function startFold(f: Fold, now: number) {
  f.isRunning = true
  f.isDirty = false
  f.last = now
}
export function endFold(f: Fold): boolean {
  f.isRunning = false
  return f.isDirty
}

// ---- The blits -------------------------------------------------------------------------

// One blit frame a screen frame at most.
export const FRAME_MS = 16
// The decoded pages kept (their pixels), by bytes: about two of the tallest.
export const FRAMES_KEPT_BYTES = 128 * 1024 * 1024
// The frame files kept: the terminal reads each after its blit, at the
// engine's next frame; older ones go once they are this old.
const FILES_KEPT = 4
const FILE_KEEP_MS = 2000

// Writes stdin's base64 to the file (its folder made, a temporary name,
// then renamed), and deletes the older frames named after it.
export const WRITE_PL = 'use MIME::Base64; local $/; my $b = <STDIN>; my ($f, @old) = @ARGV; my ($d) = $f =~ m{^(.*)/}; mkdir($d, 0700) unless -d $d; open(my $o, ">:raw", "$f.tmp") or die "$!\\n"; print $o decode_base64($b); close($o) or die "$!\\n"; rename("$f.tmp", $f) or die "$!\\n"; unlink(@old)'

// Each drawing's site (the requestId its Images are drawn under) and its
// Images' key prefix, noted by drawPages; what each page shows now (sigOf,
// by `<id>#<page>`); the decoded pages; the frame files written; the
// reasons logged; pages whose blit was refused (none until the next down).
export const blits = {
  sites: new Map<string, { requestId: string; keys: string }>(),
  shown: new Map<string, string>(),
  frames: new Map<string, Frames | null>(),
  files: [] as { path: string; at: number }[],
  logged: new Set<string>(),
  refused: new Set<string>(),
  seq: 0,
  dir: '',
}

// A drawing's site, at each draw of its pages.
export function noteSite(id: string, requestId: string, keys: string) {
  const was = blits.sites.get(id)
  if (was?.requestId === requestId && was.keys === keys) return
  blits.sites.set(id, { requestId, keys })
  for (const k of [...blits.shown.keys()]) if (k.startsWith(`${id}#`)) blits.shown.delete(k)
}

// Forgets everything (for tests).
export function forgetBlits() {
  for (const m of [blits.sites, blits.shown, blits.frames, blits.logged, blits.refused, decoding]) m.clear()
  blits.files = []
  blits.seq = 0
  blits.dir = ''
}

const ms = (t: number) => `${Math.round(t)}ms`

// Logs a reason once (the debug log, and the trace).
function logOnce($: EngineInterface, text: string) {
  traceDebug($, `select: ${text}`)
  if (blits.logged.has(text)) return
  blits.logged.add(text)
  void Promise.resolve(uiLog($, `Intelligent UI: picture select: ${text}`, { to: 'debug' })).catch(() => undefined)
}

// A page's frames: decoded once (null: it can not be, not tried again); a
// decode that runs now is shared.
const decoding = new Map<string, Promise<{ frames: Frames | null; ms: number }>>()
function framesFor($: EngineInterface, page: DrawnPage, color: string): Promise<{ frames: Frames | null; ms: number }> {
  const key = `${page.file}|${page.columns}x${page.rows}|${color}`
  const kept = blits.frames.get(key)
  if (kept !== undefined) {
    blits.frames.delete(key)
    blits.frames.set(key, kept)
    return Promise.resolve({ frames: kept, ms: 0 })
  }
  const running = decoding.get(key)
  if (running) return running
  const run = decodeFrames($, page, color, key).finally(() => decoding.delete(key))
  decoding.set(key, run)
  return run
}

async function decodeFrames($: EngineInterface, page: DrawnPage, color: string, key: string): Promise<{ frames: Frames | null; ms: number }> {
  const t = performance.now()
  let frames: Frames | null = null
  try {
    const { base64 } = await fsRead($, page.file, { as: 'bytes' })
    frames = framesOf(decodePng(fromBase64(base64)), page, rgbOf(color))
  } catch (err) {
    logOnce($, `no highlight for ${page.file}: ${err instanceof Error ? err.message : String(err)}`)
  }
  blits.frames.set(key, frames)
  let bytes = [...blits.frames.values()].reduce((n, f) => n + (f?.img.data.length ?? 0), 0)
  for (const [k, f] of blits.frames) {
    if (bytes <= FRAMES_KEPT_BYTES || k === key) continue
    bytes -= f?.img.data.length ?? 0
    blits.frames.delete(k)
  }
  const took = performance.now() - t
  if (frames) traceDebug($, `select: decoded ${page.file} ${frames.img.width}x${frames.img.height} in ${ms(took)}`)
  return { frames, ms: took }
}

// Decodes a page before its first frame (at a down), in the background.
export function warmPage($: EngineInterface, page: DrawnPage | undefined) {
  if (page && S.env) clockAfter($, 0, () => void framesFor($, page, selectColor(S.theme)).catch(() => undefined))
}

// The newest frame file's name, and the old ones that can go.
function nextFile(cache: string, now: number): { path: string; old: string[] } {
  blits.dir ||= `${cache}/select-${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const path = `${blits.dir}/f-${++blits.seq}.png`
  const keep = blits.files.slice(-FILES_KEPT)
  const old = blits.files.filter(f => !keep.includes(f) && now - f.at >= FILE_KEEP_MS)
  blits.files = blits.files.filter(f => !old.includes(f))
  blits.files.push({ path, at: now })
  return { path, old: old.map(f => f.path) }
}

// Shows one page: its own PNG back, or a frame of `rows`.
async function showPage($: EngineInterface, id: string, i: number, page: DrawnPage, rows: readonly SelRow[], sig: string): Promise<void> {
  const k = `${id}#${i}`
  const site = blits.sites.get(id)
  const env = S.env
  if (!site || !env) return
  const key = `${site.keys}p${i}`
  const rowsText = rows.length ? `rows ${rows[0]!.row}..${rows[rows.length - 1]!.row} (${rows.length})` : 'plain'
  let source: { file: string; format: 'png' } = { file: page.file, format: 'png' }
  let timing = ''
  if (rows.length) {
    const got = await framesFor($, page, selectColor(S.theme))
    if (!got.frames) {
      blits.shown.set(k, sig)
      return
    }
    const now = await clockNow($).catch(() => Date.now())
    const t1 = performance.now()
    const png = frameOf(got.frames, rows)
    const t2 = performance.now()
    const { path, old } = nextFile(env.cache, now)
    const ran = await processRun($, [perlFor(env.isMac), '-e', WRITE_PL, path, ...old], { stdin: toBase64(png) }).catch(err => ({ exitCode: 1, stderr: String(err) }))
    const t3 = performance.now()
    if (ran.exitCode !== 0) {
      logOnce($, `the frame could not be written: ${ran.stderr.trim()}`)
      return
    }
    source = { file: path, format: 'png' }
    timing = `decode ${ms(got.ms)} frame ${ms(t2 - t1)} write ${ms(t3 - t2)} ${png.length} bytes`
  }
  const t4 = performance.now()
  const res = await uiBlit($, { requestId: site.requestId, key, source }).catch(err => ({ deny: String(err) }))
  const blit = `blit ${ms(performance.now() - t4)}`
  if (res.deny) {
    blits.shown.delete(k)
    blits.refused.add(k)
    logOnce($, `the engine refused the highlight's blit (${res.deny})`)
    return
  }
  blits.shown.set(k, sig)
  traceDebug($, `select: blit ${id} page ${i} ${rowsText} ${timing ? `${timing} ` : ''}${blit}`)
}

// Brings every page to the selection now: the selected ones to their
// frames, the ones no longer selected back to their PNG. `selected` gives
// a drawing's pages and rows (or none).
export async function showSelection($: EngineInterface, selected: { id: string; pages: readonly DrawnPage[]; rows: readonly (readonly SelRow[])[] } | null) {
  const color = selectColor(S.theme)
  const want = new Map<string, { id: string; i: number; page: DrawnPage; rows: readonly SelRow[] }>()
  if (selected) selected.pages.forEach((page, i) => want.set(`${selected.id}#${i}`, { id: selected.id, i, page, rows: selected.rows[i] ?? [] }))
  // Pages shown with a highlight before, of this drawing or another.
  for (const k of blits.shown.keys()) {
    if (want.has(k) || !blits.shown.get(k)) continue
    const [id, n] = [k.slice(0, k.lastIndexOf('#')), Number(k.slice(k.lastIndexOf('#') + 1))]
    const page = drawnAnswers.get(id)?.pages[n]
    if (page) want.set(k, { id, i: n, page, rows: [] })
    else blits.shown.delete(k)
  }
  for (const [k, w] of want) {
    const sig = sigOf(w.rows, color)
    if ((blits.shown.get(k) ?? '') === sig || blits.refused.has(k)) continue
    await showPage($, w.id, w.i, w.page, w.rows, sig)
  }
}

