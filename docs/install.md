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
   /plugin install intelligent-ui --marketplace razorback16/claude-intelligent-ui
   ```

   Answer `y` to add the marketplace, then push Enter to install for your user. The mod starts at once, with no restart.

From a shell:

```
claude plugin install intelligent-ui --marketplace razorback16/claude-intelligent-ui
```

## Try it from a clone

To try it from a clone without installing:

```
git clone https://github.com/razorback16/claude-intelligent-ui
claude --plugin-dir /path/to/claude-intelligent-ui
```
