#!/bin/sh
# Renders render/md.typ with the real Typst in a terminal font that has no
# bold face (Monaco), with and without term-bold=0 (the fake bold): the
# flag changes a page with bold text, and does not change a page with no
# bold text or a page with no terminal font. A long bold word still wraps,
# and the probe's marks do not change (a show text rule would split them). It keeps the PNGs in
# $IUI_BOLD_OUT when that is set, to look at.
# Usage: sh tests/bold-sh-test.sh   (exit 0 when all pass; skips with no
# typst or no Monaco)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-bold-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

command -v typst >/dev/null 2>&1 || { echo "bold-sh-test: skipped (no typst)"; exit 0; }
typst fonts | grep -qx Monaco || { echo "bold-sh-test: skipped (Typst has no Monaco)"; exit 0; }
# Monaco has no bold face, so the hooks give the theme term-bold=0.
typst fonts --variants | sed -n '/^Monaco$/,/^[^ ]/p' | grep -q 'Weight: [6-9]00' && bad "Monaco has a bold face here"

# A doc JSON of one page of Markdown (argument 1) at $tmp/<name>.json.
doc() { perl -e 'local $/; my $m = <STDIN>; $m =~ s/(["\\])/\\$1/g; $m =~ s/\n/\\n/g; print "{\"base\": \"\", \"segments\": [\"$m\"]}"' > "$tmp/$1.json"; }
# Renders doc $1 in theme $2 (a warning for a font that is not installed is not a fail) with term-font $3 and the flag $4 (0 or 1) to $tmp/$1-$2-$4.png.
render() {
  typst compile "$here/render/md.typ" "$tmp/$1-$2-$4.png" --root / --ppi 144 --input theme=dark --input width=420 \
    --input "term-font=$3" --input "term-bold=$4" --input "theme-dir=$here/render/themes/$2" --input "doc=$tmp/$1.json" 2> "$tmp/err" \
    && ! grep -q '^error' "$tmp/err" && ok || bad "$1 in $2 ($3, term-bold=$4): $(head -3 "$tmp/err")"
}
same() { cmp -s "$tmp/$1-$2-0.png" "$tmp/$1-$2-1.png"; }

printf '## A heading\n\nText with **bold words**, a [**bold link**](https://x.y), *italic* and `code`.\n\n| Name | **Value** |\n|---|---|\n| a | **b** |\n' | doc bold
printf 'Text with *italic*, a [link](https://x.y) and `code`.\n\n```ts\nconst x = 1 // code\n```\n' | doc plain
for theme in claude-code vscode; do
  for b in 0 1; do render bold $theme Monaco $b; render plain $theme Monaco $b; done
  same bold $theme && bad "$theme: the fake bold does not change bold text" || ok
  same plain $theme && ok || bad "$theme: the fake bold changes a page with no bold text"
done
# A long bold word (cmarker splits it at each \_) and smart quotes: the
# probe's marks are the same with the flag (term-bold=0); with it the word
# can wrap, and don't is one mark.
printf 'A **aaaaaaaaaaaaaaaaaaaa\\_bbbbbbbbbbbbbbbbbbbbbbbb\\_cccccccccccccccccccccc**\n\n**Bold don'"'"'t a\\_b "q"**\n\n## Head don'"'"'t a\\_b\n' | doc long
for b in 0 1; do
  typst query --root / --input theme=dark --input width=300 --input term-font=Monaco --input "term-bold=$b" --input "theme-dir=$here/render/themes/claude-code" \
    --input "doc=$tmp/long.json" --input probe=1 "$here/render/md.typ" '<mdpos>' --field value > "$tmp/marks-$b.json" 2> "$tmp/err" || bad "probe, term-bold=$b: $(head -3 "$tmp/err")"
done
cmp -s "$tmp/marks-0.json" "$tmp/marks-1.json" && ok || bad "the fake bold changes the probe's marks"
# The long-word rule gives each letter of it a break chance (a mark of its own).
n=$(grep -o '"t":"a"' "$tmp/marks-0.json" | wc -l | tr -d ' ')
[ "$n" -ge 20 ] && ok || bad "the long bold word has no break chances ($n marks of its letters)"
grep -q '"t":"don'"'"'t"' "$tmp/marks-0.json" && ok || bad "a mark of don't is split"

# With no terminal font, the flag does nothing.
for b in 0 1; do
  typst compile "$here/render/md.typ" "$tmp/bold-none-$b.png" --root / --ppi 144 --input theme=dark --input width=420 \
    --input "term-bold=$b" --input "theme-dir=$here/render/themes/claude-code" --input "doc=$tmp/bold.json" 2>/dev/null && ok || bad "no terminal font, term-bold=$b: no page"
done
same bold none && ok || bad "with no terminal font the flag changes the page"

[ -n "${IUI_BOLD_OUT:-}" ] && mkdir -p "$IUI_BOLD_OUT" && cp "$tmp"/*.png "$IUI_BOLD_OUT"/
echo "bold-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
