// The values Intelligent UI keeps in $.state.
export type IuiTheme = 'dark' | 'light'

declare module 'claude-code' {
  interface PluginState {
    'cc-intelligent-ui': {
      // Whether answers are drawn as pictures (also kept in $.store as `enabled`).
      isOn: boolean
      // Goes up each time a render finishes or the setup changes, so the
      // AssistantMessage hooks that read it draw again.
      done: number
    }
  }
}
