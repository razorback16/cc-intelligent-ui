# Development

← Back to the [README](../README.md)

## Build and test

```
git clone https://github.com/razorback16/cc-intelligent-ui
cd cc-intelligent-ui
claude --plugin-dir .          # once: Claude Code writes the API types to .claude-plugin/types/
npx -p typescript tsc -p .     # type check
claude plugin test .           # tests
claude plugin validate .
```

`.claude-plugin/types/` is not in git. `tsconfig.json` extends the `tsconfig.json` in it, so run Claude Code with the folder once before `tsc`.

## Debug log

Set `IUI_DEBUG=1` before you start Claude Code. The mod then writes trace lines to `debug.log` in the cache folder (`${TMPDIR}/cc-intelligent-ui-<uid>/`).

## Module layout

The hooks module is `hooks/register.tsx`. It connects the hooks to the modules in `hooks/lib/`. Each module has one topic, for example `markdown.ts` (blocks and segments), `mode.ts` (light or dark), `typst.ts` (compile), `draw.tsx` (the pages of an answer), `answer.ts` (one text through the compile and cache steps), `plan.tsx` (the plan approval question and the plan rows), `frame.ts` (the terminal size and the watcher process, which also reports the clipboard changes), `copy.ts` (the text under a mouse selection of pictures) and `probe.ts` (the drawn pages, and the words of a page that a copy reads, kept in memory). The values that change are in one object, `S`, in `state.ts`. Each `$` method has one call site, a wrapper in `api.ts`; the other modules call the wrappers. This keeps the `calls:` note of `claude plugin validate` short (the validator cuts a note at about 1,000 characters, and the catalogue scan then cannot read the footprint). The tests import from `hooks/register.tsx`, which exports the names that they use.

The Typst template is `render/md.typ`. The themes are in `render/themes/` (refer to [`render/themes/README.md`](../render/themes/README.md)). The vendored Typst packages are in `render/packages/preview/`.

## Marketing images

`outcomes/build.sh` renders the samples in `outcomes/samples/` and frames them into the images in `outcomes/out/`. Refer to the [Gallery](gallery.md).
