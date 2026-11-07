import { expect, test } from 'vitest'
import { presentNextAction, representativeNextAction } from './learn-adaptive-completion'

test('names the representative handoff Void', () => {
  expect(representativeNextAction(true, 'activity_1').label).toBe('Choose your next move in your Void')
  expect(representativeNextAction(false, 'activity_1').label).toBe('Review feedback in your Void')
})

test.each([
  ['representative_pass', 'Choose your next move in your learning mission', 'Choose your next move in your Void'],
  ['representative_fail', 'Review feedback in your learning mission', 'Review feedback in your Void'],
  ['source_invalidated', 'Review your learning mission', 'Review your Void'],
])('presents the persisted %s label as Void', (reasonCode, persisted, presented) => {
  const action = { kind: 'recover', label: persisted, reasonCode, activityId: 'activity_1' }
  expect(presentNextAction(action)).toEqual({ ...action, label: presented })
  expect(action.label).toBe(persisted)
})

test.each([
  ['reflection_next_move_accepted', 'Review your learning mission'],
  ['representative_fail', 'Choose your next move in your learning mission'],
  ['representative_pass', 'Choose your next move in your learning mission today'],
  ['source_invalidated', 'Back to Learn'],
])('leaves %s with any other label unchanged', (reasonCode, label) => {
  const action = { kind: 'continue', label, reasonCode, activityId: 'activity_1' }
  expect(presentNextAction(action)).toBe(action)
})
