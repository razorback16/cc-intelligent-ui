// The /iui command: its arguments, the typeahead rows for them, and
// its registration.
import type { EngineInterface } from 'claude-code'

import {
  DEFAULT_HEIGHT, DEFAULT_SIZE, DEFAULT_WIDTH, IMAGE_MAX_COLUMNS, MAX_HEIGHT, MAX_SIZE, MAX_WIDTH, MIN_HEIGHT, MIN_SIZE, MIN_WIDTH, PICTURE_ROOM_ROWS,
  type Height, type Width,
} from './settings'
import { isThemeName, type ThemeInfo } from './themes'
import { commandRegister } from './api'

// `/iui` arguments: on, off, size <80-200>, width [40-400|full],
// height [6-200|half|full], grid [on|off], updates [on|off], details (all
// Intelligent UI found), grab (copy the text of the last mouse selection of
// pictures), dump (how the last clipboard with picture cells was read), or
// nothing (show state). A `width`, `height`, `grid` or `updates` with no
// value shows it.
export type Command =
  | { kind: 'on' | 'off' | 'show' | 'details' | 'probe' | 'grab' | 'dump' }
  | { kind: 'size'; percent: number }
  | { kind: 'width'; width?: Width }
  | { kind: 'height'; height?: Height }
  | { kind: 'grid'; grid?: boolean }
  | { kind: 'updates'; on?: boolean }
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
  { name: 'updates', description: 'look for a new version once a day, on or off' },
  { name: 'theme', description: 'list the themes, or switch to one' },
  { name: 'setup', description: 'iTerm2: add the shell line that turns pictures on' },
  { name: 'details', description: 'the mode source, the terminal font, Typst and the terminal' },
  { name: 'grab', description: 'copy the text of the pictures you last selected' },
  { name: 'dump', description: 'show what the clipboard held and how it was read' },
] as const
const SIZES = [80, 90, 100, 110, 120, 125, 150, 175, 200]
const WIDTHS: readonly Width[] = [80, 100, 120, 160, 200, 'full']
const HEIGHTS: readonly Height[] = ['half', 'full', 12, 24, 36]
const GRIDS = ['on', 'off'] as const
const UPDATES = ['on', 'off'] as const

// Typeahead rows for `/iui` arguments: the word at the cursor (`token`,
// starting at `start` in `text`) completed as a subcommand, a theme name, a
// size, a width, a height, a grid or an updates value. Right after `theme`,
// `size`, `width`, `height`, `grid` or `updates`, rows hold the word and its
// argument, since the typeahead asks only while a word is at the cursor.
export type Suggestion = { text: string; label?: string; description?: string }
export function commandSuggestions(
  text: string, token: string, start: number,
  o: { themes: readonly ThemeInfo[]; active: string; size: number; width?: Width; height?: Height; grid?: boolean; updates?: boolean },
): Suggestion[] {
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
      description: `${t.isUser ? 'user' : 'built-in'}${t.name === o.active ? ', active' : ''}${t.description ? `: ${t.description}` : ''}`,
    }))
  const sizeRows = (prefix: string, lead: string) => SIZES
    .filter(n => String(n).startsWith(prefix))
    .map(n => ({ text: `${lead}${n}`, label: `${n}%`, description: n === o.size ? 'current' : n === DEFAULT_SIZE ? 'the terminal text size' : undefined }))
  const width = o.width ?? DEFAULT_WIDTH
  const widthRows = (prefix: string, lead: string) => WIDTHS
    .filter(w => String(w).startsWith(prefix))
    .map(w => ({
      text: `${lead}${w}`,
      label: w === 'full' ? 'full' : `${w} columns`,
      description: w === width ? 'current' : w === DEFAULT_WIDTH ? 'the default' : w === 'full' ? `the terminal width (${IMAGE_MAX_COLUMNS} at most)` : undefined,
    }))
  const height = o.height ?? DEFAULT_HEIGHT
  const heightRows = (prefix: string, lead: string) => HEIGHTS
    .filter(h => String(h).startsWith(prefix))
    .map(h => ({
      text: `${lead}${h}`,
      label: typeof h === 'number' ? `${h} rows` : h,
      description: h === height ? 'current' : h === DEFAULT_HEIGHT ? 'the default: half the terminal'
        : h === 'full' ? `the terminal height less ${PICTURE_ROOM_ROWS} rows` : undefined,
    }))
  const grid = o.grid ? 'on' : 'off'
  const gridRows = (prefix: string, lead: string) => GRIDS
    .filter(g => g.startsWith(prefix))
    .map(g => ({ text: `${lead}${g}`, label: g, description: g === grid ? 'current' : g === 'off' ? 'the default' : undefined }))
  const updates = o.updates === false ? 'off' : 'on'
  const updateRows = (prefix: string, lead: string) => UPDATES
    .filter(u => u.startsWith(prefix))
    .map(u => ({ text: `${lead}${u}`, label: u, description: u === updates ? 'current' : u === 'on' ? 'the default' : undefined }))
  if (before.length === 0) {
    if (word === 'theme') return themeRows('', 'theme ')
    if (word === 'height') return heightRows('', 'height ')
    if (word === 'size') return sizeRows('', 'size ')
    if (word === 'width') return widthRows('', 'width ')
    if (word === 'grid') return gridRows('', 'grid ')
    if (word === 'updates') return updateRows('', 'updates ')
    return SUBCOMMANDS.filter(c => c.name.startsWith(word)).map(c => ({ text: c.name, description: c.description }))
  }
  if (before.length === 1 && before[0] === 'theme') return themeRows(word, '')
  if (before.length === 1 && before[0] === 'size') return sizeRows(word.replace(/%$/, ''), '')
  if (before.length === 1 && before[0] === 'width') return widthRows(word, '')
  if (before.length === 1 && before[0] === 'height') return heightRows(word, '')
  if (before.length === 1 && before[0] === 'grid') return gridRows(word, '')
  if (before.length === 1 && before[0] === 'updates') return updateRows(word, '')
  return []
}

// /iui; registered at session start and again in setUp, so it is
// there after a hot reload too.
export async function registerCommand($: EngineInterface) {
  await commandRegister($, {
    name: 'iui',
    description: "Draw Claude's answers as rendered Markdown pictures: on, off, size <80-200> (text size in % of the terminal's), width [40-400|full] (the most columns a picture takes), height [6-200|half|full] (the most rows an image or a Typst drawing takes), grid [on|off] (each line of text on whole terminal rows), updates [on|off] (look for a new version once a day), theme [name] (list or switch themes), grab (copy the selected pictures' text), dump (copy diagnostics)",
    argumentHint: '[on|off|size <percent>|width [columns|full]|height [rows|half|full]|grid [on|off]|updates [on|off]|theme [name]|grab|dump]',
  }).catch(() => undefined)
}
