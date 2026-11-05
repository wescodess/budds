export const ADAPTIVE_V2_PILOT_MANIFEST = {
  version: 'adaptive-v2-pilot.v1',
  pilotApproved: false,
  gaApproved: false,
  scope: 'slice_1_pilot',
  startsAt: '2026-09-20T00:00:00.000Z',
  endsAt: '2026-12-19T00:00:00.000Z',
  cohort: { kind: 'hashed_allowlist', maxLearners: 50, subjectHashes: [] as string[] },
  modelPolicies: [] as Array<{ model: string, inputUsdPerMillionTokens: number, outputUsdPerMillionTokens: number }>,
  allowedProviders: ['openrouter-via-cloudflare-ai-gateway.v1'],
  activityContractVersions: ['learn-adaptive.activity-contract.v1'],
  evaluationContractVersions: ['learn-adaptive.evaluation.v1'],
  policyVersion: 'adaptive-v2-provider-policy.v1',
  requestVersion: 'adaptive-v2-mastery-request.v1',
  jobVersion: 'learn-v2.mastery-scoring-job.v1',
  quotaVersion: 'learn-v2.mastery-hourly-daily.v1',
  retention: {
    provider: 'zero_data_retention_requested',
    logs: 'metadata_only_no_payload',
    local: 'delete_with_v2_job_on_account_deletion',
  },
  // Zero budgets and an unnamed owner carry no activation authority.
  productControls: {
    version: 'adaptive-v2-product-budget.utc-hour-day.v1',
    maxDispatchesPerHour: 0, maxDispatchesPerDay: 0, maxConcurrent: 0,
    maxReservedMicroUsdPerDay: 0,
  },
  rollback: {
    version: 'adaptive-v2-provider-rollback.v1',
    ownerIdentityVersion: 'adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1',
    ownerSubjectHash: null as string | null,
    enabled: false,
    maxAmbiguityPercent: 1, maxBudgetDenialPercent: 5,
  },
  limits: {
    maxRequestBytes: 48_000,
    maxResponseBytes: 32_000,
    maxOutputTokens: 1_200,
    timeoutMs: 90_000,
    leaseMs: 300_000,
    maxAttempts: 1,
    maxDispatchAttemptsPerJob: 2,
    maxConcurrentPerLearner: 1,
    quotaWindowMs: 3_600_000,
    dailyQuotaWindowMs: 86_400_000,
    maxProviderDispatchesPerWindow: 12,
    maxProviderDispatchesPerDay: 24,
    costCeilingUsdPerRequest: 0.10,
  },
} as const

export type AdaptiveV2PilotDecision =
  | { allowed: true }
  | { allowed: false, code: 'pilot_manifest_missing' | 'pilot_manifest_mismatch' | 'pilot_manifest_invalid' | 'pilot_manifest_not_approved' | 'pilot_cohort_denied' | 'pilot_model_denied' | 'pilot_rollback_active' }

export type AdaptiveV2PilotManifest = {
  version: string
  pilotApproved: boolean
  gaApproved: boolean
  scope: string
  startsAt: string
  endsAt: string
  cohort: { kind: string, maxLearners: number, subjectHashes: readonly string[] }
  modelPolicies: ReadonlyArray<{ model: string, inputUsdPerMillionTokens: number, outputUsdPerMillionTokens: number }>
  allowedProviders: readonly string[]
  activityContractVersions: readonly string[]
  evaluationContractVersions: readonly string[]
  policyVersion: string
  requestVersion: string
  jobVersion: string
  quotaVersion: string
  retention: { provider: string, logs: string, local: string }
  productControls: { version: string, maxDispatchesPerHour: number, maxDispatchesPerDay: number, maxConcurrent: number, maxReservedMicroUsdPerDay: number }
  rollback: { version: string, ownerIdentityVersion: string, ownerSubjectHash: string | null, enabled: boolean, maxAmbiguityPercent: number, maxBudgetDenialPercent: number }
  limits: {
    maxRequestBytes: number
    maxResponseBytes: number
    maxOutputTokens: number
    timeoutMs: number
    leaseMs: number
    maxAttempts: number
    maxDispatchAttemptsPerJob: number
    maxConcurrentPerLearner: number
    quotaWindowMs: number
    dailyQuotaWindowMs: number
    maxProviderDispatchesPerWindow: number
    maxProviderDispatchesPerDay: number
    costCeilingUsdPerRequest: number
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const EXACT_MANIFEST_PINS = {
  version: 'adaptive-v2-pilot.v1', policyVersion: 'adaptive-v2-provider-policy.v1',
  requestVersion: 'adaptive-v2-mastery-request.v1', jobVersion: 'learn-v2.mastery-scoring-job.v1',
  quotaVersion: 'learn-v2.mastery-hourly-daily.v1',
} as const

/** Configuration crosses a trust boundary: validate its shape before reading it. */
export function isFiniteAdaptiveV2PilotManifest(value: unknown): value is AdaptiveV2PilotManifest {
  if (!record(value) || !record(value.limits) || !record(value.cohort) || !record(value.retention)
    || !record(value.productControls) || !record(value.rollback)
    || typeof value.pilotApproved !== 'boolean' || typeof value.startsAt !== 'string' || typeof value.endsAt !== 'string'
    || !Array.isArray(value.cohort.subjectHashes) || !Array.isArray(value.modelPolicies)
    || !Array.isArray(value.allowedProviders) || !Array.isArray(value.activityContractVersions) || !Array.isArray(value.evaluationContractVersions)
    || Object.entries(EXACT_MANIFEST_PINS).some(([key, pin]) => value[key] !== pin)
    || value.allowedProviders.length !== 1 || value.allowedProviders[0] !== 'openrouter-via-cloudflare-ai-gateway.v1'
    || value.activityContractVersions.length !== 1 || value.activityContractVersions[0] !== 'learn-adaptive.activity-contract.v1'
    || value.evaluationContractVersions.length !== 1 || value.evaluationContractVersions[0] !== 'learn-adaptive.evaluation.v1'
    || value.retention.provider !== 'zero_data_retention_requested' || value.retention.logs !== 'metadata_only_no_payload'
    || value.retention.local !== 'delete_with_v2_job_on_account_deletion'
    || value.modelPolicies.some(policy => !record(policy) || typeof policy.model !== 'string'
      || typeof policy.inputUsdPerMillionTokens !== 'number' || typeof policy.outputUsdPerMillionTokens !== 'number')
    || value.cohort.subjectHashes.some(hash => typeof hash !== 'string')) return false
  const product = value.productControls
  const rollback = value.rollback
  if (product.version !== 'adaptive-v2-product-budget.utc-hour-day.v1'
    || ['maxDispatchesPerHour', 'maxDispatchesPerDay', 'maxConcurrent', 'maxReservedMicroUsdPerDay'].some(key => !Number.isSafeInteger(product[key]) || (product[key] as number) < 0)
    || (product.maxDispatchesPerHour as number) > 4_096 || (product.maxDispatchesPerDay as number) > 4_096
    || (product.maxConcurrent as number) > 128
    || (product.maxReservedMicroUsdPerDay as number) > 4_096 * 100_000
    || rollback.version !== 'adaptive-v2-provider-rollback.v1'
    || rollback.ownerIdentityVersion !== 'adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1'
    || typeof rollback.enabled !== 'boolean' || rollback.maxAmbiguityPercent !== 1 || rollback.maxBudgetDenialPercent !== 5
    || (rollback.ownerSubjectHash !== null && (typeof rollback.ownerSubjectHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(rollback.ownerSubjectHash)))) return false
  if (value.pilotApproved && (rollback.ownerSubjectHash === null
    || ['maxDispatchesPerHour', 'maxDispatchesPerDay', 'maxConcurrent', 'maxReservedMicroUsdPerDay'].some(key => (product[key] as number) <= 0))) return false
  const requiredLimits = ['maxRequestBytes', 'maxResponseBytes', 'maxOutputTokens', 'timeoutMs', 'leaseMs', 'maxAttempts', 'maxDispatchAttemptsPerJob', 'maxConcurrentPerLearner', 'quotaWindowMs', 'dailyQuotaWindowMs', 'maxProviderDispatchesPerWindow', 'maxProviderDispatchesPerDay']
  const finiteLimits = value.limits
  if (requiredLimits.some(key => typeof finiteLimits[key] !== 'number' || !Number.isSafeInteger(finiteLimits[key]) || (finiteLimits[key] as number) <= 0)
    || typeof finiteLimits.costCeilingUsdPerRequest !== 'number') return false
  const manifest = value as AdaptiveV2PilotManifest
  const limits = Object.values(manifest.limits)
  const hashes = manifest.cohort.subjectHashes
  const models = manifest.modelPolicies.map(policy => policy.model)
  const pricesAreFinite = manifest.modelPolicies.every(policy => policy.model.trim()
    && Number.isFinite(policy.inputUsdPerMillionTokens) && policy.inputUsdPerMillionTokens > 0
    && Number.isFinite(policy.outputUsdPerMillionTokens) && policy.outputUsdPerMillionTokens > 0
    && ((manifest.limits.maxRequestBytes * policy.inputUsdPerMillionTokens
      + manifest.limits.maxOutputTokens * policy.outputUsdPerMillionTokens) / 1_000_000) <= manifest.limits.costCeilingUsdPerRequest)
  return manifest.scope === 'slice_1_pilot'
    && manifest.gaApproved === false
    && Number.isFinite(Date.parse(manifest.startsAt))
    && Number.isFinite(Date.parse(manifest.endsAt))
    && Date.parse(manifest.startsAt) < Date.parse(manifest.endsAt)
    && limits.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
    && manifest.limits.maxAttempts === 1
    && manifest.limits.maxDispatchAttemptsPerJob <= 2
    && manifest.limits.timeoutMs === 90_000
    && manifest.limits.leaseMs === 300_000
    && manifest.limits.quotaWindowMs === 3_600_000
    && manifest.limits.dailyQuotaWindowMs === 86_400_000
    && manifest.limits.maxRequestBytes <= 48_000
    && manifest.limits.maxResponseBytes <= 32_000
    && manifest.limits.maxOutputTokens <= 1_200
    && manifest.limits.maxProviderDispatchesPerWindow <= 12
    && manifest.limits.maxProviderDispatchesPerDay <= 24
    && manifest.limits.maxConcurrentPerLearner === 1
    && manifest.limits.costCeilingUsdPerRequest <= 0.10
    && manifest.cohort.kind === 'hashed_allowlist'
    && Number.isSafeInteger(manifest.cohort.maxLearners) && manifest.cohort.maxLearners > 0
    && hashes.length <= manifest.cohort.maxLearners
    && new Set(hashes).size === hashes.length
    && manifest.cohort.maxLearners <= 50
    && hashes.every(hash => /^sha256:[a-f0-9]{64}$/.test(hash))
    && manifest.allowedProviders.length > 0
    && new Set(models).size === models.length
    && pricesAreFinite
    && (!manifest.pilotApproved || (hashes.length > 0 && models.length > 0))
}

export function adaptiveV2PilotDecision(
  configuredVersion: unknown,
  input: { model: string, now: number, activityContractVersion: string, evaluationContractVersion: string, learnerHash: string } = {
    model: '', now: Date.now(), activityContractVersion: '', evaluationContractVersion: '', learnerHash: '',
  },
  manifest: unknown = ADAPTIVE_V2_PILOT_MANIFEST,
): AdaptiveV2PilotDecision {
  if (typeof configuredVersion !== 'string' || !configuredVersion.trim()) return { allowed: false, code: 'pilot_manifest_missing' }
  if (!isFiniteAdaptiveV2PilotManifest(manifest)) return { allowed: false, code: 'pilot_manifest_invalid' }
  if (configuredVersion !== manifest.version) return { allowed: false, code: 'pilot_manifest_mismatch' }
  if (!manifest.pilotApproved) return { allowed: false, code: 'pilot_manifest_not_approved' }
  if (manifest.rollback.enabled) return { allowed: false, code: 'pilot_rollback_active' }
  if (!manifest.cohort.subjectHashes.includes(input.learnerHash)) return { allowed: false, code: 'pilot_cohort_denied' }
  if (!manifest.modelPolicies.some(policy => policy.model === input.model)) return { allowed: false, code: 'pilot_model_denied' }
  const withinWindow = input.now >= Date.parse(manifest.startsAt) && input.now < Date.parse(manifest.endsAt)
  const pinsMatch = (manifest.activityContractVersions as readonly string[]).includes(input.activityContractVersion)
    && (manifest.evaluationContractVersions as readonly string[]).includes(input.evaluationContractVersion)
  if (!withinWindow || !pinsMatch) return { allowed: false, code: 'pilot_manifest_not_approved' }
  return { allowed: true }
}

const PROTECTED_CONTENT = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bhttps?:\/\/\S+/i,
  /(?:^|\s)(?:\/[\w.-]+){2,}(?:\/|\.[a-z0-9]{1,8}\b)/i,
  /\b[\w.-]+\.(?:pdf|docx?|pptx?|xlsx?|txt|md|csv|json)\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /\bunpublished\s+notes?\b/i,
  /\b(?:bearer\s+|api[_-]?key\s*[:=]|token\s*[:=]|secret\s*[:=]|sk-)[A-Za-z0-9._~+/-]{8,}/i,
] as const

export type AdaptiveProviderPayloadDecision =
  | { allowed: true, requestBytes: number }
  | { allowed: false, code: 'protected_payload_content' | 'request_too_large' | 'empty_payload' }

export function validateAdaptiveProviderPayload(input: {
  learnerResponse: string
  challenge: string
  evidence: string[]
  rubric?: string[]
}): AdaptiveProviderPayloadDecision {
  if (Object.keys(input).some(key => !['learnerResponse', 'challenge', 'evidence', 'rubric'].includes(key))) return { allowed: false, code: 'protected_payload_content' }
  const fields = [input.learnerResponse, input.challenge, ...input.evidence, ...(input.rubric ?? [])]
  if (fields.some(value => !value.trim())) return { allowed: false, code: 'empty_payload' }
  if (fields.some(value => PROTECTED_CONTENT.some(pattern => pattern.test(value)))) return { allowed: false, code: 'protected_payload_content' }
  const requestBytes = new TextEncoder().encode(JSON.stringify({
    challenge: input.challenge,
    evidence: input.evidence,
    learnerResponse: input.learnerResponse,
    ...(input.rubric ? { rubric: input.rubric } : {}),
  })).byteLength
  if (requestBytes > ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes) return { allowed: false, code: 'request_too_large' }
  return { allowed: true, requestBytes }
}
