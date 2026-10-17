# Themes

← Back to the [README](../README.md)

A theme sets the colours, fonts and spacing of the picture. Three themes are in the mod:

| Name | Looks like |
|---|---|
| `claude-code` (default) | Claude Code's own Markdown colours, from its dark and light themes |
| `vscode-modern` | VS Code's Markdown preview with Dark Modern / Light Modern |
| `vscode` | The same, with the Dark+ / Light+ colours |

Each theme has a dark and a light part. The mod uses the part that agrees with Claude Code's theme. For the `auto` theme of Claude Code, refer to [How `auto` is resolved](how-it-works.md#how-auto-is-resolved).

To change the theme, run `/iui theme <name>`. To list the themes, run `/iui theme`.

## Make your own theme

1. Make a folder: `~/.claude/intelligent-ui/themes/<name>/`.
2. Put a `theme.json` in it. Write only the keys that you change. The mod merges your file over the base theme, `vscode` (not over the default, `claude-code`).
3. Run `/iui theme <name>`. You do not have to restart.

Example: pink inline code with rounder boxes.

```json
{
  "name": "Pink code",
  "dark":  { "inline-code-fg": "#ff79c6", "inline-code-bg": "#ff79c626" },
  "light": { "inline-code-fg": "#c2185b" },
  "inline-code": { "radius-px": 8 }
}
```

## Rules

- A user theme with the same folder name as a built-in theme is used in its place. It is still merged over the built-in `vscode`.
- Colours are `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. The picture has no background, so a translucent colour (for example `#ffffff1a`) looks correct on all terminal colours.
- A value of the wrong type is ignored, and the `vscode` value is used. If the file is not valid JSON, the theme is skipped, the default theme is used, and `/iui theme` tells you why.
- For your own syntax colours, put TextMate theme files in the folder and name them: `"syntax": { "dark": "dark.tmTheme", "light": "light.tmTheme" }`. A file that you name must exist.

All keys, their units and their defaults are in [`render/themes/README.md`](../render/themes/README.md).

## Licence

The `vscode` and `vscode-modern` values come from VS Code (MIT licence, Copyright (c) 2015 - present Microsoft Corporation). The `claude-code` theme uses the ANSI colours of the VS Code terminal for links and code. The `LICENSE` file is in each of those folders. Refer also to [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
