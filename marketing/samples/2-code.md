### Pick the mode from the terminal, not the OS

The terminal knows its own background, so ask it first:

```ts
export function itermModeOf(p: Profile, look: Mode): Mode {
  const key = p.separate
    ? `Background Color (${cap(look)})`
    : 'Background Color'
  return modeOfLuminance(luminanceOf(p[key]))  // > 0.4: light
}
```

```python
def luminance(r: float, g: float, b: float) -> float:
    lin = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
```

```diff
- const os = await readOsMode($)
+ const term = await readItermMode($) ?? await readGhosttyMode($)
+ if (term) return term
```
