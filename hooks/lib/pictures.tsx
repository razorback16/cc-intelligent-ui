// Pictures under rows: the files Claude sends (SendUserFile) and the images
// the user pastes are drawn under their row. An image is drawn at its own
// size or smaller (a JPEG or WebP as the PNG Typst makes of it); a Markdown
// file as an answer is. The pure parts are in images.ts.
import type { EngineInterface, FsStat, ImageSource, RenderElement, RenderInput } from 'claude-code'

import { COMPILE_TIMEOUT_MS, GUTTER, PICTURES_KEPT, SENT_TEXT_MAX_BYTES, type Height } from './settings'
import { converted, converting, epochOpen, INLINE_KEPT, inlined, keep, lastConverted, pasteDirs, pictures, S, sentTexts, type Env } from './state'
import { jobDone } from './epoch'
import { fitBox, fitsInline, INLINE_MAX_BYTES, roomColumns } from './terminal'
import { convertBox, convertedPath, folderOf, onScreenOf, pasteDirOf, pictureCells, pictureRowsFor, type PixelBox, type SentFile } from './images'
import { imagePathOf } from './markdown'
import { drawPages, hashOf } from './draw'
import { convertCall, logDebug, parseOd, pngSize } from './typst'
import { pagesOf, type Drawing } from './answer'
import { HEADERS_SH } from './host'
import { frameFor, pictureColumns, shownFor, type Frame } from './frame'

export type Picture = { file: string; stamp: string; bytes: number; width: number; height: number }
export type Shown = { source: ImageSource; columns: number; rows: number; alt: string }
// What draws under a SendUserFile row: a picture, or a Markdown file's
// pages (`blank`: an empty space while they compile; an older, wider page
// draws smaller to fit) with its pagesOf id (a copy reads them by it).
export type Under = Shown | { drawing: Exclude<Drawing, { kind: 'text' }>; id: string }
export type RowInput = RenderInput<'ToolResult' | 'UserMessage', 'terminal'>

// Where a stat is read: the `done` value the row read and the row's
// requestId. A row that draws again with no new `done` (a scroll step, a new
// onScreen) reads each stat once; a new row (the same file sent again)
// reads it anew. With none given, the file is stat'ed each time.
export type StatAt = { done: number; row: string }
const STATS_KEPT = 4096
let statsDone: number | undefined
const stats = new Map<string, Promise<FsStat | null>>()
function statOf($: EngineInterface, file: string, at?: StatAt): Promise<FsStat | null> {
  if (!at) return $.fs.stat(file).catch(() => null)
  if (statsDone !== at.done || stats.size >= STATS_KEPT) {
    stats.clear()
    statsDone = at.done
  }
  const key = `${at.row}\n${file}`
  let got = stats.get(key)
  if (!got) {
    got = $.fs.stat(file).catch(() => null)
    stats.set(key, got)
  }
  return got
}

// A PNG's pixel size from its first 24 bytes, read again only when its stat
// changes; null for a file that is gone or not a PNG.
export async function pictureOf($: EngineInterface, file: string, at?: StatAt): Promise<Picture | null> {
  const st = await statOf($, file, at)
  if (!st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  let kept = pictures.get(file)
  if (kept?.stamp !== stamp) {
    const head = await $.process.run(['sh', '-c', HEADERS_SH, 'sh', file]).catch(() => null)
    if (!head || head.exitCode !== 0) return null
    kept = { stamp, size: pngSize(parseOd(head.stdout)[0] ?? []) }
    pictures.delete(file)
    pictures.set(file, kept)
    for (const old of pictures.keys()) {
      if (pictures.size <= PICTURES_KEPT) break
      pictures.delete(old)
    }
  }
  return kept.size ? { file, stamp, bytes: st.size, ...kept.size } : null
}

// Over ssh: the PNG as base64, read once per stat; null when it is too large
// for a `{ png }` source.
export async function pictureBytes($: EngineInterface, p: Picture): Promise<string | null> {
  if (!fitsInline(p) || p.bytes > INLINE_MAX_BYTES) return null
  const key = `${p.file}@${p.stamp}`
  if (inlined.has(key)) return inlined.get(key) ?? null
  const got = await $.fs.read(p.file, { as: 'bytes' }).catch(() => null)
  if (!got) return null
  const base64 = fitsInline(p, got.base64) ? got.base64 : null
  inlined.set(key, base64)
  for (const old of inlined.keys()) {
    if (inlined.size <= INLINE_KEPT) break
    inlined.delete(old)
  }
  return base64
}

// The Images for the files that are PNGs, sized to the Frame on screen.
// `at`: as statOf.
export async function shownOf($: EngineInterface, e: RowInput, ready: Env, files: readonly string[], at?: StatAt): Promise<Shown[]> {
  const shown: Shown[] = []
  for (const file of new Set(files)) {
    const s = await shownOne($, e, ready, file, nameOf(file), at)
    if (s) shown.push(s)
  }
  return shown
}

// One PNG's Image, sized to the Frame and the height setting on screen
// (shownFor, S.shownHeight: a new size shows when its epoch commits, with
// every other picture), and at most as wide as the room now; null when it is not a PNG. `alt` is the file's name
// (the name of the file it was made of). Its generation follows the file's
// stat alone: a new box is not a new file.
export async function shownOne($: EngineInterface, e: RowInput, ready: Env, file: string, alt = nameOf(file), at?: StatAt): Promise<Shown | null> {
  const p = await pictureOf($, file, at)
  if (!p) return null
  const frame = shownFor(e.viewport)
  const fit = fitBox(pictureCells(p, pictureColumns(frame, false), pictureRowsFor(frame.rows, S.shownHeight), frame.cell), roomColumns(e.viewport))
  if (ready.inline) {
    const png = await pictureBytes($, p)
    return png ? { source: { png }, ...fit, alt } : null
  }
  const generation = Number.parseInt(hashOf([p.stamp]).slice(0, 8), 16)
  return { source: { file, format: 'png', generation }, ...fit, alt }
}

const nameOf = (file: string) => file.split('/').pop() || 'image'

// A JPEG or WebP as a PNG that Typst makes (render/convert.typ) in the
// cache, to fit `box`: once per stat stamp and box, one run at a time per
// key. The first PNG of a file is waited for; for a new box, the last PNG
// of the file draws at once while the new one is made, then jobDone draws
// it (in an open epoch: at its commit, which waits for every convert).
// `at`: as statOf. Null with no Typst, or when it fails (the row stays as is).
export async function convertedOf($: EngineInterface, ready: Env, file: string, box: PixelBox, at?: StatAt): Promise<string | null> {
  if (!ready.typst) return null
  const st = await statOf($, file, at)
  if (!st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  const before = lastPngOf(file, stamp)
  const key = `${file}@${stamp}@${box.width}x${box.height}`
  if (converted.has(key)) return converted.get(key) ?? before
  let run = converting.get(key)
  if (!run) {
    // A new box while another box of this file is made: wait for that run
    // (its refresh draws the row again, with the box of that time).
    if (before && [...converting.keys()].some(k => k.startsWith(`${file}@${stamp}@`))) return before
    run = convertOnce($, ready, file, stamp, box, key).finally(() => converting.delete(key))
    converting.set(key, run)
    // jobDone one tick later: a run that ends while this row still draws
    // must not be lost. A run that is waited for (the first PNG, no epoch
    // open) draws in this render.
    if (before || epochOpen()) void run.then(() => void $.clock.after(0, () => jobDone($)), () => undefined)
  }
  return before ?? run
}

// The last PNG made of `file` at its stat stamp in this load (any box); null
// when there is none.
function lastPngOf(file: string, stamp: string): string | null {
  const last = lastConverted.get(file)
  return last?.stamp === stamp ? last.png : null
}

// Whether a PNG of `file` as it is now was made in this load (any box).
// `at`: as statOf.
async function hasPngOf($: EngineInterface, file: string, at?: StatAt): Promise<boolean> {
  const st = await statOf($, file, at)
  return !!st && st.kind === 'file' && !!lastPngOf(file, `${st.mtimeMs}:${st.size}`)
}

async function convertOnce($: EngineInterface, ready: Env, file: string, stamp: string, box: PixelBox, key: string): Promise<string | null> {
  const out = convertedPath(ready.cache, file, stamp, box)
  // Made before (an earlier load): the same file, stamp and box.
  const made = await $.fs.stat(out).catch(() => null)
  let png: string | null = out
  if (made?.kind !== 'file' || !made.size) {
    const dir = out.replace(/\/[^/]*$/, '')
    // The write makes the key folder; Typst does not (a failed write fails
    // the run below).
    await $.fs.write(`${dir}/source.txt`, `${file}\n`).catch(() => undefined)
    // Typst writes a part file, moved to image.png only once it is whole, so
    // a run that is killed or fails leaves no image.png for a later load.
    const part = `${dir}/image.part.png`
    const { argv, env } = convertCall({ typst: ready.typst!, root: ready.root, cache: ready.cache, file, box, out: part })
    const failed = (err: unknown) => ({ exitCode: 1, stdout: '', stderr: `did not run: ${String(err)}` })
    const ran = await $.process.run(argv, { timeoutMs: COMPILE_TIMEOUT_MS, env }).catch(failed)
    const moved = ran.exitCode === 0 ? await $.process.run(['mv', '-f', part, out]).catch(failed) : null
    if (ran.exitCode !== 0) {
      await logDebug($, ready.cache, `convert ${file} failed:\n${ran.stderr}`)
      png = null
    } else if (moved?.exitCode !== 0) {
      await logDebug($, ready.cache, `convert ${file}: could not move ${part}:\n${moved?.stderr ?? ''}`)
      png = null
    }
  }
  keep(converted, key, png, PICTURES_KEPT)
  if (png) keep(lastConverted, file, { stamp, png }, PICTURES_KEPT)
  return png
}

// A Markdown file's text, read again only when its stat changes; null when
// it is gone, over SENT_TEXT_MAX_BYTES, not read, or empty.
export async function sentTextOf($: EngineInterface, file: string, at?: StatAt): Promise<string | null> {
  const st = await statOf($, file, at)
  if (!st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  const kept = sentTexts.get(file)
  if (kept?.stamp === stamp) return kept.text
  const got = st.size <= SENT_TEXT_MAX_BYTES ? await $.fs.read(file).catch(() => null) : null
  const text = got?.trim() ? got : null
  keep(sentTexts, file, { stamp, text }, PICTURES_KEPT)
  return text
}

// What draws under a SendUserFile row, in the attachments' order: each
// image, and each Markdown file's pages (through the answers' pipeline, its
// relative images by its own folder). `markdown`: the env for the Markdown
// files (null: they stay out); `id`: the call's tool_use_id; `at`: as
// statOf. Images size from the Frame on screen; while an epoch is open, the
// PNG of a JPEG or WebP for the target is made at once (not waited for), so
// it is there when the epoch commits. With no PNG of that file yet (a
// resumed session) only the target's is made, and nothing draws for it
// until the commit.
export async function sentOf(
  $: EngineInterface, e: RowInput, o: { ready: Env; markdown: Env | null; files: readonly SentFile[]; id: string; at?: StatAt },
): Promise<Under[]> {
  const shown = shownFor(e.viewport)
  const target = epochOpen() ? frameFor(e.viewport) : null
  const box = boxOf(shown, o.ready.inline, S.shownHeight)
  const next = target ? boxOf(target, o.ready.inline, S.height) : null
  const under: Under[] = []
  for (const f of o.files) {
    const full = imagePathOf(f.path, o.ready.cwd)
    if (f.kind === 'markdown') {
      const text = o.markdown ? await sentTextOf($, full, o.at) : null
      if (!o.markdown || !text) continue
      const id = `file:${o.id}:${f.path}`
      const drawing = await pagesOf($, {
        id, text, frame: frameFor(e.viewport), env: o.markdown, canStream: false, base: folderOf(full),
        onScreen: onScreenOf(e.props.onScreen),
      })
      if (drawing.kind !== 'text') under.push({ drawing, id })
      continue
    }
    if (f.kind !== 'png' && next && (next.width !== box.width || next.height !== box.height)) {
      void convertedOf($, o.ready, full, next, o.at).catch(() => null)
      if (!(await hasPngOf($, full, o.at))) continue
    }
    const png = f.kind === 'png' ? full : await convertedOf($, o.ready, full, box, o.at)
    const picture = png ? await shownOne($, e, o.ready, png, nameOf(full), o.at) : null
    if (picture) under.push(picture)
  }
  return under
}

// The space a picture takes in `frame` with the height setting `height`
// (as in shownOne), which a JPEG or WebP is made to fit. Over ssh it stays
// INLINE_MAX_SIDE pixels wide at most.
const boxOf = (frame: Frame, inline: boolean, height: Height): PixelBox =>
  convertBox(pictureColumns(frame, inline), pictureRowsFor(frame.rows, height), frame.cell)

// The rows underRow draws after `under[i]`: a picture its rows, a Markdown
// file its pages at their drawn box (fitBox in `room`, as drawPages) and a
// Typst error line, a blank none.
export function rowsAfter(under: readonly Under[], i: number, room: number): number {
  return under.slice(i + 1).reduce((sum, u) => {
    if ('source' in u) return sum + u.rows
    if (u.drawing.kind !== 'pages') return sum
    const { pages, note } = u.drawing.result
    return sum + pages.reduce((n, p) => n + fitBox(p, room).rows, 0) + (note ? 1 : 0)
  }, 0)
}

// The engine's row, then the pictures under it.
export function underRow($: EngineInterface, e: RowInput, row: RenderElement, under: readonly Under[]) {
  const { Box, Image } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {row}
      <Box flexDirection="column" marginLeft={GUTTER}>
        {under.map((s, i) => {
          if ('source' in s) return <Image key={`picture-${i}`} source={s.source} columns={s.columns} rows={s.rows} alt={s.alt} />
          const { drawing } = s
          if (drawing.kind === 'blank') return <Box key={`blank-${i}`} />
          return (
            <Box key={`pages-${i}`} flexDirection="column">
              {drawPages($, e, drawing.result, drawing.bytes, { gutter: 0, marginTop: 0, keys: `file${i}-` })}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// The folder of the images pasted in this session: by the session's cwd or
// root, else the one folder under claudeTmp that holds the session (a long
// cwd's folder name is cut). Kept once found; '' while there is none.
export async function pasteDir($: EngineInterface, ready: Env): Promise<string> {
  if (!ready.claudeTmp) return ''
  const id = await $.session.id()
  const kept = pasteDirs.get(id)
  if (kept) return kept
  const found = async (dirs: Iterable<string>) => {
    for (const dir of dirs) {
      if (!(await $.fs.exists(dir).catch(() => false))) continue
      pasteDirs.set(id, dir)
      return dir
    }
    return ''
  }
  const root = await $.session.root().catch(() => ready.cwd)
  const named = await found(new Set([ready.cwd, root].map(dir => pasteDirOf(ready.claudeTmp, dir, id))))
  if (named) return named
  const projects = (await $.fs.list(ready.claudeTmp).catch(() => [])).filter(f => f.kind === 'dir')
  return found(projects.map(f => `${ready.claudeTmp}/${f.name}/${id}/images`))
}
