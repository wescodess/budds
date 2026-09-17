import { describe, expect, test } from 'vitest'
import { validateLearnV2EntailmentDecisions, validateLearnV2SessionContentCandidate } from '../../shared/learn-v2-session-content'

const rubric = { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const, instructions: 'Explain the mechanism precisely.', passingScorePercent: 80 as const, criteria: [{ key: 'accuracy', description: 'Accurate explanation', weightPercent: 100 }] }
const candidate = { version: 'learn-v2.session-content.v1', generatorVersion: 'test-generator', assessmentRubric: rubric, blocks: ['retrieval', 'objective', 'cold_attempt', 'explanation', 'worked_example', 'faded_example', 'independent_application', 'confidence_teach_back', 'misconception_feedback', 'next_review'].map((kind, order) => ({ order, kind, content: `${kind} content`, claimOrders: [0] })), claims: [{ order: 0, claim: 'The supported factual statement.', supportSourceSnapshotIds: ['source-1'] }] }
describe('Learn V2 session-content candidate', () => {
  test('requires the complete mastery loop, immutable rubric, and supported claims', () => expect(validateLearnV2SessionContentCandidate(candidate, ['source-1'])).toMatchObject({ assessmentRubric: rubric }))
  test('rejects a missing mastery-loop block and unknown support', () => {
    expect(() => validateLearnV2SessionContentCandidate({ ...candidate, blocks: candidate.blocks.slice(0, -1) }, ['source-1'])).toThrow(/mastery loop/)
    expect(() => validateLearnV2SessionContentCandidate({ ...candidate, claims: [{ ...candidate.claims[0], supportSourceSnapshotIds: ['unknown'] }] }, ['source-1'])).toThrow(/accepted source/)
  })
  test('rejects low-confidence independent entailment', () => {
    const generated = validateLearnV2SessionContentCandidate(candidate, ['source-1'])
    const verification = { version: 'learn-v2.entailment.v2', decisions: [{ claimOrder: 0, sourceSnapshotId: 'source-1', sourceExcerptId: 'excerpt-1', decision: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.79 }] }
    expect(() => validateLearnV2EntailmentDecisions(verification, generated, new Map([['source-1', { sourceExcerptId: 'excerpt-1' }]]))).toThrow(/confidence/)
  })
})
