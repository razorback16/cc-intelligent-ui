#!/bin/sh
# Builds the site's answers: the mod's own pictures of outcomes/samples, with
# no marketing frame. The page draws the Claude Code terminal around them.
# Usage: site/build.sh                 (renders with outcomes/build.sh first)
#        SKIP_RENDER=1 site/build.sh   (uses the renders in outcomes/out/raw)
# Needs typst 0.15 and python3 with Pillow.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
[ -n "${SKIP_RENDER:-}" ] || RAW_ONLY=1 "$root/outcomes/build.sh" >/dev/null
mkdir -p "$here/assets/render"

python3 - "$root/outcomes" "$here/assets" <<'EOF'
import json, sys
from PIL import Image
outcomes, assets = sys.argv[1:]

# name, where, tab or tag, the prompt, brew time (s). The heroes' windows are
# 520 pt for 96 columns, the others 600 pt for 118 (outcomes/build.sh, frame.typ).
answers = [
  ("1-overview",       "hero",    "Markdown",       "show me what Markdown you can draw", 6),
  ("hero-1-attention", "hero",    "Attention",      "Explain attention in a transformer", 5),
  ("hero-2-latency",   "hero",    "Latency",        "Why is my API request slow?", 7),
  ("hero-3-rebase",    "hero",    "Git rebase",     "Explain git rebase with a picture", 4),
  ("2-math",           "gallery", "LaTeX math",     "write out Maxwell's equations", 3),
  ("3-mandelbrot",     "gallery", "Typst compute",  "draw the Mandelbrot set", 6),
  ("4-fractal",        "gallery", "CeTZ",           "draw a fractal tree next to a Lissajous curve", 5),
  ("5-plot",           "gallery", "cetz-plot",      "plot a damped oscillator", 4),
  ("6-diagrams",       "gallery", "fletcher",       "diagram the agent loop and the first isomorphism theorem", 5),
]

out = []
for name, group, label, ask, brew in answers:
    ims = {m: Image.open(f"{outcomes}/out/raw/{name}-{m}-1.png").convert("RGBA") for m in ("dark", "light")}
    w = ims["dark"].width
    # Cut the empty room under the answer; keep the full width so the scale holds.
    bottom = min(ims["dark"].height, max(im.getchannel("A").getbbox()[3] for im in ims.values()) + 8)
    px = 1600 if group == "hero" else 1200
    h = round(bottom * px / w)
    for m, im in ims.items():
        im.crop((0, 0, w, bottom)).resize((px, h), Image.LANCZOS) \
          .save(f"{assets}/render/{name}-{m}.webp", quality=86, method=6)
    # The bullet's centre, as a part of the picture width (sizes() in outcomes/build.sh, IMG_W 600).
    bullet = float(open(f"{outcomes}/.work/{name}.top").read().split()[1])
    frame = 520 if name.startswith("hero-") else 600
    out.append(dict(name=name, group=group, label=label, ask=ask, brew=brew,
                    frame=frame, ratio=round(h / px, 5), bullet=round((bullet + 4.2) / 600, 5)))
    print(f"{name}: {px}x{h}")

with open(f"{assets}/answers.js", "w") as f:
    f.write("// Made by site/build.sh. Do not edit.\nwindow.IUI_ANSWERS = " + json.dumps(out, indent=1) + ";\n")
EOF
