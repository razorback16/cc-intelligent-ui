// Picture select's Client (lib/select.ts): one over each page of a picture,
// in the cells of that page. It takes the pointer and posts the selection
// whole (anchor, head, phase and order), never a bare event: posts of one
// frame merge, the last one kept. A click with no drag posts `clear`. It
// draws only an empty Box: anything drawn would blank the picture's cells.
import type { ClientModule, JsonValue } from 'claude-code'

type Props = { id: string; page: number }
type Drag = { ax: number; ay: number; hx: number; hy: number; isDown: boolean }

// The posts' order, one count for every instance (the module is shared).
let seq = 0

const Select: ClientModule<Props, Drag> = (props, surface) => {
  const { Box } = surface.elements
  const post = (d: Drag, phase: 'down' | 'move' | 'up' | 'clear') => {
    const size = { columns: surface.columns, rows: surface.rows }
    const data: JsonValue = { id: props.id, page: props.page, anchor: { x: d.ax, y: d.ay }, head: { x: d.hx, y: d.hy }, phase, seq: ++seq, size }
    surface.post(data)
  }
  surface.onPointer(ev => {
    const now = surface.state
    if (ev.type === 'down') {
      if (ev.button && ev.button !== 'left') return
      const next = { ax: ev.x, ay: ev.y, hx: ev.x, hy: ev.y, isDown: true }
      surface.setState(next)
      post(next, 'down')
      return
    }
    if (!now?.isDown || (ev.type !== 'move' && ev.type !== 'up')) return
    const next = { ...now, hx: ev.x, hy: ev.y, isDown: ev.type === 'move' }
    if (ev.type === 'move' && next.hx === now.hx && next.hy === now.hy) return
    surface.setState(next)
    post(next, ev.type === 'move' ? 'move' : next.hx === next.ax && next.hy === next.ay ? 'clear' : 'up')
  })
  return <Box width={surface.columns || undefined} height={surface.rows || undefined} />
}

export default Select
