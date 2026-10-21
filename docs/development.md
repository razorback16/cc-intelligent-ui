# Development

← Back to the [README](../README.md)

## Build and test

```
git clone https://github.com/razorback16/cc-intelligent-ui
cd cc-intelligent-ui
claude --plugin-dir .          # once: Claude Code writes the API types to .claude-plugin/types/
npx -p typescript tsc -p .     # type check
claude plugin test .           # tests
sh tests/shim-test.sh          # the clipboard shims and their asks, with fake tools and a fake mod (also dash, bash --posix)
claude plugin validate .
```

`.claude-plugin/types/` is not in git. `tsconfig.json` extends the `tsconfig.json` in it, so run Claude Code with the folder once before `tsc`.

## Debug log

Set `IUI_DEBUG=1` before you start Claude Code. The mod then writes trace lines to `debug.log` in the cache folder (`${TMPDIR}/cc-intelligent-ui-<uid>/`, `/tmp` when `TMPDIR` is not set).

Picture select writes one line for each post of a `Client` (lines that start with `select:`): the phase and the order, the drawing's id, the page, the anchor and the head (the `Client`'s cells), the size of the `Client`'s region, the page's size in cells, the rows of the message on screen (`onScreen`), the page's top row in the message, its rows above the screen (`above`), and the selected rows of each page. Each blit of the highlight writes a line too (`select: blit`): the page, its selected rows (or `plain`), the times to decode the page (0 when it is decoded already), make the frame and write it, the frame's bytes, and the time of `$.ui.blit`. The first decode of a page writes `select: decoded` with its time.

## Module layout

The hooks module is `hooks/register.tsx`. It connects the hooks to the modules in `hooks/lib/`. Each module has one topic, for example `markdown.ts` (blocks and segments), `mode.ts` (light or dark), `typst.ts` (compile), `fonts.ts` (the lean font set: the fonts that a compile of plain text loads), `draw.tsx` (the pages of an answer and the link rows under them), `links.ts` (the links, file paths and commands of a text), `answer.ts` (one text through the compile and cache steps), `plan.tsx` (the plan approval question and the plan rows), `frame.ts` (the terminal size and the watcher process, which also reports the clipboard changes), `clipboard.ts` (how the clipboard is read and watched: macOS, or the Linux tools; the clipboard shims, from the template `hooks/clip-shim.sh`, set up by `hooks/clip-shim-setup.sh`; and the reader of their asks), `copy.ts` (the text under a mouse selection of pictures), `select.ts` and `blit.ts` (picture select and its highlight), `png.ts` (PNG decode and the frames' deflate pieces, in plain JavaScript), `probe.ts` (the drawn pages, and the words of a page that a copy reads, kept in memory) and `updates.ts` (the daily check for a new version). The values that change are in one object, `S`, in `state.ts`. Each `$` method has one call site, a wrapper in `api.ts`; the other modules call the wrappers. This keeps the `calls:` note of `claude plugin validate` short (the validator cuts a note at about 1,000 characters, and the catalogue scan then cannot read the footprint). The tests import from `hooks/register.tsx`, which exports the names that they use.

The skill for Claude is in `skills/intelligent-ui/`: `SKILL.md` (the contract, the workflow and an index), `references/` (one file for each topic: Typst, fletcher, CeTZ, plots and charts) and `scripts/check.sh` (the compile check, with the real template). `TYPST_PROMPT` in `hooks/lib/settings.ts` tells Claude when to load it.

The Typst template is `render/md.typ`. The themes are in `render/themes/` (refer to [`render/themes/README.md`](../render/themes/README.md)). The vendored Typst packages are in `render/packages/preview/`.

## Marketing images

`outcomes/build.sh` renders the samples in `outcomes/samples/` and frames them into the images in `outcomes/out/`. Refer to the [Gallery](gallery.md).
