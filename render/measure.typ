// Font metrics for the hooks module, read with
//   typst eval 'query(<m>).first().value' --in measure.typ --input term-font=<family>
// Per 1 em: `adv` the width of "0", `xh` the x-height (the ink of "x":
// fonts with no OS/2 x-height, such as DejaVu Sans Mono, give Typst's
// ascender there; the metric only when "x" has no ink), `avg` the mean
// advance over a lowercase pangram. `term` is none when the family is not
// installed (Typst would fall back to another font).
//
// `grid`: what the hooks module finds the row of a page's first line from
// (the bullet's, with grid=1). `body` and `heading` (h1 to h6) the `need` of
// a line in pt (line-ink); `code` the code font's per pt of its size, and
// `code-size` that size in body text (none: the `code` input); `pad` the
// padding in pt over the first line of a quote, a code block and a table
// cell (md.typ rounds it to whole rows); `table-style` the theme's
// table.style ("grid" or "rules").
//
// `fonts`: the theme's `body` and `code` font lists (merged over vscode),
// and `plain`: its list markers and numbering are ASCII only (fonts.ts uses
// the lean font set only then).
#import "fonts.typ": sans, mono-base, line-ink
#import "theme.typ": T, at-level
#let fam = sys.inputs.at("term-font", default: "")
#let probe = "the quick brown fox jumps over the lazy dog"
#let is-ascii(v) = type(v) != str or v.match(regex("^[ -~]*$")) != none
#let m(fonts, body, edge) = measure(text(
  font: fonts, size: 100pt, top-edge: edge, bottom-edge: "baseline", fallback: false, body,
))
#let metrics(fonts) = {
  let ink = m(fonts, "x", "bounds").height
  (
    adv: m(fonts, "0", "cap-height").width / 100pt,
    xh: (if ink > 0pt { ink } else { m(fonts, "x", "x-height").height }) / 100pt,
    avg: m(fonts, probe, "cap-height").width / 100pt / probe.len(),
  )
}
// The text as md.typ sets it: the body, a heading (in Typst's own heading
// rule, which makes h1 1.4em and h2 1.2em) and code (md.typ's `mono`).
#set text(font: sans, size: 11pt)
#show heading: it => {
  set text(size: at-level(T.heading.size-em, calc.min(it.level, 6) - 1) * 1em, weight: T.heading.weight)
  context [#metadata(line-ink().need / 1pt)<mh>]
}
#for level in range(1, 7) { heading(level: level, []) }
#{
  set text(font: if fam != "" and T.fonts.use-terminal-font { (fam,) + mono-base } else { mono-base }, size: 100pt)
  context [#metadata(line-ink().need / 100pt)<mc>]
}
#context {
  let found = fam != "" and m((fam,), "0", "cap-height").width != m(("Nonexistent Font Zz",), "0", "cap-height").width
  let px = 11 / 14
  [#metadata((
    term: if found { metrics((fam,)) } else { none },
    menlo: metrics(mono-base),
    body: metrics(sans),
    grid: (
      body: line-ink().need / 1pt,
      heading: query(<mh>).map(h => h.value),
      code: query(<mc>).first().value,
      code-size: if type(T.code-block.size) in (int, float) { float(T.code-block.size) } else { none },
      pad: (quote: T.quote.pad-y-em * 11, code: T.code-block.pad-px * px, table: T.table.pad-y-px * px),
      table-style: if T.table.style == "grid" { "grid" } else { "rules" },
    ),
    fonts: (body: sans, code: mono-base, plain: (T.list.markers + (T.list.numbering,)).all(is-ascii)),
  )) <m>]
}
