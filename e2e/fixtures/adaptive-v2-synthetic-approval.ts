import type { AdaptiveV2PilotManifest } from '../../shared/adaptive-v2-pilot-policy'

// Disposable test deployment only. No human approval or real provider spending.
// Positive rates simulate the existing monetary ledger's finite reserve rules.
export const SYNTHETIC_APPROVAL_LABEL = 'disposable-test-only-synthetic-approval'
let firstAuthenticatedLearner: string | undefined

export function configureDisposableSyntheticPilot(
  manifest: AdaptiveV2PilotManifest,
  input: { model: string, learnerHash: string, now: number },
  configuration: { appUrl: string, convexUrl: string, startsAt: string, endsAt: string },
) {
  manifest.pilotApproved = false
  const env = process.env
  const local = (value: string | undefined, expected: string) => {
    try {
      const url = new URL(value || '')
      return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
        && url.toString() === new URL(expected).toString()
        && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
    } catch { return false }
  }
  const startsAt = Date.parse(configuration.startsAt)
  const endsAt = Date.parse(configuration.endsAt)
  if (env.NODE_ENV !== 'test' || env.BUDDS_E2E_MODE !== 'true'
    || env.BUDDS_E2E_SYNTHETIC_ADAPTIVE_APPROVAL !== 'true'
    || ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CF_PAGES_ENVIRONMENT', 'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'].some(key => env[key])
    || !local(env.SITE_URL, configuration.appUrl) || !local(env.CONVEX_CLOUD_URL, configuration.convexUrl)
    || input.model !== 'budds-e2e-fixture.v1' || !/^sha256:[a-f0-9]{64}$/.test(input.learnerHash)
    || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt - startsAt !== 3_600_000
    || input.now < startsAt || input.now >= endsAt) return
  firstAuthenticatedLearner ??= input.learnerHash
  if (input.learnerHash !== firstAuthenticatedLearner) return
  Object.assign(manifest, {
    pilotApproved: true, gaApproved: false,
    startsAt: configuration.startsAt, endsAt: configuration.endsAt,
    cohort: { kind: 'hashed_allowlist', maxLearners: 1, subjectHashes: [firstAuthenticatedLearner] },
    modelPolicies: [{ model: 'budds-e2e-fixture.v1', inputUsdPerMillionTokens: 0.000001, outputUsdPerMillionTokens: 0.000001 }],
    productControls: { ...manifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 1, maxReservedMicroUsdPerDay: 10 },
    // Synthetic fixture owner marker, not an assertion of human approval.
    rollback: { ...manifest.rollback, ownerSubjectHash: `sha256:${'f'.repeat(64)}`, enabled: false },
    limits: { ...manifest.limits, maxProviderDispatchesPerWindow: 4, maxProviderDispatchesPerDay: 8, costCeilingUsdPerRequest: 0.000001 },
  })
}
