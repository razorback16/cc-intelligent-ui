## A Mandelbrot set, calculated in Typst

Typst calculates each pixel at render time: 4,000 cells and up to 50 iterations per cell.

```typst
#let W = 80
#let H = 50
#let maxit = 50
#let cell = calc.min(theme.width / W, theme.height / H)
#let grad = gradient.linear(..color.map.magma)
#let mandel(cx, cy) = {
  let x = 0.0
  let y = 0.0
  let i = 0
  while i < maxit and x * x + y * y <= 4.0 {
    let xt = x * x - y * y + cx
    y = 2.0 * x * y + cy
    x = xt
    i += 1
  }
  i
}
#align(center, grid(
  columns: (cell,) * W,
  rows: (cell,) * H,
  gutter: 0pt,
  ..for j in range(H) {
    for i in range(W) {
      let n = mandel(-2.2 + 3.2 * i / W, -1.0 + 2.0 * j / H)
      let c = if n == maxit { black } else {
        grad.sample((0.12 + 0.88 * calc.sqrt(n / maxit)) * 100%)
      }
      (box(width: cell, height: cell, fill: c),)
    }
  }
))
```
