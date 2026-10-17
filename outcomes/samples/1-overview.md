Here is one answer with everything Intelligent UI draws:

![Introducing Intelligent UI](intelligent-ui.png)

## Real documents, not raw text

Claude's answers arrive with **headings**, *emphasis*, `inline code`, [links](https://github.com/razorback16/claude-intelligent-ui) and pictures like the one above.

| Element | You write | You see |
|:--|:--|:--:|
| Table | `\| a \| b \|` | aligned columns |
| Task list | `- [x] done` | checkboxes |
| Math | `$e^{i\pi} + 1 = 0$` | $e^{i\pi} + 1 = 0$ |
| Image | `![alt](cover.png)` | the picture |

```ts
// Syntax colours in Claude Code's own palette
export async function draw(answer: string): Promise<Picture> {
  return typst.compile(answer, { theme: "claude-code" })
}
```

- [x] Draw Markdown in the terminal
- [x] Set LaTeX math and run live Typst
- [ ] Make coffee

> **Note:** Typst draws everything on your computer. The saved answer stays Markdown.
