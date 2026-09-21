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
  | { allowed: false, code: 'pilot_manifest_missing' | 'pilot_manifest_mismatch' | 'pilot_manifest_invalid' | 'pilot_manifest_not_approved' | 'pilot_cohort_denied' | 'pilot_model_denied' }

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

export function isFiniteAdaptiveV2PilotManifest(manifest: AdaptiveV2PilotManifest): boolean {
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
    && manifest.cohort.kind === 'hashed_allowlist'
    && Number.isSafeInteger(manifest.cohort.maxLearners) && manifest.cohort.maxLearners > 0
    && hashes.length <= manifest.cohort.maxLearners
    && new Set(hashes).size === hashes.length
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
  manifest: AdaptiveV2PilotManifest = ADAPTIVE_V2_PILOT_MANIFEST,
): AdaptiveV2PilotDecision {
  if (typeof configuredVersion !== 'string' || !configuredVersion.trim()) return { allowed: false, code: 'pilot_manifest_missing' }
  if (configuredVersion !== manifest.version) return { allowed: false, code: 'pilot_manifest_mismatch' }
  if (!isFiniteAdaptiveV2PilotManifest(manifest)) return { allowed: false, code: 'pilot_manifest_invalid' }
  if (!manifest.pilotApproved) return { allowed: false, code: 'pilot_manifest_not_approved' }
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
