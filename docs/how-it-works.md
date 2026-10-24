# How it works

← Back to the [README](../README.md)

## The steps

1. **Get the Markdown.** A `ui.render` hook on `AssistantMessage` gets each block of the answer as Markdown.
2. **Wait for the full block.** Claude Code passes a block only when it is complete, and shows its own text until then. The block is final when the model request moves on to its next block or ends, or when its text has not changed for 400 ms.
3. **Compile.** The mod writes the block to a JSON file and runs `typst compile` with `render/md.typ` in a private root (see [The Typst root](#the-typst-root)). A long answer is cut into pages at block boundaries, one PNG per page. The pages stack with no gap, so Typst measures the space between the two blocks at each cut and puts it at the top of the next page.
4. **Draw.** The hook draws one `Image` per PNG in place of the text, sized to match the terminal text (see [Text size and fonts](#text-size-and-fonts)).
5. **Safe mode.** If a compile fails (a bad Typst block or an unknown LaTeX command), the mod compiles again with Typst blocks and math as code, and a dim line names the error. If that also fails, the normal text shows.
6. **Cache.** Pictures go in `${TMPDIR}/cc-intelligent-ui-<uid>/` (`/tmp` when `TMPDIR` is not set). Folders older than 2 days are deleted at start. The drawing space of each answer goes in `~/.cache/cc-intelligent-ui/designs`, so its Typst drawings keep the same share of the screen in later sessions.
7. **Link rows.** Under the pages, the mod draws one dim row for each web link, file path and command in the Markdown: an OSC 8 `Link` for a link or an existing file, and a `Button` that copies a command. With picture select on, these rows are not drawn, because the links are live in the picture.
8. **The plan.** A `ui.render` hook on the ExitPlanMode row draws the plan. A `tool.call` hook asks the mod's own approval question, and a `classic.PermissionRequest` hook passes the answer to Claude Code, so its dialog does not show.
9. **Pasted images.** The `prompt.edit` and `prompt.change` hooks note the `[Image #N]` numbers in the draft. Hooks on `AbovePrompt` and `UserMessage` draw a small preview of each, from the PNG that Claude Code wrote at the paste. For a pasted image path, the preview uses the file that the clipboard names. Typst fills the preview's cells with `render/fill.typ`, in a root with only that template and the image.

## Text size and fonts

- **Matched size.** The mod finds the terminal font and the cell size in pixels, and Typst measures both fonts, so 100% looks as large as the terminal text. Body text and code use the terminal font.
- **Font source.** The iTerm2 profile, or the Ghostty, kitty or Rio config. On Linux, else fontconfig's `monospace`. Else the theme's code font (Menlo on macOS).
- **The font the terminal really draws.** If the configured font is not installed, the mod follows the terminal's own fallback (for example Menlo for kitty on macOS, your fixed-pitch font for iTerm2).
- **Built-in fonts.** With no font configured, Ghostty and cmux draw their own JetBrains Mono, and Rio its own Cascadia Code NF. These live inside the terminal program, so the mod copies them once per terminal version to `~/.cache/cc-intelligent-ui/fonts/`.
- **Fake bold.** If the terminal font has no bold face (for example Monaco), bold text gets a thin outline, as a terminal draws it.
- **Ghostty padding.** In Ghostty and cmux, the mod removes the window padding from the cell size, because Ghostty includes it in the pixel size.

## The Typst root

Typst blocks run as code, and Typst code can read any file under its root. So each compile gets a new private folder as its root (`STAGE_SH` in `hooks/lib/typst.ts`), removed afterwards. It holds only:

- `render/`: a copy of `md.typ` and links to the rest of the template.
- The JSON file of the blocks.
- A link to the theme folder.
- A link to each image that the answer names, if it is a real image file.

Other paths are not found, and `..` cannot leave the root. The network is off, and only the vendored packages in `render/packages/` load.

## Copy and the clipboard

- **Native copy.** A copy that puts picture cells on the clipboard (the terminal's own copy, a Claude Code selection that starts outside a picture, or a copy in another session) is a native copy. The mod never rewrites it.
- **The watcher.** One long-lived `perl` process watches the terminal size and the clipboard. On macOS it reads the clipboard's change counter every 0.3 s through PerlObjCBridge. On Linux it runs `wl-paste --watch`, `clipnotify` or GTK 3 from Python (see [Linux](install.md#linux)), so nothing runs between changes. It watches the clipboard only after the first picture of the session.
- **The toast.** When the clipboard holds picture cells of a page drawn in this session, a toast names `/iui grab`. The clipboard does not change.
- **Passwords.** The mod does not read a password manager's copy (macOS concealed or transient types, the KDE password hint on Linux, or a Wayland copy marked sensitive).
- **`/iui grab`.** Reads Claude Code's last mouse selection, or on the main screen the picture cells on the clipboard, and copies their text with `$.ui.copy`. A `ui.copy` hook also turns picture cells sent through `$.ui.copy` into text.
- **From cells to text.** Each picture cell holds its row and column (the kitty placeholder U+10EEEE and two combining marks). The mod finds the drawn page with those rows, then runs a probe (`typst query` on the same template and inputs) to get the position of each word. It keeps the words of the last 64 pages in memory only.

## Picture select

Claude Code's selection copies picture cells as placeholder characters, not text (from 2.1.305 it skips them). So the mod selects pictures itself (`hooks/lib/select.ts`):

- **Pointer.** Over each page sits a `Client` (`hooks/sel.tsx`) that takes the pointer and posts the selection: anchor, head, and phase (`down`, `move`, `up`, `clear`, `hover`, `leave`). The `Client` is in the flow, not in an absolute `Box`, because Claude Code moves an absolute `Box` above the screen down to row 0.
- **Highlight.** The layout never changes. The mod swaps the page's picture with `$.ui.blit` (`hooks/lib/blit.ts`), one small kitty command with the same image id, at most once per 16 ms.
- **PNG in JavaScript.** The hooks have no zlib, so `hooks/lib/png.ts` decodes the page and keeps a deflate piece for each row of cells, plain and tinted. A frame joins the pieces and builds new ones only for the first and last rows. `perl` writes the frame to a file that the terminal reads.
- **Copy.** At `up`, the mod copies the words under the selected cells with `$.ui.copy`, and a toast says "copied N chars of text".
- **Click targets** (`hooks/lib/targets.ts`). The probe also tags link URLs, inline code and each code block's copy button. Hover highlights the target. A click opens a link or a file (alt+click copies it) and copies a command or code.
- **Clearing.** A selection goes when you type in the prompt or make a Claude Code selection (checked every 250 ms while a selection shows).
- **When it is on.** Fullscreen mode, Claude Code 2.1.298 or newer, not over ssh. If a `Client` fails, picture select is off until a reload. `/iui details` shows the state.

### The page cache

The mod gets each page ready before the first `down` on it (`hooks/lib/pagecache.ts`). When a page is drawn or comes on screen, the mod decodes it, builds its row pieces, and probes its words in the background. The hooks have no threads, so this runs in slices of 4 ms at most, and scrolling and drawing go on.

- **Order.** One page at a time: a page you pressed on first, then pages on screen, newest answer first.
- **Off screen.** A page that leaves the screen leaves the queue. A redraw drops the old pages.
- **Memory.** Decoded pages use up to 128 MB, and pages off screen go first. `/iui off` and `/iui select off` free it all. Nothing is written to disk.
- **Not ready.** If a page is not ready at `down`, the mod finishes it first (about 0.25 s for a tall page on Apple Silicon).

## The lean font set

At each start, Typst reads all the fonts on the computer, about 70 ms per compile on macOS. Plain text does not need them. Plain text means ASCII only, with no math outside code, no live Typst block, no image and no HTML entity. About 3 of 4 blocks are plain text.

For plain text, Typst loads only:

- The terminal font.
- The theme's body and code fonts, without CJK and emoji fonts.
- Typst's own fonts (for example the math font).

The mod links these files into one cache folder (`fonts-<hash>`) and runs Typst with `--ignore-system-fonts --font-path <folder>`. The PNG does not change, because Typst takes each ASCII character from the first font of the list, and that font is in the folder.

The mod makes the folder once per session, from `typst fonts --variants`. It skips the folder when:

- The first installed font of a list is a CJK or emoji font.
- A list has no installed font.
- One style of a font is in two files.
- The theme's list markers or numbering are not ASCII.

If a compile with the folder fails, the mod compiles again with all fonts.

## How `auto` is resolved

Claude Code finds light or dark for `auto` by asking the terminal for its background colour (OSC 11). A mod cannot see that answer, so Intelligent UI tries these sources in order, and the first answer wins:

1. **The iTerm2 profile:** the background of the profile in use (`ITERM_PROFILE`, else the default profile). If the profile has light and dark colours, the set for iTerm2's theme (Settings > Appearance), or for the OS appearance when that theme is Automatic, Minimal or Compact.
2. **The Ghostty config:** the `background` from `ghostty +show-config`. With `theme = light:A,dark:B`, the theme file for the OS appearance. With neither, Ghostty's default (dark).
   - **cmux** also reads its own `config.ghostty`, where the cmux themes picker writes, and that theme wins. With no theme or colours set, cmux uses its adaptive default theme, and the mod follows cmux's appearance setting (`app.appearance` in `~/.config/cmux/cmux.json`).
3. **The kitty config:** the `background` in `kitty.conf` and its `include` files. With `dark-theme.auto.conf`, `light-theme.auto.conf` or `no-preference-theme.auto.conf` (kitty 0.38 and later), the file for the OS appearance. With no `background`, kitty's default (dark).
4. **The Rio config:** `config.toml`. With `[adaptive-theme]`, the theme for `force-theme` or the OS appearance. Else the `theme` file, else `[colors] background`, else Rio's default (dark).
5. **`COLORFGBG`**, as it was when Claude Code started.
6. **The OS appearance:** macOS Dark or Light. On Linux, the freedesktop portal's `color-scheme`, else GNOME's `color-scheme`.
7. **Dark.**

The terminal comes before the OS: a dark terminal on a light Mac is dark. The mod checks every 3 s, and after a change each mode's pictures compile once. `/iui probe` sends OSC 11 and shows the raw answers, to test whether they can reach the mod.

### herdr

In herdr, `TERM_PROGRAM` is `herdr`, so it does not name the terminal around herdr.

- **Background first.** herdr answers OSC 11 with the background of the terminal in front, so in herdr this comes before the sources above. Because the question shares Claude Code's tty, the mod asks only at start and when the herdr client changes, after 2 s with no key in the prompt, 3 times at most.
- **Which terminal.** The mod lists this user's herdr clients. On macOS it picks the one in the terminal app in front; otherwise the one whose tty was used last. It then uses that terminal's config and font.
- **Checks.** A light check every 1 s, and a full check of the process list on a change and every 10 s, only while pictures show in herdr.
- **iTerm2 under herdr.** herdr draws each picture row as its own kitty placement, and iTerm2 3.6 and 3.7 count the source rectangle from the bottom. So for an iTerm2 client, the mod stores pictures with the row bands in reverse order (`hooks/lib/flip.ts`).
- **Fallback.** With no client, the mod uses the variables herdr kept from the terminal that started it, then `COLORFGBG`, then the OS appearance.
