// iTerm2 and herdr setup: the marked block /iui setup adds to (or removes
// from) the shell's start file, and the question asked once per load.
import type { EngineInterface } from 'claude-code'

import { S } from './state'
import { readText } from './host'
import { getenv, exists, write, exec, load, save, ask, log, toast } from './api'

// Claude Code turns pictures on by itself in kitty and Ghostty only; iTerm2
// and herdr need CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 when Claude Code starts
// (a mod's $.env.set comes after its terminal check, too late). So the setup
// adds a marked block to the shell's start file that sets it in iTerm2 and
// herdr alone, not in tmux or screen (Claude Code cannot draw there). The
// markers stay as they were (an old block set it in iTerm2 only).
export const SETUP_START = '# >>> cc-intelligent-ui: Claude Code pictures in iTerm2 >>>'
export const SETUP_END = '# <<< cc-intelligent-ui <<<'
export type ShellRc = { path: string; kind: 'sh' | 'fish' }
// The start file the setup writes for the login shell (`SHELL`); null for a
// shell it does not know. iTerm2 (and herdr on macOS) starts login shells:
// bash reads .bash_profile on macOS. fish gets a file of its own in conf.d.
export function shellRcOf(o: { shell: string; home: string; zdotdir?: string; xdgConfig?: string; isMac: boolean }): ShellRc | null {
  const name = o.shell.split('/').pop() ?? ''
  if (name === 'zsh') return { path: `${o.zdotdir || o.home}/.zshrc`, kind: 'sh' }
  if (name === 'bash') return { path: `${o.home}/${o.isMac ? '.bash_profile' : '.bashrc'}`, kind: 'sh' }
  if (name === 'fish') return { path: `${o.xdgConfig || `${o.home}/.config`}/fish/conf.d/cc-intelligent-ui.fish`, kind: 'fish' }
  return null
}
export function setupBlock(kind: ShellRc['kind']): string {
  const line = kind === 'fish'
    ? 'if test "$TERM_PROGRAM" = "iTerm.app" -o "$TERM_PROGRAM" = "herdr"; and not set -q TMUX; and not set -q STY; set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1; end'
    : 'if { [ "$TERM_PROGRAM" = "iTerm.app" ] || [ "$TERM_PROGRAM" = "herdr" ]; } && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi'
  return `${SETUP_START}\n${line}\n${SETUP_END}\n`
}
export const hasSetup = (text: string) => text.includes(SETUP_START)
// The text has this version's block (an old one has no herdr).
export const hasNewSetup = (text: string, kind: ShellRc['kind']) => text.includes(setupBlock(kind))
// The text with no setup block (and no blank line left where it was).
export function withoutSetup(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== SETUP_START) {
      out.push(lines[i]!)
      continue
    }
    const end = lines.indexOf(SETUP_END, i)
    if (end < 0) {
      out.push(lines[i]!)
      continue
    }
    if (out.length && out[out.length - 1] === '') out.pop()
    i = end
  }
  return out.join('\n')
}
// The text with one setup block at its end.
export function withSetup(text: string, kind: ShellRc['kind']): string {
  const base = withoutSetup(text).replace(/\n*$/, '')
  return `${base}${base ? '\n\n' : ''}${setupBlock(kind)}`
}

// The shell start file for this user, or null when the shell is not known.
async function shellRc($: EngineInterface): Promise<ShellRc | null> {
  return shellRcOf({
    shell: (await getenv($, 'SHELL')) ?? '',
    home: (await getenv($, 'HOME')) ?? '',
    zdotdir: (await getenv($, 'ZDOTDIR')) || undefined,
    xdgConfig: (await getenv($, 'XDG_CONFIG_HOME')) || undefined,
    isMac: S.hostOs === 'Darwin',
  })
}

// The start file's text: '' when it is confirmed missing, null when it
// exists (or may exist) but cannot be read. A write over null would lose it.
async function readRc($: EngineInterface, path: string): Promise<string | null> {
  const there = await exists($, path).catch(() => true)
  if (!there) return ''
  return readText($, path)
}

// What /iui setup says where neither iTerm2 (macOS only) nor herdr runs: it changes no file.
export const SETUP_NOT_MAC = '/iui setup is for iTerm2 and herdr. iTerm2 runs on macOS only, and this terminal is not herdr, so Intelligent UI changed no file. ' +
  'On Linux, kitty and Ghostty show pictures with no setup. In herdr, run /iui setup in a herdr pane. ' +
  'For Rio, set CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 before you start Claude Code. Run /iui details to see if this terminal shows pictures.'

// The words for the terminal in use: herdr opens panes, iTerm2 tabs.
export const setupWordsOf = (isHerdr: boolean) => (isHerdr ? { app: 'herdr', tab: 'pane' } : { app: 'iTerm2', tab: 'tab' })

// Adds (or removes) the setup block. Returns what to tell the person. A
// block of an older version (no herdr) is replaced.
export async function runSetup($: EngineInterface, remove: boolean): Promise<string> {
  if (S.hostOs && S.hostOs !== 'Darwin' && !S.isHerdr) return SETUP_NOT_MAC
  const rc = await shellRc($)
  const { app, tab } = setupWordsOf(S.isHerdr)
  const manual = `export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 (only in iTerm2 and herdr, not in tmux or screen)`
  if (!rc) return `Intelligent UI does not know your shell, so it changed no file. Add this to your shell's start file: ${manual}`
  const text = await readRc($, rc.path)
  if (text === null) return `Intelligent UI could not read ${rc.path}, so it changed no file. Add this to it yourself: ${manual}`
  const restart = `Close this ${tab}, open a new ${app} ${tab}, and start Claude Code there to see pictures.`
  if (remove) {
    if (!hasSetup(text)) return `${rc.path} has no Intelligent UI block.`
    await write($, rc.path, withoutSetup(text))
    return `Removed the Intelligent UI block from ${rc.path}. New ${app} ${tab}s show answers as text.`
  }
  if (hasNewSetup(text, rc.kind)) return `${rc.path} already has the Intelligent UI block. ${restart}`
  if (rc.kind === 'fish') await exec($, ['mkdir', '-p', rc.path.replace(/\/[^/]*$/, '')]).catch(() => null)
  await write($, rc.path, withSetup(text, rc.kind))
  const done = hasSetup(text) ? `Updated the Intelligent UI block in ${rc.path}` : `Added the Intelligent UI block to ${rc.path}`
  return `${done}. ${restart} Undo with /iui setup remove.`
}

// Asks once per load whether to add the setup block; "Never ask" is kept.
export async function offerSetup($: EngineInterface) {
  if (S.setupAsked) return
  S.setupAsked = true
  if ((await load($, 'setup').catch(() => undefined)) === 'never') return
  const rc = await shellRc($)
  const text = rc ? await readRc($, rc.path) : ''
  if (text === null) return
  // A block is enough for iTerm2; herdr needs this version's (an old one sets the variable in iTerm2 only).
  const isOld = !!rc && hasSetup(text) && !hasNewSetup(text, rc.kind)
  if (rc && hasSetup(text) && !(S.isHerdr && isOld)) return
  const home = (await getenv($, 'HOME')) ?? ''
  const file = rc ? (home ? rc.path.replace(home, '~') : rc.path) : "your shell's start file"
  const { app, tab } = setupWordsOf(S.isHerdr)
  const yes = isOld ? 'Update the line' : 'Add the line'
  const question = isOld
    ? `Update the Intelligent UI line in ${file} so that it sets it in herdr too (not in tmux or screen)?`
    : `Add one line to ${file} that sets it in iTerm2 and herdr only (not in tmux or screen)?`
  const answer = await ask($,
    `Intelligent UI draws answers as pictures, but in ${app} Claude Code needs CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 when it starts. ${question}`,
    { header: 'iui', options: [yes, 'Not now', 'Never ask'] },
  )
  if (answer === 'Never ask') await save($, 'setup', 'never')
  if (answer !== yes) return
  const said = await runSetup($, false)
  // The toast box is small: a short line there, the whole text in the transcript.
  try {
    log($, said)
  } catch {}
  try {
    toast($, /^(Added|Updated)/.test(said) ? `Close this ${tab} and open a new ${app} ${tab} to see pictures.` : 'See the transcript for the setup.', { timeoutMs: 10000 })
  } catch {}
}
