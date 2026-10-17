## Function plot (cetz-plot)

A damped oscillator with its exponential envelope:

```typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#set text(fill: theme.fg, size: 9pt)
#align(center, cetz.canvas(length: theme.width / 15, {
  import cetz.draw: *
  set-style(
    axes: (stroke: theme.fg, tick: (stroke: theme.fg)),
    legend: (fill: theme.bg, stroke: theme.border),
  )
  plot.plot(
    size: (12, 4.5), x-label: $t$, y-label: $y(t)$,
    x-tick-step: 2, y-tick-step: 0.5, legend: "inner-north-east",
    {
      plot.add(domain: (0, 12), samples: 100, t => calc.exp(-t / 4),
        style: (stroke: (paint: theme.muted, dash: "dashed")), label: $plus.minus e^(-t\/4)$)
      plot.add(domain: (0, 12), samples: 100, t => -calc.exp(-t / 4),
        style: (stroke: (paint: theme.muted, dash: "dashed")))
      plot.add(domain: (0, 12), samples: 400, t => calc.exp(-t / 4) * calc.cos(3 * t),
        style: (stroke: (paint: theme.accent, thickness: 1.5pt)), label: $e^(-t\/4) cos 3t$)
    })
}))
```
