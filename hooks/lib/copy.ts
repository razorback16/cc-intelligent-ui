// Copy (pure): the text under a mouse selection of answer pictures.
//
// Claude Code draws an Image as kitty Unicode placeholders: each cell is
// U+10EEEE, then the diacritic of its row, then the diacritic of its column
// (indices into DIACRITICS; the image id is only in the cell's colour, so it
// never reaches the clipboard). A mouse copy puts those cells on the
// clipboard, one line per screen row. decodeSelection reads them back as
// runs of (row, columns) per picture; positionsOf turns the template's probe
// marks (render/md.typ, `<mdpos>`) into word boxes (and the boxes of code
// blocks' copy buttons) in PNG pixels; pickPages
// says which drawn page each run is; textOfRun reads the words under a run.
// The drawn pages and the probe of a page are in probe.ts; the clipboard
// watcher (its change counts) and the commands are in register.tsx.

// kitty's rowcolumn-diacritics.txt: 297 combining marks; mark i means row or
// column i. (The same table is in Claude Code's binary.)
export const DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1,
  0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
  0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7, 0x06d8,
  0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e4, 0x06e7, 0x06e8, 0x06eb,
  0x06ec, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073a, 0x073d, 0x073f, 0x0740, 0x0741, 0x0743,
  0x0745, 0x0747, 0x0749, 0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee, 0x07ef, 0x07f0, 0x07f1, 0x07f3,
  0x0816, 0x0817, 0x0818, 0x0819, 0x081b, 0x081c, 0x081d, 0x081e, 0x081f, 0x0820, 0x0821, 0x0822,
  0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a, 0x082b, 0x082c, 0x082d, 0x0951, 0x0953, 0x0954,
  0x0f82, 0x0f83, 0x0f86, 0x0f87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75, 0x1a76,
  0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d, 0x1b6e, 0x1b6f, 0x1b70, 0x1b71,
  0x1b72, 0x1b73, 0x1cd0, 0x1cd1, 0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4,
  0x1dc5, 0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb, 0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5,
  0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb, 0x1ddc, 0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1,
  0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe, 0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7,
  0x20db, 0x20dc, 0x20e1, 0x20e7, 0x20e9, 0x20f0, 0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2,
  0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8, 0x2de9, 0x2dea, 0x2deb, 0x2dec, 0x2ded, 0x2dee,
  0x2def, 0x2df0, 0x2df1, 0x2df2, 0x2df3, 0x2df4, 0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa,
  0x2dfb, 0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f, 0xa67c, 0xa67d, 0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1,
  0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5, 0xa8e6, 0xa8e7, 0xa8e8, 0xa8e9, 0xa8ea, 0xa8eb, 0xa8ec, 0xa8ed,
  0xa8ee, 0xa8ef, 0xa8f0, 0xa8f1, 0xaab0, 0xaab2, 0xaab3, 0xaab7, 0xaab8, 0xaabe, 0xaabf, 0xaac1,
  0xfe20, 0xfe21, 0xfe22, 0xfe23, 0xfe24, 0xfe25, 0xfe26, 0x10a0f, 0x10a38, 0x1d185, 0x1d186, 0x1d187,
  0x1d188, 0x1d189, 0x1d1aa, 0x1d1ab, 0x1d1ac, 0x1d1ad, 0x1d242, 0x1d243, 0x1d244,
]
export const PLACEHOLDER = 0x10eeee
const INDEX = new Map(DIACRITICS.map((cp, i) => [cp, i]))

// The cell string Claude Code draws at (row, col): for the tests.
export const placeholderCell = (row: number, col: number) =>
  String.fromCodePoint(PLACEHOLDER, DIACRITICS[row]!, DIACRITICS[col]!)

export const hasPlaceholders = (text: string) => text.includes(String.fromCodePoint(PLACEHOLDER))

// One screen row of a picture in the selection: its row in the picture and
// the first and last picture columns selected (inclusive).
export type RunLine = { row: number; colStart: number; colEnd: number }
// The selection in order: plain text lines, and runs of picture rows (one
// picture's rows, top to bottom).
export type Segment = { kind: 'text'; text: string } | { kind: 'image'; lines: RunLine[] }

// The reply bullet and the gutter's spaces left of a picture.
const GUTTER = /^[\s⏺●]*$/

// The selection's text as segments. A run ends where a row does not follow
// the one above (the next picture, or the next page of the same answer,
// starts again at row 0) or where a line has no placeholder.
export function decodeSelection(text: string): Segment[] {
  const out: Segment[] = []
  let run: RunLine[] | null = null
  const addText = (line: string) => {
    run = null
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += `\n${line}`
    else out.push({ kind: 'text', text: line })
  }
  for (const line of text.split(/\r?\n/)) {
    const cps = Array.from(line, c => c.codePointAt(0)!)
    const cells: { row: number; col: number }[] = []
    let other = ''
    for (let i = 0; i < cps.length; i++) {
      if (cps[i] !== PLACEHOLDER) {
        other += String.fromCodePoint(cps[i]!)
        continue
      }
      const row = INDEX.get(cps[i + 1] ?? -1)
      const col = INDEX.get(cps[i + 2] ?? -1)
      if (row === undefined) continue
      i += col === undefined ? 1 : 2
      // No column mark: the cell after the one before (kitty's rule).
      const prev = cells[cells.length - 1]
      cells.push({ row, col: col ?? (prev && prev.row === row ? prev.col + 1 : 0) })
    }
    if (!cells.length) {
      addText(line)
      continue
    }
    if (!GUTTER.test(other)) addText(other.trim())
    const row = cells[0]!.row
    const cols = cells.filter(c => c.row === row).map(c => c.col)
    const at: RunLine = { row, colStart: Math.min(...cols), colEnd: Math.max(...cols) }
    const open = run as RunLine[] | null
    if (open && open[open.length - 1]!.row < row) open.push(at)
    else {
      run = [at]
      out.push({ kind: 'image', lines: run })
    }
  }
  // A selection's last line break gives an empty last line: not text.
  const last = out[out.length - 1]
  if (last?.kind === 'text') {
    last.text = last.text.replace(/\n+$/, '')
    if (!last.text) out.pop()
  }
  return out
}

// ---- Where the words are ---------------------------------------------------

// A probe mark as `typst query <mdpos> --field value` gives it (pt).
// `t`: a tag that is no word (kind `copy`: a code block's copy button, its
// box, the whole `code` and its `lang`).
export type Mark = {
  k: 'w' | 'c' | 'b' | 't'
  p: number
  x: number
  y: number
  s?: number
  t?: string
  w?: number
  h?: number
  n?: number
  a?: number
  d?: number
  kind?: string
  prefix?: string
  cx?: number
  g?: number
  pad?: number
  href?: string
  code?: string
  lang?: string
}
// A word, or a whole code line (`adv`: its character advance), in PNG
// pixels: its box, the block it is in, and its place in the document (`i`).
// `glued`: a character of a long word or of CJK text after the first (it
// joins the one before with no space). A word's `em` is its text size and
// `pad` the padding beside inline code (a word of it), in pixels. `href`: the
// URL of the link it is in; `code`: the whole text of the inline code it is in.
export type Item = {
  i: number; text: string; x0: number; y0: number; x1: number; y1: number; block: number; adv?: number; glued?: boolean; em?: number; pad?: number
  href?: string; code?: string
}
// A block: paragraph, heading, code, quote, cell (`cx` its column), item
// (`prefix`, and `mx` the x of its marker's centre in pixels, on its first
// word's line); `first` its first item.
export type TextBlock = { kind: string; prefix: string; cx?: number; mx?: number; first: number }
// A code block's copy button in PNG pixels: its box, its code and language.
export type Button = { x0: number; y0: number; x1: number; y1: number; code: string; lang?: string }
// A probe's words by page (0-based: PNG page N+1), its blocks, and its
// copy buttons by page.
export type Positions = { ppi: number; blocks: TextBlock[]; pages: Item[][]; buttons: Button[][] }

const round = (n: number) => Math.round(n * 100) / 100
// The break chances the template adds (a zws in a long word), the strut
// before inline code (a zwj) and other marks that draw nothing.
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g

// A list's marker ("-", "1.") is drawn just before its item's mark: the
// item's prefix says it. It is the word before an item mark that is the
// prefix's first word, or that is left of the item's first word on its line
// (another theme's marker, a numbering of its own). The last word of a
// paragraph before a list is on a line above.
function isMarker(marks: readonly Mark[], j: number): boolean {
  const m = marks[j]!
  const next = marks[j + 1]
  if (m.k !== 'w' || next?.k !== 'b' || next.kind !== 'item') return false
  if (next.prefix?.trim().split(' ')[0] === m.t) return true
  const body = marks.slice(j + 2).find(x => x.k !== 'b' && x.k !== 't')
  return !!body && body.p === m.p && body.x > m.x && Math.abs(body.y - m.y) < (m.h ?? m.s ?? 11) / 2
}

// The probe's marks (document order) as boxes in pixels at `ppi`. A list's
// marker is dropped (isMarker), its centre kept as its item's `mx` (a
// checkbox drawn as a shape: 0.8 of the text size left of the item). A block mark with no word since the last one
// (an item, then its paragraph) adds to that block. A word of only
// invisible characters is dropped. A link's URL and an inline code's text go
// to its words. A copy tag is a button, not a word (no block, no text); its
// code less one line break at its end (a paste does not run it at once).
export function positionsOf(marks: readonly Mark[], ppi: number): Positions {
  const k = ppi / 72
  const blocks: TextBlock[] = []
  const pages: Item[][] = []
  const buttons: Button[][] = []
  let hasItems = false
  let count = 0
  marks.forEach((m, j) => {
    if (m.k === 't') {
      if (m.kind !== 'copy' || typeof m.code !== 'string') return
      const page = Math.max(0, m.p - 1)
      while (buttons.length <= page) buttons.push([])
      buttons[page]!.push({
        x0: round(m.x * k), y0: round(m.y * k), x1: round((m.x + (m.w ?? 0)) * k), y1: round((m.y + (m.h ?? 0)) * k), code: m.code.replace(/\r?\n$/, ''),
        ...(m.lang ? { lang: m.lang } : {}),
      })
      return
    }
    if (m.k === 'b') {
      const cur = blocks[blocks.length - 1]
      const before = marks[j - 1]
      const mx =
        m.kind !== 'item' ? undefined
        : before && isMarker(marks, j - 1) ? round((before.x + (before.w ?? 0) / 2) * k)
        : round(Math.max(0, m.x - 0.8 * (m.s ?? 11)) * k)
      if (cur && !hasItems) {
        if (!cur.prefix && m.prefix) Object.assign(cur, { prefix: m.prefix }, mx === undefined ? {} : { mx })
        if (m.kind === 'cell') Object.assign(cur, { kind: 'cell', cx: m.cx ?? 0 })
        else if (cur.kind !== 'item' && cur.kind !== 'cell') cur.kind = m.kind ?? cur.kind
      } else {
        blocks.push({ kind: m.kind ?? 'par', prefix: m.prefix ?? '', ...(m.kind === 'cell' ? { cx: m.cx ?? 0 } : {}), ...(mx === undefined ? {} : { mx }), first: -1 })
        hasItems = false
      }
      return
    }
    if (isMarker(marks, j)) return
    if (!blocks.length) blocks.push({ kind: 'par', prefix: '', first: -1 })
    const block = blocks.length - 1
    const item: Item =
      m.k === 'c'
        ? {
            i: count, text: (m.t ?? '').replace(INVISIBLE, ''), block, x0: round(m.x * k), x1: round((m.x + (m.w ?? 0)) * k),
            y0: round((m.y - (m.a ?? 0.8 * (m.s ?? 11))) * k), y1: round((m.y + (m.d ?? 0.25 * (m.s ?? 11))) * k),
            adv: m.n ? ((m.w ?? 0) * k) / m.n : 0,
          }
        : {
            i: count, text: (m.t ?? '').replace(INVISIBLE, ''), block, x0: round(m.x * k), x1: round((m.x + (m.w ?? 0)) * k),
            y0: round(m.y * k), y1: round((m.y + (m.h ?? m.s ?? 11)) * k), ...(m.g ? { glued: true } : {}),
            ...(m.s ? { em: round(m.s * k) } : {}), ...(m.pad ? { pad: round(m.pad * k) } : {}),
            ...(m.href ? { href: m.href } : {}), ...(m.code ? { code: m.code } : {}),
          }
    if (!item.text) return
    count++
    if (!hasItems) blocks[block]!.first = item.i
    hasItems = true
    const page = Math.max(0, m.p - 1)
    while (pages.length <= page) pages.push([])
    pages[page]!.push(item)
  })
  return { ppi, blocks, pages, buttons }
}

// ---- Which page a run is ---------------------------------------------------

// A page drawn this session: its PNG size and the box its Image takes as
// drawn (fitBox: an old page in an open epoch draws smaller than it was
// compiled for). The placeholders count the cells of that box.
export type DrawnPage = { file: string; width: number; height: number; columns: number; rows: number }
// The rows of a drawing's transcript message on screen at its last draw
// (e.props.onScreen on the terminal): rows `first` to `last` of its `of`,
// from the first row of the tree the hook drew.
export type OnScreen = { first: number; last: number; of: number }
// Where a drawing's pages sit in their message: `below` the rows under the
// last page (a Typst error line, a sent file's pictures after it); `top` the
// rows the layout puts above the first page (an answer's top margin), absent
// when the engine's row of its own height is above (a plan, a sent file).
export type Place = { top?: number; below: number }
// An answer drawn this session (`seq` grows with each new one); `dir` its
// key folder. A plan is `plan:<tool_use_id>`, a Markdown file Claude sent
// `file:<tool_use_id>:<path>`. `onScreen` its message's rows on screen
// (null: drawn outside the viewport; absent: not known), `place` where its
// pages are in them.
export type Drawn = { id: string; seq: number; dir: string; pages: DrawnPage[]; place?: Place; onScreen?: OnScreen | null }
export type Pick = { id: string; page: number } | null

// e.props.onScreen as an OnScreen: null when drawn outside the viewport,
// undefined when the surface does not say (or it is not one).
export function screenOf(v: unknown): OnScreen | null | undefined {
  if (v === null) return null
  const o = v as Partial<OnScreen> | undefined
  return o && typeof o.first === 'number' && typeof o.last === 'number' && typeof o.of === 'number' ? { first: o.first, last: o.last, of: o.of } : undefined
}

// The row of its message each page of `d` starts at, by its last onScreen.
// The pages are the last rows of the tree but `below`, at their drawn rows
// (DrawnPage.rows, as drawPages draws them), so the first page's top is
// `of - below - (their rows)`: exact for the layout `of` was counted on,
// with no row of tolerance needed. That top is under 0, or over place.top
// (an answer's top margin; 0 is taken too, as the root Box's margin may be
// outside the rows the engine counts), when `of` is of another layout (the
// row drawn as text before, a page drawn at another size): not known then.
// Undefined: not known; null: drawn outside the viewport.
export function pageTopsOf(d: Drawn): number[] | null | undefined {
  if (d.onScreen === null) return null
  if (!d.onScreen || !d.place) return undefined
  let at = d.onScreen.of - d.place.below - d.pages.reduce((sum, p) => sum + p.rows, 0)
  if (at < 0 || (d.place.top !== undefined && at > d.place.top)) return undefined
  return d.pages.map(p => (at += p.rows) - p.rows)
}

// Whether a drawing is the one of the transcript row `requestId` (a
// selection's row): an answer by its own id, a plan or a sent file by the
// call's tool_use_id.
export const isDrawnIn = (id: string, requestId: string) =>
  id === requestId || id === `plan:${requestId}` || id.startsWith(`file:${requestId}:`)

// For each segment, the drawn page its run is (null: text, or none fits).
// Runs next to each other (no text between) are one picture after the other,
// so consecutive pages of one answer: a run that goes on in the next must
// end on its page's last row, and the next start at row 0.
//
// The clipboard has only the row and column of each cell, not the page: a
// run inside one page of a many-page answer fits every page tall enough.
// A mouse selection is on screen when it is copied, so a placement is kept
// only when one of its runs' rows (its page's top, pageTopsOf, plus the
// run's rows) is in its message's rows on screen; a drawing outside the
// viewport has none. A drawing with no known rows on screen keeps all its
// placements, as before. A chain goes to the drawing of `requestId` (the
// selection's transcript row, isDrawnIn) when it fits there: its first
// placement on screen, else its first (the row is surer than rows on
// screen that can be out of date). Else to the newest drawing with a
// placement on screen, else to the newest it fits, as before. Two
// placements on screen at once are only possible with a page shorter than
// the viewport (or two drawings at the same width on screen): the first by
// that order (in a drawing, the first page) is taken.
export function pickPages(segments: readonly Segment[], drawn: readonly Drawn[], requestId?: string): Pick[] {
  const picks: Pick[] = segments.map(() => null)
  const mine = (d: Drawn) => requestId !== undefined && isDrawnIn(d.id, requestId)
  const newest = [...drawn].sort((a, b) => b.seq - a.seq)
  const mineFirst = newest.filter(mine)
  const others = newest.filter(d => !mine(d))
  const tops = new Map(drawn.map(d => [d.id, pageTopsOf(d)]))
  let i = 0
  while (i < segments.length) {
    if (segments[i]!.kind !== 'image') {
      i++
      continue
    }
    let j = i
    while (j < segments.length && segments[j]!.kind === 'image') j++
    const runs = segments.slice(i, j) as { kind: 'image'; lines: RunLine[] }[]
    const fits = (d: Drawn, start: number) =>
      runs.every((run, n) => {
        const page = d.pages[start + n]
        if (!page) return false
        const rows = run.lines.map(l => l.row)
        const maxRow = Math.max(...rows)
        const maxCol = Math.max(...run.lines.map(l => l.colEnd))
        if (maxRow >= page.rows || maxCol >= page.columns) return false
        if (n > 0 && Math.min(...rows) !== 0) return false
        return n === runs.length - 1 || maxRow === page.rows - 1
      })
    const onScreen = (d: Drawn, start: number) => {
      const at = tops.get(d.id)
      if (at === undefined) return true
      const view = d.onScreen
      if (!at || !view) return false
      return runs.some((run, n) => {
        const rows = run.lines.map(l => at[start + n]! + l.row)
        return Math.min(...rows) <= view.last && Math.max(...rows) >= view.first
      })
    }
    const place = (order: readonly Drawn[], seen: boolean) => {
      for (const d of order) {
        for (let start = 0; start + runs.length <= d.pages.length; start++) {
          if (!fits(d, start) || (seen && !onScreen(d, start))) continue
          runs.forEach((_, n) => (picks[i + n] = { id: d.id, page: start + n }))
          return true
        }
      }
      return false
    }
    if (!place(mineFirst, true) && !place(mineFirst, false) && !place(others, true)) place(others, false)
    i = j
  }
  return picks
}

// ---- The text under a run --------------------------------------------------

// The words of one page under a run, in reading order. The picture fills
// its drawn box of `columns` x `rows` cells, so a cell is width / columns by
// height / rows PNG pixels (a page drawn smaller has larger cells). A word is under the run when its box's centre is in a selected
// cell (its row by the vertical centre, its column by the horizontal one):
// half a word selected copies the word when the selection covers its middle.
// A code line is cut by characters, each by its own centre. An item's
// prefix is copied only when its marker's centre (`mx`) is selected too.
export function textOfRun(
  lines: readonly RunLine[], items: readonly Item[], blocks: readonly TextBlock[], page: { width: number; height: number; columns: number; rows: number },
): string {
  const colW = page.width / page.columns
  const rowH = page.height / page.rows
  const sel = new Map(lines.map(l => [l.row, l]))
  const lineOf = (item: Item) => sel.get(Math.floor((item.y0 + item.y1) / 2 / rowH))
  const within = (line: RunLine, x: number) => {
    const col = Math.floor(x / colW)
    return col >= line.colStart && col <= line.colEnd
  }
  const picked: { item: Item; text: string }[] = []
  for (const item of items) {
    const line = lineOf(item)
    if (!line) continue
    const inside = (x: number) => within(line, x)
    if (item.adv) {
      const chars = Array.from(item.text)
      const kept = chars.filter((_, c) => inside(item.x0 + (c + 0.5) * item.adv!))
      if (!kept.length) continue
      const first = chars.findIndex((_, c) => inside(item.x0 + (c + 0.5) * item.adv!))
      picked.push({ item, text: chars.slice(first, first + kept.length).join('') })
    } else if (inside((item.x0 + item.x1) / 2)) picked.push({ item, text: item.text })
  }
  const marked = (b: number) => {
    const mx = blocks[b]?.mx
    const first = mx === undefined ? undefined : picked.find(p => p.item.i === blocks[b]!.first)
    const line = first && lineOf(first.item)
    return mx === undefined || (!!line && within(line, mx))
  }
  return joinItems(picked, blocks, marked)
}

// Joins picked words: a new line between blocks (a tab between the cells of
// a table row), a block's prefix when its first word is in, a new line
// between code lines; inside a block a space between words, none between
// the pieces of one word (boxes on one line closer than 0.15 of the text
// size, not counting the padding beside inline code: a space is 0.22-0.32
// of it; none before a glued character that follows the one before it),
// none after a - or / that ends a line. `marked`: whether a block's marker
// is selected (its prefix is copied only then; all when absent). Not of the line height: that is the
// font's (Noto Sans: 1.36 of the size) or the grid's rows. Items with no
// text size: a fifth of the line height.
export function joinItems(
  picked: readonly { item: Item; text: string }[], blocks: readonly TextBlock[], marked: (block: number) => boolean = () => true,
): string {
  let out = ''
  let prev: { item: Item; text: string } | null = null
  const prefixOf = (item: Item) => {
    const b = blocks[item.block]
    return b?.prefix && b.first === item.i && marked(item.block) ? b.prefix : ''
  }
  for (const p of picked) {
    if (!prev) out += prefixOf(p.item)
    else if (p.item.block !== prev.item.block) {
      const b = blocks[p.item.block]
      const before = blocks[prev.item.block]
      out += b?.kind === 'cell' && (b.cx ?? 0) > 0 && before?.kind === 'cell' ? '\t' : '\n'
      out += prefixOf(p.item)
    } else if (p.item.adv !== undefined || prev.item.adv !== undefined) out += '\n'
    else if (p.item.glued && p.item.i === prev.item.i + 1) out += ''
    else {
      const height = p.item.y1 - p.item.y0
      const sameLine = Math.abs((p.item.y0 + p.item.y1) / 2 - (prev.item.y0 + prev.item.y1) / 2) < height / 2
      const pad = (p.item.pad ?? 0) === (prev.item.pad ?? 0) ? 0 : Math.max(p.item.pad ?? 0, prev.item.pad ?? 0)
      if (sameLine) out += p.item.x0 - prev.item.x1 - pad > (p.item.em ? p.item.em * 0.15 : height * 0.2) ? ' ' : ''
      else out += /[-/]$/.test(prev.text) ? '' : ' '
    }
    out += p.text
    prev = p
  }
  return out
}

// The copy: text segments as they are, each run as its page's text (a run
// with no page, or no words, gives nothing), joined by new lines.
export function joinSegments(segments: readonly Segment[], texts: readonly (string | null)[]): string {
  return segments
    .map((s, i) => (s.kind === 'text' ? s.text : texts[i] ?? ''))
    .filter((t, i) => t !== '' || segments[i]!.kind === 'text')
    .join('\n')
}

// For /iui dump: the first `max` cells or characters of the
// text, a placeholder cell as `[r,c]`, other characters as U+XXXX.
export function codePointsOf(text: string, max = 40): string {
  const cps = Array.from(text, c => c.codePointAt(0)!)
  const out: string[] = []
  for (let i = 0; i < cps.length && out.length < max; i++) {
    const cp = cps[i]!
    if (cp === PLACEHOLDER) {
      const row = INDEX.get(cps[i + 1] ?? -1)
      const col = INDEX.get(cps[i + 2] ?? -1)
      out.push(`U+10EEEE[${row ?? '?'},${col ?? '?'}]`)
      i += (row === undefined ? 0 : 1) + (col === undefined ? 0 : 1)
    } else out.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`)
  }
  return out.join(' ')
}
