#!/bin/sh
# Renders the sample answers with md-preview's own template, then frames them.
# Usage: marketing/build.sh   (needs typst 0.15)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
out="$here/out"; work="$here/.work"
mkdir -p "$out/raw" "$work/pkg-cache"
export TYPST_PACKAGE_CACHE_PATH="$work/pkg-cache"
width=${WIDTH:-560}; ppi=${PPI:-288}
for md in "$here"/samples/*.md; do
  name=$(basename "$md" .md)
  python3 -c 'import json,sys; print(json.dumps({"base": sys.argv[2], "segments": [open(sys.argv[1]).read()]}))' "$md" "$here/samples" > "$work/$name.json"
  for mode in dark light; do
    typst compile --root / --package-path "$root/render/packages" --format png --diagnostic-format short --ppi "$ppi" \
      --input theme=$mode --input width=$width --input doc="$work/$name.json" \
      --input theme-dir="$root/render/themes/vscode-modern" --input term-font="${TERM_FONT:-MesloLGS NF}" \
      --input top=6 --input row=0 --input code=0.9 \
      "$root/render/md.typ" "$out/raw/$name-$mode-{0p}.png"
  done
done
ls "$out/raw"

# Frames: headline, subline and the prompt for each sample.
frame() { # name title sub ask bullet-offset-pt
  for mode in dark light; do
    typst compile --root / --ppi 216 --input img="$out/raw/$1-$mode-1.png" --input mode=$mode --input bullet="$5" \
      --input title="$2" --input sub="$3" --input ask="$4" "$here/frame.typ" "$out/$1-$mode.png" 2>/dev/null
  done
}
frame 1-overview "Real Markdown, right in the terminal" "Tables, task lists, quotes and footnotes, drawn like VS Code's preview." "what is left for the v0.2.0 release?" 15
frame 2-code "Syntax colours in your own font" "Code blocks use the terminal's font and size, with VS Code colours." "how should we pick light or dark mode?" 9
frame 3-math "LaTeX math that reads like a paper" "Inline and display math, set by Typst." "why is 0.4 the cut-off?" 9
frame 4-typst "Live diagrams and plots" "Claude writes Typst; md-preview draws it, offline." "show me how auto mode decides" 9
ls "$out"

# Hero: the same answer in a dark and a light terminal.
typst compile --root / --ppi 180 --input layout=hero --input mode=dark --input bullet=7 \
  --input img-dark="$out/raw/4-typst-dark-1.png" --input img-light="$out/raw/4-typst-light-1.png" \
  --input title="Claude's answers, rendered" \
  --input sub="Markdown, math and live Typst diagrams, in the colours of your terminal." \
  --input ask="show me how auto mode decides" "$here/frame.typ" "$out/0-hero.png" 2>/dev/null
ls "$out"
