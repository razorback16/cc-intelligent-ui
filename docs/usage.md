# Usage

← Back to the [README](../README.md)

Intelligent UI draws Claude's answers as rendered Markdown. Only the drawing changes. The saved answer stays Markdown.

## What it draws

- **Markdown:** headings, lists, task lists, tables, block quotes, links, footnotes and horizontal rules.
- **Code blocks** with syntax colours, in your terminal's font. The mod reads the font from iTerm2, Ghostty, kitty and Rio. Else it uses fontconfig's `monospace` on Linux, then Menlo, SF Mono or DejaVu Sans Mono.
- **Math:** `$…$` and `$$…$$`, in LaTeX syntax.
- **Images** from `![alt](path)`. A relative path starts from the session's folder. Remote images show as a box with the alt text.
- **Live Typst:** a code block with the language `typst` (or `typ`) is drawn, not shown as code. These packages come with the mod and work offline:

  ```
  #import "@preview/cetz:0.5.2"
  #import "@preview/cetz-plot:0.1.4": plot, chart
  #import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
  ```

  A `theme` dictionary (`theme.fg`, `theme.muted`, `theme.blue`, `theme.palette`, `theme.width`, `theme.height`, …) lets a drawing use the terminal's colours and fit its space. A short part of the system prompt tells Claude about it. A drawing keeps the layout of its first draw, and scales when the terminal size changes.
- **Files that Claude sends** (the SendUserFile tool): images, PDF pages and Markdown files. See [Files that Claude sends](#files-that-claude-sends).
- **Images you paste** (`[Image #N]`): a small preview above the prompt box, and the same small images under your prompt after you send it. See [Preview of pasted images](#preview-of-pasted-images).
- **Plans** in plan mode, with the mod's own approval question. See [Plan approval](#plan-approval).

## Files that Claude sends

Each file draws under the row that lists the files, in the same order. Other files stay as the normal row.

- **Images:** PNG, JPEG, WebP and SVG. Other types, such as GIF, stay as the normal row. An SVG's size is its width and height in CSS px.
- **Markdown files** (`.md` or `.markdown`, 256 KiB or less) draw like an answer. A relative image path starts from the file's folder.
- **PDF files:** one page at a time. See below.

JPEG, WebP, SVG, PDF and Markdown need Typst.

**Size.** An image is never larger than its file or wider than the transcript. `/iui height` sets the most rows it can use (by default half the screen, 24 rows at most). The same limit applies to Typst drawings in answers.

### PDF pages

- **Change page:** a line such as `‹  3  ›` shows under the page. Click `‹` or `›`. `‹` is gray on page 1, and `›` on the last page. The mod does not show the number of pages.
- **Go to a page:** click the page number. A field opens above the prompt (at the side of the transcript in a wide fullscreen terminal). Type the number and push Enter. If the page does not exist, the field shows `No page N`. Push Esc to close it.
- **One page only:** a PDF with one page has no page line.
- **Errors:** if Typst cannot read the PDF (for example, it has a password or is damaged), the row shows the error in gray. If one page fails, its error shows above the page line.
- **Page memory:** each row starts on page 1. The mod keeps the page in memory only, so a reload goes back to page 1, and an old row can lose its page when there are many rows. If the PDF gets shorter, a page that is gone shows the last page.

## Preview of pasted images

When you paste an image, the prompt box shows `[Image #N]`. The mod shows a small preview of it above the prompt box, with its number in dim text at its left.

- **Size:** about 5 rows tall, less when the space is small. The previews sit side by side and wrap to the next line. The image keeps its shape. It fills its cells, so up to half a cell can be cut from one edge. A very wide or tall image (for example, a screenshot of one line) shows whole, with empty space beside it.
- **Delete or clear:** delete the `[Image #N]` text and its preview goes. Send or clear the prompt and all previews go.
- **After you send:** the same small images show under your prompt, without numbers. Claude Code's own `[Image #N]` rows stay under them; a mod cannot change those. `/iui height` does not apply to pasted images.
- **Pasted image paths:** if you copy the path of an image file and paste it, the mod reads the clipboard once to find the file and shows its preview. PNG, JPEG and WebP work (JPEG and WebP need Typst). This does not work over ssh. A dragged path shows its preview only after you send (see [Limitations](limitations.md)).
- **Pasted images need a PNG:** if Claude Code saved no PNG file for an image, it has no preview.
- **Without Typst**, or until the fitted copy is ready, the preview shows the image as it is. In herdr in iTerm2, no preview shows while the fitted copy is made.
- **Hidden:** a survey above the prompt box hides the previews until it closes. With `/iui off`, or in a terminal that shows no pictures, there are no previews.

## The intelligent-ui skill

The mod gives Claude a skill, `intelligent-ui`, with the full Typst, fletcher, CeTZ and cetz-plot API, recipes for many diagrams and charts, and a compile check. Claude loads it by itself before a complex drawing, or after a drawing fails to compile. For normal answers and simple drawings, it does not.

The compile check (`scripts/check.sh` in the skill) compiles a drawing with your theme, in dark and light mode. Claude looks at the result and fixes the drawing before it answers.

To start it yourself, type `/cc-intelligent-ui:intelligent-ui` (or `/intelligent-ui` when no other command has that name), then ask for the drawing.

## Commands

Settings that you change are kept for later sessions.

| Command | What it does |
|---|---|
| `/iui` | State, theme, text size, width, image height, row grid, any problem that keeps pictures away, and a new version if there is one |
| `/iui details` | All that the mod found: where the light or dark mode comes from, the terminal font, the Typst path, why pictures show or not, `Picture select:`, `/iui grab hint:` and `Update checks:` |
| `/iui on` / `off` | Pictures on or off |
| `/iui theme` | Lists the themes, the one in use, and the folder for your own themes |
| `/iui theme <name>` | Changes the theme. Default: `claude-code` |
| `/iui size <80–200>` | Text size in percent. 100 (the default) matches your terminal text |
| `/iui width` | Shows the most columns a picture can use |
| `/iui width <40–400>` | Sets the most columns a picture can use |
| `/iui width full` | Pictures use the full terminal width, like Claude Code's text, 255 columns at most. The default |
| `/iui height` | Shows the most rows an image or Typst drawing can use. Pasted images always show small |
| `/iui height half` | Half the terminal height, from 6 to 24 rows. The default |
| `/iui height full` | The terminal height less 16 rows (room for the file row, the text around it and the prompt) |
| `/iui height <6–200>` | Sets the most rows, never more than `full` |
| `/iui grid` | Shows if the row grid is on or off |
| `/iui grid on` / `off` | Puts each line of text on the terminal rows (on, the default), or uses the usual spacing (off). See [Selection and the row grid](#selection-and-the-row-grid) |
| `/iui editor` | Shows the editor setting and the editor in use |
| `/iui editor auto` | Uses the first editor on the PATH: `code`, `code-insiders`, `codium`, `cursor`, `windsurf`, `zed`, `zeditor`, `subl`, `idea`, `webstorm`, `pycharm`, `goland`, `clion`, `rider`. With none, it uses the system default app. The default. See [Click a link, a file or a command](#click-a-link-a-file-or-a-command) |
| `/iui editor <name>` | Uses this editor (for example `/iui editor cursor`). If it is not on the PATH, the mod uses the `auto` choice and the toast says so |
| `/iui editor default` | Always uses the system default app. It does not use the line number |
| `/iui editor <command>` | Uses your own command. Use `{path}`, `{line}` and `{column}` in it, for example `/iui editor nvim-qt +{line} {path}`. The mod splits it on spaces and runs it with no shell |
| `/iui select` | Shows if picture select is on or off |
| `/iui select on` / `off` | Drag over an answer to copy its text (on, the default). With `off`, a drag is Claude Code's own selection, which skips pictures from Claude Code 2.1.305. See [Picture select](#picture-select-claude-code-21298-or-newer) |
| `/iui updates` | Shows if the update check is on, and the newest version it found |
| `/iui updates on` / `off` | Checks for a new version once a day at most and shows a toast (on, the default), or stops the check. See [Update](install.md#update) |
| `/iui setup` / `setup remove` | Adds or removes the shell line that turns pictures on in iTerm2 (macOS) and herdr (macOS and Linux). Then open a new tab or pane. It updates an older iTerm2 line. On Linux outside herdr it changes nothing |
| `/iui grab` | Copies the text of your last selection of pictures. On the main screen, it copies the text of the picture cells on the clipboard. See [Copy text from a picture](#copy-text-from-a-picture) |
| `/iui dump` | Shows the last clipboard with picture cells and how the mod read it, for a bug report. Also writes it to `copy-debug.json` in the cache folder |
| `/iui probe` | Asks the terminal for its background colour (OSC 11) and shows the raw answers. See [How `auto` is resolved](how-it-works.md#how-auto-is-resolved) |

## Copy text from a picture

Copying an answer works as usual: drag over it, release, paste. This also works for a plan or a Markdown file that Claude sent. Text inside a diagram, a Typst drawing, an image or display math does not copy. Inline math copies as its LaTeX source.

This needs fullscreen mode and Claude Code 2.1.298 or newer. Run `/tui fullscreen` (`/tui default` goes back to the main screen). On the main screen, see [Picture cells on the clipboard](#picture-cells-on-the-clipboard).

### Picture select (Claude Code 2.1.298 or newer)

Picture select is what makes a drag over an answer copy its text. It works in fullscreen mode only, and it is on by default (`/iui select off` and `/iui select on`).

1. **Drag** over the answer with the left button. Start the drag on the answer. The selection shows on a blue background (VS Code's selection colour) and follows the text, as in an editor. The layout does not change.
2. **Release.** The mod copies the selected text and shows "copied N chars of text". Then paste.
3. **Clear** the selection with a click in an answer, a new selection, a key in the prompt, your next prompt, `/iui off` or `/iui select off`. A single click on normal text does not clear it (see [Limitations](limitations.md)).

A selection can go on into the next page of the same answer. The copy is usually instant; on a page that is not ready yet it can take up to 0.5 s (2–3 s with a large drawing), so wait for the toast before you paste.

#### Click a link, a file or a command

With picture select, the links, file paths, commands and code block copy buttons in an answer are live.

- **Hover** over one and its cells turn blue. There is no hover highlight while a selection shows.
- **Click** a link or a file path (press and release on the same cell) to open it:

  | Click on | What happens | Toast |
  |---|---|---|
  | A web link | Opens in the browser (`open` on macOS, `xdg-open` on Linux) | "opened the link" |
  | A file path | Opens in your editor, at the line and column of the path (`hooks/lib/copy.ts:42`) | "opened copy.ts in code" (the file and the editor) |

- **Alt+click** a link or a path to copy it, as a click did before. The toast says "copied the link" or "copied the path".
- **Click** a command, or the copy button at the top right of a code block, to copy it:

  | Click on | Copies | Toast |
  |---|---|---|
  | A command | The full command | "copied the command" |
  | The copy button at the top right of a code block | All the code of the block | "copied the code" |

- **Drag** from a link, path or command to select text as usual.
- If the open fails, the mod copies the target and the toast says so.
- Over ssh, a click copies, because a program would run on the remote computer.

**Which editor.** `/iui editor` sets the editor for file paths. With `auto` (the default), the mod uses the first editor it finds on the PATH, in the order in [Commands](#commands). If it finds none, it uses the system default app. The setting is kept for later sessions.

**What counts.** A web link is a Markdown link to an `http:`, `https:` or `mailto:` URL, or a bare URL. A file path is in the text or in inline code, and the file must exist (a relative path starts from the session's folder). A command is any other inline code, for example `` `git status` ``; for `` `! cmd` `` the click copies only `cmd`. A code block's text is not a target: use its copy button or select the text. Links to headings are not targets.

### Picture cells on the clipboard

On the main screen (not fullscreen), there is no picture select. The terminal does the copy itself, and it gives picture cells (kitty placeholder characters), not text. A Claude Code selection that starts outside an answer can also copy picture cells (see [Limitations](limitations.md)). The mod never changes the clipboard for such a copy, because it cannot tell which session the copy came from.

- **Toast:** while the mod is on and has drawn a picture in this session, it watches the clipboard. When the clipboard has picture cells from this session, a toast tells you to run `/iui grab`. On Linux this needs the tools in [Linux](install.md#linux).
- **`/iui grab`:** run it in the same session. In fullscreen, it copies the text of your last mouse selection. On the main screen, it reads the picture cells on the clipboard and copies their text. If the clipboard already has the text, it says so.
- **Wrong text?** `/iui dump` shows the cells the mod found and the page it used, and writes them to `copy-debug.json` in the cache folder.
- **Fullscreen hint:** the first time the mod draws on the main screen, a toast recommends fullscreen mode (once per session).

For the limits, see [Limitations](limitations.md).

## Links, file paths and commands

Without picture select (the main screen, ssh, Claude Code before 2.1.298, or `/iui select off`), a click on a link in a picture does nothing. Instead, the mod lists the links, file paths and commands of an answer, a plan or a sent Markdown file in dim rows under it, one per row. The rows show only when there is something to list:

```
↗ Typst docs  https://typst.app/docs
↗ https://github.com/o/r/pull/42
↗ hooks/lib/copy.ts:42
$ brew install typst
```

- **Web link** (`http:`, `https:` or `mailto:`): the link text, then the URL (once, if they are the same). Cmd+click (or your terminal's link click) opens it.
- **File path**, for example `hooks/lib/copy.ts:42`: cmd+click opens the file. A relative path starts from the session's folder (or the folder of a sent Markdown file). The row shows only if the file exists.
- **Command** from a `bash`, `sh`, `zsh`, `shell`, `console` or `shell-session` code block, or inline code that starts with `! `: click the row to copy the full command ("Copied"). A command with several lines shows its first line and the number of other lines. The click works only in fullscreen mode.

Web links are not taken from code blocks, inline code or math. File paths are taken from the text and inline code, not from code blocks.

## Selection and the row grid

The terminal draws a selection in whole rows. Without the grid, text lines in a picture do not line up with the rows (a body line is about 1.3 rows tall, a list or table line about 1.6), so after a few lines the selection drifts from the text that is copied.

The row grid (`/iui grid on`, the default) puts each line of text on the terminal rows, so the selection covers the text you get:

- **Text lines:** each line of body text, a list, a quote or a table uses one row (more with a large text size), with the text centred in the row.
- **Headings and code:** each heading, code line and gap between blocks uses whole rows. A level-2 heading uses 3 rows, with its text in the middle row.
- **Other blocks** (display math, images, Typst drawings) get extra space so that they use whole rows.
- **Reply bullet:** it sits on the row of the first line's text.

Lines are closer together than without the grid, so the look differs a little from VS Code. Use `/iui grid off` for the usual spacing. For the limits, see [Limitations](limitations.md).

## Plan approval

When Claude exits plan mode, the mod draws the plan in the transcript. Under it, the mod asks "Approve this plan?" in place of Claude Code's dialog:

| Option | What it does |
|---|---|
| Yes, auto-accept edits | Approves. Claude Code then accepts file edits without asking (`acceptEdits` mode). |
| Yes, manually approve edits | Approves. Claude Code asks before each file edit (`default` mode). |
| Yes, clear context + auto-accept | Approves, stops the turn and runs `/clear`. Then sends "Implement this plan:" with the plan as a new prompt, in `acceptEdits` mode. |
| Edit the plan | Opens the plan file in an editor and waits until you close it (10 minutes at most). On macOS without `code`, it waits until you choose "Done editing". Then asks "Approve the edited plan?". Claude gets the edited plan. |
| Type something | Sends your text to Claude as changes. Claude stays in plan mode and writes a new plan. |
| Esc | Rejects the plan and stops the turn. |

**Editor.** VS Code (`code --wait`) when `code` is on your PATH. Else, on macOS, your default text editor (TextEdit if you did not change it). Save the file, then choose "Done editing". "Open the plan file again" opens it again if you closed it. On Linux with a display, the first of VSCodium, Zed, Sublime Text, Kate, gedit and gvim on your PATH (close the file or window when you are done). Over ssh without `code`, or on Linux with none of these, "Edit the plan" does not show.

**The plan you see is the plan Claude gets.** If Claude writes the plan file and exits plan mode in the same message, the mod waits for the write (5 s at most) and reads the file again.

**When it applies.** Only when the mod can draw the plan: the mod is on, Typst is installed, the terminal shows pictures, and the plan is from the main conversation (not a subagent). The question waits until the pictures of the plan show (45 s at most). Otherwise, Claude Code shows its own dialog with the plan as text. This also occurs if the pictures do not show (for example, Typst fails, or over ssh a page is too large) or if the flow fails. After you edit the plan, the mod asks "Approve the edited plan?" also when its pictures do not show, so that Claude gets your edit. A toast tells you.

For the limits, see [Limitations](limitations.md).
