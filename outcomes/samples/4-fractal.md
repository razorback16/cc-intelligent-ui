## Recursive fractal tree and Lissajous curve (CeTZ)

The tree is a recursive function with 2,047 branches. The curve has 720 segments, each with its own color.

```typst
#import "@preview/cetz:0.5.2"
#let g = gradient.linear(theme.orange, theme.green)
#let rb = gradient.linear(..color.map.rainbow)
#align(center, cetz.canvas(length: theme.height / 7.5, {
  import cetz.draw: *
  let tree(x, y, ang, len, d) = {
    if d > 0 {
      let x2 = x + len * calc.cos(ang)
      let y2 = y + len * calc.sin(ang)
      line((x, y), (x2, y2),
        stroke: (paint: g.sample((11 - d) * 10%), thickness: d * 0.35pt, cap: "round"))
      tree(x2, y2, ang + 22deg, len * 0.74, d - 1)
      tree(x2, y2, ang - 28deg, len * 0.70, d - 1)
    }
  }
  tree(0, 0, 90deg, 1.6, 11)

  let N = 720
  let pt(k) = {
    let t = 2 * calc.pi * k / N
    (10 + 3 * calc.sin(3 * t + calc.pi / 2), 3.2 + 3 * calc.sin(4 * t))
  }
  for k in range(N) {
    line(pt(k), pt(k + 1),
      stroke: (paint: rb.sample(k / N * 100%), thickness: 1.4pt, cap: "round"))
  }
}))
```
