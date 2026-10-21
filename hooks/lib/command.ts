// The /iui command: its arguments, the typeahead rows for them, and
// its registration.
import type { EngineInterface } from 'claude-code'

import {
  DEFAULT_HEIGHT, DEFAULT_SIZE, DEFAULT_WIDTH, IMAGE_MAX_COLUMNS, MAX_HEIGHT, MAX_SIZE, MAX_WIDTH, MIN_HEIGHT, MIN_SIZE, MIN_WIDTH, PICTURE_ROOM_ROWS,
  type Height, type Width,
} from './settings'
import { isThemeName, type ThemeInfo } from './themes'
import { commandAdd } from './api'

// `/iui` arguments: on, off, size <80-200>, width [40-400|full],
// height [6-200|half|full], grid [on|off], select [on|off], updates
// [on|off], details (all Intelligent UI found), grab (copy the text of the
// last mouse selection of pictures), dump (how the last clipboard with
// picture cells was read), or nothing (show state). A `width`, `height`,
// `grid`, `select` or `updates` with no value shows it.
export type Command =
  | { kind: 'on' | 'off' | 'show' | 'details' | 'probe' | 'grab' | 'dump' }
  | { kind: 'size'; percent: number }
  | { kind: 'width'; width?: Width }
  | { kind: 'height'; height?: Height }
  | { kind: 'grid'; grid?: boolean }
  | { kind: 'updates'; on?: boolean }
  | { kind: 'select'; on?: boolean }
  | { kind: 'theme'; name?: string }
  | { kind: 'setup'; remove: boolean }
  | { kind: 'bad' }
export function parseCommand(args: string): Command {
  const typed = args.trim().split(/\s+/).filter(Boolean)
  const words = typed.map(w => w.toLowerCase())
  if (!words.length) return { kind: 'show' }
  if (words[0] === 'theme') {
    if (typed.length === 1) return { kind: 'theme' }
    if (typed.length === 2 && isThemeName(typed[1]!)) return { kind: 'theme', name: typed[1]! }
    return { kind: 'bad' }
  }
  if (words.length === 1 && (words[0] === 'on' || words[0] === 'off' || words[0] === 'details' || words[0] === 'probe' || words[0] === 'grab' || words[0] === 'dump')) {
    return { kind: words[0] }
  }
  if (words[0] === 'setup' && words.length === 1) return { kind: 'setup', remove: false }
  if (words[0] === 'setup' && words.length === 2 && words[1] === 'remove') return { kind: 'setup', remove: true }
  if (words[0] === 'size' && words.length === 2 && /^\d+%?$/.test(words[1]!)) {
    const percent = Number.parseInt(words[1]!, 10)
    if (percent >= MIN_SIZE && percent <= MAX_SIZE) return { kind: 'size', percent }
  }
  if (words[0] === 'width' && words.length === 1) return { kind: 'width' }
  if (words[0] === 'width' && words.length === 2 && words[1] === 'full') return { kind: 'width', width: 'full' }
  if (words[0] === 'width' && words.length === 2 && /^\d+$/.test(words[1]!)) {
    const width = Number.parseInt(words[1]!, 10)
    if (width >= MIN_WIDTH && width <= MAX_WIDTH) return { kind: 'width', width }
  }
  if (words[0] === 'height' && words.length === 1) return { kind: 'height' }
  if (words[0] === 'height' && words.length === 2 && (words[1] === 'half' || words[1] === 'full')) return { kind: 'height', height: words[1] }
  if (words[0] === 'height' && words.length === 2 && /^\d+$/.test(words[1]!)) {
    const height = Number.parseInt(words[1]!, 10)
    if (height >= MIN_HEIGHT && height <= MAX_HEIGHT) return { kind: 'height', height }
  }
  if (words[0] === 'grid' && words.length === 1) return { kind: 'grid' }
  if (words[0] === 'grid' && words.length === 2 && (words[1] === 'on' || words[1] === 'off')) return { kind: 'grid', grid: words[1] === 'on' }
  if (words[0] === 'select' && words.length === 1) return { kind: 'select' }
  if (words[0] === 'select' && words.length === 2 && (words[1] === 'on' || words[1] === 'off')) return { kind: 'select', on: words[1] === 'on' }
  if (words[0] === 'updates' && words.length === 1) return { kind: 'updates' }
  if (words[0] === 'updates' && words.length === 2 && (words[1] === 'on' || words[1] === 'off')) return { kind: 'updates', on: words[1] === 'on' }
  return { kind: 'bad' }
}

// The /iui arguments, and the sizes, widths, heights, grid and updates
// values the typeahead offers.
const SUBCOMMANDS = [
  { name: 'on', description: 'draw answers as pictures' },
  { name: 'off', description: 'show answers as text' },
  { name: 'size', description: `text size, ${MIN_SIZE}-${MAX_SIZE}%` },
  { name: 'width', description: `the most columns a picture takes, ${MIN_WIDTH}-${MAX_WIDTH} or full` },
  { name: 'height', description: `the most rows an image or a Typst drawing takes, ${MIN_HEIGHT}-${MAX_HEIGHT}, half or full` },
  { name: 'grid', description: 'each line of text on whole terminal rows, on or off' },
  { name: 'select', description: 'select and copy picture text with the mouse, on or off' },
  { name: 'updates', description: 'look for a new version once a day, on or off' },
  { name: 'theme', description: 'list the themes, or switch to one' },
  { name: 'setup', description: 'iTerm2: add the shell line that turns pictures on' },
  { name: 'details', description: 'the mode source, the terminal font, Typst and the terminal' },
  { name: 'grab', description: 'copy the text of the pictures you last selected (or copied, on the main screen)' },
  { name: 'dump', description: 'show what the clipboard held and how it was read' },
] as const
const SIZES = [80, 90, 100, 110, 120, 125, 150, 175, 200]
const WIDTHS: readonly Width[] = [80, 100, 120, 160, 200, 'full']
const HEIGHTS: readonly Height[] = ['half', 'full', 12, 24, 36]
const GRIDS = ['on', 'off'] as const
const UPDATES = ['on', 'off'] as const
const SELECTS = ['on', 'off'] as const

// Typeahead rows for `/iui` arguments: the word at the cursor (`token`,
// starting at `start` in `text`) completed as a subcommand, a theme name, a
// size, a width, a height, a grid or an updates value. The typeahead asks
// only while a word is at the cursor (never after a space), and again after
// a row is taken. So each word offers its next step while it is at the
// cursor: `/iui` its subcommands, and `theme`, `size`, `width`, `height`,
// `grid` or `updates` their values, as rows that hold the word too. A Tab
// then takes a row and the next rows show at once. The value in use is
// marked `in use` in each list, as in `/iui theme`.
export type Suggestion = { text: string; label?: string; description?: string }
export function commandSuggestions(
  text: string, token: string, start: number,
  o: { themes: readonly ThemeInfo[]; active: string; size: number; width?: Width; height?: Height; grid?: boolean; updates?: boolean; select?: boolean },
): Suggestion[] {
  if (token === '/iui' && /^\s*$/.test(text.slice(0, start))) {
    return SUBCOMMANDS.map(c => ({ text: `/iui ${c.name}`, label: c.name, description: c.description }))
  }
  const head = /^\s*\/iui\s+/.exec(text)
  if (!head || start < head[0].length) return []
  const before = text.slice(head[0].length, start).trim().split(/\s+/).filter(Boolean).map(w => w.toLowerCase())
  const word = token.toLowerCase()
  const themeRows = (prefix: string, lead: string) => [...o.themes]
    .filter(t => t.name.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => ({
      text: `${lead}${t.name}`,
      label: t.name,
      description: [[t.isUser ? 'yours' : '', t.name === o.active ? 'in use' : ''].filter(Boolean).join(', '), t.description].filter(Boolean).join(': ') || undefined,
    }))
  const sizeRows = (prefix: string, lead: string) => SIZES
    .filter(n => String(n).startsWith(prefix))
    .map(n => ({ text: `${lead}${n}`, label: `${n}%`, description: n === o.size ? 'in use' : n === DEFAULT_SIZE ? 'the terminal text size' : undefined }))
  const width = o.width ?? DEFAULT_WIDTH
  const widthRows = (prefix: string, lead: string) => WIDTHS
    .filter(w => String(w).startsWith(prefix))
    .map(w => ({
      text: `${lead}${w}`,
      label: w === 'full' ? 'full' : `${w} columns`,
      description: w === width ? 'in use' : w === DEFAULT_WIDTH ? 'the default' : w === 'full' ? `the terminal width (${IMAGE_MAX_COLUMNS} at most)` : undefined,
    }))
  const height = o.height ?? DEFAULT_HEIGHT
  const heightRows = (prefix: string, lead: string) => HEIGHTS
    .filter(h => String(h).startsWith(prefix))
    .map(h => ({
      text: `${lead}${h}`,
      label: typeof h === 'number' ? `${h} rows` : h,
      description: h === height ? 'in use' : h === DEFAULT_HEIGHT ? 'the default: half the terminal'
        : h === 'full' ? `the terminal height less ${PICTURE_ROOM_ROWS} rows` : undefined,
    }))
  const grid = o.grid === false ? 'off' : 'on'
  const gridRows = (prefix: string, lead: string) => GRIDS
    .filter(g => g.startsWith(prefix))
    .map(g => ({ text: `${lead}${g}`, label: g, description: g === grid ? 'in use' : g === 'on' ? 'the default' : undefined }))
  const updates = o.updates === false ? 'off' : 'on'
  const updateRows = (prefix: string, lead: string) => UPDATES
    .filter(u => u.startsWith(prefix))
    .map(u => ({ text: `${lead}${u}`, label: u, description: u === updates ? 'in use' : u === 'on' ? 'the default' : undefined }))
  const select = o.select === false ? 'off' : 'on'
  const selectRows = (prefix: string, lead: string) => SELECTS
    .filter(v => v.startsWith(prefix))
    .map(v => ({ text: `${lead}${v}`, label: v, description: v === select ? 'in use' : v === 'on' ? 'the default' : undefined }))
  if (before.length === 0) {
    if (word === 'theme') return themeRows('', 'theme ')
    if (word === 'height') return heightRows('', 'height ')
    if (word === 'size') return sizeRows('', 'size ')
    if (word === 'width') return widthRows('', 'width ')
    if (word === 'grid') return gridRows('', 'grid ')
    if (word === 'updates') return updateRows('', 'updates ')
    if (word === 'select') return selectRows('', 'select ')
    return SUBCOMMANDS.filter(c => c.name.startsWith(word)).map(c => ({ text: c.name, description: c.description }))
  }
  if (before.length === 1 && before[0] === 'theme') return themeRows(word, '')
  if (before.length === 1 && before[0] === 'size') return sizeRows(word.replace(/%$/, ''), '')
  if (before.length === 1 && before[0] === 'width') return widthRows(word, '')
  if (before.length === 1 && before[0] === 'height') return heightRows(word, '')
  if (before.length === 1 && before[0] === 'grid') return gridRows(word, '')
  if (before.length === 1 && before[0] === 'updates') return updateRows(word, '')
  if (before.length === 1 && before[0] === 'select') return selectRows(word, '')
  return []
}

// /iui; registered at session start and again in setUp, so it is
// there after a hot reload too.
export async function registerCommand($: EngineInterface) {
  await commandAdd($, {
    name: 'iui',
    description: "Draw Claude's answers as rendered Markdown pictures: on, off, size <80-200> (text size in % of the terminal's), width [40-400|full] (the most columns a picture takes), height [6-200|half|full] (the most rows an image or a Typst drawing takes), grid [on|off] (each line of text on whole terminal rows), select [on|off] (select and copy picture text with the mouse), updates [on|off] (look for a new version once a day), theme [name] (list or switch themes), grab (copy the text of the selected pictures, or of the picture cells on the clipboard), dump (copy diagnostics)",
    argumentHint: '[on|off|size <percent>|width [columns|full]|height [rows|half|full]|grid [on|off]|select [on|off]|updates [on|off]|theme [name]|grab|dump]',
  }).catch(() => undefined)
}
