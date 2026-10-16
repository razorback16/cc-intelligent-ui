## Release checklist for v0.2.0

All **four** terminals now pick the right colours. Here is what changed and what is left:

| Terminal | Mode source | Font source | Status |
|---|---|---|---|
| iTerm2 | profile background | profile font | ✅ done |
| Ghostty | config and theme files | `font-family` | ✅ done |
| kitty | `kitty.conf` and includes | `font_family` | ✅ done |
| cmux | adaptive theme | Ghostty config | ✅ done |

- [x] Read the terminal background before the OS appearance
- [x] Send pictures as bytes over **ssh**
- [ ] Test Rio on a real machine

> **Note:** the saved answer stays plain Markdown, so `/copy` still gives you the source.[^1]

[^1]: Only the drawing changes. Use `/copy` to copy an answer as Markdown.
