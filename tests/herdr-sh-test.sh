#!/bin/sh
# Runs the herdr client check (HERDR_CLIENT_SH in hooks/lib/host.ts) in sh,
# dash and bash with a fake ps, stat, uname, lsof and lsappinfo: it finds
# this pane's server above the shell, keeps the clients of this user with a
# tty, keeps with two servers only the clients of this one (by lsof),
# prints on macOS the app in front (`front`, by lsappinfo), then each
# client's lines (its tty's access time, with a fraction on macOS), its
# terminal app and its variables; nothing when no client is found. Then
# the light check (HERDR_TICK_SH) with a fake stat and lsappinfo: the app
# in front on macOS, and the access time of each tty asked that is there.
# Usage: sh tests/herdr-sh-test.sh   (exit 0 when all pass)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-herdr-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# The TypeScript text as sh: the escapes undone.
perl -0ne 'if (/^export const HERDR_CLIENT_SH = `(.*?)`$/ms) { $_ = $1; s/\\\\/\x00/g; s/\\\$/\$/g; s/\x00/\\/g; print }' "$here/hooks/lib/host.ts" > "$tmp/client.sh"
[ -s "$tmp/client.sh" ] && ok || bad "HERDR_CLIENT_SH: not found in host.ts"
perl -0ne 'if (/^export const HERDR_TICK_SH = `(.*?)`$/ms) { $_ = $1; s/\\\\/\x00/g; s/\\\$/\$/g; s/\x00/\\/g; print }' "$here/hooks/lib/host.ts" > "$tmp/tick.sh"
[ -s "$tmp/tick.sh" ] && ok || bad "HERDR_TICK_SH: not found in host.ts"

uid=$(id -u)
realps=$(command -v ps)
bin=$tmp/bin
mkdir -p "$bin"
# Only these tools (so lsof is there only when a test puts it there).
for t in awk sed grep cut paste id cat tr; do ln -s "$(command -v "$t")" "$bin/$t"; done
# ps: `eww` prints $FAKE/env-<pid>; else the table, with this shell (the
# caller of ps, or the caller's caller) under the pane's claude (pid 4999900).
cat > "$bin/ps" <<EOF
#!/bin/sh
case "\$*" in *eww*) for p; do :; done; cat "\$FAKE/env-\$p" 2>/dev/null; exit 0 ;; esac
if [ -z "\${NOSELF:-}" ]; then
  up=\$($realps -o ppid= -p \$PPID | tr -d ' ')
  echo "\$PPID \$up $uid \$NOTTY sh"
  echo "\$up 4999900 $uid \$NOTTY sh"
fi
cat "\$FAKE/table"
EOF
# stat: `/dev/null` (the check for fractional times) gives one; else $FAKE/stat.
printf '#!/bin/sh\ncase "$*" in *" /dev/null") echo 1792718368.016685000; exit 0 ;; esac\ncat "$FAKE/stat"\n' > "$bin/stat"
printf '#!/bin/sh\necho "$FAKE_OS"\n' > "$bin/uname"
chmod +x "$bin/ps" "$bin/stat" "$bin/uname"
lsof_bin() { printf '#!/bin/sh\ncat "$FAKE/lsof"\n' > "$bin/lsof"; chmod +x "$bin/lsof"; }
# lsappinfo: `front` gives an ASN; `info -only bundleid <asn>` that app's id ($FRONT).
cat > "$bin/lsappinfo" <<'EOF2'
#!/bin/sh
case "$1" in
  front) echo 'ASN:0x0-0x1a01a:' ;;
  info) [ "$4" = 'ASN:0x0-0x1a01a:' ] && [ -n "${FRONT:-}" ] && printf '"CFBundleIdentifier"="%s"\n' "$FRONT" ;;
esac
EOF2
chmod +x "$bin/lsappinfo"

# A Mac: a server (and its pane's shell and claude), Ghostty's and kitty's
# clients, and processes that are not clients (a CLI call, no tty, another
# user's), and two clients of a named session.
F=$tmp/mac
mkdir -p "$F"
cat > "$F/table" <<EOF
4999700 1 $uid ?? /Users/u/.local/bin/herdr server
4999800 4999700 $uid 16/14 -zsh
4999900 4999800 $uid 16/14 claude
4999100 1 $uid ?? /Applications/Ghostty.app/Contents/MacOS/ghostty -e /Users/u/.local/bin/herdr
4999101 4999100 0 16/12 /usr/bin/login -flp u /Users/u/.local/bin/herdr
4999102 4999101 $uid 16/12 herdr
4999200 1 $uid ?? /Applications/kitty.app/Contents/MacOS/kitty /Users/u/.local/bin/herdr
4999201 4999200 $uid 16/21 /Users/u/.local/bin/herdr
4999202 4999200 $uid 16/22 herdr pane list
4999203 4999200 $uid ?? herdr
4999204 4999200 1234567 16/23 herdr
4999205 4999200 $uid 16/24 herdr --session work
4999206 4999200 $uid 16/25 herdr session attach work
EOF
cat > "$F/stat" <<EOF
16/12 1000.25 /dev/ttys012
16/14 9999 /dev/ttys014
16/21 2000 /dev/ttys021
16/22 9999 /dev/ttys022
16/23 9999 /dev/ttys023
16/24 500 /dev/ttys024
16/25 400 /dev/ttys025
EOF
echo '/Users/u/.local/bin/herdr TERM=xterm-kitty KITTY_WINDOW_ID=1' > "$F/env-4999201"
echo 'herdr TERM=xterm-ghostty TERM_PROGRAM=ghostty' > "$F/env-4999102"
# The second server's socket peer is kitty's; this server's is Ghostty's.
cat > "$F/lsof" <<EOF
COMMAND   PID      USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
herdr   4999102 u    4u  unix 0xaaa1      0t0      ->0x5001
herdr   4999201 u    4u  unix 0xbbb1      0t0      ->0x6001
herdr   4999700 u    4u  unix 0x9001      0t0      /Users/u/.config/herdr/herdr.sock
herdr   4999700 u   30u  unix 0x5001      0t0      /Users/u/.config/herdr/herdr-client.sock
EOF

shells=
for s in sh dash bash; do command -v "$s" >/dev/null 2>&1 && shells="$shells $s"; done
for s in $shells; do
  # By its path: PATH holds only the fake tools.
  [ "$s" = bash ] && s="$(command -v bash) --posix" || s=$(command -v "$s")
  run() { PATH=$bin FAKE=$F FAKE_OS=Darwin NOTTY=?? NOSELF=$noself FRONT=$front $s "$tmp/client.sh"; }
  # The pids of the clients printed, in order of pid; one client's lines.
  pids() { echo "$1" | grep '^pid ' | cut -d' ' -f2 | sort | tr '\n' ' '; }
  block() { echo "$1" | awk -v p="$2" '/^pid / { q = $2 } q == p'; }
  noself=
  front=
  rm -f "$bin/lsof"
  # One server: all its clients (Ghostty's, kitty's and the named session's), not the others.
  out=$(run)
  [ "$(pids "$out")" = "4999102 4999201 4999205 4999206 " ] && ok || bad "$s: not the four clients ($out)"
  [ "$(block "$out" 4999201 | sed -n 2,5p | tr '\n' '|')" = "atime 2000|tty ttys021|cmd /Users/u/.local/bin/herdr|app /Applications/kitty.app/Contents/MacOS/kitty /Users/u/.local/bin/herdr|" ] && ok || bad "$s: kitty's lines ($out)"
  [ "$(block "$out" 4999201 | sed -n 6,7p | tr '\n' '|')" = "env|/Users/u/.local/bin/herdr TERM=xterm-kitty KITTY_WINDOW_ID=1|" ] && ok || bad "$s: kitty's variables ($out)"
  # Ghostty: its app is above login (which has a tty); its time keeps the fraction.
  [ "$(block "$out" 4999102 | grep '^app ')" = "app /Applications/Ghostty.app/Contents/MacOS/ghostty -e /Users/u/.local/bin/herdr" ] && ok || bad "$s: Ghostty's app ($out)"
  [ "$(block "$out" 4999102 | grep '^atime ')" = "atime 1000.25" ] && ok || bad "$s: Ghostty's time ($out)"
  [ "$(block "$out" 4999102 | sed -n 7p)" = "herdr TERM=xterm-ghostty TERM_PROGRAM=ghostty" ] && ok || bad "$s: Ghostty's variables ($out)"
  # No app in front known: no front line.
  [ -z "$(echo "$out" | grep '^front')" ] && ok || bad "$s: a front line with no app in front ($out)"
  # The app in front: its bundle id first.
  front=com.mitchellh.ghostty; out=$(run); front=
  [ "$(echo "$out" | sed -n 1p)" = "front com.mitchellh.ghostty" ] && ok || bad "$s: not the app in front ($out)"
  [ "$(pids "$out")" = "4999102 4999201 4999205 4999206 " ] && ok || bad "$s: with the app in front, not the four clients ($out)"
  # Two servers: lsof keeps this server's client (Ghostty) only.
  echo "4999701 1 $uid ?? /opt/herdr server" >> "$F/table"
  lsof_bin
  out=$(run)
  [ "$(pids "$out")" = "4999102 " ] && ok || bad "$s: two servers, not this server's client ($out)"
  # No lsof: all clients stay.
  rm -f "$bin/lsof"
  out=$(run)
  [ "$(pids "$out")" = "4999102 4999201 4999205 4999206 " ] && ok || bad "$s: two servers, no lsof, not all clients ($out)"
  # lsof with no peer column (Linux): all clients stay.
  lsof_bin
  cp "$F/lsof" "$F/lsof.keep"
  sed 's/->0x[0-9a-f]*/type=STREAM/' "$F/lsof.keep" > "$F/lsof"
  out=$(run)
  [ "$(pids "$out")" = "4999102 4999201 4999205 4999206 " ] && ok || bad "$s: two servers, no peers, not all clients ($out)"
  mv "$F/lsof.keep" "$F/lsof"
  # Two servers and this pane's not found: nothing.
  noself=1; front=com.mitchellh.ghostty; out=$(run); noself=; front=
  [ -z "$out" ] && ok || bad "$s: two servers, none above the shell, but output ($out)"
  sed '$d' "$F/table" > "$F/table2" && mv "$F/table2" "$F/table"
  rm -f "$bin/lsof"
  # No client (the only one left has no tty): nothing, exit 0.
  grep -v -e ' 16/2[1-5] ' -e ' 16/12 herdr' "$F/table" > "$F/table.none"
  out=$(cp "$F/table" "$F/table.keep" && cp "$F/table.none" "$F/table" && front=com.mitchellh.ghostty run; echo "exit $?"; cp "$F/table.keep" "$F/table")
  [ "$out" = "exit 0" ] && ok || bad "$s: no client, but output ($out)"
  # Linux: tty names (pts/N), stat -c, no tty is ?, no front line (lsappinfo is not asked).
  sed -e 's/ 16\/\([0-9]*\) / pts\/\1 /' -e 's/ ?? / ? /' "$F/table" > "$tmp/linux-table"
  L=$tmp/linux; mkdir -p "$L"; cp "$tmp/linux-table" "$L/table"; cp "$F"/env-* "$L/"
  sed 's|^16/\([0-9]*\) \([0-9.]*\) .*|/dev/pts/\1 \2 /dev/pts/\1|' "$F/stat" > "$L/stat"
  out=$(PATH=$bin FAKE=$L FAKE_OS=Linux NOTTY=? NOSELF= FRONT=com.mitchellh.ghostty $s "$tmp/client.sh")
  [ "$(pids "$out")" = "4999102 4999201 4999205 4999206 " ] && ok || bad "$s: Linux, not the four clients ($out)"
  [ "$(block "$out" 4999201 | sed -n 1,3p | tr '\n' '|')" = "pid 4999201|atime 2000|tty pts/21|" ] && ok || bad "$s: Linux, kitty's lines ($out)"
  [ -z "$(echo "$out" | grep '^front')" ] && ok || bad "$s: Linux, a front line ($out)"
done

# The light check: its own stat, which prints the format for each path in
# $FAKE/times (`path time`) and fails for the others; %a and %X give whole
# seconds; %Fa gives no number with NOFRAC (a stat with no %F).
tbin=$tmp/tbin
mkdir -p "$tbin"
for t in awk sed; do ln -s "$(command -v "$t")" "$tbin/$t"; done
ln -s "$bin/lsappinfo" "$tbin/lsappinfo"
cat > "$tbin/stat" <<'EOF2'
#!/bin/sh
fmt=$2; shift 2
rc=0
for p; do
  t=$(awk -v p="$p" '$1 == p { print $2 }' "$FAKE/times")
  if [ -z "$t" ]; then echo "stat: $p: No such file or directory" >&2; rc=1; continue; fi
  case $fmt in *%Fa) [ -n "${NOFRAC:-}" ] && t=Fa ;; *) t=${t%%.*} ;; esac
  printf '%s\n' "$fmt" | sed "s|%[Nn]|$p|; s|%Fa|$t|; s|%[aX]|$t|"
done
exit $rc
EOF2
chmod +x "$tbin/stat"
T=$tmp/tick; mkdir -p "$T"
printf '/dev/ttys012 1000.250000000\n/dev/ttys021 2000.000000000\n/dev/pts/21 2000.000000000\n' > "$T/times"
for s in $shells; do
  [ "$s" = bash ] && s="$(command -v bash) --posix" || s=$(command -v "$s")
  tick() { PATH=$tbin FAKE=$T FRONT=$front NOFRAC=$nofrac $s "$tmp/tick.sh" "$@"; echo "exit $?"; }
  front=; nofrac=
  nl='
'
  # macOS: the app in front, then each tty's time with its fraction.
  front=com.mitchellh.ghostty; out=$(tick Darwin /dev/ttys012 /dev/ttys021); front=
  [ "$out" = "front com.mitchellh.ghostty${nl}atime /dev/ttys012 1000.250000000${nl}atime /dev/ttys021 2000.000000000${nl}exit 0" ] && ok || bad "$s: tick, macOS ($out)"
  # No app in front known: no front line.
  out=$(tick Darwin /dev/ttys012)
  [ "$out" = "atime /dev/ttys012 1000.250000000${nl}exit 0" ] && ok || bad "$s: tick, no front ($out)"
  # A tty that is gone: no line for it; the others stay.
  out=$(tick Darwin /dev/ttys099 /dev/ttys021)
  [ "$out" = "atime /dev/ttys021 2000.000000000${nl}exit 0" ] && ok || bad "$s: tick, a tty gone ($out)"
  # All gone: nothing, exit 0.
  out=$(tick Darwin /dev/ttys099)
  [ "$out" = "exit 0" ] && ok || bad "$s: tick, all gone ($out)"
  # A stat with no %Fa: whole seconds.
  nofrac=1; out=$(tick Darwin /dev/ttys012 /dev/ttys021); nofrac=
  [ "$out" = "atime /dev/ttys012 1000${nl}atime /dev/ttys021 2000${nl}exit 0" ] && ok || bad "$s: tick, no %Fa ($out)"
  # No tty asked: the app in front only.
  front=com.googlecode.iterm2; out=$(tick Darwin); front=
  [ "$out" = "front com.googlecode.iterm2${nl}exit 0" ] && ok || bad "$s: tick, no tty ($out)"
  # Linux: stat -c, whole seconds, and no front line (lsappinfo is not asked).
  front=com.mitchellh.ghostty; out=$(tick Linux /dev/pts/21 /dev/pts/9); front=
  [ "$out" = "atime /dev/pts/21 2000${nl}exit 0" ] && ok || bad "$s: tick, Linux ($out)"
  out=$(tick Linux)
  [ "$out" = "exit 0" ] && ok || bad "$s: tick, Linux, no tty ($out)"
done

echo "herdr-sh-test: $pass passed, $fail failed (shells:$shells)"
[ "$fail" = 0 ]
