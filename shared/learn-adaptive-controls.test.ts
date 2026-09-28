import { describe, expect, test } from 'vitest'
import { fixedNextPlanForOverride, projectAdaptiveControls, reasonTextForActivity } from './learn-adaptive-controls'

describe('bounded adaptive controls', () => {
  test('persists the actual bounded purpose with a closed factual or source-free diagnostic reason', () => {
    expect(reasonTextForActivity({ activityClass: 'factual', purpose: 'Study the supported explanation, then apply it.', reasonCode: 'ready_v2_session', sourceState: 'ready' })).toEqual({
      version: 'learn-adaptive.reason-text.v1', purpose: 'Study the supported explanation, then apply it.',
      text: 'This activity uses accepted sources for the current learning objective.',
    })
    expect(reasonTextForActivity({ activityClass: 'non_factual', purpose: 'Record your starting point.', reasonCode: 'standalone_diagnostic', sourceState: 'none' })).toEqual({
      version: 'learn-adaptive.reason-text.v1', purpose: 'Record your starting point.',
      text: 'No source was selected, so this non-factual starting point does not make factual claims.',
    })
    expect(reasonTextForActivity({ activityClass: 'non_factual', purpose: 'Record your starting point.', reasonCode: 'evidence_preparing_diagnostic', sourceState: 'preparing' }).text).toContain('source was preparing')
  })

  test('uses a conservative bounded fallback for unknown legacy reason codes', () => {
    const reason = reasonTextForActivity({ activityClass: 'non_factual', purpose: ' A very long purpose. '.repeat(100), reasonCode: 'provider-rationale-secret', sourceState: 'none' })
    expect(reason.purpose.length).toBeLessThanOrEqual(160)
    expect(reason.text).toBe('The specific selection reason is unavailable for this activity.')
    expect(JSON.stringify(reason)).not.toContain('provider-rationale-secret')
  })
  test('maps every closed learner choice to one deterministic, provider-free fixed next-plan descriptor', () => {
    const options = ['explain_differently', 'example', 'try', 'quiz', 'compare_sources', 'practical', 'easier', 'harder',
      'answer_now', 'time_15', 'time_25', 'time_45', 'time_60', 'time_no_limit'] as const
    const plans = options.map(option => fixedNextPlanForOverride(option, '25'))
    expect(plans).toHaveLength(14)
    expect(plans.map(plan => plan.nextActivity)).toEqual([
      'alternate_explanation', 'worked_example', 'independent_try', 'knowledge_check', 'source_comparison',
      'practical_application', 'guided_step', 'challenge_step', 'answer_step',
      'continue_with_time', 'continue_with_time', 'continue_with_time', 'continue_with_time', 'continue_with_time',
    ])
    expect(plans[11]).toEqual({ version: 'learn-adaptive.fixed-next-plan.v1', inputOption: 'time_45',
      nextActivity: 'continue_with_time', availableTime: '45', difficulty: 'same', maxNewActivities: 1,
      authority: 'server_revalidate_at_boundary' })
    expect(plans[6]).toMatchObject({ inputOption: 'easier', difficulty: 'easier', availableTime: '25' })
    expect(fixedNextPlanForOverride('example', '25')).toEqual(plans[1])
    for (const plan of plans) expect(JSON.stringify(plan)).not.toMatch(/content|provider|mastery|score|evidence/i)
  })
  test('offers a closed fourteen-choice menu and defers harder as policy until scoped mastery is available', () => {
    const controls = projectAdaptiveControls({ activityClass: 'non_factual', activityStatus: 'eligible', lifecycle: 'active',
      evidenceReady: false, sourceCount: 0, currentTime: '25' })
    expect(controls.options.map(option => option.key)).toEqual([
      'explain_differently', 'example', 'try', 'quiz', 'compare_sources', 'practical', 'easier', 'harder',
      'answer_now', 'time_15', 'time_25', 'time_45', 'time_60', 'time_no_limit',
    ])
    expect(controls.options.find(option => option.key === 'example')).toMatchObject({ available: false, unavailableReason: 'evidence' })
    expect(controls.options.find(option => option.key === 'harder')).toMatchObject({ available: false, unavailableReason: 'policy' })
    expect(projectAdaptiveControls({ activityClass: 'factual', activityStatus: 'eligible', lifecycle: 'active',
      evidenceReady: true, sourceCount: 2, currentTime: '25' }).options.find(option => option.key === 'harder'))
      .toMatchObject({ available: false, unavailableReason: 'policy' })
    expect(controls.options.find(option => option.key === 'answer_now')).toMatchObject({ available: false, unavailableReason: 'state' })
    expect(controls.options.find(option => option.key === 'quiz')).toMatchObject({ available: false, unavailableReason: 'policy' })
    expect(controls.options.find(option => option.key === 'time_45')).toMatchObject({ available: true, unavailableReason: null })
    expect(controls.reasonText).toEqual(reasonTextForActivity({ activityClass: 'non_factual', purpose: 'Current learning activity.', reasonCode: '', sourceState: 'none' }))
  })

  test('blocks every choice when a factual activity is no longer operable', () => {
    const controls = projectAdaptiveControls({ activityClass: 'factual', activityStatus: 'blocked', lifecycle: 'active',
      evidenceReady: false, sourceCount: 2, currentTime: '25' })
    expect(controls.options.every(option => !option.available && option.unavailableReason === 'state')).toBe(true)
  })
})
