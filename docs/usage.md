# Usage

← Back to the [README](../README.md)

Intelligent UI draws Claude's answers as rendered Markdown pictures. Only the drawing changes. The saved answer stays Markdown.

## What it draws

- Headings, lists, task lists, tables, block quotes, links, footnotes and horizontal rules
- Code blocks with syntax colours, in your terminal's font (found for iTerm2, Ghostty, kitty and Rio; on Linux, else fontconfig's `monospace` font; else Menlo, SF Mono or DejaVu Sans Mono)
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

  These pictures are not larger than the image. They are not wider than the transcript. The height setting (`/iui height`) sets the most rows that they can use (Typst drawings use it too): by default, half the screen and not more than 24 rows. The mod draws PNG, JPEG and WebP images only. Other image types (for example GIF and SVG) stay as the normal row.
- The plan in plan mode (the ExitPlanMode tool). The mod draws the plan as a picture in the transcript, the same as an answer. Then the mod asks you to approve the plan. Refer to [Plan approval](#plan-approval).

## Commands

| Command | What it does |
|---|---|
| `/iui` | Shows the state, the theme, the text size, the width, the image height and the row grid, a problem that keeps pictures away, and a new version when there is one |
| `/iui details` | Shows all that the mod found: where the mode comes from, the terminal font, the Typst path, why the terminal can or cannot show pictures, if the automatic copy is on (`Auto copy:`), and the state of the update check (`Update checks:`) |
| `/iui on` / `off` | Turns the pictures on or off (kept for later sessions) |
| `/iui setup` / `setup remove` | iTerm2 (macOS only): adds or removes the shell line that turns pictures on (then close the tab and open a new one). On Linux, it changes no file. |
| `/iui size <80–200>` | Text size in percent. 100 is the same visual size as your terminal text. |
| `/iui width` | Shows the width: the most columns that a picture can use |
| `/iui width <40–400>` | Sets the most columns that a picture can use (kept for later sessions) |
| `/iui width full` | Pictures use the full width of the terminal, the same as the text of Claude Code (kept for later sessions). This is the default. A picture is never wider than 255 columns. |
| `/iui height` | Shows the image height: the most rows that an image can use. This applies to images (sent or pasted) and to Typst drawings in answers. |
| `/iui height half` | An image uses half the terminal height, from 6 to 24 rows (kept for later sessions). This is the default. |
| `/iui height full` | An image uses the terminal height less 16 rows (kept for later sessions). The 16 rows are for the row of the file, the text around it and the prompt. |
| `/iui height <6–200>` | Sets the most rows that an image can use (kept for later sessions). An image is never taller than with `full`. |
| `/iui grid` | Shows the row grid setting: on or off |
| `/iui grid on` | Puts each line of text in a picture on the terminal rows (kept for later sessions). This is the default. Refer to [Selection and the row grid](#selection-and-the-row-grid). |
| `/iui grid off` | Lines of text in a picture have the usual spacing (kept for later sessions). |
| `/iui updates` | Shows the update check: on or off, and the newest version that it found |
| `/iui updates on` | Looks for a new version one time each day at most, and shows a toast when there is one (kept for later sessions). This is the default. Refer to [Update](install.md#update). |
| `/iui updates off` | Stops the check for a new version and its toast (kept for later sessions) |
| `/iui theme` | Lists the themes, shows which one is in use, and shows the folder for your own themes |
| `/iui theme <name>` | Changes to that theme (kept for later sessions) |
| `/iui grab` | Copies the text under your last mouse selection of pictures. Refer to [Copy text from a picture](#copy-text-from-a-picture). |
| `/iui dump` | Shows the last clipboard text with picture cells and how the mod read it (for a bug report). It also writes this to `copy-debug.json` in the cache folder. |
| `/iui probe` | Asks the terminal for its background colour with OSC 11 and shows the raw answers. Refer to [How `auto` is resolved](how-it-works.md#how-auto-is-resolved). |

## Links, file paths and commands

A picture has no text for the terminal, so a click on a link in the picture does not open it. Thus the mod shows the links, file paths and commands of an answer, a plan or a Markdown file that Claude sent in dim rows under its picture. These rows show only when the text has links, file paths or commands. Each item uses one row:

```
↗ Typst docs  https://typst.app/docs
↗ https://github.com/o/r/pull/42
↗ hooks/lib/copy.ts:42
$ brew install typst
```

- **A web link** (`http:`, `https:` or `mailto:`): the link text, then the URL. If the link text is the URL, the URL shows one time. A cmd+click on the link (or the click that your terminal uses for links) opens it.
- **A file path**, for example `hooks/lib/copy.ts:42`: a cmd+click opens the file. A relative path starts from the session's folder (for a Markdown file that Claude sent, from the folder of that file). A row shows only when the file exists.
- **A command** from a `bash`, `sh`, `zsh`, `shell`, `console` or `shell-session` code block, or from inline code that starts with `! `: a click on the row copies the full command, and a toast shows "Copied". A command with more lines shows its first line and the number of the other lines. The click works only where Claude Code gets mouse clicks (fullscreen mode).

The mod does not take web links from code blocks, inline code or math. It takes file paths from the text and from inline code, but not from code blocks.

## Copy text from a picture

Select the text in a picture (an answer, a plan or a Markdown file that Claude sent) with the mouse, as you do with normal text. The selection puts picture cells on the clipboard. While the mod is on and has drawn a picture in this session, the mod sees each change of the clipboard (on macOS in 0.3 s or less; on Linux at once, with the tools in [Linux](install.md#linux)). When the clipboard has picture cells, the mod puts the text under your selection on the clipboard, and a toast shows the number of characters. Wait for this toast, then paste. In fullscreen mode, if this session has a selection, the mod changes the clipboard only when the clipboard holds that selection. Thus a copy from a different Claude Code session usually stays as it is. The mod does not change a clipboard that has no picture cells.

The mod finds the position of each word on a page when you copy from that page for the first time. This takes 0.15–0.5 s, and more (2–3 s) for a page with a large Typst drawing. No toast shows while it does this. Only the toast of the copy shows. The mod keeps the positions in memory, so the next copy from the same page is fast.

If the clipboard did not change, use `/iui grab`. It reads the last mouse selection of Claude Code (fullscreen mode only) and copies its text. If the copied text is not correct, `/iui dump` shows the cells that the mod found and the page that it used. It also writes all of this to `copy-debug.json` in the cache folder.

For the limits, refer to [Limitations](limitations.md).

## Selection and the row grid

The terminal draws a mouse selection as full cells, thus a selection covers full rows. Without the grid, the lines of text in a picture are not on the terminal rows. A line of body text is approximately 1.3 rows tall, and a line in a list or a table is approximately 1.6 rows tall. Thus, after some lines, the selection is not on the text that the mod copies.

The row grid (`/iui grid on`, the default) puts each line of text on the terminal rows:

- Each line of body text, a list, a quote or a table uses one row (or more rows if the text is large). The middle of the text is in the middle of a row.
- Each heading, each code line and each gap between blocks uses full rows.
- The middle of a line that uses 2 rows (or 4 rows) is on the border between two rows. Thus the mod moves such a line down by half a row, and adds half a row above and below the block that holds it. For example, a level-2 heading uses 3 rows, and its text is in the middle row. Thus a selection of one row covers the full height of the text.
- If a line of body text uses 2 rows (with a large text size), the picture starts half a row down, thus body text does not move. Only a line that uses an odd number of rows (for example, some headings) gets the half rows. If the picture starts with such a heading, the picture starts at the heading.
- A heading that has the half rows has no gap below it: the half row below its text is the gap to the text under the heading. The gap above the heading stays. For example, at 100%, a level-3 heading has 2 empty rows above it and 1 empty row below it.
- The reply bullet is on the row that holds the middle of the first line. For example, the bullet is on the second row of a level-1 heading.
- Some blocks have a height that the mod cannot set, for example display math, an image or a Typst drawing. The mod adds space to such a block, so that its height is a number of full rows.

Thus the selection covers the text that the mod copies. The lines are closer together than without the grid, so the look is not the same as VS Code. The grid is on by default. Use `/iui grid off` for the usual spacing. For the limits, refer to [Limitations](limitations.md).

## Plan approval

When Claude exits plan mode, the mod draws the plan as a picture in the transcript. Under the picture, the mod shows its own question, "Approve this plan?", in place of the Claude Code dialog. A dim line above the question tells you that the rendered plan is above. The question has these options:

| Option | What it does |
|---|---|
| Yes, auto-accept edits | Approves the plan. Claude Code then accepts file edits with no question (`acceptEdits` mode). |
| Yes, manually approve edits | Approves the plan. Claude Code then asks you before each file edit (`default` mode). |
| Yes, clear context + auto-accept | Approves the plan, stops the turn and runs `/clear`. Then the mod sends "Implement this plan:" and the plan as a new prompt, in `acceptEdits` mode. |
| Edit the plan | Opens the plan file in an editor. The mod waits until you close the file (10 minutes at most). Then it asks "Approve the edited plan?". When you approve, Claude gets the edited plan. |
| Type something | Sends your text to Claude as changes to the plan. Claude stays in plan mode and writes a new plan. |
| Esc | Rejects the plan and stops the turn. |

The editor is VS Code (`code --wait`) when the `code` command is on your PATH. If `code` is not on the PATH, macOS uses TextEdit (`open -W -t`). In that case, quit TextEdit when you complete the edit. On Linux with a display, the mod uses the first of VSCodium (`codium --wait`), Zed (`zed --wait`), Sublime Text (`subl --wait`), Kate (`kate --block`), gedit (`gedit --wait`) and gvim (`gvim -f`) that is on the PATH. Close the file (or the window) when you complete the edit. Over ssh with no `code` command, and on Linux with none of these editors, the "Edit the plan" option does not show.

The mod shows the plan file as it is when the question opens. Claude can write the plan file and exit plan mode in the same message. Then Claude Code sends the plan from before that write. In this case, the mod waits for the write to complete (5 seconds at most) and reads the file again. You approve the plan that you see, and Claude gets that plan.

The mod uses this flow only when it can draw the plan: the mod is on, Typst is installed, the terminal draws pictures, and the plan is from the main conversation (not from a subagent). In all other conditions, Claude Code shows its own dialog, as with no mod. If the flow fails, Claude Code also shows its own dialog.

For the limits of this flow, refer to [Limitations](limitations.md).
