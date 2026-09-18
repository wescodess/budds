export type LearnV2E2eEnvironment = Partial<Record<
  'BUDDS_E2E_MODE' | 'BUDDS_E2E_AUTH_TOKEN' | 'CONVEX_CLOUD_URL',
  string | undefined
>>

/**
 * Local browser tests may bootstrap the rollout cohort through the ordinary
 * authenticated-user upsert. This deliberately relies on Convex's platform
 * URL, never caller-controlled application URL configuration.
 */
export function canBootstrapLearnV2E2e(environment: LearnV2E2eEnvironment): boolean {
  if (environment.BUDDS_E2E_MODE !== 'true') return false
  if ((environment.BUDDS_E2E_AUTH_TOKEN?.length ?? 0) < 32) return false
  try {
    const url = new URL(environment.CONVEX_CLOUD_URL ?? '')
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  }
  catch {
    return false
  }
}
