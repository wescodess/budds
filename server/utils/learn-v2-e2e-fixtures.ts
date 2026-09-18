import type { GenerateParams, GenerateResponse } from './ai-gateway'
import type { SafeFetchResult } from './learn-v2-safe-fetch'
import { isE2eServerMode } from './e2e-mode'

const assessment = { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric', responseFormat: 'short_text', instructions: 'Explain the supported idea in your own words.', passingScorePercent: 80, criteria: [{ key: 'supported-explanation', description: 'Explains the accepted evidence.', weightPercent: 100 }] } as const

function requestPayload(params: GenerateParams) {
  const message = params.messages.at(-1)?.content
  try { return typeof message === 'string' ? JSON.parse(message) as Record<string, unknown> : {} } catch { return {} }
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
  }
  if (!content) return null
  return { id: 'e2e-deterministic-response', model: 'budds-e2e-fixture.v1', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
}

export function deterministicLearnV2Source(url: string): SafeFetchResult | null {
  if (!isE2eServerMode()) return null
  const finalUrl = new URL(url)
  if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'e2e.budds.invalid') throw new Error('E2E source fixture only permits e2e.budds.invalid')
  return { finalUrl: finalUrl.toString(), publicLocator: `${finalUrl.origin}/`, contentHash: 'sha256:e2e-source-fixture', contentType: 'text/html', wireBytes: 128, decodedBytes: 128, excerpt: 'Deterministic accepted evidence for the Learn V2 browser journey.', trustClassification: 'untrusted_source_data', rights: { status: 'permitted', provenance: 'html_license', policyVersion: 'learn-v2.rights.v2' }, fetchPolicyVersion: 'learn-v2.fetch.v2' }
}
