## `git rebase main`, in one picture

Your branch's commits move onto the newest `main`. The history becomes one straight line.

```typst
#import "@preview/cetz:0.5.2"
#let u = calc.min(theme.width / 8.2, theme.height / 4.4)
#align(center, cetz.canvas(length: u, {
  import cetz.draw: *
  let (main, feat) = (theme.blue, theme.orange)
  let line-w = 0.08 * u
  let commit(p, name, col) = {
    circle(p, radius: 0.3, fill: col, stroke: none)
    content(p, text(fill: theme.bg, size: 0.27 * u, weight: "bold", font: theme.sans, name))
  }
  let tag(p, name, col) = content(p, box(fill: col.transparentize(82%), stroke: 0.06 * u + col,
    inset: (x: 0.12 * u, y: 0.07 * u), radius: 0.1 * u,
    text(fill: col, size: 0.22 * u, font: theme.mono, weight: "bold", name)))
  let label(y, body) = content((-0.6, y), anchor: "east", text(fill: theme.muted, size: 0.26 * u, body))

  // Before: feature leaves main at B; main has moved on to D.
  label(0, [before])
  line((0, 0), (3, 0), stroke: line-w + main)
  bezier((1, 0), (3, -0.9), (2, -0.9), (1.4, -0.9), stroke: line-w + feat)
  for (x, n) in ((0, "A"), (1, "B"), (2, "C"), (3, "D")) { commit((x, 0), n, main) }
  commit((2, -0.9), "E", feat)
  commit((3, -0.9), "F", feat)
  tag((3.9, 0), "main", main)
  tag((4.05, -0.9), "feature", feat)

  // The move.
  line((1.5, -1.45), (1.5, -2.15), stroke: line-w + theme.fg, mark: (end: ">", fill: theme.fg))
  content((1.75, -1.8), anchor: "west", text(size: 0.24 * u, font: theme.mono, fill: theme.fg)[git rebase main])

  // After: E and F are replayed on top of D, as new commits E′ and F′.
  label(-2.7, [after])
  line((0, -2.7), (3, -2.7), stroke: line-w + main)
  line((3, -2.7), (5, -2.7), stroke: line-w + feat)
  for (x, n) in ((0, "A"), (1, "B"), (2, "C"), (3, "D")) { commit((x, -2.7), n, main) }
  commit((4, -2.7), "E′", feat)
  commit((5, -2.7), "F′", feat)
  tag((3, -3.3), "main", main)
  tag((5, -3.3), "feature", feat)
}))
```

| | Merge | Rebase |
|:--|:--:|:--:|
| History | fork + merge commit | one straight line |
| Commit IDs | kept | new for your commits |
| Safe on a shared branch | yes | no, rewrites history |
