import { convexTest } from 'convex-test'
import { api, internal } from '../../convex/_generated/api'
import schema from '../../convex/schema'
import { seedMeasurementStorage } from './learn-v2-measurement-storage'
import { privacyDigest } from '../../convex/lib/learnV2ResponsePrivacy'
import { LEARN_HELP_ADMISSION_VERSION, type LearnHelpReference } from '../../convex/lib/learnV2HelpContract'
export const HELP_OWNER = { tokenIdentifier: 'https://owner.example|help-owner', subject: 'same-subject' }
const OWNER = HELP_OWNER
const FOREIGN = { tokenIdentifier: 'https://foreign.example|help-owner', subject: OWNER.subject }
const command = { version: LEARN_HELP_ADMISSION_VERSION, kind: 'chat' as const, idempotencyKey: 'help_command_1234567890' }
const HASH = `sha256:${'a'.repeat(64)}`

export async function helpConsumerFixture(modules: Record<string, () => Promise<unknown>>, testOnly = true) {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, FOREIGN]) {
    await t.withIdentity(identity).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  }
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  const contract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const,
    instructions: 'Apply the rule.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'Correct application', weightPercent: 100 }] }
  const contractDigest = await privacyDigest(contract)
  await t.run(async ctx => {
    await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.scope.objectiveId, { depth: 'working', assessmentContract: contract })
    await ctx.db.insert('learnObjectiveSources', { userId: OWNER.tokenIdentifier, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
    await ctx.db.patch(f.scope.contextPins.studyPlanId, { activeRevisionId: f.scope.contextPins.studyPlanRevisionId })
    await ctx.db.patch(f.scope.contextPins.studyPlanRevisionId, { status: 'accepted', blueprintRevisionId: f.scope.blueprintRevisionId, blueprintRecordRevision: 1 })
    await ctx.db.patch(f.studySessionId, { status: 'in_progress', startedSessionContentId: f.scope.contextPins.sessionContentId, startedSessionContentRevision: 1, assistanceRevision: 0 })
    await ctx.db.patch(f.scope.contextPins.sessionContentId, { blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId,
      studyPlanRevisionId: f.scope.contextPins.studyPlanRevisionId, inputDigest: HASH, generatorVersion: f.scope.contextPins.generatorVersion })
    await ctx.db.patch(f.rows.learnAssessmentOpportunities, { assessmentContractVersion: contract.version, assessmentContractDigest: contractDigest, phase: 'test_open', submissionId: undefined,
      contextPins: { kind: 'planned_measurement', studyPlanId: f.scope.contextPins.studyPlanId,
        studyPlanRevisionId: f.scope.contextPins.studyPlanRevisionId, planRevision: 1, planRecordRevision: 1 },
      assessmentPins: { kind: 'measurement', itemPins: { ...f.itemPins, promptDigest: HASH, scoringSpecDigest: HASH, supportManifestDigest: HASH } },
      ...(!testOnly ? { purpose: { kind: 'calibration' as const }, contextPins: { kind: 'calibration' as const, origin: 'today' as const },
        assignmentId: undefined, assessmentPins: { kind: 'calibration' as const, caseId: f.itemPins.caseId, promptDigest: await privacyDigest(contract.instructions),
          assessmentContractVersion: contract.version, assessmentContractDigest: contractDigest, supportManifestDigest: HASH } } : {}) })
  })
  const owner = t.withIdentity(OWNER)
  const admit = (references: LearnHelpReference[] | null, key = command.idempotencyKey) => owner.mutation(api.learnV2Assistance.admitHelp, {
    ...command, idempotencyKey: key, scope: references ? { references } : null,
  })
  const exposures = () => t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(64))
  return { t, f, owner, admit, exposures }
}
