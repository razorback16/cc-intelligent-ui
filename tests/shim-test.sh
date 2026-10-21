#!/bin/sh
# Runs the clipboard shims (hooks/clip-shim.sh) against fake tools and a fake
# mod (the reader of the ask FIFO), on macOS and Linux: what counts as a
# clipboard write, the ask for picture cells and its limits, the bytes and
# arguments the real tool gets, the exit status, and no recursion. Then the
# setup script (hooks/clip-shim-setup.sh) and the cache sweep (CACHE_SH).
# Usage: sh tests/shim-test.sh   (also dash, bash --posix; exit 0 when all pass)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
template=$here/hooks/clip-shim.sh
tmp=$(mktemp -d "${TMPDIR:-/tmp}/iui-shim-test.XXXXXX")
mod=
trap '[ -z "$mod" ] || kill "$mod" 2>/dev/null; rm -rf "$tmp"' EXIT
real=$tmp/real
shims=$tmp/shims
log=$tmp/log
bin=$tmp/bin
stub=$tmp/stub
c=$tmp/c
mkdir -p "$real" "$shims" "$log" "$bin" "$stub" "$c/ask"
chmod 700 "$c" "$c/ask"
# The mod's FIFO. `launch` names it for its own pid while a shim runs.
fifo=$c/ask-mod
mkfifo -m 600 "$fifo"
pass=0
fail=0

ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# The tools the shims and the fake tools use, with no perl among them.
for t in sh dash bash cat grep rm mv ln chmod basename dirname env sleep cp mkdir ls kill sed; do
  p=$(command -v "$t") && ln -s "$p" "$bin/$t"
done
perl=$(command -v perl)
# A perl that notes each run, then runs the real one (the shims' @PERL@).
printf '#!/bin/sh\necho run >>"%s/perl.runs"\nexec "%s" "$@"\n' "$log" "$perl" >"$stub/perl"
chmod 755 "$stub/perl"
P=$shims:$real:$bin

# The fake real tools: they keep their arguments (one per line) and their
# stdin, then exit with $FAKE_EXIT or die of $FAKE_SIG.
for t in pbcopy wl-copy xclip xsel; do
  cat >"$real/$t" <<EOF
#!/bin/sh
l='$log'/\$(basename "\$0")
printf '%s\n' "\$@" >"\$l.args"
cat >"\$l.in"
[ -z "\${FAKE_SIG:-}" ] || kill -"\$FAKE_SIG" \$\$
exit "\${FAKE_EXIT:-0}"
EOF
  chmod 755 "$real/$t"
done
# make_shim <folder> <tool> <perl>: the shim as the mod writes it (each value quoted for sh).
make_shim() {
  sed -e "s|@TOOL@|'$2'|" -e "s|@REAL@|'$real/$2'|" -e "s|@DIR@|'$1'|" -e "s|@PERL@|'$3'|" "$template" >"$1/$2"
  chmod 755 "$1/$2"
}
for t in pbcopy wl-copy xclip xsel; do make_shim "$shims" "$t" "$stub/perl"; done

# The fake mod: reads ids from the FIFO (open to read and write, as the real
# reader), notes them, and answers after $2 seconds ("ANSWER for N bytes",
# or nothing with $4 = empty): a temp file, then a link. A link that fails
# meets the shim's mark: then it notes `late <id>`, and the files go.
cat >"$tmp/mod.pl" <<'EOF'
use Time::HiRes ();
my ($fifo, $wait, $log, $kind) = @ARGV;
open(my $f, "+<", $fifo) or die "fifo: $!";
(my $dir = $fifo) =~ s{/[^/]*$}{/ask};
$| = 1;
while (my $id = <$f>) {
  chomp $id;
  open(my $n, ">>", "$log/mod.ids"); print $n "$id\n"; close $n;
  open(my $r, "<:raw", "$dir/$id") or next;
  my $raw = do { local $/; <$r> }; close $r;
  Time::HiRes::sleep($wait);
  open(my $w, ">:raw", "$dir/$id.answer.tmp");
  print $w "ANSWER for " . length($raw) . " bytes" unless ($kind // "") eq "empty";
  close $w;
  if (!link("$dir/$id.answer.tmp", "$dir/$id.answer")) {
    unlink "$dir/$id", "$dir/$id.answer";
    open(my $l, ">>", "$log/mod.late"); print $l "late $id\n"; close $l;
  }
  unlink "$dir/$id.answer.tmp";
}
EOF
start_mod() {
  stop_mod
  "$perl" "$tmp/mod.pl" "$fifo" "$1" "$log" "${2:-}" &
  mod=$!
  # Until it has the FIFO open (a writer's open then works).
  n=0
  while [ "$n" -lt 100 ]; do
    "$perl" -MFcntl -e 'sysopen(my $f, $ARGV[0], O_WRONLY | O_NONBLOCK) or exit 1' "$fifo" && return
    n=$((n + 1)); sleep 0.05 2>/dev/null || sleep 1
  done
}
stop_mod() {
  [ -z "$mod" ] || { kill "$mod" 2>/dev/null; wait "$mod" 2>/dev/null; }
  mod=
}
now() { "$perl" -MTime::HiRes=time -e 'printf "%.3f", time'; }
# The seconds from $1 to now, under $2: true or false.
under() { "$perl" -MTime::HiRes=time -e 'exit(time - $ARGV[0] < $ARGV[1] ? 0 : 1)' "$1" "$2"; }

# launch <ask> <cmd>...: runs <cmd> as a child of this shell (as Claude Code
# runs the tool), with IUI_COPY_ASK=<ask>, PID in it replaced by this pid.
# LAUNCH (default fifo) puts there the mod's FIFO, a file, a link to it, or
# nothing; LAUNCH_DEEP=1 runs <cmd> one shell further down (not a child).
cat >"$tmp/launch" <<EOF
#!/bin/sh
a=\$(printf '%s' "\$1" | sed "s/PID/\$\$/"); shift
case \${LAUNCH:-fifo} in
  fifo) mv '$fifo' "\$a" ;;
  file) : >"\$a" ;;
  link) ln -s '$fifo' "\$a" ;;
esac
IUI_COPY_ASK=\$a; export IUI_COPY_ASK
if [ -n "\${LAUNCH_DEEP:-}" ]; then sh -c '"\$@"; exit \$?' sh "\$@"; else "\$@"; fi
r=\$?
case \${LAUNCH:-fifo} in
  fifo) mv "\$a" '$fifo' ;;
  file|link) rm -f "\$a" ;;
esac
exit \$r
EOF
chmod 755 "$tmp/launch"
L=$tmp/launch

input=$tmp/input
cells=$tmp/cells
answer=$tmp/answer
printf 'Copy test\nThe quick brown fox jumps' >"$input"
# Two picture cells (U+10EEEE, a row and a column diacritic) between text.
printf 'Copy \364\216\273\256\314\205\314\205\364\216\273\256\314\205\314\215 test\n' >"$cells"
printf 'ANSWER for %s bytes' "$(wc -c <"$cells" | tr -d ' ')" >"$answer"

# The ask folder has nothing left: no request, answer or mark.
clean() { [ -z "$(ls -A "$c/ask")" ] && ok || { bad "$1: files left in ask/: $(ls -A "$c/ask" | tr '\n' ' ')"; rm -f "$c/ask"/*; }; }
reset_log() { rm -f "$log"/*.args "$log"/*.in "$log/perl.runs" "$log/mod.ids" "$log/mod.late"; }

# run <shell> <file> <tool> [args...]: the shim with <file> on stdin, as
# Claude Code's exec finds it (on PATH $P, shim folder first), with the ask.
run() {
  sh_=$1 in_=$2 tool=$3
  shift 3
  reset_log
  if [ "$sh_" = exec ]; then
    PATH=$P "$L" "$c/ask-PID" "$tool" "$@" <"$in_"
  elif [ "$sh_" = bash ]; then
    PATH=$P "$L" "$c/ask-PID" bash --posix "$shims/$tool" "$@" <"$in_"
  else
    PATH=$P "$L" "$c/ask-PID" "$sh_" "$shims/$tool" "$@" <"$in_"
  fi
}

# check <shell> <write 0|1> <tool> [args...]: a write runs perl once, and
# picture cells get the mod's answer; plain text, and any other call, pass
# as they are (no perl for another call). The same arguments and exit
# status each time, and nothing left in ask/.
check() {
  sh_=$1 want=$2 tool=$3
  shift 3
  printf '%s\n' "$@" >"$tmp/want.args"
  code=${FAKE_EXIT:-0}
  what="$sh_ $tool $*"
  for kind in plain cells; do
    if [ "$kind" = plain ]; then in_=$input; else in_=$cells; fi
    run "$sh_" "$in_" "$tool" "$@"
    got=$?
    [ "$got" = "$code" ] && ok || bad "$what ($kind): exit $got, not $code"
    cmp -s "$log/$tool.args" "$tmp/want.args" && ok || bad "$what ($kind): the real tool did not get the same arguments"
    if [ "$kind" = cells ] && [ "$want" = 1 ]; then
      cmp -s "$log/$tool.in" "$answer" && ok || bad "$what: the real tool did not get the answer ($(cat "$log/$tool.in"))"
    else
      cmp -s "$log/$tool.in" "$in_" && ok || bad "$what ($kind): the real tool did not get the same stdin"
    fi
    if [ "$want" = 1 ]; then
      [ "$(cat "$log/perl.runs" 2>/dev/null)" = run ] && ok || bad "$what ($kind): not one perl run"
    else
      [ ! -e "$log/perl.runs" ] && ok || bad "$what ($kind): perl ran"
    fi
    clean "$what ($kind)"
  done
}

shells=exec
for s in sh dash bash; do command -v "$s" >/dev/null 2>&1 && shells="$shells $s"; done

start_mod 0
for s in $shells; do
  # pbcopy: a write of the general pasteboard.
  check "$s" 1 pbcopy
  check "$s" 1 pbcopy -pboard general
  check "$s" 0 pbcopy -pboard find
  check "$s" 0 pbcopy -help
  # wl-copy: a write of text unless primary, clear, or text in the arguments.
  check "$s" 1 wl-copy
  check "$s" 1 wl-copy -n --type 'text/plain;charset=utf-8'
  check "$s" 1 wl-copy --type=text/plain
  check "$s" 1 wl-copy -t UTF8_STRING
  check "$s" 0 wl-copy -t image/png
  check "$s" 0 wl-copy --type=image/png
  check "$s" 0 wl-copy --primary
  check "$s" 0 wl-copy -p
  check "$s" 0 wl-copy --clear
  check "$s" 0 wl-copy hello
  # xclip: input mode and the clipboard selection (its default is primary).
  check "$s" 1 xclip -selection clipboard
  check "$s" 1 xclip -sel c
  check "$s" 1 xclip -i -selection clipboard -t text/plain
  check "$s" 1 xclip -selection clipboard -target STRING
  check "$s" 0 xclip -selection clipboard -t image/png
  check "$s" 0 xclip -selection clipboard -target text/html
  check "$s" 0 xclip -selection primary
  check "$s" 0 xclip
  check "$s" 0 xclip -selection clipboard -o
  check "$s" 0 xclip -selection clipboard -t text/plain -o
  check "$s" 0 xclip -selection clipboard -t TARGETS -o
  check "$s" 0 xclip -selection clipboard -t image/png -o
  check "$s" 0 xclip -selection clipboard file.txt
  # xsel: input (or append) and the clipboard.
  check "$s" 1 xsel --clipboard --input
  check "$s" 1 xsel -bi
  check "$s" 1 xsel -b -i
  check "$s" 0 xsel --primary --input
  check "$s" 0 xsel --clipboard --output
  check "$s" 0 xsel -bo
  check "$s" 0 xsel --clipboard
  check "$s" 0 xsel
done

# The exit status of the real tool, for a write and for a read, each tool.
for t in pbcopy wl-copy; do FAKE_EXIT=3 check exec 1 "$t"; done
FAKE_EXIT=3 check dash 1 xclip -selection clipboard
FAKE_EXIT=3 check sh 1 xsel -bi
FAKE_EXIT=4 check exec 0 xclip -selection clipboard -o
# (An assignment before a function call stays in some shells.)
unset FAKE_EXIT

# A real tool that a signal ends: the same signal status (128 + n), with
# perl (a write) and with no perl (a read).
for a in "1 pbcopy" "0 xsel -bo"; do
  for kind in plain cells; do
    if [ "$kind" = plain ]; then in_=$input; else in_=$cells; fi
    set -- $a
    FAKE_SIG=TERM run dash "$in_" $2 ${3:-} 2>/dev/null
    got=$?
    [ "$got" = 143 ] && ok || bad "signal ($2 $kind): exit $got, not 143"
    clean "signal ($2 $kind)"
  done
done
unset FAKE_SIG
# The same signal itself, not only its status, for its parent.
for t in pbcopy "xsel -bo"; do
  reset_log
  FAKE_SIG=TERM PATH=$P "$perl" -e 'my ($f, @cmd) = @ARGV; (my $a = $f) =~ s/-mod$/-$$/; rename $f, $a; $ENV{IUI_COPY_ASK} = $a; system(@cmd); my $s = $?; rename $a, $f; exit(($s & 127) == 15 ? 0 : 1)' "$fifo" $t <"$cells"
  [ $? = 0 ] && ok || bad "signal ($t): its parent did not see SIGTERM"
  clean "signal itself ($t)"
done

# A binary type passes untouched: all bytes, no ask.
printf '\211PNG\r\n\032\n\364\216\273\256\000\377' >"$tmp/png"
run exec "$tmp/png" wl-copy -t image/png
cmp -s "$log/wl-copy.in" "$tmp/png" && [ ! -e "$log/mod.ids" ] && [ ! -e "$log/perl.runs" ] && ok || bad "image/png: not all bytes untouched"

# 4 MiB of any bytes (the limit), text with no last line break, and none.
dd if=/dev/urandom of="$tmp/big" bs=1024 count=4096 2>/dev/null
for f in big: nolf:no\ line\ break empty:; do
  name=${f%%:*}
  [ "$name" = big ] || printf '%s' "${f#*:}" >"$tmp/$name"
  run exec "$tmp/$name" xsel -bi
  cmp -s "$log/xsel.in" "$tmp/$name" && ok || bad "$name input: the text did not pass"
  clean "$name input"
done
# Picture cells in more than 4 MiB: no ask, all bytes pass (also after the
# first 4 MiB); exactly 4 MiB with cells: asked.
{ cat "$cells"; cat "$tmp/big"; } >"$tmp/big5"
run exec "$tmp/big5" pbcopy
cmp -s "$log/pbcopy.in" "$tmp/big5" && [ ! -e "$log/mod.ids" ] && ok || bad "over 4 MiB: not all bytes, or asked"
clean "over 4 MiB"
{ cat "$cells"; head -c $((4194304 - $(wc -c <"$cells"))) "$tmp/big"; } >"$tmp/big4"
run exec "$tmp/big4" pbcopy
[ -s "$log/mod.ids" ] && ok || bad "4 MiB with cells: not asked"
clean "4 MiB with cells"

# An empty answer (the mod has no text): the shim's own cells.
start_mod 0 empty
run sh "$cells" pbcopy
cmp -s "$log/pbcopy.in" "$cells" && [ -s "$log/mod.ids" ] && ok || bad "empty answer: not the cells"
clean "empty answer"
start_mod 0

# Not a direct child of the FIFO's process: no ask, no perl, the cells.
reset_log
PATH=$P LAUNCH_DEEP=1 "$L" "$c/ask-PID" pbcopy <"$cells"
got=$?
[ "$got" = 0 ] && cmp -s "$log/pbcopy.in" "$cells" && [ ! -e "$log/perl.runs" ] && [ ! -e "$log/mod.ids" ] && ok || bad "not a child: asked, or not the cells ($got)"
clean "not a child"

# IUI_COPY_ASK not set, or not a FIFO path: the cells pass, no perl.
for a in '' "$c/foo" "$c/ask-x1"; do
  reset_log
  PATH=$P LAUNCH=none "$L" "$a" pbcopy <"$cells"
  cmp -s "$log/pbcopy.in" "$cells" && [ ! -e "$log/perl.runs" ] && ok || bad "IUI_COPY_ASK '$a': the cells did not pass as they are"
done

# No reader (the mod stopped): the cells at once.
stop_mod
t0=$(now)
run exec "$cells" pbcopy
under "$t0" 0.3 && ok || bad "no reader: the shim waited"
cmp -s "$log/pbcopy.in" "$cells" && ok || bad "no reader: not the cells"
clean "no reader"

# A slow mod (1.8 s): the cells after the limit (1.5 s), well before Claude
# Code's 2 s. The late answer meets the shim's mark, and the files go.
start_mod 1.8
t0=$(now)
run dash "$cells" xclip -selection clipboard
under "$t0" 1.4 && bad "slow mod: the shim did not wait for the answer" || ok
under "$t0" 2 && ok || bad "slow mod: the shim took 2 s or more"
cmp -s "$log/xclip.in" "$cells" && ok || bad "slow mod: not the cells"
n=0
while [ ! -s "$log/mod.late" ] && [ "$n" -lt 40 ]; do sleep 0.1 2>/dev/null || sleep 1; n=$((n + 1)); done
grep -q "^late " "$log/mod.late" 2>/dev/null && ok || bad "slow mod: its answer was not refused"
clean "slow mod"
stop_mod

# No perl (the shim's perl is not there): the cells, the exit status.
start_mod 0
mkdir -p "$tmp/noperl"
make_shim "$tmp/noperl" pbcopy "$tmp/no/perl"
for s in exec sh; do
  reset_log
  if [ "$s" = exec ]; then
    PATH=$tmp/noperl:$real:$bin FAKE_EXIT=5 "$L" "$c/ask-PID" pbcopy <"$cells"
  else
    PATH=$tmp/noperl:$real:$bin FAKE_EXIT=5 "$L" "$c/ask-PID" sh "$tmp/noperl/pbcopy" <"$cells"
  fi
  got=$?
  [ "$got" = 5 ] && ok || bad "$s no perl: exit $got, not 5"
  cmp -s "$log/pbcopy.in" "$cells" && [ ! -e "$log/mod.ids" ] && ok || bad "$s no perl: not the cells"
  clean "$s no perl"
done

# A FIFO that is a regular file, or a link to the mod's FIFO: the cells, and
# the file is not written, the mod gets no id.
for kind in file link; do
  reset_log
  PATH=$P LAUNCH=$kind "$L" "$c/ask-PID" wl-copy <"$cells"
  cmp -s "$log/wl-copy.in" "$cells" && ok || bad "a $kind as the FIFO: not the cells"
  [ ! -e "$log/mod.ids" ] && ok || bad "a $kind as the FIFO: the mod got an id"
  clean "a $kind as the FIFO"
done

# An ask folder that is a link, or not this user's (root's /usr): no ask,
# the cells as they are.
mkdir -p "$tmp/l"; ln -s "$c/ask" "$tmp/l/ask"
for a in "fifo $tmp/l/ask-PID" "none /usr/ask-PID"; do
  reset_log
  PATH=$P LAUNCH=${a%% *} "$L" "${a#* }" pbcopy <"$cells"
  cmp -s "$log/pbcopy.in" "$cells" && [ ! -e "$log/mod.ids" ] && ok || bad "ask folder of ${a#* }: not the cells as they are"
done
clean "ask folder links"

# The request can not be written (ask/ read-only): all of the text, and the
# exit status.
if [ "$(id -u)" != 0 ]; then
  chmod 500 "$c/ask"
  for s in exec dash; do
    reset_log
    if [ "$s" = exec ]; then
      PATH=$P FAKE_EXIT=6 "$L" "$c/ask-PID" xsel -bi <"$cells"
    else
      PATH=$P FAKE_EXIT=6 "$L" "$c/ask-PID" dash "$shims/xsel" -bi <"$cells"
    fi
    got=$?
    [ "$got" = 6 ] && ok || bad "$s read-only ask/: exit $got, not 6"
    cmp -s "$log/xsel.in" "$cells" && [ ! -e "$log/mod.ids" ] && ok || bad "$s read-only ask/: the text did not pass"
  done
  chmod 700 "$c/ask"
fi
stop_mod

# The real tool moved: found on PATH without the shim folder, still asked.
start_mod 0
mv "$real" "$tmp/moved"
reset_log
PATH=$shims:$tmp/moved:$bin "$L" "$c/ask-PID" xclip -selection clipboard <"$cells"
got=$?
[ "$got" = 0 ] && ok || bad "a moved tool: exit $got"
cmp -s "$log/xclip.in" "$answer" && ok || bad "a moved tool: not the answer"
clean "a moved tool"
stop_mod

# No real tool, and the shim folder on PATH again in another spelling: the
# shim stops (127), it never runs itself in a loop; also through perl.
for a in none fifo; do
  start_mod 0
  out=$(PATH="$shims:$tmp/./shims:$bin" LAUNCH=$a "$L" "$c/ask-PID" xsel -bi <"$input" 2>&1)
  got=$?
  [ "$got" = 127 ] && ok || bad "no real tool ($a): exit $got, not 127 ($out)"
  stop_mod
done
mv "$tmp/moved" "$real"

# ---- The setup script: only a private folder of this user gets shims ----
# Each call runs as a child of this shell, so the pid it prints is $$.
setup=$here/hooks/clip-shim-setup.sh
sleep 60 &
other=$!
for s in $shells; do
  [ "$s" = exec ] && continue
  [ "$s" = bash ] && s='bash --posix'
  k=$(echo "$s" | tr -d ' -')
  d=$tmp/cache-$k
  m=$d/shims-$$
  mkdir -p "$d/shims" "$d/shims-$other"
  # Shims of another process (and an old shims folder) on PATH: found outside them.
  cp "$shims/pbcopy" "$d/shims/pbcopy"
  cp "$shims/pbcopy" "$d/shims-$other/pbcopy"
  PATH="$d/shims-$other:$d/shims:$real:/usr/bin:/bin" $s "$setup" find "$d" pbcopy xclip nosuchtool >"$tmp/out"
  [ $? = 0 ] && ok || bad "$s setup find: a private folder fails"
  out=$(cat "$tmp/out")
  echo "$out" | grep -qx "pid $$" && ok || bad "$s setup find: not the pid of its parent ($out)"
  echo "$out" | grep -qx "pbcopy $real/pbcopy" && ok || bad "$s setup find: pbcopy not found outside the shim folders ($out)"
  echo "$out" | grep -q nosuchtool && bad "$s setup find: a tool that is not there" || ok
  echo "$out" | grep -q '^perl /' && ok || bad "$s setup find: no perl line"
  [ -d "$m" ] && [ ! -L "$m" ] && ok || bad "$s setup find: no shims folder of the pid"
  case $(ls -ld "$m") in drwx------*) ok ;; *) bad "$s setup find: shims folder not 700" ;; esac
  # The ask folder (700) and the FIFO of the pid (600).
  echo "$out" | grep -qx "ask $d/ask-$$" && ok || bad "$s setup find: no ask line ($out)"
  case $(ls -ld "$d/ask") in drwx------*) ok ;; *) bad "$s setup find: ask folder not 700" ;; esac
  case $(ls -l "$d/ask-$$") in prw-------*) ok ;; *) bad "$s setup find: the FIFO is not a FIFO of mode 600" ;; esac
  rm -f "$d/ask-$$"
  # A file or a link in the FIFO's place (the parent's pid): a new FIFO, the target stays.
  for kind in file link; do
    printf 'keep' >"$tmp/target"
    out=$($s -c 'if [ "$1" = file ]; then printf x >"$2/ask-$$"; else ln -s "$3" "$2/ask-$$"; fi; shift 3; "$@"; :' \
      sh "$kind" "$d" "$tmp/target" $s "$setup" find "$d" pbcopy)
    p2=$(echo "$out" | sed -n 's/^pid \([0-9][0-9]*\)$/\1/p')
    [ -n "$p2" ] && [ -p "$d/ask-$p2" ] && [ ! -L "$d/ask-$p2" ] && echo "$out" | grep -qx "ask $d/ask-$p2" && ok || bad "$s setup find: no new FIFO for a $kind ($out)"
    [ "$(cat "$tmp/target")" = keep ] && ok || bad "$s setup find: the link target changed"
    rm -rf "$d/ask-$p2" "$d/shims-$p2"
  done
  # An ask folder that is a link: no ask line, the shims still set up.
  c5=$tmp/c5-$k; mkdir -p "$c5" "$tmp/other5-$k"; ln -s "$tmp/other5-$k" "$c5/ask"
  $s "$setup" find "$c5" pbcopy >"$tmp/out"; got=$?
  [ "$got" = 0 ] && ! grep -q '^ask ' "$tmp/out" && ok || bad "$s setup find: an ask link gives $got ($(cat "$tmp/out"))"
  # Install: a new shim takes its place, executable; `-file` removes one.
  printf 'x' >"$m/xclip.new-1"
  printf 'y' >"$m/xsel"
  $s "$setup" install "$d" .new-1 "$m/xclip" "-$m/xsel"
  [ $? = 0 ] && [ -x "$m/xclip" ] && [ ! -e "$m/xclip.new-1" ] && [ ! -e "$m/xsel" ] && ok || bad "$s setup install"
  # The shims of another process: never installed or removed by this one.
  printf 'z' >"$d/shims-$other/xclip.new-1"
  $s "$setup" install "$d" .new-1 "$d/shims-$other/xclip" 2>/dev/null; got=$?
  $s "$setup" install "$d" .new-1 "-$d/shims-$other/pbcopy" 2>/dev/null; got2=$?
  [ "$got" != 0 ] && [ "$got2" != 0 ] && [ ! -e "$d/shims-$other/xclip" ] && cmp -s "$d/shims-$other/pbcopy" "$shims/pbcopy" && ok || bad "$s setup install: the shims of another process changed ($got $got2)"
  # A temp file that is a link: refused, the target is not changed.
  printf 'keep' >"$tmp/target"
  ln -s "$tmp/target" "$m/pbcopy.new-2"
  $s "$setup" install "$d" .new-2 "$m/pbcopy" 2>/dev/null
  got=$?
  [ "$got" != 0 ] && [ "$(cat "$tmp/target")" = keep ] && [ ! -e "$m/pbcopy" ] && ok || bad "$s setup install: a link was used ($got)"
  # A cache folder that others can write: ours, so it is made 700 and used.
  c2=$tmp/open-$k; mkdir -p "$c2"; chmod 777 "$c2"
  $s "$setup" find "$c2" pbcopy >/dev/null
  [ $? = 0 ] && case $(ls -ld "$c2") in drwx------*) true ;; *) false ;; esac && ok || bad "$s setup: an open folder of this user was not made private"
  # A link as the cache folder, or as its shims folder: exit 3.
  ln -s "$d" "$tmp/link-$k"
  $s "$setup" find "$tmp/link-$k" pbcopy >/dev/null; got=$?
  [ "$got" = 3 ] && ok || bad "$s setup: a linked cache folder gives $got, not 3"
  c3=$tmp/c3-$k; mkdir -p "$c3" "$tmp/other-$k"; ln -s "$tmp/other-$k" "$c3/shims-$$"
  $s "$setup" find "$c3" pbcopy >/dev/null; got=$?
  [ "$got" = 3 ] && ok || bad "$s setup: a linked shims folder gives $got, not 3"
  $s "$setup" install "$c3" .new-1 "$c3/shims-$$/pbcopy" >/dev/null 2>&1; got=$?
  [ "$got" = 3 ] && ok || bad "$s setup install: a linked shims folder gives $got, not 3"
  # A link in the shims folder (it could point anywhere): exit 3.
  c4=$tmp/c4-$k; mkdir -p "$c4/shims-$$"; ln -s /usr/bin/true "$c4/shims-$$/pbcopy"
  $s "$setup" find "$c4" pbcopy >/dev/null; got=$?
  [ "$got" = 3 ] && ok || bad "$s setup: a link in the shims folder gives $got, not 3"
  # A file as the cache folder, and a folder of another user (root's /usr): exit 3.
  printf '' >"$tmp/file-$k"
  $s "$setup" find "$tmp/file-$k" pbcopy >/dev/null; got=$?
  [ "$got" = 3 ] && ok || bad "$s setup: a file as the cache folder gives $got, not 3"
  if [ "$(id -u)" != 0 ]; then
    $s "$setup" find /usr pbcopy >/dev/null 2>&1; got=$?
    [ "$got" = 3 ] && ok || bad "$s setup: a folder of another user gives $got, not 3"
  fi
done

# ---- The cache sweep (CACHE_SH in hooks/lib/env.ts) ----
# The TypeScript text as sh: ${DESIGNS_KEPT_DAYS} as 30, the escapes undone.
cache_sh=$("$perl" -ne 'if (/^export const CACHE_SH = `(.*)`$/) { $_ = $1; s/(?<!\\)\$\{DESIGNS_KEPT_DAYS\}/30/g; s/\\\$/\$/g; s/\\\\/\\/g; print }' "$here/hooks/lib/env.ts")
[ -n "$cache_sh" ] && ok || bad "CACHE_SH: not found in env.ts"
sh -c 'exit 0' &
dead=$!
wait "$dead"
uid=$(id -u)
for s in $shells; do
  [ "$s" = exec ] && continue
  [ "$s" = bash ] && s='bash --posix'
  k=$(echo "$s" | tr -d ' -')
  # A link as the cache folder (to a folder of the victim): nothing there changes.
  td=$tmp/td-$k; v=$tmp/victim-$k
  mkdir -p "$td" "$v/old" "$v/ask"; chmod 755 "$v"
  : >"$v/ask-$dead"; : >"$v/ask/$dead-1-2"
  touch -t 202001010000 "$v/old"
  ln -s "$v" "$td/cc-intelligent-ui-$uid"
  out=$(TMPDIR=$td XDG_CACHE_HOME=$tmp/xdg-$k $s -c "$cache_sh")
  [ -z "$(echo "$out" | sed -n 1p)" ] && ok || bad "$s CACHE_SH: a linked cache folder was used ($out)"
  [ -d "$v/old" ] && [ -e "$v/ask-$dead" ] && [ -e "$v/ask/$dead-1-2" ] && case $(ls -ld "$v") in drwxr-xr-x*) true ;; *) false ;; esac && ok || bad "$s CACHE_SH: the link target changed"
  # A cache folder of this user: the files of a dead pid go, of a live pid stay.
  td=$tmp/te-$k; d=$td/cc-intelligent-ui-$uid
  mkdir -p "$d/ask" "$d/shims-$dead" "$d/shims-$$" "$d/old" "$d/pkg-cache"
  : >"$d/ask-$dead"; : >"$d/ask-$$"; : >"$d/ask/$dead-1-2"; : >"$d/ask/$dead-1-2.answer"; : >"$d/ask/$$-1-2"
  : >"$d/shims-$dead/pbcopy"
  touch -t 202001010000 "$d/old" "$d/shims-$$" "$d/pkg-cache"
  out=$(TMPDIR=$td XDG_CACHE_HOME=$tmp/xdg-$k $s -c "$cache_sh")
  [ "$(echo "$out" | sed -n 1p)" = "$d" ] && ok || bad "$s CACHE_SH: not the cache folder ($out)"
  [ ! -e "$d/ask-$dead" ] && [ ! -e "$d/ask/$dead-1-2" ] && [ ! -e "$d/ask/$dead-1-2.answer" ] && [ ! -e "$d/shims-$dead" ] && [ ! -e "$d/old" ] && ok || bad "$s CACHE_SH: files of a dead pid or an old folder stayed ($(ls -A "$d" "$d/ask" | tr '\n' ' '))"
  [ -e "$d/ask-$$" ] && [ -e "$d/ask/$$-1-2" ] && [ -d "$d/shims-$$" ] && [ -d "$d/pkg-cache" ] && ok || bad "$s CACHE_SH: files of a live pid went"
done
kill "$other" 2>/dev/null; wait "$other" 2>/dev/null

echo "shim-test: $pass passed, $fail failed (shells: $shells)"
[ "$fail" = 0 ]
