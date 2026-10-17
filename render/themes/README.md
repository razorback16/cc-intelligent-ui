# md-preview themes

A theme is a folder with a `theme.json`. md-preview ships two:

| Folder | Name | Looks like |
|---|---|---|
| `vscode-modern` (default) | VS Code Modern | VS Code's Markdown preview, Dark Modern / Light Modern |
| `vscode` | VS Code | the same, with the Dark+ / Light+ colours; every theme merges over this one |

Your own themes go in `~/.claude/md-preview/themes/<name>/theme.json`. A theme there with the same folder name as a built-in one is used in its place. It is still merged over the built-in `vscode`, like every theme. Choose a theme with `/md-preview theme <name>`.

## Merging

Every key is optional. The template merges your `theme.json` over `vscode/theme.json`, so you only write what you change. A value of the wrong type (for example a colour that is not `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, or text where a number belongs) is ignored, and the vscode value is used. The file must be valid JSON; if it is not, md-preview uses the default theme, `vscode-modern`, and tells you.

Example: pink inline code, rounder boxes.

```json
{
  "name": "Pink code",
  "dark":  { "inline-code-fg": "#ff79c6", "inline-code-bg": "#ff79c626" },
  "light": { "inline-code-fg": "#c2185b" },
  "inline-code": { "radius-px": 8 }
}
```

## Units

- `*-px`: CSS pixels of VS Code's preview. Its body text is 14px, so 1px = 11/14 pt (the body is always 11pt; md-preview scales the whole picture to your terminal).
- `*-em`: em of that element's own text.
- `size`: a fraction of the body text size. For code, `"terminal"` means the size of your terminal's own text.
- Colours: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. The page is transparent, so a translucent background (for example `#ffffff1a`) looks right on any terminal colour.

## Keys and vscode defaults

| Key | vscode default | What it does |
|---|---|---|
| `name`, `description`, `source` | | Shown by `/md-preview theme` |
| `syntax.dark`, `syntax.light` | `dark.tmTheme`, `light.tmTheme` | Code colours: a TextMate theme file in this folder. If you leave this out, the vscode files are used. If you name a file, it must exist. |
| `fonts.body` | SF Pro Text, Helvetica Neue, Helvetica, Arial, … | Body font list (first installed one wins, per character) |
| `fonts.code` | Menlo, SF Mono, DejaVu Sans Mono, … | Code font list |
| `fonts.use-terminal-font` | `true` | Put the terminal's own font first for code |
| `dark.*`, `light.*` | see `vscode/theme.json` | Colours: `fg`, `muted`, `link`, `accent` (checked boxes), `bg` (the page colour that live Typst blocks get as `theme.bg`), `border` (h1/h2 rules, hr, table rows), `th-border`, `inline-code-fg`, `inline-code-bg`, `code-fg`, `code-bg`, `code-border`, `quote-bg`, `quote-border`, `check` (tick in a checked box), `red`, `green`, `blue`, `yellow`, `orange`, `purple` (for drawings) |
| `text.leading-em` / `text.paragraph-em` | `0.38` / `1.2` | Gap between lines / between paragraphs |
| `math-scale`, `math-inline-scale` | `1.2`, `1.1` | Size of display / inline LaTeX math, as a fraction of the text size. Live Typst blocks do not change. |
| `heading.size-em` | `[2, 1.5, 1.25, 1, 0.875, 0.85]` | h1–h6 sizes |
| `heading.weight` | `600` | |
| `heading.leading-em`, `above-em`, `below-em` | `0.2`, `[1.4, 1.6, 1.5, …]`, `[1.0, 1.0, 0.9, …]` | Spacing (arrays are per level; the last entry repeats) |
| `heading.rule-levels`, `rule-pad-em` | `2`, `0.3` | Levels that get a rule under them, and the gap above it |
| `list.markers` | `["disc", "circle", "square"]` | Per nesting level: `disc`, `circle` and `square` are drawn like CSS; any other text is used as the marker |
| `list.indent-em`, `gap-em` | `1.9`, `0.55` | Bullet indent; gap from bullet to text |
| `list.number-indent-em`, `number-gap-em` | `1.45`, `0.5` | The same for numbered lists |
| `list.item-spacing-em` | `0.38` | Gap between items |
| `inline-code.size` | `1.0` | Code size (VS Code: same as body) |
| `inline-code.pad-x-px`, `pad-y-px`, `radius-px` | `3`, `1`, `4` | VS Code: `padding: 1px 3px; border-radius: 4px` |
| `code-block.size`, `line-height` | `1.0`, `1.357` | |
| `code-block.pad-px`, `radius-px`, `border-px` | `16`, `3`, `1` | |
| `quote.bar-px`, `radius-px`, `pad-left-px`, `pad-right-px`, `pad-y-em` | `5`, `2`, `10`, `16`, `0.55` | |
| `table.pad-x-px`, `pad-y-px`, `border-px`, `header-weight` | `10`, `5`, `1`, `700` | |
| `rule.border-px`, `gap-em` | `1`, `1.5` | Horizontal rule |

## Licence

The `vscode` and `vscode-modern` values come from VS Code (MIT, Copyright (c) 2015 - present Microsoft Corporation). Each of those folders has the `LICENSE` file. Their `source` keys name the files the values come from.
