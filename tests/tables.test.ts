import { expect, test } from 'claude-code/testing'

import { placeFirstLine } from '../hooks/lib/draw'
import { DEFAULT_GRID, gridFirstRow, gridOf } from '../hooks/lib/grid'
import { TABLE_DRAWN, TABLE_GRID, TABLE_MD, TABLE_OFF_GRID, TABLE_ROW, type TableDrawn } from './table-fixture'

// The row of a word's ink centre (its line box is centred on its ink).
const rowOf = (w: { y: number; h: number }) => Math.floor((w.y + w.h / 2) / TABLE_ROW)
// The text rows of a table, top to bottom.
const textRows = (d: TableDrawn) => [...new Set(d.words.map(rowOf))]
// The header cells (one word each) and the cells of the first body row
// (four words each), as [left, right] in pt.
const headers = (d: TableDrawn) => d.words.slice(0, 4).map(w => [w.x, w.x + w.w])
const cells = (d: TableDrawn) => [0, 1, 2, 3].map(i => {
  const ws = d.words.slice(4 + 4 * i, 8 + 4 * i)
  return [ws[0]!.x, ws[3]!.x + ws[3]!.w]
})
// The grid numbers of the fixture's themes.
const RULES_GRID = gridOf(TABLE_GRID.vscode)!
const GRID_GRID = gridOf(TABLE_GRID['claude-code'])!

test('table.style: vscode and vscode-modern draw "rules"; claude-code draws "grid", with twice the padding', () => {
  expect(gridOf(TABLE_GRID.vscode)).toEqual(DEFAULT_GRID)
  expect(gridOf(TABLE_GRID['vscode-modern'])).toEqual(DEFAULT_GRID)
  const grid = gridOf(TABLE_GRID['claude-code'])!
  expect(grid.tableStyle).toBe('grid')
  expect(Math.abs(grid.pad.table - 2 * DEFAULT_GRID.pad.table)).toBeLessThan(0.001)
  expect({ ...grid, pad: DEFAULT_GRID.pad, tableStyle: 'rules' }).toEqual(DEFAULT_GRID)
})

test('a "rules" table (vscode): a rule under the header and between the rows, no column rules and no box', () => {
  const d = TABLE_DRAWN.vscode
  expect(d.rules[0]).toEqual([null, null, null, null])
  for (const [y, colour] of [[1, '#ffffffb0'], [2, '#ffffff2e']] as const) {
    for (const rule of d.rules[y]!) expect(rule).toEqual({ top: `0.79pt + rgb("${colour}")` })
  }
  // No box: the lines are on rows 0, 1 and 2, and the page is those 3 rows.
  expect(textRows(d)).toEqual([0, 1, 2])
  expect(d.rows).toBe(3)
})

test('a "grid" table (claude-code): thin rules between all rows and columns, in a box', () => {
  const d = TABLE_DRAWN['claude-code']
  const line = '0.79pt + rgb("#888888")'
  d.rules.forEach((row, y) => row.forEach((rule, x) => expect(rule).toEqual({ left: x > 0 ? line : null, top: y > 0 ? line : null })))
  // Each rule in the middle of a row: one row between the lines, and half a
  // row of padding and half a row around the box above the first line and
  // under the last.
  expect(textRows(d)).toEqual([1, 3, 5])
  expect(d.rows).toBe(7)
})

test('each column, its header too, has the alignment of the delimiter row: :--- left, :---: centre, ---: right, --- left', () => {
  for (const d of Object.values(TABLE_DRAWN)) {
    const [h, c] = [headers(d), cells(d)]
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.05)
    near(h[0]![0]!, c[0]![0]!)
    near((h[1]![0]! + h[1]![1]!) / 2, (c[1]![0]! + c[1]![1]!) / 2)
    near(h[2]![1]!, c[2]![1]!)
    near(h[3]![0]!, c[3]![0]!)
  }
})

test('with the row grid, the bullet of a page that starts with a table is on its first line\'s row, in both styles', () => {
  for (const [d, metrics, row] of [[TABLE_DRAWN.vscode, RULES_GRID, 0], [TABLE_DRAWN['claude-code'], GRID_GRID, 1]] as const) {
    expect(rowOf(d.words[0]!)).toBe(row)
    expect(placeFirstLine(TABLE_MD, TABLE_ROW, { metrics, code: 0.8784 })).toEqual({ topPt: 0, bulletRow: row })
  }
  // "grid": the padding rounds to whole rows and a half (at least half a row).
  expect(gridFirstRow('table', 0, 10, { ...GRID_GRID, body: 9, pad: { ...GRID_GRID.pad, table: 0 } }, 1)).toBe(1)
  expect(gridFirstRow('table', 0, 10, { ...GRID_GRID, body: 9, pad: { ...GRID_GRID.pad, table: 9 } }, 1)).toBe(1)
  expect(gridFirstRow('table', 0, 10, { ...GRID_GRID, body: 9, pad: { ...GRID_GRID.pad, table: 11 } }, 1)).toBe(2)
})

test('with the row grid off, the first line of a page that starts with a table is centred on the bullet row, in both styles', () => {
  const rowsPt = [16, 13.091, 11.6331, 8.7273]
  const rules = rowsPt.map(rowPt => placeFirstLine(TABLE_MD, rowPt, undefined, RULES_GRID))
  const boxed = rowsPt.map(rowPt => placeFirstLine(TABLE_MD, rowPt, undefined, GRID_GRID))
  // vscode: the margin and row of before.
  expect(rules).toEqual(rowsPt.map(rowPt => placeFirstLine(TABLE_MD, rowPt)))
  expect(rules).toEqual([{ topPt: -3.27, bulletRow: 0 }, { topPt: -4.72, bulletRow: 0 }, { topPt: -5.45, bulletRow: 0 }, { topPt: 1.82, bulletRow: 1 }])
  // claude-code: a margin over 0 keeps the box's top rule in the picture.
  expect(boxed).toEqual([{ topPt: 8.8, bulletRow: 1 }, { topPt: 4.44, bulletRow: 1 }, { topPt: 2.25, bulletRow: 1 }, { topPt: 6.62, bulletRow: 2 }])
  // Its first line is as far from its bullet row's centre as vscode's (on it).
  const fromCentre = (w: { y: number; h: number }, p: { topPt: number; bulletRow: number }, rowPt: number) =>
    w.y + w.h / 2 + p.topPt - (p.bulletRow + 0.5) * rowPt
  rowsPt.forEach((rowPt, i) => {
    const off = fromCentre(TABLE_OFF_GRID['claude-code'], boxed[i]!, rowPt) - fromCentre(TABLE_OFF_GRID.vscode, rules[i]!, rowPt)
    expect(Math.abs(off)).toBeLessThan(0.02)
  })
})
