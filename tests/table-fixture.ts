// A real table: render/md.typ's words and rules for TABLE_MD, with the row
// grid, at 98 columns of a 16 x 32 px cell (width 570.02 pt, ppi 198.0562,
// row 11.6331 pt, code 0.8784, no term-font), dark, in the vscode theme
// ("rules") and the claude-code theme ("grid"). `rows`: the PNG's height in
// rows. To make it again (after a template change), with doc.json
// {"base": "/tmp", "segments": [TABLE_MD], "images": []} and
// IN="--input theme=dark --input width=570.02 --input top=0
// --input row=11.6331 --input grid=1 --input code=0.8784
// --input theme-dir=$PWD/render/themes/<theme> --input doc=$PWD/doc.json":
//   typst compile --root / --package-path render/packages --format png \
//     --ppi 198.0562 $IN render/md.typ 'a-{0p}.png'      # rows: height / 32
//   typst eval --root / --package-path render/packages $IN --input probe=1 \
//     '(words: query(<mdpos>).map(m => m.value).filter(m => m.k == "w")
//       .map(m => (t: m.t, x: calc.round(m.x, digits: 2), y: calc.round(m.y, digits: 2),
//       w: calc.round(m.w, digits: 2), h: calc.round(m.h, digits: 2))),
//       rules: range(3).map(y => range(4).map(x => (query(table).first().stroke)(x, y))))' \
//     --in render/md.typ                                 # words, rules
// `rules[y][x]`: the table's stroke of cell (x, y).
export const TABLE_MD = '| L | C | R | P |\n|:---|:---:|---:|---|\n| a long left cell | a long centre cell | a long right cell | a long plain cell |\n| 1 | 2 | 3 | 4 |\n'
export const TABLE_ROW = 11.6331

// The font measure's `grid` of each theme (rounded), the hooks module's
// numbers for the bullet row:
//   typst eval 'query(<m>).first().value.grid' --in render/measure.typ \
//     --root / --input term-font= --input theme-dir=$PWD/render/themes/<theme>
const measured = (table: number, style: string) => ({
  body: 11.2836, heading: [31.8046, 20.4458, 14.1985, 11.3588, 9.9389, 9.655], code: 1.0775, 'code-size': 1,
  pad: { quote: 6.05, code: 12.5714, table }, 'table-style': style,
})
export const TABLE_GRID: Record<'vscode' | 'vscode-modern' | 'claude-code', unknown> = {
  vscode: measured(3.9286, 'rules'),
  'vscode-modern': measured(3.9286, 'rules'),
  'claude-code': measured(7.8571, 'grid'),
}

// The row grid off (IN without --input grid=1): the top-left word's y and
// h, as in TABLE_DRAWN. claude-code's line is lower by its padding (10 px,
// not 5 px); its box changes no layout.
//   typst eval --root / --package-path render/packages $IN --input probe=1 \
//     'query(<mdpos>).map(m => m.value).filter(m => m.k == "w").first()' --in render/md.typ
export const TABLE_OFF_GRID: Record<'vscode' | 'claude-code', { y: number; h: number }> = {
  vscode: { y: 3.93, h: 13.13 },
  'claude-code': { y: 7.86, h: 13.13 },
}

type Word = { t: string; x: number; y: number; w: number; h: number }
type Rule = { left?: string | null; top: string | null } | null
export type TableDrawn = { rows: number; words: Word[]; rules: Rule[][] }

const vscodeTh = '0.79pt + rgb("#ffffffb0")'
const vscodeBorder = '0.79pt + rgb("#ffffff2e")'
const claudeLine = '0.79pt + rgb("#888888")'

export const TABLE_DRAWN: Record<'vscode' | 'claude-code', TableDrawn> = {
  vscode: {
    rows: 3,
    words: [
      {"t":"L","x":7.86,"y":0.0,"w":6.54,"h":11.63},{"t":"C","x":136.76,"y":0.0,"w":8.15,"h":11.63},{"t":"R","x":273.21,"y":0.0,"w":7.64,"h":11.63},{"t":"P","x":296.56,"y":0.0,"w":7.41,"h":11.63},
      {"t":"a","x":7.86,"y":11.63,"w":6.07,"h":11.63},{"t":"long","x":17.02,"y":11.63,"w":22.4,"h":11.63},{"t":"left","x":42.52,"y":11.63,"w":17.04,"h":11.63},{"t":"cell","x":62.65,"y":11.63,"w":18.0,"h":11.63},
      {"t":"a","x":96.37,"y":11.63,"w":6.07,"h":11.63},{"t":"long","x":105.53,"y":11.63,"w":22.4,"h":11.63},{"t":"centre","x":131.03,"y":11.63,"w":33.17,"h":11.63},{"t":"cell","x":167.29,"y":11.63,"w":18.0,"h":11.63},
      {"t":"a","x":201.01,"y":11.63,"w":6.07,"h":11.63},{"t":"long","x":210.17,"y":11.63,"w":22.4,"h":11.63},{"t":"right","x":235.67,"y":11.63,"w":24.08,"h":11.63},{"t":"cell","x":262.84,"y":11.63,"w":18.0,"h":11.63},
      {"t":"a","x":296.56,"y":11.63,"w":6.07,"h":11.63},{"t":"long","x":305.72,"y":11.63,"w":22.4,"h":11.63},{"t":"plain","x":331.22,"y":11.63,"w":24.7,"h":11.63},{"t":"cell","x":359.01,"y":11.63,"w":18.0,"h":11.63},
      {"t":"1","x":7.86,"y":23.27,"w":5.1,"h":11.63},{"t":"2","x":137.51,"y":23.27,"w":6.64,"h":11.63},{"t":"3","x":273.95,"y":23.27,"w":6.9,"h":11.63},{"t":"4","x":296.56,"y":23.27,"w":7.08,"h":11.63},
    ],
    rules: [
      [null, null, null, null],
      [{ top: vscodeTh }, { top: vscodeTh }, { top: vscodeTh }, { top: vscodeTh }],
      [{ top: vscodeBorder }, { top: vscodeBorder }, { top: vscodeBorder }, { top: vscodeBorder }],
    ],
  },
  'claude-code': {
    rows: 7,
    words: [
      {"t":"L","x":7.86,"y":11.63,"w":6.54,"h":11.63},{"t":"C","x":136.76,"y":11.63,"w":8.15,"h":11.63},{"t":"R","x":273.21,"y":11.63,"w":7.64,"h":11.63},{"t":"P","x":296.56,"y":11.63,"w":7.41,"h":11.63},
      {"t":"a","x":7.86,"y":34.9,"w":6.07,"h":11.63},{"t":"long","x":17.02,"y":34.9,"w":22.4,"h":11.63},{"t":"left","x":42.52,"y":34.9,"w":17.04,"h":11.63},{"t":"cell","x":62.65,"y":34.9,"w":18.0,"h":11.63},
      {"t":"a","x":96.37,"y":34.9,"w":6.07,"h":11.63},{"t":"long","x":105.53,"y":34.9,"w":22.4,"h":11.63},{"t":"centre","x":131.03,"y":34.9,"w":33.17,"h":11.63},{"t":"cell","x":167.29,"y":34.9,"w":18.0,"h":11.63},
      {"t":"a","x":201.01,"y":34.9,"w":6.07,"h":11.63},{"t":"long","x":210.17,"y":34.9,"w":22.4,"h":11.63},{"t":"right","x":235.67,"y":34.9,"w":24.08,"h":11.63},{"t":"cell","x":262.84,"y":34.9,"w":18.0,"h":11.63},
      {"t":"a","x":296.56,"y":34.9,"w":6.07,"h":11.63},{"t":"long","x":305.72,"y":34.9,"w":22.4,"h":11.63},{"t":"plain","x":331.22,"y":34.9,"w":24.7,"h":11.63},{"t":"cell","x":359.01,"y":34.9,"w":18.0,"h":11.63},
      {"t":"1","x":7.86,"y":58.17,"w":5.1,"h":11.63},{"t":"2","x":137.51,"y":58.17,"w":6.64,"h":11.63},{"t":"3","x":273.95,"y":58.17,"w":6.9,"h":11.63},{"t":"4","x":296.56,"y":58.17,"w":7.08,"h":11.63},
    ],
    rules: [
      [{ left: null, top: null }, { left: claudeLine, top: null }, { left: claudeLine, top: null }, { left: claudeLine, top: null }],
      [{ left: null, top: claudeLine }, { left: claudeLine, top: claudeLine }, { left: claudeLine, top: claudeLine }, { left: claudeLine, top: claudeLine }],
      [{ left: null, top: claudeLine }, { left: claudeLine, top: claudeLine }, { left: claudeLine, top: claudeLine }, { left: claudeLine, top: claudeLine }],
    ],
  },
}
