#!/bin/sh
# Makes the README's hero GIFs (outcomes/out/hero-dark.gif, hero-light.gif):
# the site's first hero answer with its animation (site/index.html), the
# picture at 0.8 of its width so the whole window fits with no scroll, at
# 2x density, then made 1400 px wide with no dither: about 1 MB each.
# Usage: outcomes/gif.sh   (needs node with playwright, python3 with Pillow
# and libimagequant; the site's renders: site/build.sh)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
work="$here/.work/gif"
pw=${PW_ROOT:-$(npm root -g)}
for theme in dark light; do
  rm -rf "$work/$theme"
  PW_ROOT="$pw" node "$here/gif/capture.mjs" "$root" "$work/$theme" "$theme" 25 0.8 2
  python3 -I "$here/gif/encode.py" "$work/$theme" "$here/out/hero-$theme.gif" 1400 none
done
