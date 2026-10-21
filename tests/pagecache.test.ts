import { expect, test } from 'claude-code/testing'

// The hooks module first, as the engine loads it (its modules import each other).
import '../hooks/register'
import {
  bytesFor, evictKeys, forgetPages, holdPages, keyOf, needFrames, nextWant, notePages, pages, pagesOnScreen, PROMOTED_SLICE_MS, quantile, SLICE_MS, sliceOf, type Want,
} from '../hooks/lib/pagecache'
import { bytesOf, frameNow, framesOf, frameOf, rgbOf } from '../hooks/lib/frames'
import { chunk, concat, decodePng, deflatePiece, headOf, tailOf, toBase64 } from '../hooks/lib/png'
import type { Drawn, DrawnPage } from '../hooks/lib/copy'

const COLOR = '#264f78'

// ---- The queue -------------------------------------------------------------

const want = (key: string, o: Partial<Want> = {}): Want =>
  ({ key, page: { file: `/c/k/${key}.png`, width: 16, height: 16, columns: 2, rows: 2 }, color: COLOR, id: 'a', index: 0, seq: 1, onScreen: true, promoted: 0, ...o })

test("the next page: the last down's first, then the pages on screen, the newest drawing first, its pages in order", () => {
  const all = [
    want('old-0', { seq: 1, index: 0 }), want('new-1', { seq: 2, index: 1 }), want('new-0', { seq: 2, index: 0 }), want('off', { seq: 3, onScreen: false }),
  ]
  expect(nextWant(all)?.key).toBe('new-0')
  expect(nextWant(all.filter(w => !w.key.startsWith('new')))?.key).toBe('old-0')
  expect(nextWant([want('off', { seq: 3, onScreen: false })])?.key).toBe('off')
  // A down's page goes first, whatever its drawing; the last down before an older one.
  expect(nextWant([...all, want('down-1', { seq: 0, promoted: 1 })])?.key).toBe('down-1')
  expect(nextWant([...all, want('down-1', { promoted: 1 }), want('down-2', { promoted: 2 })])?.key).toBe('down-2')
  expect(nextWant([])).toBeUndefined()
})

test('the pages kept fit their budget: only the oldest off screen go; the ones on screen, the selection\'s and the page just built never', () => {
  const kept = [
    { key: 'a', bytes: 40, onScreen: true }, { key: 'b', bytes: 40, onScreen: false }, { key: 'c', bytes: 40, onScreen: true }, { key: 'd', bytes: 40, onScreen: false },
  ]
  expect(evictKeys(kept, 160, new Set(['d']))).toEqual([])
  expect(evictKeys(kept, 120, new Set(['d']))).toEqual(['b'])
  expect(evictKeys(kept, 80, new Set())).toEqual(['b', 'd'])
  // Over the budget with the pages on screen: they stay (no thrash).
  expect(evictKeys(kept, 80, new Set(['d']))).toEqual(['b'])
  expect(evictKeys(kept, 0, new Set(['b']))).toEqual(['d'])
})

test('the pages on screen: by the rows of the message on screen and the page tops; all when not known, none off screen', () => {
  const page = (rows: number): DrawnPage => ({ file: `/c/k/a-${rows}.png`, width: 1568, height: rows * 32, columns: 98, rows })
  const d: Drawn = { id: 'a', seq: 1, dir: '/c/k', pages: [page(16), page(16), page(4)], place: { top: 1, below: 0 } }
  expect(pagesOnScreen(d)).toEqual([0, 1, 2])
  expect(pagesOnScreen({ ...d, onScreen: null })).toEqual([])
  // Under a top margin of 1: page 0 is rows 1 to 16, page 1 rows 17 to 32, page 2 rows 33 to 36.
  expect(pagesOnScreen({ ...d, onScreen: { first: 0, last: 16, of: 37 } })).toEqual([0])
  expect(pagesOnScreen({ ...d, onScreen: { first: 16, last: 17, of: 37 } })).toEqual([0, 1])
  expect(pagesOnScreen({ ...d, onScreen: { first: 30, last: 36, of: 37 } })).toEqual([1, 2])
})

test("a slice: steps until its budget, never one that the last step's time says goes past it; one step at least", () => {
  let t = 0
  const now = () => t
  // Each step takes 1.5 ms.
  function* steps(n: number): Generator<string | undefined, string, void> {
    for (let i = 0; i < n; i++) {
      t += 1.5
      yield i === 1 ? 'ready' : undefined
    }
    return 'done'
  }
  const b = { stepMs: 0 }
  const seen: string[] = []
  const s = steps(5)
  // 1.5, then 3 (+ 1.5 would pass 4): two steps.
  expect(sliceOf(s, 4, b, v => seen.push(v), now)).toEqual({ ms: 3 })
  expect(seen).toEqual(['ready'])
  expect(b.stepMs).toBe(1.5)
  expect(sliceOf(s, 4, b, v => seen.push(v), now)).toEqual({ ms: 3 })
  // The fifth step, then the end.
  expect(sliceOf(s, 4, b, v => seen.push(v), now)).toEqual({ ms: 1.5, done: 'done' })
  // A step longer than the budget: one step a slice.
  const long = (function* (): Generator<undefined, string, void> {
    t += 9
    yield
    return 'end'
  })()
  expect(sliceOf(long, 4, b, () => {}, now)).toEqual({ ms: 9 })
  expect(sliceOf(long, 4, b, () => {}, now)).toEqual({ ms: 0, done: 'end' })
  expect([SLICE_MS, PROMOTED_SLICE_MS]).toEqual([4, 8])
  expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10)
  expect(quantile([1, 2, 3, 4], 0.5)).toBe(2)
})

// ---- The scheduler -----------------------------------------------------------

// A 1568 x 512 page (98 x 16 cells of 16 x 32), pixels of its number: a build of a few slices.
const pngOf = (n: number) => {
  const line = 1568 * 4 + 1
  const raw = new Uint8Array(512 * line)
  for (let y = 0; y < 512; y++) for (let x = 0; x < 1568; x++) if ((x + y + n) % 3 === 0) raw.set([n * 40, 210, 220, 255], y * line + 1 + x * 4)
  const piece = deflatePiece(raw, 4, line)
  return toBase64(concat([headOf(1568, 512), chunk('IDAT', piece.bytes), tailOf([piece])]))
}
const PNGS = [pngOf(0), pngOf(1), pngOf(2)]
const pageOf = (n: number): DrawnPage => ({ file: `/c/k${n}/a-1.png`, width: 1568, height: 512, columns: 98, rows: 16 })
const drawn = (id: string, seq: number, ns: number[], onScreen?: Drawn['onScreen']): Drawn => ({ id, seq, dir: `/c/${id}`, pages: ns.map(pageOf), place: { below: 0 }, onScreen })

// The hooks beneath: `$.clock.after` queues its callback (a slice), which
// `tick` runs with the promises after it; `$.fs.read` gives each page's PNG,
// noting the read and the pages built at that time.
function fake() {
  forgetPages()
  const timers: (() => void)[] = []
  const reads: { file: string; built: string[] }[] = []
  const $ = {
    clock: { after: (_ms: number, fn: () => void) => (timers.push(fn), { cancel() {} }) },
    fs: {
      read: async (path: string) => {
        reads.push({ file: path, built: [...pages.frames.keys()].map(k => k.split('|')[0]!) })
        return { base64: PNGS[Number(/k(\d)\//.exec(path)![1])]! }
      },
    },
    ui: { log: async () => undefined },
  } as any
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const tick = async () => {
    const fn = timers.shift()
    if (!fn) return false
    fn()
    await flush()
    return true
  }
  const drain = async () => {
    for (let n = 0; n < 100000 && (await tick()); n++);
  }
  return { $, timers, reads, tick, drain, flush }
}
const files = (reads: { file: string }[]) => reads.map(r => r.file)

test('the cache builds one page at a time, the pages on screen of the newest drawing first; each page is read once', async () => {
  const f = fake()
  notePages(f.$, drawn('old', 1, [0, 1]), COLOR)
  notePages(f.$, drawn('new', 2, [2]), COLOR)
  // One pump: one slice queued at a time.
  expect(f.timers.length).toBe(1)
  await f.drain()
  expect(files(f.reads)).toEqual([pageOf(2).file, pageOf(0).file, pageOf(1).file])
  // Each read began once the page before it was built.
  expect(f.reads.map(r => r.built)).toEqual([[], [pageOf(2).file], [pageOf(2).file, pageOf(0).file]])
  expect(pages.isPumping).toBe(false)
  expect(pages.wants.size).toBe(0)
  // Drawn again (or scrolled): nothing to build, nothing read.
  notePages(f.$, drawn('old', 1, [0, 1]), COLOR)
  await f.drain()
  expect(f.reads.length).toBe(3)
  // The frames are the ones made at once.
  const one = framesOf(decodePng(Uint8Array.from(atob(PNGS[0]!), c => c.charCodeAt(0))), pageOf(0), rgbOf(COLOR))
  const got = pages.frames.get(keyOf(pageOf(0), COLOR))!
  const rows = [{ row: 2, x0: 5, x1: 97 }, { row: 3, x0: 0, x1: 97 }, { row: 4, x0: 0, x1: 40 }]
  expect(toBase64(frameOf(got, rows))).toBe(toBase64(frameOf(one, rows)))
})

test('a down on a page not built: it goes first; the build it puts aside pauses, then goes on (its PNG read once)', async () => {
  const f = fake()
  notePages(f.$, drawn('a', 1, [0, 1]), COLOR)
  // The read of page 0, then one slice of its decode.
  await f.tick()
  await f.tick()
  expect(pages.build?.want.page.file).toBe(pageOf(0).file)
  expect(pages.build?.isReady).toBe(false)
  const order: string[] = []
  const got = needFrames(f.$, pageOf(1), COLOR, { id: 'a', index: 1, seq: 1 }).then(r => (order.push('page 1'), r))
  await f.flush()
  expect(pages.wants.get(keyOf(pageOf(0), COLOR))?.paused).toBeDefined()
  for (let n = 0; n < 100000 && !order.length && (await f.tick()); n++);
  expect(order).toEqual(['page 1'])
  expect((await got).frames?.img.width).toBe(1568)
  expect(pages.frames.has(keyOf(pageOf(0), COLOR))).toBe(false)
  await f.drain()
  expect(files(f.reads)).toEqual([pageOf(0).file, pageOf(1).file])
  expect(pages.frames.get(keyOf(pageOf(0), COLOR))?.plain.length).toBe(16)
  // Built now: a down waits for nothing.
  expect((await needFrames(f.$, pageOf(0), COLOR)).waitMs).toBe(0)
})

test('a page that leaves the screen leaves the queue and its build stops; a page a down asked for goes on', async () => {
  const f = fake()
  notePages(f.$, drawn('a', 1, [0, 1]), COLOR)
  await f.tick()
  await f.tick()
  expect(pages.build?.want.page.file).toBe(pageOf(0).file)
  notePages(f.$, drawn('a', 1, [0, 1], null), COLOR)
  await f.drain()
  expect(files(f.reads)).toEqual([pageOf(0).file])
  expect(pages.frames.size).toBe(0)
  expect(pages.isPumping).toBe(false)
  // Asked for by a down, then off screen: built all the same.
  const got = needFrames(f.$, pageOf(1), COLOR)
  notePages(f.$, drawn('a', 1, [0, 1], null), COLOR)
  await f.drain()
  expect((await got).frames?.plain.length).toBe(16)
  expect(files(f.reads)).toEqual([pageOf(0).file, pageOf(1).file])
  // Back on screen: page 0 is built from the start.
  notePages(f.$, drawn('a', 1, [0, 1]), COLOR)
  await f.drain()
  expect(files(f.reads)).toEqual([pageOf(0).file, pageOf(1).file, pageOf(0).file])
  expect(pages.frames.size).toBe(2)
})

test('a page that can not be read gets no frames, is not tried again, and a down on it waits for nothing', async () => {
  const f = fake()
  f.$.fs.read = async () => {
    throw new Error('ENOENT')
  }
  notePages(f.$, drawn('a', 1, [0]), COLOR)
  await f.drain()
  expect(pages.frames.get(keyOf(pageOf(0), COLOR))).toBeNull()
  notePages(f.$, drawn('a', 1, [0]), COLOR)
  await f.drain()
  expect(await needFrames(f.$, pageOf(0), COLOR)).toEqual({ frames: null, waitMs: 0 })
})

const key = (n: number) => keyOf(pageOf(n), COLOR)

test('a down on a page whose build was stopped (off screen) before its next slice takes the build up again: its frames come', async () => {
  const f = fake()
  notePages(f.$, drawn('a', 1, [0, 1], { first: 0, last: 15, of: 32 }), COLOR)
  await f.tick()
  await f.tick()
  expect(pages.build?.want.page.file).toBe(pageOf(0).file)
  // Scrolled: page 0 off screen, its build stopped but not dropped yet.
  notePages(f.$, drawn('a', 1, [0, 1], { first: 16, last: 31, of: 32 }), COLOR)
  expect(pages.build?.isCancelled).toBe(true)
  let got: { frames: unknown } | undefined
  void needFrames(f.$, pageOf(0), COLOR, { id: 'a', index: 0, seq: 1 }).then(r => (got = r))
  await f.drain()
  expect((got?.frames as { plain: unknown[] } | undefined)?.plain.length).toBe(16)
  expect(pages.waiters.size).toBe(0)
  expect(pages.isPumping).toBe(false)
  // Read once: the build went on.
  expect(files(f.reads).filter(r => r === pageOf(0).file).length).toBe(1)
})

test('a page stopped off screen and back on screen before its next slice goes on', async () => {
  const f = fake()
  notePages(f.$, drawn('a', 1, [0]), COLOR)
  await f.tick()
  notePages(f.$, drawn('a', 1, [0], null), COLOR)
  notePages(f.$, drawn('a', 1, [0]), COLOR)
  await f.drain()
  expect(pages.frames.get(key(0))?.plain.length).toBe(16)
  expect(f.reads.length).toBe(1)
})

test('pages on screen over the budget do not thrash: the background builds what fits, a down builds its page all the same', async () => {
  const f = fake()
  // One page fits, not two.
  pages.budget = Math.floor(bytesFor(pageOf(0)) * 1.5)
  const d = drawn('a', 1, [0, 1])
  notePages(f.$, d, COLOR)
  // Each render notes the pages again, as the row is drawn while the cache works.
  for (let n = 0; n < 3000; n++) {
    if (!(await f.tick())) {
      notePages(f.$, d, COLOR)
      if (!f.timers.length) break
      continue
    }
    if (n % 5 === 0) notePages(f.$, d, COLOR)
  }
  expect(files(f.reads)).toEqual([pageOf(0).file])
  expect([...pages.frames.keys()]).toEqual([key(0)])
  expect(pages.wants.has(key(1))).toBe(true)
  // A down on page 1: built over the budget (a soft limit); page 0, on screen, stays.
  const got = needFrames(f.$, pageOf(1), COLOR, { id: 'a', index: 1, seq: 1 })
  await f.drain()
  expect((await got).frames?.plain.length).toBe(16)
  expect(new Set(pages.frames.keys())).toEqual(new Set([key(0), key(1)]))
  // Page 0 off screen: it goes at the next build.
  notePages(f.$, drawn('a', 1, [0, 1, 2], { first: 17, last: 48, of: 49 }), COLOR)
  const two = needFrames(f.$, pageOf(2), COLOR, { id: 'a', index: 2, seq: 1 })
  await f.drain()
  expect((await two).frames).not.toBeNull()
  expect(pages.frames.has(key(0))).toBe(false)
  expect(f.reads.length).toBe(3)
})

test("the selection's page is never dropped, on screen or not", async () => {
  const f = fake()
  pages.budget = Math.floor(bytesFor(pageOf(0)) * 1.5)
  notePages(f.$, drawn('a', 1, [0]), COLOR)
  await f.drain()
  holdPages([key(0)])
  // Page 0 off screen, page 1 on screen: no room for it in the background.
  notePages(f.$, drawn('a', 1, [0, 1], { first: 17, last: 32, of: 33 }), COLOR)
  await f.drain()
  expect(f.reads.length).toBe(1)
  // A down on page 1: built, and page 0 (the selection's) stays.
  const one = needFrames(f.$, pageOf(1), COLOR, { id: 'a', index: 1, seq: 1 })
  await f.drain()
  expect((await one).frames).not.toBeNull()
  expect(new Set(pages.frames.keys())).toEqual(new Set([key(0), key(1)]))
  // Let go: the next build drops it.
  holdPages([])
  notePages(f.$, drawn('a', 1, [0, 1, 2], { first: 33, last: 48, of: 49 }), COLOR)
  const two = needFrames(f.$, pageOf(2), COLOR, { id: 'a', index: 2, seq: 1 })
  await f.drain()
  expect((await two).frames).not.toBeNull()
  expect(pages.frames.has(key(0))).toBe(false)
})

test('a drawing drawn again with new page files (a stream, a resize, a theme) drops its old keys: one page queued, the old builds stopped, who waits gets none', async () => {
  const f = fake()
  const page = (v: number) => ({ file: `/c/k${v % 3}/v${v}/a-1.png`, width: 1568, height: 512, columns: 98, rows: 16 })
  const draw = (v: number): Drawn => ({ id: 'a', seq: v + 1, dir: `/c/v${v}`, pages: [page(v)], place: { below: 0 } })
  notePages(f.$, draw(0), COLOR)
  await f.tick()
  await f.tick()
  expect(pages.build?.want.page.file).toBe(page(0).file)
  const old = needFrames(f.$, page(0), COLOR)
  for (let v = 1; v < 10; v++) notePages(f.$, draw(v), COLOR)
  expect([...pages.screen]).toEqual([keyOf(page(9), COLOR)])
  expect([...pages.wants.keys()]).toEqual([keyOf(page(9), COLOR)])
  expect(pages.build?.isCancelled).toBe(true)
  expect((await old).frames).toBeNull()
  await f.drain()
  expect(files(f.reads)).toEqual([page(0).file, page(9).file])
  expect([...pages.frames.keys()]).toEqual([keyOf(page(9), COLOR)])
  // A key another drawing still uses stays.
  notePages(f.$, { ...draw(9), id: 'b' }, COLOR)
  notePages(f.$, draw(10), COLOR)
  expect(pages.screen.has(keyOf(page(9), COLOR))).toBe(true)
})

test('a ready build a down puts aside is paused: its tinted rows are made in the background after the down', async () => {
  const f = fake()
  notePages(f.$, drawn('a', 1, [0, 1]), COLOR)
  // Until page 0 is ready, with its tinted rows still to make.
  for (let n = 0; n < 100000 && !(pages.frames.has(key(0)) && pages.build?.want.key === key(0)); n++) await f.tick()
  expect(pages.frames.get(key(0))!.tint.filter(Boolean).length).toBeLessThan(16)
  const one = needFrames(f.$, pageOf(1), COLOR, { id: 'a', index: 1, seq: 1 })
  expect(pages.wants.get(key(0))?.paused?.isReady).toBe(true)
  await f.drain()
  expect((await one).frames).not.toBeNull()
  expect(pages.frames.get(key(0))!.tint.filter(Boolean).length).toBe(16)
  expect(f.reads.length).toBe(2)
})

test("a frame makes tinted rows for its time at most (one at least), the rest drawn plain; the next frames make them, the same frame in the end", () => {
  const png = Uint8Array.from(atob(PNGS[0]!), c => c.charCodeAt(0))
  const f = framesOf(decodePng(png), pageOf(0), rgbOf(COLOR))
  const rows = Array.from({ length: 14 }, (_, i) => ({ row: i + 1, x0: 0, x1: 97 }))
  // A clock that moves 1 ms at each read: 3 ms make three rows.
  let t = 0
  const now = () => t++
  const first = frameNow(f, rows, 3, now)
  expect(first.isWhole).toBe(false)
  expect(f.tint.filter(Boolean).length).toBe(3)
  let n = 1
  for (let made = first; !made.isWhole; n++) made = frameNow(f, rows, 3, now)
  expect(n).toBe(5)
  expect(f.tint.filter(Boolean).length).toBe(14)
  const whole = framesOf(decodePng(png), pageOf(0), rgbOf(COLOR))
  expect(toBase64(frameNow(f, rows, 3, now).png)).toBe(toBase64(frameOf(whole, rows)))
  // A budget of 0 still makes one row.
  const g = framesOf(decodePng(png), pageOf(0), rgbOf(COLOR))
  expect(frameNow(g, rows, 0, now).isWhole).toBe(false)
  expect(g.tint.filter(Boolean).length).toBe(1)
  expect(bytesOf(g)).toBeGreaterThan(0)
})

test('a forget (select off) gives who waits no frames, stops the pump, and a new pump starts clean', async () => {
  const f = fake()
  notePages(f.$, drawn('a', 1, [0]), COLOR)
  await f.tick()
  const got = needFrames(f.$, pageOf(1), COLOR, { id: 'a', index: 1, seq: 1 })
  forgetPages()
  expect((await got).frames).toBeNull()
  await f.drain()
  expect(pages.frames.size).toBe(0)
  expect(pages.isPumping).toBe(false)
  notePages(f.$, drawn('a', 1, [1]), COLOR)
  expect(f.timers.length).toBe(1)
  await f.drain()
  expect(pages.frames.get(key(1))?.plain.length).toBe(16)
})
