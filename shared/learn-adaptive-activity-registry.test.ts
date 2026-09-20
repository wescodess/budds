import { describe, expect, expectTypeOf, test } from 'vitest'
import {
  ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
  ADAPTIVE_ACTIVITY_FALLBACK_VERSION,
  ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION,
  ADAPTIVE_ACTIVITY_RENDERER_VERSION,
  ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION,
  ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION,
  getAdaptiveActivityRegistry,
  validateAdaptiveActivityPrimitive,
  validateAdaptiveActivityPrimitiveSequence,
  type ValidatedAdaptiveActivityPrimitive,
} from './learn-adaptive-activity-registry'

const evidence = {
  'source-1': { integrityState: 'accepted' },
  'source-2': { integrityState: 'conflict' },
  'source-snapshot-1': { integrityState: 'accepted' },
} as const

describe('Adaptive Learn activity registry', () => {
  test('publishes the seven approved primitives with stable versions, actions, and test IDs', () => {
    expect(getAdaptiveActivityRegistry()).toEqual({
      contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
      rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
      analytics: {
        validation: { name: 'adaptive_primitive_validation', version: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION, outcomes: ['valid', 'rejected'] },
        sequenceValidation: { name: 'adaptive_primitive_sequence_validation', version: ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION, outcomes: ['valid', 'rejected'] },
        fallback: { name: 'adaptive_primitive_fallback', version: ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION, outcomes: ['fallback'] },
      },
      registeredTypes: [
        'cited_explanation',
        'diagnostic_prompt',
        'worked_example',
        'independent_application',
        'source_comparison',
        'artifact_workspace',
        'reflection_next_move',
      ],
      primitives: [
        { type: 'cited_explanation', allowedActions: ['continue', 'inspect_source', 'ask_for_example'], testId: 'learn-primitive-cited-explanation' },
        { type: 'diagnostic_prompt', allowedActions: ['submit_response'], testId: 'learn-primitive-diagnostic-prompt' },
        { type: 'worked_example', allowedActions: ['reveal_example', 'continue'], testId: 'learn-primitive-worked-example' },
        { type: 'independent_application', allowedActions: ['submit_response', 'save_draft'], testId: 'learn-primitive-independent-application' },
        { type: 'source_comparison', allowedActions: ['choose_source', 'submit_comparison'], testId: 'learn-primitive-source-comparison' },
        { type: 'artifact_workspace', allowedActions: ['save_artifact', 'apply_artifact', 'share_artifact'], testId: 'learn-primitive-artifact-workspace' },
        { type: 'reflection_next_move', allowedActions: ['accept_next_move', 'override_next_move', 'end_thread'], testId: 'learn-primitive-reflection-next-move' },
      ],
      fallback: { version: ADAPTIVE_ACTIVITY_FALLBACK_VERSION, testId: 'learn-activity-fallback' },
    })
  })

  test('validates a registered primitive and returns its pinned render contract', () => {
    expect(validateAdaptiveActivityPrimitive({
      type: 'cited_explanation',
      action: 'continue',
      props: {
        heading: 'Why plants need light',
        explanation: 'Plants convert light energy into stored chemical energy.',
        sourceRefs: ['source-snapshot-1'],
      },
    }, evidence)).toEqual({
      ok: true,
      value: {
        contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
        rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
        type: 'cited_explanation',
        action: 'continue',
        props: {
          heading: 'Why plants need light',
          explanation: 'Plants convert light energy into stored chemical energy.',
          sourceRefs: ['source-snapshot-1'],
        },
        testId: 'learn-primitive-cited-explanation',
      },
      analytics: {
        name: 'adaptive_primitive_validation',
        version: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION,
        outcome: 'valid',
        primitiveType: 'cited_explanation',
        reasonCode: null,
      },
    })
  })

  test.each([
      { type: 'cited_explanation', action: 'inspect_source', props: { heading: 'Light energy', explanation: 'Evidence-grounded explanation.', sourceRefs: ['source-1'] } },
      { type: 'diagnostic_prompt', action: 'submit_response', props: { prompt: 'Explain the mechanism.', responseFormat: 'short_text', assistance: 'hint_available' } },
      { type: 'worked_example', action: 'reveal_example', props: { heading: 'Worked mechanism', problem: 'Trace the energy.', steps: ['Identify the input.', 'Trace the conversion.'], guidedConsequence: 'Using this support caps this attempt at guided.', sourceRefs: ['source-1'] } },
      { type: 'independent_application', action: 'save_draft', props: { prompt: 'Apply the mechanism to a new case.', responseFormat: 'long_text', draftPersistence: true } },
      { type: 'source_comparison', action: 'submit_comparison', props: { prompt: 'Which source better supports the claim?', sources: [{ sourceRef: 'source-1', label: 'Source A', summary: 'Primary evidence.' }, { sourceRef: 'source-2', label: 'Source B', summary: 'Conflicting evidence.' }] } },
      { type: 'artifact_workspace', action: 'save_artifact', props: { prompt: 'Build a concise plan.', artifactKind: 'plan', starterText: 'Goal:' } },
      { type: 'reflection_next_move', action: 'override_next_move', props: { feedback: 'The core mechanism is secure.', nextMove: 'Compare conflicting cases.', allowedDecisions: ['accept', 'override', 'end'] } },
  ] as const)('validates bounded $type props', (fixture) => {
    expect(validateAdaptiveActivityPrimitive(fixture, evidence)).toMatchObject({
      ok: true,
      value: {
        contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
        rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
        type: fixture.type,
        action: fixture.action,
      },
      analytics: { outcome: 'valid', primitiveType: fixture.type, reasonCode: null },
    })
  })

  test.each([
    ['unknown_primitive', { type: 'generated_widget', action: 'continue', props: {} }],
    ['unsupported_action', { type: 'cited_explanation', action: 'run_tool', props: { heading: 'Safe', explanation: 'Safe text.', sourceRefs: ['source-1'] } }],
    ['oversized_prop', { type: 'cited_explanation', action: 'continue', props: { heading: 'x'.repeat(161), explanation: 'Safe text.', sourceRefs: ['source-1'] } }],
    ['unsafe_url', { type: 'cited_explanation', action: 'continue', props: { heading: 'Unsafe link', explanation: 'Open javascript:alert(1)', sourceRefs: ['source-1'] } }],
    ['executable_content', { type: 'cited_explanation', action: 'continue', props: { heading: 'Unsafe markup', explanation: '<script>alert(1)</script>', sourceRefs: ['source-1'] } }],
    ['invalid_props', { type: 'diagnostic_prompt', action: 'submit_response', props: { prompt: 'Answer.', responseFormat: 'short_text', assistance: 'none', onSubmit: 'run()' } }],
  ] as const)('rejects %s with a deterministic text/card fallback and versioned analytics', (reasonCode, candidate) => {
    const expected = {
      ok: false,
      error: { code: reasonCode, message: expect.any(String) },
      fallback: {
        version: ADAPTIVE_ACTIVITY_FALLBACK_VERSION,
        kind: 'text_card',
        title: 'Activity unavailable',
        body: expect.any(String),
        primaryAction: { type: 'continue_safe', label: 'Continue safely' },
        testId: 'learn-activity-fallback',
      },
      analytics: {
        name: 'adaptive_primitive_validation',
        version: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION,
        outcome: 'rejected',
        primitiveType: candidate.type === 'generated_widget' ? null : candidate.type,
        reasonCode,
      },
      fallbackAnalytics: {
        name: 'adaptive_primitive_fallback',
        version: ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION,
        outcome: 'fallback',
        primitiveType: candidate.type === 'generated_widget' ? null : candidate.type,
        reasonCode,
      },
    }
    expect(validateAdaptiveActivityPrimitive(candidate, evidence)).toEqual(expected)
    expect(validateAdaptiveActivityPrimitive(candidate, evidence)).toEqual(expected)
  })

  test.each([
    ['unknown reference', ['source-missing']],
    ['unaccepted reference', ['source-2']],
  ])('rejects an %s instead of trusting generated evidence', (_label, sourceRefs) => {
    expect(validateAdaptiveActivityPrimitive({
      type: 'cited_explanation',
      action: 'continue',
      props: { heading: 'Evidence', explanation: 'Claim.', sourceRefs },
    }, evidence)).toMatchObject({
      ok: false,
      error: { code: 'invalid_evidence_link' },
      fallback: { testId: 'learn-activity-fallback' },
      analytics: { reasonCode: 'invalid_evidence_link' },
      fallbackAnalytics: { reasonCode: 'invalid_evidence_link' },
    })
  })

  test('derives source-comparison integrity from the authority projection', () => {
    const result = validateAdaptiveActivityPrimitive({
      type: 'source_comparison',
      action: 'choose_source',
      props: {
        prompt: 'Compare.',
        sources: [
          { sourceRef: 'source-1', label: 'Accepted', summary: 'Primary.' },
          { sourceRef: 'source-2', label: 'Conflict', summary: 'Disputed.' },
        ],
      },
    }, evidence)
    expect(result).toMatchObject({
      ok: true,
      value: { props: { sources: [{ integrityState: 'accepted' }, { integrityState: 'conflict' }] } },
    })
  })

  test.each(['constructor', 'toString'])('rejects prototype key %s as an evidence reference', (sourceRef) => {
    expect(validateAdaptiveActivityPrimitive({
      type: 'source_comparison',
      action: 'choose_source',
      props: {
        prompt: 'Compare.',
        sources: [
          { sourceRef, label: 'Forged', summary: 'Inherited property.' },
          { sourceRef: 'source-1', label: 'Known', summary: 'Accepted source.' },
        ],
      },
    }, evidence)).toMatchObject({ ok: false, error: { code: 'invalid_evidence_link' } })
  })

  test('rejects generated source-comparison integrity instead of trusting it', () => {
    expect(validateAdaptiveActivityPrimitive({
      type: 'source_comparison',
      action: 'choose_source',
      props: {
        prompt: 'Compare.',
        sources: [
          { sourceRef: 'source-1', label: 'A', summary: 'Primary.', integrityState: 'accepted' },
          { sourceRef: 'source-2', label: 'B', summary: 'Disputed.', integrityState: 'accepted' },
        ],
      },
    }, evidence)).toMatchObject({ ok: false, error: { code: 'invalid_props' } })
  })

  test('exports a discriminated output contract for exhaustive renderers', () => {
    const render = (primitive: ValidatedAdaptiveActivityPrimitive) => {
      if (primitive.type === 'cited_explanation') {
        expectTypeOf(primitive.props.sourceRefs).toEqualTypeOf<string[]>()
        expectTypeOf(primitive.action).toEqualTypeOf<'continue' | 'inspect_source' | 'ask_for_example'>()
      }
    }
    expect(render).toBeTypeOf('function')
  })

  test('validates a bounded primitive sequence without mutating its input', () => {
    const plan = [
      { type: 'diagnostic_prompt', action: 'submit_response', props: { prompt: 'Explain the mechanism.', responseFormat: 'short_text', assistance: 'none' } },
      { type: 'reflection_next_move', action: 'accept_next_move', props: { feedback: 'The mechanism is clear.', nextMove: 'Apply it independently.', allowedDecisions: ['accept', 'override'] } },
    ]
    const before = structuredClone(plan)
    expect(validateAdaptiveActivityPrimitiveSequence(plan)).toMatchObject({
      ok: true,
      value: {
        contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
        rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
        primitives: [{ type: 'diagnostic_prompt' }, { type: 'reflection_next_move' }],
      },
      analytics: { name: 'adaptive_primitive_sequence_validation', version: ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION, outcome: 'valid', primitiveCount: 2, reasonCode: null },
    })
    expect(plan).toEqual(before)
  })

  test('rejects an oversized primitive sequence before any item is accepted', () => {
    const item = { type: 'diagnostic_prompt', action: 'submit_response', props: { prompt: 'Explain the mechanism.', responseFormat: 'short_text', assistance: 'none' } }
    expect(validateAdaptiveActivityPrimitiveSequence(Array.from({ length: 8 }, () => structuredClone(item)))).toMatchObject({
      ok: false,
      error: { code: 'oversized_plan' },
      fallback: { version: ADAPTIVE_ACTIVITY_FALLBACK_VERSION, kind: 'text_card', testId: 'learn-activity-fallback' },
      analytics: { name: 'adaptive_primitive_sequence_validation', version: ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION, outcome: 'rejected', primitiveCount: 8, reasonCode: 'oversized_plan' },
      fallbackAnalytics: { name: 'adaptive_primitive_fallback', version: ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION, outcome: 'fallback', reasonCode: 'oversized_plan' },
    })
  })
})
