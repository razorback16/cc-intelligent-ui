// Click targets (pure): the web links, files, commands and code blocks' copy
// buttons drawn on a page of a picture, and the cells each takes, from the
// page's probed words (copy.ts: a word's `href` and `code`), its buttons and
// the drawing's resolved links (only files that exist, by their label). The
// text of a code block is no target, only its copy button (its whole code);
// inline code is (a command to copy).
import { joinItems, type Button, type Item } from './copy'
import type { ShownLink } from './draw'
import { fileOf, trimUrl } from './links'
import type { PageWords } from './probe'
import type { SelRow } from './select'

export type Target =
  | { kind: 'web'; href: string } | { kind: 'file'; path: string } | { kind: 'command'; text: string } | { kind: 'code'; text: string; lang?: string }
// One target on one page: what it does, and its cells on that page (the cells whose centre test matches
// textOfRun's rule: a word is in a cell when its box centre is in it; a target covers, on each of its rows,
// the columns from its first word's left cell to its last word's right cell).
export type PageTarget = { target: Target; rows: SelRow[] }

type Page = { width: number; height: number; columns: number; rows: number }

const isWeb = (url: string) => /^(https?:\/\/|mailto:)/i.test(url)
// The punctuation a bare word may have around a path or a URL.
const LEAD = /^[([{<"'*_]+/
const TRAIL = /[)\]}>"'*_.,;:!?]+$/

// The cells of some items on a page, row by row (SelRow: inclusive
// columns). A word takes the cells whose centres are in its box (at least
// the one its centre is in).
function rowsOf(items: readonly Item[], page: Page): SelRow[] {
  const colW = page.width / page.columns
  const rowH = page.height / page.rows
  const clamp = (c: number) => Math.min(page.columns - 1, Math.max(0, c))
  const col = (x: number) => clamp(Math.floor(x / colW))
  const rows = new Map<number, SelRow>()
  for (const item of items) {
    const row = Math.floor((item.y0 + item.y1) / 2 / rowH)
    if (row < 0 || row >= page.rows) continue
    const mid = col((item.x0 + item.x1) / 2)
    const x0 = Math.min(mid, clamp(Math.ceil(item.x0 / colW - 0.5)))
    const x1 = Math.max(mid, clamp(Math.floor(item.x1 / colW - 0.5)))
    const had = rows.get(row)
    rows.set(row, had ? { row, x0: Math.min(had.x0, x0), x1: Math.max(had.x1, x1) } : { row, x0, x1 })
  }
  return [...rows.values()].sort((a, b) => a.row - b.row)
}

// The cells of a button's box, row by row: the cells whose centres are in
// it (at least the one its centre is in).
function boxRows(box: Button, page: Page): SelRow[] {
  const colW = page.width / page.columns
  const rowH = page.height / page.rows
  // The first and last cells whose centres are in [a, b] (else the one of its centre), clamped to n.
  const span = (a: number, b: number, size: number, n: number) => {
    const mid = Math.floor((a + b) / 2 / size)
    const lo = Math.min(mid, Math.ceil(a / size - 0.5))
    const hi = Math.max(mid, Math.floor(b / size - 0.5))
    return [Math.max(0, lo), Math.min(n - 1, hi)] as const
  }
  const [r0, r1] = span(box.y0, box.y1, rowH, page.rows)
  const [x0, x1] = span(box.x0, box.x1, colW, page.columns)
  const rows: SelRow[] = []
  if (x0 <= x1) for (let row = r0; row <= r1; row++) rows.push({ row, x0, x1 })
  return rows
}

// A file's target: the ShownLink of kind file with that label (it exists).
function fileTarget(label: string, links: readonly ShownLink[]): Target | null {
  const link = links.find(l => l.kind === 'file' && l.label === label)
  return link?.kind === 'file' ? { kind: 'file', path: link.path } : null
}

// The target of a bare token (words with no space between, not in a link or
// code): a URL (trimmed as links.ts does) or a file path that exists.
function bareTarget(token: string, links: readonly ShownLink[]): Target | null {
  const text = token.replace(LEAD, '')
  if (/^https?:\/\/\S/i.test(text)) return { kind: 'web', href: trimUrl(text) }
  const path = text.replace(TRAIL, '')
  return fileOf(path, true) ? fileTarget(path, links) : null
}

// The page's targets in document order. Consecutive words with the same
// link URL are one web target (a URL only); the words of one inline code a
// file that exists, else a command (its text, less a `! ` before it); a code block none; a bare URL
// or file path one target over its words (pieces with no space between, as
// the copy joins them). A copy button is a code target over its box, put
// before the first target that starts below it (or right of it on its row).
export function targetsOf(words: PageWords, page: Page, links: readonly ShownLink[]): PageTarget[] {
  const { items } = words
  const out: PageTarget[] = []
  const add = (target: Target | null, of: readonly Item[]) => {
    const rows = target ? rowsOf(of, page) : []
    if (target && rows.length) out.push({ target, rows })
  }
  // Whether `b` goes on the same token as `a` (no space between, as joinItems joins them).
  const joins = (a: Item, b: Item) =>
    a.block === b.block && !a.adv && !b.adv && joinItems([{ item: a, text: a.text }, { item: b, text: b.text }], []) === a.text + b.text
  let i = 0
  while (i < items.length) {
    const item = items[i]!
    let j = i + 1
    if (item.adv) {
      while (j < items.length && items[j]!.adv && items[j]!.block === item.block) j++
    } else if (item.href) {
      while (j < items.length && items[j]!.href === item.href) j++
      const href = item.href
      const path = href.replace(/^file:\/\//i, '').replace(/[?#].*$/, '')
      add(isWeb(href) ? { kind: 'web', href } : fileOf(path) ? fileTarget(path, links) : null, items.slice(i, j))
    } else if (item.code) {
      while (j < items.length && !items[j]!.href && items[j]!.code === item.code) j++
      const code = item.code.replace(/\s+/g, ' ').trim()
      add((fileOf(code) && fileTarget(code, links)) || { kind: 'command', text: code.replace(/^!\s+(?=\S)/, '') }, items.slice(i, j))
    } else {
      while (j < items.length && !items[j]!.href && !items[j]!.code && joins(items[j - 1]!, items[j]!)) j++
      const token = items.slice(i, j)
      add(bareTarget(token.map(w => w.text).join(''), links), token)
    }
    i = j
  }
  for (const button of words.buttons ?? []) {
    const rows = boxRows(button, page)
    if (!rows.length) continue
    const top = rows[0]!
    const at = out.findIndex(t => t.rows[0]!.row > top.row || (t.rows[0]!.row === top.row && t.rows[0]!.x0 > top.x0))
    const target: Target = { kind: 'code', text: button.code, ...(button.lang ? { lang: button.lang } : {}) }
    out.splice(at < 0 ? out.length : at, 0, { target, rows })
  }
  return out
}

// The index of the target whose cells hold (x, y) in page cells, or -1.
export function targetAt(targets: readonly PageTarget[], x: number, y: number): number {
  return targets.findIndex(t => t.rows.some(r => r.row === y && x >= r.x0 && x <= r.x1))
}
