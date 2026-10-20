# cetz-plot 0.1.4: `plot`

Use `plot` for data on numeric axes: lines, scatter, functions, bands, log scales, bars on a numeric x,
error bars, box and violin plots, contours. For category charts (bars by name, pies, radar) see charts.md.
Every ```` ```typst ```` example in this file was compiled with the real template, in dark and light.

Contents
1. Set-up: imports, size, theme style
2. `plot.plot` parameters
3. Axis options (`x-…`, `y-…`, `x2-…`, `y2-…`)
4. Series colours: `plot-style`, `mark-style`, `style`
5. The add functions
6. Legend
7. Recipes: lines, scatter, functions, band, log, dual axis, histogram, error bars, box/violin, contour, annotations
8. Traps

## 1. Set-up

```
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg, minor-stroke: theme.muted),
      grid: (stroke: theme.border + 0.5pt), minor-grid: (stroke: theme.border + 0.25pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  plot.plot(size: (15, 4), ..., { plot.add(...) })
})
```

- `size: (W, H)` is the data area in canvas units, without tick labels and axis labels.
  Allow about 1.5 units for them: `length: calc.min(theme.width / (W + 1.5), theme.height / (H + 1.5))`.
  `(15, 4)` with `/ 16.5` and `/ 5.5` fills a wide, short room.
- The `set-style` lines are required. Axes, ticks and the legend border are black by default, the legend
  fill is white, the grid is light gray. With school-book axes, also set `axes: (mark: (fill: theme.fg))` for the arrow heads.
- Normal cetz shapes are not allowed in the plot body. Wrap them in `plot.annotate({ ... })` (section 5).

## 2. `plot.plot` parameters

| Parameter | Values |
|---|---|
| `size` | `(width, height)` in canvas units |
| `axis-style` | `"scientific"` (frame, default), `"scientific-auto"` (only used axes), `"school-book"` (arrows crossing at 0), `"left"` (arrows at the min sides), `none` |
| `plot-style`, `mark-style` | a style dictionary or a function `i => style` (i = the index of the data call) |
| `fill-below` | `true` (default): fills are drawn below the axes |
| `legend` | `auto`, a position string (section 6), a coordinate, or `none` |
| `legend-anchor` | the legend's anchor at that position (default: the opposite one) |
| `legend-style` | legend style overrides (section 6) |
| `name` | element name; the plot's anchors work outside: `"p.north"`, and `add-anchor` points: `"p.peak"` |
| `x-…`, `y-…`, ... | axis options (section 3) |

## 3. Axis options

Prefix each option with the axis name: `x-min: 0`, `y-tick-step: 10`, `y2-label: [mm]`.
Axes are `x`, `y`, `x2` (top), `y2` (right). A data call uses `axes: ("x", "y")` by default; use `axes: ("x", "y2")` for the right axis.

| Option | Values |
|---|---|
| `label` | content or `none`. The default is the axis name in italics (`x`, `y`): pass `none` to hide it |
| `min`, `max` | numbers or `auto`; min > max flips the axis |
| `tick-step` | `auto`, a number, or `none` (no step ticks) |
| `minor-tick-step` | a number or `none` |
| `ticks` | extra ticks: `(1, 2, 3)` or `((0, [Jan]), (1, [Feb]))`; with `tick-step: none` they are the only ticks |
| `format` | `"float"` (default), `"sci"`, or a function `v => content`; also `plot.formats.decimal`, `.sci`, `.fraction`, `.multiple-of` (π steps) |
| `decimals` | digits for `"float"` (default 2) |
| `mode` | `"lin"` (default) or `"log"`; with log, `min` must be > 0 |
| `base` | log base for the tick labels (default 10) |
| `grid` | `false`, `true` / `"major"`, `"minor"`, `"both"` |
| `break` | `true`: a zigzag at the axis start when min > 0 |
| `equal` | `"y"`: lock the x scale to the y scale (circles stay round) |
| `inset` | `(low, high)` extra space inside the axis ends |

Numeric tick labels are math (the math font). For category names, use `ticks:` with content or strings.

## 4. Series colours

The default series colours are Typst's blue, red, green, yellow and **black**. Always set theme colours, in one of two ways:

- Per call: `plot.add(data, style: (stroke: theme.blue + 1.5pt))`, `mark-style: (stroke: theme.blue, fill: theme.bg)`.
- For all calls: `plot.plot(plot-style: i => (stroke: theme.palette.at(calc.rem(i, 6)) + 1.5pt, fill: theme.palette.at(calc.rem(i, 6)).transparentize(75%)), mark-style: i => (...))`.
  `i` counts every data call in the body (also `add-hline`, `add-bar`, ...).
- Box plots, violins and error bars take their outlier and centre marks from `mark-style`: set it too.

## 5. The add functions

| Function | Main parameters |
|---|---|
| `plot.add(data, ...)` | data: array of `(x, y)`, or a function `x => y` (or `t => (x, y)` for parametric) with `domain: (a, b)`, `samples: 50`, `sample-at: (...)`. `line: "raw" \| "linear" \| "spline" \| "hv" \| "vh" \| "hvh"` or `(type: "spline", tension: 0.5)`. `mark: "o" \| "square" \| "triangle" \| "x" \| "+" \| "-" \| "\|" \| "<>" \| 5`, `mark-size: 0.2`, `mark-style`. `fill: true` (to y = 0, `fill-type: "axis"`) or `fill-type: "shape"`. `hypograph`, `epigraph`. `style`, `label`, `axes` |
| `plot.add-fill-between(a, b, ...)` | two data arrays or functions; `domain`, `samples`, `line`, `style: (fill: ..., stroke: none)`, `label` |
| `plot.add-hline(..ys, min: auto, max: auto)` | horizontal lines at y values; `style`, `label` |
| `plot.add-vline(..xs, min: auto, max: auto)` | vertical lines at x values |
| `plot.add-bar(data, ...)` | rows `(x, y)` or `(x, y1, y2, ...)`; `mode: "basic" \| "clustered" \| "stacked" \| "stacked100"`, `bar-width: 1`, `bar-position: "center" \| "start" \| "end"`, `cluster-gap`, `labels` (one or per series), `error-key`, `style` |
| `plot.add-errorbar((x, y), x-error: e, y-error: e)` | e is a number or `(down, up)`; `mark: "o"`, `mark-size`, `whisker-size` (in **x data units**), `style`, `mark-style`, `label` |
| `plot.add-boxwhisker(boxes)` | a dictionary or array of `(x:, min:, q1:, q2:, q3:, max:, outliers: (...))`; `box-width: 0.75`, `whisker-width: 0.5`, `mark: "*"`, `mark-size`, `style` |
| `plot.add-violin(data, ...)` | items `(x, (samples...))`; `side: "right" \| "left" \| "both"`, `bandwidth: 1`, `extents: 0.25`, `samples`, `style` |
| `plot.add-contour(f, z: (...), ...)` | `f: (x, y) => z` or a matrix; `x-domain`, `y-domain`, `x-samples: 25`, `y-samples: 25`, `op: auto \| ">" \| "<" \| ...`, `fill: true`, `style` (one style for all levels of one call) |
| `plot.annotate({ ... }, background: false)` | cetz shapes in data coordinates; `background: true` draws behind the data; `resize: false` keeps the axis range |
| `plot.add-anchor("name", (x, y))` | a named point in data coordinates, used outside as `"plotname.name"`; x or y can be `"min"`/`"max"` |
| `plot.add-legend([label], preview: ...)` | an extra legend entry |

`plot.sample-fn(f, domain, samples)` gives the sampled points of a function, if you need them.

## 6. Legend

- Positions: `"north"`, `"south"`, `"east"`, `"west"`, `"north-east"`, ... (outside the data area) and
  `"inner-north-west"`, `"inner-north"`, `"inner-south-east"`, ... (inside). `auto` = `"north-east"`.
- `legend-style: (orientation: ltr, item: (spacing: 0.4), padding: 0.1, spacing: 0.1, fill: theme.bg, stroke: theme.border)`.
  `orientation: ltr` makes one row; give it `item: (spacing: ...)` or the entries touch.
- Only calls with a `label` get an entry. Give one error bar of a loop a label (`label: if i == 0 [±2σ]`).

## 7. Recipes

Multi-series lines with markers, categories on x, minor grid:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg, minor-stroke: theme.muted),
      grid: (stroke: theme.border + 0.5pt), minor-grid: (stroke: theme.border + 0.25pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  let months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug")
  let series = (([web], (12, 15, 14, 19, 24, 28, 27, 33)), ([iOS], (8, 9, 12, 13, 15, 18, 22, 24)), ([Android], (5, 7, 8, 8, 11, 12, 14, 19)))
  plot.plot(
    size: (15, 4), x-label: none, y-label: [k users],
    x-ticks: months.enumerate(), x-tick-step: none, x-min: -0.3, x-max: 7.3,
    y-min: 0, y-max: 35, y-tick-step: 10, y-minor-tick-step: 5, y-grid: "both",
    legend: "inner-north-west",
    // One style per series index: the theme palette, never the default colours
    plot-style: i => (stroke: theme.palette.at(calc.rem(i, 6)) + 1.5pt),
    mark-style: i => (stroke: theme.palette.at(calc.rem(i, 6)), fill: theme.bg),
    {
      for (name, ys) in series {
        plot.add(ys.enumerate(), label: name, mark: "o", mark-size: 0.15)
      }
    })
})
```

Scatter (no stroke, marks only) with a dashed trend line:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), grid: (stroke: theme.border + 0.5pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  // Fake data: (size in KB, ms) for two groups
  let a = range(25).map(i => (i * 4 + calc.rem(i * 7, 5), 20 + i * 1.6 + calc.rem(i * 13, 9)))
  let b = range(25).map(i => (i * 4 + calc.rem(i * 3, 4), 12 + i * 0.7 + calc.rem(i * 11, 6)))
  plot.plot(size: (15, 4), x-label: [payload (KB)], y-label: [latency (ms)],
    x-min: -3, x-max: 103, y-min: 5, y-max: 70, x-grid: true, y-grid: true, legend: "inner-north-west", {
    // A scatter is plot.add with stroke: none and a mark
    plot.add(a, label: [gzip], mark: "o", mark-size: 0.18,
      style: (stroke: none), mark-style: (stroke: theme.orange, fill: theme.orange.transparentize(60%)))
    plot.add(b, label: [zstd], mark: "triangle", mark-size: 0.2,
      style: (stroke: none), mark-style: (stroke: theme.blue, fill: theme.blue.transparentize(60%)))
    // A trend line over the same axes
    plot.add(domain: (0, 100), x => 12 + 0.175 * x, style: (stroke: (paint: theme.muted, dash: "dashed")))
  })
})
```

Functions with school-book axes, π ticks and a step line:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  // school-book axes are arrows: their mark fill needs the theme colour too
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), mark: (fill: theme.fg)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  plot.plot(size: (15, 4), axis-style: "school-book",
    x-tick-step: calc.pi / 2, x-format: plot.formats.multiple-of,
    y-tick-step: 1, y-min: -1.5, y-max: 1.5,
    legend: "inner-south-east", legend-style: (orientation: ltr, item: (spacing: 0.4)), {
    plot.add(domain: (-calc.pi, 2 * calc.pi), samples: 120, calc.sin, label: $sin x$,
      style: (stroke: theme.blue + 1.5pt))
    plot.add(domain: (-calc.pi, 2 * calc.pi), samples: 120, x => calc.cos(x) / 2, label: $1/2 cos x$,
      style: (stroke: theme.orange + 1.5pt))
    // A step function: line: "hv"
    plot.add(range(-3, 7).map(x => (x, calc.rem(calc.abs(x), 2) - 0.5)), line: "hv", label: [step],
      style: (stroke: (paint: theme.green, dash: "dashed")))
  })
})
```

Band between two curves, and an area to y = 0:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), grid: (stroke: theme.border + 0.5pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  let f(x) = 50 + 30 * calc.sin(x / 2) + 2 * x
  plot.plot(size: (15, 4), x-label: [day], y-label: [req/s], y-min: 0, y-max: 140, y-grid: true, legend: "inner-north-west", {
    // Band between two functions (p10..p90)
    plot.add-fill-between(domain: (0, 20), x => f(x) - 8 - x / 2, x => f(x) + 8 + x / 2,
      label: [p10–p90], style: (fill: theme.blue.transparentize(80%), stroke: none))
    plot.add(domain: (0, 20), f, label: [median], style: (stroke: theme.blue + 1.5pt))
    // Area under a curve to y = 0: fill: true
    plot.add(domain: (0, 20), x => 10 + 5 * calc.cos(x / 3), fill: true, label: [errors],
      style: (stroke: theme.red, fill: theme.red.transparentize(75%)))
  })
})
```

Log–log axes:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg, minor-stroke: theme.muted),
      grid: (stroke: theme.border + 0.5pt), minor-grid: (stroke: theme.border + 0.25pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  let n = (1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024)
  plot.plot(size: (15, 4), x-label: [n], y-label: [ops],
    // log axes: mode "log", base for the tick labels; min must be > 0
    x-mode: "log", x-base: 2, x-tick-step: 1, x-min: 1, x-max: 1024,
    y-mode: "log", y-base: 10, y-tick-step: 1, y-minor-tick-step: 1, y-min: 1, y-max: 1e6,
    x-format: v => text(str(int(v))), y-format: v => $10^#calc.round(calc.log(v))$,
    y-grid: "both", x-grid: true, legend: "inner-north-west", {
    plot.add(n.map(x => (x, x)), label: $O(n)$, mark: "o", mark-size: 0.12, style: (stroke: theme.green), mark-style: (stroke: theme.green, fill: theme.bg))
    plot.add(n.map(x => (x, x * calc.log(x, base: 2) + 1)), label: $O(n log n)$, mark: "o", mark-size: 0.12, style: (stroke: theme.blue), mark-style: (stroke: theme.blue, fill: theme.bg))
    plot.add(n.map(x => (x, x * x)), label: $O(n^2)$, mark: "o", mark-size: 0.12, style: (stroke: theme.red), mark-style: (stroke: theme.red, fill: theme.bg))
  })
})
```

Dual y axes (bars on `y2`, line on `y`):

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 17, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), grid: (stroke: theme.border + 0.5pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  let temp = (3, 4, 8, 12, 16, 19, 22, 21, 17, 12, 7, 4)
  let rain = (60, 45, 50, 42, 55, 60, 50, 58, 62, 75, 80, 70)
  plot.plot(size: (15, 4), axis-style: "scientific", x-label: none,
    x-tick-step: 1, x-min: -0.6, x-max: 11.6,
    x-format: v => ("J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D").at(int(v)),
    y-label: text(fill: theme.orange)[°C], y-min: 0, y-max: 25, y-tick-step: 5, y-grid: true,
    // A secondary axis: name it y2 and plot with axes: ("x", "y2")
    y2-label: text(fill: theme.blue)[mm rain], y2-min: 0, y2-max: 100, y2-tick-step: 20,
    legend: "inner-north-west", {
    plot.add-bar(rain.enumerate(), bar-width: 0.6, axes: ("x", "y2"), labels: [rain],
      style: (fill: theme.blue.transparentize(70%), stroke: none))
    plot.add(temp.enumerate(), line: "spline", label: [temp], mark: "o",
      style: (stroke: theme.orange + 1.5pt), mark-style: (stroke: theme.orange, fill: theme.bg))
  })
})
```

Histogram with `add-bar` (bin the values first) and a mean line:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), grid: (stroke: theme.border + 0.5pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  // Histogram: count values into bins, then one bar per bin
  let data = range(400).map(i => calc.rem(i * 7919, 101) / 10 + calc.rem(i * 104729, 53) / 10)
  let (lo, step, k) = (0, 1, 16)
  let counts = range(k).map(b => data.filter(v => v >= lo + b * step and v < lo + (b + 1) * step).len())
  plot.plot(size: (15, 4), x-label: [response time (s)], y-label: [count],
    x-min: 0, x-max: k, x-tick-step: 2, y-min: 0, y-max: 45, y-grid: true, legend: "inner-north-east", {
    // bar-position: "start" puts each bar's left edge on its x (a bin start)
    plot.add-bar(counts.enumerate().map(((b, c)) => (lo + b * step, c)), bar-width: step, bar-position: "start",
      labels: [requests], style: (fill: theme.purple.transparentize(60%), stroke: theme.purple + 0.5pt))
    plot.add-vline(8.1, label: [mean], style: (stroke: (paint: theme.red, dash: "dashed")))
  })
})
```

Error bars (categorical x so the whisker width is even):

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), grid: (stroke: theme.border + 0.5pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  // (threads, mean ms, std dev); x is the row index, the tick labels name it
  let rows = ((1, 120, 8), (2, 64, 6), (4, 35, 5), (8, 21, 4), (16, 15, 5), (32, 14, 7))
  plot.plot(size: (15, 4), x-label: [threads], y-label: [ms],
    x-min: -0.5, x-max: 5.5, x-tick-step: none, x-ticks: rows.enumerate().map(((i, r)) => (i, str(r.at(0)))),
    y-min: 0, y-max: 140, y-grid: true, legend: "inner-north-east", {
    plot.add(rows.enumerate().map(((i, r)) => (i, r.at(1))), label: [mean], style: (stroke: theme.blue + 1.5pt))
    for (i, (_, y, e)) in rows.enumerate() {
      // y-error: a number (symmetric) or (down, up); whisker-size is in x data units
      plot.add-errorbar((i, y), y-error: 2 * e, mark: "o", mark-size: 0.15, whisker-size: 0.2,
        label: if i == 0 [±2σ], style: (stroke: theme.fg), mark-style: (fill: theme.blue, stroke: none))
    }
  })
})
```

Box plots and violins:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), grid: (stroke: theme.border + 0.5pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  // Outlier marks take the plot mark-style (default: blue, red, ...), so set it
  plot.plot(size: (15, 4), mark-style: i => (stroke: theme.fg, fill: theme.bg), x-min: 0.3, x-max: 6.7, x-label: none, y-label: [ms],
    x-ticks: ((1.5, [v1]), (3.5, [v2]), (5.5, [v3])), x-tick-step: none, y-min: 0, y-max: 80, y-grid: true, {
    // Box plots: one dictionary per box
    plot.add-boxwhisker((
      (x: 1, min: 12, q1: 22, q2: 30, q3: 41, max: 58, outliers: (66, 71)),
      (x: 3, min: 10, q1: 18, q2: 24, q3: 30, max: 44, outliers: (52,)),
      (x: 5, min: 8, q1: 14, q2: 17, q3: 22, max: 30, outliers: ()),
    ), box-width: 0.6, mark: "o", mark-size: 0.12,
      style: (stroke: theme.fg, fill: theme.blue.transparentize(75%)))
    // Violin plots: (x, (samples...)) items; side "both" draws a full violin
    let s(m, k) = range(40).map(i => m + calc.rem(i * 37, 23) * k / 10 - k)
    plot.add-violin(((2, s(32, 9)), (4, s(24, 6)), (6, s(17, 4))), side: "both", bandwidth: 3, extents: 0.4,
      style: (stroke: theme.purple, fill: theme.purple.transparentize(75%)))
  })
})
```

Contour levels (one call per level, so each level gets its own fill):

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  cetz.draw.set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  let f(x, y) = calc.exp(-((x - 1) * (x - 1) + y * y)) + 0.8 * calc.exp(-((x + 1.5) * (x + 1.5) + (y - 0.5) * (y - 0.5)) * 2)
  plot.plot(size: (15, 4), x-label: $x$, y-label: $y$, x-tick-step: 1, y-tick-step: 1,
    x-min: -4, x-max: 4, y-min: -1.6, y-max: 1.6, {
    // One add-contour per level: each level gets its own colour (one style covers all z of one call)
    for (i, z) in (0.1, 0.3, 0.5, 0.7, 0.9).enumerate() {
      plot.add-contour(f, z: z, op: ">=", fill: true, x-domain: (-4, 4), y-domain: (-1.6, 1.6),
        x-samples: 60, y-samples: 30,
        style: (fill: theme.orange.transparentize(85% - i * 12%), stroke: theme.orange + 0.6pt))
    }
  })
})
```

Annotations: a shaded span, a threshold, a vertical marker, and a callout drawn outside the plot:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 16.5, theme.height / 5.5), {
  import cetz.draw: *
  set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg), grid: (stroke: theme.border + 0.5pt)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  let cpu = (20, 22, 25, 24, 30, 45, 78, 92, 88, 60, 40, 32, 28, 26, 24, 23)
  plot.plot(size: (15, 4), name: "p", x-label: [minute], y-label: [CPU %], x-min: 0, x-max: 15, x-tick-step: 3,
    y-min: 0, y-max: 100, y-tick-step: 25, y-grid: true, legend: "inner-north-east", {
    // A shaded span behind the data: annotate(background: true) uses plot coordinates
    plot.annotate(background: true, {
      rect((5.5, 0), (9.5, 100), fill: theme.red.transparentize(88%), stroke: none)
      content((5.65, 97), text(fill: theme.red, size: 0.8em)[incident], anchor: "north-west")
    })
    plot.add(cpu.enumerate(), label: [cpu], style: (stroke: theme.blue + 1.5pt))
    plot.add-hline(80, label: [alert], style: (stroke: (paint: theme.orange, dash: "dashed")))
    plot.add-vline(7, style: (stroke: (paint: theme.muted, dash: "dotted")))
    // A named point to draw from outside the plot
    plot.add-anchor("peak", (7, 92))
  })
  // Outside the plot: canvas coordinates again, but "p.peak" still works
  content((rel: (2.2, -0.2), to: "p.peak"), text(fill: theme.fg, size: 0.85em)[peak 92% at 7 min], anchor: "west", name: "lbl")
  line("lbl.west", "p.peak", stroke: theme.muted, mark: (end: ">", fill: theme.muted))
})
```

## 8. Traps

- Black by default: axes, ticks, minor ticks, the legend border and the default series colour list (it ends in black). The legend fill is white: on dark, white text on a white box.
- The axis labels default to `x` and `y` in italics. Pass `x-label: none` if you do not want them.
- `size` excludes the tick labels and axis labels: leave about 1.5 units around it in the canvas `length`.
- `whisker-size` of `add-errorbar` and `bar-width` of `add-bar` are in x data units. On a log x axis they come out uneven: use a categorical x.
- With `mode: "log"`, values ≤ 0 have no place. Set `min` > 0 and keep the data > 0.
- Category ticks: `x-ticks: names.enumerate()` with `x-tick-step: none`, and `x-min`/`x-max` half a step outside the first and last index, or the end points sit on the frame.
- `auto` limits fit the data exactly: a band or a bar touches the frame. Set `y-max` a little higher.
- Normal cetz calls (`line`, `content`) in the plot body fail with "Expected plot sub-command in plot body". Put them in `plot.annotate`.
- A `fill: true` area fills to y = 0. Set `y-min: 0` so the area starts at the frame.
