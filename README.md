# Intelligent UI

A Claude Code mod that draws Claude's answers as rendered Markdown pictures, in Claude Code's own colours or with a look close to VS Code's Markdown preview.

The plugin is still installed as `md-preview`, and its command is still `/md-preview`. A later version changes them to `claude-intelligent-ui` and `/iui`. Claude can also put live Typst in an answer, for diagrams, charts and math.

Only the drawing changes. The saved answer stays Markdown.

## What it draws

- Headings, lists, task lists, tables, block quotes, links, footnotes and horizontal rules
- Code blocks with syntax colours, in your terminal's font (found for iTerm2, Ghostty, kitty and Rio; else Menlo, SF Mono or DejaVu Sans Mono)
- Math (`$…$` and `$$…$$`, LaTeX syntax, through mitex)
- Images from `![alt](path)`. A relative path starts from the session's folder. Remote images show as an alt-text box.
- Live Typst: a fenced block with the language `typst` (or `typ`) is rendered, not shown as code. These packages are in the mod and work offline:

  ```
  #import "@preview/cetz:0.5.2"
  #import "@preview/cetz-plot:0.1.4": plot, chart
  #import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
  ```

  A `theme` dictionary (`theme.fg`, `theme.muted`, `theme.blue`, `theme.palette`, `theme.width`, …) is in scope, so drawings match the terminal's colours. The mod tells Claude about this in a short part of the system prompt. `theme.width` and `theme.height` give the space for a drawing. The mod keeps the size that a message had when it was drawn the first time. When the terminal size changes, the mod makes the drawings larger or smaller by the same amount.
- Files that Claude sends to you (the SendUserFile tool). The mod draws each file under the row that shows the files, in the same order:
  - PNG, JPEG and WebP images. Typst changes a JPEG or WebP image into a PNG image in the cache folder. The PNG image is the size of the space for the picture in the transcript, or smaller. Typst does this one time for each version of the file and each size of the space. When the space changes, the mod shows the old PNG image until Typst makes the new one.
  - Markdown files (`.md` or `.markdown`, 256 KiB or less). The mod draws the file as rendered pictures, the same as an answer. A relative image path in the file starts from the folder of the file.

  Other files stay as the normal row. JPEG images, WebP images and Markdown files need Typst.
- Images that you paste into the prompt (`[Image #N]`). The mod draws each image under your prompt.

  These pictures are not larger than the image. They are not wider than the transcript. The height setting (`/md-preview height`) sets the most rows that they can use (Typst drawings use it too): by default, half the screen and not more than 24 rows. The mod draws PNG, JPEG and WebP images only. Other image types (for example GIF and SVG) stay as the normal row.
- The plan in plan mode (the ExitPlanMode tool). The mod draws the plan as a picture in the transcript, the same as an answer. Then the mod asks you to approve the plan. Refer to [Plan approval](#plan-approval).

## Requirements

- Claude Code 2.1.301 or later (tested on 2.1.301)
- [Typst](https://typst.app) 0.15 (tested on 0.15.1)
- macOS (tested). Linux can work, but it is not tested.
- A terminal where Claude Code draws pictures:
  - **kitty (0.28 or later) and Ghostty:** pictures work with no setting.
  - **iTerm2 3.6 or later (3.7.5 tested):** Claude Code needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` when it starts. A mod cannot set it early enough. The first time the mod runs in iTerm2, it asks to add one line to your shell's start file (`~/.zshrc`, `~/.bash_profile` or a fish `conf.d` file). The line sets the variable in iTerm2 only, not in tmux or screen. Then close the tab, open a new iTerm2 tab, and start Claude Code there. You can also run `/md-preview setup` (undo: `/md-preview setup remove`).
  - **Rio 0.5.27 or later (not tested):** set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before you start Claude Code.
  - Do not put the variable in the `env` of `~/.claude/settings.json`. It then applies in every terminal, also where pictures cannot show.
  - **Not supported:** WezTerm, Warp and Konsole do not draw kitty pictures with Unicode placeholders, so they show no pictures, also with the variable set. Alacritty, Terminal.app, Windows Terminal, GNOME Terminal (and other VTE terminals), foot, VS Code, Tabby, Hyper and JetBrains terminals have no kitty pictures.
  - **tmux and screen:** no pictures. Claude Code does not send pictures through tmux or screen, also with the variable set. Set `MD_PREVIEW_FORCE=1` to try anyway.
  - **ssh:** pictures work when the terminal on your computer is kitty or Ghostty (`TERM` must come through ssh), or when you set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` on the remote computer. The mod sends each picture as data, because the terminal cannot read files on the remote computer. A page larger than 4096 pixels on a side or 2 MiB shows as text. An image of that size does not show.
  - Background sessions (agent view, forks, `claude attach`) cannot draw pictures.

  Where pictures cannot draw, the mod shows the normal text.

## Install

1. Install Typst: `brew install typst` (or see [Typst's install page](https://github.com/typst/typst#installation)).
2. At the prompt of a Claude Code session in the terminal, type:

   ```
   /plugin install md-preview --marketplace razorback16/claude-md-preview
   ```

   Answer `y` to add the marketplace, then push Enter to install for your user. The mod starts at once, with no restart.

From a shell:

```
claude plugin install md-preview --marketplace razorback16/claude-md-preview
```

To try it from a clone without installing: `claude --plugin-dir /path/to/claude-md-preview`.

## Use

| Command | What it does |
|---|---|
| `/md-preview` | Shows the state, the text size, the width, the image height and the terminal font that the mod found |
| `/md-preview on` / `off` | Turns the pictures on or off (kept for later sessions) |
| `/md-preview setup` / `setup remove` | iTerm2: adds or removes the shell line that turns pictures on (then close the tab and open a new one) |
| `/md-preview size <80–200>` | Text size in percent. 100 is the same visual size as your terminal text. |
| `/md-preview width` | Shows the width: the most columns that a picture can use |
| `/md-preview width <40–400>` | Sets the most columns that a picture can use (kept for later sessions) |
| `/md-preview width full` | Pictures use the full width of the terminal, the same as the text of Claude Code (kept for later sessions). This is the default. A picture is never wider than 255 columns. |
| `/md-preview height` | Shows the image height: the most rows that an image can use. This applies to images (sent or pasted) and to Typst drawings in answers. |
| `/md-preview height half` | An image uses half the terminal height, from 6 to 24 rows (kept for later sessions). This is the default. |
| `/md-preview height full` | An image uses the terminal height less 16 rows (kept for later sessions). The 16 rows are for the row of the file, the text around it and the prompt. |
| `/md-preview height <6–200>` | Sets the most rows that an image can use (kept for later sessions). An image is never taller than with `full`. |
| `/md-preview theme` | Lists the themes, shows which one is in use, and shows the folder for your own themes |
| `/md-preview theme <name>` | Changes to that theme (kept for later sessions) |

### Plan approval

When Claude exits plan mode, the mod draws the plan as a picture in the transcript. Under the picture, the mod shows its own question, "Approve this plan?", in place of the Claude Code dialog. A dim line above the question tells you that the rendered plan is above. The question has these options:

| Option | What it does |
|---|---|
| Yes, auto-accept edits | Approves the plan. Claude Code then accepts file edits with no question (`acceptEdits` mode). |
| Yes, manually approve edits | Approves the plan. Claude Code then asks you before each file edit (`default` mode). |
| Yes, clear context + auto-accept | Approves the plan, stops the turn and runs `/clear`. Then the mod sends "Implement this plan:" and the plan as a new prompt, in `acceptEdits` mode. |
| Edit the plan | Opens the plan file in an editor. The mod waits until you close the file (10 minutes at most). Then it asks "Approve the edited plan?". When you approve, Claude gets the edited plan. |
| Type something | Sends your text to Claude as changes to the plan. Claude stays in plan mode and writes a new plan. |
| Esc | Rejects the plan and stops the turn. |

The editor is VS Code (`code --wait`) when the `code` command is on your PATH. If `code` is not on the PATH, macOS uses TextEdit (`open -W -t`). In that case, quit TextEdit when you complete the edit. Over ssh and on Linux with no `code` command, the "Edit the plan" option does not show.

The mod shows the plan file as it is when the question opens. Claude can write the plan file and exit plan mode in the same message. Then Claude Code sends the plan from before that write. In this case, the mod waits for the write to complete (5 seconds at most) and reads the file again. You approve the plan that you see, and Claude gets that plan.

The mod uses this flow only when it can draw the plan: the mod is on, Typst is installed, the terminal draws pictures, and the plan is from the main conversation (not from a subagent). In all other conditions, Claude Code shows its own dialog, as with no mod. If the flow fails, Claude Code also shows its own dialog.

## Themes

A theme sets the colours, fonts and spacing of the picture. Three themes are in the mod:

| Name | Looks like |
|---|---|
| `claude-code` (default) | Claude Code's own Markdown colours, from its dark and light themes |
| `vscode-modern` | VS Code's Markdown preview with Dark Modern / Light Modern |
| `vscode` | The same, with the Dark+ / Light+ colours |

Each theme has a dark and a light part. The mod uses the part that agrees with Claude Code's theme.

### Make your own theme

1. Make a folder: `~/.claude/md-preview/themes/<name>/`.
2. Put a `theme.json` in it. Write only the keys that you change. The mod merges your file over the base theme, `vscode` (not over the default, `claude-code`).
3. Run `/md-preview theme <name>`. You do not have to restart.

Example: pink inline code with rounder boxes.

```json
{
  "name": "Pink code",
  "dark":  { "inline-code-fg": "#ff79c6", "inline-code-bg": "#ff79c626" },
  "light": { "inline-code-fg": "#c2185b" },
  "inline-code": { "radius-px": 8 }
}
```

- A user theme with the same folder name as a built-in theme is used in its place. It is still merged over the built-in `vscode`.
- Colours are `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. The picture has no background, so a translucent colour (for example `#ffffff1a`) looks correct on all terminal colours.
- A value of the wrong type is ignored, and the `vscode` value is used. If the file is not valid JSON, the theme is skipped, the default theme is used, and `/md-preview theme` tells you why.
- For your own syntax colours, put TextMate theme files in the folder and name them: `"syntax": { "dark": "dark.tmTheme", "light": "light.tmTheme" }`. A file that you name must exist.

All keys, their units and their defaults are in [`render/themes/README.md`](render/themes/README.md).

The `vscode` and `vscode-modern` values come from VS Code (MIT licence, Copyright (c) 2015 - present Microsoft Corporation). The `claude-code` theme uses the ANSI colours of the VS Code terminal for links and code. The `LICENSE` file is in each of those folders.

## How it works

1. A `ui.render` hook on `AssistantMessage` gets each block of the answer as Markdown.
2. While Claude writes a block, the block is hidden. The block is final when the model request starts its next block (a tool call, more text) or ends. If the mod did not see the request, the block is final after its text stops changing for 400 ms. Then the mod writes the block to a JSON file and runs `typst compile` with `render/md.typ`. Long answers are cut at block boundaries into pages. One page is one PNG.
3. The hook draws one `Image` per PNG, in place of the text.
4. Text size: the mod finds the terminal font (iTerm2 profile, Ghostty, kitty or Rio config, else Menlo metrics) and the cell size in pixels. Typst then measures both fonts so that 100% looks as large as the terminal text.
5. If a compile fails (a bad Typst block or an unknown LaTeX command), the mod compiles once more in safe mode: Typst blocks and math show as code. A dim line under the picture names the error. If that also fails, the normal text shows.
6. Pictures are kept in `${TMPDIR}/md-preview-<uid>/`. Folders older than 2 days are deleted at start.
7. The plan: a `ui.render` hook on the ExitPlanMode `ToolUse` row draws the plan through the same steps. Claude Code shows that row above the approval question. The approved result row then shows only its header, so the plan does not show two times. A `tool.call` hook on ExitPlanMode asks the mod's question (`$.ui.ask`) before Claude Code asks for permission. Then a `classic.PermissionRequest` hook gives the answer to Claude Code at once, so the Claude Code dialog does not show. For an approval, the hook sends the plan (`updatedInput`) and the new permission mode (`setMode`). For the person's text, the `tool.call` hook refuses the call with that text.

### How `auto` is resolved

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

Intelligent UI checks every 3 s. After a change, each mode's pictures compile once. `/md-preview probe` asks the terminal for its background with OSC 11 (5 times) and shows the raw answers. This is a test of whether the answer can reach the mod. The 3 s check does not use OSC 11 yet.

## Limitations

- **Copying text from a picture does not work.** A picture fills its cells with kitty placeholder characters (U+10EEEE plus combining marks). Claude Code's mouse selection copies those cells directly to the clipboard, and no mod hook runs before that copy. So a paste gives strange characters, not the text. Use Claude Code's `/copy` to copy the last answer as Markdown (`/copy 2` for the one before it; it shows a picker for the full answer or one code block, unless "Skip the /copy picker" is on in `/config`), or turn the mod off (`/md-preview off`) to select text. To stop the clipboard write on select, set `copyOnSelect` to `false` in `/config`.
- **Search does not find text in a picture.**
- **While Claude writes**, the block is hidden, and Claude Code's spinner shows the progress. When the block is final, its picture shows after the compile (0.15–0.6 s). A long answer shows only when it is done. If the picture is not ready 2 s after the block is final, the normal text shows until the picture is ready. If the compile fails, the normal text stays. An earlier answer that is not in the cache (for example, after a resume) is blank for up to 1 s, then shows as text until its picture is ready.
- **Short summaries** between tool calls stay as text.
- **Plan approval:** a mod cannot draw the Claude Code approval dialog, so the mod shows its own question. That question can have 4 options at most. Thus it has no option to keep planning (use Type something or Esc). The edit option cannot use a terminal editor (vim, nano), because a mod has no terminal. Where an organization manages Claude Code, `classic.PermissionRequest` hooks of a plugin that you install do not run. Then the Claude Code dialog shows after the mod's question.
- **Typst blocks:** `#page`, `#pagebreak` and `#set page` are errors. A package that is not in the mod cannot be downloaded (the network is blocked for Typst), so its block shows as code.
- **Security:** Typst runs with `--root /`, so a Typst block can read any file that you can read and draw it in the picture. Nothing leaves the computer.
- **The look is close to VS Code, not exact:** Typst does not use CSS. Raw HTML in Markdown is shown in a simple form or dropped. Loose lists have tight spacing.
- **A picture that the terminal dropped from its image memory** (after many large pictures) is not sent again when you scroll back to it.
- **Over ssh**, the mod cannot read the terminal's config on your computer. So it uses Menlo metrics for the text size, and `auto` uses `COLORFGBG` if ssh sends it. Else `auto` is dark. The mod does not use the OS appearance of the remote computer. Pages are shorter, so that each one is at most 4096 pixels tall. In tmux or screen on the remote computer, no pictures show.
- **`auto` theme** reads the iTerm2 profile, the Ghostty, kitty and Rio configs, and the cmux settings directly. It does not read kitty's `globinclude`, `envinclude` and `geninclude` lines, or colours that you set while kitty runs. In other terminals, it uses `COLORFGBG` (set only when the terminal starts), then the OS appearance. If you change the theme of such a terminal and the OS appearance does not change, Intelligent UI does not see it. A change shows after up to 3 s.

## Develop

```
git clone https://github.com/razorback16/claude-md-preview
cd claude-md-preview
claude --plugin-dir .          # once: Claude Code writes the API types to .claude-plugin/types/
npx -p typescript tsc -p .     # type check
claude plugin test .           # tests
claude plugin validate .
```

`.claude-plugin/types/` is not in git. `tsconfig.json` extends the `tsconfig.json` in it, so run Claude Code with the folder once before `tsc`.

The hooks module is `hooks/register.tsx`. It connects the hooks to the modules in `hooks/lib/`. Each module has one topic, for example `markdown.ts` (blocks and segments), `mode.ts` (light or dark), `typst.ts` (compile) `draw.tsx` (the pages of an answer), `answer.ts` (one text through the compile and cache steps) and `plan.tsx` (the plan approval question and the plan rows). The values that change are in one object, `S`, in `state.ts`. The tests import from `hooks/register.tsx`, which exports the names that they use.

## Licence

MIT, see [`LICENSE`](LICENSE). The vendored Typst packages and the VS Code theme values keep their own licences: see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
