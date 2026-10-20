# fletcher 0.5.8: diagrams with nodes and arrows

fletcher draws flow charts, pipelines, state machines, block diagrams, trees and commutative diagrams
on an elastic grid. Facts here come from the vendored source (`render/packages/preview/fletcher/0.5.8/src/`).
Every ```` ```typst ```` example was compiled with the real template in dark and light and checked by eye.

Contents
1. Start here: the safe skeleton
2. `diagram()` parameters
3. `node()` parameters and shapes
4. `edge()` parameters, marks and flags
5. Coordinates, names, paths
6. Groups (`enclose`) and layers
7. Wide and short layouts
8. Recipes: pipeline + feedback, decision flow, state machine, architecture groups, sequence lanes, tree, commutative diagrams, network, parallel edges, coordinate forms
9. Traps and fletcher error messages

## 1. Start here: the safe skeleton

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg,  // defaults: no node outline, black edges
  node-shape: rect,                              // auto makes short labels circles
  crossing-fill: theme.bg,                       // default is white: white boxes on dark
  spacing: (3em, 1.5em),                         // (between columns, between rows)
  node((0, 0), [A], name: <a>, fill: theme.blue.transparentize(80%)),
  node((1, 0), [B], name: <b>),
  edge(<a>, <b>, "->", [label]),
)
```

`as fletcher` keeps `fletcher.shapes.*` reachable. `diagram`, `node`, `edge` must be imported in **each** block.

## 2. `diagram()` parameters

| Parameter | Default | Notes |
|---|---|---|
| `spacing` | `3em` | gap between bounding boxes of adjacent rows/columns; `(x, y)` pair |
| `cell-size` | `0pt` | minimum row/column size, centre to centre; `(w, h)` pair; use it to fill `theme.width` |
| `node-stroke` | `none` | default node outline; pass `theme.fg` |
| `node-fill` | `none` | default node fill |
| `node-shape` | `auto` | `auto` = circle when the label is roundish (aspect < 1.5), else rect |
| `node-inset` | `6pt` | padding inside nodes |
| `node-outset` | `0pt` | gap between node and edge ends |
| `node-corner-radius` | `none` | rounded rects |
| `node-defocus` | `0.2` | how edges aim at wide nodes; `0` = at the centre |
| `edge-stroke` | `0.048em` (black) | pass `theme.fg`; marks scale with its thickness |
| `edge-corner-radius` | `2.5pt` | rounding of poly-edge corners |
| `label-sep` | `0.4em` | gap between edge and label |
| `label-size` | `1em` | edge label text size |
| `label-wrapper` | box with `label-fill` | function `edge => content` |
| `mark-scale` | `100%` | arrowhead size |
| `crossing-fill` | `white` | fill behind `crossing` edges and `label-side: center` labels: pass `theme.bg` |
| `crossing-thickness` | `5` | gap width, in stroke widths |
| `axes` | `(ltr, ttb)` | y grows downwards; `(ltr, btt)` for maths-style |
| `debug` | `false` | `1` shows the grid, `2`–`3` boxes and anchors |
| `render` | cetz canvas | `(grid, nodes, edges, options) => …` for custom drawing |

Positional arguments are nodes and edges; arrays and `{ … }` code blocks of them work, so build them with `for` and `.map()` and spread with `..`.

## 3. `node()` parameters and shapes

`node(pos, label, ..)`: up to two positional arguments. One positional argument that is an array, dictionary or label is the position.

| Parameter | Notes |
|---|---|
| `pos` | `(x, y)` elastic, `<name>`, `(rel: (dx, dy), to: <name>)` |
| `label` | content; `align(top + left)[…]` places it in a larger node |
| `name` | a label `<id>`, or a string (converted). `label("w" + str(i))` makes names in loops |
| `width`, `height` | fixed size; else label + 2 × inset |
| `radius` | fixed circle radius (does not grow with the label) |
| `inset`, `outset`, `fill`, `stroke`, `corner-radius`, `shape`, `defocus` | per-node overrides |
| `extrude` | extra outlines: `(0, 3)` double, `(0, -3)` inner ring (accept state); numbers = stroke widths |
| `enclose` | positions/names to surround (a group box); the node's own `pos` is then ignored |
| `layer` | draw order; `enclose` nodes default to `-1` (behind) |
| `snap` | edge snapping priority; `false` = edges never snap to it |

`stroke: none` makes a text-only node. A node with `[]` and `stroke: none` is an invisible anchor (an entry arrow start).

Shapes (`fletcher.shapes.*`, pass the function: `shape: fletcher.shapes.diamond`): `rect`, `circle`, `ellipse`, `pill`,
`diamond`, `hexagon`, `octagon`, `cylinder` (database), `parallelogram`, `trapezium`, `triangle`, `house`, `chevron`,
`brace`, `bracket`, `paren`. Options with `.with(…)`: `diamond.with(fit: 0.5)`, `cylinder.with(tilt: 8deg, rings: 4pt)`,
`triangle.with(dir: top)`, `chevron.with(dir: right)`, `parallelogram.with(angle: 20deg)`, `brace.with(dir: bottom, label: […])`.
The plain functions `rect`, `circle` and the strings `"rect"`, `"circle"` also work; other strings (`"diamond"`) fail.

## 4. `edge()` parameters, marks and flags

`edge(from, to, marks, label, ..)`: vertices first, then a marks string and a content label in any order.

| Parameter | Notes |
|---|---|
| vertices | `edge(<a>, <b>)`, `edge(<a>, (2, 1), (4, 1), <b>)` (poly line), `edge(<a>, "r,d")`, `edge("r")` (from the previous node), `edge()` (previous to next node) |
| `marks` | string shorthand (below) or an array of mark names / dictionaries |
| `label` | content (a string positional is read as marks, not as a label) |
| `label-side` | `left`, `right`, `center`, `auto`: left/right of the direction of travel |
| `label-pos` | `0.5` / `50%` along the edge; `(segment, 50%)` for a poly edge; `100% - 1em` |
| `label-sep`, `label-angle`, `label-anchor`, `label-size` | fine placement |
| `label-fill` | `true` = `crossing-fill`; auto is on only for `label-side: center` |
| `stroke` | `theme.muted`, `1pt + theme.red`, `(paint: theme.fg, dash: "dashed")` |
| `dash` | `"dashed"`, `"dotted"`, … |
| `bend` | arc; positive bends to the left of travel (a left-to-right edge bulges up) |
| `loop-angle` | self loop direction with `edge(<n>, <n>, bend: 130deg)`: `90deg` up, `-90deg` down, `0deg` right, `180deg` left |
| `corner` | `left` / `right`: one right-angled corner between two points |
| `corner-radius` | per edge; `none` ≠ `0pt` |
| `shift` | sideways offset, for parallel edges: `shift: 4pt` |
| `extrude` | multi-stroke, `(-2, 2)` = double |
| `decorations` | `"wave"`, `"zigzag"`, `"coil"` |
| `crossing` | draw a `crossing-fill` gap under this edge where it crosses others |
| `layer` | `-1` puts guide lines (lifelines) behind |
| `snap-to` | `(auto, none)` etc.: which nodes the ends attach to |
| `floating` | do not affect the diagram size |

Marks shorthand = mark, line, mark: `"->"` `"<-"` `"<->"` `"=>"` (double) `"==>"` (triple) `"-->"` (dashed) `"..>"` (dotted)
`"~>"` (wave) `"-|>"` (solid triangle) `"-}>"` (stealth) `"->>"` (two heads) `">->"` (tail) `"|->"` (maps-to) `"hook->"` `"hook'->"`
`"-o"` `"-O"` `"*-*"` (dots) `"-@"` `"x-x"` `"<>-"` (diamond) `"-/-"` (slash) `"-||-"` `"-[]"` `"-"` (plain) `"--"` (dashed plain).
Crow's foot (ER diagrams): `"n-1"`, `"n!-1!"`, `"n?-1?"`. Flags as positional strings: `"dashed"`, `"dotted"`, `"double"`,
`"triple"`, `"crossing"`, `"wave"`, `"zigzag"`, `"coil"`. Line styles in the middle: `-` `=` `==` `--` `..` `~`.
A bad string fails with ``Invalid marks shorthand `-->>-x`. Try `-->>--x`.``

## 5. Coordinates, names, paths

- `(x, y)`: column, row. Columns and rows are elastic: each is as wide/tall as its largest node, and `spacing` goes between them.
- Fractional positions (`(1, 0.5)`, `(3, -0.8)`) are interpolated between rows/columns. They get **no spacing of their own**:
  two nodes at rows 0 and 0.5 overlap. Use integers for nodes that stack, fractions for nodes between them and for edge corner points.
- Names: `name: <db>`, then `edge(<api>, <db>)`. Names make edits safe (move a node, edges follow).
- Relative: `(rel: (1, 0), to: <b>)`. Shorthand vertex strings (not as the first vertex): `"r"`, `"l"`, `"u"`/`"t"`, `"d"`/`"b"`, combined `"d,r,r"`.
- A poly edge goes through every vertex in order; the first and last snap to the nodes there.

## 6. Groups (`enclose`) and layers

- `node(enclose: (<a>, <b>, (3, 1)), stroke: (paint: c, dash: "dashed"), fill: c.transparentize(94%), inset: 8pt)` draws a box around members, behind them (layer -1).
- `enclose` makes **no room for the group's own label**: a label in the group node overlaps the members. Put the title in its own
  `stroke: none` node above the members and enclose that node too (recipe 8.4).
- Edges to `<a>` still attach to `<a>`, not to the group. To attach to the group, name it and use that name.
- Groups grow the grid like other nodes; leave a free fractional row for the title.

## 7. Wide and short layouts

- Lay flows left to right; use 1–3 rows. Make the column spacing larger than the row spacing: `spacing: (4em, 1.4em)`.
- A diagram has its natural size; it does not stretch to `theme.width`. To fill the width with `n` columns:
  `spacing: (1em, …), cell-size: (theme.width / n - 1em, 0pt)`; or for fixed-width nodes of width `nw`:
  `spacing: (0pt, …), cell-size: ((theme.width - nw) / (n - 1), …)`.
- fletcher makes no space for edge labels: a label wider than its gap overlaps nodes. Short labels, `\` breaks, wider gaps.
- Route long back-edges through a free row above or below (`(x, -0.8)`), never through a row with nodes.
- A diagram wider than the block is scaled down (smaller text). A tall one is not.

## 8. Recipes

### 8.1 Pipeline with a feedback loop

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg, node-shape: rect,
  node-corner-radius: 3pt, crossing-fill: theme.bg, spacing: (4em, 1.4em),
  node((0, 0), [Source], fill: theme.blue.transparentize(80%), name: <src>),
  node((1, 0), [Parse], fill: theme.purple.transparentize(80%), name: <parse>),
  node((2, 0), [Validate], fill: theme.orange.transparentize(80%), name: <val>),
  node((3, 0), [Enrich], fill: theme.yellow.transparentize(80%), name: <enr>),
  node((4, 0), [Store], fill: theme.green.transparentize(80%), name: <db>, shape: fletcher.shapes.cylinder),
  node((2, 1), text(fill: theme.red)[dead-letter], stroke: (paint: theme.red, dash: "dashed"), name: <dlq>),
  edge(<src>, <parse>, "->"),
  edge(<parse>, <val>, "->"),
  edge(<val>, <enr>, "->", [ok], label-side: right),
  edge(<enr>, <db>, "->"),
  edge(<val>, <dlq>, "->", text(fill: theme.red)[bad], label-side: left),
  // feedback above the row (row 1 is taken): up, left, down
  edge(<enr>, (3, -0.8), (1, -0.8), <parse>, "->", stroke: theme.accent, text(fill: theme.accent)[retry]),
)
```

### 8.2 Decision flow chart (diamonds), filling the width

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#let cols = 5
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg, node-shape: rect, crossing-fill: theme.bg,
  // fill theme.width: cols cells + (cols - 1) gaps
  spacing: (1em, 1.8em), cell-size: (theme.width / cols - 1em, 0pt),
  node((0, 0), [Request], shape: fletcher.shapes.pill, fill: theme.blue.transparentize(80%), name: <in>),
  node((1, 0), [Cached?], shape: fletcher.shapes.diamond, fill: theme.yellow.transparentize(80%), name: <q1>),
  node((2, 0), [Authorised?], shape: fletcher.shapes.diamond, fill: theme.yellow.transparentize(80%), name: <q2>),
  node((3, 0), [Query DB], fill: theme.purple.transparentize(80%), name: <db>),
  node((4, 0), [200 OK], shape: fletcher.shapes.pill, fill: theme.green.transparentize(80%), name: <ok>),
  node((2, 1), [401], shape: fletcher.shapes.pill, fill: theme.red.transparentize(80%), name: <deny>),
  edge(<in>, <q1>, "->"),
  edge(<q1>, <q2>, "->", [no]),
  edge(<q2>, <db>, "->", [yes]),
  edge(<db>, <ok>, "->"),
  edge(<q2>, <deny>, "->", [no], label-side: left),
  // yes from the cache: around the bottom, past the 401 node
  edge(<q1>, (1, 1.6), (4, 1.6), <ok>, "->", [yes], label-pos: 0.3, label-side: left),
)
```

### 8.3 State machine with self-loops

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#let st(pos, name, body, c) = node(pos, body, name: name, shape: circle, fill: c.transparentize(80%))
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg, spacing: (7em, 2em), node-inset: 8pt,
  node((-0.6, 0), [], name: <start>, stroke: none),
  st((0, 0), <idle>, [Idle], theme.blue),
  st((1, 0), <run>, [Running], theme.green),
  st((2, 0), <paused>, [Paused], theme.yellow),
  node((3, 0), [Done], name: <done>, shape: circle, extrude: (0, -3), fill: theme.purple.transparentize(80%)),
  edge(<start>, <idle>, "-|>"),
  edge(<idle>, <run>, "->", [start], bend: 25deg),
  edge(<run>, <idle>, "->", [reset], bend: 25deg),
  edge(<run>, <paused>, "->", [pause], bend: 25deg),
  edge(<paused>, <run>, "->", [resume], bend: 25deg),
  edge(<run>, <run>, "->", [tick], bend: 130deg, loop-angle: 90deg, label-sep: 0.2em),
  edge(<paused>, <paused>, "->", [poll], bend: 130deg, loop-angle: -90deg),
  edge(<paused>, <done>, "->", [stop]),
)
```

### 8.4 Architecture with grouped subsystems

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#let part(pos, body, name, c) = node(pos, body, name: name, fill: c.transparentize(80%), stroke: c)
// enclose makes no room for a group's own label: give the title its own
// text node above the members and enclose it too.
#let group(pos, title, members, c) = (
  node(pos, text(size: 0.8em, fill: c, weight: "bold", title), stroke: none, name: label(title)),
  node(enclose: members + (label(title),), inset: 8pt, corner-radius: 6pt,
    stroke: (paint: c, dash: "dashed"), fill: c.transparentize(94%)),
)
#diagram(
  node-shape: rect, node-corner-radius: 3pt, edge-stroke: theme.fg,
  spacing: (4em, 1.2em),
  node((0, 0.5), [Browser], name: <web>, stroke: theme.fg),
  node((0, 1.5), [Mobile], name: <app>, stroke: theme.fg),
  part((1, 1), [API gateway], <gw>, theme.purple),
  part((2, 0), [Users], <users>, theme.blue),
  part((2, 1), [Orders], <orders>, theme.blue),
  part((2, 2), [Billing], <billing>, theme.blue),
  part((3, 0.5), [Postgres], <pg>, theme.green),
  part((3, 1.5), [Kafka], <kafka>, theme.orange),
  ..group((2, -0.7), "services", (<users>, <orders>, <billing>), theme.blue),
  ..group((3, -0.2), "data", (<pg>, <kafka>), theme.green),
  edge(<web>, <gw>, "->"), edge(<app>, <gw>, "->"),
  edge(<gw>, <users>, "->"), edge(<gw>, <orders>, "->"), edge(<gw>, <billing>, "->"),
  edge(<users>, <pg>, "->"), edge(<orders>, <pg>, "->"),
  edge(<orders>, <kafka>, "->"), edge(<kafka>, <billing>, "->"),
)
```

### 8.5 Sequence-style lanes

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#let actors = ([Client], [API], [Auth], [DB])
#let msgs = (
  // (from, to, row, label, dashed reply?)
  (0, 1, 1, [POST /login], false),
  (1, 2, 2, [verify(pw)], false),
  (2, 3, 3, [SELECT user], false),
  (3, 2, 4, [row], true),
  (2, 1, 5, [token], true),
  (1, 0, 6, [200 + cookie], true),
)
#let last = msgs.len() + 1
#diagram(
  edge-stroke: theme.fg, node-stroke: theme.fg, node-shape: rect,
  spacing: (0pt, 0pt), // column centres are cell-size apart: n - 1 gaps + one node width = theme.width
  cell-size: ((theme.width - 6em) / (actors.len() - 1), 1.7em),
  ..actors.enumerate().map(((x, a)) => (
    node((x, 0), a, fill: theme.palette.at(x).transparentize(80%), width: 6em),
    edge((x, 0), (x, last), stroke: (paint: theme.muted, dash: "dashed"), layer: -1),
  )).flatten(),
  ..msgs.map(((a, b, y, l, reply)) => edge((a, y), (b, y), l,
    if reply { "--|>" } else { "-|>" },
    stroke: if reply { theme.muted } else { theme.fg }, label-sep: 0.15em)),
)
```

### 8.6 Tree / hierarchy (computed layout)

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
// (label, children). Leaves go left to right; a parent sits over the middle
// of its children. Returns (next free x, own x, nodes and edges).
#let tree(t, depth: 0, x: 0) = {
  let (body, kids) = t
  let fill = theme.palette.at(depth).transparentize(80%)
  if kids.len() == 0 { return (x + 1, x, (node((x, depth), body, fill: fill),)) }
  let (nx, xs, items) = (x, (), ())
  for k in kids {
    let (n, kx, its) = tree(k, depth: depth + 1, x: nx)
    (nx, xs, items) = (n, xs + (kx,), items + its)
  }
  let me = (xs.first() + xs.last()) / 2
  items.push(node((me, depth), body, fill: fill))
  for kx in xs {
    // org-chart elbows: down, across, down (straight when right below:
    // two equal vertices in a row are an error)
    items.push(if kx == me { edge((me, depth), (kx, depth + 1)) } else {
      edge((me, depth), (me, depth + 0.5), (kx, depth + 0.5), (kx, depth + 1))
    })
  }
  (nx, me, items)
}
// text(font: theme.mono), not raw: raw gets the inline-code box and colour
#let mono(s) = text(font: theme.mono, s)
#let leaf(l) = (mono(l), ())
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.muted, node-shape: rect, node-corner-radius: 3pt,
  spacing: (1.2em, 1.6em),
  ..tree((mono("src/"), (
    (mono("app/"), (leaf("main.rs"), leaf("cli.rs"))),
    (mono("core/"), (leaf("parse.rs"), leaf("eval.rs"), leaf("types.rs"))),
    (mono("util/"), (leaf("log.rs"),)),
  ))).at(2),
)
```

### 8.7 Commutative diagrams (math)

In math mode `&` separates columns and `\` rows; `edge(..)` inside a cell starts at that cell. Inside `$…$` use `#` for
non-math values (`label-side: #right`).

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#grid(columns: (1fr, 1fr, 1fr), align: center + horizon,
  // math mode: & separates columns, \ rows; edge() in a cell starts there
  diagram(edge-stroke: theme.fg, spacing: 3em, $
    A edge(f, ->) edge("d", g, ->, label-side: #right) & B edge("d", h, ->) \
    C edge(k, "->", label-side: #right) & D
  $),
  // the same with explicit coordinates, plus a dashed unique arrow
  diagram(edge-stroke: theme.fg, spacing: (3.5em, 2.5em), crossing-fill: theme.bg,
    node((0, 0), $X$), node((1, 0), $X times Y$), node((2, 0), $Y$),
    node((1, 1), $Z$),
    edge((1, 0), (0, 0), $pi_1$, "->", label-side: right),
    edge((1, 0), (2, 0), $pi_2$, "->"),
    edge((1, 1), (0, 0), $f$, "->", label-side: left),
    edge((1, 1), (2, 0), $g$, "->", label-side: right),
    edge((1, 1), (1, 0), $exists ! u$, "-->", label-side: center),
  ),
  diagram(edge-stroke: theme.fg, spacing: 4em,
    node((0, 0), $V$), node((1, 0), $W$),
    edge((0, 0), (1, 0), $T$, "->", bend: 30deg),
    edge((1, 0), (0, 0), $T^(-1)$, "->", bend: 30deg),
    edge((0, 0), (0, 0), $id$, "->", bend: 130deg, loop-angle: 180deg),
  ),
)
```

### 8.8 Network / topology

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#let dev(pos, body, name, c, shape: rect) = node(pos, body, name: name, shape: shape,
  fill: c.transparentize(80%), stroke: c)
#diagram(
  edge-stroke: theme.fg, node-corner-radius: 3pt, crossing-fill: theme.bg,
  // rows 0..5 hold the servers (integer rows get the spacing);
  // the other nodes sit between them at fractional rows
  spacing: (3.5em, 0.5em),
  dev((0, 2.5), [Internet], <net>, theme.muted, shape: fletcher.shapes.ellipse),
  dev((1, 2.5), [Firewall], <fw>, theme.red, shape: fletcher.shapes.hexagon),
  dev((2, 1), [Router A], <ra>, theme.purple),
  dev((2, 4), [Router B], <rb>, theme.purple),
  dev((3, 1), [Switch 1], <s1>, theme.blue),
  dev((3, 4), [Switch 2], <s2>, theme.blue),
  ..range(3).map(i => dev((4, i), [web #(i + 1)], label("w" + str(i)), theme.green)),
  ..range(3).map(i => dev((4, 3 + i), [db #(i + 1)], label("d" + str(i)), theme.orange)),
  edge(<net>, <fw>, "<->"),
  edge(<fw>, <ra>, "-"), edge(<fw>, <rb>, "-"),
  edge(<ra>, <s1>, "-"), edge(<rb>, <s2>, "-"),
  // redundant cross links; `crossing` cuts a gap in what lies under
  edge(<ra>, <s2>, "-", stroke: (paint: theme.muted, dash: "dashed")),
  edge(<rb>, <s1>, "-", stroke: (paint: theme.muted, dash: "dashed"), crossing: true),
  ..range(3).map(i => edge(<s1>, label("w" + str(i)), "-")),
  ..range(3).map(i => edge(<s2>, label("d" + str(i)), "-")),
)
```

### 8.9 Parallel edges with labels outside

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg, node-shape: rect, spacing: 8em,
  node((0, 0), [Client], name: <c>),
  node((1, 0), [Server], name: <s>),
  // two parallel edges: shift them apart. `left` is left of the direction
  // of travel, so both labels go to the outer sides.
  edge(<c>, <s>, "->", [request \ (JSON)], shift: 4pt, label-side: left),
  edge(<s>, <c>, "->", text(fill: theme.muted)[response], shift: 4pt, label-side: left),
)
```

### 8.10 Coordinate forms, corners, shorthands

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg, node-shape: rect, crossing-fill: theme.bg,
  spacing: (3em, 1.5em),
  node((0, 0), [A], name: <a>),
  edge("r", "->", [next]),                       // from the last node, one column right
  node((1, 0), [B], name: <b>),
  node((rel: (1, 1), to: <b>), [C], name: <c>),  // relative to a named node
  edge(<b>, <c>, "->", corner: right),           // one right-angled corner
  edge(<a>, "d,r,r", "-->", [via d], label-pos: (1, 50%)), // shorthand path; label on segment 1
  node((3, 0), [D], name: <d>, extrude: (0, 3)),  // double outline
  edge(<c>, <d>, "=>", bend: -30deg),
  edge(<b>, <d>, "->", [over], label-side: center, bend: 40deg), // label on the line, crossing-fill behind it
)
```

## 9. Traps and fletcher error messages

Traps (each one seen in a render):
- `crossing-fill` defaults to **white**: `label-side: center` labels and `crossing` edges show white boxes on dark. Set `crossing-fill: theme.bg`.
- `node-stroke` defaults to none and `edge-stroke` to black: always pass `theme.fg`. Give text-only nodes `stroke: none`.
- `node-shape: auto` turns short labels (`[A]`, `[Done]`) into circles: set `node-shape: rect`.
- `diamond`, `triangle`, `chevron` … are drawn **larger** than the box used for layout: neighbours touch. Add spacing around them.
- Nodes at fractional rows/columns get no spacing and overlap. Stack nodes on integer rows.
- Edges do not avoid nodes: a corner path through a row with nodes crosses them. Use a free (fractional) row.
- Two equal vertices in a row (a corner at the start point) fail with `Adjacent vertices must be distinct.` Use a straight edge then.
- `radius:` fixes a circle size; a longer label spills out. Leave `radius` out to size by the label.
- `label-side: auto` puts the labels of two parallel edges both above. Use `label-side: left` on both (left of travel).
- Node names in `edge()` must be labels `<a>`. A string `"a"` is read as marks: `Marks argument passed to edge() twice; found "a" and "->"`.
- Edge labels must be content `[ok]`. A string `"ok"` is read as marks: ``Couldn't interpret `edge()` arguments `ok`. Try using named arguments.``
- `raw` inside node labels gets the inline-code box. Use `text(font: theme.mono)[…]`.
- A helper parameter named `label` shadows the `label()` function inside it. Name it `body`.
- Marks scale with stroke thickness: `stroke: 2pt + …` gives large heads; lower `mark-scale`.

| Message | Fix |
|---|---|
| `Node `zz` not found. Named nodes are: …` | spell the name; define the node in this diagram |
| `Invalid marks shorthand …. Try ….` | use the suggested string |
| `` `label-side` must be one of `left`, `center`, `right`, or `auto`; got `top`. `` | `top`/`bottom` are not sides; use `left`/`right` |
| `expected function, found string` (in `draw.typ`) | `shape: "diamond"`: pass `fletcher.shapes.diamond` |
| `Adjacent vertices must be distinct.` | remove the duplicate vertex |
| ``Couldn't interpret `edge()` arguments …`` | a string where content was meant: `[ok]`, not `"ok"` |
| `Marks argument passed to edge() twice` | a node name given as a string: `<a>`, not `"a"` |
| `unknown variable: node` | add the `#import` line to this block |
