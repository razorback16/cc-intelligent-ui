// Work on the host: the shell snippets Intelligent UI runs, the tty size (one
// read, and the watcher's loop: the size and the clipboard), the terminal's font, and light or dark for auto (the terminal's settings, then
// COLORFGBG, then the OS appearance), read again by a poll.
import type { EngineInterface } from 'claude-code'

import type { IuiTheme } from '../../types'
import { CLIP_WAKE_MS, HOST_CHECK_MS, HOST_POLL_MS, MODES } from './settings'
import { S } from './state'
import { beginEpoch } from './epoch'
import { luminanceOf, modeOfColorFgBg, modeOfLuminance, modeOfMacAppearance, parseOsc11, resolveMode, schemeOfPortal, type HostMode } from './mode'
import {
  cmuxAppearanceOf, cmuxConfigOf, cmuxGhosttyConfigPath, cmuxSettingsOf, familyOfFc, GHOSTTY_DEFAULT_FONT, ghosttyBackgroundOf, ghosttyFontOf, ghosttyHasColors,
  ghosttyThemePaths, ghosttyThemesOf,
  ghosttyValueOf, hexColorOf, itermAppearanceOf, itermFontOf, itermModeOf, jsoncOf, kittyAutoFileOf, kittyBackgroundOf,
  kittyConfigDirsOf, kittyEntriesOf, kittyFontOf, kittySchemeOfGnome, kittyValueOf, parseFontSpec, rioBackgroundOf,
  rioConfigDirOf, rioFontOf, rioForcedOf, rioThemeNamesOf, rioThemePath, tomlStringsOf, type CmuxAppearance, type KittyEntries,
} from './terminals'
import { firstLine } from './markdown'
import { isGhosttyHere } from './terminal'
import { clockEvery, envGet, fsExists, fsRead, processRun } from './api'

// One tty size read: `rows cols xpixel ypixel` (TIOCGWINSZ); exit 1 with no tty.
export const CELL_SH = `perl -e 'open(T, "</dev/tty") or exit 1; my $w = " " x 8; ioctl(T, ($^O eq "darwin" ? 0x40087468 : 0x5413), $w) or exit 1; print join(" ", unpack("S4", $w))'`
// The watcher (frame.ts): one long-lived perl for the tty size and the
// clipboard. It prints `pid <n>` first, then a line `size rows cols xpixel
// ypixel` at start and at each change. With the argument `clip` alone
// (macOS: /usr/bin/perl, which has PerlObjCBridge) it also prints `clip
// <n>`, the clipboard's change count, at start and at each change, read
// every CLIP_WAKE_MS; `clip none` once when the bridge does not load (then
// only the size). With `clip` and a command (Linux: the notifier of
// clipboard.ts), a child of its own process group runs that command and
// prints `clip <n>` (0, 1, ...) for each line the command prints, and `clip
// none` when it ends; the watcher stops that group when it exits. It sleeps
// in sigsuspend with SIGWINCH and SIGALRM blocked outside it, so a SIGWINCH
// that comes while it reads is kept for the next sleep (never lost), and it
// does no work between signals. With no bridge, an alarm each 10 s wakes it
// only to see that its parent still runs. Exit 1 when /dev/tty does not
// open (and no clip); exit 0 when the parent dies (its parent id changes),
// stdout breaks, or (with a notifier) at SIGTERM.
export const WATCH_PL = [
  'use POSIX (); use Config; use Time::HiRes ();',
  'my %n; @n{split " ", $Config{sig_name}} = split " ", $Config{sig_num};',
  'my $tty = open(my $t, "<", "/dev/tty");',
  'my $req = $^O eq "darwin" ? 0x40087468 : 0x5413;',
  'my $parent = getppid(); my $last = ""; my $seen = ""; $| = 1;',
  '$SIG{PIPE} = sub { exit 0 }; $SIG{WINCH} = sub {}; $SIG{ALRM} = sub {};',
  'print "pid $$\\n" or exit 0;',
  'my $pb; my $relay;',
  'if (($ARGV[0] // "") eq "clip" && @ARGV > 1) {',
  '  $relay = fork();',
  '  if (defined $relay && !$relay) {',
  '    $SIG{PIPE} = "IGNORE"; $SIG{WINCH} = "DEFAULT"; $SIG{ALRM} = "DEFAULT"; setpgrp(0, 0); my $c; my $k = 0;',
  '    if (open($c, "-|", @ARGV[1 .. $#ARGV])) { while (<$c>) { print "clip $k\\n" or last; $k++; } }',
  '    print "clip none\\n"; kill "TERM", -$$; POSIX::_exit(0);',
  '  }',
  '  if ($relay) { setpgrp($relay, $relay); $SIG{TERM} = sub { exit 0 }; } else { print "clip none\\n" or exit 0; }',
  '} elsif (($ARGV[0] // "") eq "clip") {',
  '  $pb = eval { require Foundation; Foundation->import;',
  '    NSBundle->bundleWithPath_("/System/Library/Frameworks/AppKit.framework")->load;',
  '    @NSPasteboard::ISA = ("PerlObjCBridge"); my $p = NSPasteboard->generalPasteboard; defined $p->changeCount ? $p : undef };',
  '  print "clip none\\n" or exit 0 unless $pb;',
  '}',
  'END { kill "TERM", -$relay if $relay; }',
  'exit 1 unless $tty || $pb || $relay;',
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
// Copies the JetBrains Mono that Ghostty carries in its program (no font
// files: the TrueType data is inside it) to a folder that Typst can read,
// once per Ghostty build: the variable Regular and Italic (an `fvar` table
// and the family in the `name` table), each size once (a universal program
// has a copy per CPU). The folder is in the user cache, by the program's
// path, size and mtime; it prints the folder, and exit 1 when no font was
// found. Made in a temporary folder first, so a compile never sees half.
export const GHOSTTY_FONTS_PL = [
  'use strict;',
  'my $f = shift or exit 1;',
  'my @st = stat($f) or exit 1;',
  'my $base = ($ENV{XDG_CACHE_HOME} || "$ENV{HOME}/.cache") . "/cc-intelligent-ui/fonts";',
  'my $key = unpack("%32C*", $f) . "-$st[7]-$st[9]";',
  'my $d = "$base/ghostty-$key";',
  'if (-d $d) { utime(undef, undef, $d); print "$d\\n"; exit 0 }',
  'open(my $h, "<:raw", $f) or exit 1; my $b = do { local $/; <$h> }; close $h;',
  'my $want = "\\0" . join("\\0", split(//, "JetBrains Mono"));',
  'system("mkdir", "-p", $base) == 0 or exit 1;',
  'my $t = "$d.$$"; mkdir($t) or exit 1;',
  'my (%seen, $n);',
  'while ($b =~ /\\x00\\x01\\x00\\x00/g) {',
  '  my $o = pos($b) - 4; my $k = unpack("n", substr($b, $o + 4, 2));',
  '  next if $k < 4 || $k > 40;',
  '  my ($end, $fvar, $name, $bad) = (0, 0, "", 0);',
  '  for my $i (0 .. $k - 1) {',
  '    my ($tag, $cs, $off, $len) = unpack("a4NNN", substr($b, $o + 12 + 16 * $i, 16));',
  '    if ($tag !~ m{^[A-Za-z0-9/ ]{4}$} || $off + $len > 20000000) { $bad = 1; last }',
  '    $end = $off + $len if $off + $len > $end;',
  '    $fvar = 1 if $tag eq "fvar";',
  '    $name = substr($b, $o + $off, $len) if $tag eq "name";',
  '  }',
  '  next if $bad || !$fvar || index($name, $want) < 0 || $seen{$end}++;',
  '  open(my $w, ">:raw", "$t/JetBrainsMono-" . ++$n . ".ttf") or next;',
  '  print $w substr($b, $o, $end); close $w;',
  '}',
  'if (!$n) { rmdir $t; exit 1 }',
  'rename($t, $d) or system("rm", "-rf", $t);',
  '-d $d or exit 1; print "$d\\n";',
].join('\n')
// Runs GHOSTTY_FONTS_PL (with the perl of perlFor) on the first Ghostty
// program found: the one of GHOSTTY_BIN_DIR, the PATH's, then each other
// argument (the apps' places).
export const GHOSTTY_FONTS_SH = [
  'perl=$1; pl=$2; shift 2',
  'for f in "${GHOSTTY_BIN_DIR:+$GHOSTTY_BIN_DIR/ghostty}" "$(command -v ghostty)" "$@"; do',
  '  [ -n "$f" ] && [ -f "$f" ] && exec "$perl" -e "$pl" "$f"',
  'done',
  'exit 1',
].join('\n')
// Where the apps keep their Ghostty program.
const GHOSTTY_PROGRAMS = ['/Applications/cmux.app/Contents/Resources/bin/ghostty', '/Applications/Ghostty.app/Contents/MacOS/ghostty']
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
// be read. On Linux, when the terminal's config names none: fontconfig's
// monospace font (fc-match), which kitty and most terminals use.
export async function termFontOf($: EngineInterface, isMac: boolean): Promise<string> {
  // Over ssh, a config here is not the one of the user's terminal.
  if (S.isRemote) return ''
  const font = await configFontOf($, isMac)
  if (font || isMac) return font
  return fcFamily($, 'monospace')
}

// A family fontconfig gives for a pattern (the first of its names), '' when
// fc-match fails. `fc-match` always gives a font, the nearest one.
async function fcFamily($: EngineInterface, pattern: string): Promise<string> {
  const got = await processRun($, ['fc-match', pattern, '-f', '%{family}'], { timeoutMs: 5000 }).catch(() => null)
  return got?.exitCode === 0 ? familyOfFc(got.stdout) : ''
}

// Ghostty draws its own JetBrains Mono when no font-family is set. Typst
// draws it from the system's fonts when fontconfig has it (Linux), else
// from a copy of the one in Ghostty's program (S.fontPaths).
async function ghosttyDefaultFont($: EngineInterface, isMac: boolean): Promise<string> {
  const got = await processRun($, ['fc-list', '-q', GHOSTTY_DEFAULT_FONT], { timeoutMs: 5000 }).catch(() => null)
  if (got?.exitCode === 0) return GHOSTTY_DEFAULT_FONT
  const made = await processRun($, ['sh', '-c', GHOSTTY_FONTS_SH, 'sh', perlFor(isMac), GHOSTTY_FONTS_PL, ...GHOSTTY_PROGRAMS], { timeoutMs: 10000 }).catch(() => null)
  const dir = made?.exitCode === 0 ? firstLine(made.stdout) : ''
  if (!dir) return ''
  S.fontPaths = dir
  return GHOSTTY_DEFAULT_FONT
}

// The font that the terminal's own config or profile names.
async function configFontOf($: EngineInterface, isMac: boolean): Promise<string> {
  if (S.isIterm && isMac) {
    const profile = await envGet($, 'ITERM_PROFILE')
    const [marks, guid] = await Promise.all([
      processRun($, ['sh', '-c', ITERM_BOOKMARKS_SH], { timeoutMs: 5000 }).catch(() => null),
      processRun($, ['sh', '-c', ITERM_DEFAULT_SH], { timeoutMs: 5000 }).catch(() => null),
    ])
    const spec = parseFontSpec(itermFontOf(marks?.stdout ?? '', profile, guid?.stdout ?? '') ?? '')
    if (!spec) return ''
    const named = await processRun($, ['osascript', '-l', 'JavaScript', '-e', FAMILY_JXA, spec.name], { timeoutMs: 5000 }).catch(() => null)
    return named?.exitCode === 0 ? firstLine(named.stdout) : ''
  }
  if (isGhosttyHere()) {
    const shown = await processRun($, ['sh', '-c', GHOSTTY_SH], { timeoutMs: 5000 }).catch(() => null)
    return ghosttyFontOf(shown?.stdout ?? '') ?? (await ghosttyDefaultFont($, isMac))
  }
  if (S.isKitty) {
    // A family name as is; a PostScript name to its family (macOS: AppKit;
    // Linux: fontconfig); the system's monospace from fontconfig (Linux,
    // termFontOf; on macOS it is Menlo).
    const font = kittyFontOf(kittyValueOf((await readKittyConfig($)).entries, 'font_family'))
    if (font && 'family' in font) return font.family
    if (font && isMac) {
      const named = await processRun($, ['osascript', '-l', 'JavaScript', '-e', FAMILY_JXA, font.postscript], { timeoutMs: 5000 }).catch(() => null)
      return named?.exitCode === 0 ? firstLine(named.stdout) : ''
    }
    if (font) return fcFamily($, `:postscriptname=${font.postscript}`)
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
  const got = await processRun($, ['sh', '-c', ITERM_MODE_SH], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  if (!got || got.exitCode !== 0) return null
  const [style = '', guid = '', marks = ''] = got.stdout.split(/^@\n/m)
  const appearance = itermAppearanceOf(style) ?? (await readOsMode($).catch(() => null))?.mode ?? null
  const mode = itermModeOf(marks, S.itermProfile, guid, appearance)
  return mode ? { mode, source: 'iTerm2', detail: `profile ${S.itermProfile || 'default'} background` } : null
}

// One OSC 11 question to the terminal: its raw answer ('' for none), or null
// when the tty could not be opened.
export async function probeOsc11($: EngineInterface): Promise<{ reply: string } | null> {
  const got = await processRun($, ['perl', '-e', OSC11_PL], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  return got && got.exitCode === 0 ? { reply: got.stdout } : null
}

// The background of Ghostty's config. A `light:A,dark:B` theme follows the OS
// (in cmux, cmux's appearance). In cmux, cmux's own config is read as well.
async function readGhosttyMode($: EngineInterface): Promise<HostMode | null> {
  if (!/ghostty/i.test(S.termProgram + S.termName)) return null
  const got = await processRun($, ['sh', '-c', GHOSTTY_SH], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  if (!got || got.exitCode !== 0) return null
  const home = (await envGet($, 'HOME')) ?? ''
  const own = S.isCmux ? ((await readText($, cmuxGhosttyConfigPath(home))) ?? '') : ''
  const config = cmuxConfigOf(got.stdout, own)
  if (S.isCmux && !ghosttyHasColors(config)) {
    const adaptive = await readCmuxMode($).catch(() => null)
    if (adaptive) return adaptive
  }
  const pair = ghosttyThemesOf(ghosttyValueOf(config, 'theme'))
  const themeBg: { light?: string; dark?: string } = {}
  let appearance: IuiTheme | null = null
  if (pair) {
    appearance = S.isCmux ? ((await readCmuxAppearance($).catch(() => null))?.mode ?? null) : ((await readOsMode($).catch(() => null))?.mode ?? null)
    const where = {
      xdgConfig: (await envGet($, 'XDG_CONFIG_HOME')) || undefined,
      home,
      resources: (await envGet($, 'GHOSTTY_RESOURCES_DIR')) || undefined,
    }
    for (const mode of MODES) {
      for (const path of ghosttyThemePaths(pair[mode], where)) {
        const text = await fsRead($, path).catch(() => null)
        if (typeof text !== 'string') continue
        themeBg[mode] = ghosttyValueOf(text, 'background')
        break
      }
    }
  }
  const bg = hexColorOf(ghosttyBackgroundOf(config, appearance, themeBg) ?? '')
  if (!bg) return null
  const shown = ghosttyValueOf(config, 'background')
  const detail = `${pair && appearance ? `theme ${pair[appearance]}` : !shown ? 'default' : 'config'} background`
  return { mode: modeOfLuminance(luminanceOf(bg)), source: ghosttyValueOf(own, 'theme') ? 'cmux' : 'Ghostty', detail }
}

// cmux with no colours in the Ghostty config: its adaptive default theme
// (terminal.adaptiveDefaultTheme, on unless cmux.json turns it off) follows
// cmux's appearance, the OS's when that is system. Null when it is off.
async function readCmuxMode($: EngineInterface): Promise<HostMode | null> {
  const home = (await envGet($, 'HOME')) ?? ''
  const settings = cmuxSettingsOf(jsoncOf((await readText($, `${home}/.config/cmux/cmux.json`)) ?? ''))
  if (settings.adaptive === false) return null
  const seen = await readCmuxAppearance($, settings.appearance)
  return seen ? { mode: seen.mode, source: 'cmux', detail: `adaptive default theme, appearance ${seen.appearance}` } : null
}

// cmux's appearance (cmux.json's, else the one saved in Settings) and the
// mode it gives: the OS's when it is system. Null when that is not known.
async function readCmuxAppearance($: EngineInterface, file?: CmuxAppearance): Promise<{ mode: IuiTheme; appearance: CmuxAppearance } | null> {
  if (file === undefined) {
    const home = (await envGet($, 'HOME')) ?? ''
    file = cmuxSettingsOf(jsoncOf((await readText($, `${home}/.config/cmux/cmux.json`)) ?? '')).appearance
  }
  let saved = ''
  if (!file && S.hostOs === 'Darwin') {
    const got = await processRun($, ['defaults', 'read', 'com.cmuxterm.app', 'appearanceMode'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    saved = got?.exitCode === 0 ? got.stdout : ''
  }
  const appearance = cmuxAppearanceOf(file, saved)
  const mode = appearance === 'system' ? ((await readOsMode($).catch(() => null))?.mode ?? null) : appearance
  return mode ? { mode, appearance } : null
}

// Rio sets TERM_PROGRAM=rio, and TERM=rio when its terminfo is installed.
const isRioHere = () => /^rio$/i.test(S.termProgram) || /^rio$/i.test(S.termName)

// A file's text, or null when it can't be read.
export async function readText($: EngineInterface, path: string): Promise<string | null> {
  const text = await fsRead($, path).catch(() => null)
  return typeof text === 'string' ? text : null
}

// kitty's config folder and kitty.conf with its includes: the first folder
// that has a kitty.conf, else the first folder (auto theme files can be there).
async function readKittyConfig($: EngineInterface): Promise<{ dir: string; entries: KittyEntries; home: string }> {
  const home = (await envGet($, 'HOME')) ?? ''
  const dirs = kittyConfigDirsOf({
    kittyDir: (await envGet($, 'KITTY_CONFIG_DIRECTORY')) || undefined,
    xdgConfig: (await envGet($, 'XDG_CONFIG_HOME')) || undefined,
    home,
    isMac: S.hostOs === 'Darwin',
  })
  const o = { home, vars: { KITTY_OS: S.hostOs === 'Darwin' ? 'macos' : S.hostOs.toLowerCase() } }
  for (const dir of dirs) {
    if (!(await fsExists($, `${dir}/kitty.conf`).catch(() => false))) continue
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
  const found = await Promise.all(schemes.map(s => fsExists($, `${dir}/${kittyAutoFileOf(s)}`).catch(() => false)))
  let auto: { file: string; entries: KittyEntries } | null = null
  if (found.some(Boolean)) {
    let scheme: (typeof schemes)[number] | null = null
    if (S.hostOs === 'Linux') scheme = (await readLinuxScheme($).catch(() => null))?.scheme ?? null
    else scheme = (await readOsMode($).catch(() => null))?.mode ?? null
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
    rioHome: (await envGet($, 'RIO_CONFIG_HOME')) || undefined,
    xdgConfig: (await envGet($, 'XDG_CONFIG_HOME')) || undefined,
    home: (await envGet($, 'HOME')) ?? '',
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

// The OS appearance: macOS, or on Linux the desktop's colour scheme
// (readLinuxScheme; no preference is light, as GNOME's default is).
async function readOsMode($: EngineInterface): Promise<HostMode | null> {
  if (S.hostOs === 'Darwin') {
    const got = await processRun($, ['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    return got ? { mode: modeOfMacAppearance(got.exitCode, got.stdout), source: 'macOS' } : null
  }
  if (S.hostOs === 'Linux') {
    const seen = await readLinuxScheme($).catch(() => null)
    if (seen) return { mode: seen.scheme === 'dark' ? 'dark' : 'light', source: seen.source }
  }
  return null
}

// The freedesktop portal's colour scheme (GNOME, KDE and others: the value
// kitty reads too), by gdbus, else busctl. The first tool that works is
// kept, so each check runs one process; when neither works, GNOME's
// gsettings is read in its place.
const PORTAL_ARGS = {
  gdbus: ['gdbus', 'call', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop',
    '--method', 'org.freedesktop.portal.Settings.Read', 'org.freedesktop.appearance', 'color-scheme'],
  busctl: ['busctl', '--user', 'call', 'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Settings',
    'Read', 'ss', 'org.freedesktop.appearance', 'color-scheme'],
} as const
type LinuxScheme = { scheme: 'dark' | 'light' | 'no-preference'; source: 'desktop portal' | 'GNOME' }
async function readLinuxScheme($: EngineInterface): Promise<LinuxScheme | null> {
  const tools = S.portalTool === null ? (['gdbus', 'busctl'] as const) : S.portalTool ? [S.portalTool] : []
  for (const tool of tools) {
    const got = await processRun($, PORTAL_ARGS[tool], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    const scheme = got && got.exitCode === 0 ? schemeOfPortal(got.stdout) : null
    if (scheme) {
      S.portalTool = tool
      return { scheme, source: 'desktop portal' }
    }
  }
  if (S.portalTool === null) S.portalTool = ''
  if (S.portalTool) return null
  const got = await processRun($, ['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  const scheme = got && got.exitCode === 0 ? kittySchemeOfGnome(got.stdout) : null
  return scheme ? { scheme, source: 'GNOME' } : null
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
      S.watch = clockEvery($, HOST_POLL_MS, () => void pollHost($).catch(() => undefined))
    } catch {
      S.watch = null
    }
  } else if (S.setting !== 'auto' && S.watch) {
    S.watch.cancel()
    S.watch = null
  }
}
