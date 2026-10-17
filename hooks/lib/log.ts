// The debug log: `debug.log` in the cache folder.
import type { EngineInterface } from 'claude-code'

import { S } from './state'

export async function logDebug($: EngineInterface, cache: string, text: string) {
  const stamp = new Date().toISOString()
  await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', `${cache}/debug.log`], { stdin: `[${stamp}] ${text.trimEnd()}\n` }).catch(() => undefined)
}

// A trace line, only with MD_PREVIEW_DEBUG set (S.debug, read in setUp).
export function traceDebug($: EngineInterface, text: string) {
  if (S.debug && S.env) void logDebug($, S.env.cache, text)
}
