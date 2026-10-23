#!/bin/sh
# Makes the root of a compile with STAGE_SH (hooks/lib/typst.ts) in sh, dash
# and bash, and compiles render/md.typ in it with the real Typst, as the mod
# does: answer code reads no file outside the root (/etc/hosts, a file by its
# path, `..`, /dev/zero, a link named .png to a text file), while the
# template, the theme and the allowed images still load; the folder is
# private, a folder is never used twice, and nothing is made through a link.
# Usage: sh tests/root-sh-test.sh   (exit 0 when all pass; the compiles skip with no typst)
set -u
here=$(cd "$(dirname "$0")/.." && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-root-test.XXXXXX")
tmp=$(cd "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# The TypeScript array as sh: each '...' line, the escapes undone.
stage_sh=$(perl -e 'local $/; $_ = <STDIN>; /export const STAGE_SH = \[\n(.*?)\n\]\.join/s or exit 1;
  print join("\n", map { s/^\s*\x27//; s/\x27,?\s*$//; s/\\\\/\\/g; $_ } split /\n/, $1)' < "$here/hooks/lib/typst.ts")
[ -n "$stage_sh" ] && ok || bad "STAGE_SH: not found in typst.ts"

# The answer's folder: a picture, a link to it, a link named .png to a text
# file, a folder named .png; a secret text file and a theme of the user.
base=$tmp/base theme=$tmp/themes/mine secret=$tmp/secret.txt
mkdir -p "$base/dir.png" "$tmp/themes"
cp -R "$here/render/themes/claude-code" "$theme"
echo 'SECRET-WORDS-42' > "$secret"
if command -v typst >/dev/null 2>&1; then
  printf '#set page(width: 40pt, height: 20pt, fill: blue)\n' | typst compile -f png - "$base/pic.png"
else
  printf '\211PNG\r\n\032\n' > "$base/pic.png"
fi
ln -s pic.png "$base/ok.png"
ln -s "$secret" "$base/link.png"
touch "$tmp/marker"

shells=
for s in sh dash bash; do command -v "$s" >/dev/null 2>&1 && shells="$shells $s"; done
n=0
for s in $shells; do
  [ "$s" = bash ] && s='bash --posix'
  n=$((n + 1)); k=$tmp/cache/k$n; r=$k/r-1
  mkdir -p "$k"
  printf '{"doc":%s}' "$n" | $s -c "$stage_sh" sh "$r" "$here" "$k/doc.json" "$theme" \
    "$base/pic.png" "$base/ok.png" "$base/link.png" "$base/dir.png" "$here/render/themes/evil.png" "$theme/evil.png" \
    "$base/x/../evil.png" "relative.png" "$tmp/missing.png"
  [ $? = 0 ] && ok || bad "$s: STAGE_SH failed"
  case $(ls -ld "$r") in drwx------*) ok ;; *) bad "$s: the run folder is not private ($(ls -ld "$r"))" ;; esac
  [ -f "$r$here/render/md.typ" ] && [ ! -L "$r$here/render/md.typ" ] && cmp -s "$here/render/md.typ" "$r$here/render/md.typ" && ok || bad "$s: md.typ is not a copy"
  [ -L "$r$here/render/theme.typ" ] && [ -L "$r$here/render/themes" ] && ok || bad "$s: the rest of render/ is not linked"
  [ "$(cat "$r$k/doc.json")" = "{\"doc\":$n}" ] && ok || bad "$s: the doc JSON is not stdin"
  [ -L "$r$theme" ] && [ -f "$r$theme/theme.json" ] && ok || bad "$s: no theme link"
  [ -L "$r$base/pic.png" ] && [ -L "$r$base/ok.png" ] && ok || bad "$s: an allowed image is not linked"
  for no in "$base/link.png" "$base/dir.png" "$base/evil.png" "$base/x" "$tmp/missing.png" /relative.png "$theme/evil.png"; do
    [ ! -e "$r$no" ] && [ ! -L "$r$no" ] && ok || bad "$s: $no is in the root"
  done
  # Nothing is made through the links (in the plugin or the theme).
  [ -z "$(find "$here/render" "$theme" -newer "$tmp/marker" 2>/dev/null)" ] && ok || bad "$s: files made through a link: $(find "$here/render" "$theme" -newer "$tmp/marker")"
  # A folder that is there is never used again.
  printf '{}' | $s -c "$stage_sh" sh "$r" "$here" "$k/doc.json" "$theme" 2>/dev/null && bad "$s: an old folder was used again" || ok
  # A built-in theme is in render/ already: no link of its own.
  printf '{}' | $s -c "$stage_sh" sh "$k/r-2" "$here" "$k/doc.json" "$here/render/themes/vscode" && [ -f "$k/r-2$here/render/themes/vscode/theme.json" ] \
    && [ ! -L "$k/r-2$here/render/themes/vscode" ] && ok || bad "$s: a built-in theme"
done
[ -z "$(find "$here/render" -newer "$tmp/marker" 2>/dev/null)" ] && ok || bad "files made in render/"

if ! command -v typst >/dev/null 2>&1; then
  echo "root-sh-test: $pass passed, $fail failed (compiles skipped: no typst)"
  [ "$fail" = 0 ]; exit
fi

# Compiles Markdown $2 (with base, images $3...) as the mod does, in a new
# root; the errors in $tmp/err. A run longer than 20 s is stopped.
runs=0
compile() {
  name=$1 md=$2
  shift 2
  runs=$((runs + 1)); k=$tmp/cache/c$runs
  mkdir -p "$k"
  printf '%s' "$md" | perl -e 'my ($b, @i) = @ARGV; local $/; my $m = <STDIN>; my $q = sub { my $s = shift; $s =~ s/(["\\])/\\$1/g; $s =~ s/\n/\\n/g; "\"$s\"" };
    print "{\"base\": ", $q->($b), ", \"segments\": [", $q->($m), "], \"images\": [", join(", ", map { $q->($_) } @i), "]}"' "$base" "$@" \
    | sh -c "$stage_sh" sh "$k/r" "$here" "$k/doc.json" "$theme" $(i=0; for p; do i=$((i + 1)); [ $((i % 2)) = 0 ] && echo "$p"; done) \
    || { bad "$name: STAGE_SH failed"; return 1; }
  perl -e 'alarm 20; exec @ARGV' typst compile --root "$k/r" --package-path "$here/render/packages" --input theme=dark --input width=400 \
    --input "theme-dir=$theme" --input "doc=$k/doc.json" "$k/r$here/render/md.typ" "$tmp/$name.png" > "$tmp/err" 2>&1
}

# The mod's own answer: a picture by a relative path, one by its link and by
# its full path, math, a table, a diagram, a code block.
answer='# Title

A picture ![p](pic.png), its link ![o](ok.png) and ![f](BASE/pic.png).

Math $e^(i pi) + 1 = 0$ and $$\int_0^1 x^2 dx$$

| a | b |
|---|--:|
| 1 | 22 |

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#diagram(node-stroke: theme.fg, node((0, 0), [A]), edge("-|>"), node((1, 0), [B]))
```

```python
print("hi")
```'
answer=$(printf '%s' "$answer" | sed "s#BASE#$base#")
compile answer "$answer" pic.png "$base/pic.png" ok.png "$base/ok.png" "$base/pic.png" "$base/pic.png" \
  && ok || bad "an answer with pictures, math, a table and a diagram: $(head -n 3 "$tmp/err")"
compile allowed '```typst
#image("'"$base"'/pic.png", width: 1cm) #read("'"$base"'/pic.png", encoding: none).len()
```' pic.png "$base/pic.png" && ok || bad "an allowed image read by a block: $(head -n 3 "$tmp/err")"

# A block that reads a file outside the root fails (the mod then shows it
# as code), and says why: not found, or out of the root.
for code in \
  '#read("/etc/hosts")' '#include "/etc/hosts"' '#import "/etc/hosts"' '#image("/etc/hosts")' '#json("/etc/hosts")' '#csv("/etc/hosts")' \
  "#read(\"$secret\")" "#include \"$secret\"" "#csv(\"$secret\")" '#read("../../../../../../../../../../etc/hosts")' \
  "#read(\"$here/render/../../../../../../../../etc/hosts\")" "#read(\"$theme/../../secret.txt\")" '#read("/dev/zero").len()' \
  "#read(\"$base/link.png\")" "#image(\"$base/link.png\")" "#read(\"$base/dir.png/../../secret.txt\")"; do
  md=$(printf 'Text.\n\n```typst\n%s\n```\n' "$code")
  if compile attack "$md" pic.png "$base/pic.png" link.png "$base/link.png"; then
    bad "$code: compiled"
  elif grep -q 'file not found\|escape the project root' "$tmp/err" && ! grep -q 'SECRET-WORDS\|localhost' "$tmp/err"; then ok
  else bad "$code: $(head -n 3 "$tmp/err")"
  fi
done
# The same block with the root at / (as before) reads the file: the test is real.
compile wide "$(printf 'Text.\n\n```typst\n#read("%s")\n```\n' "$secret")" && bad "a read of the secret compiled" || ok
typst compile --root / --package-path "$here/render/packages" --input theme=dark --input width=400 --input "theme-dir=$theme" \
  --input "doc=$tmp/cache/c$runs/r$tmp/cache/c$runs/doc.json" "$here/render/md.typ" "$tmp/old.png" > /dev/null 2>&1 \
  && ok || bad "with the root at /, a read of the secret did not compile (the test shows nothing)"

echo "root-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
