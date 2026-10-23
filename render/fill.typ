// Intelligent UI: the preview of a pasted image (the band above the prompt
// box), made to fill the cells it is drawn in. Compiled at 72 ppi, where 1 pt
// is 1 pixel.
//
// Inputs: f = the PNG's path in the root (/image.png: FILL_SH links it, and
// the root has only it and this file); maxw, maxh = the pixel size of its
// cells. The page is exactly that, and the image covers it (the aspect kept,
// centred, under half a cell cut on one side), so no empty cell area is left
// under or beside it.
#set page(width: auto, height: auto, margin: 0pt)

#let num(key) = calc.max(1, float(sys.inputs.at(key, default: "1")))
#let (bw, bh) = (num("maxw"), num("maxh"))

#box(width: bw * 1pt, height: bh * 1pt, clip: true, image(sys.inputs.at("f", default: ""), width: bw * 1pt, height: bh * 1pt, fit: "cover"))
