// Pictures under rows: the PNGs Claude sends (SendUserFile) and the images
// the user pastes are drawn under their row, at their own size or smaller.
// The pure parts are in images.ts.
import type { EngineInterface, ImageSource, RenderElement, RenderInput } from 'claude-code'

import { DEFAULT_CELL, GUTTER, PICTURES_KEPT } from './settings'
import { INLINE_KEPT, inlined, pasteDirs, pictures, S, type Env } from './state'
import { columnsFor, fitsInline, INLINE_MAX_BYTES } from './terminal'
import { pasteDirOf, pictureCells, pictureRowsFor } from './images'
import { hashOf } from './draw'
import { parseOd, pngSize } from './typst'
import { HEADERS_SH } from './host'

export type Picture = { file: string; stamp: string; bytes: number; width: number; height: number }
export type Shown = { source: ImageSource; columns: number; rows: number; alt: string }
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
  const columns = columnsFor(e.viewport?.columns)
  const rows = pictureRowsFor(e.viewport?.rows)
  const px = S.cell ?? DEFAULT_CELL
  const shown: Shown[] = []
  for (const file of new Set(files)) {
    const p = await pictureOf($, file)
    if (!p) continue
    const fit = pictureCells(p, columns, rows, px)
    const alt = file.split('/').pop() || 'image'
    if (ready.inline) {
      const png = await pictureBytes($, p)
      if (png) shown.push({ source: { png }, ...fit, alt })
      continue
    }
    const generation = Number.parseInt(hashOf([p.stamp, fit.columns, fit.rows]).slice(0, 8), 16)
    shown.push({ source: { file, format: 'png', generation }, ...fit, alt })
  }
  return shown
}

// The engine's row, then the pictures under it.
export function underRow($: EngineInterface, e: RowInput, row: RenderElement, shown: readonly Shown[]) {
  const { Box, Image } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {row}
      <Box flexDirection="column" marginLeft={GUTTER}>
        {shown.map((s, i) => <Image key={`picture-${i}`} source={s.source} columns={s.columns} rows={s.rows} alt={s.alt} />)}
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
