# Privacy and access

← Back to the [README](../README.md)

The mod sends nothing about you or your sessions anywhere. This page lists everything it reads, writes and runs.

## Network

- **One request a day at most:** a GET, through Claude Code, for the public `plugin.json` of this mod on `raw.githubusercontent.com`. It only tells you about a new version.
- **Turn it off:** `/iui updates off`. It is also off when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_UPDATES` or `DISABLE_AUTOUPDATER` is set.

## Clipboard

### What the mod reads

- **The watcher:** a small `perl` process watches the clipboard while the mod is on and has drawn a picture (not over ssh).
  - macOS: it reads only the change counter. When the counter changes, the mod reads the text once with a short `perl` script (PerlObjCBridge).
  - Linux: a notifier (`wl-paste --watch`, `clipnotify` or GTK 3 from `python3`) reports each change. The mod then reads the text with `wl-paste`, `xclip` or GTK.
- **`/iui grab`** with no mouse selection reads the clipboard once.
- **A pasted image path:** when you paste and a new `[Image #N]` has no image file from Claude Code, the mod reads the clipboard once to find the image file the path names. This happens only while the mod is on and draws pictures, not over ssh. The text is used only as a list of image paths, kept in memory only for the draft, and sent nowhere.

### What it does with the text

- **Checks it for picture cells** only. If it finds them, a toast names `/iui grab`.
- **Keeps it in memory only** and sends it nowhere.
- **One exception:** `/iui dump` writes the last clipboard with picture cells to `copy-debug.json` in the cache folder.

### Password managers

A password manager's copy is never read:

- macOS: a copy with a concealed or transient type.
- Linux: a copy that offers the `x-kde-passwordManagerHint` target.
- Wayland: also a copy marked sensitive. The watcher notes only that the clipboard changed, and the read sees the mark and gets no text. (`wl-paste --watch` hands each new copy to `cat`, which drops it.)

### When the mod writes the clipboard

Only when you:

- release a selection in an answer;
- click a link, a file path, a command or a copy button in an answer;
- run `/iui grab`;
- press the command button in a link row (in fullscreen with `/iui select off`, where Claude Code gets the click).

It also writes when it changes a `$.ui.copy` that has picture cells to its text.

## Files

| Where | What | Kept |
|---|---|---|
| `$TMPDIR/cc-intelligent-ui-<uid>` (`/tmp` when `TMPDIR` is not set) | The private cache folder (mode 700): drawn pages, converted images, previews of pasted images, and one folder for each Typst compile (the [Typst root](#typst)) | Compile folders until the compile ends; other folders 2 days (not `pkg-cache`, Typst's package cache) |
| `~/.cache/cc-intelligent-ui/designs` | The size of each Typst drawing, so it keeps its size in later sessions | 180 days |
| `~/.cache/cc-intelligent-ui/fonts` | Fonts copied out of a terminal app, such as Ghostty's JetBrains Mono | |

`$XDG_CACHE_HOME` replaces `~/.cache` when it is set.

- **Previews of pasted images** come from the image files Claude Code writes when you paste, or, for a pasted path, from the file the path names. A JPEG or WebP is first made into a PNG by Typst.
- **Your shell start file:** `/iui setup` (iTerm2 on macOS, and herdr) changes it only when you run it or agree to its question. The install script adds the same block when iTerm2 or herdr is there (`IUI_NO_SHELL_SETUP=1` stops it). Everything the install script changes is in [Install](install.md#the-install-script).

## Processes

- **Always:** `typst`, the `perl` watcher, and short helper commands such as `perl`, `sh`, `osascript`, `defaults`, `plutil`, `fc-list` and `fc-match`.
- **Linux clipboard:** `wl-paste`, `xclip`, `clipnotify` or `python3 -I` (GTK 3; isolated, so it loads no code from the project folder).
- **herdr**, only while the mod is on and pictures show (from the start):
  - **Each second**, to find the herdr client you use: `stat` of the clients' terminal devices (the time of the last key) and, on macOS, `lsappinfo` (the app in front). With no client attached, there is no check each second.
  - **Each 10 s**, and when the check each second sees a change, a full check: `ps` (the process list), `lsof` (with more than one herdr server), and the environment of your own herdr clients (Linux: `/proc/<pid>/environ`; macOS: `ps eww`).
  - **Background colour:** with the `auto` theme, a `perl` asks herdr's pane for its background (OSC 11) at the start and when you change to a different herdr client. Not on a timer.

### Environment variables in the herdr check

The shell of the full check keeps only these variables. The mod, and other mods' hooks, get no other variable, and nothing is written anywhere:

`TERM`, `TERM_PROGRAM`, `COLORFGBG`, `LC_TERMINAL`, `ITERM_PROFILE`, `ITERM_SESSION_ID`, `GHOSTTY_BIN_DIR`, `GHOSTTY_RESOURCES_DIR`, `KITTY_CONFIG_DIRECTORY`, `KITTY_INSTALLATION_DIR`, `KITTY_PID`, `KITTY_WINDOW_ID`, `CMUX_SOCKET_PATH`, `CMUX_SURFACE_ID`, `CMUX_WORKSPACE_ID`, `RIO_CONFIG_HOME`.

## Typst

Each compile of an answer or a plan runs with a narrow root: a new folder with only the mod's template, the theme and the images the text names. So Typst code in an answer cannot read other files on your computer.

The same applies to the skill's `check.sh`, and to the preview of a pasted image (a folder with only its template and that image).

Typst also has no network: its proxy variables point to `http://127.0.0.1:9`, so it downloads nothing (a package the mod does not include cannot be fetched).
