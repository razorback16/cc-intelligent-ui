// Pictures under rows: the files Claude sends (SendUserFile) and the images
// the user pastes are drawn under their row. An image is drawn at its own
// size or smaller (a JPEG, WebP or SVG as the PNG Typst makes of it); a PDF
// as one page, with a control line to turn the pages; a Markdown file as an
// answer is. The pure parts are in images.ts.
import type { EngineInterface, FsStat, ImageSource, RenderElement, RenderInput } from 'claude-code'

import { COMPILE_TIMEOUT_MS, GUTTER, PICTURES_KEPT, SENT_TEXT_MAX_BYTES, type Height } from './settings'
import {
  converted, converting, epochOpen, INLINE_KEPT, inlined, keep, lastConverted, pageAsk, pasteDirs, pdfFacts, pdfPages, pictures, refresh, S, sentTexts,
  type Env,
} from './state'
import { jobDone } from './epoch'
import { fitBox, fitsInline, INLINE_MAX_BYTES, roomColumns } from './terminal'
import {
  convertBox, convertedPath, factsAfter, folderOf, isNoPageError, lastKnownPage, NO_FACTS, onScreenOf, pageControls, pageOf, parsePage, pasteDirOf, pictureCells,
  pictureRowsFor, type PdfFacts, type PixelBox, type SentFile,
} from './images'
import { imagePathOf } from './markdown'
import { drawPages, hashOf, linkRowsOf, linksFor, type ShownLink } from './draw'
import { convertCall, logDebug, parseOd, pngSize } from './typst'
import { pagesOf, type Drawing } from './answer'
import { HEADERS_SH } from './host'
import { frameFor, pictureColumns, shownFor, type Frame } from './frame'
import { clockAfter, fsExists, fsList, fsRead, fsStat, fsWrite, processRun, sessionId, sessionRoot, uiClose, invalidate, uiOpen, uiResolve } from './api'

export type Picture = { file: string; stamp: string; bytes: number; width: number; height: number }
export type Shown = { source: ImageSource; columns: number; rows: number; alt: string }
// The control line under a PDF's page: the row's key in pdfPages, the
// file and its stat stamp, the page, whether ‹ and › act, and the box of
// the picture (the page field makes a page at it).
export type PageLine = { row: string; file: string; stamp: string; page: number; back: boolean; forward: boolean; box: PixelBox }
// What draws under a SendUserFile row: a picture (a PDF's page with its
// control line, none for a PDF of one page), a dim line with Typst's error
// (a PDF that Typst can not read; a PDF page that failed, with its control
// line), or a Markdown file's pages (`blank`: an empty space while they
// compile; an older, wider page draws smaller to fit) with its pagesOf id
// (a copy reads them by it) and the link rows under its pages (none while
// blank).
export type Under =
  | (Shown & { pdf?: PageLine })
  | { note: string; pdf?: PageLine }
  | { drawing: Exclude<Drawing, { kind: 'text' }>; id: string; links?: readonly ShownLink[] }
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
  if (!at) return fsStat($, file).catch(() => null)
  if (statsDone !== at.done || stats.size >= STATS_KEPT) {
    stats.clear()
    statsDone = at.done
  }
  const key = `${at.row}\n${file}`
  let got = stats.get(key)
  if (!got) {
    got = fsStat($, file).catch(() => null)
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
    const head = await processRun($, ['sh', '-c', HEADERS_SH, 'sh', file]).catch(() => null)
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
  const got = await fsRead($, p.file, { as: 'bytes' }).catch(() => null)
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

// A JPEG, WebP or SVG, or a PDF's page, as a PNG that Typst makes
// (render/convert.typ) in the cache, to fit `box`: once per stat stamp, box
// and page, one run at a time per key. The first PNG of a file is waited
// for; for a new box or page, the last PNG shown of the file draws at once
// while the new one is made, then jobDone draws it (in an open epoch: at
// its commit, which waits for every convert). `at`: as statOf; `pdf`: as
// PdfRun. Null with no Typst, or when it fails (the row stays as is; a
// PDF's page that failed draws nothing in its place).
export async function convertedOf($: EngineInterface, ready: Env, file: string, box: PixelBox, at?: StatAt, pdf?: PdfRun): Promise<string | null> {
  if (!ready.typst) return null
  const st = await statOf($, file, at)
  if (!st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  const before = pdf?.wait ? null : lastPngOf(pdf?.row ?? file, stamp)
  const key = convertKey(file, stamp, box, pdf?.page)
  if (converted.has(key)) {
    const png = converted.get(key) ?? null
    // A page made ahead is the one shown now.
    if (png && pdf && !pdf.probe) keep(lastConverted, pdf.row, { stamp, png }, PICTURES_KEPT)
    return pdf ? png : png ?? before
  }
  let run = converting.get(key)
  if (!run) {
    // A new box or page while another of this file is made: wait for that
    // run (its refresh draws the row again, with the box of that time).
    if (before && [...converting.keys()].some(k => k.startsWith(`${file}@${stamp}@`))) return before
    run = runOf($, ready, file, stamp, box, pdf)
    // jobDone one tick later: a run that ends while this row still draws
    // must not be lost. A run that is waited for (the first PNG, no epoch
    // open) draws in this render.
    if (before || epochOpen()) void run.then(() => void clockAfter($, 0, () => jobDone($)), () => undefined)
  }
  return before ?? run
}

// A run for a PDF's page: the page, the row it shows in (pdfRow: its last
// PNG shown is the row's), `probe` for the next page made ahead (it does
// not show), `wait` for a page not known to exist (no older PNG draws in
// its place: it is waited for).
type PdfRun = { page: number; row: string; probe?: true; wait?: boolean }

// The key of a PNG in `converted` and `converting`; a PDF's has its page.
const convertKey = (file: string, stamp: string, box: PixelBox, page?: number) =>
  `${file}@${stamp}@${box.width}x${box.height}${page ? `@${page}` : ''}`

// The run that makes a key's PNG: the one that runs now, else a new one.
function runOf($: EngineInterface, ready: Env, file: string, stamp: string, box: PixelBox, pdf?: PdfRun) {
  const key = convertKey(file, stamp, box, pdf?.page)
  let run = converting.get(key)
  if (!run) {
    run = convertOnce($, ready, file, stamp, box, key, pdf).finally(() => converting.delete(key))
    converting.set(key, run)
  }
  return run
}

// The last PNG shown of `file` (a PDF's row) at its stat stamp in this load
// (any box or page); null when there is none.
function lastPngOf(file: string, stamp: string): string | null {
  const last = lastConverted.get(file)
  return last?.stamp === stamp ? last.png : null
}

// Whether a PNG of `file` as it is now was made in this load (any box; a
// PDF's: shown in its row `row`). `at`: as statOf.
async function hasPngOf($: EngineInterface, file: string, at?: StatAt, row?: string): Promise<boolean> {
  const st = await statOf($, file, at)
  return !!st && st.kind === 'file' && !!lastPngOf(row ?? file, `${st.mtimeMs}:${st.size}`)
}

async function convertOnce($: EngineInterface, ready: Env, file: string, stamp: string, box: PixelBox, key: string, pdf?: PdfRun): Promise<string | null> {
  const out = convertedPath(ready.cache, file, stamp, box, pdf?.page)
  // The Typst error of a run that failed (null: made).
  let error: string | null = null
  // Made before (an earlier load): the same file, stamp and box.
  const made = await fsStat($, out).catch(() => null)
  let png: string | null = out
  if (made?.kind !== 'file' || !made.size) {
    const dir = out.replace(/\/[^/]*$/, '')
    // The write makes the key folder; Typst does not (a failed write fails
    // the run below).
    await fsWrite($, `${dir}/source.txt`, `${file}\n`).catch(() => undefined)
    // Typst writes a part file, moved to image.png only once it is whole, so
    // a run that is killed or fails leaves no image.png for a later load.
    const part = `${dir}/image.part.png`
    const { argv, env } = convertCall({ typst: ready.typst!, root: ready.root, cache: ready.cache, file, box, out: part, page: pdf?.page })
    const failed = (err: unknown) => ({ exitCode: 1, stdout: '', stderr: `did not run: ${String(err)}` })
    const ran = await processRun($, argv, { timeoutMs: COMPILE_TIMEOUT_MS, env }).catch(failed)
    const moved = ran.exitCode === 0 ? await processRun($, ['mv', '-f', part, out]).catch(failed) : null
    if (ran.exitCode !== 0) {
      // A PDF's page that is not there is no failure: it tells the last page.
      if (!pdf || !isNoPageError(ran.stderr)) await logDebug($, ready.cache, `convert ${file} failed:\n${ran.stderr}`)
      error = ran.stderr
      png = null
    } else if (moved?.exitCode !== 0) {
      await logDebug($, ready.cache, `convert ${file}: could not move ${part}:\n${moved?.stderr ?? ''}`)
      error = `error: could not move ${part}`
      png = null
    }
  }
  keep(converted, key, png, PICTURES_KEPT)
  if (pdf) keep(pdfFacts, `${file}@${stamp}`, factsAfter(factsOf(file, stamp), pdf.page, error), PICTURES_KEPT)
  if (png && !pdf?.probe) keep(lastConverted, pdf?.row ?? file, { stamp, png }, PICTURES_KEPT)
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
  const got = st.size <= SENT_TEXT_MAX_BYTES ? await fsRead($, file).catch(() => null) : null
  const text = got?.trim() ? got : null
  keep(sentTexts, file, { stamp, text }, PICTURES_KEPT)
  return text
}

// What draws under a SendUserFile row, in the attachments' order: each
// image, each PDF's page (pdfOf), and each Markdown file's pages (through
// the answers' pipeline, its relative images by its own folder).
// `markdown`: the env for the Markdown files (null: they stay out); `id`:
// the call's tool_use_id; `at`: as statOf. Images size from the Frame on
// screen; while an epoch is open, the PNG of a JPEG, WebP, SVG or PDF page
// for the target is made at once (not waited for), so it is there when the
// epoch commits. With no PNG of that file yet (a resumed session) only the
// target's is made, and nothing draws for it until the commit.
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
      if (drawing.kind === 'pages') under.push({ drawing, id, links: await linksFor($, text, folderOf(full)) })
      else if (drawing.kind !== 'text') under.push({ drawing, id })
      continue
    }
    if (f.kind === 'pdf') {
      const u = await pdfOf($, e, o.ready, { file: full, row: pdfRow(o.id, f.path), box, next, at: o.at })
      if (u) under.push(u)
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

// ---- PDF pages ----------------------------------------------------------------

// A PDF's key in pdfPages: its row's tool_use_id and its path.
const pdfRow = (id: string, path: string) => `${id}\n${path}`

// The pages a SendUserFile row shows of its PDFs, for its memo.
export const pdfPagesOf = (id: string, files: readonly SentFile[]) =>
  files.filter(f => f.kind === 'pdf').map(f => pdfPages.get(pdfRow(id, f.path)) ?? 1).join(',')

// What is known of a PDF's pages at its stat stamp (pdfFacts).
const factsOf = (file: string, stamp: string): PdfFacts => pdfFacts.get(`${file}@${stamp}`) ?? NO_FACTS

// The page a row shows of a PDF at its stat stamp: the page stored, before
// a page known not to exist (stored so, for the next press).
function rowPage(row: string, f: PdfFacts): number {
  const stored = pdfPages.get(row) ?? 1
  const page = pageOf(stored, f.missing)
  if (page !== stored) keep(pdfPages, row, page, PICTURES_KEPT)
  return page
}

// A PDF's page under its row (`row`: its key in pdfPages; page 1 at first)
// with its control line, or a dim line with Typst's error (with the control
// line after page 1). A page not known to exist is waited for (it is
// mostly made ahead already): no older page draws with its number. The next
// page is made too (pdfFacts then tells whether › acts); on the first draw
// it is waited for, so a PDF of one page never draws the line. `next`: the
// target's box in an open epoch (as for an image). Null with no Typst, or
// for a file that is gone.
async function pdfOf(
  $: EngineInterface, e: RowInput, ready: Env, o: { file: string; row: string; box: PixelBox; next: PixelBox | null; at?: StatAt },
): Promise<Under | null> {
  const { file, row, box, at } = o
  const st = await statOf($, file, at)
  if (!ready.typst || !st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  const known = factsOf(file, stamp)
  const page = rowPage(row, known)
  const wait = known.made < page
  if (o.next && (o.next.width !== box.width || o.next.height !== box.height)) {
    void convertedOf($, ready, file, o.next, at, { page, row, wait }).catch(() => null)
    if (!(await hasPngOf($, file, at, row))) return null
  }
  const first = !(await hasPngOf($, file, at, row))
  const made = convertedOf($, ready, file, box, at, { page, row, wait }).catch(() => null)
  const isKnown = known.made > page || (known.missing > 0 && page + 1 >= known.missing)
  const ahead = isKnown ? null : convertedOf($, ready, file, box, at, { page: page + 1, row, probe: true }).catch(() => null)
  const png = await made
  if (first) await ahead
  const now = factsOf(file, stamp)
  // The file got shorter and the row's page is gone: its last page (the
  // count in Typst's hint), else page 1. One run more at most.
  if (!png && page > 1 && now.missing && page >= now.missing) {
    keep(pdfPages, row, lastKnownPage(now), PICTURES_KEPT)
    return pdfOf($, e, ready, o)
  }
  const controls = pageControls(page, now.missing)
  const line = controls ? { row, file, stamp, page, box, ...controls } : undefined
  if (!png) {
    const error = now.errors[page]
    if (!error) return null
    return page > 1 ? { note: `PDF: page ${page}: ${error}`, pdf: line } : { note: `PDF: ${error}` }
  }
  const picture = await shownOne($, e, ready, png, nameOf(file), at)
  return picture && line ? { ...picture, pdf: line } : picture
}

// Whether page `page` of a PDF exists: by what is known, else by a run that
// makes it (at the box of its picture, so the row draws it at once). A
// string: Typst's error for another failure; null when it is not known (no
// Typst, a file that is gone).
async function pageMade($: EngineInterface, ready: Env, file: string, row: string, page: number, box: PixelBox): Promise<boolean | string | null> {
  const st = await fsStat($, file).catch(() => null)
  if (!ready.typst || !st || st.kind !== 'file') return null
  const stamp = `${st.mtimeMs}:${st.size}`
  const known = factsOf(file, stamp)
  if (known.missing && page >= known.missing) return false
  if (!converted.has(convertKey(file, stamp, box, page))) await runOf($, ready, file, stamp, box, { page, row }).catch(() => null)
  const f = factsOf(file, stamp)
  if (f.missing && page >= f.missing) return false
  return f.made >= page ? true : (f.errors[page] ?? null)
}

// A press on ‹ or ›: the row's page `by` one, within the pages known at the
// stamp it drew with, and the row draws again.
function turnPage($: EngineInterface, line: PageLine, by: number) {
  const known = factsOf(line.file, line.stamp)
  const now = pageOf(pdfPages.get(line.row) ?? line.page, known.missing)
  const page = pageOf(now + by, known.missing)
  if (page === now) return
  keep(pdfPages, line.row, page, PICTURES_KEPT)
  refresh($)
}

// The page field: a pane that opens above the prompt (docked beside the
// transcript in fullscreen) and takes the keys, its Input focused. Esc
// closes it (closeOnEscape). The band above the prompt can not take the
// keys for a plugin (only the person's ctrl+x tab or click), so it is a
// pane.
const PAGE_PANE = 'iui-page'

// A press on the page number: the page field, with the page in it.
async function askPage($: EngineInterface, line: PageLine) {
  pageAsk.now = { row: line.row, file: line.file, box: line.box, value: String(line.page), note: '' }
  await uiOpen($, { id: PAGE_PANE, title: 'Page', focus: true, closeOnEscape: true, rows: 2, columns: 24 }).catch(() => undefined)
  // An open field (another row's) draws the new page.
  invalidate($, 'ui.render')
}

// Enter in the page field: a page that exists shows in its row and the
// field closes; else the field stays open with a note. Only the last Enter
// in the field as it is now acts: a field opened again (another row) or a
// later Enter makes an earlier one's result go unused.
async function submitPage($: EngineInterface, text: string) {
  const ask = pageAsk.now
  if (!ask) return void uiClose($, { id: PAGE_PANE }).catch(() => undefined)
  const mine = { ...ask, value: text }
  pageAsk.now = mine
  const page = parsePage(text)
  const made = page && S.env ? await pageMade($, S.env, ask.file, ask.row, page, ask.box) : null
  if (pageAsk.now !== mine) return
  if (!page || made !== true) {
    const note = !page ? 'Type a page number' : made === false ? `No page ${page}` : `Page ${page}: ${made ?? 'Typst could not make it'}`
    pageAsk.now = { ...mine, note }
    invalidate($, 'ui.render')
    return
  }
  keep(pdfPages, ask.row, page, PICTURES_KEPT)
  pageAsk.now = null
  await uiClose($, { id: PAGE_PANE }).catch(() => undefined)
  refresh($)
}

// The page field's tree: the page in an Input that has the focus, and its
// note under it.
export function drawPageField($: EngineInterface, e: RenderInput<'Pane', 'terminal'>) {
  const { Box, Text, Input } = uiResolve($, e)
  const ask = pageAsk.now
  if (!ask) return <Text dimColor>No PDF page to go to. Esc closes this.</Text>
  return (
    <Box flexDirection="column">
      <Input key="page" label="Page " value={ask.value} submitLabel="go" autoFocus onSubmit={text => void submitPage($, text)} />
      {ask.note ? <Text dimColor>{ask.note}</Text> : null}
    </Box>
  )
}

// The control line under a PDF's page, one row: ‹, the page number and ›,
// each a Button in the accent color, or dim and no Button where it does
// nothing (‹ on page 1, › on the last page). The number opens the page
// field. Centered under the picture when `columns` (its width) is given:
// a margin of half the room the line leaves (it is 6 cells and the digits).
function drawPageLine($: EngineInterface, e: RowInput, line: PageLine, keys: string, columns?: number) {
  const { Box, Text, Button } = uiResolve($, e)
  const arrow = (glyph: string, on: boolean, by: number, key: string) =>
    on ? (
      <Button key={`${keys}${key}`} plain onPress={() => turnPage($, line, by)}>
        <Text color="suggestion">{glyph}</Text>
      </Button>
    ) : (
      <Text dimColor>{glyph}</Text>
    )
  return (
    <Box height={1} overflow="hidden" marginLeft={columns ? Math.max(0, Math.floor((columns - 6 - String(line.page).length) / 2)) : 0}>
      {arrow('‹', line.back, -1, 'page-back')}
      <Text>{'  '}</Text>
      <Button key={`${keys}page-number`} plain onPress={() => void askPage($, line)}>
        <Text color="suggestion">{String(line.page)}</Text>
      </Button>
      <Text>{'  '}</Text>
      {arrow('›', line.forward, 1, 'page-forward')}
    </Box>
  )
}

// The space a picture takes in `frame` with the height setting `height`
// (as in shownOne), which a JPEG, WebP, SVG or PDF page is made to fit. Over
// ssh it stays INLINE_MAX_SIDE pixels wide at most.
const boxOf = (frame: Frame, inline: boolean, height: Height): PixelBox =>
  convertBox(pictureColumns(frame, inline), pictureRowsFor(frame.rows, height), frame.cell)

// The rows underRow draws under the pages of `under[i]` besides its Typst
// error line: its link rows, then all after it (a picture its rows, a
// PDF's error line one, each with a PDF's control line; a Markdown file its
// pages at their drawn box (fitBox in `room`, as drawPages), a Typst error
// line and its link rows; a blank none). `isSelect`: the row's pages take
// picture select (takesSelect), so pages drawn from files have no link rows.
export function rowsAfter(under: readonly Under[], i: number, room: number, isSelect = false): number {
  const own = under[i]
  return linkRows(own, isSelect) + under.slice(i + 1).reduce((sum, u) => {
    if ('note' in u) return sum + 1 + (u.pdf ? 1 : 0)
    if ('source' in u) return sum + u.rows + (u.pdf ? 1 : 0)
    if (u.drawing.kind !== 'pages') return sum
    const { pages, note } = u.drawing.result
    return sum + pages.reduce((n, p) => n + fitBox(p, room).rows, 0) + (note ? 1 : 0) + linkRows(u, isSelect)
  }, 0)
}

// The link rows drawn under a Markdown file's pages (one row each; none where they take picture select).
const linkRows = (u: Under | undefined, isSelect: boolean) =>
  u && 'drawing' in u && u.drawing.kind === 'pages' ? linkRowsOf(u.links, isSelect && !u.drawing.bytes) : 0

// The engine's row, then the pictures under it.
export function underRow($: EngineInterface, e: RowInput, row: RenderElement, under: readonly Under[]) {
  const { Box, Image, Text } = uiResolve($, e)
  return (
    <Box flexDirection="column">
      {row}
      <Box flexDirection="column" marginLeft={GUTTER}>
        {under.map((s, i) => {
          if ('note' in s && s.pdf) {
            return (
              <Box key={`pdf-${i}`} flexDirection="column">
                <Text dimColor wrap="truncate-end">{s.note}</Text>
                {drawPageLine($, e, s.pdf, `pdf${i}-`)}
              </Box>
            )
          }
          if ('note' in s) return <Text key={`note-${i}`} dimColor wrap="truncate-end">{s.note}</Text>
          if ('source' in s && s.pdf) {
            return (
              <Box key={`pdf-${i}`} flexDirection="column">
                <Image source={s.source} columns={s.columns} rows={s.rows} alt={s.alt} />
                {drawPageLine($, e, s.pdf, `pdf${i}-`, s.columns)}
              </Box>
            )
          }
          if ('source' in s) return <Image key={`picture-${i}`} source={s.source} columns={s.columns} rows={s.rows} alt={s.alt} />
          const { drawing } = s
          if (drawing.kind === 'blank') return <Box key={`blank-${i}`} />
          return (
            <Box key={`pages-${i}`} flexDirection="column">
              {drawPages($, e, drawing.result, drawing.bytes, { gutter: 0, marginTop: 0, keys: `file${i}-`, links: s.links, id: s.id })}
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
  const id = await sessionId($)
  const kept = pasteDirs.get(id)
  if (kept) return kept
  const found = async (dirs: Iterable<string>) => {
    for (const dir of dirs) {
      if (!(await fsExists($, dir).catch(() => false))) continue
      pasteDirs.set(id, dir)
      return dir
    }
    return ''
  }
  const root = await sessionRoot($).catch(() => ready.cwd)
  const named = await found(new Set([ready.cwd, root].map(dir => pasteDirOf(ready.claudeTmp, dir, id))))
  if (named) return named
  const projects = (await fsList($, ready.claudeTmp).catch(() => [])).filter(f => f.kind === 'dir')
  return found(projects.map(f => `${ready.claudeTmp}/${f.name}/${id}/images`))
}
