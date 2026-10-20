---
name: intelligent-ui
description: Full Typst API, recipes and a compile check for the live ```typst blocks that Intelligent UI draws in the terminal. Load it before you write a complex or unusual typst block (a diagram, flow chart, state machine, architecture, chart, plot, timeline, tree, heatmap, gantt or custom layout that goes beyond the short examples in the system prompt), or after a typst block failed to compile and showed as code. Do not load it for normal Markdown answers, tables, math, or a drawing as simple as those examples.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/check.sh *)
---

# Intelligent UI: complex Typst drawings

Intelligent UI draws each answer as a picture with the template `render/md.typ`. A fenced ```typst (or ```typ) block is compiled live and drawn in the answer. This skill tells you how to write a block that compiles and looks right in dark and light mode, and how to check it before you answer.

## The contract

- Each block compiles alone, as Typst markup (begin code lines with `#`). It must start with its own `#import` lines:
  ```
  #import "@preview/cetz:0.5.2"
  #import "@preview/cetz-plot:0.1.4": plot, chart
  #import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
  ```
  These are the only packages. There is no network.
- Only `theme` is in scope. Its keys:
  - colours: `fg`, `muted`, `link`, `border`, `accent`, `bg`, `code-bg`, `red`, `green`, `blue`, `yellow`, `orange`, `purple`
  - `palette`: 6 colours in this order: blue, orange, green, red, purple, yellow
  - `width`: the content width (a length). `height`: the height a drawing should fit in (a length; 3/4 of the width when the terminal height is unknown). `page-width`: the page width.
  - `text-size` (11pt), `sans` and `mono` (font lists), `dark` (bool)
- Size: fit `theme.width` × `theme.height`. The terminal is wide and short, so lay flows out left to right. A drawing wider than its space is made smaller. A drawing taller than `theme.height` is never made smaller: the page grows and the answer gets long.
- The mod keeps the size of the first draw. When the terminal changes, it scales the whole drawing by one factor. So size from `theme.width` and `theme.height`, never from fixed page numbers.
- Text already has `theme.fg` and the body font. Strokes do not: the default stroke is black, which is invisible on a dark theme. Pass a theme colour to every stroke, axis, tick, legend and mark.
- Fill shapes with a theme colour `.transparentize(80%)`. Colour data series with `theme.palette` in order. Use `theme.muted` for secondary text.
- `#page`, `#pagebreak` and `#set page` are errors. A column break is dropped.
- One block that fails makes the whole answer compile again in safe mode: then every typst block and all math of that answer show as code. So one bad block spoils the full answer.

## Workflow for a complex drawing

1. Pick the package with the table below.
2. Read the one matching reference file (see the index). Do not read all of them.
3. Write the block body (no fences) to a scratch file outside the project, for example `/tmp/iui-draft.typ`.
4. Run `${CLAUDE_SKILL_DIR}/scripts/check.sh /tmp/iui-draft.typ`.
5. If a mode prints `error`, read the diagnostics, fix the file and run it again.
6. Read the dark PNG and the light PNG with the Read tool. Look for: text shown as code (the block did not compile), overlap, labels that cut lines, invisible strokes, a drawing taller than the box, empty space.
7. Fix and check again until both modes are right. Then paste the exact block from the file into the answer, in a ```typst fence.

For a full answer with Markdown around the drawings, write it to a `.md` file and check that file: it compiles the way the mod does.

### Which package

| You want to draw | Use | Reference |
|---|---|---|
| Flow chart, pipeline, state machine, architecture boxes and arrows, commutative diagram | fletcher | `fletcher.md` |
| Free drawing: timeline, tree, geometry, custom shapes, annotated figures, layouts with exact positions | cetz | `cetz.md` |
| Line, scatter or function plot, filled area, bar or error bars on numeric axes, contour | cetz-plot `plot` | `plot.md` |
| Bar, column, pie, radar, pyramid or box chart of categories | cetz-plot `chart` | `charts.md` |
| Candlestick, ratio bars, heatmap, gantt, waterfall | cetz rects and lines in a scaled box | `charts.md` |
| Coloured table, cards, side-by-side panels, a legend row | plain Typst `table`, `grid`, `box`, `rect` | `typst.md` |

If Markdown shows it well (a plain table, a list), use Markdown, not typst.

### A cetz start point

A timeline in a 10 × 2 unit box. It shows the canvas size, the stroke style, fills and muted text:

```typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 10, theme.height / 2), {
  import cetz.draw: *
  set-style(stroke: theme.fg)
  line((0, 0), (10, 0), mark: (end: ">"))
  for (x, name, date, c) in ((1, [v1.0], [Jan], theme.blue), (4, [v1.1], [Apr], theme.green), (8, [v2.0], [Oct], theme.orange)) {
    circle((x, 0), radius: 0.15, fill: c, stroke: none)
    content((x, 0.5), name)
    content((x, -0.5), text(fill: theme.muted, date))
  }
})
```

## check.sh

```
${CLAUDE_SKILL_DIR}/scripts/check.sh [--theme NAME] [--mode dark|light|both] [--width PT] [--height PT] FILE
```

- `FILE`: a `.typ` file is one block body without fences. A `.md` file is Markdown with typst blocks. `-` reads the text from stdin.
- It compiles with the real template, the vendored packages and your active theme (or `--theme NAME`). `--mode` is `both` by default. `--width` and `--height` set the space in pt.
- Output: a `using …` line, then one line per mode. `ok <mode> <png> …` gives the PNG paths. `error <mode>` is followed by the compiler diagnostics (`FILE:line:col: error: …`).
- Exit 0 only when all modes compile; 1 on a compile error; 2 on bad use or no Typst 0.15. Font warnings ("unknown font family") are noise.
- Width, height and row grid are your last values from the mod's design cache, else 900 × 320 pt. The terminal font is not used, so the text width can differ a little.
- Diagnostics give lines of FILE and 0-based columns, as Typst prints them. Typst stops at the first error of a block, so run the script again after each fix.
- A `.md` file compiles as one page. The mod can split a long answer into more pages.
- The PNGs are drawn on the theme's background colour, so you can read them with the Read tool (the mod's own PNGs are transparent).
- It also accepts `--opt=value`, `-h`, and a folder path for `--theme`.
- A compile with exit 0 can still be wrong. Always look at the PNGs.

## Top traps

- cetz-plot axes, ticks and legend are black by default. In the canvas, before the plot:
  `cetz.draw.set-style(axes: (stroke: theme.fg, tick: (stroke: theme.fg)), legend: (fill: theme.bg, stroke: theme.border))`.
- cetz: begin the canvas body with `set-style(stroke: theme.fg)`. Lay the drawing out in a W × H unit box: `cetz.canvas(length: calc.min(theme.width / W, theme.height / H), { … })`.
- fletcher: pass `node-stroke: theme.fg, edge-stroke: theme.fg` and `node-shape: rect` (small nodes become circles). Use `crossing-fill: theme.bg`. `stroke: none` makes a text-only node.
- fletcher makes no space for edge labels and does not route edges around nodes. Keep labels short, make each gap wider than its label, break a long label with `\`, and go around nodes with corner points, not `bend`.
- cetz-plot 0.1.4 has no candlestick. Draw it with cetz `rect` and `line` in a scaled coordinate box.
- A variable named `h` shadows the spacing function `h()`. Do not use it in destructuring or loops.
- In content, `$` starts math and `~` is a non-breaking space. Write `\$` and `\~`. Use `#(expr)` to put an expression into content.
- Text labels that cross a dashed reference line are hard to read. Put the labels in a fixed column.
- A drawing taller than `theme.height` is not made smaller. Make it wider and shorter instead.

## References

Read only the file that matches the drawing:

- [`references/typst.md`](references/typst.md): the Typst language for blocks, layout, `table` and `grid`, the theme keys, common compile errors and their fixes.
- [`references/fletcher.md`](references/fletcher.md): fletcher for flow charts, state machines, architecture diagrams and commutative diagrams.
- [`references/cetz.md`](references/cetz.md): cetz free drawing: canvas, primitives, anchors, timelines, trees, geometry.
- [`references/plot.md`](references/plot.md): cetz-plot `plot`: line, scatter, function, bar, error bar, fill and contour plots.
- [`references/charts.md`](references/charts.md): cetz-plot `chart` (bar, column, pie, radar, pyramid, box) and custom charts (candlestick, ratio bars, heatmap, gantt, waterfall).

The files are in `${CLAUDE_SKILL_DIR}/references/`.
