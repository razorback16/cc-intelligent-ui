// The pictures of an answer: the key of its inputs, the page width and ppi
// that match the terminal's text, where its first line sits, and the
// drawing of its pages beside the reply bullet, with the rows of its links
// under them.
import type { EngineInterface, RenderComponent, RenderSurface, RenderViewport, ResolveInput } from 'claude-code'

import type { IuiTheme } from '../../types'
import { BODY_PT, bulletOf, GRID_VERSION, GUTTER, LINK_FILES_KEPT, MARGIN_TOP, RESULTS_KEPT, TEMPLATE_VERSION } from './settings'
import { INLINE_KEPT, inlined, keep, linkFiles, S, type Cell, type Look, type Metrics, type Result, type Room } from './state'
import { DEFAULT_GRID, gridFirstRow, type GridMetrics } from './grid'
import { FENCE, imagePathOf } from './markdown'
import { linksOf, type LinkItem } from './links'
import { fitBox, fitsInline, roomColumns } from './terminal'
import { clickLinks, selectOn } from './select'
import { noteSite } from './blit'
import { fsExists, fsRead, uiCopy, uiResolve, uiToast } from './api'

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
  mode: IuiTheme
  termFont: string
  columnPt: number
  templateStamp: string
  look: Look
  // Over ssh: pages are cut shorter (inlineBudget), so they are other PNGs.
  inline?: boolean
  // The folder relative images start from, when it is not the session's (a
  // Markdown file's): the same text there shows other images.
  base?: string
  // Only for a text with a live Typst block or a local image (needsRoom):
  // the room height and the design. A plain text's key does not change
  // with the rows.
  room?: Room
  // `/iui grid` on: the lines on the row grid, another picture (with
  // GRID_VERSION). Off adds nothing, so the keys of before stay.
  grid?: boolean
  // The fake bold of a terminal font with no bold face (fauxBoldOf).
  fauxBold?: boolean
}): string {
  const { room } = o
  return hashOf([
    o.textHash, o.columns, o.cell.width, o.cell.height, o.size, o.mode, o.termFont, o.columnPt,
    o.templateStamp, o.look.name, o.look.dir, o.look.stamp, TEMPLATE_VERSION, ...(o.inline ? ['inline'] : []),
    ...(o.base ? ['base', o.base] : []),
    ...(room ? ['room', room.heightPt, room.design.widthPt, room.design.heightPt] : []),
    ...(o.grid ? ['grid', GRID_VERSION] : []),
    ...(o.fauxBold ? ['faux-bold'] : []),
  ])
}

// Where the first line of a page's text lies with no top margin, in the
// template's pt (measured from its PNGs at 11 pt body text, vscode): the
// centre of its ink, and the top of its ink. By what the answer starts with.
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

const HEADING = /^ {0,3}(#{1,6})\s/
const firstTextLine = (md: string) => md.split('\n').find(l => l.trim()) ?? ''
export function firstLineOf(md: string): FirstLine {
  const line = firstTextLine(md)
  const heading = HEADING.exec(line)
  if (heading) return (['h1', 'h2', 'h3'] as const)[heading[1]!.length - 1] ?? 'h4'
  if (/^ {0,3}>/.test(line)) return 'quote'
  if (FENCE.test(line)) return 'code'
  if (/^ {0,3}\|/.test(line)) return 'table'
  return 'para'
}

// FIRST_LINE in a theme (its grid numbers): a quote's, code block's or
// table's first line moves by the theme's padding less vscode's. A "grid"
// table's ink starts at its box's top rule, so the box is not cut.
function firstLineIn(kind: FirstLine, g: GridMetrics): { centre: number; inkTop: number } {
  const at = FIRST_LINE[kind]
  if (kind !== 'quote' && kind !== 'code' && kind !== 'table') return at
  const more = g.pad[kind] - DEFAULT_GRID.pad[kind]
  return { centre: at.centre + more, inkTop: kind === 'table' && g.tableStyle === 'grid' ? 0 : at.inkTop + more }
}

// The first page's top margin (pt, may be negative) that puts the centre of
// the first line of text on the centre of a terminal row, and which row that
// is: row 0 when the line fits there, else the first row its ink can reach
// without being cut at the picture's top. The bullet is drawn on that row.
// `g`: the theme's grid numbers (its padding).
export function alignFirstLine(kind: FirstLine, rowPt: number, g: GridMetrics = DEFAULT_GRID): { topPt: number; bulletRow: number } {
  const { centre, inkTop } = firstLineIn(kind, g)
  const bulletRow = Math.max(0, Math.ceil((centre - inkTop + 0.5) / rowPt - 0.5 - 1e-9))
  return { topPt: Math.round(((bulletRow + 0.5) * rowPt - centre) * 100) / 100, bulletRow }
}

// The first page's top margin and bullet row. With the row grid (the
// fonts' grid numbers and the job's code size): no margin, and the row of
// the first line's ink centre (gridFirstRow). Off the grid, `metrics` gives
// the theme's padding.
export function placeFirstLine(
  md: string, rowPt: number, grid?: { metrics: GridMetrics; code: number }, metrics: GridMetrics = grid?.metrics ?? DEFAULT_GRID,
): { topPt: number; bulletRow: number } {
  const kind = firstLineOf(md)
  if (!grid) return alignFirstLine(kind, rowPt, metrics)
  const level = HEADING.exec(firstTextLine(md))?.[1]!.length ?? 0
  return { topPt: 0, bulletRow: gridFirstRow(kind, level, rowPt, grid.metrics, grid.code) }
}

// Over ssh: every page's PNG as base64 for a `{ png }` source, or null when
// a page cannot go (over INLINE_MAX_SIDE or INLINE_MAX_BYTES, or not read),
// so the message shows as text.
export async function inlineOf($: EngineInterface, result: Result): Promise<string[] | null> {
  const out: string[] = []
  for (const page of result.pages) {
    if (!fitsInline(page)) return null
    if (!inlined.has(page.file)) {
      const got = await fsRead($, page.file, { as: 'bytes' }).catch(() => null)
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
// first line's row), `gutter` its width (0: none), `marginTop` the rows above,
// `keys` a prefix for its Images' and Buttons' keys (several sets in one
// tree), `links` the link rows under the pages (one row each; none drawn
// when the pages take picture select: a click on the picture copies or
// opens them), `id` the drawing's id in drawnAnswers (its pages take
// picture select, its Images swapped by key under the render's requestId:
// blit.ts).
export type PagesLayout = { bullet?: boolean; gutter?: number; marginTop?: number; keys?: string; links?: readonly ShownLink[]; id?: string }

// The bullet's row when the page is drawn `factor` as wide.
export function scaledBulletRow(bulletRow: number, factor: number): number {
  if (factor >= 1) return bulletRow
  return Math.max(0, Math.round((bulletRow + 0.5) * factor - 0.5))
}

// Whether pages drawn in this render take picture select (with their
// Client): from files (not `inline`, as bytes over ssh), in an engine with
// the Client element, and selectOn.
export function takesSelect($: EngineInterface, e: ResolveInput<RenderComponent, 'terminal'> & { viewport?: RenderViewport }, inline?: readonly string[]): boolean {
  const table = uiResolve($, e)
  const Client: typeof table.Client | undefined = table.Client
  return !inline && !!Client && selectOn({ hasClient: true, isFullscreen: e.viewport?.isFullscreen })
}

// The link rows drawn under pages (one each): none when they take picture select.
export const linkRowsOf = (links: readonly ShownLink[] | undefined, isSelect: boolean) => (isSelect ? 0 : (links?.length ?? 0))

// `inline`: each page's PNG as base64 (over ssh); else the terminal reads the
// file. Each page draws at its own box, never stretched. A page wider than
// the room now (an old one in an open epoch) draws smaller to fit, the
// bullet scaled too: the engine shifts a wider Image, it does not clip it.
export function drawPages(
  $: EngineInterface, e: ResolveInput<RenderComponent, 'terminal'> & { viewport?: RenderViewport; requestId?: string }, result: Result, inline?: readonly string[], layout: PagesLayout = {},
) {
  const table = uiResolve($, e)
  const { Box, Text, Image } = table
  // Absent in an engine with no Client element.
  const Client: typeof table.Client | undefined = table.Client
  const gutter = layout.gutter ?? GUTTER
  const room = roomColumns(e.viewport)
  const first = result.pages[0]
  const factor = first && first.columns > room ? room / first.columns : 1
  const keys = layout.keys ?? ''
  const boxes = result.pages.map(page => fitBox(page, room))
  // Picture select: each page in a Box of its size with the Client that
  // takes the pointer over it, in the flow, pulled up over the page
  // (marginTop): never absolute (the engine moves an absolute Box whose top
  // is above the screen down to row 0, its pointer too). The highlight
  // swaps the Image's picture (blit.ts); the layout stays.
  const id = layout.id
  const isSelect = !!id && !!Client && takesSelect($, e, inline)
  if (isSelect && e.requestId) noteSite(id, e.requestId, keys)
  if (isSelect) keep(clickLinks, id, layout.links ?? [], RESULTS_KEPT)
  return (
    <Box flexDirection="row" marginTop={layout.marginTop ?? MARGIN_TOP}>
      {gutter > 0 ? (
        <Box width={gutter} flexShrink={0} marginTop={scaledBulletRow(result.bulletRow, factor)}>
          <Text>{layout.bullet ? bulletOf(S.env?.isMac ?? true) : ' '}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" flexShrink={0}>
        {result.pages.map((page, i) => {
          const box = boxes[i]!
          const shrunk = box.columns !== page.columns
          const image = (
            <Image
              key={`${keys}p${i}`}
              source={inline ? { png: inline[i]! } : { file: page.file, format: 'png', ...(shrunk ? { generation: box.columns * 1000 + box.rows } : {}) }}
              columns={box.columns}
              rows={box.rows}
              alt={page.alt}
            />
          )
          if (!isSelect || !Client || !id) return image
          return (
            <Box key={`${keys}w${i}`} flexDirection="column" width={box.columns} height={box.rows} flexShrink={0}>
              {image}
              <Box key={`${keys}c${i}`} marginTop={-box.rows} width={box.columns} height={box.rows} flexShrink={0}>
                <Client key={`${keys}sel${i}`} module="../sel.tsx" width={box.columns} height={box.rows} props={{ id, page: i }} />
              </Box>
            </Box>
          )
        })}
        {result.note ? <Text dimColor wrap="truncate-end">Typst error: {result.note}</Text> : null}
        {layout.links?.length && !isSelect ? drawLinks($, e, layout.links, keys) : null}
      </Box>
    </Box>
  )
}

// ---- Links ------------------------------------------------------------------
// A click on a picture cannot open a link (an Image is a leaf: no Link holds
// it, and a press on it gives no cell). So the links, file paths and commands
// of a text are drawn under its pages, one row each; where the pages take
// picture select, its Client finds them on the picture (targets.ts) instead.

// A link row: a web link, a file found (`path` its absolute path, `href` its
// file:// URL), or a command.
export type ShownLink = Exclude<LinkItem, { kind: 'file' }> | { kind: 'file'; label: string; path: string; href: string }

// The file:// URL of an absolute path, percent-encoded (`#` and `?` too).
export const fileHref = (path: string) => `file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`

// The items as link rows: each file path made absolute from `base` (the
// folder relative paths start from; `~/` is the home folder) and kept only
// when it is a file now (each path checked once: linkFiles).
export async function resolveLinks($: EngineInterface, items: readonly LinkItem[], base: string, home = S.env?.home ?? ''): Promise<ShownLink[]> {
  const shown: ShownLink[] = []
  for (const item of items) {
    if (item.kind !== 'file') {
      shown.push(item)
      continue
    }
    const path = home && item.path.startsWith('~/') ? `${home.replace(/\/+$/, '')}${item.path.slice(1)}` : imagePathOf(item.path, base)
    let isFile = linkFiles.get(path)
    if (isFile === undefined) {
      isFile = await fsExists($, path).catch(() => false)
      keep(linkFiles, path, isFile, LINK_FILES_KEPT)
    }
    if (isFile) shown.push({ kind: 'file', label: item.label, path, href: fileHref(path) })
  }
  return shown
}

// The link rows of a Markdown text (`base` as resolveLinks); none when it
// cannot be read for them.
export async function linksFor($: EngineInterface, text: string, base: string): Promise<ShownLink[]> {
  try {
    return await resolveLinks($, linksOf(text), base)
  } catch {
    return []
  }
}

// Copies a command at a press of its row, with a toast.
async function copyCommand($: EngineInterface, text: string, surface: RenderSurface) {
  const copied = await uiCopy($, { text, surface }).catch(() => null)
  uiToast($, copied?.isCopied ? 'Copied' : `Could not copy${copied ? `: ${copied.reason}` : ''}`)
}

// One row per link, all dim and cut at the row's end (the copy counts them
// as one row each): a web link (its URL after it when the label is not the
// URL), a file, or a command as a Button that copies it.
export function drawLinks($: EngineInterface, e: ResolveInput<RenderComponent, 'terminal'>, links: readonly ShownLink[], keys: string) {
  const { Box, Text, Link, Button } = uiResolve($, e)
  return links.map(link => {
    if (link.kind === 'command') {
      const { text } = link
      return (
        <Box height={1} overflow="hidden">
          <Button key={`${keys}link-${hashOf([text]).slice(0, 8)}`} plain dimColor onPress={press => void copyCommand($, text, press.surface)}>
            <Text wrap="truncate-end">$ {link.label}</Text>
          </Button>
        </Box>
      )
    }
    const href = link.href
    return (
      <Text dimColor wrap="truncate-end">
        ↗ <Link href={href}>{link.label}</Link>
        {link.kind === 'web' && link.label !== href ? `  ${href}` : null}
      </Text>
    )
  })
}
