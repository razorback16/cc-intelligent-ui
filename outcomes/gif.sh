#!/bin/sh
# Makes the README's hero GIFs (outcomes/out/hero-dark.gif, hero-light.gif):
# the site's first hero answer with its animation (site/index.html), with
# no header, the answer cut after its code block (0.8285 of its width) and
# the picture at 0.65 of its width, at 2x density, then made 1200 px wide
# with no dither.
# Usage: outcomes/gif.sh   (needs node with playwright and sharp, python3 with Pillow
# and libimagequant; the site's renders: site/build.sh)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
work="$here/.work/gif"
pw=${PW_ROOT:-$(npm root -g)}
for theme in dark light; do
  rm -rf "$work/$theme"
  PW_ROOT="$pw" node "$here/gif/capture.mjs" "$root" "$work/$theme" "$theme" 25 0.65 2 0.8285
  python3 -I "$here/gif/encode.py" "$work/$theme" "$here/out/hero-$theme.gif" 1200 none
done
