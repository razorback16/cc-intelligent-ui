// The Env, once per load: the cache folder, Typst, the terminal, its font
// and Frame (then kept by the Frame watcher), the theme and the mode.
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import {
  BASE_THEME, DEFAULT_HEIGHT, DEFAULT_SIZE, DESIGNS_KEPT_DAYS, DEFAULT_THEME, DEFAULT_WIDTH, MAX_HEIGHT, MAX_SIZE, MAX_WIDTH, MIN_HEIGHT, MIN_SIZE, MIN_WIDTH, noTypstOf, USE_COPY_SHIM,
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
import { findClipWay, noShims, setUpShims } from './clipboard'
import { findTypst, measureFonts } from './typst'
import { checkUpdates } from './updates'
import { configs, envGet, fsList, fsStat, pluginRoot, processRun, sessionCwd, sessionVersion, storeGet, uiToast } from './api'

// The `isOn` atom, which setUp turns off when the stored setting says so (a
// copy of its own: see state.ts).
const isOn = atom({ plugin: 'cc-intelligent-ui', key: 'isOn' } as const, true)

// Makes the cache folder (stops when it is a link or not this user's),
// drops key folders not touched for 2 days (not the asks and shims of a
// live process), the ask FIFOs, request files and shims folders of a pid
// that is gone (and request files of 2 days), makes the designs folder
// (outside the tmp cache) and drops design files not touched for
// DESIGNS_KEPT_DAYS; prints the cache folder, the OS name and the designs
// folder (the OS name alone when the cache folder can not be made private).
export const CACHE_SH = `d="\${TMPDIR:-/tmp}"; d="\${d%/}/cc-intelligent-ui-$(id -u)"; g="\${XDG_CACHE_HOME:-$HOME/.cache}/cc-intelligent-ui/designs"; mkdir "$d" 2>/dev/null; [ ! -L "$d" ] && [ -d "$d" ] && [ -O "$d" ] && chmod 700 "$d" && { find "$d" -mindepth 1 -maxdepth 1 -type d -mtime +2 ! -name pkg-cache ! -name ask ! -name 'shims-*' -exec rm -rf {} + 2>/dev/null; for f in "$d"/ask-* "$d"/ask/* "$d"/shims-*; do n=\${f##*/}; n=\${n#ask-}; n=\${n#shims-}; n=\${n%%-*}; case $n in ''|*[!0-9]*) continue ;; esac; kill -0 "$n" 2>/dev/null || rm -rf -- "$f"; done; find "$d/ask" -type f -mtime +2 -delete 2>/dev/null; mkdir -p "$g" 2>/dev/null && find "$g" -type f -mtime +${DESIGNS_KEPT_DAYS} -delete 2>/dev/null; printf '%s\\n%s\\n%s\\n' "$d" "$(uname -s)" "$g"; } || printf '\\n%s\\n\\n' "$(uname -s)"`

// Once per load: the cache folder, Typst, the terminal and its font, the
// theme, the cell. A failed setup is tried again on the next call.
export function setUp($: EngineInterface): Promise<Env> {
  S.envLoading ??= (async () => {
    await registerCommand($)
    const made = await processRun($, ['sh', '-c', CACHE_SH]).catch(() => null)
    const [made1 = '', os = '', made3 = ''] = (made?.stdout ?? '').split('\n')
    const cache = made1.trim() || '/tmp/cc-intelligent-ui'
    // The key folders on disk now: a key found here is read back at once.
    const listed = await fsList($, cache).catch(() => [])
    S.onDisk = new Set(listed.filter(entry => entry.kind === 'dir' && entry.name !== 'pkg-cache').map(entry => entry.name))
    const program = (await envGet($, 'TERM_PROGRAM')) ?? ''
    const term = (await envGet($, 'TERM')) ?? ''
    const ssh = !!(await envGet($, 'SSH_CONNECTION')) || !!(await envGet($, 'SSH_TTY'))
    const background = (await envGet($, 'CLAUDE_CODE_SESSION_KIND')) === 'bg'
    const canDraw = canDrawIn({
      program,
      term,
      kitty: !!(await envGet($, 'KITTY_WINDOW_ID')),
      tmux: !!(await envGet($, 'TMUX')) || !!(await envGet($, 'STY')) || /^tmux|^screen/i.test(term),
      ssh,
      background,
      engineForced: isSet(await envGet($, 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES')),
      modForced: isSet(await envGet($, 'IUI_FORCE')),
    })
    const root = pluginRoot($)
    const template = await fsStat($, `${root}/render/md.typ`).catch(() => null)
    const rows = await configs($).catch(() => [])
    const raw = rows.find(row => row.key === 'theme')?.value
    S.settingRaw = typeof raw === 'string' ? raw : ''
    S.setting = settingOf(raw)
    S.hostOs = os.trim()
    S.termProgram = program
    S.termName = term
    S.itermProfile = (await envGet($, 'ITERM_PROFILE')) || undefined
    S.isKitty = /kitty/i.test(term) || !!(await envGet($, 'KITTY_WINDOW_ID')) || !!(await envGet($, 'KITTY_PID'))
    S.isRemote = ssh
    // On this computer, where pictures draw: the clipboard shims, before Claude Code copies.
    if (!ssh && (S.hostOs === 'Darwin' || S.hostOs === 'Linux')) {
      if (!USE_COPY_SHIM && !isSet(await envGet($, 'IUI_COPY_SHIM'))) noShims('the copy shims are off')
      else if (background) noShims('a background session')
      else if (!canDraw) noShims('no pictures in this terminal')
      // Never in the shared fallback folder.
      else if (made1.trim()) await setUpShims($, cache, S.hostOs === 'Darwin')
      else noShims()
    }
    S.debug = isSet(await envGet($, 'IUI_DEBUG'))
    S.isIterm = isItermIn({
      program,
      profile: S.itermProfile,
      session: (await envGet($, 'ITERM_SESSION_ID')) || undefined,
      lcTerminal: (await envGet($, 'LC_TERMINAL')) || undefined,
    })
    S.setupNeeded = S.isIterm && !canDraw && !ssh && S.hostOs === 'Darwin' &&
      !(await envGet($, 'TMUX')) && !(await envGet($, 'STY')) && (await envGet($, 'CLAUDE_CODE_SESSION_KIND')) !== 'bg'
    if (S.setupNeeded) void offerSetup($).catch(() => undefined)
    S.isCmux = !!(await envGet($, 'CMUX_SURFACE_ID')) || !!(await envGet($, 'CMUX_WORKSPACE_ID')) || !!(await envGet($, 'CMUX_SOCKET_PATH'))
    S.colorFgBg = (await envGet($, 'COLORFGBG')) ?? ''
    if (S.setting === 'auto') S.host = (await readHostMode($).catch(() => null)) ?? S.host
    S.theme = resolveMode(S.setting, S.host)
    watchHost($)
    const kept = Number(await storeGet($, 'size').catch(() => undefined))
    S.size = kept >= MIN_SIZE && kept <= MAX_SIZE ? kept : DEFAULT_SIZE
    const width = await storeGet($, 'width').catch(() => undefined)
    S.width = width === 'full' ? 'full' : Number.isInteger(width) && Number(width) >= MIN_WIDTH && Number(width) <= MAX_WIDTH ? Number(width) : DEFAULT_WIDTH
    const height = await storeGet($, 'height').catch(() => undefined)
    S.height = height === 'half' || height === 'full' ? height
      : Number.isInteger(height) && Number(height) >= MIN_HEIGHT && Number(height) <= MAX_HEIGHT ? Number(height) : DEFAULT_HEIGHT
    S.grid = (await storeGet($, 'grid').catch(() => undefined)) !== false
    S.select = (await storeGet($, 'select').catch(() => undefined)) !== false
    // An engine with no version call is older than picture select.
    S.engine = await Promise.resolve().then(() => sessionVersion($)).then(v => v.base ?? v.version, () => '')
    if ((await storeGet($, 'enabled').catch(() => undefined)) === false) await update($, isOn, () => false).catch(() => undefined)
    const isMac = os.trim() === 'Darwin'
    // Linux, on this computer: the clipboard tools, for the copy.
    if (S.hostOs === 'Linux' && !ssh) void findClipWay($).catch(() => undefined)
    setFrame(await readFrame($))
    if (canDraw) watchFrame($)
    const typst = await findTypst($)
    if (!typst) {
      try {
        uiToast($, noTypstOf(isMac), { timeoutMs: 8000 })
      } catch {}
    }
    const termFont = await termFontOf($, isMac).catch(() => '')
    const home = (await envGet($, 'HOME')) ?? ''
    const designs = made3.trim() || (home ? `${home}/.cache/cc-intelligent-ui/designs` : `${cache}/designs`)
    const stored = await storeGet($, 'theme-name').catch(() => undefined)
    const wanted = typeof stored === 'string' && stored ? stored : DEFAULT_THEME
    const applied = await applyTheme($, root, home, wanted).catch(() => null)
    if (!applied) S.look = { name: BASE_THEME, dir: `${root}/render/themes/${BASE_THEME}`, stamp: '0' }
    else if (applied.chosen.isFallback) {
      try {
        uiToast($, `Intelligent UI: theme ${wanted} not found, using ${applied.chosen.name}`, { timeoutMs: 8000 })
      } catch {}
    }
    S.env = {
      typst,
      canDraw,
      inline: ssh && canDraw,
      cache,
      cwd: await sessionCwd($).catch(() => '/'),
      root,
      isMac,
      stamp: String(template?.mtimeMs ?? 0),
      home,
      claudeTmp: claudeTmpOf({
        tmpdir: (await envGet($, 'CLAUDE_CODE_TMPDIR')) || undefined,
        uid: await processRun($, ['id', '-u']).then(r => (r.exitCode === 0 ? r.stdout : ''), () => ''),
        isMac,
      }),
      termFont,
      designs,
      metrics: typst ? await measureFonts($, typst, root, cache, termFont, S.look?.dir ?? `${root}/render/themes/${BASE_THEME}`) : DEFAULT_METRICS,
    }
    refresh($)
    // The start is done: the update check now, and nothing waits for it.
    void checkUpdates($)
    return S.env
  })().catch((err: unknown) => {
    S.envLoading = null
    throw err
  })
  return S.envLoading
}
