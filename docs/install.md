# Install

← Back to the [README](../README.md)

## Requirements

- Claude Code 2.1.298 or later (tested on 2.1.301)
- [Typst](https://typst.app) 0.15 (tested on 0.15.1)
- macOS (tested) or Linux with X11 or Wayland. The Linux parts are tested in a container, not yet on a Linux desktop. Refer to [Linux](#linux).
- A terminal where Claude Code draws pictures. Refer to [Terminals](#terminals).

## Terminals

- **kitty (0.28 or later), Ghostty and cmux (Ghostty inside, macOS only):** pictures work with no setting. kitty and Ghostty work on macOS and on Linux.
- **iTerm2 3.6 or later (3.7.5 tested, macOS only):** Claude Code needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` when it starts. A mod cannot set it early enough. The first time the mod runs in iTerm2, it asks to add one line to your shell's start file (`~/.zshrc`, `~/.bash_profile` or a fish `conf.d` file). The line sets the variable in iTerm2 and herdr only, not in tmux or screen. Then close the tab, open a new iTerm2 tab, and start Claude Code there. You can also run `/iui setup` (undo: `/iui setup remove`).
- **herdr (0.9.5 tested, in Ghostty and iTerm2):** herdr is a terminal multiplexer. It draws the pictures of its panes in the terminal that it runs in, so that terminal must show kitty pictures (kitty, Ghostty or iTerm2 3.6 or later). Claude Code needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` in herdr too. The first time the mod runs in a herdr pane, it asks to add the same line to your shell's start file. If the file has the line of an older version (iTerm2 only), the mod asks to update it. Then close the pane, open a new herdr pane, and start Claude Code there. You can also run `/iui setup` (undo: `/iui setup remove`). herdr works on macOS and on Linux.
  - herdr hides the name of the terminal that it runs in. With the `auto` theme, the mod gets the background from herdr: herdr gives the background of the terminal in front. This also works with `herdr --remote`.
  - For the font, the mod finds the herdr client where you typed last. You can attach to one herdr server from more than one terminal (for example Ghostty and kitty). The mod reads the variables and the terminal app of that client, then reads the font of that terminal. When you type in a different terminal, the mod finds it at the next check (every 3 s) and draws the pictures again with that font. If the mod cannot find a client, it uses the variables that herdr keeps of the terminal that started the herdr server (`GHOSTTY_RESOURCES_DIR` for Ghostty, `KITTY_PID` for kitty, `ITERM_PROFILE` for iTerm2). `/iui details` shows the terminal and how the mod found it, for example `herdr 0.9.5 (in kitty, the client you used last)` or `herdr 0.9.5 (in Ghostty, from the server's start)`.
  - Pages are shorter in herdr, so that herdr can send each one to the terminal. Refer to [Limitations](limitations.md).
  - In iTerm2, herdr sends each row of a picture as one part of the image, and iTerm2 counts the top of that part from the bottom of the image. Thus the rows would show in the opposite order. When the herdr client where you typed last is iTerm2, the mod keeps the rows of each page and each picture in an order that iTerm2 shows correctly. Picture select also works. When you type in a different terminal (for example Ghostty), the mod draws the pictures again in the usual order. `/iui details` then shows `pages and pictures stored upside down by rows`. With `herdr --remote` in iTerm2, the mod cannot find the client, so the rows of the pictures show in the wrong order. Refer to [Limitations](limitations.md).
- **Rio 0.5.27 or later (not tested):** set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before you start Claude Code. Rio works on macOS and on Linux.
- Do not put the variable in the `env` of `~/.claude/settings.json`. It then applies in every terminal, also where pictures cannot show.
- **Warp (not yet):** Warp does not draw kitty pictures with Unicode placeholders yet. The pull request [warpdotdev/warp#16312](https://github.com/warpdotdev/warp/pull/16312) adds them. The mod will support Warp when that pull request is merged.
- **WezTerm (not yet):** WezTerm does not draw kitty pictures with Unicode placeholders yet, so it shows no pictures, also with the variable set. The pull request [wezterm/wezterm#7924](https://github.com/wezterm/wezterm/pull/7924) adds them. The mod will support WezTerm when that pull request is merged.
- **Not supported:** Konsole does not draw kitty pictures with Unicode placeholders, so it shows no pictures, also with the variable set. Alacritty, Terminal.app, Windows Terminal, GNOME Terminal (and other VTE terminals), foot, VS Code, Tabby, Hyper and JetBrains terminals have no kitty pictures.
- **tmux and screen:** no pictures. Claude Code does not send pictures through tmux or screen, also with the variable set. Set `IUI_FORCE=1` to try anyway.
- **ssh:** pictures work when the terminal on your computer is kitty or Ghostty (`TERM` must come through ssh), or when you set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` on the remote computer. The mod sends each picture as data, because the terminal cannot read files on the remote computer. A page larger than 4096 pixels on a side or 2 MiB shows as text. An image of that size does not show.
- Background sessions (agent view, forks, `claude attach`) cannot draw pictures.

Where pictures cannot draw, the mod shows the normal text. To see why a terminal can or cannot show pictures, run `/iui details`.

## Install steps

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
  2. **X11, and GNOME on Wayland (through Xwayland):** `clipnotify` tells the mod about each clipboard change, and `xclip` or `xsel` reads the clipboard. If `clipnotify` is not installed, the mod uses GTK 3 from Python (`python3-gi`, which most GNOME desktops have) for both.
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

1. In Claude Code, type `/plugin`.
2. Go to **Marketplaces**, then select **razorback16**.
3. Select **Enable auto-update**.

Claude Code then updates the mod in approximately 10 minutes after the first message of a session. The new version starts in the next session, or after you type `/reload-plugins`.

### Update manually

From a shell:

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
