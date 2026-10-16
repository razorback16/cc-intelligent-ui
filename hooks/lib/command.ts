// The /md-preview command: its arguments, the typeahead rows for them, and
// its registration.
import type { EngineInterface } from 'claude-code'

import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE } from './settings'
import { isThemeName, type ThemeInfo } from './themes'

// `/md-preview` arguments: on, off, size <80-200>, or nothing (show state).
export type Command =
  | { kind: 'on' | 'off' | 'show' | 'probe' }
  | { kind: 'size'; percent: number }
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
  if (words.length === 1 && (words[0] === 'on' || words[0] === 'off' || words[0] === 'probe')) return { kind: words[0] }
  if (words[0] === 'setup' && words.length === 1) return { kind: 'setup', remove: false }
  if (words[0] === 'setup' && words.length === 2 && words[1] === 'remove') return { kind: 'setup', remove: true }
  if (words[0] === 'size' && words.length === 2 && /^\d+%?$/.test(words[1]!)) {
    const percent = Number.parseInt(words[1]!, 10)
    if (percent >= MIN_SIZE && percent <= MAX_SIZE) return { kind: 'size', percent }
  }
  return { kind: 'bad' }
}

// The /md-preview arguments, and the sizes the typeahead offers.
const SUBCOMMANDS = [
  { name: 'on', description: 'draw answers as pictures' },
  { name: 'off', description: 'show answers as text' },
  { name: 'size', description: `text size, ${MIN_SIZE}-${MAX_SIZE}%` },
  { name: 'theme', description: 'list the themes, or switch to one' },
  { name: 'setup', description: 'iTerm2: add the shell line that turns pictures on' },
] as const
const SIZES = [80, 90, 100, 110, 120, 125, 150, 175, 200]

// Typeahead rows for `/md-preview` arguments: the word at the cursor (`token`,
// starting at `start` in `text`) completed as a subcommand, a theme name or a
// size. Right after `theme` or `size`, rows hold the word and its argument,
// since the typeahead asks only while a word is at the cursor.
export type Suggestion = { text: string; label?: string; description?: string }
export function commandSuggestions(
  text: string, token: string, start: number,
  o: { themes: readonly ThemeInfo[]; active: string; size: number },
): Suggestion[] {
  const head = /^\s*\/md-preview\s+/.exec(text)
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
  if (before.length === 0) {
    if (word === 'theme') return themeRows('', 'theme ')
    if (word === 'size') return sizeRows('', 'size ')
    return SUBCOMMANDS.filter(c => c.name.startsWith(word)).map(c => ({ text: c.name, description: c.description }))
  }
  if (before.length === 1 && before[0] === 'theme') return themeRows(word, '')
  if (before.length === 1 && before[0] === 'size') return sizeRows(word.replace(/%$/, ''), '')
  return []
}

// /md-preview; registered at session start and again in setUp, so it is
// there after a hot reload too.
export async function registerCommand($: EngineInterface) {
  await $.command.register({
    name: 'md-preview',
    description: "Draw Claude's answers as rendered Markdown pictures: on, off, size <80-200> (text size in % of the terminal's), theme [name] (list or switch themes)",
    argumentHint: '[on|off|size <percent>|theme [name]]',
  }).catch(() => undefined)
}
