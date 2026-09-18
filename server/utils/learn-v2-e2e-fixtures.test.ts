import { afterEach, describe, expect, it } from 'vitest'
import { parseLearnV2BlueprintAliasCandidate } from '../../shared/learn-v2-blueprint'
import { deterministicLearnV2Completion, deterministicLearnV2Source } from './learn-v2-e2e-fixtures'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })
const parameters = (name: string, payload: Record<string, unknown>) => ({ model: 'fixture', messages: [{ role: 'user' as const, content: JSON.stringify(payload) }], jsonSchema: { name, schema: {} } })

describe('Learn V2 deterministic E2E fixtures', () => {
  it('are unavailable without explicit server-only mode', () => {
    delete process.env.BUDDS_E2E_MODE
    expect(deterministicLearnV2Completion(parameters('learn_v2_mastery_score', {}))).toBeNull()
  })

  it('returns contract-valid blueprint, content, verification, calibration, and mastery envelopes', () => {
    process.env.NODE_ENV = 'test'; process.env.BUDDS_E2E_MODE = 'true'; process.env.BUDDS_E2E_AUTH_TOKEN = 'a'.repeat(32)
    const blueprint = JSON.parse(deterministicLearnV2Completion(parameters('learn_v2_blueprint_candidate_v1', { sources: [{ alias: 'source-001' }] }))!.choices[0]!.message.content)
    expect(parseLearnV2BlueprintAliasCandidate(JSON.stringify(blueprint), ['source-001'], ['source-001']).objectives).toHaveLength(6)
    const rubric = { criteria: [{ key: 'criterion', weightPercent: 100 }] }
    const calibration = JSON.parse(deterministicLearnV2Completion(parameters('learn_v2_calibration_score', { objective: { assessmentContract: rubric } }))!.choices[0]!.message.content)
    const mastery = JSON.parse(deterministicLearnV2Completion(parameters('learn_v2_mastery_score', { rubric }))!.choices[0]!.message.content)
    const verification = JSON.parse(deterministicLearnV2Completion(parameters('learn_v2_claim_entailment_verification', { pairs: [{ claimOrder: 0, sourceSnapshotId: 'source', sourceExcerptId: 'excerpt' }] }))!.choices[0]!.message.content)
    expect(calibration.criterionResults[0]).toMatchObject({ key: 'criterion', awarded: true })
    expect(mastery).toMatchObject({ misconceptionTags: [] })
    expect(verification).toMatchObject({ version: 'learn-v2.entailment.v2', decisions: [expect.objectContaining({ decision: 'entailed' })] })
    expect(deterministicLearnV2Source('https://e2e.budds.invalid/source')?.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
