#!/bin/sh
# Intelligent UI (cc-intelligent-ui): sets up the clipboard shims (clip-shim.sh).
#   find <cache> <tool>...: prints `pid <Claude Code's pid>`, makes the shims
#     folder <cache>/shims-<pid> of this process, then `<tool> <path>` for each
#     tool found on PATH without a shims folder, `perl <path>`, and `ask <fifo>`
#     when it made the private folder <cache>/ask and the FIFO <cache>/ask-<pid>
#     (mode 600) for the shims' asks.
#   install <cache> <suffix> <file>...: puts each new shim `<file><suffix>` in
#     place, executable first; `-<file>` removes the shim of a tool that is gone.
#     Only in the shims folder of this process: never the one of another.
# Exit 3: <cache> or the shims folder is not a private folder of this user.

# A folder of this user (not a link), made 700, with no group or other write.
private() {
  [ ! -L "$1" ] && [ -d "$1" ] && [ -O "$1" ] && chmod 700 "$1" 2>/dev/null || return 1
  case $(ls -ld "$1") in d????-??-*) return 0 ;; esac
  return 1
}
# The shims folder: private, and each entry a file of this user (not a link).
shims_ok() {
  private "$1" || return 1
  [ -z "$(find "$1" -mindepth 1 \( ! -type f -o ! -user "$(id -u)" \) 2>&1)" ]
}
# A FIFO of this user (not a link).
fifo_ok() { [ -p "$1" ] && [ ! -L "$1" ] && [ -O "$1" ]; }

mode=$1; c=$2; d=$2/shims-$PPID
shift 2
case $mode in
  find)
    echo "pid $PPID"
    private "$c" || { echo "unsafe $c"; exit 3; }
    mkdir "$d" 2>/dev/null
    shims_ok "$d" || { echo "unsafe $d"; exit 3; }
    p=; IFS=:; set -f
    for e in $PATH; do case $e in "$c"/shims|"$c"/shims-*) ;; *) p=${p:+$p:}$e ;; esac; done
    unset IFS; set +f; PATH=$p
    for t in "$@" perl; do x=$(command -v "$t" 2>/dev/null) && case $x in /*) echo "$t $x" ;; esac; done
    q=$c/ask; f=$c/ask-$PPID
    mkdir "$q" 2>/dev/null
    private "$q" || exit 0
    fifo_ok "$f" || { rm -f "$f"; mkfifo -m 600 "$f" 2>/dev/null; }
    fifo_ok "$f" && chmod 600 "$f" && echo "ask $f"
    exit 0 ;;
  install)
    private "$c" && shims_ok "$d" || exit 3
    s=$1; shift
    for f in "$@"; do
      # Only files in the shims folder.
      case ${f#-} in "$d"/*) ;; *) exit 1 ;; esac
      case $f in
        -*) rm -f -- "${f#-}" ;;
        *)
          { [ -f "$f$s" ] && [ ! -L "$f$s" ] && [ -O "$f$s" ] && chmod 755 "$f$s" && mv -f "$f$s" "$f"; } || { rm -f "$f$s"; exit 1; }
          [ -f "$f" ] && [ ! -L "$f" ] && [ -O "$f" ] || exit 1 ;;
      esac
    done ;;
  *) exit 2 ;;
esac
