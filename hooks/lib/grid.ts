// The row grid (`/iui grid on`): the row of a page's first line, from the
// numbers the template lays it out with, for the reply bullet.
import type { FirstLine } from './draw'
import { BODY_PT } from './settings'

// render/measure.typ `grid` (pt): the height a line box of the body and of
// h1 to h6 needs, the same per pt of the code size, the code size in body
// text (null: the `code` input), the padding over a first line and the
// theme's table.style.
export type GridMetrics = {
  body: number
  heading: number[]
  code: number
  codeSize: number | null
  pad: { quote: number; code: number; table: number }
  tableStyle: 'rules' | 'grid'
}
// Measured with Typst on macOS: SF Pro Text and Menlo, the vscode values.
export const DEFAULT_GRID: GridMetrics = {
  body: 11.2836,
  heading: [31.8046, 20.4458, 14.1985, 11.3588, 9.9389, 9.655],
  code: 1.0775,
  codeSize: 1,
  pad: { quote: 6.05, code: 12.5714, table: 3.9286 },
  tableStyle: 'rules',
}

// measure.typ's `grid` as GridMetrics; null when it is not one.
export function gridOf(v: unknown): GridMetrics | null {
  const g = v as Record<string, unknown> | null
  const pad = g?.pad as Record<string, unknown> | undefined
  const pt = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0
  const size = g?.['code-size']
  const style = g?.['table-style']
  if (
    !g || !pt(g.body) || !pt(g.code) || !Array.isArray(g.heading) || g.heading.length !== 6 || !g.heading.every(pt)
    || !(size === null || (pt(size) && (size as number) > 0)) || !pad || !pt(pad.quote) || !pt(pad.code) || !pt(pad.table)
    || (style !== 'rules' && style !== 'grid')
  ) return null
  return {
    body: g.body as number, heading: g.heading as number[], code: g.code as number, codeSize: size as number | null,
    pad: { quote: pad.quote as number, code: pad.code as number, table: pad.table as number }, tableStyle: style,
  }
}

// The template's rounding: grid-edges and rows-near in render/md.typ.
export const gridRowsOf = (needPt: number, rowPt: number) => Math.max(1, Math.ceil(needPt / rowPt - 0.001))
const rowsNear = (pt: number, rowPt: number) => Math.round(pt / rowPt)

// The row of the ink centre of a page's first line: its padding in whole
// rows, then row floor(n / 2) of its line box of n rows (an even box is half
// a row down, so its centre is in row n / 2). When a line of body text is an
// even number of rows, the page starts half a row down; code lines of an odd
// number of rows are then half a row down in it, one row more (a heading's
// line box starts the page). `level`: a heading's (1 to 6); `code`: the
// job's code input. A list is a `para`: body lines. A "grid" table: its
// padding in whole rows and a half, and half a row above its box.
export function gridFirstRow(kind: FirstLine, level: number, rowPt: number, g: GridMetrics, code: number): number {
  const middle = (needPt: number) => Math.floor(gridRowsOf(needPt, rowPt) / 2)
  const body = middle(g.body)
  switch (kind) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
      return middle(g.heading[level - 1] ?? g.body)
    case 'quote':
      return rowsNear(g.pad.quote, rowPt) + body
    case 'code': {
      const n = gridRowsOf(g.code * BODY_PT * (g.codeSize ?? code), rowPt)
      const half = gridRowsOf(g.body, rowPt) % 2 === 0
      return rowsNear(g.pad.code, rowPt) + Math.floor(n / 2) + (half && n % 2 === 1 ? 1 : 0)
    }
    case 'table':
      if (g.tableStyle === 'grid') return rowsNear(Math.max(0, g.pad.table - rowPt / 2), rowPt) + 1 + body
      return rowsNear(g.pad.table, rowPt) + body
    default:
      return body
  }
}
