// Picture select's Client (lib/select.ts): one over each page of a picture,
// in the cells of that page. It takes the pointer and posts the selection
// whole (anchor, head, phase and order), never a bare event: posts of one
// frame merge, the last one kept. A click with no drag posts `clear`. With
// no button down, a move to a new cell posts `hover` and a leave `leave`;
// each carries the last up or clear (`end`), which it may replace. It draws
// only an empty Box: anything drawn would blank the picture's cells. It sets
// no key listener: with one, a click would give it the keys (the prompt
// would get none until Escape), and Escape never reaches it.
import type { ClientModule, JsonValue } from 'claude-code'

type Props = { id: string; page: number }
// The drag (anchor, head, the button down), the cell of the last hover post
// ('' none) and the last up or clear posted.
type Drag = { ax: number; ay: number; hx: number; hy: number; isDown: boolean; over?: string; end?: JsonValue }
type Phase = 'down' | 'move' | 'up' | 'clear' | 'hover' | 'leave'

// The posts' order, one count for every instance (the module is shared).
let seq = 0

const Select: ClientModule<Props, Drag> = (props, surface) => {
  const { Box } = surface.elements
  const dataOf = (d: Drag, phase: Phase): JsonValue => {
    const size = { columns: surface.columns, rows: surface.rows }
    const data: Record<string, JsonValue> = { id: props.id, page: props.page, anchor: { x: d.ax, y: d.ay }, head: { x: d.hx, y: d.hy }, phase, seq: ++seq, size }
    if ((phase === 'hover' || phase === 'leave') && d.end) data.end = d.end
    return data
  }
  // Posts the drag at `phase` and keeps it as the state; an up or a clear is kept with it (`end`).
  const post = (d: Drag, phase: Phase) => {
    const data = dataOf(d, phase)
    surface.setState(phase === 'up' || phase === 'clear' ? { ...d, end: data } : d)
    surface.post(data)
  }
  surface.onPointer(ev => {
    const now = surface.state
    if (ev.type === 'down') {
      if (ev.button && ev.button !== 'left') return
      post({ ax: ev.x, ay: ev.y, hx: ev.x, hy: ev.y, isDown: true }, 'down')
      return
    }
    if (!now?.isDown) {
      // No button down: a hover at each new cell, a leave once.
      const idle: Drag = now ?? { ax: ev.x, ay: ev.y, hx: ev.x, hy: ev.y, isDown: false }
      if (ev.type === 'move' && !ev.button) {
        const cell = `${ev.x},${ev.y}`
        if (idle.over === cell) return
        post({ ...idle, ax: ev.x, ay: ev.y, hx: ev.x, hy: ev.y, over: cell }, 'hover')
      } else if (ev.type === 'leave' && idle.over) post({ ...idle, over: '' }, 'leave')
      return
    }
    if (ev.type !== 'move' && ev.type !== 'up') return
    // A move with no button while down: its up was lost, so the drag ends where it was.
    // The cell of an end counts as hovered (the hooks tint a click's target again).
    if (ev.type === 'move' && !ev.button) {
      const ended = { ...now, isDown: false, over: `${now.hx},${now.hy}` }
      post(ended, ended.hx === ended.ax && ended.hy === ended.ay ? 'clear' : 'up')
      return
    }
    const next = { ...now, hx: ev.x, hy: ev.y, isDown: ev.type === 'move', ...(ev.type === 'up' ? { over: `${ev.x},${ev.y}` } : {}) }
    if (ev.type === 'move' && next.hx === now.hx && next.hy === now.hy) return
    post(next, ev.type === 'move' ? 'move' : next.hx === next.ax && next.hy === next.ay ? 'clear' : 'up')
  })
  return <Box width={surface.columns || undefined} height={surface.rows || undefined} />
}

export default Select
