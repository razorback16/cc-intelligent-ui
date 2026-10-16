// Pictures under rows (pure): which images a SendUserFile result or a prompt
// names, where Claude Code keeps pasted images, and the cells a picture takes.
// The drawing on the host is in pictures.tsx.
import type { Cell } from './state'
import { MAX_IMAGE_ROWS, PICTURE_MAX_ROWS, PICTURE_MIN_ROWS } from './settings'

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

// The image paths of a SendUserFile result that can be PNGs (the engine's
// Image draws PNG only; the header read tells for sure).
export function sentImages(output: unknown): string[] {
  const list = output && typeof output === 'object' ? (output as { attachments?: unknown }).attachments : undefined
  if (!Array.isArray(list)) return []
  return list
    .filter((a): a is { path: string; isImage: true; media_type?: unknown } =>
      !!a && typeof a === 'object' && a.isImage === true && typeof a.path === 'string' && a.path !== '')
    .filter(a => typeof a.media_type !== 'string' || /^image\/png$/i.test(a.media_type))
    .map(a => a.path)
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
