#!/bin/sh
# Runs the one-line installer (site/install.sh) with bash in a sandbox: a HOME
# of its own, a fake `claude` that logs its arguments and fakes the plugin
# lists, a fake `curl` that serves local files and a fake `uname`. The real
# HOME and the real Claude Code are never used. Checks: no claude, or a
# system that is not supported, changes nothing; a Typst 0.15 that is there
# is kept; a missing Typst is downloaded and installed only with the correct
# SHA-256; the marketplace and the mod are added, or updated on a second run;
# settings.json gets extraKnownMarketplaces.razorback16.autoUpdate = true with
# all other bytes kept, a backup only when it changed, and no change when it
# is not valid JSON or set already; the IUI_NO_* options; a cut download runs
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

# The fakes. claude: its state (marketplace added, mod version) in $FAKE_STATE.
fake=$tmp/fake
nocl=$tmp/fake-no-claude
mkdir -p "$fake" "$nocl" "$tmp/assets" "$tmp/build"
cat > "$fake/claude" << 'EOF'
#!/bin/sh
st=${FAKE_STATE:?}
echo "$*" >> "$st/claude.log"
if IFS= read -r line; then echo "$line" >> "$st/stdin.log"; fi
case "$*" in
  --version) echo "${FAKE_CLAUDE_VERSION:-2.1.307} (Claude Code)" ;;
  'plugin marketplace list --json')
    if [ -f "$st/mkt" ]; then printf '[\n  {\n    "name": "razorback16",\n    "source": "github",\n    "repo": "razorback16/cc-intelligent-ui"\n  }\n]\n'
    else printf '[\n  {\n    "name": "other",\n    "source": "github",\n    "repo": "o/r"\n  }\n]\n'; fi ;;
  'plugin marketplace add razorback16/cc-intelligent-ui') touch "$st/mkt"; echo 'Successfully added marketplace: razorback16 (declared in user settings)' ;;
  'plugin marketplace update razorback16') echo 'Successfully updated marketplace: razorback16' ;;
  'plugin list --json')
    if [ -f "$st/plugin" ]; then printf '[{"id":"cc-intelligent-ui@razorback16","version":"%s","scope":"user","enabled":%s}]\n' "$(cat "$st/plugin")" "${FAKE_ENABLED:-true}"
    else echo '[{"id":"cc-intelligent-ui@razorback16","version":"0.1.0","scope":"project","enabled":true}]'; fi ;;
  'plugin install cc-intelligent-ui@razorback16 --scope user') echo 0.3.3 > "$st/plugin"; echo 'Installed cc-intelligent-ui' ;;
  'plugin update cc-intelligent-ui@razorback16 --scope user') echo 0.3.3 > "$st/plugin"; echo 'Updated cc-intelligent-ui' ;;
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
chmod 755 "$fake/claude" "$fake/curl" "$fake/uname"
cp "$fake/curl" "$fake/uname" "$nocl/"

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
  env -i HOME="$d/home" PATH="${BIN:-$fake}${XPATH:+:$XPATH}:$sys" TMPDIR="$d" FAKE_STATE="$d/state" FAKE_ASSETS="$tmp/assets" \
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
  env -i HOME="$d/home" PATH="$fake:$sys" TMPDIR="$d" FAKE_STATE="$d/state" FAKE_ASSETS="$tmp/assets" bash "$tmp/install.sh" < /dev/null > "$d/out2" 2>&1
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
  env -i HOME="$d/home" PATH="$fake:$sys" TMPDIR="$d" FAKE_STATE="$d/state" FAKE_ASSETS="$tmp/assets" bash < "$tmp/install.sh" > "$d/out" 2>&1
  rc=$?
  [ "$rc" = 0 ] && [ -x "$d/home/.local/bin/typst" ] && [ -f "$d/home/.claude/settings.json" ] && ok || { bad "a piped run: exit $rc"; show; }
  [ ! -e "$d/state/stdin.log" ] && ok || bad "a piped run: claude read the script"
fi

run no-typst IUI_NO_TYPST=1
[ "$rc" = 0 ] && no_downloads && out 'IUI_NO_TYPST is set' && [ ! -e "$d/home/.local/bin" ] && ok || bad "IUI_NO_TYPST: exit $rc, or a download"

# --- 3. The mod ---------------------------------------------------------------

run disabled IUI_NO_TYPST=1 FAKE_ENABLED=false
[ "$rc" = 0 ] && out 'claude plugin enable cc-intelligent-ui@razorback16' && ok || bad "a disabled mod: no words"
log 'plugin install cc-intelligent-ui@razorback16 --scope user' && ok || bad "a project install is not a user install"

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
grep -q 'All other settings are kept' "$d/out" && ok || bad "other keys: no words on the backup"

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
