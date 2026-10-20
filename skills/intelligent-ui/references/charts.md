# cetz-plot 0.1.4: `chart`, and custom charts

`chart` draws category charts: bars, columns, pies and donuts, pyramids, radar, box plots.
For a chart type that cetz-plot does not have (candlestick, gantt, waterfall, heatmap, bullet bars, sparklines),
draw it with cetz shapes in a scaled unit box (section 3). For numeric x/y plots see plot.md.
Every ```` ```typst ```` example in this file was compiled with the real template, in dark and light.

Contents
1. Which chart for which data
2. `chart` functions: bar and column, pie and donut, pyramid and radar, box plot
3. Custom charts: candlestick, ratio bars with a reference line, heatmap, gantt, waterfall, sparklines, bullet bars
4. Traps

Import: `#import "@preview/cetz:0.5.2"` and `#import "@preview/cetz-plot:0.1.4": chart`. A chart goes in a `cetz.canvas`.

## 1. Which chart for which data

| Data | Use |
|---|---|
| a few named values, long names | `chart.barchart` (horizontal) |
| values per period or category | `chart.columnchart`, `mode: "clustered"` for 2–4 series |
| parts of one whole, per category | `columnchart` `mode: "stacked"`, or `"stacked100"` for shares |
| parts of one whole, 2–6 parts | `chart.piechart` (donut with `inner-radius`) |
| a funnel or a hierarchy of sizes | `chart.pyramid` |
| a profile on 5–8 axes | `chart.radarchart` |
| distributions per group | `chart.boxwhisker`, or `plot.add-violin` (plot.md) |
| a trend over numeric x | `plot.add` (plot.md) |
| price open/high/low/close | candlestick (3.1) |
| progress against a target | ratio bars (3.2) or bullet bars (3.7) |
| a value per (row, column) | heatmap (3.3) |
| tasks over time | gantt (3.4) |
| how a total changes step by step | waterfall (3.5) |
| many small trends in a table | sparklines (3.6) |

## 2. `chart` functions

All chart axes and the legend need the theme style, as in plot.md. The bar, column and box charts also set
their own dotted gray grid: override it under the chart's style root (`barchart`, `columnchart`, `boxwhisker`).
`bar-style`, `slice-style`, `level-style` and `data-style` default to a red palette: always pass theme colours.

### Bar and column charts

- `chart.columnchart(data, label-key: 0, value-key: 1, mode: "basic", size: (W, H), bar-style: i => (...), labels: (...), x-label:, y-label:, y-format:, ..plot-args)`.
- `chart.barchart(...)`: the same with horizontal bars (`x-format`). The first row is at the top.
- Rows: `([Q1], 12)` for basic; `([Q1], 12, 8, 4)` with `value-key: (1, 2, 3)` for clustered and stacked.
- `mode`: `"basic"`, `"clustered"`, `"stacked"`, `"stacked100"` (the value axis shows %).
- `labels: ([EU], [US], [AP])` names the series in the legend (one per value key).
- Extra arguments go to `plot.plot`: `legend: "inner-north-west"`, `x-tick-step: 20`, `x-min: 0`, `y-max: 100`, ...
- Style root: `set-style(columnchart: (bar-width: 0.8, cluster-gap: 0, x-inset: 1, axes: (...)))`; `barchart` has `y-inset`.
- Always give both numbers of `size`.

Clustered and stacked100 columns, side by side (a Typst `grid` of two canvases, each with `length` from `theme.width / 2`):

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": chart
#let style = (
  axes: (stroke: theme.fg, tick: (stroke: theme.fg)),
  legend: (fill: theme.bg, stroke: theme.border),
  // The charts set their own dotted gray grid: override it under the chart's root
  columnchart: (axes: (grid: (stroke: (paint: theme.border, dash: "dotted")))),
)
// One style per bar index (basic) or per series (clustered/stacked)
#let bars = i => (fill: theme.palette.at(calc.rem(i, 6)).transparentize(25%), stroke: none)
#let data = (([Q1], 12, 8, 4), ([Q2], 15, 9, 6), ([Q3], 11, 12, 7), ([Q4], 18, 10, 9))
// Two charts side by side: a grid of two canvases, each half the width
#grid(columns: (1fr, 1fr), column-gutter: 1em,
  cetz.canvas(length: calc.min(theme.width / 2 / 8, theme.height / 5.5), {
    cetz.draw.set-style(..style)
    chart.columnchart(data, mode: "clustered", value-key: (1, 2, 3), size: (7, 4),
      labels: ([EU], [US], [AP]), legend: "inner-north-west", bar-style: bars, y-label: [M\$])
  }),
  cetz.canvas(length: calc.min(theme.width / 2 / 8, theme.height / 5.5), {
    cetz.draw.set-style(..style)
    chart.columnchart(data, mode: "stacked100", value-key: (1, 2, 3), size: (7, 4),
      labels: ([EU], [US], [AP]), legend: none, bar-style: bars, y-label: [share])
  }),
)
```

Horizontal bars, one bar highlighted:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": chart
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg)),
    legend: (fill: theme.bg, stroke: theme.border),
    barchart: (bar-width: 0.7, axes: (grid: (stroke: (paint: theme.border, dash: "dotted")))),
  )
  // barchart: horizontal bars; the first row is drawn at the top
  let langs = (([Rust], 82), ([TypeScript], 74), ([Go], 61), ([Python], 58), ([Java], 40))
  chart.barchart(langs, size: (15, 4), x-label: [% who would use it again],
    x-tick-step: 20, x-min: 0, x-max: 100,
    bar-style: i => (fill: if i == 0 { theme.accent } else { theme.muted.transparentize(40%) }, stroke: none))
})
```

### Pie and donut

- `chart.piechart(data, value-key: 1, label-key: 0, slice-style: (...), outset: 0, radius: 1, inner-radius: 0, ...)`.
- Data: numbers, arrays or dictionaries; `value-key` and `label-key` pick the fields.
- `slice-style`: an array of styles or colours, a function `i => style`, or a gradient.
- Style keys: `radius`, `inner-radius` (> 0 makes a donut), `gap: 0.5deg`, `start: 90deg`, `stop: 450deg`, `clockwise: true`,
  `outset: 0` (or `(0, 2)`) with `outset-offset: 10%` and `outset-mode: "OFFSET" | "RADIUS"`.
- `outer-label: (content: "LABEL" | "%" | "VALUE" | none | (value, label) => content, radius: 125%, angle: 0deg, anchor: "center")`;
  `inner-label` has the same keys (default `content: none`, `radius: 150%` of the mid radius).
- The legend is on when any item has a label: `legend: (label: none)` turns it off. When on, it needs `fill: theme.bg`.
  Keys: `label`, `position: "south"`, `anchor: "north"`, `orientation: ltr`, `item: (spacing: ...)`.
- Anchors: `"item-0"` (outer radius of slice 0), `"item-0-inner"`. Text in the donut hole: `cetz.draw.content((0, 0), ...)`.

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": chart
#let data = (([Chrome], 64), ([Safari], 19), ([Edge], 5), ([Firefox], 3), ([Other], 9))
#let slices = data.enumerate().map(((i, _)) => (fill: theme.palette.at(i).transparentize(15%), stroke: theme.bg + 1.5pt))
#grid(columns: (1fr, 1fr), align: center + horizon,
  // Pie: label-key/value-key pick the fields; outer labels outside, one slice pulled out
  cetz.canvas(length: theme.height / 3.6, {
    chart.piechart(data, value-key: 1, label-key: 0, radius: 1, slice-style: slices,
      outset: 0, outset-offset: 12%,
      // A function label: skip small slices so labels do not collide
      inner-label: (content: (v, l) => if v >= 5 { text(fill: theme.bg, weight: "bold", size: 0.85em, str(v) + "%") }, radius: 120%),
      outer-label: (content: "LABEL", radius: 135%),
      // The legend is on by default (legend.label: "LABEL", white fill): turn it off here
      legend: (label: none))
  }),
  // Donut: inner-radius > 0; the legend below needs fill: theme.bg (its default is white)
  cetz.canvas(length: theme.height / 3.6, {
    chart.piechart(data, value-key: 1, label-key: 0, radius: 1, inner-radius: 0.6, slice-style: slices,
      gap: 1deg, outer-label: (content: none),
      legend: (label: "LABEL", fill: theme.bg, item: (spacing: 0.3)))
    cetz.draw.content((0, 0), text(size: 1.2em, weight: "bold")[100 M])
  }),
)
```

### Pyramid and radar

- `chart.pyramid(data, label-key: 0, value-key: 1, level-style: i => (...), mode: "REGULAR" | "AREA-HEIGHT" | "HEIGHT" | "WIDTH", level-height: 1, gap: 0)`.
  The first row is the top level. `inner-label: (content: "LABEL" | "%" | "VALUE" | function, force-inside: false)`,
  `side-label: (content: ..., side: "west" | "east")`. Anchors: `"levels.0"`, `"levels.0.east"`.
- `chart.radarchart(labels, rows, data-style: i => (...), radius: 2, web-ticks: 4, web-style: (stroke: ...), web-label-offset: 0.4)`.
  Each value is a fraction **0..1 of the radius** (the source doc says 0..radius; a value of 2 with radius 2 lands far outside).
  The spokes use the current stroke: `set-style(stroke: theme.border)` first. There is no legend: add `content` lines.

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": chart
#grid(columns: (1fr, 1fr), align: center + horizon,
  // Pyramid: the first row is the top level
  cetz.canvas(length: theme.height / 5, {
    chart.pyramid(
      (([Paid], 60), ([Trials], 180), ([Sign-ups], 420), ([Visits], 1000)),
      label-key: 0, value-key: 1, mode: "REGULAR", level-height: 0.9, gap: 0.08,
      level-style: i => (fill: theme.palette.at(i).transparentize(30%), stroke: none),
      inner-label: (content: "LABEL"),
      side-label: (content: (v, l) => text(fill: theme.muted, str(v)), side: "east"))
  }),
  // Radar: values are fractions 0..1 of the radius (not 0..radius);
  // the spokes use the current stroke, the web uses web-style
  cetz.canvas(length: theme.height / 5.2, {
    cetz.draw.set-style(stroke: theme.border)
    chart.radarchart(
      ([Speed], [Memory], [Safety], [Tooling], [Docs], [Hiring]),
      ((0.9, 0.8, 1, 0.7, 0.65, 0.4), (0.6, 0.5, 0.45, 0.95, 0.9, 0.95)),
      radius: 2, web-ticks: 4,
      web-style: (stroke: theme.border),
      data-style: i => (stroke: theme.palette.at(i) + 1.5pt, fill: theme.palette.at(i).transparentize(75%)))
    cetz.draw.content((2.6, 2), text(fill: theme.palette.at(0))[■ Rust], anchor: "west")
    cetz.draw.content((2.6, 1.6), text(fill: theme.palette.at(1))[■ Go], anchor: "west")
  }),
)
```

### Box plot chart

- `chart.boxwhisker(boxes, size: (W, H), label-key: "label", mark: "*", ..plot-args)`; each box is
  `(label: [..], min:, q1:, q2:, q3:, max:, outliers: (...))`.
- The boxes take `plot-style` and the outliers `mark-style` (both via plot-args); the defaults are blue, red, green, yellow.
- Style root `boxwhisker: (box-width: 0.75, whisker-width: 0.5, mark-size: 0.15, axes: (...))`.

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": chart
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg)),
    // Root "boxwhisker": the boxes' style and the chart's dotted gray grid
    boxwhisker: (box-width: 0.5, axes: (grid: (stroke: (paint: theme.border, dash: "dotted")))),
  )
  // Rows: (label, min, q1, q2, q3, max, outliers) as dictionaries; x is the row's position
  chart.boxwhisker(size: (15, 4), label-key: "label", y-min: 0, y-max: 100, y-tick-step: 25, y-grid: true, y-label: [ms],
    // The boxes take plot-style (default: blue, red, green, yellow), the outliers mark-style
    plot-style: i => (stroke: theme.fg, fill: theme.green.transparentize(75%)),
    mark-style: i => (stroke: theme.red, fill: theme.red.transparentize(50%)),
    (
      (label: [eu-west], min: 12, q1: 25, q2: 33, q3: 44, max: 60, outliers: (72, 88)),
      (label: [us-east], min: 9, q1: 18, q2: 24, q3: 31, max: 45, outliers: (63,)),
      (label: [ap-south], min: 20, q1: 34, q2: 45, q3: 58, max: 79, outliers: ()),
      (label: [sa-east], min: 15, q1: 28, q2: 37, q3: 49, max: 66, outliers: (91,)),
    ))
})
```

## 3. Custom charts

The pattern: choose a W × H unit box, write a function that maps a data value to units (`y(p) = (p - lo) / (hi - lo) * H`),
and draw with `rect`, `line` and `content`. Keep labels in fixed columns (left of the box for names, right for notes),
so no label crosses a bar or a reference line.

### 3.1 Candlestick (OHLC)

Green body when close ≥ open, red otherwise; the wick spans low to high. cetz-plot 0.1.4 has no candlestick.

```typst
#import "@preview/cetz:0.5.2"
// Candlestick (cetz-plot 0.1.4 has none): map prices into a W x H unit box by hand
#let ohlc = ((101, 106, 99, 104), (104, 108, 103, 107), (107, 107, 101, 102), (102, 104, 97, 98),
  (98, 103, 96, 102), (102, 109, 101, 108), (108, 112, 106, 110), (110, 111, 104, 105),
  (105, 107, 100, 101), (101, 106, 100, 105), (105, 113, 104, 112), (112, 115, 109, 114))
#let (W, H) = (14, 4)
#let (lo, hi) = (95, 116)
#let y(p) = (p - lo) / (hi - lo) * H
#let dx = W / ohlc.len()
#cetz.canvas(length: calc.min(theme.width / (W + 1.2), theme.height / (H + 0.8)), {
  import cetz.draw: *
  // Grid lines and price labels in a fixed column left of the box
  for p in range(lo + 5, hi + 1, step: 5) {
    line((0, y(p)), (W, y(p)), stroke: theme.border + 0.5pt)
    content((-0.15, y(p)), text(fill: theme.muted, size: 0.8em, str(p)), anchor: "east")
  }
  line((0, 0), (W, 0), stroke: theme.fg)
  for (i, (o, h, l, c)) in ohlc.enumerate() {
    let x = (i + 0.5) * dx
    let col = if c >= o { theme.green } else { theme.red }
    line((x, y(l)), (x, y(h)), stroke: col + 1pt)                       // wick
    rect((x - dx * 0.3, y(calc.min(o, c))), (x + dx * 0.3, y(calc.max(o, c))),
      fill: col, stroke: none)                                            // body
    content((x, -0.15), text(fill: theme.muted, size: 0.75em, "D" + str(i + 1)), anchor: "north")
  }
})
```

### 3.2 Ratio bars with a 100% reference line

Values and notes go in fixed columns right of the longest bar. The reference line is drawn last.

```typst
#import "@preview/cetz:0.5.2"
// Horizontal ratio bars against a 100% target. Values and notes sit in fixed columns
// right of the longest bar, so no label crosses the dashed reference line.
#let rows = (([Build time], 0.62, [CI cache on]), ([Bundle size], 0.88, [tree-shaken]),
  ([Cold start], 1.18, [over budget]), ([Memory], 0.95, []), ([Test time], 0.41, [parallel]))
#let (W, H) = (15, rows.len() * 0.8)
#let label-w = 2.6   // column for row names
#let bar-w = 8       // 100% = 8 units
#let max-r = calc.max(..rows.map(r => r.at(1)))
#let note-x = label-w + bar-w * calc.max(max-r, 1) + 0.4
#cetz.canvas(length: calc.min(theme.width / W, theme.height / (H + 1)), {
  import cetz.draw: *
  for (i, (name, r, note)) in rows.enumerate() {
    let yy = H - (i + 0.5) * 0.8
    let c = if r > 1 { theme.red } else if r > 0.9 { theme.orange } else { theme.green }
    content((label-w - 0.2, yy), name, anchor: "east")
    rect((label-w, yy - 0.25), (label-w + bar-w * r, yy + 0.25), fill: c.transparentize(30%), stroke: none)
    content((note-x + 0.9, yy), text(size: 0.85em, str(int(r * 100)) + "%"), anchor: "east")
    content((note-x + 1.2, yy), text(fill: theme.muted, size: 0.85em, note), anchor: "west")
  }
  // The 100% line, drawn last so it is on top; its label goes above the rows
  line((label-w + bar-w, 0), (label-w + bar-w, H + 0.1), stroke: (paint: theme.fg, dash: "dashed"))
  content((label-w + bar-w, H + 0.1), text(fill: theme.muted, size: 0.8em)[budget 100%], anchor: "south")
})
```

### 3.3 Heatmap

`color.mix((theme.bg, (1 - t) * 100%), (c, t * 100%))` gives a scale that fades into the background in both modes.

```typst
#import "@preview/cetz:0.5.2"
// Heatmap: one rect per cell, colour = theme colour mixed by value
#let days = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
#let hours = range(0, 24)
#let v(d, hr) = calc.max(0, calc.sin((hr - 6) / 24 * 2 * calc.pi)) * (if d < 5 { 1 } else { 0.4 }) + calc.rem(d * 7 + hr * 3, 5) / 20
#let (W, H) = (24 * 0.6, 7 * 0.5)
#cetz.canvas(length: calc.min(theme.width / (W + 2.2), theme.height / (H + 1.2)), {
  import cetz.draw: *
  for (d, day) in days.enumerate() {
    let yy = H - (d + 1) * 0.5
    content((-0.15, yy + 0.25), text(fill: theme.muted, size: 0.8em, day), anchor: "east")
    for hr in hours {
      let t = calc.min(1, v(d, hr))
      // color.mix blends two theme colours; t = 0 is the background
      let c = color.mix((theme.bg, (1 - t) * 100%), (theme.orange, t * 100%))
      rect((hr * 0.6, yy), (rel: (0.56, 0.46)), fill: c, stroke: none, radius: 0.04)
    }
  }
  for hr in range(0, 24, step: 3) {
    content((hr * 0.6 + 0.28, -0.1), text(fill: theme.muted, size: 0.75em, str(hr) + "h"), anchor: "north")
  }
  // Legend: a gradient bar in its own column
  rect((W + 0.4, 0), (W + 0.7, H), stroke: theme.border, fill: gradient.linear(theme.orange, theme.bg, angle: 90deg))
  content((W + 0.8, H), text(fill: theme.muted, size: 0.75em)[high], anchor: "north-west")
  content((W + 0.8, 0), text(fill: theme.muted, size: 0.75em)[low], anchor: "south-west")
})
```

### 3.4 Gantt

```typst
#import "@preview/cetz:0.5.2"
// Gantt: tasks (name, start week, length, colour); time axis on top
#let tasks = (([Research], 0, 3, theme.blue), ([Design], 2, 3, theme.purple), ([Backend], 4, 6, theme.orange),
  ([Frontend], 5, 5, theme.orange), ([QA], 9, 3, theme.green), ([Launch], 12, 1, theme.red))
#let weeks = 14
#let (lw, uw, rh) = (2.4, 0.9, 0.6)   // label column, units per week, row height
#let H = tasks.len() * rh
#cetz.canvas(length: calc.min(theme.width / (lw + weeks * uw + 0.3), theme.height / (H + 1)), {
  import cetz.draw: *
  for w in range(weeks + 1) {
    line((lw + w * uw, 0), (lw + w * uw, H), stroke: theme.border + 0.4pt)
    if w < weeks { content((lw + (w + 0.5) * uw, H + 0.1), text(fill: theme.muted, size: 0.75em, "W" + str(w + 1)), anchor: "south") }
  }
  for (i, (name, s, n, c)) in tasks.enumerate() {
    let yy = H - (i + 1) * rh
    content((lw - 0.2, yy + rh / 2), name, anchor: "east")
    rect((lw + s * uw, yy + 0.1), (lw + (s + n) * uw, yy + rh - 0.1), fill: c.transparentize(40%), stroke: c, radius: 0.08)
  }
  // Today marker
  let today = lw + 6.4 * uw
  line((today, -0.05), (today, H), stroke: theme.red + 1.2pt)
  content((today, -0.05), text(fill: theme.red, size: 0.75em)[today], anchor: "north")
})
```

### 3.5 Waterfall

```typst
#import "@preview/cetz:0.5.2"
// Waterfall: each step starts where the last one ended; totals are full bars
#let steps = (([Q3 ARR], 120, "total"), ([New], 34, "step"), ([Expansion], 18, "step"),
  ([Churn], -22, "step"), ([Downgrade], -9, "step"), ([Q4 ARR], 141, "total"))
#let (W, H, top) = (14, 4, 180)
#let y(v) = v / top * H
#let dx = W / steps.len()
#cetz.canvas(length: calc.min(theme.width / (W + 1), theme.height / (H + 1)), {
  import cetz.draw: *
  for v in range(0, top + 1, step: 40) {
    line((0, y(v)), (W, y(v)), stroke: theme.border + 0.4pt)
    content((-0.15, y(v)), text(fill: theme.muted, size: 0.8em, str(v)), anchor: "east")
  }
  let run = 0
  for (i, (name, v, kind)) in steps.enumerate() {
    let (a, b, c) = if kind == "total" { (0, v, theme.blue) } else if v >= 0 { (run, run + v, theme.green) } else { (run + v, run, theme.red) }
    run = if kind == "total" { v } else { run + v }
    let x0 = i * dx + dx * 0.15
    rect((x0, y(a)), (x0 + dx * 0.7, y(b)), fill: c.transparentize(25%), stroke: none)
    let sign = if kind == "step" and v > 0 { "+" } else { "" }
    content((x0 + dx * 0.35, y(calc.max(a, b)) + 0.08), text(size: 0.8em, sign + str(v)), anchor: "south")
    content((x0 + dx * 0.35, -0.1), text(fill: theme.muted, size: 0.8em, name), anchor: "north")
    // Connector to the next bar
    if i < steps.len() - 1 {
      line((x0 + dx * 0.7, y(run)), (x0 + dx * 1.15, y(run)), stroke: (paint: theme.muted, dash: "dotted"))
    }
  }
})
```

### 3.6 Sparklines in a table

Small canvases (`length: 1em`) inside a Typst `table`; no axes.

```typst
#import "@preview/cetz:0.5.2"
// Sparklines: one tiny canvas per row inside a Typst table
#let spark(ys, c) = cetz.canvas(length: 1em, {
  import cetz.draw: *
  let (lo, hi) = (calc.min(..ys), calc.max(..ys))
  let pts = ys.enumerate().map(((i, v)) => (i * 6 / (ys.len() - 1), (v - lo) / (hi - lo) * 1.2))
  line(..pts, stroke: c + 1pt)
  circle(pts.last(), radius: 0.12, fill: c, stroke: none)
})
#let rows = (
  ([API p95], (210, 190, 230, 250, 240, 280, 300, 290, 320), [320 ms], theme.red),
  ([Error rate], (2.1, 1.8, 1.5, 1.6, 1.2, 1.1, 0.9, 1.0, 0.8), [0.8 %], theme.green),
  ([Sign-ups], (40, 42, 39, 51, 55, 53, 60, 64, 71), [71 /day], theme.blue),
  ([Queue depth], (5, 9, 4, 12, 6, 15, 7, 11, 8), [8], theme.orange),
)
#table(columns: (auto, auto, auto), stroke: none, inset: (x: 10pt, y: 5pt), align: (left + horizon, center + horizon, right + horizon),
  table.header(text(fill: theme.muted)[metric], text(fill: theme.muted)[last 9 days], text(fill: theme.muted)[now]),
  table.hline(stroke: theme.border),
  ..rows.map(((n, ys, now, c)) => (n, spark(ys, c), strong(now))).flatten(),
)
```

### 3.7 Bullet bars

Bands for poor/ok/good, the value as a thin bar, the target as a tick.

```typst
#import "@preview/cetz:0.5.2"
// Bullet bars: bands (poor/ok/good), the value bar and a target tick per row
#let rows = (([Revenue], 0.72, 0.85, [\$7.2M of \$8.5M]), ([Profit], 0.55, 0.6, [22% margin]),
  ([New users], 0.93, 0.8, [9.3k, target 8k]), ([NPS], 0.38, 0.5, [38]))
#let (lw, bw, rh) = (2.4, 9, 0.75)
#let H = rows.len() * rh
#cetz.canvas(length: calc.min(theme.width / (lw + bw + 3.6), theme.height / (H + 0.3)), {
  import cetz.draw: *
  for (i, (name, v, target, note)) in rows.enumerate() {
    let y0 = H - (i + 1) * rh + 0.12
    content((lw - 0.2, y0 + 0.25), strong(name), anchor: "east")
    // Bands: three muted shades
    for (a, b, t) in ((0, 0.5, 85%), (0.5, 0.8, 78%), (0.8, 1, 70%)) {
      rect((lw + a * bw, y0), (lw + b * bw, y0 + 0.5), fill: theme.muted.transparentize(t), stroke: none)
    }
    rect((lw, y0 + 0.17), (lw + v * bw, y0 + 0.33), fill: theme.fg, stroke: none)
    line((lw + target * bw, y0 + 0.05), (lw + target * bw, y0 + 0.45), stroke: theme.orange + 2pt)
    content((lw + bw + 0.3, y0 + 0.25), text(fill: theme.muted, size: 0.85em, note), anchor: "west")
  }
})
```

## 4. Traps

- `bar-style`, `slice-style`, `level-style`, `data-style` default to `cetz.palette.red`. `cetz.palette.new(colors: theme.palette)`
  keeps a **black** stroke: write a function `i => (fill: theme.palette.at(calc.rem(i, 6)), stroke: none)` instead.
- Bar and box charts set `axes: (grid: (stroke: (dash: "dotted", paint: gray)))` inside their group, and this wins over a
  global `axes` grid style (the column chart sets only the dash). Set the grid under the chart root: `barchart: (axes: (grid: ...))`.
- `chart.boxwhisker` colours come from `plot-style`, not from `set-style(fill: ...)`.
- `piechart` shows a white legend whenever items have labels. Turn it off (`legend: (label: none)`) or give it `fill: theme.bg`.
- Small pie slices: their inner labels collide. Use a label function that returns `none` below a limit.
- `radarchart` values are fractions of the radius (0..1).
- In content, `$` starts math: write `[M\$]`, `[\$7.2M]`.
- The default `size: (auto, 1)` of bar and column charts gives a tiny chart: always give `size: (W, H)`.
