// Pictures under rows (pure): which images, PDFs and Markdown files a
// SendUserFile result names, which images a prompt names, where Claude Code
// keeps pasted images, the cells a picture takes, and the pages of a PDF.
// The drawing on the host is in pictures.tsx.
import type { Cell } from './state'
import { CONVERT_MAX_SIDE, MAX_IMAGE_ROWS, PICTURE_MAX_ROWS, PICTURE_MIN_ROWS, PICTURE_ROOM_ROWS, type Height } from './settings'
import { hashOf } from './draw'

// The most rows a picture under a row (or a drawing's room) takes in a
// terminal of `terminalRows` rows (frameFor(...).rows), by `height` (/iui
// height): half the rows within PICTURE_MIN_ROWS to PICTURE_MAX_ROWS
// (half); the rows less PICTURE_ROOM_ROWS (full); or a number, at most as
// much as full. Never under PICTURE_MIN_ROWS or over MAX_IMAGE_ROWS.
export function pictureRowsFor(terminalRows: number | undefined, height: Height): number {
  const view = terminalRows ?? 2 * PICTURE_MAX_ROWS
  const full = view - PICTURE_ROOM_ROWS
  const rows = height === 'half' ? Math.min(PICTURE_MAX_ROWS, Math.floor(view / 2)) : height === 'full' ? full : Math.min(height, full)
  return Math.min(MAX_IMAGE_ROWS, Math.max(PICTURE_MIN_ROWS, rows))
}

// A row's onScreen (e.props.onScreen) as a job's: null (the terminal holds
// the row off screen) is false, a range is true, none is not known.
export const onScreenOf = (v: unknown): boolean | undefined => (v === null ? false : v ? true : undefined)

// The cells a picture of `size` pixels takes: its own size or smaller (never
// larger), at most `columns` wide and `rows` tall, the aspect kept.
export function pictureCells(size: { width: number; height: number }, columns: number, rows: number, px: Cell): { columns: number; rows: number } {
  const scale = Math.min(1, (columns * px.width) / size.width, (rows * px.height) / size.height)
  return {
    columns: Math.max(1, Math.min(MAX_IMAGE_ROWS, columns, Math.round((size.width * scale) / px.width))),
    rows: Math.max(1, Math.min(MAX_IMAGE_ROWS, rows, Math.round((size.height * scale) / px.height))),
  }
}

// The kinds of file a SendUserFile result can draw: an image the engine's
// Image takes (PNG), an image Typst makes a PNG of (JPEG, WebP, SVG), a PDF
// (Typst makes a PNG of one page), and a Markdown file (drawn as an answer
// is).
export type SentKind = 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf' | 'markdown'
export type SentFile = { path: string; kind: SentKind }

// An image's type: by its media type, else by its file name. Null for any
// other type (GIF, …). An image with neither is a PNG to try (the header
// read tells for sure).
export function imageKindOf(a: { path: string; media_type?: unknown }): 'png' | 'jpeg' | 'webp' | 'svg' | null {
  if (typeof a.media_type === 'string') {
    const type = a.media_type.trim().toLowerCase()
    if (type === 'image/png') return 'png'
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpeg'
    if (type === 'image/svg+xml') return 'svg'
    return type === 'image/webp' ? 'webp' : null
  }
  if (/\.jpe?g$/i.test(a.path)) return 'jpeg'
  if (/\.webp$/i.test(a.path)) return 'webp'
  if (isSvgPath(a.path)) return 'svg'
  return 'png'
}

// An SVG file, by its name. Claude Code sends one with isImage false (its
// images are PNG, JPEG, GIF and WebP) and the media type image/svg+xml.
export const isSvgPath = (path: string) => /\.svg$/i.test(path)
const isSvg = (a: { path: string; media_type?: unknown }) =>
  typeof a.media_type === 'string' ? a.media_type.trim().toLowerCase() === 'image/svg+xml' : isSvgPath(a.path)

// A PDF file, by its name. Claude Code sends one with isImage false and the
// media type application/pdf.
export const isPdfPath = (path: string) => /\.pdf$/i.test(path)
const isPdf = (a: { path: string; media_type?: unknown }) =>
  typeof a.media_type === 'string' ? a.media_type.trim().toLowerCase() === 'application/pdf' : isPdfPath(a.path)

// A Markdown file, by its name: .md or .markdown.
export const isMarkdownPath = (path: string) => /\.(md|markdown)$/i.test(path)

// The files of a SendUserFile result that can draw, in its order, each once.
export function sentFiles(output: unknown): SentFile[] {
  const list = output && typeof output === 'object' ? (output as { attachments?: unknown }).attachments : undefined
  if (!Array.isArray(list)) return []
  const found: SentFile[] = []
  for (const a of list) {
    if (!a || typeof a !== 'object' || typeof a.path !== 'string' || a.path === '') continue
    if (found.some(f => f.path === a.path)) continue
    const kind = a.isImage === true ? imageKindOf(a) : isSvg(a) ? 'svg' : isPdf(a) ? 'pdf' : isMarkdownPath(a.path) ? 'markdown' : null
    if (kind) found.push({ path: a.path, kind })
  }
  return found
}

// The paths of a SendUserFile result that draw as a picture (PNG, JPEG,
// WebP, SVG, and a page of a PDF).
export const sentImages = (output: unknown) => sentFiles(output).filter(f => f.kind !== 'markdown').map(f => f.path)

// The folder of a file, for the relative images of a Markdown file.
export const folderOf = (path: string) => path.replace(/\/+[^/]*$/, '') || '/'

// The box in pixels a JPEG, WebP, SVG or PDF page is made to fit: the space
// a picture takes (as pictureCells), each side at most CONVERT_MAX_SIDE.
export type PixelBox = { width: number; height: number }
export function convertBox(columns: number, rows: number, px: Cell): PixelBox {
  const side = (n: number) => Math.max(1, Math.min(CONVERT_MAX_SIDE, Math.round(n)))
  return { width: side(columns * px.width), height: side(rows * px.height) }
}

// The PNG Typst makes of a JPEG, WebP or SVG, or of a PDF's page: in a key
// folder of the cache (as a compile's, dropped after 2 days), by the file,
// its stat stamp, the box and the page, so a changed file, a new box or
// another page is made again. With no page the key is as before.
export const convertedPath = (cache: string, file: string, stamp: string, box: PixelBox, page?: number) =>
  `${cache}/${hashOf(['convert', file, stamp, box.width, box.height, ...(page ? ['page', page] : [])])}/image.png`

// ---- PDF pages ----------------------------------------------------------------
// A PDF draws one page at a time. Its page count is not read: when page N
// shows, page N+1 is made too, and Typst's "page N+1 does not exist" tells
// that N is the last page. The hint of that error has the page count.

// What is known of a PDF's pages at one stat stamp: the highest page made
// (0: none yet), the lowest page Typst says does not exist (0: not known),
// the page count from Typst's hint (0: not known), and the short Typst
// error of each page that failed for another reason.
export type PdfFacts = { made: number; missing: number; pages: number; errors: Readonly<Record<number, string>> }
export const NO_FACTS: PdfFacts = { made: 0, missing: 0, pages: 0, errors: {} }

// Typst's error for a page that is not in the PDF ("failed to load PDF
// (page 4 does not exist)").
export const isNoPageError = (stderr: string) => /\bpage \d+ does not exist\b/i.test(stderr)

// The page count in the hint of that error ("hint: the document only has
// 3 pages", in Typst's human format only); 0 when it is not there.
export const pageCountOf = (stderr: string) => Number(/\bonly has (\d+) pages?\b/i.exec(stderr)?.[1] ?? 0)

// The first Typst error of a run, short: the text after "error: ", its
// "failed to load PDF (…)" cut to what is in the parentheses.
export function shortError(stderr: string): string {
  const line = stderr.split('\n').find(l => /\berror: /.test(l)) ?? stderr.split('\n').find(l => l.trim()) ?? ''
  const text = line.replace(/^.*?\berror: /, '').trim()
  return (/^failed to load PDF \((.+)\)$/i.exec(text)?.[1] ?? text) || 'Typst could not read it'
}

// The facts after a run for `page`: made (`stderr` null), not there (with
// the page count when the hint gives it), or another error.
export function factsAfter(f: PdfFacts, page: number, stderr: string | null): PdfFacts {
  if (stderr === null) {
    const { [page]: _, ...errors } = f.errors
    return { ...f, made: Math.max(f.made, page), errors }
  }
  if (isNoPageError(stderr)) {
    const pages = pageCountOf(stderr)
    if (pages > 0 && pages < page) return { ...f, pages, missing: pages + 1 }
    return { ...f, missing: f.missing ? Math.min(f.missing, page) : page }
  }
  return { ...f, errors: { ...f.errors, [page]: shortError(stderr) } }
}

// The last page as far as it is known, for a row whose page is gone (the
// file got shorter): the page count, or the page before the first missing
// one when that page was made; else page 1.
export const lastKnownPage = (f: PdfFacts) => (f.pages ? f.pages : f.missing > 1 && f.made === f.missing - 1 ? f.made : 1)

// The page to show: at least 1, and before a page known not to exist.
export const pageOf = (page: number, missing: number) => Math.max(1, missing ? Math.min(page, missing - 1) : page)

// The control line under a page: whether ‹ (`back`) and › (`forward`) act.
// › acts until the next page is known not to exist. Null for a PDF of one
// page: no line.
export function pageControls(page: number, missing: number): { back: boolean; forward: boolean } | null {
  if (missing === 2) return null
  return { back: page > 1, forward: !missing || page + 1 < missing }
}

// A page number the person typed: a whole number from 1, spaces around it
// allowed; null for any other text.
export function parsePage(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && Number.isSafeInteger(n) ? n : null
}

// The numbers of the `[Image #N]` marks in a prompt, each once, in order.
export function pastedNumbers(text: string): number[] {
  const found: number[] = []
  for (const m of text.matchAll(/\[Image #(\d+)\]/g)) {
    const n = Number(m[1])
    if (n > 0 && !found.includes(n)) found.push(n)
  }
  return found
}

// Claude Code's folder name for a project: every character but a letter or a
// digit is `-` (/Users/me/app → -Users-me-app).
export const projectSlug = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-')

// Claude Code's temp folder of this user: <CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>
// (/tmp is /private/tmp on macOS); '' when the uid is not known.
export function claudeTmpOf(o: { tmpdir?: string; uid: string; isMac: boolean }): string {
  const uid = o.uid.trim()
  if (!/^\d+$/.test(uid)) return ''
  const base = (o.tmpdir?.trim() || (o.isMac ? '/private/tmp' : '/tmp')).replace(/\/+$/, '')
  return `${base}/claude-${uid}`
}

// Where Claude Code keeps the images pasted in a session, and image N there.
export const pasteDirOf = (claudeTmp: string, cwd: string, sessionId: string) => `${claudeTmp}/${projectSlug(cwd)}/${sessionId}/images`
export const pastedImagePath = (dir: string, n: number) => `${dir}/${n}.png`
