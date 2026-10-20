import { expect, test } from 'claude-code/testing'

import { designKey, designPath, designText, hashOf, loadDesign, parseDesign, recordDesign } from '../hooks/register'
import { DESIGNS_IN_MEMORY, designInMemory, forgetDesigns, noteDesign } from '../hooks/lib/designs'
import { forgetTouches, TOUCH_BATCH } from '../hooks/lib/typst'
import { TOUCH_FLUSH_MS } from '../hooks/lib/settings'

test('a design key comes from the text hash and the images folder', () => {
  const textHash = hashOf(['# A diagram'])
  expect(designKey(textHash)).toBe(hashOf(['design', textHash, '']))
  expect(designKey(textHash, '/docs')).toBe(hashOf(['design', textHash, '/docs']))
  expect(designKey(textHash)).toBe(designKey(textHash, ''))
  expect(designKey(textHash, '/docs') === designKey(textHash)).toBe(false)
  expect(designKey(textHash)).toMatch(/^[0-9a-f]{16}$/)
})

test('a design file is in a folder of its first 2 hex digits', () => {
  expect(designPath('/cache/designs', '0a1b2c3d4e5f6071')).toBe('/cache/designs/0a/0a1b2c3d4e5f6071')
})

test('a design is the text "W0 H0" in pt', () => {
  expect(designText({ widthPt: 512.5, heightPt: 300 })).toBe('512.5 300')
  expect(parseDesign('512.5 300')).toEqual({ widthPt: 512.5, heightPt: 300 })
  expect(parseDesign('  512.5\t300\n')).toEqual({ widthPt: 512.5, heightPt: 300 })
  const d = { widthPt: 1 / 3, heightPt: 123.456789 }
  expect(parseDesign(designText(d))).toEqual(d)
})

test('a bad or empty design file is missing', () => {
  for (const text of ['', '512', '512 300 1', 'a b', '0 300', '512 -1', 'NaN 300', 'Infinity 300', '512 300x']) {
    expect(parseDesign(text)).toBe(null)
  }
})

// ---- Host functions ---------------------------------------------------------

// A fake engine with an in-memory fs: the files, and what the host did.
// Its clock runs a timer only at `advance` (by the time asked of it).
function disk(files: Record<string, string>, failWrite = false) {
  forgetTouches()
  forgetDesigns()
  const seen = { reads: [] as string[], writes: [] as string[], touches: [] as string[], runs: [] as string[][] }
  let timers: Array<{ ms: number; fn: () => void; isOff: boolean }> = []
  const advance = (ms: number) => {
    const due = timers.filter(t => !t.isOff && t.ms <= ms)
    timers = timers.filter(t => !due.includes(t))
    for (const t of due) t.fn()
  }
  const $ = {
    clock: {
      after: (ms: number, fn: () => void) => {
        const t = { ms, fn, isOff: false }
        timers.push(t)
        return { cancel: () => (t.isOff = true) }
      },
    },
    fs: {
      read: async (path: string) => {
        seen.reads.push(path)
        if (!(path in files)) throw new Error('ENOENT')
        return files[path]
      },
      exists: async (path: string) => path in files,
      write: async (path: string, text: string) => {
        if (failWrite) throw new Error('EACCES')
        seen.writes.push(path)
        files[path] = text
      },
    },
    process: {
      run: async (argv: string[]) => {
        seen.runs.push(argv)
        if (argv[0] === 'touch' && argv[1] === '-c') seen.touches.push(...argv.slice(2))
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as any
  return { $, seen, advance }
}

test('a missing design is null, and the miss is read once', async () => {
  const { $, seen } = disk({})
  expect(await loadDesign($, '/d', 'aa00000000000001')).toBe(null)
  expect(await loadDesign($, '/d', 'aa00000000000001')).toBe(null)
  expect(seen.reads).toEqual(['/d/aa/aa00000000000001'])
  expect(seen.touches).toEqual([])
})

test('a design file loads once, then comes from memory, and is touched later in one batch', async () => {
  const path = designPath('/d', 'bb00000000000002')
  const other = designPath('/d', 'bb00000000000003')
  const { $, seen, advance } = disk({ [path]: '500 300', [other]: '400 200' })
  expect(await loadDesign($, '/d', 'bb00000000000002')).toEqual({ widthPt: 500, heightPt: 300 })
  expect(await loadDesign($, '/d', 'bb00000000000002')).toEqual({ widthPt: 500, heightPt: 300 })
  expect(await loadDesign($, '/d', 'bb00000000000003')).toEqual({ widthPt: 400, heightPt: 200 })
  expect(seen.reads.length).toBe(2)
  // No process while it loads (a render path): one touch after TOUCH_FLUSH_MS.
  expect(seen.runs).toEqual([])
  advance(TOUCH_FLUSH_MS)
  expect(seen.runs).toEqual([['touch', '-c', path, other]])
})

test('touches go at most TOUCH_BATCH paths a run, the rest at the next run', async () => {
  const files = Object.fromEntries(Array.from({ length: TOUCH_BATCH + 5 }, (_, i) => [designPath('/d', `ab${String(i).padStart(14, '0')}`), '1 1']))
  const { $, seen, advance } = disk(files)
  for (const path of Object.keys(files)) await loadDesign($, '/d', path.slice(-16))
  advance(TOUCH_FLUSH_MS)
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0]!.length).toBe(2 + TOUCH_BATCH)
  advance(TOUCH_FLUSH_MS)
  expect(seen.runs.length).toBe(2)
  expect(seen.touches.sort()).toEqual(Object.keys(files).sort())
})

test('a bad design text is missing', async () => {
  const { $ } = disk({ [designPath('/d', 'cc00000000000003')]: 'junk' })
  expect(await loadDesign($, '/d', 'cc00000000000003')).toBe(null)
})

test('record writes a design once', async () => {
  const { $, seen } = disk({})
  const d = { widthPt: 400, heightPt: 250 }
  await recordDesign($, '/d', 'dd00000000000004', d)
  await recordDesign($, '/d', 'dd00000000000004', { widthPt: 1, heightPt: 1 })
  expect(seen.writes).toEqual(['/d/dd/dd00000000000004'])
})

test('record does not overwrite an existing file', async () => {
  const path = designPath('/d', 'ee00000000000005')
  const { $, seen } = disk({ [path]: '500 300' })
  await recordDesign($, '/d', 'ee00000000000005', { widthPt: 1, heightPt: 1 })
  expect(seen.writes).toEqual([])
})

test('record then load gives the value without a read', async () => {
  const { $, seen } = disk({})
  const d = { widthPt: 400, heightPt: 250 }
  await recordDesign($, '/d', 'ff00000000000006', d)
  expect(await loadDesign($, '/d', 'ff00000000000006')).toEqual(d)
  expect(seen.reads).toEqual([])
})

test('a design noted at queue time is in memory, is not replaced by a later note, and is saved by record', async () => {
  const { $, seen } = disk({})
  const first = { widthPt: 400, heightPt: 250 }
  expect(designInMemory('gg00000000000007')).toBe(undefined)
  noteDesign('gg00000000000007', first)
  noteDesign('gg00000000000007', { widthPt: 1, heightPt: 1 })
  expect(designInMemory('gg00000000000007')).toEqual(first)
  expect(await loadDesign($, '/d', 'gg00000000000007')).toEqual(first)
  expect(seen.reads).toEqual([])
  await recordDesign($, '/d', 'gg00000000000007', first)
  expect(seen.writes).toEqual(['/d/gg/gg00000000000007'])
  await recordDesign($, '/d', 'gg00000000000007', first)
  expect(seen.writes.length).toBe(1)
})

test('a missing design is null in memory, not undefined', async () => {
  const { $ } = disk({})
  await loadDesign($, '/d', 'hh00000000000008')
  expect(designInMemory('hh00000000000008')).toBe(null)
})

test('record keeps the design of a file another session wrote first, and writes nothing', async () => {
  const path = designPath('/d', 'ii00000000000009')
  const { $, seen } = disk({ [path]: '500 300' })
  noteDesign('ii00000000000009', { widthPt: 1, heightPt: 1 })
  await recordDesign($, '/d', 'ii00000000000009', { widthPt: 1, heightPt: 1 })
  expect(seen.writes).toEqual([])
  expect(designInMemory('ii00000000000009')).toEqual({ widthPt: 500, heightPt: 300 })
  // Saved now, so a second record returns at once, with no read.
  const reads = seen.reads.length
  await recordDesign($, '/d', 'ii00000000000009', { widthPt: 2, heightPt: 2 })
  expect(seen.reads.length).toBe(reads)
})

test('record writes over a file that is not a design', async () => {
  const path = designPath('/d', 'jj0000000000000a')
  const { $, seen } = disk({ [path]: 'junk' })
  await recordDesign($, '/d', 'jj0000000000000a', { widthPt: 400, heightPt: 250 })
  expect(seen.writes).toEqual([path])
  expect(await loadDesign($, '/d', 'jj0000000000000a')).toEqual({ widthPt: 400, heightPt: 250 })
})

test('record never throws when the write fails; the design stays only noted', async () => {
  const { $ } = disk({}, true)
  noteDesign('kk0000000000000b', { widthPt: 400, heightPt: 250 })
  await recordDesign($, '/d', 'kk0000000000000b', { widthPt: 400, heightPt: 250 })
  expect(designInMemory('kk0000000000000b')).toEqual({ widthPt: 400, heightPt: 250 })
})

test('the designs in memory are bounded: the oldest go', () => {
  disk({})
  for (let i = 0; i <= DESIGNS_IN_MEMORY; i++) noteDesign(`m${i}`, { widthPt: 1, heightPt: 1 })
  expect(designInMemory('m0')).toBe(undefined)
  expect(designInMemory(`m${DESIGNS_IN_MEMORY}`)).toEqual({ widthPt: 1, heightPt: 1 })
})
