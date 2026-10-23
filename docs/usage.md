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
  - PNG, JPEG, WebP and SVG images. Typst changes a JPEG, WebP or SVG image into a PNG image in the cache folder. The PNG image is the size of the space for the picture in the transcript, or smaller. Typst does this one time for each version of the file and each size of the space. When the space changes, the mod shows the old PNG image until Typst makes the new one.
  - PDF files. The mod draws one page of the PDF. Typst changes the page into a PNG image in the cache folder. The page fills the space for the picture in the transcript, and it can be larger than the page in the PDF. A line with the page number shows under the page, for example `‹  3  ›`. Click `‹` or `›` to show the page before or the page after. `‹` is gray on page 1, and `›` is gray on the last page. When a page shows, Typst also makes the next page, so that `›` shows it immediately. The mod does not show the number of pages.

    Click the page number to go to a page: a field with the page number opens above the prompt (in fullscreen mode in a wide terminal, at the side of the transcript). Type the page number and push Enter. Push Esc to close the field. If the page does not exist, the field stays open and shows `No page N`.

    A PDF with one page has no line under it. If Typst cannot read the PDF (for example, a PDF with a password or a damaged PDF), the row shows one gray line with the error from Typst. If Typst cannot make one page, the row shows the error for that page above the line. Each row starts on page 1. The mod keeps the page of each row in memory only: a reload of the mod sets all rows to page 1 again, and an old row can lose its page when there are many rows. If the PDF gets shorter, a row on a page that is gone shows the last page.
  - Markdown files (`.md` or `.markdown`, 256 KiB or less). The mod draws the file as rendered pictures, the same as an answer. A relative image path in the file starts from the folder of the file.

  Other files stay as the normal row. JPEG images, WebP images, SVG images, PDF files and Markdown files need Typst.
- Images that you paste into the prompt (`[Image #N]`). The mod draws each image under your prompt.

  These pictures are not larger than the image. They are not wider than the transcript. The height setting (`/iui height`) sets the most rows that they can use (Typst drawings use it too): by default, half the screen and not more than 24 rows. The mod draws PNG, JPEG, WebP and SVG images only. Other image types (for example GIF) stay as the normal row. The size of an SVG image is its width and height in CSS px.
- The plan in plan mode (the ExitPlanMode tool). The mod draws the plan as a picture in the transcript, the same as an answer. Then the mod asks you to approve the plan. Refer to [Plan approval](#plan-approval).

## The intelligent-ui skill

The mod has a skill for Claude: `intelligent-ui`. It has the full API of Typst, fletcher, CeTZ and cetz-plot, recipes for many diagram and chart types, and a compile check. Claude loads it by itself before it writes a complex drawing, or after a drawing did not compile. For normal answers and simple drawings, Claude does not load it.

The compile check (`scripts/check.sh` in the skill) compiles a drawing with the mod's template and your theme, in dark and light mode. It shows the errors and writes PNG images. Claude looks at the images and corrects the drawing before it answers.

You can also start the skill yourself: type `/cc-intelligent-ui:intelligent-ui` (or `/intelligent-ui` when no other command has that name), and then ask for the drawing.

## Commands

| Command | What it does |
|---|---|
| `/iui` | Shows the state, the theme, the text size, the width, the image height and the row grid, a problem that keeps pictures away, and a new version when there is one |
| `/iui details` | Shows all that the mod found: where the mode comes from, the terminal font, the Typst path, why the terminal can or cannot show pictures, if picture select is on (`Picture select:`), if the `/iui grab` toast is on (`/iui grab hint:`), and the state of the update check (`Update checks:`) |
| `/iui on` / `off` | Turns the pictures on or off (kept for later sessions) |
| `/iui setup` / `setup remove` | iTerm2 (macOS only) and herdr (macOS and Linux): adds or removes the shell line that turns pictures on (then close the tab or pane and open a new one). An older line (iTerm2 only) is updated. On Linux outside herdr, it changes no file. |
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
| `/iui select` | Shows the picture select setting: on or off |
| `/iui select on` | With Claude Code 2.1.298 or newer, in fullscreen mode, a drag over a picture selects its text and copies it (kept for later sessions). This is the default. Refer to [Picture select](#picture-select-claude-code-21298-or-newer). |
| `/iui select off` | Stops picture select (kept for later sessions). Then a drag over a picture is the selection of Claude Code. From Claude Code 2.1.305, that selection skips pictures. |
| `/iui updates` | Shows the update check: on or off, and the newest version that it found |
| `/iui updates on` | Looks for a new version one time each day at most, and shows a toast when there is one (kept for later sessions). This is the default. Refer to [Update](install.md#update). |
| `/iui updates off` | Stops the check for a new version and its toast (kept for later sessions) |
| `/iui theme` | Lists the themes, shows which one is in use, and shows the folder for your own themes |
| `/iui theme <name>` | Changes to that theme (kept for later sessions) |
| `/iui grab` | Copies the text under your last mouse selection of pictures. On the main screen, it copies the text of the picture cells on the clipboard. Refer to [Copy text from a picture](#copy-text-from-a-picture). |
| `/iui dump` | Shows the last clipboard text with picture cells and how the mod read it (for a bug report). It also writes this to `copy-debug.json` in the cache folder. |
| `/iui probe` | Asks the terminal for its background colour with OSC 11 and shows the raw answers. Refer to [How `auto` is resolved](how-it-works.md#how-auto-is-resolved). |

## Links, file paths and commands

In fullscreen mode, with picture select on, you click the links, file paths and commands in the picture itself. Refer to [Click a link, a file or a command](#click-a-link-a-file-or-a-command). In other conditions (the main screen, over ssh, Claude Code before 2.1.298, or `/iui select off`), a picture has no text for the terminal, so a click on a link in the picture does not open it. Then the mod shows the links, file paths and commands of an answer, a plan or a Markdown file that Claude sent in dim rows under its picture. These rows show only when the text has links, file paths or commands. Each item uses one row:

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

We recommend fullscreen mode: run `/tui fullscreen` (`/tui default` goes back to the main screen). In fullscreen mode, picture select copies the text of a picture (an answer, a plan or a Markdown file that Claude sent). Refer to [Picture select](#picture-select-claude-code-21298-or-newer).

### Picture select (Claude Code 2.1.298 or newer)

Picture select works in fullscreen mode only. It is on by default. `/iui select off` turns it off, and `/iui select on` turns it on again.

1. Drag over a picture with the left button. Start the drag on the picture. The selected cells show on a blue background (VS Code's selection colour), in the order of the text: the first row from where you started, the rows between, and the last row to the pointer. The layout does not change.
2. Release the button. The mod copies the text of the selected cells (the same words that a copy of these cells gives) and shows the toast "copied N chars of text". Then paste.
3. These remove the selection: a click with no drag in a picture (a click on a link, a file path or a command also copies it, refer to [Click a link, a file or a command](#click-a-link-a-file-or-a-command)), a new selection in a picture, a key typed in the prompt, a new selection of Claude Code (normal text), your next prompt, and `/iui off` or `/iui select off`. A single click on normal text does not (refer to [Limitations](limitations.md)).

A selection can go on into the next page of the same answer.

#### Click a link, a file or a command

With picture select, the web links, file paths, commands and the copy buttons of code blocks in a picture are live. The dim link rows do not show under the picture.

- Move the pointer over a link, a file path, a command or a copy button (no button). Its cells show on the blue background. Move the pointer off it, and the background goes. While a selection shows, there is no such highlight.
- Click it (push and release the button on the same cell). The mod copies it and shows a toast: a web link copies its URL ("copied the link"), a file path copies its full path ("copied the path"), a command copies the full command ("copied the command"), and the copy button of a code block (at the top right of the block) copies all the code of the block ("copied the code").
- A drag that starts on a link, a file path or a command selects text, as on other text.

A web link is a Markdown link to an `http:`, `https:` or `mailto:` URL, or a URL in the text. A file path is in the text or in inline code, and the file must exist (a relative path starts from the session's folder). A command is any inline code that is not a file that exists, for example `` `git status` `` (a click copies its text; for `` `! cmd` `` it copies only `cmd`). The text of a code block is not a target: to copy all of it, click its copy button, or select its text. A link to a heading in the same text is not a link for this.

When a page is drawn or comes on the screen, the mod gets the page ready for the highlight in the background. It also finds the position of each word on the page. Thus the first highlight and the copy are fast. If you push the button on a page that is not ready, the mod gets that page ready first, and the first highlight shows a short time later. If the words of the page are not ready when you release the button, the copy waits for them: approximately 0.05 s for plain text (only ASCII characters, no math, no Typst block and no image), 0.15–0.5 s for other text, and more (2–3 s) for a page with a large Typst drawing. No toast shows while the mod does this. Only the toast of the copy shows. The mod keeps the positions in memory, so the next copy from the same page is fast.

### Picture cells on the clipboard

On the main screen (not fullscreen mode), there is no picture select. The terminal copies the selection itself, not Claude Code. The copy gives picture cells (kitty placeholder characters), not text. A selection of Claude Code that starts outside a picture can also copy picture cells (refer to [Limitations](limitations.md)). The mod never changes the clipboard for such a copy, because it cannot know which session the copy is from.

While the mod is on and has drawn a picture in this session, it sees each change of the clipboard (on macOS in 0.3 s or less; on Linux at once, with the tools in [Linux](install.md#linux)). When the clipboard has picture cells of a picture in this session, a toast tells you to use `/iui grab`. Run `/iui grab` in the same session. When the mod draws its first picture on the main screen, a toast recommends fullscreen mode (one time in each session).

`/iui grab` puts the text on the clipboard. In fullscreen mode, it reads the last mouse selection of Claude Code and copies its text. With no selection (the main screen), it reads the picture cells on the clipboard and copies their text. If the clipboard has the text already, it tells you. If the copied text is not correct, `/iui dump` shows the cells that the mod found and the page that it used. It also writes all of this to `copy-debug.json` in the cache folder.

A copy of picture cells through `$.ui.copy` gets the text in place of the cells.

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
