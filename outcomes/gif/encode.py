# Frames (capture.mjs) to one looping GIF: one palette for all frames (from a
# montage of key frames, libimagequant), Floyd-Steinberg dither (fs) or none,
# identical frames merged.
# Usage: python3 encode.py <frames dir> <out.gif> [width] [fs|none]
import glob, json, sys
from PIL import Image, ImageChops

src, out = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 0
DITHER = Image.Dither.FLOYDSTEINBERG if (sys.argv[4] if len(sys.argv) > 4 else 'fs') == 'fs' else Image.Dither.NONE
info = json.load(open(f"{src}/info.json"))
step = round(1000 / info["fps"])
files = sorted(glob.glob(f"{src}/f*.png"))
frames = [Image.open(f).convert("RGB") for f in files]
if width:
    h = round(frames[0].height * width / frames[0].width)
    frames = [f.resize((width, h), Image.LANCZOS) for f in frames]

# The palette: the finished frame (all the colours of the answer) and a frame mid-draw.
keys = [frames[-1], frames[len(frames) // 2], frames[len(frames) // 3]]
w, h = frames[0].size
montage = Image.new("RGB", (w, h * len(keys)))
for i, k in enumerate(keys):
    montage.paste(k, (0, h * i))
pal = montage.quantize(colors=256, method=Image.Quantize.LIBIMAGEQUANT)

out_frames, durations = [], []
prev = None
for f in frames:
    q = f.quantize(palette=pal, dither=DITHER)
    if prev is not None and ImageChops.difference(q.convert("RGB"), prev.convert("RGB")).getbbox() is None:
        durations[-1] += step
        continue
    out_frames.append(q)
    durations.append(step)
    prev = q

out_frames[0].save(out, save_all=True, append_images=out_frames[1:], duration=durations, loop=0, optimize=False, disposal=1)
print(out, len(out_frames), "frames", f"{w}x{h}")
