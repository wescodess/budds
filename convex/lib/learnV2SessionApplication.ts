import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../../shared/learn-v2-responses'
import { baselineMasteryScoringArtifacts } from '../../server/utils/learn-v2-mastery-scorer'
import { sessionMeasurementScope } from './learnV2MeasurementItems'
import { normalizedInstructionalCaseFingerprints } from './learnV2ArtifactLineage'
import { isLearnV2ContentEvidenceReady } from './learnV2ContentEvidenceReady'
import { getLearnMeasurementScorer } from './learnV2MeasurementScorerInventory'
import { grantLearnAssessmentDeliveryForOwner } from './learnV2AssessmentDelivery'
import { privacyDigest } from './learnV2ResponsePrivacy'

export async function bindSessionApplication(ctx: MutationCtx, userId: string, session: Doc<'studySessions'>, content: Doc<'sessionContent'>, surface: 'today' | 'canvas' = 'today') {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || !LEARN_MEASUREMENT_CAPABILITIES.enrollment || !LEARN_MEASUREMENT_CAPABILITIES.delivery) return
  const catalog = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).unique()
  if (!catalog?.measurementCapability?.enabled) return
  const historyKnown = catalog.historyCompleteness === 'prospective_complete' && !!catalog.historyBasisVersion
    && !!catalog.historyCoverageWatermark && !!catalog.instrumentationEpoch && session._creationTime >= catalog.createdAt
  const existing = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
    q.eq('userId', userId).eq('contextPins.studySessionId', session._id)).take(2)
  if (existing.length) throw new Error('Learn application is already bound')
  const { scope, plan } = await sessionMeasurementScope(ctx, userId, session)
  if (!await isLearnV2ContentEvidenceReady(ctx, userId, content, scope.learningVoidId)) return
  if (session.status !== 'in_progress' || session.startedSessionContentId !== content._id || !content.inputDigest || !content.generatorVersion) throw new Error('Learn application evidence unavailable')
  const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
  const prompts = blocks.filter(block => block.kind === 'independent_application' && block.content)
  if (blocks.length > 16 || prompts.length !== 1 || !content.assessmentRubricSnapshot) throw new Error('Learn application prompt unavailable')
  const rubric = JSON.parse(content.assessmentRubricSnapshot) as { version: string }
  const fingerprints = await normalizedInstructionalCaseFingerprints(prompts[0]!.content!, prompts[0]!.content!)
  const cases = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint_and_solutionFingerprint', q =>
    q.eq('userId', userId).eq('scenarioFingerprint', fingerprints.scenarioFingerprint).eq('solutionFingerprint', fingerprints.solutionFingerprint)).take(2)
  const caseRow = cases[0]
  if (cases.length !== 1 || !caseRow || caseRow.usageClass !== 'instructional' || caseRow.reservedAt !== undefined) throw new Error('Learn application case unavailable')
  const { registry } = await getLearnMeasurementScorer()
  const { binding } = registry.resolveNew({ kind: 'legacy_published', publishedContent: { providerModel: content.providerModel ?? '',
    requestSettingsDigest: (await baselineMasteryScoringArtifacts()).requestSettingsDigest } })
  const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(33)
  const supports = []
  for (const claim of claims) supports.push(...await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9))
  const now = Date.now()
  const id = await ctx.db.insert('learnAssessmentOpportunities', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now,
    ...scope, scopeKind: 'v2', evidenceStatus: 'available',
    contextPins: { kind: 'session', studyPlanId: plan.studyPlanId, studyPlanRevisionId: plan._id, planRevision: plan.revision,
      planRecordRevision: plan.recordRevision!, studySessionId: session._id, sessionRevision: session.revision,
      sessionContentId: content._id, contentRevision: content.revision, contentInputDigest: content.inputDigest, generatorVersion: content.generatorVersion },
    delayedCheckId: await privacyDigest(['learn-v2.session-application.v1', session._id, content._id]), purpose: { kind: 'independent_application' },
    assessmentPins: { kind: 'session_application', caseId: caseRow._id, promptDigest: await privacyDigest(prompts[0]!.content),
      rubricVersion: rubric.version, rubricDigest: await privacyDigest(rubric), supportManifestDigest: await privacyDigest(supports) },
    scoringBinding: binding, phase: 'ready', revision: 1, eligibilityPolicyVersion: 'learn-v2.session-application.v1', operationalEligibility: 'eligible',
    openAt: now, closeAt: Math.min(session.scheduledEndAt === undefined ? 8_640_000_000_000_000 : session.scheduledEndAt + 1, 8_640_000_000_000_000),
    checkSequence: 0, originalSlot: true, deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
  await ctx.db.patch(session._id, { assessmentPurpose: 'independent_application', assessmentOpportunityId: id,
    assistanceRevision: session.assistanceRevision ?? (historyKnown ? 0 : undefined) })
  if (surface === 'canvas') return id
  const grant = await grantLearnAssessmentDeliveryForOwner(ctx, userId, { assessmentOpportunityId: id, expectedRevision: 1,
    idempotencyKey: (await privacyDigest(['learn-v2.session-application.v1', session._id])).slice(7), flow: 'today' })
  if (grant.status !== 'granted') throw new Error(`Learn application delivery unavailable: ${grant.status === 'unavailable' ? grant.reasonCodes.join(',') : 'disabled'}`)
  return id
}
