#!/bin/sh
# Makes the root of a pasted image's preview with FILL_SH (hooks/lib/typst.ts)
# in sh, dash and bash, and compiles render/fill.typ in it with the real
# Typst, as the mod does: the root is private and has only fill.typ and a
# link to the pasted file; a pasted file that is a link or not a file gets no
# root; the copy fills the box; Typst reads no file outside the root.
# Usage: sh tests/fill-sh-test.sh   (exit 0 when all pass; the compiles skip with no typst)
set -u
here=$(cd "$(dirname "$0")/.." && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-fill-test.XXXXXX")
tmp=$(cd "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# The TypeScript array as sh: each '...' line, the escapes undone.
fill_sh=$(perl -e 'local $/; $_ = <STDIN>; /export const FILL_SH = \[\n(.*?)\n\]\.join/s or exit 1;
  print join("\n", map { s/^\s*\x27//; s/\x27,?\s*$//; s/\\\\/\\/g; $_ } split /\n/, $1)' < "$here/hooks/lib/typst.ts")
[ -n "$fill_sh" ] && ok || bad "FILL_SH: not found in typst.ts"

# The pasted image (Claude Code's file), a link to it and a secret text file.
paste=$tmp/paste secret=$tmp/secret.txt
mkdir -p "$paste/dir.png"
echo 'SECRET-WORDS-42' > "$secret"
if command -v typst >/dev/null 2>&1; then
  printf '#set page(width: 64pt, height: 32pt, fill: blue)\n' | typst compile -f png - "$paste/5.png"
else
  printf '\211PNG\r\n\032\n' > "$paste/5.png"
fi
ln -s 5.png "$paste/6.png"

shells=
for s in sh dash bash; do command -v "$s" >/dev/null 2>&1 && shells="$shells $s"; done
n=0
for s in $shells; do
  [ "$s" = bash ] && s='bash --posix'
  n=$((n + 1)); k=$tmp/cache/k$n; r=$k/r-1
  mkdir -p "$k"
  $s -c "$fill_sh" sh "$r" "$here" "$paste/5.png" && ok || bad "$s: FILL_SH failed"
  case $(ls -ld "$r") in drwx------*) ok ;; *) bad "$s: the root is not private ($(ls -ld "$r"))" ;; esac
  [ -f "$r/fill.typ" ] && [ ! -L "$r/fill.typ" ] && cmp -s "$here/render/fill.typ" "$r/fill.typ" && ok || bad "$s: fill.typ is not a copy"
  [ -L "$r/image.png" ] && [ "$(readlink "$r/image.png")" = "$paste/5.png" ] && ok || bad "$s: image.png is not a link to the pasted file"
  [ "$(ls -A "$r" | tr '\n' ' ')" = "fill.typ image.png " ] && ok || bad "$s: the root has more: $(ls -A "$r")"
  # A folder that is there is never used again.
  $s -c "$fill_sh" sh "$r" "$here" "$paste/5.png" 2>/dev/null && bad "$s: an old folder was used again" || ok
  # A link, a folder, no file, not a .png or a relative path: no root.
  for no in "$paste/6.png" "$paste/dir.png" "$paste/missing.png" "$secret" 5.png; do
    $s -c "$fill_sh" sh "$k/r-no" "$here" "$no" 2>/dev/null && bad "$s: a root for $no" || ok
    [ ! -e "$k/r-no" ] && ok || { bad "$s: $k/r-no made for $no"; rm -rf "$k/r-no"; }
  done
done

if ! command -v typst >/dev/null 2>&1; then
  echo "fill-sh-test: $pass passed, $fail failed (compiles skipped: no typst)"
  [ "$fail" = 0 ]; exit
fi

# Compiles fill.typ as the mod does (fillCall), with input f=$2, in root $1.
fill() {
  perl -e 'alarm 20; exec @ARGV' typst compile --root "$1" --format png --diagnostic-format short --ppi 72 \
    --input "f=$2" --input maxw=40 --input maxh=30 "$1/fill.typ" "$tmp/out.png" > "$tmp/err" 2>&1
}
r=$tmp/cache/k1/r-1
fill "$r" /image.png && ok || bad "the pasted image: $(head -n 3 "$tmp/err")"
# The copy is the box in pixels: 40 x 30.
size=$(perl -e 'open(F, "<", $ARGV[0]) or exit 1; binmode F; read(F, my $h, 24); my ($w, $h2) = unpack("NN", substr($h, 16, 8)); print "$w $h2"' "$tmp/out.png")
[ "$size" = "40 30" ] && ok || bad "the copy is $size, not 40 30"
# Any other file: not found, or out of the root.
for f in /etc/hosts "$secret" "$paste/5.png" ../../../../../../../../etc/hosts /fill.typ; do
  if fill "$r" "$f"; then bad "f=$f: compiled"
  elif ! grep -q 'SECRET-WORDS\|localhost' "$tmp/err"; then ok
  else bad "f=$f: $(head -n 3 "$tmp/err")"
  fi
done
# The same input with the root at / (as before) reads the file: the test is real.
typst compile --root / --format png --ppi 72 --input "f=$paste/5.png" --input maxw=40 --input maxh=30 "$here/render/fill.typ" "$tmp/old.png" > /dev/null 2>&1 \
  && ok || bad "with the root at /, the pasted file by its path did not compile (the test shows nothing)"

echo "fill-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
