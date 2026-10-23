// Intelligent UI's state: the types the modules share, the values that change
// (`S`), the caches, and refresh (the `done` atom).
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { IuiTheme } from '../../types'
import type { ThemeInfo } from './themes'
import type { HostMode, ThemeSetting } from './mode'
import type { PlanVerdict } from './plan'
import type { Drawn } from './copy'
import type { GridMetrics } from './grid'
import type { Checked } from './updates'
import type { ClipWay } from './clipboard'
import type { PdfFacts, PixelBox } from './images'
import { DEFAULT_HEIGHT, DEFAULT_SIZE, DEFAULT_WIDTH, type Height, type Width } from './settings'
import { invalidate } from './api'

// The `done` atom (see types/index.d.ts) for refresh. The state scan of
// `claude plugin validate` reads an atom only from a const in the file that
// reads or writes it, so each such file has a copy of its own (atom() is a
// plain description: the copies are one value).
const done = atom({ plugin: 'cc-intelligent-ui', key: 'done' } as const, 0)

export type Cell = { width: number; height: number }
// The terminal now (one TIOCGWINSZ read): its columns, rows and cell in
// device pixels. A font size change is a change of the cell.
export type Frame = { columns: number; rows: number; cell: Cell }
// The drawing space in pt at the first compile of a text: the page width
// (the template's `width`) and the room height. Its live Typst blocks scale from it.
export type Design = { widthPt: number; heightPt: number }
// The room for a drawing: its height in pt now, and the design of the text.
// `designKey` names the design's file; `isNew`: no file yet (the design is
// the space now, recorded once a final compile succeeds).
export type Room = { heightPt: number; design: Design; designKey: string; isNew: boolean }
// Per 1 em (render/measure.typ): `adv` the width of "0", `xh` the x-height,
// `avg` the mean advance over a lowercase pangram.
export type FontMetrics = { adv: number; xh: number; avg: number }
// The theme's font lists (merged over vscode), and `plain`: its list
// markers and numbering are ASCII (fonts.ts: the lean font set).
export type LeanFonts = { body: string[]; code: string[]; plain: boolean }
// `term` the terminal's font (null when unknown or not installed), `menlo`
// the template's code font, `body` its text font, `grid` the row grid's
// numbers (DEFAULT_GRID when not given), `fonts` the theme's font lists
// (none: no lean font set), `termBold` whether Typst has a bold face of the
// terminal's font (none: not known).
export type Metrics = { term: FontMetrics | null; menlo: FontMetrics; body: FontMetrics; grid?: GridMetrics; fonts?: LeanFonts; termBold?: boolean }
// The terminal's font is known and has no bold face: md.typ draws a fake bold (term-bold=0).
export const fauxBoldOf = (m: Metrics) => !!m.term && m.termBold === false
// Measured with Typst on macOS: Menlo and SF Pro Text.
export const DEFAULT_METRICS: Metrics = {
  term: null,
  menlo: { adv: 0.602, xh: 0.547, avg: 0.602 },
  body: { adv: 0.63, xh: 0.526, avg: 0.483 },
}
export type Env = {
  typst: string | null
  canDraw: boolean
  // Over ssh: pictures go as `{ png }` bytes, not as a file name.
  inline: boolean
  cache: string
  cwd: string
  root: string
  isMac: boolean
  stamp: string
  home: string
  // Claude Code's temp folder of this user (claudeTmpOf; '' when not known).
  claudeTmp: string
  // The terminal's font family ('' when not known) and the fonts' metrics.
  termFont: string
  metrics: Metrics
  // The designs folder (designs.ts), outside the 2-day tmp cleanup.
  designs: string
}
// `columns` and `rows`: the cell box the page was compiled for (it is drawn
// at that box, never stretched).
export type Page = { file: string; width: number; height: number; alt: string; columns: number; rows: number }
export type Result = { pages: Page[]; bulletRow: number; note?: string }
export type Job = {
  key: string
  requestId: string
  text: string
  columns: number
  cell: Cell
  theme: IuiTheme
  size: number
  // `/iui grid`: each text line on the terminal's row grid.
  grid: boolean
  themeDir: string
  env: Env
  // The folder relative images start from (a Markdown file's); else env.cwd.
  base?: string
  // The room for its drawings (a text with a live Typst block or a local image).
  room?: Room
  // The epoch (S.epoch) it was enqueued in: only the open epoch's jobs hold
  // its commit (set by enqueue).
  epoch: number
  // The queue's order: a row on screen first, then the newest (`order`, set
  // by enqueue). `onScreen` false: the row is known to be off screen (it
  // does not hold the commit); undefined: not known.
  onScreen?: boolean
  order?: number
}
// The active theme: its name, folder, and the mtimes of its files and the
// base theme's, which are part of every key.
export type Look = { name: string; dir: string; stamp: string }

// Module state: lost on a hot reload, which is fine. The PNGs stay on disk
// with a pages.json beside them, so a key compiled before is read back.
// The values that change are in one object, so every module sees the same.
export const S = {
  env: null as Env | null,
  envLoading: null as Promise<Env> | null,
  // The target: the terminal now, settled (the tty's Frame with its columns
  // at most the viewport's). Keys and compiles use it. Only frame.ts and
  // beginEpoch set it. Null until the first read.
  frame: null as Frame | null,
  // The Frame whose pictures are on screen: the target once its epoch
  // committed (all its pictures swap in one redraw). Pictures size from it.
  shown: null as Frame | null,
  // The epoch: one for each new target (a settled resize, a setting, a mode).
  // It is open while `epoch` is not `shownEpoch` (epochOpen).
  epoch: 0,
  shownEpoch: 0,
  // A burst of tty lines or viewports is not quiet yet: no job starts, and
  // the epoch does not commit. `missed`: a job ended while it was so.
  resizing: false,
  missed: false,
  // The last good tty read and the last viewport a render hook saw, not
  // settled yet (frame.ts settles them into `frame`).
  tty: null as Frame | null,
  viewColumns: null as number | null,
  viewRows: null as number | null,
  // The terminal's layout (a viewport's isFullscreen; fixed per session),
  // null before a render hook says.
  isFullscreen: null as boolean | null,
  // The fullscreen advice was shown (once, on the main screen).
  fullscreenTold: false,
  // Why there is no cache folder ('' when there is one): nothing is drawn.
  cacheProblem: '',
  // The key folders in the cache at setUp: a key found there is read back
  // at once (a reopened session), with no queue and no blank.
  onDisk: new Set<string>(),
  theme: 'dark' as IuiTheme,
  size: DEFAULT_SIZE,
  // `/iui width`: the most columns a picture takes, or full.
  width: DEFAULT_WIDTH as Width,
  // `/iui height`: the most rows an image or a Typst drawing takes (half, full or a number).
  height: DEFAULT_HEIGHT as Height,
  // The height setting of the pictures on screen: `height` once its epoch
  // committed (with `shown`), so an image box changes in one step.
  shownHeight: DEFAULT_HEIGHT as Height,
  // `/iui grid`: each text line of a page on whole terminal rows, so a
  // mouse selection (whole cells) covers the text it copies. On by default.
  grid: true,
  // `/iui select`: picture select (select.ts), on by default; and Claude
  // Code's version ('' not known), read in setUp.
  select: true,
  engine: '',
  look: null as Look | null,
  // The usable themes the last scan found, for the typeahead.
  themeChoices: [] as ThemeInfo[],
  // Claude Code's theme setting as set (`settingRaw`) and read (`setting`); with
  // auto, `host` is the OS appearance last read and `watch` the poll timer. A
  // hot reload cancels the old module's timers (`$.clock` docs), so `watch`
  // starts empty with the module and at most one poll runs (`checking`).
  setting: 'dark' as ThemeSetting,
  settingRaw: '',
  host: null as HostMode | null,
  hostOs: '',
  colorFgBg: '',
  termProgram: '',
  termName: '',
  itermProfile: undefined as string | undefined,
  // kitty: TERM=xterm-kitty, or its KITTY_WINDOW_ID / KITTY_PID (set in setUp).
  isKitty: false,
  // iTerm2 (isItermIn) and cmux (Ghostty inside, with its CMUX_* variables), set in setUp.
  isIterm: false,
  isCmux: false,
  // A font folder for Typst (TYPST_FONT_PATHS): the font a terminal carries
  // in its program (Ghostty's, Rio's), when it draws it. '' for none.
  fontPaths: '',
  // The user's own TYPST_FONT_PATHS (set in setUp); fontPaths goes after it.
  userFontPaths: '',
  // Over ssh (set in setUp): the terminal's config and the OS appearance here
  // are the remote computer's, not those of the user's screen.
  isRemote: false,
  // IUI_DEBUG is set (setUp): trace lines go to the debug log.
  debug: false,
  // iTerm2 with the engine's pictures off at start: /iui setup can help
  // (`setupNeeded`); the question is asked once per load (`setupAsked`).
  setupNeeded: false,
  setupAsked: false,
  watch: null as { cancel: () => void } | null,
  checking: false,
  // Linux: the tool that reads the desktop portal's colour scheme (host.ts;
  // null: not tried yet, '': none works, so GNOME's gsettings is read).
  portalTool: null as 'gdbus' | 'busctl' | '' | null,
  // Linux: how the clipboard is read and watched (clipboard.ts; null: not
  // looked up, as on macOS and over ssh).
  clipWay: null as ClipWay | null,
  // Streaming: model requests of the main loop in flight.
  stepsLive: 0,
  // The plan (plan.tsx): the main loop's running turn (`turn.start`), the
  // verdict the mod's question gave for the PermissionRequest that follows
  // (null: none, the engine's dialog asks), the question asked now ('': none),
  // and the `code` command's path (null: not looked up yet; '': none), and
  // on Linux a GUI editor that waits (its path and flag; [] none).
  mainTurnId: '',
  planVerdict: null as PlanVerdict | null,
  planAsking: '',
  planCode: null as string | null,
  planGui: null as string[] | null,
  // The update check (updates.ts), read once per load (`updatesLoading`):
  // `/iui updates` (on by default), the variable that turns the check off
  // ('' none), this mod's version ('' not known) and the last check (null:
  // none stored). `updateDone`: this load's check ran or was not due;
  // `updateBusy`: one runs now.
  updates: true,
  updatesOff: '',
  ownVersion: '',
  updateChecked: null as Checked | null,
  updatesLoading: null as Promise<void> | null,
  updateDone: false,
  updateBusy: false,
}
// The compile results by key (an LRU: set with `keep` at RESULTS_KEPT).
export const results = new Map<string, Result | 'failed'>()
// Streaming: model requests of the main loop in flight (`S.stepsLive`), the
// blocks drawn blank while their text streams (with the job to compile once
// final), and the blocks a request made final (they stay final).
export const lastText = new Map<string, string>()
export const live = new Map<string, { job: Job; still: { cancel: () => void } }>()
export const finalized = new Set<string>()
// A final block not drawn yet: blank until `showText` (its deadline passed).
export const pending = new Map<string, { textHash: string; showText: boolean; timer: { cancel: () => void } }>()
// The jobs waiting, and the jobs that compile now by key (with the cancel
// of each: beginEpoch stops them; and its signal: an entry cancelled still
// holds its slot until its compile ends, but its key may be enqueued again).
export const queue: Job[] = []
export const running = new Map<string, { job: Job; cancel: () => void; signal: AbortSignal }>()
// An epoch is open: its target is not on screen yet.
export const epochOpen = () => S.epoch !== S.shownEpoch
// The key last drawn per message (and its text), so a new size keeps the old
// picture (at its own box) until the new one is ready instead of the text.
// `job`: the Job of that key as it drew (its env as then, no text), for the
// probe of a copy. The oldest go past RESULTS_KEPT, as `results`.
export const lastKey = new Map<string, { key: string; textHash: string; job: Job }>()
// Over ssh: each page file's PNG as base64 (null: too large to send), read
// once so a redraw does not read it again; the oldest go past INLINE_KEPT.
export const inlined = new Map<string, string | null>()
export const INLINE_KEPT = 64
// Pictures under rows: each file's PNG size by its stat stamp (null: not a
// PNG), and the pasted-images folder of each session once found.
export const pictures = new Map<string, { stamp: string; size: { width: number; height: number } | null }>()
export const pasteDirs = new Map<string, string>()
// SendUserFile: the PNG Typst made of each JPEG, WebP or SVG, or PDF page,
// by its file, stat stamp, box and page (null: it failed), the ones Typst
// makes now (same keys), the last PNG shown of each file (a PDF's by its
// row; any box or page: it draws while a new box is made), and the text of
// each Markdown file by its stat stamp (null: it does not draw).
export const converted = new Map<string, string | null>()
export const converting = new Map<string, Promise<string | null>>()
export const lastConverted = new Map<string, { stamp: string; png: string }>()
export const sentTexts = new Map<string, { stamp: string; text: string | null }>()
// SendUserFile PDFs: what is known of each file's pages (by `<file>@<stat
// stamp>`), and the page each row shows of each PDF (by
// `<tool_use_id>\n<path>`; page 1 when not set). In memory only.
export const pdfFacts = new Map<string, PdfFacts>()
export const pdfPages = new Map<string, number>()
// The page field (pictures.tsx): the row and PDF it is for, the box of its
// picture, the text it holds and its note (''); null while it is closed.
export const pageAsk = {
  now: null as { row: string; file: string; box: PixelBox; value: string; note: string } | null,
}
// The link rows (draw.tsx): whether each absolute path is a file (at most
// LINK_FILES_KEPT).
export const linkFiles = new Map<string, boolean>()
// The plan: the text edited in Intelligent UI's flow, by the call's tool_use_id
// (its rows draw it), and the ExitPlanMode calls of subagents (drawn as the
// engine draws them).
export const editedPlans = new Map<string, string>()
export const subagentPlans = new Set<string>()
// The main loop's Write and Edit calls still running, by file path (the plan
// waits for its file's).
export const writesLive = new Map<string, number>()

// Copy (copy.ts, probe.ts): the pages drawn this session by their id (an
// answer's requestId, `plan:<tool_use_id>`, `file:<tool_use_id>:<path>`;
// oldest first, at most DRAWN_KEPT), each with the Job that drew it (the
// probe's inputs; none when not known).
export const drawnAnswers = new Map<string, Drawn & { job?: Job }>()
export const DRAWN_KEPT = 64
// The clipboard (register.tsx): the change count last seen (null: none
// yet; the first of each watcher child is only noted), whether the watcher
// found no PerlObjCBridge (`none`), a read that runs (`busy`) and a change
// that came during it (`again`), the clipboard text last seen (null: none
// could be read) and last written (so a write is never read back as new),
// the last text with placeholders with its row (`rawRow`, when known) and
// how it was read (for dump), and the order of the drawings (`seq`).
export const clip = {
  count: null as number | null,
  none: false,
  busy: false,
  again: false,
  seen: '' as string | null,
  wrote: '',
  raw: '',
  rawRow: undefined as string | undefined,
  seq: 0,
  last: null as unknown,
}

// The lean font sets (fonts.ts) by the fonts they are for (Typst, the
// terminal font and the theme's lists): the folder once made ('' while it
// is made, or when the lean set is not used for these fonts).
export const leanDirs = new Map<string, string>()

// Sets a cache entry as the newest; the oldest go past `max`.
export function keep<T>(cache: Map<string, T>, key: string, value: T, max: number) {
  cache.delete(key)
  cache.set(key, value)
  for (const old of cache.keys()) {
    if (cache.size <= max) break
    cache.delete(old)
  }
}

// Redraws every reader of `done`; an invalidate where the write is refused.
export function refresh($: EngineInterface) {
  void update($, done, n => n + 1).catch(() => invalidate($, 'ui.render'))
}
