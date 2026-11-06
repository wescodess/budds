import type { Doc } from '../_generated/dataModel'

// Only closed, body-free command rejections survive source purging. Never
// infer safety from resultKind alone: cached JSON can carry protected aliases.
const safeRejections = new Set([
  JSON.stringify(['blocked', 'activity_boundary_unavailable', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'activity_not_current', 'Current activity is unavailable']),
  JSON.stringify(['blocked', 'activity_unavailable', 'Activity is unavailable']),
  JSON.stringify(['blocked', 'activity_unavailable', 'Reflection activity is unavailable']),
  JSON.stringify(['blocked', 'activity_unavailable', 'The activity is unavailable']),
  JSON.stringify(['blocked', 'artifact_evidence_unavailable', 'This activity evidence is unavailable; the artifact is read-only']),
  JSON.stringify(['blocked', 'artifact_unavailable', 'Artifact is unavailable']),
  JSON.stringify(['blocked', 'artifact_unavailable', 'The saved artifact is unavailable']),
  JSON.stringify(['blocked', 'authority_changed', 'The learning mission has changed']),
  JSON.stringify(['blocked', 'clarification_pending', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'clarification_pending', 'Resolve the initial clarification before routing']),
  JSON.stringify(['blocked', 'contribution_already_converted', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'contribution_unavailable', 'Contribution is unavailable']),
  JSON.stringify(['blocked', 'decision_unavailable', 'That reflection choice is unavailable']),
  JSON.stringify(['blocked', 'evidence_conflict', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'evidence_unavailable', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'evidence_unavailable', 'Review the source before requesting promotion']),
  JSON.stringify(['blocked', 'factual_authority_unavailable', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'factual_authority_unavailable', 'Pinned factual authority is unavailable']),
  JSON.stringify(['blocked', 'lifecycle_unavailable', 'Thread cannot be ended in its current lifecycle']),
  JSON.stringify(['blocked', 'lifecycle_unavailable', 'Thread cannot be left in its current lifecycle']),
  JSON.stringify(['blocked', 'lifecycle_unavailable', 'Thread is not available to resume']),
  JSON.stringify(['blocked', 'preference_unavailable', 'Preference is unavailable']),
  JSON.stringify(['blocked', 'representative_authority_unavailable', 'Representative attempt authority is unavailable']),
  JSON.stringify(['blocked', 'representative_not_passed', 'A passing representative outcome is required']),
  JSON.stringify(['blocked', 'representative_unavailable', 'A representative outcome is unavailable']),
  JSON.stringify(['blocked', 'routing_boundary_recorded', 'This activity boundary already has a routing decision']),
  JSON.stringify(['blocked', 'routing_boundary_recorded', 'This routing boundary is already recorded']),
  JSON.stringify(['blocked', 'routing_boundary_unavailable', 'Current activity authority is unavailable']),
  JSON.stringify(['blocked', 'routing_boundary_unavailable', 'Pinned factual activity authority is unavailable']),
  JSON.stringify(['blocked', 'routing_boundary_unavailable', 'The current activity boundary is unavailable']),
  JSON.stringify(['blocked', 'routing_boundary_unavailable', 'The current activity is not complete']),
  JSON.stringify(['blocked', 'source_revision_changed', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'source_unavailable', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'thread_deleting', 'Thread deletion is in progress']),
  JSON.stringify(['blocked', 'thread_not_active', 'Thread lifecycle does not accept this command']),
  JSON.stringify(['blocked', 'thread_not_editable', 'This thread cannot accept a promotion proposal']),
  JSON.stringify(['blocked', 'thread_not_editable', 'This thread is read-only']),
  JSON.stringify(['blocked', 'thread_not_editable', 'Thread is unavailable for artifact editing']),
  JSON.stringify(['blocked', 'thread_not_ready', 'Contribution cannot be converted at this boundary']),
  JSON.stringify(['blocked', 'thread_unavailable', 'Thread is not ready for routing']),
  JSON.stringify(['invalid', 'artifact_text_invalid', 'Artifact title or summary is invalid']),
  JSON.stringify(['invalid', 'factual_source_pins_invalid', 'Pinned source revisions disagree']),
  JSON.stringify(['invalid', 'preference_value_invalid', 'Preference value is invalid']),
  JSON.stringify(['invalid', 'promotion_basis_required', 'Choose one saved artifact or representative performance']),
  JSON.stringify(['invalid', 'routing_boundary_invalid', 'The next activity boundary is invalid']),
  JSON.stringify(['invalid', 'routing_decision_integrity', 'Prior routing decision integrity failed']),
  JSON.stringify(['invalid', 'routing_snapshot_oversized', 'Routing snapshot exceeds its limit']),
])

export function retainsSafeAdaptiveRejection(receipt: Doc<'learnActivityCommandReceipts'>, now: number) {
  if (receipt.resultRedactedAt !== undefined || receipt.redactionStatus !== 'pending' || receipt.resultExpiresAt <= now
    || !receipt.resultReference || !['blocked', 'invalid'].includes(receipt.resultKind)) return false
  try {
    const result: unknown = JSON.parse(receipt.resultReference)
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false
    const row = result as Record<string, unknown>
    return receipt.resultReference === JSON.stringify(row)
      && Object.keys(row).sort().join(',') === 'code,kind,message,retryable'
      && row.kind === receipt.resultKind && row.retryable === false
      && safeRejections.has(JSON.stringify([row.kind, row.code, row.message]))
  }
  catch { return false }
}
