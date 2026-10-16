# md-preview

A Claude Code mod that draws Claude's answers as rendered Markdown pictures, with a look close to VS Code's Markdown preview. Claude can also put live Typst in an answer, for diagrams, charts and math.

Only the drawing changes. The saved answer stays Markdown.

## What it draws

- Headings, lists, task lists, tables, block quotes, links, footnotes and horizontal rules
- Code blocks with syntax colours, in your terminal's font (found for iTerm2 and Ghostty; else Menlo, SF Mono or DejaVu Sans Mono)
- Math (`$…$` and `$$…$$`, LaTeX syntax, through mitex)
- Images from `![alt](path)`. A relative path starts from the session's folder. Remote images show as an alt-text box.
- Live Typst: a fenced block with the language `typst` (or `typ`) is rendered, not shown as code. These packages are in the mod and work offline:

  ```
  #import "@preview/cetz:0.5.2"
  #import "@preview/cetz-plot:0.1.4": plot, chart
  #import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
  ```

  A `theme` dictionary (`theme.fg`, `theme.muted`, `theme.blue`, `theme.palette`, `theme.width`, …) is in scope, so drawings match the terminal's colours. The mod tells Claude about this in a short part of the system prompt.

## Requirements

- Claude Code 2.1.301 or later (tested on 2.1.301)
- [Typst](https://typst.app) 0.15 (tested on 0.15.1)
- macOS (tested). Linux can work, but it is not tested.
- A terminal where Claude Code draws pictures:
  - **Ghostty and kitty:** pictures work with no setting.
  - **iTerm2 (3.7.5 tested), WezTerm, Warp, Konsole:** set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before you start Claude Code.
  - Not inside tmux or screen (unless forced), and not over ssh. Set `MD_PREVIEW_FORCE=1` to try anyway.
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
| `/md-preview` | Shows the state, the text size and the terminal font that the mod found |
| `/md-preview on` / `off` | Turns the pictures on or off (kept for later sessions) |
| `/md-preview size <80–200>` | Text size in percent. 100 is the same visual size as your terminal text. |
| `/md-preview theme` | Lists the themes, shows which one is in use, and shows the folder for your own themes |
| `/md-preview theme <name>` | Changes to that theme (kept for later sessions) |

## Themes

A theme sets the colours, fonts and spacing of the picture. Two themes are in the mod:

| Name | Looks like |
|---|---|
| `vscode-modern` (default) | VS Code's Markdown preview with Dark Modern / Light Modern |
| `vscode` | The same, with the Dark+ / Light+ colours |

Each theme has a dark and a light part. The mod uses the part that agrees with Claude Code's theme.

### Make your own theme

1. Make a folder: `~/.claude/md-preview/themes/<name>/`.
2. Put a `theme.json` in it. Write only the keys that you change. The mod merges your file over the base theme, `vscode` (not over the default, `vscode-modern`).
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

The `vscode` and `vscode-modern` values come from VS Code (MIT licence, Copyright (c) 2015 - present Microsoft Corporation). The `LICENSE` file is in each of those folders.

## How it works

1. A `ui.render` hook on `AssistantMessage` gets each block of the answer as Markdown.
2. When the text stops changing for 400 ms, the mod writes the block to a JSON file and runs `typst compile` with `render/md.typ`. Long answers are cut at block boundaries into pages. One page is one PNG.
3. The hook draws one `Image` per PNG, in place of the text.
4. Text size: the mod finds the terminal font (iTerm2 profile, Ghostty config, else Menlo metrics) and the cell size in pixels. Typst then measures both fonts so that 100% looks as large as the terminal text.
5. If a compile fails (a bad Typst block or an unknown LaTeX command), the mod compiles once more in safe mode: Typst blocks and math show as code. A dim line under the picture names the error. If that also fails, the normal text shows.
6. Pictures are kept in `${TMPDIR}/md-preview-<uid>/`. Folders older than 2 days are deleted at start.

## Limitations

- **Copying text from a picture does not work.** A picture fills its cells with kitty placeholder characters (U+10EEEE plus combining marks). Claude Code's mouse selection copies those cells directly to the clipboard, and no mod hook runs before that copy. So a paste gives strange characters, not the text. Use Claude Code's `/copy` to copy the last answer as Markdown (`/copy 2` for the one before it; it shows a picker for the full answer or one code block, unless "Skip the /copy picker" is on in `/config`), or turn the mod off (`/md-preview off`) to select text. To stop the clipboard write on select, set `copyOnSelect` to `false` in `/config`.
- **Search does not find text in a picture.**
- **While Claude writes**, the answer shows as normal text. The picture comes about 0.4 s after the text stops changing, plus 0.15–0.6 s to compile.
- **Short summaries** between tool calls stay as text.
- **Typst blocks:** `#page`, `#pagebreak` and `#set page` are errors. A package that is not in the mod cannot be downloaded (the network is blocked for Typst), so its block shows as code.
- **Security:** Typst runs with `--root /`, so a Typst block can read any file that you can read and draw it in the picture. Nothing leaves the computer.
- **The look is close to VS Code, not exact:** Typst does not use CSS. Raw HTML in Markdown is shown in a simple form or dropped. Loose lists have tight spacing.
- **A picture that the terminal dropped from its image memory** (after many large pictures) is not sent again when you scroll back to it.
- **`auto` theme** is drawn as dark.

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

## Licence

MIT, see [`LICENSE`](LICENSE). The vendored Typst packages and the VS Code theme values keep their own licences: see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
