#!/bin/sh
# Runs the cache sweep (CACHE_SH in hooks/lib/env.ts) in sh, dash and bash:
# a cache folder that is a link is never used or changed (it is named, for
# /iui details); in a cache folder
# of this user, key folders of 2 days go and pkg-cache stays.
# Usage: sh tests/cache-sh-test.sh   (exit 0 when all pass)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-cache-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# The TypeScript text as sh: ${DESIGNS_KEPT_DAYS} as 30, the escapes undone.
cache_sh=$(perl -ne 'if (/^export const CACHE_SH = `(.*)`$/) { $_ = $1; s/(?<!\\)\$\{DESIGNS_KEPT_DAYS\}/30/g; s/\\\$/\$/g; s/\\\\/\\/g; print }' "$here/hooks/lib/env.ts")
[ -n "$cache_sh" ] && ok || bad "CACHE_SH: not found in env.ts"
uid=$(id -u)
shells=
for s in sh dash bash; do command -v "$s" >/dev/null 2>&1 && shells="$shells $s"; done
for s in $shells; do
  [ "$s" = bash ] && s='bash --posix'
  k=$(echo "$s" | tr -d ' -')
  # A link as the cache folder (to a folder of the victim): nothing there changes.
  td=$tmp/td-$k; v=$tmp/victim-$k
  mkdir -p "$td" "$v/old"; chmod 755 "$v"
  touch -t 202001010000 "$v/old"
  ln -s "$v" "$td/cc-intelligent-ui-$uid"
  out=$(TMPDIR=$td XDG_CACHE_HOME=$tmp/xdg-$k $s -c "$cache_sh")
  [ -z "$(echo "$out" | sed -n 1p)" ] && ok || bad "$s CACHE_SH: a linked cache folder was used ($out)"
  [ "$(echo "$out" | sed -n 2p)" = "$(uname -s)" ] && ok || bad "$s CACHE_SH: no OS name for a linked cache folder ($out)"
  [ "$(echo "$out" | sed -n 4p)" = "$td/cc-intelligent-ui-$uid" ] && ok || bad "$s CACHE_SH: the refused folder is not named ($out)"
  [ -d "$v/old" ] && case $(ls -ld "$v") in drwxr-xr-x*) true ;; *) false ;; esac && ok || bad "$s CACHE_SH: the link target changed"
  # A cache folder of this user: old key folders go, pkg-cache and new ones stay.
  td=$tmp/te-$k; d=$td/cc-intelligent-ui-$uid
  mkdir -p "$d/old" "$d/new" "$d/pkg-cache"
  touch -t 202001010000 "$d/old" "$d/pkg-cache"
  out=$(TMPDIR=$td XDG_CACHE_HOME=$tmp/xdg-$k $s -c "$cache_sh")
  [ "$(echo "$out" | sed -n 1p)" = "$d" ] && ok || bad "$s CACHE_SH: not the cache folder ($out)"
  [ ! -e "$d/old" ] && [ -d "$d/new" ] && [ -d "$d/pkg-cache" ] && ok || bad "$s CACHE_SH: the sweep is wrong ($(ls -A "$d" | tr '\n' ' '))"
  case $(ls -ld "$d") in drwx------*) ok ;; *) bad "$s CACHE_SH: the cache folder is not private" ;; esac
done

echo "cache-sh-test: $pass passed, $fail failed (shells:$shells)"
[ "$fail" = 0 ]
