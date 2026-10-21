# Changelog

All releases of Intelligent UI for Claude Code (`cc-intelligent-ui`). Claude Code finds a new version by the `version` in `.claude-plugin/plugin.json`. To get it, refer to [Update](docs/install.md#update).

## Unreleased

### New

- **Picture select.** Since Claude Code 2.1.305, the mouse selection of Claude Code skips pictures: no highlight and no text. In fullscreen mode, the mod now selects the text of a picture itself. Drag over the picture: the selected rows show on a blue background, and when you release the button, the mod copies their text and shows the toast "copied N chars of text". A click with no drag removes the selection. This needs Claude Code 2.1.305 or newer. `/iui select off` turns it off. Refer to [Copy text from a picture](docs/usage.md#copy-text-from-a-picture).

### Changed

- **The automatic copy asks its own session.** The mod puts small shims of Claude Code's clipboard tools (`pbcopy`; `wl-copy`, `xclip`, `xsel`) first on the `PATH` of the Claude Code process, in a folder of that process only. When Claude Code copies picture cells, the shim asks the mod of its session for their text through a private FIFO, and the real tool gets that text. The shim waits 1.5 s at most; then it uses the cells, and a toast names `/iui grab`. The mod never writes the clipboard for a copy that it did not answer. Thus a copy of a different session is never changed, also when it has the same cells. Before, the mod read the clipboard after the copy and used the mouse selection: a session with an old selection of the same cells changed the copy of a different session. Refer to [Clipboard shims](README.md#clipboard-shims).
- A copy of picture cells that is not from this session gets the `/iui grab` toast, also in fullscreen mode.
- `/iui details` says why the automatic copy is off when the shims cannot work (ssh, a background session, a terminal with no pictures, no `perl`, or Linux with no `wl-copy`, `xclip` or `xsel`).

## 0.3.0 (2026-10-20)

### New

- **The `intelligent-ui` skill.** Claude loads it before it draws a complex or unusual drawing, or after a drawing failed. It has:
  - References for the Typst language, fletcher, CeTZ, cetz-plot plots and cetz-plot charts, with 53 examples that compile in light and dark mode.
  - Recipes for drawings that the packages do not have: candlestick, ratio bars, heatmap, gantt, waterfall and more.
  - `check.sh`, which compiles a drawing with the real template, your theme and your terminal size, in light and dark mode. It gives each error with its line in the drawing, and a picture that Claude looks at before it answers.

  Normal answers and simple drawings do not load the skill. Refer to [Usage](docs/usage.md).
- **More visual answers.** Claude is told to draw a process, a structure, a timeline or data when a picture explains more than words. The system prompt has three short examples (a flow chart, a timeline and a plot) and the rules that keep drawings readable in light and dark mode.
- **Tables like Claude Code's own.** The `claude-code` theme draws a full grid around tables (`table.style` in a theme).

### Changed

- Body text uses the terminal's font, at the terminal's size.
- Ghostty and cmux: the text size does not include the window padding. When the Ghostty config names no font, the mod uses Ghostty's own JetBrains Mono.
- The first line of an answer is not on the row grid. It uses the theme's padding.
- Each live Typst block must import the packages that it uses.

## 0.2.3 (2026-10-19)

### Changed

- On the main screen, the mod does not change the clipboard by itself. A toast names `/iui grab`, which copies the text of the pictures that you selected.
- Fullscreen mode is recommended. A one-time toast says this, and the README says how to turn it on (`/tui fullscreen`).

## 0.2.2 (2026-10-19)

### New

- SVG files that Claude sends draw under their row.
- PDF files that Claude sends draw one page under their row, with ‹ page › controls.

### Fixed

- Multi-line labels in live Typst drawings do not overlap on the row grid.
- With more than one Claude Code session open, a fullscreen session does not write over the copy of another session.

## 0.2.1 (2026-10-18)

### New

- **Linux** (X11 and Wayland): the clipboard watch (`wl-paste`, `clipnotify` or GTK), light or dark mode from the desktop portal, the terminal font from fontconfig, and plan editors. Refer to [Install](docs/install.md#linux).
- `/iui` typeahead: the subcommands show as you type.

### Changed

- Plain text compiles about 3 times faster: Typst loads only the fonts that it needs.
- A simpler `/iui theme` listing, with one mark for the theme in use.

### Fixed

- Fonts with no x-height value (for example DejaVu Sans Mono and Andale Mono) are not drawn too large.
- Copied text keeps its spaces with all fonts (Noto Sans lost them).

## 0.2.0 (2026-10-18)

### New

- **The row grid** (`/iui grid on|off`, on by default). Each line of text in a picture is on the terminal's rows, so a mouse selection covers the text.
- **Link rows.** The web links, file paths and commands of an answer show in rows under its picture. A cmd+click opens a link. A click on a command copies it.
- **Update notice.** A daily check for a new version shows a toast. `/iui updates off` stops it.

### Changed

- The `claude-code` theme draws code blocks with no background and a thin border, so the selection shows through them.

## 0.1.0 (2026-10-17)

The first release.

- Claude's answers draw as rendered Markdown pictures, with [Typst](https://typst.app): headings, tables, task lists, block quotes, code with syntax colours, and LaTeX math.
- Live diagrams, charts and plots: Claude writes Typst blocks with CeTZ, cetz-plot and fletcher, which work offline.
- Images in an answer, and JPEG, WebP and Markdown files that Claude sends, draw in the transcript.
- In plan mode, the plan draws rendered, with an approve, edit or reject question under it.
- Copy text from the pictures with the mouse.
- Themes that follow light and dark mode: `claude-code` (the default), `vscode-modern`, `vscode`, or your own.
- Pictures use the full terminal width. Resizing and scrolling do not jitter.
- The `/iui` command: `on`, `off`, `theme`, `size`, `details`, `setup`, `grab` and `dump`.
- Terminals on macOS: kitty 0.28+, Ghostty, cmux, iTerm2 3.6+ (after `/iui setup`), and Rio 0.5.27+ (not tested). Over ssh from kitty or Ghostty.
