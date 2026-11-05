export const ADAPTIVE_REPRESENTATIVE_COMPLETION_VERSION = 'learn-adaptive.representative-completion.v1' as const

// The only Slice-1 continuation after a scored representative response is a
// named handoff to existing V2 authority. No activity or schedule is inferred.
export function representativeNextAction(passed: boolean, activityId: string) {
  return {
    kind: 'open_v2_mission' as const,
    label: passed ? 'Choose your next move in your Void' : 'Review feedback in your Void',
    reasonCode: passed ? 'representative_pass' as const : 'representative_fail' as const,
    activityId,
  }
}

const PERSISTED_NEXT_ACTION_LABELS = new Map<string, readonly [string, string]>([
  ['representative_pass', ['Choose your next move in your learning mission', 'Choose your next move in your Void']],
  ['representative_fail', ['Review feedback in your learning mission', 'Review feedback in your Void']],
  ['source_invalidated', ['Review your learning mission', 'Review your Void']],
])

export function presentNextAction<T extends { label: string, reasonCode: string }>(action: T): T {
  const [persisted, label] = PERSISTED_NEXT_ACTION_LABELS.get(action.reasonCode) ?? []
  return label !== undefined && persisted === action.label ? { ...action, label } : action
}
