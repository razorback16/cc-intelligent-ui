// The pictures of an answer: the key of its inputs, the page width and ppi
// that match the terminal's text, where its first line sits, and the
// drawing of its pages beside the reply bullet.
import type { EngineInterface, RenderComponent, ResolveInput } from 'claude-code'

import type { MdPreviewTheme } from '../../types'
import { BODY_PT, bulletOf, GUTTER, MARGIN_TOP, MAX_IMAGE_ROWS, TEMPLATE_VERSION } from './settings'
import { INLINE_KEPT, inlined, S, type Cell, type Look, type Metrics, type Result } from './state'
import { FENCE } from './markdown'
import { fitsInline } from './terminal'

// FNV-1a over the parts, twice with different offsets: 16 hex digits.
export function hashOf(parts: readonly (string | number)[]): string {
  const s = parts.join('\u0000')
  let a = 0x811c9dc5
  let b = 0x050c5d1f
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

// How wide a column is in the page's pt so the template's 11 pt body text
// looks as big as the terminal's text, `sizePercent` on top. A terminal em is
// a cell / the advance of its font; the body font is matched to it by
// x-height and average width together (sqrt of the two ratios), since a
// proportional font at the same em looks smaller. Code is set in the
// terminal's font at the terminal's size: `code` is its size / body size.
// The template uses `code` only for a theme that sets "size": "terminal"
// for code; the vscode themes draw code at body size, as VS Code does.
export function fontFit(m: Metrics, sizePercent = 100) {
  const t = m.term ?? m.menlo
  const ratio = Math.sqrt((t.xh / m.body.xh) * (t.avg / m.body.avg))
  const scale = sizePercent / 100
  return {
    columnPt: Math.round(((BODY_PT * t.adv) / (ratio * scale)) * 10000) / 10000,
    code: Math.round((1 / ratio) * 10000) / 10000,
    ratio,
  }
}

// The page width in pt and the ppi that make the PNG exactly as wide as the
// box in device pixels; `rowPt` is one terminal row in the page's pt.
export function sizing(columns: number, px: Cell, columnPt: number) {
  const widthPt = Math.round(columns * columnPt * 100) / 100
  const widthPx = Math.round(columns * px.width)
  const ppi = widthPx / (widthPt / 72)
  return { widthPt, widthPx, ppi, rowPt: (px.height * 72) / ppi }
}

// Every input a picture depends on, as one key.
export function renderKey(o: {
  textHash: string
  columns: number
  cell: Cell
  size: number
  mode: MdPreviewTheme
  termFont: string
  columnPt: number
  templateStamp: string
  look: Look
  // Over ssh: pages are cut shorter (inlineBudget), so they are other PNGs.
  inline?: boolean
}): string {
  return hashOf([
    o.textHash, o.columns, o.cell.width, o.cell.height, o.size, o.mode, o.termFont, o.columnPt,
    o.templateStamp, o.look.name, o.look.dir, o.look.stamp, TEMPLATE_VERSION, ...(o.inline ? ['inline'] : []),
  ])
}

// Where the first line of a page's text lies with no top margin, in the
// template's pt (measured from its PNGs at 11 pt body text): the centre of
// its ink, and the top of its ink. By what the answer starts with.
export type FirstLine = 'para' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote' | 'code' | 'table'
const FIRST_LINE: Record<FirstLine, { centre: number; inkTop: number }> = {
  para: { centre: 7.45, inkTop: 2.55 },
  h1: { centre: 20.36, inkTop: 5.82 },
  h2: { centre: 13.09, inkTop: 3.64 },
  h3: { centre: 9.09, inkTop: 2.55 },
  h4: { centre: 7.27, inkTop: 2.18 },
  quote: { centre: 13.45, inkTop: 8.36 },
  code: { centre: 17.09, inkTop: 12.36 },
  table: { centre: 11.27, inkTop: 6.18 },
}

export function firstLineOf(md: string): FirstLine {
  const line = md.split('\n').find(l => l.trim()) ?? ''
  const heading = /^ {0,3}(#{1,6})\s/.exec(line)
  if (heading) return (['h1', 'h2', 'h3'] as const)[heading[1]!.length - 1] ?? 'h4'
  if (/^ {0,3}>/.test(line)) return 'quote'
  if (FENCE.test(line)) return 'code'
  if (/^ {0,3}\|/.test(line)) return 'table'
  return 'para'
}

// The first page's top margin (pt, may be negative) that puts the centre of
// the first line of text on the centre of a terminal row, and which row that
// is: row 0 when the line fits there, else the first row its ink can reach
// without being cut at the picture's top. The bullet is drawn on that row.
export function alignFirstLine(kind: FirstLine, rowPt: number): { topPt: number; bulletRow: number } {
  const { centre, inkTop } = FIRST_LINE[kind]
  const bulletRow = Math.max(0, Math.ceil((centre - inkTop + 0.5) / rowPt - 0.5 - 1e-9))
  return { topPt: Math.round(((bulletRow + 0.5) * rowPt - centre) * 100) / 100, bulletRow }
}

// The rows an Image of this PNG takes when it is drawn `columns` wide. The
// template pads each page to whole rows, so this rounds (no stretch).
export function rowsFor(page: { width: number; height: number }, columns: number, px: Cell): number {
  const scale = Math.min(1, (columns * px.width) / page.width)
  return Math.max(1, Math.min(MAX_IMAGE_ROWS, Math.round((page.height * scale) / px.height)))
}

// Over ssh: every page's PNG as base64 for a `{ png }` source, or null when
// a page cannot go (over INLINE_MAX_SIDE or INLINE_MAX_BYTES, or not read),
// so the message shows as text.
export async function inlineOf($: EngineInterface, result: Result): Promise<string[] | null> {
  const out: string[] = []
  for (const page of result.pages) {
    if (!fitsInline(page)) return null
    if (!inlined.has(page.file)) {
      const got = await $.fs.read(page.file, { as: 'bytes' }).catch(() => null)
      const base64 = got && fitsInline(page, got.base64) ? got.base64 : null
      if (got) inlined.set(page.file, base64)
      for (const old of inlined.keys()) {
        if (inlined.size <= INLINE_KEPT) break
        inlined.delete(old)
      }
      if (!base64) return null
      out.push(base64)
      continue
    }
    const base64 = inlined.get(page.file)
    if (!base64) return null
    out.push(base64)
  }
  return out
}

// How a set of pages sits: `bullet` the reply bullet in the gutter (on the
// first line's row), `gutter` its width (0: none), `marginTop` the rows above.
export type PagesLayout = { bullet?: boolean; gutter?: number; marginTop?: number }

// `inline`: each page's PNG as base64 (over ssh); else the terminal reads the file.
export function drawPages($: EngineInterface, e: ResolveInput<RenderComponent, 'terminal'>, result: Result, columns: number, px: Cell, inline?: readonly string[], layout: PagesLayout = {}) {
  const { Box, Text, Image } = $.ui.resolve(e)
  const gutter = layout.gutter ?? GUTTER
  return (
    <Box flexDirection="row" marginTop={layout.marginTop ?? MARGIN_TOP}>
      {gutter > 0 ? (
        <Box width={gutter} flexShrink={0} marginTop={result.bulletRow}>
          <Text>{layout.bullet ? bulletOf(S.env?.isMac ?? true) : ' '}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column">
        {result.pages.map((page, i) => {
          const rows = rowsFor(page, columns, px)
          return (
            <Image
              key={`p${i}`}
              source={inline ? { png: inline[i]! } : { file: page.file, format: 'png', generation: columns * 1000 + rows }}
              columns={columns}
              rows={rows}
              alt={page.alt}
            />
          )
        })}
        {result.note ? <Text dimColor wrap="truncate-end">Typst error: {result.note}</Text> : null}
      </Box>
    </Box>
  )
}
