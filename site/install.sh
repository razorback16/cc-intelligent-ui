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
#      commands (or updates both when they are there).
#   4. Turns on auto-update for the razorback16 marketplace in your Claude Code
#      settings.json (extraKnownMarketplaces), with a backup.
# Run it again to update. It never uses sudo.
# Options: IUI_NO_TYPST=1 (no Typst step), IUI_NO_AUTO_UPDATE=1 (no auto-update step).
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

# The typst that the mod uses: the PATH first, then TYPST_DIRS in order.
mod_typst() {
  local p d
  p=$(command -v typst 2> /dev/null || true)
  case $p in /*)
    printf '%s' "$p"
    return 0
    ;;
  esac
  for d in $TYPST_DIRS; do
    case $d in \~/*) d=$HOME/${d#\~/} ;; esac
    if [ -e "$d/typst" ]; then
      printf '%s' "$d/typst"
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
#   has-name NAME        stdin: a JSON array; exit 0 when an object in it has "name": NAME
#   plugin ID            stdin: a JSON array; prints the "version" and "enabled" of "id": ID, "scope": "user"
#   settings FILE BACKUP sets extraKnownMarketplaces.razorback16 (source and autoUpdate: true)
#                        in FILE; prints created, changed or unchanged. Exit 2: not changed (the reason on stdout).
json_pl() {
  cat << 'PERL'
use strict; use warnings;
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
  $r =~ s{\\(?:u([0-9a-fA-F]{4})|(.))}{defined $1 ? chr(hex $1) : ($e{$2} // $2)}ge;
  return $r;
}
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

if ($mode eq 'has-name' || $mode eq 'plugin') {
  local $/; my $in = <STDIN> // '';
  my $v = eval { parse($in) } or exit 3;
  exit 3 unless $v->{t} eq 'a';
  for my $x (@{ $v->{l} }) {
    next unless $x->{t} eq 'o';
    if ($mode eq 'has-name') {
      my $n = member($x, 'name');
      exit 0 if $n && $n->{v}{t} eq 's' && $n->{v}{s} eq $args[0];
    } else {
      my ($id, $sc, $ver, $en) = map { member($x, $_) } qw(id scope version enabled);
      next unless $id && $id->{v}{t} eq 's' && $id->{v}{s} eq $args[0];
      next unless $sc && $sc->{v}{t} eq 's' && $sc->{v}{s} eq 'user';
      my $vs = ($ver && $ver->{v}{t} eq 's') ? $ver->{v}{s} : '?';
      $vs =~ s/[^\x21-\x7e]//g;
      print $vs, ' ', (($en && $en->{v}{t} eq 'false') ? 'disabled' : 'enabled'), "\n";
      exit 0;
    }
  }
  exit 1;
}
exit 4 unless $mode eq 'settings';

my ($file, $bak) = @args;
my $name = 'razorback16';
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
  my ($path, $data, $fmode) = @_;
  my $tmp = "$path.iui-$$";
  unlink $tmp;
  sysopen(my $fh, $tmp, O_WRONLY | O_CREAT | O_EXCL, defined $fmode ? 0600 : 0666) or die "can not write $tmp: $!\n";
  binmode $fh;
  print {$fh} $data or die "can not write $tmp: $!\n";
  close $fh or die "can not write $tmp: $!\n";
  chmod($fmode, $tmp) if defined $fmode;
  rename($tmp, $path) or do { unlink $tmp; die "can not write $path: $!\n" };
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
  $text = render([[extraKnownMarketplaces => [[$name => [[source => \@source], [autoUpdate => 'true']]]]]], '', '  ', 1, ': ') . "\n";
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
    $add->($root, [extraKnownMarketplaces => [[$name => [[source => \@source], [autoUpdate => 'true']]]]]);
  } elsif ($ekm->{v}{t} ne 'o') {
    refuse("extraKnownMarketplaces in $file is not an object");
  } else {
    my $rb = member($ekm->{v}, $name);
    if (!$rb) {
      $add->($ekm->{v}, [$name => [[source => \@source], [autoUpdate => 'true']]]);
    } elsif ($rb->{v}{t} ne 'o') {
      refuse("extraKnownMarketplaces.$name in $file is not an object");
    } else {
      my $au = member($rb->{v}, 'autoUpdate');
      if ($au && $au->{v}{t} eq 'true') { print "unchanged\n"; exit 0 }
      if ($au) {
        push @edits, [$au->{v}{b}, $au->{v}{e}, 'true'];
      } else {
        $add->($rb->{v}, (member($rb->{v}, 'source') ? () : [source => \@source]), [autoUpdate => 'true']);
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
  $ok = $m && ($k eq 'autoUpdate' ? $m->{v}{t} eq 'true' : $m->{v}{t} eq 'o');
  $check = $m->{v} if $ok;
}
refuse("the change of $file did not read back (nothing was written)") unless $ok;
my $fmode = defined $old ? (stat $real)[2] & 07777 : undef;
eval {
  put($bak, $old, $fmode) if defined $old;
  put($real, $text, $fmode);
  1;
} or refuse("$@");
print "$out\n";
PERL
}

json() { perl -e "$(json_pl)" "$@"; }

# --- 3. The mod ----------------------------------------------------------------

SUM_PLUGIN=
# "VERSION enabled|disabled" of the mod in user scope, or nothing.
plugin_state() {
  "$CLAUDE" plugin list --json < /dev/null 2> /dev/null | json plugin "$PLUGIN" 2> /dev/null || true
}

marketplace_known() {
  local out rc=0
  if out=$("$CLAUDE" plugin marketplace list --json < /dev/null 2> /dev/null); then
    printf '%s' "$out" | json has-name "$MARKETPLACE" 2> /dev/null || rc=$?
    case $rc in 0 | 1) return $rc ;; esac
  fi
  # No JSON: the text list.
  "$CLAUDE" plugin marketplace list < /dev/null 2> /dev/null | grep -qw "$MARKETPLACE"
}

install_plugin() {
  local before after
  step "3. The mod: $PLUGIN"
  if marketplace_known; then
    claude_run plugin marketplace update "$MARKETPLACE" || warn "the marketplace update failed. The mod is updated from the copy that Claude Code has."
  else
    claude_run plugin marketplace add "$MARKETPLACE_REPO" || die "Claude Code could not add the marketplace $MARKETPLACE_REPO."
  fi
  before=$(plugin_state)
  if [ -n "$before" ]; then
    claude_run plugin update "$PLUGIN" --scope user || warn "the update of the mod failed. The installed version stays."
    after=$(plugin_state)
    if [ "${after%% *}" = "${before%% *}" ]; then
      SUM_PLUGIN="$PLUGIN_NAME ${after%% *} (the newest version was installed already)"
    else
      SUM_PLUGIN="$PLUGIN_NAME ${after%% *} (updated from ${before%% *})"
    fi
  else
    claude_run plugin install "$PLUGIN" --scope user || die "Claude Code could not install $PLUGIN."
    after=$(plugin_state)
    SUM_PLUGIN="$PLUGIN_NAME ${after%% *} (installed)"
  fi
  case $after in
    *' disabled') warn "the mod is disabled in Claude Code. To turn it on: claude plugin enable $PLUGIN" ;;
  esac
}

# --- 4. Auto-update ------------------------------------------------------------

SUM_AUTO=
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

auto_update() {
  local dir file result rc t
  step "4. Auto-update for the $MARKETPLACE marketplace"
  if on "${IUI_NO_AUTO_UPDATE:-}"; then
    note "Skipped (IUI_NO_AUTO_UPDATE is set)."
    SUM_AUTO="not changed (IUI_NO_AUTO_UPDATE is set)"
    return 0
  fi
  dir=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
  file=$dir/settings.json
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
  result=$(json settings "$file" "$file.bak-iui" 2>&1) || rc=$?
  t="~"
  result=${result//"$HOME"/$t}
  case $rc:$result in
    0:unchanged)
      note "Auto-update is on already ($(tilde "$file")). Not changed."
      SUM_AUTO="on (it was on already)"
      ;;
    0:created)
      note "Made $(tilde "$file") with extraKnownMarketplaces.$MARKETPLACE.autoUpdate = true."
      SUM_AUTO="on ($(tilde "$file"), new file)"
      UNDO_AUTO="delete $(tilde "$file")"
      ;;
    0:changed)
      note "Set extraKnownMarketplaces.$MARKETPLACE.autoUpdate = true in $(tilde "$file")."
      note "All other settings are kept. The file before the change: $(tilde "$file").bak-iui"
      SUM_AUTO="on ($(tilde "$file"))"
      UNDO_AUTO="copy $(tilde "$file").bak-iui back to $(tilde "$file")"
      ;;
    *)
      warn "$(tilde "$file") was not changed: ${result:-an unknown error}"
      manual_auto_update "$(tilde "$file")"
      SUM_AUTO="NOT turned on (refer to the warning above)"
      PROBLEM=1
      ;;
  esac
}

# --- 5. Summary ----------------------------------------------------------------

summary() {
  step "Done"
  note "Typst:        $SUM_TYPST"
  note "Mod:          $SUM_PLUGIN"
  note "Auto-update:  $SUM_AUTO"
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
  if [ -n "$UNDO_AUTO" ]; then
    note "Auto-update:  /plugin > Marketplaces > $MARKETPLACE > Disable auto-update, or $UNDO_AUTO"
  fi
}

main() {
  init_output
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  say "${BOLD}Intelligent UI for Claude Code: installer${PLAIN}"
  say "It installs Typst $TYPST_VERSION (when no Typst $TYPST_MIN or later is found), the mod $PLUGIN,"
  say "and turns on auto-update for the $MARKETPLACE marketplace. It never uses sudo."
  step "1. Checks"
  check_platform
  check_claude
  install_typst
  cleanup
  WORK=
  install_plugin
  auto_update
  summary
  if [ -n "$PROBLEM" ]; then
    say ""
    say "Finished with a problem: refer to the warning above."
    exit 1
  fi
}

main "$@"
