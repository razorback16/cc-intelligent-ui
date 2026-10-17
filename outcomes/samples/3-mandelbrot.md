## A Mandelbrot set, calculated in Typst

Typst calculates each pixel at render time: 100,000 pixels, up to 120 iterations each, with smooth colouring.

```typst
#let W = 400
#let H = 250
#let maxit = 120
// 256 magma colours as RGB bytes, so a pixel is one lookup.
#let grad = gradient.linear(..color.map.magma)
#let lut = range(256).map(k => grad.sample(k / 255 * 100%)
  .rgb().components().slice(0, 3).map(v => int(calc.round(v / 100% * 255))))
#let px = ()
#for j in range(H) {
  let cy = -1.0 + 2.0 * j / (H - 1)
  for i in range(W) {
    let cx = -2.2 + 3.2 * i / (W - 1)
    let (x, y, n) = (0.0, 0.0, 0)
    while n < maxit and x * x + y * y <= 65536.0 {
      (x, y) = (x * x - y * y + cx, 2.0 * x * y + cy)
      n += 1
    }
    px += if n == maxit { (0, 0, 0) } else {
      // A fractional escape count: no colour bands.
      let nu = n + 1 - calc.log(calc.ln(x * x + y * y) / 2, base: 2)
      lut.at(calc.clamp(int(255 * (0.08 + 0.92 * calc.ln(calc.max(nu, 1)) / calc.ln(maxit))), 0, 255))
    }
  }
}
#align(center, image(bytes(px), format: (encoding: "rgb8", width: W, height: H),
  width: calc.min(theme.width, theme.height * W / H)))
```
