// Intelligent UI: the preview of a pasted image (the band above the prompt
// box), made to fill the cells it is drawn in. Compiled at 72 ppi, where 1 pt
// is 1 pixel.
//
// Inputs: f = the PNG's path in the root (/image.png: FILL_SH links it, and
// the root has only it and this file); maxw, maxh = the pixel size of its
// cells; fit = cover (the default) or contain. The page is exactly that
// size. With cover the image covers it (the aspect kept, centred, at most
// half a cell cut: fillFitOf in composer.tsx), so no empty cell area is left
// under or beside it; with contain all of it shows, centred, the rest clear.
#set page(width: auto, height: auto, margin: 0pt, fill: none)

#let num(key) = calc.max(1, float(sys.inputs.at(key, default: "1")))
#let (bw, bh) = (num("maxw"), num("maxh"))
#let fit = if sys.inputs.at("fit", default: "cover") == "contain" { "contain" } else { "cover" }

#box(width: bw * 1pt, height: bh * 1pt, clip: true, image(sys.inputs.at("f", default: ""), width: bw * 1pt, height: bh * 1pt, fit: fit))
