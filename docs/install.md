# Install

← Back to the [README](../README.md)

## Requirements

- Claude Code 2.1.298 or later (tested on 2.1.301)
- [Typst](https://typst.app) 0.15 (tested on 0.15.1)
- macOS (tested). Linux can work, but it is not tested.
- A terminal where Claude Code draws pictures. Refer to [Terminals](#terminals).

## Terminals

- **kitty (0.28 or later), Ghostty and cmux (Ghostty inside):** pictures work with no setting.
- **iTerm2 3.6 or later (3.7.5 tested):** Claude Code needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` when it starts. A mod cannot set it early enough. The first time the mod runs in iTerm2, it asks to add one line to your shell's start file (`~/.zshrc`, `~/.bash_profile` or a fish `conf.d` file). The line sets the variable in iTerm2 only, not in tmux or screen. Then close the tab, open a new iTerm2 tab, and start Claude Code there. You can also run `/iui setup` (undo: `/iui setup remove`).
- **Rio 0.5.27 or later (not tested):** set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before you start Claude Code.
- Do not put the variable in the `env` of `~/.claude/settings.json`. It then applies in every terminal, also where pictures cannot show.
- **Not supported:** WezTerm, Warp and Konsole do not draw kitty pictures with Unicode placeholders, so they show no pictures, also with the variable set. Alacritty, Terminal.app, Windows Terminal, GNOME Terminal (and other VTE terminals), foot, VS Code, Tabby, Hyper and JetBrains terminals have no kitty pictures.
- **tmux and screen:** no pictures. Claude Code does not send pictures through tmux or screen, also with the variable set. Set `IUI_FORCE=1` to try anyway.
- **ssh:** pictures work when the terminal on your computer is kitty or Ghostty (`TERM` must come through ssh), or when you set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` on the remote computer. The mod sends each picture as data, because the terminal cannot read files on the remote computer. A page larger than 4096 pixels on a side or 2 MiB shows as text. An image of that size does not show.
- Background sessions (agent view, forks, `claude attach`) cannot draw pictures.

Where pictures cannot draw, the mod shows the normal text. To see why a terminal can or cannot show pictures, run `/iui details`.

## Install steps

1. Install Typst: `brew install typst` (or see [Typst's install page](https://github.com/typst/typst#installation)).
2. At the prompt of a Claude Code session in the terminal, type:

   ```
   /plugin install cc-intelligent-ui --marketplace razorback16/cc-intelligent-ui
   ```

   Answer `y` to add the marketplace, then push Enter to install for your user. The mod starts at once, with no restart.

From a shell:

```
claude plugin install cc-intelligent-ui --marketplace razorback16/cc-intelligent-ui
```

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
