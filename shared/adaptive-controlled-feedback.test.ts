import { describe, expect, test } from 'vitest'
import {
  ADAPTIVE_FEEDBACK_TEMPLATE_VERSION,
  ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION,
  projectControlledFeedback,
  renderControlledFeedbackTemplate,
} from './adaptive-controlled-feedback'

describe('adaptive controlled feedback', () => {
  test('discards provider prose and renders only versioned server templates from pinned criteria', () => {
    const projection = projectControlledFeedback({
      criteria: [
        { key: 'core', label: 'Core correctness' },
        { key: 'boundary', label: 'Boundary application' },
      ],
      outcomes: [
        { key: 'core', awarded: true, rationale: 'Expose this private provider rationale.' },
        { key: 'boundary', awarded: false, rationale: 'Also unsafe.' },
      ],
      misconceptionTags: ['missing_required_step'],
    })

    expect(projection).toEqual({
      templateVersion: ADAPTIVE_FEEDBACK_TEMPLATE_VERSION,
      taxonomyVersion: ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION,
      criterionResults: [
        { key: 'core', label: 'Core correctness', awarded: true, template: 'criterion_met', message: 'Core correctness: criterion met.' },
        { key: 'boundary', label: 'Boundary application', awarded: false, template: 'criterion_not_met', message: 'Boundary application: criterion not met yet.' },
      ],
      misconceptionTags: ['missing_required_step'],
      misconceptionFeedback: [{ tag: 'missing_required_step', template: 'response_incomplete', message: 'The response is incomplete. Add the missing required parts and try again.' }],
    })
    expect(JSON.stringify(projection)).not.toContain('provider rationale')
    expect(JSON.stringify(projection)).not.toContain('unsafe')
  })

  test.each([
    ['unknown tags', ['made_up']],
    ['duplicate tags', ['evidence_mismatch', 'evidence_mismatch']],
  ])('rejects %s', (_label, misconceptionTags) => {
    expect(() => projectControlledFeedback({
      criteria: [{ key: 'core', label: 'Core correctness' }],
      outcomes: [{ key: 'core', awarded: true }],
      misconceptionTags,
    })).toThrow(/misconception taxonomy/i)
  })

  test('rejects outcomes that do not exactly match the pinned criterion set', () => {
    expect(() => projectControlledFeedback({
      criteria: [{ key: 'core', label: 'Core correctness' }],
      outcomes: [{ key: 'other', awarded: true }],
      misconceptionTags: [],
    })).toThrow(/pinned criteria/i)
  })

  test('provides bounded recovery copy without interpolating provider or learner text', () => {
    expect(renderControlledFeedbackTemplate('provider_unavailable')).toBe('Your response was saved. Scoring needs review, and no mastery change was made.')
  })
})
