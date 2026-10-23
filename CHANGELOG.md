# Changelog

All releases of Intelligent UI for Claude Code (`cc-intelligent-ui`). Claude Code finds a new version by the `version` in `.claude-plugin/plugin.json`. To get it, refer to [Update](docs/install.md#update).

## 0.3.3 (2026-10-22)

### New

- **A preview of pasted images above the prompt box.** When you paste an image (`[Image #N]`), a small preview of it shows above the prompt box before you send the prompt, with its number (`#N`) at its left. Typst makes a copy of the image that fills the cells of the preview. The previews show side by side, approximately 5 rows tall. When you delete the `[Image #N]` text, or send or clear the prompt, the preview goes away. Refer to [Preview of pasted images](docs/usage.md#preview-of-pasted-images).
- **herdr support** (the terminal multiplexer). In a herdr pane, Claude Code needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` to show pictures. The mod asks one time to add the shell line, as in iTerm2. `/iui setup` also adds it. Then close the pane and open a new herdr pane. herdr must run in a terminal that shows kitty pictures (kitty, Ghostty or iTerm2). Refer to [Terminals](docs/install.md#terminals).
- **herdr in iTerm2.** iTerm2 shows each row of a herdr picture from the bottom of the image, so the rows of a page showed in the wrong order. When the herdr client in use is iTerm2, the mod stores the bands of rows of each page and picture in reverse order. Then iTerm2 shows them in the correct order. `/iui details` shows `pages and pictures stored upside down by rows` when this is on. It does not work with `herdr --remote` in iTerm2.
- `/iui setup` works in herdr on Linux too.
- `/iui details` names herdr, its version, the terminal that it runs in and how the mod found that terminal, for example `herdr 0.9.5 (in kitty, the terminal in front)`. If the mod uses the variables of the herdr server, it shows `(in Ghostty, from the server's start)`.
- **A one-line installer.** `curl -fsSL https://intelligentui.art/install.sh | bash` checks the system and Claude Code, installs Typst 0.15.1 when no Typst 0.15 or later is found (the official release from GitHub, checked against a SHA-256 in the script, into `~/.local/bin`), adds the `razorback16` marketplace and installs the mod with the `claude plugin` commands (a `razorback16` marketplace from another source, such as a fork, a pinned ref or a local folder, is added again from GitHub; a second user copy from another marketplace is uninstalled), and turns on auto-update for the marketplace in `~/.claude/settings.json` (`extraKnownMarketplaces`, with a backup of the file before the auto-update change; all other settings stay byte for byte; an `"autoUpdate": false` that you set stays). Run it again to update. It never uses `sudo`. When iTerm2 or herdr is there, it also adds the mod's `/iui setup` block to your shell's start file (with a backup). `IUI_NO_TYPST=1`, `IUI_NO_AUTO_UPDATE=1` and `IUI_NO_SHELL_SETUP=1` skip a step. Refer to [The install script](docs/install.md#the-install-script).

### Fixed

- **The newest copy wins.** A click, a picture selection's up, `/iui grab` and the `ui.copy` change of picture cells each read their text first. An older one that was still reading wrote the clipboard over a newer copy. Now it writes nothing when a newer copy came: a newer click or up, a `$.ui.copy` (another plugin's, or the command button of a link row), Claude Code's own copy of a selection, or a copy in another app. A `ui.copy` change that lost its turn is refused. `/iui grab`, a click on no target and an up with no text copy nothing and cancel no other copy. An older copy (a click, an up, `/iui grab` or a `ui.copy` change) waits for a newer click or up that still reads its text, so it never writes first and is then overwritten. A copy in another app counts from the time the clipboard changed, not from the time the mod read it.
- **A password manager's copy is never read.** On macOS the mod reads the clipboard with a short `perl` script (PerlObjCBridge) in place of `pbpaste`, and stops at a copy with a concealed or transient type. On Linux, `xclip`, `wl-paste` and GTK look for the `x-kde-passwordManagerHint` target before and after the read. On Wayland, a copy marked sensitive was skipped already.
- **The code in an answer can read no other file.** Each compile of an answer or a plan had `/` as its Typst root, so a Typst block could read any file (`read`, `include`, `image`, `json`, `csv`), and `read("/dev/zero")` used all the memory. Now each compile runs in a root of its own, with only the template, the theme and the answer's images. The skill's `check.sh` does the same, and it stops with an error when its cache folder is a link or not yours. Pictures are the same as before.
- `/iui setup` with bash on macOS writes the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists. Before, it made `~/.bash_profile`, and a login bash then no longer read `~/.profile`.
- In a session that shows pictures already, `/iui setup` says so, not to open a new tab.
- `/iui setup`, `/iui setup remove` and the setup question never write a shell start file that they cannot read (no permission, or too large). Before, such a file was replaced with only the Intelligent UI block. Now the mod changes no file and shows the line to add.
- **Plan mode:** when Claude Code runs two `ExitPlanMode` calls at once, the mod does not ask its question, so the answer for one plan can not go to the other (a rejected plan was allowed). Claude Code's own dialog asks.
- `/iui theme` runs one at a time: an older `/iui theme` that was still loading no longer sets its theme over a newer one. A setting that you change with `/iui` while the mod starts is kept (before, the start set it back to the stored value).
- A long session no longer keeps the last text of each answer in memory: the mod keeps the newest 1,024, as it does for the compile results.
- The picture select highlight could stop on a page whose frames went out of the page cache while its build waited. That page is now built again.
- The watcher no longer sends `kill` to the PID of a child that ended (the PID can be another process's).
- On Linux, the GTK clipboard read, watch and check run Python isolated (`-I`): a `gi.py` in the session's project folder no longer runs.
- When `$.ui.selection()` fails, a `ui.copy` of picture cells and `/iui grab` copy again (before, they said that a newer copy came first).
- A clipboard read that fails (an error or the 2 s timeout), or a late read of one of the mod's last 4 copies, no longer cancels a newer copy.
- In herdr, the mod now uses the font and the background of the terminal that herdr runs in (Ghostty, kitty, iTerm2, cmux or Rio). Before, it used Menlo and the OS appearance, so the text could be dark on a dark background.
  - With the `auto` theme, the background comes from herdr: herdr gives the background of the terminal in front (OSC 11). This also works with `herdr --remote`. If an answer does not come, the mod keeps the last background for up to 2 more checks.
  - The font comes from the herdr client that you use. You can attach to one herdr server from more than one terminal, for example from Ghostty and from kitty. On macOS, the mod uses the client in the terminal app in front. When the app in front is not a terminal (for example a browser), it keeps the last client. On Linux, and between two clients in the same app, it uses the client where you typed last. When you change to a different terminal, the mod finds it at the next check (every 1 s), reads its font and draws the pictures again. If the mod cannot find the client, it uses the variables of the terminal that started the herdr server.
- In herdr, a tall page of a long answer did not show (herdr does not send an image that is too large to the terminal). Refer to [Limitations](docs/limitations.md).
- At a page break between two blocks (for example a paragraph and a list, or a table and a heading), the next page starts with the same gap as in one page. Before, the gap was lost. With the row grid off, the gap can be up to 1 row larger.

### Changed

- On Linux, `xsel` no longer reads the clipboard: it cannot show the targets of a copy, so it cannot skip a password manager's copy. Install `xclip` (or GTK 3 for Python); `/iui details` tells you.
- The README has a **Privacy and access** section: the network request, the clipboard reads and writes, the files, the processes and the Typst root.
- The shell line of `/iui setup` sets the variable in iTerm2 and in herdr. `/iui setup` replaces the line of an older version. In herdr, the mod asks to update an older line. In iTerm2, the older line still works, and the mod does not ask.
- In herdr, pages are shorter, so that each page is at most 16 MiB as pixels.
- **Pasted images in the transcript look the same as their preview.** After you send the prompt, the images show under it side by side, approximately 5 rows tall, with no number. They do not use `/iui height` now (sent images and Typst drawings still do). Claude Code's own `[Image #N]` rows stay under them.

## 0.3.2 (2026-10-21)

### New

- **Links, file paths and commands in the pictures are live** (picture select, fullscreen mode). Move the pointer over one: its cells show on the selection colour. A click copies it: a web link its URL, a file path its full path, a command the full command (toasts "copied the link", "copied the path", "copied the command"). A command is any inline code (for example `` `git status` ``; `` `! cmd` `` copies only `cmd`); a code block is not a target. A drag that starts on one still selects text. Refer to [Click a link, a file or a command](docs/usage.md#click-a-link-a-file-or-a-command).
- **Code blocks have a header with the language and a copy button.** A click on the button copies all the code of the block (toast "copied the code"; picture select, fullscreen mode). A code block is only as wide as its code needs, at most the width of the page. A code block in a live Typst drawing has no header.
- **A copy includes inline math** as its LaTeX source, for example `$A = \pi r^2$`. The mod copies the full equation when the selection covers its middle. Display math is not copied.
- `IUI_DEBUG=1` writes a `select: click` line with the target of each click, and a `select: hover` line when the target under the pointer changes.

### Changed

- A copy that starts at a list item's first word does not copy its marker (`- `, `1. `). The marker is copied when the selection covers it.
- Where the pages take picture select, the dim link rows under the pictures do not show (the links are in the picture). On the main screen, over ssh, before Claude Code 2.1.298 and with `/iui select off`, they show as before.

## 0.3.1 (2026-10-21)

### New

- **Picture select.** In fullscreen mode, with Claude Code 2.1.298 or newer, the mod selects the text of a picture itself. Drag over the picture: the selected cells show on a blue background (VS Code's selection colour), and when you release the button, the mod copies their text and shows the toast "copied N chars of text". A click with no drag removes the selection. A selection can go on into the next page of the same answer. The highlight swaps the page's picture with `$.ui.blit` (a frame with the selected cells tinted), so the layout never changes. `/iui select off` turns it off. Refer to [Picture select](docs/usage.md#picture-select-claude-code-21298-or-newer).
- **Pages ready in the background.** When a page is drawn or comes on the screen, the mod decodes it and finds its words in the background, in short slices, so scrolling and drawing continue. Thus the first highlight and the copy at the button's up do not wait. Refer to [The page cache](docs/how-it-works.md#the-page-cache).
- **More ways to remove a picture selection:** a key typed in the prompt, and a new selection of Claude Code (normal text). A single click on normal text does not remove it (Claude Code tells a mod nothing about it), and Escape does not either. Refer to [Limitations](docs/limitations.md).

### Changed

- The automatic copy of 0.3.0 is gone: the mod does not write the clipboard after a copy of picture cells in fullscreen mode. Picture select copies the text of pictures. A copy that still gives picture cells (the main screen, a selection of Claude Code that starts outside a picture) gets a toast that names `/iui grab`, and the clipboard does not change.
- `/iui details` shows the lines `Picture select:` and `/iui grab hint:` in place of `Auto copy:`.
- If the private cache folder cannot be used (a link, not a folder, or not yours), the mod draws nothing and tells you why in `/iui`, `/iui details` and a toast. Before, it used the shared folder `/tmp/cc-intelligent-ui`.

### Fixed

- **Rio:** the pictures use Rio's own font, Cascadia Code NF. This font is inside the Rio program, so Typst did not have it and drew the theme's fonts. Now the mod copies the font from the program, as it does for Ghostty's JetBrains Mono. A font in Rio's config that is not installed also gives Rio's own font, because Rio draws that font.
- The terminal font is the font that the terminal draws, also when its config names a font that is not installed: Ghostty and cmux on macOS draw their JetBrains Mono, Ghostty and kitty on Linux draw the nearest font of fontconfig, kitty on macOS draws Menlo (also for a font that is not fixed-pitch), iTerm2 draws the user's fixed-pitch font. For a Ghostty `font-family` list, the first font of the list that is installed. kitty on macOS with no `font_family` now gives Menlo for body text too. A name in another case or spacing (for example `iosevkaterm`) gives the installed name, so that Typst finds the font.
- The font folder that the mod gives Typst goes after your own `TYPST_FONT_PATHS`. Before, it replaced it. An empty entry in `TYPST_FONT_PATHS` (for example `/a:`) no longer stops each Typst run.
- iTerm2: a profile font with font settings after its size (for example, ligatures off) is read. Before, the terminal font was not known.
- cmux: a `font-family` in cmux's own config (`config.ghostty` in its Application Support folder) is read.
- `/iui details` tells you when Typst does not have the terminal font.
- **Bold text in a terminal font with no bold face** (for example, Monaco in iTerm2): the pictures draw a fake bold, as the terminal does. Before, bold text in that font was drawn regular, because Typst does not make a bold face. Text in other fonts does not change. Refer to [Limitations](docs/limitations.md).
- Plan mode: when Claude changes the plan and asks for approval again in the same message, the picture shows the changed plan. Before, it showed the plan before the change.
- Picture select: a push of the button on a page that had just gone off the screen no longer waits for ever (no highlight until a reload).
- Picture select: two tall pages on the screen no longer make each other ready again and again (the page cache keeps the pages on the screen, and the page of the selection).
- Picture select: a drawing drawn again with new page files (a stream, a resize, a theme or size change) no longer keeps its old pages in the queue.
- Picture select: a slow copy no longer writes the clipboard after a newer copy.
- Picture select: a selection of many full rows no longer stops the hooks for up to 0.16 s; the tinted rows are made in the background, and a frame makes them for 6 ms at most.
- Picture select: a lost button up ends the drag; a reloaded Client is not ignored; a Client fault or a change to fullscreen mode takes effect at the next draw; `/iui off` and `/iui select off` let the page cache go; with no `perl`, the mod tries to write a frame one time only.

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
