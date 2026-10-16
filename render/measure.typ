// Font metrics for the hooks module, read with
//   typst eval 'query(<m>).first().value' --in measure.typ --input term-font=<family>
// Per 1 em: `adv` the width of "0", `xh` the x-height, `avg` the mean
// advance over a lowercase pangram. `term` is none when the family is not
// installed (Typst would fall back to another font).
#import "fonts.typ": sans, mono-base
#let fam = sys.inputs.at("term-font", default: "")
#let probe = "the quick brown fox jumps over the lazy dog"
#let m(fonts, body, edge) = measure(text(
  font: fonts, size: 100pt, top-edge: edge, bottom-edge: "baseline", fallback: false, body,
))
#let metrics(fonts) = (
  adv: m(fonts, "0", "cap-height").width / 100pt,
  xh: m(fonts, "x", "x-height").height / 100pt,
  avg: m(fonts, probe, "cap-height").width / 100pt / probe.len(),
)
#context {
  let found = fam != "" and m((fam,), "0", "cap-height").width != m(("Nonexistent Font Zz",), "0", "cap-height").width
  [#metadata((
    term: if found { metrics((fam,)) } else { none },
    menlo: metrics(mono-base),
    body: metrics(sans),
  )) <m>]
}
