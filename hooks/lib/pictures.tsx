// Pictures under rows: the files Claude sends (SendUserFile) and the images
// the user pastes are drawn under their row. An image is drawn at its own
// size or smaller (a JPEG or WebP as the PNG Typst makes of it); a Markdown
// file as an answer is. The pure parts are in images.ts.
import type { EngineInterface, ImageSource, RenderElement, RenderInput } from 'claude-code'

import { COMPILE_TIMEOUT_MS, DEFAULT_CELL, GUTTER, PICTURES_KEPT, SENT_TEXT_MAX_BYTES } from './settings'
import { converted, converting, INLINE_KEPT, inlined, lastConverted, pasteDirs, pictures, refresh, S, sentTexts, type Env } from './state'
import { columnsFor, fitsInline, INLINE_MAX_BYTES } from './terminal'
import { convertBox, convertedPath, folderOf, pasteDirOf, pictureCells, pictureRowsFor, type PixelBox, type SentFile } from './images'
import { imagePathOf } from './markdown'
import { drawPages, hashOf } from './draw'
import { convertCall, logDebug, parseOd, pngSize } from './typst'
import { pagesOf, type Drawing } from './answer'
import { HEADERS_SH } from './host'

export type Picture = { file: string; stamp: string; bytes: number; width: number; height: number }
export type Shown = { source: ImageSource; columns: number; rows: number; alt: string }
// What draws under a SendUserFile row: a picture, or a Markdown file's
// pages (`blank`: an empty space while they compile).
export type Under = Shown | { drawing: Exclude<Drawing, { kind: 'text' }>; columns: number }
export type RowInput = RenderInput<'ToolResult' | 'UserMessage', 'terminal'>

// A PNG's pixel size from its first 24 bytes, read again only when its stat
// changes; null for a file that is gone or not a PNG.
export async function pictureOf($: EngineInterface, file: string): Promise<Picture | null> {
  const st = await $.fs.stat(file).catch(() => null)
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

// The Images for the files that are PNGs, sized to the viewport.
export async function shownOf($: EngineInterface, e: RowInput, ready: Env, files: readonly string[]): Promise<Shown[]> {
  const shown: Shown[] = []
  for (const file of new Set(files)) {
    const s = await shownOne($, e, ready, file)
    if (s) shown.push(s)
  }
  return shown
}

// One PNG's Image, sized to the viewport; null when it is not a PNG. `alt`
// is the file's name (the name of the file it was made of).
export async function shownOne($: EngineInterface, e: RowInput, ready: Env, file: string, alt = nameOf(file)): Promise<Shown | null> {
  const p = await pictureOf($, file)
  if (!p) return null
  const fit = pictureCells(p, columnsFor(e.viewport?.columns, S.width), pictureRowsFor(e.viewport?.rows, S.height), S.cell ?? DEFAULT_CELL)
  if (ready.inline) {
    const png = await pictureBytes($, p)
    return png ? { source: { png }, ...fit, alt } : null
  }
  const generation = Number.parseInt(hashOf([p.stamp, fit.columns, fit.rows]).slice(0, 8), 16)
  return { source: { file, format: 'png', generation }, ...fit, alt }
}

const nameOf = (file: string) => file.split('/').pop() || 'image'

// A JPEG or WebP as a PNG that Typst makes (render/convert.typ) in the
// cache, to fit `box`: once per stat stamp and box, one run at a time per
// key. The first PNG of a file is waited for; for a new box, the last PNG
// of the file draws at once while the new one is made, then a refresh
// draws it. Null with no Typst, or when it fails (the row stays as is).
export async function convertedOf($: EngineInterface, ready: Env, file: string, box: PixelBox): Promise<string | null> {
  if (!ready.typst) return null
  const st = await $.fs.stat(file).catch(() => null)
  if (!st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  const last = lastConverted.get(file)
  const before = last?.stamp === stamp ? last.png : null
  const key = `${file}@${stamp}@${box.width}x${box.height}`
  if (converted.has(key)) return converted.get(key) ?? before
  let run = converting.get(key)
  if (!run) {
    // A new box while another box of this file is made: wait for that run
    // (its refresh draws the row again, with the box of that time).
    if (before && [...converting.keys()].some(k => k.startsWith(`${file}@${stamp}@`))) return before
    run = convertOnce($, ready, file, stamp, box, key).finally(() => converting.delete(key))
    converting.set(key, run)
    // The refresh one tick later: a run that ends while this row still draws
    // must not be lost.
    if (before) void run.then(() => void $.clock.after(0, () => refresh($)), () => undefined)
  }
  return before ?? run
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
  keep(converted, key, png)
  if (png) keep(lastConverted, file, { stamp, png })
  return png
}

// Sets a cache entry as the newest; the oldest go past PICTURES_KEPT.
function keep<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key)
  cache.set(key, value)
  for (const old of cache.keys()) {
    if (cache.size <= PICTURES_KEPT) break
    cache.delete(old)
  }
}

// A Markdown file's text, read again only when its stat changes; null when
// it is gone, over SENT_TEXT_MAX_BYTES, not read, or empty.
export async function sentTextOf($: EngineInterface, file: string): Promise<string | null> {
  const st = await $.fs.stat(file).catch(() => null)
  if (!st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  const kept = sentTexts.get(file)
  if (kept?.stamp === stamp) return kept.text
  const got = st.size <= SENT_TEXT_MAX_BYTES ? await $.fs.read(file).catch(() => null) : null
  const text = got?.trim() ? got : null
  keep(sentTexts, file, { stamp, text })
  return text
}

// What draws under a SendUserFile row, in the attachments' order: each
// image, and each Markdown file's pages (through the answers' pipeline, its
// relative images by its own folder). `markdown`: the env for the Markdown
// files (null: they stay out); `id`: the call's tool_use_id.
export async function sentOf(
  $: EngineInterface, e: RowInput, o: { ready: Env; markdown: Env | null; files: readonly SentFile[]; id: string },
): Promise<Under[]> {
  // Over ssh a Markdown file's page must stay INLINE_MAX_SIDE pixels wide at most.
  const columns = columnsFor(e.viewport?.columns, S.width, o.ready.inline ? (S.cell ?? DEFAULT_CELL) : null)
  // The space a picture takes (as in shownOne), which a JPEG or WebP is made to fit.
  const box = convertBox(columns, pictureRowsFor(e.viewport?.rows, S.height), S.cell ?? DEFAULT_CELL)
  const under: Under[] = []
  for (const f of o.files) {
    const full = imagePathOf(f.path, o.ready.cwd)
    if (f.kind === 'markdown') {
      const text = o.markdown ? await sentTextOf($, full) : null
      if (!o.markdown || !text) continue
      const drawing = await pagesOf($, { id: `file:${o.id}:${f.path}`, text, columns, env: o.markdown, canStream: false, base: folderOf(full) })
      if (drawing.kind !== 'text') under.push({ drawing, columns })
      continue
    }
    const png = f.kind === 'png' ? full : await convertedOf($, o.ready, full, box)
    const shown = png ? await shownOne($, e, o.ready, png, nameOf(full)) : null
    if (shown) under.push(shown)
  }
  return under
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
          const { drawing, columns } = s
          if (drawing.kind === 'blank') return <Box key={`blank-${i}`} />
          return (
            <Box key={`pages-${i}`} flexDirection="column">
              {drawPages($, e, drawing.result, columns, drawing.px, drawing.bytes, { gutter: 0, marginTop: 0, keys: `file${i}-` })}
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
