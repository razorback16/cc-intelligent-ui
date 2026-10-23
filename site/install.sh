#!/usr/bin/env bash
# Intelligent UI for Claude Code: the one-line installer.
#
#   curl -fsSL https://intelligentui.art/install.sh | bash
#
# What it does (refer to docs/install.md):
#   1. Checks the system (macOS or Linux, arm64 or x86_64) and that Claude Code is installed.
#   2. Typst: when no Typst 0.15 or later is found, downloads the official Typst 0.15.1
#      release from GitHub, checks its SHA-256 (in this file) and puts it in ~/.local/bin.
#   3. Adds the razorback16 marketplace and installs the mod, with the `claude plugin`
#      commands (or updates both when they are there). A razorback16 marketplace from
#      another source (a fork, a pinned ref, a local folder) is removed and added again
#      from GitHub. Another user copy of the mod (from another marketplace) is uninstalled;
#      copies in a project are not changed, only shown.
#   4. Turns on auto-update for the razorback16 marketplace in your Claude Code
#      settings.json (extraKnownMarketplaces), with a backup of the file before that change.
#      An autoUpdate: false that you set is kept.
# Run it again to update. It never uses sudo.
#   5. When iTerm2 or herdr is there: adds the mod's own /iui setup block (it sets
#      CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 in iTerm2 and herdr only) to the start file of
#      your login shell, with a backup. /iui setup remove removes it.
# Options: IUI_NO_TYPST=1 (no Typst step), IUI_NO_AUTO_UPDATE=1 (no auto-update step),
# IUI_NO_SHELL_SETUP=1 (no shell setup step).
# All the work is in functions, and the last line runs it: a cut download runs nothing.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "Run this script with bash: curl -fsSL https://intelligentui.art/install.sh | bash" >&2
  exit 1
fi
set -euo pipefail

MARKETPLACE=razorback16
MARKETPLACE_REPO=razorback16/cc-intelligent-ui
PLUGIN_NAME=cc-intelligent-ui
PLUGIN=cc-intelligent-ui@razorback16
# The oldest Claude Code that the mod works with (docs/install.md).
MIN_CLAUDE=2.1.298
CLAUDE_SETUP_URL=https://code.claude.com/docs/en/setup
TYPST_VERSION=0.15.1
TYPST_MIN=0.15
TYPST_URL=https://github.com/typst/typst/releases/download/v$TYPST_VERSION
# Where the mod looks for Typst when it is not on the PATH, in its order
# (TYPST_FALLBACKS in hooks/lib/settings.ts). `~` is $HOME.
TYPST_DIRS='/opt/homebrew/bin /usr/local/bin /usr/bin /snap/bin ~/.cargo/bin ~/.local/bin /home/linuxbrew/.linuxbrew/bin ~/.linuxbrew/bin'

# SHA-256 of the official Typst 0.15.1 release files. Computed from the files
# downloaded from github.com/typst/typst/releases/tag/v0.15.1, and the same as
# the `digest` of each file in the GitHub release API.
typst_sha256() {
  case $1 in
    typst-aarch64-apple-darwin.tar.xz) echo 48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a ;;
    typst-x86_64-apple-darwin.tar.xz) echo 7f9fdd9584866245de9a79e0add8f9236fae6f40a8a45e2c4771ccc14db4e0fa ;;
    typst-aarch64-unknown-linux-musl.tar.xz) echo 5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee ;;
    typst-x86_64-unknown-linux-musl.tar.xz) echo a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c ;;
    *) return 1 ;;
  esac
}

# Output: plain ASCII; bold headings only on a terminal.
BOLD=
PLAIN=
init_output() {
  if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ] && [ -z "${NO_COLOR:-}" ]; then
    BOLD=$(printf '\033[1m')
    PLAIN=$(printf '\033[0m')
  fi
}
say() { printf '%s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$PLAIN"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '  Warning: %s\n' "$*" >&2; }
die() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}
# Shows a claude command, then runs it (stdin closed: it can not read this script).
claude_run() {
  printf '  $ claude %s\n' "$*"
  "$CLAUDE" "$@" < /dev/null
}

on() { [ -n "${1:-}" ] && [ "$1" != 0 ]; }

# The work folder, removed at the end.
WORK=
cleanup() { if [ -n "$WORK" ]; then rm -rf "$WORK"; fi; }

# 0 when version $1 >= $2 (dotted numbers).
version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, "."); if (m > n) n = m
    for (i = 1; i <= n; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 0 }'
}

# "~/..." with $HOME, for messages and paths.
tilde() {
  case $1 in
    "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# --- 1. Checks -------------------------------------------------------------

OS=
ARCH=
TARGET=
check_platform() {
  local s m
  s=$(uname -s)
  m=$(uname -m)
  case $s in
    Darwin) OS=macos TARGET=apple-darwin ;;
    Linux) OS=linux TARGET=unknown-linux-musl ;;
    *) die "this system ($s) is not supported. Intelligent UI works on macOS and Linux." ;;
  esac
  case $m in
    arm64 | aarch64) ARCH=aarch64 ;;
    x86_64 | amd64) ARCH=x86_64 ;;
    *) die "this processor ($m) is not supported. Intelligent UI works on arm64 and x86_64." ;;
  esac
  # A shell under Rosetta says x86_64 on an Apple silicon Mac.
  if [ "$OS" = macos ] && [ "$ARCH" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2> /dev/null || true)" = 1 ]; then
    ARCH=aarch64
  fi
  note "System: $OS, $ARCH"
}

CLAUDE=
check_claude() {
  local v
  CLAUDE=$(command -v claude 2> /dev/null || true)
  if [ -z "$CLAUDE" ]; then
    # The native installer's place, when the shell has not put it on the PATH yet.
    for v in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do
      if [ -x "$v" ]; then
        CLAUDE=$v
        break
      fi
    done
  fi
  if [ -z "$CLAUDE" ]; then
    printf '\nError: Claude Code is not installed (no claude command on your PATH).\n' >&2
    printf 'Install Claude Code first: %s\nThen run this installer again. Nothing was changed.\n' "$CLAUDE_SETUP_URL" >&2
    exit 1
  fi
  v=$("$CLAUDE" --version < /dev/null 2> /dev/null | awk 'NR == 1 { print $1 }' || true)
  case $v in
    [0-9]*.[0-9]*.[0-9]*)
      note "Claude Code: $v ($(tilde "$CLAUDE"))"
      if ! version_ge "$v" "$MIN_CLAUDE"; then
        warn "Intelligent UI needs Claude Code $MIN_CLAUDE or later. Update Claude Code: claude update"
      fi
      ;;
    *) warn "could not read the version of Claude Code ($(tilde "$CLAUDE")). Intelligent UI needs $MIN_CLAUDE or later." ;;
  esac
}

# --- 2. Typst --------------------------------------------------------------

# The version of the typst at $1 (for example 0.15.1), or nothing.
typst_version() {
  "$1" --version < /dev/null 2> /dev/null | awk 'NR == 1 && $1 == "typst" { print $2 }' || true
}

# The typst that the mod uses (findTypst in hooks/lib/typst.ts): a login
# shell's PATH (macOS puts /usr/local/bin first there), then the PATH, then
# TYPST_DIRS in order.
mod_typst() {
  local p
  p=$(perl -e 'alarm 5; exec @ARGV' sh -lc 'command -v typst' < /dev/null 2> /dev/null | head -n 1 || true)
  case $p in /*)
    printf '%s' "$p"
    return 0
    ;;
  esac
  find_tool typst
}

# The program $1: on the PATH, else in TYPST_DIRS in order.
find_tool() {
  local p d
  p=$(command -v "$1" 2> /dev/null || true)
  case $p in /*)
    printf '%s' "$p"
    return 0
    ;;
  esac
  for d in $TYPST_DIRS; do
    case $d in \~/*) d=$HOME/${d#\~/} ;; esac
    if [ -e "$d/$1" ]; then
      printf '%s' "$d/$1"
      return 0
    fi
  done
  return 0
}

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    perl -MDigest::SHA -e 'print Digest::SHA->new(256)->addfile($ARGV[0], "b")->hexdigest' "$1"
  fi
}

# tar extracts .tar.xz with the xz command, or by itself (bsdtar, as on macOS).
tar_reads_xz() {
  command -v xz > /dev/null 2>&1 && return 0
  tar --version 2> /dev/null | grep -qi bsdtar
}

SUM_TYPST=
UNDO_TYPST=
install_typst() {
  local pick v dest asset want got bin
  step "2. Typst"
  if on "${IUI_NO_TYPST:-}"; then
    note "Skipped (IUI_NO_TYPST is set)."
    SUM_TYPST="not checked (IUI_NO_TYPST is set)"
    return 0
  fi
  dest=$HOME/.local/bin/typst
  pick=$(mod_typst)
  if [ -n "$pick" ]; then
    v=$(typst_version "$pick")
    if [ -n "$v" ] && version_ge "$v" "$TYPST_MIN"; then
      note "Typst $v is installed: $(tilde "$pick"). Not changed."
      SUM_TYPST="Typst $v, $(tilde "$pick") (already installed)"
      return 0
    fi
    note "Typst ${v:-of an unknown version} is at $(tilde "$pick"). Intelligent UI needs $TYPST_MIN or later."
  fi
  v=
  if [ -x "$dest" ]; then v=$(typst_version "$dest"); fi
  if [ -n "$v" ] && version_ge "$v" "$TYPST_MIN"; then
    note "Typst $v is in $(tilde "$dest") already. Not changed."
    SUM_TYPST="Typst $v, $(tilde "$dest") (already installed)"
  else
    command -v curl > /dev/null 2>&1 || die "curl is not installed. Install curl, or install Typst $TYPST_MIN yourself (refer to https://github.com/typst/typst#installation)."
    tar_reads_xz || die "tar can not extract .tar.xz files here. Install xz (xz-utils on Debian and Ubuntu), then run this installer again."
    if [ -d "$dest" ] && [ ! -L "$dest" ]; then die "$(tilde "$dest") is a folder. Typst was not installed."; fi
    asset=typst-$ARCH-$TARGET.tar.xz
    want=$(typst_sha256 "$asset") || die "no Typst release file for $ARCH-$TARGET."
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/iui-install.XXXXXX")
    note "Downloading the official Typst $TYPST_VERSION release: $TYPST_URL/$asset"
    curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 2 -o "$WORK/$asset" "$TYPST_URL/$asset" < /dev/null \
      || die "the download of Typst failed. Nothing was installed."
    got=$(sha256_of "$WORK/$asset")
    if [ "$got" != "$want" ]; then
      die "the SHA-256 of the downloaded Typst file is not correct (expected $want, got $got). The file was deleted, and nothing was installed."
    fi
    note "SHA-256 is correct: $got"
    mkdir "$WORK/x"
    tar -xJf "$WORK/$asset" -C "$WORK/x" < /dev/null || die "tar could not extract $asset. Nothing was installed."
    bin=$WORK/x/typst-$ARCH-$TARGET/typst
    if [ ! -f "$bin" ] || [ -L "$bin" ]; then die "no typst program in $asset. Nothing was installed."; fi
    chmod 755 "$bin"
    v=$(typst_version "$bin")
    [ "$v" = "$TYPST_VERSION" ] || die "the downloaded typst does not run here (it gave '${v}'). Nothing was installed."
    mkdir -p "$HOME/.local/bin"
    # A copy in the same folder, then one rename: never a half-written typst.
    cp "$bin" "$HOME/.local/bin/.typst.iui-$$"
    chmod 755 "$HOME/.local/bin/.typst.iui-$$"
    mv -f "$HOME/.local/bin/.typst.iui-$$" "$dest"
    note "Installed Typst $TYPST_VERSION: $(tilde "$dest")"
    SUM_TYPST="Typst $TYPST_VERSION, $(tilde "$dest") (downloaded and installed)"
    UNDO_TYPST="rm ~/.local/bin/typst"
  fi
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) note "Your PATH does not have ~/.local/bin. Intelligent UI finds Typst there. To run typst in a shell, add ~/.local/bin to your PATH." ;;
  esac
  pick=$(mod_typst)
  if [ -n "$pick" ] && [ "$pick" != "$dest" ]; then
    warn "Intelligent UI uses the first Typst it finds: $(tilde "$pick") (Typst $(typst_version "$pick")). Remove or update that one, or put ~/.local/bin before it in your PATH."
  fi
}

# --- JSON (perl) -------------------------------------------------------------

# A small strict JSON reader that keeps the byte place of each value, so a
# change to settings.json inserts text and keeps all other bytes. It needs
# only core perl (no modules). Modes:
#   marketplace NAME     stdin: the marketplace list (a JSON array); prints 3 lines for "name": NAME:
#                        official or other, the source for `marketplace add`, and a description.
#                        Exit 1: no such marketplace.
#   plugin ID            stdin: the plugin list; prints the "version" and "enabled" of "id": ID, "scope": "user"
#   copies NAME          stdin: the plugin list; prints "id TAB scope TAB version TAB enabled TAB projectPath"
#                        for each copy of the plugin NAME (any marketplace, any scope); a copy with no
#                        marketplace (@skills-dir, @inline) has its folder (installPath) for projectPath
#   entry FILE           prints declared, or off (autoUpdate: false), for extraKnownMarketplaces.razorback16
#                        in FILE. Exit 1: not there. Exit 2: FILE can not be read.
#   settings FILE BACKUP [OFF]
#                        sets extraKnownMarketplaces.razorback16 (source and autoUpdate: true, or false with OFF)
#                        in FILE; prints created, changed, unchanged or off (false already, kept).
#                        Exit 2: not changed (the reason on stdout).
# Exit 3: stdin is not a JSON array.
json_pl() {
  cat << 'PERL'
use strict; use warnings; no warnings 'recursion';
use Fcntl;
my ($mode, @args) = @ARGV;
my $s;
sub err { die "not valid JSON (byte " . (pos($s) // 0) . ": expected $_[0])\n" }
sub ws { $s =~ /\G[ \t\n\r]*/gc }
# The next byte (no zero-length match: perl allows no two at one place).
sub peek { substr($s, pos($s), 1) eq $_[0] }
sub str {
  $s =~ /\G"((?:[^"\\\x00-\x1f]++|\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4}))*+)"/gc or err('a string');
  my $r = $1;
  my %e = (n => "\n", t => "\t", b => "\b", f => "\f", r => "\r");
  # \u escapes as UTF-8 bytes (a pair for a character past U+FFFF), as the file's own bytes.
  $r =~ s{\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\(.)}
    {defined $1 ? u8(0x10000 + ((hex($1) - 0xD800) << 10) + hex($2) - 0xDC00) : defined $3 ? u8(hex $3) : ($e{$4} // $4)}ge;
  return $r;
}
sub u8 { my $c = chr(shift); utf8::encode($c); return $c }
sub val {
  ws();
  my $b = pos($s);
  if ($s =~ /\G\{/gc) {
    my @m;
    ws();
    unless ($s =~ /\G\}/gc) {
      while (1) {
        ws();
        my $ks = pos($s);
        peek('"') or err('a key');
        my $k = str();
        my $ke = pos($s);
        ws();
        $s =~ /\G:/gc or err("':'");
        my $v = val();
        push @m, { k => $k, ks => $ks, ke => $ke, v => $v };
        ws();
        next if $s =~ /\G,/gc;
        last if $s =~ /\G\}/gc;
        err("',' or '}'");
      }
    }
    return { t => 'o', m => \@m, b => $b, e => pos($s) };
  }
  if ($s =~ /\G\[/gc) {
    my @l;
    ws();
    unless ($s =~ /\G\]/gc) {
      while (1) {
        push @l, val();
        ws();
        next if $s =~ /\G,/gc;
        last if $s =~ /\G\]/gc;
        err("',' or ']'");
      }
    }
    return { t => 'a', l => \@l, b => $b, e => pos($s) };
  }
  if (peek('"')) { my $x = str(); return { t => 's', s => $x, b => $b, e => pos($s) } }
  if ($s =~ /\G-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/gc) { return { t => 'n', b => $b, e => pos($s) } }
  if ($s =~ /\G(true|false|null)/gc) { return { t => $1, b => $b, e => pos($s) } }
  err('a value');
}
sub parse {
  $s = $_[0];
  pos($s) = ($s =~ /^\xEF\xBB\xBF/) ? 3 : 0;
  my $v = val();
  ws();
  pos($s) == length($s) or err('the end of the file');
  return $v;
}
# The last member named $k (JSON.parse keeps the last one).
sub member { my ($o, $k) = @_; my $f; for (@{ $o->{m} }) { $f = $_ if $_->{k} eq $k } return $f }

# A string member, or undef.
sub sv { my ($o, $k) = @_; my $m = member($o, $k); return ($m && $m->{v}{t} eq 's') ? $m->{v}{s} : undef }
# No control bytes (for the shell's messages); other bytes, such as UTF-8 letters, are kept.
sub clean { my $x = shift // ''; $x =~ s/[\x00-\x1f\x7f]|\xc2[\x80-\x9f]//g; return $x }
# 1 when a source (an object with source, repo, url, ref, path) is the official
# one: GitHub razorback16/cc-intelligent-ui, with no ref, path or sparse paths.
sub official {
  my $o = shift;
  for my $k (qw(ref path)) { my $x = sv($o, $k); return 0 if defined $x && $x ne '' }
  return 0 if member($o, 'sparsePaths');
  my $kind = sv($o, 'source') // '';
  my $repo = sv($o, 'repo') // '';
  my $url = sv($o, 'url') // '';
  return 1 if $kind eq 'github' && lc($repo) eq 'razorback16/cc-intelligent-ui';
  return 1 if $kind eq 'git' && $url =~ m{\Ahttps://github\.com/razorback16/cc-intelligent-ui(?:\.git)?\z}i;
  return 0;
}

if ($mode eq 'marketplace' || $mode eq 'plugin' || $mode eq 'copies') {
  local $/; my $in = <STDIN> // '';
  my $v = eval { parse($in) } or exit 3;
  exit 3 unless $v->{t} eq 'a';
  for my $x (@{ $v->{l} }) {
    next unless $x->{t} eq 'o';
    if ($mode eq 'marketplace') {
      next unless (sv($x, 'name') // '') eq $args[0];
      my ($kind, $ref, $path) = map { clean(sv($x, $_)) } qw(source ref path);
      my ($spec, $desc);
      if ($kind eq 'github' || $kind eq 'git') {
        my $at = clean(sv($x, $kind eq 'git' ? 'url' : 'repo'));
        $spec = $at . ($ref ne '' ? "#$ref" : '');
        $desc = ($kind eq 'git' ? "the git URL $at" : "the GitHub repository $at") . ($ref ne '' ? " (ref $ref)" : '') . ($path ne '' ? " (folder $path)" : '');
      } elsif ($kind eq 'directory' || $kind eq 'file') {
        $spec = $path;
        $desc = ($kind eq 'file' ? 'the local file ' : 'the local folder ') . $path;
      } elsif ($kind eq 'url') {
        $spec = clean(sv($x, 'url'));
        $desc = "the URL $spec";
      } else {
        $spec = '';
        $desc = "a source of the type '$kind'";
      }
      print official($x) ? 'official' : 'other', "\n$spec\n$desc\n";
      exit 0;
    }
    my ($id, $sc, $ver, $en) = map { member($x, $_) } qw(id scope version enabled);
    next unless $id && $id->{v}{t} eq 's';
    my $vs = ($ver && $ver->{v}{t} eq 's') ? $ver->{v}{s} : '?';
    $vs =~ s/[^\x21-\x7e]//g;
    my $state = ($en && $en->{v}{t} eq 'false') ? 'disabled' : 'enabled';
    if ($mode eq 'plugin') {
      next unless $id->{v}{s} eq $args[0];
      next unless $sc && $sc->{v}{t} eq 's' && $sc->{v}{s} eq 'user';
      print $vs eq '' ? '?' : $vs, " $state\n";
      exit 0;
    }
    # copies: only ids that are safe to give to `claude plugin`.
    next unless $id->{v}{s} =~ /\A\Q$args[0]\E\@[A-Za-z0-9._-]+\z/;
    my $scope = clean(sv($x, 'scope'));
    $scope = '?' unless $scope =~ /\A[a-z]+\z/;
    my $where = sv($x, $id->{v}{s} =~ /\@(?:skills-dir|inline)\z/ ? 'installPath' : 'projectPath');
    print join("\t", $id->{v}{s}, $scope, $vs eq '' ? '?' : $vs, $state, clean($where)), "\n";
  }
  exit($mode eq 'copies' ? 0 : 1);
}
my $name = 'razorback16';
if ($mode eq 'entry') {
  my $f = $args[0];
  exit 1 unless -e $f;
  open(my $fh, '<:raw', $f) or exit 2;
  local $/; my $t = <$fh> // ''; close $fh;
  exit 1 if $t =~ /\A\s*\z/;
  my $root = eval { parse($t) } or exit 2;
  exit 2 unless $root->{t} eq 'o';
  my $ekm = member($root, 'extraKnownMarketplaces');
  exit 1 unless $ekm && $ekm->{v}{t} eq 'o';
  my $rb = member($ekm->{v}, $name) or exit 1;
  my $au = $rb->{v}{t} eq 'o' ? member($rb->{v}, 'autoUpdate') : undef;
  print $au && $au->{v}{t} eq 'false' ? "off\n" : "declared\n";
  exit 0;
}
exit 4 unless $mode eq 'settings';

my ($file, $bak, $off) = @args;
my $want = $off ? 'false' : 'true';
my @source = ([source => '"github"'], [repo => '"razorback16/cc-intelligent-ui"']);
sub refuse { print "$_[0]\n"; exit 2 }
my $real = $file;
if (-l $file) {
  require Cwd;
  $real = Cwd::realpath($file);
  refuse("$file is a link to a file that is not there") unless defined $real && -e $real;
}
my ($old, $text);
if (-e $real) {
  refuse("$file is not a file") unless -f $real;
  open(my $fh, '<:raw', $real) or refuse("can not read $file: $!");
  local $/; $old = <$fh> // ''; close $fh;
}
# Writes: a new file in the same folder, then one rename.
sub put {
  my ($path, $data, $fmode, $then) = @_;
  my $tmp = "$path.iui-$$";
  unlink $tmp;
  sysopen(my $fh, $tmp, O_WRONLY | O_CREAT | O_EXCL, defined $fmode ? 0600 : 0666) or die "can not write $tmp: $!\n";
  binmode $fh;
  unless ((print {$fh} $data) && close $fh) { my $e = $!; unlink $tmp; die "can not write $tmp: $e\n" }
  chmod($fmode, $tmp) if defined $fmode;
  # The backup only when the new file is written.
  if ($then) { eval { $then->(); 1 } or do { unlink $tmp; die $@ } }
  rename($tmp, $path) or do { my $e = $!; unlink $tmp; die "can not write $path: $e\n" };
}
# A file that is not writable, or one with more names (hard links), is not replaced.
sub writable {
  my $nl = (stat $real)[3];
  refuse("$file is not writable") unless -w $real;
  refuse("$file has $nl hard links, and a new file would break them") if $nl > 1;
}
# The line end of the file (CRLF kept).
our $NL = (defined $old && $old =~ /\r\n/) ? "\r\n" : "\n";
# JSON text for a value: [key, value] lists are objects, a string is raw JSON.
sub render {
  my ($v, $ind, $unit, $multi, $kv) = @_;
  return $v unless ref $v;
  my @p = map { '"' . $_->[0] . '"' . $kv . render($_->[1], $ind . $unit, $unit, $multi, $kv) } @$v;
  return $multi ? "{$NL" . join(",$NL", map { "$ind$unit$_" } @p) . "$NL$ind}" : '{' . join($kv eq ':' ? ',' : ', ', @p) . '}';
}
my $out;
if (!defined $old || $old =~ /\A\s*\z/) {
  $text = render([[extraKnownMarketplaces => [[$name => [[source => \@source], [autoUpdate => $want]]]]]], '', '  ', 1, ': ') . "\n";
  $out = defined $old ? 'changed' : 'created';
} else {
  my $root = eval { parse($old) };
  unless ($root) { chomp(my $why = $@); refuse("$file is $why") }
  refuse("$file is not a JSON object") unless $root->{t} eq 'o';
  my $lineind = sub { my $p = shift; my $l = rindex($old, "\n", $p - 1) + 1; substr($old, $l) =~ /^([ \t]*)/; $1 };
  my $nl = ($old =~ /\n/);
  my ($unit, $kv) = ('  ', ': ');
  if (@{ $root->{m} }) {
    my $f = $root->{m}[0];
    my $gap = substr($old, $root->{b} + 1, $f->{ks} - $root->{b} - 1);
    $unit = $1 if $gap =~ /\n([ \t]+)\z/;
    $kv = (substr($old, $f->{ke}, $f->{v}{b} - $f->{ke}) =~ / /) ? ': ' : ':';
  } elsif (!$nl) {
    $kv = ':';
  }
  # Each change: [begin, end, new text].
  my @edits;
  my $add = sub {
    my ($o, @members) = @_;
    my $li = $lineind->($o->{b});
    if (@{ $o->{m} }) {
      my $f = $o->{m}[0];
      my $l = $o->{m}[-1];
      my $gap = substr($old, $o->{b} + 1, $f->{ks} - $o->{b} - 1);
      my $okv = (substr($old, $f->{ke}, $f->{v}{b} - $f->{ke}) =~ / /) ? ': ' : ':';
      if ($gap =~ /\n([ \t]*)\z/) {
        my $mi = $1;
        my $u = (length($mi) > length($li) && substr($mi, 0, length $li) eq $li) ? substr($mi, length $li) : $unit;
        push @edits, [$l->{v}{e}, $l->{v}{e}, join('', map { ",$NL$mi\"$_->[0]\"$okv" . render($_->[1], $mi, $u, 1, $okv) } @members)];
      } else {
        my $sep = $okv eq ':' ? ',' : ', ';
        push @edits, [$l->{v}{e}, $l->{v}{e}, join('', map { "$sep\"$_->[0]\"$okv" . render($_->[1], '', '', 0, $okv) } @members)];
      }
    } else {
      push @edits, [$o->{b}, $o->{e}, render(\@members, $li, $unit, $nl ? 1 : 0, $kv)];
    }
  };
  my $ekm = member($root, 'extraKnownMarketplaces');
  if (!$ekm) {
    $add->($root, [extraKnownMarketplaces => [[$name => [[source => \@source], [autoUpdate => $want]]]]]);
  } elsif ($ekm->{v}{t} ne 'o') {
    refuse("extraKnownMarketplaces in $file is not an object");
  } else {
    my $rb = member($ekm->{v}, $name);
    if (!$rb) {
      $add->($ekm->{v}, [$name => [[source => \@source], [autoUpdate => $want]]]);
    } elsif ($rb->{v}{t} ne 'o') {
      refuse("extraKnownMarketplaces.$name in $file is not an object");
    } else {
      my $src = member($rb->{v}, 'source');
      refuse("extraKnownMarketplaces.$name in $file has another source, not the GitHub repository razorback16/cc-intelligent-ui")
        if $src && !($src->{v}{t} eq 'o' && official($src->{v}));
      my $au = member($rb->{v}, 'autoUpdate');
      if ($au && $au->{v}{t} eq 'true') { print "unchanged\n"; exit 0 }
      # Off by the person's choice (Disable auto-update): kept.
      if ($au && $au->{v}{t} eq 'false') { print "off\n"; exit 0 }
      if ($au) {
        push @edits, [$au->{v}{b}, $au->{v}{e}, $want];
      } else {
        $add->($rb->{v}, (member($rb->{v}, 'source') ? () : [source => \@source]), [autoUpdate => $want]);
      }
    }
  }
  $text = $old;
  for my $e (sort { $b->[0] <=> $a->[0] } @edits) { substr($text, $e->[0], $e->[1] - $e->[0]) = $e->[2] }
  $out = 'changed';
}
# The new text must read back with the entry set.
my $check = eval { parse($text) };
my $ok = $check && $check->{t} eq 'o';
for my $k ('extraKnownMarketplaces', $name, 'autoUpdate') {
  last unless $ok;
  my $m = member($check, $k);
  $ok = $m && ($k eq 'autoUpdate' ? $m->{v}{t} eq $want : $m->{v}{t} eq 'o');
  $check = $m->{v} if $ok;
}
refuse("the change of $file did not read back (nothing was written)") unless $ok;
writable() if defined $old;
my $fmode = defined $old ? (stat $real)[2] & 07777 : undef;
eval {
  put($real, $text, $fmode, defined $old ? sub { put($bak, $old, $fmode) } : undef);
  1;
} or do { chomp(my $why = $@); refuse($why) };
print "$out\n";
PERL
}

# LC_ALL=C: no perl locale warnings (a LANG that is not installed).
json() { LC_ALL=C perl -e "$(json_pl)" "$@"; }

# --- 3. The mod ----------------------------------------------------------------

SUM_PLUGIN=
COPIES=
# Undo lines of step 3 that are not always there (one per line).
UNDO_MORE=
TAB=$(printf '\t')
# $1 quoted for a shell command line, when it needs quotes.
shq() {
  case $1 in
    '' | *[!A-Za-z0-9_./:@#%+=,-]*) printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}
# The version in a plugin_state line, or "?".
ver_of() {
  local v=${1%% *}
  printf '%s' "${v:-?}"
}

# "VERSION enabled|disabled" of the mod in user scope, or nothing.
plugin_state() {
  "$CLAUDE" plugin list --json < /dev/null 2> /dev/null | json plugin "$PLUGIN" 2> /dev/null || true
}

# Each copy of the mod, from any marketplace, in any scope (lines of
# id, scope, version, enabled and projectPath, with tabs).
plugin_copies() {
  "$CLAUDE" plugin list --json < /dev/null 2> /dev/null | json copies "$PLUGIN_NAME" 2> /dev/null || true
}

# The razorback16 marketplace. MKT_KIND: official, other (another source:
# MKT_SPEC and MKT_DESC tell which), none (not known) or unknown (no JSON list).
MKT_KIND=
MKT_SPEC=
MKT_DESC=
marketplace_source() {
  local out info rc=0
  MKT_KIND=unknown
  if out=$("$CLAUDE" plugin marketplace list --json < /dev/null 2> /dev/null); then
    info=$(printf '%s' "$out" | json marketplace "$MARKETPLACE" 2> /dev/null) || rc=$?
    case $rc in
      0)
        {
          IFS= read -r MKT_KIND
          IFS= read -r MKT_SPEC
          IFS= read -r MKT_DESC
        } << INFO || true
$info
INFO
        return 0
        ;;
      1)
        MKT_KIND=none
        return 0
        ;;
    esac
  fi
  # No JSON: the text list. The source is not known.
  if ! "$CLAUDE" plugin marketplace list < /dev/null 2> /dev/null | grep -qw "$MARKETPLACE"; then MKT_KIND=none; fi
}

# The user settings file of Claude Code.
settings_file() { printf '%s/settings.json' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; }

# The razorback16 entry of the user settings: none, declared, off (autoUpdate
# false) or unknown (the file can not be read).
user_entry() {
  local f out rc=0
  f=$(settings_file)
  case $f in /*) ;; *)
    printf unknown
    return 0
    ;;
  esac
  out=$(json entry "$f" 2> /dev/null) || rc=$?
  case $rc in
    0) printf '%s' "$out" ;;
    1) printf none ;;
    *) printf unknown ;;
  esac
}

# The marketplace has another source (a fork, a pinned ref, a local folder):
# an update from it can not get the newest version. Remove its entry in the
# user settings, then add the official one. Claude Code can uninstall the mod
# with the marketplace; if it does, the installer installs it again.
OLD_STATE=
REPOINTED=
AUTO_OFF=
repoint_marketplace() {
  local id scope ver pp undo entry
  warn "the $MARKETPLACE marketplace comes from $MKT_DESC, not from the GitHub repository $MARKETPLACE_REPO. An update from there can not get the newest version of the mod."
  note "So the installer adds the $MARKETPLACE marketplace again from $MARKETPLACE_REPO."
  note "Claude Code can uninstall the mod with the old marketplace; if it does, the installer installs it again."
  note "Kept: your /iui settings (Claude Code keeps them under the name $PLUGIN). The mod has no other saved options, secrets or data."
  OLD_STATE=$(plugin_state)
  entry=$(user_entry)
  # Auto-update that you turned off stays off for the new source.
  if [ "$entry" = off ]; then AUTO_OFF=1; fi
  while IFS=$TAB read -r id scope ver _ pp; do
    if [ "$id" = "$PLUGIN" ] && [ "$scope" != user ]; then
      note "Claude Code can also remove the copy of the mod in $scope scope for ${pp:-a project}."
    fi
  done << COPIES
$COPIES
COPIES
  if [ -n "$MKT_SPEC" ]; then
    undo="claude plugin marketplace remove $MARKETPLACE, then claude plugin marketplace add $(shq "$MKT_SPEC")"
  else
    undo="claude plugin marketplace remove $MARKETPLACE, then add $MKT_DESC again"
  fi
  # `remove --scope user` fails when the user settings do not declare it (an
  # older Claude Code, or another scope); then `add` changes its source by itself.
  if [ "$entry" = none ]; then
    note "Your user settings do not declare the $MARKETPLACE marketplace, so claude plugin marketplace add changes its source."
    if ! claude_run plugin marketplace add "$MARKETPLACE_REPO"; then
      die "Claude Code could not add the marketplace $MARKETPLACE_REPO. The old marketplace was not changed. The mod was not updated."
    fi
  else
    claude_run plugin marketplace remove "$MARKETPLACE" --scope user || die "Claude Code could not remove the marketplace $MARKETPLACE (from $MKT_DESC). The mod was not updated."
    if ! claude_run plugin marketplace add "$MARKETPLACE_REPO"; then
      die "Claude Code could not add the marketplace $MARKETPLACE_REPO. To add the old one back: claude plugin marketplace add $(shq "${MKT_SPEC:-?}")"
    fi
  fi
  note "The $MARKETPLACE marketplace comes from $MARKETPLACE_REPO now (before: $MKT_DESC)."
  REPOINTED=1
  UNDO_MORE="${UNDO_MORE}Old source:   $undo
"
}

# A copy that is in $2 (copies lines) with the id, scope and path of line $1.
copy_in() {
  local id scope pp i s p
  IFS=$TAB read -r id scope _ _ pp << LINE
$1
LINE
  while IFS=$TAB read -r i s _ _ p; do
    if [ "$i" = "$id" ] && [ "$s" = "$scope" ] && [ "$p" = "$pp" ]; then return 0; fi
  done << LIST
$2
LIST
  return 1
}

install_plugin() {
  local before after rc=0 mkt_ok=1 now line id scope ver pp old new
  step "3. The mod: $PLUGIN"
  COPIES=$(plugin_copies)
  marketplace_source
  case $MKT_KIND in
    none) claude_run plugin marketplace add "$MARKETPLACE_REPO" || die "Claude Code could not add the marketplace $MARKETPLACE_REPO." ;;
    other) repoint_marketplace ;;
    *)
      if ! claude_run plugin marketplace update "$MARKETPLACE"; then
        mkt_ok=
        warn "the marketplace update failed. The mod is updated from the copy of the marketplace that Claude Code has, which can be old."
      fi
      ;;
  esac
  before=$(plugin_state)
  if [ -n "$before" ]; then
    claude_run plugin update "$PLUGIN" --scope user || rc=$?
    after=$(plugin_state)
    if [ "$rc" != 0 ]; then
      warn "the update of the mod failed. The installed version ($(ver_of "$after")) stays."
      SUM_PLUGIN="$PLUGIN_NAME $(ver_of "$after") (NOT updated: the update failed, refer to the warning above)"
      PROBLEM=1
    elif [ "$(ver_of "$after")" != "$(ver_of "$before")" ]; then
      SUM_PLUGIN="$PLUGIN_NAME $(ver_of "$after") (updated from $(ver_of "$before"))"
    elif [ -z "$mkt_ok" ]; then
      SUM_PLUGIN="$PLUGIN_NAME $(ver_of "$after") (NOT checked for a newer version: the marketplace update failed)"
      PROBLEM=1
    elif [ "$MKT_KIND" = unknown ]; then
      SUM_PLUGIN="$PLUGIN_NAME $(ver_of "$after") (no newer version found)"
    else
      SUM_PLUGIN="$PLUGIN_NAME $(ver_of "$after") (the newest version was installed already)"
    fi
  else
    claude_run plugin install "$PLUGIN" --scope user || die "Claude Code could not install $PLUGIN."
    after=$(plugin_state)
    SUM_PLUGIN="$PLUGIN_NAME $(ver_of "$after") (installed)"
  fi
  if [ -n "$REPOINTED" ] && [ "$rc" = 0 ]; then
    SUM_PLUGIN="$PLUGIN_NAME $(ver_of "$after") (from $MARKETPLACE_REPO now; before: $(ver_of "$OLD_STATE") from $MKT_DESC)"
    # A local folder can have a version that is not released yet.
    old=$(ver_of "$OLD_STATE")
    new=$(ver_of "$after")
    if [ "$old" != '?' ] && [ "$new" != '?' ] && [ "$old" != "$new" ] && version_ge "$old" "$new"; then
      warn "the version from the old source ($old) is newer than the version on GitHub ($new). To use the old source again: $(printf '%s' "$UNDO_MORE" | sed -n 's/^Old source: *//p')"
    fi
  fi
  # A mod that was disabled before the new marketplace stays disabled.
  case $OLD_STATE:$after in
    *' disabled:'*' enabled')
      claude_run plugin disable "$PLUGIN" --scope user || warn "Claude Code could not disable the mod again."
      after=$(plugin_state)
      ;;
  esac
  case $after in
    *' disabled') warn "the mod is disabled in Claude Code. To turn it on: claude plugin enable $PLUGIN" ;;
  esac
  now=$(plugin_copies)
  # A copy with no marketplace: Claude Code can not uninstall it.
  while IFS=$TAB read -r id scope ver _ pp; do
    case $id in
      *@skills-dir) warn "a copy of the mod is in a skills folder of Claude Code ($(tilde "${pp:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills}")): $id $ver. It has no marketplace, so Claude Code can not uninstall it. The copy from $MARKETPLACE is used, not that one. To remove it, delete its folder (claude plugin list shows it)." ;;
      *@inline) warn "a copy of the mod is loaded with --plugin-dir${pp:+ from $pp}: $id $ver. Claude Code can not uninstall it. To stop it, start Claude Code without that --plugin-dir." ;;
    esac
  done << NOW
$now
NOW
  # Another copy in user scope (from another marketplace) would run too.
  if [ -n "$after" ]; then
    while IFS=$TAB read -r id scope ver _ pp; do
      case $id in '' | "$PLUGIN" | *@skills-dir | *@inline) continue ;; esac
      [ "$scope" = user ] || continue
      note "Another copy of the mod is installed for your user: $id $ver. Two copies would both run, so the installer uninstalls that one."
      if claude_run plugin uninstall "$id" --scope user; then
        note "Uninstalled $id. Its /iui settings are kept under its own name; set them again with /iui if you want."
        UNDO_MORE="${UNDO_MORE}Other copy:   claude plugin install $id --scope user
"
      else
        warn "Claude Code could not uninstall $id. Two copies of the mod run. To remove it: claude plugin uninstall $id --scope user"
        PROBLEM=1
      fi
    done << NOW
$now
NOW
    now=$(plugin_copies)
  fi
  # Copies in a project: not changed. In that folder, they can hide the user copy.
  while IFS=$TAB read -r id scope ver _ pp; do
    case $scope in '' | user) continue ;; esac
    case $id in *@skills-dir | *@inline) continue ;; esac
    warn "a copy of the mod is installed in $scope scope for ${pp:-a project}: $id $ver. In that project it can be used instead of the version above. To remove it: cd $(shq "${pp:-.}") && claude plugin uninstall $id --scope $scope"
  done << NOW
$now
NOW
  # Copies that Claude Code removed with the old marketplace.
  if [ -n "$REPOINTED" ]; then
    while IFS= read -r line; do
      IFS=$TAB read -r id scope _ _ pp << LINE
$line
LINE
      case $scope in '' | user) continue ;; esac
      [ "$id" = "$PLUGIN" ] || continue
      copy_in "$line" "$now" && continue
      warn "Claude Code removed the copy of the mod in $scope scope for ${pp:-a project} with the old marketplace. To install it there again: cd $(shq "${pp:-.}") && claude plugin install $PLUGIN --scope $scope"
    done << COPIES
$COPIES
COPIES
  fi
}

# --- 4. Auto-update ------------------------------------------------------------

SUM_AUTO=
AUTO_ON=
UNDO_AUTO=
PROBLEM=
manual_auto_update() {
  say "  To turn on auto-update yourself: in Claude Code, type /plugin, go to Marketplaces," >&2
  say "  select $MARKETPLACE, then select Enable auto-update. Or add this to $1:" >&2
  cat >&2 << EOF
    "extraKnownMarketplaces": {
      "$MARKETPLACE": {
        "source": { "source": "github", "repo": "$MARKETPLACE_REPO" },
        "autoUpdate": true
      }
    }
EOF
}

# Auto-update turned on: $1 is created or changed, $2 the file.
auto_on() {
  AUTO_ON=1
  if [ "$1" = created ]; then
    note "Made $(tilde "$2") with extraKnownMarketplaces.$MARKETPLACE.autoUpdate = true."
    SUM_AUTO="on ($(tilde "$2"), new file)"
    return 0
  fi
  note "Set extraKnownMarketplaces.$MARKETPLACE.autoUpdate = true in $(tilde "$2")."
  note "All other settings are kept. The file before this auto-update change: $(tilde "$2").bak-iui"
  note "(It has the changes of step 3 already: the backup undoes only the auto-update change.)"
  SUM_AUTO="on ($(tilde "$2"))"
  UNDO_AUTO="copy $(tilde "$2").bak-iui (the file before the auto-update change only) back to $(tilde "$2")"
}

auto_update() {
  local dir file result rc t
  step "4. Auto-update for the $MARKETPLACE marketplace"
  if on "${IUI_NO_AUTO_UPDATE:-}"; then
    note "Skipped (IUI_NO_AUTO_UPDATE is set)."
    SUM_AUTO="not changed (IUI_NO_AUTO_UPDATE is set)"
    return 0
  fi
  dir=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
  file=$(settings_file)
  case $dir in
    /*) ;;
    *)
      warn "CLAUDE_CONFIG_DIR ($dir) is not an absolute path, so the settings file is not known. Nothing was changed."
      manual_auto_update "your settings.json"
      SUM_AUTO="NOT turned on (refer to the warning above)"
      PROBLEM=1
      return 0
      ;;
  esac
  if ! command -v perl > /dev/null 2>&1; then
    warn "perl is not installed, so $(tilde "$file") was not changed."
    manual_auto_update "$(tilde "$file")"
    SUM_AUTO="NOT turned on (refer to the warning above)"
    PROBLEM=1
    return 0
  fi
  if [ ! -e "$file" ] && [ ! -L "$file" ]; then mkdir -p "$dir"; fi
  rc=0
  # Only stdout is the result; perl's stderr goes to the screen.
  result=$(json settings "$file" "$file.bak-iui" ${AUTO_OFF:+off}) || rc=$?
  t="~"
  result=${result//"$HOME"/$t}
  case $rc:$result in
    0:unchanged)
      note "Auto-update is on already ($(tilde "$file")). Not changed."
      SUM_AUTO="on (it was on already)"
      AUTO_ON=1
      ;;
    0:off)
      note "Auto-update is off: you turned it off (extraKnownMarketplaces.$MARKETPLACE.autoUpdate = false in $(tilde "$file")). Not changed."
      SUM_AUTO="off (your choice; not changed)"
      ;;
    0:created | 0:changed)
      if [ -z "$AUTO_OFF" ]; then
        auto_on "$result" "$file"
      else
        note "Auto-update stays off for the new source, as you set it: extraKnownMarketplaces.$MARKETPLACE.autoUpdate = false in $(tilde "$file")."
        if [ "$result" = changed ]; then note "The file before this change: $(tilde "$file").bak-iui"; fi
        SUM_AUTO="off (your choice; kept for the new source)"
      fi
      ;;
    *)
      warn "$(tilde "$file") was not changed: ${result:-an unknown error}"
      manual_auto_update "$(tilde "$file")"
      SUM_AUTO="NOT turned on (refer to the warning above)"
      PROBLEM=1
      ;;
  esac
}

# --- 5. Pictures in iTerm2 and herdr -------------------------------------------

# The mod's own setup block (SETUP_START, SETUP_END and setupBlock() of
# hooks/lib/setup.ts, byte for byte): Claude Code shows pictures in iTerm2 and
# herdr only with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 when it starts. The mod's
# /iui setup sees this block as done, and /iui setup remove removes it.
SETUP_START='# >>> cc-intelligent-ui: Claude Code pictures in iTerm2 >>>'
SETUP_END='# <<< cc-intelligent-ui <<<'
# shellcheck disable=SC2016 # the shell reads these lines later, not now
SETUP_SH='if { [ "$TERM_PROGRAM" = "iTerm.app" ] || [ "$TERM_PROGRAM" = "herdr" ]; } && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi'
# shellcheck disable=SC2016
SETUP_FISH='if test "$TERM_PROGRAM" = "iTerm.app" -o "$TERM_PROGRAM" = "herdr"; and not set -q TMUX; and not set -q STY; set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1; end'

# Puts the block in a start file as the mod's withSetup() does: an older block
# of the mod is replaced, one blank line goes before the block, and the exact
# block already there changes nothing. Args: FILE START LINE END BACKUP. A link
# keeps its place and its file changes. Prints created, changed (block added),
# updated (an older block replaced) or unchanged. Exit 2: not changed (the reason on stdout).
setup_pl() {
  cat << 'PERL'
use strict; use warnings;
use Fcntl;
my ($file, $start, $line, $end, $bak) = @ARGV;
sub refuse { print "$_[0]\n"; exit 2 }
my $real = $file;
if (-l $file) {
  require Cwd;
  $real = Cwd::realpath($file);
  refuse("$file is a link to a file that is not there") unless defined $real && -e $real;
}
my $old;
if (-e $real) {
  refuse("$file is not a regular file") unless -f $real;
  refuse("$file is larger than 4 MB") if -s $real > 4 * 1024 * 1024;
  open(my $fh, '<:raw', $real) or refuse("can not read $file: $!");
  local $/; $old = <$fh>; close $fh;
  refuse("can not read $file") unless defined $old;
}
my $text = $old // '';
my $block = "$start\n$line\n$end\n";
if (index($text, $block) >= 0) { print "unchanged\n"; exit 0 }
# withoutSetup(): each START ... END block goes, with one blank line before it.
my @lines = split /\n/, $text, -1;
my @out;
my $replaced = 0;
for (my $i = 0; $i < @lines; $i++) {
  if ($lines[$i] ne $start) { push @out, $lines[$i]; next }
  my $e = -1;
  for my $j ($i .. $#lines) { if ($lines[$j] eq $end) { $e = $j; last } }
  if ($e < 0) { push @out, $lines[$i]; next }
  pop @out if @out && $out[-1] eq '';
  $i = $e;
  $replaced++;
}
my $base = join("\n", @out);
$base =~ s/\n*\z//;
my $new = $base . ($base ne '' ? "\n\n" : '') . $block;
# Writes: a new file in the same folder, then one rename.
sub put {
  my ($path, $data, $fmode, $then) = @_;
  my $tmp = "$path.iui-$$";
  unlink $tmp;
  sysopen(my $fh, $tmp, O_WRONLY | O_CREAT | O_EXCL, defined $fmode ? 0600 : 0666) or die "can not write $tmp: $!\n";
  binmode $fh;
  unless ((print {$fh} $data) && close $fh) { my $e = $!; unlink $tmp; die "can not write $tmp: $e\n" }
  chmod($fmode, $tmp) if defined $fmode;
  # The backup only when the new file is written.
  if ($then) { eval { $then->(); 1 } or do { unlink $tmp; die $@ } }
  rename($tmp, $path) or do { my $e = $!; unlink $tmp; die "can not write $path: $e\n" };
}
# A file that is not writable, or one with more names (hard links), is not replaced.
if (defined $old) {
  my $nl = (stat $real)[3];
  refuse("$file is not writable") unless -w $real;
  refuse("$file has $nl hard links, and a new file would break them") if $nl > 1;
}
my $fmode = defined $old ? (stat $real)[2] & 07777 : undef;
eval {
  put($real, $new, $fmode, defined $old ? sub { put($bak, $old, $fmode) } : undef);
  1;
} or do { chomp(my $why = $@); refuse($why) };
print !defined $old ? "created\n" : $replaced ? "updated\n" : "changed\n";
PERL
}

# 0 when iTerm2 is installed (macOS). IUI_TEST_ROOT is only for the tests.
has_iterm() {
  local p
  [ "$OS" = macos ] || return 1
  for p in "${IUI_TEST_ROOT:-}/Applications/iTerm.app" "$HOME/Applications/iTerm.app"; do
    if [ -d "$p" ]; then return 0; fi
  done
  command -v mdfind > /dev/null 2>&1 || return 1
  # Spotlight, stopped after 5 s.
  p=$(perl -e 'alarm 5; exec @ARGV' mdfind "kMDItemCFBundleIdentifier == 'com.googlecode.iterm2'" < /dev/null 2> /dev/null | grep -m 1 '\.app$' || true)
  [ -n "$p" ]
}

SUM_SHELL=
UNDO_SHELL=
shell_setup() {
  local apps='' name file kind line result rc t f
  step "5. Pictures in iTerm2 and herdr"
  if on "${IUI_NO_SHELL_SETUP:-}"; then
    note "Skipped (IUI_NO_SHELL_SETUP is set)."
    SUM_SHELL="not changed (IUI_NO_SHELL_SETUP is set)"
    return 0
  fi
  if has_iterm; then apps=iTerm2; fi
  if [ -n "$(find_tool herdr)" ]; then apps=${apps:+$apps and }herdr; fi
  if [ -z "$apps" ]; then
    note "No iTerm2 or herdr found. Not needed: other terminals need no setup."
    SUM_SHELL="not needed (no iTerm2 or herdr)"
    return 0
  fi
  note "$apps found. Claude Code shows pictures there only with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1."
  # The start file of the login shell, as the mod's shellRcOf() picks it.
  name=${SHELL:-}
  name=${name##*/}
  case $name in
    zsh) file=${ZDOTDIR:-$HOME}/.zshrc kind='sh' ;;
    bash)
      kind='sh'
      file=$HOME/.bashrc
      if [ "$OS" = macos ]; then
        # Login bash reads only the first of these that exists: a new .bash_profile would hide the others.
        file=$HOME/.bash_profile
        for f in .bash_profile .bash_login .profile; do
          if [ -e "$HOME/$f" ] || [ -L "$HOME/$f" ]; then
            file=$HOME/$f
            break
          fi
        done
      fi
      ;;
    fish) file=${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/cc-intelligent-ui.fish kind='fish' ;;
    *)
      note "Your shell (${name:-not known}) is not one that the mod knows, so no file was changed."
      note "Add this to your shell's start file: export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 (only in iTerm2 and herdr, not in tmux or screen)"
      SUM_SHELL="NOT added (your shell is not known; refer to the lines above)"
      return 0
      ;;
  esac
  if [ "$kind" = fish ]; then line=$SETUP_FISH; else line=$SETUP_SH; fi
  if ! command -v perl > /dev/null 2>&1; then
    result="perl is not installed"
    rc=2
  else
    if [ "$kind" = fish ] && [ ! -e "$file" ] && [ ! -L "$file" ]; then mkdir -p "${file%/*}"; fi
    rc=0
    # Only stdout is the result (LC_ALL=C: no perl locale warnings).
    result=$(LC_ALL=C perl -e "$(setup_pl)" "$file" "$SETUP_START" "$line" "$SETUP_END" "$file.bak-iui") || rc=$?
  fi
  t="~"
  result=${result//"$HOME"/$t}
  case $rc:$result in
    0:unchanged)
      note "$(tilde "$file") has the Intelligent UI block already. Not changed."
      SUM_SHELL="set already in $(tilde "$file")"
      ;;
    0:created)
      note "Made $(tilde "$file") with the Intelligent UI block."
      SUM_SHELL="added to $(tilde "$file") (open a new tab or pane)"
      ;;
    0:changed)
      note "Added the Intelligent UI block to $(tilde "$file")."
      note "The file before this change: $(tilde "$file").bak-iui"
      SUM_SHELL="added to $(tilde "$file") (open a new tab or pane)"
      ;;
    0:updated)
      note "Updated the Intelligent UI block in $(tilde "$file") (an older block of the mod is replaced)."
      note "The file before this change: $(tilde "$file").bak-iui"
      SUM_SHELL="updated in $(tilde "$file") (open a new tab or pane)"
      ;;
    *)
      warn "$(tilde "$file") was not changed: ${result:-an unknown error}"
      say "  To set it yourself, add these lines to $(tilde "$file"), or run /iui setup in Claude Code in iTerm2 or herdr:" >&2
      printf '    %s\n' "$SETUP_START" "$line" "$SETUP_END" >&2
      SUM_SHELL="NOT added (refer to the warning above)"
      PROBLEM=1
      return 0
      ;;
  esac
  UNDO_SHELL="/iui setup remove in Claude Code, or delete the lines from '$SETUP_START' to '$SETUP_END' in $(tilde "$file")"
}

# --- 6. Summary ----------------------------------------------------------------

summary() {
  step "Done"
  note "Typst:        $SUM_TYPST"
  note "Mod:          $SUM_PLUGIN"
  note "Auto-update:  $SUM_AUTO"
  note "Pictures in iTerm2/herdr: $SUM_SHELL"
  say ""
  say "Restart Claude Code, or type /reload-plugins in a session that runs now."
  say "Intelligent UI works best in fullscreen mode: type /tui fullscreen in Claude Code."
  say "Pictures show only in some terminals (kitty, Ghostty, iTerm2 and others). To see why"
  say "pictures do or do not show, type /iui details. Docs: https://github.com/razorback16/cc-intelligent-ui"
  say ""
  say "To undo:"
  if [ -n "$UNDO_TYPST" ]; then note "Typst:        $UNDO_TYPST"; fi
  note "Mod:          claude plugin uninstall $PLUGIN"
  note "Marketplace:  claude plugin marketplace remove $MARKETPLACE  (also removes its settings entry)"
  if [ -n "$UNDO_MORE" ]; then printf '%s' "$UNDO_MORE" | sed 's/^/  /'; fi
  if [ -n "$AUTO_ON" ]; then
    note "Auto-update:  /plugin > Marketplaces > $MARKETPLACE > Disable auto-update"
    note "              (it also sets extraKnownMarketplaces.$MARKETPLACE.autoUpdate to false in settings.json)"
    if [ -n "$UNDO_AUTO" ]; then note "              or $UNDO_AUTO"; fi
  fi
  if [ -n "$UNDO_SHELL" ]; then note "Shell setup:  $UNDO_SHELL"; fi
  case $SUM_AUTO in off*)
    say ""
    say "Auto-update is off, as you set it. To turn it on: in Claude Code, type /plugin, go to"
    say "Marketplaces, select $MARKETPLACE, then select Enable auto-update."
    ;;
  esac
}

main() {
  init_output
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  say "${BOLD}Intelligent UI for Claude Code: installer${PLAIN}"
  say "It installs Typst $TYPST_VERSION (when no Typst $TYPST_MIN or later is found), the mod $PLUGIN,"
  say "turns on auto-update for the $MARKETPLACE marketplace, and sets up pictures in iTerm2 and herdr."
  say "It never uses sudo."
  step "1. Checks"
  check_platform
  check_claude
  install_typst
  cleanup
  WORK=
  install_plugin
  auto_update
  shell_setup
  summary
  if [ -n "$PROBLEM" ]; then
    say ""
    say "Finished with a problem: refer to the warning above."
    exit 1
  fi
}

main "$@"
