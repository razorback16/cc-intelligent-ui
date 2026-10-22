# Intelligent UI themes

A theme is a folder with a `theme.json`. Intelligent UI ships three:

| Folder | Name | Looks like |
|---|---|---|
| `claude-code` (default) | Claude Code | Claude Code's own Markdown in the terminal, with its dark and light themes |
| `vscode-modern` | VS Code Modern | VS Code's Markdown preview, Dark Modern / Light Modern |
| `vscode` | VS Code | the same, with the Dark+ / Light+ colours; every theme merges over this one |

Your own themes go in `~/.claude/cc-intelligent-ui/themes/<name>/theme.json`. A theme there with the same folder name as a built-in one is used in its place. It is still merged over the built-in `vscode`, like every theme. Choose a theme with `/iui theme <name>`.

## Merging

Every key is optional. The template merges your `theme.json` over `vscode/theme.json`, so you only write what you change. A value of the wrong type (for example a colour that is not `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, or text where a number belongs) is ignored, and the vscode value is used. The file must be valid JSON; if it is not, Intelligent UI uses the default theme, `claude-code`, and tells you.

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

- `*-px`: CSS pixels of VS Code's preview. Its body text is 14px, so 1px = 11/14 pt (the body is always 11pt; Intelligent UI scales the whole picture to your terminal).
- `*-em`: em of that element's own text.
- `size`: a fraction of the body text size. For code, `"terminal"` means the size of your terminal's own text.
- Colours: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. The page is transparent, so a translucent background (for example `#ffffff1a`) looks right on any terminal colour. The terminal draws the mouse selection under the picture: it shows through a translucent background, but an opaque one (`code-bg`, `quote-bg`, `inline-code-bg`) hides it.

## Keys and vscode defaults

| Key | vscode default | What it does |
|---|---|---|
| `name`, `description`, `source` | | Shown by `/iui theme` |
| `syntax.dark`, `syntax.light` | `dark.tmTheme`, `light.tmTheme` | Code colours: a TextMate theme file in this folder. If you leave this out, the vscode files are used. If you name a file, it must exist. |
| `fonts.body` | SF Pro Text, Helvetica Neue, Helvetica, Arial, … | Body font list (first installed one wins, per character). The terminal's own font is always put first, so body text is exactly the terminal's size (at `/iui size 100`). This list is used when the terminal's font is not known. |
| `fonts.code` | Menlo, SF Mono, DejaVu Sans Mono, … | Code font list |
| `fonts.use-terminal-font` | `true` | Put the terminal's own font first for code |
| `dark.*`, `light.*` | see `vscode/theme.json` | Colours: `fg`, `muted`, `link`, `accent` (checked boxes), `bg` (the page colour that live Typst blocks get as `theme.bg`), `border` (h1/h2 rules, hr, table rows), `th-border`, `inline-code-fg`, `inline-code-bg`, `code-fg`, `code-plain-fg` (code blocks with no language; if you leave it out, `code-fg` is used), `code-bg`, `code-border`, `quote-bg`, `quote-border`, `check` (tick in a checked box), `red`, `green`, `blue`, `yellow`, `orange`, `purple` (for drawings) |
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
| `list.numbering` | `"1."` | Numbers of numbered lists: a [Typst numbering pattern](https://typst.app/docs/reference/model/numbering/). Each counting symbol is one nesting level, and the last one repeats: `"1.a.i."` gives `1.`, `a.`, `i.`, `i.`. A pattern with no counting symbol is ignored. |
| `inline-code.size` | `1.0` | Code size (VS Code: same as body) |
| `inline-code.pad-x-px`, `pad-y-px`, `radius-px` | `3`, `1`, `4` | VS Code: `padding: 1px 3px; border-radius: 4px` |
| `code-block.size`, `line-height` | `1.0`, `1.357` | |
| `code-block.pad-px`, `radius-px`, `border-px` | `16`, `3`, `1` | A code block is only as wide as its code needs (at most the width of the page). Its header row shows the language and a copy button in `muted`, with a rule in `code-border` under them. |
| `quote.bar-px`, `radius-px`, `pad-left-px`, `pad-right-px`, `pad-y-em` | `5`, `2`, `10`, `16`, `0.55` | |
| `table.style` | `"rules"` | `"rules"`: VS Code's preview (a rule under the header and between the rows). `"grid"`: Claude Code's own tables (a box and a rule between all rows and columns, all in `th-border`). Another value draws as `"rules"`. Each column, its header too, has the alignment of the Markdown (`:---` left, `:---:` centre, `---:` right, `---` left). |
| `table.pad-x-px`, `pad-y-px`, `border-px`, `header-weight` | `10`, `5`, `1`, `700` | |
| `rule.border-px`, `gap-em` | `1`, `1.5` | Horizontal rule |

With `/iui grid on`, the lines of text lie on the terminal's rows. Then some keys change their effect:

- `text.leading-em`, `text.paragraph-em`, `heading.leading-em`, `heading.rule-pad-em`, `list.item-spacing-em` and `code-block.line-height` are not used. Each line is one row (a large heading is two or more rows; a line of an even number of rows is half a row down, with half a row more above and below its block). The gap between paragraphs and blocks is one row. The items of a tight list have no gap. The items of a loose list (a list with a blank line between its items or in an item) have a gap of one row.
- The header row of a code block has the rows of one line of code.
- `heading.above-em` and `below-em`, `rule.gap-em`, `code-block.pad-px`, `quote.pad-y-em` and `table.pad-y-px` are rounded to the nearest whole number of rows. Gaps above and below headings and rules are one row or more.
- With `table.style` `"grid"`, `table.pad-y-px` is rounded to the nearest whole number of rows and a half (half a row or more), and the table has half a row more above and below its box. Each rule is then in the middle of a row.

## Licence

The `vscode` and `vscode-modern` values come from VS Code (MIT, Copyright (c) 2015 - present Microsoft Corporation). Each of those folders has the `LICENSE` file. Their `source` keys name the files the values come from.

The `claude-code` colours come from Claude Code's theme palettes and its Markdown renderer. Claude Code writes links and code in ANSI colour names (`blue`, `cyan`, and so on), so the theme uses the ANSI colours of the VS Code terminal (`terminalColorRegistry.ts`, MIT) for them. Its syntax files keep the scopes of `vscode/*.tmTheme`. That folder has the `LICENSE` file too.
