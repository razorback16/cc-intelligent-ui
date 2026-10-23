<picture>
  <source media="(prefers-color-scheme: dark)" srcset="outcomes/out/hero-dark.gif">
  <source media="(prefers-color-scheme: light)" srcset="outcomes/out/hero-light.gif">
  <img alt="Claude Code: a prompt asks Claude to show what Markdown it can draw, and the answer draws as one rendered picture: a cover image, a heading, a table, LaTeX math, a code block with syntax colours, a task list and a note" src="outcomes/out/hero-light.gif" width="100%">
</picture>

# Intelligent UI for Claude Code

**Claude's answers, rendered.** Real Markdown, math, charts and diagrams, right in your terminal.

<sub>An independent, community-made mod for Claude Code. Not affiliated with Anthropic.</sub>

Intelligent UI draws each answer from Claude as a typeset picture, with [Typst](https://typst.app). Tables line up, equations look like a paper, and Claude can draw a chart or a diagram when a picture explains more than words. Only the drawing changes. The saved answer stays Markdown.

## Install

On macOS or Linux:

```
curl -fsSL https://intelligentui.art/install.sh | bash
```

It installs Typst if needed, installs the mod and turns on auto-update. Then restart Claude Code. Run it again to update. [What the script does](docs/install.md#the-install-script).

**By hand:** install [Typst](https://typst.app) 0.15 (`brew install typst`), then in Claude Code type `/plugin install cc-intelligent-ui --marketplace razorback16/cc-intelligent-ui`, and turn on auto-update in `/plugin`. [Install guide](docs/install.md).

Needs Claude Code 2.1.298 or later. Works best in fullscreen mode (`/tui fullscreen`).

## Terminals

| Terminal | Pictures |
|---|---|
| kitty 0.28+, Ghostty, cmux | Yes |
| iTerm2 3.6+, herdr | Yes, after `/iui setup` (the install script does it) |
| Rio 0.5.27+ | Yes, with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` (not tested) |
| ssh | Yes, from kitty or Ghostty |
| Warp, WezTerm | Not yet (waiting on [warp#16312](https://github.com/warpdotdev/warp/pull/16312), [wezterm#7924](https://github.com/wezterm/wezterm/pull/7924)) |
| tmux, screen, Terminal.app, Alacritty, VS Code, others | No: you see normal text |

`/iui details` tells you why pictures do or do not show. [All terminal details](docs/install.md#terminals).

![Claude explains why an API request is slow: a timing chart shows the DB query takes 310 of 450 ms, with Amdahl's law and a table of fixes, in a dark and a light terminal](outcomes/out/0-hero-2-latency.png)

## Features

- **Rendered Markdown:** headings, tables, task lists, quotes and highlighted code, in your terminal's font.
- **LaTeX math:** inline and display, typeset.
- **Diagrams, charts and plots:** Claude draws them live with Typst, in your theme's colours, offline.
- **Images and files:** images in answers, images and Markdown files that Claude sends, and a preview of images you paste, above the prompt box.
- **Copy answers as usual:** in fullscreen, drag over an answer to select and copy its text, as you do with normal text. Click a link, path or command to copy it. [How copy works](docs/usage.md#copy-text-from-a-picture).
- **Readable plans:** plan mode shows the plan rendered, with approve, edit and reject.
- **Light and dark themes:** Claude Code's colours or VS Code's, or your own.

## See it

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="outcomes/out/6-diagrams-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="outcomes/out/6-diagrams-light.png">
        <img alt="A flow chart of an agent loop and a commutative diagram of the First Isomorphism Theorem, drawn with fletcher in a Claude answer" src="outcomes/out/6-diagrams-light.png" width="100%">
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="outcomes/out/2-math-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="outcomes/out/2-math-light.png">
        <img alt="Typeset LaTeX math in Claude Code: the Gaussian integral, Maxwell's equations, a rotation matrix, a piecewise function, the Fourier transform and the Schrödinger equation" src="outcomes/out/2-math-light.png" width="100%">
      </picture>
    </td>
  </tr>
</table>

More in the [gallery](docs/gallery.md): plots, fractals and a tour of all the Markdown.

## Commands

| Command | What it does |
|---|---|
| `/iui` | State, and what keeps pictures away |
| `/iui on` / `off` | Pictures on or off |
| `/iui theme <name>` | `claude-code`, `vscode-modern`, `vscode` or your own |
| `/iui size <80–200>` | Text size, in percent |
| `/iui setup` | Turns pictures on in iTerm2 and herdr |
| `/iui grab` | Copies the text of your last selection of pictures |

All commands are in [Usage](docs/usage.md).

## Privacy

Nothing about you or your sessions leaves your computer. The mod makes one request a day at most, for its own public version number (`/iui updates off` stops it). It reads the clipboard only to help a copy or to find a pasted image path, skips password manager copies, and writes it only when you copy. Typst code in an answer cannot read your files. [Full details](docs/privacy.md).

## Docs

[Install](docs/install.md) · [Usage](docs/usage.md) · [Themes](docs/themes.md) · [How it works](docs/how-it-works.md) · [Limitations](docs/limitations.md) · [Privacy](docs/privacy.md) · [Development](docs/development.md) · [Gallery](docs/gallery.md) · [Changelog](CHANGELOG.md)

## Disclaimer

Intelligent UI is an independent project. It is not made, supported or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.

## Licence

MIT, see [`LICENSE`](LICENSE). The vendored Typst packages and the VS Code theme values keep their own licences: see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
