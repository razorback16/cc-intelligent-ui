#!/bin/sh
# Runs the herdr client check (HERDR_CLIENT_SH in hooks/lib/host.ts) in sh,
# dash and bash with a fake ps, stat, uname and lsof: it finds this pane's
# server above the shell, keeps the clients of this user with a tty, keeps
# with two servers only the clients of this one (by lsof), picks the tty
# read last, and prints that client's lines, its terminal app and its
# variables; nothing when no client is found.
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
printf '#!/bin/sh\ncat "$FAKE/stat"\n' > "$bin/stat"
printf '#!/bin/sh\necho "$FAKE_OS"\n' > "$bin/uname"
chmod +x "$bin/ps" "$bin/stat" "$bin/uname"
lsof_bin() { printf '#!/bin/sh\ncat "$FAKE/lsof"\n' > "$bin/lsof"; chmod +x "$bin/lsof"; }

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
16/12 1000 /dev/ttys012
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
  run() { PATH=$bin FAKE=$F FAKE_OS=Darwin NOTTY=?? NOSELF=$noself $s "$tmp/client.sh"; }
  noself=
  rm -f "$bin/lsof"
  # One server: the tty read last (kitty's) wins.
  out=$(run)
  [ "$(echo "$out" | sed -n 1p)" = "pid 4999201" ] && ok || bad "$s: not kitty's client ($out)"
  [ "$(echo "$out" | sed -n 2,5p | tr '\n' '|')" = "atime 2000|tty ttys021|cmd /Users/u/.local/bin/herdr|app /Applications/kitty.app/Contents/MacOS/kitty /Users/u/.local/bin/herdr|" ] && ok || bad "$s: kitty's lines ($out)"
  [ "$(echo "$out" | sed -n 6,7p | tr '\n' '|')" = "env|/Users/u/.local/bin/herdr TERM=xterm-kitty KITTY_WINDOW_ID=1|" ] && ok || bad "$s: kitty's variables ($out)"
  # Ghostty read last: its app is above login (which has a tty).
  sed 's/^16\/12 1000/16\/12 3000/' "$F/stat" > "$F/stat2" && mv "$F/stat2" "$F/stat"
  out=$(run)
  [ "$(echo "$out" | sed -n 1p)" = "pid 4999102" ] && ok || bad "$s: not Ghostty's client ($out)"
  [ "$(echo "$out" | grep '^app ')" = "app /Applications/Ghostty.app/Contents/MacOS/ghostty -e /Users/u/.local/bin/herdr" ] && ok || bad "$s: Ghostty's app ($out)"
  sed 's/^16\/12 3000/16\/12 1000/' "$F/stat" > "$F/stat2" && mv "$F/stat2" "$F/stat"
  # Two servers: lsof keeps this server's client (Ghostty), though kitty's was read last.
  echo "4999701 1 $uid ?? /opt/herdr server" >> "$F/table"
  lsof_bin
  out=$(run)
  [ "$(echo "$out" | sed -n 1p)" = "pid 4999102" ] && ok || bad "$s: two servers, not this server's client ($out)"
  # No lsof: all clients stay.
  rm -f "$bin/lsof"
  out=$(run)
  [ "$(echo "$out" | sed -n 1p)" = "pid 4999201" ] && ok || bad "$s: two servers, no lsof, not the last read ($out)"
  # lsof with no peer column (Linux): all clients stay.
  lsof_bin
  cp "$F/lsof" "$F/lsof.keep"
  sed 's/->0x[0-9a-f]*/type=STREAM/' "$F/lsof.keep" > "$F/lsof"
  out=$(run)
  [ "$(echo "$out" | sed -n 1p)" = "pid 4999201" ] && ok || bad "$s: two servers, no peers, not the last read ($out)"
  mv "$F/lsof.keep" "$F/lsof"
  # Two servers and this pane's not found: nothing.
  noself=1; out=$(run); noself=
  [ -z "$out" ] && ok || bad "$s: two servers, none above the shell, but output ($out)"
  sed '$d' "$F/table" > "$F/table2" && mv "$F/table2" "$F/table"
  rm -f "$bin/lsof"
  # No client (the only one left has no tty): nothing, exit 0.
  grep -v -e ' 16/2[1-5] ' -e ' 16/12 herdr' "$F/table" > "$F/table.none"
  out=$(cp "$F/table" "$F/table.keep" && cp "$F/table.none" "$F/table" && run; echo "exit $?"; cp "$F/table.keep" "$F/table")
  [ "$out" = "exit 0" ] && ok || bad "$s: no client, but output ($out)"
  # Linux: tty names (pts/N), stat -c, no tty is ?.
  sed -e 's/ 16\/\([0-9]*\) / pts\/\1 /' -e 's/ ?? / ? /' "$F/table" > "$tmp/linux-table"
  L=$tmp/linux; mkdir -p "$L"; cp "$tmp/linux-table" "$L/table"; cp "$F"/env-* "$L/"
  sed 's|^16/\([0-9]*\) \([0-9]*\) .*|/dev/pts/\1 \2 /dev/pts/\1|' "$F/stat" > "$L/stat"
  out=$(PATH=$bin FAKE=$L FAKE_OS=Linux NOTTY=? NOSELF= $s "$tmp/client.sh")
  [ "$(echo "$out" | sed -n 1,3p | tr '\n' '|')" = "pid 4999201|atime 2000|tty pts/21|" ] && ok || bad "$s: Linux, not kitty's client ($out)"
done

echo "herdr-sh-test: $pass passed, $fail failed (shells:$shells)"
[ "$fail" = 0 ]
