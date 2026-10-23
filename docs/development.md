# Development

← Back to the [README](../README.md)

## Build and test

```
git clone https://github.com/razorback16/cc-intelligent-ui
cd cc-intelligent-ui
claude --plugin-dir .          # once: Claude Code writes the API types to .claude-plugin/types/
npx -p typescript tsc -p .     # type check
claude plugin test .           # tests
sh tests/cache-sh-test.sh      # the cache folder sweep (CACHE_SH) in sh, dash and bash --posix
sh tests/fonts-sh-test.sh      # the copy of a font out of a terminal's program (PROGRAM_FONTS_SH and _PL) with perl
sh tests/bold-sh-test.sh       # the fake bold of md.typ (term-bold=0) with the real Typst and Monaco (skips with no Monaco)
sh tests/code-sh-test.sh       # code blocks of md.typ (width, header, copy button mark, row grid) with the real Typst (skips with no typst)
sh tests/root-sh-test.sh       # the Typst root of a compile (STAGE_SH): answer code reads no other file, with the real Typst (its compiles skip with no typst)
sh tests/fill-sh-test.sh       # the root of a pasted image's preview (FILL_SH): only fill.typ and the pasted file, with the real Typst (its compiles skip with no typst)
sh tests/check-sh-test.sh      # the skill's check.sh: a private cache folder, and a block reads no other file (skips with no Typst 0.15)
sh tests/footprint-sh-test.sh  # release gate: the validator's footprint is whole (no [+N chars] mark, calls line of 850 characters at most)
sh tests/gap-sh-test.sh        # the gap at a page break of md.typ (seams), on and off the row grid, with the real Typst (skips with no typst)
sh tests/herdr-sh-test.sh      # the herdr client finder (HERDR_CLIENT_SH) with fake ps, stat, lsof and lsappinfo, in sh, dash and bash
claude plugin validate .
```

`.claude-plugin/types/` is not in git. `tsconfig.json` extends the `tsconfig.json` in it, so run Claude Code with the folder once before `tsc`.

## Debug log

Set `IUI_DEBUG=1` before you start Claude Code. The mod then writes trace lines to `debug.log` in the cache folder (`${TMPDIR}/cc-intelligent-ui-<uid>/`, `/tmp` when `TMPDIR` is not set).

Picture select writes trace lines that start with `select:`:

- `select: <phase> #<order> ...`: one line for each post of a `Client`. It gives the phase and the order, the drawing's id, the page, the anchor and the head (the `Client`'s cells), the size of the `Client`'s region, the page's size in cells, the rows of the message on screen (`onScreen`), the page's top row in the message, its rows above the screen (`above`), and the selected rows of each page.
- `select: blit <id> page <n> rows <a>..<b> (<count>)` (or `plain`): one line for each blit of the highlight. It gives the time that the frame waited for the page cache (`wait`, 0 when the page is ready), the times to make the frame (`frame`) and to write it (`write`), the frame's bytes, and the time of `$.ui.blit` (`blit`).
- `select: cache start|first|pause|resume|stop|drop|built ...`: the page cache. `drop` is a page file that no drawing uses now (a redraw). `start` gives the time to read the PNG and the pages in the queue. `first` is a `down` on a page that is not ready. `built` gives the page's size, `ready in` (the time until a frame can be made), `done in` (the time until the tinted pieces are made too), the read, the number of slices, their max and their p95, the pages kept with their MB, and the pages in the queue.
- `select: words <id> page <n> <k> words in <ms> (background)`: the background probe of a page's words (`none` when it found no words).
- `select: copy <n> chars <ms>ms after the up (text <ms>ms, words cached | words probed for page <n>); native selection seen (...) | no native selection`: the copy at `up`, and whether Claude Code has a selection of its own with picture cells.
- `select: native copy seen: ...`: picture cells on the clipboard, or a `$.ui.copy` with picture cells.
- `select: hover <id> page <n> target <i> (<kind>) rows <row>:<x0>-<x1>,...` (or `select: hover none`): the target under the pointer changed (`web`, `file`, `command` or `code`, and its cells; `code` is the copy button of a code block).
- `select: click <id> page <n> at <x>,<y> target <kind>|none`: one line for each click (a `clear`), with the target that it copies.

## Module layout

The hooks module is `hooks/register.tsx`. It connects the hooks to the modules in `hooks/lib/`. Each module has one topic, for example `markdown.ts` (blocks and segments), `mode.ts` (light or dark), `typst.ts` (compile), `fonts.ts` (the lean font set: the fonts that a compile of plain text loads), `draw.tsx` (the pages of an answer and the link rows under them), `links.ts` (the links, file paths and commands of a text), `answer.ts` (one text through the compile and cache steps), `plan.tsx` (the plan approval question and the plan rows), `composer.tsx` (the previews of the images pasted in the draft, above the prompt box), `frame.ts` (the terminal size and the watcher process, which also reports the clipboard changes), `clipboard.ts` (how the clipboard is read and watched for the `/iui grab` toast: macOS, or the Linux tools), `copy.ts` (the text under a mouse selection of pictures), `select.ts` and `blit.ts` (picture select and its highlight), `frames.ts` (the frames of a page: the cell edges, the bands, the row pieces and the frame PNG), `pagecache.ts` (the background page cache: the build queue in slices, and the words probe), `png.ts` (PNG decode, also in steps, and the deflate pieces, in plain JavaScript), `flip.ts` (herdr in iTerm2: the pages and pictures stored with the bands of their rows moved), `probe.ts` (the drawn pages, and the words of a page that a copy reads, kept in memory) and `updates.ts` (the daily check for a new version). The values that change are in one object, `S`, in `state.ts`. The hook bodies in `register.tsx` call `$` themselves; every other `$` call is a wrapper with a short name in `api.ts` (for example `cat` for `$.fs.read`, `exec` for `$.process.run`). The `calls:` note of `claude plugin validate` names each method with the wrappers that call it (`via cat`), and a method that a hook body calls with none. The validator cuts a note at about 1,000 characters and marks the cut `[+N chars]`; the catalogue scan then cannot read the footprint. `tests/footprint-sh-test.sh` is the release gate for this: it fails on a `[+N chars]` mark in the text or the `--json` report, on a calls line (the text after `calls: `) of more than 850 characters, and on a `$` call in `hooks/` outside `api.ts` and `register.tsx`. The tests import from `hooks/register.tsx`, which exports the names that they use.

The skill for Claude is in `skills/intelligent-ui/`: `SKILL.md` (the contract, the workflow and an index), `references/` (one file for each topic: Typst, fletcher, CeTZ, plots and charts) and `scripts/check.sh` (the compile check, with the real template). `TYPST_PROMPT` in `hooks/lib/settings.ts` tells Claude when to load it.

The Typst template is `render/md.typ`. The themes are in `render/themes/` (refer to [`render/themes/README.md`](../render/themes/README.md)). The vendored Typst packages are in `render/packages/preview/`.

## Marketing images

`outcomes/build.sh` renders the samples in `outcomes/samples/` and frames them into the images in `outcomes/out/`. Refer to the [Gallery](gallery.md).
