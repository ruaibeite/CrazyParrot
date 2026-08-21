const DEFAULT_COMMAND_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * node-pty requires every environment value to be a string. Electron's
 * inherited environment may contain undefined values, which otherwise causes
 * the native spawn call to fail before a command has a chance to run.
 */
export function buildCommandEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') environment[key] = value
  }
  if (!environment.PATH) environment.PATH = DEFAULT_COMMAND_PATH
  environment.TERM = 'xterm-256color'
  return environment
}

export function commandStartFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  const message = String(error ?? '').trim()
  return message || 'Unknown process start error'
}
