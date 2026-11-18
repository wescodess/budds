import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { getLearnMeasurementScorer } from './learnV2MeasurementScorerInventory'
import { getLearnResponseStateForOwner } from './learnV2Responses'
import { calibrationEvidence } from '../learnV2MapCalibration'
import { learnCalibrationScoringProtocol } from './learnV2MeasurementCalibrationScorer'
import { hasLearnV2Access } from './learnV2Access'
import { requireAuth } from './auth'
import { privacyDigest } from './learnV2ResponsePrivacy'
import { measurementItemReason, measurementScopeReason } from './learnV2Measurement'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { learnPrivateScoringPayloadSchema, learnAssessmentPinsSchema, learnMeasurementItemPinsSchema, learnScoringExecutionReceiptSchema, type LearnScoringExecutionReceipt } from '../../shared/learn-v2-measurement'
import { ADAPTIVE_V2_PILOT_MANIFEST, adaptiveV2PilotDecision } from '../../shared/adaptive-v2-pilot-policy'
import { createLearnMasteryScorerService, scorerCanonicalJson, type BaselineMasteryScoringInput, type LearnScoringExecutionResult } from '../../server/utils/learn-v2-mastery-scorer'
import { LEARN_V2_PUBLIC_API_VERSION, disabledLearnV2Result, type LearnV2SubmissionScore } from './learnV2PublicContract'
import { learnSafeAssessmentResultSchema } from '../../shared/learn-v2-assessment-disclosure'

type ReadCtx = QueryCtx | MutationCtx
const limits = ADAPTIVE_V2_PILOT_MANIFEST.limits

export async function requireSavedLearnScoringInput(ctx: ReadCtx, userId: string, submissionId: Id<'learnResponses'>) {
  if (await requireAuth(ctx) !== userId || !await hasLearnV2Access(ctx, userId)) throw new Error('Learn scoring access denied')
  const response = await ctx.db.get(submissionId)
  if (!response || response.userId !== userId || response.scopeKind !== 'v2' || !('assessmentOpportunityId' in response)) throw new Error('Learn scoring submission unavailable')
  if (!response.masteryAtAcceptance) throw new Error('Learn acceptance-time mastery snapshot unavailable')
  const opportunity = await ctx.db.get(response.assessmentOpportunityId)
  const job = opportunity?.scoringJobId ? await ctx.db.get(opportunity.scoringJobId) : null
  if (!opportunity || opportunity.userId !== userId || opportunity.submissionId !== response._id
    || !job || job.userId !== userId || job.submissionId !== response._id || job.assessmentOpportunityId !== opportunity._id
    || job.type !== 'sealed_response_scoring' || job.requestFingerprint !== response.payloadDigest
    || scorerCanonicalJson(job.scoringBinding) !== scorerCanonicalJson(response.scoringBinding)
    || scorerCanonicalJson(opportunity.scoringBinding) !== scorerCanonicalJson(response.scoringBinding)
    || scorerCanonicalJson(opportunity.assessmentPins) !== scorerCanonicalJson(response.assessmentPins)) throw new Error('Learn scoring pins mismatch')
  const state = await getLearnResponseStateForOwner(ctx, userId, { assessmentOpportunityId: opportunity._id })
  if (state.status !== 'available' || state.work?.body.bodyAvailability !== 'available'
    || response.currentEligibility === 'unknown' || response.invalidatedAt !== undefined || opportunity.invalidatedAt !== undefined) throw new Error('Learn scoring evidence unavailable')
  const objective = await ctx.db.get(opportunity.objectiveId)
  if (!objective || objective.userId !== userId || !objective.assessmentContract || typeof objective.assessmentContract === 'string'
    || await privacyDigest(objective.assessmentContract) !== response.assessmentContractDigest) throw new Error('Learn scoring rubric unavailable')
  const payload = state.work.body.payload
  const contract = objective.assessmentContract
  let rubric = { version: contract.version as string, criteria: contract.criteria }
  let rubricSnapshot: string | null = null
  let challenge = contract.instructions
  const evidence: BaselineMasteryScoringInput['evidence'] = []
  let scoringSpec: ReturnType<typeof learnPrivateScoringPayloadSchema.parse> | null = null
  if (opportunity.assessmentPins.kind === 'measurement') {
    const pins = opportunity.assessmentPins.itemPins
    const reason = await measurementScopeReason(ctx, userId, opportunity)
      ?? await measurementItemReason(ctx, userId, learnMeasurementItemPinsSchema.parse(pins), opportunity, response.scoringBinding)
    if (reason) throw new Error('Learn scoring evidence unavailable')
    const item = (await ctx.db.get(pins.itemId))!
    const spec = (await ctx.db.get(pins.scoringSpecId))!
    scoringSpec = learnPrivateScoringPayloadSchema.parse(spec.payload)
    challenge = item.prompt!
    if (scoringSpec.kind === 'bounded_rubric') rubric = { version: contract.version, criteria: scoringSpec.criteria }
    const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', item._id)).take(33)
    for (const claim of claims) {
      const supports = await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_claimId', q => q.eq('userId', userId).eq('claimId', claim._id)).take(9)
      for (const support of supports) {
        const excerpt = await ctx.db.get(support.sourceExcerptId)
        if (!excerpt?.excerpt) throw new Error('Learn scoring evidence unavailable')
        evidence.push({ alias: `S${evidence.length + 1}`, claim: claim.claim ?? '', excerpt: excerpt.excerpt })
      }
    }
  } else {
    const blueprint = await ctx.db.get(response.blueprintRevisionId)
    const learningVoid = await ctx.db.get(response.learningVoidId)
    if (!blueprint || blueprint.userId !== userId || blueprint.recordRevision !== response.blueprintRecordRevision
      || learningVoid?.activeBlueprintRevisionId !== blueprint._id) throw new Error('Learn scoring pins mismatch')
    if (response.contextPins.kind === 'session') {
      const pins = response.contextPins
      const content = await ctx.db.get(pins.sessionContentId)
      const session = await ctx.db.get(pins.studySessionId)
      if (!content || content.userId !== userId || content.revision !== pins.contentRevision || content.status !== 'published'
        || session?.userId !== userId || session.startedSessionContentId !== content._id) throw new Error('Learn scoring pins mismatch')
      rubricSnapshot = content.assessmentRubricSnapshot ?? null
      rubric = JSON.parse(rubricSnapshot ?? 'null')
      if (!rubric || opportunity.assessmentPins.kind !== 'session_application' || await privacyDigest(rubric) !== opportunity.assessmentPins.rubricDigest) throw new Error('Learn scoring rubric unavailable')
      const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(16)
      const prompts = blocks.filter(row => row.kind === 'transfer_challenge' && row.content)
      if (prompts.length !== 1 || await privacyDigest(prompts[0]!.content) !== opportunity.assessmentPins.promptDigest) throw new Error('Learn scoring prompt unavailable')
      challenge = prompts[0]!.content!
      const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(33)
      if (!claims.length || claims.length > 32) throw new Error('Learn scoring evidence unavailable')
      for (const claim of claims) {
        const supports = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
        if (!supports.length || supports.length > 8) throw new Error('Learn scoring evidence unavailable')
        for (const support of supports) {
          const excerpt = await ctx.db.get(support.sourceExcerptId)
          if (support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available'
            || !excerpt?.excerpt || excerpt.userId !== userId || excerpt.evidencePurgedAt !== undefined) throw new Error('Learn scoring evidence unavailable')
          evidence.push({ alias: `S${evidence.length + 1}`, claim: claim.claim, excerpt: excerpt.excerpt })
        }
      }
    } else {
      const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(9)
      if (!links.length || links.length > 8) throw new Error('Learn scoring evidence unavailable')
      for (const link of links) {
        const excerpts = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', link.sourceSnapshotId)).take(1)
        if (!excerpts[0]?.excerpt) throw new Error('Learn scoring evidence unavailable')
        evidence.push({ alias: `S${evidence.length + 1}`, claim: objective.title, excerpt: excerpts[0].excerpt })
      }
    }
  }
  if (evidence.length > 64) throw new Error('Learn scoring evidence exceeds its bound')
  const scoringInput: BaselineMasteryScoringInput = { rubric, challenge, evidence,
    learnerResponse: payload.kind === 'text' ? payload.text : payload.kind === 'source_comparison' ? payload.comparison : scorerCanonicalJson(payload) }
  if (response.contextPins.kind === 'session' && response.contextPins.canvas) {
    const canvas = response.contextPins.canvas
    const thread = await ctx.db.get(canvas.threadId)
    const activity = await ctx.db.get(canvas.activityId)
    if (!thread || !activity || thread.currentActivityId !== activity._id || thread.revision !== canvas.threadRevision
      || activity.planRevision !== canvas.activityRevision || ['ended', 'replaced', 'blocked'].includes(activity.status)
      || process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST !== canvas.pilotConfigurationVersion
      || !adaptiveV2PilotDecision(canvas.pilotConfigurationVersion, { model: response.scoringBinding.kind === 'model' ? response.scoringBinding.requestedModel : '',
        now: Date.now(), activityContractVersion: activity.contractVersion, evaluationContractVersion: activity.evaluationContract.version,
        learnerHash: await privacyDigest(['adaptive-v2-pilot-cohort.v1', userId]) }).allowed) throw new Error('Adaptive scoring admission unavailable')
  }
  const calibration = opportunity.purpose.kind === 'calibration' ? { objective: { title: objective.title, capability: objective.capability, assessmentContract: objective.assessmentContract },
    evidence: (await calibrationEvidence(ctx, userId, objective._id)).evidence } : null
  return { response, opportunity, job, payload, scoringSpec, scoringInput, rubricSnapshot: rubricSnapshot ?? JSON.stringify(rubric), calibrationSnapshot: calibration ? JSON.stringify(calibration) : null }
}
export type SavedLearnScoringInput = Awaited<ReturnType<typeof requireSavedLearnScoringInput>>

export async function readSavedLearnScoringState(ctx: ReadCtx, userId: string, submissionId: Id<'learnResponses'>): Promise<LearnV2SubmissionScore> {
  if (!LEARN_MEASUREMENT_CAPABILITIES.scoring) return disabledLearnV2Result()
  const input = await requireSavedLearnScoringInput(ctx, userId, submissionId)
  const { opportunity, response } = input
  if (opportunity.authoritativeAttemptId) {
    const attempt = await ctx.db.get(opportunity.authoritativeAttemptId)
    if (!attempt || attempt.userId !== userId || attempt.submissionId !== submissionId) throw new Error('Learn scored result unavailable')
    return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'scored', submissionId,
      result: learnSafeAssessmentResultSchema.parse({ attemptId: attempt._id, scorePercent: attempt.serverScorePercent, thresholdPercent: 80,
        scoreCommittedAt: attempt.scoreCommittedAt, feedbackCodes: [response.validitySnapshot.status !== 'valid' || response.currentEligibility !== 'eligible' ? 'excluded_result'
          : response.assistanceSnapshot.state === 'assisted' ? 'assisted_result' : attempt.serverScorePercent! >= 80 ? 'pass' : 'needs_review'] }) }
  }
  const status = ['retryable_failure', 'reconciliation_required', 'invalid'].includes(opportunity.phase)
    ? opportunity.phase as 'retryable_failure' | 'reconciliation_required' | 'invalid' : 'scoring_pending'
  return { version: LEARN_V2_PUBLIC_API_VERSION, status, submissionId, reasonCodes: opportunity.reasonCode ? [opportunity.reasonCode] : [] }
}

export async function prepareSavedLearnModelScoring(input: SavedLearnScoringInput, receipt: Pick<LearnScoringExecutionReceipt, 'dispatchedAt' | 'dispatchOrdinal' | 'leaseIdentityHash'>) {
  const binding = input.response.scoringBinding
  if (binding.kind !== 'model') throw new Error('Learn model binding required')
  const { registry, saved } = await getLearnMeasurementScorer(binding)
  if (!saved || scorerCanonicalJson(saved.binding) !== scorerCanonicalJson(binding)) throw new Error('Learn bound scorer configuration unavailable')
  const calibration = input.calibrationSnapshot ? JSON.parse(input.calibrationSnapshot) as { objective: { title: string, capability?: string, assessmentContract?: unknown }, evidence: Array<{ alias: string, excerpt?: string, locator: string }> } : null
  if (calibration && binding.scorerVersion !== 'learn-v2.calibration-scorer.v1') throw new Error('Calibration scorer configuration required')
  const service = createLearnMasteryScorerService(registry, undefined, Date.now, calibration ? learnCalibrationScoringProtocol(calibration.objective, calibration.evidence) : undefined)
  const prepared = await service.prepare({ saved, scoringInput: { ...input.scoringInput, rubric: JSON.parse(input.rubricSnapshot) }, leaseExpiresAt: input.job.leaseExpiresAt!,
    context: { assessmentOpportunityId: input.opportunity._id, submissionId: input.response._id, jobId: input.job._id,
      dispatchedAt: receipt.dispatchedAt, dispatchOrdinal: receipt.dispatchOrdinal, leaseIdentityHash: receipt.leaseIdentityHash, responseDigest: input.response.payloadDigest, assessmentPins: learnAssessmentPinsSchema.parse(input.opportunity.assessmentPins) } })
  return { service, prepared }
}

export async function deterministicLearnScoringReceipt(input: SavedLearnScoringInput, context: Pick<LearnScoringExecutionReceipt, 'dispatchedAt' | 'dispatchOrdinal' | 'leaseIdentityHash'>) {
  const spec = input.scoringSpec
  const payload = input.payload
  const binding = input.response.scoringBinding
  if (!spec || spec.kind === 'bounded_rubric' || binding.kind !== 'deterministic') throw new Error('Learn deterministic scoring unavailable')
  let correct: boolean
  if (spec.kind === 'keyed' && payload.kind === 'keyed') correct = spec.acceptedSets.some(set => scorerCanonicalJson([...set].sort()) === scorerCanonicalJson([...payload.keys].sort()))
  else if (spec.kind === 'ordered' && payload.kind === 'ordered') correct = scorerCanonicalJson(spec.expected) === scorerCanonicalJson(payload.entries)
  else if (spec.kind === 'numeric' && payload.kind === 'numeric') correct = payload.unit === spec.unit && Math.abs(payload.value - spec.expected) <= Math.max(spec.absoluteTolerance, Math.abs(spec.expected) * spec.relativeTolerance)
  else throw new Error('Learn response format mismatch')
  const verdict = { criterionResults: [{ key: 'answer', awarded: correct }], misconceptionTags: [], scorePercent: correct ? 100 : 0,
    responseDigest: input.response.payloadDigest, verdictDigest: await privacyDigest([spec.kind, correct]) }
  const snapshot = scorerCanonicalJson(binding)
  return learnScoringExecutionReceiptSchema.parse({ ...context, assessmentOpportunityId: input.opportunity._id,
    submissionId: input.response._id, jobId: input.job._id, responseDigest: input.response.payloadDigest,
    assessmentPins: input.opportunity.assessmentPins, scoringBinding: binding,
    frozenConfiguration: { digest: await privacyDigest(binding), snapshot }, requestDigest: await privacyDigest([input.response.payloadDigest, input.opportunity.assessmentPins]),
    requestBytes: new TextEncoder().encode(scorerCanonicalJson(payload)).byteLength, transportSettingsDigest: await privacyDigest(binding),
    observedIdentity: { status: 'deterministic', engineVersion: binding.engineVersion }, outcome: 'validated', verdict, usage: null, integrityResult: 'verified' })
}

export async function reserveSavedLearnScoring(ctx: MutationCtx, userId: string, submissionId: Id<'learnResponses'>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.scoring) return { kind: 'disabled' as const }
  const input = await requireSavedLearnScoringInput(ctx, userId, submissionId)
  const { job, opportunity } = input
  if (opportunity.authoritativeAttemptId) return { kind: 'completed' as const }
  const executions = await ctx.db.query('learnScoringExecutions').withIndex('by_userId_and_jobId_and_dispatchOrdinal', q => q.eq('userId', userId).eq('jobId', job._id)).take(limits.maxDispatchAttemptsPerJob + 1)
  if (executions.length > limits.maxDispatchAttemptsPerJob) throw new Error('Learn execution inventory exceeds its bound')
  const verified = executions.find(row => row.outcome === 'validated' && !row.authoritativeAttemptId)
  if (verified) return { kind: 'receipt' as const, executionId: verified._id }
  if (job.status === 'blocked' || opportunity.phase === 'invalid') return { kind: 'blocked' as const }
  if (job.status === 'running') {
    if ((job.leaseExpiresAt ?? 0) > Date.now()) return { kind: 'pending' as const }
    await ctx.db.patch(job._id, { status: 'blocked', terminalReason: 'provider_outcome_requires_reconciliation', revision: job.revision + 1, updatedAt: Date.now() })
    await ctx.db.patch(opportunity._id, { phase: 'reconciliation_required', reasonCode: 'provider_outcome_requires_reconciliation', revision: opportunity.revision + 1 })
    return { kind: 'blocked' as const }
  }
  if (job.status === 'leased' && (job.leaseExpiresAt ?? 0) > Date.now()) return { kind: 'pending' as const }
  if ((job.attempts ?? 0) >= limits.maxDispatchAttemptsPerJob) {
    await ctx.db.patch(job._id, { status: 'failed', terminalReason: 'scoring_attempt_limit', revision: job.revision + 1, updatedAt: Date.now() })
    await ctx.db.patch(opportunity._id, { phase: 'invalid', reasonCode: 'scoring_attempt_limit', revision: opportunity.revision + 1 })
    return { kind: 'blocked' as const }
  }
  const leaseToken = crypto.randomUUID()
  await ctx.db.patch(job._id, { status: 'leased', leaseToken, leaseExpiresAt: Date.now() + limits.leaseMs, revision: job.revision + 1, updatedAt: Date.now() })
  return { kind: 'acquired' as const, leaseToken }
}

export async function saveLearnScoringExecution(ctx: MutationCtx, userId: string, input: SavedLearnScoringInput, candidate: LearnScoringExecutionReceipt) {
  const receipt = learnScoringExecutionReceiptSchema.parse(candidate)
  const { job, response, opportunity } = input
  if (job.status !== 'leased' || !job.leaseToken || (job.leaseExpiresAt ?? 0) <= Date.now()
    || receipt.leaseIdentityHash !== await privacyDigest(job.leaseToken) || receipt.dispatchOrdinal !== (job.attempts ?? 0) + 1
    || receipt.dispatchOrdinal > limits.maxDispatchAttemptsPerJob || receipt.dispatchedAt > Date.now()
    || receipt.submissionId !== response._id || receipt.jobId !== job._id || receipt.assessmentOpportunityId !== opportunity._id
    || receipt.responseDigest !== response.payloadDigest || scorerCanonicalJson(receipt.scoringBinding) !== scorerCanonicalJson(response.scoringBinding)
    || scorerCanonicalJson(receipt.assessmentPins) !== scorerCanonicalJson(response.assessmentPins)
    || receipt.authoritativeAttemptId) throw new Error('Learn scoring execution conflicts')
  if (response.scoringBinding.kind === 'model') {
    const running = await ctx.db.query('learnJobs').withIndex('by_userId_and_status_and_leaseExpiresAt', q =>
      q.eq('userId', userId).eq('status', 'running').gt('leaseExpiresAt', Date.now())).take(limits.maxConcurrentPerLearner + 1)
    const recent = await ctx.db.query('learnMasteryScoringRateEvents').withIndex('by_userId_and_createdAt', q =>
      q.eq('userId', userId).gt('createdAt', Date.now() - limits.quotaWindowMs)).take(limits.maxProviderDispatchesPerWindow + 1)
    if (running.length >= limits.maxConcurrentPerLearner || recent.length >= limits.maxProviderDispatchesPerWindow) throw new Error('Learn scoring admission limit reached')
    const { prepared } = await prepareSavedLearnModelScoring(input, receipt)
    if (scorerCanonicalJson(prepared.receipt) !== scorerCanonicalJson(receipt)) throw new Error('Learn scoring request conflicts')
  } else if (scorerCanonicalJson(await deterministicLearnScoringReceipt(input, receipt)) !== scorerCanonicalJson(receipt)) throw new Error('Learn deterministic result conflicts')
  const { scopeKind: _kind, contextPins: _pins, ...capability } = response
  const executionId = await ctx.db.insert('learnScoringExecutions', { userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(),
    evidenceStatus: 'available', learningVoidId: capability.learningVoidId, blueprintRevisionId: capability.blueprintRevisionId,
    objectiveId: capability.objectiveId, blueprintRecordRevision: capability.blueprintRecordRevision,
    assessmentContractVersion: capability.assessmentContractVersion, assessmentContractDigest: capability.assessmentContractDigest, depth: capability.depth, ...receipt })
  if (response.scoringBinding.kind === 'model') await ctx.db.insert('learnMasteryScoringRateEvents', { userId, jobId: job._id,
    createdAt: Date.now(), expiresAt: Date.now() + limits.dailyQuotaWindowMs })
  await ctx.db.patch(job._id, { status: 'running', attempts: receipt.dispatchOrdinal, revision: job.revision + 1, updatedAt: Date.now() })
  await ctx.db.patch(opportunity._id, { phase: 'scoring_pending', revision: opportunity.revision + 1 })
  return executionId
}

export async function saveLearnModelScoringResult(ctx: MutationCtx, userId: string, executionId: Id<'learnScoringExecutions'>, result: LearnScoringExecutionResult) {
  const execution = await ctx.db.get(executionId)
  if (!execution || execution.userId !== userId || execution.outcome !== 'pending') throw new Error('Learn scoring receipt unavailable')
  const input = await requireSavedLearnScoringInput(ctx, userId, execution.submissionId)
  const { job, opportunity } = input
  if (job.status !== 'running' || !job.leaseToken || execution.leaseIdentityHash !== await privacyDigest(job.leaseToken)) throw new Error('Learn scoring receipt conflicts')
  const { service, prepared } = await prepareSavedLearnModelScoring(input, execution)
  if (scorerCanonicalJson(prepared.receipt) !== scorerCanonicalJson(receiptFields(execution))) throw new Error('Learn scoring request conflicts')
  if (result.receipt.outcome === 'validated' && !await service.isConsumable(prepared, result)) throw new Error('Learn scoring receipt is not verified')
  const receipt = learnScoringExecutionReceiptSchema.parse(result.receipt)
  const { observedIdentity: _identity, outcome: _outcome, verdict: _verdict, usage: _usage, integrityResult: _integrity, ...request } = receipt
  const { observedIdentity: _oldIdentity, outcome: _oldOutcome, verdict: _oldVerdict, usage: _oldUsage, integrityResult: _oldIntegrity, ...savedRequest } = prepared.receipt
  if (scorerCanonicalJson(request) !== scorerCanonicalJson(savedRequest)) throw new Error('Learn scoring result pins mismatch')
  await ctx.db.patch(executionId, { observedIdentity: receipt.observedIdentity, outcome: receipt.outcome, verdict: receipt.verdict, usage: receipt.usage, integrityResult: receipt.integrityResult })
  if (receipt.outcome !== 'validated') {
    const retryable = receipt.outcome === 'error' && ['not_dispatched', 'definitive_failure'].includes(result.terminal.failure ?? '')
    await ctx.db.patch(job._id, { status: retryable ? 'queued' : 'blocked', leaseToken: undefined, leaseExpiresAt: undefined,
      terminalReason: retryable ? 'provider_definitive_failure' : 'provider_outcome_requires_reconciliation', revision: job.revision + 1, updatedAt: Date.now() })
    await ctx.db.patch(opportunity._id, { phase: retryable ? 'retryable_failure' : 'reconciliation_required', reasonCode: receipt.integrityResult, revision: opportunity.revision + 1 })
  }
  return receipt.outcome === 'validated'
}

export function receiptFields(row: Doc<'learnScoringExecutions'>) {
  const { _id: _id, _creationTime: _time, userId: _user, storageVersion: _version, createdAt: _created,
    evidenceStatus: _evidence, invalidatedAt: _invalidated,
    learningVoidId: _void, blueprintRevisionId: _blueprint, objectiveId: _objective, blueprintRecordRevision: _revision,
    assessmentContractVersion: _contract, assessmentContractDigest: _digest, depth: _depth, ...receipt } = row
  return learnScoringExecutionReceiptSchema.parse(receipt)
}

export { getLearnMeasurementScorer } from './learnV2MeasurementScorerInventory'
