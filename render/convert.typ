// Intelligent UI: makes a PNG of a JPEG or WebP (the engine's Image draws PNG
// only). Compiled at 72 ppi, where 1 pt is 1 pixel.
//
// Inputs: f = the image's absolute path (with --root /); maxw, maxh = the
// box in pixels the PNG must fit (0 or absent: no limit on that side).
//
// Typst sizes an image by its own DPI (a 300 dpi JPEG is drawn at a quarter
// of its pixels), so the pixel size is read from the file and set as the
// width. A file it can not read keeps Typst's size.
#set page(width: auto, height: auto, margin: 0pt)

#let f = sys.inputs.at("f", default: "")
#let data = read(f, encoding: none)
#let at(i) = if i < data.len() { data.at(i) } else { 0 }
#let be16(i) = at(i) * 256 + at(i + 1)
#let le16(i) = at(i) + at(i + 1) * 256
#let le24(i) = le16(i) + at(i + 2) * 65536
#let has-tag(i, tag) = data.len() >= i + tag.len() and data.slice(i, i + tag.len()) == bytes(tag)

// A JPEG's (width, height): from the first SOF marker.
#let jpeg-size() = {
  let sofs = (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf)
  let i = 2
  let size = none
  while size == none and i + 9 <= data.len() and at(i) == 0xff {
    let m = at(i + 1)
    if m == 0xff { i += 1 }
    else if m in sofs { size = (be16(i + 7), be16(i + 5)) }
    else { i += 2 + be16(i + 2) }
  }
  size
}

// A WebP's (width, height): from its VP8, VP8L or VP8X chunk.
#let webp-size() = {
  if has-tag(12, "VP8 ") { (calc.rem(le16(26), 16384), calc.rem(le16(28), 16384)) }
  else if has-tag(12, "VP8L") {
    let (b0, b1, b2, b3) = (at(21), at(22), at(23), at(24))
    (1 + b0 + calc.rem(b1, 64) * 256, 1 + calc.quo(b1, 64) + b2 * 4 + calc.rem(b3, 16) * 1024)
  } else if has-tag(12, "VP8X") { (1 + le24(24), 1 + le24(27)) }
}

#let size = if has-tag(0, "RIFF") and has-tag(8, "WEBP") { webp-size() } else if at(0) == 0xff and at(1) == 0xd8 { jpeg-size() }

// The sides as drawn: the pixel size, swapped when Typst turns the image by
// its EXIF orientation; else Typst's own size. Then it fits the box, the
// aspect kept; an image is never made larger.
#context {
  let natural = measure(image(data))
  let (w, h) = if size == none or size.at(0) == 0 or size.at(1) == 0 { (natural.width / 1pt, natural.height / 1pt) } else { size }
  let turned = w != h and (natural.width > natural.height) != (w > h)
  let (dw, dh) = if turned { (h, w) } else { (w, h) }
  let side(key) = int(sys.inputs.at(key, default: "0"))
  let (maxw, maxh) = (side("maxw"), side("maxh"))
  let scale = calc.min(1, if maxw > 0 { maxw / dw } else { 1 }, if maxh > 0 { maxh / dh } else { 1 })
  image(data, width: dw * scale * 1pt)
}
