## Flow diagram (fletcher): an agent loop

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#set text(fill: theme.fg, size: 10pt)
#align(center, diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg,
  spacing: (18mm, 12mm), node-corner-radius: 4pt, node-inset: 8pt,
  node((0, 0), [User prompt], fill: theme.blue.transparentize(70%)),
  edge("-|>"),
  node((1, 0), [*Model*], fill: theme.purple.transparentize(65%), shape: fletcher.shapes.hexagon),
  edge("-|>", [tool call], label-side: left),
  node((2, 0), [Tool], fill: theme.orange.transparentize(70%)),
  edge((2, 0), (1, 0), "-|>", [result], bend: 50deg),
  edge((1, 0), (1, 1), "-|>", [done]),
  node((1, 1), [Answer], fill: theme.green.transparentize(70%), shape: fletcher.shapes.pill),
  edge((2, 0), (2, 1), "--|>", [log]),
  node((2, 1), [Memory], fill: theme.yellow.transparentize(70%), shape: fletcher.shapes.cylinder),
))
```

## Commutative diagram: the First Isomorphism Theorem

Plain LaTeX math cannot draw this diagram. Fletcher draws it from math-mode syntax:

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#set text(fill: theme.fg, size: 12pt)
#align(center, diagram(
  edge-stroke: theme.fg, cell-size: 15mm,
  $
    G edge(f, ->) edge("d", pi, ->>) & im(f) \
    G slash ker(f) edge("ur", tilde(f), "hook-->")
  $
))
```
