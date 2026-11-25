import { projectAdaptiveControls } from '~~/shared/learn-adaptive-controls'
import { adaptiveRecoveryCopy } from '~~/shared/learn-adaptive-recovery'
import { LEARN_CANVAS_CHECK_RECEIPT_VERSION, learnCanvasCheckReceiptSchema, type LearnCanvasCheckReceipt } from '~~/shared/learn-v2-today-check'
import type { LearnAssessmentPhase } from '~~/shared/learn-v2-delayed-check'

type Thread = { id: string, outcome?: string, intent?: string, revision?: number }

const purpose = 'Complete the assigned check.'

function checkActivity(id: string, planRevision: number, status: string, blocked: boolean) {
  return {
    id, status, purpose, reasonCode: 'assessment_check', planRevision, draftKind: null,
    evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: blocked ? 'blocked' : 'accepted', sourceRefs: [] as string[] },
    controls: projectAdaptiveControls({ activityClass: 'factual', activityStatus: 'blocked', lifecycle: 'active',
      evidenceReady: false, sourceCount: 0, currentTime: '20', purpose, reasonCode: 'assessment_check', sourceState: 'blocked' }),
    primitive: null,
    fallback: { version: 'learn-adaptive.text-card-fallback.v1', kind: 'text_card', testId: 'learn-activity-fallback', title: 'Assigned check', body: '', primaryAction: { type: 'continue_safe', label: 'Continue' } },
    requiredAction: { kind: 'submit_response', label: 'Submit response' },
  }
}

function session() {
  return { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }
}

export function serverAssessmentCanvas(input: {
  ownerId?: string
  thread?: Thread
  activityId?: string
  opportunityId: string
  phase: LearnAssessmentPhase
  revision?: number
  submissionId?: string | null
  delivered?: boolean
  bodyAvailability?: 'available' | 'unavailable'
  currentEligibility?: string
}) {
  const delivered = input.delivered ?? true
  const submissionId = input.submissionId ?? null
  const status = !delivered ? 'blocked'
    : input.phase === 'test_open' ? 'started'
      : input.phase === 'scored_pass' || input.phase === 'scored_fail' ? 'feedback'
        : input.phase === 'reconciliation_required' ? 'reconciling'
          : input.phase === 'scoring_pending' ? 'scoring'
            : submissionId ? 'submitted' : 'blocked'
  return {
    status, ownerId: input.ownerId ?? 'owner_1',
    thread: { id: input.thread?.id ?? 'thread_1', outcome: 'Assigned check', intent: input.thread?.intent ?? 'understand', revision: input.thread?.revision ?? 2 },
    recoveryState: status === 'blocked' ? 'blocked' : null, recoveryEvidenceIssue: null,
    recovery: status === 'blocked' ? adaptiveRecoveryCopy('blocked') : null,
    activity: checkActivity(input.activityId ?? 'activity_1', 1, 'eligible', status === 'blocked'),
    session: session(),
    responsePrompt: null, declaredStimulus: null, responseSpec: null, savedResponse: null,
    assessment: {
      assessmentOpportunityId: input.opportunityId, phase: input.phase, revision: input.revision ?? 2, submissionId,
      bodyAvailability: input.bodyAvailability ?? 'unavailable', currentEligibility: input.currentEligibility ?? 'unknown',
      reasonCode: delivered ? null : 'not_admitted', ...(delivered ? {} : { observations: 'no_observations' as const }),
    },
  }
}

export function serverCheckReceipt(input: {
  reference: string
  state: LearnCanvasCheckReceipt['state']
  submissionId?: string
  acceptedAt?: number
  confidence?: number
  answer?: string | null
  bodyReason?: 'evidence_unavailable' | 'unavailable' | 'disclosure_unknown' | 'not_delivered'
  result?: Record<string, unknown>
}): LearnCanvasCheckReceipt {
  const body = input.answer ? { bodyAvailability: 'available', payload: { kind: 'text', text: input.answer } }
    : { bodyAvailability: 'unavailable', reasonCode: input.bodyReason ?? 'unavailable' }
  return learnCanvasCheckReceiptSchema.parse({
    version: LEARN_CANVAS_CHECK_RECEIPT_VERSION, reference: input.reference, state: input.state,
    submissionId: input.submissionId ?? 'submission_1', acceptedAt: input.acceptedAt ?? 1_800_000_000_000,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }), body,
    ...(input.state === 'result_ready' ? { result: input.result } : {}),
  })
}

export function serverSavedCheckCanvas(input: {
  ownerId?: string
  thread?: Thread
  activityId?: string
  opportunityId: string
  phase: LearnAssessmentPhase
  receipt: LearnCanvasCheckReceipt
}) {
  const { receipt } = input
  const status = receipt.state === 'closed' ? 'blocked' : receipt.state === 'result_unconfirmed' ? 'reconciling'
    : receipt.state === 'result_ready' ? 'feedback' : input.phase === 'scoring_pending' ? 'scoring' : 'submitted'
  const recoverable = receipt.state === 'closed' || receipt.state === 'result_unconfirmed'
  const payload = receipt.body.bodyAvailability === 'available' ? receipt.body.payload : null
  return {
    status, ownerId: input.ownerId ?? 'owner_1', checkReceipt: receipt,
    thread: { id: input.thread?.id ?? 'thread_1', outcome: 'Assigned check', intent: input.thread?.intent ?? 'understand', revision: input.thread?.revision ?? 2 },
    recoveryState: receipt.state === 'closed' ? 'invalidated' : null, recoveryEvidenceIssue: null, recovery: null,
    activity: checkActivity(input.activityId ?? 'activity_1', 1, 'blocked', true),
    session: session(),
    responsePrompt: null, declaredStimulus: null, responseSpec: null,
    savedResponse: receipt.confidence !== undefined && payload?.kind === 'text' ? { response: payload.text, confidence: receipt.confidence } : null,
    ...(!recoverable ? { assessment: { assessmentOpportunityId: input.opportunityId, phase: input.phase, revision: 3,
      submissionId: receipt.submissionId, bodyAvailability: receipt.body.bodyAvailability, currentEligibility: 'eligible', reasonCode: null } } : {}),
  }
}
