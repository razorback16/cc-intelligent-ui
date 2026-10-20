# Typst essentials for live blocks

Typst 0.15 language facts you need to write a ```` ```typst ```` block that compiles the first time and looks right.
Every ```` ```typst ```` example in this file was compiled with the real template, in dark and light.

Contents
1. How a block runs
2. The `theme` dictionary
3. Markup mode and code mode
4. Values and types
5. `let`, functions, closures
6. Arrays, dictionaries, loops, destructuring
7. Numbers: `calc` and formatting
8. Colours
9. Layout elements
10. `context`, `measure`, `layout`
11. Math and `raw`
12. Recipes: comparison table, heatmap table, stat tiles, legend row, bars, diagram + notes, math
13. Errors and their fixes
14. Silent traps (no error, wrong picture)

## 1. How a block runs

- The template evaluates the block source as **markup** (`eval(src, mode: "markup", scope: (theme: …))`).
  In scope: the Typst standard library and `theme`. Nothing else: no other variables, and no packages until you `#import` them.
- These set rules are already active: `text(font: theme.sans, size: 11pt, fill: theme.fg)`. You do not set them again.
- The block is placed in a container. `#page`, `#set page(...)` and `#pagebreak()` are errors.
- Lay out for `theme.width` × `theme.height` (these are the design size, not always the size on screen).
  The template scales the whole block by one factor to fit the terminal. A block that is too wide is made smaller to fit.
  A block taller than `theme.height` is **not** made smaller: the page grows. So make it wide and short.
- `theme.width` changes with the terminal (for example 896pt or 1404pt). Size things with `fr`, `%` or `theme.width`, not with fixed widths that you guess.
- To check a block, run `scripts/check.sh` on it (it gives `file:line:col` errors and PNGs). A raw
  `typst compile` of the template reports every error at `md.typ:891` (the `eval` call), without the line in your block.

## 2. The `theme` dictionary

| Key | Type | Use |
|---|---|---|
| `theme.fg` | color | text, strokes, axes |
| `theme.muted` | color | secondary text, guide lines |
| `theme.link` | color | links |
| `theme.border` | color | thin rules, table lines, frames |
| `theme.accent` | color | one highlight |
| `theme.bg` | color | page background: `crossing-fill`, label backgrounds, "gaps" |
| `theme.code-bg` | color (semi-transparent) | tile and track backgrounds |
| `theme.red` `.green` `.blue` `.yellow` `.orange` `.purple` | color | status and category colours |
| `theme.palette` | array of 6 colors | data series in order: blue, orange, green, red, purple, yellow |
| `theme.width` | length | content width of the drawing |
| `theme.height` | length | height the drawing should fit in |
| `theme.page-width` | length | page width (content width + margins) |
| `theme.text-size` | length | body text size (11pt) |
| `theme.sans`, `theme.mono` | array of strings | font lists for `text(font: …)` |
| `theme.dark` | bool | true for the dark scheme |

`theme.colour` (a key that is not there) is the error `dictionary does not contain key "colour"`.
`theme.palette.at(6)` is out of bounds: use `theme.palette.at(calc.rem(i, 6))` for more than 6 series.

## 3. Markup mode and code mode

- The block starts in markup: text is text. `#` switches to code for **one expression**: `#x`, `#f(a)`, `#(x + 1)`, `#for … {}`.
- `#x+1` shows the value of `x` and then the text `+1`. To compute, write `#(x + 1)`.
- `#let …` runs to the end of its line. Put one `#let` on each line. A second `#` on the same line after a `#let`
  is the error ``the character `#` is not valid in code``.
- Inside `{ … }` (code block) you are in code: no `#`. Inside `[ … ]` (content block) you are in markup again: use `#` to get back to code.
- A trailing content block is the last argument: `#text(fill: theme.red)[alert]` = `#text(fill: theme.red, [alert])`.
- Comments: `// line` and `/* block */`, in markup and in code.
- Markup characters that do something: `*bold*`, `_emph_`, `` `raw` ``, `$math$`, `<label>`, `@ref`, `~` (no-break space),
  `\` (line break), `//` (comment), `-`/`+`/`=` at the start of a line (list, numbered list, heading).
  Escape with a backslash: `\$`, `\~`, `\#`, `\@`, `\<`, `\*`, `\_`, `\/\/`.

## 4. Values and types

- `content` is `[…]` (markup). `str` is `"…"`. Many parameters want one and not the other:
  `raw("x")` needs a string (`raw([x])` is `expected string, found content`); `text(fill: c, "abc")` and `text(fill: c)[abc]` both work.
- `"a" + "b"` is a string. `"a" + [b]` is content. `"n = " + 3` is an error: write `"n = " + str(3)` or `[n = #n]`.
- Lengths: `pt`, `em`, `cm`. Ratio: `50%`. Relative: `50% + 1em`. Fraction: `1fr` (only in grid/table columns, `h`, `v`, `stack` spacing).
  `1pt + 2` is an error. `theme.width / 2pt` is a float (448.0). `theme.width * 0.5` is a length.
- Colours: `theme.blue`, `rgb("#4a9")`, `luma(50%)`. A string is not a colour: `fill: "blue"` is an error.
- Strokes: `theme.fg` (colour only), `1pt + theme.fg`, or `(paint: theme.red, thickness: 1pt, dash: "dashed")`.
  Dash values: `"dashed"`, `"dotted"`, `"densely-dashed"`, `"loosely-dotted"`, …
- Alignment: `left`, `center`, `right`, `top`, `horizon`, `bottom`, combined with `+`: `top + right`, `center + horizon`.
- `none` draws nothing. `auto` means "the default".

## 5. `let`, functions, closures

```typc
let n = 3                          // a variable
let tile(label, value, good: true) = …   // a function with a named parameter (default true)
let double = x => x * 2            // a closure
let f(..args) = args.pos()         // variadic: args.pos(), args.named()
tile.with(good: false)             // pre-fill arguments
```

- A function body is one expression: `= text(…)`, or `= { … }` (code, the joined result of each line), or `= [ … ]` (markup).
- A function can **read** outer variables but not change them: `total += 1` inside a function is
  `variables from outside the function are read-only and cannot be modified`. Return a new value instead,
  or change the variable in a top-level `for` loop (that is allowed).
- Do not name a variable after a built-in that you also call: `h`, `v`, `box`, `text`, `line`, `rect`, `table`, `grid`.
  After `#let (w, h) = (3, 2)`, `#h(1em)` is `expected function, found integer`. Use `wd`, `ht`.
- Unknown named argument: `unexpected argument: c`.

## 6. Arrays, dictionaries, loops, destructuring

```typc
let a = (1, 2, 3)          // array; a single item needs a comma: (1,)
a.len()  a.at(0)  a.at(9, default: 0)  a.first()  a.last()  a.sum()  a.rev()  a.sorted()
a.map(x => x * 2)  a.filter(x => x > 1)  a.enumerate()  a.zip(b)  a.join(", ")  a.flatten()
range(5)  range(1, 6)  (1fr,) * 4      // (1fr, 1fr, 1fr, 1fr)
let d = (name: "api", ms: 182)         // dictionary; empty one is (:)
d.name  d.at("ms")  d.at("x", default: 0)  d.keys()  d.values()  d.pairs()  d.insert("k", 1)
for x in a { … }   for (i, x) in a.enumerate() { … }   for (k, v) in d { … }
let (x, y) = (1, 2)   let (first, ..rest) = a   let (name, ms) = (d.name, d.ms)
```

- `..` spreads: `grid(..cells)`, `calc.max(..a)`. `calc.max(a)` (no `..`) returns the array unchanged (no error).
- `#for` in markup joins the bodies: `#for (i, x) in a.enumerate() [#i: #x ]`.
- To build cells for `grid`/`table`, map each row to an array and `.flatten()`, then spread with `..`.
- `let (a, b) = (1, 2, 3)` is `too many elements to destructure`.
- `if` needs a bool: `if 1 […]` is `expected boolean, found integer`. `if x != none`, `if a.len() > 0`.

## 7. Numbers: `calc` and formatting

- `calc.round(x, digits: 1)`, `calc.floor`, `calc.ceil`, `calc.abs`, `calc.min(a, b)`, `calc.max(..arr)`,
  `calc.rem(i, n)`, `calc.quo(i, n)` (integer division), `calc.even(i)`, `calc.pow`, `calc.sqrt`, `calc.log`, `calc.sin(30deg)`, `calc.pi`.
- `str(0.1 + 0.2)` is `0.30000000000000004`: always round before you show a float: `str(calc.round(x, digits: 2))`.
- `int(7.9)` is 7. `float("3.5")` is 3.5. `str(1234567)` has no separators.
- For format strings, the vendored oxifmt works offline: `#import "@preview/oxifmt:1.0.0": strfmt`, then
  `strfmt("{:.2}", 2/3)`, `strfmt("{:.1}%", x)`, `strfmt("{}", 1234567, fmt-thousands-separator: ",")`.

## 8. Colours

- Fills that work in both schemes: `c.transparentize(80%)` (light tint) to `40%` (strong). It takes a **ratio**: `transparentize(80)` is `expected ratio, found integer`.
- An opaque tint: `color.mix(theme.blue, theme.bg)` (50/50) or weighted `color.mix((theme.green, 70), (theme.red, 30))`.
- `c.lighten(40%)`, `c.darken(40%)`: the same change in both schemes, so the contrast changes. Prefer `transparentize` and `color.mix` with `theme.bg`.
- Gradients: `gradient.linear(theme.green, theme.yellow, theme.red)`, with `angle: 90deg` for vertical. `g.sample(30%)` gives one colour (a colour scale for heatmaps).
- Text on a strong fill: `theme.fg` is fine up to about `transparentize(40%)`. For solid fills use `theme.bg` as the text colour.

```typst
#let g = gradient.linear(theme.green, theme.yellow, theme.red)
#stack(dir: ltr, spacing: 4pt,
  ..range(11).map(i => box(width: 2em, height: 1.2em, radius: 2pt, fill: g.sample(i * 10%))),
  h(1em),
  box(width: 3em, height: 1.2em, fill: theme.blue.transparentize(80%)),
  box(width: 3em, height: 1.2em, fill: color.mix(theme.blue, theme.bg)),
  box(width: 3em, height: 1.2em, fill: gradient.linear(theme.blue, theme.purple)),
)
```

## 9. Layout elements

- `text(fill:, size:, weight: "bold" | 700, style: "italic", font: theme.mono)[…]`. `size` needs a length: `size: 2` is `expected length, found integer`; write `2em` or `22pt`.
- `box(width:, height:, fill:, stroke:, radius:, inset:, baseline:)` is inline (stays in the line). `block(…)` is a paragraph-level box (starts a new line). Same parameters, plus `breakable`.
- `rect`, `circle`, `ellipse`, `square`, `line(start:, end:, length:, angle:, stroke:)`, `polygon(…)` are shapes; default stroke is black: pass `stroke:`.
- `stack(dir: ltr | ttb, spacing: 1em, ..items)` puts items in a row or column.
- `grid(columns: (1fr, 2fr, auto), rows: auto, gutter: 8pt, column-gutter:, row-gutter:, align:, ..cells)`. `columns: 3` means 3 `auto` columns.
- `table(…)` is a grid with `stroke` and `inset`; it takes `fill: (x, y) => …`, `align: (x, y) => …` or per-column arrays,
  `stroke: (x, y) => (bottom: 0.5pt + theme.border)`, `table.header(…)`, `table.cell(colspan: 2, fill: …)[…]`, `table.hline(stroke: …)`, `table.vline(…)`.
- `align(center + horizon)[…]`, `pad(x: 1em, top: 4pt)[…]` (block level), `place(top + right, dx: -4pt, dy: 4pt)[…]` (out of the flow, relative to the parent container).
- `h(1em)`, `h(1fr)` (push to the right), `v(0.5em)`. `#h(1fr)` only works inside a line, not next to a block element.
- `scale(80%, reflow: true)[…]`, `rotate(-90deg, reflow: true)[…]`, `move(dx:, dy:)[…]`, `hide[…]`.

## 10. `context`, `measure`, `layout`

- `measure(c)`, `text.size`, `text.font`, `here()` need context. Without it: `can only be used when context is known`.
  Wrap the part that uses them: `#context { let w = measure(x).width; … }`.
- `measure(c).width` of text is its unwrapped width. `measure(c, width: theme.width)` wraps first.
- **Do not size things from `layout(size => …)` in a live block.** The template measures the block with no width limit, so `size.width` is infinite in that pass,
  and `box(width: f * size.width)` fails with `cannot expand into infinite width`. Use `theme.width`, `1fr` columns or `%` widths instead.
- `100%` inside a `box`/`block` is the parent width; inside a `grid` cell it is the cell width.

## 11. Math and `raw`

- Inline `$x^2$`, display `$ x^2 $` (spaces inside the dollars make it a centred block). Math takes the text colour: `text(fill: theme.accent)[$f(x)$]`.
- In math, multi-letter words are variables unless quoted: `"softmax"(z)`. Functions: `frac(a, b)` or `a / b`, `sqrt(x)`, `sum_(i=1)^n`, `hat(y)`, `cal(L)`, `bb(R)`, `mat(1, 2; 3, 4)`, `cases(…)`.
- In math, `#` brings code back: `$#theme.width$`, `$x = #str(n)$`.
- `raw("code", lang: "rust")` gets the template's code look (code font, syntax colours, a background box for inline raw).
  For plain mono labels inside drawings and nodes use `text(font: theme.mono)[…]` instead.

## 12. Recipes

A coloured comparison table (header tint, zebra rows, status colours, `fr` columns):

```typst
#let yes = text(fill: theme.green)[✓]
#let no = text(fill: theme.red)[✗]
#table(
  columns: (1.4fr, 1fr, 1fr, 1fr),
  align: (left, center, center, center),
  stroke: (x, y) => (bottom: 0.5pt + theme.border),
  inset: (x: 8pt, y: 6pt),
  fill: (x, y) => if y == 0 { theme.blue.transparentize(80%) } else if calc.even(y) { theme.code-bg },
  table.header([*Feature*], [*SQLite*], [*Postgres*], [*Redis*]),
  [Transactions], yes, yes, text(fill: theme.yellow)[partial],
  [Runs in-process], yes, no, no,
  [Full-text search], yes, yes, no,
  [Latency], [\~µs], [\~ms], [\~µs],
)
```

A heatmap table (cell fill from the value):

```typst
#let rows = ("api", "db", "cache", "auth")
#let data = (
  (12, 30, 55, 80, 95, 70, 40, 20),
  (5, 10, 25, 60, 88, 92, 50, 15),
  (2, 4, 8, 15, 20, 18, 9, 3),
  (20, 22, 30, 35, 40, 38, 30, 25),
)
#let cell(v) = table.cell(fill: color.mix((theme.green, 100 - v), (theme.red, v)).transparentize(40%))[#v]
#table(
  columns: (5em,) + (1fr,) * 8,
  align: center + horizon, stroke: 0.5pt + theme.bg, inset: 5pt,
  [], ..range(8).map(i => text(fill: theme.muted)[#(i + 9):00]),
  ..rows.zip(data).map(((name, vals)) => ([*#name*], ..vals.map(cell))).flatten(),
)
```

A stat-tile row (KPI cards in a grid):

```typst
#let tile(label, value, delta, good) = block(
  width: 100%, inset: 10pt, radius: 6pt, fill: theme.code-bg, stroke: 0.5pt + theme.border,
  {
    text(size: 0.85em, fill: theme.muted, label)
    v(2pt)
    text(size: 1.8em, weight: "bold", value)
    h(6pt)
    text(fill: if good { theme.green } else { theme.red }, delta)
  },
)
#grid(
  columns: (1fr,) * 4, gutter: 10pt,
  tile([Requests / s], [12.4k], [▲ 8%], true),
  tile([p95 latency], [182 ms], [▲ 12 ms], false),
  tile([Error rate], [0.21%], [▼ 0.05], true),
  tile([Cost / day], [\$1,240], [▲ \$90], false),
)
```

A legend row:

```typst
#let swatch(c) = box(width: 0.9em, height: 0.9em, radius: 2pt, fill: c, baseline: 0.1em)
#let names = ([Ingest], [Transform], [Store], [Serve], [Archive], [Other])
#stack(dir: ltr, spacing: 1.5em, ..names.zip(theme.palette).map(((n, c)) => [#swatch(c) #n]))
```

Horizontal bars with a measured label column (no `layout`, see section 10):

```typst
#let data = (("parse", 0.42), ("type-check", 0.31), ("codegen", 0.18), ("link", 0.09))
#let mono(s) = text(font: theme.mono, size: 0.9em, s)
#context {
  let label-w = calc.max(..data.map(((n, _)) => measure(mono(n)).width))
  grid(
    columns: (label-w, 1fr, 4em), column-gutter: 0.6em, row-gutter: 6pt, align: (right, left, right),
    ..data.enumerate().map(((i, (name, f))) => (
      mono(name),
      box(width: 100%, height: 0.9em, radius: 2pt, fill: theme.code-bg,
        box(width: f * 100%, height: 100%, radius: 2pt, fill: theme.palette.at(i))),
      text(fill: theme.muted, str(calc.round(f * 100, digits: 1)) + "%"),
    )).flatten(),
  )
}
```

Two columns: a diagram and its notes:

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#grid(
  columns: (3fr, 2fr), column-gutter: 2em, align: horizon,
  diagram(
    node-stroke: theme.fg, edge-stroke: theme.fg, node-shape: rect, spacing: (2.5em, 1.5em),
    node((0, 0), [Client], fill: theme.blue.transparentize(80%), name: <c>),
    node((1, 0), [Gateway], fill: theme.purple.transparentize(80%), name: <g>),
    node((2, 0), [Service], fill: theme.green.transparentize(80%), name: <s>),
    edge(<c>, <g>, "->"),
    edge(<g>, <s>, "->"),
  ),
  block(inset: (left: 1em), stroke: (left: 2pt + theme.accent))[
    *Notes*
    - The gateway checks the token.
    - The service never sees raw keys.
    - #text(fill: theme.muted)[Retries: 3, backoff 2×.]
  ],
)
```

Math beside text:

```typst
#grid(columns: (1fr, 1fr), align: horizon + center,
  $ "softmax"(z)_i = e^(z_i) / (sum_(j=1)^K e^(z_j)) $,
  [The loss is #text(fill: theme.accent)[$cal(L) = -sum_i y_i log hat(y)_i$], for $K$ classes.],
)
```

## 13. Errors and their fixes

| Error message (Typst 0.15) | Cause | Fix |
|---|---|---|
| `unknown variable: node` | package not imported in this block | add the `#import` line at the top of each block |
| `unknown variable: foo` | typo, or a `#let` in another block | each block is alone: define it here |
| `expected function, found integer` | a variable `h`/`v`/`box`… shadows the function; or `f(1)(2)` | rename the variable (`ht`, `wd`) |
| `cannot add string and integer` | `"n = " + n` | `"n = " + str(n)` or `[n = #n]` |
| `cannot add content and integer` | `[12] + 1`, a function given `[…]` for a number | keep numbers as numbers; `f(3)`, not `f[3]` |
| `cannot add length and integer` / `and string` | `1pt + 2`, `1pt + "red"` | `1pt + 2pt`, `1pt + theme.red` |
| `expected string, found content` | `raw([x])`, `str` wanted | `raw("x")` |
| `expected color, gradient, tiling, or none, found string` | `fill: "blue"` | `fill: theme.blue` |
| `expected ratio, found integer` | `transparentize(80)` | `transparentize(80%)` |
| `expected length, found integer` | `text(size: 2)` | `size: 2em` |
| `expected boolean, found integer` | `if 1 …` | a real comparison |
| `type integer has no method len` / `element text has no method len` | method on the wrong type (content is not a string) | keep data as strings/arrays; turn into content last |
| `dictionary does not contain key "x"` | wrong `theme.` key or dict key | see section 2; `d.at("x", default: …)` |
| `array index out of bounds (index: 6, len: 6)` | `theme.palette.at(6)` | `theme.palette.at(calc.rem(i, 6))` |
| `too many elements to destructure` | `let (a, b) = (1, 2, 3)` | match the count, or `(a, b, ..rest)` |
| `unexpected argument: c` | wrong named argument | read the parameter list |
| `unexpected argument` (cetz) | `line`/`rect` without `import cetz.draw: *` | import the draw functions inside the canvas body |
| `variables from outside the function are read-only and cannot be modified` | `x += 1` in a function | return values; mutate only in top-level loops |
| `can only be used when context is known` | `measure`, `text.size` outside `context` | `#context { … }` |
| `cannot expand into infinite width` | width from `layout(size => …)` | use `theme.width`, `fr`, `%` |
| ``the character `#` is not valid in code`` | a second `#` on a `#let` line, or `#` inside `{ }` | one statement per line; no `#` in code |
| `unclosed delimiter` | missing `)` `]` `}`, or an odd `*` / `_` / `$` in text (`2 * 3`) | close it; escape `\*`, `\_`, `\$` |
| `label <x.com> does not exist in the document` | `me@x.com` (`@` is a reference) | `me\@x.com` |
| `page configuration is not allowed inside of containers` | `#set page(…)` | remove it; size with `theme.width`/`theme.height` |
| `pagebreaks are not allowed inside of containers` | `#pagebreak()` | remove it; use one block per drawing |
| `package found, but version 0.5.9 does not exist (latest is 0.5.8)` | wrong version | use the versions in the prompt |

## 14. Silent traps (no error, wrong picture)

- `$5 and $10` becomes math (`5 ∧ 10`). Write `\$5 and \$10`.
- `~` becomes a no-break space; `a <b> c` drops `<b>` (it is a label); `x // y` hides the rest of the line. Escape: `\~`, `\<b>`, `\/\/`.
- A line that starts with `-`, `+`, `=` or `1.` becomes a list item or heading.
- `#x+1` shows `5+1`. Use `#(x + 1)`.
- `calc.max(arr)` returns `arr`. Use `calc.max(..arr)`.
- `str(float)` shows 17 digits. Round first.
- Any shape or line without `stroke:` is black, invisible on the dark theme. `table` and `grid` strokes too: pass `theme.border`.
- `pad`, `block`, `align`, `table`, `grid` are block level: text after them starts a new line. Use `box` or `stack(dir: ltr)` to keep a row.
- `raw` inside a drawing gets the inline-code box and syntax colour. Use `text(font: theme.mono)`.
- A font name that is not installed is only a warning; the text falls back to another font.
