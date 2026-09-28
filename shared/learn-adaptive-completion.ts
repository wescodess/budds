export const ADAPTIVE_REPRESENTATIVE_COMPLETION_VERSION = 'learn-adaptive.representative-completion.v1' as const

// The only Slice-1 continuation after a scored representative response is a
// named handoff to existing V2 authority. No activity or schedule is inferred.
export function representativeNextAction(passed: boolean, activityId: string) {
  return {
    kind: 'open_v2_mission' as const,
    label: passed ? 'Choose your next move in your learning mission' : 'Review feedback in your learning mission',
    reasonCode: passed ? 'representative_pass' as const : 'representative_fail' as const,
    activityId,
  }
}
