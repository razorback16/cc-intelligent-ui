## Candlestick chart (CeTZ)

Two weeks of a stock's prices, with a 3-day moving average and the volume under it:

```typst
#import "@preview/cetz:0.5.2"
#let ohlc = ((101, 106, 99, 104), (104, 108, 103, 107), (107, 107, 101, 102), (102, 104, 97, 98),
  (98, 103, 96, 102), (102, 109, 101, 108), (108, 112, 106, 110), (110, 111, 104, 105),
  (105, 107, 100, 101), (101, 106, 100, 105))
#let vol = (3.1, 3.8, 4.6, 5.2, 3.9, 6.1, 5.4, 4.8, 4.2, 3.6)
#let (W, H, V) = (14, 3.4, 0.9)
#let (lo, hi) = (95, 114)
#let y(p) = V + 0.4 + (p - lo) / (hi - lo) * H
#let dx = W / ohlc.len()
#let ma = range(2, ohlc.len()).map(i => (ohlc.at(i - 2).at(3) + ohlc.at(i - 1).at(3) + ohlc.at(i).at(3)) / 3)
#set text(fill: theme.fg, size: 9pt)
#align(center, cetz.canvas(length: theme.width / (W + 3), {
  import cetz.draw: *
  for p in range(lo + 5, hi + 1, step: 5) {
    line((0, y(p)), (W, y(p)), stroke: theme.border + 0.5pt)
    content((-0.2, y(p)), text(fill: theme.muted, size: 0.85em, "$" + str(p)), anchor: "east")
  }
  for (i, (o, h, l, c)) in ohlc.enumerate() {
    let x = (i + 0.5) * dx
    let col = if c >= o { theme.green } else { theme.red }
    line((x, y(l)), (x, y(h)), stroke: col + 1pt)
    rect((x - dx * 0.3, y(calc.min(o, c))), (x + dx * 0.3, y(calc.max(o, c))), fill: col, stroke: none)
    rect((x - dx * 0.3, 0), (x + dx * 0.3, vol.at(i) / 6.1 * V), fill: col.transparentize(55%), stroke: none)
    content((x, -0.2), text(fill: theme.muted, size: 0.8em, "D" + str(i + 1)), anchor: "north")
  }
  line(..ma.enumerate().map(((i, m)) => ((i + 2.5) * dx, y(m))), stroke: theme.accent + 1.4pt)
  content((W + 0.2, y(ma.last())), text(fill: theme.accent, size: 0.85em)[3-day MA], anchor: "west")
  content((W + 0.2, V / 2), text(fill: theme.muted, size: 0.85em)[volume], anchor: "west")
}))
```

The best day is D6: it opens at 102 and closes at 108, **+5.9%**.
