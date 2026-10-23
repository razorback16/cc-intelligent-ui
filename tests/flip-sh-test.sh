#!/bin/sh
# Runs WRITE_PL (hooks/lib/flip.ts: a flipped PNG or a picture select frame
# written from base64) with the real perl: the file and its folder, the
# older frames deleted, a folder it can not write, and two writers of one
# file at the same time (each its own temporary file: both end 0, the file
# whole, no temporary file left).
# Usage: sh tests/flip-sh-test.sh   (exit 0 when all pass)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-flip-test.XXXXXX")
trap 'chmod -R u+rwx "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# The TypeScript string as text, its escapes undone.
pl=$(perl -ne 'if (/^export const WRITE_PL = \x27(.*)\x27$/) { (my $s = $1) =~ s/\\\\/\\/g; print $s }' "$here/hooks/lib/flip.ts")
[ -n "$pl" ] && ok || bad "WRITE_PL: not found in flip.ts"

# 1. The file in a new folder; the older frames named after it deleted.
printf 'hello' | base64 > "$tmp/small.b64"
mkdir -p "$tmp/old" && : > "$tmp/old/f-1.png" && : > "$tmp/old/f-2.png"
perl -e "$pl" "$tmp/new/f.png" "$tmp/old/f-1.png" "$tmp/old/f-2.png" < "$tmp/small.b64" && ok || bad "a write exited $?"
[ "$(cat "$tmp/new/f.png" 2>/dev/null)" = hello ] && ok || bad "the file: $(cat "$tmp/new/f.png" 2>&1)"
[ ! -e "$tmp/old/f-1.png" ] && [ ! -e "$tmp/old/f-2.png" ] && ok || bad "the older frames are still there"
[ -z "$(find "$tmp/new" -name '*.tmp')" ] && ok || bad "a temporary file is left: $(find "$tmp/new" -name '*.tmp')"

# 2. A folder it can not write: exit 1, nothing there.
mkdir "$tmp/ro" && chmod 500 "$tmp/ro"
if [ -w "$tmp/ro" ]; then
  echo "flip-sh-test: the read-only case skipped (the folder stays writable: root?)"
else
  perl -e "$pl" "$tmp/ro/f.png" < "$tmp/small.b64" 2> "$tmp/err" && bad "a write to a read-only folder exited 0" || ok
  [ -z "$(ls "$tmp/ro")" ] && ok || bad "the read-only folder has: $(ls "$tmp/ro")"
fi

# 3. Two writers of one file at once, five times: a large picture (12 MB),
# so the two overlap.
head -c 12000000 /dev/zero | tr '\0' 'x' | base64 > "$tmp/big.b64"
size=$(perl -MMIME::Base64 -e 'local $/; print length(decode_base64(<STDIN>))' < "$tmp/big.b64")
i=0
while [ "$i" -lt 5 ]; do
  i=$((i + 1))
  rm -rf "$tmp/k"
  perl -e "$pl" "$tmp/k/flip.png" < "$tmp/big.b64" 2> "$tmp/e1" & a=$!
  perl -e "$pl" "$tmp/k/flip.png" < "$tmp/big.b64" 2> "$tmp/e2" & b=$!
  wait "$a"; ea=$?
  wait "$b"; eb=$?
  [ "$ea" = 0 ] && [ "$eb" = 0 ] && ok || bad "run $i: two writers at once exited $ea and $eb: $(cat "$tmp/e1" "$tmp/e2")"
  got=$(wc -c < "$tmp/k/flip.png" 2>/dev/null | tr -d ' ')
  [ "$got" = "$size" ] && ok || bad "run $i: the file has ${got:-no} bytes, not $size"
  [ -z "$(find "$tmp/k" -name '*.tmp')" ] && ok || bad "run $i: a temporary file is left"
done

echo "flip-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
