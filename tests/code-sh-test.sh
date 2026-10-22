#!/bin/sh
# Renders code blocks with render/md.typ and the real Typst, and reads the
# probe's marks: a block is only as wide as its code and header need (at
# most the page), the header has the language and a copy button, the probe
# marks the button (`t`, kind copy, with the code and the language), the
# header text has no word or line marks, and on the row grid the header is
# whole rows and the code lines stay on their rows. It keeps the PNGs in
# $IUI_CODE_OUT when that is set, to look at.
# Usage: sh tests/code-sh-test.sh   (exit 0 when all pass; skips with no typst)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-code-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

command -v typst >/dev/null 2>&1 || { echo "code-sh-test: skipped (no typst)"; exit 0; }

# A doc JSON of one page of Markdown (stdin) at $tmp/<name>.json.
doc() { perl -e 'local $/; my $m = <STDIN>; $m =~ s/(["\\])/\\$1/g; $m =~ s/\n/\\n/g; print "{\"base\": \"\", \"segments\": [\"$m\"]}"' > "$tmp/$1.json"; }
# The inputs of doc $1 in theme $2 (dark), with grid row $3 (0: no grid).
inputs() {
  echo "--input theme=dark --input width=420 --input top=4 --input code=0.9 --input theme-dir=$here/render/themes/$2 --input doc=$tmp/$1.json"
  [ "$3" = 0 ] || echo "--input row=$3 --input grid=1"
}
# The probe's marks of doc $1 (theme $2, row $3) at $tmp/$1-$2-$3.marks.
probe() {
  # shellcheck disable=SC2046
  typst query --root / --package-path "$here/render/packages" $(inputs "$1" "$2" "$3") --input probe=1 "$here/render/md.typ" '<mdpos>' --field value \
    > "$tmp/$1-$2-$3.marks" 2> "$tmp/err" && ok || bad "probe of $1 ($2, row $3): $(grep -A3 '^error' "$tmp/err" | head -4)"
}
# A check of the marks file $1 by the perl expression $2 (the marks are in
# @m, the code blocks' `t` marks in @t, the `c` marks in @c, the `w` marks
# in @w); it prints what is wrong, nothing when all is right.
check() {
  perl -MJSON::PP -e 'local $/; my @m = @{decode_json(<STDIN>)}; my @t = grep { $_->{k} eq "t" } @m; my @c = grep { $_->{k} eq "c" } @m; my @w = grep { $_->{k} eq "w" } @m; '"$2" < "$1"
}
is() { out=$(check "$1" "$2"); [ -z "$out" ] && ok || bad "$3: $out"; }

printf 'Short:\n\n```python\nprint("hi")\nx = 1\n```\n\nNo language:\n\n```\nmake test\n```\n\nLong:\n\n```sh\necho aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n```\n\n- An item:\n\n  ```js\n  const a = 1\n  ```\n\n> A quote:\n>\n> ```ts\n> let b = 2\n> ```\n\nAfter.\n' | doc code
for theme in claude-code vscode; do
  for row in 0 13.2 11.6331; do
    probe code $theme $row
    f="$tmp/code-$theme-$row.marks"
    # One button for each block (measure places no marks), and one line mark
    # for each code line.
    is "$f" 'print "t: ", scalar @t, "\n" if @t != 5; print "c: ", scalar @c, "\n" if @c != 6' "$theme row $row: the marks of 5 blocks and 6 lines"
    # The contract: kind copy, the whole code, the language when there is one, a size.
    is "$f" 'my @want = (["python", "print(\"hi\")\nx = 1\n"], [undef, "make test\n"], ["sh", undef], ["js", "const a = 1\n"], ["ts", "let b = 2\n"]);
      for my $i (0 .. 4) { my ($t, $l, $c) = ($t[$i], @{$want[$i]});
        print "$i kind\n" if $t->{kind} ne "copy";
        print "$i lang\n" if (defined $l ? ($t->{lang} // "") ne $l : exists $t->{lang});
        print "$i code\n" if defined $c and $t->{code} ne $c;
        print "$i size\n" if !($t->{w} > 0 and $t->{h} > 0) }' "$theme row $row: the t marks"
    # Order: the block's b mark, its button, then its lines.
    is "$f" 'my $s = join " ", map { $_->{k} eq "b" ? "b" . $_->{kind} : $_->{k} } grep { $_->{k} ne "w" } @m; my $n = () = $s =~ /bcode t c/g; print "$s\n" if $n != 5' "$theme row $row: b, then t, then c"
    # No word marks from the header (the language, Copy).
    is "$f" 'print join(" ", map { $_->{t} } grep { $_->{t} =~ /^(Copy|python|sh|js|ts)$/ } @w), "\n" if grep { $_->{t} =~ /^(Copy|python|sh|js|ts)$/ } @w' "$theme row $row: no word marks in the header"
    # Short code: a narrow block (the button's right edge far from the page's);
    # the long line: the block is as wide as the page.
    is "$f" 'print "short ", $t[0]{x} + $t[0]{w}, "\n" if $t[0]{x} + $t[0]{w} > 200; print "long ", $t[2]{x} + $t[2]{w}, "\n" if $t[2]{x} + $t[2]{w} < 400' "$theme row $row: the block width"
    if [ "$row" != 0 ]; then
      # The grid: the button is whole rows from the page's top (half a row
      # more in the half-row phase), as high as a code line's rows, and
      # each code line is the same rows below its button.
      is "$f" 'my $r = '"$row"'; my $top = $m[0]{y};
        for my $t (@t) { my $k = ($t->{y} - $top) / $r * 2; print "y $t->{y}\n" if abs($k - sprintf("%.0f", $k)) > 0.001;
          my $h = $t->{h} / $r; print "h $t->{h}\n" if abs($h - sprintf("%.0f", $h)) > 0.001 or $h < 1 }
        my %d = map { sprintf("%.3f", ($c[$_]{y} - $t[$_ > 1 ? $_ - 1 : 0]{y}) / $r - int(($c[$_]{y} - $t[$_ > 1 ? $_ - 1 : 0]{y}) / $r)) => 1 } (0, 2 .. 5);
        print "line phases: ", join(" ", keys %d), "\n" if keys %d != 1' "$theme row $row: the header and the lines on the grid"
    fi
  done
done

# A code block that a live drawing makes has no header: no button mark (and
# no other code marks: a drawing is scaled).
printf 'Text.\n\n```typst\n#raw("let a = 1", block: true, lang: "rust")\n```\n' | doc draw
probe draw claude-code 0
is "$tmp/draw-claude-code-0.marks" 'print join(" ", map { $_->{k} } grep { $_->{k} =~ /^[tc]$/ or ($_->{kind} // "") eq "code" } @m), "\n" if grep { $_->{k} =~ /^[tc]$/ or ($_->{kind} // "") eq "code" } @m' "no code marks in a drawing"

# PNGs to look at.
if [ -n "${IUI_CODE_OUT:-}" ]; then
  mkdir -p "$IUI_CODE_OUT"
  for row in 0 13.2; do
    # shellcheck disable=SC2046
    typst compile --root / --package-path "$here/render/packages" --format png --ppi 144 $(inputs code vscode "$row") "$here/render/md.typ" "$IUI_CODE_OUT/code-$row-{0p}.png" 2>/dev/null
  done
fi
echo "code-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
