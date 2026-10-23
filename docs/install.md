# Install

← Back to the [README](../README.md)

## Requirements

- Claude Code 2.1.298 or later (tested on 2.1.307)
- [Typst](https://typst.app) 0.15 (tested on 0.15.1)
- macOS (tested), or Linux with X11 or Wayland (tested on Ubuntu 24.04 with GNOME). Refer to [Linux](#linux).
- A terminal where Claude Code can show pictures. Refer to [Terminals](#terminals).

## Terminals

- **kitty 0.28+, Ghostty, cmux:** works with no setup. kitty and Ghostty run on macOS and Linux; cmux (Ghostty inside) on macOS only.
- **iTerm2 3.6+ (macOS, 3.7.5 tested):** needs [the setup line](#the-setup-line). The first time the mod runs in iTerm2, it asks to add it. Say yes, close the tab, and start Claude Code in a new iTerm2 tab.
- **herdr (0.9.5 tested, in Ghostty and iTerm2):** needs the setup line too, asked for the same way. Then start Claude Code in a new herdr pane. herdr must run in a terminal that shows kitty pictures (kitty, Ghostty or iTerm2 3.6+). Refer to [herdr](#herdr).
- **Rio 0.5.27+ (not tested):** set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before you start Claude Code. Runs on macOS and Linux.
- **ssh:** works when your local terminal is kitty or Ghostty (`TERM` must come through ssh), or when you set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` on the remote computer. Pictures go as data, so a page over 4096 pixels on a side or over 2 MiB shows as text, and an image that large does not show.
- **tmux and screen:** no pictures. Claude Code does not send pictures through them, even with the variable set. Set `IUI_FORCE=1` to try anyway.
- **Warp and WezTerm (not yet):** they do not draw kitty pictures with Unicode placeholders. Support comes when [warpdotdev/warp#16312](https://github.com/warpdotdev/warp/pull/16312) and [wezterm/wezterm#7924](https://github.com/wezterm/wezterm/pull/7924) are merged.
- **Not supported:** Konsole (no Unicode placeholders), Alacritty, Terminal.app, Windows Terminal, GNOME Terminal and other VTE terminals, foot, VS Code, Tabby, Hyper and JetBrains terminals (no kitty pictures).
- **Background sessions** (agent view, forks, `claude attach`) cannot show pictures.

Where pictures cannot show, you see the normal text. `/iui details` tells you why.

### The setup line

iTerm2 and herdr show pictures only when `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` is set before Claude Code starts. A mod cannot set it early enough, so the mod adds this block to your shell's start file when you agree, or when you run `/iui setup`:

```sh
# >>> cc-intelligent-ui: Claude Code pictures in iTerm2 >>>
if { [ "$TERM_PROGRAM" = "iTerm.app" ] || [ "$TERM_PROGRAM" = "herdr" ]; } && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi
# <<< cc-intelligent-ui <<<
```

- **Where it sets the variable:** in iTerm2 and herdr only, not in tmux or screen.
- **fish:** the line is `if test "$TERM_PROGRAM" = "iTerm.app" -o "$TERM_PROGRAM" = "herdr"; and not set -q TMUX; and not set -q STY; set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1; end`.
- **The start file** of the shell in `SHELL`:
  - zsh: `${ZDOTDIR:-~}/.zshrc`
  - bash on macOS: the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists (a login bash reads only that one). `~/.bash_profile` is made only when none exists.
  - bash on Linux: `~/.bashrc`
  - fish: `${XDG_CONFIG_HOME:-~/.config}/fish/conf.d/cc-intelligent-ui.fish`
- **Older versions:** their line was for iTerm2 only (the markers are the same). `/iui setup` replaces it, and in herdr the mod asks to update it.
- **Undo:** `/iui setup remove`, or delete the marked lines.
- **Another shell, or a file the mod cannot read:** the mod changes nothing and shows the line to add.
- **Not in `settings.json`:** do not put the variable in the `env` of `~/.claude/settings.json`. It then applies in every terminal, also where pictures cannot show.

### herdr

- **`SHELL`:** herdr runs the shell of `SHELL` in its panes. If herdr starts without `SHELL` (for example from a launcher or a service), its panes run `/bin/sh`, which does not read your start file. Start herdr from a normal shell, or set `SHELL` for it.
- **Theme:** herdr hides the outer terminal. With the `auto` theme, the mod asks herdr for the background of the terminal in front. This also works with `herdr --remote`.
- **Font:** you can attach to one herdr server from more than one terminal. The mod uses the font of the terminal of the herdr client you use:
  - On macOS, the client in the terminal app in front (the one where you typed last if that app has two or more). If the app in front has no client (for example a browser), the mod keeps the last client.
  - On Linux, the client where you typed last.
  - The mod checks for a change every 1 s and redraws with the new font. A newly attached client in the app in front, or any new client on Linux, is found at the full check every 10 s.
  - With no client found, the mod uses the variables of the terminal that started the herdr server (`GHOSTTY_RESOURCES_DIR`, `KITTY_PID` or `ITERM_PROFILE`).
  - `/iui details` shows the terminal and how the mod found it, for example `herdr 0.9.5 (in kitty, the client you used last)`.
- **iTerm2 under herdr:** iTerm2 would show the rows of each picture in reverse order, so the mod stores pages and pictures upside down by rows. Selecting text in an answer still works, and `/iui details` shows `pages and pictures stored upside down by rows`. With `herdr --remote` in iTerm2, the mod cannot find the client and the rows show in the wrong order.
- **Shorter pages:** pages are shorter in herdr, so that herdr can pass each one on. Refer to [Limitations](limitations.md).

## Install steps

Use the install script, or install by hand.

### The install script

In a shell, on macOS or Linux:

```
curl -fsSL https://intelligentui.art/install.sh | bash
```

Or download the script, read it, and run `bash install.sh`. The source is [`site/install.sh`](../site/install.sh). When it is done, restart Claude Code or type `/reload-plugins`. To update, run it again: steps that are already done change nothing.

What it does:

1. **Checks** your system (macOS or Linux, arm64 or x86_64) and that Claude Code is installed.
2. **Typst:** if no Typst 0.15 or later is found, installs the official Typst 0.15.1 into `~/.local/bin`, after a SHA-256 check.
3. **The mod:** adds the `razorback16` marketplace and installs the mod, or updates both.
4. **Auto-update:** turns it on for the marketplace in your Claude Code `settings.json`, with a backup.
5. **iTerm2 and herdr:** if either is there, adds [the setup line](#the-setup-line) to your shell's start file, with a backup.
6. **Summary:** what changed, and how to undo each step.

**Options** (environment variables):

- `IUI_NO_TYPST=1`: skip step 2. The script does not look for Typst and downloads nothing.
- `IUI_NO_AUTO_UPDATE=1`: skip step 4. `settings.json` does not change.
- `IUI_NO_SHELL_SETUP=1`: skip step 5. No shell start file changes.

For example: `curl -fsSL https://intelligentui.art/install.sh | IUI_NO_TYPST=1 bash`.

**Safety.** The script never uses `sudo`. It runs no downloaded code except the Typst program it checked. It writes each file as a new file in the same folder and renames it over the old one, with the same permissions. All its work is in functions that the last line runs, so a cut download runs nothing. Its output is plain text.

**Undo:**

- The mod: `claude plugin uninstall cc-intelligent-ui@razorback16`
- The marketplace: `claude plugin marketplace remove razorback16`. Claude Code also removes the `razorback16` entry of `extraKnownMarketplaces` from your settings.
- Only auto-update: in Claude Code, type `/plugin`, go to **Marketplaces**, select **razorback16**, then **Disable auto-update**. In Claude Code 2.1.307 this also sets `"autoUpdate": false` in the settings file that declares the marketplace. Or copy `settings.json.bak-iui` back to `settings.json` (it is the file before the auto-update change only).
- An old marketplace source the script replaced: `claude plugin marketplace remove razorback16`, then `claude plugin marketplace add <old source>` (the script shows the old source).
- A copy from another marketplace the script uninstalled: `claude plugin install <id> --scope user` (the script shows the id).
- Typst, if the script installed it: `rm ~/.local/bin/typst`
- The shell setup: `/iui setup remove` in Claude Code, or delete the lines from `# >>> cc-intelligent-ui` to `# <<< cc-intelligent-ui <<<` in the start file the script names.

<details>
<summary><b>Each step in detail</b></summary>

**1. Checks**

- The `claude` command must be on your `PATH`, or in `~/.local/bin` or `~/.claude/local`. Without it, the script points you to [Set up Claude Code](https://code.claude.com/docs/en/setup), changes nothing, and exits with code 1.
- Claude Code older than 2.1.298 gives a warning; the script continues.

**2. Typst**

- It looks for Typst as the mod does: the `PATH` of a login shell (`sh -l`; on macOS `/usr/local/bin` comes first there), then your `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.cargo/bin`, `~/.local/bin`, `/home/linuxbrew/.linuxbrew/bin` and `~/.linuxbrew/bin`. If the first one it finds is 0.15 or later, nothing changes.
- Else it downloads the release file for your system from [GitHub](https://github.com/typst/typst/releases/tag/v0.15.1) (`typst-aarch64-apple-darwin`, `typst-x86_64-apple-darwin`, `typst-aarch64-unknown-linux-musl` or `typst-x86_64-unknown-linux-musl`, `.tar.xz`) with `curl`, over HTTPS only.
- On a SHA-256 mismatch with the value in the script, it deletes the file, installs nothing, and stops.
- It extracts the file in a private temporary folder (deleted at the end), checks that the program runs, and moves it to `~/.local/bin/typst`, replacing an older one there.
- Linux needs `xz` for `tar` (`xz-utils` on Debian and Ubuntu).
- It tells you when `~/.local/bin` is not on your `PATH` (the mod finds Typst there anyway), and when an older Typst comes first, so the mod would use that one.

**3. The mod**

The script uses only the `claude plugin` commands and shows each one before it runs it.

- **Marketplace:** `claude plugin marketplace add razorback16/cc-intelligent-ui` if `razorback16` is not known, else `claude plugin marketplace update razorback16`.
- **Mod:** `claude plugin install cc-intelligent-ui@razorback16 --scope user` if it is not installed for your user, else `claude plugin update cc-intelligent-ui@razorback16 --scope user`.
- **Another marketplace source.** Updates come only from the GitHub repository `razorback16/cc-intelligent-ui` (or its `https://github.com/...` URL) with no ref. If `razorback16` comes from somewhere else (a fork, a pinned ref such as `#v0.3.0`, a local folder), the script adds it again from GitHub, then updates the mod. It runs `claude plugin marketplace remove razorback16 --scope user` first only when your user `settings.json` declares the marketplace; otherwise `add` changes the source by itself.
  - If Claude Code uninstalls the mod (also its project copies) during this, the script installs it again.
  - Your `/iui` settings stay (they belong to `cc-intelligent-ui@razorback16`). A disabled mod stays disabled.
  - The script shows the old source and the command to add it back, and tells you if the old source had a newer version (for example a work folder).
- **Other copies of the mod.** A user copy from another marketplace (for example `cc-intelligent-ui@other`) would also run, so the script uninstalls it after the `razorback16` copy is in, and shows the command to install it again. These are only shown, with their folder:
  - A copy with no marketplace (`cc-intelligent-ui@skills-dir` in a Claude Code skills folder, or `cc-intelligent-ui@inline` from `--plugin-dir`). The `razorback16` copy is used, not that one.
  - Copies in project or local scope, with the command to remove them. In that project, such a copy can be used instead of the user copy.
- **A failed update** of the mod or the marketplace: the summary says the mod was not updated, and the script exits with code 1.

**4. Auto-update**

In your user settings, `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), the script adds `"autoUpdate": true` to the `razorback16` entry that `claude plugin marketplace add` wrote. This is the documented Claude Code setting:

```json
"extraKnownMarketplaces": {
  "razorback16": {
    "source": { "source": "github", "repo": "razorback16/cc-intelligent-ui" },
    "autoUpdate": true
  }
}
```

- **Only that changes.** All other bytes of the file (keys, order, values, spaces) stay the same. It edits the JSON with `perl` (no modules), never with `sed`.
- **Backup:** `settings.json.bak-iui`, only when the file changed. It undoes only the auto-update change, not step 3.
- **No file:** it makes one. **A link:** the file it points to changes.
- **`true` already:** nothing changes.
- **`false`** (you chose **Disable auto-update**): kept, also when step 3 adds the marketplace again. The script says how to turn it on.
- **Not changed:** a read-only file, a hard link (more than one name), or a `razorback16` entry with another `source`.
- **Not valid JSON** (for example, with comments): nothing changes, the script shows the entry to add, and exits with code 1.

**5. iTerm2 and herdr**

If iTerm2 is installed (macOS: `/Applications/iTerm.app`, `~/Applications/iTerm.app`, or found by Spotlight) or `herdr` is there (on the `PATH` or in the folders of step 2), the script adds the same block as `/iui setup` to the same [start file](#the-setup-line) of your login shell.

- Another shell: nothing changes; the script shows the line to add.
- An older block of the mod is replaced. If the block is there already, nothing changes. If the file is a link, the file it points to changes.
- **Backup:** `<file>.bak-iui`.
- **Not changed:** a file that cannot be read, is not a regular file, is read-only, is a hard link, or is larger than 4 MB. The script then shows the lines to add and exits with code 1.

**6. Summary**

What was installed or updated, where Typst is, the state of auto-update and of the shell setup, and how to undo each step.

</details>

### By hand

1. Install Typst: `brew install typst` on macOS. On Linux, refer to [Install Typst on Linux](#install-typst-on-linux). For all the ways, refer to [Typst's install page](https://github.com/typst/typst#installation).
2. At the prompt of a Claude Code session in the terminal, type:

   ```
   /plugin install cc-intelligent-ui --marketplace razorback16/cc-intelligent-ui
   ```

   Answer `y` to add the marketplace, then press Enter to install for your user. The mod starts at once, with no restart. From a shell: `claude plugin install cc-intelligent-ui --marketplace razorback16/cc-intelligent-ui`.
3. [Turn on auto-update](#turn-on-auto-update) to get each new version.
4. In iTerm2 or herdr, say yes when the mod asks to add [the setup line](#the-setup-line), or run `/iui setup`.

## Install Typst on Linux

You need Typst 0.15 or later. Use one of these:

- **Cargo** (Rust): `cargo install --locked typst-cli`. Typst goes into `~/.cargo/bin`.
- **The release file:** download `typst-x86_64-unknown-linux-musl.tar.xz` (or `typst-aarch64-unknown-linux-musl.tar.xz` for ARM) from [the Typst releases](https://github.com/typst/typst/releases). Extract it and put `typst` in a folder on your `PATH`, for example `~/.local/bin`.
- **A distribution package, Snap (`sudo snap install typst`) or Homebrew on Linux (`brew install typst`).** Check the version with `typst --version`: some distributions have an older one.

The mod finds Typst on the `PATH` of your login shell, and also in `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.cargo/bin`, `~/.local/bin` and the Homebrew folders.

## Linux

The mod works on Linux with X11 and Wayland. It uses these tools (most systems have the first three):

- **perl** (perl 5): reads the terminal size and cell size and watches for changes. It also writes the highlight frames for picture select (with the core module `MIME::Base64`). On macOS, `/usr/bin/perl` with Apple's PerlObjCBridge also watches the clipboard for the `/iui grab` toast.
- **fontconfig** (`fc-match`, `fc-list`): finds the terminal font when the terminal config names none, and checks that a named font is installed. kitty and most terminals use fontconfig's `monospace`. Ghostty uses its own JetBrains Mono when its config names no font; if fontconfig does not have it, the mod copies it from the Ghostty program (refer to [How it works](how-it-works.md)).
- **Light or dark mode** (for the `auto` theme): the freedesktop portal (`org.freedesktop.appearance color-scheme`, through `gdbus` or `busctl`), which GNOME, KDE Plasma and most desktops have. If it does not answer, GNOME's `color-scheme` (`gsettings`).
- **The clipboard**, only for the `/iui grab` toast and for `/iui grab` on the main screen (refer to [Picture cells on the clipboard](usage.md#picture-cells-on-the-clipboard)). The mod uses the first that works:
  1. **Wayland, not GNOME:** `wl-paste --watch` from `wl-clipboard`. It needs the compositor's data-control protocol (KDE Plasma, Sway, Hyprland and other wlroots compositors have it).
  2. **X11, and GNOME on Wayland (through Xwayland):** `clipnotify` to see changes and `xclip` to read. Without them, GTK 3 from Python (`python3-gi`, on most GNOME desktops). `xsel` is not used: it cannot show the targets of a copy, so the mod could not skip a password manager's copy (`/iui details` tells you to install `xclip`).
  3. **GNOME on Wayland with no X11 tool:** `wl-paste`. GNOME has no data-control protocol, so `wl-paste --watch` stops and there is no toast.

  With none of these, there is no `/iui grab` toast. Picture select, `/iui grab` (with a selection, in fullscreen), Claude Code's `/copy` and the `ui.copy` hook still work. `/iui details` shows the tool in use, or why there is no toast, on the line `/iui grab hint:`.
- **"Edit the plan"** (refer to [Plan approval](usage.md#plan-approval)): VS Code (`code --wait`), else the first on the `PATH` of VSCodium, Zed, Sublime Text, Kate, gedit and gvim (editors that can wait until you close the file). With none, the option does not show.
- **The cache folder** is in `$TMPDIR`, else `/tmp`.

`/iui setup` changes no file on Linux, except in a herdr pane: there it adds the setup line (to `~/.bashrc` for bash, because herdr does not start a login shell on Linux).

To install the clipboard tools:

- Debian and Ubuntu: `sudo apt install wl-clipboard xclip`. `clipnotify` is not packaged: build it from [cdown/clipnotify](https://github.com/cdown/clipnotify), or use GTK 3 from Python: `sudo apt install python3-gi gir1.2-gtk-3.0`.
- Fedora: `sudo dnf install wl-clipboard xclip`.
- Arch Linux: `sudo pacman -S wl-clipboard xclip clipnotify`.

## Update

Claude Code sees a new version by the version number in the mod's `plugin.json`. For a marketplace not from Anthropic, such as `razorback16`, auto-update is off by default.

### Turn on auto-update

The [install script](#the-install-script) turns it on. To do it yourself:

1. In Claude Code, type `/plugin`.
2. Go to **Marketplaces**, then select **razorback16**.
3. Select **Enable auto-update**.

Claude Code then updates the mod about 10 minutes after the first message of a session. The new version starts in the next session, or after `/reload-plugins`.

### Update manually

Run the [install script](#the-install-script) again, or from a shell:

```
claude plugin marketplace update razorback16
claude plugin update cc-intelligent-ui@razorback16
```

Then type `/reload-plugins` in Claude Code, or start a new session.

### The update notice

At most once a day, after a session starts, the mod checks for a new version. If there is one, a toast shows the new version, your version and the update commands (at most once a day for each version). `/iui` and `/iui details` also show it.

- **Network:** one GET request through Claude Code for a public file on GitHub (`https://raw.githubusercontent.com/razorback16/cc-intelligent-ui/main/.claude-plugin/plugin.json`). No data about you or your sessions is sent.
- **Turn it off:** `/iui updates off` (kept for later sessions). `/iui updates on` turns it back on.
- **No check** when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_UPDATES` or `DISABLE_AUTOUPDATER` is set, in a background session, or with `claude -p`.

## Try it from a clone

To try it without installing:

```
git clone https://github.com/razorback16/cc-intelligent-ui
claude --plugin-dir /path/to/cc-intelligent-ui
```
