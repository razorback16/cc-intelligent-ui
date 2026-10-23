// Intelligent UI's settings: sizes, limits, timings and the text it adds to
// Claude's system prompt.
import type { Cell } from './state'

// ---- Settings -------------------------------------------------------------

// `/iui width`: the most columns a picture takes (in this range), or
// `full`, the default: the terminal width less the bullet, as Claude Code's
// own text. An Image is at most IMAGE_MAX_COLUMNS wide, so no width goes
// past it.
export type Width = number | 'full'
export const DEFAULT_WIDTH: Width = 'full'
export const MIN_WIDTH = 40
export const MAX_WIDTH = 400
export const IMAGE_MAX_COLUMNS = 255
// The width setting as words: "160 columns", or "full (the terminal width)".
export const widthText = (width: Width) => (width === 'full' ? 'full (the terminal width)' : `${width} columns`)
// The bullet column to the left of an answer.
export const GUTTER = 2
// Claude Code's own reply bullet: ⏺ on macOS, ● elsewhere.
export const bulletOf = (isMac: boolean) => (isMac ? '⏺' : '●')
// The engine's answer row has a blank row above it; ours keeps it.
export const MARGIN_TOP = 1
// The template's body text size in pt; the page width is chosen so that this
// text looks as big as the terminal's own (see fontFit).
export const BODY_PT = 11
// `/iui size`: a percent on top of that match.
export const DEFAULT_SIZE = 100
export const MIN_SIZE = 80
export const MAX_SIZE = 200
// A block whose text changes outside a model request we saw (a hot reload
// mid-stream) is final once its text has been still this long.
export const SETTLE_MS = 400
// Inside a request, a block whose text has been still this long is final
// too (a stalled stream never keeps it hidden).
export const LIVE_STILL_MS = 2000
// How long a final block that is not drawn yet stays blank before its text
// shows: after it streamed, and when it was never live (a resumed transcript).
export const BLANK_AFTER_LIVE_MS = 2000
export const BLANK_RESUMED_MS = 1000
export const MAX_RUNNING = 2
// A segment is cut to be about this many rows; an Image is 255 rows at most.
export const SEGMENT_ROWS = 160
// The rows a live Typst block is counted as when its room is not known: the
// largest room of the default height (PICTURE_MAX_ROWS).
export const DRAWING_ROWS = 24
export const MAX_IMAGE_ROWS = 255
// The cell in device pixels when the tty reports none (tmux, a relay): an
// 8 x 16 point cell at Retina scale 2. A reported cell outside 4 to 64 px
// wide is not trusted.
export const DEFAULT_CELL: Cell = { width: 16, height: 32 }
// Part of every key: bump it when the interface with the template changes.
// The template's inputs for the room of a drawing (all in pt): `height` the
// room height now, `design-w` and `design-h` the design (the space at the
// first compile of the text). Its live Typst blocks scale by
// min(content width / design-w, height / design-h).
export const TEMPLATE_VERSION = '9'
// Part of the key of a picture with the row grid only: bump it when such a
// picture or its bullet row changes, so the keys with the grid off stay.
export const GRID_VERSION = '2'
export const COMPILE_TIMEOUT_MS = 20000
export const ALT_CHARS = 200
// Where Typst is when the login shell's PATH does not find it. `~` is $HOME.
export const TYPST_FALLBACKS = [
  '/opt/homebrew/bin/typst', '/usr/local/bin/typst', '/usr/bin/typst', '/snap/bin/typst', '~/.cargo/bin/typst', '~/.local/bin/typst',
  '/home/linuxbrew/.linuxbrew/bin/typst', '~/.linuxbrew/bin/typst',
]
export const NO_TYPST = 'Intelligent UI: install Typst (brew install typst) to see rendered answers'
// How to install Typst: brew on macOS; on Linux, cargo or a release file
// (docs/install.md has more ways).
export const typstHintOf = (isMac: boolean) =>
  isMac ? 'brew install typst' : 'cargo install --locked typst-cli, or a release from github.com/typst/typst/releases'
export const noTypstOf = (isMac: boolean) => (isMac ? NO_TYPST : `Intelligent UI: install Typst (${typstHintOf(false)}) to see rendered answers`)
// Typst downloads a package it doesn't find under --package-path; a proxy
// nobody listens on makes that fail at once, so a live block never fetches.
export const NO_NETWORK = 'http://127.0.0.1:9'
// With Claude Code's theme on auto: how often the OS appearance is read, and
// how long one read may take.
export const HOST_POLL_MS = 3000
export const HOST_CHECK_MS = 2000
// Under herdr: how often the light client check runs (the app in front and
// the known clients' tty times), and the most time between two full scans
// (the process list: new or gone clients).
export const HERDR_POLL_MS = 1000
export const HERDR_SCAN_MS = 10000
// Under herdr the OSC 11 probe (at the start and for a new client) reads the
// pane's tty, which Claude Code reads too: a key typed then can go to the
// probe. So it does not run within this time of a key in the prompt box.
export const OSC11_QUIET_MS = 2000
// Copy: how often the watcher reads the clipboard's change count (macOS;
// one call in the watcher, no process), and the word positions of how
// many pages are kept in memory (a copy probes only the pages it reads).
export const CLIP_WAKE_MS = 300
export const PROBED_KEPT = 64
// The base every theme merges over (its theme.json and syntax files).
export const BASE_THEME = 'vscode'
// The theme used when none is chosen, or when the chosen one is not usable.
export const DEFAULT_THEME = 'claude-code'
// The two modes a theme has syntax colours for.
export const MODES = ['dark', 'light'] as const
// A picture under a row (an image Claude sends, an image the user pastes)
// and a drawing's room: at most this many rows tall, and at most half the
// terminal's rows.
export const PICTURE_MAX_ROWS = 24
export const PICTURE_MIN_ROWS = 6
// `/iui height`: the most rows an image Claude sends or a Typst
// drawing (the room of a live block or a local image in Markdown; not a
// whole Markdown page) takes. `half`, the default: as above. `full`: the
// terminal's rows less PICTURE_ROOM_ROWS. A number: that many rows, at most
// as many as `full`. Never under PICTURE_MIN_ROWS.
export type Height = number | 'half' | 'full'
export const DEFAULT_HEIGHT: Height = 'half'
export const MIN_HEIGHT = PICTURE_MIN_ROWS
export const MAX_HEIGHT = 200
// The rows an image leaves free: the row of the file, the text around it
// and the prompt.
export const PICTURE_ROOM_ROWS = 16
// The height setting as words.
export const heightText = (height: Height) =>
  height === 'half' ? `half (half the terminal, ${PICTURE_MIN_ROWS} to ${PICTURE_MAX_ROWS} rows)`
  : height === 'full' ? `full (the terminal height less ${PICTURE_ROOM_ROWS} rows)`
  : `${height} rows`
// The grid setting as words.
export const gridText = (grid: boolean) => (grid ? 'on (each line of text on whole terminal rows)' : 'off')
// `/iui select`: picture select (select.ts), on by default, from the oldest
// Claude Code the mod supports (the Client, ui.message, ui.blit and ui.copy are there).
export const SELECT_SINCE = '2.1.298'
export const selectText = (on: boolean) => (on ? 'on (select and copy picture text with the mouse, fullscreen)' : 'off')
export const PICTURES_KEPT = 64
// The previews of pasted images (composer.tsx: the band and the rows): about
// this many rows tall, this many columns apart, and a file not there yet
// looked for again after PREVIEW_RETRY_MS, PREVIEW_TRIES times at most.
export const PREVIEW_ROWS = 5
export const PREVIEW_GAP = 2
export const PREVIEW_RETRY_MS = 250
export const PREVIEW_TRIES = 8
// The file paths of the link rows under a picture: whether each one is a
// file, kept for this many paths (the oldest go).
export const LINK_FILES_KEPT = 512
// The compile results kept in memory (an LRU); the oldest go past this.
export const RESULTS_KEPT = 1024
// A resize or a font size change is settled when no new tty line and no
// new viewport came for this long (one compile wave for each drag).
export const RESIZE_QUIET_MS = 450
// An epoch (a new target Frame, theme or setting) shows its pictures all at
// once: when its jobs on screen are done, at least COMMIT_MIN_MS after it
// began, or at COMMIT_MAX_MS whatever is still running.
export const COMMIT_MIN_MS = 100
export const COMMIT_MAX_MS = 5000
// The cache folders and design files read are touched together this often
// (one `touch -c` for all), not at each read.
export const TOUCH_FLUSH_MS = 5000
// A design file not read in this many days is deleted.
export const DESIGNS_KEPT_DAYS = 180
// A Markdown file Claude sends (SendUserFile) draws when it is at most this
// many bytes.
export const SENT_TEXT_MAX_BYTES = 256 * 1024
// The PNG Typst makes of a JPEG, WebP or SVG (never made larger), or of a
// PDF page, fits the space of the picture, and each side is at most this
// many pixels.
export const CONVERT_MAX_SIDE = 4096

// What Claude is told while the mod draws its answers (a system prompt
// section, added last).
export const TYPST_PROMPT = `Your replies in this terminal are drawn as rendered Markdown pictures (VS Code preview look), so use Markdown freely: headings, tables, task lists, code blocks, images by absolute path, and LaTeX math (\`$…$\` inline, \`$$…$$\` for display).
Make your answers visual where a picture explains more than words: draw a process, a structure, a timeline or data in a fenced \`\`\`typst block. It is rendered live with Typst 0.15 (full Typst markup; begin code lines with #). For what Markdown shows well, such as tables and lists, use Markdown.
Each typst block compiles alone, with only \`theme\` in scope, so start it with the #import of each package it uses. These are available offline:
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot, chart
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
\`theme\` has: theme.fg, theme.muted, theme.link, theme.border, theme.accent, theme.bg, theme.code-bg, theme.red/green/blue/yellow/orange/purple, theme.palette (6 colours), theme.width (content width) and theme.height (the height a drawing should fit in), both lengths, theme.text-size, theme.sans and theme.mono (font lists), theme.dark (bool).
Rules (the examples follow them):
- Size: fit theme.width × theme.height; a taller drawing is not made smaller. The terminal is wide and short, so lay flows out left to right.
- Colours: text already has theme.fg and the body font. Default strokes are black and invisible on a dark theme, so always pass theme colours as the examples do. Fill shapes with a theme colour \`.transparentize(80%)\`, colour data with theme.palette in order, use theme.muted for secondary text.
- fletcher makes no space for edge labels and does not route edges around nodes: keep labels short, make each gap wider than its label, break a long label with \`\\\`, and go around nodes with corner points, not \`bend\`.
- #page, #pagebreak and #set page are errors. A block that fails to compile shows as code.
Only for a complex or unusual drawing (beyond these examples), or after a block failed, load the cc-intelligent-ui:intelligent-ui skill first; normal answers and drawings like these need no skill.
A flow chart (fletcher; \`node-shape: rect\` keeps small nodes from becoming circles, \`stroke: none\` is a text-only node):
\`\`\`typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#diagram(
  node-stroke: theme.fg, edge-stroke: theme.fg, node-shape: rect,
  crossing-fill: theme.bg, spacing: (3em, 2em),
  node((0, 0), [Build], fill: theme.blue.transparentize(80%), name: <b>),
  node((1, 0), [Test], fill: theme.orange.transparentize(80%), name: <t>),
  node((2, 0), [Deploy], fill: theme.green.transparentize(80%), name: <d>),
  node((3, 0), [live], stroke: none, name: <l>),
  edge(<b>, <t>, "->"),
  edge(<t>, <d>, "->", [pass]),
  edge(<d>, <l>, "-->"),
  edge(<t>, (1, 1), (0, 1), <b>, "->", [fail], label-side: right),
)
\`\`\`
A timeline (cetz; lay the drawing out in a W × H unit box, here 10 × 2):
\`\`\`typst
#import "@preview/cetz:0.5.2"
#cetz.canvas(length: calc.min(theme.width / 10, theme.height / 2), {
  import cetz.draw: *
  set-style(stroke: theme.fg)
  line((0, 0), (10, 0), mark: (end: ">"))
  for (x, name, date, c) in ((2, [v1.0], [Jan], theme.blue), (7, [v2.0], [Oct], theme.green)) {
    circle((x, 0), radius: 0.15, fill: c, stroke: none)
    content((x, 0.5), name)
    content((x, -0.5), text(fill: theme.muted, date))
  }
})
\`\`\`
A plot (cetz-plot; the axes, ticks and legend need the set-style line):
\`\`\`typst
#import "@preview/cetz:0.5.2"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(length: calc.min(theme.width / 14, theme.height / 6), {
  cetz.draw.set-style(axes: (stroke: theme.fg, tick: (stroke: theme.fg)), legend: (fill: theme.bg, stroke: theme.border))
  plot.plot(size: (12, 4), x-label: [requests], y-label: [ms], legend: "inner-north-west", {
    plot.add(((1, 20), (4, 90), (8, 190)), label: [no cache], style: (stroke: theme.palette.at(0)))
    plot.add(((1, 20), (4, 30), (8, 38)), label: [cache], style: (stroke: theme.palette.at(1)))
  })
})
\`\`\`
A plan (the plan file you write in plan mode) is drawn the same way when ExitPlanMode asks for approval, so the same Markdown, $math$ and typst blocks work there.
The stored text stays Markdown, so keep replies readable as plain text too.`
