// Designs: the drawing space in pt (page width, room height) at the first
// compile of a text, so its live Typst blocks keep their share of the screen
// at any later size, also in a session opened later. One small file per
// design, named by its hash: `${dir}/<key[0:2]>/<key>`, text `W0 H0`.
//
// Host functions:
// - loadDesign($, dir, key): Promise<Design | null>: the memory map first,
//   else one fs.read of designPath (a read that fails is missing); touch the
//   file (touchLater: batched) when it is read the first time in a load.
// - noteDesign(key, design): a first compile's design in memory as its job
//   is queued, so a render during the compile uses the same design.
// - recordDesign($, dir, key, design): Promise<void>: one fs.write only when
//   the file is missing, after the compile ends; a file that is there wins.
import type { EngineInterface } from 'claude-code'

import { keep, type Design } from './state'
import { hashOf } from './draw'
import { touchLater } from './typst'
import { fsExists, fsRead, fsWrite } from './api'

export type { Design } from './state'

// The key of a text's design: by its text hash and its images' folder.
export const designKey = (textHash: string, base?: string): string => hashOf(['design', textHash, base ?? ''])

// The file of a design under `dir`, in a folder of its first 2 hex digits.
export const designPath = (dir: string, key: string): string => `${dir}/${key.slice(0, 2)}/${key}`

// A design file's text `W0 H0` (pt); null when it is not two numbers over 0.
export function parseDesign(text: string): Design | null {
  const parts = text.trim().split(/\s+/)
  if (parts.length !== 2) return null
  const [widthPt, heightPt] = parts.map(Number)
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt! <= 0 || heightPt! <= 0) return null
  return { widthPt: widthPt!, heightPt: heightPt! }
}

// A design as its file's text.
export const designText = (d: Design): string => `${d.widthPt} ${d.heightPt}`

// The designs known in this load (null: the file is missing). Bounded.
export const DESIGNS_IN_MEMORY = 4096
const known = new Map<string, Design | null>()
// The designs in `known` that a job uses but that are not on disk yet
// (noteDesign); recordDesign saves them.
const unsaved = new Set<string>()

// Clears the memory map (for tests).
export const forgetDesigns = () => {
  known.clear()
  unsaved.clear()
}

// The design of a key in memory only (no read): for a text that is still
// live, which must not wait for the disk. Undefined when not known.
export const designInMemory = (key: string): Design | null | undefined => known.get(key)

// A first compile's design, put in memory as the job is queued (before its
// file is written), so a later render of the same text (a resize while it
// compiles) uses the same design and not a design of its own.
export function noteDesign(key: string, design: Design) {
  if (known.get(key)) return
  keep(known, key, design, DESIGNS_IN_MEMORY)
  unsaved.add(key)
  if (unsaved.size > DESIGNS_IN_MEMORY) unsaved.delete(unsaved.values().next().value!)
}

// The design of a key: from memory, else one read of its file. A read that
// fails, or a bad text, is missing. A file read the first time in this load
// is touched (batched), so the cleanup of old files goes by use.
export async function loadDesign($: EngineInterface, dir: string, key: string): Promise<Design | null> {
  if (known.has(key)) return known.get(key) ?? null
  const path = designPath(dir, key)
  const text = await fsRead($, path).catch(() => null)
  const design = typeof text === 'string' ? parseDesign(text) : null
  keep(known, key, design, DESIGNS_IN_MEMORY)
  if (design) touchLater($, path)
  return design
}

// Saves a design when its file is missing, after a compile ends. When the
// file is there (another session wrote it first), the file wins: its design
// goes in memory instead. Never throws.
export async function recordDesign($: EngineInterface, dir: string, key: string, design: Design): Promise<void> {
  try {
    if (known.get(key) && !unsaved.has(key)) return
    const path = designPath(dir, key)
    if (await fsExists($, path).catch(() => false)) {
      const text = await fsRead($, path).catch(() => null)
      const kept = typeof text === 'string' ? parseDesign(text) : null
      if (kept) {
        keep(known, key, kept, DESIGNS_IN_MEMORY)
        unsaved.delete(key)
        return
      }
    }
    await fsWrite($, path, designText(design))
    keep(known, key, design, DESIGNS_IN_MEMORY)
    unsaved.delete(key)
  } catch {}
}
