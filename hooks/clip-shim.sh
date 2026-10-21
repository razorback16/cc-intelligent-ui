#!/bin/sh
# Intelligent UI (cc-intelligent-ui): a pass-through shim for one clipboard tool.
# It runs the real tool with the same arguments and exit status. A clipboard
# write of picture cells by the Claude Code process of the FIFO $IUI_COPY_ASK
# (its direct child) asks that process's mod for their text, and the real
# tool gets that text. Only the request file has text on disk. See the README.
tool=@TOOL@
real=@REAL@
dir=@DIR@
perl=@PERL@
if [ ! -x "$real" ]; then
  # The real tool moved: find it on PATH without this folder (never this shim).
  [ -z "${IUI_SHIM_IN:-}" ] || { echo "$tool: not found" >&2; exit 127; }
  IUI_SHIM_IN=1; export IUI_SHIM_IN
  p=; IFS=:; set -f
  for e in $PATH; do [ "$e" = "$dir" ] || p=${p:+$p:}$e; done
  unset IFS; set +f; PATH=$p; real=$tool
fi

# w=1: a write of text to the clipboard (not primary) with the text on stdin.
# Any other call (also a type that is not text), or an argument not known
# here, passes through untouched.
w=1; v=; s=; i=; b=
text_type() { case $1 in text/plain*|UTF8_STRING|STRING|TEXT) ;; *) w=0 ;; esac; }
case $tool in
  pbcopy)
    for a in "$@"; do
      if [ -n "$v" ]; then [ "$a" = general ] || w=0; v=; continue; fi
      case $a in -pboard) v=1 ;; *) w=0 ;; esac
    done ;;
  wl-copy)
    for a in "$@"; do
      if [ -n "$v" ]; then [ "$v" = type ] && text_type "$a"; v=; continue; fi
      case $a in
        -n|--trim-newline|-f|--foreground|-o|--paste-once|--regular|--seat=*) ;;
        --type=*) text_type "${a#--type=}" ;;
        -t|--type) v=type ;;
        -s|--seat) v=1 ;;
        *) w=0 ;;
      esac
    done ;;
  xclip)
    # Its default selection is primary: only an explicit clipboard counts.
    for a in "$@"; do
      if [ -n "$v" ]; then
        if [ "$v" = sel ]; then case $a in c*) s=1 ;; *) s= ;; esac; fi
        [ "$v" = type ] && text_type "$a"
        v=; continue
      fi
      case $a in
        -i|-in|-input|-f|-filter|-quiet|-silent|-verbose|-noutf8|-rmlastnl) ;;
        -sel|-selection) v=sel ;;
        -t|-target) v=type ;;
        -d|-display|-l|-loops) v=1 ;;
        *) w=0 ;;
      esac
    done
    [ "$s" = 1 ] || w=0 ;;
  xsel)
    for a in "$@"; do
      if [ -n "$v" ]; then v=; continue; fi
      case $a in
        --input|--append) i=1 ;;
        --clipboard) b=1 ;;
        --nodetach|--verbose|--zeroflush) ;;
        --selectionTimeout|--logfile|--display) v=1 ;;
        --*|-) w=0 ;;
        -*)
          r=${a#-}
          while [ -n "$r" ]; do
            c=${r%"${r#?}"}; r=${r#?}
            case $c in
              i|a) i=1 ;;
              b) b=1 ;;
              n|v|z) ;;
              t|l) if [ -z "$r" ]; then v=1; else w=0; fi ;;
              *) w=0 ;;
            esac
          done ;;
        *) w=0 ;;
      esac
    done
    [ "$i" = 1 ] && [ "$b" = 1 ] || w=0 ;;
  *) w=0 ;;
esac
[ -z "$v" ] || w=0

# The ask: only from the Claude Code process of the FIFO <cache>/ask-<pid>.
f=${IUI_COPY_ASK:-}; n=${f##*/ask-}
case $n in ''|*[!0-9]*) w=0 ;; esac
[ "$n" = "$PPID" ] || w=0
[ "$w" = 1 ] && [ -x "$perl" ] || exec "$real" "$@"
# Perl keeps the text in memory. Picture cells (U+10EEEE, F4 8E BB AE), 4 MiB
# at most: a request file in <cache>/ask, its id to the FIFO, then the answer
# (1.5 s from the start at most: Claude Code stops the tool at 2 s), else the
# cells as they are. Then the real tool through a pipe, and its exit status.
exec "$perl" -e '
use strict; use Fcntl; use POSIX (); use Config; use Time::HiRes ();
my $END = Time::HiRes::time() + 1.5;
my $MAX = 4 << 20;
my ($fifo, $real, @args) = @ARGV;
binmode STDIN;
# A text over $MAX: no end of file here, so no ask.
my ($text, $eof) = ("", 0);
while (length($text) <= $MAX) {
  my $n = sysread(STDIN, $text, 65536, length $text);
  if (!$n) { $eof = 1; last; }
}
my $out = $text;
my $q;
my ($root, $own) = $fifo =~ m{^(.*)/ask-(\d+)$};
if ($eof && defined $own && $own == getppid() && index($text, "\xF4\x8E\xBB\xAE") >= 0) {
  $q = "$root/ask/$own-$$-" . int(Time::HiRes::time() * 1000);
  eval {
    my @d = lstat("$root/ask"); die unless @d && -d _ && $d[4] == $>;
    my @f = lstat($fifo); die unless @f && -p _ && $f[4] == $>;
    sysopen(my $w, "$q.tmp", O_WRONLY | O_CREAT | O_EXCL, 0600) or die;
    (print $w $text) && close($w) or die;
    rename("$q.tmp", $q) or die;
    # No reader (ENXIO): the mod does not run, so no wait.
    sysopen(my $p, $fifo, O_WRONLY | O_NONBLOCK) or die;
    my @s = stat($p); die unless -p _ && $s[0] == $f[0] && $s[1] == $f[1];
    my $id = substr($q, length("$root/ask/"));
    syswrite($p, "$id\n") == length($id) + 1 or die; close $p;
    my $a;
    until (open($a, "<:raw", "$q.answer")) {
      if (Time::HiRes::time() >= $END) {
        # Too late: the mark stops a later answer (the mod links it with no overwrite).
        die if sysopen(my $m, "$q.answer", O_WRONLY | O_CREAT | O_EXCL, 0600);
        open($a, "<:raw", "$q.answer") or die; last;
      }
      Time::HiRes::sleep(0.01);
    }
    my $got = do { local $/; <$a> }; close $a;
    unlink "$q.answer";
    # An empty answer: the cells as they are.
    $out = $got if defined $got && length $got;
  };
  unlink $q, "$q.tmp";
}
$SIG{PIPE} = "IGNORE";
my $to;
unless (open($to, "|-", $real, @args)) { print STDERR "$real: $!\n"; exit 127; }
binmode $to;
print $to $out;
unless ($eof) { my $b; while (sysread(STDIN, $b, 65536)) { print $to $b or last; } }
my $ok = close($to); my ($st, $err) = ($?, $! + 0);
exit 1 if $st == -1;
if (my $sig = $st & 127) {
  my $name = (split " ", $Config{sig_name})[$sig];
  $SIG{$name} = "DEFAULT" if $name;
  kill $sig, $$;
  exit 128 + $sig;
}
exit($st >> 8) if $st >> 8;
exit(!$ok && $err && $err != POSIX::EPIPE() ? 1 : 0);
' -- "$f" "$real" "$@"
