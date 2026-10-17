# How it works

← Back to the [README](../README.md)

## The steps

1. A `ui.render` hook on `AssistantMessage` gets each block of the answer as Markdown.
2. While Claude writes a block, the block is hidden. The block is final when the model request starts its next block (a tool call, more text) or ends. If the mod did not see the request, the block is final after its text stops changing for 400 ms. Then the mod writes the block to a JSON file and runs `typst compile` with `render/md.typ`. Long answers are cut at block boundaries into pages. One page is one PNG.
3. The hook draws one `Image` per PNG, in place of the text.
4. Text size: the mod finds the terminal font (iTerm2 profile, Ghostty, kitty or Rio config, else Menlo metrics) and the cell size in pixels. Typst then measures both fonts so that 100% looks as large as the terminal text.
5. If a compile fails (a bad Typst block or an unknown LaTeX command), the mod compiles once more in safe mode: Typst blocks and math show as code. A dim line under the picture names the error. If that also fails, the normal text shows.
6. Pictures are kept in `${TMPDIR}/intelligent-ui-<uid>/`. Folders older than 2 days are deleted at start. The drawing space of each answer at its first compile is kept in `~/.cache/intelligent-ui/designs`, so that its Typst drawings keep the same share of the screen in later sessions.
7. The plan: a `ui.render` hook on the ExitPlanMode `ToolUse` row draws the plan through the same steps. Claude Code shows that row above the approval question. The approved result row then shows only its header, so the plan does not show two times. A `tool.call` hook on ExitPlanMode asks the mod's question (`$.ui.ask`) before Claude Code asks for permission. Then a `classic.PermissionRequest` hook gives the answer to Claude Code at once, so the Claude Code dialog does not show. For an approval, the hook sends the plan (`updatedInput`) and the new permission mode (`setMode`). For the person's text, the `tool.call` hook refuses the call with that text.

## How `auto` is resolved

Claude Code finds the light or dark mode for `auto` by asking the terminal for its background colour (OSC 11). A mod cannot see that answer, so Intelligent UI uses these sources, in this order. The first source that gives an answer is used:

1. **The iTerm2 profile:** the background colour of the profile in use (`ITERM_PROFILE`, else the default profile). Intelligent UI finds iTerm2 by `TERM_PROGRAM`. If `TERM_PROGRAM` is not set, `ITERM_PROFILE`, `ITERM_SESSION_ID` or `LC_TERMINAL=iTerm2` also show iTerm2. If the profile has separate colours for light and dark mode, Intelligent UI uses the set for iTerm2's theme (Settings > Appearance). If that theme is Automatic, Minimal or Compact, it uses the set for the OS appearance.
2. **The Ghostty config:** the `background` that `ghostty +show-config` gives. With a `theme = light:A,dark:B`, Intelligent UI reads the background from the theme file for the OS appearance. With no theme and no `background`, it uses Ghostty's default (`#282c34`, dark).
   - **cmux** (Ghostty inside, found by its `CMUX_*` variables) reads the same Ghostty config. If that config sets no `theme`, `background`, `foreground` or `palette`, cmux uses its adaptive default theme. Intelligent UI then uses cmux's appearance: `app.appearance` in `~/.config/cmux/cmux.json`, else the value in cmux's Settings. If that appearance is System, Intelligent UI uses the OS appearance. If `terminal.adaptiveDefaultTheme` is `false` in `cmux.json`, Intelligent UI uses the Ghostty rules above.
3. **The kitty config:** the `background` in `kitty.conf` and in the files that it includes (`include` lines only). The themes kitten writes such an include. If the config folder has `dark-theme.auto.conf`, `light-theme.auto.conf` or `no-preference-theme.auto.conf` (kitty 0.38 and later), Intelligent UI uses the file for the OS appearance, as kitty does. With no `background`, it uses kitty's default (`#000000`, dark). The config folder is `KITTY_CONFIG_DIRECTORY`. If that is not set, it is the first of `$XDG_CONFIG_HOME/kitty`, `~/.config/kitty` and (on macOS) `~/Library/Preferences/kitty` that has a `kitty.conf`.
4. **The Rio config:** `config.toml` in `RIO_CONFIG_HOME`, else in `~/.config/rio` (on Linux, `$XDG_CONFIG_HOME/rio` if that is set). With an `[adaptive-theme]`, Intelligent UI reads the theme file for `force-theme`, else for the OS appearance. Else it reads the file for `theme`, else the `[colors] background`. Theme files are in the `themes` folder. With no background, it uses Rio's default (`#0F0D0E`, dark).
5. **`COLORFGBG`**, as it was when Claude Code started. Ghostty does not set it.
6. **The OS appearance:** macOS Dark or Light, or GNOME's `color-scheme` on Linux.
7. **Dark.**

The terminal comes before the OS: a dark terminal on a light Mac is dark.

Intelligent UI checks every 3 s. After a change, each mode's pictures compile once. `/iui probe` asks the terminal for its background with OSC 11 (5 times) and shows the raw answers. This is a test of whether the answer can reach the mod. The 3 s check does not use OSC 11 yet.
