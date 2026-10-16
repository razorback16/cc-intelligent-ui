// md-preview's state: the types the modules share, the values that change
// (`S`), the caches, and refresh (the `done` atom).
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { MdPreviewTheme } from '../../types'
import type { ThemeInfo } from './themes'
import type { HostMode, ThemeSetting } from './mode'
import type { PlanVerdict } from './plan'
import { DEFAULT_SIZE } from './settings'

// The `done` atom (see types/index.d.ts) for refresh. The state scan of
// `claude plugin validate` reads an atom only from a const in the file that
// reads or writes it, so each such file has a copy of its own (atom() is a
// plain description: the copies are one value).
const done = atom({ plugin: 'md-preview', key: 'done' } as const, 0)

export type Cell = { width: number; height: number }
// Per 1 em (render/measure.typ): `adv` the width of "0", `xh` the x-height,
// `avg` the mean advance over a lowercase pangram.
export type FontMetrics = { adv: number; xh: number; avg: number }
// `term` the terminal's font (null when unknown or not installed), `menlo`
// the template's code font, `body` its text font.
export type Metrics = { term: FontMetrics | null; menlo: FontMetrics; body: FontMetrics }
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
}
export type Page = { file: string; width: number; height: number; alt: string }
export type Result = { pages: Page[]; columns: number; bulletRow: number; note?: string }
export type Job = {
  key: string
  requestId: string
  text: string
  columns: number
  cell: Cell
  theme: MdPreviewTheme
  size: number
  themeDir: string
  env: Env
  // The folder relative images start from (a Markdown file's); else env.cwd.
  base?: string
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
  cell: null as Cell | null,
  theme: 'dark' as MdPreviewTheme,
  size: DEFAULT_SIZE,
  look: null as Look | null,
  // The usable themes the last scan found, for the typeahead.
  themeChoices: [] as ThemeInfo[],
  lastView: '',
  measureTimer: null as { cancel: () => void } | null,
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
  // Over ssh (set in setUp): the terminal's config and the OS appearance here
  // are the remote computer's, not those of the user's screen.
  isRemote: false,
  // iTerm2 with the engine's pictures off at start: /md-preview setup can help
  // (`setupNeeded`); the question is asked once per load (`setupAsked`).
  setupNeeded: false,
  setupAsked: false,
  watch: null as { cancel: () => void } | null,
  checking: false,
  // Streaming: model requests of the main loop in flight.
  stepsLive: 0,
  // The plan (plan.tsx): the main loop's running turn (`turn.start`), the
  // verdict md-preview's question gave for the PermissionRequest that follows
  // (null: none, the engine's dialog asks), the question asked now ('': none),
  // and the `code` command's path (null: not looked up yet; '': none).
  mainTurnId: '',
  planVerdict: null as PlanVerdict | null,
  planAsking: '',
  planCode: null as string | null,
}
export const results = new Map<string, Result | 'failed'>()
// Streaming: model requests of the main loop in flight (`S.stepsLive`), the
// blocks drawn blank while their text streams (with the job to compile once
// final), and the blocks a request made final (they stay final).
export const lastText = new Map<string, string>()
export const live = new Map<string, { job: Job; still: { cancel: () => void } }>()
export const finalized = new Set<string>()
// A final block not drawn yet: blank until `showText` (its deadline passed).
export const pending = new Map<string, { textHash: string; showText: boolean; timer: { cancel: () => void } }>()
export const queue: Job[] = []
export const running = new Set<string>()
// The last result drawn per message, so a width change keeps the old picture
// (scaled) until the new one is ready instead of falling back to text.
export const shown = new Map<string, { textHash: string; result: Result }>()
// Over ssh: each page file's PNG as base64 (null: too large to send), read
// once so a redraw does not read it again; the oldest go past INLINE_KEPT.
export const inlined = new Map<string, string | null>()
export const INLINE_KEPT = 64
// Pictures under rows: each file's PNG size by its stat stamp (null: not a
// PNG), and the pasted-images folder of each session once found.
export const pictures = new Map<string, { stamp: string; size: { width: number; height: number } | null }>()
export const pasteDirs = new Map<string, string>()
// SendUserFile: the PNG Typst made of each JPEG or WebP by its file, stat
// stamp and box (null: it failed), the ones Typst makes now (same keys), the
// last PNG made of each file (any box: it draws while a new box is made),
// and the text of each Markdown file by its stat stamp (null: it does not
// draw).
export const converted = new Map<string, string | null>()
export const converting = new Map<string, Promise<string | null>>()
export const lastConverted = new Map<string, { stamp: string; png: string }>()
export const sentTexts = new Map<string, { stamp: string; text: string | null }>()
// The plan: the text edited in md-preview's flow, by the call's tool_use_id
// (its rows draw it), and the ExitPlanMode calls of subagents (drawn as the
// engine draws them).
export const editedPlans = new Map<string, string>()
export const subagentPlans = new Set<string>()
// The main loop's Write and Edit calls still running, by file path (the plan
// waits for its file's).
export const writesLive = new Map<string, number>()

// Redraws every reader of `done`; an invalidate where the write is refused.
export function refresh($: EngineInterface) {
  void update($, done, n => n + 1).catch(() => $.ui.invalidate('ui.render'))
}
