// iTerm2 setup: the marked block /iui setup adds to (or removes from)
// the shell's start file, and the question asked once per load.
import type { EngineInterface } from 'claude-code'

import { S } from './state'
import { readText } from './host'

// Claude Code turns pictures on by itself in kitty and Ghostty only; iTerm2
// needs CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 when Claude Code starts (a mod's
// $.env.set comes after its terminal check, too late). So the setup adds a
// marked block to the shell's start file that sets it in iTerm2 alone, not in
// tmux or screen (Claude Code cannot draw there).
export const SETUP_START = '# >>> intelligent-ui: Claude Code pictures in iTerm2 >>>'
export const SETUP_END = '# <<< intelligent-ui <<<'
export type ShellRc = { path: string; kind: 'sh' | 'fish' }
// The start file the setup writes for the login shell (`SHELL`); null for a
// shell it does not know. iTerm2 starts login shells: bash reads
// .bash_profile on macOS. fish gets a file of its own in conf.d.
export function shellRcOf(o: { shell: string; home: string; zdotdir?: string; xdgConfig?: string; isMac: boolean }): ShellRc | null {
  const name = o.shell.split('/').pop() ?? ''
  if (name === 'zsh') return { path: `${o.zdotdir || o.home}/.zshrc`, kind: 'sh' }
  if (name === 'bash') return { path: `${o.home}/${o.isMac ? '.bash_profile' : '.bashrc'}`, kind: 'sh' }
  if (name === 'fish') return { path: `${o.xdgConfig || `${o.home}/.config`}/fish/conf.d/intelligent-ui.fish`, kind: 'fish' }
  return null
}
export function setupBlock(kind: ShellRc['kind']): string {
  const line = kind === 'fish'
    ? 'if test "$TERM_PROGRAM" = "iTerm.app"; and not set -q TMUX; and not set -q STY; set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1; end'
    : 'if [ "$TERM_PROGRAM" = "iTerm.app" ] && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi'
  return `${SETUP_START}\n${line}\n${SETUP_END}\n`
}
export const hasSetup = (text: string) => text.includes(SETUP_START)
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
    shell: (await $.env.get('SHELL')) ?? '',
    home: (await $.env.get('HOME')) ?? '',
    zdotdir: (await $.env.get('ZDOTDIR')) || undefined,
    xdgConfig: (await $.env.get('XDG_CONFIG_HOME')) || undefined,
    isMac: S.hostOs === 'Darwin',
  })
}

// Adds (or removes) the setup block. Returns what to tell the person.
export async function runSetup($: EngineInterface, remove: boolean): Promise<string> {
  const rc = await shellRc($)
  const manual = `export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 (only in iTerm2, not in tmux or screen)`
  if (!rc) return `Intelligent UI does not know your shell, so it changed no file. Add this to your shell's start file: ${manual}`
  const text = (await readText($, rc.path)) ?? ''
  const restart = 'Close this tab, open a new iTerm2 tab, and start Claude Code there to see pictures.'
  if (remove) {
    if (!hasSetup(text)) return `${rc.path} has no Intelligent UI block.`
    await $.fs.write(rc.path, withoutSetup(text))
    return `Removed the Intelligent UI block from ${rc.path}. New iTerm2 tabs show answers as text.`
  }
  if (hasSetup(text)) return `${rc.path} already has the Intelligent UI block. ${restart}`
  if (rc.kind === 'fish') await $.process.run(['mkdir', '-p', rc.path.replace(/\/[^/]*$/, '')]).catch(() => null)
  await $.fs.write(rc.path, withSetup(text, rc.kind))
  return `Added the Intelligent UI block to ${rc.path}. ${restart} Undo with /iui setup remove.`
}

// Asks once per load whether to add the setup block; "Never ask" is kept.
export async function offerSetup($: EngineInterface) {
  if (S.setupAsked) return
  S.setupAsked = true
  if ((await $.store.get('setup').catch(() => undefined)) === 'never') return
  const rc = await shellRc($)
  if (rc && hasSetup((await readText($, rc.path)) ?? '')) return
  const file = rc ? rc.path.replace((await $.env.get('HOME')) ?? '\u0000', '~') : "your shell's start file"
  const answer = await $.ui.ask(
    `Intelligent UI draws answers as pictures, but in iTerm2 Claude Code needs CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 when it starts. Add one line to ${file} that sets it in iTerm2 only (not in tmux or screen)?`,
    { header: 'iui', options: ['Add the line', 'Not now', 'Never ask'] },
  )
  if (answer === 'Never ask') await $.store.set('setup', 'never')
  if (answer !== 'Add the line') return
  const said = await runSetup($, false)
  // The toast box is small: a short line there, the whole text in the transcript.
  try {
    $.ui.log(said)
  } catch {}
  try {
    $.ui.toast(said.startsWith('Added') ? 'Close this tab and open a new iTerm2 tab to see pictures.' : 'See the transcript for the setup.', { timeoutMs: 10000 })
  } catch {}
}
