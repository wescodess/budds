import { measurementReadContext } from './lib/learnV2MeasurementReadContext'
import { defineTeachingMutation } from './lib/learnV2TeachingReads'
import { teachingReadScope } from './lib/learnV2TeachingReadScope'
import { v, type Infer } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalMutation, internalQuery, mutation, type ActionCtx, type MutationCtx, type QueryCtx } from './_generated/server'
import { requireAuth } from './lib/auth'
import { requireOwnedSubmission } from './lib/learnV2PublicAccess'
import {
  acceptMasterySubmissionArgs, acceptMasterySubmissionSchema, parsePublicLearnRequest,
  responseReceiptValidator, scoreMasterySubmissionArgs, scoreMasterySubmissionSchema, scoreMasterySubmissionValidator,
  type LearnV2AcceptMasterySubmission, type LearnV2ScoreMasterySubmission, type LearnV2SubmissionScore,
} from './lib/learnV2PublicContract'
import { acceptResponseForOwner } from './learnV2Responses'
import type { LearnResponseReceipt } from '../shared/learn-v2-responses'
import { hasLearnV2Access, requireLearnV2MutationAccess } from './lib/learnV2Access'
import { hasAdaptiveExperienceAccess } from './lib/adaptiveLearnAccess'
import { addCalendarDays, deriveMastery, LEARN_V2_MASTERY_SCORER_VERSION, LEARN_V2_MASTERY_THRESHOLD, masteryAttemptTime, scoreCriteria, deriveEligibleMeasurementMastery, localDateAt } from '../shared/learn-v2-mastery'
import { representativeNextAction } from '../shared/learn-adaptive-completion'
import { classifyAiGatewayFailure, generateCompletion } from '../server/utils/ai-gateway'
import { buildBaselineMasteryScoringPayload, buildBaselineMasteryScoringRequest, parseBaselineMasteryScoringResponse, scorerCanonicalJson } from '../server/utils/learn-v2-mastery-scorer'
import { retrieveLearnV2FolderEvidence } from '../server/utils/learn-v2-folder-evidence'
import { requireActiveBlueprint } from './lib/learnV2BlueprintAuthority'
import { matchesLegacyFingerprint, privacyDigest } from './lib/learnV2ResponsePrivacy'
import { getScopedMasteryRecord, transitionScopedMasteryRecord } from './lib/learnV2MasteryScope'
import { ADAPTIVE_V2_PILOT_MANIFEST, adaptiveV2PilotDecision, validateAdaptiveProviderPayload } from '../shared/adaptive-v2-pilot-policy'
import {
  ADAPTIVE_FEEDBACK_TEMPLATE_VERSION,
  ADAPTIVE_MISCONCEPTION_TAGS,
  ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION,
  projectControlledFeedback,
  renderControlledFeedbackTemplate,
  type ControlledFeedbackProjection,
} from '../shared/adaptive-controlled-feedback'
import { findCurrentAdaptiveActivityForSessionContent, writeLearnActivityEvent, writeLearnMeasurementEvent } from './lib/learnAdaptiveEvents'
import { ADAPTIVE_PROVIDER_OPERATIONAL_STORAGE_MANIFEST } from '../shared/adaptive-learn-storage-manifest'

import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, learnTimezoneSchema } from '../shared/learn-v2-responses'
import { isLearnRetainedPromotionTimeEligible } from '../shared/learn-v2-delayed-check'
import { isLearnScoringReceiptCommittable, learnMeasurementItemPinsSchema, deriveLearnScorerConfiguration, LEARN_V2_SCORER_IDENTITY_POLICY_VERSION } from '../shared/learn-v2-measurement'
import { canEmitLearnMeasurementOutcomeEvent, LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION } from '../shared/learn-adaptive-events'
import { freezeFirstIndependentClaimForOwner, writeMeasurementOpportunityFact } from './lib/learnV2Measurement'
import { materializeLearnMeasurementAssignment } from './lib/learnV2MeasurementDueWork'
import { resolveLearnRetainedShell } from './lib/learnV2DelayedDelivery'
import { requireLearnActiveWorkPlan } from './lib/learnV2FixedChecks'
import { getFrozenLearnMeasurementProtocol } from './lib/learnV2MeasurementAssignment'
import { appendLearnMeasurementFact, writeLearnResponseAcceptanceFact } from './lib/learnV2MeasurementFacts'
import { requireSavedLearnScoringInput, reserveSavedLearnScoring, readSavedLearnScoringState, prepareSavedLearnModelScoring,
  deterministicLearnScoringReceipt, saveLearnScoringExecution, saveLearnModelScoringResult, receiptFields, getLearnMeasurementScorer } from './lib/learnV2MeasurementScoring'
import type { LearnScoringExecutionResult } from '../server/utils/learn-v2-mastery-scorer'

const MAX_RESPONSE = 12_000
const MAX_MISCONCEPTIONS = ADAPTIVE_MISCONCEPTION_TAGS.length
const MAX_SOURCES = 64
const SCORING_JOB_TYPE = 'mastery_scoring'
const SCORING_LEASE_MS = ADAPTIVE_V2_PILOT_MANIFEST.limits.leaseMs
export const LEARN_V2_MASTERY_SCORING_ADMISSION = {
  windowMs: ADAPTIVE_V2_PILOT_MANIFEST.limits.quotaWindowMs,
  maxProviderDispatches: ADAPTIVE_V2_PILOT_MANIFEST.limits.maxProviderDispatchesPerWindow,
} as const
const SCORING_RATE_EVENT_RETENTION_MS = ADAPTIVE_V2_PILOT_MANIFEST.limits.dailyQuotaWindowMs
const SCORING_RECOVERY_BATCH = 32
const RATE_EVENT_CLEANUP_BATCH = 128
const FOLLOW_UP_JOB_TYPE = 'session_content_generation'
const scorerVerdictValidator = v.object({
  scorerVersion: v.string(), criterionResults: v.array(v.object({ key: v.string(), awarded: v.boolean() })),
  misconceptionTags: v.array(v.string()), verifierVersions: v.array(v.string()),
})
export type MasteryAttemptRequest = { studySessionId: Id<'studySessions'>, expectedSessionRevision: number, expectedContentRevision: number, expectedPlanRecordRevision: number, expectedBlueprintRecordRevision: number, response: string, confidence: number, idempotencyKey: string }
type AdaptiveAdmissionContext = { threadId: Id<'learningThreads'>, activityId: string, manifestVersion: string }
type AttemptRequest = MasteryAttemptRequest
const PRODUCT_POLICY_VERSION = 'adaptive-v2-product-budget.utc-hour-day.v1'
const ROLLBACK_POLICY_VERSION = 'adaptive-v2-provider-rollback.v1'
const MAX_AMBIGUITY_PERCENT = 1
const MAX_BUDGET_DENIAL_PERCENT = 5
type ProductDenialCode = 'adaptive_product_hourly_quota' | 'adaptive_product_daily_quota' | 'adaptive_product_cost_budget' | 'adaptive_product_concurrency_cap' | 'adaptive_product_guardrail_review' | 'adaptive_product_ledger_unavailable'
type ProductAdmission = { kind: 'allowed' } | { kind: 'blocked', code: ProductDenialCode, retryable: boolean, retryAfterMs?: number }

async function productBudgetRow(ctx: QueryCtx | MutationCtx, scope: 'hour' | 'day' | 'guardrail', now: number) {
  const windowMs = scope === 'hour' ? 3_600_000 : 86_400_000
  const periodStart = scope === 'guardrail' ? 0 : Math.floor(now / windowMs) * windowMs
  return { periodStart, row: await ctx.db.query('learnAdaptiveProviderBudgets').withIndex('by_scope_and_periodStart', q => q.eq('scope', scope).eq('periodStart', periodStart)).unique() }
}

function productLedgerValid(row: Doc<'learnAdaptiveProviderBudgets'>): boolean {
  return row.policyVersion === PRODUCT_POLICY_VERSION && row.rollbackVersion === ROLLBACK_POLICY_VERSION
    && [row.dispatches, row.reservedMicroUsd, row.outstanding, row.eligibleStarts, row.ambiguousOutcomes, row.budgetDenials].every(value => Number.isSafeInteger(value) && value >= 0)
}

async function ensureProductBudgetRow(ctx: MutationCtx, scope: 'hour' | 'day' | 'guardrail', now: number) {
  const { periodStart, row } = await productBudgetRow(ctx, scope, now)
  if (row) return row
  const id = await ctx.db.insert('learnAdaptiveProviderBudgets', {
    scope, periodStart, policyVersion: PRODUCT_POLICY_VERSION, rollbackVersion: ROLLBACK_POLICY_VERSION,
    dispatches: 0, reservedMicroUsd: 0, outstanding: 0, eligibleStarts: 0, ambiguousOutcomes: 0, budgetDenials: 0,
    rollbackLatched: false, updatedAt: now,
    ...(scope === 'guardrail' ? {} : { expiresAt: periodStart + (scope === 'hour' ? 3_600_000 : 86_400_000) + ADAPTIVE_PROVIDER_OPERATIONAL_STORAGE_MANIFEST.windowRetentionMs }),
  })
  return (await ctx.db.get(id))!
}

/** One atomic boundary owns quota, concurrency and conservative spend reservation. */
async function admitAdaptiveProductDispatch(ctx: MutationCtx, job: Doc<'learnJobs'>, reserve: boolean): Promise<ProductAdmission> {
  const now = Date.now()
  const policy = ADAPTIVE_V2_PILOT_MANIFEST.productControls
  const price = ADAPTIVE_V2_PILOT_MANIFEST.modelPolicies.find(row => row.model === job.providerModel)
  if (job.providerProductPolicyVersion !== PRODUCT_POLICY_VERSION || job.providerRollbackPolicyVersion !== ROLLBACK_POLICY_VERSION || !price
    || job.providerVersion !== 'openrouter-via-cloudflare-ai-gateway.v1' || job.providerPolicyVersion !== ADAPTIVE_V2_PILOT_MANIFEST.policyVersion
    || job.providerRequestVersion !== ADAPTIVE_V2_PILOT_MANIFEST.requestVersion || job.providerJobVersion !== ADAPTIVE_V2_PILOT_MANIFEST.jobVersion
    || job.providerQuotaPolicyVersion !== ADAPTIVE_V2_PILOT_MANIFEST.quotaVersion
    || job.providerRetentionPolicyVersion !== ADAPTIVE_V2_PILOT_MANIFEST.retention.provider
    || job.providerMaxRequestBytes !== ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes
    || job.providerMaxOutputTokens !== ADAPTIVE_V2_PILOT_MANIFEST.limits.maxOutputTokens
    || job.providerReservationStatus === 'outstanding' || job.providerReservationStatus === 'ambiguous') {
    return { kind: 'blocked', code: 'adaptive_product_ledger_unavailable', retryable: false }
  }
  // Every input byte is conservatively charged as a token, including the full
  // bounded provider envelope; output tokens use the hard completion ceiling.
  const reservedMicroUsd = Math.ceil(ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes * price.inputUsdPerMillionTokens
    + ADAPTIVE_V2_PILOT_MANIFEST.limits.maxOutputTokens * price.outputUsdPerMillionTokens)
  if (!Number.isSafeInteger(reservedMicroUsd) || reservedMicroUsd < 1 || reservedMicroUsd > Math.floor(ADAPTIVE_V2_PILOT_MANIFEST.limits.costCeilingUsdPerRequest * 1_000_000)) return { kind: 'blocked', code: 'adaptive_product_ledger_unavailable', retryable: false }
  const guardrail = await ensureProductBudgetRow(ctx, 'guardrail', now)
  const hour = await ensureProductBudgetRow(ctx, 'hour', now)
  const day = await ensureProductBudgetRow(ctx, 'day', now)
  if (![guardrail, hour, day].every(productLedgerValid)) return { kind: 'blocked', code: 'adaptive_product_ledger_unavailable', retryable: false }
  if (guardrail.rollbackLatched || guardrail.eligibleStarts >= 1_000_000) return { kind: 'blocked', code: 'adaptive_product_guardrail_review', retryable: false }
  const attempt = (job.attempts ?? 0) + 1
  const eligibleStarts = guardrail.eligibleStarts + (job.providerAdmissionCountedAttempt === attempt ? 0 : 1)
  let denial: Extract<ProductAdmission, { kind: 'blocked' }> | undefined
  if (guardrail.outstanding >= policy.maxConcurrent) denial = { kind: 'blocked', code: 'adaptive_product_concurrency_cap', retryable: true }
  else if (hour.dispatches >= policy.maxDispatchesPerHour) denial = { kind: 'blocked', code: 'adaptive_product_hourly_quota', retryable: true, retryAfterMs: hour.periodStart + 3_600_000 - now }
  else if (day.dispatches >= policy.maxDispatchesPerDay) denial = { kind: 'blocked', code: 'adaptive_product_daily_quota', retryable: true, retryAfterMs: day.periodStart + 86_400_000 - now }
  else if (day.reservedMicroUsd + reservedMicroUsd > policy.maxReservedMicroUsdPerDay) denial = { kind: 'blocked', code: 'adaptive_product_cost_budget', retryable: true, retryAfterMs: day.periodStart + 86_400_000 - now }
  const budgetDenied = denial?.kind === 'blocked' && ['adaptive_product_hourly_quota', 'adaptive_product_daily_quota', 'adaptive_product_cost_budget'].includes(denial.code)
  const budgetDenials = guardrail.budgetDenials + (budgetDenied && job.providerBudgetDeniedAttempt !== attempt ? 1 : 0)
  const rollbackLatched = budgetDenials * 100 > eligibleStarts * MAX_BUDGET_DENIAL_PERCENT
  await ctx.db.patch(guardrail._id, { eligibleStarts, budgetDenials, rollbackLatched, updatedAt: now })
  await ctx.db.patch(job._id, { providerAdmissionCountedAttempt: attempt, ...(budgetDenied ? { providerBudgetDeniedAttempt: attempt } : {}),
    ...(denial ? { providerAdmissionDenialCode: denial.code, providerAdmissionDeniedAt: now } : {}) })
  if (denial) return rollbackLatched ? { ...denial, retryable: false } : denial
  if (reserve) {
    await ctx.db.patch(hour._id, { dispatches: hour.dispatches + 1, reservedMicroUsd: hour.reservedMicroUsd + reservedMicroUsd, updatedAt: now })
    await ctx.db.patch(day._id, { dispatches: day.dispatches + 1, reservedMicroUsd: day.reservedMicroUsd + reservedMicroUsd, updatedAt: now })
    await ctx.db.patch(guardrail._id, { dispatches: guardrail.dispatches + 1, reservedMicroUsd: guardrail.reservedMicroUsd + reservedMicroUsd, outstanding: guardrail.outstanding + 1, updatedAt: now })
    await ctx.db.patch(job._id, { providerReservationAttempt: attempt, providerReservedMicroUsd: (job.providerReservedMicroUsd ?? 0) + reservedMicroUsd, providerReservationStatus: 'outstanding' })
  }
  return { kind: 'allowed' }
}

async function settleAdaptiveProductReservation(ctx: MutationCtx, job: Doc<'learnJobs'>, ambiguous: boolean, now: number) {
  if (job.providerProductPolicyVersion !== PRODUCT_POLICY_VERSION || job.providerReservationStatus !== 'outstanding') return
  const { row } = await productBudgetRow(ctx, 'guardrail', now)
  if (!row || !productLedgerValid(row) || row.outstanding < 1) throw new Error('Adaptive product reservation is unavailable')
  const ambiguousOutcomes = row.ambiguousOutcomes + (ambiguous ? 1 : 0)
  await ctx.db.patch(row._id, { outstanding: row.outstanding - (ambiguous ? 0 : 1), ambiguousOutcomes,
    rollbackLatched: row.rollbackLatched || ambiguousOutcomes * 100 > row.eligibleStarts * MAX_AMBIGUITY_PERCENT, updatedAt: now })
  await ctx.db.patch(job._id, { providerReservationStatus: ambiguous ? 'ambiguous' : 'settled' })
}

/** Owner deletion cannot establish that a dispatched provider request stopped. */
export async function preserveAdaptiveProductReservationOnDeletion(ctx: MutationCtx, job: Doc<'learnJobs'>) {
  await settleAdaptiveProductReservation(ctx, job, true, Date.now())
}
function requestFingerprintPayload(args: AttemptRequest) { return { command: 'submitMasteryAttempt', studySessionId: String(args.studySessionId), expectedSessionRevision: args.expectedSessionRevision, expectedContentRevision: args.expectedContentRevision, expectedPlanRecordRevision: args.expectedPlanRecordRevision, expectedBlueprintRecordRevision: args.expectedBlueprintRecordRevision, response: args.response, confidence: args.confidence } }
function legacyRequestFingerprint(args: AttemptRequest) { return JSON.stringify(requestFingerprintPayload(args)) }
async function requestFingerprints(args: AttemptRequest) { return { digest: await digest(requestFingerprintPayload(args)), legacy: legacyRequestFingerprint(args) } }
async function fingerprintMatches(stored: string | undefined, fingerprints: Awaited<ReturnType<typeof requestFingerprints>>) { return stored === fingerprints.digest || await matchesLegacyFingerprint(stored, fingerprints.legacy) }
function validText(value: string, label: string, max: number) { if (!value.trim() || value.length > max) throw new Error(`${label} is invalid`) }
function validateAttemptRequest(args: AttemptRequest) {
  validText(args.idempotencyKey, 'Idempotency key', 128); validText(args.response, 'Response', MAX_RESPONSE)
  if (!Number.isInteger(args.confidence) || args.confidence < 1 || args.confidence > 5) throw new Error('Confidence is invalid')
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') { const row = value as Record<string, unknown>; return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}` }
  return JSON.stringify(value)
}
async function digest(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
function legacyFeedback(attempt: Doc<'masteryAttempts'>): ControlledFeedbackProjection {
  if (attempt.feedbackTemplateVersion === ADAPTIVE_FEEDBACK_TEMPLATE_VERSION
    && attempt.misconceptionTaxonomyVersion === ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION
    && attempt.feedbackProjectionJson) {
    const persisted = JSON.parse(attempt.feedbackProjectionJson) as ControlledFeedbackProjection
    if (persisted?.templateVersion !== attempt.feedbackTemplateVersion || persisted?.taxonomyVersion !== attempt.misconceptionTaxonomyVersion
      || !Array.isArray(persisted.criterionResults) || !Array.isArray(persisted.misconceptionTags) || !Array.isArray(persisted.misconceptionFeedback)) throw new Error('Committed feedback projection is invalid')
    return persisted
  }
  let criterionResults: Array<{ key: string, awarded: boolean }> = []
  let misconceptionTags: string[] = []
  let criteria: Array<{ key: string, description?: string }> = []
  try {
    const parsed = JSON.parse(attempt.criterionResultsJson ?? '[]') as unknown
    if (Array.isArray(parsed)) criterionResults = parsed.flatMap((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return []
      const item = row as Record<string, unknown>
      return typeof item.key === 'string' && typeof item.awarded === 'boolean' ? [{ key: item.key, awarded: item.awarded }] : []
    })
  }
  catch { /* persisted rows before feedback */ }
  try { misconceptionTags = JSON.parse(attempt.misconceptionTagsJson ?? '[]') } catch { /* persisted rows before feedback */ }
  try {
    const rubric = JSON.parse(attempt.rubricSnapshot ?? 'null') as { criteria?: Array<{ key?: unknown, description?: unknown }> } | null
    if (rubric?.criteria && Array.isArray(rubric.criteria)) criteria = rubric.criteria.flatMap(row => typeof row.key === 'string' ? [{ key: row.key, ...(typeof row.description === 'string' ? { description: row.description } : {}) }] : [])
  }
  catch { /* persisted rows before feedback */ }
  const allowed = new Set<string>(ADAPTIVE_MISCONCEPTION_TAGS)
  const safeTags = [...new Set(misconceptionTags.filter(tag => typeof tag === 'string' && allowed.has(tag)))].slice(0, MAX_MISCONCEPTIONS)
  try {
    return projectControlledFeedback({
      criteria: criteria.map(row => ({ key: row.key, label: row.description?.trim() || row.key })),
      outcomes: criterionResults,
      misconceptionTags: safeTags,
    })
  }
  catch {
    return { templateVersion: ADAPTIVE_FEEDBACK_TEMPLATE_VERSION, taxonomyVersion: ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION, criterionResults: [], misconceptionTags: [], misconceptionFeedback: [] }
  }
}

function feedback(attempt: Doc<'masteryAttempts'>): ControlledFeedbackProjection {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return legacyFeedback(attempt)
  let tags: unknown = []
  try {
    tags = attempt.feedbackTemplateVersion === ADAPTIVE_FEEDBACK_TEMPLATE_VERSION
      && attempt.misconceptionTaxonomyVersion === ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION && attempt.feedbackProjectionJson
      ? (JSON.parse(attempt.feedbackProjectionJson) as { misconceptionTags?: unknown }).misconceptionTags
      : JSON.parse(attempt.misconceptionTagsJson ?? '[]')
  } catch { /* legacy feedback may be unavailable */ }
  const allowed = new Set<string>(ADAPTIVE_MISCONCEPTION_TAGS)
  const safeTags = Array.isArray(tags) ? [...new Set(tags.filter((tag): tag is string => typeof tag === 'string' && allowed.has(tag)))].slice(0, MAX_MISCONCEPTIONS) : []
  return projectControlledFeedback({ criteria: [], outcomes: [], misconceptionTags: safeTags })
}

async function sessionScope(ctx: MutationCtx | QueryCtx, userId: string, sessionId: Id<'studySessions'>) {
  const session = await ctx.db.get(sessionId)
  if (!session || session.userId !== userId) throw new Error('Study session not found')
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  const root = plan && await ctx.db.get(plan.studyPlanId)
  const content = session.startedSessionContentId && await ctx.db.get(session.startedSessionContentId)
  const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId)
  const objective = await ctx.db.get(session.primaryObjectiveId)
  const voidRow = plan && await ctx.db.get(plan.learningVoidId)
  const folder = voidRow && await ctx.db.get(voidRow.folderId)
  if (!plan || !root || !content || !blueprint || !objective || !voidRow || !folder || plan.userId !== userId || root.userId !== userId || content.userId !== userId || blueprint.userId !== userId || objective.userId !== userId || voidRow.userId !== userId || folder.userId !== userId) throw new Error('Started session pin is unavailable')
  await requireActiveBlueprint(ctx, userId, voidRow, blueprint._id)
  if (root.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted' || plan.blueprintRecordRevision !== blueprint.recordRevision || objective.blueprintRevisionId !== blueprint._id
    || content.status !== 'published' || content.studySessionId !== session._id || content.blueprintRevisionId !== blueprint._id || content.objectiveId !== objective._id || content.studyPlanRevisionId !== plan._id
    || session.startedSessionContentRevision !== content.revision) throw new Error('Started session pin is no longer current')
  return { session, plan, root, content, blueprint, objective, voidRow }
}

async function adaptiveScoringAuthority(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  scope: Awaited<ReturnType<typeof sessionScope>>,
  admission: AdaptiveAdmissionContext,
  stagedInput?: { response: string, confidence: number },
) {
  if (!(await hasAdaptiveExperienceAccess(ctx, userId))) return { allowed: false as const, kind: 'denied' as const, code: 'adaptive_gate_unavailable' as const }
  const thread = await ctx.db.get(admission.threadId)
  const activity = await ctx.db.query('learningThreadActivities')
    .withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', admission.activityId))
    .unique()
  if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || !activity || activity.threadId !== thread._id
    || thread.currentActivityId !== activity._id || activity.activityClass !== 'factual'
    || thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== scope.voidRow._id
    || activity.evaluationContract.kind !== 'server_scored'
    || !['submitted', 'scoring', 'reconciling', 'feedback'].includes(activity.status)
    || activity.learningVoidId !== scope.voidRow._id || activity.blueprintRevisionId !== scope.blueprint._id
    || activity.objectiveId !== scope.objective._id || activity.sessionContentId !== scope.content._id) {
    return { allowed: false as const, kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const }
  }
  const pilot = adaptiveV2PilotDecision(admission.manifestVersion, {
    model: scope.content.providerModel?.trim() ?? '',
    now: Date.now(),
    activityContractVersion: activity.contractVersion,
    evaluationContractVersion: activity.evaluationContract.version,
    learnerHash: await digest(['adaptive-v2-pilot-cohort.v1', userId]),
  })
  if (!pilot.allowed) return { allowed: false as const, kind: 'blocked' as const, code: pilot.code }
  const { row: productGuardrail } = await productBudgetRow(ctx, 'guardrail', Date.now())
  if (productGuardrail && (!productLedgerValid(productGuardrail) || productGuardrail.rollbackLatched)) {
    return { allowed: false as const, kind: 'blocked' as const, code: 'adaptive_product_guardrail_review' as const }
  }
  if (stagedInput && (activity.submittedResponse !== stagedInput.response || activity.submittedConfidence !== stagedInput.confidence)) {
    return { allowed: false as const, kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const }
  }
  return { allowed: true as const, activity }
}

async function adaptiveLinkedReplayAuthority(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  admission: AdaptiveAdmissionContext,
  job: Doc<'learnJobs'>,
) {
  if (!(await hasAdaptiveExperienceAccess(ctx, userId))) return null
  const thread = await ctx.db.get(admission.threadId)
  const activity = await ctx.db.query('learningThreadActivities')
    .withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', admission.activityId))
    .unique()
  if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || !activity || activity.userId !== userId || activity.threadId !== thread._id
    || job.userId !== userId || job.adaptiveThreadId !== thread._id || job.adaptiveActivityId !== activity._id
    || (activity.scoringJobId && activity.scoringJobId !== job._id)) return null
  return activity
}

async function projectAdaptiveReconciliation(ctx: MutationCtx, job: Doc<'learnJobs'>) {
  if (!job.adaptiveActivityId || !job.adaptiveThreadId) return
  try {
    const [activity, thread] = await Promise.all([ctx.db.get(job.adaptiveActivityId), ctx.db.get(job.adaptiveThreadId)])
    if (!activity || !thread || activity.userId !== job.userId || activity.threadId !== job.adaptiveThreadId || thread.userId !== job.userId
      || thread.currentActivityId !== activity._id || activity.status === 'ended' || activity.status === 'replaced'
      || (activity.scoringJobId && activity.scoringJobId !== job._id)) return
    if (activity.status === 'reconciling' && activity.scoringJobId === job._id && activity.reconciliationReason === 'provider_outcome_requires_reconciliation') return
    await ctx.db.patch(activity._id, {
      status: 'reconciling',
      scoringJobId: job._id,
      reconciliationReason: 'provider_outcome_requires_reconciliation',
      ...(activity.submittedResponse ? { recoveryFeedback: { templateVersion: ADAPTIVE_FEEDBACK_TEMPLATE_VERSION, template: 'provider_unavailable' as const, message: renderControlledFeedbackTemplate('provider_unavailable') } } : {}),
      updatedAt: Date.now(),
    })
  }
  catch {
    // The V2 job is the authority. A stale/missing adaptive projection cannot
    // keep an ambiguous provider outcome running or cause it to be replayed.
  }
}

async function blockAmbiguousMasteryJob(ctx: MutationCtx, job: Doc<'learnJobs'>, now: number) {
  await settleAdaptiveProductReservation(ctx, job, true, now)
  await ctx.db.patch(job._id, {
    status: 'blocked',
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    checkpoint: undefined,
    terminalReason: 'provider_outcome_requires_reconciliation',
    revision: job.revision + 1,
    updatedAt: now,
  })
  await projectAdaptiveReconciliation(ctx, job)
  if (job.adaptiveActivityId && job.adaptiveThreadId) {
    const activity = await ctx.db.get(job.adaptiveActivityId)
    const thread = await ctx.db.get(job.adaptiveThreadId)
    if (activity && thread && activity.userId === job.userId && activity.threadId === thread._id && thread.userId === job.userId) {
      await writeLearnActivityEvent(ctx, {
        userId: job.userId,
        threadId: thread._id,
        activityId: activity._id,
        eventType: 'provider_ambiguity',
        eventVersion: 'provider_ambiguity.v1',
        sourceVersion: ADAPTIVE_V2_PILOT_MANIFEST.requestVersion,
        contractVersion: activity.contractVersion,
        semanticKey: `job:${String(job._id)}:provider_ambiguity`,
        occurredAt: now,
        reasonCode: 'provider_outcome_requires_reconciliation',
        outcomeCode: 'blocked',
        metadata: { providerStage: 'reconciliation' },
      })
    }
  }
}

async function projectAdaptiveFeedback(ctx: MutationCtx, job: Doc<'learnJobs'>, attemptId: Id<'masteryAttempts'>, projection: ControlledFeedbackProjection) {
  if (!job.adaptiveActivityId || !job.adaptiveThreadId) return
  const activity = await ctx.db.get(job.adaptiveActivityId)
  if (!activity || activity.userId !== job.userId || activity.threadId !== job.adaptiveThreadId || (activity.scoringJobId && activity.scoringJobId !== job._id)) throw new Error('Adaptive scoring projection is unavailable')
  if (activity.masteryAttemptId === attemptId && activity.scoringJobId === job._id
    && (!LEARN_MEASUREMENT_CAPABILITIES.responses || canonicalJson(activity.feedbackProjection ?? null) === canonicalJson(projection))) return
  await ctx.db.patch(activity._id, {
    status: 'feedback',
    scoringJobId: job._id,
    masteryAttemptId: attemptId,
    submittedResponse: undefined,
    submittedConfidence: undefined,
    reconciliationReason: undefined,
    recoveryFeedback: undefined,
    feedbackProjection: projection,
    updatedAt: Date.now(),
  })
}

async function emitAdaptiveAttemptEvents(ctx: MutationCtx, input: {
  job: Doc<'learnJobs'>
  attemptId: Id<'masteryAttempts'>
  now: number
  scorePercent: number
  kind: 'independent_application' | 'retained_transfer'
  assistanceLevel: 'none' | 'hint' | 'reveal'
  outcome: { previousState: string, state: string, remediation: boolean }
  scorerVersion: string
}) {
  if (!input.job.adaptiveActivityId || !input.job.adaptiveThreadId) return
  const [activity, thread] = await Promise.all([ctx.db.get(input.job.adaptiveActivityId), ctx.db.get(input.job.adaptiveThreadId)])
  if (!activity || !thread || activity.userId !== input.job.userId || activity.threadId !== thread._id || thread.userId !== input.job.userId) throw new Error('Adaptive attempt event authority is unavailable')
  if (thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== input.job.learningVoidId
    || activity.learningVoidId !== thread.learningVoidId) throw new Error('Adaptive attempt V2 anchor is unavailable')
  const common = {
    userId: input.job.userId,
    threadId: thread._id,
    activityId: activity._id,
    sourceVersion: input.scorerVersion,
    contractVersion: activity.contractVersion,
    occurredAt: input.now,
    metadata: {
      activityClass: activity.activityClass,
      boundaryOrdinal: activity.boundaryOrdinal,
      planRevision: activity.planRevision,
      assistanceLevel: input.assistanceLevel,
      attemptKind: input.kind,
      masteryState: input.outcome.state as 'unseen' | 'learning' | 'guided' | 'independent' | 'retained' | 'needs_review' | 'blocked' | 'provisionally_known',
    },
  }
  await writeLearnActivityEvent(ctx, { ...common, eventType: 'activity_completed', eventVersion: 'activity_completed.v1', semanticKey: `attempt:${String(input.attemptId)}:completed`, reasonCode: 'server_scored_attempt_committed', outcomeCode: 'completed' })
  const passed = input.scorePercent >= LEARN_V2_MASTERY_THRESHOLD
  await writeLearnActivityEvent(ctx, { ...common, eventType: passed ? 'representative_pass' : 'representative_fail', eventVersion: passed ? 'representative_pass.v1' : 'representative_fail.v1', semanticKey: `attempt:${String(input.attemptId)}:representative`, reasonCode: 'server_scored_outcome', outcomeCode: passed ? 'pass' : 'fail' })
  if (thread.currentActivityId === activity._id) {
    await ctx.db.patch(thread._id, {
      unresolvedPoint: passed && input.assistanceLevel === 'none' ? thread.unresolvedPoint?.slice(0, 240)
        : (thread.unresolvedPoint ?? thread.originalNeed).slice(0, 240),
      nextAction: representativeNextAction(passed, activity.activityId),
      revision: thread.revision + 1,
      updatedAt: input.now,
    })
  }
  if (input.kind === 'retained_transfer') {
    if (input.assistanceLevel === 'none') {
      await writeLearnActivityEvent(ctx, { ...common, eventType: 'delayed_check_eligible', eventVersion: 'delayed_check_eligible.v1', semanticKey: `attempt:${String(input.attemptId)}:delayed_eligible`, reasonCode: 'seven_calendar_days_elapsed', outcomeCode: 'eligible' })
    }
    await writeLearnActivityEvent(ctx, { ...common, eventType: 'delayed_check_attempt', eventVersion: 'delayed_check_attempt.v1', semanticKey: `attempt:${String(input.attemptId)}:delayed_attempt`, reasonCode: input.assistanceLevel === 'none' ? 'eligible_delayed_check_committed' : 'assisted_delayed_check_committed', outcomeCode: passed ? 'pass' : 'fail' })
  }
  if (input.outcome.state === 'retained' && input.outcome.previousState !== 'retained') {
    await writeLearnActivityEvent(ctx, { ...common, eventType: 'retained', eventVersion: 'retained.v1', semanticKey: `attempt:${String(input.attemptId)}:retained`, reasonCode: 'eligible_delayed_pass', outcomeCode: 'retained' })
  }
  if (input.outcome.remediation) {
    await writeLearnActivityEvent(ctx, { ...common, eventType: 'remediation', eventVersion: 'remediation.v1', semanticKey: `attempt:${String(input.attemptId)}:remediation`, reasonCode: 'failed_check', outcomeCode: 'needs_review' })
  }
}

async function emitAdaptiveMeaningfulResponse(ctx: MutationCtx, input: { userId: string, threadId: Id<'learningThreads'>, activity: Doc<'learningThreadActivities'>, jobId: Id<'learnJobs'>, occurredAt: number }) {
  await writeLearnActivityEvent(ctx, {
    userId: input.userId,
    threadId: input.threadId,
    activityId: input.activity._id,
    eventType: 'meaningful_response',
    eventVersion: 'meaningful_response.v1',
    sourceVersion: input.activity.evaluationContract.version,
    contractVersion: input.activity.contractVersion,
    semanticKey: `job:${String(input.jobId)}:meaningful_response`,
    occurredAt: input.occurredAt,
    reasonCode: 'server_scoring_reserved',
    outcomeCode: 'response_saved',
    metadata: { activityClass: input.activity.activityClass, boundaryOrdinal: input.activity.boundaryOrdinal, planRevision: input.activity.planRevision },
  })
}

async function linkedAdaptiveActivityForSession(ctx: MutationCtx, userId: string, sessionContentId: Id<'sessionContent'>) {
  return await findCurrentAdaptiveActivityForSessionContent(ctx, userId, sessionContentId)
}

async function masteryScoringLedger(args: AttemptRequest, adaptiveAdmission?: AdaptiveAdmissionContext) {
  const admissionPayload = JSON.stringify({ response: args.response, confidence: args.confidence })
  const requestDigest = await digest(admissionPayload)
  return {
    inputDigest: requestDigest,
    providerVersion: ADAPTIVE_V2_PILOT_MANIFEST.allowedProviders[0],
    providerPolicyVersion: ADAPTIVE_V2_PILOT_MANIFEST.policyVersion,
    providerRequestVersion: ADAPTIVE_V2_PILOT_MANIFEST.requestVersion,
    providerJobVersion: ADAPTIVE_V2_PILOT_MANIFEST.jobVersion,
    providerPayloadPolicyVersion: 'learn-v2.mastery-minimized-payload.v1',
    providerLogPolicyVersion: 'metadata-only-no-payload.v1',
    providerRetentionPolicyVersion: ADAPTIVE_V2_PILOT_MANIFEST.retention.provider,
    providerDeletionPolicyVersion: ADAPTIVE_V2_PILOT_MANIFEST.retention.local,
    providerTimeoutPolicyVersion: 'learn-v2.mastery-timeout.v1',
    providerQuotaPolicyVersion: ADAPTIVE_V2_PILOT_MANIFEST.quotaVersion,
    providerPilotManifestVersion: adaptiveAdmission?.manifestVersion,
    ...(adaptiveAdmission ? { providerProductPolicyVersion: PRODUCT_POLICY_VERSION, providerRollbackPolicyVersion: ROLLBACK_POLICY_VERSION } : {}),
    providerRequestDigest: requestDigest,
    providerRequestBytes: new TextEncoder().encode(admissionPayload).byteLength,
    providerMaxRequestBytes: ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes,
    providerMaxResponseBytes: ADAPTIVE_V2_PILOT_MANIFEST.limits.maxResponseBytes,
    providerMaxOutputTokens: ADAPTIVE_V2_PILOT_MANIFEST.limits.maxOutputTokens,
    providerTimeoutMs: ADAPTIVE_V2_PILOT_MANIFEST.limits.timeoutMs,
    providerCostCeilingUsd: ADAPTIVE_V2_PILOT_MANIFEST.limits.costCeilingUsdPerRequest,
  }
}

async function exactContentEvidence(ctx: MutationCtx | QueryCtx, userId: string, content: Doc<'sessionContent'>) {
  const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(33)
  if (!claims.length || claims.length > 32) throw new Error('Started session evidence is unavailable')
  const sourceIds = new Map<string, Id<'learnSourceSnapshots'>>()
  const verifierVersions = new Set<string>()
  const contentRevisionPins: Array<{
    claimId: string
    supportId: string
    sourceExcerptId: string
    sourceSnapshotId: string
    sourceRevisionNumber: number
    sourceRecordRevision: number
    sourceRevision: string | null
    excerptLocator: string
    verifierVersion: string
  }> = []
  const items: Array<{
    alias: string
    claim: string
    excerpt?: string
    folderEvidence?: { documentId: string, contentHash: string, sourceRevision: string }
  }> = []
  for (const claim of claims) {
    const supports = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
    if (!supports.length || supports.length > 8) throw new Error('Started session evidence is unavailable')
    for (const support of supports) {
      const excerpt = await ctx.db.get(support.sourceExcerptId)
      const sourceId = support.sourceSnapshotId ?? excerpt?.sourceSnapshotId
      const source = sourceId && await ctx.db.get(sourceId)
      if (!excerpt || excerpt.userId !== userId || excerpt.evidencePurgedAt !== undefined
        || !source || source.userId !== userId || source.evidencePurgedAt !== undefined || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted' || source.conflictStatus !== 'clear'
        || support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available' || !support.verifierVersion?.trim() || (support.confidence ?? 0) < 0.8) throw new Error('Started session evidence is unavailable')
      sourceIds.set(String(source._id), source._id)
      verifierVersions.add(support.verifierVersion)
      contentRevisionPins.push({ claimId: String(claim._id), supportId: String(support._id), sourceExcerptId: String(excerpt._id), sourceSnapshotId: String(source._id), sourceRevisionNumber: source.revision, sourceRecordRevision: source.recordRevision ?? 1, sourceRevision: source.sourceRevision ?? null, excerptLocator: excerpt.locator, verifierVersion: support.verifierVersion })
      const alias = `source-${String(items.length + 1).padStart(3, '0')}`
      if (source.rightsStatus === 'permitted' && excerpt.rightsStatus === 'permitted' && excerpt.excerpt?.trim()) {
        items.push({ alias, claim: claim.claim, excerpt: excerpt.excerpt })
        continue
      }
      const identity = await ctx.db.get(source.sourceIdentityId)
      if (!identity || identity.userId !== userId || identity.origin !== 'folder_document' || !identity.folderDocumentId
        || typeof source.contentHash !== 'string' || typeof source.sourceRevision !== 'string') throw new Error('Started session evidence is unavailable')
      items.push({ alias, claim: claim.claim, folderEvidence: { documentId: String(identity.folderDocumentId), contentHash: source.contentHash, sourceRevision: source.sourceRevision } })
    }
  }
  if (!sourceIds.size || sourceIds.size > MAX_SOURCES) throw new Error('Started session evidence scope is unavailable')
  return { sourceIds: [...sourceIds.keys()].sort(), sourceSnapshotIds: [...sourceIds.values()].sort((a, b) => String(a).localeCompare(String(b))), verifierVersions: [...verifierVersions].sort(), contentRevisionPins: contentRevisionPins.sort((a, b) => a.supportId.localeCompare(b.supportId)), items }
}

/** A fixed mid-morning local instant avoids DST gaps while preserving calendar-day semantics. */
function localDayAtNineUtcMs(localDate: string, timezone: string) {
  const [year, month, day] = localDate.split('-').map(Number)
  const targetUtc = Date.UTC(year!, month! - 1, day!, 9)
  // Offset at the target local day is converged from Intl rather than assuming 24h days.
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit' }).formatToParts(instant)
    const part = (kind: Intl.DateTimeFormatPartTypes) => Number(parts.find(row => row.type === kind)?.value)
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute')) - instant
  }
  let instant = targetUtc
  for (let index = 0; index < 2; index++) instant = targetUtc - offset(instant)
  return instant
}

async function createFollowUp(ctx: MutationCtx, input: { userId: string, scope: Pick<Awaited<ReturnType<typeof sessionScope>>, 'plan' | 'objective' | 'voidRow' | 'blueprint'>, testOnly?: boolean, attemptId: Id<'masteryAttempts'>, outcome: { state: string, remediation: boolean, setFirstIndependent: boolean }, now: number, timezone: string, firstIndependentLocalDate?: string, sourceIds: Id<'learnSourceSnapshots'>[] }) {
  const kind = input.outcome.remediation ? 'review' as const : input.outcome.state === 'guided' ? 'review' as const : input.outcome.setFirstIndependent ? 'retained_review' as const : null
  if (!kind) return null
  const plan = await requireLearnActiveWorkPlan(ctx, input.userId, input.scope.plan)
  const priority = input.outcome.remediation ? 'prerequisite_remediation' : input.outcome.state === 'guided' ? 'due_review' : 'overdue_retained_review'
  const date = kind === 'retained_review' && input.firstIndependentLocalDate ? addCalendarDays(input.firstIndependentLocalDate, 7) : undefined
  const scheduledStartAt = date ? Math.max(input.now, localDayAtNineUtcMs(date, input.timezone)) : input.now
  const durationMinutes = Math.max(15, Math.min(60, input.scope.objective.estimatedMinutes ?? 30))
  const sessionId = await ctx.db.insert('studySessions', { userId: input.userId, studyPlanRevisionId: plan._id, primaryObjectiveId: input.scope.objective._id, status: 'planned', revision: 1, scheduledStartAt, scheduledEndAt: scheduledStartAt + durationMinutes * 60_000, timezone: input.timezone, placementKind: kind, schedulingPriority: priority, schedulerVersion: 'learn-v2.mastery-followup.v1', auditReasonCode: `mastery_followup:${input.attemptId}`,
    ...(LEARN_MEASUREMENT_CAPABILITIES.responses ? { placementId: `mastery-followup:${input.attemptId}` } : {}) })
  if (kind === 'retained_review' && input.testOnly) return await resolveLearnRetainedShell(ctx, input.userId, sessionId, input.attemptId)
  const inputDigest = await digest({ attemptId: String(input.attemptId), planRevisionId: String(plan._id), sessionId: String(sessionId), objectiveId: String(input.scope.objective._id), sourceIds: input.sourceIds.map(String).sort() })
  const jobId = await ctx.db.insert('learnJobs', { userId: input.userId, learningVoidId: input.scope.voidRow._id, blueprintRevisionId: input.scope.blueprint._id, studyPlanRevisionId: plan._id, studySessionId: sessionId, type: FOLLOW_UP_JOB_TYPE, status: 'queued', revision: 1, idempotencyKey: `mastery-followup:${input.attemptId}`, requestFingerprint: inputDigest, inputDigest, expectedVoidRevision: input.scope.voidRow.revision, expectedBlueprintRecordRevision: input.scope.blueprint.recordRevision, expectedSessionRevision: 1, attempts: 0, dispatchSupportingSourceSnapshotIds: input.sourceIds, providerEnabled: process.env.LEARN_V2_SESSION_CONTENT_PROVIDER_ENABLED === 'true', providerModel: process.env.LEARN_V2_SESSION_CONTENT_MODEL?.trim() || undefined, providerPolicyVersion: 'learn-v2.session-content-provider.v1', createdAt: input.now, updatedAt: input.now })
  await ctx.scheduler.runAfter(0, internal.learnV2SessionContent.executeSessionContentGeneration, { tokenIdentifier: input.userId, jobId, expectedRevision: 1 })
  return { sessionId, scheduledStartAt }
}

const recordAssistanceUseTeaching = defineTeachingMutation({name:'learnV2Mastery.recordAssistanceUse',scope:async(ctx,userId,args)=>await teachingReadScope(ctx,userId,[{kind:'session',id:args.studySessionId}]),
  args: { studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), kind: v.union(v.literal('substantive_hint'), v.literal('answer_reveal')) },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2MutationAccess(ctx)
    const scope = await sessionScope(ctx, userId, args.studySessionId)
    if (LEARN_MEASUREMENT_CAPABILITIES.responses) {
      const assessments = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q => q.eq('userId', userId).eq('contextPins.studySessionId', scope.session._id)).take(3)
      if (assessments.length > 2 || assessments.some(row => !row.submissionId && ['retained_transfer', 'measurement_cold', 'measurement_delayed'].includes(row.purpose.kind))) throw new Error('Assessment assistance is unavailable before sealing')
    }
    const blockKind = args.kind === 'substantive_hint' ? 'faded_example' : 'worked_example'
    const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', scope.content._id)).take(16)
    const matches = blocks.filter(block => block.kind === blockKind && block.content?.trim())
    if (matches.length !== 1) throw new Error('Requested assistance is unavailable')
    const assistance = { kind: args.kind, content: matches[0]!.content! }
    const already = args.kind === 'substantive_hint' ? scope.session.substantiveHintUsedAt !== undefined : scope.session.answerRevealedAt !== undefined
    if (already) return { status: 'recorded' as const, revision: scope.session.revision, replayed: true, assistance }
    if (scope.session.status !== 'in_progress' || scope.session.revision !== args.expectedSessionRevision) throw new Error('Study session revision conflict')
    const now = Date.now()
    await ctx.db.patch(scope.session._id, {
      ...(args.kind === 'substantive_hint' ? { substantiveHintUsedAt: now } : { answerRevealedAt: now }),
      assistanceRevision: (scope.session.assistanceRevision ?? 0) + 1, revision: scope.session.revision + 1,
    })
    if (LEARN_MEASUREMENT_CAPABILITIES.responses) {
      const applications = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q => q.eq('userId', userId).eq('contextPins.studySessionId', scope.session._id)).take(3)
      for (const row of applications) {
        if (row.submissionId || row.purpose.kind !== 'independent_application' || row.contextPins.kind !== 'session') continue
        if (row.contextPins.sessionContentId !== scope.content._id || row.contextPins.sessionRevision !== scope.session.revision) throw new Error('Learn application revision conflict')
        await ctx.db.patch(row._id, { contextPins: { ...row.contextPins, sessionRevision: scope.session.revision + 1 }, revision: row.revision + 1 })
      }
    }
    const adaptive = await hasAdaptiveExperienceAccess(ctx, userId)
      ? await linkedAdaptiveActivityForSession(ctx, userId, scope.content._id)
      : null
    if (adaptive) await writeLearnActivityEvent(ctx, {
      userId,
      threadId: adaptive.thread._id,
      activityId: adaptive.activity._id,
      eventType: 'assistance',
      eventVersion: 'assistance.v1',
      sourceVersion: 'learn-v2.assistance.v1',
      contractVersion: adaptive.activity.contractVersion,
      semanticKey: `session:${String(scope.session._id)}:assistance:${args.kind}`,
      occurredAt: now,
      reasonCode: args.kind,
      outcomeCode: 'recorded',
      metadata: { activityClass: adaptive.activity.activityClass, boundaryOrdinal: adaptive.activity.boundaryOrdinal, planRevision: adaptive.activity.planRevision, assistanceLevel: args.kind === 'answer_reveal' ? 'reveal' : 'hint' },
    })
    return { status: 'recorded' as const, revision: scope.session.revision + 1, replayed: false, assistance }
  },
})
export const recordAssistanceUse = mutation(recordAssistanceUseTeaching)

export const beginMasteryScoring = internalMutation({
  args: {
    tokenIdentifier: v.string(), studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), expectedContentRevision: v.number(), expectedPlanRecordRevision: v.number(), expectedBlueprintRecordRevision: v.number(),
    response: v.string(), confidence: v.number(), idempotencyKey: v.string(),
    adaptiveAdmission: v.optional(v.object({ threadId: v.id('learningThreads'), activityId: v.string(), manifestVersion: v.string() })),
  },
  handler: async (ctx, args) => {
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) {
      if (args.adaptiveAdmission) return { kind: 'denied' as const, code: 'adaptive_gate_unavailable' as const, message: 'Adaptive Learn is unavailable.', retryable: false }
      throw new Error('Learn V2 access denied')
    }
    validateAttemptRequest(args)
    if (LEARN_MEASUREMENT_CAPABILITIES.responses && await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q => q.eq('userId', args.tokenIdentifier).eq('contextPins.studySessionId', args.studySessionId)).first()) throw new Error('Saved submission and verified execution receipt required')
    const fingerprints = await requestFingerprints(args)
    let scope: Awaited<ReturnType<typeof sessionScope>> | undefined
    let adaptiveActivity: Doc<'learningThreadActivities'> | undefined
    const attempt = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', args.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique()
    const existing = await ctx.db.query('learnJobs').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', args.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique()
    if (attempt) {
      if (!await fingerprintMatches(attempt.requestFingerprint, fingerprints)) throw new Error('Idempotency key was already used for a different request')
      if (args.adaptiveAdmission) {
        const activity = existing && await adaptiveLinkedReplayAuthority(ctx, args.tokenIdentifier, args.adaptiveAdmission, existing)
        if (!activity || !existing || existing.type !== SCORING_JOB_TYPE
          || (activity.masteryAttemptId && activity.masteryAttemptId !== attempt._id)) {
          return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const, message: 'Adaptive scoring is unavailable.', retryable: false }
        }
        await projectAdaptiveFeedback(ctx, existing, attempt._id, feedback(attempt))
      }
      const record = attempt.blueprintRevisionId ? (await getScopedMasteryRecord(ctx, args.tokenIdentifier, attempt.blueprintRevisionId, attempt.objectiveId)).record : null
      return { kind: 'replay' as const, attemptId: attempt._id, scorePercent: attempt.serverScorePercent, state: attempt.result, nextReviewAt: record?.lastAttemptId === attempt._id ? record.nextReviewAt ?? null : null, feedback: feedback(attempt) }
    }
    const now = Date.now()
    if (existing) {
      if (existing.type !== SCORING_JOB_TYPE || !await fingerprintMatches(existing.requestFingerprint, fingerprints)) throw new Error('Idempotency key was already used for a different request')
      if (args.adaptiveAdmission) {
        adaptiveActivity = await adaptiveLinkedReplayAuthority(ctx, args.tokenIdentifier, args.adaptiveAdmission, existing) ?? undefined
        if (!adaptiveActivity) return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const, message: 'Adaptive scoring is unavailable.', retryable: false }
      }
      if (existing.status === 'blocked') {
        await projectAdaptiveReconciliation(ctx, existing)
        return { kind: 'blocked' as const, code: 'provider_outcome_requires_reconciliation' as const, message: 'Scoring needs reconciliation. No mastery change was made.', retryable: false }
      }
      if (existing.status === 'running') {
        if ((existing.leaseExpiresAt ?? 0) > now) return { kind: 'pending' as const, status: 'in_progress' as const }
        await blockAmbiguousMasteryJob(ctx, existing, now)
        return { kind: 'blocked' as const, code: 'provider_outcome_requires_reconciliation' as const, message: 'Scoring needs reconciliation. No mastery change was made.', retryable: false }
      }
      if ((existing.status === 'leased' || existing.status === 'queued') && (existing.leaseExpiresAt ?? 0) > now) return { kind: 'pending' as const, status: 'in_progress' as const }
      // A public wrapper cannot downgrade a persisted adaptive scoring job by
      // omitting its admission context when acquiring a new dispatch lease.
      if (!args.adaptiveAdmission && (existing.adaptiveThreadId || existing.adaptiveActivityId
        || existing.providerPilotManifestVersion || existing.providerProductPolicyVersion || existing.providerRollbackPolicyVersion)) {
        return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const, message: 'Use the Adaptive Learn submission to continue this scoring request.', retryable: false }
      }
      scope ??= await sessionScope(ctx, args.tokenIdentifier, args.studySessionId)
      if (scope.session.status !== 'in_progress' || scope.session.revision !== args.expectedSessionRevision || scope.content.revision !== args.expectedContentRevision || scope.plan.recordRevision !== args.expectedPlanRecordRevision || scope.blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Started session revision conflict')
      if (args.adaptiveAdmission) {
        const authority = await adaptiveScoringAuthority(ctx, args.tokenIdentifier, scope, args.adaptiveAdmission, args)
        if (!authority.allowed) return { kind: authority.kind, code: authority.code, message: 'Adaptive scoring is unavailable.', retryable: false }
        if (authority.activity._id !== adaptiveActivity?._id) return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const, message: 'Adaptive scoring is unavailable.', retryable: false }
        const [runningJobs, leasedJobs] = await Promise.all([
          ctx.db.query('learnJobs').withIndex('by_userId_and_status_and_leaseExpiresAt', q => q.eq('userId', args.tokenIdentifier).eq('status', 'running').gt('leaseExpiresAt', now)).take(ADAPTIVE_V2_PILOT_MANIFEST.limits.maxConcurrentPerLearner + 1),
          ctx.db.query('learnJobs').withIndex('by_userId_and_status_and_leaseExpiresAt', q => q.eq('userId', args.tokenIdentifier).eq('status', 'leased').gt('leaseExpiresAt', now)).take(ADAPTIVE_V2_PILOT_MANIFEST.limits.maxConcurrentPerLearner + 1),
        ])
        if (runningJobs.length + leasedJobs.length >= ADAPTIVE_V2_PILOT_MANIFEST.limits.maxConcurrentPerLearner) return { kind: 'blocked' as const, code: 'adaptive_concurrency_cap', message: 'Adaptive scoring is at capacity.', retryable: true }
      }
      const leaseToken = crypto.randomUUID()
      await ctx.db.patch(existing._id, { ...await masteryScoringLedger(args, args.adaptiveAdmission), requestFingerprint: fingerprints.digest, status: 'leased', leaseToken, leaseExpiresAt: now + SCORING_LEASE_MS, checkpoint: 'reserved', terminalReason: undefined, revision: existing.revision + 1, updatedAt: now })
      if (adaptiveActivity) {
        await ctx.db.patch(adaptiveActivity._id, { status: 'scoring', scoringJobId: existing._id, submittedResponse: args.response, reconciliationReason: undefined, recoveryFeedback: undefined, updatedAt: now })
        await emitAdaptiveMeaningfulResponse(ctx, { userId: args.tokenIdentifier, threadId: args.adaptiveAdmission!.threadId, activity: adaptiveActivity, jobId: existing._id, occurredAt: now })
      }
      return { kind: 'acquired' as const, jobId: existing._id, leaseToken }
    }
    scope ??= await sessionScope(ctx, args.tokenIdentifier, args.studySessionId)
    if (scope.session.status !== 'in_progress' || scope.session.revision !== args.expectedSessionRevision || scope.content.revision !== args.expectedContentRevision || scope.plan.recordRevision !== args.expectedPlanRecordRevision || scope.blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Started session revision conflict')
    if (args.adaptiveAdmission) {
      const authority = await adaptiveScoringAuthority(ctx, args.tokenIdentifier, scope, args.adaptiveAdmission, args)
      if (!authority.allowed) return { kind: authority.kind, code: authority.code, message: authority.kind === 'denied' ? 'Adaptive scoring is unavailable.' : 'Adaptive pilot dispatch is not approved.', retryable: false }
      adaptiveActivity = authority.activity
      if (adaptiveActivity?.status !== 'submitted' || adaptiveActivity.scoringJobId || adaptiveActivity.masteryAttemptId) return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const, message: 'Adaptive scoring is unavailable.', retryable: false }
      const [runningJobs, leasedJobs] = await Promise.all([
        ctx.db.query('learnJobs').withIndex('by_userId_and_status_and_leaseExpiresAt', q => q.eq('userId', args.tokenIdentifier).eq('status', 'running').gt('leaseExpiresAt', now)).take(ADAPTIVE_V2_PILOT_MANIFEST.limits.maxConcurrentPerLearner + 1),
        ctx.db.query('learnJobs').withIndex('by_userId_and_status_and_leaseExpiresAt', q => q.eq('userId', args.tokenIdentifier).eq('status', 'leased').gt('leaseExpiresAt', now)).take(ADAPTIVE_V2_PILOT_MANIFEST.limits.maxConcurrentPerLearner + 1),
      ])
      if (runningJobs.length + leasedJobs.length >= ADAPTIVE_V2_PILOT_MANIFEST.limits.maxConcurrentPerLearner) return { kind: 'blocked' as const, code: 'adaptive_concurrency_cap', message: 'Adaptive scoring is at capacity.', retryable: true }
    }
    const leaseToken = crypto.randomUUID()
    const jobId = await ctx.db.insert('learnJobs', { userId: args.tokenIdentifier, learningVoidId: scope.voidRow._id, blueprintRevisionId: scope.blueprint._id, studyPlanRevisionId: scope.plan._id, studySessionId: scope.session._id, ...(adaptiveActivity && args.adaptiveAdmission ? { adaptiveThreadId: args.adaptiveAdmission.threadId, adaptiveActivityId: adaptiveActivity._id } : {}), type: SCORING_JOB_TYPE, status: 'leased', revision: 1, idempotencyKey: args.idempotencyKey, requestFingerprint: fingerprints.digest, ...await masteryScoringLedger(args, args.adaptiveAdmission), expectedBlueprintRecordRevision: args.expectedBlueprintRecordRevision, expectedSessionRevision: args.expectedSessionRevision, attempts: 0, providerModel: scope.content.providerModel, leaseToken, leaseExpiresAt: now + SCORING_LEASE_MS, checkpoint: 'reserved', createdAt: now, updatedAt: now })
    if (adaptiveActivity) {
      await ctx.db.patch(adaptiveActivity._id, { status: 'scoring', scoringJobId: jobId, submittedResponse: args.response, updatedAt: now })
      await emitAdaptiveMeaningfulResponse(ctx, { userId: args.tokenIdentifier, threadId: args.adaptiveAdmission!.threadId, activity: adaptiveActivity, jobId, occurredAt: now })
    }
    return { kind: 'acquired' as const, jobId, leaseToken }
  },
})

export const markMasteryScoringDispatched = internalMutation({
  args: { tokenIdentifier: v.string(), jobId: v.id('learnJobs'), leaseToken: v.string(), adaptiveAdmission: v.optional(v.object({ threadId: v.id('learningThreads'), activityId: v.string(), manifestVersion: v.string() })) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.tokenIdentifier || job.type !== SCORING_JOB_TYPE || job.status !== 'leased' || job.leaseToken !== args.leaseToken || (job.leaseExpiresAt ?? 0) <= Date.now()) throw new Error('Mastery scoring lease unavailable')
    if (!job.studySessionId || !job.blueprintRevisionId) throw new Error('Mastery scoring authority is unavailable')
    const scope = await sessionScope(ctx, args.tokenIdentifier, job.studySessionId)
    if (scope.blueprint._id !== job.blueprintRevisionId) throw new Error('Active Blueprint pointer is unavailable')
    if (!job.providerRequestDigest || !job.providerRequestBytes || !job.providerRequestVersion || !job.providerPolicyVersion || !job.providerJobVersion
      || !job.providerPayloadPolicyVersion || !job.providerLogPolicyVersion || !job.providerRetentionPolicyVersion || !job.providerDeletionPolicyVersion
      || !job.providerTimeoutPolicyVersion || !job.providerQuotaPolicyVersion || !job.providerMaxRequestBytes || !job.providerMaxResponseBytes
      || !job.providerMaxOutputTokens || !job.providerTimeoutMs || !job.providerCostCeilingUsd) {
      if (args.adaptiveAdmission) return { kind: 'blocked' as const, code: 'adaptive_request_ledger_unavailable', retryable: false }
      throw new Error('Mastery scoring request ledger is unavailable')
    }
    if ((job.attempts ?? 0) >= ADAPTIVE_V2_PILOT_MANIFEST.limits.maxDispatchAttemptsPerJob) {
      if (args.adaptiveAdmission) return { kind: 'blocked' as const, code: 'adaptive_dispatch_attempt_cap', retryable: false }
      throw new Error('Mastery scoring dispatch attempt cap reached')
    }
    if (args.adaptiveAdmission) {
      const authority = await adaptiveScoringAuthority(ctx, args.tokenIdentifier, scope, args.adaptiveAdmission)
      if (!authority.allowed) return { kind: authority.kind, code: authority.code, retryable: false }
      if (job.adaptiveThreadId !== args.adaptiveAdmission.threadId || job.adaptiveActivityId !== authority.activity._id || authority.activity.scoringJobId !== job._id) return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable' as const, retryable: false }
    }
    const now = Date.now()
    const windowStart = now - LEARN_V2_MASTERY_SCORING_ADMISSION.windowMs
    const recent = await ctx.db.query('learnMasteryScoringRateEvents')
      .withIndex('by_userId_and_createdAt', q => q.eq('userId', args.tokenIdentifier).gt('createdAt', windowStart))
      .take(LEARN_V2_MASTERY_SCORING_ADMISSION.maxProviderDispatches + 1)
    if (recent.length >= LEARN_V2_MASTERY_SCORING_ADMISSION.maxProviderDispatches) {
      const retryAfter = Math.max(1, recent[0]!.createdAt + LEARN_V2_MASTERY_SCORING_ADMISSION.windowMs - now)
      if (args.adaptiveAdmission) return { kind: 'blocked' as const, code: 'adaptive_hourly_quota', retryable: true, retryAfterMs: retryAfter }
      throw new Error(`Mastery scoring quota reached; retry after ${Math.ceil(retryAfter / 1000)} seconds`)
    }
    if (args.adaptiveAdmission) {
      const daily = await ctx.db.query('learnMasteryScoringRateEvents')
        .withIndex('by_userId_and_createdAt', q => q.eq('userId', args.tokenIdentifier).gt('createdAt', now - ADAPTIVE_V2_PILOT_MANIFEST.limits.dailyQuotaWindowMs))
        .take(ADAPTIVE_V2_PILOT_MANIFEST.limits.maxProviderDispatchesPerDay + 1)
      if (daily.length >= ADAPTIVE_V2_PILOT_MANIFEST.limits.maxProviderDispatchesPerDay) return { kind: 'blocked' as const, code: 'adaptive_daily_quota', retryable: true }
      const productAdmission = await admitAdaptiveProductDispatch(ctx, job, true)
      if (productAdmission.kind !== 'allowed') return productAdmission
    }
    await ctx.db.insert('learnMasteryScoringRateEvents', { userId: args.tokenIdentifier, jobId: job._id, createdAt: now, expiresAt: now + SCORING_RATE_EVENT_RETENTION_MS })
    await ctx.db.patch(job._id, { status: 'running', checkpoint: 'provider_dispatched', attempts: (job.attempts ?? 0) + 1, revision: job.revision + 1, updatedAt: now })
    return args.adaptiveAdmission ? { kind: 'allowed' as const } : null
  },
})

export const authorizeMasteryScoringIo = internalMutation({
  args: {
    tokenIdentifier: v.string(), jobId: v.id('learnJobs'), leaseToken: v.string(),
    stage: v.union(v.literal('evidence_retrieval'), v.literal('provider_dispatch')),
    adaptiveAdmission: v.optional(v.object({ threadId: v.id('learningThreads'), activityId: v.string(), manifestVersion: v.string() })),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.tokenIdentifier || job.type !== SCORING_JOB_TYPE || job.status !== 'leased' || job.leaseToken !== args.leaseToken || (job.leaseExpiresAt ?? 0) <= Date.now()) throw new Error('Mastery scoring lease unavailable')
    if (!args.adaptiveAdmission) return { kind: 'allowed' as const }
    if (!job.studySessionId || job.providerPilotManifestVersion !== args.adaptiveAdmission.manifestVersion) return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable', retryable: false }
    const scope = await sessionScope(ctx, args.tokenIdentifier, job.studySessionId)
    const authority = await adaptiveScoringAuthority(ctx, args.tokenIdentifier, scope, args.adaptiveAdmission)
    if (!authority.allowed) return { kind: authority.kind, code: authority.code, retryable: false }
    if (job.adaptiveThreadId !== args.adaptiveAdmission.threadId || job.adaptiveActivityId !== authority.activity._id || authority.activity.scoringJobId !== job._id) return { kind: 'denied' as const, code: 'adaptive_activity_authority_unavailable', retryable: false }
    const productAdmission = await admitAdaptiveProductDispatch(ctx, job, false)
    if (productAdmission.kind !== 'allowed') return productAdmission
    await ctx.db.patch(job._id, { checkpoint: `authorized:${args.stage}`, revision: job.revision + 1, updatedAt: Date.now() })
    return { kind: 'allowed' as const }
  },
})

export const recordMasteryScoringPayload = internalMutation({
  args: { tokenIdentifier: v.string(), jobId: v.id('learnJobs'), leaseToken: v.string(), requestDigest: v.string(), requestBytes: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.tokenIdentifier || job.type !== SCORING_JOB_TYPE || job.status !== 'leased' || job.leaseToken !== args.leaseToken) throw new Error('Mastery scoring lease unavailable')
    if (!/^sha256:[a-f0-9]{64}$/.test(args.requestDigest) || !Number.isSafeInteger(args.requestBytes) || args.requestBytes < 1 || args.requestBytes > (job.providerMaxRequestBytes ?? 0)) throw new Error('Mastery scoring payload is invalid')
    await ctx.db.patch(job._id, { providerRequestDigest: args.requestDigest, providerRequestBytes: args.requestBytes, checkpoint: 'payload_recorded', revision: job.revision + 1, updatedAt: Date.now() })
    return { kind: 'recorded' as const }
  },
})

/**
 * A provider call is only safe to retry before dispatch. Once a job reached
 * running, a provider may have accepted it even if this worker lost the reply.
 */
export const recoverExpiredMasteryScoringJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let recovered = 0
    let blocked = 0
    for (const status of ['leased', 'running'] as const) {
      const jobs = await ctx.db.query('learnJobs')
        .withIndex('by_type_and_status_and_leaseExpiresAt', q => q.eq('type', SCORING_JOB_TYPE).eq('status', status).lte('leaseExpiresAt', now))
        .take(SCORING_RECOVERY_BATCH - recovered - blocked)
      for (const job of jobs) {
        if (status === 'running') {
          blocked += 1
          await blockAmbiguousMasteryJob(ctx, job, now)
        }
        else {
          recovered += 1
          await ctx.db.patch(job._id, { status: 'queued', leaseToken: undefined, leaseExpiresAt: undefined, checkpoint: undefined, terminalReason: 'provider_not_dispatched', revision: job.revision + 1, updatedAt: now })
        }
      }
      if (recovered + blocked >= SCORING_RECOVERY_BATCH) break
    }
    if (recovered + blocked >= SCORING_RECOVERY_BATCH) await ctx.scheduler.runAfter(0, internal.learnV2Mastery.recoverExpiredMasteryScoringJobs, {})
    return { recovered, blocked }
  },
})

export const cleanupExpiredMasteryScoringRateEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('learnMasteryScoringRateEvents')
      .withIndex('by_expiresAt', q => q.lte('expiresAt', Date.now()))
      .take(RATE_EVENT_CLEANUP_BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    const productRows = await ctx.db.query('learnAdaptiveProviderBudgets')
      .withIndex('by_expiresAt', q => q.gt('expiresAt', 0).lte('expiresAt', Date.now()))
      .take(RATE_EVENT_CLEANUP_BATCH)
    for (const row of productRows) await ctx.db.delete(row._id)
    if (productRows.length >= RATE_EVENT_CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.learnV2Mastery.cleanupExpiredMasteryScoringRateEvents, {})
    if (rows.length >= RATE_EVENT_CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.learnV2Mastery.cleanupExpiredMasteryScoringRateEvents, {})
    return { deleted: rows.length }
  },
})

export const finishMasteryScoringFailure = internalMutation({
  args: { tokenIdentifier: v.string(), jobId: v.id('learnJobs'), leaseToken: v.string(), outcome: v.union(v.literal('not_dispatched'), v.literal('definitive_failure'), v.literal('ambiguous')) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.tokenIdentifier || job.type !== SCORING_JOB_TYPE || job.leaseToken !== args.leaseToken || (job.status !== 'leased' && job.status !== 'running')) return
    if (args.outcome === 'ambiguous') {
      await blockAmbiguousMasteryJob(ctx, job, Date.now())
      return
    }
    const now = Date.now()
    const definitive = args.outcome === 'definitive_failure'
    await settleAdaptiveProductReservation(ctx, job, false, now)
    await ctx.db.patch(job._id, { status: 'queued', leaseToken: undefined, leaseExpiresAt: undefined, checkpoint: undefined, terminalReason: definitive ? 'provider_definitive_failure' : 'provider_not_dispatched', revision: job.revision + 1, updatedAt: now })
    if (job.adaptiveActivityId && job.adaptiveThreadId) {
      const [activity, thread] = await Promise.all([ctx.db.get(job.adaptiveActivityId), ctx.db.get(job.adaptiveThreadId)])
      if (activity && thread && activity.userId === job.userId && activity.threadId === thread._id && thread.userId === job.userId) await writeLearnActivityEvent(ctx, {
        userId: job.userId,
        threadId: thread._id,
        activityId: activity._id,
        eventType: 'provider_failure',
        eventVersion: 'provider_failure.v1',
        sourceVersion: ADAPTIVE_V2_PILOT_MANIFEST.requestVersion,
        contractVersion: activity.contractVersion,
        semanticKey: `job:${String(job._id)}:provider_failure:${job.revision + 1}`,
        occurredAt: now,
        reasonCode: definitive ? 'provider_definitive_failure' : 'provider_not_dispatched',
        outcomeCode: 'queued',
        metadata: { providerStage: definitive ? 'outcome' : 'reservation' },
      })
    }
  },
})

export const getMasteryScoringInput = internalQuery({
  args: {
    tokenIdentifier: v.string(), studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), expectedContentRevision: v.number(), expectedPlanRecordRevision: v.number(), expectedBlueprintRecordRevision: v.number(),
    response: v.string(), confidence: v.number(), idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) throw new Error('Learn V2 access denied')
    validateAttemptRequest(args)
    if (LEARN_MEASUREMENT_CAPABILITIES.responses && await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q => q.eq('userId', args.tokenIdentifier).eq('contextPins.studySessionId', args.studySessionId)).first()) throw new Error('Saved submission and verified execution receipt required')
    const fingerprints = await requestFingerprints(args)
    const prior = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', args.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique()
    if (prior) {
      if (!await fingerprintMatches(prior.requestFingerprint, fingerprints)) throw new Error('Idempotency key was already used for a different request')
      const record = prior.blueprintRevisionId ? (await getScopedMasteryRecord(ctx, args.tokenIdentifier, prior.blueprintRevisionId, prior.objectiveId)).record : null
      return { kind: 'replay' as const, attemptId: prior._id, scorePercent: prior.serverScorePercent, state: prior.result, nextReviewAt: record?.lastAttemptId === prior._id ? record.nextReviewAt ?? null : null, feedback: feedback(prior) }
    }
    const scope = await sessionScope(ctx, args.tokenIdentifier, args.studySessionId)
    if (scope.session.status !== 'in_progress' || scope.session.revision !== args.expectedSessionRevision || scope.content.revision !== args.expectedContentRevision || scope.plan.recordRevision !== args.expectedPlanRecordRevision || scope.blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Started session revision conflict')
    const rubric = JSON.parse(scope.content.assessmentRubricSnapshot ?? 'null') as { version: string, criteria: Array<{ key: string, description?: string, weightPercent: number }> } | null
    if (!rubric || rubric.version !== 'learn-v2.assessment.v1' || canonicalJson(rubric) !== canonicalJson(scope.objective.assessmentContract)) throw new Error('Started session rubric is unavailable')
    const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', args.tokenIdentifier).eq('sessionContentId', scope.content._id)).take(16)
    const challenges = blocks.filter(block => block.kind === 'independent_application' && block.content?.trim())
    if (challenges.length !== 1) throw new Error('Independent application is unavailable')
    const evidence = await exactContentEvidence(ctx, args.tokenIdentifier, scope.content)
    if (!scope.content.providerModel?.trim()) throw new Error('Mastery scorer is unavailable')
    return { kind: 'score' as const, model: scope.content.providerModel, rubric, challenge: challenges[0]!.content!, evidence: evidence.items, sourceSnapshotIds: evidence.sourceSnapshotIds, contentRevisionPins: evidence.contentRevisionPins, verifierVersions: evidence.verifierVersions }
  },
})

type ProviderAdmissionMetadata = { version: 'adaptive-v2-provider-admission.v1', stage: 'reservation' | 'provider_dispatch', productPolicyVersion: typeof PRODUCT_POLICY_VERSION, rollbackPolicyVersion: typeof ROLLBACK_POLICY_VERSION, retryAfterMs?: number }
function providerAdmissionMetadata(stage: ProviderAdmissionMetadata['stage'], retryAfterMs?: number): ProviderAdmissionMetadata {
  return { version: 'adaptive-v2-provider-admission.v1', stage, productPolicyVersion: PRODUCT_POLICY_VERSION, rollbackPolicyVersion: ROLLBACK_POLICY_VERSION,
    ...(retryAfterMs !== undefined && Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0 && retryAfterMs <= 86_400_000 ? { retryAfterMs } : {}) }
}
export type MasteryAttemptActionResult = { status: 'completed', attemptId: Id<'masteryAttempts'>, scorePercent?: number, state?: string, nextReviewAt?: number | null, feedback?: ControlledFeedbackProjection, replayed: boolean }
  | { status: 'in_progress', replayed: false }
  | { status: 'denied' | 'blocked' | 'invalid', code: string, message: string, retryable: boolean, admission?: ProviderAdmissionMetadata }

const controlledFeedbackValidator = v.object({
  templateVersion: v.literal(ADAPTIVE_FEEDBACK_TEMPLATE_VERSION), taxonomyVersion: v.literal(ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION),
  criterionResults: v.array(v.object({ key: v.string(), label: v.string(), awarded: v.boolean(),
    template: v.union(v.literal('criterion_met'), v.literal('criterion_not_met')), message: v.string() })),
  misconceptionTags: v.array(v.union(...ADAPTIVE_MISCONCEPTION_TAGS.map(tag => v.literal(tag)))),
  misconceptionFeedback: v.array(v.object({ tag: v.union(...ADAPTIVE_MISCONCEPTION_TAGS.map(tag => v.literal(tag))),
    template: v.union(v.literal('evidence_insufficient'), v.literal('response_incomplete')), message: v.string() })),
})
export const masteryAttemptReturnValidator = v.union(
  v.object({ status: v.literal('completed'), attemptId: v.id('masteryAttempts'), scorePercent: v.optional(v.number()), state: v.optional(v.string()),
    nextReviewAt: v.optional(v.union(v.number(), v.null())), feedback: v.optional(controlledFeedbackValidator), replayed: v.boolean() }),
  v.object({ status: v.literal('in_progress'), replayed: v.literal(false) }),
  v.object({ status: v.union(v.literal('denied'), v.literal('blocked'), v.literal('invalid')), code: v.string(), message: v.string(), retryable: v.boolean(),
    admission: v.optional(v.object({ version: v.literal('adaptive-v2-provider-admission.v1'), stage: v.union(v.literal('reservation'), v.literal('provider_dispatch')),
      productPolicyVersion: v.literal(PRODUCT_POLICY_VERSION), rollbackPolicyVersion: v.literal(ROLLBACK_POLICY_VERSION), retryAfterMs: v.optional(v.number()) })) }),
)

/** One orchestration helper owns reservation, evidence loading, provider I/O, and commit for both public wrappers. */
export async function submitMasteryAttemptForOwner(
  ctx: ActionCtx,
  tokenIdentifier: string,
  args: MasteryAttemptRequest,
  adaptiveAdmission?: AdaptiveAdmissionContext,
): Promise<MasteryAttemptActionResult> {
    if (LEARN_MEASUREMENT_CAPABILITIES.scoring) {
      const accepted = await ctx.runMutation(internal.learnV2Mastery.acceptCompatibilityMasterySubmission, { tokenIdentifier, ...args,
        ...(adaptiveAdmission ? { adaptiveAdmission } : {}) })
      if (accepted.kind !== 'accepted') return { status: 'invalid', code: accepted.reasonCode, message: 'The response could not be accepted.', retryable: false }
      const result = await scoreMasterySubmissionForOwner(ctx, tokenIdentifier, { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: accepted.submissionId,
        idempotencyKey: (await privacyDigest(args.idempotencyKey)).slice(7) })
      if (result.status !== 'scored') return { status: 'blocked', code: result.status, message: 'Scoring is pending.', retryable: result.status === 'retryable_failure' }
      const outcome = await ctx.runQuery(internal.learnV2Mastery.getSealedMasteryAttemptOutcome, { tokenIdentifier, attemptId: result.result.attemptId })
      return { status: 'completed', ...outcome, scorePercent: result.result.scorePercent, replayed: accepted.replayed }
    }
    if (adaptiveAdmission) {
      const gate: { allowed: boolean } = await ctx.runQuery(internal.lib.adaptiveLearnAccess.checkAdaptiveJobAdmission, { tokenIdentifier })
      if (!gate.allowed) return { status: 'denied', code: 'adaptive_gate_unavailable', message: 'Adaptive Learn is unavailable.', retryable: false }
    }
    const reservation = await ctx.runMutation(internal.learnV2Mastery.beginMasteryScoring, { tokenIdentifier, ...args, ...(adaptiveAdmission ? { adaptiveAdmission } : {}) })
    if (reservation.kind === 'denied' || reservation.kind === 'blocked') return { status: reservation.kind, code: reservation.code, message: reservation.message, retryable: reservation.retryable,
      ...(adaptiveAdmission ? { admission: providerAdmissionMetadata('reservation') } : {}) }
    if (reservation.kind === 'replay') return { status: 'completed', attemptId: reservation.attemptId, scorePercent: reservation.scorePercent, state: reservation.state, nextReviewAt: reservation.nextReviewAt, feedback: reservation.feedback, replayed: true }
    if (reservation.kind === 'pending') {
      return { status: 'in_progress', replayed: false }
    }
    const jobId = reservation.jobId
    const leaseToken = reservation.leaseToken
    if (!jobId || !leaseToken) throw new Error('Mastery scoring reservation is unavailable')
    const loadInput = () => ctx.runQuery(internal.learnV2Mastery.getMasteryScoringInput, { tokenIdentifier, ...args })
    let input: Awaited<ReturnType<typeof loadInput>>
    try { input = await loadInput() }
    catch (error) {
      await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
      throw error
    }
    if (input.kind === 'replay') return { status: 'completed', attemptId: input.attemptId, scorePercent: input.scorePercent, state: input.state, nextReviewAt: input.nextReviewAt, feedback: input.feedback, replayed: true }
    let scoringEvidence = input.evidence
    const folderSources = scoringEvidence.flatMap(item => item.folderEvidence ? [{ alias: item.alias, ...item.folderEvidence }] : [])
    if (folderSources.length > 0) {
      if (adaptiveAdmission) {
        await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
        return { status: 'blocked', code: 'adaptive_private_retrieval_not_approved', message: 'This activity needs protected retrieval that is not approved for the pilot.', retryable: false }
      }
      const io = await ctx.runMutation(internal.learnV2Mastery.authorizeMasteryScoringIo, { tokenIdentifier, jobId, leaseToken, stage: 'evidence_retrieval' })
      if (io.kind !== 'allowed') return { status: io.kind, code: io.code, message: 'Scoring is unavailable.', retryable: io.retryable }
      try {
        const retrieved = await retrieveLearnV2FolderEvidence({ query: input.challenge, userId: tokenIdentifier, sources: folderSources })
        scoringEvidence = scoringEvidence.map(item => item.excerpt?.trim() ? item : { ...item, excerpt: retrieved.get(item.alias) })
      }
      catch (error) {
        await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
        throw new Error('Started session evidence is unavailable', { cause: error })
      }
    }
    if (scoringEvidence.some(item => !item.excerpt?.trim())) {
      await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
      throw new Error('Started session evidence is unavailable')
    }
    const payloadDecision = validateAdaptiveProviderPayload({
      learnerResponse: args.response,
      challenge: input.challenge,
      evidence: scoringEvidence.map(item => `${item.alias}: ${item.claim}\n${item.excerpt ?? ''}`),
      rubric: input.rubric.criteria.map(row => `${row.key}: ${row.description ?? ''}`),
    })
    if (!payloadDecision.allowed) {
      await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
      if (adaptiveAdmission) return { status: 'invalid', code: payloadDecision.code, message: 'The response cannot be sent under the pilot privacy policy.', retryable: false }
      throw new Error('Mastery scoring payload is invalid')
    }
    const providerPayloadJson = buildBaselineMasteryScoringPayload({ rubric: input.rubric, challenge: input.challenge, evidence: scoringEvidence, learnerResponse: args.response })
    const providerPayloadBytes = new TextEncoder().encode(providerPayloadJson).byteLength
    if (providerPayloadBytes > ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes) {
      await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
      return { status: 'blocked', code: 'provider_request_cap', message: 'The scoring request exceeds the finite pilot cap.', retryable: false }
    }
    await ctx.runMutation(internal.learnV2Mastery.recordMasteryScoringPayload, { tokenIdentifier, jobId, leaseToken, requestDigest: await digest(providerPayloadJson), requestBytes: providerPayloadBytes })
    if (adaptiveAdmission) {
      const io = await ctx.runMutation(internal.learnV2Mastery.authorizeMasteryScoringIo, { tokenIdentifier, jobId, leaseToken, stage: 'provider_dispatch', adaptiveAdmission })
      if (io.kind !== 'allowed') {
        await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
        return { status: io.kind, code: io.code, message: 'Adaptive scoring is unavailable.', retryable: io.retryable,
          admission: providerAdmissionMetadata('provider_dispatch', 'retryAfterMs' in io ? io.retryAfterMs : undefined) }
      }
    }
    try {
      const dispatch = await ctx.runMutation(internal.learnV2Mastery.markMasteryScoringDispatched, { tokenIdentifier, jobId, leaseToken, ...(adaptiveAdmission ? { adaptiveAdmission } : {}) })
      if (adaptiveAdmission && dispatch?.kind !== 'allowed') {
        await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
        if (!dispatch) throw new Error('Adaptive scoring admission is unavailable')
        return { status: dispatch.kind, code: dispatch.code, message: 'Adaptive scoring is temporarily unavailable.', retryable: dispatch.retryable,
          admission: providerAdmissionMetadata('provider_dispatch', 'retryAfterMs' in dispatch ? dispatch.retryAfterMs : undefined) }
      }
    }
    catch (error) {
      // Admission happens before the provider boundary. A quota refusal is
      // definitive non-dispatch and must remain retryable when its window ends.
      await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: 'not_dispatched' })
      throw error
    }
    try {
      const completion = await generateCompletion(buildBaselineMasteryScoringRequest(input.model, providerPayloadJson, AbortSignal.timeout(ADAPTIVE_V2_PILOT_MANIFEST.limits.timeoutMs)))
      const result = parseBaselineMasteryScoringResponse(completion.choices[0]!.message.content)
      const recorded = await ctx.runMutation(internal.learnV2Mastery.recordMasteryAttempt, {
        tokenIdentifier, ...args, scoringJobId: jobId, scoringLeaseToken: leaseToken, providerResponseId: completion.id,
        scoredSourceSnapshotIds: input.sourceSnapshotIds, scoredContentRevisionPins: input.contentRevisionPins,
        scorerVerdict: { scorerVersion: LEARN_V2_MASTERY_SCORER_VERSION, criterionResults: result.criterionResults, misconceptionTags: result.misconceptionTags, verifierVersions: input.verifierVersions },
      })
      return { status: 'completed', ...recorded }
    }
    catch (error) {
      const failure = classifyAiGatewayFailure(error)
      await ctx.runMutation(internal.learnV2Mastery.finishMasteryScoringFailure, { tokenIdentifier, jobId, leaseToken, outcome: failure === 'not_dispatched' ? 'not_dispatched' : failure === 'definitive_failure' ? 'definitive_failure' : 'ambiguous' })
      if (adaptiveAdmission && failure !== 'not_dispatched' && failure !== 'definitive_failure') return { status: 'blocked', code: 'provider_outcome_requires_reconciliation', message: 'Scoring needs reconciliation. No mastery change was made.', retryable: false }
      throw error
    }
}

export const masteryAttemptArgs = {
  studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), expectedContentRevision: v.number(), expectedPlanRecordRevision: v.number(), expectedBlueprintRecordRevision: v.number(),
  response: v.string(), confidence: v.number(), idempotencyKey: v.string(),
}

export async function acceptMasterySubmissionForOwner(
  ctx: MutationCtx, tokenIdentifier: string, input: LearnV2AcceptMasterySubmission,
): Promise<LearnResponseReceipt> {
  const request = parsePublicLearnRequest(acceptMasterySubmissionSchema, input)
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return await acceptResponseForOwner(ctx, tokenIdentifier, request.submission)
  ctx = measurementReadContext(ctx, tokenIdentifier)
  const entry = 'response' in request.submission ? request.submission.response : request.submission.application
  const target = 'assessmentOpportunityId' in entry.target ? await ctx.db.get(entry.target.assessmentOpportunityId) : null
  const existed = target?.submissionId !== undefined
  const receipt = await acceptResponseForOwner(ctx, tokenIdentifier, request.submission)
  if (receipt.kind !== 'accepted') return receipt
  const response = await ctx.db.get(receipt.submissionId)
  if (!response || response.scopeKind !== 'v2' || !('assessmentOpportunityId' in response)) throw new Error('Learn submission unavailable')
  const opportunity = (await ctx.db.get(response.assessmentOpportunityId))!
  if (existed && !response.masteryAtAcceptance) return receipt
  if (!response.masteryAtAcceptance) {
    const { record } = await getScopedMasteryRecord(ctx, tokenIdentifier, response.blueprintRevisionId, response.objectiveId)
    const session = response.contextPins.kind === 'session' ? await ctx.db.get(response.contextPins.studySessionId) : null
    const revision = response.contextPins.kind !== 'calibration' ? await ctx.db.get(response.contextPins.studyPlanRevisionId) : null
    const performanceTimezone = learnTimezoneSchema.parse('clock' in opportunity.purpose
      ? record?.firstIndependentTimezone ?? opportunity.purpose.clock.timezone : session?.timezone ?? revision?.timezone ?? 'UTC')
    await ctx.db.patch(response._id, { masteryAtAcceptance: { performanceTimezone, opportunityRevision: ('response' in request.submission ? request.submission.response : request.submission.application).expectedRevision, state: record?.state ?? 'unseen', recordRevision: record?.recordRevision ?? 0,
      firstIndependentLocalDate: record?.firstIndependentLocalDate ?? null, firstIndependentTimezone: record?.firstIndependentTimezone ?? null } })
  }
  const protocol = getFrozenLearnMeasurementProtocol()
  if (!response.masteryAtAcceptance && !opportunity.assignmentId && protocol) await writeLearnResponseAcceptanceFact(ctx, tokenIdentifier, response, protocol.epoch)
  if ('clock' in opportunity.purpose) await writeLearnMeasurementEvent(ctx, tokenIdentifier, {
    taxonomyVersion: LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION, eventType: 'delayed_check_attempt', eventVersion: 'delayed_check_attempt.v2',
    sourceVersion: 'learn-v2.sealed-scoring.v1', contractVersion: opportunity.eligibilityPolicyVersion, occurredAt: response.acceptedAt,
    learningVoidId: response.learningVoidId, blueprintRevisionId: response.blueprintRevisionId, objectiveId: response.objectiveId,
    assessmentOpportunityId: opportunity._id, submissionId: response._id, horizonDays: opportunity.purpose.clock.horizonDays,
    measurementEligible: response.validitySnapshot.measurementEligible, masteryEligible: response.validitySnapshot.masteryEligible,
    metadata: { masteryState: response.masteryAtAcceptance?.state ?? (await getScopedMasteryRecord(ctx, tokenIdentifier, response.blueprintRevisionId, response.objectiveId)).record?.state ?? 'unseen' },
    ...(response.contextPins.kind === 'session' && response.contextPins.canvas ? { threadId: response.contextPins.canvas.threadId, activityId: response.contextPins.canvas.activityId } : {}),
  })
  if (opportunity.assignmentId && protocol) {
    const assignment = await ctx.db.get(opportunity.assignmentId)
    if (assignment?.status === 'admitted') await materializeLearnMeasurementAssignment(ctx, assignment, protocol, Date.now())
  }
  return receipt
}

export const acceptMasterySubmission = mutation({
  args: acceptMasterySubmissionArgs, returns: responseReceiptValidator,
  handler: async (ctx, args) => await acceptMasterySubmissionForOwner(ctx, await requireAuth(ctx), args),
})

export const getMasterySubmissionScoringState = internalQuery({
  args: scoreMasterySubmissionArgs, returns: scoreMasterySubmissionValidator,
  handler: async (ctx, args): Promise<LearnV2SubmissionScore> => {
    const request = parsePublicLearnRequest(scoreMasterySubmissionSchema, args)
    await requireOwnedSubmission(ctx, request.submissionId)
    return await readSavedLearnScoringState(ctx, await requireAuth(ctx), request.submissionId)
  },
})

export async function scoreMasterySubmissionForOwner(
  ctx: ActionCtx, tokenIdentifier: string, args: LearnV2ScoreMasterySubmission,
): Promise<LearnV2SubmissionScore> {
  if (await requireAuth(ctx) !== tokenIdentifier) throw new Error('Learn access denied')
  const request = parsePublicLearnRequest(scoreMasterySubmissionSchema, args)
  const reservation = await ctx.runMutation(internal.learnV2Mastery.beginSealedMasteryScoring, { tokenIdentifier, submissionId: request.submissionId })
  if (reservation.kind === 'receipt') {
    await ctx.runMutation(internal.learnV2Mastery.commitSealedMasteryAttempt, { tokenIdentifier, submissionId: request.submissionId, executionId: reservation.executionId })
  } else if (reservation.kind === 'acquired') {
    try {
      const input = await ctx.runQuery(internal.learnV2Mastery.getSealedMasteryScoringInput, { tokenIdentifier, submissionId: request.submissionId })
      const context = { dispatchedAt: Date.now(), dispatchOrdinal: (input.job.attempts ?? 0) + 1, leaseIdentityHash: await privacyDigest(reservation.leaseToken) }
      if (input.response.scoringBinding.kind === 'deterministic') {
        const receipt = await deterministicLearnScoringReceipt(input, context)
        const executionId = await ctx.runMutation(internal.learnV2Mastery.registerSealedMasteryScoring, { tokenIdentifier, submissionId: request.submissionId, receiptJson: JSON.stringify(receipt) })
        await ctx.runMutation(internal.learnV2Mastery.commitSealedMasteryAttempt, { tokenIdentifier, submissionId: request.submissionId, executionId })
      } else {
        const { service, prepared } = await prepareSavedLearnModelScoring(input, context)
        const executionId = await ctx.runMutation(internal.learnV2Mastery.registerSealedMasteryScoring, { tokenIdentifier, submissionId: request.submissionId, receiptJson: JSON.stringify(prepared.receipt) })
        const result = await service.dispatch(prepared)
        const verified = await ctx.runMutation(internal.learnV2Mastery.recordMasteryScoringReceipt, { tokenIdentifier, executionId, resultJson: JSON.stringify(result) })
        if (verified) await ctx.runMutation(internal.learnV2Mastery.commitSealedMasteryAttempt, { tokenIdentifier, submissionId: request.submissionId, executionId })
      }
    } catch {
      await ctx.runMutation(internal.learnV2Mastery.failSealedMasteryScoring, { tokenIdentifier, submissionId: request.submissionId, leaseToken: reservation.leaseToken })
    }
  }
  return await ctx.runQuery(internal.learnV2Mastery.getMasterySubmissionScoringState, request)
}

export const scoreMasterySubmission = action({
  args: scoreMasterySubmissionArgs, returns: scoreMasterySubmissionValidator,
  handler: async (ctx, args): Promise<LearnV2SubmissionScore> => await scoreMasterySubmissionForOwner(ctx, await requireAuth(ctx), args),
})

const sealedScoringArgs = { tokenIdentifier: v.string(), submissionId: v.id('learnResponses') }
export const beginSealedMasteryScoring = internalMutation({
  args: sealedScoringArgs,
  handler: async (ctx, args) => {
    const result = await reserveSavedLearnScoring(ctx, args.tokenIdentifier, args.submissionId)
    if (result.kind === 'blocked') {
      const response = await ctx.db.get(args.submissionId)
      const opportunity = response && 'assessmentOpportunityId' in response ? await ctx.db.get(response.assessmentOpportunityId) : null
      const job = opportunity?.scoringJobId ? await ctx.db.get(opportunity.scoringJobId) : null
      if (job?.terminalReason === 'provider_outcome_requires_reconciliation') await settleAdaptiveProductReservation(ctx, job, true, Date.now())
    }
    return result
  },
})
export const getSealedMasteryScoringInput = internalQuery({
  args: sealedScoringArgs,
  handler: async (ctx, args) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.scoring) throw new Error('Learn scoring disabled')
    return await requireSavedLearnScoringInput(ctx, args.tokenIdentifier, args.submissionId)
  },
})
export const registerSealedMasteryScoring = internalMutation({
  args: { ...sealedScoringArgs, receiptJson: v.string() },
  handler: async (ctx, args) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.scoring || args.receiptJson.length > 128_000) throw new Error('Learn scoring unavailable')
    const input = await requireSavedLearnScoringInput(ctx, args.tokenIdentifier, args.submissionId)
    const pins = input.response.contextPins
    if (pins.kind === 'session' && pins.canvas && input.response.scoringBinding.kind === 'model') {
      const canvas = pins.canvas
      const activity = await ctx.db.get(canvas.activityId)
      if (!activity) throw new Error('Adaptive scoring authority unavailable')
      const admission = { threadId: canvas.threadId, activityId: activity.activityId, manifestVersion: canvas.pilotConfigurationVersion }
      const ledger = await masteryScoringLedger({ studySessionId: pins.studySessionId, expectedSessionRevision: pins.sessionRevision,
        expectedContentRevision: pins.contentRevision, expectedPlanRecordRevision: pins.planRecordRevision,
        expectedBlueprintRecordRevision: input.response.blueprintRecordRevision, response: input.scoringInput.learnerResponse,
        confidence: input.response.confidence ?? 1, idempotencyKey: `submission:${input.response._id}` }, admission)
      const daily = await ctx.db.query('learnMasteryScoringRateEvents').withIndex('by_userId_and_createdAt', q =>
        q.eq('userId', args.tokenIdentifier).gt('createdAt', Date.now() - ADAPTIVE_V2_PILOT_MANIFEST.limits.dailyQuotaWindowMs)).take(ADAPTIVE_V2_PILOT_MANIFEST.limits.maxProviderDispatchesPerDay + 1)
      if (daily.length >= ADAPTIVE_V2_PILOT_MANIFEST.limits.maxProviderDispatchesPerDay) throw new Error('Adaptive daily scoring quota reached')
      const fields = { ...ledger, providerModel: input.response.scoringBinding.requestedModel, adaptiveThreadId: canvas.threadId, adaptiveActivityId: canvas.activityId }
      await ctx.db.patch(input.job._id, fields)
      const product = await admitAdaptiveProductDispatch(ctx, { ...input.job, ...fields }, true)
      if (product.kind !== 'allowed') throw new Error('Adaptive scoring budget unavailable')
    }
    return await saveLearnScoringExecution(ctx, args.tokenIdentifier, input, JSON.parse(args.receiptJson))
  },
})
export const recordMasteryScoringReceipt = internalMutation({
  args: { tokenIdentifier: v.string(), executionId: v.id('learnScoringExecutions'), resultJson: v.string() },
  handler: async (ctx, args) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.scoring || args.resultJson.length > 128_000) throw new Error('Learn scoring unavailable')
    const verified = await saveLearnModelScoringResult(ctx, args.tokenIdentifier, args.executionId, JSON.parse(args.resultJson) as LearnScoringExecutionResult)
    if (!verified) {
      const execution = (await ctx.db.get(args.executionId))!
      const job = (await ctx.db.get(execution.jobId))!
      await settleAdaptiveProductReservation(ctx, job, job.status === 'blocked', Date.now())
    }
    return verified
  },
})
export const failSealedMasteryScoring = internalMutation({
  args: { ...sealedScoringArgs, leaseToken: v.string() },
  handler: async (ctx, args) => {
    const input = await requireSavedLearnScoringInput(ctx, args.tokenIdentifier, args.submissionId)
    const { job, opportunity } = input
    if (job.leaseToken !== args.leaseToken || !['leased', 'running'].includes(job.status)) return
    const dispatched = job.status === 'running'
    await settleAdaptiveProductReservation(ctx, job, dispatched, Date.now())
    await ctx.db.patch(job._id, { status: dispatched ? 'blocked' : 'queued', leaseToken: undefined, leaseExpiresAt: undefined,
      terminalReason: dispatched ? 'provider_outcome_requires_reconciliation' : 'scorer_unavailable', revision: job.revision + 1, updatedAt: Date.now() })
    await ctx.db.patch(opportunity._id, { phase: dispatched ? 'reconciliation_required' : 'retryable_failure',
      reasonCode: dispatched ? 'provider_outcome_requires_reconciliation' : 'scorer_unavailable', revision: opportunity.revision + 1 })
  },
})
export const getSealedMasteryAttemptOutcome = internalQuery({
  args: { tokenIdentifier: v.string(), attemptId: v.id('masteryAttempts') },
  handler: async (ctx, args) => {
    if (await requireAuth(ctx) !== args.tokenIdentifier || !await hasLearnV2Access(ctx, args.tokenIdentifier)) throw new Error('Learn access denied')
    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== args.tokenIdentifier) throw new Error('Learn attempt unavailable')
    return { attemptId: attempt._id, state: attempt.masteryStateAfter, nextReviewAt: null }
  },
})

export const acceptCompatibilityMasterySubmission = internalMutation({
  args: { tokenIdentifier: v.string(), ...masteryAttemptArgs,
    adaptiveAdmission: v.optional(v.object({ threadId: v.id('learningThreads'), activityId: v.string(), manifestVersion: v.string() })) },
  handler: async (ctx, args) => {
    if (await requireAuth(ctx) !== args.tokenIdentifier) throw new Error('Learn access denied')
    validateAttemptRequest(args)
    const rows = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
      q.eq('userId', args.tokenIdentifier).eq('contextPins.studySessionId', args.studySessionId)).take(3)
    if (rows.length !== 1) throw new Error('Learn assessment opportunity unavailable')
    const opportunity = rows[0]!
    const pins = opportunity.contextPins
    if (pins.kind !== 'session' || pins.sessionRevision !== args.expectedSessionRevision || pins.contentRevision !== args.expectedContentRevision
      || pins.planRecordRevision !== args.expectedPlanRecordRevision || opportunity.blueprintRecordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Started session revision conflict')
    if (pins.canvas || args.adaptiveAdmission) {
      if (!pins.canvas || !args.adaptiveAdmission || pins.canvas.threadId !== args.adaptiveAdmission.threadId) throw new Error('Adaptive scoring authority unavailable')
      const scope = await sessionScope(ctx, args.tokenIdentifier, args.studySessionId)
      const authority = await adaptiveScoringAuthority(ctx, args.tokenIdentifier,
        { ...scope, content: { ...scope.content, providerModel: opportunity.scoringBinding.kind === 'model' ? opportunity.scoringBinding.requestedModel : '' } }, args.adaptiveAdmission)
      if (!authority.allowed || authority.activity._id !== pins.canvas.activityId) throw new Error('Adaptive scoring authority unavailable')
    }
    const receipt = await acceptMasterySubmissionForOwner(ctx, args.tokenIdentifier, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: (await privacyDigest(args.idempotencyKey)).slice(7), response: { target: { assessmentOpportunityId: opportunity._id },
        expectedRevision: opportunity.submissionId ? (await ctx.db.get(opportunity.submissionId))?.masteryAtAcceptance?.opportunityRevision ?? opportunity.revision : opportunity.revision,
        payload: { kind: 'text', text: args.response }, ...(opportunity.deliveryPins?.confidenceRequested ? { confidence: args.confidence } : {}) } } })
    return { ...receipt, replayed: opportunity.submissionId !== undefined }
  },
})

export const commitSealedMasteryAttempt = internalMutation({
  args: { ...sealedScoringArgs, executionId: v.id('learnScoringExecutions') },
  handler: async (ctx, args) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.scoring) throw new Error('Learn scoring disabled')
    const input = await requireSavedLearnScoringInput(ctx, args.tokenIdentifier, args.submissionId)
    const { response, opportunity, job } = input
    const execution = await ctx.db.get(args.executionId)
    if (!execution || execution.userId !== args.tokenIdentifier || execution.submissionId !== response._id
      || execution.assessmentOpportunityId !== opportunity._id || execution.jobId !== job._id
      || execution.responseDigest !== response.payloadDigest || execution.invalidatedAt !== undefined || execution.evidenceStatus !== 'available'
      || scorerCanonicalJson(execution.assessmentPins) !== scorerCanonicalJson(response.assessmentPins)
      || scorerCanonicalJson(execution.scoringBinding) !== scorerCanonicalJson(response.scoringBinding)) throw new Error('Learn execution receipt mismatch')
    if (opportunity.authoritativeAttemptId) {
      if (execution.authoritativeAttemptId !== opportunity.authoritativeAttemptId) throw new Error('Learn receipt already consumed')
      return opportunity.authoritativeAttemptId
    }
    const policy = response.scoringBinding.kind === 'model' ? (await getLearnMeasurementScorer(response.scoringBinding)).registry.identityPolicy
      : { version: LEARN_V2_SCORER_IDENTITY_POLICY_VERSION, verifiedModelAliases: [] }
    const receipt = receiptFields(execution)
    if (!isLearnScoringReceiptCommittable(receipt, policy) || !receipt.verdict || job.status !== 'running'
      || !job.leaseToken || receipt.leaseIdentityHash !== await privacyDigest(job.leaseToken)) throw new Error('Learn verified receipt required')
    const scorePercent = receipt.verdict.scorePercent
    if (response.scoringBinding.kind === 'deterministic') {
      const expected = await deterministicLearnScoringReceipt(input, receipt)
      if (scorerCanonicalJson(expected.verdict) !== scorerCanonicalJson(receipt.verdict)) throw new Error('Learn deterministic receipt mismatch')
    } else if (scoreCriteria(input.scoringInput.rubric.criteria, receipt.verdict.criterionResults) !== scorePercent) throw new Error('Learn rubric receipt mismatch')
    const { record } = await getScopedMasteryRecord(ctx, args.tokenIdentifier, response.blueprintRevisionId, response.objectiveId)
    const previousState = record?.state ?? 'unseen'
    const kind = opportunity.purpose.kind
    if (kind === 'calibration') {
      const learningVoid = await ctx.db.get(response.learningVoidId)
      if (learningVoid?.status !== 'calibration') throw new Error('Blueprint is not in calibration')
      const attempts = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_blueprintRevisionId_and_kind', q =>
        q.eq('userId', args.tokenIdentifier).eq('blueprintRevisionId', response.blueprintRevisionId).eq('kind', 'calibration')).take(8)
      if (attempts.length >= 7 || attempts.some(row => row.objectiveId === response.objectiveId)) throw new Error('Calibration objective already attempted or inventory exhausted')
    }
    const measured = kind === 'measurement_cold' || kind === 'measurement_delayed'
    const delayed = kind === 'measurement_delayed' || kind === 'retained_transfer'
    const attemptTimezone = response.masteryAtAcceptance!.performanceTimezone
    const attemptLocalDate = localDateAt(response.acceptedAt, attemptTimezone)
    const clean = response.validitySnapshot.status === 'valid' && response.currentEligibility === 'eligible'
    const retainedEligible = !delayed || response.masteryAtAcceptance !== undefined && isLearnRetainedPromotionTimeEligible({
      previousState: response.masteryAtAcceptance.state, acceptedAt: response.acceptedAt,
      firstIndependentLocalDate: response.masteryAtAcceptance.firstIndependentLocalDate,
      firstIndependentTimezone: response.masteryAtAcceptance.firstIndependentTimezone })
      && isLearnRetainedPromotionTimeEligible({ previousState, acceptedAt: response.acceptedAt,
        firstIndependentLocalDate: record?.firstIndependentLocalDate ?? null, firstIndependentTimezone: record?.firstIndependentTimezone ?? null })
    const masteryEligible = clean && response.validitySnapshot.masteryEligible && retainedEligible
    const outcome = measured ? deriveEligibleMeasurementMastery({ kind, scorePercent, previousState,
      measurementEligible: clean && response.validitySnapshot.measurementEligible, masteryEligible,
      firstIndependentLocalDate: record?.firstIndependentLocalDate, attemptLocalDate })
      : masteryEligible ? deriveMastery({ kind, scorePercent, previousState,
        assisted: response.assistanceSnapshot.state !== 'unassisted', firstIndependentLocalDate: record?.firstIndependentLocalDate, attemptLocalDate }) : null
    const now = Date.now()
    const masteryRecordRevision = outcome ? (record?.recordRevision ?? 0) + 1 : record?.recordRevision ?? 0
    const pins = response.contextPins
    const identity = receipt.observedIdentity
    const common = { userId: args.tokenIdentifier, blueprintRevisionId: response.blueprintRevisionId, objectiveId: response.objectiveId,
      attemptedAt: response.acceptedAt, acceptedAt: response.acceptedAt, scoreCommittedAt: now, attemptLocalDate, attemptTimezone,
      idempotencyKey: `submission:${response._id}`, requestFingerprint: response.payloadDigest, serverScorePercent: scorePercent,
      submissionId: response._id, assessmentOpportunityId: opportunity._id, scoringExecutionId: execution._id,
      scoringBinding: response.scoringBinding, assessmentPins: response.assessmentPins, assistanceSnapshot: response.assistanceSnapshot,
      validitySnapshot: response.validitySnapshot, usedHint: response.assistanceSnapshot.substantiveHintUsedAt !== null,
      usedReveal: response.assistanceSnapshot.answerRevealedAt !== null, confidence: response.confidence,
      requestedScorerModel: response.scoringBinding.kind === 'model' ? response.scoringBinding.requestedModel : null,
      returnedScorerModel: identity.status === 'deterministic' ? null : identity.returnedScorerModel,
      scorerVersion: response.scoringBinding.kind === 'model' ? response.scoringBinding.scorerVersion : response.scoringBinding.engineVersion,
      criterionResultsJson: JSON.stringify(receipt.verdict.criterionResults), misconceptionTagsJson: JSON.stringify(receipt.verdict.misconceptionTags),
      masteryStateBefore: previousState, masteryStateAfter: outcome?.state ?? previousState,
      masteryTransitionVersion: 'learn-v2.mastery-transition.v1' as const, masteryTransitionReason: outcome?.reason,
      masteryRecordRevision, result: outcome?.state ?? previousState,
      ...(pins.kind === 'session' ? { studySessionId: pins.studySessionId, sessionContentId: pins.sessionContentId, studyPlanRevisionId: pins.studyPlanRevisionId } : {}),
    }
    let attemptId: Id<'masteryAttempts'>
    if (measured && response.assessmentPins.kind === 'measurement') {
      attemptId = await ctx.db.insert('masteryAttempts', { ...common, ...(kind === 'measurement_delayed' ? { kind, horizonDays: opportunity.horizonDays! } : { kind }),
        measurementStorage: { version: 'learn-v2.measurement-storage.v1', scope: { scopeKind: 'v2', learningVoidId: response.learningVoidId,
          blueprintRevisionId: response.blueprintRevisionId, objectiveId: response.objectiveId, blueprintRecordRevision: response.blueprintRecordRevision,
          assessmentContractVersion: response.assessmentContractVersion, assessmentContractDigest: response.assessmentContractDigest, depth: response.depth, contextPins: pins },
          assessmentOpportunityId: opportunity._id, submissionId: response._id, executionId: execution._id, itemPins: response.assessmentPins.itemPins,
          scoringBinding: response.scoringBinding, assistanceSnapshot: response.assistanceSnapshot, validitySnapshot: response.validitySnapshot,
          acceptedAt: response.acceptedAt, scoreCommittedAt: now, requestedScorerModel: common.requestedScorerModel, returnedScorerModel: common.returnedScorerModel,
          ...(opportunity.firstCheckClaim ? { firstCheckClaim: opportunity.firstCheckClaim, checkSequence: opportunity.checkSequence } : {}) } })
    } else if (!measured) attemptId = await ctx.db.insert('masteryAttempts', { ...common, kind })
    else throw new Error('Learn measurement pins unavailable')
    await settleAdaptiveProductReservation(ctx, job, false, now)
    await ctx.db.patch(execution._id, { authoritativeAttemptId: attemptId, committedAt: now })
    await ctx.db.patch(job._id, { status: 'succeeded', leaseToken: undefined, leaseExpiresAt: undefined, revision: job.revision + 1, updatedAt: now })
    await ctx.db.patch(opportunity._id, { authoritativeAttemptId: attemptId, phase: scorePercent >= 80 ? 'scored_pass' : 'scored_fail', revision: opportunity.revision + 1 })
    let followUp: { sessionId: Id<'studySessions'>, scheduledStartAt: number } | null = null
    if (outcome && kind !== 'calibration' && pins.kind !== 'calibration') {
      const plan = await ctx.db.get(pins.studyPlanRevisionId)
      const objective = await ctx.db.get(response.objectiveId)
      const blueprint = await ctx.db.get(response.blueprintRevisionId)
      const voidRow = await ctx.db.get(response.learningVoidId)
      const links = await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_submissionId', q => q.eq('userId', args.tokenIdentifier).eq('submissionId', response._id)).take(65)
      if (!plan || !objective || !blueprint || !voidRow || links.length > 64) throw new Error('Learn follow-up scope unavailable')
      followUp = await createFollowUp(ctx, { userId: args.tokenIdentifier, scope: { plan, objective, blueprint, voidRow }, testOnly: true,
        attemptId, outcome, now, timezone: attemptTimezone, firstIndependentLocalDate: outcome.setFirstIndependent ? attemptLocalDate : record?.firstIndependentLocalDate,
        sourceIds: links.flatMap(row => row.dependency.kind === 'snapshot' ? [row.dependency.sourceSnapshotId] : []) })
    }
    if (outcome) {
      await transitionScopedMasteryRecord(ctx, { userId: args.tokenIdentifier, blueprintRevisionId: response.blueprintRevisionId,
        objectiveId: response.objectiveId, historyAttemptId: attemptId, transition: { state: outcome.state, recordRevision: masteryRecordRevision,
          schedulingPriority: outcome.remediation ? 'remediation' : 'standard', nextReviewAt: followUp?.scheduledStartAt, remediationAttemptId: outcome.remediation ? attemptId : undefined, lastAttemptAt: response.acceptedAt, lastAttemptId: attemptId,
          ...(outcome.setFirstIndependent ? { firstIndependentPassAt: response.acceptedAt, firstIndependentLocalDate: attemptLocalDate, firstIndependentTimezone: attemptTimezone } : {}), updatedAt: now } })
      if (!measured && kind !== 'calibration' && pins.kind === 'session') {
        const session = await ctx.db.get(pins.studySessionId)
        if (session) await ctx.db.patch(session._id, { status: 'completed', revision: session.revision + 1 })
      }
    }
    const protocol = getFrozenLearnMeasurementProtocol()
    const assignment = opportunity.assignmentId ? await ctx.db.get(opportunity.assignmentId) : null
    const epoch = assignment?.epoch ?? protocol?.epoch
    if (epoch && kind !== 'calibration') {
      const configuration = await deriveLearnScorerConfiguration(response.scoringBinding)
      const item = response.assessmentPins.kind === 'measurement' ? response.assessmentPins.itemPins : null
      await appendLearnMeasurementFact(ctx, args.tokenIdentifier, { epoch, learningVoidId: response.learningVoidId, occurredAt: now,
        fact: { kind: 'score', submissionId: response._id, attemptId, executionId: execution._id, scorePercent, scoreCommittedAt: now,
          snapshot: { submissionId: response._id, attemptId, executionId: execution._id, kind, acceptedAt: response.acceptedAt,
            scoreCommittedAt: now, scorePercent, thresholdPercent: 80, caseId: item?.caseId ?? (response.assessmentPins.kind !== 'measurement' ? response.assessmentPins.caseId : '' as Id<'learnAssessmentCases'>),
            itemId: item?.itemId ?? null, familyRevision: item?.familyRevision ?? null, formLabel: item ? learnMeasurementItemPinsSchema.parse(item).formLabel : null,
            ...configuration, observedModel: common.returnedScorerModel, observedUpstream: identity.status === 'deterministic' ? null : identity.servingProvider,
            identityVersion: LEARN_V2_SCORER_IDENTITY_POLICY_VERSION, identityStatus: identity.status, comparisonContractDigest: response.assessmentContractDigest,
            supportManifestDigest: item?.supportManifestDigest ?? (response.assessmentPins.kind !== 'measurement' ? response.assessmentPins.supportManifestDigest : ''),
            assistanceState: response.assistanceSnapshot.state, assistancePolicyVersion: response.assistanceSnapshot.policyVersion,
            validityStatus: clean ? response.validitySnapshot.status : 'excluded', exclusionReasons: clean ? response.validitySnapshot.exclusionReasons : [...new Set([...response.validitySnapshot.exclusionReasons, 'current_integrity_excluded'])],
            measurementEligible: clean && response.validitySnapshot.measurementEligible, masteryEligible,
            evidenceAvailable: true, pasteObserved: response.assistanceSnapshot.pasteObserved, focusLossObserved: response.assistanceSnapshot.focusLossObserved,
            instrumentationVersion: response.assistanceSnapshot.instrumentationVersion, masteryStateBefore: previousState, masteryStateAfter: outcome?.state ?? previousState } } })
      if (outcome?.setFirstIndependent && response.assistanceSnapshot.state === 'unassisted') await freezeFirstIndependentClaimForOwner(ctx, args.tokenIdentifier, { basisAttemptId: attemptId,
        ...(assignment?.status === 'admitted' ? { assignmentId: assignment._id } : {}) })
      await writeMeasurementOpportunityFact(ctx, { userId: args.tokenIdentifier, epoch, learningVoidId: response.learningVoidId }, (await ctx.db.get(opportunity._id))!)
    }
    const eventBasis = { kind, gradingStatus: 'scored' as const, scorePercent, assistanceSnapshot: response.assistanceSnapshot,
      validitySnapshot: response.validitySnapshot, masteryStateBefore: previousState, masteryStateAfter: outcome?.state ?? previousState }
    for (const eventType of ['representative_pass', 'representative_fail', 'retained'] as const) {
      if (!clean || !canEmitLearnMeasurementOutcomeEvent(eventType, eventBasis)) continue
      await writeLearnMeasurementEvent(ctx, args.tokenIdentifier, { taxonomyVersion: LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION,
        eventType, eventVersion: `${eventType}.v2`, sourceVersion: 'learn-v2.sealed-scoring.v1', contractVersion: opportunity.eligibilityPolicyVersion,
        occurredAt: now, learningVoidId: response.learningVoidId, blueprintRevisionId: response.blueprintRevisionId, objectiveId: response.objectiveId,
        assessmentOpportunityId: opportunity._id, submissionId: response._id, attemptId, measurementEligible: response.validitySnapshot.measurementEligible,
        masteryEligible, ...(opportunity.horizonDays ? { horizonDays: opportunity.horizonDays } : {}),
        ...(pins.kind === 'session' && pins.canvas ? { threadId: pins.canvas.threadId, activityId: pins.canvas.activityId } : {}),
        metadata: { masteryState: outcome?.state ?? previousState, ...(response.assistanceSnapshot.state === 'unknown' ? {} : { assistanceLevel: response.assistanceSnapshot.answerRevealedAt !== null ? 'reveal' as const
          : response.assistanceSnapshot.state === 'assisted' ? 'hint' as const : 'none' as const }) } })
    }
    return attemptId
  },
})

export const submitMasteryAttempt = action({
  args: masteryAttemptArgs, returns: masteryAttemptReturnValidator,
  handler: async (ctx, args): Promise<MasteryAttemptActionResult> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Learn V2 access denied')
    return await submitMasteryAttemptForOwner(ctx, identity.tokenIdentifier, args)
  },
})

export const legacyMasteryAttemptArgs = {
    tokenIdentifier: v.string(), studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), expectedContentRevision: v.number(), expectedPlanRecordRevision: v.number(), expectedBlueprintRecordRevision: v.number(),
    response: v.string(), confidence: v.number(), idempotencyKey: v.string(), scorerVerdict: scorerVerdictValidator,
    scoringJobId: v.optional(v.id('learnJobs')), scoringLeaseToken: v.optional(v.string()), providerResponseId: v.optional(v.string()),
    scoredSourceSnapshotIds: v.optional(v.array(v.id('learnSourceSnapshots'))),
    scoredContentRevisionPins: v.optional(v.array(v.object({ claimId: v.string(), supportId: v.string(), sourceExcerptId: v.string(), sourceSnapshotId: v.string(), sourceRevisionNumber: v.number(), sourceRecordRevision: v.number(), sourceRevision: v.union(v.string(), v.null()), excerptLocator: v.string(), verifierVersion: v.string() }))),
  }
const legacyMasteryAttemptValidator = v.object(legacyMasteryAttemptArgs)

export async function recordLegacyMasteryAttemptForOwner(ctx: MutationCtx, args: Infer<typeof legacyMasteryAttemptValidator>) {
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) throw new Error('Learn V2 access denied')
    validateAttemptRequest(args)
    if (args.scorerVerdict.scorerVersion !== LEARN_V2_MASTERY_SCORER_VERSION || args.scorerVerdict.misconceptionTags.length > MAX_MISCONCEPTIONS || args.scorerVerdict.verifierVersions.length > MAX_SOURCES) throw new Error('Server scorer verdict is invalid')
    if (args.scorerVerdict.criterionResults.length < 1 || args.scorerVerdict.criterionResults.length > 8
      || args.scorerVerdict.criterionResults.some(row => !row.key.trim() || row.key.length > 64)
      || args.scorerVerdict.misconceptionTags.some(tag => !ADAPTIVE_MISCONCEPTION_TAGS.includes(tag as never))
      || new Set(args.scorerVerdict.misconceptionTags).size !== args.scorerVerdict.misconceptionTags.length
      || args.scorerVerdict.verifierVersions.some(version => !version.trim() || version.length > 200)
      || new Set(args.scorerVerdict.verifierVersions).size !== args.scorerVerdict.verifierVersions.length) throw new Error('Server scorer verdict is invalid')
    const requestFingerprintValue = await requestFingerprints(args)
    if ((args.scoringJobId === undefined) !== (args.scoringLeaseToken === undefined)) throw new Error('Mastery scoring command is invalid')
    const scoringJob = args.scoringJobId && await ctx.db.get(args.scoringJobId)
    if (args.scoringJobId && (!scoringJob || scoringJob.userId !== args.tokenIdentifier || scoringJob.type !== SCORING_JOB_TYPE || scoringJob.status !== 'running' || scoringJob.leaseToken !== args.scoringLeaseToken || !await fingerprintMatches(scoringJob.requestFingerprint, requestFingerprintValue))) throw new Error('Mastery scoring command is invalid')
    if (scoringJob && (!args.scoredSourceSnapshotIds?.length || !args.scoredContentRevisionPins?.length)) throw new Error('Mastery scoring evidence pins are unavailable')
    const prior = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', args.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique()
    if (prior) {
      if (!await fingerprintMatches(prior.requestFingerprint, requestFingerprintValue)) throw new Error('Idempotency key was already used for a different request')
      const currentRecord = prior.blueprintRevisionId ? (await getScopedMasteryRecord(ctx, args.tokenIdentifier, prior.blueprintRevisionId, prior.objectiveId)).record : null
      return { attemptId: prior._id, scorePercent: prior.serverScorePercent, state: prior.result, nextReviewAt: currentRecord?.lastAttemptId === prior._id ? currentRecord.nextReviewAt ?? null : null, feedback: feedback(prior), replayed: true }
    }
    const scope = await sessionScope(ctx, args.tokenIdentifier, args.studySessionId)
    if (scoringJob?.providerProductPolicyVersion) {
      const activity = scoringJob.adaptiveActivityId && await ctx.db.get(scoringJob.adaptiveActivityId)
      if (!activity || !scoringJob.adaptiveThreadId || !scoringJob.providerPilotManifestVersion
        || process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST !== scoringJob.providerPilotManifestVersion
        || scoringJob.providerReservationStatus !== 'outstanding' || (scoringJob.leaseExpiresAt ?? 0) <= Date.now()) throw new Error('Adaptive scoring reply requires reconciliation')
      const authority = await adaptiveScoringAuthority(ctx, args.tokenIdentifier, scope, {
        threadId: scoringJob.adaptiveThreadId, activityId: activity.activityId, manifestVersion: scoringJob.providerPilotManifestVersion,
      })
      if (!authority.allowed || authority.activity.scoringJobId !== scoringJob._id) throw new Error('Adaptive scoring reply requires reconciliation')
    }
    if (scope.session.status !== 'in_progress' || scope.session.revision !== args.expectedSessionRevision || scope.content.revision !== args.expectedContentRevision || scope.session.startedSessionContentRevision !== scope.content.revision || scope.plan.recordRevision !== args.expectedPlanRecordRevision || scope.blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Started session revision conflict')
    const rubric = JSON.parse(scope.content.assessmentRubricSnapshot ?? 'null') as { version: string, criteria: Array<{ key: string, description?: string, weightPercent: number }> } | null
    if (!rubric || rubric.version !== 'learn-v2.assessment.v1') throw new Error('Started session rubric is unavailable')
    if (canonicalJson(rubric) !== canonicalJson(scope.objective.assessmentContract)) throw new Error('Started session rubric is no longer pinned to the objective')
    const scorePercent = scoreCriteria(rubric.criteria, args.scorerVerdict.criterionResults)
    const controlledFeedback = projectControlledFeedback({
      criteria: LEARN_MEASUREMENT_CAPABILITIES.responses ? [] : rubric.criteria.map(row => ({ key: row.key, label: row.description?.trim() || row.key })),
      outcomes: LEARN_MEASUREMENT_CAPABILITIES.responses ? [] : args.scorerVerdict.criterionResults,
      misconceptionTags: args.scorerVerdict.misconceptionTags,
    })
    const evidence = await exactContentEvidence(ctx, args.tokenIdentifier, scope.content)
    if (canonicalJson([...args.scorerVerdict.verifierVersions].sort()) !== canonicalJson(evidence.verifierVersions)) throw new Error('Server scorer verifier pins do not match the published content')
    const scoredSourceSnapshotIds = scoringJob ? args.scoredSourceSnapshotIds! : evidence.sourceSnapshotIds
    const scoredContentRevisionPins = scoringJob ? args.scoredContentRevisionPins! : evidence.contentRevisionPins
    if (canonicalJson(scoredSourceSnapshotIds.map(String).sort()) !== canonicalJson(evidence.sourceIds)
      || canonicalJson(scoredContentRevisionPins) !== canonicalJson(evidence.contentRevisionPins)) throw new Error('Mastery scoring evidence pins do not match the published content')
    const sessionTimezone = scope.session.timezone ?? scope.plan.timezone
    if (!sessionTimezone) throw new Error('Started session timezone pin is unavailable')
    const record = (await getScopedMasteryRecord(ctx, args.tokenIdentifier, scope.blueprint._id, scope.objective._id)).record
    const kind = scope.session.placementKind === 'retained_review' ? 'retained_transfer' as const : 'independent_application' as const
    const assisted = scope.session.substantiveHintUsedAt !== undefined || scope.session.answerRevealedAt !== undefined
    const attemptTimezone = kind === 'retained_transfer' && record?.firstIndependentTimezone ? record.firstIndependentTimezone : sessionTimezone
    const { attemptedAt: now, localDate: attemptLocalDate } = masteryAttemptTime(attemptTimezone)
    const outcome = deriveMastery({ scorePercent, assisted, kind, previousState: record?.state, firstIndependentLocalDate: record?.firstIndependentLocalDate, attemptLocalDate })
    const masteryRecordRevision = (record?.recordRevision ?? 0) + 1
    const attemptId = await ctx.db.insert('masteryAttempts', { userId: args.tokenIdentifier, blueprintRevisionId: scope.blueprint._id, objectiveId: scope.objective._id, studySessionId: scope.session._id, sessionContentId: scope.content._id, studyPlanRevisionId: scope.plan._id, kind, activityContractVersion: 'learn-v2.mastery-attempt.v1', providerVersion: 'openrouter-via-cloudflare-ai-gateway.v1', attemptedAt: now, attemptLocalDate, attemptTimezone, idempotencyKey: args.idempotencyKey, requestFingerprint: requestFingerprintValue.digest, serverScorePercent: scorePercent, response: args.response, criterionResultsJson: JSON.stringify(args.scorerVerdict.criterionResults), misconceptionTagsJson: JSON.stringify(args.scorerVerdict.misconceptionTags), feedbackTemplateVersion: ADAPTIVE_FEEDBACK_TEMPLATE_VERSION, misconceptionTaxonomyVersion: ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION, feedbackProjectionJson: JSON.stringify(controlledFeedback), usedHint: scope.session.substantiveHintUsedAt !== undefined, usedReveal: scope.session.answerRevealedAt !== undefined, confidence: args.confidence, rubricVersion: rubric.version, rubricSnapshot: scope.content.assessmentRubricSnapshot, scorerVersion: args.scorerVerdict.scorerVersion, scorerModel: scope.content.providerModel, verifierVersionsJson: JSON.stringify(evidence.verifierVersions), sourceSnapshotIdsJson: JSON.stringify(scoredSourceSnapshotIds.map(String).sort()), contentRevisionPinsJson: JSON.stringify(scoredContentRevisionPins), sessionRevision: scope.session.revision, contentRevision: scope.content.revision, planRevision: scope.plan.revision, planRecordRevision: scope.plan.recordRevision, blueprintRecordRevision: scope.blueprint.recordRevision, masteryStateBefore: outcome.previousState, masteryStateAfter: outcome.state, masteryTransitionReason: outcome.reason, masteryTransitionVersion: outcome.transitionVersion, masteryRecordRevision, result: outcome.state })
    const followUp = await createFollowUp(ctx, { userId: args.tokenIdentifier, scope, attemptId, outcome, now, timezone: attemptTimezone, firstIndependentLocalDate: outcome.setFirstIndependent ? attemptLocalDate : record?.firstIndependentLocalDate, sourceIds: evidence.sourceSnapshotIds })
    const patch = { state: outcome.state, schedulingPriority: outcome.remediation ? 'remediation' as const : 'standard' as const, recordRevision: masteryRecordRevision, lastAttemptAt: now, lastAttemptId: attemptId, nextReviewAt: followUp?.scheduledStartAt, remediationAttemptId: outcome.remediation ? attemptId : undefined, ...(outcome.setFirstIndependent ? { firstIndependentPassAt: now, firstIndependentLocalDate: attemptLocalDate, firstIndependentTimezone: attemptTimezone } : {}), updatedAt: now }
    await transitionScopedMasteryRecord(ctx, { userId: args.tokenIdentifier, blueprintRevisionId: scope.blueprint._id, objectiveId: scope.objective._id, historyAttemptId: attemptId, transition: patch })
    if (scoringJob) {
      await settleAdaptiveProductReservation(ctx, scoringJob, false, now)
      await ctx.db.patch(scoringJob._id, { status: 'succeeded', providerResponseId: args.providerResponseId, leaseToken: undefined, leaseExpiresAt: undefined, checkpoint: `attempt:${String(attemptId)}`, terminalReason: undefined, revision: scoringJob.revision + 1, updatedAt: now })
      await projectAdaptiveFeedback(ctx, scoringJob, attemptId, controlledFeedback)
      await emitAdaptiveAttemptEvents(ctx, { job: scoringJob, attemptId, now, scorePercent, kind, assistanceLevel: scope.session.answerRevealedAt !== undefined ? 'reveal' : scope.session.substantiveHintUsedAt !== undefined ? 'hint' : 'none', outcome, scorerVersion: args.scorerVerdict.scorerVersion })
    }
    await ctx.db.patch(scope.session._id, { status: 'completed', revision: scope.session.revision + 1, auditReasonCode: 'mastery_attempt_recorded' })
    await ctx.db.insert('learnPlanAuditEvents', { userId: args.tokenIdentifier, learningVoidId: scope.voidRow._id, studyPlanRevisionId: scope.plan._id, studySessionId: scope.session._id, reasonCode: 'mastery_attempt_recorded', details: JSON.stringify({ attemptId, kind, scorePercent, state: outcome.state, assisted }), createdAt: now })
    return { attemptId, scorePercent, state: outcome.state, nextReviewAt: followUp?.scheduledStartAt ?? null, feedback: controlledFeedback, replayed: false }
}

export const recordMasteryAttempt = internalMutation({
  args: legacyMasteryAttemptValidator.fields,
  handler: async (ctx, args) => {
    if (!args.scoringJobId || !args.scoringLeaseToken) throw new Error('Saved submission and verified execution receipt required')
    if (LEARN_MEASUREMENT_CAPABILITIES.scoring) throw new Error('Saved submission and verified execution receipt required')
    if (LEARN_MEASUREMENT_CAPABILITIES.responses && await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q => q.eq('userId', args.tokenIdentifier).eq('contextPins.studySessionId', args.studySessionId)).first()) throw new Error('Saved submission and verified execution receipt required')
    return await recordLegacyMasteryAttemptForOwner(ctx, args)
  },
})
