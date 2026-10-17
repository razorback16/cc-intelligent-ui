// The Env, once per load: the cache folder, Typst, the terminal, its font
// and Frame (then kept by the Frame watcher), the theme and the mode.
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import {
  BASE_THEME, DEFAULT_HEIGHT, DEFAULT_SIZE, DESIGNS_KEPT_DAYS, DEFAULT_THEME, DEFAULT_WIDTH, MAX_HEIGHT, MAX_SIZE, MAX_WIDTH, MIN_HEIGHT, MIN_SIZE, MIN_WIDTH, NO_TYPST,
} from './settings'
import { DEFAULT_METRICS, refresh, S, type Env } from './state'
import { resolveMode, settingOf } from './mode'
import { isItermIn } from './terminals'
import { canDrawIn, isSet } from './terminal'
import { claudeTmpOf } from './images'
import { applyTheme } from './themes'
import { registerCommand } from './command'
import { readHostMode, termFontOf, watchHost } from './host'
import { readFrame, setFrame, watchFrame } from './frame'
import { offerSetup } from './setup'
import { findTypst, measureFonts } from './typst'

// The `isOn` atom, which setUp turns off when the stored setting says so (a
// copy of its own: see state.ts).
const isOn = atom({ plugin: 'md-preview', key: 'isOn' } as const, true)

// Makes the cache folder, drops key folders not touched for 2 days, makes
// the designs folder (outside the tmp cache) and drops design files not
// touched for DESIGNS_KEPT_DAYS; prints the cache folder, the OS name and
// the designs folder.
const CACHE_SH = `d="\${TMPDIR:-/tmp}"; d="\${d%/}/md-preview-$(id -u)"; g="\${XDG_CACHE_HOME:-$HOME/.cache}/md-preview/designs"; mkdir -p "$d" && chmod 700 "$d" && { find "$d" -mindepth 1 -maxdepth 1 -type d -mtime +2 ! -name pkg-cache -exec rm -rf {} + 2>/dev/null; mkdir -p "$g" 2>/dev/null && find "$g" -type f -mtime +${DESIGNS_KEPT_DAYS} -delete 2>/dev/null; printf '%s\\n%s\\n%s\\n' "$d" "$(uname -s)" "$g"; }`

// Once per load: the cache folder, Typst, the terminal and its font, the
// theme, the cell. A failed setup is tried again on the next call.
export function setUp($: EngineInterface): Promise<Env> {
  S.envLoading ??= (async () => {
    await registerCommand($)
    const made = await $.process.run(['sh', '-c', CACHE_SH]).catch(() => null)
    const [made1 = '', os = '', made3 = ''] = (made?.stdout ?? '').split('\n')
    const cache = made1.trim() || '/tmp/md-preview'
    // The key folders on disk now: a key found here is read back at once.
    const listed = await $.fs.list(cache).catch(() => [])
    S.onDisk = new Set(listed.filter(entry => entry.kind === 'dir' && entry.name !== 'pkg-cache').map(entry => entry.name))
    const program = (await $.env.get('TERM_PROGRAM')) ?? ''
    const term = (await $.env.get('TERM')) ?? ''
    const ssh = !!(await $.env.get('SSH_CONNECTION')) || !!(await $.env.get('SSH_TTY'))
    const canDraw = canDrawIn({
      program,
      term,
      kitty: !!(await $.env.get('KITTY_WINDOW_ID')),
      tmux: !!(await $.env.get('TMUX')) || !!(await $.env.get('STY')) || /^tmux|^screen/i.test(term),
      ssh,
      background: (await $.env.get('CLAUDE_CODE_SESSION_KIND')) === 'bg',
      engineForced: isSet(await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')),
      modForced: isSet(await $.env.get('MD_PREVIEW_FORCE')),
    })
    const root = $.plugin.root
    const template = await $.fs.stat(`${root}/render/md.typ`).catch(() => null)
    const rows = await $.config.list().catch(() => [])
    const raw = rows.find(row => row.key === 'theme')?.value
    S.settingRaw = typeof raw === 'string' ? raw : ''
    S.setting = settingOf(raw)
    S.hostOs = os.trim()
    S.termProgram = program
    S.termName = term
    S.itermProfile = (await $.env.get('ITERM_PROFILE')) || undefined
    S.isKitty = /kitty/i.test(term) || !!(await $.env.get('KITTY_WINDOW_ID')) || !!(await $.env.get('KITTY_PID'))
    S.isRemote = ssh
    S.debug = isSet(await $.env.get('MD_PREVIEW_DEBUG'))
    S.isIterm = isItermIn({
      program,
      profile: S.itermProfile,
      session: (await $.env.get('ITERM_SESSION_ID')) || undefined,
      lcTerminal: (await $.env.get('LC_TERMINAL')) || undefined,
    })
    S.setupNeeded = S.isIterm && !canDraw && !ssh && S.hostOs === 'Darwin' &&
      !(await $.env.get('TMUX')) && !(await $.env.get('STY')) && (await $.env.get('CLAUDE_CODE_SESSION_KIND')) !== 'bg'
    if (S.setupNeeded) void offerSetup($).catch(() => undefined)
    S.isCmux = !!(await $.env.get('CMUX_SURFACE_ID')) || !!(await $.env.get('CMUX_WORKSPACE_ID')) || !!(await $.env.get('CMUX_SOCKET_PATH'))
    S.colorFgBg = (await $.env.get('COLORFGBG')) ?? ''
    if (S.setting === 'auto') S.host = (await readHostMode($).catch(() => null)) ?? S.host
    S.theme = resolveMode(S.setting, S.host)
    watchHost($)
    const kept = Number(await $.store.get('size').catch(() => undefined))
    S.size = kept >= MIN_SIZE && kept <= MAX_SIZE ? kept : DEFAULT_SIZE
    const width = await $.store.get('width').catch(() => undefined)
    S.width = width === 'full' ? 'full' : Number.isInteger(width) && Number(width) >= MIN_WIDTH && Number(width) <= MAX_WIDTH ? Number(width) : DEFAULT_WIDTH
    const height = await $.store.get('height').catch(() => undefined)
    S.height = height === 'half' || height === 'full' ? height
      : Number.isInteger(height) && Number(height) >= MIN_HEIGHT && Number(height) <= MAX_HEIGHT ? Number(height) : DEFAULT_HEIGHT
    if ((await $.store.get('enabled').catch(() => undefined)) === false) await update($, isOn, () => false).catch(() => undefined)
    const isMac = os.trim() === 'Darwin'
    setFrame(await readFrame($))
    if (canDraw) watchFrame($)
    const typst = await findTypst($)
    if (!typst) {
      try {
        $.ui.toast(NO_TYPST, { timeoutMs: 8000 })
      } catch {}
    }
    const termFont = await termFontOf($, program, isMac).catch(() => '')
    const home = (await $.env.get('HOME')) ?? ''
    const designs = made3.trim() || (home ? `${home}/.cache/md-preview/designs` : `${cache}/designs`)
    const stored = await $.store.get('theme-name').catch(() => undefined)
    const wanted = typeof stored === 'string' && stored ? stored : DEFAULT_THEME
    const applied = await applyTheme($, root, home, wanted).catch(() => null)
    if (!applied) S.look = { name: BASE_THEME, dir: `${root}/render/themes/${BASE_THEME}`, stamp: '0' }
    else if (applied.chosen.isFallback) {
      try {
        $.ui.toast(`md-preview: theme ${wanted} not found, using ${applied.chosen.name}`, { timeoutMs: 8000 })
      } catch {}
    }
    S.env = {
      typst,
      canDraw,
      inline: ssh && canDraw,
      cache,
      cwd: await $.session.cwd().catch(() => '/'),
      root,
      isMac,
      stamp: String(template?.mtimeMs ?? 0),
      home,
      claudeTmp: claudeTmpOf({
        tmpdir: (await $.env.get('CLAUDE_CODE_TMPDIR')) || undefined,
        uid: await $.process.run(['id', '-u']).then(r => (r.exitCode === 0 ? r.stdout : ''), () => ''),
        isMac,
      }),
      termFont,
      designs,
      metrics: typst ? await measureFonts($, typst, root, cache, termFont, S.look?.dir ?? `${root}/render/themes/${BASE_THEME}`) : DEFAULT_METRICS,
    }
    refresh($)
    return S.env
  })().catch((err: unknown) => {
    S.envLoading = null
    throw err
  })
  return S.envLoading
}
