// Work on the host: the shell snippets Intelligent UI runs, the tty size (one
// read, and the watcher's loop: the size and the clipboard), the terminal's font, and light or dark for auto (the terminal's settings, then
// COLORFGBG, then the OS appearance), read again by a poll.
import type { EngineInterface } from 'claude-code'

import type { IuiTheme } from '../../types'
import { CLIP_WAKE_MS, HERDR_POLL_MS, HERDR_SCAN_MS, HOST_CHECK_MS, HOST_POLL_MS, MODES } from './settings'
import { S } from './state'
import { beginEpoch } from './epoch'
import { keptOsc11, luminanceOf, modeOfColorFgBg, modeOfLuminance, modeOfMacAppearance, parseOsc11, resolveMode, schemeOfPortal, type HostMode } from './mode'
import {
  cmuxAppearanceOf, cmuxConfigOf, cmuxGhosttyConfigPath, cmuxSettingsOf, familyOfFc, GHOSTTY_DEFAULT_FONT, ghosttyBackgroundOf, ghosttyFontsOf, ghosttyHasColors,
  ghosttyThemePaths, ghosttyThemesOf,
  ghosttyValueOf, hexColorOf, itermAppearanceOf, itermFontOf, itermModeOf, jsoncOf, kittyAutoFileOf, kittyBackgroundOf,
  kittyConfigDirsOf, kittyEntriesOf, kittyFontOf, kittySchemeOfGnome, kittyValueOf, KITTY_MAC_FONT, parseFontSpec, rioBackgroundOf,
  rioConfigDirOf, RIO_DEFAULT_FONT, RIO_OLD_FONT, rioFontOf, rioForcedOf, rioThemeNamesOf, rioThemePath, tomlStringsOf, type CmuxAppearance, type KittyEntries,
} from './terminals'
import { firstLine } from './markdown'
import {
  frontKindOf, herdrClientChanged, herdrClientsOf, herdrHostOf, herdrTickOf, herdrTickPick, isCmuxIn, isFlipHere, isGhosttyHere, isGhosttyIn, isKittyIn, isRioIn, pickHerdrClient,
  ttyNameOf, type HerdrClient, type HerdrTick, type OuterName,
} from './terminal'
import { refont } from './frame'
import { every, nowMs, getenv, exists, cat, exec } from './api'

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
// A PostScript name (argv[0]) to its family name; with argv[1] `user`, a
// name that is not installed gives the user's fixed-pitch font (iTerm2 then
// draws it: Menlo, unless it was changed).
const FAMILY_JXA = 'function run(argv) { ObjC.import("AppKit"); var f = argv[0] ? $.NSFont.fontWithNameSize(argv[0], 12) : null; if ((!f || f.isNil()) && argv[1] === "user") f = $.NSFont.userFixedPitchFontOfSize(12); return !f || f.isNil() ? "" : f.familyName.js }'
// Whether a family (argv[0]) is installed, as CoreText finds it by name:
// yes or no; with argv[1] `mono`, `proportional` when no style of it is fixed-pitch.
const HAS_FAMILY_JXA = 'function run(argv) { ObjC.import("AppKit"); var m = $.NSFontManager.sharedFontManager.availableMembersOfFontFamily(argv[0]); if (m.isNil()) return "no"; if (argv[1] !== "mono") return "yes"; for (var i = 0; i < m.count; i++) if (m.objectAtIndex(i).objectAtIndex(3).js & 0x400) return "yes"; return "proportional" }'
// The installed family (`=Name`) whose name is argv[0] in any case, else `no`.
const FAMILY_NOCASE_JXA = 'function run(argv) { ObjC.import("AppKit"); var a = $.NSFontManager.sharedFontManager.availableFontFamilies, w = argv[0].toLowerCase(); for (var i = 0; i < a.count; i++) { var f = a.objectAtIndex(i).js; if (f.toLowerCase() === w) return "=" + f } return "no" }'
// iTerm2's appearance, the default profile's GUID and the profiles, split by "@" lines.
const ITERM_MODE_SH = `defaults read com.googlecode.iterm2 TabStyleWithAutomaticOption 2>/dev/null; echo @; ${ITERM_DEFAULT_SH} 2>/dev/null; echo @; ${ITERM_BOOKMARKS_SH}`
const GHOSTTY_SH = `"\${GHOSTTY_BIN_DIR:+\$GHOSTTY_BIN_DIR/}ghostty" +show-config`
// Copies the font that a terminal carries in its program (no font files:
// the TrueType data is inside it; Ghostty's JetBrains Mono, Rio's Cascadia
// Code NF) to a folder that Typst can read, once per build: the variable
// Regular and Italic (an `fvar` table and the family, argument 2, in the
// `name` table), each size once (a universal program has a copy per CPU).
// The folder is in the user cache, by the tag (argument 1) and the
// program's path, size and mtime; it prints the folder. Exit 3 when the
// program has no such font (kept as a `.none` marker, so the next run does
// not read the program again); exit 1 for other failures. Made in a
// temporary folder first, so a compile never sees half. Each new copy or
// marker removes the tag's temporary folders of 1 day and its other folders
// and markers of 30 days (an older build's). The key has the scanner's
// version and the family, so a change to either reads the program again.
// A write that fails leaves no folder and no marker (exit 1).
export const PROGRAM_FONTS_PL = [
  'use strict;',
  'my ($tag, $family, $f) = @ARGV; $f or exit 1;',
  'my @st = stat($f) or exit 1;',
  'my $base = ($ENV{XDG_CACHE_HOME} || "$ENV{HOME}/.cache") . "/cc-intelligent-ui/fonts";',
  'my $key = "v2-" . unpack("%32C*", "$family/$f") . "-$st[7]-$st[9]";',
  'my $d = "$base/$tag-$key";',
  'if (-d $d) { utime(undef, undef, $d); print "$d\\n"; exit 0 }',
  'exit 3 if -e "$d.none";',
  'sub sweep {',
  '  opendir(my $dh, $base) or return;',
  '  for my $e (readdir $dh) {',
  '    next unless index($e, "$tag-") == 0; my $p = "$base/$e";',
  '    next if $p eq $d || $p eq "$d.none"; my $age = -M $p; next unless defined $age;',
  '    next unless $e =~ /\\.\\d+$/ ? $age > 1 : $age > 30;',
  '    if (-d $p) { system("rm", "-rf", $p) } else { unlink $p }',
  '  }',
  '}',
  'open(my $h, "<:raw", $f) or exit 1; my $b = do { local $/; <$h> }; close $h;',
  'my $want = "\\0" . join("\\0", split(//, $family));',
  'system("mkdir", "-p", $base) == 0 or exit 1;',
  'my $t = "$d.$$"; system("rm", "-rf", $t); mkdir($t) or exit 1;',
  'sub fail { system("rm", "-rf", $t); exit 1 }',
  'my %seen; my $n = 0;',
  'while ($b =~ /\\x00\\x01\\x00\\x00/g) {',
  '  my $o = pos($b) - 4; my $k = unpack("n", substr($b, $o + 4, 2));',
  '  next if $k < 4 || $k > 40;',
  '  my ($end, $fvar, $name, $bad) = (0, 0, "", 0);',
  '  for my $i (0 .. $k - 1) {',
  '    my ($tt, $cs, $off, $len) = unpack("a4NNN", substr($b, $o + 12 + 16 * $i, 16));',
  '    if ($tt !~ m{^[A-Za-z0-9/ ]{4}$} || $off + $len > 20000000) { $bad = 1; last }',
  '    $end = $off + $len if $off + $len > $end;',
  '    $fvar = 1 if $tt eq "fvar";',
  '    $name = substr($b, $o + $off, $len) if $tt eq "name";',
  '  }',
  '  next if $bad || !$fvar || index($name, $want) < 0 || $seen{$end}++;',
  '  open(my $w, ">:raw", "$t/$tag-" . ($n + 1) . ".ttf") or fail();',
  '  (print $w substr($b, $o, $end)) && close($w) or fail(); $n++;',
  '}',
  'if (!$n) { rmdir $t; if (open(my $m, ">", "$d.none")) { close $m } sweep(); exit 3 }',
  'rename($t, $d) or system("rm", "-rf", $t);',
  '-d $d or exit 1; sweep(); print "$d\\n";',
].join('\n')
// Runs PROGRAM_FONTS_PL (with the perl of perlFor) with a tag and a family
// on the first program found: for ghostty the one of GHOSTTY_BIN_DIR, then
// the PATH's command of that name, then each other path (the apps' places).
// Exit 2 when no program is found.
export const PROGRAM_FONTS_SH = [
  'perl=$1; pl=$2; tag=$3; family=$4; name=$5; shift 5',
  'first=; [ "$name" = ghostty ] && first=${GHOSTTY_BIN_DIR:+$GHOSTTY_BIN_DIR/ghostty}',
  'for f in "$first" "$(command -v "$name")" "$@"; do',
  '  [ -n "$f" ] && [ -f "$f" ] && exec "$perl" -e "$pl" "$tag" "$family" "$f"',
  'done',
  'exit 2',
].join('\n')
// Where the apps keep their Ghostty program.
const GHOSTTY_PROGRAMS = ['/Applications/cmux.app/Contents/Resources/bin/ghostty', '/Applications/Ghostty.app/Contents/MacOS/ghostty']
// Where Rio's program can be (after the PATH's): the macOS app (rio.app), cargo's, Flatpak's.
const rioProgramsOf = (home: string) => [
  '/Applications/rio.app/Contents/MacOS/rio', `${home}/Applications/rio.app/Contents/MacOS/rio`, `${home}/.cargo/bin/rio`,
  '/var/lib/flatpak/app/com.rioterm.Rio/current/active/files/bin/rio', `${home}/.local/share/flatpak/app/com.rioterm.Rio/current/active/files/bin/rio`,
]
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
// herdr: the clients of this pane's server. One ps lists the processes;
// this pane's server is the `herdr server` above this shell. A client is a
// `herdr` of this user with a tty (no arguments, `--session <name>`,
// `session attach <name>` or `client`). With more than one server, lsof
// keeps the clients whose socket peer is one of this server's sockets (no
// lsof, or no peer column as on Linux: all stay). On macOS it prints first
// `front` and the bundle id of the app in front (lsappinfo; no line when
// that can't be read). Then for each client: `pid`, `atime` (its tty's
// access time, a key read there; macOS: with a fraction), `tty`, `cmd` (its
// command) and `app` (its nearest ancestor with no tty: the terminal app)
// lines, then `env` and the client's variables (Linux:
// /proc/<pid>/environ, NUL-separated; macOS: `ps eww`, its command then the
// variables). pickHerdrClient chooses one. Nothing (exit 0) when none is found.
export const HERDR_CLIENT_SH = `s=$$
u=$(uname -s)
case $u in
  Darwin|*BSD) t=$(ps -A -o pid= -o ppid= -o uid= -o tdev= -o command= 2>/dev/null) || exit 0
    f='%Fa'; case $(stat -f %Fa /dev/null 2>/dev/null) in [0-9]*.[0-9]*) ;; *) f='%a' ;; esac
    a=$(stat -f "%Hr/%Lr $f %N" /dev/ttys* 2>/dev/null) ;;
  *) t=$(ps -A -o pid= -o ppid= -o uid= -o tty= -o command= 2>/dev/null) || exit 0; a=$(stat -c '%n %X %n' /dev/pts/[0-9]* /dev/tty[0-9]* 2>/dev/null | sed 's|^/dev/||') ;;
esac
c=$({ printf '%s\\n' "$a" | sed 's/^/@ /'; printf '%s\\n' "$t"; } | awk -v me="$(id -u)" -v self="$s" '
  $1 == "@" { at[$2] = $3; nm[$2] = $4; sub(/^\\/dev\\//, "", nm[$2]); next }
  { p = $1; pp[p] = $2; ty[p] = $4; x = $0; sub(/^ *[0-9]+ +[0-9]+ +[0-9]+ +[^ ]+ +/, "", x); cm[p] = x; if ($3 != me) next
    n = split(x, w, " "); b = w[1]; sub(/.*\\//, "", b); if (b != "herdr") next
    if (n == 2 && w[2] == "server") { srv[p] = 1; ns++; next }
    r = x; sub(/^[^ ]+ ?/, "", r); if ((ty[p] in at) && r ~ /^(--session[= ][^ ]+|session attach [^ ]+|client)?$/) cl[p] = 1 }
  END {
    q = self; for (j = 0; j < 64 && q > 1; j++) { if (q in srv) break; q = pp[q] }
    printf "srv\\t%d\\t%s\\n", ns, (q in srv) ? q : ""
    for (p in cl) {
      a = pp[p]; for (j = 0; j < 64 && a > 1 && ty[a] !~ /^[?-]+$/; j++) a = pp[a]
      printf "cl\\t%s\\t%s\\t%s\\t%s\\t%s\\n", at[ty[p]], p, nm[ty[p]], cm[p], (a > 1 ? cm[a] : "") } }')
n=$(printf '%s\\n' "$c" | awk -F '\\t' '$1 == "srv" { print $2 }')
v=$(printf '%s\\n' "$c" | awk -F '\\t' '$1 == "srv" { print $3 }')
l=$(printf '%s\\n' "$c" | grep '^cl')
[ -n "$l" ] || exit 0
if [ "\${n:-0}" -gt 1 ]; then
  [ -n "$v" ] || exit 0
  if command -v lsof >/dev/null 2>&1; then
    k=$(lsof -a -U -p "$v,$(printf '%s\\n' "$l" | cut -f3 | paste -sd, -)" 2>/dev/null | awk -v v="$v" '$2 == v { a[$6] = 1 } $NF ~ /^->0x/ { e[NR] = substr($NF, 3); o[NR] = $2 } END { for (i in e) { f = 1; if (e[i] in a) print o[i] } if (f) print "peers" }')
    case $k in *peers*) l=$({ printf '%s\\n@\\n' "$k"; printf '%s\\n' "$l"; } | awk -F '\\t' 'f == 0 { if ($0 == "@") f = 1; else m[$0] = 1; next } $3 in m') ;; esac
  fi
fi
if [ "$u" = Darwin ] && command -v lsappinfo >/dev/null 2>&1; then
  f=$(lsappinfo info -only bundleid "$(lsappinfo front 2>/dev/null)" 2>/dev/null | sed -n 's/^"CFBundleIdentifier"="\\(.*\\)"$/\\1/p')
  [ -n "$f" ] && printf 'front %s\\n' "$f"
fi
printf '%s\\n' "$l" | cut -f3 | while read -r p; do
  printf '%s\\n' "$l" | awk -F '\\t' -v p="$p" '$3 == p { printf "pid %s\\natime %s\\ntty %s\\ncmd %s\\napp %s\\nenv\\n", $3, $2, $4, $5, $6 }'
  if [ -r "/proc/$p/environ" ]; then cat "/proc/$p/environ"; echo; else ps eww -o command= -p "$p"; fi
done
exit 0`
// herdr's light check, each HERDR_POLL_MS: argument 1 is the OS (uname -s),
// the others the known clients' ttys (/dev/...). On macOS it prints `front`
// and the bundle id of the app in front (as HERDR_CLIENT_SH), then an
// `atime <tty> <time>` line per tty (with a fraction on macOS; none for a
// tty that is gone). No ps: it costs a tenth of the full scan.
export const HERDR_TICK_SH = `o=$1; shift
if [ "$o" = Darwin ] && command -v lsappinfo >/dev/null 2>&1; then
  f=$(lsappinfo info -only bundleid "$(lsappinfo front 2>/dev/null)" 2>/dev/null)
  case $f in '"CFBundleIdentifier"="'*'"') f=\${f#*=\\"}; printf 'front %s\\n' "\${f%\\"}" ;; esac
fi
[ $# -gt 0 ] || exit 0
case $o in
  Darwin|*BSD) a=$(stat -f 'atime %N %Fa' "$@" 2>/dev/null)
    case $a in *[0-9].[0-9]*) ;; *) a=$(stat -f 'atime %N %a' "$@" 2>/dev/null) ;; esac ;;
  *) a=$(stat -c 'atime %n %X' "$@" 2>/dev/null) ;;
esac
[ -n "$a" ] && printf '%s\\n' "$a"
exit 0`

// The terminal's font family: iTerm2's profile font, Ghostty's font-family,
// kitty's font_family, Rio's [fonts] family; '' elsewhere or when it can't
// be read. A family that the terminal does not find is the one it draws in
// its place (its own font, Menlo, or fontconfig's nearest). On Linux, when
// the terminal's config names none: fontconfig's monospace font (fc-match),
// which kitty and most terminals use.
export async function termFontOf($: EngineInterface, isMac: boolean): Promise<string> {
  // Over ssh, a config here is not the one of the user's terminal.
  if (S.isRemote) return ''
  const font = await configFontOf($, isMac)
  if (font || isMac) return font
  return fcFamily($, 'monospace')
}

// A family as a fontconfig pattern: its `-`, `:`, `,` and `\` escaped.
export const fcPatternOf = (family: string) => family.replace(/[\\\-:,]/g, '\\$&')

// A family fontconfig gives for a pattern (the first of its names), '' when
// fc-match fails. `fc-match` always gives a font, the nearest one.
async function fcFamily($: EngineInterface, pattern: string): Promise<string> {
  const got = await exec($, ['fc-match', pattern, '-f', '%{family}'], { timeoutMs: 5000 }).catch(() => null)
  return got?.exitCode === 0 ? familyOfFc(got.stdout) : ''
}

// The family of the first font that fontconfig lists for a pattern (only
// fonts that match it), '' for none.
async function fcListFamily($: EngineInterface, pattern: string): Promise<string> {
  const got = await exec($, ['fc-list', pattern, 'family'], { timeoutMs: 5000 }).catch(() => null)
  return got?.exitCode === 0 ? familyOfFc(firstLine(got.stdout)) : ''
}

// What CoreText says of a family (HAS_FAMILY_JXA), '' when it can't be read.
async function macFamily($: EngineInterface, family: string, mono = false): Promise<string> {
  const got = await exec($, ['osascript', '-l', 'JavaScript', '-e', HAS_FAMILY_JXA, family, ...(mono ? ['mono'] : [])], { timeoutMs: 5000 }).catch(() => null)
  return got?.exitCode === 0 ? firstLine(got.stdout) : ''
}

// The installed family of a name, as Typst must name it: CoreText on
// macOS, fontconfig on Linux (in any case and spacing; `exact`: in any
// case only, as Rio's font database matches it). '' when it is not
// installed; null when that can't be read (then the name is taken as is).
async function installedFamily($: EngineInterface, isMac: boolean, family: string, exact = false): Promise<string | null> {
  if (isMac && exact) {
    const got = await exec($, ['osascript', '-l', 'JavaScript', '-e', FAMILY_NOCASE_JXA, family], { timeoutMs: 5000 }).catch(() => null)
    const line = got?.exitCode === 0 ? firstLine(got.stdout) : ''
    return line.startsWith('=') ? line.slice(1) : line === 'no' ? '' : null
  }
  if (isMac) {
    const seen = await macFamily($, family)
    return seen === 'yes' ? family : seen === 'no' ? '' : null
  }
  const got = await exec($, ['fc-list', exact ? ':' : fcPatternOf(family), 'family'], { timeoutMs: 5000 }).catch(() => null)
  if (got?.exitCode !== 0) return null
  // Each line is a font's family names, split by commas, with `\` escapes.
  const names = got.stdout.split('\n').flatMap(line => line.split(/(?<!\\),/).map(name => name.replace(/\\(.)/g, '$1').trim())).filter(Boolean)
  const loose = (n: string) => (exact ? n : n.replace(/\s/g, '')).toLowerCase()
  return names.find(n => loose(n) === loose(family)) ?? (exact ? '' : names[0] ?? '')
}

// Copies the font a terminal carries in its program (PROGRAM_FONTS_PL) and
// gives it to Typst (S.fontPaths): 'copied', 'none' (the program has no
// such font) or 'failed' (no program, or the copy failed).
async function programFont($: EngineInterface, isMac: boolean, o: { tag: string; family: string; name: string; paths: readonly string[] }): Promise<'copied' | 'none' | 'failed'> {
  const argv = ['sh', '-c', PROGRAM_FONTS_SH, 'sh', perlFor(isMac), PROGRAM_FONTS_PL, o.tag, o.family, o.name, ...o.paths]
  const made = await exec($, argv, { timeoutMs: 10000, ...ghosttyInit() }).catch(() => null)
  const dir = made?.exitCode === 0 ? firstLine(made.stdout) : ''
  // No copy now: an older folder (maybe gone) is not given to Typst.
  if (!dir) S.fontPaths = ''
  if (made?.exitCode === 3) return 'none'
  if (!dir) return 'failed'
  S.fontPaths = dir
  return 'copied'
}

// Ghostty draws its own JetBrains Mono when no font-family is set (and on
// macOS when it finds none of them). Typst draws it from the system's fonts
// when fontconfig has it (Linux), else from a copy of the one in Ghostty's
// program (S.fontPaths).
async function ghosttyDefaultFont($: EngineInterface, isMac: boolean): Promise<string> {
  const got = await exec($, ['fc-list', '-q', GHOSTTY_DEFAULT_FONT], { timeoutMs: 5000 }).catch(() => null)
  if (got?.exitCode === 0) return GHOSTTY_DEFAULT_FONT
  const o = { tag: 'ghostty', family: GHOSTTY_DEFAULT_FONT, name: 'ghostty', paths: GHOSTTY_PROGRAMS }
  return (await programFont($, isMac, o)) === 'copied' ? GHOSTTY_DEFAULT_FONT : ''
}

// Ghostty's font: the first family of its font-family list that it finds.
// None found: on macOS its own JetBrains Mono; on Linux fontconfig's
// nearest font for the first family (Ghostty takes the first font of
// fontconfig's sorted list). No list: its own JetBrains Mono.
async function ghosttyFont($: EngineInterface, isMac: boolean, names: readonly string[]): Promise<string> {
  if (!names.length) return ghosttyDefaultFont($, isMac)
  for (const name of names) {
    const found = await installedFamily($, isMac, name)
    if (found !== '') return found ?? name
  }
  if (isMac) return ghosttyDefaultFont($, isMac)
  return (await fcFamily($, fcPatternOf(names[0]!))) || names[0]!
}

// Rio draws its own Cascadia Code NF when the config names no font (or
// `cascadiacode`, or one it does not find by its exact name): a copy of
// the one in Rio's program. A Rio up to 0.4 carries a Cascadia Code with
// no `fvar` (none found): Cascadia Code. No program: the system's Cascadia
// Code (the same letters) when it is installed.
async function rioFont($: EngineInterface, isMac: boolean): Promise<string> {
  const named = rioFontOf((await readRioConfig($)).config)
  const found = named === RIO_DEFAULT_FONT ? '' : await installedFamily($, isMac, named, true)
  if (found !== '') return found ?? named
  const home = (await getenv($, 'HOME')) ?? ''
  const copy = await programFont($, isMac, { tag: 'rio', family: RIO_DEFAULT_FONT, name: 'rio', paths: rioProgramsOf(home) })
  if (copy === 'copied') return RIO_DEFAULT_FONT
  if (copy === 'none') return RIO_OLD_FONT
  return (await installedFamily($, isMac, RIO_OLD_FONT)) ? RIO_OLD_FONT : RIO_DEFAULT_FONT
}

// iTerm2, or herdr in iTerm2 (its profile and font; S.isIterm stays false
// there, so the setup question for iTerm2 is not asked).
const isItermHere = () => S.isIterm || S.herdrHost === 'iterm'

// A variable of the terminal the user sees: under herdr the client's
// (S.herdrClient; not set there is not set), else this process's.
export function outerEnv($: EngineInterface, name: OuterName): Promise<string | undefined> {
  const client = S.herdrClient
  return client ? Promise.resolve(client.env[name] || undefined) : getenv($, name)
}
// GHOSTTY_SH and PROGRAM_FONTS_SH run the client's Ghostty under herdr ('': the PATH's).
const ghosttyInit = () => (S.herdrClient ? { env: { GHOSTTY_BIN_DIR: S.herdrClient.env.GHOSTTY_BIN_DIR ?? '' } } : {})

// The terminal values the font and mode readers use (S.itermProfile,
// S.colorFgBg, S.herdrHost, S.isKitty, S.isCmux): under herdr the client's
// when one is found, else this process's variables (under herdr: those of
// the terminal that started its server, the fallback).
export async function setOuter($: EngineInterface) {
  S.itermProfile = (await outerEnv($, 'ITERM_PROFILE')) || undefined
  S.colorFgBg = (await outerEnv($, 'COLORFGBG')) ?? ''
  const client = S.herdrClient
  if (client) {
    S.herdrHost = client.kind
    S.isKitty = client.kind === 'kitty'
    S.isCmux = client.kind === 'cmux'
    return
  }
  S.isCmux = isCmuxIn({ surface: await getenv($, 'CMUX_SURFACE_ID'), workspace: await getenv($, 'CMUX_WORKSPACE_ID'), socket: await getenv($, 'CMUX_SOCKET_PATH') })
  S.herdrHost = S.isHerdr
    ? herdrHostOf({
      cmux: S.isCmux,
      ghosttyResources: await getenv($, 'GHOSTTY_RESOURCES_DIR'),
      ghosttyBin: await getenv($, 'GHOSTTY_BIN_DIR'),
      kittyPid: await getenv($, 'KITTY_PID'),
      kittyDir: await getenv($, 'KITTY_INSTALLATION_DIR'),
      itermProfile: S.itermProfile,
    })
    : ''
  S.isKitty = isKittyIn({ term: S.termName, windowId: await getenv($, 'KITTY_WINDOW_ID'), pid: await getenv($, 'KITTY_PID') }) || S.herdrHost === 'kitty'
}

// herdr: reads the clients (HERDR_CLIENT_SH; the full scan) and follows the
// one that pickHerdrClient chooses (`was`: the client of before, kept while
// the app in front has none). True when its terminal changed
// (herdrClientChanged); a read that finds none keeps the last one. The
// clients and the app in front are kept for the light check.
export async function readHerdrClient($: EngineInterface, was: HerdrClient | null = S.herdrClient): Promise<boolean> {
  const got = await exec($, ['sh', '-c', HERDR_CLIENT_SH], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  const read = got?.exitCode === 0 ? herdrClientsOf(got.stdout) : null
  // A failed scan counts too, so the next one waits HERDR_SCAN_MS.
  S.herdrScanAt = await nowMs($).catch(() => Date.now())
  if (read) {
    S.herdrClients = read.clients
    S.herdrScanFront = read.front
  }
  const pick = read ? pickHerdrClient(read.clients, read.front === null ? null : frontKindOf(read.front), was) : null
  if (!pick) return false
  if (pick.by !== 'kept') S.herdrBy = pick.by
  const changed = herdrClientChanged(S.herdrClient, pick.client)
  S.herdrClient = pick.client
  return changed
}

// herdr's check each HERDR_POLL_MS: the light check (HERDR_TICK_SH, then
// herdrTickPick on the clients of the last scan), else the full scan
// (readHerdrClient). True when the terminal changed.
export async function checkHerdrClient($: EngineInterface): Promise<boolean> {
  const now = await nowMs($).catch(() => Date.now())
  const ageMs = S.herdrScanAt === null ? null : now - S.herdrScanAt
  let tick: HerdrTick | null = null
  if (ageMs !== null && ageMs < HERDR_SCAN_MS) {
    const ttys = S.herdrClients.map(c => `/dev/${ttyNameOf(c.tty)}`)
    // Nothing to read (no client, no app in front off macOS, as a remote pane): no process.
    const got = ttys.length || S.hostOs === 'Darwin' ? await exec($, ['sh', '-c', HERDR_TICK_SH, 'sh', S.hostOs, ...ttys], { timeoutMs: HOST_CHECK_MS }).catch(() => null) : { exitCode: 0, stdout: '' }
    tick = got?.exitCode === 0 ? herdrTickOf(got.stdout) : null
  }
  const light = herdrTickPick({ clients: S.herdrClients, tick, was: S.herdrClient, scanFront: S.herdrScanFront, ageMs })
  if (!light) return readHerdrClient($)
  S.herdrClients = light.clients
  if (!light.pick) return false
  if (light.pick.by !== 'kept') S.herdrBy = light.pick.by
  const changed = herdrClientChanged(S.herdrClient, light.pick.client)
  S.herdrClient = light.pick.client
  return changed
}

// The font that the terminal's own config or profile names.
async function configFontOf($: EngineInterface, isMac: boolean): Promise<string> {
  if (isItermHere() && isMac) {
    const profile = S.itermProfile
    const [marks, guid] = await Promise.all([
      exec($, ['sh', '-c', ITERM_BOOKMARKS_SH], { timeoutMs: 5000 }).catch(() => null),
      exec($, ['sh', '-c', ITERM_DEFAULT_SH], { timeoutMs: 5000 }).catch(() => null),
    ])
    // A read that failed or no profile: not known.
    const font = marks?.exitCode === 0 ? itermFontOf(marks.stdout, profile, guid?.stdout ?? '') : null
    if (font === null) return ''
    // An empty or bad profile font, or one that is not installed: iTerm2 draws the user's fixed-pitch font.
    const named = await exec($, ['osascript', '-l', 'JavaScript', '-e', FAMILY_JXA, parseFontSpec(font)?.name ?? '', 'user'], { timeoutMs: 5000 }).catch(() => null)
    return named?.exitCode === 0 ? firstLine(named.stdout) : ''
  }
  if (isGhosttyHere()) {
    const shown = await exec($, ['sh', '-c', GHOSTTY_SH], { timeoutMs: 5000, ...ghosttyInit() }).catch(() => null)
    // cmux loads its own config after Ghostty's; +show-config does not read it.
    const own = S.isCmux ? ((await readText($, cmuxGhosttyConfigPath((await getenv($, 'HOME')) ?? ''))) ?? '') : ''
    return ghosttyFont($, isMac, ghosttyFontsOf(cmuxConfigOf(shown?.stdout ?? '', own)))
  }
  if (S.isKitty) {
    // As kitty finds a font: a family name, else a full or PostScript name
    // (macOS: AppKit; Linux: fontconfig), else the nearest font (macOS:
    // Menlo; Linux: fontconfig's monospace match). kitty looks only at
    // fixed-pitch fonts. No font_family: the system's monospace (macOS:
    // Menlo; Linux: fontconfig's, in termFontOf).
    const font = kittyFontOf(kittyValueOf((await readKittyConfig($)).entries, 'font_family'))
    if (!font) return isMac ? KITTY_MAC_FONT : ''
    const name = 'family' in font ? font.family : font.postscript
    if (isMac) {
      const seen = 'family' in font ? await macFamily($, name, true) : 'no'
      if (seen === 'yes' || seen === '') return name
      if (seen === 'proportional') return KITTY_MAC_FONT
      const named = await exec($, ['osascript', '-l', 'JavaScript', '-e', FAMILY_JXA, name], { timeoutMs: 5000 }).catch(() => null)
      return named?.exitCode === 0 ? firstLine(named.stdout) || KITTY_MAC_FONT : ''
    }
    const found = 'family' in font ? await installedFamily($, isMac, name) : ''
    if (found !== '') return found ?? name
    const exact = (await fcListFamily($, `:postscriptname=${fcPatternOf(name)}`)) || (await fcListFamily($, `:fullname=${fcPatternOf(name)}`))
    return exact || (await fcFamily($, `${'family' in font ? fcPatternOf(name) : `:postscriptname=${fcPatternOf(name)}`}:spacing=mono`))
  }
  if (isRioHere()) return rioFont($, isMac)
  return ''
}

// The mode for auto now, or null when nothing can be read (keep the last
// one): 1. the terminal's OSC 11 answer (off, see USE_OSC11; on under herdr,
// local or remote: its pane answers with the background of the terminal in
// front, and a missed answer keeps the last one a while, keptOsc11); 2. the
// terminal's own settings (iTerm2's profile, Ghostty's, kitty's or Rio's
// config); 3. COLORFGBG at start; 4. the
// OS appearance; 5. dark (resolveMode). The terminal comes before the OS: a
// dark terminal on a light Mac is dark. Over ssh, only COLORFGBG (when ssh
// sends it): the configs and the OS here are the remote computer's.
export async function readHostMode($: EngineInterface): Promise<HostMode | null> {
  if (USE_OSC11) {
    const bg = parseOsc11((await probeOsc11($))?.reply ?? '')
    if (bg) return { mode: modeOfLuminance(luminanceOf(bg)), source: 'terminal', detail: 'OSC 11 background' }
  } else if (S.isHerdr) {
    const bg = parseOsc11((await probeOsc11($).catch(() => null))?.reply ?? '')
    const answer: HostMode | null = bg ? { mode: modeOfLuminance(luminanceOf(bg)), source: 'herdr', detail: 'OSC 11 background of the terminal in front' } : null
    const { kept, use } = keptOsc11(S.osc11Kept, answer)
    S.osc11Kept = kept
    if (use) return use
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
  if (!isItermHere() || S.hostOs !== 'Darwin') return null
  const got = await exec($, ['sh', '-c', ITERM_MODE_SH], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  if (!got || got.exitCode !== 0) return null
  const [style = '', guid = '', marks = ''] = got.stdout.split(/^@\n/m)
  const appearance = itermAppearanceOf(style) ?? (await readOsMode($).catch(() => null))?.mode ?? null
  const mode = itermModeOf(marks, S.itermProfile, guid, appearance)
  return mode ? { mode, source: 'iTerm2', detail: `profile ${S.itermProfile || 'default'} background` } : null
}

// One OSC 11 question to the terminal: its raw answer ('' for none), or null
// when the tty could not be opened.
export async function probeOsc11($: EngineInterface): Promise<{ reply: string } | null> {
  const got = await exec($, ['perl', '-e', OSC11_PL], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  return got && got.exitCode === 0 ? { reply: got.stdout } : null
}

// The background of Ghostty's config. A `light:A,dark:B` theme follows the OS
// (in cmux, cmux's appearance). In cmux, cmux's own config is read as well;
// herdr in Ghostty reads Ghostty's.
async function readGhosttyMode($: EngineInterface): Promise<HostMode | null> {
  if (!isGhosttyIn(S.termProgram, S.termName) && S.herdrHost !== 'ghostty' && S.herdrHost !== 'cmux') return null
  const got = await exec($, ['sh', '-c', GHOSTTY_SH], { timeoutMs: HOST_CHECK_MS, ...ghosttyInit() }).catch(() => null)
  if (!got || got.exitCode !== 0) return null
  const home = (await getenv($, 'HOME')) ?? ''
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
      xdgConfig: (await getenv($, 'XDG_CONFIG_HOME')) || undefined,
      home,
      resources: (await outerEnv($, 'GHOSTTY_RESOURCES_DIR')) || undefined,
    }
    for (const mode of MODES) {
      for (const path of ghosttyThemePaths(pair[mode], where)) {
        const text = await cat($, path).catch(() => null)
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
  const home = (await getenv($, 'HOME')) ?? ''
  const settings = cmuxSettingsOf(jsoncOf((await readText($, `${home}/.config/cmux/cmux.json`)) ?? ''))
  if (settings.adaptive === false) return null
  const seen = await readCmuxAppearance($, settings.appearance)
  return seen ? { mode: seen.mode, source: 'cmux', detail: `adaptive default theme, appearance ${seen.appearance}` } : null
}

// cmux's appearance (cmux.json's, else the one saved in Settings) and the
// mode it gives: the OS's when it is system. Null when that is not known.
async function readCmuxAppearance($: EngineInterface, file?: CmuxAppearance): Promise<{ mode: IuiTheme; appearance: CmuxAppearance } | null> {
  if (file === undefined) {
    const home = (await getenv($, 'HOME')) ?? ''
    file = cmuxSettingsOf(jsoncOf((await readText($, `${home}/.config/cmux/cmux.json`)) ?? '')).appearance
  }
  let saved = ''
  if (!file && S.hostOs === 'Darwin') {
    const got = await exec($, ['defaults', 'read', 'com.cmuxterm.app', 'appearanceMode'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    saved = got?.exitCode === 0 ? got.stdout : ''
  }
  const appearance = cmuxAppearanceOf(file, saved)
  const mode = appearance === 'system' ? ((await readOsMode($).catch(() => null))?.mode ?? null) : appearance
  return mode ? { mode, appearance } : null
}

// Rio sets TERM_PROGRAM=rio, and TERM=rio when its terminfo is installed; or herdr in Rio.
const isRioHere = () => isRioIn(S.termProgram, S.termName) || S.herdrHost === 'rio'

// A file's text, or null when it can't be read.
export async function readText($: EngineInterface, path: string): Promise<string | null> {
  const text = await cat($, path).catch(() => null)
  return typeof text === 'string' ? text : null
}

// kitty's config folder and kitty.conf with its includes: the first folder
// that has a kitty.conf, else the first folder (auto theme files can be there).
async function readKittyConfig($: EngineInterface): Promise<{ dir: string; entries: KittyEntries; home: string }> {
  const home = (await getenv($, 'HOME')) ?? ''
  const dirs = kittyConfigDirsOf({
    kittyDir: (await outerEnv($, 'KITTY_CONFIG_DIRECTORY')) || undefined,
    xdgConfig: (await getenv($, 'XDG_CONFIG_HOME')) || undefined,
    home,
    isMac: S.hostOs === 'Darwin',
  })
  const o = { home, vars: { KITTY_OS: S.hostOs === 'Darwin' ? 'macos' : S.hostOs.toLowerCase() } }
  for (const dir of dirs) {
    if (!(await exists($, `${dir}/kitty.conf`).catch(() => false))) continue
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
  const found = await Promise.all(schemes.map(s => exists($, `${dir}/${kittyAutoFileOf(s)}`).catch(() => false)))
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
    rioHome: (await outerEnv($, 'RIO_CONFIG_HOME')) || undefined,
    xdgConfig: (await getenv($, 'XDG_CONFIG_HOME')) || undefined,
    home: (await getenv($, 'HOME')) ?? '',
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
    const got = await exec($, ['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
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
    const got = await exec($, PORTAL_ARGS[tool], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
    const scheme = got && got.exitCode === 0 ? schemeOfPortal(got.stdout) : null
    if (scheme) {
      S.portalTool = tool
      return { scheme, source: 'desktop portal' }
    }
  }
  if (S.portalTool === null) S.portalTool = ''
  if (S.portalTool) return null
  const got = await exec($, ['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'], { timeoutMs: HOST_CHECK_MS }).catch(() => null)
  const scheme = got && got.exitCode === 0 ? kittySchemeOfGnome(got.stdout) : null
  return scheme ? { scheme, source: 'GNOME' } : null
}

// One poll (never two at once): under herdr the client first (another
// terminal sets the terminal values again, then the font and its metrics
// are read again), then with auto the mode. A changed mode, font or flip
// mode (isFlipHere: iTerm2 in or out) redraws. Under herdr the mode is read
// each HOST_POLL_MS (every third poll), at once for another terminal, and
// with `modeNow`.
export async function pollHost($: EngineInterface, modeNow = false) {
  const herdr = herdrPolled()
  if (S.checking || (S.setting !== 'auto' && !herdr)) return
  S.checking = true
  let refonted = false
  const flipWas = isFlipHere()
  try {
    const moved = herdr && (await checkHerdrClient($).catch(() => false))
    if (moved) await setOuter($)
    const due = !herdr || modeNow || moved || ++S.hostTicks >= HOST_POLL_MS / HERDR_POLL_MS
    if (due) S.hostTicks = 0
    if (S.setting === 'auto' && due) S.host = (await readHostMode($).catch(() => null)) ?? S.host
    if (moved) refonted = await refont($).catch(() => false)
  } finally {
    S.checking = false
  }
  if (!refonted && isFlipHere() === flipWas) return showMode($)
  S.theme = resolveMode(S.setting, S.host)
  beginEpoch($)
}

// Draws in the mode the setting and the OS give, when it changed: a new
// epoch, so all pictures swap to the new mode in one redraw.
export function showMode($: EngineInterface) {
  const next = resolveMode(S.setting, S.host)
  if (next === S.theme) return
  S.theme = next
  beginEpoch($)
}

// herdr's client is checked: under herdr, with pictures drawn and the mod on.
const herdrPolled = () => S.isHerdr && S.herdrDraws && !S.isOff

// Polls while the setting is auto or herdr's client is checked (it can
// change), and only then, until the session ends: each HOST_POLL_MS, while
// herdr's client is checked each HERDR_POLL_MS.
export function watchHost($: EngineInterface) {
  const wanted = !S.hostEnded && (S.setting === 'auto' || herdrPolled())
  const ms = herdrPolled() ? HERDR_POLL_MS : HOST_POLL_MS
  // Started before setUp knew of herdr: started again with its period.
  if (S.watch && (!wanted || S.watchMs !== ms)) {
    S.watch.cancel()
    S.watch = null
  }
  if (wanted && !S.watch) {
    try {
      S.watch = every($, ms, () => void pollHost($).catch(() => undefined))
      S.watchMs = ms
    } catch {
      S.watch = null
    }
  }
}

// The session ends (not a /clear): no more polls.
export function stopHost() {
  S.hostEnded = true
  S.watch?.cancel()
  S.watch = null
}
