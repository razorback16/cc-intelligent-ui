// Intelligent UI: draws Markdown segments like VS Code's Markdown preview
// (the colours come from the theme). One segment = one page = one PNG.
//
// typst compile --root / --package-path <render>/packages --format png --ppi <ppi>
//   <render>/md.typ <outdir>/<a|b>-{0p}.png, with these inputs (pt values are
//   plain numbers as strings):
//   theme=dark|light     the colour scheme (default dark)
//   theme-dir=<folder>   the active theme's absolute folder (themes/README.md;
//                        merged over vscode)
//   doc=<path>           the absolute path of the doc JSON (below)
//   width=<pt>           the page width (default 600)
//   top=<pt>             the first page's top margin (default 6)
//   row=<pt>             one terminal row; each page is padded to whole rows
//                        (default 0 = no padding)
//   grid=1               the row grid (optional; needs row; below)
//   code=<fraction>      code size as a fraction of the body text (default 0.9)
//   term-font=<family>   the terminal's font, used first for code (optional)
//   term-bold=0          the terminal font has no bold face: a fake bold (optional)
//   height=<pt>          the room height of one drawing now (default 0 =
//                        unknown: no height limit and no height factor)
//   design-w=<pt>        the design page width: the `width` at the first
//                        compile of the text (default = width)
//   design-h=<pt>        the design room height: the `height` at the first
//                        compile of the text (default = height)
//   safe=1               the retry mode (optional; below)
//   page=<n>             only the n-th segment (1-based, = the PNG's {0p});
//                        the probe of one page (below)
//
// Live ```typst blocks are laid out in the design space (theme.width,
// theme.height, theme.page-width are the design values) and drawn scaled by
// one factor for the page: f = min(content width / design content width,
// height / design-h), without the height term when the height is unknown.
// A block that is still wider than its space after f is made smaller to fit
// (never larger than f); a tall block is never made smaller (the page grows).
//
// doc JSON: { "base": "/dir/for/relative/images", "segments": ["md", ...],
//             "images": ["/abs/path.png", ...] (optional allow-list),
//             "seams": [null, ["md above", "md below"], ...] (optional) }
// seams: for each segment after the first, the block above its break (the
// last of the segment before) and its own first block. The page starts with
// the gap these two blocks have in one flow (pages are drawn with no gap).
//
// safe=1: the retry mode after a failed compile. `typst` fences are shown as
// code (no eval), math is shown as code (no mitex), images are alt boxes.
//
// grid=1: every line of text lies on the terminal's row grid, so a selection
// of whole rows covers whole lines. Each line box is a whole number of rows
// with its text centred, every block starts and ends on a row boundary, and
// blocks of free height (display math, live drawings, images) are made a
// whole number of rows. A line box of an even number of rows is half a row
// down, so the centre of every line is on the middle of a row: when a line
// of body text is an even number of rows, the page's top margin is half a
// row, else 0 (`top` is not used), and a block of lines of the other parity
// gets half a row above and below (phase-pad). With row=0, grid=1 does
// nothing.

#import "@preview/cmarker:0.1.6"
#import "@preview/mitex:0.2.7": mitex-convert, mitex-scope

// ---------- inputs ----------
#let inp = sys.inputs
#let dark = inp.at("theme", default: "dark") != "light"
#let safe = inp.at("safe", default: "0") not in ("", "0", "false", "no", "off")
// One segment only (page=<n>, 1-based); 0 = all of them.
#let only = int(inp.at("page", default: "0"))
// The probe (probe=1) and its marks: see the probe section below.
#let probe = inp.at("probe", default: "0") not in ("", "0", "false", "no", "off")
#let mark(kind, dy: 0pt, ..extra) = context {
  let at = here().position()
  [#metadata((k: kind, p: at.page + calc.max(0, only - 1), x: at.x / 1pt, y: (at.y + dy) / 1pt, s: text.size.to-absolute() / 1pt, ..extra.named()))<mdpos>]
}
// Block code sets this so the word rule leaves its text to the line marks;
// math and live drawings set no-marks. The orphan cost changes nothing
// here: a page is as tall as its text, so no paragraph breaks across pages.
#let in-code(costs) = costs.orphan == 101%
#let no-marks(costs) = costs.orphan == 102%
#let page-w = float(inp.at("width", default: "600")) * 1pt
// No left margin, so the text starts in the column normal replies start in.
#let margin-left = 0pt
#let margin-right = 4pt
#let margin-y = 6pt
// The first page's top margin in pt: the hooks module sets it so the first
// line of text sits on the terminal row of the reply bullet.
#let first-top = float(inp.at("top", default: "6")) * 1pt
// One terminal row in pt: each page is padded to a whole number of rows, so
// its picture fills its box exactly. 0 = no padding.
#let row = float(inp.at("row", default: "0")) * 1pt
// The row grid (grid=1, only with a row; see the top).
#let on-grid = row > 0pt and inp.at("grid", default: "0") not in ("", "0", "false", "no", "off")
// Code size as a fraction of the body text (the hooks module sets it so code
// in the terminal's font is the terminal's own size).
#let code-scale = float(inp.at("code", default: "0.9"))
// A pt input: its number in pt, else `default` (absent, empty or bad).
#let pt-in(key, default) = {
  let v = str(inp.at(key, default: "")).trim()
  if v.match(regex("^[0-9]+(\\.[0-9]+)?$")) == none { default } else { float(v) * 1pt }
}
// The room height of one drawing now; 0pt = unknown.
#let room-h = pt-in("height", 0pt)
// The design: the space at the first compile of the text.
#let design-page-w = {
  let w = pt-in("design-w", page-w)
  if w > margin-left + margin-right { w } else { page-w }
}
#let design-h = pt-in("design-h", room-h)
#let doc = if "doc" in inp { json(inp.doc) } else {
  (base: "", segments: ("*Intelligent UI:* no `doc` input given.",))
}
#let base = str(doc.at("base", default: ""))
#let allow = doc.at("images", default: none)
#let segments = doc.at("segments", default: ())
#if type(segments) == str { segments = (segments,) }
#if segments.len() == 0 { segments = ("",) }
#let seams = doc.at("seams", default: none)
#if type(seams) != array { seams = () }

// ---------- theme ----------
// Colours, fonts and element sizes come from the active theme
// (theme.typ reads themes/<name>/theme.json, merged over themes/vscode).
// Theme keys named *-px are CSS px of VS Code's preview (14px body) at our
// 11pt body; *-em are em of the element's own text.
#import "theme.typ": T, C, syntax, at-level
#let px = 11pt / 14
// The font lists live in fonts.typ, which render/measure.typ reads too.
#import "fonts.typ": sans, mono-base, line-ink
// The terminal's own font first for code, so code looks like the terminal
// (unless the theme sets fonts.use-terminal-font to false).
#let term-font = inp.at("term-font", default: "")
#let mono = if term-font != "" and T.fonts.use-terminal-font { (term-font,) + mono-base } else { mono-base }
#let content-w = page-w - margin-left - margin-right
#let design-content-w = design-page-w - margin-left - margin-right
// The one factor of the page's live blocks (> 0).
#let factor = {
  let f = content-w / design-content-w
  if room-h > 0pt and design-h > 0pt { f = calc.min(f, room-h / design-h) }
  if f > 0 { f } else { 1.0 }
}
// Code size as a fraction of the body text: the theme's number, or
// "terminal" for the hooks module's `code` input (terminal-sized code).
#let code-size(v) = if v == "terminal" { code-scale } else if type(v) in (int, float) { float(v) } else { code-scale }
#let E = T // element settings, read as E.heading, E.quote, ...

// What a live ```typst block sees as `theme`.
#let theme = (
  dark: dark,
  fg: C.fg,
  muted: C.muted,
  link: C.link,
  border: C.border,
  accent: C.accent,
  bg: C.bg,
  code-bg: C.code-bg,
  red: C.red,
  green: C.green,
  blue: C.blue,
  yellow: C.yellow,
  orange: C.orange,
  purple: C.purple,
  palette: (C.blue, C.orange, C.green, C.red, C.purple, C.yellow),
  width: content-w,
  // The room height of a drawing (when it is unknown: 3/4 of the width).
  height: if room-h > 0pt { room-h } else { content-w * 0.75 },
  page-width: page-w,
  text-size: 11pt,
  sans: sans,
  mono: mono,
)

// What the code of a live block sees: the design space.
#let live-theme = theme + (
  width: design-content-w,
  height: if design-h > 0pt { design-h } else { design-content-w * 0.75 },
  page-width: design-page-w,
)

// ---------- page and text ----------
#set document(title: "Intelligent UI")
#set page(width: page-w, height: auto, margin: (left: margin-left, right: margin-right, y: margin-y), fill: none)
// CSS-like line boxes: line-height 22px at 14px.
#set text(
  font: sans, size: 11pt, fill: C.fg, hyphenate: false, lang: "en",
  top-edge: "ascender", bottom-edge: "descender",
)
#set par(leading: E.text.leading-em * 1em, spacing: E.text.paragraph-em * 1em, justify: false)
#set block(spacing: E.text.paragraph-em * 1em)

// ---------- a fake bold for a terminal font with no bold face ----------
// term-bold=0: Typst has no bold face of the terminal font (Monaco, for
// one), so its bold text would draw regular. As a terminal does, bold
// text in that font gets a stroke of its own fill (0.04em: as thick as
// Menlo's and DejaVu Sans Mono's bold). Text in other fonts stays. The
// stroke goes on bold regions (strong, headings, table headers), never
// on each text: a show text rule stops the long-word and probe rules
// from matching across texts, and makes each compile slower.
#let faux-bold = term-font != "" and inp.at("term-bold", default: "1") == "0"
#let faux-stroke = 0.04em
#let weight-num = (thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900)
#let weight-of(w) = if type(w) == int { w } else { weight-num.at(w, default: 400) }
// The first font of the current list, lower case (needs context).
#let first-font() = {
  let f = text.font
  let x = if type(f) == array { f.at(0, default: "") } else { f }
  lower(if type(x) == dictionary { x.name } else { x })
}
#let is-term() = first-font() == lower(term-font)
// A bold region: the stroke in its fill, when it is in the terminal font
// and has no stroke yet (a stroke that is set stays).
#let faux(body) = if not faux-bold { body } else {
  context if text.stroke != none or not is-term() { body } else { text(stroke: faux-stroke + text.fill, body) }
}
// strong as an explicit weight (its delta), with the stroke when bold.
#show strong: it => if not faux-bold { it } else {
  context if not is-term() { it } else {
    let w = calc.min(weight-of(text.weight) + it.delta, 900)
    if w >= 600 and text.stroke == none { text(weight: w, stroke: faux-stroke + text.fill, it.body) } else { text(weight: w, it.body) }
  }
}

// ---------- the row grid (grid=1) ----------
// Lengths on the grid: `rows-near` the whole rows nearest a length (gaps,
// padding), `rows-up` the whole rows (at least one) a height needs.
#let rows-near(x) = calc.round(x / row) * row
#let rows-up(x) = calc.max(1, calc.ceil(x / row - 0.001)) * row
// Fixed text edges for the current font and size (needs context) that make
// one line box exactly `rows` rows, with the ink of a line (the tops of
// "bdfhkl" to the bottoms of "gjpqy") centred in it: centring the font's
// ascender-to-descender box instead puts large text visibly low. `rows` is
// the least number of rows that this ink and a gap of 0.1em need: 1 for the
// body text at the usual sizes (its ascender-to-descender box is then a
// little more than the row; only the ink must not touch). With par leading
// 0, the lines of a paragraph are then exactly `rows` rows apart. The hooks
// module finds the same `rows` from measure.typ (the bullet's row).
#let grid-edges() = {
  let (up, down, need) = line-ink()
  let n = calc.max(1, calc.ceil(need / row - 0.001))
  let mid = (up - down) / 2
  (top: mid + n * row / 2, bottom: mid - n * row / 2, rows: n)
}
// The half-row phase: the centre of a line box of an even number of rows
// is on a row boundary. Such lines go half a row down: their block gets
// half a row more above and below (still whole rows). The block marks its
// content with a text cost (no effect here, like the probe's flags), so a
// block in it with lines of the same parity does not move again, and one
// with the other parity moves back.
#let half-cost = 103%
#let half-costs(half) = (widow: if half { half-cost } else { 100% })
// The rows of the line box here, from the grid's fixed edges (needs context).
#let line-rows() = if type(text.top-edge) == length and type(text.bottom-edge) == length {
  calc.max(1, int(calc.round((text.top-edge - text.bottom-edge).to-absolute() / row)))
} else { 1 }
// Half a row when lines of parity `half` are in a flow of the other phase.
#let phase-pad(half) = if half != (text.costs.widow == half-cost) { row / 2 } else { 0pt }
// `body`, lines of the text here, in their phase.
#let in-phase(body) = context {
  let half = calc.even(line-rows())
  let pad = phase-pad(half)
  if pad == 0pt { body } else { block(inset: (y: pad), { set text(costs: half-costs(half)); body }) }
}
// The phase of a page's flow is the body text's: true when a line of body
// text is an even number of rows (needs context, at the body's size). Then
// the page starts half a row down, and the lines of body text (paragraphs,
// lists, table cells, quotes, footnotes) need no half row of their own;
// only a block of the other parity (a heading, code) gets one.
#let flow-half() = calc.even(grid-edges().rows)
// The half row under a heading of the other phase is its gap to the block
// under it, so there is no gap there (the gap above stays). The heading
// sets its padding here; heading-gaps puts a strong -1 row after it, which
// takes away its gap below (one row; with a larger gap above the next block,
// for example a heading's, that gap less one row).
#let heading-pad = state("grid-heading-pad", 0pt)
// `body` (a flow: the page's, a quote's) with that -1 row after each
// heading that has a block after it. After the last block it would make
// the page one row too short, which cuts the heading.
#let heading-gaps(body, page: false) = {
  if type(body) != content or body.func() != [].func() { return body }
  let kids = body.children
  let blank = c => c.func() in ([ ].func(), parbreak)
  let last = kids.len() - 1
  while last >= 0 and blank(kids.at(last)) { last -= 1 }
  let first = 0
  while first <= last and blank(kids.at(first)) { first += 1 }
  let out = kids.enumerate().map(((i, c)) => if c.func() == heading and i < last {
    (c, context if heading-pad.get() > 0pt { v(-row) })
  } else { (c,) }).flatten()
  // page: true for a page's flow. When it has the half-row phase and starts
  // with a heading of the other phase, the page's half row and the
  // heading's half row above are an empty row: -1 row takes it away (the
  // heading's line box starts the page, as in a flow of its own phase).
  // The heading moves half a row more than the others when its height
  // (whole rows) in the other phase is less.
  if page and first <= last and kids.at(first).func() == heading {
    let c = kids.at(first)
    out.insert(0, context if flow-half() {
      let here = measure(block(width: content-w, c)).height
      let other = measure(block(width: content-w, { set text(costs: half-costs(false)); c })).height
      if here > other { v(-row) }
    })
  }
  out.join()
}

// ---------- headings ----------
#set heading(numbering: none)
#show heading: it => {
  let lvl = calc.min(it.level, 6)
  let H = E.heading
  let size = at-level(H.size-em, lvl - 1) * 1em
  let above = at-level(H.above-em, lvl - 1) * 11pt
  let below = at-level(H.below-em, lvl - 1) * 11pt
  if on-grid {
    // The grid: a line box of whole rows (3 for h1 and 2 for h2 and h3 at
    // the usual sizes: Typst's own heading rule makes h1 1.4em and h2 1.2em
    // of the theme's size, so h1 is 30.8pt), whole-row gaps (at least one),
    // and the rule on the bottom of the line box (no padding under the
    // text: it would add height). A line box of the other parity than the
    // flow is half a row down (phase-pad): at 100%, an h2 is then 3 rows,
    // its text in the middle one. Such a heading has no gap below
    // (heading-gaps): the half row under its line box is the gap, and its
    // rule is on the bottom of the line box, above that half row.
    return {
      set text(size: size, weight: H.weight)
      context {
        let g = grid-edges()
        let half = calc.even(g.rows)
        let pad = phase-pad(half)
        let rule = if lvl <= H.rule-levels { (bottom: px + C.border) }
        set text(top-edge: g.top, bottom-edge: g.bottom, costs: half-costs(half))
        show raw: set text(top-edge: g.top, bottom-edge: g.bottom)
        set par(leading: 0pt)
        heading-pad.update(pad)
        let body = if weight-of(H.weight) >= 600 { faux(it.body) } else { it.body }
        block(
          width: 100%, above: calc.max(row, rows-near(above)), below: if pad > 0pt { row } else { calc.max(row, rows-near(below)) },
          sticky: true, inset: (y: pad), stroke: if pad == 0pt { rule },
          if pad == 0pt { body } else { block(width: 100%, stroke: rule, body) },
        )
      }
    }
  }
  set text(size: size, weight: H.weight)
  set par(leading: H.leading-em * 1em)
  let body = if weight-of(H.weight) >= 600 { faux(it.body) } else { it.body }
  if lvl <= H.rule-levels {
    block(
      width: 100%, above: above, below: below, sticky: true,
      inset: (bottom: H.rule-pad-em * 1em), stroke: (bottom: px + C.border),
      body,
    )
  } else {
    block(width: 100%, above: above, below: below, sticky: true, body)
  }
}

// ---------- links, emphasis ----------
#show link: set text(fill: C.link)
// In a fake bold region, the stroke takes the link's colour too.
#show link: it => if not faux-bold { it } else { context if text.stroke == none { it } else { text(stroke: faux-stroke + C.link, it) } }
#set strike(stroke: 0.06em)

// ---------- lists ----------
// "disc", "circle" and "square" draw CSS-like markers (0.35em, centred
// 0.31em above the baseline, as measured in VS Code); any other string is
// used as text.
#let list-marker(m) = {
  let d = 0.35em
  let lift = 0.31em - d / 2
  if m == "disc" { box(baseline: -lift, circle(radius: d / 2, fill: C.fg, stroke: none)) }
  else if m == "circle" { box(baseline: -lift, circle(radius: d / 2 - 0.03em, stroke: 0.06em + C.fg)) }
  else if m == "square" { box(baseline: -lift, square(size: d * 0.9, fill: C.fg, stroke: none)) }
  else { [#m] }
}
#set list(
  marker: E.list.markers.map(list-marker),
  indent: E.list.indent-em * 1em, body-indent: E.list.gap-em * 1em, spacing: E.list.item-spacing-em * 1em,
)
// list.numbering is one Typst pattern: its counting symbols are the nesting
// levels ("1.a.i." gives 1., a., i.), and the last one repeats. A pattern
// with no counting symbol fails the compile, so it gets "1." instead.
#let enum-numbering = {
  let p = E.list.numbering
  if type(p) == str and p.match(regex("[1aAiI*αΑא一壹あいアイㄱ가①⓵]")) != none { p } else { "1." }
}
#set enum(
  numbering: enum-numbering,
  indent: E.list.number-indent-em * 1em, body-indent: E.list.number-gap-em * 1em, spacing: E.list.item-spacing-em * 1em,
)

// ---------- code ----------
#set raw(theme: syntax(), tab-size: 4)
// Typst shrinks raw text to 0.8em by default, hence the / 0.8.
#show raw: set text(font: mono, top-edge: "ascender", bottom-edge: "descender")
#show raw.where(block: false): set text(size: code-size(E.inline-code.size) / 0.8 * 1em)
#show raw.where(block: true): set text(size: code-size(E.code-block.size) / 0.8 * 1em)
// Code in a font that has a bold face gets no fake bold of the text around it.
#show raw: it => if faux-bold and lower(mono.at(0)) != lower(term-font) { text(stroke: none, it) } else { it }
// Inline code: like VS Code's `code { padding: 1px 3px; border-radius: 4px }`,
// the background covers the code font's ascender to descender plus the
// padding. highlight (not box) so long inline code can wrap across lines.
#show raw.where(block: false): it => context {
  let IC = E.inline-code
  let asc = measure(text(top-edge: "ascender", bottom-edge: "baseline", "x")).height
  let desc = measure(text(top-edge: "baseline", bottom-edge: "descender", "x")).height
  let pad-x = IC.pad-x-px * px
  let pad-y = IC.pad-y-px * px
  // A zero-width strut of the body text: a line with only code (a table
  // cell, a list item) gets the body's line box, so its baseline is where
  // the text next to it has its baseline (the code font is smaller). On
  // the grid, the strut keeps the grid's edges (the line box of one row).
  if on-grid { text(font: sans, size: text.size, sym.zwj) } else {
    text(font: sans, size: text.size, top-edge: "ascender", bottom-edge: "descender", sym.zwj)
  }
  h(pad-x)
  highlight(
    fill: C.inline-code-bg, extent: pad-x, radius: IC.radius-px * px,
    top-edge: asc + pad-y, bottom-edge: -(desc + pad-y),
    text(fill: C.inline-code-fg, ..if faux-bold and text.stroke != none { (stroke: faux-stroke + C.inline-code-fg) }, it),
  )
  h(pad-x)
}
// Code blocks: VS Code's `pre` (padding 16px, radius 3px, 1px border) with
// `code { line-height: 1.357em }`, only as wide as its code and header need
// (at most the width here, where long lines wrap). A block with no language
// has its own colour, code-plain-fg, when the theme sets one (Typst gives
// unscoped code the text colour, not the tmTheme's).
// The header row on top: the language as written (when the fence has one)
// and a copy button, small and muted, with a rule under them. Its text has
// no marks (no-marks); the probe marks the button (`t`, see the probe).
// The copy icon: two pages, the back one seen over and right of the front.
#let copy-icon = box(width: 0.85em, height: 0.85em, baseline: 0.12em, {
  let line = (paint: C.muted, thickness: 0.07em, join: "round")
  place(rect(width: 0.6em, height: 0.6em, radius: 0.12em, stroke: line), dy: 0.25em)
  place(curve(stroke: line, curve.move((0.25em, 0.25em)), curve.line((0.25em, 0em)), curve.line((0.85em, 0em)), curve.line((0.85em, 0.6em)), curve.line((0.6em, 0.6em))))
})
#show raw.where(block: true): it => context {
  let fg = if it.lang == none { C.at("code-plain-fg", default: C.code-fg) } else { C.code-fg }
  let CB = E.code-block
  let pad = CB.pad-px * px
  let line = CB.border-px * px + C.code-border
  // The grid: each code line exactly one row (the code is the terminal's
  // font at its size), the header one line of code, padding of whole rows
  // (16px is about one row), and half a row more when its lines are not in
  // the flow's phase (phase-pad).
  let g = if on-grid { grid-edges() } else { (top: 0pt, bottom: 0pt, rows: 1) }
  let half = calc.even(g.rows)
  let phase = if on-grid { phase-pad(half) } else { 0pt }
  let area = measure(text(top-edge: "ascender", bottom-edge: "descender", "x")).height
  set text(top-edge: g.top, bottom-edge: g.bottom, costs: half-costs(half)) if on-grid
  set par(leading: if on-grid { 0pt } else { calc.max(0pt, CB.line-height * text.size - area) }, justify: false)
  let gap = if on-grid { row } else { 1.2em }
  // In a live drawing (no-marks): the full width and no header, as the
  // drawing is scaled (its button would not be where it is drawn).
  if no-marks(text.costs) {
    block(
      width: 100%, fill: C.code-bg, stroke: line, radius: CB.radius-px * px, above: gap, below: gap,
      inset: if on-grid { (x: pad, y: rows-near(pad) + phase) } else { pad }, text(fill: fg, it),
    )
  } else {
    let small(body) = text(font: sans, size: 0.85em, fill: C.muted, body)
    let lang = if it.lang != none { small(it.lang) }
    let copy = small[#copy-icon#h(0.35em)Copy]
    let bpad = pad / 2
    let bw = measure(copy).width + 2 * bpad
    let hh = if on-grid { g.rows * row } else { measure(small("X")).height + 0.6 * pad }
    let header = block(width: 100%, height: hh, inset: (left: pad, right: pad - bpad), stroke: (bottom: line), {
      set text(costs: (orphan: 102%))
      if probe and in-code(text.costs) { place(top + right, box(width: bw, height: hh, mark("t", kind: "copy", w: bw / 1pt, h: hh / 1pt, code: it.text, ..if it.lang != none { (lang: it.lang) }))) }
      grid(columns: (1fr, bw), rows: hh, align: (left + horizon, center + horizon), lang, copy)
    })
    let code = block(width: 100%, inset: if on-grid { (x: pad, y: rows-near(pad)) } else { pad }, text(fill: fg, it))
    block(width: 100%, above: gap, below: gap, layout(size => {
      // The width the code and the header need, at most the width here.
      let need = calc.max(
        measure(text(fill: fg, it)).width,
        if lang == none { 0pt } else { measure(lang).width + pad } + bw - bpad,
      ) + 2 * pad
      block(
        width: calc.min(need, size.width), fill: C.code-bg, stroke: line,
        radius: CB.radius-px * px, inset: (y: phase), stack(header, code),
      )
    }))
  }
}

// ---------- block quotes ----------
// Typst's quote adds its own space around the block (a paragraph then a
// quote had twice the paragraph gap, and a nested quote a large gap after
// the text above it), so the gaps are set here: the paragraph gap, like
// every other block.
#show quote.where(block: true): it => {
  let Q = E.quote
  // The grid: whole-row gaps and padding (0.55em is nearer to no row than
  // to one, so the bar is as tall as the text's rows), and one row between
  // the blocks in it (Typst's own quote rule gives them 2.4em above and
  // 1.8em below). Its lines in their phase (phase-pad).
  if on-grid {
    return context {
      let half = calc.even(line-rows())
      block(
        width: 100%, fill: C.quote-bg, radius: Q.radius-px * px, above: row, below: row,
        stroke: (left: Q.bar-px * px + C.quote-border),
        inset: (left: (Q.pad-left-px + Q.bar-px) * px, right: Q.pad-right-px * px, y: rows-near(Q.pad-y-em * 11pt) + phase-pad(half)),
        { set block(spacing: row); set text(costs: half-costs(half)); heading-gaps(it.body) },
      )
    }
  }
  block(
    width: 100%, fill: C.quote-bg, radius: Q.radius-px * px,
    above: E.text.paragraph-em * 1em, below: E.text.paragraph-em * 1em,
    stroke: (left: Q.bar-px * px + C.quote-border),
    inset: (left: (Q.pad-left-px + Q.bar-px) * px, right: Q.pad-right-px * px, y: Q.pad-y-em * 1em),
    it.body,
  )
}

// ---------- tables ----------
// table.style: "rules" (VS Code's preview: a rule under the header and
// between the rows) or "grid" (Claude Code's own tables). Another value
// draws as "rules". Each column, its header too, has the alignment of the
// Markdown's delimiter row.
// The grid: each table row is whole rows (padding of whole rows: 5px is
// none), so the rules lie on row boundaries.
#let table-pad = E.table.pad-y-px * px
#let rules-inset = (x: E.table.pad-x-px * px, y: if on-grid { rows-near(table-pad) } else { table-pad })
#let rules-stroke = (x, y) => if y == 1 { (top: E.table.border-px * px + C.th-border) } else if y > 1 { (top: E.table.border-px * px + C.border) }
// "grid": a full grid of thin rules (border-px, th-border). On the row grid
// the padding is whole rows and a half, so each rule is in the middle of a
// row.
#let table-line = E.table.border-px * px + C.th-border
#let grid-stroke = (x, y) => (left: if x > 0 { table-line }, top: if y > 0 { table-line })
#let grid-inset = (x: E.table.pad-x-px * px, y: if on-grid { rows-near(calc.max(0pt, table-pad - row / 2)) + row / 2 } else { table-pad })
#let table-grid = E.table.style == "grid"
#set table(inset: if table-grid { grid-inset } else { rules-inset }, stroke: if table-grid { grid-stroke } else { rules-stroke })
// The outer border is the block's, inside the table's edges (a negative
// outset changes no layout), so a table at a page's edge (no left margin)
// keeps all of it. The clip trims the rule ends that Typst draws past the
// edges. On the row grid, half a row around the box keeps the text on its
// rows and puts each rule in the middle of a row.
#show table: it => if it.stroke == grid-stroke {
  let framed = block(stroke: table-line, outset: -table-line.thickness / 2, clip: true, it)
  if on-grid { block(inset: (y: row / 2), framed) } else { framed }
} else { it }
// Live ```typst drawings (the only scale here) keep the "rules" look.
#show scale: set table(inset: rules-inset, stroke: rules-stroke)
#show table.cell.where(y: 0): set text(weight: E.table.header-weight)
#show table.cell.where(y: 0): it => if weight-of(E.table.header-weight) >= 600 { faux(it) } else { it }
#show table: set par(leading: 0.38em)

// ---------- footnotes ----------
#set footnote.entry(separator: line(length: 30%, stroke: px + C.border), gap: 0.5em)
#show footnote.entry: set text(size: 0.9em, fill: C.muted)

// ---------- long words, URLs and paths must wrap ----------
// A token of 30+ non-space characters gets break chances after each
// character, so it wraps like CSS `word-wrap: break-word` instead of
// running off the page.
#show regex("\S{30,}"): it => it.text.clusters().join(sym.zws)

// ---------- probe: where the text lies ----------
// probe=1 is given only to `typst query <md.typ> "<mdpos>" --field value`
// (same inputs as the PNG compile), never to the PNG compile itself: the
// word rule below splits text into separately shaped runs, which moves
// glyphs by a fraction of a pixel (a PNG with probe=1 differs from one
// without in anti-aliasing, max 64/255 on a channel, but no word moves and
// no line breaks elsewhere). Its marks are `metadata` labelled <mdpos>, in
// document order:
//   w: a word (a run of non-space characters, cut after - and /), boxed;
//      x, y the top-left of its box: y is the top of its line box (text
//      top-edge "ascender"), w its advance width and h its ascender-to-
//      descender height. Its ink lies inside the box (1-4 px side bearings
//      at 2.75 px/pt), its centre is y + h/2.
//      A long word (30+ characters) or CJK text breaks anywhere: each of
//      its characters (clusters) is a word, boxed, `g` on all but the
//      first (they join with no space).
//      A word of inline code has `pad`, the theme's padding beside the
//      code, when it is not 0, and `code`, the whole text of that code.
//      A word in a link to a URL (a string) has `href`, the URL.
//      Inline math is one word, its LaTeX source in dollars, boxed as a
//      word of the text's line (`s` is the math's size); see md-math.
//   c: a block code line: x its start, y its baseline, a and d the code
//      font's ascender and descender, w its width, n its characters.
//   b: a block starts: paragraph, heading, code block, quote, table cell
//      (column `cx`), list item (`prefix`: "- ", "1. ", "- [x] ").
//   t: a click target: kind "copy", the copy button of a code block (after
//      its `b`, before its lines), boxed; x, y the top-left of its box, w
//      and h its size, `code` the block's whole text, `lang` its language
//      (when the fence has one).
// Display math, and the text in math and in live ```typst drawings, have no
// marks (a drawing is scaled, so its marks would not be where it is drawn).
// With page=<n>, only that segment is laid out, as in the whole document
// (each segment is a page of its own: its own margins and labels), so a
// copy probes only the pages it reads; `p` is still the PNG's page.
// Each mark has its page `p` (1-based, = the PNG's {0p}) and the text size
// `s`; all lengths in pt from the page's top-left. A bare (unboxed) mark at
// the start of a wrapped line is placed at the end of the line above, and
// one at a paragraph's end on the next line; hence the boxes.
// Inline code sets this so its words carry the theme's padding beside it
// (`pad`: a copy takes it off the gap to the text next to it).
#let in-inline-code(costs) = costs.orphan == 104%
#let cjk = regex("[\\p{Han}\\p{Hiragana}\\p{Katakana}\\p{Hangul}]")
// The URL of the link and the text of the inline code the text is in.
#let probe-href = state("probe-href", none)
#let probe-code = state("probe-code", none)
#let probe-rules(body) = {
  // A word is cut after a hyphen or a slash, where a line may break; a
  // token of 30+ characters is one word (it breaks anywhere, see above).
  show regex("\\S{30,}|[^\\s/-]*[/-]+|[^\\s/-]+"): it => context if in-code(text.costs) or no-marks(text.costs) { it } else {
    let size = measure(it)
    let t = it.text
    let pad = E.inline-code.pad-x-px * px
    let pad = if in-inline-code(text.costs) and pad > 0pt { (pad: pad / 1pt) } else { (:) }
    let tags = pad
    let href = probe-href.get()
    if href != none { tags.insert("href", href) }
    let code = if in-inline-code(text.costs) { probe-code.get() }
    if code != none { tags.insert("code", code) }
    if t.clusters().len() >= 30 or t.match(cjk) != none {
      // A long word or CJK text breaks anywhere: a box for each character
      // (a line may break between boxes, as at the long-word rule's zws).
      // Bare text here would be matched by that rule again as one word,
      // with all the marks after it.
      for (i, c) in t.clusters().enumerate() {
        let one = measure(c)
        box({ mark("w", t: c, w: one.width / 1pt, h: one.height / 1pt, ..tags, ..if i > 0 { (g: 1) } else { (:) }); c })
      }
    } else {
      // Boxed, so the mark is where the word is drawn (a bare mark at the
      // start of a wrapped line stays at the end of the line above).
      box({ mark("w", t: t, w: size.width / 1pt, h: size.height / 1pt, ..tags); it })
    }
  }
  // A code line: a zero-size box at its start (its y is the baseline). An
  // empty line has none: a box would give it a height.
  show raw.line: it => context if not in-code(text.costs) or it.text == "" { it } else {
    let asc = measure(text(top-edge: "ascender", bottom-edge: "baseline", "x")).height
    let desc = measure(text(top-edge: "baseline", bottom-edge: "descender", "x")).height
    box(mark("c", t: it.text, w: measure(it.body).width / 1pt, n: it.text.clusters().len(), a: asc / 1pt, d: desc / 1pt))
    it
  }
  show raw.where(block: true): it => context if no-marks(text.costs) { it } else {
    mark("b", kind: "code")
    set text(costs: (orphan: 101%))
    it
  }
  show math.equation: set text(costs: (orphan: 102%))
  show raw.where(block: false): it => context if no-marks(text.costs) { it } else { set text(costs: (orphan: 104%)); probe-code.update(it.text); it }
  show link: it => if type(it.dest) != str { it } else { probe-href.update(it.dest); it; probe-href.update(none) }
  show par: it => { mark("b", kind: "par"); it }
  show heading: it => { mark("b", kind: "heading"); it }
  show quote.where(block: true): it => { mark("b", kind: "quote"); it }
  show table.cell: it => { mark("b", kind: "cell", cx: it.x); it }
  body
}
#show: body => if probe { probe-rules(body) } else { body }
#let item-mark(prefix, body) = if not probe { body } else { mark("b", kind: "item", prefix: prefix); body }

// ---------- helpers ----------
// On the grid, the boxes below have no padding above and below (it would
// make the line taller than its row): the frame is the row, made 1pt smaller.
#let alt-box(alt, why: none) = box(
  stroke: px + C.muted, inset: (x: 4pt, y: if on-grid { 0pt } else { 1.5pt }), outset: (y: if on-grid { -1pt } else { 1pt }), radius: 3pt,
  text(fill: C.muted, size: 0.9em, {
    "🖼 "
    if alt == none or alt == "" { if why == none { "image" } else { why } } else { alt }
  }),
)

#let image-exts = ("png", "jpg", "jpeg", "gif", "svg", "webp")

#let resolve(p) = {
  let p = p.trim()
  if p.starts-with("file://") { p = p.slice(7) }
  p = p.replace("%20", " ")
  if p.starts-with("/") { p } else if base == "" { none } else {
    base.trim("/", at: end) + "/" + p.trim("./", at: start, repeat: false)
  }
}

#let md-image(path, alt: none, want: none, ..rest) = {
  let path = if type(path) == str { path } else { "" }
  let alt = if alt == none { none } else if type(alt) == str { alt } else { none }
  if safe or path == "" { return alt-box(alt) }
  // Remote (http:, https:, data:, ...) images cannot be loaded.
  if path.match(regex("^[A-Za-z][A-Za-z0-9+.-]+:")) != none and not path.starts-with("file://") {
    return alt-box(alt)
  }
  let full = resolve(path)
  if full == none { return alt-box(alt) }
  let ext = lower(full.split(".").last())
  if ext not in image-exts { return alt-box(alt) }
  if allow != none and full not in allow and path not in allow { return alt-box(alt) }
  box(layout(size => {
    let nat = measure(image(full))
    // CSS px -> pt at our scale; never wider than the column (max-width: 100%).
    let w = if want == none { nat.width * (11 / 14) } else if type(want) == ratio {
      want * size.width
    } else { want }
    let w = calc.min(w, size.width)
    // Never taller than the room of a drawing (when it is known).
    let w = if room-h > 0pt and nat.width > 0pt and w * (nat.height / nat.width) > room-h {
      room-h * (nat.width / nat.height)
    } else { w }
    if on-grid {
      // The grid: the image centred in a box of whole rows, lowered by the
      // line's descent, so its line is exactly those rows.
      let h = if nat.width > 0pt { w * (nat.height / nat.width) } else { nat.height }
      let desc = if type(text.bottom-edge) == length { -text.bottom-edge } else { 0pt }
      box(height: rows-up(h), baseline: desc, align(horizon, image(full, width: w, alt: alt)))
    } else {
      image(full, width: w, alt: alt)
    }
  }))
}

// <img src=... alt=... width=...>
#let html-img(attrs) = {
  let src = attrs.at("src", default: "")
  let alt = attrs.at("alt", default: none)
  // width="40" (CSS px) or width="50%"
  let w = attrs.at("width", default: none)
  let w = if w == none { none } else if w.match(regex("^\d+(\.\d+)?%$")) != none {
    float(w.trim("%", at: end)) * 1%
  } else if w.match(regex("^\d+(\.\d+)?(px)?$")) != none {
    float(w.trim("px", at: end)) * px
  } else { none }
  md-image(src, alt: alt, want: w)
}

// [@x] (citation / reference). Footnote refs work; anything else is drawn
// as plain text so a missing label can never fail the compile.
#let md-ref(target, supplement: auto, ..rest) = context {
  let found = if type(target) == label { query(target) } else { () }
  if found.len() == 1 and found.first().func() == footnote {
    ref(target)
  } else if supplement != auto and supplement != none {
    supplement
  } else {
    let name = if type(target) == label { str(target) } else { repr(target) }
    "[@" + name.replace(regex("^s\d+-"), "") + "]"
  }
}

// [text](#anchor): link inside the segment when the label exists, else text.
#let md-link(dest, ..args) = {
  if type(dest) == label {
    let body = args.pos().at(0, default: none)
    context {
      if query(dest).len() == 1 { link(dest, ..args) } else {
        text(fill: C.link, if body == none { str(dest) } else { body })
      }
    }
  } else if type(dest) == str and dest.trim() == "" {
    // [text]() : an empty URL is an error in Typst.
    let body = args.pos().at(0, default: none)
    text(fill: C.link, if body == none { "" } else { body })
  } else {
    link(dest, ..args)
  }
}

// <a href=...>; <a name=...> (no href) is just its text.
#let html-a(attrs, body) = {
  let href = attrs.at("href", default: "")
  if href.trim() == "" { body } else if href.starts-with("#") {
    text(fill: C.link, body)
  } else { link(href, body) }
}

// ---------- HTML tables (<table><tr><td>) ----------
// cmarker's own version fails on bad rowspan/colspan or an empty table.
// Same tagging scheme as cmarker: [#metadata((tag, data))#body].
#let tagged(c, tags) = (
  type(c) == content and c.func() == [].func() and c.children.len() == 2
    and c.children.at(0).func() == metadata
    and type(c.children.at(0).value) == array and c.children.at(0).value.len() == 2
    and c.children.at(0).value.at(0) in tags
)
#let untag(c, tags) = {
  let kids = if tagged(c, tags) { (c,) } else if type(c) == content and c.func() == [].func() { c.children } else { () }
  kids.filter(k => tagged(k, tags)).map(k => (k.children.at(0).value.at(0), k.children.at(0).value.at(1), k.children.at(1)))
}
#let span-attr(attrs, key) = {
  let v = str(attrs.at(key, default: "1")).trim()
  if v.match(regex("^[1-9][0-9]{0,2}$")) != none { int(v) } else { 1 }
}
#let html-cell(attrs, body) = [#metadata(("<td>", attrs))#body]
#let html-table(attrs, body) = {
  let rows = (header: (), body: (), footer: ())
  for (tag, _, child) in untag(body, ("<tr>", "<thead>", "<tfoot>", "<tbody>")) {
    if tag == "<thead>" {
      for (_, _, row) in untag(child, ("<tr>",)) { rows.header.push(untag(row, ("<td>",))) }
    } else if tag == "<tfoot>" {
      for (_, _, row) in untag(child, ("<tr>",)) { rows.footer.push(untag(row, ("<td>",))) }
    } else if tag == "<tbody>" {
      for (_, _, row) in untag(child, ("<tr>",)) { rows.body.push(untag(row, ("<td>",))) }
    } else {
      rows.body.push(untag(child, ("<td>",)))
    }
  }
  let all = rows.header + rows.body + rows.footer
  if all.len() == 0 { return body }
  // Count the columns each row really needs, rowspans from above included.
  let need = all.map(_ => 0)
  let i = 0
  let bounds = ()
  for (k, section) in rows {
    let stop = i + section.len()
    bounds.push((k, i, stop))
    for row in section {
      for (_, a, _) in row {
        for r in range(i, calc.min(i + span-attr(a, "rowspan"), stop)) {
          need.at(r) += span-attr(a, "colspan")
        }
      }
      i += 1
    }
  }
  let columns = calc.max(0, ..need)
  if columns == 0 { return body }
  let cells = (:)
  for (k, start, stop) in bounds {
    let out = ()
    for (j, row) in rows.at(k).enumerate() {
      let y = start + j
      for (_, a, td) in row {
        out.push(table.cell(
          y: y,
          colspan: calc.min(span-attr(a, "colspan"), columns),
          rowspan: calc.max(1, calc.min(span-attr(a, "rowspan"), stop - y)),
          td,
        ))
      }
    }
    cells.insert(k, out)
  }
  let args = ()
  if cells.header.len() != 0 { args.push(table.header(..cells.header)) }
  args += cells.body
  if cells.footer.len() != 0 { args.push(table.footer(..cells.footer)) }
  table(columns: columns, ..args)
}

#let md-rule() = if on-grid {
  // The grid: one row with the line in its middle, whole-row gaps.
  let gap = calc.max(row, rows-near(E.rule.gap-em * 11pt))
  block(height: row, above: gap, below: gap, align(horizon, line(length: 100%, stroke: E.rule.border-px * px + C.border)))
} else {
  block(above: E.rule.gap-em * 1em, below: E.rule.gap-em * 1em, line(length: 100%, stroke: E.rule.border-px * px + C.border))
}

// ---------- task lists: "- [x] done" / "- [ ] todo" ----------
#let checkbox(checked) = box(
  width: 0.95em, height: 0.95em, baseline: 0.12em, radius: 2.5 * px,
  fill: if checked { C.accent } else { none },
  stroke: if checked { 0.8 * px + C.accent } else { 1.2 * px + C.muted },
  if checked {
    place(curve(
      stroke: (paint: C.check, thickness: 0.13em, cap: "round", join: "round"),
      curve.move((0.22em, 0.5em)),
      curve.line((0.42em, 0.7em)),
      curve.line((0.75em, 0.27em)),
    ))
  },
)

// Text of an element when it is plain text or a space, else none.
#let plain(c) = {
  // Escaped "\[" arrives as a `symbol` element; plain text as `text`.
  if type(c) == str { c } else if c == [ ] { " " } else if c.func() != raw and "text" in c.fields() and type(c.text) == str {
    c.text
  } else { none }
}

// If an item body starts with "[ ] " / "[x] ", return (checked, rest).
#let task-split(body) = {
  if type(body) != content { return none }
  let kids = if body.func() == [].func() { body.children } else { (body,) }
  let acc = ""
  let n = 0
  for c in kids {
    if acc.len() >= 4 { break }
    let t = plain(c)
    if t == none { break }
    acc += t
    n += 1
  }
  let m = acc.match(regex("^\[([ xX])\][ \t]"))
  if m == none or m.end != acc.len() {
    // The 4 characters may sit in one text with more text after them.
    if m != none and m.end < acc.len() and n > 0 {
      let first-rest = acc.slice(m.end)
      return (m.captures.at(0) != " ", (first-rest, ..kids.slice(n)).join())
    }
    return none
  }
  (m.captures.at(0) != " ", kids.slice(n).join())
}

// A loose list (a blank line between its items or between the blocks of an
// item): cmarker ends each paragraph of its items with a parbreak, a tight
// list has none. On the grid, the items of a loose list have one row
// between them (the items of a tight list touch, as the lines of a
// paragraph do).
#let loose(items) = items.any(it => type(it) == content and it.func() == [].func() and it.children.any(c => c.func() == parbreak))
#let item-gap(items) = if on-grid and loose(items) { (spacing: row) } else { (:) }

#let list-of(..args) = {
  let items = args.pos()
  let gap = item-gap(items)
  let tasks = items.map(task-split)
  if probe {
    items = items.zip(tasks).map(((it, t)) => item-mark(if t == none { "- " } else if t.at(0) { "- [x] " } else { "- [ ] " }, it))
    tasks = tasks.zip(items).map(((t, it)) => if t == none { none } else { (t.at(0), item-mark(if t.at(0) { "- [x] " } else { "- [ ] " }, t.at(1))) })
  }
  if tasks.all(t => t == none) { return list(..args.named(), ..gap, ..items) }
  if tasks.all(t => t != none) {
    // GitHub-style: no bullet, the checkbox sits where the bullet would.
    // The grid: a strut of the text (its line box) beside each checkbox, so
    // the checkbox sits on its row's baseline, and no gap between rows (one
    // row in a loose list).
    let rows = tasks.map(t => (
      align(right, if on-grid { [#sym.zwj#checkbox(t.at(0))] } else { checkbox(t.at(0)) }),
      t.at(1),
    ))
    pad(left: 0.45em, grid(
      columns: (1.4em, 1fr), column-gutter: 0.55em, row-gutter: if on-grid { gap.at("spacing", default: 0pt) } else { 0.38em + 0.15em },
      ..rows.flatten(),
    ))
  } else {
    list(..args.named(), ..gap, ..items.zip(tasks).map(((it, t)) => if t == none { it } else {
      [#checkbox(t.at(0)) #t.at(1)]
    }))
  }
}

// "1. [x] done": keep the number, put the checkbox after it.
#let enum-of(..args) = {
  let start = args.named().at("start", default: 1)
  let start = if type(start) == int { start } else { 1 }
  let gap = item-gap(args.pos())
  let items = args.pos().enumerate().map(((i, it)) => {
    let t = task-split(it)
    let it = if t == none { it } else { [#checkbox(t.at(0)) #t.at(1)] }
    item-mark(str(start + i) + ". ", it)
  })
  enum(..args.named(), ..gap, ..items)
}

// On the grid, a list with its nested lists is one block in its phase.
#let md-list(..args) = if on-grid { in-phase(list-of(..args)) } else { list-of(..args) }
#let md-enum(..args) = if on-grid { in-phase(enum-of(..args)) } else { enum-of(..args) }

// ---------- ```typst fences: live Typst ----------
#let live-langs = ("typst", "typ")
// The width that content `c` needs when it is laid out in the width `w`:
// more than `w` only when a part with a fixed size (a canvas, a rect) is
// wider. In Typst 0.15, measure(c, width: w) never gives more than `w`, and
// measure(c) (no limit) gives the length of unwrapped text lines too, so:
// content wider than `w` without a limit that does not reflow between `w`
// and that width (the same height) needs that width; else its direct parts
// are checked one by one (depth 1 at most: text wraps, so it never needs
// more than `w`).
#let needed-width(c, w, depth: 0) = {
  if type(c) != content { return 0pt }
  let free = measure(c).width
  if free <= w { return free }
  if calc.abs((measure(c, width: w).height - measure(c, width: free).height).pt()) < 0.01 { return free }
  if depth >= 1 { return 0pt }
  let f = c.fields()
  let kids = if "children" in f { f.children } else if "child" in f { (f.child,) } else if "body" in f { (f.body,) } else { () }
  kids.fold(0pt, (acc, k) => calc.max(acc, needed-width(k, w, depth: depth + 1)))
}
#let md-raw(src, block: false, lang: none, ..args) = {
  let l = if lang == none { "" } else { lower(str(lang).trim()) }
  if block and not safe and l in live-langs {
    // Inside a block, so #pagebreak() and #set page() are errors (one
    // segment must stay one page); a column break is dropped.
    let drawing = {
      show colbreak: none
      // The probe: no marks (see no-marks). The grid: no half-row phase.
      // Code blocks: no header (see the code section).
      set text(costs: (orphan: 102%))
      // Off-grid text rules, so multi-line labels do not overlap.
      set text(top-edge: "ascender", bottom-edge: "descender") if on-grid
      set par(leading: E.text.leading-em * 1em, spacing: E.text.paragraph-em * 1em) if on-grid
      set std.block(spacing: E.text.paragraph-em * 1em) if on-grid
      eval(src, mode: "markup", scope: (theme: live-theme))
    }
    std.block(width: 100%, above: if on-grid { row } else { 1.2em }, below: if on-grid { row } else { 1.2em }, layout(size => {
      // The space here (less than the content width in a list or a quote).
      let space = if size.width.pt() < 1e6 { size.width } else { content-w }
      // Lay the code out in the design width (in design units: the space / f
      // when that is less, so 100% widths fill the space here).
      let w = calc.min(design-content-w, space / factor)
      // Fit guard: a part with a fixed size wider than w gets a smaller
      // factor, so it is never cut. A tall drawing is never made smaller
      // (the page grows; the factor has the height ratio already).
      let k = factor
      let wide = needed-width(drawing, w)
      if wide > w { k = calc.min(k, space / wide) }
      // Lay a too-wide drawing out in the width it needs: in the width w, an
      // align(center, ..) puts the extra width left of the block, where the
      // scale cannot bring it back (it is cut off at the page edge).
      let drawn = scale(k * 100%, origin: top + left, reflow: true, std.block(width: calc.max(w, wide), drawing))
      // The grid: the drawing centred in whole rows.
      if on-grid { std.block(height: rows-up(measure(drawn, width: space).height), align(horizon, drawn)) } else { drawn }
    }))
  } else if block and safe and l in live-langs {
    // Retry mode: show the source, with a note that it was not drawn.
    std.block(above: if on-grid { row } else { 1.2em }, below: 0pt, sticky: true,
      text(size: 0.85em, fill: C.muted, style: "italic")[Typst source (not drawn: the answer failed to compile)])
    raw(src, block: true, lang: "typst")
  } else {
    raw(src, block: block, lang: lang, ..args)
  }
}

// ---------- math ----------
// Math is drawn larger than the body text, as in VS Code's preview (KaTeX):
// display math by the theme's math-scale, inline math by math-inline-scale.
#let math-scale(key, default) = {
  let v = T.at(key, default: default)
  if type(v) in (int, float) and v > 0 and v <= 4 { float(v) } else { default }
}
#let display-scale = math-scale("math-scale", 1.2)
#let inline-scale = math-scale("math-inline-scale", 1.1)

// In LaTeX a bare | (and \vert, \|, \Vert) is an ordinary symbol: |x| and
// P(A|B) are tight. mitex gives Typst a bare `|`, which Typst spaces like a
// relation ("| x |"). So each one that is not a delimiter of \left, \right
// or \middle becomes \mathord{|}, and \big| (\Big, \bigg, \Bigg) becomes
// \mathord{\big|} (\bigl: \mathopen, \bigr: \mathclose, \bigm: \mathrel), as
// in LaTeX. Text arguments (\text{a|b}, ...) are left as they are.
#let bars = ("|", "\\vert", "\\|", "\\Vert")
#let big-class = (l: "mathopen", r: "mathclose", m: "mathrel")
#let latex-bars(src) = {
  if bars.all(b => not src.contains(b)) { return src }
  let out = ""
  let last = 0
  let delim = false // the token before was \left, \right or \middle
  let big = none // the token before was \big...: (start, class)
  let text-arg = false // the next { opens a text argument
  let depth = 0 // brace depth inside a text argument (0 = not in one)
  for m in src.matches(regex("\\\\([A-Za-z]+|[\\s\\S])|\\S")) {
    let t = m.text
    if depth > 0 {
      if t == "{" { depth += 1 } else if t == "}" { depth -= 1 }
      continue
    }
    if t == "{" and text-arg { depth = 1 }
    if t in bars and big != none {
      out += src.slice(last, big.at(0)) + "{\\" + big.at(1) + "{" + src.slice(big.at(0), m.end) + "}}"
      last = m.end
    } else if t in bars and not delim {
      out += src.slice(last, m.start) + "{\\mathord{" + t + "}}"
      last = m.end
    }
    let name = if t.starts-with("\\") { t.slice(1) } else { "" }
    delim = name in ("left", "right", "middle")
    let b = name.match(regex("^[bB]igg?([lrm]?)$"))
    big = if b == none { none } else { (m.start, big-class.at(b.captures.at(0), default: "mathord")) }
    text-arg = name.match(regex("^(text[a-z]*|mbox|hbox|emph)$")) != none
  }
  out + src.slice(last)
}

// LaTeX's cases is an array `@{}l@{\quad}l@{}`: every column left-aligned,
// a quad between columns. Typst's cases puts `&` columns right, left, right,
// ... with no gap, so mitex's `cases(x & x >= 0, ...)` reads "x x≥0". Each
// row x & y becomes `& x && quad y`: its cells in the left-aligned columns.
#let amp = $&$.body // an alignment point (Typst has no constructor for it)
#let latex-row(row) = {
  let kids = if type(row) == content and row.func() == [].func() { row.children } else { (row,) }
  let cells = ((),)
  for k in kids {
    if type(k) == content and k.func() == amp.func() { cells.push(()) } else { cells.last().push(k) }
  }
  let cells = cells.map(c => c.join())
  (amp, cells.first(), ..cells.slice(1).map(c => (amp, amp, h(1em), c)).flatten()).join()
}
#let latex-cases(..args) = math.cases(..args.named(), ..args.pos().map(latex-row))
#let latex-scope = mitex-scope + (
  cases: latex-cases,
  rcases: latex-cases.with(reverse: true),
  // mitex draws \lVert x \rVert as two bars "||"; LaTeX draws one ‖.
  lVert: math.class("opening", sym.bar.v.double),
  rVert: math.class("closing", sym.bar.v.double),
)

#let md-math = if safe {
  (src, block: false) => if block { raw(src, block: true, lang: "latex") } else { raw(src) }
} else {
  (src, block: false) => {
    let src = if type(src) == str { src } else { src.text }
    let typ = mitex-convert(latex-bars(src))
    let body = eval("$" + typ + "$", scope: latex-scope)
    let scaled(it) = { set text(size: (if block { display-scale } else { inline-scale }) * 1em); it }
    // The probe: inline math is one word, its LaTeX source, boxed as the
    // text's line (see the probe). The mark is in the equation, so it is
    // where the equation starts, also at the start of a wrapped line.
    if probe and not block { context {
      let asc = measure(text(bottom-edge: "baseline", "x")).height
      let h = measure(text("x")).height
      let w = measure(scaled(math.equation(block: false, body))).width
      let word = mark("w", dy: -asc, t: "$" + src + "$", w: w / 1pt, h: h / 1pt)
      scaled(math.equation(block: false, [#word#body]))
    } } else { scaled(math.equation(block: block, body)) }
  }
}

#let kbd(attrs, body) = box(
  stroke: px + C.border, inset: (x: 3pt, y: if on-grid { 0pt } else { 1pt }), outset: (y: if on-grid { -1pt } else { 1pt }), radius: 3pt,
  text(font: mono, size: 0.9em, body),
)

// ---------- the row grid: the page's rules (grid=1) ----------
// The rules of a page on the grid, over the rules above (the elements with
// their own grid branch above: headings, code blocks, quotes, tables, task
// lists, rules, images, live drawings, alt and kbd boxes).
#let grid-rules(body) = context {
  let g = grid-edges()
  // The line box's height above and below the baseline.
  let (asc, desc) = (g.top, -g.bottom)
  // Body text: line boxes of exactly g.rows rows (fixed edges, no leading),
  // one row between paragraphs and blocks. Any smaller text (inline code,
  // footnotes, sub- and superscripts) gets the same fixed edges, so it never
  // makes its line taller. The flow has the body text's phase (flow-half).
  set text(top-edge: g.top, bottom-edge: g.bottom, costs: half-costs(calc.even(g.rows)))
  show raw: set text(top-edge: g.top, bottom-edge: g.bottom)
  // Raised and lowered text (footnote numbers): x-height to baseline edges,
  // which stay inside the line box, so it never makes its line taller.
  show super: set text(top-edge: "x-height", bottom-edge: "baseline")
  show sub: set text(top-edge: "x-height", bottom-edge: "baseline")
  set par(leading: 0pt, spacing: row)
  set block(spacing: row)
  show table: set par(leading: 0pt)
  // No gap between list items (a loose list's items set one row: item-gap).
  set list(spacing: 0pt)
  set enum(spacing: 0pt)
  // Footnotes: the separator in the middle of a row of its own (the row
  // above it is the gap), and each entry is one line. An entry's own rule
  // gives it a leading of 0.5em; on the grid its lines are as far apart as
  // the text's (its smaller text has the body's fixed edges, so each of its
  // lines is g.rows rows too).
  show footnote.entry: set par(leading: 0pt)
  // Each paragraph and table cell in its phase (phase-pad), not a live
  // drawing's: in a flow of the body text's phase it does not move. A
  // footnote entry has the phase of the page's flow, whatever refers to it
  // (its lines are g.rows rows, and the separator and the entries are whole
  // rows under the flow), so it does not move either.
  show par: it => context if no-marks(text.costs) { it } else { in-phase(it) }
  show table.cell: in-phase
  show footnote.entry: set text(costs: half-costs(calc.even(g.rows)))
  set footnote.entry(
    clearance: 0pt, gap: 0pt,
    separator: block(height: row, align(horizon, line(length: 30%, stroke: px + C.border))),
  )
  // Inline math taller than the line box. The line box is the text's here
  // (a heading's is not the body's): its fixed edges, or the body's where
  // the edges are not lengths (raised and lowered text). Math ink at most
  // 0.15 row over an edge goes out of the line box, which keeps its height
  // (the ink then comes near the next line, not into its text); more ink
  // over an edge gives its line whole rows more above or below the text
  // (the text stays on its row). The math's baseline is always the text's.
  show math.equation.where(block: false): it => context {
    let (asc, desc) = if type(text.top-edge) == length and type(text.bottom-edge) == length {
      (text.top-edge.to-absolute(), -text.bottom-edge.to-absolute())
    } else { (asc, desc) }
    let big = 1000pt
    let a = measure([#text(top-edge: "baseline", bottom-edge: -big, sym.zwj)#box(it)]).height - big
    let d = measure([#text(top-edge: big, bottom-edge: "baseline", sym.zwj)#box(it)]).height - big
    if a <= asc and d <= desc { return it }
    // The line box above and below the baseline: the text's, or whole rows
    // more for an edge with more than the slack over it.
    let slack = 0.15 * row
    let up = if a <= asc + slack { asc } else { asc + calc.ceil((a - asc - slack) / row) * row }
    let down = if d <= desc + slack { desc } else { desc + calc.ceil((d - desc - slack) / row) * row }
    // The math with its baseline on the box's (the box's top is `up` over
    // the baseline, the math's top `a`), so its ink may go out of the box.
    box(width: measure(box(it)).width, height: up + down, baseline: down, place(top + left, dy: up - a, box(it)))
  }
  // Display math: centred in whole rows.
  show math.equation.where(block: true): it => context {
    block(width: 100%, height: rows-up(measure(it).height), above: row, below: row, align(horizon, it))
  }
  body
}

// ---------- render ----------
// The content of segment `i`; `scope` over the template's own functions.
#let render-md(md, i, math: md-math, scope: (:)) = cmarker.render(
  md,
  smart-punctuation: false,
  raw-typst: false,
  math: math,
  label-prefix: "s" + str(i) + "-",
  html: (
    img: ("void", html-img),
    a: html-a,
    table: html-table,
    td: html-cell,
    th: (attrs, body) => html-cell(attrs, strong(body)),
    tbody: (attrs, body) => [#metadata(("<tbody>", attrs))#body],
    kbd: kbd,
  ),
  scope: (
    image: md-image,
    raw: md-raw,
    ref: md-ref,
    link: md-link,
    list: md-list,
    enum: md-enum,
    rule: md-rule,
    ..scope,
  ),
)
// The footnotes in a content tree (not a reference to one: its body is a
// label).
#let notes-in(c) = if type(c) != content { 0 } else if c.func() == footnote {
  if type(c.body) == content { 1 + notes-in(c.body) } else { 0 }
} else {
  c.fields().values().map(v => if type(v) == array { v.map(notes-in).sum(default: 0) } else { notes-in(v) }).sum(default: 0)
}
// page=<n>: the footnotes of the segments before it (no drawing, math or
// image made), so its own have the numbers of the whole document.
#let notes-before = if only > 1 {
  let none-of(..args) = []
  segments.slice(0, calc.min(only - 1, segments.len())).enumerate().map(((i, seg)) => {
    notes-in(render-md(if type(seg) == str { seg } else { str(seg) }, i, math: (src, block: false) => [], scope: (image: none-of, raw: none-of)))
  }).sum(default: 0)
} else { 0 }

// The grid's rules are over the pages (not only their bodies), so the
// footnote entries, which a page lays out, have them too.
#show: body => if on-grid { grid-rules(body) } else { body }

// The two blocks of a seam as one flow less each alone: the gap between
// them (needs context). Its own label prefix, so no label is used twice.
#let seam-gap(seam) = {
  let h(md) = {
    let body = render-md(md, "seam")
    measure(block(width: content-w, if on-grid { heading-gaps(body) } else { body })).height
  }
  let (above, below) = seam.map(str)
  h(above + "\n\n" + below) - h(above) - h(below)
}

#for (i, seg) in segments.enumerate() {
  if only > 0 and i + 1 != only { continue }
  let md = if type(seg) == str { seg } else { str(seg) }
  let seam = seams.at(i, default: none)
  let seam = if i > 0 and type(seam) == array and seam.len() == 2 { seam } else { none }
  let body = render-md(md, i)
  // A page that continues the text has no heading row taken away at its top
  // (its gap above, from the seam, is the flow's).
  if on-grid { body = heading-gaps(body, page: seam == none) }
  if notes-before > 0 { body = { counter(footnote).update(notes-before); body } }
  // Pad the bottom so the page is a whole number of terminal rows.
  context {
    // On the grid, every page starts on a row (no top margin), or half a
    // row lower when the flow has the half-row phase (grid-rules).
    let half = on-grid and flow-half()
    let top = if on-grid { if half { row / 2 } else { 0pt } } else if i == 0 { first-top } else if seam != none { 0pt } else { margin-y }
    // A page that continues the text: the seam's gap above its first block,
    // less the half rows of this page's top and of the page above's bottom.
    let body = if seam == none { body } else { v(seam-gap(seam) - if half { row } else { 0pt }); body }
    // No bottom margin: text is measured to its descenders, so the last line
    // ends the page and the next row is the engine's own gap.
    let total = top + measure(block(width: content-w, body)).height
    let pad = if row > 0pt { calc.ceil(total / row - 0.001) * row - total } else { 0pt }
    page(margin: (top: top, bottom: pad), body)
  }
}
