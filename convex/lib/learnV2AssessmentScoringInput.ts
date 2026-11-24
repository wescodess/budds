import type { Doc } from '../_generated/dataModel'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { BaselineMasteryScoringInput } from '../../server/utils/learn-v2-mastery-scorer'
import { assertMeasurementScoringContract, assertMeasurementScoringTransportContract } from '../../server/utils/learn-v2-measurement-item-contract'
import { LEARN_MEASUREMENT_RUBRIC_SCORER_VERSION } from '../../server/utils/learn-v2-measurement-rubric-scorer'
import { LEARN_MEASUREMENT_STORAGE_LIMITS as storage } from '../../shared/learn-v2-measurement-storage-manifest'
import { LearnScoringInputError } from '../../shared/learn-v2-errors'
import { learnMeasurementItemPinsSchema, type learnPrivateScoringPayloadSchema } from '../../shared/learn-v2-measurement'
import { calibrationEvidence } from '../learnV2MapCalibration'
import { learnCalibrationScoringProtocol } from './learnV2MeasurementCalibrationScorer'
import { measurementItemReason, measurementScopeReason } from './learnV2Measurement'
import { readMeasurementScoringInput } from './learnV2MeasurementItemContract'
import { privacyDigest } from './learnV2ResponsePrivacy'

export async function readLearnAssessmentScoringInput(ctx: QueryCtx | MutationCtx, userId: string,
  opportunity: Doc<'learnAssessmentOpportunities'>, mode: 'publication' | 'acceptance' | 'recovery', learnerResponse: string) {
  if (opportunity.userId !== userId) throw new LearnScoringInputError('Learn scoring access denied')
  const objective = await ctx.db.get(opportunity.objectiveId)
  if (!objective || objective.userId !== userId || !objective.assessmentContract || typeof objective.assessmentContract === 'string'
    || await privacyDigest(objective.assessmentContract) !== opportunity.assessmentContractDigest) throw new LearnScoringInputError('Learn scoring rubric unavailable')
  const contract = objective.assessmentContract
  let scoringInput: BaselineMasteryScoringInput
  let scoringSpec: ReturnType<typeof learnPrivateScoringPayloadSchema.parse> | null = null
  let rubricSnapshot: string | null = null
  if (opportunity.assessmentPins.kind === 'measurement') {
    const pins = opportunity.assessmentPins.itemPins
    if (mode === 'recovery') {
      const reason = await measurementScopeReason(ctx, userId, opportunity)
        ?? await measurementItemReason(ctx, userId, learnMeasurementItemPinsSchema.parse(pins), opportunity, opportunity.scoringBinding)
      if (reason) throw new LearnScoringInputError('Learn scoring evidence unavailable')
    }
    const measured = await readMeasurementScoringInput(ctx, userId, pins.itemId,
      { version: contract.version, criteria: contract.criteria }, learnerResponse, mode)
    scoringSpec = measured.payload
    scoringInput = measured.input
    if (mode === 'recovery' && scoringSpec.kind === 'bounded_rubric') {
      if (await privacyDigest({ prompt: measured.item.prompt, declaredStimulus: measured.item.declaredStimulus ?? null,
        responseSpec: measured.item.responseSpec }) !== pins.promptDigest) throw new LearnScoringInputError('Learn scoring stimulus pins mismatch')
      if (opportunity.scoringBinding.kind !== 'model' || opportunity.scoringBinding.scorerVersion !== LEARN_MEASUREMENT_RUBRIC_SCORER_VERSION) throw new LearnScoringInputError('Learn declared stimulus scorer configuration required')
    }
  } else {
    const blueprint = await ctx.db.get(opportunity.blueprintRevisionId)
    const learningVoid = await ctx.db.get(opportunity.learningVoidId)
    if (!blueprint || blueprint.userId !== userId || blueprint.recordRevision !== opportunity.blueprintRecordRevision
      || learningVoid?.activeBlueprintRevisionId !== blueprint._id) throw new LearnScoringInputError('Learn scoring pins mismatch')
    const evidence: BaselineMasteryScoringInput['evidence'] = []
    let rubric = { version: contract.version as string, criteria: contract.criteria }
    let challenge = contract.instructions
    if (opportunity.contextPins.kind === 'session') {
      const pins = opportunity.contextPins
      const content = await ctx.db.get(pins.sessionContentId)
      const session = await ctx.db.get(pins.studySessionId)
      if (!content || content.userId !== userId || content.revision !== pins.contentRevision || content.status !== 'published'
        || session?.userId !== userId || mode !== 'publication' && session.startedSessionContentId !== content._id) throw new LearnScoringInputError('Learn scoring pins mismatch')
      rubricSnapshot = content.assessmentRubricSnapshot ?? null
      rubric = JSON.parse(rubricSnapshot ?? 'null')
      if (!rubric || opportunity.assessmentPins.kind !== 'session_application' || await privacyDigest(rubric) !== opportunity.assessmentPins.rubricDigest) throw new LearnScoringInputError('Learn scoring rubric unavailable')
      const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
      const prompts = blocks.filter(row => (row.kind === 'independent_application' || row.kind === 'transfer_challenge') && row.content)
      if (blocks.length > 16 || prompts.length !== 1 || await privacyDigest(prompts[0]!.content) !== opportunity.assessmentPins.promptDigest) throw new LearnScoringInputError('Learn scoring prompt unavailable')
      challenge = prompts[0]!.content!
      const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(storage.maxClaims + 1)
      if (!claims.length || claims.length > storage.maxClaims) throw new LearnScoringInputError('Learn scoring evidence unavailable')
      for (const claim of claims) {
        const supports = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(storage.maxSupportsPerClaim + 1)
        if (!supports.length || supports.length > storage.maxSupportsPerClaim) throw new LearnScoringInputError('Learn scoring evidence unavailable')
        for (const support of supports) {
          const excerpt = await ctx.db.get(support.sourceExcerptId)
          if (support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available'
            || !excerpt?.excerpt || excerpt.userId !== userId || excerpt.evidencePurgedAt !== undefined) throw new LearnScoringInputError('Learn scoring evidence unavailable')
          evidence.push({ alias: `S${evidence.length + 1}`, claim: claim.claim, excerpt: excerpt.excerpt })
        }
      }
    } else {
      const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(9)
      if (!links.length || links.length > 8) throw new LearnScoringInputError('Learn scoring evidence unavailable')
      for (const link of links) {
        const excerpts = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', link.sourceSnapshotId)).take(1)
        if (!excerpts[0]?.excerpt) throw new LearnScoringInputError('Learn scoring evidence unavailable')
        evidence.push({ alias: `S${evidence.length + 1}`, claim: objective.title, excerpt: excerpts[0].excerpt })
      }
    }
    scoringInput = { rubric, challenge, evidence, learnerResponse }
  }
  const calibration = opportunity.purpose.kind === 'calibration' ? { objective: { title: objective.title, capability: objective.capability,
    assessmentContract: objective.assessmentContract }, evidence: (await calibrationEvidence(ctx, userId, objective._id)).evidence } : null
  const request = calibration ? learnCalibrationScoringProtocol(calibration.objective, calibration.evidence).request : undefined
  if (mode === 'recovery') assertMeasurementScoringTransportContract(scoringInput, opportunity.scoringBinding, request)
  else assertMeasurementScoringContract(scoringInput, opportunity.scoringBinding, mode === 'acceptance', request)
  return { scoringInput, scoringSpec, rubricSnapshot: rubricSnapshot ?? JSON.stringify(scoringInput.rubric),
    calibrationSnapshot: calibration ? JSON.stringify(calibration) : null }
}
