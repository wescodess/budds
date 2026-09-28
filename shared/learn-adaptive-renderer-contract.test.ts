import { describe, expect, test } from 'vitest'
import {
  ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
  ADAPTIVE_ACTIVITY_RENDERER_VERSION,
  getAdaptiveActivityRegistry,
  type AdaptiveActivityPrimitiveType,
} from './learn-adaptive-activity-registry'
import { ADAPTIVE_ACTIVITY_RENDERERS, canvasRendererForPrimitive, resolveAdaptiveActivityRenderer, type AdaptiveActivityRenderer } from './learn-adaptive-renderer-contract'

const evidence = { 'source-1': { integrityState: 'accepted' }, 'source-2': { integrityState: 'accepted' } } as const
const fixtures = {
  cited_explanation: { renderer: 'ready_session', action: 'continue', testId: 'learn-primitive-cited-explanation', props: { heading: 'Gravity', explanation: 'Gravity attracts masses.', sourceRefs: ['source-1'] }, accessibleName: 'Cited explanation' },
  diagnostic_prompt: { renderer: 'diagnostic', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt', props: { prompt: 'What do you know?', responseFormat: 'short_text', assistance: 'none' }, accessibleName: 'Diagnostic prompt' },
  worked_example: { renderer: 'ready_session', action: 'reveal_example', testId: 'learn-primitive-worked-example', props: { heading: 'Example', problem: 'Trace gravity.', steps: ['Identify the masses.'], guidedConsequence: 'This is guided practice.', sourceRefs: ['source-1'] }, accessibleName: 'Worked example' },
  independent_application: { renderer: 'ready_session', action: 'submit_response', testId: 'learn-primitive-independent-application', props: { prompt: 'Apply gravity.', responseFormat: 'long_text', draftPersistence: true }, accessibleName: 'Independent application' },
  source_comparison: { renderer: 'ready_session', action: 'submit_comparison', testId: 'learn-primitive-source-comparison', props: { prompt: 'Compare evidence.', sources: [{ sourceRef: 'source-1', label: 'A', summary: 'First.' }, { sourceRef: 'source-2', label: 'B', summary: 'Second.' }] }, accessibleName: 'Source comparison' },
  artifact_workspace: { renderer: 'artifact', action: 'save_artifact', testId: 'learn-primitive-artifact-workspace', props: { prompt: 'Build a plan.', artifactKind: 'plan', starterText: 'Goal:' }, accessibleName: 'Artifact workspace' },
  reflection_next_move: { renderer: 'reflection', action: 'accept_next_move', testId: 'learn-primitive-reflection-next-move', props: { feedback: 'Good progress.', nextMove: 'Try a new case.', allowedDecisions: ['accept', 'override', 'end'] }, accessibleName: 'Reflection and next move' },
} as const satisfies Record<AdaptiveActivityPrimitiveType, { renderer: AdaptiveActivityRenderer, action: string, testId: string, props: object, accessibleName: string }>

function projected(type: AdaptiveActivityPrimitiveType) {
  const fixture = fixtures[type]
  return { contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION, rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
    type, action: fixture.action, testId: fixture.testId, props: structuredClone(fixture.props) }
}

describe('adaptive activity renderer integration', () => {
  test('every registered primitive has exactly one fixture, renderer version, fallback, and accessible name', () => {
    const registered = getAdaptiveActivityRegistry().registeredTypes
    expect(Object.keys(fixtures).sort()).toEqual([...registered].sort())
    expect(Object.keys(ADAPTIVE_ACTIVITY_RENDERERS).sort()).toEqual([...registered].sort())
    for (const type of registered) {
      const fixture = fixtures[type]
      const result = resolveAdaptiveActivityRenderer(projected(type), fixture.renderer, evidence)
      expect(result).toMatchObject({ ok: true, value: { type, rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION, testId: fixture.testId },
        renderer: fixture.renderer, accessibleName: fixture.accessibleName })
      expect(ADAPTIVE_ACTIVITY_RENDERERS[type].fallback).toBe('learn-activity-fallback')
      expect(ADAPTIVE_ACTIVITY_RENDERERS[type].accessibleName).toBe(fixture.accessibleName)
      expect(canvasRendererForPrimitive(type)).toBe(fixture.renderer)
      expect(resolveAdaptiveActivityRenderer({ ...projected(type), rendererVersion: 'learn-adaptive.renderer.v2' }, fixture.renderer, evidence)).toMatchObject({
        ok: false, reason: 'invalid_props', fallback: { version: 'learn-adaptive.text-card-fallback.v1', testId: 'learn-activity-fallback' },
      })
    }
  })

  test('all registered action variants validate under the renderer-version contract', () => {
    for (const primitive of getAdaptiveActivityRegistry().primitives) {
      const type = primitive.type
      for (const action of primitive.allowedActions) {
        const input = { ...projected(type), action }
        expect(resolveAdaptiveActivityRenderer(input, fixtures[type].renderer, evidence)).toMatchObject({
          ok: true, value: { type, action, rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION },
        })
      }
    }
  })

  test('a valid primitive sent to the wrong Canvas gets a deterministic fallback', () => {
    expect(resolveAdaptiveActivityRenderer(projected('artifact_workspace'), 'ready_session', evidence)).toMatchObject({
      ok: false, reason: 'renderer_unavailable', fallback: { version: 'learn-adaptive.text-card-fallback.v1', testId: 'learn-activity-fallback' },
    })
  })

  test.each([
    ['unknown_primitive', { ...projected('cited_explanation'), type: 'generated_widget' }],
    ['invalid_props', { ...projected('cited_explanation'), rendererVersion: 'learn-adaptive.renderer.v2' }],
    ['invalid_props', { ...projected('cited_explanation'), contractVersion: 'learn-adaptive.activity-contract.v2' }],
    ['unsupported_action', { ...projected('cited_explanation'), action: 'run_tool' }],
    ['unsafe_url', { ...projected('cited_explanation'), props: { ...fixtures.cited_explanation.props, explanation: 'javascript:alert(1)' } }],
    ['invalid_props', { ...projected('cited_explanation'), props: { ...fixtures.cited_explanation.props, extra: 'unapproved' } }],
    ['invalid_props', { ...projected('cited_explanation'), extra: 'unapproved' }],
  ])('returns %s and the same fallback on repeated validation', (reason, candidate) => {
    const first = resolveAdaptiveActivityRenderer(candidate, 'ready_session', evidence)
    expect(first).toMatchObject({ ok: false, reason, fallback: { kind: 'text_card', testId: 'learn-activity-fallback', primaryAction: { type: 'continue_safe' } } })
    expect(resolveAdaptiveActivityRenderer(candidate, 'ready_session', evidence)).toEqual(first)
  })
})
