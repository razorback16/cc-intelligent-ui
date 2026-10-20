# cetz 0.5.2: drawing on a canvas

Use cetz for drawings that are not a chart and not a node-and-edge diagram: timelines, boxes with arrows,
layer stacks, geometry, trees, braces, gauges, small graphs. For flow charts and state machines, fletcher
is easier (fletcher.md). For data plots, use cetz-plot (plot.md, charts.md).
Every ```` ```typst ```` example in this file was compiled with the real template, in dark and light.

Contents
1. Canvas, sizing and a first drawing (annotated timeline)
2. Coordinates
3. Names and anchors
4. Shapes
5. Marks (arrow heads)
6. Styles and `set-style`
7. Text in the canvas: `content`
8. Groups, scope, layers, transforms
9. Libraries: tree, decorations, angle
10. Recipes: architecture, layer stack, geometry, tree, braces, gauges, network, shape sheet, reusable parts
11. Traps

## 1. Canvas, sizing and a first drawing

- Import: `#import "@preview/cetz:0.5.2"`. Draw in `#cetz.canvas(length: L, { import cetz.draw: *; ... })`.
- `length` is the size of one unit. Plan the drawing in a W × H unit box and fit the box to the room:
  `length: calc.min(theme.width / W, theme.height / H)`. Wide and short: W about 3 × H.
- The y axis points **up**. (0, 0) is not the corner: the canvas is the bounding box of what you draw.
- Text does not scale with `length`. At 896pt × 320pt, one unit is about 55–65pt, so a 10-letter label needs about 1 unit.
- Put `set-style(stroke: theme.fg)` first. The default stroke is black (invisible on dark).
- The bounding box ignores stroke width. For thick strokes at the edge, add `padding: 0.1` (units) to the canvas.
- Other canvas parameters: `padding`, `background` (a colour), `baseline`, `debug: true` (shows the bounding boxes).

Annotated timeline (a 14 × 4 box: phases as bands, milestones with name and date, one callout):

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 14, theme.height / 4), {
  import cetz.draw: *
  set-style(stroke: theme.fg)
  // Phases as bands under the axis
  for (x0, x1, name, c) in ((0.5, 4.5, [Design], theme.blue), (4.5, 9.5, [Build], theme.purple), (9.5, 13.5, [Launch], theme.green)) {
    rect((x0, -0.9), (x1, -0.3), fill: c.transparentize(80%), stroke: none)
    content(((x0 + x1) / 2, -0.6), text(size: 0.85em, name))
  }
  line((0, 0), (14, 0), mark: (end: ">", fill: theme.fg))
  for (x, name, date, c) in (
    (1, [Kick-off], [Jan 8], theme.blue),
    (4, [Spec frozen], [Mar 2], theme.blue),
    (7, [Beta], [May 20], theme.purple),
    (10, [RC1], [Aug 1], theme.orange),
    (13, [v1.0], [Oct 14], theme.green),
  ) {
    line((x, 0), (x, 0.8), stroke: (paint: theme.muted, dash: "dotted"))
    circle((x, 0), radius: 0.14, fill: c, stroke: theme.bg + 1.5pt)
    content((x, 1.4), name, anchor: "base")
    content((x, 1.0), text(fill: theme.muted, size: 0.8em, date), anchor: "base")
  }
  // A note pointing at one milestone
  content((7, 2.5), text(fill: theme.orange, size: 0.85em)[slipped 3 weeks], name: "note")
  line("note.south", (7, 1.85), stroke: theme.orange, mark: (end: ">", fill: theme.orange))
})
```

The text on one row has `anchor: "base"`, so labels with and without descenders (p, g) line up.

## 2. Coordinates

| Write | Means |
|---|---|
| `(x, y)` / `(x, y, z)` | absolute, in units |
| `()` | the previous position (the end of the last element) |
| `(rel: (dx, dy))` | relative to the previous position |
| `(rel: (dx, dy), to: "a.east")` | relative to another point |
| `(30deg, 2)` / `(angle: 30deg, radius: 2)` | polar around (0, 0) |
| `(30deg, (3, 1))` | polar on an ellipse with radii 3 and 1 |
| `(rel: (30deg, 2), to: (5, 1))` | polar around another point |
| `(a, 50%, b)` | the point halfway from a to b (any ratio) |
| `(a, 1.5, b)` | 1.5 units from a toward b |
| `(a, 50%, 90deg, b)` | as above, with b turned 90° around a |
| `(a, "\|-", b)` | x of a, y of b |
| `(a, "-\|", b)` | x of b, y of a |
| `(p, "_\|_", a, b)` | p projected onto the line a–b |
| `(bary: (a: 1, b: 1, c: 2))` | weighted mean of named elements |
| `"name"` / `"name.anchor"` | an anchor of a named element (section 3) |
| `((a, b) => ..., p, q)` | a function of resolved points; it returns a point |

`a` and `b` can be any coordinate, also anchor strings: `("a.east", 50%, "b.west")`.

## 3. Names and anchors

- Give an element `name: "srv"`. Then use `"srv"` (its default anchor, mostly the centre) or `"srv.<anchor>"`.
- Border anchors (rect, circle, content, group): `north`, `south`, `east`, `west`, `north-east`, ..., `center`, and any angle: `"srv.30deg"`.
- Path anchors (line, bezier, arc, catmull, hobby): `start`, `mid`, `end`, a ratio along the path `"l.25%"`, or a distance `"l.2"`.
- `line("a", "b")` with two names (no anchor) starts and ends on the borders of a and b, on the line between their centres.
- Content anchors also have `base`, `base-west`, `base-east`, `mid`, `text`.
- Arc anchors: `arc-start`, `arc-end`, `arc-center`, `origin`, `chord-center`.
- Inside a named group, a child keeps its name with a prefix: `"g.box.east"`. `anchor("top", (0, 2))` adds a custom anchor to the group.
- `intersections("i", "a", "b")` makes anchors `"i.0"`, `"i.1"`, ... for the crossing points (example in section 10).
- An element can be placed by one of its anchors: `rect((0, 0), (2, 1), anchor: "north-west")`, `content(p, [x], anchor: "west")`.

## 4. Shapes

| Shape | Call | Notes |
|---|---|---|
| line, polyline | `line(a, b, c, close: false)` | `mark:` for arrows; `close: true` makes a polygon |
| rectangle | `rect(a, b, radius: 0.1)` | b can be `(rel: (w, ht))`; radius per corner: `(north: 50%)` |
| circle, ellipse | `circle(c, radius: 1)` / `radius: (rx, ry)` | `circle(a, b)`: centre a, through b; `circle-through(a, b, c)` |
| arc | `arc(p, start: 0deg, stop: 90deg, radius: 1)` | two of `start`, `stop`, `delta`; `mode: "OPEN" \| "CLOSE" \| "PIE"`; p is the arc start unless `anchor: "origin"` |
| arc by 3 points | `arc-through(a, b, c)` | |
| Bézier | `bezier(start, end, c1)` / `bezier(start, end, c1, c2)` | `bezier-through(a, b, c)` passes through b |
| smooth curve | `catmull(..pts, tension: 0.5)`, `hobby(..pts, omega: 0)` | through all points |
| regular polygon | `polygon(c, 6, radius: 1)` | star: `n-star(c, 5, inner-radius: 50%)` |
| grid | `grid(a, b, step: 0.5, stroke: theme.border)` | `step: (x: 1, y: 0.5)` |
| box around things | `rect-around("a", "b", padding: 0.2)` | |
| merged path | `merge-path({ line(...); arc(...) }, close: true, fill: ...)` | one fill for many parts |
| path with holes | `compound-path({ rect(...); circle(...) }, fill-rule: "even-odd")` | |
| SVG-like path | `svg-path(("m", (0, 0)), ("l", (1, 1)), ("z",))` | |

Thick ring segment: an `arc` with a thick stroke (`stroke: (paint: c, thickness: 7pt, cap: "round")`), example in section 10.

## 5. Marks (arrow heads)

- `line(a, b, mark: (end: ">"))`, `mark: (start: "<", end: ">")`, or `mark: (end: (">", ">"))` for two heads.
- Symbols: `">"` triangle, `">>"` stealth, `")>"` curved stealth, `"|"` bar, `"o"` circle, `"<>"` diamond,
  `"[]"` square, `"]"` bracket, `"x"`, `"+"`, `"*"` star. Long names work too: `"triangle"`, `"stealth"`, `"straight"`.
- Size and look: `mark: (end: ">", scale: 1.5, fill: theme.fg, length: 0.2cm, width: 0.15cm)`.
- A mark is hollow by default (its outline uses the line stroke). For a solid head, set `mark: (fill: theme.fg)` with `set-style`, or give `fill:` per line in the line's colour.
- Marks shorten the line so the tip ends at the point. `mark(from, to, symbol: ">")` draws a mark alone.

## 6. Styles and `set-style`

- Per element: `rect(a, b, fill: theme.blue.transparentize(80%), stroke: theme.blue + 0.8pt)`.
- Strokes: a colour, a length, `c + 1pt`, or `(paint: c, thickness: 1pt, dash: "dashed" | "dotted", cap: "round")`.
- For everything that follows (inside the current `scope` or `group`): `set-style(stroke: theme.fg, fill: none)`.
- Per element type: `set-style(rect: (radius: 0.1), circle: (fill: ...), content: (padding: 0.1), mark: (fill: theme.fg))`.
- Library roots: `brace`, `flat-brace`, `angle`, `zigzag`, `wave`, `coil`; cetz-plot uses `axes` and `legend` (plot.md).
- `fill(c)` and `stroke(s)` are short forms of `set-style(fill: c)` and `set-style(stroke: s)`.

## 7. Text in the canvas: `content`

- `content(p, [Label])`: centred on p. `anchor: "west"` puts the label's west side on p.
- `content(a, b, box(width: 100%, height: 100%, ...))`: fills the rect a–b (for wrapped text).
- `padding: 0.1` (units) gives room around it; `frame: "rect" | "circle"` draws a frame that uses `stroke` and `fill`.
- `angle: 30deg` turns it; `angle: "l.end"` turns it to point at another coordinate (text along a line).
- Style the text with Typst: `text(fill: theme.muted, size: 0.8em, font: theme.mono)[...]`, `strong[...]`, math `$theta$`.
- A named content has border anchors: `content((7, 2.5), [note], name: "n")` then `line("n.south", ...)`.

## 8. Groups, scope, layers, transforms

- `scope({ ... })`: styles and transforms inside stay inside. Use it for every local `translate` or `rotate`.
- `group(name: "g", { ... })`: like scope, and the group gets anchors from its bounding box.
- `on-layer(-1, { ... })`: draw behind (lower layers first; default 0). Use it for edges under nodes and backgrounds under text.
- `translate((dx, dy))`, `rotate(30deg)`, `rotate(30deg, origin: p)`, `scale(2)`, `scale(x: 1, y: 50%)`, `set-origin(p)`.
- Transforms move shapes; text is moved but not turned or scaled (use `content(..., angle:)`).
- `hide({ ... })`: elements that only give anchors or intersections, not drawn.
- `get-ctx(ctx => { ... })`: read the context, for example `cetz.coordinate.resolve(ctx, "a.east")` to get numbers.

## 9. Libraries: tree, decorations, angle

- `cetz.tree.tree(root, direction: "down" | "up" | "left" | "right", grow: 1, spread: 1, draw-node: ..., draw-edge: ...)`.
  `root` is nested arrays: `([root], ([child], [leaf], [leaf]), [leaf])`.
  `draw-node: (node, ..) => ...` draws at `()` (the node position); `node.content`, `node.depth`, `node.n` are set.
  `draw-edge: (from, to, ..) => ...` gets two nodes; their element names are `from.group-name` and `to.group-name`.
  Node anchors: `"0"` is the root, `"0-1"` its second child (with `name: "t"`: `"t.0-1"`).
- `cetz.decorations.brace(a, b, amplitude: 0.3, name: "b")`: a curly brace on the left of a → b
  (left to right points up, right to left points down). Its `fill` is **black** by default: set `brace: (fill: theme.fg, stroke: none)`.
  Put the text at `"b.content"`.
- `cetz.decorations.flat-brace(a, b, amplitude: 0.3)`: straight segments, better for long spans; it uses `stroke`.
- `cetz.decorations.zigzag(line(a, b), amplitude: 0.2, segments: 8)`, also `wave`, `coil`, `square`; `start: 10%, stop: 90%` decorate a part.
- `cetz.angle.angle(origin, a, b, label: $alpha$, radius: 0.8, label-radius: 1.1)` marks the angle a–origin–b (counter-clockwise; `direction: "cw" | "near" | "far"`).
  `cetz.angle.right-angle(origin, a, b, radius: 0.3, label: none)` draws the square mark.

## 10. Recipes

Boxes with arrows (architecture). A helper draws a named box; edges go border to border:

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 15, theme.height / 5), {
  import cetz.draw: *
  set-style(stroke: theme.fg, mark: (fill: theme.fg))
  // A box: a named rect with its label at the centre
  let box(pos, name, label, c, w: 2.6, ht: 1) = {
    rect((pos.at(0) - w / 2, pos.at(1) - ht / 2), (rel: (w, ht)), radius: 0.12,
      fill: c.transparentize(80%), stroke: c, name: name)
    content(name + ".center", label)
  }
  box((1.5, 2), "web", [Web app], theme.blue)
  box((1.5, 0), "cli", [CLI], theme.blue)
  box((5.5, 1), "api", [API gateway], theme.purple, w: 3)
  box((9.5, 2), "auth", [Auth], theme.orange)
  box((9.5, 0), "jobs", [Job queue], theme.orange)
  box((13.3, 1), "db", [Postgres], theme.green, w: 2.2, ht: 2.6)
  // Edges between borders: "name.east" etc. are border anchors
  line("web.east", "api.west", mark: (end: ">"))
  line("cli.east", "api.west", mark: (end: ">"))
  line("api.east", "auth.west", mark: (end: ">"))
  line("api.east", "jobs.west", mark: (end: ">"))
  line("auth.east", ("db.west", "|-", "auth.east"), mark: (end: ">"))
  line("jobs.east", ("db.west", "|-", "jobs.east"), mark: (end: ">"))
  // An edge label just above the middle of the edge
  content(("api.east", 50%, "auth.west"), text(fill: theme.muted, size: 0.8em)[JWT], anchor: "south-east", padding: 0.1)
  // A dashed group frame around two boxes
  rect((7.9, -0.75), (11.1, 2.75), stroke: (paint: theme.muted, dash: "dashed"), radius: 0.2)
  content((9.5, 2.75), text(fill: theme.muted, size: 0.8em)[services], anchor: "south", padding: 0.08)
})
```

Layer stack with notes in a fixed column right of the stack:

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 14, theme.height / 5), {
  import cetz.draw: *
  set-style(stroke: theme.fg)
  let layers = (
    ([Application], [your code], theme.blue),
    ([Framework], [routing, ORM], theme.purple),
    ([Runtime], [Node 22], theme.orange),
    ([OS], [Linux 6.8], theme.green),
    ([Hardware], [x86-64, 32 GB], theme.muted),
  )
  // Layer i from the top: y goes down from 4.5
  for (i, (name, note, c)) in layers.enumerate() {
    let y = 4 - i * 0.9
    rect((0, y), (8, y + 0.8), fill: c.transparentize(80%), stroke: c, radius: 0.08, name: "l" + str(i))
    content((0.3, y + 0.4), strong(name), anchor: "west")
    content((7.7, y + 0.4), text(fill: theme.muted, note), anchor: "east")
  }
  // Notes in a fixed column right of the stack, with a bracket over a span
  line((8.3, 4.8), (8.5, 4.8), (8.5, 3.1), (8.3, 3.1))
  content((8.7, 3.95), [user space: you deploy this], anchor: "west")
  line((8.3, 2.9), (8.5, 2.9), (8.5, 0.4), (8.3, 0.4), stroke: theme.muted)
  content((8.7, 1.65), text(fill: theme.muted)[platform: managed for you], anchor: "west")
})
```

Geometry: vectors (one in polar form), angle, projection, right angle, intersections:

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 12, theme.height / 4.6), {
  import cetz.draw: *
  set-style(stroke: theme.fg, mark: (fill: theme.fg))
  // Axes and a light grid
  grid((-0.5, -0.5), (5.5, 3.5), step: 1, stroke: theme.border + 0.4pt)
  line((-0.5, 0), (5.6, 0), mark: (end: ">"))
  line((0, -0.5), (0, 3.6), mark: (end: ">"))
  content((5.6, 0), $x$, anchor: "west", padding: 0.1)
  content((0, 3.6), $y$, anchor: "south", padding: 0.1)
  // Two vectors: one in polar form (angle, length)
  line((0, 0), (4, 1), stroke: theme.blue + 1.5pt, mark: (end: ">", fill: theme.blue), name: "u")
  line((0, 0), (35deg, 3.5), stroke: theme.orange + 1.5pt, mark: (end: ">", fill: theme.orange), name: "v")
  content("u.end", text(fill: theme.blue, $arrow(u)$), anchor: "west", padding: 0.1)
  content("v.end", text(fill: theme.orange, $arrow(v)$), anchor: "south-west", padding: 0.05)
  // The angle between them
  cetz.angle.angle((0, 0), "u.end", "v.end", radius: 1.2, label: text(fill: theme.purple, $theta$),
    label-radius: 1.5, stroke: theme.purple)
  // Projection of v onto u, with the right angle mark
  line("v.end", ("v.end", "_|_", (0, 0), "u.end"), stroke: (paint: theme.muted, dash: "dashed"), name: "p")
  cetz.angle.right-angle("p.end", "v.end", "u.end", radius: 0.25, stroke: theme.muted, label: none)
  circle("p.end", radius: 0.06, fill: theme.fg, stroke: none)
  // Right panel: a circle, a chord and their intersections
  circle((9, 1.5), radius: 1.5, stroke: theme.green, name: "c")
  line((7, 0.3), (11, 2.6), stroke: theme.red, name: "l")
  intersections("i", "c", "l")
  for p in ("i.0", "i.1") { circle(p, radius: 0.08, fill: theme.red, stroke: none) }
  content("c.north", text(fill: theme.muted, size: 0.85em)[2 intersections], anchor: "south", padding: 0.1)
})
```

Tree with styled nodes and elbow edges:

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 16, theme.height / 4.5), {
  import cetz.draw: *
  set-style(stroke: theme.fg)
  cetz.tree.tree(
    ([src/], ([hooks/], [lib/], [index.ts]), ([render/], [md.typ], [theme.typ], [packages/]), ([tests/], [pure.test.ts])),
    direction: "down", grow: 1.4, spread: 2.2,
    draw-node: (node, ..) => {
      let c = (theme.accent, theme.blue, theme.green).at(calc.min(node.depth, 2))
      content((), box(inset: (x: 6pt, y: 4pt), radius: 3pt, fill: c.transparentize(82%), stroke: c + 0.6pt,
        text(font: theme.mono, size: 0.85em, node.content)), name: "box")
    },
    draw-edge: (from, to, ..) => {
      // From the bottom of the parent to the top of the child, with an elbow
      let (a, b) = (from.group-name + ".south", to.group-name + ".north")
      line(a, (a, 50%, (a, "|-", b)), ((a, 50%, (a, "|-", b)), "-|", b), b, stroke: theme.muted)
    },
  )
})
```

Braces over a range (curly brace above, flat brace below):

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 14, theme.height / 3.5), {
  import cetz.draw: *
  set-style(stroke: theme.fg)
  // A byte layout: 16 cells
  let cells = range(16)
  for i in cells {
    let c = if i < 2 { theme.blue } else if i < 4 { theme.orange } else if i < 12 { theme.green } else { theme.purple }
    rect((i * 0.8, 0), (rel: (0.8, 0.8)), fill: c.transparentize(80%), stroke: theme.border)
    content((i * 0.8 + 0.4, 0.4), text(font: theme.mono, size: 0.8em, str(i)))
  }
  // Braces: brace() points left of start -> end, so go right-to-left below, left-to-right above
  set-style(brace: (fill: theme.fg, stroke: none), flat-brace: (stroke: theme.muted))
  cetz.decorations.brace((0, 0.9), (1.6, 0.9), name: "magic", amplitude: 0.3)
  content("magic.content", [magic], anchor: "south")
  cetz.decorations.brace((1.6, 0.9), (3.2, 0.9), name: "ver", amplitude: 0.3)
  content("ver.content", [version], anchor: "south")
  // flat-brace: straight segments, better for long spans
  cetz.decorations.flat-brace((9.6, -0.1), (3.2, -0.1), name: "body", amplitude: 0.3)
  content("body.content", text(fill: theme.muted)[payload (8 bytes)], anchor: "north")
  cetz.decorations.flat-brace((12.8, -0.1), (9.6, -0.1), name: "crc", amplitude: 0.3)
  content("crc.content", text(fill: theme.muted)[CRC-32], anchor: "north")
})
```

Progress rings and a half gauge (arcs with thick strokes, canvas padding):

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 13, theme.height / 3), padding: 0.1, {
  import cetz.draw: *
  // The bounds ignore stroke width, so thick strokes need canvas padding (in units).
  // Progress rings: a full track circle, then an arc for the value (clockwise from the top)
  let ring(pos, frac, label, c) = {
    circle(pos, radius: 1, stroke: theme.border + 7pt)
    arc(pos, start: 90deg, delta: -frac * 360deg, radius: 1, anchor: "origin",
      stroke: (paint: c, thickness: 7pt, cap: "round"))
    content(pos, text(size: 1.4em, weight: "bold", str(int(frac * 100)) + "%"))
    content((pos.at(0), pos.at(1) - 1.35), text(fill: theme.muted, label))
  }
  ring((1.2, 1.5), 0.72, [CPU], theme.blue)
  ring((4, 1.5), 0.41, [Memory], theme.green)
  ring((6.8, 1.5), 0.93, [Disk], theme.red)
  // A half gauge with a needle
  let (cx, cy, r) = (10.5, 0.9, 1.8)
  for (a0, a1, c) in ((180deg, 120deg, theme.green), (120deg, 60deg, theme.yellow), (60deg, 0deg, theme.red)) {
    arc((cx, cy), start: a0, stop: a1, radius: r, anchor: "origin", stroke: (paint: c, thickness: 6pt))
  }
  let v = 0.62 // 0..1
  let ang = 180deg - v * 180deg
  line((cx, cy), (rel: (ang, r - 0.35)), stroke: theme.fg + 2pt, mark: (end: ">", fill: theme.fg))
  circle((cx, cy), radius: 0.1, fill: theme.fg, stroke: none)
  content((cx, cy - 0.45), text(fill: theme.muted)[latency: 620 ms])
  for (t, a) in (([0], 180deg), ([500], 90deg), ([1000], 0deg)) {
    content((rel: (a, r + 0.35), to: (cx, cy)), text(fill: theme.muted, size: 0.8em, t))
  }
})
```

Network graph from a list of names and edges (nodes on an ellipse, edges on a lower layer):

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 14, theme.height / 4.4), {
  import cetz.draw: *
  set-style(stroke: theme.fg)
  // Nodes on an ellipse (polar coordinates), edges from a list of pairs
  let names = ("api", "auth", "db", "cache", "queue", "worker", "mail", "cdn")
  let edges = (("api", "auth"), ("api", "db"), ("api", "cache"), ("api", "queue"),
    ("queue", "worker"), ("worker", "db"), ("worker", "mail"), ("cdn", "api"), ("auth", "db"))
  let n = names.len()
  for (i, name) in names.enumerate() {
    let a = 90deg - i * 360deg / n
    let c = theme.palette.at(calc.rem(i, theme.palette.len()))
    // (angle, (rx, ry)) is an elliptic polar coordinate around (0, 0)
    circle((a, (5.5, 1.7)), radius: 0.4, fill: c.transparentize(75%), stroke: c, name: name)
    content(name, text(size: 0.85em, name))
  }
  // Edges go below the nodes (layer -1); line("a", "b") stops at both borders
  on-layer(-1, {
    for (a, b) in edges { line(a, b, stroke: theme.muted, mark: (end: ">", fill: theme.muted)) }
  })
})
```

Shape sheet: what each primitive, mark and path decoration looks like:

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 16, theme.height / 4), {
  import cetz.draw: *
  set-style(stroke: theme.fg, mark: (fill: theme.fg))
  let cap(x, body) = content((x, -0.35), text(font: theme.mono, fill: theme.muted, size: 0.75em, body), anchor: "north")
  // Bottom row (y = 0..1; y grows up): shapes
  rect((0, 0), (rel: (1.4, 1)), radius: 0.15, fill: theme.blue.transparentize(80%)); cap(0.7, "rect")
  circle((2.4, 0.5), radius: (0.7, 0.45), fill: theme.green.transparentize(80%)); cap(2.4, "circle (ellipse)")
  arc((4, 0.1), start: 0deg, stop: 120deg, radius: 0.8, mode: "PIE", anchor: "origin", fill: theme.orange.transparentize(70%)); cap(4.0, "arc PIE")
  polygon((6, 0.5), 6, radius: 0.55, fill: theme.purple.transparentize(80%)); cap(6, "polygon")
  n-star((7.7, 0.5), 5, radius: 0.55, fill: theme.yellow.transparentize(70%)); cap(7.7, "n-star")
  bezier((9, 0), (10.6, 0), (9.3, 1.2), (10.3, -0.6), stroke: theme.red); cap(9.8, "bezier")
  catmull((11.2, 0), (11.7, 1), (12.2, 0.2), (12.8, 0.9), stroke: theme.blue); cap(12, "catmull")
  hobby((13.4, 0), (13.9, 1), (14.4, 0.2), (15, 0.9), stroke: theme.green); cap(14.2, "hobby")
  // Middle row: marks and path decorations
  let y = 2.2
  for (i, m) in (">", ">>", "|", "o", "<>", "]", "x").enumerate() {
    line((i * 1.1, y), (i * 1.1 + 0.8, y), mark: (end: m))
    content((i * 1.1 + 0.4, y - 0.15), text(font: theme.mono, fill: theme.muted, size: 0.75em, m), anchor: "north")
  }
  cetz.decorations.zigzag(line((8, y), (10, y)), amplitude: 0.15, segments: 8)
  cetz.decorations.wave(line((10.5, y), (12.5, y)), amplitude: 0.15, segments: 6, stroke: theme.blue)
  cetz.decorations.coil(line((13, y), (15, y)), amplitude: 0.25, segments: 8, stroke: theme.orange)
  for (x, t) in ((9, "zigzag"), (11.5, "wave"), (14, "coil")) {
    content((x, y - 0.35), text(font: theme.mono, fill: theme.muted, size: 0.75em, t), anchor: "north")
  }
  // Top row: grid, content frames, text along a line
  grid((0, 3), (3, 3.9), step: 0.3, stroke: theme.border + 0.4pt)
  content((5, 3.45), [frame: "rect"], frame: "rect", padding: 0.12, fill: theme.code-bg, stroke: theme.border)
  content((8.5, 3.45), [frame: "circle"], frame: "circle", padding: 0.05, stroke: theme.accent)
  line((10.5, 3.1), (14.5, 3.8), stroke: theme.muted, name: "l")
  content(("l.start", 50%, "l.end"), angle: "l.end", anchor: "south", padding: 0.08, text(size: 0.8em)[text along a line])
})
```

Reusable parts with `group`, `scope` and transforms:

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 12.5, theme.height / 3.4), padding: 0.1, {
  import cetz.draw: *
  set-style(stroke: theme.fg, mark: (fill: theme.fg))
  // A reusable part: a function that draws a named group around (0, 0)
  let server(name, label, c) = group(name: name, {
    rect((-0.7, -0.9), (0.7, 0.9), radius: 0.1, fill: c.transparentize(85%), stroke: c, name: "box")
    for y in (0.45, 0, -0.45) {
      rect((-0.5, y - 0.15), (0.5, y + 0.15), stroke: c + 0.6pt)
      circle((0.35, y), radius: 0.05, fill: c, stroke: none)
    }
    content((0, -1.15), label, anchor: "north")
  })
  // translate() inside scope() moves only what is in the scope
  for (i, (name, c)) in (("eu", theme.blue), ("us", theme.green), ("ap", theme.orange)).enumerate() {
    scope({ translate((i * 2.4, 0)); server(name, text(font: theme.mono, name), c) })
  }
  // Anchors of a named child work outside the group: "eu.box.east"
  // ("eu.east" is the east of the whole group, label included)
  line("eu.box.east", "us.box.west", mark: (start: ">", end: ">"))
  line("us.box.east", "ap.box.west", mark: (start: ">", end: ">"))
  // rotate() and scale() in a scope: a clock with 12 ticks
  scope({
    translate((8.6, 0))
    circle((0, 0), radius: 1.3, stroke: theme.border + 1.5pt)
    for i in range(12) {
      scope({ rotate(i * 30deg); line((0, 1.05), (0, 1.25), stroke: theme.muted + 1.5pt) })
    }
    rotate(-60deg) // the hand: 2 o'clock
    line((0, 0), (0, 0.95), stroke: theme.accent + 2pt, mark: (end: ">", fill: theme.accent))
  })
  // set-style per element type: every later circle gets this fill
  set-style(circle: (fill: theme.purple.transparentize(70%), stroke: theme.purple))
  scope({ scale(y: 50%); circle((11.4, 0), radius: 0.6) })
  content((11.4, -0.6), text(fill: theme.muted, size: 0.8em)[scale(y: 50%)])
})
```

## 11. Traps

- Default black: strokes, the `brace` fill, `grid` lines. Marks are hollow until you give `fill`. Set them all from `theme`.
- `"g.east"` of a group is the bounding box of the whole group, label included. Name the inner shape and use `"g.box.east"`.
- `translate`, `rotate` and `set-style` stay active until the end of the scope. Wrap local changes in `scope({ ... })`.
- `arc(p, ...)` puts the arc **start** on p. To give the centre, add `anchor: "origin"`.
- The canvas bounding box ignores stroke width: thick strokes at the edge are cut. Add canvas `padding`.
- Text has a fixed size. If labels overlap, make the unit box smaller (fewer units = bigger units), not the text.
- In `content`, `$` and `~` are markup: write `\$` and `\~`. A variable named `h` hides the `h()` function: do not use it.
- In a tree, `draw-edge` gets node dictionaries, not names: `from + ".south"` fails with "cannot add dictionary and string".
- A raw compile of the template reports errors at `md.typ:891`. Use `scripts/check.sh` for the line in your block.
