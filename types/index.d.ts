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
      // The `[Image #N]` numbers of the prompt box's draft, so the band above
      // the prompt draws their previews.
      draft: number[]
      // Per prompt row (its requestId): goes up when a filled copy of one of
      // its pasted images is made, so that row draws again.
      filled: StateFamily<number>
    }
  }
}
