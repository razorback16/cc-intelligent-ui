#!/bin/sh
# Runs the skill's compile check (skills/intelligent-ui/scripts/check.sh)
# with the real Typst: it refuses a cache folder that is a link, or whose
# check folder is one, and changes nothing there; a block reads no file
# outside its run folder (Typst's root), so its errors never print one; a
# good block still compiles.
# Usage: sh tests/check-sh-test.sh   (exit 0 when all pass; skips with no Typst 0.15)
set -u
here=$(cd "$(dirname "$0")/.." && pwd -P)
check=$here/skills/intelligent-ui/scripts/check.sh
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-check-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

case $(typst --version 2>/dev/null) in
  'typst 0.15.'*) ;;
  *) echo "check-sh-test: skipped (no Typst 0.15)"; exit 0 ;;
esac
uid=$(id -u)
block=$tmp/block.typ
printf '#rect(width: 2cm, height: 1cm, fill: theme.blue)\n' > "$block"

# A link as the cache folder (to a folder of the victim): refused, nothing there changes.
v=$tmp/victim
mkdir -p "$tmp/td" "$v"; chmod 755 "$v"
ln -s "$v" "$tmp/td/cc-intelligent-ui-$uid"
out=$(TMPDIR=$tmp/td bash "$check" --theme vscode --mode dark "$block" 2>&1)
[ $? = 2 ] && ok || bad "a linked cache folder: not exit 2 ($out)"
echo "$out" | grep -q "error: the cache folder $tmp/td/cc-intelligent-ui-$uid is a link" && ok || bad "a linked cache folder: no error ($out)"
[ -z "$(ls -A "$v")" ] && case $(ls -ld "$v") in drwxr-xr-x*) true ;; *) false ;; esac && ok || bad "a linked cache folder: the target changed"

# A check folder that is a link: refused too.
d=$tmp/te/cc-intelligent-ui-$uid
mkdir -p "$d" "$tmp/victim2"
ln -s "$tmp/victim2" "$d/check"
out=$(TMPDIR=$tmp/te bash "$check" --theme vscode --mode dark "$block" 2>&1)
[ $? = 2 ] && echo "$out" | grep -q "error: the folder $d/check is a link" && ok || bad "a linked check folder: not refused ($out)"
[ -z "$(ls -A "$tmp/victim2")" ] && ok || bad "a linked check folder: files made in its target"

# A cache folder of this user that others can open: made private, then used.
d=$tmp/tf/cc-intelligent-ui-$uid
mkdir -p "$d"; chmod 777 "$d"
out=$(TMPDIR=$tmp/tf bash "$check" --theme vscode --mode dark "$block" 2>&1)
[ $? = 0 ] && ok || bad "a good block: not exit 0 ($out)"
case $(ls -ld "$d") in drwx------*) ok ;; *) bad "the cache folder is not private: $(ls -ld "$d")" ;; esac
png=$(echo "$out" | sed -n 's/^ok dark //p')
[ -n "$png" ] && [ -f "$png" ] && ok || bad "a good block: no PNG ($out)"

# A block that reads a file: an error, and never the file's text.
echo 'SECRET-WORDS-42' > "$tmp/secret.txt"
# The words of /etc/hosts (9 letters or more), to find any part of it.
tr -cs '[:alnum:]' '\n' < /etc/hosts | awk 'length($0) >= 9' | sort -u > "$tmp/hosts.words"
for code in '#panic(read("/etc/hosts").slice(0, 60))' '#panic(read("/etc/hosts"))' "#panic(read(\"$tmp/secret.txt\"))" \
  "#include \"$tmp/secret.txt\"" '#panic(read("../../../../../../../../etc/hosts"))' "#image(\"$tmp/secret.txt\")"; do
  out=$(printf '%s\n' "$code" | TMPDIR=$tmp/tf bash "$check" --theme vscode --mode dark - 2>&1)
  st=$?
  if [ $st != 1 ]; then bad "$code: exit $st ($out)"
  elif echo "$out" | grep -q 'SECRET-WORDS'; then bad "$code: the secret file was printed"
  elif [ -s "$tmp/hosts.words" ] && echo "$out" | grep -qF -f "$tmp/hosts.words"; then bad "$code: /etc/hosts was printed"
  elif echo "$out" | grep -q 'file not found\|escape the project root'; then ok
  else bad "$code: $out"
  fi
done

echo "check-sh-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
