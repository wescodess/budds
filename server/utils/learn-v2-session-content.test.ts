import { describe, expect, test } from 'vitest'
import { validateLearnV2SessionContentCandidate } from '../../shared/learn-v2-session-content'

const rubric = { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const, instructions: 'Explain the mechanism precisely.', passingScorePercent: 80 as const, criteria: [{ key: 'accuracy', description: 'Accurate explanation', weightPercent: 100 }] }
const candidate = { version: 'learn-v2.session-content.v1', generatorVersion: 'test-generator', assessmentRubric: rubric, blocks: ['retrieval', 'objective', 'cold_attempt', 'explanation', 'worked_example', 'faded_example', 'independent_application', 'confidence_teach_back', 'misconception_feedback', 'next_review'].map((kind, order) => ({ order, kind, content: `${kind} content`, claimOrders: [0] })), claims: [{ order: 0, claim: 'The supported factual statement.', supportSourceSnapshotIds: ['source-1'], verifierVersion: 'learn-v2.entailment.v1', confidence: 0.9 }] }
describe('Learn V2 session-content candidate', () => {
  test('requires the complete mastery loop, immutable rubric, and confident supported claims', () => expect(validateLearnV2SessionContentCandidate(candidate, ['source-1'])).toMatchObject({ assessmentRubric: rubric }))
  test('rejects a missing mastery-loop block, unknown support, and low confidence', () => {
    expect(() => validateLearnV2SessionContentCandidate({ ...candidate, blocks: candidate.blocks.slice(0, -1) }, ['source-1'])).toThrow(/mastery loop/)
    expect(() => validateLearnV2SessionContentCandidate({ ...candidate, claims: [{ ...candidate.claims[0], supportSourceSnapshotIds: ['unknown'] }] }, ['source-1'])).toThrow(/accepted source/)
    expect(() => validateLearnV2SessionContentCandidate({ ...candidate, claims: [{ ...candidate.claims[0], confidence: 0.79 }] }, ['source-1'])).toThrow(/confidence/)
  })
})
