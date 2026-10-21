#!/bin/sh
# Runs the copy of a font out of a terminal's program (PROGRAM_FONTS_SH and
# PROGRAM_FONTS_PL in hooks/lib/host.ts) with the real perl, in sh, dash and
# bash: on a fake program that holds small sfnt fonts (with `fvar` and
# `name` tables), it checks the folder and its files, a second run from
# the cache, the `.none` marker, the sweep of old folders, two runs at the
# same time, a family of its own key, a write that fails, and no program.
# Usage: sh tests/fonts-sh-test.sh   (exit 0 when all pass)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-fonts-test.XXXXXX")
trap 'chmod -R u+rwx "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# The TypeScript arrays as text: each '...' line, the escapes undone.
part() {
  perl -e 'local $/; $_ = <STDIN>; /export const $ARGV[0] = \[\n(.*?)\n\]\.join/s or exit 1;
    print join("\n", map { s/^\s*\x27//; s/\x27,?\s*$//; s/\\\\/\\/g; $_ } split /\n/, $1)' "$1" < "$here/hooks/lib/host.ts"
}
pl=$(part PROGRAM_FONTS_PL) && [ -n "$pl" ] && ok || bad "PROGRAM_FONTS_PL: not found in host.ts"
sh_text=$(part PROGRAM_FONTS_SH) && [ -n "$sh_text" ] && ok || bad "PROGRAM_FONTS_SH: not found in host.ts"
perl=$(command -v perl)

# A small sfnt: 4 tables (fvar, head, maxp, name); the name table holds the
# family in UTF-16BE. Argument 1: the family; 2: the filler size (so two
# fonts differ in size); 3: the file to write.
cat > "$tmp/font.pl" <<'EOF'
my ($family, $pad, $out) = @ARGV;
my %t = (fvar => "\0" x 16, head => "\0" x 54, maxp => "\0" x (6 + $pad), name => "\0\0\0\1\0\x12" . "\0" x 12 . join("", map { "\0$_" } split //, $family));
my @tags = sort keys %t; my $off = 12 + 16 * @tags; my ($dir, $data) = ("", "");
for my $tag (@tags) { my $d = $t{$tag}; $d .= "\0" x ((4 - length($d) % 4) % 4); $dir .= pack("a4NNN", $tag, 0, $off + length($data), length($t{$tag})); $data .= $d; }
open(my $o, ">:raw", $out) or die; print $o pack("Nnnnn", 0x00010000, scalar(@tags), 64, 2, 0) . $dir . $data; close $o;
EOF
"$perl" "$tmp/font.pl" "Test Mono" 0 "$tmp/regular.ttf"
"$perl" "$tmp/font.pl" "Test Mono" 8 "$tmp/italic.ttf"
"$perl" "$tmp/font.pl" "Other Font" 4 "$tmp/other.ttf"
"$perl" "$tmp/font.pl" "Big Mono" 4000 "$tmp/big.ttf"
# A program: filler, the fonts (the regular one twice, as in a universal
# program), and another family's font.
program() {
  { head -c 3000 /dev/urandom; cat "$tmp/regular.ttf"; head -c 500 /dev/urandom; cat "$tmp/italic.ttf" "$tmp/other.ttf"; head -c 700 /dev/urandom; cat "$tmp/regular.ttf"; } > "$1"
  chmod 755 "$1"
}
same() { cmp -s "$1" "$2"; }

shells=
for s in sh dash bash; do command -v "$s" >/dev/null 2>&1 && shells="$shells $s"; done
for s in $shells; do
  [ "$s" = bash ] && s='bash --posix'
  k=$(echo "$s" | tr -d ' -')
  xdg=$tmp/xdg-$k; base=$xdg/cc-intelligent-ui/fonts; bin=$tmp/bin-$k
  mkdir -p "$bin"; program "$bin/term"
  run() { XDG_CACHE_HOME=$xdg PATH=$bin:/usr/bin:/bin $s -c "$sh_text" sh "$perl" "$pl" "$@"; }
  # Old folders of the tag: a temporary one of 2 days and a key folder of
  # 31 days go; a key folder of today and another tag's old folder stay.
  mkdir -p "$base/test-old" "$base/test-1-2-3.999" "$base/test-new" "$base/other-old"
  touch -t 202001010000 "$base/test-old" "$base/test-1-2-3.999" "$base/other-old"
  # The first run: the folder, one file for each size of the family.
  out=$(run test "Test Mono" term /nowhere); code=$?
  dir=$(echo "$out" | sed -n 1p)
  [ "$code" = 0 ] && case $dir in "$base"/test-v2-*) true ;; *) false ;; esac && ok || bad "$s: exit $code, folder '$dir'"
  [ "$(ls "$dir" | tr '\n' ' ')" = "test-1.ttf test-2.ttf " ] && ok || bad "$s: the files are $(ls "$dir" | tr '\n' ' ')"
  same "$dir/test-1.ttf" "$tmp/regular.ttf" && same "$dir/test-2.ttf" "$tmp/italic.ttf" && ok || bad "$s: a copied font is not the same"
  [ ! -e "$base/test-old" ] && [ ! -e "$base/test-1-2-3.999" ] && [ -d "$base/test-new" ] && [ -d "$base/other-old" ] && ok || bad "$s: the sweep is wrong ($(ls "$base" | tr '\n' ' '))"
  # The second run reads the cache, not the program.
  chmod 000 "$bin/term"
  out=$(run test "Test Mono" term "$bin/term"); code=$?
  [ "$code" = 0 ] && [ "$out" = "$dir" ] && ok || bad "$s: the second run gave exit $code, '$out'"
  chmod 755 "$bin/term"
  # A family the program does not have: exit 3 and a marker, then exit 3
  # from the marker (the program is not read again).
  out=$(run none "Missing Font" term); code=$?
  [ "$code" = 3 ] && [ -z "$out" ] && ls "$base"/none-*.none >/dev/null 2>&1 && ok || bad "$s: no font gave exit $code, '$out', no marker"
  ls -d "$base"/none-* 2>/dev/null | grep -qv '\.none$' && bad "$s: a folder for no font" || ok
  chmod 000 "$bin/term"
  run none "Missing Font" term "$bin/term" >/dev/null; code=$?
  [ "$code" = 3 ] && ok || bad "$s: the marker was not used (exit $code)"
  chmod 755 "$bin/term"
  # Two runs at the same time (a new build: a new key): one folder, no temporary folder left.
  program "$bin/term2"
  run two "Test Mono" term2 > "$tmp/a-$k" & a=$!
  run two "Test Mono" term2 > "$tmp/b-$k" & b=$!
  wait $a; ca=$?; wait $b; cb=$?
  [ "$ca" = 0 ] && [ "$cb" = 0 ] && [ "$(cat "$tmp/a-$k")" = "$(cat "$tmp/b-$k")" ] && ok || bad "$s: two runs gave $ca/$cb, '$(cat "$tmp/a-$k")' and '$(cat "$tmp/b-$k")'"
  [ "$(ls -d "$base"/two-* | wc -l | tr -d ' ')" = 1 ] && [ "$(ls "$(cat "$tmp/a-$k")" | wc -l | tr -d ' ')" = 2 ] && ok || bad "$s: two runs left $(ls -d "$base"/two-* | tr '\n' ' ')"
  # Another family of the same program: a key of its own.
  out=$(run test "Other Font" term); code=$?
  # (the copy ends at its last table: the file's padding after it is not copied)
  [ "$code" = 0 ] && [ -n "$out" ] && [ "$out" != "$dir" ] && [ "$(ls "$out")" = test-1.ttf ] && head -c "$(wc -c < "$out/test-1.ttf")" "$tmp/other.ttf" | cmp -s - "$out/test-1.ttf" && ok || bad "$s: another family gave exit $code, '$out'"
  # A write that fails (a file size limit): exit 1, no folder and no marker.
  { head -c 3000 /dev/urandom; cat "$tmp/big.ttf"; } > "$bin/term3"; chmod 755 "$bin/term3"
  (trap '' XFSZ; ulimit -f 2; run big "Big Mono" term3 >/dev/null); code=$?
  [ "$code" = 1 ] && [ -z "$(ls -d "$base"/big-* 2>/dev/null)" ] && ok || bad "$s: a failed write gave exit $code, left $(ls -d "$base"/big-* 2>/dev/null | tr '\n' ' ')"
  # No program: exit 2.
  run test "Test Mono" nothing-here /nowhere/term > /dev/null; code=$?
  [ "$code" = 2 ] && ok || bad "$s: no program gave exit $code"
done

echo "fonts-sh-test: $pass passed, $fail failed (shells:$shells)"
[ "$fail" = 0 ]
