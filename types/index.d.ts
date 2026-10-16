// The values md-preview keeps in $.state.
export type MdPreviewTheme = 'dark' | 'light'

declare module 'claude-code' {
  interface PluginState {
    'md-preview': {
      // Whether answers are drawn as pictures (also kept in $.store as `enabled`).
      isOn: boolean
      // Goes up each time a render finishes or the setup changes, so the
      // AssistantMessage hooks that read it draw again.
      done: number
    }
  }
}
