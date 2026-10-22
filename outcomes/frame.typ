// Outcome frame: Intelligent UI renders in terminal windows, with a headline.
// One window:  --input img=<abs png> --input mode=dark|light --input ask=.. [--input pad=<pt>]
// Hero (two):  --input layout=hero --input img-dark=.. --input img-light=.. --input ask=..
// Both:        --input title=..   (typst compile --root / frame.typ out.png)
#let inp = sys.inputs
#let hero = inp.at("layout", default: "one") == "hero"
#let page-dark = inp.at("mode", default: "dark") == "dark"
#let img-w = float(inp.at("img-w", default: if hero { "430" } else { "560" })) * 1pt
#let mono = ("MesloLGS NF", "Menlo")
#let sans = ("SF Pro Display", "Helvetica Neue", "Inter")

// The Claude Code mascot, drawn from its pixels (1 unit = 1 px of a 2x screenshot).
#let mascot(u, body, eye) = box(width: 75 * u, height: 48 * u, {
  let r(x, y, w, h, c) = place(dx: (x + 9) * u, dy: y * u, rect(width: w * u, height: h * u, fill: c))
  r(0, 0, 57, 36, body)
  r(-9, 20, 75, 8, body)
  r(9, 8, 4, 12, eye)
  r(43, 8, 4, 12, eye)
  for x in (0, 9, 43, 52) { r(x, 36, 4, 12, body) }
})

// A terminal window with Claude Code in it: the header, the prompt, the
// answer (the Intelligent UI picture beside the bullet), the input box and the
// mode line. Colours are from a screenshot of Claude Code 2.1.301.
#let window(img, dark, ask) = {
  let c = if dark { (
    bg: rgb("#283237"), fg: rgb("#ffffff"), dim: rgb("#a7a5a5"), hint: rgb("#9a9da1"),
    bar: rgb("#21211f"), title: rgb("#b6b6b4"), edge: rgb("#3c4448"), sep: rgb("#7a7b7c"),
    ask-bg: rgb("#343e43"), green: rgb("#52c96a"), mode: rgb("#ffd301"), eye: rgb("#050302"),
  ) } else { (
    bg: rgb("#ffffff"), fg: rgb("#1f1f1f"), dim: rgb("#6e6e6e"), hint: rgb("#8a8d91"),
    bar: rgb("#ececec"), title: rgb("#4d4d4d"), edge: rgb("#d4d4d4"), sep: rgb("#b5b5b5"),
    ask-bg: rgb("#f0f0f0"), green: rgb("#2f9e4b"), mode: rgb("#a07400"), eye: rgb("#050302"),
  ) }
  let light(col) = circle(radius: 4.2pt, fill: col)
  let rule = line(length: 100%, stroke: 0.5pt + c.sep)
  block(width: img-w + 40pt, radius: 10pt, clip: true, stroke: 0.6pt + c.edge, fill: c.bg)[
    #block(width: 100%, fill: c.bar, inset: (x: 10pt, y: 8pt), below: 0pt)[
      #grid(columns: (auto, 1fr, auto), align: horizon, column-gutter: 12pt,
        stack(dir: ltr, spacing: 6pt, light(rgb("#ff5f57")), light(rgb("#febc2e")), light(rgb("#28c840"))),
        text(font: sans, size: 9pt, weight: "semibold", fill: c.title)[Claude Code],
        text(font: sans, size: 8pt, fill: c.dim)[⌥⌘1])
    ]
    #block(inset: (x: 8pt, top: 12pt, bottom: 8pt), below: 0pt)[
      #set text(font: mono, size: 8.5pt, fill: c.fg)
      #set par(leading: 0.45em)
      #grid(columns: (auto, auto), column-gutter: 9pt, align: horizon,
        mascot(0.42pt, rgb("#d77757"), c.eye),
        [*Claude Code* #text(fill: c.dim)[v2.1.301] \
         #text(fill: c.dim)[Opus 5.5 with high effort · Claude Max] \
         #text(fill: c.dim)[\~/projects/cc-intelligent-ui ·] #text(fill: c.green)[/rc]])
      #v(14pt)
      #block(width: 100%, fill: c.ask-bg, inset: (x: 4pt, y: 4pt), below: 0pt)[❯ #ask]
      #v(12pt)
      #grid(columns: (12pt, auto),
        move(dx: 3pt, dy: float(inp.at("bullet", default: "9")) * 1pt, text(size: 8pt)[●]),
        image(img, width: img-w))
      #v(10pt)
      #text(fill: c.dim)[✻ Brewed for 6s]
      // `pad` (pt): more empty room, so two windows side by side have one height.
      #v(26pt + float(inp.at("pad", default: "0")) * 1pt)
      #align(right, text(fill: c.dim)[● high · /effort])
      #v(-4pt)
      #rule
      #v(-2pt)
      ❯ #box(fill: c.fg, width: 5.2pt, height: 9pt, baseline: 1.5pt)
      #v(-2pt)
      #rule
      #v(-2pt)
      #let tri = box(polygon(fill: c.mode, (0pt, 0pt), (4.2pt, 2.6pt), (0pt, 5.2pt)), baseline: -0.6pt)
      #text(fill: c.mode)[#tri#h(0.8pt)#tri auto mode on] #text(fill: c.dim)[(shift+tab to cycle)]
    ]
  ]
}

#set page(width: if hero { 2 * img-w + 80pt + 2 * 56pt + 24pt } else { img-w + 40pt + 2 * 56pt }, height: auto,
  margin: (x: 56pt, top: 52pt, bottom: 60pt),
  fill: gradient.linear(angle: 35deg,
    ..if page-dark { (rgb("#14161f"), rgb("#2a1f3d"), rgb("#3b2416")) } else { (rgb("#fdf6ee"), rgb("#efe8fb"), rgb("#e6f1fb")) }))
#set text(font: sans, fill: if page-dark { white } else { rgb("#1d1d1f") })

#align(center)[
  // The brand line is on the heroes only; on a single frame the title is the heading.
  #if hero [
    #text(size: 34pt, weight: "bold", tracking: 2pt, fill: rgb("#d97757"))[INTELLIGENT UI FOR CLAUDE CODE]
    #v(-2pt)
    #text(size: 24pt, weight: "semibold")[#inp.at("title", default: "")]
  ] else [
    #text(size: 27pt, weight: "bold")[#inp.at("title", default: "")]
  ]
]
#v(14pt)
#let ask = inp.at("ask", default: "")
#if hero {
  grid(columns: 2, column-gutter: 24pt, align: top,
    window(inp.img-dark, true, ask), window(inp.img-light, false, ask))
} else {
  window(inp.img, page-dark, ask)
}
