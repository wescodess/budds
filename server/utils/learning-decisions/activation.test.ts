import { describe, expect, test } from 'vitest'
import { isQuizSemanticAdvisoryEnabled, QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION } from './activation'

describe('quiz semantic activation boundary', () => {
  test('keeps learner advisory mode disabled without approved calibration evidence', () => {
    expect(QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION).toBe('quiz-semantic-advisory.v1')
    expect(isQuizSemanticAdvisoryEnabled('off', QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION)).toBe(false)
    expect(isQuizSemanticAdvisoryEnabled('shadow', QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION)).toBe(false)
    expect(isQuizSemanticAdvisoryEnabled('advisory', QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION)).toBe(false)
  })
})
