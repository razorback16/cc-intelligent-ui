# Development

← Back to the [README](../README.md)

## Build and test

```
git clone https://github.com/razorback16/cc-intelligent-ui
cd cc-intelligent-ui
claude --plugin-dir .          # once: Claude Code writes the API types to .claude-plugin/types/
npx -p typescript tsc -p .     # type check
claude plugin test .           # tests
sh tests/cache-sh-test.sh      # cache folder sweep, in sh, dash and bash --posix
sh tests/fonts-sh-test.sh      # copying a font out of a terminal program
sh tests/bold-sh-test.sh       # fake bold with real Typst and Monaco (skips with no Monaco)
sh tests/code-sh-test.sh       # code blocks: width, header, copy button, row grid (skips with no typst)
sh tests/root-sh-test.sh       # the Typst root: answer code reads no other file (compiles skip with no typst)
sh tests/fill-sh-test.sh       # the paste preview root: only fill.typ and the image (compiles skip with no typst)
sh tests/check-sh-test.sh      # the skill's check.sh: private cache, no other file read (skips with no Typst 0.15)
sh tests/footprint-sh-test.sh  # release gate: the validator footprint is whole
sh tests/gap-sh-test.sh        # the gap at a page break, on and off the row grid (skips with no typst)
sh tests/flip-sh-test.sh       # writing a flipped PNG or frame with real perl, also two writers at once
sh tests/herdr-sh-test.sh      # the herdr client finder with fake ps, stat, lsof and lsappinfo
sh tests/install-sh-test.sh    # site/install.sh in a sandbox HOME (shellcheck when installed)
claude plugin validate .
```

`.claude-plugin/types/` is not in git. `tsconfig.json` extends the one in it, so run Claude Code with the folder once before `tsc`.

## Release

1. **Bump the version** in `.claude-plugin/plugin.json`. Claude Code updates the mod only when this changes.
2. **Add a section** to `CHANGELOG.md`.
3. **Run the tests** above.
4. **Tag the commit** `v<version>`:

   ```
   git tag -a v<version> -m "cc-intelligent-ui <version>"
   ```

5. **Deploy the site** with the release. It serves `site/install.sh` at https://intelligentui.art/install.sh, and `.github/workflows/pages.yml` deploys it on a push to `main` that changes `site/`. Then check that the script is there:

   ```
   curl -fsSL https://intelligentui.art/install.sh | head -1    # #!/usr/bin/env bash
   ```

## Debug log

Set `IUI_DEBUG=1` before you start Claude Code. The mod then writes `debug.log` in the cache folder (`${TMPDIR}/cc-intelligent-ui-<uid>/`, `/tmp` when `TMPDIR` is not set).

Picture select lines start with `select:`:

- `select: <phase> #<order> ...`: each `Client` post. The drawing's id, page, anchor and head, the region size, the page size in cells, the message rows on screen (`onScreen`), the page's top row, its rows above the screen (`above`), and the selected rows of each page.
- `select: blit <id> page <n> rows <a>..<b> (<count>)` (or `plain`): each highlight blit. Time waiting for the page cache (`wait`), to make the frame (`frame`), to write it (`write`), the frame's bytes, and the `$.ui.blit` time (`blit`).
- `select: cache start|first|pause|resume|stop|drop|built ...`: the page cache. `start`: PNG read time and queue. `first`: a `down` on a page that is not ready. `drop`: a page file no longer drawn. `built`: size, `ready in`, `done in`, read time, slice count, max and p95, pages kept with their MB, and queue.
- `select: words <id> page <n> <k> words in <ms> (background)`: the background word probe (`none` when it found no words).
- `select: copy <n> chars <ms>ms after the up (text <ms>ms, words cached | words probed for page <n>); native selection seen (...) | no native selection`: the copy at `up`, and whether Claude Code has its own selection with picture cells.
- `select: native copy seen: ...`: picture cells on the clipboard, or a `$.ui.copy` with picture cells.
- `select: hover <id> page <n> target <i> (<kind>) rows <row>:<x0>-<x1>,...` (or `select: hover none`): the target under the pointer changed. Kind is `web`, `file`, `command` or `code` (a code block's copy button).
- `select: click <id> page <n> at <x>,<y> target <kind>|none`: each click (a `clear`) and the target it copies.

## Module layout

`hooks/register.tsx` is the hooks module. It connects the hooks to the modules in `hooks/lib/`, one topic each:

| Module | Topic |
| --- | --- |
| `answer.ts` | One text through compile and cache, and its states before it is ready |
| `api.ts` | The wrappers for every `$` call outside `register.tsx` |
| `blit.ts` | Picture select's highlight with `$.ui.blit` |
| `clipboard.ts` | Reading and watching the clipboard, on macOS and Linux |
| `command.ts` | The `/iui` command and its typeahead |
| `composer.tsx` | Previews of pasted images and pasted image paths |
| `copy.ts` | The text under a mouse selection of pictures |
| `designs.ts` | The drawing space kept per answer across sessions |
| `draw.tsx` | The pages of an answer and the link rows under them |
| `env.ts` | Setup at load: cache folder, Typst, terminal, font, theme |
| `epoch.ts` | Swapping all pictures at once after a resize or setting change |
| `flip.ts` | herdr in iTerm2: pictures stored with row bands reversed |
| `fonts.ts` | The lean font set |
| `frame.ts` | Terminal size and the watcher process |
| `frames.ts` | A page's frames: cell edges, row pieces, frame PNG |
| `grid.ts` | The row grid's first-line position |
| `host.ts` | Shell snippets: tty size, terminal font, light or dark for `auto` |
| `images.ts` | Which images, PDFs and Markdown files a message names |
| `links.ts` | Links, file paths and commands in a text |
| `log.ts` | The debug log |
| `markdown.ts` | Blocks, fences and segments |
| `mode.ts` | Light or dark (pure) |
| `pagecache.ts` | The background page cache and word probe |
| `pictures.tsx` | Files Claude sends: images, PDFs, Markdown |
| `plan.tsx` | The plan approval question and plan rows |
| `png.ts` | PNG decode and deflate pieces in plain JavaScript |
| `probe.ts` | Drawn pages and their words, in memory |
| `select.ts` | Picture select |
| `settings.ts` | Sizes, limits, timings, and the system prompt text |
| `setup.ts` | `/iui setup` for iTerm2 and herdr |
| `state.ts` | Shared types and the state object `S` |
| `stream.ts` | Streaming and the compile queue |
| `targets.ts` | Click targets on a page |
| `terminal.ts` | What the terminal can draw |
| `terminals.ts` | Each terminal's config: background and font |
| `themes.ts` | Themes and `/iui theme` |
| `typst.ts` | Finding Typst, measuring fonts, compiling, the Typst root |
| `updates.ts` | The daily check for a new version |

`hooks/sel.tsx` is picture select's `Client`. The tests import from `hooks/register.tsx`, which exports the names they use.

**Footprint gate.** Only hook bodies in `register.tsx` and the wrappers in `api.ts` call `$` (for example `cat` wraps `$.fs.read`, `exec` wraps `$.process.run`). The `calls:` note of `claude plugin validate` names each method and its wrappers (`via cat`). The validator cuts that note at about 1,000 characters and marks the cut `[+N chars]`, and then the catalogue scan cannot read the footprint. `tests/footprint-sh-test.sh` fails on:

- a `[+N chars]` mark in the text or the `--json` report,
- a calls line (the text after `calls: `) over 850 characters,
- a `$` call in `hooks/` outside `api.ts` and `register.tsx`.

## Other parts

- **The skill** is in `skills/intelligent-ui/`: `SKILL.md` (contract, workflow, index), `references/` (Typst, fletcher, CeTZ, plots and charts) and `scripts/check.sh` (compile check with the real template). `TYPST_PROMPT` in `hooks/lib/settings.ts` tells Claude when to load it.
- **The template** is `render/md.typ`. Themes are in `render/themes/` (see [`render/themes/README.md`](../render/themes/README.md)). Vendored Typst packages are in `render/packages/preview/`.
- **Marketing images.** `outcomes/build.sh` renders `outcomes/samples/` into `outcomes/out/`. See the [Gallery](gallery.md).
