# Limitations

← Back to the [README](../README.md)

## Copy and picture select

- **Fullscreen only.** Picture select needs fullscreen mode and Claude Code 2.1.298 or newer. It does not work over ssh. Anywhere else, a copy of a picture gives picture cells, which paste as strange characters. Use `/iui grab`, Claude Code's `/copy`, or `/iui off` instead.
- **Start the drag on the picture.** On Claude Code 2.1.298 to 2.1.304, a selection that starts outside a picture (or a double or triple click) is Claude Code's own selection, and it can copy picture cells. From 2.1.305, Claude Code's selection skips pictures. A drag with a modifier key (for example Option in iTerm2) is the terminal's own selection and also copies picture cells.
- **One picture at a time.** A selection stays in the picture where it started, so you cannot select text and a picture together. There is no double click, triple click or Shift+click.
- **Whole words.** A word is copied when the selection covers its middle. In code, in long words (30 characters or more, such as paths and URLs) and in CJK text, the copy goes by character. Inline math copies as its LaTeX source (`$A = \pi r^2$`). If inline math breaks across two lines, select its first line. Display math, text in images and text in Typst drawings do not copy.
- **Clearing a selection.** A single click on normal text and Escape do not clear a picture selection, because Claude Code does not tell the mod about them. A click in a picture, a key in the prompt, a new selection, your next prompt or `/iui off` does.
- **A Claude Code selection stays on screen** when you then drag over a picture. Click normal text or push a key first.
- **Short waits.** The mod reads the words of a page in the background. If you release the button before they are ready, the copy takes up to 0.5 s (2–3 s for a large Typst drawing). Wait for the "copied N chars" toast before you paste. On a page that is not ready, the highlight also comes a moment after the press.
- **The highlight** needs `perl`. Without it, select and copy still work, with no highlight. The colour is VS Code's, not your theme's. A page over 4 MiB has no highlight. If the terminal draws a page with a different aspect than its cells, the highlight can be off by part of a cell. After Claude Code redraws a page, the highlight comes back only when the selection changes. Ready pages use up to 128 MB of memory.
- **Copy on release.** The copy happens when you release the button, even if `copyOnSelect` is off in `/config`.

## Picture cells and `/iui grab`

- **The mod never changes the clipboard for picture cells.** Two sessions can show the same cells, and the mod cannot tell which one the copy came from. A toast tells you to run `/iui grab` in the session that has the picture.
- **`/iui grab` can pick the wrong page.** Picture cells do not identify the answer, so the text can come from a different page or an older answer of the same width. This is more likely on the main screen, after `/clear`, and for pages after the first one. `/iui dump` shows the page it used. The mod remembers only the last 64 pictures of the session.
- **The toast needs a clipboard watcher.** On macOS this is `/usr/bin/perl` with PerlObjCBridge, which macOS has. On Linux it is `wl-paste --watch` on Wayland, else `clipnotify` or Python GTK 3 on X11 and Xwayland. GNOME on Wayland has no data-control protocol, so the mod uses the Xwayland tools there. With no watcher, over ssh, or in a background session, there is no toast. `/iui details` shows the state. With `clipnotify` 1.0.2 or older, a mouse selection also makes the mod read the clipboard once (it changes nothing).

## Clicks and links

- **A click copies; it does not open.** The terminal does not send cmd+click to Claude Code, and on macOS ctrl+click is the secondary click.
- **Not every link is a target.** Code blocks are not targets: select the text. A file path is a target only if the file existed when the answer was drawn. Links to headings, and links in Typst drawings, math or images, are not targets. Until the mod knows the words of a page, hover shows nothing and a click waits.
- **The dim rows under a picture** (with the copy button of a `bash` block) do not show with picture select.
- **Without picture select** (main screen, ssh, older Claude Code, `/iui select off`), a click on a picture does nothing. Use the link rows under it. A command row copies only in fullscreen mode. A `file://` link opens in the app that your terminal chooses.

## How pictures look

- **Close to VS Code, not exact.** Typst does not use CSS. Raw HTML is simplified or dropped. Loose lists get tight spacing (a one-row gap with the row grid on).
- **Fake bold.** In a terminal font with no bold face (for example Monaco), bold text gets a thin outline. A character from a fallback font that has a real bold face looks a little bolder. Bold text inside a Typst drawing shows as regular.
- **The row grid** (`/iui grid on`) puts all text on whole terminal rows:
  - Level 1–3 headings use 3 rows at 100% text size. An answer that starts with a level-2 or level-3 heading has an empty first row.
  - Inline math that is taller than a row adds a row to its line. Math that is only a little taller does not, and can come close to the next line. On the first line of an answer, it can put the reply bullet one row above the text.
  - At larger text sizes (`/iui size`; from about 111% for code, 117% for body text) each line uses 2 rows. Paragraphs then get an almost empty row between lines, tables, math, images, drawings and rules move down half a row, and headings and code blocks can grow by one row.
  - These numbers change with the terminal font and cell size.
- **Page breaks.** A long answer is cut into pages, and each page is laid out alone. Without the row grid, the gap at a break can be up to one row larger. List numbers can shift a little between pages (`9.` and `10.`), and an item alone on a page can lose the spacing of a loose list.
- **While Claude writes**, Claude Code shows the raw Markdown of a block until the block is complete. The block is then blank until its picture is ready: under 1 s for text, 2–3 s for a large drawing. After 2 s, the text shows until the picture is ready, and it stays if the compile fails. After a resume, old answers can be blank for up to 1 s, then show as text until they are drawn.
- **Short summaries** between tool calls stay as text.
- **Search** does not find text in a picture.
- **Dropped images.** If the terminal drops a picture from its image memory (after many large pictures), the mod does not send it again when you scroll back.

## Typst blocks

- `#page`, `#pagebreak` and `#set page` are errors. A package that the mod does not include cannot be downloaded (Typst has no network), so its block shows as code.
- Each compile has a private root with only the template, the theme and the answer's images. A block cannot read other files; if it tries, it shows as code. Nothing leaves your computer.

## Other features

- **PDF files.** The page buttons work only in fullscreen mode. The mod shows one page at a time, with no page count, and you cannot copy text from a page. The page field gets the keyboard only when the prompt is empty; otherwise click the field to type. Esc then goes to the prompt. To close the field, click it and push Esc, or click its close mark.
- **Plan approval.** A mod cannot draw Claude Code's dialog, so the mod asks its own question, with 4 options at most. There is no "keep planning" option: type a reply or push Esc. The edit option needs a GUI editor that waits until you close the file, so not vim or nano, and on Linux not `xdg-open`. Where an organization manages Claude Code, plugin permission hooks do not run, and Claude Code's dialog shows after the mod's question.
- **Cache folders.** The mod uses only its private folder `$TMPDIR/cc-intelligent-ui-<uid>`, which must be yours, mode 700 and not a link. If it is not, the mod draws nothing and `/iui details` says why: fix or remove the folder, then start Claude Code again. The mod also keeps drawing spaces in `~/.cache/cc-intelligent-ui/designs` for 180 days, and fonts copied out of terminal apps in `~/.cache/cc-intelligent-ui/fonts` (fonts of an older app build are deleted after 30 days). It uses `$XDG_CACHE_HOME` when set.

## Terminals

- **Over ssh,** the mod cannot read your local terminal's config. It sizes text by the theme's code font, and `auto` uses `COLORFGBG` if ssh sends it, else dark. Pages are at most 4096 px tall. With tmux or screen on the remote computer, no pictures show.
- **The `auto` theme** reads the settings of iTerm2, Ghostty, kitty, Rio and cmux directly (in herdr, those of the terminal around herdr). It does not read kitty's `globinclude`, `envinclude` and `geninclude` lines, or colours set while kitty runs. In other terminals it uses `COLORFGBG` (set only when the terminal starts), then the OS appearance (on Linux, the desktop portal or the GNOME setting). A theme change in such a terminal that does not change the OS appearance is not seen. Changes show within 3 s.

### herdr

- **Large images.** herdr drops, with no message, an image over its 30 MiB transfer limit (about 22 MiB of pixels, for example 2900 × 2000). The mod makes pages shorter in herdr to fit, but a pasted image, a PDF page or a Typst drawing over the limit does not show.
- **Background with `auto`.** The mod asks herdr for the background (OSC 11) only at the start and when you change to a different herdr client (with `herdr --remote`, only at the start). Between those times, a background change shows only if the terminal's config or the OS appearance changes too.
- **The background question can take a key.** It reads the tty for up to 0.3 s, and Claude Code reads the same tty. A key, a dialog answer, Esc or a mouse report in that moment can go to the mod and be lost. The mod does not ask within 2 s of a key in the prompt, but it cannot see dialog keys or mouse reports. A theme other than `auto` stops the question.
- **Which terminal gives the font.** On macOS, the herdr client in the terminal app in front (if that app has several, the one you typed in last). If the app in front is not a terminal with a client, the mod keeps the one it used before. On Linux, the client where you typed last, which is not always the one you look at. A change shows within 1 s (on Linux up to about 9 s; a newly attached client up to 10 s).
- **When the client is not found.** With `herdr --remote`, the client is on another computer, so there is no terminal font, as over ssh. If the mod cannot read the processes (`ps`), it uses the variables of the terminal that started the herdr server. On Linux with several named herdr sessions, `lsof` cannot tell them apart, so the mod can pick a client of a different session.
- **Variables on macOS** come from `ps eww`, which does not mark where a value ends. A value of a different variable that contains text such as ` TERM=` can leak part of itself into a terminal variable. Linux reads `/proc/<pid>/environ` and does not have this problem.

### herdr in iTerm2

iTerm2 3.6 and 3.7 count each part of an image from the bottom, so herdr's pictures would show with their rows upside down. When the herdr client is iTerm2, the mod stores each page and picture with its rows reversed, so they show correctly. Pages take a little longer to show and their files are larger. Picture select works. These cases are still wrong:

- With `herdr --remote`, the mod cannot see that the terminal is iTerm2, so rows show in the wrong order. Use Ghostty or kitty for `herdr --remote`.
- If the mod cannot find the herdr client, it does not reverse the rows.
- With iTerm2 and another terminal attached, only the terminal the mod follows shows the rows in order. After you change terminals, it draws again within 1 s.
- Right after a change of terminal, or after you make the window narrower, an old picture can show upside down for a moment.
