### How `auto` finds the mode

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#set text(fill: theme.fg, size: 10pt)
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg, spacing: (14mm, 9mm),
  node-corner-radius: 4pt,
  node((0, 0), [Claude Code\ theme = auto], fill: theme.accent.transparentize(75%)),
  edge("-|>"),
  node((1, 0), [Terminal config\ iTerm2 · Ghostty · kitty · Rio · cmux], fill: theme.blue.transparentize(75%)),
  edge("-|>", [none]),
  node((2, 0), [COLORFGBG], fill: theme.purple.transparentize(75%)),
  edge("-|>", [none]),
  node((3, 0), [OS appearance], fill: theme.orange.transparentize(75%)),
  edge((1, 0), (1, 1), "-|>", [found], label-side: left),
  node((1, 1), [light / dark], fill: theme.green.transparentize(70%)),
  edge((2, 0), (1, 1), "-|>"),
  edge((3, 0), (1, 1), "-|>"),
)
```

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#set text(fill: theme.fg, size: 9pt)
#cetz.canvas({
  import cetz.draw: *
  set-style(axes: (stroke: theme.fg, tick: (stroke: theme.fg)), legend: (fill: theme.bg, stroke: theme.border))
  plot.plot(size: (11, 4.2), x-label: [sRGB channel value], y-label: [linear value],
    legend: "inner-north-west", {
    plot.add(domain: (0, 1), samples: 80,
      x => if x <= 0.04045 { x / 12.92 } else { calc.pow((x + 0.055) / 1.055, 2.4) },
      style: (stroke: 2pt + theme.blue), label: [sRGB decode])
    plot.add(domain: (0, 1), x => x, style: (stroke: (paint: theme.muted, dash: "dashed")), label: [identity])
    plot.add-hline(0.4, style: (stroke: 1pt + theme.orange), label: [light cut-off])
  })
})
```
