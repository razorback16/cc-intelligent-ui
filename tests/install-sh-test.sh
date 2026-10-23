#!/bin/sh
# Runs the one-line installer (site/install.sh) with bash in a sandbox: a HOME
# of its own, a fake `claude` that logs its arguments and fakes the plugin
# lists, a fake `curl` that serves local files and a fake `uname`. The real
# HOME and the real Claude Code are never used. Checks: no claude, or a
# system that is not supported, changes nothing; a Typst 0.15 that is there
# is kept; a missing Typst is downloaded and installed only with the correct
# SHA-256; the marketplace and the mod are added, or updated on a second run;
# a marketplace from another source (fork, ref, folder) is added again from
# GitHub, a disabled mod stays disabled, another user copy is uninstalled,
# project copies are only shown, and a failed update is not called newest;
# settings.json gets extraKnownMarketplaces.razorback16.autoUpdate = true with
# all other bytes kept, a backup only when it changed, and no change when it
# is not valid JSON or set already; with iTerm2 or herdr, the mod's setup block
# (the one of hooks/lib/setup.ts, or of IUI_SETUP_TS) in the start file of the
# login shell, as the mod writes it; the IUI_NO_* options; a cut download runs
# nothing; shellcheck when it is installed.
# Usage: sh tests/install-sh-test.sh   (exit 0 when all pass)
set -u
here=$(cd "$(dirname "$0")/.." && pwd -P)
script=$here/site/install.sh
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-install-test.XXXXXX")
tmp=$(cd "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }
sys=/usr/bin:/bin:/usr/sbin:/sbin

# The fakes. claude: its state in $FAKE_STATE: mkt (the razorback16 entry of the
# marketplace list, as JSON; no file: not known) and plugins (the installed
# copies: id, scope, version, enabled, projectPath, extra JSON; with tabs).
fake=$tmp/fake
nocl=$tmp/fake-no-claude
mkdir -p "$fake" "$nocl" "$tmp/assets" "$tmp/build"
cat > "$fake/claude" << 'EOF'
#!/bin/sh
st=${FAKE_STATE:?}
echo "$*" >> "$st/claude.log"
if IFS= read -r line; then echo "$line" >> "$st/stdin.log"; fi
P=$st/plugins
touch "$P"
T=$(printf '\t')
ours=cc-intelligent-ui@razorback16
official='{"name": "razorback16", "source": "github", "repo": "razorback16/cc-intelligent-ui", "installLocation": "/fake/marketplaces/razorback16"}'
# setp ID SCOPE VERSION ENABLED: one line for the id and scope.
setp() {
  grep -v "^$1$T$2$T" "$P" > "$P.new"
  printf '%s\t%s\t%s\t%s\t\t\n' "$1" "$2" "$3" "$4" >> "$P.new"
  mv "$P.new" "$P"
}
# getp ID SCOPE FIELD
getp() { awk -F"$T" -v i="$1" -v s="$2" -v f="$3" '$1 == i && $2 == s { print $f }' "$P"; }
case "$*" in
  --version) echo "${FAKE_CLAUDE_VERSION:-2.1.307} (Claude Code)" ;;
  'plugin marketplace list --json')
    printf '[\n  {\n    "name": "other",\n    "source": "github",\n    "repo": "o/r",\n    "installLocation": "/fake/marketplaces/other"\n  }'
    if [ -f "$st/mkt" ]; then printf ',\n  %s' "$(cat "$st/mkt")"; fi
    printf '\n]\n' ;;
  'plugin marketplace add razorback16/cc-intelligent-ui')
    if [ -f "$st/mkt" ] && [ "$(cat "$st/mkt")" != "$official" ]; then
      echo 'Failed to add marketplace: Cannot add marketplace "razorback16": its source does not match' >&2
      exit 1
    fi
    [ -z "${FAKE_ADD_FAIL:-}" ] || exit 1
    echo "$official" > "$st/mkt"
    echo 'Successfully added marketplace: razorback16 (declared in user settings)' ;;
  'plugin marketplace update razorback16')
    [ -z "${FAKE_MKT_UPDATE_FAIL:-}" ] || { echo 'Failed to update marketplace' >&2; exit 1; }
    echo 'Successfully updated marketplace: razorback16' ;;
  'plugin marketplace remove razorback16 --scope user')
    [ -z "${FAKE_REMOVE_FAIL:-}" ] || { echo 'Failed to remove marketplace' >&2; exit 1; }
    rm -f "$st/mkt"
    echo 'Successfully removed marketplace: razorback16 (from user settings)'
    # Claude Code 2.1.307 uninstalls the plugins of the marketplace (in all scopes).
    if [ -z "${FAKE_REMOVE_KEEPS:-}" ]; then
      grep -v "^[^$T]*@razorback16$T" "$P" > "$P.new"
      mv "$P.new" "$P"
      echo 'Also uninstalled 1 plugin from this marketplace:'
    fi ;;
  'plugin list --json')
    awk -F"$T" 'BEGIN { printf "[" }
      { printf "%s\n  {\"id\": \"%s\", \"version\": \"%s\", \"scope\": \"%s\", \"enabled\": %s, \"installPath\": \"/fake/cache/%s\"%s%s, \"projectEnabled\": false}",
          (NR > 1 ? "," : ""), $1, $3, $2, $4, $1, ($5 != "" ? ", \"projectPath\": \"" $5 "\"" : ""), ($6 != "" ? ", " $6 : "") }
      END { print "\n]" }' "$P" ;;
  "plugin install $ours --scope user")
    [ -z "${FAKE_INSTALL_FAIL:-}" ] || exit 1
    [ -f "$st/mkt" ] || { echo 'Plugin not found' >&2; exit 1; }
    setp "$ours" user "${FAKE_LATEST:-0.3.3}" "${FAKE_ENABLED:-true}"
    echo 'Installed cc-intelligent-ui' ;;
  "plugin update $ours --scope user")
    [ -z "${FAKE_UPDATE_FAIL:-}" ] || { echo 'Failed to update' >&2; exit 1; }
    en=$(getp "$ours" user 4)
    [ -n "$en" ] || { echo 'not installed' >&2; exit 1; }
    # Only the official marketplace has the newest version.
    if [ "$(cat "$st/mkt" 2> /dev/null)" = "$official" ]; then
      setp "$ours" user "${FAKE_LATEST:-0.3.3}" "$en"
      echo 'Updated cc-intelligent-ui'
    else
      echo "cc-intelligent-ui is already at the latest version ($(getp "$ours" user 3))"
    fi ;;
  "plugin disable $ours --scope user")
    setp "$ours" user "$(getp "$ours" user 3)" false ;;
  'plugin uninstall '*' --scope user')
    grep -v "^$3${T}user$T" "$P" > "$P.new"
    mv "$P.new" "$P" ;;
  *) echo "fake claude: unknown command: $*" >&2; exit 1 ;;
esac
EOF
cat > "$fake/curl" << 'EOF'
#!/bin/sh
out= url=
while [ $# -gt 0 ]; do
  case $1 in
    -o | --proto | --proto-redir | --retry) [ "$1" = -o ] && out=$2; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
echo "$url" >> "${FAKE_STATE:?}/curl.log"
src=${FAKE_ASSETS:?}/${url##*/}
[ -f "$src" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
cp "$src" "$out"
EOF
cat > "$fake/uname" << 'EOF'
#!/bin/sh
case ${1:-} in
  -m) echo "${FAKE_ARCH:-arm64}" ;;
  *) echo "${FAKE_OS:-Darwin}" ;;
esac
EOF
# mdfind (Spotlight) finds iTerm2 only when FAKE_MDFIND is set.
printf '#!/bin/sh\n[ -n "${FAKE_MDFIND:-}" ] && echo "$FAKE_MDFIND"\nexit 0\n' > "$fake/mdfind"
chmod 755 "$fake/claude" "$fake/curl" "$fake/uname" "$fake/mdfind"
cp "$fake/curl" "$fake/uname" "$fake/mdfind" "$nocl/"

# A fake typst of a version: mktypst DIR VERSION
mktypst() {
  mkdir -p "$1"
  printf '#!/bin/sh\necho "typst %s (fake)"\n' "$2" > "$1/typst"
  chmod 755 "$1/typst"
}

# The fake release file (Darwin arm64), and its SHA-256.
asset=typst-aarch64-apple-darwin
mktypst "$tmp/build/$asset" 0.15.1
can_xz=1
(cd "$tmp/build" && tar -cJf "$tmp/assets/$asset.tar.xz" "$asset") 2> /dev/null || can_xz=
sha() { if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'; }
real_sum=48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a
fake_sum=$( [ -n "$can_xz" ] && sha "$tmp/assets/$asset.tar.xz")

# The script with the mod's Typst folders in the sandbox (sys/a ... sys/e for
# the folders outside HOME); install.sh also has the SHA-256 of the fake file.
grep -q "$real_sum" "$script" && ok || bad "the arm64 macOS SHA-256 is not in install.sh"
dirs="$tmp/sys/a $tmp/sys/b $tmp/sys/c $tmp/sys/d ~/.cargo/bin ~/.local/bin $tmp/sys/e ~/.linuxbrew/bin"
perl -pe 's#^TYPST_DIRS=.*#TYPST_DIRS='"'$dirs'"'#' "$script" > "$tmp/install-badsum.sh"
perl -pe "s/$real_sum/$fake_sum/" "$tmp/install-badsum.sh" > "$tmp/install.sh"
grep -q "^TYPST_DIRS='$tmp/sys/a " "$tmp/install.sh" && ok || bad "the test could not set TYPST_DIRS"

typst_on_sys=
PATH=$sys command -v typst > /dev/null 2>&1 && typst_on_sys=1

# run NAME [VAR=value ...]: runs the installer with HOME $tmp/NAME/home; the
# output in $tmp/NAME/out, the exit code in $rc. SCRIPT and BIN change the
# script and the fake folder; XPATH goes before the system folders (each for one run).
run() {
  name=$1
  shift
  d=$tmp/$name
  mkdir -p "$d/home" "$d/state"
  env -i HOME="$d/home" PATH="${BIN:-$fake}${XPATH:+:$XPATH}:$sys" TMPDIR="$d" FAKE_STATE="$d/state" FAKE_ASSETS="$tmp/assets" IUI_TEST_ROOT="$d/root" \
    "$@" bash "${SCRIPT:-$tmp/install.sh}" < /dev/null > "$d/out" 2>&1
  rc=$?
  # sh keeps an assignment before a function call: clear them.
  BIN='' SCRIPT='' XPATH=''
}
# The checks after a run.
out() { grep -q -- "$1" "$d/out"; }
log() { grep -qx -- "$1" "$d/state/claude.log" 2> /dev/null; }
empty_home() { [ -z "$(cd "$d/home" && find . -mindepth 1 2> /dev/null)" ]; }
no_claude_calls() { [ ! -e "$d/state/claude.log" ]; }
no_downloads() { [ ! -e "$d/state/curl.log" ]; }
no_work_left() { [ -z "$(find "$d" -maxdepth 1 -name 'iui-install.*' 2> /dev/null)" ] && [ -z "$(find "$d/home" -name '.typst.iui-*' -o -name '*.iui-[0-9]*' 2> /dev/null)" ]; }
show() { sed 's/^/    | /' "$d/out"; }

# --- The script's shape -------------------------------------------------------

[ "$(tail -n 1 "$script")" = 'main "$@"' ] && ok || bad "the last line is not: main \"\$@\""
head -n 1 "$script" | grep -qx '#!/usr/bin/env bash' && ok || bad "the first line is not #!/usr/bin/env bash"
grep -q '^set -euo pipefail$' "$script" && ok || bad "no set -euo pipefail"
LC_ALL=C grep -n '[^ -~	]' "$script" > "$tmp/nonascii" && bad "install.sh has a character that is not ASCII: $(head -n 1 "$tmp/nonascii")" || ok
[ -z "$(grep -n 'sudo' "$script" | grep -v 'never uses sudo')" ] && ok || bad "install.sh names sudo: $(grep -n sudo "$script" | grep -v 'never uses sudo')"
[ -z "$(grep -nE '^[[:space:]]*eval[[:space:]]+[^{[:space:]]|[;&|][[:space:]]*eval[[:space:]]' "$script")" ] && ok || bad "install.sh uses eval"
grep -q "curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2" "$script" && ok || bad "the download is not https only"
# The Typst folders are the mod's (TYPST_FALLBACKS), in its order.
mod_dirs=$(perl -0ne '/TYPST_FALLBACKS = \[(.*?)\]/s or exit 1; my $l = $1; print join(" ", map { s#/typst$##r } $l =~ /\x27([^\x27]+)\x27/g)' "$here/hooks/lib/settings.ts")
inst_dirs=$(sed -n "s/^TYPST_DIRS='\(.*\)'$/\1/p" "$script")
[ -n "$mod_dirs" ] && [ "$mod_dirs" = "$inst_dirs" ] && ok || bad "TYPST_DIRS ($inst_dirs) is not TYPST_FALLBACKS of hooks/lib/settings.ts ($mod_dirs)"
# The oldest Claude Code is the one of docs/install.md.
doc_min=$(sed -n 's/^- Claude Code \([0-9.]*\) or later.*/\1/p' "$here/docs/install.md")
[ -n "$doc_min" ] && grep -qx "MIN_CLAUDE=$doc_min" "$script" && ok || bad "MIN_CLAUDE is not $doc_min (docs/install.md)"
if command -v shellcheck > /dev/null 2>&1; then
  shellcheck -s bash "$script" > "$tmp/shellcheck" 2>&1 && ok || bad "shellcheck: $(head -n 20 "$tmp/shellcheck")"
else
  echo "install-sh-test: shellcheck skipped (not installed)"
fi

# --- 1. Checks ----------------------------------------------------------------

BIN=$nocl run no-claude
[ "$rc" = 1 ] && ok || bad "no claude: exit $rc, not 1"
out 'code.claude.com/docs/en/setup' && out 'Nothing was changed' && ok || bad "no claude: no words on how to install Claude Code"
empty_home && no_downloads && ok || bad "no claude: something changed"

run freebsd FAKE_OS=FreeBSD
[ "$rc" = 1 ] && out 'FreeBSD) is not supported' && ok || bad "FreeBSD: exit $rc"
empty_home && no_claude_calls && no_downloads && ok || bad "FreeBSD: something changed"
run armv7 FAKE_OS=Linux FAKE_ARCH=armv7l
[ "$rc" = 1 ] && out 'armv7l) is not supported' && ok || bad "armv7l: exit $rc"
empty_home && no_claude_calls && no_downloads && ok || bad "armv7l: something changed"

run old-claude IUI_NO_TYPST=1 FAKE_CLAUDE_VERSION=2.1.200
[ "$rc" = 0 ] && out 'needs Claude Code 2.1.298 or later' && ok || bad "an old Claude Code: exit $rc, or no warning"

# --- 2. Typst -----------------------------------------------------------------

mktypst "$tmp/path-new" 0.15.2
XPATH=$tmp/path-new run typst-on-path
[ "$rc" = 0 ] && out 'Typst 0.15.2 is installed' && ok || bad "Typst on the PATH: exit $rc"
no_downloads && [ ! -e "$d/home/.local/bin/typst" ] && ok || bad "Typst on the PATH: a download"

mkdir -p "$tmp/cargo/home"
mktypst "$tmp/cargo/home/.cargo/bin" 0.15.0
run cargo
[ "$rc" = 0 ] && out 'Typst 0.15.0 is installed: ~/.cargo/bin/typst' && no_downloads && ok || bad "Typst in ~/.cargo/bin: exit $rc, or a download"

if [ -n "$typst_on_sys" ] || [ -z "$can_xz" ]; then
  echo "install-sh-test: the Typst download skipped (a typst in $sys, or tar can not make .tar.xz)"
else
  run download
  [ "$rc" = 0 ] && ok || { bad "the download: exit $rc"; show; }
  [ "$(cat "$d/state/curl.log")" = "https://github.com/typst/typst/releases/download/v0.15.1/$asset.tar.xz" ] && ok || bad "the download URL: $(cat "$d/state/curl.log")"
  [ -x "$d/home/.local/bin/typst" ] && [ "$("$d/home/.local/bin/typst" --version)" = "typst 0.15.1 (fake)" ] && ok || bad "the download: no typst in ~/.local/bin"
  out 'SHA-256 is correct' && out 'Your PATH does not have ~/.local/bin' && ok || bad "the download: no SHA-256 or PATH line"
  no_work_left && ok || bad "the download: files left: $(find "$d" -name 'iui-install.*' -o -name '.typst.iui-*')"
  out 'rm ~/.local/bin/typst' && ok || bad "the download: no undo line"

  # The second run: Typst is found in ~/.local/bin; the mod and the marketplace are updated.
  cp "$d/home/.claude/settings.json" "$tmp/settings-1"
  env -i HOME="$d/home" PATH="$fake:$sys" TMPDIR="$d" FAKE_STATE="$d/state" FAKE_ASSETS="$tmp/assets" IUI_TEST_ROOT="$d/root" bash "$tmp/install.sh" < /dev/null > "$d/out2" 2>&1
  rc=$?
  [ "$rc" = 0 ] && ok || bad "the second run: exit $rc"
  [ "$(wc -l < "$d/state/curl.log" | tr -d ' ')" = 1 ] && ok || bad "the second run downloaded again"
  grep -q 'Typst 0.15.1 is installed: ~/.local/bin/typst' "$d/out2" && ok || bad "the second run: Typst not found in ~/.local/bin"
  log 'plugin marketplace add razorback16/cc-intelligent-ui' && log 'plugin install cc-intelligent-ui@razorback16 --scope user' && ok || bad "the first run: no add or install"
  log 'plugin marketplace update razorback16' && log 'plugin update cc-intelligent-ui@razorback16 --scope user' && ok || bad "the second run: no update"
  [ "$(grep -c '^plugin marketplace add' "$d/state/claude.log")" = 1 ] && [ "$(grep -c '^plugin install' "$d/state/claude.log")" = 1 ] && ok || bad "the second run added or installed again"
  cmp -s "$tmp/settings-1" "$d/home/.claude/settings.json" && [ ! -e "$d/home/.claude/settings.json.bak-iui" ] && ok || bad "the second run changed settings.json"
  grep -q 'on (it was on already)' "$d/out2" && grep -q 'the newest version was installed already' "$d/out2" && ok || bad "the second run: summary"
  [ ! -e "$d/state/stdin.log" ] && ok || bad "claude read stdin: $(cat "$d/state/stdin.log")"

  # An old Typst first on the PATH: the new one is installed, with a warning.
  mktypst "$tmp/path-old" 0.13.1
  XPATH=$tmp/path-old run old-typst
  [ "$rc" = 0 ] && [ -x "$d/home/.local/bin/typst" ] && ok || bad "an old Typst: exit $rc, or no new typst"
  out 'Typst 0.13.1 is at' && out 'uses the first Typst it finds' && ok || bad "an old Typst: no warning"

  # An old Typst in ~/.local/bin is replaced.
  mkdir -p "$tmp/replace/home"
  mktypst "$tmp/replace/home/.local/bin" 0.12.0
  XPATH=$tmp/replace/home/.local/bin run replace
  [ "$rc" = 0 ] && [ "$("$d/home/.local/bin/typst" --version)" = "typst 0.15.1 (fake)" ] && ok || bad "an old Typst in ~/.local/bin was not replaced"
  out 'Your PATH does not have ~/.local/bin' && bad "the PATH line with ~/.local/bin on the PATH" || ok

  # The SHA-256 is not correct: refused, nothing installed, nothing else run.
  SCRIPT=$tmp/install-badsum.sh run badsum
  [ "$rc" = 1 ] && out 'SHA-256 of the downloaded Typst file is not correct' && ok || bad "a bad SHA-256: exit $rc"
  [ ! -e "$d/home/.local/bin/typst" ] && [ ! -e "$d/home/.claude" ] && ok || bad "a bad SHA-256: something was installed"
  grep -q '^plugin' "$d/state/claude.log" && bad "a bad SHA-256: claude plugin was run" || ok
  no_work_left && ok || bad "a bad SHA-256: files left"

  # The download fails (no such file for Linux x86_64 here).
  run nofile FAKE_OS=Linux FAKE_ARCH=x86_64
  [ "$rc" = 1 ] && out 'download of Typst failed' && [ ! -e "$d/home/.local/bin" ] && ok || bad "a failed download: exit $rc"
  grep -q 'typst-x86_64-unknown-linux-musl.tar.xz$' "$d/state/curl.log" && ok || bad "Linux x86_64: the wrong file"

  # A piped run (curl ... | bash) works.
  d=$tmp/piped
  mkdir -p "$d/home" "$d/state"
  env -i HOME="$d/home" PATH="$fake:$sys" TMPDIR="$d" FAKE_STATE="$d/state" FAKE_ASSETS="$tmp/assets" IUI_TEST_ROOT="$d/root" bash < "$tmp/install.sh" > "$d/out" 2>&1
  rc=$?
  [ "$rc" = 0 ] && [ -x "$d/home/.local/bin/typst" ] && [ -f "$d/home/.claude/settings.json" ] && ok || { bad "a piped run: exit $rc"; show; }
  [ ! -e "$d/state/stdin.log" ] && ok || bad "a piped run: claude read the script"

fi

run no-typst IUI_NO_TYPST=1
[ "$rc" = 0 ] && no_downloads && out 'IUI_NO_TYPST is set' && [ ! -e "$d/home/.local/bin" ] && ok || bad "IUI_NO_TYPST: exit $rc, or a download"

# --- 3. The mod ---------------------------------------------------------------

# seed NAME MKT [PLUGIN LINE ...]: the fake claude's state before a run. MKT
# is the razorback16 entry of the marketplace list (empty: not known); each
# plugin line is "id scope version enabled [projectPath [extra JSON]]" with tabs.
seed() {
  sd=$tmp/$1/state
  mkdir -p "$sd"
  if [ -n "$2" ]; then printf '%s\n' "$2" > "$sd/mkt"; fi
  : > "$sd/plugins"
  shift 2
  for l in "$@"; do printf '%s\n' "$l" >> "$sd/plugins"; done
}
T=$(printf '\t')
ours=cc-intelligent-ui@razorback16
mkt_official='{"name": "razorback16", "source": "github", "repo": "razorback16/cc-intelligent-ui", "installLocation": "/fake/marketplaces/razorback16"}'
# The version and enabled of a copy after the run: plugin ID SCOPE
plugin() { awk -F"$T" -v i="$1" -v s="$2" '$1 == i && $2 == s { print $3 " " $4 }' "$d/state/plugins"; }
# Line numbers in the claude log: the order of the commands.
at() { grep -nx -- "$1" "$d/state/claude.log" | head -n 1 | cut -d: -f1; }

seed disabled '' "$ours${T}project${T}0.1.0${T}true${T}/work/p"
run disabled IUI_NO_TYPST=1 FAKE_ENABLED=false
[ "$rc" = 0 ] && out 'claude plugin enable cc-intelligent-ui@razorback16' && ok || bad "a disabled mod: no words"
log 'plugin install cc-intelligent-ui@razorback16 --scope user' && ok || bad "a project install is not a user install"

# The official source: updated, not removed.
seed official "$mkt_official" "$ours${T}user${T}0.3.2${T}true"
run official IUI_NO_TYPST=1
[ "$rc" = 0 ] && log 'plugin marketplace update razorback16' && log "plugin update $ours --scope user" && ok || { bad "official: exit $rc, or no update"; show; }
grep -q 'marketplace remove' "$d/state/claude.log" && bad "official: the marketplace was removed" || ok
[ "$(plugin "$ours" user)" = '0.3.3 true' ] && out 'updated from 0.3.2' && ok || bad "official: not updated: $(plugin "$ours" user)"
out 'Disable auto-update' && ok || bad "official: no undo line for auto-update"

# Git URLs of the official repository with no ref: not removed.
n=0
for u in 'https://github.com/razorback16/cc-intelligent-ui.git' 'https://GitHub.com/Razorback16/CC-Intelligent-UI' 'https://github.com/razorback16/cc-intelligent-ui'; do
  n=$((n + 1))
  seed "git-official-$n" '{"name": "razorback16", "source": "git", "url": "'"$u"'", "installLocation": "/fake/m"}' "$ours${T}user${T}0.3.2${T}true"
  run "git-official-$n" IUI_NO_TYPST=1
  [ "$rc" = 0 ] && log 'plugin marketplace update razorback16' && ok || bad "git URL $u: exit $rc, or no marketplace update"
  grep -q 'marketplace remove' "$d/state/claude.log" && bad "git URL $u: the marketplace was removed" || ok
done

# Another source: removed, added from GitHub, the mod installed again.
# repointed NAME MKT UNDO-SOURCE DESCRIPTION
repointed() {
  seed "$1" "$2" "$ours${T}user${T}0.3.0${T}true"
  run "$1" IUI_NO_TYPST=1
  [ "$rc" = 0 ] && ok || { bad "$1: exit $rc"; show; }
  log 'plugin marketplace remove razorback16 --scope user' && log 'plugin marketplace add razorback16/cc-intelligent-ui' && log "plugin install $ours --scope user" && ok || bad "$1: not removed, added and installed: $(tr '\n' ';' < "$d/state/claude.log")"
  [ "$(at 'plugin marketplace remove razorback16 --scope user')" -lt "$(at 'plugin marketplace add razorback16/cc-intelligent-ui')" ] && ok || bad "$1: the order of remove and add"
  log 'plugin marketplace update razorback16' && bad "$1: an update from the old source" || ok
  [ "$(plugin "$ours" user)" = '0.3.3 true' ] && ok || bad "$1: the mod is $(plugin "$ours" user), not 0.3.3"
  out "comes from $4, not from the GitHub repository" && ok || { bad "$1: no words on the old source"; show; }
  out "claude plugin marketplace add $3" && ok || { bad "$1: no undo line: $3"; show; }
  out "before: 0.3.0 from $4" && ok || bad "$1: the summary does not say the old version and source"
  out 'the newest version was installed already' && bad "$1: the summary says newest" || ok
  out 'Kept: your /iui settings' && ok || bad "$1: no words on the settings kept"
}
repointed fork '{"name": "razorback16", "source": "github", "repo": "someone/cc-intelligent-ui", "installLocation": "/fake/m"}' \
  'someone/cc-intelligent-ui' 'the GitHub repository someone/cc-intelligent-ui'
repointed pinned '{"name": "razorback16", "source": "github", "repo": "razorback16/cc-intelligent-ui", "ref": "v0.3.0", "installLocation": "/fake/m"}' \
  'razorback16/cc-intelligent-ui#v0.3.0' 'the GitHub repository razorback16/cc-intelligent-ui (ref v0.3.0)'
repointed git-ref '{"name": "razorback16", "source": "git", "url": "https://github.com/razorback16/cc-intelligent-ui.git", "ref": "releases", "installLocation": "/fake/m"}' \
  'https://github.com/razorback16/cc-intelligent-ui.git#releases' 'the git URL https://github.com/razorback16/cc-intelligent-ui.git (ref releases)'
# A local folder (as Claude Code 2.1.307 lists it).
repointed folder '{"name": "razorback16", "source": "directory", "path": "/Users/claude/iui/7e5933a06955", "installLocation": "/Users/claude/iui/7e5933a06955"}' \
  '/Users/claude/iui/7e5933a06955' 'the local folder /Users/claude/iui/7e5933a06955'
repointed folder-space '{"name": "razorback16", "source": "directory", "path": "/Users/me/my iui", "installLocation": "/Users/me/my iui"}' \
  "'/Users/me/my iui'" 'the local folder /Users/me/my iui'

# The old source had a newer version (a work folder): a warning.
seed folder-newer '{"name": "razorback16", "source": "directory", "path": "/work/iui"}' "$ours${T}user${T}0.4.0${T}true"
run folder-newer IUI_NO_TYPST=1
[ "$rc" = 0 ] && out 'from the old source (0.4.0) is newer than the version on GitHub (0.3.3)' && out 'then claude plugin marketplace add /work/iui' && ok || { bad "a newer old source: no warning"; show; }
out 'is newer than the version on GitHub' && [ "$(grep -c 'is newer than' "$tmp/fork/out")" = 0 ] && ok || bad "an older old source: a newer warning"

# A disabled mod stays disabled after the new marketplace.
seed repoint-disabled '{"name": "razorback16", "source": "github", "repo": "someone/cc-intelligent-ui"}' "$ours${T}user${T}0.3.0${T}false"
run repoint-disabled IUI_NO_TYPST=1
[ "$rc" = 0 ] && log "plugin disable $ours --scope user" && [ "$(plugin "$ours" user)" = '0.3.3 false' ] && ok || { bad "re-point, disabled: exit $rc, $(plugin "$ours" user)"; show; }
[ "$(at "plugin install $ours --scope user")" -lt "$(at "plugin disable $ours --scope user")" ] && ok || bad "re-point, disabled: disabled before the install"
out "claude plugin enable $ours" && ok || bad "re-point, disabled: no words"

# remove does not uninstall the mod: it is updated, not installed again. A
# copy of ours in a project that Claude Code removed with the marketplace, or not.
seed remove-keeps '{"name": "razorback16", "source": "github", "repo": "someone/cc-intelligent-ui"}' "$ours${T}user${T}0.3.0${T}true" "$ours${T}project${T}0.3.0${T}true${T}/work/proj"
run remove-keeps IUI_NO_TYPST=1 FAKE_REMOVE_KEEPS=1
[ "$rc" = 0 ] && log "plugin update $ours --scope user" && [ "$(plugin "$ours" user)" = '0.3.3 true' ] && ok || { bad "remove keeps the mod: exit $rc, $(plugin "$ours" user)"; show; }
log "plugin install $ours --scope user" && bad "remove keeps the mod: installed again" || ok
out "before: 0.3.0 from" && ok || bad "remove keeps the mod: summary"
out "project scope for /work/proj: $ours 0.3.0" && out "cd /work/proj && claude plugin uninstall $ours --scope project" && ok || { bad "remove keeps the mod: no project warning"; show; }
seed remove-uninstalls '{"name": "razorback16", "source": "github", "repo": "someone/cc-intelligent-ui"}' "$ours${T}user${T}0.3.0${T}true" "$ours${T}project${T}0.3.0${T}true${T}/work/proj"
run remove-uninstalls IUI_NO_TYPST=1
[ "$rc" = 0 ] && log "plugin install $ours --scope user" && [ "$(plugin "$ours" user)" = '0.3.3 true' ] && ok || { bad "remove uninstalls: exit $rc"; show; }
out "removed the copy of the mod in project scope for /work/proj" && out "cd /work/proj && claude plugin install $ours --scope project" && ok || { bad "remove uninstalls: no words on the project copy"; show; }

# The remove fails: stop, nothing added.
seed remove-fails '{"name": "razorback16", "source": "github", "repo": "someone/cc-intelligent-ui"}' "$ours${T}user${T}0.3.0${T}true"
run remove-fails IUI_NO_TYPST=1 FAKE_REMOVE_FAIL=1
[ "$rc" = 1 ] && out 'could not remove the marketplace razorback16' && ok || bad "remove fails: exit $rc"
grep -q 'marketplace add\|plugin install\|plugin update' "$d/state/claude.log" && bad "remove fails: more was run" || ok
# The add fails after the remove: how to add the old one back.
seed add-fails '{"name": "razorback16", "source": "github", "repo": "someone/cc-intelligent-ui"}' "$ours${T}user${T}0.3.0${T}true"
run add-fails IUI_NO_TYPST=1 FAKE_ADD_FAIL=1
[ "$rc" = 1 ] && out 'To add the old one back: claude plugin marketplace add someone/cc-intelligent-ui' && ok || { bad "add fails: exit $rc"; show; }

# A user copy from another marketplace: uninstalled after ours is there.
seed other-copy "$mkt_official" "$ours${T}user${T}0.3.2${T}true" "cc-intelligent-ui@other-mkt${T}user${T}0.2.0${T}true"
run other-copy IUI_NO_TYPST=1
[ "$rc" = 0 ] && log 'plugin uninstall cc-intelligent-ui@other-mkt --scope user' && [ -z "$(plugin cc-intelligent-ui@other-mkt user)" ] && ok || { bad "another copy: exit $rc, not uninstalled"; show; }
[ "$(at "plugin update $ours --scope user")" -lt "$(at 'plugin uninstall cc-intelligent-ui@other-mkt --scope user')" ] && ok || bad "another copy: uninstalled before ours was updated"
out 'claude plugin install cc-intelligent-ui@other-mkt --scope user' && ok || bad "another copy: no undo line"
[ "$(plugin "$ours" user)" = '0.3.3 true' ] && ok || bad "another copy: ours is $(plugin "$ours" user)"
# Only another copy (ours not installed): ours installed first.
seed other-only '' "cc-intelligent-ui@other-mkt${T}user${T}0.2.0${T}true"
run other-only IUI_NO_TYPST=1
[ "$rc" = 0 ] && [ "$(at "plugin install $ours --scope user")" -lt "$(at 'plugin uninstall cc-intelligent-ui@other-mkt --scope user')" ] && ok || { bad "only another copy: exit $rc"; show; }

# Copies in a project or local scope: not changed, a warning.
seed project-copies "$mkt_official" "$ours${T}user${T}0.3.2${T}true" "$ours${T}project${T}0.1.0${T}true${T}/work/proj" "cc-intelligent-ui@other-mkt${T}local${T}0.2.0${T}true${T}/work/my b"
run project-copies IUI_NO_TYPST=1
[ "$rc" = 0 ] && ok || bad "project copies: exit $rc"
grep -q 'uninstall' "$d/state/claude.log" && bad "project copies: a copy was uninstalled" || ok
[ "$(plugin "$ours" project)" = '0.1.0 true' ] && [ "$(plugin cc-intelligent-ui@other-mkt local)" = '0.2.0 true' ] && ok || bad "project copies: changed"
out "cd /work/proj && claude plugin uninstall $ours --scope project" && out "cd '/work/my b' && claude plugin uninstall cc-intelligent-ui@other-mkt --scope local" && ok || { bad "project copies: no warnings"; show; }

# A failed update: an honest summary and exit 1.
seed update-fails "$mkt_official" "$ours${T}user${T}0.3.2${T}true"
run update-fails IUI_NO_TYPST=1 FAKE_UPDATE_FAIL=1
[ "$rc" = 1 ] && out 'NOT updated: the update failed' && ok || { bad "update fails: exit $rc"; show; }
out 'the newest version was installed already' && bad "update fails: the summary says newest" || ok
# A failed marketplace update and no new version: not "the newest".
seed mkt-update-fails "$mkt_official" "$ours${T}user${T}0.3.2${T}true"
run mkt-update-fails IUI_NO_TYPST=1 FAKE_MKT_UPDATE_FAIL=1 FAKE_LATEST=0.3.2
[ "$rc" = 1 ] && out 'NOT checked for a newer version' && ok || { bad "marketplace update fails: exit $rc"; show; }
out 'the newest version was installed already' && bad "marketplace update fails: the summary says newest" || ok

# --- 4. Auto-update: settings.json --------------------------------------------

# setting NAME INPUT EXPECTED: settings.json is INPUT (printf format) before the
# run and EXPECTED after it; a backup only when it changed.
setting() {
  name=$1
  mkdir -p "$tmp/$name/home/.claude"
  printf "$2" > "$tmp/$name/in"
  printf "$3" > "$tmp/$name/want"
  cp "$tmp/$name/in" "$tmp/$name/home/.claude/settings.json"
  run "$name" IUI_NO_TYPST=1
  [ "$rc" = 0 ] && ok || { bad "$name: exit $rc"; show; }
  cmp -s "$d/want" "$d/home/.claude/settings.json" && ok || { bad "$name: settings.json is not as expected:"; diff "$d/want" "$d/home/.claude/settings.json" | sed 's/^/    /'; }
  if cmp -s "$d/in" "$d/want"; then
    [ ! -e "$d/home/.claude/settings.json.bak-iui" ] && ok || bad "$name: a backup with no change"
  else
    cmp -s "$d/in" "$d/home/.claude/settings.json.bak-iui" && ok || bad "$name: the backup is not the old file"
  fi
  no_work_left && ok || bad "$name: a temp file left"
}
entry2='{\n    "razorback16": {\n      "source": {\n        "source": "github",\n        "repo": "razorback16/cc-intelligent-ui"\n      },\n      "autoUpdate": true\n    }\n  }'

run missing IUI_NO_TYPST=1
printf '{\n  "extraKnownMarketplaces": %s\n}\n' "$(printf "$entry2")" > "$d/want"
cmp -s "$d/want" "$d/home/.claude/settings.json" && [ ! -e "$d/home/.claude/settings.json.bak-iui" ] && ok || bad "a missing settings.json: not made as expected"
out 'new file' && ok || bad "a missing settings.json: summary"

setting other-keys \
  '{\n  "model": "opus",\n  "permissions": {\n    "allow": [\n      "Bash(ls)"\n    ]\n  },\n  "note": "caf\303\251 \\u00e9 \\"x\\"",\n  "n": -1.5e3,\n  "enabledPlugins": {\n    "x@y": true\n  }\n}\n' \
  '{\n  "model": "opus",\n  "permissions": {\n    "allow": [\n      "Bash(ls)"\n    ]\n  },\n  "note": "caf\303\251 \\u00e9 \\"x\\"",\n  "n": -1.5e3,\n  "enabledPlugins": {\n    "x@y": true\n  },\n  "extraKnownMarketplaces": '"$entry2"'\n}\n'
grep -q 'All other settings are kept' "$d/out" && out 'before this auto-update change' && out 'undoes only the auto-update change' && ok || bad "other keys: no words on the backup"

# As `claude plugin marketplace add` declares it: source only.
setting declared \
  '{\n  "extraKnownMarketplaces": {\n    "other": {\n      "source": {\n        "source": "github",\n        "repo": "o/r"\n      }\n    },\n    "razorback16": {\n      "source": {\n        "source": "github",\n        "repo": "razorback16/cc-intelligent-ui"\n      }\n    }\n  },\n  "theme": "dark"\n}' \
  '{\n  "extraKnownMarketplaces": {\n    "other": {\n      "source": {\n        "source": "github",\n        "repo": "o/r"\n      }\n    },\n    "razorback16": {\n      "source": {\n        "source": "github",\n        "repo": "razorback16/cc-intelligent-ui"\n      },\n      "autoUpdate": true\n    }\n  },\n  "theme": "dark"\n}'

setting other-marketplace \
  '{\n  "extraKnownMarketplaces": {\n    "other": {\n      "source": {\n        "source": "github",\n        "repo": "o/r"\n      }\n    }\n  }\n}\n' \
  '{\n  "extraKnownMarketplaces": {\n    "other": {\n      "source": {\n        "source": "github",\n        "repo": "o/r"\n      }\n    },\n    "razorback16": {\n      "source": {\n        "source": "github",\n        "repo": "razorback16/cc-intelligent-ui"\n      },\n      "autoUpdate": true\n    }\n  }\n}\n'

setting turned-off \
  '{\n  "extraKnownMarketplaces": {\n    "razorback16": {\n      "autoUpdate": false,\n      "source": {"source": "github", "repo": "razorback16/cc-intelligent-ui"}\n    }\n  }\n}\n' \
  '{\n  "extraKnownMarketplaces": {\n    "razorback16": {\n      "autoUpdate": true,\n      "source": {"source": "github", "repo": "razorback16/cc-intelligent-ui"}\n    }\n  }\n}\n'

setting already-set \
  '{\n  "a": 1,\n  "extraKnownMarketplaces": {\n    "razorback16": {\n      "source": {"source": "github", "repo": "razorback16/cc-intelligent-ui"},\n      "autoUpdate": true\n    }\n  }\n}\n' \
  '{\n  "a": 1,\n  "extraKnownMarketplaces": {\n    "razorback16": {\n      "source": {"source": "github", "repo": "razorback16/cc-intelligent-ui"},\n      "autoUpdate": true\n    }\n  }\n}\n'
grep -q 'Auto-update is on already' "$d/out" && ok || bad "already set: no words"
out 'Disable auto-update' && ok || bad "already set: no undo line for auto-update"

setting tabs \
  '{\n\t"a": [1, 2],\n\t"b": {}\n}\n' \
  '{\n\t"a": [1, 2],\n\t"b": {},\n\t"extraKnownMarketplaces": {\n\t\t"razorback16": {\n\t\t\t"source": {\n\t\t\t\t"source": "github",\n\t\t\t\t"repo": "razorback16/cc-intelligent-ui"\n\t\t\t},\n\t\t\t"autoUpdate": true\n\t\t}\n\t}\n}\n'

setting four-spaces \
  '{\n    "a": true\n}' \
  '{\n    "a": true,\n    "extraKnownMarketplaces": {\n        "razorback16": {\n            "source": {\n                "source": "github",\n                "repo": "razorback16/cc-intelligent-ui"\n            },\n            "autoUpdate": true\n        }\n    }\n}'

setting minified \
  '{"a":1,"b":[true,null]}' \
  '{"a":1,"b":[true,null],"extraKnownMarketplaces":{"razorback16":{"source":{"source":"github","repo":"razorback16/cc-intelligent-ui"},"autoUpdate":true}}}'

setting one-line \
  '{ "a": 1 }\n' \
  '{ "a": 1, "extraKnownMarketplaces": {"razorback16": {"source": {"source": "github", "repo": "razorback16/cc-intelligent-ui"}, "autoUpdate": true}} }\n'

setting empty-object \
  '{}\n' \
  '{\n  "extraKnownMarketplaces": '"$entry2"'\n}\n'

setting empty-marketplaces \
  '{\n  "extraKnownMarketplaces": {},\n  "z": 0\n}\n' \
  '{\n  "extraKnownMarketplaces": '"$entry2"',\n  "z": 0\n}\n'

setting crlf \
  '{\r\n  "a": 1\r\n}\r\n' \
  '{\r\n  "a": 1,\r\n  "extraKnownMarketplaces": '"$(printf '%s' "$entry2" | sed 's/\\n/\\r\\n/g')"'\r\n}\r\n'

# Not valid JSON, or not the shape: no change, no backup, the snippet, exit 1.
refused() {
  name=$1
  mkdir -p "$tmp/$name/home/.claude"
  printf "$2" > "$tmp/$name/in"
  cp "$tmp/$name/in" "$tmp/$name/home/.claude/settings.json"
  run "$name" IUI_NO_TYPST=1
  [ "$rc" = 1 ] && ok || bad "$name: exit $rc, not 1"
  cmp -s "$d/in" "$d/home/.claude/settings.json" && [ ! -e "$d/home/.claude/settings.json.bak-iui" ] && ok || bad "$name: settings.json changed"
  out 'was not changed' && out '"autoUpdate": true' && out 'Enable auto-update' && out 'NOT turned on' && ok || { bad "$name: no snippet"; show; }
  log 'plugin install cc-intelligent-ui@razorback16 --scope user' && ok || bad "$name: the mod was not installed"
  no_work_left && ok || bad "$name: a temp file left"
}
refused invalid '{\n  "a": 1,\n}\n'
refused comments '{\n  // my settings\n  "a": 1\n}\n'
refused truncated '{\n  "a": {\n'
refused root-array '[1, 2]\n'
refused bad-marketplaces '{"extraKnownMarketplaces": []}\n'
refused bad-entry '{"extraKnownMarketplaces": {"razorback16": "x"}}\n'
refused control-char '{"a": "x\001y"}\n'
refused two-values '{} {}\n'
refused other-source '{"extraKnownMarketplaces": {"razorback16": {"source": {"source": "directory", "path": "/x"}}}}\n'

# The place of the settings: CLAUDE_CONFIG_DIR.
mkdir -p "$tmp/config/conf"
run config IUI_NO_TYPST=1 CLAUDE_CONFIG_DIR="$tmp/config/conf"
[ "$rc" = 0 ] && grep -q '"autoUpdate": true' "$tmp/config/conf/settings.json" && [ ! -e "$d/home/.claude" ] && ok || bad "CLAUDE_CONFIG_DIR: not used"

# A settings.json that is a link: the link stays, its file changes, with its mode.
mkdir -p "$tmp/link/home/.claude" "$tmp/link/dotfiles"
printf '{\n  "a": 1\n}\n' > "$tmp/link/dotfiles/settings.json"
chmod 600 "$tmp/link/dotfiles/settings.json"
ln -s "$tmp/link/dotfiles/settings.json" "$tmp/link/home/.claude/settings.json"
run link IUI_NO_TYPST=1
[ "$rc" = 0 ] && [ -L "$d/home/.claude/settings.json" ] && grep -q '"autoUpdate": true' "$d/dotfiles/settings.json" && ok || bad "a link: exit $rc, or the link was replaced"
case $(ls -l "$d/dotfiles/settings.json") in -rw-------*) ok ;; *) bad "a link: the mode changed: $(ls -l "$d/dotfiles/settings.json")" ;; esac
case $(ls -l "$d/home/.claude/settings.json.bak-iui") in -rw-------*) ok ;; *) bad "the backup mode is not the file's" ;; esac

run no-auto-update IUI_NO_TYPST=1 IUI_NO_AUTO_UPDATE=1
[ "$rc" = 0 ] && [ ! -e "$d/home/.claude" ] && out 'IUI_NO_AUTO_UPDATE is set' && ok || bad "IUI_NO_AUTO_UPDATE: exit $rc, or settings.json was made"
log 'plugin install cc-intelligent-ui@razorback16 --scope user' && ok || bad "IUI_NO_AUTO_UPDATE: the mod was not installed"

# --- 5. Pictures in iTerm2 and herdr: the shell setup -------------------------

# The block of install.sh is the block of the mod (hooks/lib/setup.ts, or the
# file in IUI_SETUP_TS), so they can not drift.
setup_ts=${IUI_SETUP_TS:-$here/hooks/lib/setup.ts}
ts_part() { perl -ne "print \"\$1\\n\" if /$1/" "$setup_ts" | head -n 1; }
sh_part() { sed -n "s/^$1='\(.*\)'\$/\1/p" "$script"; }
S_START=$(sh_part SETUP_START)
S_END=$(sh_part SETUP_END)
S_SH=$(sh_part SETUP_SH)
S_FISH=$(sh_part SETUP_FISH)
[ -n "$S_START" ] && [ -n "$S_END" ] && [ -n "$S_SH" ] && [ -n "$S_FISH" ] && ok || bad "install.sh: no SETUP_ lines"
if grep -q '"herdr"' "$setup_ts"; then
  [ "$S_START" = "$(ts_part "SETUP_START = '(.*)'")" ] && [ "$S_END" = "$(ts_part "SETUP_END = '(.*)'")" ] && ok || bad "the setup markers are not the ones of $setup_ts"
  [ "$S_FISH" = "$(ts_part "^ *\\? '(if test .*)'\$")" ] && [ "$S_SH" = "$(ts_part "^ *: '(if .*)'\$")" ] && ok || bad "the setup lines are not the ones of $setup_ts"
else
  echo "install-sh-test: the block check with setup.ts skipped ($setup_ts is the older iTerm2-only version; set IUI_SETUP_TS)"
fi
block_sh=$(printf '%s\n%s\n%s\n_' "$S_START" "$S_SH" "$S_END")
block_sh=${block_sh%_}
block_fish=$(printf '%s\n%s\n%s\n_' "$S_START" "$S_FISH" "$S_END")
block_fish=${block_fish%_}
# The old block of the mod (iTerm2 only).
old_block='# >>> cc-intelligent-ui: Claude Code pictures in iTerm2 >>>
if [ "$TERM_PROGRAM" = "iTerm.app" ] && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi
# <<< cc-intelligent-ui <<<
'
# iterm NAME: iTerm2 in /Applications for the run NAME.
iterm() { mkdir -p "$tmp/$1/root/Applications/iTerm.app"; }
# is FILE TEXT: FILE has exactly TEXT.
is() { printf '%s' "$2" > "$d/want-rc" && cmp -s "$d/want-rc" "$1"; }

run no-iterm IUI_NO_TYPST=1 SHELL=/bin/zsh
[ "$rc" = 0 ] && out 'not needed (no iTerm2 or herdr)' && [ ! -e "$d/home/.zshrc" ] && ok || bad "no iTerm2 or herdr: exit $rc, or a change"

iterm iterm-zsh
run iterm-zsh IUI_NO_TYPST=1 SHELL=/bin/zsh
[ "$rc" = 0 ] && is "$d/home/.zshrc" "$block_sh" && ok || { bad "iTerm2, zsh: ~/.zshrc is not the block"; show; }
out 'added to ~/.zshrc (open a new tab or pane)' && out '/iui setup remove' && [ ! -e "$d/home/.zshrc.bak-iui" ] && ok || bad "iTerm2, zsh: summary, undo or a backup"
run iterm-zsh IUI_NO_TYPST=1 SHELL=/bin/zsh
[ "$rc" = 0 ] && is "$d/home/.zshrc" "$block_sh" && [ ! -e "$d/home/.zshrc.bak-iui" ] && out 'set already in ~/.zshrc' && ok || bad "iTerm2, zsh, the second run: changed"

iterm zsh-lines
mkdir -p "$tmp/zsh-lines/home"
printf 'export A=1\n\n\n' > "$tmp/zsh-lines/home/.zshrc"
chmod 640 "$tmp/zsh-lines/home/.zshrc"
run zsh-lines IUI_NO_TYPST=1 SHELL=/usr/local/bin/zsh
[ "$rc" = 0 ] && is "$d/home/.zshrc" "export A=1

$block_sh" && ok || { bad "zsh with lines: not as the mod's withSetup()"; show; }
printf 'export A=1\n\n\n' | cmp -s - "$d/home/.zshrc.bak-iui" && ok || bad "zsh with lines: the backup is not the old file"
case $(ls -l "$d/home/.zshrc") in -rw-r-----*) ok ;; *) bad "zsh with lines: the mode changed: $(ls -l "$d/home/.zshrc")" ;; esac
no_work_left && ok || bad "zsh with lines: a temp file left"

# An old block of the mod (iTerm2 only) is replaced: one block.
iterm old-block
mkdir -p "$tmp/old-block/home"
printf 'a\n\n%sb\n' "$old_block" > "$tmp/old-block/home/.zshrc"
run old-block IUI_NO_TYPST=1 SHELL=/bin/zsh
[ "$rc" = 0 ] && is "$d/home/.zshrc" "a
b

$block_sh" && ok || { bad "an old block: not replaced as the mod does"; cat "$d/home/.zshrc"; }
[ "$(grep -c 'cc-intelligent-ui: Claude Code pictures' "$d/home/.zshrc")" = 1 ] && ok || bad "an old block: two blocks"

iterm zdotdir
mkdir -p "$tmp/zdotdir/zdot"
run zdotdir IUI_NO_TYPST=1 SHELL=/bin/zsh ZDOTDIR="$tmp/zdotdir/zdot"
[ "$rc" = 0 ] && is "$d/zdot/.zshrc" "$block_sh" && [ ! -e "$d/home/.zshrc" ] && ok || bad "ZDOTDIR: not used"

iterm bash-mac
run bash-mac IUI_NO_TYPST=1 SHELL=/bin/bash
[ "$rc" = 0 ] && is "$d/home/.bash_profile" "$block_sh" && [ ! -e "$d/home/.bashrc" ] && ok || bad "bash on macOS: not ~/.bash_profile"

# herdr on Linux (in ~/.local/bin, as the script looks for Typst).
mkdir -p "$tmp/bash-linux/home/.local/bin"
printf '#!/bin/sh\n' > "$tmp/bash-linux/home/.local/bin/herdr"
chmod 755 "$tmp/bash-linux/home/.local/bin/herdr"
run bash-linux IUI_NO_TYPST=1 FAKE_OS=Linux FAKE_ARCH=x86_64 SHELL=/bin/bash
[ "$rc" = 0 ] && is "$d/home/.bashrc" "$block_sh" && [ ! -e "$d/home/.bash_profile" ] && out 'herdr found' && ok || { bad "herdr, bash on Linux: not ~/.bashrc"; show; }
# iTerm2 is for macOS only.
iterm linux-iterm
run linux-iterm IUI_NO_TYPST=1 FAKE_OS=Linux FAKE_ARCH=x86_64 SHELL=/bin/bash
[ "$rc" = 0 ] && out 'not needed' && [ ! -e "$d/home/.bashrc" ] && ok || bad "Linux with an iTerm.app folder: a change"

iterm fish
run fish IUI_NO_TYPST=1 SHELL=/opt/homebrew/bin/fish
[ "$rc" = 0 ] && is "$d/home/.config/fish/conf.d/cc-intelligent-ui.fish" "$block_fish" && ok || { bad "fish: no conf.d file"; show; }
iterm fish-xdg
mkdir -p "$tmp/fish-xdg/xdg"
run fish-xdg IUI_NO_TYPST=1 SHELL=/usr/bin/fish XDG_CONFIG_HOME="$tmp/fish-xdg/xdg"
[ "$rc" = 0 ] && is "$d/xdg/fish/conf.d/cc-intelligent-ui.fish" "$block_fish" && ok || bad "fish: XDG_CONFIG_HOME not used"

# Found by Spotlight, or herdr on the PATH.
run mdfind IUI_NO_TYPST=1 SHELL=/bin/zsh FAKE_MDFIND=/Applications/iTerm.app
[ "$rc" = 0 ] && is "$d/home/.zshrc" "$block_sh" && out 'iTerm2 found' && ok || bad "iTerm2 found by mdfind: no block"
mkdir -p "$tmp/herdr-bin"
printf '#!/bin/sh\n' > "$tmp/herdr-bin/herdr"
chmod 755 "$tmp/herdr-bin/herdr"
XPATH=$tmp/herdr-bin run herdr-path IUI_NO_TYPST=1 SHELL=/bin/zsh
[ "$rc" = 0 ] && is "$d/home/.zshrc" "$block_sh" && out 'herdr found' && ok || bad "herdr on the PATH: no block"

# A link (dotfiles): the file it points to changes, the link stays.
iterm rc-link
mkdir -p "$tmp/rc-link/home" "$tmp/rc-link/dotfiles"
printf 'x=1\n' > "$tmp/rc-link/dotfiles/zshrc"
ln -s "$tmp/rc-link/dotfiles/zshrc" "$tmp/rc-link/home/.zshrc"
run rc-link IUI_NO_TYPST=1 SHELL=/bin/zsh
[ "$rc" = 0 ] && [ -L "$d/home/.zshrc" ] && is "$d/dotfiles/zshrc" "x=1

$block_sh" && ok || bad "a linked ~/.zshrc: the link was replaced, or its file not changed"
[ "$(cat "$d/home/.zshrc.bak-iui")" = 'x=1' ] && ok || bad "a linked ~/.zshrc: no backup"

# Not changed: a file that can not be read, a folder, a big file.
# rc_refused NAME: ~/.zshrc stays as it is, exit 1, the lines to add.
rc_refused() {
  [ "$rc" = 1 ] && out 'was not changed' && out 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi' && out 'NOT added' && ok || { bad "$1: exit $rc, or no words"; show; }
  [ ! -e "$d/home/.zshrc.bak-iui" ] && no_work_left && ok || bad "$1: a backup or a temp file"
}
if [ "$(id -u)" != 0 ]; then
  iterm unreadable
  mkdir -p "$tmp/unreadable/home"
  printf 'secret\n' > "$tmp/unreadable/home/.zshrc"
  chmod 000 "$tmp/unreadable/home/.zshrc"
  run unreadable IUI_NO_TYPST=1 SHELL=/bin/zsh
  chmod 600 "$d/home/.zshrc"
  rc_refused unreadable
  [ "$(cat "$d/home/.zshrc")" = secret ] && ok || bad "unreadable: changed"
fi
iterm rc-folder
mkdir -p "$tmp/rc-folder/home/.zshrc"
run rc-folder IUI_NO_TYPST=1 SHELL=/bin/zsh
rc_refused rc-folder
iterm rc-big
mkdir -p "$tmp/rc-big/home"
perl -e 'print "# x\n" x (1300 * 1024)' > "$tmp/rc-big/home/.zshrc"
cp "$tmp/rc-big/home/.zshrc" "$tmp/rc-big/big"
run rc-big IUI_NO_TYPST=1 SHELL=/bin/zsh
rc_refused rc-big
cmp -s "$d/big" "$d/home/.zshrc" && ok || bad "a big ~/.zshrc: changed"

iterm no-shell-setup
run no-shell-setup IUI_NO_TYPST=1 SHELL=/bin/zsh IUI_NO_SHELL_SETUP=1
[ "$rc" = 0 ] && out 'IUI_NO_SHELL_SETUP is set' && [ ! -e "$d/home/.zshrc" ] && ok || bad "IUI_NO_SHELL_SETUP: a change"
iterm tcsh
run tcsh IUI_NO_TYPST=1 SHELL=/bin/tcsh
[ "$rc" = 0 ] && out 'Your shell (tcsh) is not one that the mod knows' && out "export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 (only in iTerm2 and herdr" && ok || { bad "an unknown shell: no manual line"; show; }
[ -z "$(cd "$d/home" && find . -name '.*rc' -o -name '.bash_profile' -o -name '*.fish')" ] && ok || bad "an unknown shell: a file was made"

# The output is plain ASCII when it is not a terminal.
LC_ALL=C cat "$tmp"/*/out | LC_ALL=C grep -n '[^ -~	]' > "$tmp/nonascii" && bad "an output that is not plain ASCII: $(head -n 2 "$tmp/nonascii")" || ok

# --- A cut download runs nothing ---------------------------------------------

size=$(wc -c < "$tmp/install.sh" | tr -d ' ')
last=$(tail -n 1 "$tmp/install.sh" | wc -c | tr -d ' ')
cuts="$((size - last)) $((size - 3))"
i=1
while [ "$i" -lt 40 ]; do
  cuts="$cuts $((size * i / 40))"
  i=$((i + 1))
done
n=0
for c in $cuts; do
  n=$((n + 1))
  head -c "$c" "$tmp/install.sh" > "$tmp/cut.sh"
  SCRIPT=$tmp/cut.sh run "cut-$n"
  empty_home && no_claude_calls && no_downloads && ok || { bad "a script cut at byte $c ran something (exit $rc)"; show; }
done
# The full file (the same size cut) runs: the test can see a run.
head -c "$(wc -c < "$tmp/install.sh" | tr -d ' ')" "$tmp/install.sh" > "$tmp/cut.sh"
SCRIPT=$tmp/cut.sh run cut-full IUI_NO_TYPST=1
[ "$rc" = 0 ] && log 'plugin install cc-intelligent-ui@razorback16 --scope user' && ok || bad "the uncut script did not run"

echo "install-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
