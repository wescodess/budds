export const ADAPTIVE_V2_PILOT_MANIFEST = {
  version: 'adaptive-v2-pilot.v1',
  pilotApproved: false,
  gaApproved: false,
  scope: 'slice_1_pilot',
  startsAt: '2026-09-20T00:00:00.000Z',
  endsAt: '2026-12-19T00:00:00.000Z',
  cohort: { kind: 'adaptive_entitlement', maxLearners: 50 },
  allowedModels: [] as string[],
  allowedProviders: ['openrouter-via-cloudflare-ai-gateway.v1'],
  activityContractVersions: ['learn-adaptive.activity-contract.v1'],
  evaluationContractVersions: ['learn-adaptive.evaluation.v1'],
  policyVersion: 'adaptive-v2-provider-policy.v1',
  requestVersion: 'adaptive-v2-mastery-request.v1',
  jobVersion: 'learn-v2.mastery-scoring-job.v1',
  quotaVersion: 'learn-v2.mastery-hourly.v1',
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
    maxProviderDispatchesPerWindow: 12,
    maxProviderDispatchesPerDay: 24,
    costCeilingUsdPerRequest: 0.10,
  },
} as const

export type AdaptiveV2PilotDecision =
  | { allowed: true }
  | { allowed: false, code: 'pilot_manifest_missing' | 'pilot_manifest_mismatch' | 'pilot_manifest_invalid' | 'pilot_manifest_not_approved' }

export type AdaptiveV2PilotManifest = {
  version: string
  pilotApproved: boolean
  gaApproved: boolean
  scope: string
  startsAt: string
  endsAt: string
  cohort: { kind: string, maxLearners: number }
  allowedModels: readonly string[]
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
    maxProviderDispatchesPerWindow: number
    maxProviderDispatchesPerDay: number
    costCeilingUsdPerRequest: number
  }
}

export function isFiniteAdaptiveV2PilotManifest(manifest: AdaptiveV2PilotManifest): boolean {
  const limits = Object.values(manifest.limits)
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
    && manifest.cohort.maxLearners > 0
    && manifest.allowedProviders.length > 0
    && (!manifest.pilotApproved || manifest.allowedModels.length > 0)
}

export function adaptiveV2PilotDecision(
  configuredVersion: unknown,
  input: { model: string, now: number, activityContractVersion: string, evaluationContractVersion: string } = {
    model: '', now: Date.now(), activityContractVersion: '', evaluationContractVersion: '',
  },
  manifest: AdaptiveV2PilotManifest = ADAPTIVE_V2_PILOT_MANIFEST,
): AdaptiveV2PilotDecision {
  if (typeof configuredVersion !== 'string' || !configuredVersion.trim()) return { allowed: false, code: 'pilot_manifest_missing' }
  if (configuredVersion !== manifest.version) return { allowed: false, code: 'pilot_manifest_mismatch' }
  if (!isFiniteAdaptiveV2PilotManifest(manifest)) return { allowed: false, code: 'pilot_manifest_invalid' }
  const withinWindow = input.now >= Date.parse(manifest.startsAt) && input.now < Date.parse(manifest.endsAt)
  const pinsMatch = manifest.allowedModels.includes(input.model)
    && (manifest.activityContractVersions as readonly string[]).includes(input.activityContractVersion)
    && (manifest.evaluationContractVersions as readonly string[]).includes(input.evaluationContractVersion)
  if (!manifest.pilotApproved || !withinWindow || !pinsMatch) return { allowed: false, code: 'pilot_manifest_not_approved' }
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
