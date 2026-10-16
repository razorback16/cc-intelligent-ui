// md-preview: draws Markdown segments like VS Code's Markdown preview
// (the colours come from the theme). One segment = one page = one PNG.
//
// typst compile --root / --package-path <render>/packages --format png --ppi <ppi>
//   --input theme=dark|light --input width=<page width in pt>
//   --input doc=<absolute path of JSON> [--input safe=1]
//   --input theme-dir=<absolute theme folder> (themes/README.md; merged over vscode)
//   <render>/md.typ <outdir>/<a|b>-{0p}.png
//
// doc JSON: { "base": "/dir/for/relative/images", "segments": ["md", ...],
//             "images": ["/abs/path.png", ...] (optional allow-list) }
//
// safe=1: the retry mode after a failed compile. `typst` fences are shown as
// code (no eval), math is shown as code (no mitex), images are alt boxes.

#import "@preview/cmarker:0.1.6"
#import "@preview/mitex:0.2.7": mitex

// ---------- inputs ----------
#let inp = sys.inputs
#let dark = inp.at("theme", default: "dark") != "light"
#let safe = inp.at("safe", default: "0") not in ("", "0", "false", "no", "off")
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
// Code size as a fraction of the body text (the hooks module sets it so code
// in the terminal's font is the terminal's own size).
#let code-scale = float(inp.at("code", default: "0.9"))
#let doc = if "doc" in inp { json(inp.doc) } else {
  (base: "", segments: ("*md-preview:* no `doc` input given.",))
}
#let base = str(doc.at("base", default: ""))
#let allow = doc.at("images", default: none)
#let segments = doc.at("segments", default: ())
#if type(segments) == str { segments = (segments,) }
#if segments.len() == 0 { segments = ("",) }

// ---------- theme ----------
// Colours, fonts and element sizes come from the active theme
// (theme.typ reads themes/<name>/theme.json, merged over themes/vscode).
// Theme keys named *-px are CSS px of VS Code's preview (14px body) at our
// 11pt body; *-em are em of the element's own text.
#import "theme.typ": T, C, syntax, at-level
#let px = 11pt / 14
// The font lists live in fonts.typ, which render/measure.typ reads too.
#import "fonts.typ": sans, mono-base
// The terminal's own font first for code, so code looks like the terminal
// (unless the theme sets fonts.use-terminal-font to false).
#let term-font = inp.at("term-font", default: "")
#let mono = if term-font != "" and T.fonts.use-terminal-font { (term-font,) + mono-base } else { mono-base }
#let content-w = page-w - margin-left - margin-right
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
  page-width: page-w,
  text-size: 11pt,
  sans: sans,
  mono: mono,
)

// ---------- page and text ----------
#set document(title: "md-preview")
#set page(width: page-w, height: auto, margin: (left: margin-left, right: margin-right, y: margin-y), fill: none)
// CSS-like line boxes: line-height 22px at 14px.
#set text(
  font: sans, size: 11pt, fill: C.fg, hyphenate: false, lang: "en",
  top-edge: "ascender", bottom-edge: "descender",
)
#set par(leading: E.text.leading-em * 1em, spacing: E.text.paragraph-em * 1em, justify: false)
#set block(spacing: E.text.paragraph-em * 1em)

// ---------- headings ----------
#set heading(numbering: none)
#show heading: it => {
  let lvl = calc.min(it.level, 6)
  let H = E.heading
  let size = at-level(H.size-em, lvl - 1) * 1em
  let above = at-level(H.above-em, lvl - 1) * 11pt
  let below = at-level(H.below-em, lvl - 1) * 11pt
  set text(size: size, weight: H.weight)
  set par(leading: H.leading-em * 1em)
  if lvl <= H.rule-levels {
    block(
      width: 100%, above: above, below: below, sticky: true,
      inset: (bottom: H.rule-pad-em * 1em), stroke: (bottom: px + C.border),
      it.body,
    )
  } else {
    block(width: 100%, above: above, below: below, sticky: true, it.body)
  }
}

// ---------- links, emphasis ----------
#show link: set text(fill: C.link)
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
#set enum(
  numbering: "1.",
  indent: E.list.number-indent-em * 1em, body-indent: E.list.number-gap-em * 1em, spacing: E.list.item-spacing-em * 1em,
)

// ---------- code ----------
#set raw(theme: syntax(), tab-size: 4)
// Typst shrinks raw text to 0.8em by default, hence the / 0.8.
#show raw: set text(font: mono, top-edge: "ascender", bottom-edge: "descender")
#show raw.where(block: false): set text(size: code-size(E.inline-code.size) / 0.8 * 1em)
#show raw.where(block: true): set text(size: code-size(E.code-block.size) / 0.8 * 1em)
// Inline code: like VS Code's `code { padding: 1px 3px; border-radius: 4px }`,
// the background covers the code font's ascender to descender plus the
// padding. highlight (not box) so long inline code can wrap across lines.
#show raw.where(block: false): it => context {
  let IC = E.inline-code
  let asc = measure(text(top-edge: "ascender", bottom-edge: "baseline", "x")).height
  let desc = measure(text(top-edge: "baseline", bottom-edge: "descender", "x")).height
  let pad-x = IC.pad-x-px * px
  let pad-y = IC.pad-y-px * px
  h(pad-x)
  highlight(
    fill: C.inline-code-bg, extent: pad-x, radius: IC.radius-px * px,
    top-edge: asc + pad-y, bottom-edge: -(desc + pad-y),
    text(fill: C.inline-code-fg, it),
  )
  h(pad-x)
}
// Code blocks: VS Code's `pre` (padding 16px, radius 3px, 1px border) with
// `code { line-height: 1.357em }`.
#show raw.where(block: true): it => context {
  let CB = E.code-block
  let area = measure(text(top-edge: "ascender", bottom-edge: "descender", "x")).height
  set par(leading: calc.max(0pt, CB.line-height * text.size - area), justify: false)
  block(
    width: 100%, fill: C.code-bg, stroke: CB.border-px * px + C.code-border,
    radius: CB.radius-px * px, inset: CB.pad-px * px, above: 1.2em, below: 1.2em,
    text(fill: C.code-fg, it),
  )
}

// ---------- block quotes ----------
#show quote.where(block: true): it => {
  let Q = E.quote
  block(
    width: 100%, fill: C.quote-bg, radius: Q.radius-px * px,
    stroke: (left: Q.bar-px * px + C.quote-border),
    inset: (left: (Q.pad-left-px + Q.bar-px) * px, right: Q.pad-right-px * px, y: Q.pad-y-em * 1em),
    it.body,
  )
}

// ---------- tables ----------
#set table(
  inset: (x: E.table.pad-x-px * px, y: E.table.pad-y-px * px),
  stroke: (x, y) => if y == 1 { (top: E.table.border-px * px + C.th-border) } else if y > 1 { (top: E.table.border-px * px + C.border) },
)
#show table.cell.where(y: 0): set text(weight: E.table.header-weight)
#show table: set par(leading: 0.38em)

// ---------- footnotes ----------
#set footnote.entry(separator: line(length: 30%, stroke: px + C.border), gap: 0.5em)
#show footnote.entry: set text(size: 0.9em, fill: C.muted)

// ---------- long words, URLs and paths must wrap ----------
// A token of 30+ non-space characters gets break chances after each
// character, so it wraps like CSS `word-wrap: break-word` instead of
// running off the page.
#show regex("\S{30,}"): it => it.text.clusters().join(sym.zws)

// ---------- helpers ----------
#let alt-box(alt, why: none) = box(
  stroke: px + C.muted, inset: (x: 4pt, y: 1.5pt), outset: (y: 1pt), radius: 3pt,
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
    image(full, width: w, alt: alt)
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

#let md-rule() = block(above: E.rule.gap-em * 1em, below: E.rule.gap-em * 1em, line(length: 100%, stroke: E.rule.border-px * px + C.border))

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

#let md-list(..args) = {
  let items = args.pos()
  let tasks = items.map(task-split)
  if tasks.all(t => t == none) { return list(..args) }
  if tasks.all(t => t != none) {
    // GitHub-style: no bullet, the checkbox sits where the bullet would.
    let rows = tasks.map(t => (
      align(right, checkbox(t.at(0))),
      t.at(1),
    ))
    pad(left: 0.45em, grid(
      columns: (1.4em, 1fr), column-gutter: 0.55em, row-gutter: 0.38em + 0.15em,
      ..rows.flatten(),
    ))
  } else {
    list(..args.named(), ..items.zip(tasks).map(((it, t)) => if t == none { it } else {
      [#checkbox(t.at(0)) #t.at(1)]
    }))
  }
}

// "1. [x] done": keep the number, put the checkbox after it.
#let md-enum(..args) = {
  let items = args.pos().map(it => {
    let t = task-split(it)
    if t == none { it } else { [#checkbox(t.at(0)) #t.at(1)] }
  })
  enum(..args.named(), ..items)
}

// ---------- ```typst fences: live Typst ----------
#let live-langs = ("typst", "typ")
#let md-raw(src, block: false, lang: none, ..args) = {
  let l = if lang == none { "" } else { lower(str(lang).trim()) }
  if block and not safe and l in live-langs {
    // Inside a block, so #pagebreak() and #set page() are errors (one
    // segment must stay one page); a column break is dropped.
    std.block(width: 100%, above: 1.2em, below: 1.2em, {
      show colbreak: none
      eval(src, mode: "markup", scope: (theme: theme))
    })
  } else if block and safe and l in live-langs {
    // Retry mode: show the source, with a note that it was not drawn.
    std.block(above: 1.2em, below: 0pt, sticky: true,
      text(size: 0.85em, fill: C.muted, style: "italic")[Typst source (not drawn: the answer failed to compile)])
    raw(src, block: true, lang: "typst")
  } else {
    raw(src, block: block, lang: lang, ..args)
  }
}

// ---------- math ----------
#let md-math = if safe {
  (src, block: false) => if block { raw(src, block: true, lang: "latex") } else { raw(src) }
} else { mitex }

#let kbd(attrs, body) = box(
  stroke: px + C.border, inset: (x: 3pt, y: 1pt), outset: (y: 1pt), radius: 3pt,
  text(font: mono, size: 0.9em, body),
)

// ---------- render ----------
#for (i, seg) in segments.enumerate() {
  let md = if type(seg) == str { seg } else { str(seg) }
  let top = if i == 0 { first-top } else { margin-y }
  let body = cmarker.render(
    md,
    smart-punctuation: false,
    raw-typst: false,
    math: md-math,
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
    ),
  )
  // Pad the bottom so the page is a whole number of terminal rows.
  context {
    // No bottom margin: text is measured to its descenders, so the last line
    // ends the page and the next row is the engine's own gap.
    let total = top + measure(block(width: content-w, body)).height
    let pad = if row > 0pt { calc.ceil(total / row - 0.001) * row - total } else { 0pt }
    page(margin: (top: top, bottom: pad), body)
  }
}
