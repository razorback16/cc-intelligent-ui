// Intelligent UI themes: loads the active theme and merges it over the
// built-in `vscode` theme, so a user theme only lists what it changes.
//
//   --input theme-dir=<absolute folder that holds theme.json>  (optional)
//   --input theme=dark|light
//
// A value of the wrong type (or a colour that is not #rgb, #rgba, #rrggbb
// or #rrggbbaa) is ignored and the vscode value is used, so a bad user
// theme draws like vscode instead of failing the compile. theme.json itself
// must be valid JSON (the hooks module checks that before it passes it).

#let base-dir = "themes/vscode"
#let base = json(base-dir + "/theme.json")
#let theme-dir = sys.inputs.at("theme-dir", default: "").trim().trim("/", at: end)
#let user = if theme-dir == "" { (:) } else {
  let u = json(theme-dir + "/theme.json")
  if type(u) == dictionary { u } else { (:) }
}

#let is-colour(v) = type(v) == str and v.match(regex("^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")) != none
#let is-num(v) = type(v) in (int, float)

// Is `u` an acceptable replacement for the default `b`?
#let valid(u, b) = {
  if u == none { false }
  else if is-num(b) { is-num(u) }
  else if type(b) == bool { type(u) == bool }
  else if type(b) == str { if b.starts-with("#") { is-colour(u) } else { type(u) == str } }
  else if type(b) == array {
    type(u) == array and u.len() > 0 and (b.len() == 0 or u.all(x => if is-num(b.first()) { is-num(x) } else { type(x) == type(b.first()) }))
  } else { type(u) == type(b) }
}

#let merge(b, u) = {
  let out = b
  for (k, v) in u {
    if k in b {
      let bv = b.at(k)
      if type(bv) == dictionary and type(v) == dictionary { out.insert(k, merge(bv, v)) }
      else if valid(v, bv) or (k == "size" and v == "terminal") { out.insert(k, v) }
    } else if v != none {
      out.insert(k, v)
    }
  }
  out
}

#let T = merge(base, user)
#let dark = sys.inputs.at("theme", default: "dark") != "light"
#let mode = if dark { "dark" } else { "light" }

// Colours of the active mode, as Typst colours.
#let C = {
  let out = (:)
  for (k, v) in T.at(mode) { if is-colour(v) { out.insert(k, rgb(v)) } }
  out
}

// i-th entry of a per-level array; the last entry repeats.
#let at-level(arr, i) = arr.at(calc.min(i, arr.len() - 1))

// Syntax colours: the user theme's own tmTheme when theme.json names one,
// else the vscode one for this mode. A function, so measure.typ (which
// imports this file through fonts.typ) never reads the file.
#let syntax() = {
  let own = user.at("syntax", default: (:))
  let name = if type(own) == dictionary { own.at(mode, default: none) } else { none }
  if type(name) == str and name.trim() != "" and theme-dir != "" {
    let p = if name.starts-with("/") { name } else { theme-dir + "/" + name }
    read(p, encoding: none)
  } else {
    read(base-dir + "/" + base.syntax.at(mode), encoding: none)
  }
}

#let fonts = T.fonts
