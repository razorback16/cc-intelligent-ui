// Font lists shared by md.typ and measure.typ. They come from the active
// theme (theme.typ: `fonts.body` and `fonts.code`, merged over vscode).
#import "theme.typ": fonts
// The terminal's own font first for body text, so the hooks module sizes it
// exactly as the terminal's text.
#let term-font = sys.inputs.at("term-font", default: "")
#let sans = if term-font != "" { (term-font,) + fonts.body } else { fonts.body }
#let mono-base = fonts.code
// The row grid (md.typ, grid=1): the ink of a line of the current text
// (needs context), "bdfhkl" `up` from the baseline and "gjpqy" `down`, and
// the height its line box `need`s (the ink and 0.1em; md.typ rounds it up
// to whole rows).
#let line-ink() = {
  let up = measure(text(top-edge: "bounds", bottom-edge: "baseline", "bdfhkl")).height
  let down = measure(text(top-edge: "baseline", bottom-edge: "bounds", "gjpqy")).height
  (up: up, down: down, need: up + down + 0.1em.to-absolute())
}
