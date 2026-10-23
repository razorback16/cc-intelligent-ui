// The images pasted in the prompt box: a small preview of each `[Image #N]`,
// side by side. The draft's are in the band above the prompt (AbovePrompt)
// before it is sent, each after its dim `#N`; a sent prompt's under its row
// (UserMessage), the same size, after the gutter (Claude Code shows the
// numbers there). The picture is a copy that Typst makes to fill
// its cells exactly (render/fill.typ: no empty cell area under it, unless
// that cuts more than half a cell: fillFitOf); the plain image shows until it is made. The draft's numbers are in the `draft` atom
// (register.tsx, which writes it at each edit that changes them); the
// pictures are the files Claude Code wrote at the paste (pasteDir).
import type { EngineInterface, ImageSource, RenderElement, RenderInput, RenderViewport } from 'claude-code'

import { COMPILE_TIMEOUT_MS, GUTTER, PICTURES_KEPT, PREVIEW_GAP, PREVIEW_RETRY_MS, PREVIEW_ROWS, PREVIEW_TRIES } from './settings'
import { keep, type Cell, type Env } from './state'
import { folderOf, pastedImagePath, pictureCells, type PixelBox } from './images'
import { pasteDir, pictureOf, sourceOf, type Picture } from './pictures'
import { shownFor } from './frame'
import { hashOf } from './draw'
import { FILL_SH, fillCall, logDebug } from './typst'
import { isFlipHere } from './terminal'
import { delay, stat, write, exec, uiResolve } from './api'

export type BandInput = RenderInput<'AbovePrompt', 'terminal'>
export type RowInput = RenderInput<'UserMessage', 'terminal'>
// One preview: the image's number, its source (the filled copy once made)
// and its picture's cells.
export type Preview = { n: number; source: ImageSource; columns: number; rows: number }
type Slot = { columns: number; rows: number }
type Size = { width: number; height: number }

// Whether two lists of numbers are the same, in the same order.
export const sameNumbers = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i])

// The alt text of a preview: the draft's own mark.
export const altOf = (n: number) => `[Image #${n}]`

// A band preview's number, and its column: the number and a space.
export const labelOf = (n: number) => `#${n}`
export const labelColumns = (n: number) => labelOf(n).length + 1

// The pixels of `cells` cells: the box a filled copy fills exactly.
export const cellPixels = (cells: Slot, cell: Cell): PixelBox => ({
  width: Math.max(1, Math.round(cells.columns * cell.width)),
  height: Math.max(1, Math.round(cells.rows * cell.height)),
})

// How a filled copy fits its box: `cover` (the aspect kept, the rest cut)
// only when it cuts at most half a cell, else `contain` (all of the image,
// an empty strip beside it): a wide one-line screenshot is not cut in half.
export function fillFitOf(size: Size, box: PixelBox, cell: Cell): 'cover' | 'contain' {
  const scale = Math.max(box.width / size.width, box.height / size.height)
  const cut = (n: number, side: number, c: number) => n * scale - side <= c / 2 + 1
  return cut(size.width, box.width, cell.width) && cut(size.height, box.height, cell.height) ? 'cover' : 'contain'
}

// Where the filled copy of a picture is kept: a key folder of the cache (as
// a convert's, dropped after 2 days), by the file, its stat stamp, the box
// in pixels and the fit (one copy, whatever its number).
export const filledPath = (cache: string, p: Picture, box: PixelBox, fit: 'cover' | 'contain' = 'cover') =>
  `${cache}/${hashOf(['fill', p.file, p.stamp, box.width, box.height, ...(fit === 'cover' ? [] : [fit])])}/image.png`

// The previews' layout in `columns` cells and `maxRows` rows (Infinity under
// a row: no cap): each picture at most PREVIEW_ROWS tall (less when the band
// is short), after its label's `labels[i]` columns (none when not given),
// side by side, PREVIEW_GAP apart, a new line only where one does not fit.
// With more lines than fit in all but one row of the band, the rows go down
// (to 1: then the band scrolls). Null when not one row, or no column, is
// left for a picture.
export function previewLayout(
  sizes: readonly Size[], cell: Cell, columns: number, maxRows: number, labels: readonly number[] = [],
): { boxes: Slot[]; lines: number[][] } | null {
  const most = Math.min(PREVIEW_ROWS, maxRows - 1)
  const label = (i: number) => labels[i] ?? 0
  if (most < 1 || !sizes.length || sizes.some((_, i) => columns - label(i) < 1)) return null
  let laid: { boxes: Slot[]; lines: number[][] } | null = null
  for (let rows = most; rows >= 1; rows--) {
    const boxes = sizes.map((size, i) => pictureCells(size, columns - label(i), rows, cell))
    laid = { boxes, lines: linesOf(boxes.map((b, i) => label(i) + b.columns), columns) }
    const tallest = (line: number[]) => Math.max(...line.map(i => boxes[i]!.rows))
    if (laid.lines.reduce((sum, line) => sum + tallest(line), 0) <= maxRows - 1) break
  }
  return laid
}

// The boxes of `widths` in lines of at most `columns` cells, PREVIEW_GAP
// apart, in order; a box wider than a line has one of its own.
export function linesOf(widths: readonly number[], columns: number): number[][] {
  const lines: number[][] = []
  let used = 0
  widths.forEach((w, i) => {
    const line = lines.at(-1)
    if (line && used + PREVIEW_GAP + w <= columns) {
      line.push(i)
      used += PREVIEW_GAP + w
    } else {
      lines.push([i])
      used = w
    }
  })
  return lines
}

// The previews of the images `numbers`, in lines (previewLayout) of
// `columns` cells and `maxRows` rows, after their numbers when `labelled`,
// else after the gutter: each one's filled copy
// once made, else the plain image (in flip mode none while the copy is
// made: only a PNG stored for its rows draws; with no copy, the image as it
// is stored so). A file that is gone or not a PNG is left out;
// `isWhole` is false then (it may not be written yet: previewRetry).
// `isFinal` is false while a copy is made (`redraw` once it is).
export async function previewsOf(
  $: EngineInterface, view: RenderViewport | undefined, ready: Env, numbers: readonly number[], o: { columns: number; maxRows: number; labelled: boolean; redraw: () => void },
): Promise<{ lines: Preview[][]; isWhole: boolean; isFinal: boolean }> {
  const dir = await pasteDir($, ready)
  if (!dir) return { lines: [], isWhole: false, isFinal: true }
  const flip = isFlipHere(ready)
  const found: { n: number; plain: ImageSource | null; p: Picture }[] = []
  for (const n of numbers) {
    const p = await pictureOf($, pastedImagePath(dir, n))
    const plain = p && !flip ? await sourceOf($, ready, p) : null
    if (p && (flip || plain)) found.push({ n, plain, p })
  }
  const isWhole = found.length === numbers.length
  const cell = shownFor(view).cell
  const laid = o.labelled
    ? previewLayout(found.map(f => f.p), cell, o.columns, o.maxRows, found.map(f => labelColumns(f.n)))
    : previewLayout(found.map(f => f.p), cell, o.columns - GUTTER, o.maxRows)
  if (!laid) return { lines: [], isWhole, isFinal: true }
  let isFinal = true
  const previews = new Map<number, Preview>()
  for (const [i, { n, plain, p }] of found.entries()) {
    const box = laid.boxes[i]!
    const made = filledOf($, ready, p, cellPixels(box, cell), cell, o.redraw)
    if (made === undefined) isFinal = false
    const q = made ? await pictureOf($, made) : null
    // Flip mode with no copy (no Typst, or it failed): the image stored for its rows.
    const bare = flip && made === null ? await sourceOf($, ready, p, box.rows) : plain
    const source = (q ? await sourceOf($, ready, q, box.rows) : null) ?? bare
    if (source) previews.set(i, { n, source, ...box })
  }
  const lines = laid.lines.map(line => line.flatMap(i => previews.get(i) ?? [])).filter(line => line.length)
  return { lines, isWhole, isFinal }
}

// The filled copies made in this load by key (null: it failed), and the
// ones being made, each with the redraws of the drawings that wait for it.
const filled = new Map<string, string | null>()
const filling = new Map<string, Set<() => void>>()

// A picture's filled copy for `box` pixels: its path; undefined while it is
// made (`redraw` once it is, with every other caller's: the plain image
// shows meanwhile); null when it failed (not tried again) or with no Typst.
function filledOf($: EngineInterface, ready: Env, p: Picture, box: PixelBox, cell: Cell, redraw: () => void): string | null | undefined {
  if (!ready.typst) return null
  const fit = fillFitOf(p, box, cell)
  const key = `${p.file}@${p.stamp}@${box.width}x${box.height}@${fit}`
  if (filled.has(key)) return filled.get(key) ?? null
  const waits = filling.get(key)
  if (waits) {
    waits.add(redraw)
    return undefined
  }
  const redraws = new Set([redraw])
  filling.set(key, redraws)
  void makeFilled($, ready, p, box, fit).catch(() => null).then(png => {
    filling.delete(key)
    keep(filled, key, png, PICTURES_KEPT)
    if (png) for (const again of redraws) again()
  })
  return undefined
}

// Makes the filled copy with Typst (a part file moved to image.png once
// whole, as a convert), in a root of its own (FILL_SH: fill.typ and a link
// to the pasted file, removed after). One made in an earlier load is used
// as is. Null when the root can not be made or Typst fails.
async function makeFilled($: EngineInterface, ready: Env, p: Picture, box: PixelBox, fit: 'cover' | 'contain'): Promise<string | null> {
  const out = filledPath(ready.cache, p, box, fit)
  const made = await stat($, out).catch(() => null)
  if (made?.kind === 'file' && made.size) return out
  const dir = folderOf(out)
  // The write makes the key folder; Typst does not.
  await write($, `${dir}/source.txt`, `${p.file}\n`).catch(() => undefined)
  const run = `${dir}/r-${Math.random().toString(36).slice(2, 10)}`
  // The part file is in the run folder: another load's fill of the key has its own.
  const part = `${run}/image.part.png`
  const staged = await exec($, ['sh', '-c', FILL_SH, 'sh', run, ready.root, p.file], { timeoutMs: 10000 }).catch(() => null)
  if (staged?.exitCode !== 0) {
    await logDebug($, ready.cache, `fill ${p.file}: the root ${run} could not be made: ${staged?.stderr ?? 'sh did not run'}`)
    return null
  }
  try {
    const { argv, env } = fillCall({ typst: ready.typst!, run, cache: ready.cache, box, fit, out: part })
    const ran = await exec($, argv, { timeoutMs: COMPILE_TIMEOUT_MS, env })
    if (ran.exitCode !== 0) {
      await logDebug($, ready.cache, `fill ${p.file} failed:\n${ran.stderr}`)
      return null
    }
    const moved = await exec($, ['mv', '-f', part, out])
    return moved.exitCode === 0 ? out : null
  } finally {
    void Promise.resolve(exec($, ['rm', '-rf', run], { timeoutMs: 10000 })).catch(() => undefined)
  }
}

// A draft with an image not found: `redraw` (the band alone) a little later
// (the file may come after the edit), PREVIEW_TRIES times at most per draft.
let retried = { key: '', tries: 0 }
export function previewRetry($: EngineInterface, key: string, redraw: () => void) {
  if (retried.key !== key) retried = { key, tries: 0 }
  if (retried.tries >= PREVIEW_TRIES) return
  retried.tries++
  void delay($, PREVIEW_RETRY_MS, redraw)
}

// The previews in their lines: each after its dim number when `labelled`
// (the first one's in the gutter), else after the gutter (as underRow).
function previewLines($: EngineInterface, e: BandInput | RowInput, lines: readonly Preview[][], labelled: boolean) {
  const { Box, Text, Image } = uiResolve($, e)
  const image = (p: Preview) => <Image key={`preview-${p.n}`} source={p.source} columns={p.columns} rows={p.rows} alt={altOf(p.n)} />
  return (
    <Box flexDirection="column" marginLeft={labelled ? 0 : GUTTER}>
      {lines.map((line, i) => (
        <Box key={`previews-${i}`} flexDirection="row" columnGap={PREVIEW_GAP}>
          {line.map(p => labelled ? (
            <Box key={`preview-${p.n}`} flexDirection="row">
              <Box width={labelColumns(p.n)}>
                <Text dimColor>{labelOf(p.n)}</Text>
              </Box>
              {image(p)}
            </Box>
          ) : image(p))}
        </Box>
      ))}
    </Box>
  )
}

// The previews, then the band beneath (another plugin's or the engine's).
export function drawPreviews($: EngineInterface, e: BandInput, lines: readonly Preview[][], below: RenderElement) {
  const { Box } = uiResolve($, e)
  return (
    <Box flexDirection="column">
      {previewLines($, e, lines, true)}
      {below}
    </Box>
  )
}

// The engine's prompt row, then the previews under it.
export function previewsUnder($: EngineInterface, e: RowInput, row: RenderElement, lines: readonly Preview[][]) {
  const { Box } = uiResolve($, e)
  return (
    <Box flexDirection="column">
      {row}
      {previewLines($, e, lines, false)}
    </Box>
  )
}
