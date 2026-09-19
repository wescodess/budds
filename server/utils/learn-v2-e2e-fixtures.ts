import type { GenerateParams, GenerateResponse } from './ai-gateway'
import type { SafeFetchResult } from './learn-v2-safe-fetch'
import { isE2eServerMode } from './e2e-mode'

export const LEARN_V2_E2E_FOLDER_FIXTURE_FILENAME = 'learn-v2-orbital-mechanics.md'
export const LEARN_V2_E2E_FOLDER_FIXTURE_TEXT = `# Transfer orbits

A transfer orbit is a deliberate path used to move between two orbital energies. For circular orbits, the learner compares the velocity changes required at the departure and arrival points. The maneuver changes velocity at the appropriate orbital points, and those changes alter the spacecraft's orbital energy.

To explain a transfer, identify the initial orbit, the target orbit, the required velocity changes, and why each change occurs at that point. The same reasoning can then be applied to a new pair of circular orbits.
`

type FixtureEnvironment = Record<string, string | undefined>

function isLoopbackConvex(env: FixtureEnvironment) {
  try {
    const url = new URL(env.CONVEX_SITE_URL ?? env.CONVEX_URL ?? '')
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  } catch { return false }
}

async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function deterministicLearnV2FolderUpload(
  filename: string,
  bytes: Uint8Array,
  env: FixtureEnvironment = process.env,
): Promise<{ contentHash: string; sourceRevision: string } | null> {
  if (!isE2eServerMode(env) || !isLoopbackConvex(env) || filename !== LEARN_V2_E2E_FOLDER_FIXTURE_FILENAME) return null
  const expected = new TextEncoder().encode(LEARN_V2_E2E_FOLDER_FIXTURE_TEXT)
  if (bytes.length !== expected.length || bytes.some((byte, index) => byte !== expected[index])) return null
  const contentHash = await sha256(bytes)
  return { contentHash, sourceRevision: `sha256:${contentHash}` }
}

export async function deterministicLearnV2FolderEvidence(
  sources: Array<{ alias: string; contentHash: string; sourceRevision: string }>,
  env: FixtureEnvironment = process.env,
): Promise<Map<string, string> | null> {
  if (!isE2eServerMode(env) || !isLoopbackConvex(env) || sources.length === 0) return null
  const contentHash = await sha256(new TextEncoder().encode(LEARN_V2_E2E_FOLDER_FIXTURE_TEXT))
  const sourceRevision = `sha256:${contentHash}`
  if (sources.some(source => source.contentHash !== contentHash || source.sourceRevision !== sourceRevision)) return null
  return new Map(sources.map(source => [source.alias, LEARN_V2_E2E_FOLDER_FIXTURE_TEXT.slice(0, 4_000)]))
}

const assessment = { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric', responseFormat: 'short_text', instructions: 'Explain the supported idea in your own words.', passingScorePercent: 80, criteria: [{ key: 'supported-explanation', description: 'Explains the accepted evidence.', weightPercent: 100 }] } as const

function requestPayload(params: GenerateParams) {
  const message = params.messages.at(-1)?.content
  try { return typeof message === 'string' ? JSON.parse(message) as Record<string, unknown> : {} } catch { return {} }
}

function criterionResults(payload: Record<string, unknown>) {
  const rubric = (payload.rubric ?? (payload.objective as { assessmentContract?: unknown } | undefined)?.assessmentContract) as { criteria?: unknown } | undefined
  const criteria = Array.isArray(rubric?.criteria) ? rubric.criteria : []
  return criteria.map((criterion) => ({ key: typeof criterion === 'object' && criterion ? String((criterion as { key?: unknown }).key) : '', awarded: true, rationale: 'Supported by the deterministic accepted evidence.' })).filter(result => result.key)
}

export function deterministicLearnV2Completion(params: GenerateParams): GenerateResponse | null {
  if (!isE2eServerMode()) return null
  const schemaName = params.jsonSchema?.name
  const payload = requestPayload(params)
  let content: unknown = null
  if (schemaName === 'learn_v2_blueprint_candidate_v1') {
    const aliases = Array.isArray(payload.sources) ? payload.sources.map(source => typeof source === 'object' && source ? (source as { alias?: unknown }).alias : undefined).filter((alias): alias is string => typeof alias === 'string') : []
    const alias = aliases[0] ?? 'source-001'
    const milestones = ['foundation', 'practice', 'application'].map((key, order) => ({ key, order, title: `E2E ${key}`, description: `Deterministic ${key} milestone.` }))
    content = { version: 'learn-v2.blueprint-candidate.v1', generatorVersion: 'budds-e2e-fixture.v1', milestones, objectives: Array.from({ length: 6 }, (_, order) => ({ key: `objective-${order + 1}`, milestoneKey: milestones[Math.min(2, Math.floor(order / 2))]!.key, order, title: `E2E objective ${order + 1}`, capability: `Apply supported concept ${order + 1}.`, estimatedMinutes: 15, coverage: 'strong', gapReason: null, sourceAliases: [alias], gapSourceAliases: [], prerequisiteObjectiveKeys: order === 0 ? [] : [`objective-${order}`], assessmentContract: assessment })) }
  } else if (schemaName === 'learn_v2_session_content') {
    const aliases = Array.isArray(payload.sources) ? payload.sources.map(source => typeof source === 'object' && source ? (source as { alias?: unknown }).alias : undefined).filter((alias): alias is string => typeof alias === 'string') : []
    const alias = aliases[0] ?? 'source-001'
    const kinds = ['retrieval', 'objective', 'cold_attempt', 'explanation', 'worked_example', 'faded_example', 'independent_application', 'confidence_teach_back', 'misconception_feedback', 'next_review']
    content = { version: 'learn-v2.session-content.v1', generatorVersion: 'budds-e2e-fixture.v1', assessmentRubric: assessment, blocks: kinds.map((kind, order) => ({ order, kind, content: `Deterministic ${kind} supported by accepted evidence.`, claimOrders: [0] })), claims: [{ order: 0, claim: 'The deterministic fixture only presents accepted evidence.', supportSourceSnapshotIds: [alias] }] }
  } else if (schemaName === 'learn_v2_claim_entailment_verification') {
    const pairs = Array.isArray(payload.pairs) ? payload.pairs : []
    content = { version: 'learn-v2.entailment.v2', decisions: pairs.map((pair) => ({ claimOrder: Number((pair as { claimOrder?: unknown }).claimOrder), sourceSnapshotId: String((pair as { sourceSnapshotId?: unknown }).sourceSnapshotId), sourceExcerptId: String((pair as { sourceExcerptId?: unknown }).sourceExcerptId), decision: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 1 })) }
  } else if (schemaName === 'learn_v2_calibration_score') {
    content = { criterionResults: criterionResults(payload) }
  } else if (schemaName === 'learn_v2_mastery_score') {
    content = { criterionResults: criterionResults(payload), misconceptionTags: [] }
  }
  if (!content) return null
  return { id: 'e2e-deterministic-response', model: 'budds-e2e-fixture.v1', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
}

export function deterministicLearnV2Source(url: string): SafeFetchResult | null {
  if (!isE2eServerMode()) return null
  const finalUrl = new URL(url)
  if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'e2e.budds.invalid') throw new Error('E2E source fixture only permits e2e.budds.invalid')
  return { finalUrl: finalUrl.toString(), publicLocator: `${finalUrl.origin}/`, contentHash: 'e'.repeat(64), contentType: 'text/html', wireBytes: 128, decodedBytes: 128, excerpt: 'Deterministic accepted evidence for the Learn V2 browser journey.', trustClassification: 'untrusted_source_data', rights: { status: 'permitted', provenance: 'html_license', policyVersion: 'learn-v2.rights.v2' }, fetchPolicyVersion: 'learn-v2.fetch.v2' }
}
