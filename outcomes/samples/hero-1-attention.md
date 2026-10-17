## How attention works, in one picture

Each word asks every earlier word: *how much should I listen to you?* The row for **it** looks back at **cat**. That is how the model knows what *it* means.

$$\mathrm{Attention}(Q, K, V) = \mathrm{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right) V$$

```typst
#let words = ("The", "cat", "sat", "on", "the", "mat", "because", "it", "was", "tired")
#let n = words.len()
// Raw scores q·k/√d for a few strong links; every other earlier word scores 0.
#let strong = ((1, 0, 1.2), (2, 1, 2.4), (3, 2, 2.0), (4, 3, 1.6), (5, 4, 2.2), (5, 2, 1.0),
  (6, 2, 1.8), (7, 1, 3.6), (7, 5, 1.1), (8, 7, 2.6), (9, 1, 2.3), (9, 7, 1.7))
#let score(i, j) = strong.find(s => s.at(0) == i and s.at(1) == j)
#let weights = range(n).map(i => {
  // softmax over the words up to i (a causal mask hides the later ones)
  let e = range(i + 1).map(j => { let s = score(i, j); calc.exp(if s == none { 0.0 } else { s.at(2) }) })
  let z = e.sum()
  range(n).map(j => if j <= i { e.at(j) / z } else { none })
})
#let label-w = 0.17 * theme.width
#let cell = calc.min((theme.width - label-w) / n, theme.height / (n + 1.7))
#let heat = gradient.linear(theme.bg, theme.purple.lighten(20%), theme.orange)
#let small = text.with(size: 0.3 * cell, fill: theme.muted)
#align(center, grid(
  columns: (label-w,) + (cell,) * n,
  rows: (auto,) + (cell,) * n,
  align: (x, y) => if x == 0 { right + horizon } else { center + bottom },
  [], ..words.map(w => box(height: 1.6 * cell, align(bottom, rotate(-55deg, reflow: true, small(w))))),
  ..for i in range(n) {
    (pad(right: 0.2 * cell, text(size: 0.34 * cell, weight: if i == 7 { "bold" } else { "regular" },
      fill: if i == 7 { theme.orange } else { theme.fg }, words.at(i))),)
    for j in range(n) {
      let w = weights.at(i).at(j)
      (if w == none { box(width: cell, height: cell) } else {
        let c = heat.sample(100% * calc.min(1, 0.06 + 1.1 * w))
        box(width: cell, height: cell, inset: 0.04 * cell, box(width: 100%, height: 100%, radius: 0.12 * cell, fill: c,
          stroke: if i == 7 and j == 1 { 0.07 * cell + theme.fg } else { none },
          align(center + horizon, if w > 0.3 { text(size: 0.26 * cell, fill: white, weight: "bold", str(calc.round(w * 100)) + "%") })))
      },)
    }
  }
))
```

- $Q$, the **query**: what this word looks for
- $K$, the **key**: what each word offers
- $V$, the **value**: what it passes on when it is chosen
