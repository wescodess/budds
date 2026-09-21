import { v } from 'convex/values'
import {
  ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
  ADAPTIVE_ACTIVITY_FALLBACK_VERSION,
  ADAPTIVE_ACTIVITY_RENDERER_VERSION,
  ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION,
  ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION,
} from './learn-adaptive-activity-registry'
import { ADAPTIVE_ACTIVITY_PLAN_VERSION, ADAPTIVE_ACTIVITY_REPLAY_VERSION } from './learn-adaptive-activity-plan'

export const ADAPTIVE_LEARN_STORAGE_MANIFEST = [
  {
    table: 'learningThreadActivities',
    ownerIndex: 'by_userId',
    parentIndex: 'by_userId_and_threadId_and_boundaryOrdinal',
    export: 'redacted_bounded',
    accountDeletion: 'delete',
  },
  {
    table: 'learningThreads',
    ownerIndex: 'by_userId',
    parentIndex: 'by_userId_and_updatedAt',
    export: 'bounded',
    accountDeletion: 'delete',
  },
] as const

export const ADAPTIVE_LEARN_ACCOUNT_DELETE_ORDER = ADAPTIVE_LEARN_STORAGE_MANIFEST.map(entry => entry.table)
export const ADAPTIVE_LEARN_EXPORT_COLLECTIONS = ['learningThreads', 'learningThreadActivities'] as const

const learningIntentValidator = v.union(v.literal('understand'), v.literal('prepare'), v.literal('build'), v.literal('master'), v.literal('refresh'), v.literal('explore'))
const availableTimeValidator = v.union(v.literal('15'), v.literal('25'), v.literal('45'), v.literal('60'), v.literal('no_limit'))
const evidenceStateValidator = v.union(v.literal('none'), v.literal('preparing'), v.literal('ready'), v.literal('blocked'), v.literal('stale'), v.literal('invalidated'), v.literal('unavailable'))

const citedExplanationProps = v.object({ heading: v.string(), explanation: v.string(), sourceRefs: v.array(v.string()) })
const diagnosticPromptProps = v.object({ prompt: v.string(), responseFormat: v.union(v.literal('short_text'), v.literal('long_text')), assistance: v.union(v.literal('none'), v.literal('hint_available')) })
const workedExampleProps = v.object({ heading: v.string(), problem: v.string(), steps: v.array(v.string()), guidedConsequence: v.string(), sourceRefs: v.array(v.string()) })
const independentApplicationProps = v.object({ prompt: v.string(), responseFormat: v.union(v.literal('short_text'), v.literal('long_text'), v.literal('structured')), draftPersistence: v.boolean() })
const sourceComparisonInputProps = v.object({ prompt: v.string(), sources: v.array(v.object({ sourceRef: v.string(), label: v.string(), summary: v.string() })) })
const sourceComparisonStoredProps = v.object({ prompt: v.string(), sources: v.array(v.object({ sourceRef: v.string(), label: v.string(), summary: v.string(), integrityState: v.union(v.literal('accepted'), v.literal('conflict'), v.literal('gap'), v.literal('stale'), v.literal('unavailable')) })) })
const artifactWorkspaceProps = v.object({ prompt: v.string(), artifactKind: v.union(v.literal('note'), v.literal('plan'), v.literal('draft'), v.literal('answer'), v.literal('other')), starterText: v.string() })
const reflectionNextMoveProps = v.object({ feedback: v.string(), nextMove: v.string(), allowedDecisions: v.array(v.union(v.literal('accept'), v.literal('override'), v.literal('end'))) })

export const adaptiveActivityPrimitiveInputValidator = v.union(
  v.object({ type: v.literal('cited_explanation'), action: v.union(v.literal('continue'), v.literal('inspect_source'), v.literal('ask_for_example')), props: citedExplanationProps }),
  v.object({ type: v.literal('diagnostic_prompt'), action: v.literal('submit_response'), props: diagnosticPromptProps }),
  v.object({ type: v.literal('worked_example'), action: v.union(v.literal('reveal_example'), v.literal('continue')), props: workedExampleProps }),
  v.object({ type: v.literal('independent_application'), action: v.union(v.literal('submit_response'), v.literal('save_draft')), props: independentApplicationProps }),
  v.object({ type: v.literal('source_comparison'), action: v.union(v.literal('choose_source'), v.literal('submit_comparison')), props: sourceComparisonInputProps }),
  v.object({ type: v.literal('artifact_workspace'), action: v.union(v.literal('save_artifact'), v.literal('apply_artifact'), v.literal('share_artifact')), props: artifactWorkspaceProps }),
  v.object({ type: v.literal('reflection_next_move'), action: v.union(v.literal('accept_next_move'), v.literal('override_next_move'), v.literal('end_thread')), props: reflectionNextMoveProps }),
)

const storedPrimitiveFields = {
  contractVersion: v.literal(ADAPTIVE_ACTIVITY_CONTRACT_VERSION),
  rendererVersion: v.literal(ADAPTIVE_ACTIVITY_RENDERER_VERSION),
}

export const adaptiveActivityPrimitivePlanValidator = v.array(v.union(
  v.object({ ...storedPrimitiveFields, type: v.literal('cited_explanation'), action: v.union(v.literal('continue'), v.literal('inspect_source'), v.literal('ask_for_example')), props: citedExplanationProps, testId: v.literal('learn-primitive-cited-explanation') }),
  v.object({ ...storedPrimitiveFields, type: v.literal('diagnostic_prompt'), action: v.literal('submit_response'), props: diagnosticPromptProps, testId: v.literal('learn-primitive-diagnostic-prompt') }),
  v.object({ ...storedPrimitiveFields, type: v.literal('worked_example'), action: v.union(v.literal('reveal_example'), v.literal('continue')), props: workedExampleProps, testId: v.literal('learn-primitive-worked-example') }),
  v.object({ ...storedPrimitiveFields, type: v.literal('independent_application'), action: v.union(v.literal('submit_response'), v.literal('save_draft')), props: independentApplicationProps, testId: v.literal('learn-primitive-independent-application') }),
  v.object({ ...storedPrimitiveFields, type: v.literal('source_comparison'), action: v.union(v.literal('choose_source'), v.literal('submit_comparison')), props: sourceComparisonStoredProps, testId: v.literal('learn-primitive-source-comparison') }),
  v.object({ ...storedPrimitiveFields, type: v.literal('artifact_workspace'), action: v.union(v.literal('save_artifact'), v.literal('apply_artifact'), v.literal('share_artifact')), props: artifactWorkspaceProps, testId: v.literal('learn-primitive-artifact-workspace') }),
  v.object({ ...storedPrimitiveFields, type: v.literal('reflection_next_move'), action: v.union(v.literal('accept_next_move'), v.literal('override_next_move'), v.literal('end_thread')), props: reflectionNextMoveProps, testId: v.literal('learn-primitive-reflection-next-move') }),
))

export const adaptiveRequiredActionValidator = v.object({ kind: v.string(), label: v.string() })
export const adaptiveEvaluationContractValidator = v.object({
  version: v.string(),
  kind: v.union(v.literal('acknowledgement'), v.literal('learner_response'), v.literal('server_scored')),
  responseFormat: v.union(v.literal('none'), v.literal('short_text'), v.literal('long_text'), v.literal('structured')),
  passingScorePercent: v.union(v.number(), v.null()),
})
export const adaptiveAccessibilityMetadataValidator = v.object({ heading: v.string(), instructions: v.string(), focusTargetTestId: v.string(), liveRegionMode: v.union(v.literal('off'), v.literal('polite'), v.literal('assertive')) })
export const adaptiveDecisionInputsValidator = v.object({
  availableTime: availableTimeValidator,
  sourceState: evidenceStateValidator,
  priorActivityId: v.union(v.string(), v.null()),
  priorOutcome: v.union(v.string(), v.null()),
  assistance: v.union(v.literal('none'), v.literal('hint'), v.literal('reveal')),
  confidence: v.union(v.number(), v.null()),
})

export const learningThreadFields = {
  userId: v.string(),
  originalNeed: v.string(),
  intent: learningIntentValidator,
  availableTime: availableTimeValidator,
  authorityKind: v.union(v.literal('standalone'), v.literal('v2_mission')),
  learningVoidId: v.optional(v.id('learningVoids')),
  sourceScope: v.union(
    v.object({ kind: v.literal('none') }),
    v.object({ kind: v.literal('folder'), sourceId: v.string() }),
    v.object({ kind: v.literal('document'), sourceId: v.string() }),
    v.object({ kind: v.literal('url'), urlHash: v.string() }),
    v.object({ kind: v.literal('pasted'), contentDigest: v.string(), byteCount: v.number() }),
  ),
  evidenceState: evidenceStateValidator,
  lifecycle: v.union(v.literal('draft'), v.literal('preparing'), v.literal('ready'), v.literal('active'), v.literal('paused'), v.literal('ended'), v.literal('blocked'), v.literal('rollback')),
  revision: v.number(),
  currentActivityId: v.optional(v.id('learningThreadActivities')),
  unresolvedPoint: v.optional(v.string()),
  nextAction: v.optional(v.object({ kind: v.string(), label: v.string(), reasonCode: v.string(), activityId: v.string() })),
  createdAt: v.number(),
  updatedAt: v.number(),
}

export const learningThreadActivityFields = {
  userId: v.string(),
  threadId: v.id('learningThreads'),
  activityId: v.string(),
  boundaryOrdinal: v.number(),
  planRevision: v.number(),
  activityClass: v.union(v.literal('factual'), v.literal('non_factual')),
  status: v.union(v.literal('eligible'), v.literal('started'), v.literal('submitted'), v.literal('scoring'), v.literal('feedback'), v.literal('blocked'), v.literal('reconciling'), v.literal('ended'), v.literal('replaced')),
  planVersion: v.literal(ADAPTIVE_ACTIVITY_PLAN_VERSION),
  replayVersion: v.literal(ADAPTIVE_ACTIVITY_REPLAY_VERSION),
  contractVersion: v.literal(ADAPTIVE_ACTIVITY_CONTRACT_VERSION),
  rendererVersion: v.literal(ADAPTIVE_ACTIVITY_RENDERER_VERSION),
  validationVersion: v.literal(ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION),
  sequenceValidationVersion: v.literal(ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION),
  fallbackVersion: v.literal(ADAPTIVE_ACTIVITY_FALLBACK_VERSION),
  intent: learningIntentValidator,
  objectiveId: v.union(v.id('learnObjectives'), v.null()),
  purpose: v.string(),
  reasonCode: v.string(),
  primitivePlan: adaptiveActivityPrimitivePlanValidator,
  requiredAction: adaptiveRequiredActionValidator,
  evaluationContract: adaptiveEvaluationContractValidator,
  fallback: v.object({ version: v.literal(ADAPTIVE_ACTIVITY_FALLBACK_VERSION), kind: v.literal('text_card'), title: v.string(), body: v.string(), primaryAction: v.object({ type: v.literal('continue_safe'), label: v.string() }), testId: v.literal('learn-activity-fallback') }),
  accessibilityMetadata: adaptiveAccessibilityMetadataValidator,
  learningVoidId: v.union(v.id('learningVoids'), v.null()),
  blueprintRevisionId: v.union(v.id('learnBlueprintRevisions'), v.null()),
  sessionContentId: v.union(v.id('sessionContent'), v.null()),
  evidenceReferences: v.array(v.object({ claimId: v.id('sessionContentClaims'), supportId: v.id('learnClaimSupports'), sourceSnapshotId: v.id('learnSourceSnapshots'), sourceSnapshotRevision: v.number(), sourceRecordRevision: v.number(), verifierVersion: v.string(), integrityState: v.literal('accepted') })),
  generationInputs: v.object({ sessionContentRevision: v.union(v.number(), v.null()), sessionContentInputDigest: v.union(v.string(), v.null()), generatorVersion: v.union(v.string(), v.null()) }),
  decisionInputs: adaptiveDecisionInputsValidator,
  replacesActivityId: v.union(v.string(), v.null()),
  canonicalInputSnapshot: v.string(),
  inputDigest: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
}

export const commitAdaptiveActivityPlanValidator = v.object({
  tokenIdentifier: v.string(),
  threadId: v.id('learningThreads'),
  activityId: v.string(),
  boundaryOrdinal: v.number(),
  planRevision: v.number(),
  activityClass: v.union(v.literal('factual'), v.literal('non_factual')),
  intent: learningIntentValidator,
  objectiveId: v.union(v.id('learnObjectives'), v.null()),
  purpose: v.string(),
  reasonCode: v.string(),
  primitiveSequence: v.array(adaptiveActivityPrimitiveInputValidator),
  requiredAction: adaptiveRequiredActionValidator,
  evaluationContract: adaptiveEvaluationContractValidator,
  accessibilityMetadata: adaptiveAccessibilityMetadataValidator,
  learningVoidId: v.union(v.id('learningVoids'), v.null()),
  blueprintRevisionId: v.union(v.id('learnBlueprintRevisions'), v.null()),
  sessionContentId: v.union(v.id('sessionContent'), v.null()),
  evidenceReferences: v.array(v.object({ claimId: v.id('sessionContentClaims'), supportId: v.id('learnClaimSupports'), sourceSnapshotId: v.id('learnSourceSnapshots') })),
  decisionInputs: adaptiveDecisionInputsValidator,
  replacesActivityId: v.optional(v.string()),
})
