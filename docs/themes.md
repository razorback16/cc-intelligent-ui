# Themes

← Back to the [README](../README.md)

A theme sets the colours, fonts and spacing of answers. Body text always uses your terminal's font at its text size.

| Name | Looks like |
|---|---|
| `claude-code` (default) | Claude Code's own Markdown colours, from its dark and light themes |
| `vscode-modern` | VS Code's Markdown preview with Dark Modern / Light Modern |
| `vscode` | The same, with the Dark+ / Light+ colours |

Each theme has a dark and a light part. The mod uses the one that matches Claude Code's theme. For Claude Code's `auto` theme, refer to [How `auto` is resolved](how-it-works.md#how-auto-is-resolved).

- **Change the theme:** `/iui theme <name>`
- **List the themes:** `/iui theme`

## Make your own theme

1. Make a folder: `~/.claude/cc-intelligent-ui/themes/<name>/`.
2. Put a `theme.json` in it, with only the keys you change. The mod merges it over the `vscode` theme (not over the default, `claude-code`).
3. Run `/iui theme <name>`. No restart needed.

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

- **Same name as a built-in theme:** your theme is used in its place, still merged over the built-in `vscode`.
- **Colours:** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. Answers have no background, so a translucent colour (for example `#ffffff1a`) looks right on any terminal colour.
- **Wrong values:** a value of the wrong type is ignored, and the `vscode` value is used.
- **Invalid JSON:** the theme is skipped, the default theme is used, and `/iui theme` tells you why.
- **Syntax colours:** put TextMate theme files in the folder and name them: `"syntax": { "dark": "dark.tmTheme", "light": "light.tmTheme" }`. A file you name must exist.

All keys, units and defaults are in [`render/themes/README.md`](../render/themes/README.md).

## Licence

The `vscode` and `vscode-modern` values come from VS Code (MIT licence, Copyright (c) 2015 - present Microsoft Corporation). The `claude-code` theme uses the ANSI colours of the VS Code terminal for links and code. Each of those folders has the `LICENSE` file. Refer also to [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
