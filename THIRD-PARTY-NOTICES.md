# Third-party notices

Intelligent UI is MIT licensed (see `LICENSE`). It includes the work of others, each under its own licence. Each folder below holds that project's licence file.

## Typst packages (in `render/packages/preview/`)

These are copies of the published packages from [Typst Universe](https://typst.app/universe), so Intelligent UI works offline.

| Package | Version | Licence |
|---|---|---|
| [cmarker](https://typst.app/universe/package/cmarker) | 0.1.6 | MIT |
| [mitex](https://typst.app/universe/package/mitex) | 0.2.7 | Apache-2.0 |
| [cetz](https://typst.app/universe/package/cetz) | 0.5.2, 0.3.4 | LGPL-3.0-or-later |
| [cetz-plot](https://typst.app/universe/package/cetz-plot) | 0.1.4 | LGPL-3.0-or-later |
| [fletcher](https://typst.app/universe/package/fletcher) | 0.5.8 | MIT |
| [oxifmt](https://typst.app/universe/package/oxifmt) | 1.0.0 | MIT OR Apache-2.0 |
| [oxifmt](https://typst.app/universe/package/oxifmt) | 0.2.1 | MIT-0 |

cetz 0.3.4 and oxifmt are there because other packages import them.

cetz and cetz-plot are under the LGPL-3.0. Their full licence text is in their folders. The LGPL-3.0 refers to the GPL-3.0, which is at https://www.gnu.org/licenses/gpl-3.0.html.

## VS Code (in `render/themes/vscode/`, `render/themes/vscode-modern/` and `render/themes/claude-code/`)

The colours, sizes and spacing of the `vscode` and `vscode-modern` themes come from [VS Code](https://github.com/microsoft/vscode): its Markdown preview styles (`markdown.css`, `highlight.css`) and its Dark+, Light+, Dark Modern and Light Modern themes. The `claude-code` theme uses the ANSI colours of the VS Code terminal (`terminalColorRegistry.ts`) and the syntax scopes of the `vscode` theme. MIT, Copyright (c) 2015 - present Microsoft Corporation. The `source` key in each `theme.json` names the files.

## show-your-work

The one-line Perl command that reads the terminal's cell size in pixels (`CELL_SH` in `hooks/register.tsx`) comes from [show-your-work](https://github.com/iamumeransari/claude-show-your-work). MIT, Copyright (c) 2026 Umer Ansari.
