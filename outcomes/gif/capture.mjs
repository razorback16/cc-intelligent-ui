// Records the site's first hero answer (its animation from site/index.html) as PNG
// frames, one theme at a time, with no header and the answer cut at `cut` (its height
// as a part of its width; 0: all of it).
// Usage: node capture.mjs <repo> <out dir> <theme> [fps] [scale] [density] [cut]
// The frames are drawn from a timeline (frameAt), not in real time, so none is dropped.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_ROOT + "/");
const { chromium } = require("playwright");
const sharp = require("sharp");

const [repo, out, theme, fpsArg, scaleArg, dsfArg, cutArg] = process.argv.slice(2);
const fps = Number(fpsArg || 25), scale = Number(scaleArg || 0.8), dsf = Number(dsfArg || 2), cut = Number(cutArg || 0);
const html = readFileSync(`${repo}/site/index.html`, "utf8");
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
const js = readFileSync(`${repo}/site/assets/answers.js`, "utf8");
const answers = JSON.parse(js.slice(js.indexOf("["), js.lastIndexOf("]") + 1));
const hero = answers.find((x) => x.group === "hero");
const a = { ...hero, ratio: cut || hero.ratio };
// GitHub's page colours, so the window sits on the README as on the site.
const pageBg = theme === "dark" ? "#0d1117" : "#ffffff";
const W = 1000, PAD = 28;

const page = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
<style>${css}
  body { background: ${pageBg}; min-height: 0; }
  #box { padding: ${PAD}px; width: ${W}px; }
  /* The timeline sets every state itself. */
  *, *::before, *::after { transition: none !important; animation: none !important; }
  /* The picture at its own pixels (see pic.png below); the clip-path cuts it at the box's
     bottom (the raw render is taller: room under the answer), not at its other edges. */
  .t-pic img { height: auto; bottom: auto; right: auto; }
  /* No empty room between the answer and the input box. */
  .t-status { padding-top: calc(var(--pt) * 10); }
  :root[data-theme="dark"] { --shadow: 0 18px 40px -18px rgba(0,0,0,.8); }
  :root[data-theme="light"] { --shadow: 0 18px 40px -18px rgba(0,0,0,.28); }
</style></head><body><div id="box"></div></body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: W, height: 1400 }, deviceScaleFactor: dsf });
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/page.html`, page);
await tab.goto(`file://${out}/page.html`);
// The lossless render (outcomes/build.sh), else the site's WebP.
const raw = `${repo}/outcomes/out/raw/${a.name}-${theme}-1.png`;
const pic = `file://${existsSync(raw) ? raw : `${repo}/site/assets/render/${a.name}-${theme}.webp`}`;
const length = await tab.evaluate(({ a, pic, scale }) => {
  const w = a.frame * scale;
  const tri = '<svg viewBox="0 0 4.2 5.2"><path d="M0 0l4.2 2.6L0 5.2z"/></svg>';
  document.getElementById("box").innerHTML = `<div class="t-wrap">
    <div class="term full" style="--f:${a.frame + 40};--w:${w};--ar:${1 / a.ratio};--dot:calc(var(--pt) * ${w * a.bullet})">
      <div class="t-bar"><span class="t-lights"><i></i><i></i><i></i></span><span class="t-title">Claude Code</span><span class="t-key">⌥⌘1</span></div>
      <div class="t-body"><div class="t-scroll">
        <div class="t-ask">❯ <span class="q"></span></div>
        <div class="t-answer">
          <span class="t-spin"><b>✻</b> <i>Brewing…</i> <span></span></span>
          <span class="t-dot">●</span>
          <div class="t-pic"><img src="${pic}"></div>
        </div>
        <div class="t-brew">✻ Brewed for ${a.brew}s</div></div>
        <div class="t-status">● high · /effort</div><div class="t-rule"></div><div class="t-input">❯ <span class="in"></span><span class="t-cur"></span></div><div class="t-rule"></div><div class="t-mode"><b>${tri}${tri} auto mode on</b> (shift+tab to cycle)</div>
      </div>
    </div></div>`;
  const t = document.querySelector(".term");
  const $ = (s) => t.querySelector(s);
  const q = $(".q"), input = $(".in"), cur = $(".t-cur"), ask = $(".t-ask"), spinEl = $(".t-spin"), spin = $(".t-spin b"), secs = $(".t-spin span");
  const dot = $(".t-dot"), picEl = $(".t-pic"), brew = $(".t-brew");

  // The site's steps (site/index.html, play()), as times in ms.
  const key = (i) => 30 + (i % 3) * 8, chars = [...a.ask];
  const T0 = 450, typed = chars.reduce((n, _, i) => n + key(i), 0);
  const sent = T0 + typed + 320, drawn = sent + 12 * 110, ms = 900 + a.ratio * 600;
  const done = drawn + 1000 + a.ratio * 600, HOLD = 3000;
  const ease = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (2 - 2 * p) ** 3 / 2);
  const fade = (from, dur, now) => Math.max(0, Math.min(1, (now - from) / dur));
  const glyphs = "·✢✳✶✻✽✻✶✳✢";

  window.frameAt = (now) => {
    // The prompt as typed so far, in the input box.
    let n = 0, at = T0;
    while (n < chars.length && now >= at + key(n)) { at += key(n); n++; }
    const typing = now >= T0 && now < sent;
    input.textContent = now < sent ? chars.slice(0, now >= T0 ? n : 0).join("") : "";
    // The cursor blinks (1.05 s) but not while typing.
    cur.style.opacity = typing || now % 1050 < 525 ? 1 : 0;
    q.textContent = now >= sent ? a.ask : "";
    ask.style.opacity = fade(sent, 300, now);
    spinEl.style.opacity = now < sent ? 0 : now < drawn ? fade(sent, 300, now) : 1 - fade(drawn, 300, now);
    const step = Math.min(11, Math.floor((now - sent) / 110));
    spin.textContent = glyphs[Math.max(0, step) % glyphs.length];
    secs.textContent = `(${1 + Math.floor(Math.max(0, step) / 9)}s · esc to interrupt)`;
    dot.style.opacity = now < drawn ? 0 : fade(drawn, 300, now);
    picEl.style.opacity = now < drawn ? 0 : fade(drawn, 350, now);
    picEl.style.clipPath = now < drawn ? "inset(0 0 100% 0)" : `inset(-4px -4px ${(1 - ease(Math.min((now - drawn) / ms, 1))) * 100}% -4px)`;
    brew.style.opacity = now < done ? 0 : fade(done, 300, now);
  };
  // One height: the finished answer's, so the window never moves.
  window.frameAt(done + 1000);
  t.style.height = t.offsetHeight + "px";
  return done + HOLD;
}, { a, pic, scale });

// The picture made as wide as its box in pixels (Lanczos), and drawn at whole pixels:
// Chrome resamples a picture at a fraction of a pixel, which loses its thin edge lines
// (a code block's left border is one column at x 0).
const px = await tab.evaluate((dsf) => Math.round(document.querySelector(".t-pic").getBoundingClientRect().width * dsf), dsf);
await sharp(new URL(pic).pathname).resize({ width: px, kernel: "lanczos3" }).png().toFile(`${out}/pic.png`);
await tab.evaluate(({ src, px, dsf }) => {
  const img = document.querySelector(".t-pic img");
  img.src = src;
  img.style.width = `${px / dsf}px`;
  const r = img.getBoundingClientRect();
  const snap = (v) => (Math.round(v * dsf) - v * dsf) / dsf;
  img.style.transform = `translate(${snap(r.left)}px, ${snap(r.top)}px)`;
}, { src: `file://${out}/pic.png`, px, dsf });
await tab.waitForFunction(() => document.querySelector(".t-pic img").complete);
await tab.evaluate(() => document.fonts.ready);
mkdirSync(out, { recursive: true });
const box = await tab.$("#box");
const count = Math.round((length / 1000) * fps);
for (let i = 0; i < count; i++) {
  await tab.evaluate((now) => window.frameAt(now), (i * 1000) / fps);
  await box.screenshot({ path: `${out}/f${String(i).padStart(4, "0")}.png` });
}
writeFileSync(`${out}/info.json`, JSON.stringify({ fps, count, length }));
await browser.close();
console.log(`${theme}: ${count} frames, ${length} ms`);
