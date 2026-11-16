import { v } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import {
  beginMeasurementFamily, getValidatedMeasurementFamily, publishMeasurementFamily, quarantineMeasurementFamily,
  requireFamilyJob, selectUnusedMeasurementReserve, stageMeasurementFamily, validateMeasurementFamily,
} from './lib/learnV2MeasurementItems'

const leaseArgs = { tokenIdentifier: v.string(), jobId: v.id('learnJobs'), leaseToken: v.string(), expectedRevision: v.number() }
const reasons = new Set(['measurement_disabled', 'unknown_history', 'access_revoked', 'pins_mismatch', 'unmeasurable_no_t0',
  'evidence_unavailable', 'support_pins_mismatch', 'claim_pins_mismatch', 'item_pins_mismatch', 'case_collision',
  'comparison_coverage_unknown', 'form_comparability_unknown', 'source_key_coverage_unknown', 'harness_artifact_unavailable',
  'validation_pins_mismatch', 'catalog_revision_conflict', 'family_members_invalid'])
async function rejectFamily(ctx: MutationCtx, job: Doc<'learnJobs'>, family: Doc<'learnMeasurementFamilies'>, error: unknown) {
  const reasonCode = error instanceof Error && reasons.has(error.message) ? error.message : 'validation_unavailable'
  await quarantineMeasurementFamily(ctx, family, reasonCode)
  await ctx.db.patch(job._id, { status: 'blocked', terminalReason: reasonCode, checkpoint: undefined,
    leaseToken: undefined, leaseExpiresAt: undefined, revision: job.revision + 1, updatedAt: Date.now() })
  return { status: 'quarantined' as const, reasonCode }
}

export const beginFamilyGeneration = internalMutation({
  args: { tokenIdentifier: v.string(), studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(),
    familyKey: v.string(), revision: v.number(), coreFormCount: v.union(v.literal(2), v.literal(3)),
    equivalenceVersion: v.string(), equivalenceDescriptorJson: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => beginMeasurementFamily(ctx, args.tokenIdentifier, args),
})

export const generateFamilyCandidates = internalMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const { job, family } = await requireFamilyJob(ctx, args.tokenIdentifier, args.jobId, args.leaseToken, args.expectedRevision)
    try { return await stageMeasurementFamily(ctx, job, family) }
    catch (error) { return rejectFamily(ctx, job, family, error) }
  },
})

export const validateFamily = internalMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const { job, family } = await requireFamilyJob(ctx, args.tokenIdentifier, args.jobId, args.leaseToken, args.expectedRevision)
    try { return await validateMeasurementFamily(ctx, job, family) }
    catch (error) { return rejectFamily(ctx, job, family, error) }
  },
})

export const publishFamily = internalMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const { job, family } = await requireFamilyJob(ctx, args.tokenIdentifier, args.jobId, args.leaseToken, args.expectedRevision)
    try { return await publishMeasurementFamily(ctx, job, family) }
    catch (error) { return rejectFamily(ctx, job, family, error) }
  },
})

export const invalidateFamily = internalMutation({
  args: { tokenIdentifier: v.string(), familyId: v.id('learnMeasurementFamilies'), expectedRecordRevision: v.number(),
    reasonCode: v.union(v.literal('wrong_key'), v.literal('case_collision'), v.literal('support_loss'), v.literal('invalid_validation'), v.literal('retired')) },
  handler: async (ctx, args) => {
    const family = await ctx.db.get(args.familyId)
    if (!family || family.userId !== args.tokenIdentifier || family.recordRevision !== args.expectedRecordRevision) throw new Error('family_revision_conflict')
    await quarantineMeasurementFamily(ctx, family, args.reasonCode, args.reasonCode === 'retired')
    return { status: args.reasonCode === 'retired' ? 'retired' as const : 'quarantined' as const, recordRevision: family.recordRevision + 1 }
  },
})

export const getValidatedFamily = internalQuery({
  args: { tokenIdentifier: v.string(), familyId: v.id('learnMeasurementFamilies') },
  handler: async (ctx, args) => getValidatedMeasurementFamily(ctx, args.tokenIdentifier, args.familyId),
})

export const getUnusedReserve = internalQuery({
  args: { tokenIdentifier: v.string(), familyId: v.id('learnMeasurementFamilies'), excludedCaseIds: v.array(v.id('learnAssessmentCases')) },
  handler: async (ctx, args) => {
    if (args.excludedCaseIds.length > 6) throw new Error('reserve_request_invalid')
    return selectUnusedMeasurementReserve(ctx, args.tokenIdentifier, args.familyId, args.excludedCaseIds)
  },
})
