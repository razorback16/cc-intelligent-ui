// Intelligent UI: a page PNG cut into one PNG per terminal row, for picture
// select (hooks/lib/strips.ts). At --ppi 72, 1 pt is 1 pixel, so each strip
// is the page's own pixels, unscaled.
//
// typst compile --root / --ppi 72 --input src=<page.png> --input w=<px>
//   --input h=<px> --input row=<px> <render>/strips.typ <dir>/s-{0p}.png
#let src = sys.inputs.at("src")
#let w = int(sys.inputs.at("w"))
#let h = int(sys.inputs.at("h"))
#let row = int(sys.inputs.at("row"))
#set page(width: w * 1pt, height: row * 1pt, margin: 0pt, fill: none)
#let img = image(src, width: w * 1pt, height: h * 1pt, scaling: "pixelated")
#for k in range(calc.ceil(h / row)) {
  if k > 0 { pagebreak() }
  box(width: w * 1pt, height: row * 1pt, clip: true, place(dy: -k * row * 1pt, img))
}
