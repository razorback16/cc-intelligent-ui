// Picture select's highlight (select.ts): each page stays one keyed Image
// whose layout never changes, and a selection swaps its picture with
// `$.ui.blit` (one small command to the terminal, the same image id). The
// frame is the page with the selected cells over the selection colour: in
// a selected cell each page pixel (straight alpha) over the opaque colour,
// elsewhere the page as it is. A clear swaps the page's own PNG back.
//
// The page is decoded once, in the background when it is drawn or comes on
// screen (pagecache.ts; png.ts: the hooks have no zlib), and kept in memory.
// Its rows are deflate pieces made once (plain, and tinted in the
// background or the first time a whole row is selected, TINT_MS of them a
// frame); a frame makes only the selection's first and last rows (partly
// selected) and joins the pieces: up to about 3 MB for a tall page. The
// hooks can write only text, so perl writes the frame (base64 on its
// stdin) to a file of its own, which the terminal reads.
import type { EngineInterface } from 'claude-code'

import { drawnAnswers, S } from './state'
import { toBase64 } from './png'
import { frameNow, selectColor } from './frames'
import { forgetPages, holdPages, keyOf, needFrames } from './pagecache'
import type { DrawnPage } from './copy'
import type { SelRow } from './select'
import { perlFor } from './host'
import { traceDebug } from './log'
import { clockNow, processRun, uiBlit, uiLog } from './api'

export { bandOf, edgesOf, frameOf, framesOf, over, rgbOf, selectColor, type Frames, type Rgb } from './frames'

// What a page shows, as a string: '' its own PNG, else the colour and rows.
export const sigOf = (rows: readonly SelRow[], color: string) => (rows.length ? `${color}|${rows.map(r => `${r.row}:${r.x0}-${r.x1}`).join(',')}` : '')

// ---- Throttle -------------------------------------------------------------------------

// The fold of the blits: a run (a frame made and blitted) at most at once
// and at most once a gap, so the posts between fold into one run that reads
// the newest selection. `last` is the last run's start.
export type Fold = { isRunning: boolean; isDirty: boolean; last: number }
export const foldNew = (): Fold => ({ isRunning: false, isDirty: false, last: -Infinity })

// A poke: `run` now, `wait` that long then run (the fold counts as running
// meanwhile), or `fold` into the run that goes on (one more run after it).
export function pokeFold(f: Fold, now: number, gapMs: number): { kind: 'run' } | { kind: 'wait'; ms: number } | { kind: 'fold' } {
  if (f.isRunning) {
    f.isDirty = true
    return { kind: 'fold' }
  }
  f.isRunning = true
  const ms = f.last + gapMs - now
  return ms > 0 ? { kind: 'wait', ms } : { kind: 'run' }
}

// A run starts (at `now`), and ends: whether a poke came while it ran.
export function startFold(f: Fold, now: number) {
  f.isRunning = true
  f.isDirty = false
  f.last = now
}
export function endFold(f: Fold): boolean {
  f.isRunning = false
  return f.isDirty
}

// ---- The blits -------------------------------------------------------------------------

// One blit frame a screen frame at most.
export const FRAME_MS = 16
// The frame files kept: the terminal reads each after its blit, at the
// engine's next frame; older ones go once they are this old.
const FILES_KEPT = 4
const FILE_KEEP_MS = 2000

// Writes stdin's base64 to the file (its folder made, a temporary name,
// then renamed), and deletes the older frames named after it.
export const WRITE_PL = 'use MIME::Base64; local $/; my $b = <STDIN>; my ($f, @old) = @ARGV; my ($d) = $f =~ m{^(.*)/}; mkdir($d, 0700) unless -d $d; open(my $o, ">:raw", "$f.tmp") or die "$!\\n"; print $o decode_base64($b); close($o) or die "$!\\n"; rename("$f.tmp", $f) or die "$!\\n"; unlink(@old)'

// Each drawing's site (the requestId its Images are drawn under) and its
// Images' key prefix, noted by drawPages; what each page shows now (sigOf,
// by `<id>#<page>`); the frame files written; the reasons logged; pages
// whose blit was refused (none until the next down); `noWriter`: perl
// could not start (no frame is tried again; the copy still works).
export const blits = {
  sites: new Map<string, { requestId: string; keys: string }>(),
  shown: new Map<string, string>(),
  files: [] as { path: string; at: number }[],
  logged: new Set<string>(),
  refused: new Set<string>(),
  seq: 0,
  dir: '',
  noWriter: false,
}

// A drawing's site, at each draw of its pages.
export function noteSite(id: string, requestId: string, keys: string) {
  const was = blits.sites.get(id)
  if (was?.requestId === requestId && was.keys === keys) return
  blits.sites.set(id, { requestId, keys })
  for (const k of [...blits.shown.keys()]) if (k.startsWith(`${id}#`)) blits.shown.delete(k)
}

// Forgets everything (for tests).
export function forgetBlits() {
  for (const m of [blits.sites, blits.shown, blits.logged, blits.refused]) m.clear()
  forgetPages()
  blits.files = []
  blits.seq = 0
  blits.dir = ''
  blits.noWriter = false
}

const ms = (t: number) => `${Math.round(t)}ms`

// Logs a reason once (the debug log, and the trace).
function logOnce($: EngineInterface, text: string) {
  traceDebug($, `select: ${text}`)
  if (blits.logged.has(text)) return
  blits.logged.add(text)
  void Promise.resolve(uiLog($, `Intelligent UI: picture select: ${text}`, { to: 'debug' })).catch(() => undefined)
}

// The newest frame file's name, and the old ones that can go.
function nextFile(cache: string, now: number): { path: string; old: string[] } {
  blits.dir ||= `${cache}/select-${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const path = `${blits.dir}/f-${++blits.seq}.png`
  const keep = blits.files.slice(-FILES_KEPT)
  const old = blits.files.filter(f => !keep.includes(f) && now - f.at >= FILE_KEEP_MS)
  blits.files = blits.files.filter(f => !old.includes(f))
  blits.files.push({ path, at: now })
  return { path, old: old.map(f => f.path) }
}

// Shows one page: its own PNG back, or a frame of `rows`. True when it
// should be shown again: a frame with rows drawn plain for now, or one
// dropped as its row was drawn again meanwhile.
async function showPage($: EngineInterface, id: string, i: number, page: DrawnPage, rows: readonly SelRow[], sig: string): Promise<boolean> {
  const k = `${id}#${i}`
  const site = blits.sites.get(id)
  const env = S.env
  if (!site || !env || (rows.length && blits.noWriter)) return false
  const key = `${site.keys}p${i}`
  const rowsText = rows.length ? `rows ${rows[0]!.row}..${rows[rows.length - 1]!.row} (${rows.length})` : 'plain'
  let source: { file: string; format: 'png' } = { file: page.file, format: 'png' }
  let timing = ''
  let isWhole = true
  if (rows.length) {
    const d = drawnAnswers.get(id)
    const got = await needFrames($, page, selectColor(S.theme), { id, index: i, seq: d?.seq ?? 0 })
    if (!got.frames) {
      blits.shown.set(k, sig)
      return false
    }
    const now = await clockNow($).catch(() => Date.now())
    const t1 = performance.now()
    const made = frameNow(got.frames, rows)
    const png = made.png
    isWhole = made.isWhole
    const t2 = performance.now()
    const { path, old } = nextFile(env.cache, now)
    const ran = await processRun($, [perlFor(env.isMac), '-e', WRITE_PL, path, ...old], { stdin: toBase64(png) }).catch(err => ({ exitCode: -1, stderr: String(err) }))
    const t3 = performance.now()
    if (ran.exitCode !== 0) {
      // No perl: no frame is tried again.
      if (ran.exitCode === -1 && /ENOENT|not found/i.test(ran.stderr)) blits.noWriter = true
      logOnce($, `the frame could not be written: ${ran.stderr.trim()}`)
      return false
    }
    // The row was drawn again meanwhile (a new page file, or a new site): this frame is of the old one.
    if (drawnAnswers.get(id)?.pages[i]?.file !== page.file || blits.sites.get(id) !== site) return true
    source = { file: path, format: 'png' }
    timing = `wait ${ms(got.waitMs)} frame ${ms(t2 - t1)}${isWhole ? '' : ' (part)'} write ${ms(t3 - t2)} ${png.length} bytes`
  }
  const t4 = performance.now()
  const res = await uiBlit($, { requestId: site.requestId, key, source }).catch(err => ({ deny: String(err) }))
  const blit = `blit ${ms(performance.now() - t4)}`
  if (res.deny) {
    blits.shown.delete(k)
    blits.refused.add(k)
    logOnce($, `the engine refused the highlight's blit (${res.deny})`)
    return false
  }
  // A part frame is not what the page is to show: the next run makes the rest.
  blits.shown.set(k, isWhole ? sig : `${sig}~`)
  traceDebug($, `select: blit ${id} page ${i} ${rowsText} ${timing ? `${timing} ` : ''}${blit}`)
  return !isWhole
}

// Brings every page to the selection now: the selected ones to their
// frames, the ones no longer selected back to their PNG. `selected` gives
// a drawing's pages and rows (or none). True when a page is to be shown
// again (showPage).
export async function showSelection($: EngineInterface, selected: { id: string; pages: readonly DrawnPage[]; rows: readonly (readonly SelRow[])[] } | null): Promise<boolean> {
  const color = selectColor(S.theme)
  holdPages(selected ? selected.pages.filter((_, i) => selected.rows[i]?.length).map(page => keyOf(page, color)) : [])
  const want = new Map<string, { id: string; i: number; page: DrawnPage; rows: readonly SelRow[] }>()
  if (selected) selected.pages.forEach((page, i) => want.set(`${selected.id}#${i}`, { id: selected.id, i, page, rows: selected.rows[i] ?? [] }))
  // Pages shown with a highlight before, of this drawing or another.
  for (const k of blits.shown.keys()) {
    if (want.has(k) || !blits.shown.get(k)) continue
    const [id, n] = [k.slice(0, k.lastIndexOf('#')), Number(k.slice(k.lastIndexOf('#') + 1))]
    const page = drawnAnswers.get(id)?.pages[n]
    if (page) want.set(k, { id, i: n, page, rows: [] })
    else blits.shown.delete(k)
  }
  let again = false
  for (const [k, w] of want) {
    // Its page file too: a row drawn again with a new file is shown again.
    const sig = w.rows.length ? `${sigOf(w.rows, color)}|${w.page.file}` : ''
    if ((blits.shown.get(k) ?? '') === sig || blits.refused.has(k)) continue
    if (await showPage($, w.id, w.i, w.page, w.rows, sig)) again = true
  }
  return again
}

