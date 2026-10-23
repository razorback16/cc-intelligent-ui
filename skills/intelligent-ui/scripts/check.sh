#!/usr/bin/env bash
# Intelligent UI: compiles a ```typst block (or a Markdown answer) with the
# mod's own template (render/md.typ), its vendored packages and the active
# theme, in dark and light, and writes PNGs to look at with the Read tool.
#
#   check.sh [--theme NAME] [--mode dark|light|both] [--width PT] [--height PT] FILE
#
# FILE: a .typ file with one block body (no fences), a .md file with one or
# more ```typst blocks (compiled as one answer), or `-` (stdin, as .typ).
# Output, one line each: `using ...`, then per mode `ok <mode> <png>...` or
# `error <mode>` and its diagnostics (FILE:line:col: error: ...), then a hint.
# Exit 0: every mode compiled; 1: an error; 2: bad use or no Typst 0.15.
set -u

usage() {
  echo "usage: check.sh [--theme NAME] [--mode dark|light|both] [--width PT] [--height PT] FILE|-"
}

here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)
if [ ! -f "$root/render/md.typ" ]; then
  echo "error: no render/md.typ in $root (the plugin root)"
  exit 2
fi

theme_arg='' mode=both width='' height=''
while [ $# -gt 0 ]; do
  case $1 in
    --theme) theme_arg=${2-}; shift 2 || shift ;;
    --theme=*) theme_arg=${1#*=}; shift ;;
    --mode) mode=${2-}; shift 2 || shift ;;
    --mode=*) mode=${1#*=}; shift ;;
    --width) width=${2-}; shift 2 || shift ;;
    --width=*) width=${1#*=}; shift ;;
    --height) height=${2-}; shift 2 || shift ;;
    --height=*) height=${1#*=}; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -) break ;;
    -*) echo "error: unknown option $1"; usage; exit 2 ;;
    *) break ;;
  esac
done
if [ $# -ne 1 ]; then usage; exit 2; fi
file=$1
case $mode in
  dark|light) modes=$mode ;;
  both) modes='dark light' ;;
  *) echo "error: --mode must be dark, light or both"; exit 2 ;;
esac
is_pt() { printf '%s' "$1" | grep -Eq '^[0-9]+(\.[0-9]+)?$'; }
for v in "$width" "$height"; do
  if [ -n "$v" ] && ! is_pt "$v"; then echo "error: --width and --height are numbers in pt (got $v)"; exit 2; fi
done

# Typst: the PATH, else the mod's fallbacks (settings.ts TYPST_FALLBACKS).
typst=$(command -v typst 2>/dev/null || true)
if [ -z "$typst" ]; then
  for t in /opt/homebrew/bin/typst /usr/local/bin/typst /usr/bin/typst /snap/bin/typst "$HOME/.cargo/bin/typst" \
    "$HOME/.local/bin/typst" /home/linuxbrew/.linuxbrew/bin/typst "$HOME/.linuxbrew/bin/typst"; do
    if [ -x "$t" ]; then typst=$t; break; fi
  done
fi
if [ -z "$typst" ]; then
  echo "error: typst not found (the mod needs Typst 0.15: brew install typst, or cargo install --locked typst-cli)"
  exit 2
fi
version=$("$typst" --version 2>/dev/null | head -n 1)
case $version in
  'typst 0.15.'*) ;;
  *) echo "error: typst 0.15.x is needed, found ${version:-nothing} at $typst"; exit 2 ;;
esac

# The mod's cache root (docs/how-it-works.md step 6), private as the mod
# makes it (env.ts CACHE_SH): no link, and this user's. Runs older than a day go.
cache=${TMPDIR:-/tmp}
cache="${cache%/}/cc-intelligent-ui-$(id -u)"
private() { [ ! -L "$1" ] && [ -d "$1" ] && [ -O "$1" ]; }
mkdir "$cache" 2>/dev/null
if ! private "$cache" || ! chmod 700 "$cache"; then echo "error: the cache folder $cache is a link, not a folder, or not yours"; exit 2; fi
mkdir "$cache/check" 2>/dev/null
if ! private "$cache/check"; then echo "error: the folder $cache/check is a link, not a folder, or not yours"; exit 2; fi
find "$cache/check" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null
run=$(mktemp -d "$cache/check/run-XXXXXX") && run=$(cd "$run" && pwd -P) || { echo "error: can not make a folder in $cache/check"; exit 2; }

# The run folder is Typst's root, so a block reads no other file: render/
# has md.typ (copied: Typst wants its main file inside the root) and links
# to the rest of the template; theme is a link to the theme folder (below).
mkdir "$run/render" && ln -s "$root"/render/* "$run/render/" && rm "$run/render/md.typ" && cp "$root/render/md.typ" "$run/render/md.typ" \
  || { echo "error: can not make the template folder in $run"; exit 2; }

# The input, kept as src.typ or src.md in the run folder.
if [ "$file" = - ]; then
  kind=typ label=stdin base=$PWD
  cat > "$run/src.typ"
else
  if [ ! -f "$file" ]; then echo "error: no file $file"; exit 2; fi
  case $file in
    *.md|*.markdown|*.MD) kind=md ;;
    *) kind=typ ;;
  esac
  label=$file
  base=$(cd "$(dirname "$file")" && pwd -P)
  cp "$file" "$run/src.$kind"
fi
src="$run/src.$kind"

# The mod's store (`/iui theme`, `/iui grid`): the newest of its files.
config=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
store=$(ls -t "$config"/plugins/store/cc-intelligent-ui_*.json 2>/dev/null | head -n 1)
stored() { [ -n "$store" ] && grep -o "\"$1\"[[:space:]]*:[[:space:]]*[^,}]*" "$store" | head -n 1 | sed 's/^[^:]*:[[:space:]]*//; s/^"//; s/"[[:space:]]*$//'; }

# The theme: a user theme wins over a built-in one; else claude-code, else vscode (themes.ts).
theme_dir_of() {
  case $1 in
    */*) if [ -f "$1/theme.json" ]; then (cd "$1" && pwd -P); fi; return ;;
  esac
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$' || return
  for d in "$HOME/.claude/cc-intelligent-ui/themes/$1" "$root/render/themes/$1"; do
    if [ -f "$d/theme.json" ]; then printf '%s\n' "$d"; return; fi
  done
}
wanted=${theme_arg:-$(stored theme-name)}
wanted=${wanted:-claude-code}
theme_name=$wanted theme_note=''
theme_dir=$(theme_dir_of "$wanted")
for fallback in claude-code vscode; do
  [ -n "$theme_dir" ] && break
  theme_note="note: theme $wanted not found, using $fallback"
  theme_name=$fallback
  theme_dir=$(theme_dir_of "$fallback")
done

# The size: the newest design file (page width and room height in pt at the
# last first compile, designs.ts), else 900 x 320.
designs="${XDG_CACHE_HOME:-$HOME/.cache}/cc-intelligent-ui/designs"
design=$(ls -t "$designs"/*/* 2>/dev/null | head -n 1)
dw='' dh=''
if [ -n "$design" ]; then
  read -r dw dh _ < "$design" 2>/dev/null || true
  is_pt "${dw:-x}" && is_pt "${dh:-x}" || { dw=''; dh=''; }
fi
width=${width:-${dw:-900}}
height=${height:-${dh:-320}}

# The row grid (on unless `/iui grid off`): one terminal row in pt, from the
# newest page the mod drew (cell height x pt per pixel at the design width).
row=''
if [ "$(stored grid)" != false ] && [ -n "$dw" ]; then
  pages=$(ls -t "$cache"/*/pages.json 2>/dev/null | head -n 1)
  if [ -n "$pages" ]; then
    num() { grep -o "\"$1\":[0-9.]*" "$pages" | head -n 1 | cut -d: -f2; }
    row=$(awk -v w="$dw" -v pw="$(num width)" -v ph="$(num height)" -v r="$(num rows)" -v c="$(num columns)" 'BEGIN {
      if (pw > 0 && ph > 0 && r > 0 && c > 0 && w / c > 3 && w / c < 12) { v = w * ph / (r * pw); if (v > 6 && v < 40) printf "%.4f", v }
    }')
  fi
fi

echo "using theme=$theme_name width=$width height=$height row=${row:-off}"
[ -n "$theme_note" ] && echo "$theme_note"
ln -s "$theme_dir" "$run/theme" || { echo "error: can not link the theme folder in $run"; exit 2; }

# The doc JSON (as the mod writes it): a .typ body goes in a fence longer
# than any backtick run in it; Typst does the JSON escapes. No images are
# allowed (they are outside the root): they show as their alt text.
"$typst" eval --root "$run" --input "src=/src.$kind" --input "kind=$kind" --input "base=$base" '{
  let body = read(sys.inputs.src)
  let n = calc.max(3, ..body.matches(regex("`+")).map(m => m.text.len() + 1))
  let fence = "`" * n
  let md = if sys.inputs.kind == "typ" { fence + "typst\n" + body.trim("\n", at: end) + "\n" + fence + "\n" } else { body }
  (base: sys.inputs.base, segments: (md,), images: ())
}' > "$run/doc.json" 2> "$run/doc.log" || {
  echo "error: can not read $label (it must be UTF-8 text)"
  grep -v 'unknown font family' "$run/doc.log" | head -n 5
  exit 2
}
printf '{"base":"","segments":[""]}\n' > "$run/empty.json"

# Each live block alone (block-K.typ: the theme import, then its body), for
# diagnostics with lines in FILE; map.txt: K, the line before the body, indent.
shim='#import "/shim.typ": theme'
printf '#import "/render/md.typ": live-theme as theme\n' > "$run/shim.typ"
if [ $kind = typ ]; then
  { printf '%s\n' "$shim"; cat "$src"; } > "$run/block-1.typ"
  echo "1 0 0" > "$run/map.txt"
else
  awk -v dir="$run" -v shim="$shim" '
    function lead(s,  n) { n = 0; while (substr(s, n + 1, 1) == " ") n++; return n }
    {
      line = $0; sub(/\r$/, "", line)
      if (!inb) {
        if (match(line, /^ *(````*|~~~~*)/)) {
          ind = lead(line); mark = substr(line, ind + 1, RLENGTH - ind); info = substr(line, RLENGTH + 1)
          if (substr(mark, 1, 1) == "`" && index(info, "`")) next
          lang = info; sub(/^[ \t]+/, "", lang); sub(/[ \t{].*$/, "", lang); lang = tolower(lang)
          inb = 1; live = (lang == "typst" || lang == "typ")
          if (live) { k++; f = dir "/block-" k ".typ"; print shim > f; print k, NR, ind > (dir "/map.txt") }
        }
        next
      }
      if (match(line, /^ *(````*|~~~~*)[ \t]*$/)) {
        m = line; sub(/^ */, "", m); sub(/[ \t]*$/, "", m)
        if (substr(m, 1, 1) == substr(mark, 1, 1) && length(m) >= length(mark)) { if (live) close(f); inb = 0; next }
      }
      if (live) { n = lead(line); if (n > ind) n = ind; print substr(line, n + 1) > f }
    }
    END { if (live && inb) close(f) }
  ' "$src"
  [ -f "$run/map.txt" ] || { echo "note: $label has no \`\`\`typst block"; : > "$run/map.txt"; }
fi

# Runs typst in the run folder (short paths; its root) with the mod's env
# (typst.ts noNetworkEnv) and its 20 s limit; its output goes to file $1.
run_typst() {
  local out=$1 cmd=$2 pid dog status
  shift 2
  (cd "$run" && exec env HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
    https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 all_proxy=http://127.0.0.1:9 NO_PROXY= no_proxy= \
    TYPST_PACKAGE_CACHE_PATH="$cache/pkg-cache" "$typst" "$cmd" --root "$run" "$@") > "$out" 2>&1 &
  pid=$!
  # The watchdog stops its own sleep when it is stopped, so no process stays.
  (sleep 20 & s=$!; trap 'kill $s; exit 0' TERM; wait $s && kill "$pid" && echo "error: timed out after 20 s (an endless loop?)" >> "$out") \
    > /dev/null 2>&1 < /dev/null &
  dog=$!
  wait "$pid" 2> /dev/null
  status=$?
  kill "$dog" 2> /dev/null
  wait "$dog" 2> /dev/null
  return $status
}
inputs_of() {
  set -- --input "theme=$1" --input "theme-dir=/theme" --input "doc=$2" --input "width=$width" --input "height=$height"
  [ -n "$row" ] && set -- "$@" --input "row=$row" --input grid=1
  printf '%s\n' "$@"
}

# Diagnostics without font noise, with short paths.
clean() {
  grep -v 'unknown font family' "$1" | grep -v '^[[:space:]]*$' \
    | sed -e 's#[^ ]*/render/md\.typ:#md.typ:#g' -e 's#^render/md\.typ:#md.typ:#' -e "s#$run/##g"
}

# The diagnostics of each block alone, at lines of FILE; an error inside a
# package is put at its call site in the block ("in <place>"). Status 0 when
# a block failed.
block_errors() {
  m=$1 failed=1
  while read -r k start ind; do
    [ -n "$k" ] || continue
    old_ifs=$IFS; IFS='
'
    set -- $(inputs_of "$m" /empty.json)
    IFS=$old_ifs
    log="$run/diag-$m-$k.log"
    run_typst "$log" compile --package-path "$root/render/packages" --diagnostic-format short \
      "$@" "block-$k.typ" "diag-$m-$k.pdf" && continue
    failed=0
    first=$(clean "$log" | grep -m 1 'error:')
    at=''
    case $first in
      "block-$k.typ:"*|*'timed out'*|'') ;;
      *)
        run_typst "$run/trace-$m-$k.log" compile --package-path "$root/render/packages" --diagnostic-format human \
          "$@" "block-$k.typ" "diag-$m-$k.pdf"
        at=$(grep -o "block-$k\.typ:[0-9]*:[0-9]*" "$run/trace-$m-$k.log" | head -n 1)
        ;;
    esac
    clean "$log" | awk -v k="$k" -v s="$start" -v i="$ind" -v label="$label" -v at="$at" '
      function place(p) { split(p, a, ":"); return label ":" (s + a[2] - 1) ":" (a[3] + i) }
      {
        p = "block-" k ".typ:"
        if (index($0, p) == 1 && match($0, /^[^:]*:[0-9]+:[0-9]+/)) print place(substr($0, 1, RLENGTH)) substr($0, RLENGTH + 1)
        else if (at != "" && !done && index($0, "error:")) { done = 1; c = index($0, ": "); print place(at) substr($0, c) " (in " substr($0, 1, c - 1) ")" }
        else print "  " $0
      }'
  done < "$run/map.txt"
  return $failed
}

# The PNGs of a mode, in page order, each on the theme's background (the
# mod's PNGs are clear over the terminal); the clear one when that fails.
printf '#import "/render/theme.typ": C\n#page(width: auto, height: auto, margin: 0pt, fill: C.bg, image(sys.inputs.png))\n' > "$run/backdrop.typ"
pngs_of() {
  n=1 list=''
  while [ -f "$run/clear-$1-$n.png" ]; do
    out="$run/$1-$n.png"
    run_typst "$run/backdrop.log" compile --ppi 72 --input "png=/clear-$1-$n.png" --input "theme=$1" \
      --input "theme-dir=/theme" backdrop.typ "$out" || out="$run/clear-$1-$n.png"
    list="$list $out"; n=$((n + 1))
  done
  printf '%s' "${list# }"
}

all=0
for m in $modes; do
  old_ifs=$IFS; IFS='
'
  set -- $(inputs_of "$m" /doc.json)
  IFS=$old_ifs
  if run_typst "$run/$m.log" compile --package-path "$root/render/packages" --format png --diagnostic-format short \
    --ppi 144 "$@" render/md.typ "clear-$m-{p}.png"; then
    echo "ok $m $(pngs_of "$m")"
    clean "$run/$m.log" | sed 's/^/  /'
  else
    all=1
    echo "error $m"
    if grep -q 'timed out' "$run/$m.log"; then
      clean "$run/$m.log" | grep 'timed out'
    elif ! block_errors "$m"; then
      clean "$run/$m.log"
      echo "note: no block fails alone; the error comes from the Markdown or the page (#pagebreak, #set page, bad math)"
    fi
  fi
done
echo "hint: look at each PNG with the Read tool; a clean compile can still overlap, overflow or draw in invisible colours"
exit $all
