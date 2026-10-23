#!/bin/sh
# Renders Markdown with render/md.typ and the real Typst, once as one page
# and once cut into pages at its blocks (with the seams that compile writes
# in doc.json), and compares where each line is with the pages one under
# the other: on the row grid (both phases) a page that continues the text
# starts with the gap the blocks have in one page, so each line is where it
# is in one page; off the grid each line is at most one row lower for each
# break (a page is padded to whole rows). It keeps the PNGs in $IUI_GAP_OUT
# when that is set, to look at.
# Usage: sh tests/gap-sh-test.sh   (exit 0 when all pass; skips with no typst)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-gap-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

command -v typst >/dev/null 2>&1 || { echo "gap-sh-test: skipped (no typst)"; exit 0; }

# Doc JSONs from the Markdown on stdin (blocks between blank lines, no
# fence with a blank line): $tmp/<name>-one.json (one segment) and
# $tmp/<name>-cut.json (one segment for each block, with its seams).
docs() {
  perl -e 'local $/; my $m = <STDIN>; $m =~ s/\n+$//; my @b = split /\n\n+/, $m;
    my $q = sub { my $s = shift; $s =~ s/(["\\])/\\$1/g; $s =~ s/\n/\\n/g; "\"$s\"" };
    open my $one, ">", "$ARGV[0]-one.json"; print $one "{\"base\": \"\", \"segments\": [" . $q->($m) . "]}";
    my @seams = ("null", map { "[" . $q->($b[$_ - 1]) . ", " . $q->($b[$_]) . "]" } 1 .. $#b);
    open my $cut, ">", "$ARGV[0]-cut.json"; print $cut "{\"base\": \"\", \"segments\": [" . join(", ", map { $q->($_) } @b) . "], \"seams\": [" . join(", ", @seams) . "]}"' "$tmp/$1"
}
# The inputs of doc $1 with row $2, grid $3 (1 on, 0 off).
inputs() {
  echo "--input theme=dark --input width=420 --input top=4 --input code=0.9 --input theme-dir=$here/render/themes/claude-code --input doc=$1 --input row=$2"
  [ "$3" = 0 ] || echo "--input grid=1"
}
# The y of each line (its first mark), the pages one under the other, of
# doc $1 (row $2, grid $3) at $1.lines: the page heights from the PNGs (at
# 720 ppi: 0.1 pt), the marks from the probe.
lines() {
  rm -f "$1".*.png
  # shellcheck disable=SC2046
  typst compile --root / --package-path "$here/render/packages" --format png --ppi 720 $(inputs "$1.json" "$2" "$3") "$here/render/md.typ" "$1.{0p}.png" 2> "$tmp/err" \
    && typst query --root / --package-path "$here/render/packages" $(inputs "$1.json" "$2" "$3") --input probe=1 "$here/render/md.typ" '<mdpos>' --field value > "$1.marks" 2> "$tmp/err" \
    || { bad "typst for $(basename "$1") (row $2, grid $3): $(grep -A3 '^error' "$tmp/err" | head -4)"; return 1; }
  perl -MJSON::PP -e 'my $marks = shift;
    my @h = map { open my $f, "<:raw", $_; read $f, my $b, 24; (unpack "x20 N", $b) / 10 } sort { ($a =~ /(\d+)\.png$/)[0] <=> ($b =~ /(\d+)\.png$/)[0] } @ARGV;
    my @off = (0); push @off, $off[-1] + $_ for @h;
    local $/; open my $m, "<", $marks; my @m = @{decode_json(<$m>)}; my %seen;
    for my $x (grep { $_->{k} eq "w" or $_->{k} eq "c" } @m) { my $y = $x->{y} + $off[$x->{p} - 1]; next if $seen{sprintf "%.0f", $y}++; printf "%.2f %d %.2f %s\n", $y, $x->{p}, $x->{y}, $x->{k} eq "c" ? "code" : $x->{t} }' "$1.marks" "$1".*.png > "$1.lines"
  ok
}
# Compares the lines of $1-one and $1-cut (row $2, grid $3): the same
# lines; on the grid each at the same y (to 0.15 pt), off the grid each at
# most one row lower for each break above it.
same() {
  lines "$tmp/$1-one" "$2" "$3" && lines "$tmp/$1-cut" "$2" "$3" || return
  out=$(paste -d ' ' "$tmp/$1-one.lines" "$tmp/$1-cut.lines" | perl -ne 'my ($y1, $p1, $r1, $t1, $y2, $p2, $r2, $t2) = split;
    print "$t1 / $t2\n" if $t1 ne $t2; my $d = $y2 - $y1;
    if ('"$3"') { print "$t1 at $y1, cut $y2\n" if abs($d) > 0.15 } else { print "$t1 at $y1, cut $y2\n" if $d < -0.15 or $d > ($p2 - 1) * '"$2"' + 0.15 }')
  [ "$(wc -l < "$tmp/$1-one.lines")" = "$(wc -l < "$tmp/$1-cut.lines")" ] || out="lines: $(wc -l < "$tmp/$1-one.lines") and $(wc -l < "$tmp/$1-cut.lines") $out"
  [ -z "$out" ] && ok || bad "$1 (row $2, grid $3): $out"
}

# The case that was seen: a list on the page under a paragraph.
printf '## 1. What Is a GPU?\n\nJust as $E=mc^2$ a paragraph that ends here.\n\n- **Fixed-function era:** item one\n- item two\n' | docs list
# Other blocks at a break: a heading of each phase, code, a quote, a
# table, display math, a numbered list, a rule.
printf '# A Field Guide\n\n### Three\n\nText under it.\n\n```sh\necho hi\n```\n\n> A quote.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Two\n\n$$\nx^2 + y^2\n$$\n\n1. one\n2. two\n\n---\n\nLast.\n' | docs mixed
# 13.2: one row a line; 11.6331: another font size; 7: two rows a line
# (the half-row phase).
for row in 13.2 11.6331 7; do
  same list "$row" 1
  same mixed "$row" 1
done
same list 13.2 0
same mixed 13.2 0

# The page under the break starts with the blank row (grid, one row a
# line): the list's first line is a row down, not at the page's top.
lines "$tmp/list-cut" 13.2 1 && {
  out=$(perl -ne 'my ($y, $p, $r, $t) = split; print "page 3 starts at $r\n" if $p == 3 and !$s++ and $r < 13.2' "$tmp/list-cut.lines")
  [ -z "$out" ] && ok || bad "the blank row at the break: $out"
}

# PNGs to look at.
if [ -n "${IUI_GAP_OUT:-}" ]; then
  mkdir -p "$IUI_GAP_OUT"
  cp "$tmp"/*.png "$IUI_GAP_OUT/" 2>/dev/null
fi
echo "gap-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
