// The one call site of each `$` method the mod uses: the other modules call
// these wrappers, so the `calls:` note of `claude plugin validate` names one
// function per method and stays short. Each wrapper is a function
// declaration that spells the call `$.noun.method(...)` (the validator
// follows `$` into a declaration only), with the types of EngineInterface.
import type {
  AskOptions, CommandSpec, EngineInterface, FsBytes, FsReadBytesOptions, FsReadOptions, FsStatOptions, HttpInit, ImageBlitArgs, InvalidatableEventName,
  OpEventOf, PaneCloseArgs, PaneOpenArgs, ProcessRunInit, ProcessSpawnRequest, ResolveInput, ToastOptions, UiCopyArgs, UiLogOptions,
} from 'claude-code'

// The environment variables the mod reads. `$.env.get` takes a literal name
// (the validator lists them), so envGet has one call per name.
export type EnvName =
  | 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' | 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES' | 'CLAUDE_CODE_SESSION_KIND' | 'CLAUDE_CODE_TMPDIR'
  | 'CMUX_SOCKET_PATH' | 'CMUX_SURFACE_ID' | 'CMUX_WORKSPACE_ID' | 'COLORFGBG' | 'DISABLE_AUTOUPDATER' | 'DISABLE_UPDATES' | 'DISPLAY'
  | 'GHOSTTY_RESOURCES_DIR' | 'HOME'
  | 'ITERM_PROFILE' | 'ITERM_SESSION_ID' | 'IUI_DEBUG' | 'IUI_FORCE' | 'KITTY_CONFIG_DIRECTORY' | 'KITTY_PID'
  | 'KITTY_WINDOW_ID' | 'LC_TERMINAL' | 'RIO_CONFIG_HOME' | 'SHELL' | 'SSH_CONNECTION' | 'SSH_TTY' | 'STY'
  | 'TERM' | 'TERM_PROGRAM' | 'TMUX' | 'TYPST_FONT_PATHS' | 'WAYLAND_DISPLAY' | 'XDG_CONFIG_HOME' | 'XDG_CURRENT_DESKTOP' | 'ZDOTDIR'

export function clockAfter($: EngineInterface, ms: number, fn: () => void) {
  return $.clock.after(ms, fn)
}

export function clockEvery($: EngineInterface, ms: number, fn: () => void) {
  return $.clock.every(ms, fn)
}

export function clockNow($: EngineInterface) {
  return $.clock.now()
}

export function commandAdd($: EngineInterface, command: CommandSpec) {
  return $.command.register(command)
}

export function commandRun($: EngineInterface, input: Parameters<EngineInterface['command']['run']>[0]) {
  return $.command.run(input)
}

export function configs($: EngineInterface) {
  return $.config.list()
}

export function envGet($: EngineInterface, name: EnvName): Promise<string | undefined> {
  switch (name) {
    case 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': return $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
    case 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES': return $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')
    case 'CLAUDE_CODE_SESSION_KIND': return $.env.get('CLAUDE_CODE_SESSION_KIND')
    case 'CLAUDE_CODE_TMPDIR': return $.env.get('CLAUDE_CODE_TMPDIR')
    case 'CMUX_SOCKET_PATH': return $.env.get('CMUX_SOCKET_PATH')
    case 'CMUX_SURFACE_ID': return $.env.get('CMUX_SURFACE_ID')
    case 'CMUX_WORKSPACE_ID': return $.env.get('CMUX_WORKSPACE_ID')
    case 'COLORFGBG': return $.env.get('COLORFGBG')
    case 'DISABLE_AUTOUPDATER': return $.env.get('DISABLE_AUTOUPDATER')
    case 'DISABLE_UPDATES': return $.env.get('DISABLE_UPDATES')
    case 'DISPLAY': return $.env.get('DISPLAY')
    case 'GHOSTTY_RESOURCES_DIR': return $.env.get('GHOSTTY_RESOURCES_DIR')
    case 'HOME': return $.env.get('HOME')
    case 'ITERM_PROFILE': return $.env.get('ITERM_PROFILE')
    case 'ITERM_SESSION_ID': return $.env.get('ITERM_SESSION_ID')
    case 'IUI_DEBUG': return $.env.get('IUI_DEBUG')
    case 'IUI_FORCE': return $.env.get('IUI_FORCE')
    case 'KITTY_CONFIG_DIRECTORY': return $.env.get('KITTY_CONFIG_DIRECTORY')
    case 'KITTY_PID': return $.env.get('KITTY_PID')
    case 'KITTY_WINDOW_ID': return $.env.get('KITTY_WINDOW_ID')
    case 'LC_TERMINAL': return $.env.get('LC_TERMINAL')
    case 'RIO_CONFIG_HOME': return $.env.get('RIO_CONFIG_HOME')
    case 'SHELL': return $.env.get('SHELL')
    case 'SSH_CONNECTION': return $.env.get('SSH_CONNECTION')
    case 'SSH_TTY': return $.env.get('SSH_TTY')
    case 'STY': return $.env.get('STY')
    case 'TERM': return $.env.get('TERM')
    case 'TERM_PROGRAM': return $.env.get('TERM_PROGRAM')
    case 'TMUX': return $.env.get('TMUX')
    case 'TYPST_FONT_PATHS': return $.env.get('TYPST_FONT_PATHS')
    case 'WAYLAND_DISPLAY': return $.env.get('WAYLAND_DISPLAY')
    case 'XDG_CONFIG_HOME': return $.env.get('XDG_CONFIG_HOME')
    case 'XDG_CURRENT_DESKTOP': return $.env.get('XDG_CURRENT_DESKTOP')
    case 'ZDOTDIR': return $.env.get('ZDOTDIR')
  }
}

export function fsExists($: EngineInterface, path: string) {
  return $.fs.exists(path)
}

export function fsList($: EngineInterface, path?: string) {
  return $.fs.list(path)
}

// The overloads of `$.fs.read` (FsReadCall): text, or bytes with `{ as: 'bytes' }`.
export function fsRead($: EngineInterface, path: string): Promise<string>
export function fsRead($: EngineInterface, path: string, options: FsReadBytesOptions): Promise<FsBytes>
export function fsRead($: EngineInterface, path: string, options: FsReadOptions): Promise<string | FsBytes>
export function fsRead($: EngineInterface, path: string, options?: FsReadOptions): Promise<string | FsBytes> {
  return options ? $.fs.read(path, options) : $.fs.read(path)
}

export function fsStat($: EngineInterface, path: string, options?: FsStatOptions) {
  return $.fs.stat(path, options)
}

export function fsWrite($: EngineInterface, path: string, text: string) {
  return $.fs.write(path, text)
}

export function httpFetch($: EngineInterface, url: string, init?: HttpInit) {
  return $.http.fetch(url, init)
}

export function pluginRoot($: EngineInterface) {
  return $.plugin.root
}

export function processRun($: EngineInterface, argv: readonly string[], init?: ProcessRunInit) {
  return $.process.run(argv, init)
}

export function spawn($: EngineInterface, request: ProcessSpawnRequest) {
  return $.process.spawn(request)
}

export function submit($: EngineInterface, input: Parameters<EngineInterface['prompt']['submit']>[0]) {
  return $.prompt.submit(input)
}

export function sessionCwd($: EngineInterface) {
  return $.session.cwd()
}

export function sessionId($: EngineInterface) {
  return $.session.id()
}

export function sessionRoot($: EngineInterface) {
  return $.session.root()
}

export function sessionVersion($: EngineInterface) {
  return $.session.version()
}

export function sessionSurfaces($: EngineInterface) {
  return $.session.surfaces()
}

export function storeGet($: EngineInterface, key: string) {
  return $.store.get(key)
}

export function storeSet($: EngineInterface, key: string, value: unknown) {
  return $.store.set(key, value)
}

export function turnAbort($: EngineInterface, input: OpEventOf['turn.abort']) {
  return $.turn.abort(input)
}

export function uiAsk($: EngineInterface, question: string, options?: readonly string[] | AskOptions) {
  return $.ui.ask(question, options)
}

export function uiBlit($: EngineInterface, args: ImageBlitArgs) {
  return $.ui.blit(args)
}

export function uiClose($: EngineInterface, pane: PaneCloseArgs) {
  return $.ui.close(pane)
}

export function uiCopy($: EngineInterface, args: UiCopyArgs) {
  return $.ui.copy(args)
}

export function invalidate($: EngineInterface, event: InvalidatableEventName) {
  return $.ui.invalidate(event)
}

export function uiLog($: EngineInterface, text: string, options?: UiLogOptions) {
  return $.ui.log(text, options)
}

export function uiOpen($: EngineInterface, pane: PaneOpenArgs) {
  return $.ui.open(pane)
}

export function uiResolve<E extends ResolveInput>($: EngineInterface, e: E) {
  return $.ui.resolve(e)
}

export function uiSelection($: EngineInterface) {
  return $.ui.selection()
}

export function uiToast($: EngineInterface, text: string, options?: ToastOptions) {
  return $.ui.toast(text, options)
}
