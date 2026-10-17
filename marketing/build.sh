#!/bin/sh
# Renders the sample answers with md-preview's own template, then frames them.
# Usage: marketing/build.sh   (needs typst 0.15)
#
# The template gets the inputs the mod gives it (hooks/lib/typst.ts runTypst,
# draw.tsx sizing/fontFit/alignFirstLine, answer.ts roomOf) for a terminal of
# COLS picture columns and ROWS rows, with CELL_W x CELL_H px cells (2x
# Retina), MesloLGS NF as the terminal font and `/md-preview height` on half.
# Only the PNG resolution (PPI) is higher than the mod's, for crisp images.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
out="$here/out"; work="$here/.work"
mkdir -p "$out/raw" "$work/pkg-cache"
export TYPST_PACKAGE_CACHE_PATH="$work/pkg-cache"
cols=${COLS:-118}; rows=${ROWS:-50}; cell_w=${CELL_W:-16}; cell_h=${CELL_H:-32}
ppi=${PPI:-288}; font=${TERM_FONT:-MesloLGS NF}; img_w=${IMG_W:-600}
theme_dir="$root/render/themes/vscode-modern"

# The font fit: the pt of one column and the code size (draw.tsx fontFit).
metrics=$(typst eval 'query(<m>).first().value' --in "$root/render/measure.typ" --root / \
  --input "term-font=$font" --input "theme-dir=$theme_dir" 2>/dev/null)

# Sizes for one sample (python3): sizes <md> <columns> prints
# `width row code height top bullet`.
#   width, row: draw.tsx sizing; code: fontFit; height: the room height
#   (images.ts pictureRowsFor, half: min(24, rows/2), 6 to rows-16, rows of
#   `row` pt); top, bullet: alignFirstLine for the first line, and the
#   frame's bullet offset (pt) at that row's centre with the picture shown
#   IMG_W pt wide.
sizes() {
  python3 - "$1" "$metrics" "$2" "$rows" "$cell_w" "$cell_h" "$img_w" <<'EOF'
import json, math, re, sys
md, m, cols, rows, cw, ch, img_w = open(sys.argv[1]).read(), json.loads(sys.argv[2]), *map(float, sys.argv[3:])
t, b = m["term"] or m["menlo"], m["body"]
ratio = math.sqrt((t["xh"] / b["xh"]) * (t["avg"] / b["avg"]))
column = round(11 * t["adv"] / ratio, 4)
code = round(1 / ratio, 4)
width = round(cols * column, 2)
ppi = round(cols * cw) / (width / 72)
row = ch * 72 / ppi
pic_rows = min(24, math.floor(rows / 2))
pic_rows = min(255, max(6, min(pic_rows, rows - 16)))
height = round(pic_rows * row, 2)
first = {"para": (7.45, 2.55), "h1": (20.36, 5.82), "h2": (13.09, 3.64), "h3": (9.09, 2.55), "h4": (7.27, 2.18),
         "quote": (13.45, 8.36), "code": (17.09, 12.36), "table": (11.27, 6.18)}
line = next((l for l in md.split("\n") if l.strip()), "")
h = re.match(r"^ {0,3}(#{1,6})\s", line)
kind = (["h1", "h2", "h3"][len(h.group(1)) - 1] if len(h.group(1)) <= 3 else "h4") if h else \
  "quote" if re.match(r"^ {0,3}>", line) else "code" if re.match(r"^ {0,3}(```|~~~)", line) else \
  "table" if re.match(r"^ {0,3}\|", line) else "para"
centre, ink = first[kind]
bullet_row = max(0, math.ceil((centre - ink + 0.5) / row - 0.5 - 1e-9))
top = round((bullet_row + 0.5) * row - centre, 2)
# The frame's ● (8 pt) sits 4.2 pt above its move offset's centre line.
bullet = round((bullet_row + 0.5) * row * img_w / width - 4.2, 2)
print(width, round(row, 4), code, height, top, bullet)
EOF
}

# Renders one sample: render <md> <name> <columns>.
render() {
  python3 -c 'import json,sys; print(json.dumps({"base": sys.argv[2], "segments": [open(sys.argv[1]).read()]}))' "$1" "$here/samples" > "$work/$2.json"
  name=$2
  set -- $(sizes "$1" "$3")
  echo "$5 $6" > "$work/$name.top"
  for mode in dark light; do
    rm -f "$out/raw/$name-$mode-"*.png
    typst compile --root / --package-path "$root/render/packages" --format png --diagnostic-format short --ppi "$ppi" \
      --input theme=$mode --input width=$1 --input doc="$work/$name.json" \
      --input theme-dir="$theme_dir" --input term-font="$font" \
      --input top=$5 --input row=$2 --input code=$3 \
      --input height=$4 --input design-w=$1 --input design-h=$4 \
      "$root/render/md.typ" "$out/raw/$name-$mode-{0p}.png"
  done
}
for md in "$here"/samples/*.md; do render "$md" "$(basename "$md" .md)" "$cols"; done
# The hero's windows are narrower: the same answer in a terminal of HERO_COLS.
hero=3-mandelbrot; hero_cols=${HERO_COLS:-96}; hero_w=${HERO_W:-520}
render "$here/samples/$hero.md" hero "$hero_cols"
ls "$out/raw"

# The bullet offset of a sample (pt), from sizes().
bullet() { cut -d' ' -f2 "$work/$1.top"; }

# Frames: headline, subline and the prompt for each sample.
frame() { # name title sub ask
  for mode in dark light; do
    typst compile --root / --ppi 216 --input img="$out/raw/$1-$mode-1.png" --input mode=$mode --input bullet="$(bullet "$1")" \
      --input img-w="$img_w" --input title="$2" --input sub="$3" --input ask="$4" "$here/frame.typ" "$out/$1-$mode.png" 2>/dev/null
  done
}
frame 1-overview "Real Markdown, right in the terminal" \
  "Tables, task lists, quotes and math, drawn like VS Code's preview." \
  "show me what Markdown you can draw"
frame 2-math "LaTeX math that reads like a paper" \
  "Inline and display math, matrices and cases, set by Typst." \
  "write out Maxwell's equations"
frame 3-mandelbrot "A fractal, calculated as it draws" \
  "Claude writes the code; Typst runs it and paints 4,000 cells." \
  "draw the Mandelbrot set"
frame 4-fractal "Recursion and colour, live" \
  "A 2,047-branch tree and a 720-segment curve, drawn with CeTZ." \
  "draw a fractal tree next to a Lissajous curve"
frame 5-plot "Plots with axes and a legend" \
  "cetz-plot draws functions in your theme's colours." \
  "plot a damped oscillator"
frame 6-diagrams "Flow charts and commutative diagrams" \
  "fletcher draws boxes, arrows and maths from a few lines of text." \
  "diagram the agent loop and the first isomorphism theorem"
ls "$out"

# Hero: the same answer in a dark and a light terminal.
typst compile --root / --ppi 180 --input layout=hero --input mode=dark --input img-w="$hero_w" \
  --input bullet="$(python3 -c 'import sys; print(round((float(sys.argv[1]) + 4.2) * float(sys.argv[2]) / float(sys.argv[3]) - 4.2, 2))' "$(bullet hero)" "$hero_w" "$img_w")" \
  --input img-dark="$out/raw/hero-dark-1.png" --input img-light="$out/raw/hero-light-1.png" \
  --input title="Claude's answers, rendered" \
  --input sub="Markdown, math and live Typst drawings, in the colours of your terminal." \
  --input ask="Demonstrate some insane capabilities of md-preview" "$here/frame.typ" "$out/0-hero.png" 2>/dev/null
ls "$out"
