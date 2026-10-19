# How it works

← Back to the [README](../README.md)

## The steps

1. A `ui.render` hook on `AssistantMessage` gets each block of the answer as Markdown.
2. While Claude writes a block, the block is hidden. The block is final when the model request starts its next block (a tool call, more text) or ends. If the mod did not see the request, the block is final after its text stops changing for 400 ms. Then the mod writes the block to a JSON file and runs `typst compile` with `render/md.typ`. For plain text, Typst loads only some fonts (refer to [The lean font set](#the-lean-font-set)). Long answers are cut at block boundaries into pages. One page is one PNG.
3. The hook draws one `Image` per PNG, in place of the text.
4. Text size: the mod finds the terminal font (iTerm2 profile, Ghostty, kitty or Rio config, else Menlo metrics) and the cell size in pixels. Typst then measures both fonts so that 100% looks as large as the terminal text.
5. If a compile fails (a bad Typst block or an unknown LaTeX command), the mod compiles once more in safe mode: Typst blocks and math show as code. A dim line under the picture names the error. If that also fails, the normal text shows.
6. Pictures are kept in `${TMPDIR}/cc-intelligent-ui-<uid>/`. Folders older than 2 days are deleted at start. The drawing space of each answer at its first compile is kept in `~/.cache/cc-intelligent-ui/designs`, so that its Typst drawings keep the same share of the screen in later sessions.
7. Links: the mod finds the web links, file paths and commands in the Markdown (not in code blocks or math). It draws one dim row for each under the pages, with a `Link` (an OSC 8 link) for a web link or a file, and a `Button` that copies a command (`$.ui.copy`). It keeps a file row only when the file exists (`$.fs.exists`, kept in memory for 512 paths). Each row is one terminal row, cut at its end. The copy (step 9) counts these rows under the pages, so it still finds the page that you select.
8. The plan: a `ui.render` hook on the ExitPlanMode `ToolUse` row draws the plan through the same steps. Claude Code shows that row above the approval question. The approved result row then shows only its header, so the plan does not show two times. A `tool.call` hook on ExitPlanMode asks the mod's question (`$.ui.ask`) before Claude Code asks for permission. Then a `classic.PermissionRequest` hook gives the answer to Claude Code at once, so the Claude Code dialog does not show. For an approval, the hook sends the plan (`updatedInput`) and the new permission mode (`setMode`). For the person's text, the `tool.call` hook refuses the call with that text.
9. Copy: one long-lived `perl` process watches the terminal size (at each SIGWINCH) and, on macOS, the clipboard. For the clipboard, it uses `/usr/bin/perl` with Apple's PerlObjCBridge and reads the change counter of the clipboard (`NSPasteboard changeCount`) every 0.3 s. This read is in the process and starts no other process (approximately 0.05% of one CPU core). The clipboard part starts only while the mod is on and after the mod drew its first picture in this session; then the mod starts the process again with the clipboard part (and again without it after `/iui off`). When the counter changes, the mod reads the clipboard one time (`pbpaste`). The first counter after a start is not a change, so an old clipboard is not copied. A picture cell holds its row and its column (kitty placeholder U+10EEEE plus two combining marks). The mod finds the drawn page that has these rows, at the size that it is drawn. Then it finds the position of each word on that page: it runs the probe (`typst query` on the same template, with the same inputs as the PNG compile, plus `probe=1` and `page=<n>`) for the selected pages only. The mod keeps the positions of the last 64 pages in memory. It writes nothing to disk for this, and the PNGs do not change. The mod takes the words in the selected cells. Immediately before it writes the text with `$.ui.copy`, it reads the clipboard again. If the clipboard has a newer copy, the mod does not write over it, and it reads that copy next. If the process stops, the mod starts it again after 1 s (3 times at most). At `/clear` or a resume, the process continues without the clipboard part. At other session ends (for example `/exit`), the mod stops the process and does not start a new one. A `ui.copy` hook also changes a copy with picture cells to the text.

## The lean font set

At each start, Typst reads all the fonts of the computer. On macOS, this is approximately 70 ms of each compile. Plain text does not need most of these fonts. Plain text has only ASCII characters, no math outside code, no live Typst block, no image and no HTML entity. In the answers that we measured, approximately 3 of 4 blocks are plain text.

For plain text, Typst loads only these fonts:

- The terminal font.
- The body fonts and the code fonts of the theme, but not the CJK fonts and the emoji fonts.
- The fonts in Typst (for example, the math font).

The mod puts links to these font files in one folder in the cache (`fonts-<hash>`). It gives Typst `--ignore-system-fonts --font-path <folder>`. Then a block of plain text compiles in approximately 0.03–0.07 s, not 0.1–0.15 s. The PNG does not change. For ASCII text, Typst takes each character from the first font of the list that has it, and that font is in the folder. Other text can need a character that no font of the list has. Then Typst looks in all the fonts of the computer, so other text compiles with all the fonts.

The mod makes the folder one time in each session, after the first compile of plain text. `typst fonts --variants` gives the files. The mod does not use the folder in these conditions:

- The first installed font of a list is a CJK font or an emoji font.
- A list has no installed font.
- One style of a font is in two files (then the order in which Typst reads the files can change the font that it uses).
- The list markers or the numbering of the theme are not ASCII.

If a compile with the folder fails, the mod compiles again with all the fonts. The probe of a copy (step 9) uses the same fonts as the PNG compile. If the folder is not there (the cleanup at start deletes folders that are older than 2 days), the mod uses all the fonts and makes the folder again.

## How `auto` is resolved

Claude Code finds the light or dark mode for `auto` by asking the terminal for its background colour (OSC 11). A mod cannot see that answer, so Intelligent UI uses these sources, in this order. The first source that gives an answer is used:

1. **The iTerm2 profile:** the background colour of the profile in use (`ITERM_PROFILE`, else the default profile). Intelligent UI finds iTerm2 by `TERM_PROGRAM`. If `TERM_PROGRAM` is not set, `ITERM_PROFILE`, `ITERM_SESSION_ID` or `LC_TERMINAL=iTerm2` also show iTerm2. If the profile has separate colours for light and dark mode, Intelligent UI uses the set for iTerm2's theme (Settings > Appearance). If that theme is Automatic, Minimal or Compact, it uses the set for the OS appearance.
2. **The Ghostty config:** the `background` that `ghostty +show-config` gives. With a `theme = light:A,dark:B`, Intelligent UI reads the background from the theme file for the OS appearance. With no theme and no `background`, it uses Ghostty's default (`#282c34`, dark).
   - **cmux** (Ghostty inside, found by its `CMUX_*` variables) reads the same Ghostty config, then its own config, `~/Library/Application Support/com.cmuxterm.app/config.ghostty`. The cmux themes picker (Settings > Themes, `cmux themes`) writes the theme there, and that theme wins over the Ghostty config's. A `light:A,dark:B` theme follows cmux's appearance (see below). If these configs set no `theme`, `background`, `foreground` or `palette`, cmux uses its adaptive default theme. Intelligent UI then uses cmux's appearance: `app.appearance` in `~/.config/cmux/cmux.json`, else the value in cmux's Settings. If that appearance is System, Intelligent UI uses the OS appearance. If `terminal.adaptiveDefaultTheme` is `false` in `cmux.json`, Intelligent UI uses the Ghostty rules above.
3. **The kitty config:** the `background` in `kitty.conf` and in the files that it includes (`include` lines only). The themes kitten writes such an include. If the config folder has `dark-theme.auto.conf`, `light-theme.auto.conf` or `no-preference-theme.auto.conf` (kitty 0.38 and later), Intelligent UI uses the file for the OS appearance, as kitty does. With no `background`, it uses kitty's default (`#000000`, dark). The config folder is `KITTY_CONFIG_DIRECTORY`. If that is not set, it is the first of `$XDG_CONFIG_HOME/kitty`, `~/.config/kitty` and (on macOS) `~/Library/Preferences/kitty` that has a `kitty.conf`.
4. **The Rio config:** `config.toml` in `RIO_CONFIG_HOME`, else in `~/.config/rio` (on Linux, `$XDG_CONFIG_HOME/rio` if that is set). With an `[adaptive-theme]`, Intelligent UI reads the theme file for `force-theme`, else for the OS appearance. Else it reads the file for `theme`, else the `[colors] background`. Theme files are in the `themes` folder. With no background, it uses Rio's default (`#0F0D0E`, dark).
5. **`COLORFGBG`**, as it was when Claude Code started. Ghostty does not set it.
6. **The OS appearance:** macOS Dark or Light, or GNOME's `color-scheme` on Linux.
7. **Dark.**

The terminal comes before the OS: a dark terminal on a light Mac is dark.

Intelligent UI checks every 3 s. After a change, each mode's pictures compile once. `/iui probe` asks the terminal for its background with OSC 11 (5 times) and shows the raw answers. This is a test of whether the answer can reach the mod. The 3 s check does not use OSC 11 yet.
