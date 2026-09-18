/** Server-only admission for disposable browser-test infrastructure. */
export type E2eEnvironment = Record<string, string | undefined>

export function isE2eServerMode(env: E2eEnvironment = process.env): boolean {
  return env.NODE_ENV !== 'production'
    && env.BUDDS_E2E_MODE === 'true'
    && (env.BUDDS_E2E_AUTH_TOKEN?.length ?? 0) >= 32
}

export function assertE2eServerMode(env: E2eEnvironment = process.env): void {
  if (!isE2eServerMode(env)) throw new Error('E2E_MODE_DISABLED')
}

export function isAuthorizedE2eRequest(token: string | undefined, env: E2eEnvironment = process.env): boolean {
  return isE2eServerMode(env) && !!token && token === env.BUDDS_E2E_AUTH_TOKEN
}
