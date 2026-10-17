// Work on the host: the shell snippets Intelligent UI runs, the tty size (one
// read, and the watcher's loop: the size and the clipboard), the terminal's font, and light or dark for auto (the terminal's settings, then
// COLORFGBG, then the OS appearance), read again by a poll.
import type { EngineInterface } from 'claude-code'

import type { IuiTheme } from '../../types'
import { CLIP_WAKE_MS, HOST_CHECK_MS, HOST_POLL_MS, MODES } from './settings'
import { S } from './state'
import { beginEpoch } from './epoch'
import { luminanceOf, modeOfColorFgBg, modeOfGnome, modeOfLuminance, modeOfMacAppearance, parseOsc11, resolveMode, type HostMode } from './mode'
import {
  cmuxAppearanceOf, cmuxSettingsOf, ghosttyBackgroundOf, ghosttyFontOf, ghosttyHasColors, ghosttyThemePaths, ghosttyThemesOf,
  ghosttyValueOf, hexColorOf, itermAppearanceOf, itermFontOf, itermModeOf, jsoncOf, kittyAutoFileOf, kittyBackgroundOf,
  kittyConfigDirsOf, kittyEntriesOf, kittyFontOf, kittySchemeOfGnome, kittyValueOf, parseFontSpec, rioBackgroundOf,
  rioConfigDirOf, rioFontOf, rioForcedOf, rioThemeNamesOf, rioThemePath, tomlStringsOf, type KittyEntries,
} from './terminals'
import { firstLine } from './markdown'

// One tty size read: `rows cols xpixel ypixel` (TIOCGWINSZ); exit 1 with no tty.
export const CELL_SH = `perl -e 'open(T, "</dev/tty") or exit 1; my $w = " " x 8; ioctl(T, ($^O eq "darwin" ? 0x40087468 : 0x5413), $w) or exit 1; print join(" ", unpack("S4", $w))'`
// The watcher (frame.ts): one long-lived perl for the tty size and the
// clipboard. It prints `pid <n>` first, then a line `size rows cols xpixel
// ypixel` at start and at each change. With the argument `clip` (macOS
// only: /usr/bin/perl, which has PerlObjCBridge) it also prints `clip <n>`,
// the clipboard's change count, at start and at each change, read every
// CLIP_WAKE_MS; `clip none` once when the bridge does not load (then only
// the size). It sleeps in sigsuspend with SIGWINCH and SIGALRM blocked
// outside it, so a SIGWINCH that comes while it reads is kept for the next
// sleep (never lost), and it does no work between signals. With no clip,
// an alarm each 10 s wakes it only to see that its parent still runs. Exit
// 1 when /dev/tty does not open (and no clip); exit 0 when the parent dies
// (its parent id changes) or stdout breaks.
export const WATCH_PL = [
  'use POSIX (); use Config; use Time::HiRes ();',
  'my %n; @n{split " ", $Config{sig_name}} = split " ", $Config{sig_num};',
  'my $tty = open(my $t, "<", "/dev/tty");',
  'my $req = $^O eq "darwin" ? 0x40087468 : 0x5413;',
  'my $parent = getppid(); my $last = ""; my $seen = ""; $| = 1;',
  '$SIG{PIPE} = sub { exit 0 }; $SIG{WINCH} = sub {}; $SIG{ALRM} = sub {};',
  'print "pid $$\\n" or exit 0;',
  'my $pb;',
  'if (($ARGV[0] // "") eq "clip") {',
  '  $pb = eval { require Foundation; Foundation->import;',
  '    NSBundle->bundleWithPath_("/System/Library/Frameworks/AppKit.framework")->load;',
  '    @NSPasteboard::ISA = ("PerlObjCBridge"); my $p = NSPasteboard->generalPasteboard; defined $p->changeCount ? $p : undef };',
  '  print "clip none\\n" or exit 0 unless $pb;',
  '}',
  'exit 1 unless $tty || $pb;',
  'POSIX::sigprocmask(POSIX::SIG_BLOCK(), POSIX::SigSet->new($n{WINCH}, $n{ALRM}));',
  'my $none = POSIX::SigSet->new();',
  'while (1) {',
  '  my $w = " " x 8;',
  '  if ($tty && ioctl($t, $req, $w)) {',
  '    my $line = join(" ", unpack("S4", $w));',
  '    if ($line ne $last) { print "size $line\\n" or exit 0; $last = $line; }',
  '  }',
  '  if ($pb) {',
  '    my $c = eval { $pb->changeCount };',
  '    if (defined $c && "$c" ne $seen) { print "clip $c\\n" or exit 0; $seen = "$c"; }',
  '  }',
  '  exit 0 if getppid() != $parent;',
  `  if ($pb) { Time::HiRes::ualarm(${CLIP_WAKE_MS * 1000}); } else { alarm(10); }`,
  '  POSIX::sigsuspend($none);',
  '}',
].join(' ')
// The perl that runs the watcher: on macOS the system's (a Homebrew perl
// has no PerlObjCBridge), else the one on the PATH.
export const perlFor = (isMac: boolean) => (isMac ? '/usr/bin/perl' : 'perl')
const ITERM_BOOKMARKS_SH = `defaults export com.googlecode.iterm2 - | plutil -extract "New Bookmarks" json -o - -`
const ITERM_DEFAULT_SH = `defaults read com.googlecode.iterm2 "Default Bookmark Guid"`
// A PostScript name (argv[0]) to its family name.
const FAMILY_JXA = 'function run(argv) { ObjC.import("AppKit"); var f = $.NSFont.fontWithNameSize(argv[0], 12); return f.isNil() ? "" : f.familyName.js }'
// iTerm2's appearance, the default profile's GUID and the profiles, split by "@" lines.
const ITERM_MODE_SH = `defaults read com.googlecode.iterm2 TabStyleWithAutomaticOption 2>/dev/null; echo @; ${ITERM_DEFAULT_SH} 2>/dev/null; echo @; ${ITERM_BOOKMARKS_SH}`
const GHOSTTY_SH = `"\${GHOSTTY_BIN_DIR:+\$GHOSTTY_BIN_DIR/}ghostty" +show-config`
// Asks the terminal for its background (OSC 11) and prints the answer. It
// opens the tty itself, non-blocking, changes no tty mode, and waits 300 ms at
// most. Claude Code reads the same tty, so the answer may go to it instead.
export const OSC11_PL = [
  'use Fcntl; use IO::Select; use Time::HiRes qw(time);',
  'sysopen(my $t, "/dev/tty", O_RDWR | O_NONBLOCK | O_NOCTTY) or exit 1;',
  'syswrite($t, "\\e]11;?\\a");',
  'my $s = IO::Select->new($t); my $r = ""; my $end = time + 0.3;',
  'while ((my $left = $end - time) > 0) {',
  '  last unless $s->can_read($left);',
  '  my $n = sysread($t, my $b, 256);',
  '  last if !defined $n && !$!{EAGAIN}; last if defined $n && $n == 0;',
  '  $r .= $b if $n; last if $r =~ /\\a|\\e\\\\/;',
  '}',
  'print $r;',
].join(' ')
// Off until /iui probe shows the answer reaches the mod: the poll
// then asks the terminal (source 1 of auto) every period.
export const USE_OSC11 = false
export const PROBE_RUNS = 5
export const HEADERS_SH = `for f in "$@"; do head -c 24 "$f" | od -An -v -tx1; echo @; done`

// The terminal's font family: iTerm2's profile font, Ghostty's font-family,
// kitty's font_family, Rio's [fonts] family; '' elsewhere or when it can't
// be read.
export async function termFontOf($: EngineInterface, program: string, isMac: boolean): Promise<string> {
  // Over ssh, a config here is not the one of the user's terminal.
  if (S.isRemote) return ''
  if (S.isIterm && isMac) {
    const profile = await $.env.get('ITERM_PROFILE')
    const [marks, guid] = await Promise.all([
      $.process.run(['sh', '-c', ITERM_BOOKMARKS_SH], { timeoutMs: 5000 }).catch(() => null),
      $.process.run(['sh', '-c', ITERM_DEFAULT_SH], { timeoutMs: 5000 }).catch(() => null),
    ])
    const spec = parseFontSpec(itermFontOf(marks?.stdout ?? '', profile, guid?.stdout ?? '') ?? '')
    if (!spec) return ''
    const named = await $.process.run(['osascript', '-l', 'JavaScript', '-e', FAMILY_JXA, spec.name], { timeoutMs: 5000 }).catch(() => null)
    return named?.exitCode === 0 ? firstLine(named.stdout) : ''
  }
  if (/ghostty/i.test(program)) {
    const shown = await $.process.run(['sh', '-c', GHOSTTY_SH], { timeoutMs: 5000 }).catch(() => null)
    return ghosttyFontOf(shown?.stdout ?? '') ?? ''
  }
  if (S.isKitty) {
    // A family name as is; a PostScript name to its family (macOS); the
    // system's monospace from fontconfig (Linux; on macOS it is Menlo).
    const font = kittyFontOf(kittyValueOf((await readKittyConfig($)).entries, 'font_family'))
    if (font && 'family' in font) return font.family
    if (font && isMac) {
      const named = await $.process.run(['osascript', '-l', 'JavaScript', '-e', FAMILY_JXA, font.postscript], { timeoutMs: 5000 }).catch(() => null)
      return named?.exitCode === 0 ? firstLine(named.stdout) : ''
    }
    if (!font && !isMac) {
      const got = await $.process.run(['fc-match', 'monospace', '-f', '%{family}'], { timeoutMs: 5000 }).catch(() => null)
      return got?.exitCode === 0 ? (got.stdout.split(',')[0] ?? '').trim() : ''
    }
    return ''
  }
  if (isRioHere()) return rioFontOf((await readRioConfig($)).config)
  return ''
}

// The mode for auto now, or null when nothing can be read (keep the last
// one): 1. the terminal's OSC 11 answer (off, see USE_OSC11); 2. the
// terminal's own settings (iTerm2's profile, Ghostty's, kitty's or Rio's
// config); 3. COLORFGBG at start; 4. the
// OS appearance; 5. dark (resolveMode). The terminal comes before the OS: a
// dark terminal on a light Mac is dark. Over ssh, only COLORFGBG (when ssh
// sends it): the configs and the OS here are the remote computer's.
export async function readHostMode($: EngineInterface): Promise<HostMode | null> {
  if (USE_OSC11) {
    const bg = parseOsc11((await probeOsc11($))?.reply ?? '')
    if (bg) return { mode: modeOfLuminance(luminanceOf(bg)), source: 'terminal', detail: 'OSC 11 background' }
  }
  if (S.isRemote) {
    const mode = modeOfColorFgBg(S.colorFgBg)
    return mode ? { mode, source: 'COLORFGBG' } : null
  }
  const term =
    (await readItermMode($).catch(() => null)) ??
    (await readGhosttyMode($).catch(() => null)) ??
    (await readKittyMode($).catch(() => null)) ??
    (await readRioMode($).catch(() => null))
  if (term) return term
  const mode = modeOfColorFgBg(S.colorFgBg)
  if (mode) return { mode, source: 'COLORFGBG' }
  return readOsMode($).catch(() => null)
}

// The background of the iTerm2 profile in use, on a Mac.
async function readItermMode($: EngineInterface): Promise<HostMode | null> {
  if (!S.isIterm || S.hostOs !== 'Darwin') return null
  const got = await $.process.run(['sh', '-c', ITERM_MODE_SH], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  if (!got || got.exitCode !== 0) return null
  const [style = '', guid = '', marks = ''] = got.stdout.split(/^@\n/m)
  const appearance = itermAppearanceOf(style) ?? (await readOsMode($).catch(() => null))?.mode ?? null
  const mode = itermModeOf(marks, S.itermProfile, guid, appearance)
  return mode ? { mode, source: 'iTerm2', detail: `profile ${S.itermProfile || 'default'} background` } : null
}

// One OSC 11 question to the terminal: its raw answer ('' for none), or null
// when the tty could not be opened.
export async function probeOsc11($: EngineInterface): Promise<{ reply: string } | null> {
  const got = await $.process.run(['perl', '-e', OSC11_PL], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  return got && got.exitCode === 0 ? { reply: got.stdout } : null
}

// The background of Ghostty's config. A `light:A,dark:B` theme follows the OS.
async function readGhosttyMode($: EngineInterface): Promise<HostMode | null> {
  if (!/ghostty/i.test(S.termProgram + S.termName)) return null
  const got = await $.process.run(['sh', '-c', GHOSTTY_SH], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  if (!got || got.exitCode !== 0) return null
  if (S.isCmux && !ghosttyHasColors(got.stdout)) {
    const adaptive = await readCmuxMode($).catch(() => null)
    if (adaptive) return adaptive
  }
  const pair = ghosttyThemesOf(ghosttyValueOf(got.stdout, 'theme'))
  const themeBg: { light?: string; dark?: string } = {}
  let appearance: IuiTheme | null = null
  if (pair) {
    appearance = (await readOsMode($).catch(() => null))?.mode ?? null
    const where = {
      xdgConfig: (await $.env.get('XDG_CONFIG_HOME')) || undefined,
      home: (await $.env.get('HOME')) ?? '',
      resources: (await $.env.get('GHOSTTY_RESOURCES_DIR')) || undefined,
    }
    for (const mode of MODES) {
      for (const path of ghosttyThemePaths(pair[mode], where)) {
        const text = await $.fs.read(path).catch(() => null)
        if (typeof text !== 'string') continue
        themeBg[mode] = ghosttyValueOf(text, 'background')
        break
      }
    }
  }
  const bg = hexColorOf(ghosttyBackgroundOf(got.stdout, appearance, themeBg) ?? '')
  if (!bg) return null
  const shown = ghosttyValueOf(got.stdout, 'background')
  const detail = `${!shown ? 'default' : pair && appearance ? `theme ${pair[appearance]}` : 'config'} background`
  return { mode: modeOfLuminance(luminanceOf(bg)), source: 'Ghostty', detail }
}

// cmux with no colours in the Ghostty config: its adaptive default theme
// (terminal.adaptiveDefaultTheme, on unless cmux.json turns it off) follows
// cmux's appearance, the OS's when that is system. Null when it is off.
async function readCmuxMode($: EngineInterface): Promise<HostMode | null> {
  const home = (await $.env.get('HOME')) ?? ''
  const settings = cmuxSettingsOf(jsoncOf((await readText($, `${home}/.config/cmux/cmux.json`)) ?? ''))
  if (settings.adaptive === false) return null
  let saved = ''
  if (!settings.appearance && S.hostOs === 'Darwin') {
    const got = await $.process.run(['defaults', 'read', 'com.cmuxterm.app', 'appearanceMode'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    saved = got?.exitCode === 0 ? got.stdout : ''
  }
  const appearance = cmuxAppearanceOf(settings.appearance, saved)
  const mode = appearance === 'system' ? ((await readOsMode($).catch(() => null))?.mode ?? null) : appearance
  return mode ? { mode, source: 'cmux', detail: `adaptive default theme, appearance ${appearance}` } : null
}

// Rio sets TERM_PROGRAM=rio, and TERM=rio when its terminfo is installed.
const isRioHere = () => /^rio$/i.test(S.termProgram) || /^rio$/i.test(S.termName)

// A file's text, or null when it can't be read.
export async function readText($: EngineInterface, path: string): Promise<string | null> {
  const text = await $.fs.read(path).catch(() => null)
  return typeof text === 'string' ? text : null
}

// kitty's config folder and kitty.conf with its includes: the first folder
// that has a kitty.conf, else the first folder (auto theme files can be there).
async function readKittyConfig($: EngineInterface): Promise<{ dir: string; entries: KittyEntries; home: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  const dirs = kittyConfigDirsOf({
    kittyDir: (await $.env.get('KITTY_CONFIG_DIRECTORY')) || undefined,
    xdgConfig: (await $.env.get('XDG_CONFIG_HOME')) || undefined,
    home,
    isMac: S.hostOs === 'Darwin',
  })
  const o = { home, vars: { KITTY_OS: S.hostOs === 'Darwin' ? 'macos' : S.hostOs.toLowerCase() } }
  for (const dir of dirs) {
    if (!(await $.fs.exists(`${dir}/kitty.conf`).catch(() => false))) continue
    return { dir, entries: await kittyEntriesOf(`${dir}/kitty.conf`, path => readText($, path), o), home }
  }
  return { dir: dirs[0]!, entries: [], home }
}

// The background of kitty's config. Auto theme files (kitty 0.38+) follow
// the OS: the OS is read only when one of them exists.
async function readKittyMode($: EngineInterface): Promise<HostMode | null> {
  if (!S.isKitty) return null
  const { dir, entries, home } = await readKittyConfig($)
  const schemes = ['dark', 'light', 'no-preference'] as const
  const found = await Promise.all(schemes.map(s => $.fs.exists(`${dir}/${kittyAutoFileOf(s)}`).catch(() => false)))
  let auto: { file: string; entries: KittyEntries } | null = null
  if (found.some(Boolean)) {
    let scheme: (typeof schemes)[number] | null = null
    if (S.hostOs === 'Linux') {
      const got = await $.process.run(['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
      scheme = got && got.exitCode === 0 ? kittySchemeOfGnome(got.stdout) : null
    } else scheme = (await readOsMode($).catch(() => null))?.mode ?? null
    if (scheme && found[schemes.indexOf(scheme)]) {
      const file = kittyAutoFileOf(scheme)
      auto = { file, entries: await kittyEntriesOf(`${dir}/${file}`, path => readText($, path), { home }) }
    }
  }
  const got = kittyBackgroundOf(entries, auto)
  const bg = hexColorOf(got.bg)
  return bg ? { mode: modeOfLuminance(luminanceOf(bg)), source: 'kitty', detail: got.detail } : null
}

// Rio's config folder and its config.toml's string values.
async function readRioConfig($: EngineInterface): Promise<{ dir: string; config: Record<string, string> }> {
  const dir = rioConfigDirOf({
    rioHome: (await $.env.get('RIO_CONFIG_HOME')) || undefined,
    xdgConfig: (await $.env.get('XDG_CONFIG_HOME')) || undefined,
    home: (await $.env.get('HOME')) ?? '',
    isMac: S.hostOs === 'Darwin',
  })
  return { dir, config: tomlStringsOf((await readText($, `${dir}/config.toml`)) ?? '') }
}

// The background of Rio's config. An `[adaptive-theme]` follows the OS
// unless `force-theme` is set: the OS is read only then.
async function readRioMode($: EngineInterface): Promise<HostMode | null> {
  if (!isRioHere()) return null
  const { dir, config } = await readRioConfig($)
  const themes: Record<string, string | null> = {}
  for (const name of rioThemeNamesOf(config)) themes[name] = await readText($, rioThemePath(dir, name))
  const adaptive = !!config['adaptive-theme.light'] && !!config['adaptive-theme.dark'] && !rioForcedOf(config)
  const appearance = adaptive ? ((await readOsMode($).catch(() => null))?.mode ?? null) : null
  const got = rioBackgroundOf(config, appearance, themes)
  const bg = hexColorOf(got.bg)
  return bg ? { mode: modeOfLuminance(luminanceOf(bg)), source: 'Rio', detail: got.detail } : null
}

// The OS appearance: macOS, or GNOME's colour scheme on Linux.
async function readOsMode($: EngineInterface): Promise<HostMode | null> {
  if (S.hostOs === 'Darwin') {
    const got = await $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    return got ? { mode: modeOfMacAppearance(got.exitCode, got.stdout), source: 'macOS' } : null
  }
  if (S.hostOs === 'Linux') {
    const got = await $.process.run(['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    const mode = got && got.exitCode === 0 ? modeOfGnome(got.stdout) : null
    if (mode) return { mode, source: 'GNOME' }
  }
  return null
}

// One read of the OS appearance (never two at once); a changed mode redraws.
export async function pollHost($: EngineInterface) {
  if (S.checking || S.setting !== 'auto') return
  S.checking = true
  try {
    S.host = (await readHostMode($).catch(() => null)) ?? S.host
  } finally {
    S.checking = false
  }
  showMode($)
}

// Draws in the mode the setting and the OS give, when it changed: a new
// epoch, so all pictures swap to the new mode in one redraw.
export function showMode($: EngineInterface) {
  const next = resolveMode(S.setting, S.host)
  if (next === S.theme) return
  S.theme = next
  beginEpoch($)
}

// Polls the OS appearance while the setting is auto, and only then.
export function watchHost($: EngineInterface) {
  if (S.setting === 'auto' && !S.watch) {
    try {
      S.watch = $.clock.every(HOST_POLL_MS, () => void pollHost($).catch(() => undefined))
    } catch {
      S.watch = null
    }
  } else if (S.setting !== 'auto' && S.watch) {
    S.watch.cancel()
    S.watch = null
  }
}
