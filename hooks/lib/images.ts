// Pictures under rows (pure): which images and Markdown files a SendUserFile
// result names, which images a prompt names, where Claude Code keeps pasted
// images, and the cells a picture takes. The drawing on the host is in
// pictures.tsx.
import type { Cell } from './state'
import { CONVERT_MAX_SIDE, MAX_IMAGE_ROWS, PICTURE_MAX_ROWS, PICTURE_MIN_ROWS } from './settings'
import { hashOf } from './draw'

// The most rows a picture under a row takes: half the viewport, within
// PICTURE_MIN_ROWS to PICTURE_MAX_ROWS.
export function pictureRowsFor(viewportRows: number | undefined): number {
  return Math.max(PICTURE_MIN_ROWS, Math.min(PICTURE_MAX_ROWS, Math.floor((viewportRows ?? 2 * PICTURE_MAX_ROWS) / 2)))
}

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
// Image takes (PNG), an image Typst makes a PNG of (JPEG, WebP), and a
// Markdown file (drawn as an answer is).
export type SentKind = 'png' | 'jpeg' | 'webp' | 'markdown'
export type SentFile = { path: string; kind: SentKind }

// An image's type: by its media type, else by its file name. Null for any
// other type (GIF, SVG, …). An image with neither is a PNG to try (the
// header read tells for sure).
export function imageKindOf(a: { path: string; media_type?: unknown }): 'png' | 'jpeg' | 'webp' | null {
  if (typeof a.media_type === 'string') {
    const type = a.media_type.trim().toLowerCase()
    if (type === 'image/png') return 'png'
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpeg'
    return type === 'image/webp' ? 'webp' : null
  }
  if (/\.jpe?g$/i.test(a.path)) return 'jpeg'
  if (/\.webp$/i.test(a.path)) return 'webp'
  return 'png'
}

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
    const kind = a.isImage === true ? imageKindOf(a) : isMarkdownPath(a.path) ? 'markdown' : null
    if (kind) found.push({ path: a.path, kind })
  }
  return found
}

// The image paths of a SendUserFile result that can draw (PNG, JPEG, WebP).
export const sentImages = (output: unknown) => sentFiles(output).filter(f => f.kind !== 'markdown').map(f => f.path)

// The folder of a file, for the relative images of a Markdown file.
export const folderOf = (path: string) => path.replace(/\/+[^/]*$/, '') || '/'

// The box in pixels a JPEG or WebP is made to fit: the space a picture
// takes (as pictureCells), each side at most CONVERT_MAX_SIDE.
export type PixelBox = { width: number; height: number }
export function convertBox(columns: number, rows: number, px: Cell): PixelBox {
  const side = (n: number) => Math.max(1, Math.min(CONVERT_MAX_SIDE, Math.round(n)))
  return { width: side(columns * px.width), height: side(rows * px.height) }
}

// The PNG Typst makes of a JPEG or WebP: in a key folder of the cache (as a
// compile's, dropped after 2 days), by the file, its stat stamp and the box,
// so a changed file or a new box is made again.
export const convertedPath = (cache: string, file: string, stamp: string, box: PixelBox) =>
  `${cache}/${hashOf(['convert', file, stamp, box.width, box.height])}/image.png`

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
