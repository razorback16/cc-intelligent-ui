import { expect, test } from 'claude-code/testing'

// The hooks module first, as the engine loads it (its modules import each other).
import '../hooks/register'
import {
  evictKeys, forgetPages, keyOf, needFrames, nextWant, notePages, pages, pagesOnScreen, PROMOTED_SLICE_MS, quantile, SLICE_MS, sliceOf, type Want,
} from '../hooks/lib/pagecache'
import { framesOf, frameOf, rgbOf } from '../hooks/lib/frames'
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

test('the pages kept fit their budget: the oldest off screen go first, then the oldest on screen; the page just built never', () => {
  const kept = [
    { key: 'a', bytes: 40, onScreen: true }, { key: 'b', bytes: 40, onScreen: false }, { key: 'c', bytes: 40, onScreen: true }, { key: 'd', bytes: 40, onScreen: false },
  ]
  expect(evictKeys(kept, 160, 'd')).toEqual([])
  expect(evictKeys(kept, 120, 'd')).toEqual(['b'])
  expect(evictKeys(kept, 80, 'd')).toEqual(['b', 'a'])
  expect(evictKeys(kept, 40, 'a')).toEqual(['b', 'd', 'c'])
  expect(evictKeys(kept, 0, 'c')).toEqual(['b', 'd', 'a'])
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
