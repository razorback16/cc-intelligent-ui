#!/bin/sh
# Release gate: the footprint that `claude plugin validate` reports is whole.
# The validator cuts a note at about 1,000 characters and marks the cut
# `[+N chars]`; the catalogue then can not read the footprint. Checks: no
# such mark in the text or the --json report, the `register.tsx calls:` line
# (the text after `calls: `) is 850 characters at most, and no `$.noun.method(`
# call is in hooks/ outside hooks/lib/api.ts and hooks/register.tsx.
# Usage: sh tests/footprint-sh-test.sh   (exit 0 when all pass; skips with no claude)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
max=850
pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

if ! command -v claude >/dev/null 2>&1; then
  echo "footprint-sh-test: skipped (no claude on PATH)"
  exit 0
fi

text=$(claude plugin validate "$here" 2>&1) && ok || bad "validate (text) failed"
json=$(claude plugin validate "$here" --json 2>&1) && ok || bad "validate (--json) failed"

# 1. No cut note in either report.
uncut() {
  cut=$(printf '%s\n' "$2" | perl -CS -ne 'print "$1\n" if /(.{0,40}\[\+\d+ chars?\])/' | head -n 1)
  [ -z "$cut" ] && ok || bad "the $1 report has a cut note: $cut"
}
uncut text "$text"
uncut --json "$json"

# 2. The calls line, in characters (not bytes). No line is a fail.
calls=$(printf '%s\n' "$text" | grep -E 'register\.tsx calls: ' | head -n 1)
if [ -z "$calls" ]; then
  bad "no 'register.tsx calls:' line in the report"
  length=0
else
  length=$(printf '%s' "${calls#*calls: }" | perl -CS -ne 'print length')
  [ "$length" -le "$max" ] && ok || bad "the calls line is $length characters, over $max"
fi

# 3. The engine calls only in api.ts and register.tsx (a comment line is no call).
others=$(cd "$here" && grep -rnE '\$\.[a-z]+\.[a-zA-Z]+(<[^(]*>)?\(' hooks | grep -vE '^hooks/(lib/api\.ts|register\.tsx):' | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//')
[ -z "$others" ] && ok || bad "engine calls outside hooks/lib/api.ts and hooks/register.tsx (add a wrapper to api.ts):
$others"

echo "footprint-sh-test: $pass passed, $fail failed (calls line $length/$max characters)"
[ "$fail" = 0 ]
