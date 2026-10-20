import { expect, test } from 'claude-code/testing'

import {
  composeFrame, followWatcher, frameChange, frameFor, frameOfLine, lineSplitter, noteTty, noteView, pictureColumns, quietTimer, setFrame, shownFor,
  WATCH_RESTART_MS, WATCH_RESTARTS, watchFrame, watchLineOf, watchState, type Frame, type WatchLine,
} from '../hooks/lib/frame'
import { COMMIT_MIN_MS, DEFAULT_CELL, IMAGE_MAX_COLUMNS, RESIZE_QUIET_MS } from '../hooks/lib/settings'
import { INLINE_MAX_SIDE, isGhosttyHere } from '../hooks/lib/terminal'
import { perlFor, WATCH_PL } from '../hooks/lib/host'
// The module state the Frame reads and sets (this file's copy of the
// modules is the one imported above).
import { converting, queue, running, S } from '../hooks/lib/state'

const frame = (columns: number, rows: number, width = 16, height = 32): Frame => ({ columns, rows, cell: { width, height } })

test('the same frame is no change', () => {
  expect(frameChange(frame(100, 40), frame(100, 40))).toBe('none')
})

test('the first read and a new cell are a cell change, also with the same columns', () => {
  expect(frameChange(null, frame(100, 40))).toBe('cell')
  expect(frameChange(frame(100, 40), frame(100, 40, 18, 36))).toBe('cell')
  expect(frameChange(frame(100, 40), frame(100, 40, 16, 34))).toBe('cell')
  // The cell goes first when the columns change too (a font size change).
  expect(frameChange(frame(100, 40), frame(90, 36, 18, 36))).toBe('cell')
})

test('columns go before rows; rows only is a rows change', () => {
  expect(frameChange(frame(100, 40), frame(120, 40))).toBe('columns')
  expect(frameChange(frame(100, 40), frame(120, 50))).toBe('columns')
  expect(frameChange(frame(100, 40), frame(100, 50))).toBe('rows')
})

// ---- One watcher line ---------------------------------------------------------

test('a tty size is rows, columns and the cell in device pixels', () => {
  expect(frameOfLine('50 120 2040 1700')).toEqual(frame(120, 50, 17, 34))
  expect(frameOfLine('40 200 3200 1360\n')).toEqual(frame(200, 40, 16, 34))
})

test('a line with no pixels (tmux, a relay) is no Frame', () => {
  expect(frameOfLine('50 200 0 0')).toBe(null)
  expect(frameOfLine('0 0 0 0')).toBe(null)
})

test('an absurd or broken line is no Frame', () => {
  // A cell under 4 or over 64 px wide.
  expect(frameOfLine('50 200 600 1700')).toBe(null)
  expect(frameOfLine('50 20 1700 1700')).toBe(null)
  expect(frameOfLine('')).toBe(null)
  expect(frameOfLine('50 120 2040')).toBe(null)
  expect(frameOfLine('50 120 2040 1700 9')).toBe(null)
  expect(frameOfLine('50 120 20x0 1700')).toBe(null)
  expect(frameOfLine('-50 120 2040 1700')).toBe(null)
})

test('a watcher line is its PID, a size, a clipboard change count or clip none; any other line is none', () => {
  expect(watchLineOf('pid 4242')).toEqual({ pid: '4242' })
  expect(watchLineOf('size 50 120 2040 1700')).toEqual({ size: frame(120, 50, 17, 34) })
  // A bad size is a size line with no Frame (noteTty drops it).
  expect(watchLineOf('size 50 200 0 0')).toEqual({ size: null })
  expect(watchLineOf('clip 1394')).toEqual({ clip: 1394 })
  expect(watchLineOf('clip none\r')).toEqual({ clip: null })
  expect(watchLineOf('clip -1')).toBe(null)
  expect(watchLineOf('clip')).toBe(null)
  expect(watchLineOf('pid x')).toBe(null)
  // The bare size of one tty read (CELL_SH) is not a watcher line.
  expect(watchLineOf('50 120 2040 1700')).toBe(null)
  expect(watchLineOf('')).toBe(null)
})

// ---- Pieces to lines ----------------------------------------------------------

test('pieces join into lines across their borders', () => {
  const split = lineSplitter()
  expect(split('50 12')).toEqual([])
  expect(split('0 2040 1700\n40 2')).toEqual(['50 120 2040 1700'])
  expect(split('00 3200 1360\n')).toEqual(['40 200 3200 1360'])
  expect(split('1 2 3 4\n5 6 7 8\n')).toEqual(['1 2 3 4', '5 6 7 8'])
  expect(split('9 9 9 9\r\n')).toEqual(['9 9 9 9'])
})

const pieces = (texts: Array<{ stream?: 'stdout' | 'stderr'; text: string }>, code: number | null) =>
  (async function* () {
    for (const p of texts) yield { stream: p.stream ?? ('stdout' as const), text: p.text }
    return { code, signal: null }
  })()

test('the watcher lines are read across pieces; stderr and other lines are dropped', async () => {
  const seen: WatchLine[] = []
  const text = [{ text: 'pid 7\nsize 50 120 20' }, { text: '40 1700\nclip 3' }, { stream: 'stderr' as const, text: 'size 1 1 1 1\n' }, { text: '\njunk\nsize 40 200 3200 1360\nclip none\n' }]
  const ended = await followWatcher(pieces(text, 0), line => seen.push(line))
  expect(seen).toEqual([{ pid: '7' }, { size: frame(120, 50, 17, 34) }, { clip: 3 }, { size: frame(200, 40, 16, 34) }, { clip: null }])
  expect(ended).toBe('failed')
})

test('a watcher that exits 1 has no tty; one that can not start failed', async () => {
  expect(await followWatcher(pieces([], 1), () => undefined)).toBe('no tty')
  const broken = (async function* (): AsyncGenerator<{ stream: 'stdout'; text: string }, { code: number }> {
    throw new Error('ENOENT')
  })()
  expect(await followWatcher(broken, () => undefined)).toBe('failed')
})

// ---- The watcher -----------------------------------------------------------------

test('WATCH_PL sleeps in sigsuspend with SIGWINCH and SIGALRM blocked outside it: no select, no sleep', () => {
  expect(WATCH_PL).toContain('POSIX::sigsuspend(')
  expect(WATCH_PL).toContain('POSIX::sigprocmask(POSIX::SIG_BLOCK(), POSIX::SigSet->new($n{WINCH}, $n{ALRM}))')
  // With no clipboard part, the alarm only finds a dead parent; with it, a
  // 300 ms alarm reads the change count (the same sigsuspend: a SIGWINCH
  // that comes meanwhile is kept).
  expect(WATCH_PL).toContain('alarm(10)')
  expect(WATCH_PL).toContain('Time::HiRes::ualarm(300000)')
  expect(WATCH_PL).toContain('exit 0 if getppid() != $parent')
  expect(WATCH_PL).not.toContain('select')
  expect(WATCH_PL).not.toContain('sleep')
})

test('WATCH_PL loads the bridge in an eval only with the clip argument alone, and says clip none when it fails', () => {
  expect(WATCH_PL).toContain('} elsif (($ARGV[0] // "") eq "clip") {')
  expect(WATCH_PL).toContain('$pb = eval { require Foundation; Foundation->import;')
  expect(WATCH_PL).toContain('@NSPasteboard::ISA = ("PerlObjCBridge")')
  expect(WATCH_PL).toContain('print "clip none\\n" or exit 0 unless $pb;')
  expect(WATCH_PL).toContain('print "clip $c\\n"')
  expect(WATCH_PL).toContain('print "size $line\\n"')
  expect(WATCH_PL).toContain('print "pid $$\\n"')
  // No tty and no clipboard part: exit 1.
  expect(WATCH_PL).toContain('exit 1 unless $tty || $pb || $relay;')
  expect(perlFor(true)).toBe('/usr/bin/perl')
  expect(perlFor(false)).toBe('perl')
})

test('WATCH_PL with clip and a command (Linux): a child in its own group relays the lines, and the group stops with the watcher', () => {
  expect(WATCH_PL).toContain('if (($ARGV[0] // "") eq "clip" && @ARGV > 1) {')
  expect(WATCH_PL).toContain('setpgrp(0, 0)')
  expect(WATCH_PL).toContain('open($c, "-|", @ARGV[1 .. $#ARGV])')
  expect(WATCH_PL).toContain('print "clip $k\\n" or last; $k++;')
  expect(WATCH_PL).toContain('print "clip none\\n"; kill "TERM", -$$; POSIX::_exit(0);')
  expect(WATCH_PL).toContain('setpgrp($relay, $relay); $SIG{TERM} = sub { exit 0 };')
  expect(WATCH_PL).toContain('END { kill "TERM", -$relay if $relay; }')
})

// ---- The quiet timer ----------------------------------------------------------------

// A timer in memory: `advance` runs each wait that comes due, in order.
function fakeClock() {
  let now = 0
  let waits: Array<{ due: number; fn: () => void; live: boolean }> = []
  return {
    after: (ms: number, fn: () => void) => {
      const wait = { due: now + ms, fn, live: true }
      waits.push(wait)
      return { cancel: () => void (wait.live = false) }
    },
    advance: async (ms: number) => {
      const end = now + ms
      for (;;) {
        const next = waits.filter(w => w.live && w.due <= end).sort((a, b) => a.due - b.due)[0]
        if (!next) break
        now = next.due
        next.live = false
        next.fn()
        await flush()
      }
      now = end
      waits = waits.filter(w => w.live)
      await flush()
    },
  }
}
// Lets the promises started settle.
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

function quiet() {
  const clock = fakeClock()
  const seen: string[] = []
  const stales: Array<() => boolean> = []
  const poke = quietTimer({
    ms: 450,
    after: clock.after,
    onStart: () => seen.push('start'),
    onQuiet: stale => {
      seen.push('quiet')
      stales.push(stale)
    },
  })
  return { clock, poke, seen, stales }
}

test('a drag gives one start and one quiet, 450 ms after its last input', async () => {
  const q = quiet()
  for (let i = 0; i < 10; i++) {
    q.poke()
    await q.clock.advance(100)
  }
  expect(q.seen).toEqual(['start'])
  await q.clock.advance(349)
  expect(q.seen).toEqual(['start'])
  await q.clock.advance(1)
  expect(q.seen).toEqual(['start', 'quiet'])
  // A new burst starts again.
  q.poke()
  await q.clock.advance(450)
  expect(q.seen).toEqual(['start', 'quiet', 'start', 'quiet'])
})

test('a quiet is stale once a newer input came', async () => {
  const q = quiet()
  q.poke()
  await q.clock.advance(450)
  expect(q.stales[0]!()).toBe(false)
  q.poke()
  expect(q.stales[0]!()).toBe(true)
  expect(q.seen).toEqual(['start', 'quiet', 'start'])
})

// ---- Composing the Frame --------------------------------------------------------------

test('the Frame is the tty\'s, at most the viewport wide; its rows are the tty\'s', () => {
  expect(composeFrame(frame(200, 50, 17, 34), { columns: 150, rows: 40 })).toEqual(frame(150, 50, 17, 34))
  expect(composeFrame(frame(200, 50, 17, 34), { columns: 300, rows: 60 })).toEqual(frame(200, 50, 17, 34))
  expect(composeFrame(frame(200, 50, 17, 34), null)).toEqual(frame(200, 50, 17, 34))
})

test('with no tty, the Frame is the viewport (else 80 x 48) and DEFAULT_CELL', () => {
  expect(composeFrame(null, { columns: 120, rows: 30 })).toEqual({ columns: 120, rows: 30, cell: DEFAULT_CELL })
  expect(composeFrame(null, null)).toEqual({ columns: 80, rows: 48, cell: DEFAULT_CELL })
})

test('the Frame for a drawing is the target; a picture drawn now sizes from the Frame on screen', () => {
  const was = { frame: S.frame, shown: S.shown }
  try {
    S.frame = frame(200, 50, 17, 34)
    S.shown = frame(160, 50, 17, 34)
    expect(frameFor({ columns: 150, rows: 40 })).toEqual(frame(200, 50, 17, 34))
    expect(frameFor()).toEqual(frame(200, 50, 17, 34))
    expect(shownFor({ columns: 150, rows: 40 })).toEqual(frame(160, 50, 17, 34))
    // Nothing on screen yet: the target.
    S.shown = null
    expect(shownFor()).toEqual(frame(200, 50, 17, 34))
    // No Frame at all: the viewport.
    S.frame = null
    expect(frameFor({ columns: 120, rows: 30 })).toEqual({ columns: 120, rows: 30, cell: DEFAULT_CELL })
    expect(shownFor()).toEqual({ columns: 80, rows: 48, cell: DEFAULT_CELL })
  } finally {
    S.frame = was.frame
    S.shown = was.shown
  }
})

test('a picture takes the Frame\'s columns less the gutter, capped by the width setting and, over ssh, by the cell', () => {
  const was = S.width
  try {
    S.width = 'full'
    expect(pictureColumns(frame(120, 40), false)).toBe(118)
    // Over ssh a { png } source is INLINE_MAX_SIDE px wide at most.
    expect(pictureColumns(frame(400, 40), true)).toBe(Math.min(IMAGE_MAX_COLUMNS, Math.floor(INLINE_MAX_SIDE / 16)))
    S.width = 60
    expect(pictureColumns(frame(120, 40), false)).toBe(60)
  } finally {
    S.width = was
  }
})

// ---- Settling a burst ------------------------------------------------------------------

// One `$` for the settle tests (the quiet timer keeps the first one): a
// clock in memory, a tty read the test sets (and may hold), and the redraws.
const clock = fakeClock()
const tty = { line: '50 200 3400 1700', reads: 0, gate: null as Promise<void> | null, refreshes: 0 }
// The watchers started: each one's argv, `say` (a line it prints) and
// `end` (its exit); the PIDs killed.
type Child = { argv: string[]; say: (line: string) => void; end: (code: number) => void }
const children: Child[] = []
const kills: string[] = []
function spawn({ argv }: { argv: string[] }) {
  const lines: string[] = []
  let code: number | null = null
  let wake = () => {}
  children.push({ argv, say: line => (lines.push(line), wake()), end: c => ((code = c), wake()) })
  return (async function* () {
    for (;;) {
      while (lines.length) yield { stream: 'stdout' as const, text: `${lines.shift()}\n` }
      if (code !== null) return { code, signal: null }
      await new Promise<void>(r => (wake = r))
    }
  })()
}
const $ = {
  clock: { after: clock.after },
  process: {
    spawn,
    run: async (argv: string[]) => {
      if (argv[0] === 'kill') {
        kills.push(argv[1]!)
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      tty.reads++
      if (tty.gate) await tty.gate
      return { exitCode: 0, stdout: tty.line, stderr: '' }
    },
  },
  ui: { invalidate: () => void tty.refreshes++ },
} as any

// A load with this tty read at setUp (no epoch open, nothing held).
async function loaded(line: string | null) {
  await clock.advance(10000)
  S.shownEpoch = S.epoch
  S.frame = S.shown = S.tty = null
  S.viewColumns = S.viewRows = null
  S.resizing = S.missed = false
  queue.length = 0
  running.clear()
  converting.clear()
  if (line) tty.line = line
  setFrame(line ? frameOfLine(line) : null)
  tty.reads = 0
  tty.refreshes = 0
}

test('setUp\'s read is the target and the Frame on screen; the first viewport applies at once', async () => {
  await loaded('50 200 3400 1700')
  expect(S.frame).toEqual(frame(200, 50, 17, 34))
  expect(S.shown).toEqual(frame(200, 50, 17, 34))
  noteView($, { columns: 150, rows: 50 })
  expect(S.frame).toEqual(frame(150, 50, 17, 34))
  expect(S.shown).toEqual(frame(150, 50, 17, 34))
  expect(S.resizing).toBe(false)
  // The watcher's first line is the value known: no burst.
  noteTty($, frameOfLine('50 200 3400 1700'))
  expect(S.resizing).toBe(false)
  await clock.advance(1000)
  expect(tty.reads).toBe(0)
})

test('a drag holds the jobs, then one read sets the target; the pictures follow at the commit', async () => {
  await loaded('50 200 3400 1700')
  noteView($, { columns: 200, rows: 50 })
  const epoch = S.epoch
  for (let c = 190; c >= 120; c -= 10) {
    if (c < 190) await clock.advance(100)
    noteTty($, frameOfLine(`50 ${c} ${c * 17} 1700`))
    expect(S.resizing).toBe(true)
  }
  expect(tty.reads).toBe(0)
  expect(S.frame).toEqual(frame(200, 50, 17, 34))
  // The tty read at quiet wins over the last line.
  tty.line = '50 118 2006 1700'
  await clock.advance(RESIZE_QUIET_MS)
  expect(tty.reads).toBe(1)
  expect(S.resizing).toBe(false)
  expect(S.epoch).toBe(epoch + 1)
  expect(S.frame).toEqual(frame(118, 50, 17, 34))
  expect(S.shown).toEqual(frame(200, 50, 17, 34))
  await clock.advance(COMMIT_MIN_MS)
  expect(S.shown).toEqual(frame(118, 50, 17, 34))
})

test('a burst that ends at the same Frame begins no epoch and lets the jobs go on', async () => {
  await loaded('50 200 3400 1700')
  noteView($, { columns: 200, rows: 50 })
  const epoch = S.epoch
  noteTty($, frameOfLine('50 180 3060 1700'))
  noteTty($, frameOfLine('50 200 3400 1700'))
  expect(S.resizing).toBe(true)
  await clock.advance(RESIZE_QUIET_MS)
  expect(tty.reads).toBe(1)
  expect(S.resizing).toBe(false)
  expect(S.epoch).toBe(epoch)
})

test('a narrower viewport settles like a tty line; viewport rows alone do not count with a tty', async () => {
  await loaded('50 200 3400 1700')
  noteView($, { columns: 200, rows: 50 })
  const epoch = S.epoch
  noteView($, { columns: 200, rows: 30 })
  expect(S.resizing).toBe(false)
  noteView($, { columns: 160, rows: 30 })
  expect(S.resizing).toBe(true)
  expect(S.frame).toEqual(frame(200, 50, 17, 34))
  await clock.advance(RESIZE_QUIET_MS)
  expect(S.epoch).toBe(epoch + 1)
  expect(S.frame).toEqual(frame(160, 50, 17, 34))
})

test('with no tty, the viewport is the Frame and a change settles with no read', async () => {
  await loaded(null)
  noteView($, { columns: 120, rows: 30 })
  expect(S.frame).toEqual({ columns: 120, rows: 30, cell: DEFAULT_CELL })
  const epoch = S.epoch
  noteView($, { columns: 120, rows: 40 })
  expect(S.resizing).toBe(true)
  await clock.advance(RESIZE_QUIET_MS)
  expect(tty.reads).toBe(0)
  expect(S.epoch).toBe(epoch + 1)
  expect(S.frame).toEqual({ columns: 120, rows: 40, cell: DEFAULT_CELL })
})

test('an input during the quiet read stops that settle: the newer quiet settles once', async () => {
  await loaded('50 200 3400 1700')
  noteView($, { columns: 200, rows: 50 })
  const epoch = S.epoch
  let open = () => {}
  tty.gate = new Promise<void>(r => (open = r))
  tty.line = '50 150 2550 1700'
  noteTty($, frameOfLine('50 150 2550 1700'))
  await clock.advance(RESIZE_QUIET_MS)
  expect(tty.reads).toBe(1)
  noteTty($, frameOfLine('50 140 2380 1700'))
  tty.gate = null
  tty.line = '50 140 2380 1700'
  open()
  await flush()
  expect(S.epoch).toBe(epoch)
  expect(S.resizing).toBe(true)
  await clock.advance(RESIZE_QUIET_MS)
  expect(tty.reads).toBe(2)
  expect(S.epoch).toBe(epoch + 1)
  expect(S.frame).toEqual(frame(140, 50, 17, 34))
})

// ---- The watcher's restarts ---------------------------------------------------

test('with no watcher, the clipboard part off starts none', () => {
  watchFrame($, null)
  expect(children.length).toBe(0)
  expect(watchState()).toBe(null)
})

test('the clipboard part starts the watcher again with clip; the old one is killed and its lines dropped; the size again begins no epoch', async () => {
  await loaded('50 200 3400 1700')
  noteView($, { columns: 200, rows: 50 })
  const epoch = S.epoch
  watchFrame($)
  const first = children[0]!
  expect(first.argv).toEqual(['perl', '-e', WATCH_PL])
  first.say('pid 101')
  first.say('size 50 200 3400 1700')
  await flush()
  expect(watchState()).toEqual({ clip: false, ended: false })
  // On: a new child with the argument, and a kill of the first.
  const counts: Array<number | null> = []
  watchFrame($, n => counts.push(n))
  const second = children[1]!
  expect(second.argv).toEqual(['perl', '-e', WATCH_PL, 'clip'])
  await flush()
  expect(kills).toEqual(['101'])
  first.say('size 50 150 2550 1700')
  second.say('pid 102')
  second.say('size 50 200 3400 1700')
  second.say('clip 7')
  await flush()
  // The size known: no burst, no read, no epoch.
  expect(S.resizing).toBe(false)
  await clock.advance(RESIZE_QUIET_MS * 2)
  expect(tty.reads).toBe(0)
  expect(S.epoch).toBe(epoch)
  expect(S.frame).toEqual(frame(200, 50, 17, 34))
  expect(counts).toEqual([7])
  expect(watchState()).toEqual({ clip: true, ended: false })
  // The same part again, and setUp's start: no new child.
  watchFrame($, n => counts.push(n))
  watchFrame($)
  expect(children.length).toBe(2)
  second.say('clip 8')
  second.say('clip none')
  await flush()
  expect(counts).toEqual([7, 8, null])
  // Off: a child with no argument; the one before is killed.
  watchFrame($, null)
  expect(children[2]!.argv).toEqual(['perl', '-e', WATCH_PL])
  await flush()
  expect(kills).toEqual(['101', '102'])
  // A child stopped before its PID came is killed when it comes.
  watchFrame($, n => counts.push(n))
  children[2]!.say('pid 103')
  await flush()
  expect(kills).toEqual(['101', '102', '103'])
  // A size change from the child now goes on as before.
  const fourth = children[3]!
  fourth.say('pid 104')
  tty.line = '50 150 2550 1700'
  fourth.say('size 50 150 2550 1700')
  await flush()
  expect(S.resizing).toBe(true)
  await clock.advance(RESIZE_QUIET_MS)
  expect(S.epoch).toBe(epoch + 1)
  // A child that ends is noted (details says the copy is off).
  fourth.end(0)
  await flush()
  expect(watchState()).toEqual({ clip: true, ended: true })
})

test('a clip child that ends on its own starts again after WATCH_RESTART_MS, WATCH_RESTARTS times at most', async () => {
  // The last child of the test before ended on its own.
  const before = children.length
  await clock.advance(WATCH_RESTART_MS - 1)
  expect(children.length).toBe(before)
  await clock.advance(1)
  expect(children.length).toBe(before + 1)
  expect(children.at(-1)!.argv).toEqual(['perl', '-e', WATCH_PL, 'clip'])
  expect(watchState()).toEqual({ clip: true, ended: false })
  for (let i = 1; i < WATCH_RESTARTS; i++) {
    children.at(-1)!.end(0)
    await flush()
    await clock.advance(WATCH_RESTART_MS)
  }
  expect(children.length).toBe(before + WATCH_RESTARTS)
  // The cap: the next end starts none, and neither does a call that wants one.
  children.at(-1)!.end(0)
  await flush()
  await clock.advance(WATCH_RESTART_MS * 5)
  watchFrame($)
  expect(children.length).toBe(before + WATCH_RESTARTS)
  expect(watchState()).toEqual({ clip: true, ended: true })
})

test('Ghostty is told by TERM_PROGRAM or TERM, and cmux (its engine) counts too', () => {
  const was = { program: S.termProgram, name: S.termName, cmux: S.isCmux }
  try {
    S.isCmux = false
    S.termProgram = 'ghostty'
    S.termName = 'xterm-256color'
    expect(isGhosttyHere()).toBe(true)
    S.termProgram = ''
    S.termName = 'xterm-ghostty'
    expect(isGhosttyHere()).toBe(true)
    S.termName = 'xterm-kitty'
    expect(isGhosttyHere()).toBe(false)
    S.isCmux = true
    expect(isGhosttyHere()).toBe(true)
  } finally {
    S.termProgram = was.program
    S.termName = was.name
    S.isCmux = was.cmux
  }
})
