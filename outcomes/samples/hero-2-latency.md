## Where your 450 ms go

`GET /api/orders` takes **450 ms**. The **DB query** is 69% of it, so that is the fix that counts.

```typst
#let spans = (("DNS", 0, 12), ("TCP + TLS", 12, 50), ("Auth", 50, 74),
  ("DB query", 74, 384), ("Render JSON", 384, 430), ("Send", 430, 450))
#let total = 450
#let label-w = 0.2 * theme.width
#let bar-w = theme.width - label-w - 0.12 * theme.width
#let row-h = calc.min(0.075 * theme.width, theme.height / (spans.len() + 1.6))
#let x(ms) = ms / total * bar-w
#let lane(body) = box(width: bar-w, height: row-h, body)
#align(center, grid(
  columns: (label-w, bar-w + 0.12 * theme.width), rows: row-h, align: (right + horizon, left + horizon),
  column-gutter: 0.25 * row-h,
  ..for (name, a, b) in spans {
    let hot = name == "DB query"
    let col = if hot { theme.orange } else { theme.blue }
    (text(weight: if hot { "bold" } else { "regular" }, fill: if hot { col } else { theme.fg }, name),
     lane({
       place(dx: 0pt, line(length: row-h, angle: 90deg, stroke: 0.6pt + theme.border))
       place(horizon, dx: x(a), rect(width: calc.max(x(b - a), 0.12 * row-h), height: 0.62 * row-h, radius: 0.16 * row-h, fill: col))
       place(horizon, dx: x(b) + 0.15 * row-h, text(size: 0.9em, fill: theme.muted, str(b - a) + " ms"))
     }))
  },
  [], lane({
    place(line(length: bar-w, stroke: 0.6pt + theme.border))
    for t in range(0, total + 1, step: 100) {
      place(dx: x(t), line(length: 0.18 * row-h, angle: 90deg, stroke: 0.6pt + theme.border))
      place(dx: x(t) - 0.6 * row-h, dy: 0.25 * row-h, box(width: 1.2 * row-h, align(center,
        text(size: 0.85em, fill: theme.muted, str(t) + if t == 400 { " ms" } else { "" }))))
    }
  }),
))
```

Make the DB query 4× faster and the request is only about 2× faster. That is Amdahl's law, with $p = 0.69$ of the time sped up $s = 4$ times:

$$S = \frac{1}{(1 - p) + \frac{p}{s}} = \frac{1}{0.31 + \frac{0.69}{4}} \approx 2.1$$

| Fix | New time | Faster |
|:--|--:|--:|
| Cache the orders (no DB query) | 140 ms | **3.2×** |
| An index makes the query 4× faster | 218 ms | 2.1× |
| HTTP/3 0-RTT (no TLS round trip) | 412 ms | 1.1× |
