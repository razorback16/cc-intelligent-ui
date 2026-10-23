# Install

← Back to the [README](../README.md)

## Requirements

- Claude Code 2.1.298 or later (tested on 2.1.307)
- [Typst](https://typst.app) 0.15 (tested on 0.15.1)
- macOS (tested) or Linux with X11 or Wayland. It works on a Linux desktop (tested on Ubuntu 24.04 with GNOME). Refer to [Linux](#linux).
- A terminal where Claude Code draws pictures. Refer to [Terminals](#terminals).

## Terminals

- **kitty (0.28 or later), Ghostty and cmux (Ghostty inside, macOS only):** pictures work with no setting. kitty and Ghostty work on macOS and on Linux.
- **iTerm2 3.6 or later (3.7.5 tested, macOS only):** Claude Code needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` when it starts. A mod cannot set it early enough. The first time the mod runs in iTerm2, it asks to add one line to your shell's start file (`~/.zshrc`, a fish `conf.d` file, or for bash on macOS the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists; it makes `~/.bash_profile` only when none of them exists). The line sets the variable in iTerm2 and herdr only, not in tmux or screen. Then close the tab, open a new iTerm2 tab, and start Claude Code there. You can also run `/iui setup` (undo: `/iui setup remove`).
- **herdr (0.9.5 tested, in Ghostty and iTerm2):** herdr is a terminal multiplexer. It draws the pictures of its panes in the terminal that it runs in, so that terminal must show kitty pictures (kitty, Ghostty or iTerm2 3.6 or later). Claude Code needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` in herdr too. The first time the mod runs in a herdr pane, it asks to add the same line to your shell's start file. If the file has the line of an older version (iTerm2 only), the mod asks to update it. Then close the pane, open a new herdr pane, and start Claude Code there. You can also run `/iui setup` (undo: `/iui setup remove`). herdr works on macOS and on Linux.
  - herdr runs the shell of `SHELL` in its panes. If herdr starts with no `SHELL` in its environment (for example from a launcher or a service), its panes run `/bin/sh`, which does not read your shell's start file, so the line has no effect. Start herdr from a normal shell, or set `SHELL` for it.
  - herdr hides the name of the terminal that it runs in. With the `auto` theme, the mod gets the background from herdr: herdr gives the background of the terminal in front. This also works with `herdr --remote`.
  - For the font, the mod finds the herdr client that you use. You can attach to one herdr server from more than one terminal (for example Ghostty and kitty). On macOS, the mod uses the client in the terminal app in front. If that app has two or more clients, it uses the one where you typed last. If the app in front has no client (for example, a browser), the mod keeps the client that it used before. On Linux, the mod uses the client where you typed last. The mod does not use only the place where you typed last on macOS, because iTerm2 answers each picture that herdr sends, and that looks like typing in iTerm2. The mod reads the variables and the terminal app of that client, then reads the font of that terminal. When you go to a different terminal, the mod finds it at the next check (every 1 s) and draws the pictures again with that font. If you attach a new client in the app that is in front, or on Linux, the mod can find it only at the full check (every 10 s). If the mod cannot find a client, it uses the variables that herdr keeps of the terminal that started the herdr server (`GHOSTTY_RESOURCES_DIR` for Ghostty, `KITTY_PID` for kitty, `ITERM_PROFILE` for iTerm2). `/iui details` shows the terminal and how the mod found it, for example `herdr 0.9.5 (in Ghostty, the terminal in front)`, `herdr 0.9.5 (in kitty, the client you used last)` or `herdr 0.9.5 (in Ghostty, from the server's start)`.
  - Pages are shorter in herdr, so that herdr can send each one to the terminal. Refer to [Limitations](limitations.md).
  - In iTerm2, herdr sends each row of a picture as one part of the image, and iTerm2 counts the top of that part from the bottom of the image. Thus the rows would show in the opposite order. When the herdr client that the mod uses is iTerm2, the mod keeps the rows of each page and each picture in an order that iTerm2 shows correctly. Picture select also works. When you go to a different terminal (for example Ghostty), the mod draws the pictures again in the usual order. `/iui details` then shows `pages and pictures stored upside down by rows`. With `herdr --remote` in iTerm2, the mod cannot find the client, so the rows of the pictures show in the wrong order. Refer to [Limitations](limitations.md).
- **Rio 0.5.27 or later (not tested):** set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before you start Claude Code. Rio works on macOS and on Linux.
- **The setup line.** `/iui setup` (and a yes to the question in iTerm2 or herdr) adds this block to your shell's start file. It sets the variable in iTerm2 and herdr only, not in tmux or screen:

  ```sh
  # >>> cc-intelligent-ui: Claude Code pictures in iTerm2 >>>
  if { [ "$TERM_PROGRAM" = "iTerm.app" ] || [ "$TERM_PROGRAM" = "herdr" ]; } && [ -z "$TMUX" ] && [ -z "$STY" ]; then export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1; fi
  # <<< cc-intelligent-ui <<<
  ```

  For fish, the line is `if test "$TERM_PROGRAM" = "iTerm.app" -o "$TERM_PROGRAM" = "herdr"; and not set -q TMUX; and not set -q STY; set -gx CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1; end`. The markers stay as in older versions, whose line was for iTerm2 only. `/iui setup` replaces an older line, and `/iui setup remove` removes the block. If the mod cannot read the file, it changes nothing and shows the line to add.
- Do not put the variable in the `env` of `~/.claude/settings.json`. It then applies in every terminal, also where pictures cannot show.
- **Warp (not yet):** Warp does not draw kitty pictures with Unicode placeholders yet. The pull request [warpdotdev/warp#16312](https://github.com/warpdotdev/warp/pull/16312) adds them. The mod will support Warp when that pull request is merged.
- **WezTerm (not yet):** WezTerm does not draw kitty pictures with Unicode placeholders yet, so it shows no pictures, also with the variable set. The pull request [wezterm/wezterm#7924](https://github.com/wezterm/wezterm/pull/7924) adds them. The mod will support WezTerm when that pull request is merged.
- **Not supported:** Konsole does not draw kitty pictures with Unicode placeholders, so it shows no pictures, also with the variable set. Alacritty, Terminal.app, Windows Terminal, GNOME Terminal (and other VTE terminals), foot, VS Code, Tabby, Hyper and JetBrains terminals have no kitty pictures.
- **tmux and screen:** no pictures. Claude Code does not send pictures through tmux or screen, also with the variable set. Set `IUI_FORCE=1` to try anyway.
- **ssh:** pictures work when the terminal on your computer is kitty or Ghostty (`TERM` must come through ssh), or when you set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` on the remote computer. The mod sends each picture as data, because the terminal cannot read files on the remote computer. A page larger than 4096 pixels on a side or 2 MiB shows as text. An image of that size does not show.
- Background sessions (agent view, forks, `claude attach`) cannot draw pictures.

Where pictures cannot draw, the mod shows the normal text. To see why a terminal can or cannot show pictures, run `/iui details`.

## Install steps

There are two ways: the install script, or by hand.

### The install script

In a shell, on macOS or Linux:

```
curl -fsSL https://intelligentui.art/install.sh | bash
```

You can also download the script, read it, and run it with `bash install.sh`. Its source is [`site/install.sh`](../site/install.sh). When it is done, restart Claude Code, or type `/reload-plugins` in a session. To update, run it again: each step that is done already changes nothing.

The script does these steps, in this order:

1. **Checks.** The system must be macOS or Linux, on arm64 or x86_64. The `claude` command must be on your `PATH` (or in `~/.local/bin` or `~/.claude/local`). If Claude Code is not installed, the script tells you where to get it ([Set up Claude Code](https://code.claude.com/docs/en/setup)), changes nothing, and stops with exit code 1. If Claude Code is older than 2.1.298, it shows a warning and continues.
2. **Typst.** The script looks for Typst as the mod does: in the `PATH` of a login shell (`sh -l`; on macOS this puts `/usr/local/bin` first), then on the `PATH`, then in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.cargo/bin`, `~/.local/bin`, `/home/linuxbrew/.linuxbrew/bin` and `~/.linuxbrew/bin`. If the first Typst that it finds is 0.15 or later, it changes nothing. If not, it downloads the official Typst 0.15.1 release file for your system from [github.com/typst/typst/releases](https://github.com/typst/typst/releases/tag/v0.15.1) (`typst-aarch64-apple-darwin`, `typst-x86_64-apple-darwin`, `typst-aarch64-unknown-linux-musl` or `typst-x86_64-unknown-linux-musl`, `.tar.xz`), with `curl` over HTTPS only. It compares the file's SHA-256 with the value written in the script. If they are not the same, it deletes the file, installs nothing and stops. Then it extracts the file in a private temporary folder (deleted at the end), makes sure that the program runs, and moves it to `~/.local/bin/typst` in one step. An older `typst` in `~/.local/bin` is replaced. Linux needs `xz` for `tar` (the `xz-utils` package on Debian and Ubuntu). The script tells you when `~/.local/bin` is not on your `PATH` (the mod finds Typst there anyway), and when an older Typst comes first, so that the mod uses that one.
3. **The mod.** With the Claude Code commands only. If the `razorback16` marketplace is not known (`claude plugin marketplace list`), it runs `claude plugin marketplace add razorback16/cc-intelligent-ui`; else `claude plugin marketplace update razorback16`. Then, if the mod is not installed for your user (`claude plugin list`), it runs `claude plugin install cc-intelligent-ui@razorback16 --scope user`; else `claude plugin update cc-intelligent-ui@razorback16 --scope user`. The script shows each command before it runs it.

   The script gets the newest version only from the official source: the GitHub repository `razorback16/cc-intelligent-ui` (or its `https://github.com/...` git URL) with no ref. If the `razorback16` marketplace comes from another source, for example a fork, a pinned ref (`#v0.3.0`) or a local folder, an update can not get the newest version. Then, if your user settings (`settings.json`) declare the `razorback16` marketplace, the script runs `claude plugin marketplace remove razorback16 --scope user` (this removes only that entry) and `claude plugin marketplace add razorback16/cc-intelligent-ui`. If they do not declare it (an older Claude Code added it, or another scope declares it), `remove --scope user` would fail, so the script runs only `claude plugin marketplace add razorback16/cc-intelligent-ui`, which changes the source by itself. Then it updates the mod. Claude Code can uninstall the mod (also its copies in projects) with the old marketplace; if it does, the script installs the mod again. Your `/iui` settings are kept, because Claude Code keeps them under the name `cc-intelligent-ui@razorback16`. If the mod was disabled, it stays disabled. The script shows the old source and the command to add it back. If the old source had a newer version (for example a work folder), the script says so.

   If a copy of the mod from another marketplace is installed for your user (for example `cc-intelligent-ui@other`), both copies would run. The script uninstalls that copy after the `razorback16` copy is installed, and shows the command to install it again. A copy with no marketplace (`cc-intelligent-ui@skills-dir` in a skills folder of Claude Code, or `cc-intelligent-ui@inline` from `--plugin-dir`) can not be uninstalled with `claude plugin`: the script shows it with its folder and does not change it. The `razorback16` copy is used, not that one. The script does not change copies in project or local scope. It shows each one, with its project folder and the command to remove it, because in that project such a copy can be used instead of the user copy.

   If the update of the mod or of the marketplace fails, the summary says that the mod was not updated (not that the newest version is installed), and the script ends with exit code 1.
4. **Auto-update.** The script sets this entry in your user settings, `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). This is the setting that Claude Code documents for a marketplace in `extraKnownMarketplaces`:

   ```json
   "extraKnownMarketplaces": {
     "razorback16": {
       "source": { "source": "github", "repo": "razorback16/cc-intelligent-ui" },
       "autoUpdate": true
     }
   }
   ```

   `claude plugin marketplace add` already writes the `razorback16` entry with its `source`; the script adds `"autoUpdate": true` to it. It changes only that: all other bytes of the file (keys, their order, values, spaces) stay the same. It writes a new file in the same folder and then renames it over the old one, with the same permissions. If `settings.json` is a link, the file that it points to changes. It keeps the file before this change as `settings.json.bak-iui`, only when it changed the file. Step 3 (`claude plugin marketplace add` and `install`) changed `settings.json` already, so the backup undoes only the auto-update change, not step 3. If the file is not there, it makes it. If `autoUpdate` is `true` already, it changes nothing. If `autoUpdate` is `false` (you selected **Disable auto-update**), the script keeps it, says that auto-update is off by your choice, and tells you how to turn it on. When it adds the marketplace again from GitHub (step 3), it keeps `"autoUpdate": false` for the new entry. If the file is read-only, or has more than one name (a hard link), the script does not change it. If the `razorback16` entry has another `source`, the script does not change the file. If the file is not valid JSON (for example, it has comments), the script changes nothing, shows the entry to add, and ends with exit code 1. It uses `perl` (no modules) to read and change the JSON. It never uses `sed` on JSON.
5. **Pictures in iTerm2 and herdr.** Claude Code shows pictures in iTerm2 and herdr only when `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` is set when it starts. If iTerm2 is installed (macOS: `/Applications/iTerm.app`, `~/Applications/iTerm.app`, or Spotlight finds it) or `herdr` is there (on the `PATH` or in the folders of step 2), the script adds the mod's own block, the same that `/iui setup` adds, to the start file of your login shell (from `SHELL`): `${ZDOTDIR:-~}/.zshrc` for zsh; for bash, `~/.bashrc` on Linux, and on macOS the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists (a login bash reads only that one; the script makes `~/.bash_profile` only when none exists); `${XDG_CONFIG_HOME:-~/.config}/fish/conf.d/cc-intelligent-ui.fish` for fish. The block is between the lines `# >>> cc-intelligent-ui: Claude Code pictures in iTerm2 >>>` and `# <<< cc-intelligent-ui <<<`. It sets the variable in iTerm2 and herdr only, not in tmux or screen. An older block of the mod is replaced, not added again; if the block is there already, nothing changes. If the file is a link, the file that it points to changes. The script writes a new file in the same folder and renames it over the old one, with the same permissions, and keeps the old file as `<file>.bak-iui`. If the file can not be read, is not a regular file, is read-only, has more than one name (a hard link), or is larger than 4 MB, the script changes nothing, shows the lines to add, and ends with exit code 1. For another shell, it changes nothing and shows the line to add. Undo: `/iui setup remove` in Claude Code, or delete the marked lines.
6. **Summary.** What was installed or updated, where Typst is, the state of auto-update and of the shell setup, and how to undo each step.

Options (environment variables):

- `IUI_NO_TYPST=1`: no Typst step. The script does not look for Typst and downloads nothing.
- `IUI_NO_AUTO_UPDATE=1`: no auto-update step. `settings.json` does not change.
- `IUI_NO_SHELL_SETUP=1`: no shell setup step (5). No shell start file changes.

For example: `curl -fsSL https://intelligentui.art/install.sh | IUI_NO_TYPST=1 bash`.

The script never uses `sudo` and runs no downloaded code other than the Typst program that it checked. All its work is in functions that the last line runs, so a download that stops in the middle runs nothing. Its output is plain text.

To undo:

- The mod: `claude plugin uninstall cc-intelligent-ui@razorback16`
- The marketplace: `claude plugin marketplace remove razorback16`. Claude Code also removes the `razorback16` entry of `extraKnownMarketplaces` from your settings.
- Only auto-update: in Claude Code, type `/plugin`, go to **Marketplaces**, select **razorback16**, then select **Disable auto-update**. In Claude Code 2.1.307, this also sets `"autoUpdate": false` in the settings file that declares the marketplace. Or copy `settings.json.bak-iui` back to `settings.json` (it is the file before the auto-update change only).
- The old marketplace source, if the script replaced it: `claude plugin marketplace remove razorback16`, then `claude plugin marketplace add <old source>` (the script shows the old source).
- A copy from another marketplace that the script uninstalled: `claude plugin install <id> --scope user` (the script shows the id).
- Typst, if the script installed it: `rm ~/.local/bin/typst`
- The shell setup: `/iui setup remove` in Claude Code, or delete the lines from `# >>> cc-intelligent-ui` to `# <<< cc-intelligent-ui <<<` in the start file that the script names.

### By hand

1. Install Typst: `brew install typst` on macOS. On Linux, refer to [Install Typst on Linux](#install-typst-on-linux). For all the ways, refer to [Typst's install page](https://github.com/typst/typst#installation).
2. At the prompt of a Claude Code session in the terminal, type:

   ```
   /plugin install cc-intelligent-ui --marketplace razorback16/cc-intelligent-ui
   ```

   Answer `y` to add the marketplace, then push Enter to install for your user. The mod starts at once, with no restart.

From a shell:

```
claude plugin install cc-intelligent-ui --marketplace razorback16/cc-intelligent-ui
```

## Install Typst on Linux

You need Typst 0.15 or later. Use one of these ways:

- **Cargo** (Rust): `cargo install --locked typst-cli`. Typst goes into `~/.cargo/bin`.
- **The release file:** download `typst-x86_64-unknown-linux-musl.tar.xz` (or `typst-aarch64-unknown-linux-musl.tar.xz` for ARM) from [the Typst releases](https://github.com/typst/typst/releases). Extract it and put `typst` in a folder on your `PATH`, for example `~/.local/bin`.
- **A package of your distribution, Snap (`sudo snap install typst`) or Homebrew on Linux (`brew install typst`).** Make sure that the version is 0.15 or later (`typst --version`). Some distributions have an older version.

The mod finds Typst on the `PATH` of your login shell. It also looks in `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `~/.cargo/bin`, `~/.local/bin` and the Homebrew folders.

## Linux

The mod works on Linux with X11 and with Wayland. It uses these tools. Most Linux systems have the first three.

- **perl** (perl 5): reads the terminal size and its cell size, and watches for a change of the size. It also writes the frame files of the highlight for picture select (with `MIME::Base64`, a core module). On macOS, `/usr/bin/perl` also watches the clipboard for the `/iui grab` toast, with Apple's PerlObjCBridge (macOS has it).
- **fontconfig** (`fc-match`, `fc-list`): finds the terminal font when the terminal's config does not name one. kitty and most terminals use fontconfig's `monospace` font. Ghostty uses its own JetBrains Mono when its config names no font. If fontconfig does not have JetBrains Mono, the mod copies the font from the Ghostty program (refer to [How it works](how-it-works.md)). The mod also uses `fc-list` to find if the font that the terminal config names is installed.
- **The light or dark mode of the desktop** (for the `auto` theme): the freedesktop portal (`org.freedesktop.appearance color-scheme`, through `gdbus` or `busctl`). GNOME, KDE Plasma and most desktops have the portal. If the portal does not answer, the mod reads GNOME's `color-scheme` (`gsettings`).
- **The clipboard** (only for the `/iui grab` toast and for `/iui grab` on the main screen, refer to [Picture cells on the clipboard](usage.md#picture-cells-on-the-clipboard)). The mod uses the first of these that it finds:
  1. **Wayland, not GNOME:** `wl-paste` from `wl-clipboard`. `wl-paste --watch` tells the mod about each clipboard change. It needs the data-control protocol of the compositor (KDE Plasma, Sway, Hyprland and other wlroots compositors have it).
  2. **X11, and GNOME on Wayland (through Xwayland):** `clipnotify` tells the mod about each clipboard change, and `xclip` reads the clipboard. If `clipnotify` or `xclip` is not installed, the mod uses GTK 3 from Python (`python3-gi`, which most GNOME desktops have) in its place. The mod does not use `xsel`: it cannot show the targets of a copy, so it cannot skip a password manager's copy (`/iui details` tells you to install `xclip`).
  3. **GNOME on Wayland with no X11 tool:** `wl-paste`. GNOME does not have the data-control protocol, so `wl-paste --watch` stops, and there is no `/iui grab` toast.

  If none of these work, there is no `/iui grab` toast. Picture select, `/iui grab` (with a selection, in fullscreen mode), Claude Code's `/copy` and the `ui.copy` hook still work. `/iui details` shows the tool in use, or why there is no toast, on the line `/iui grab hint:`.
- **"Edit the plan"** (refer to [Plan approval](usage.md#plan-approval)): VS Code (`code --wait`), else the first of VSCodium, Zed, Sublime Text, Kate, gedit and gvim that is on the `PATH`. These editors can wait until you close the file. If none is installed, the option does not show.
- **The cache folder** is in `$TMPDIR`, else in `/tmp`.

`/iui setup` is for iTerm2 and herdr. On Linux it changes no file, but in a herdr pane it adds the line (to `~/.bashrc` for bash, because herdr does not start a login shell on Linux).

To install the clipboard tools, for example:

- Debian and Ubuntu: `sudo apt install wl-clipboard xclip` (`clipnotify` is not in their packages: build it from [cdown/clipnotify](https://github.com/cdown/clipnotify), or use GTK 3 from Python: `sudo apt install python3-gi gir1.2-gtk-3.0`).
- Fedora: `sudo dnf install wl-clipboard xclip`.
- Arch Linux: `sudo pacman -S wl-clipboard xclip clipnotify`.

## Update

Claude Code finds a new version of the mod from the version number in its `plugin.json`. For a marketplace that is not from Anthropic, such as `razorback16`, auto-update is off by default.

### Turn on auto-update

The [install script](#the-install-script) turns it on for you. To turn it on yourself:

1. In Claude Code, type `/plugin`.
2. Go to **Marketplaces**, then select **razorback16**.
3. Select **Enable auto-update**.

Claude Code then updates the mod in approximately 10 minutes after the first message of a session. The new version starts in the next session, or after you type `/reload-plugins`.

### Update manually

Run the [install script](#the-install-script) again, or, from a shell:

```
claude plugin marketplace update razorback16
claude plugin update cc-intelligent-ui@razorback16
```

Then type `/reload-plugins` in Claude Code, or start a new session.

### The update notice

The mod looks for a new version one time each day at most, after a session starts. When there is a newer version, a toast shows the new version, your version and the update commands. A toast for one version shows one time each day at most. `/iui` and `/iui details` also show the new version.

- Network use: one GET request for a public file on GitHub (`https://raw.githubusercontent.com/razorback16/cc-intelligent-ui/main/.claude-plugin/plugin.json`) each day at most. The mod sends no data about you or your sessions. The request goes through Claude Code.
- `/iui updates off` stops the check and the toast (kept for later sessions). `/iui updates on` starts them again.
- The mod does not look for a new version when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_UPDATES` or `DISABLE_AUTOUPDATER` is set, in a background session, or with `claude -p`.

## Try it from a clone

To try it from a clone without installing:

```
git clone https://github.com/razorback16/cc-intelligent-ui
claude --plugin-dir /path/to/cc-intelligent-ui
```
