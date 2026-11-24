import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_ITEM_LIMITS as limits, MeasurementItemBoundsError } from '../../shared/learn-v2-measurement-item-limits'
import { LearnScoringInputError } from '../../shared/learn-v2-errors'
import { learnPrivateScoringPayloadSchema } from '../../shared/learn-v2-measurement'
import type { LearnResponsePayload } from '../../shared/learn-v2-responses'
import { assertMeasurementScoringContract } from '../../server/utils/learn-v2-measurement-item-contract'
import { scorerCanonicalJson, type BaselineMasteryScoringInput } from '../../server/utils/learn-v2-mastery-scorer'

export function measurementLearnerResponse(payload: LearnResponsePayload) {
  return payload.kind === 'text' ? payload.text : payload.kind === 'source_comparison' ? payload.comparison : scorerCanonicalJson(payload)
}

export async function readMeasurementScoringInput(ctx: Pick<QueryCtx, 'db'>, userId: string, itemId: Id<'learnMeasurementItems'>,
  rubric: BaselineMasteryScoringInput['rubric'], learnerResponse?: string) {
  const item = await ctx.db.get(itemId)
  const spec = item?.scoringSpecId ? await ctx.db.get(item.scoringSpecId) : null
  if (!item || !spec || item.userId !== userId || spec.userId !== userId || spec.itemId !== item._id || !item.prompt) throw new LearnScoringInputError('Learn scoring item unavailable')
  const payload = learnPrivateScoringPayloadSchema.parse(spec.payload)
  const evidence: BaselineMasteryScoringInput['evidence'] = []
  const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', itemId)).take(limits.claims + 1)
  if (!claims.length || claims.length > limits.claims) throw new MeasurementItemBoundsError('item_evidence_limit')
  for (const claim of claims) {
    const supports = await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_claimId', q => q.eq('userId', userId).eq('claimId', claim._id)).take(limits.supportsPerClaim + 1)
    if (!supports.length || supports.length > limits.supportsPerClaim || evidence.length + supports.length > limits.evidenceRows) throw new MeasurementItemBoundsError('item_evidence_limit')
    for (const support of supports) {
      const excerpt = await ctx.db.get(support.sourceExcerptId)
      if (!excerpt?.excerpt || excerpt.userId !== userId) throw new LearnScoringInputError('Learn scoring evidence unavailable')
      evidence.push({ alias: `S${evidence.length + 1}`, claim: claim.claim ?? '', excerpt: excerpt.excerpt })
    }
  }
  const input: BaselineMasteryScoringInput = { rubric: payload.kind === 'bounded_rubric' ? { version: rubric.version, criteria: payload.criteria } : rubric,
    challenge: item.prompt, evidence, ...(payload.kind === 'bounded_rubric' ? { declaredStimulus: item.declaredStimulus ?? null } : {}), learnerResponse: learnerResponse ?? 'x' }
  assertMeasurementScoringContract(input, spec.scoringBinding, learnerResponse !== undefined)
  return { item, spec, payload, input }
}
