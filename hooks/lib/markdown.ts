// Markdown as md-preview reads it: blocks, fences, the segments an answer is
// cut into, the images it names, and a plain text of it for an Image's alt.
import { ALT_CHARS, SEGMENT_ROWS } from './settings'

export const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)/
export const isTypstInfo = (info: string) => /^(typst|typ)$/i.test(info)

// One block of Markdown: lines between blank lines outside fences, or one
// fenced block that starts at the margin.
export type Block = { lines: string[]; fence?: { mark: string; info: string }; isMath?: boolean }

export function blocksOf(md: string): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  let open: { char: string; len: number } | null = null
  let inMath = false
  const close = () => {
    if (cur && cur.lines.length) blocks.push(cur)
    cur = null
  }
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (open) {
      cur!.lines.push(line)
      const m = FENCE.exec(line)
      if (m && m[2]![0] === open.char && m[2]!.length >= open.len && line.trim() === m[2]) {
        open = null
        if (cur!.fence) close()
      }
      continue
    }
    if (inMath) {
      cur!.lines.push(line)
      if (line.trim() === '$$') inMath = false
      continue
    }
    const m = FENCE.exec(line)
    if (m) {
      open = { char: m[2]![0]!, len: m[2]!.length }
      // A fence at the margin is a block of its own; an indented one (in a
      // list item) stays with the item.
      if (m[1] === '') {
        close()
        cur = { lines: [line], fence: { mark: m[2]!, info: m[3] ?? '' } }
      } else (cur ??= { lines: [] }).lines.push(line)
      continue
    }
    if (line.trim() === '') {
      close()
      continue
    }
    ;(cur ??= { lines: [] }).lines.push(line)
    if (line.trim() === '$$') {
      inMath = true
      cur.isMath = true
    }
  }
  close()
  return blocks
}

// A rough count of the rows a block takes once drawn `columns` wide.
export function rowsOfBlock(block: Block, columns: number): number {
  const isCode = !!block.fence
  const perRow = columns * (isCode ? 1.0 : 1.15)
  let rows = 1
  for (const line of block.lines) {
    rows += Math.ceil(Math.max(1, line.length) / perRow) * (isCode ? 1.1 : 1.3)
    if (/^#{1,2}\s/.test(line)) rows += 1.5
  }
  if (block.fence && isTypstInfo(block.fence.info)) rows += 20
  return rows
}

const LINK_DEF = /^ {0,3}\[(?!\^)[^\]]+\]:\s*\S/
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]]+\]:/

// Splits an answer into segments of about `budget` rows at block boundaries.
// A fence is never split, but a long plain code fence is cut into several
// fences of the same language; a typst fence always stays whole. A block that
// starts indented (a list item's continuation) never starts a segment. Text
// with footnotes stays one segment; link definitions go into every segment.
export function splitSegments(md: string, columns: number, budget = SEGMENT_ROWS): string[] {
  const blocks = blocksOf(md)
  if (!blocks.length) return []
  const outside = blocks.filter(b => !b.fence).flatMap(b => b.lines)
  if (outside.some(line => FOOTNOTE_DEF.test(line))) return [md]
  const defs = outside.filter(line => LINK_DEF.test(line))

  const pieces: Block[] = []
  for (const block of blocks) {
    const { fence } = block
    if (fence && !isTypstInfo(fence.info) && rowsOfBlock(block, columns) > budget && block.lines.length > 2) {
      const body = block.lines.slice(1, -1)
      const per = Math.max(1, Math.floor(budget / Math.max(1.1, rowsOfBlock(block, columns) / block.lines.length)) - 2)
      for (let i = 0; i < body.length; i += per) {
        pieces.push({ lines: [block.lines[0]!, ...body.slice(i, i + per), fence.mark], fence })
      }
    } else pieces.push(block)
  }

  const segments: Block[][] = [[]]
  let used = 0
  for (const piece of pieces) {
    const need = rowsOfBlock(piece, columns)
    const canCut = !/^\s/.test(piece.lines[0] ?? '')
    if (used + need > budget && segments.at(-1)!.length && canCut) {
      segments.push([])
      used = 0
    }
    segments.at(-1)!.push(piece)
    used += need
  }
  const texts = segments.map(seg => seg.map(b => b.lines.join('\n')).join('\n\n'))
  if (texts.length < 2 || !defs.length) return texts
  return texts.map(t => `${t}\n\n${defs.filter(d => !t.includes(d)).join('\n')}`.trimEnd())
}

// The local image paths Markdown names outside code fences.
const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

export function localImages(md: string): string[] {
  const found: string[] = []
  let open: { char: string; len: number } | null = null
  for (const line of md.split('\n')) {
    const m = FENCE.exec(line)
    if (open) {
      if (m && m[2]![0] === open.char && m[2]!.length >= open.len && line.trim() === m[2]) open = null
    } else if (m) open = { char: m[2]![0]!, len: m[2]!.length }
    else for (const ref of line.matchAll(IMAGE)) if (!/^[a-z][a-z0-9+.-]*:/i.test(ref[2]!) || /^file:/i.test(ref[2]!)) found.push(ref[2]!)
  }
  return found
}

// Where an image path leads, as the template resolves it: `file://` dropped,
// `%20` a space, a relative path joined to `base`.
export function imagePathOf(path: string, base: string): string {
  const plain = path.trim().replace(/^file:\/\//i, '').replace(/%20/g, ' ')
  return plain.startsWith('/') ? plain : `${base.replace(/\/+$/, '')}/${plain.replace(/^\.\//, '')}`
}

// A short one-line plain text of some Markdown, for an Image's alt.
export function plainOf(md: string, max = ALT_CHARS): string {
  const flat = md
    .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat || ' '
}

export const firstLine = (text: string) => text.split('\n').find(l => l.trim())?.trim() ?? ''
