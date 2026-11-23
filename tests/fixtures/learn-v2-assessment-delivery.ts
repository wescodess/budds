/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test'
import { anyApi, type ApiFromModules } from 'convex/server'
import { vi } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import schema from '../../convex/schema'
import { MEASUREMENT_HARNESS_VERSION, measurementDigest, measurementItemAdapters } from '../../convex/lib/learnV2MeasurementItems'
import { learnMeasurementProtocolSchema } from '../../convex/lib/learnV2MeasurementAssignment'
import { LEARN_V2_MASTERY_LOOP_BLOCKS } from '../../shared/learn-v2-session-content'
import type { LearnScorerBinding } from '../../shared/learn-v2-measurement'
import { measurementReplacementModules } from './learn-v2-measurement-replacement'

const modules = import.meta.glob('../../convex/**/*.ts')
const commands = (anyApi as unknown as ApiFromModules<{ learnV2MeasurementItems: typeof import('../../convex/learnV2MeasurementItems') }>).learnV2MeasurementItems
export const deliveryIdentity = { tokenIdentifier: 'https://auth.example|measurement-publisher', subject: 'publisher' }
export const deliveryRubric = { version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const, responseFormat: 'short_text' as const,
  instructions: 'Apply the source rule.', passingScorePercent: 80 as const,
  criteria: [{ key: 'accuracy', description: 'PRIVATE-ORDINARY-RUBRIC', weightPercent: 100 }] }
const rubric = deliveryRubric
const binding = { kind: 'deterministic' as const, engineVersion: 'fixture.numeric.v1', thresholdVersion: 'threshold.v1',
  thresholdPercent: 80 as const, transitionVersion: 'learn-v2.mastery-transition.v1' as const }
const privateRubric = { kind: 'bounded_rubric' as const, keyInsufficientReason: 'The capability requires written reasoning.',
  criteria: [{ key: 'private-criterion', description: 'PRIVATE-RUBRIC-CANARY', weightPercent: 100 }] }
const modelBinding = { kind: 'model' as const, configurationId: 'fixture-only', configurationVersion: 'config.v1',
  configurationDigest: `sha256:${'f'.repeat(64)}`, requestedModel: 'offline-fixture-model', routingMode: 'strict' as const,
  endpoint: 'https://fixture.invalid/scorer', scorerVersion: 'scorer.v1', promptVersion: 'prompt.v1', responseSchemaVersion: 'response.v1',
  parserVersion: 'parser.v1', guardVersion: 'guard.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80 as const,
  transitionVersion: 'learn-v2.mastery-transition.v1' as const }

export function syntheticDeliveryProtocol(now = Date.now(), model = false) {
  return learnMeasurementProtocolSchema.parse({ version: 'synthetic.delivery-protocol.v1', epoch: 'synthetic.epoch.v1', baselineSha: 'b'.repeat(40),
    cohortVersion: 'synthetic.cohort.v1', schedulingPolicyVersion: 'synthetic.calendar.v1', enrollmentStartAt: now - 1000,
    enrollmentEndAt: now + 86_400_000, flows: ['v2_today', 'v2_canvas'], anchorKind: 'enrollment', coldWindowMs: 3_600_000, disambiguation: 'reject',
    replacementReasons: ['novel_item_unavailable', 'evidence_unavailable', 'contaminated', 'abandoned'],
    windows: [7, 30].map(horizonDays => ({ horizonDays, dueMinute: 0, openDayOffset: 0, openMinute: 0, closeDayOffset: 1, closeMinute: 0 })),
    scoringBinding: model ? modelBinding : binding })
}

export async function assessmentDeliveryFixture(options: { core?: 2 | 3, reserve?: boolean, reserveCount?: number, rubric?: boolean, keyed?: boolean, adapters?: boolean, scorerBinding?: LearnScorerBinding,
  test?: TestConvex<typeof schema>, identity?: typeof deliveryIdentity, inventory?: { claims: number, supports: number, sources: number, extraSupports?: number, backingDocuments?: boolean }, transactionLimits?: boolean } = {}) {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const identity = options.identity ?? deliveryIdentity
  const userId = identity.tokenIdentifier
  const t = options.test ?? convexTest({ schema, modules: { ...modules, ...measurementReplacementModules }, transactionLimits: options.transactionLimits ?? true })
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  const graph = await t.run(async ctx => {
    const now = Date.now()
    const folderId = await ctx.db.insert('folders', { userId, name: 'Synthetic rules', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Synthetic capability', status: 'scheduled', revision: 2, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, learningVoidId, blueprintId, revision: 1, recordRevision: 1, status: 'accepted', acceptedAt: now, createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Apply a rule', depth: 'working', assessmentContract: rubric })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId, studyPlanId, revision: 1, recordRevision: 1,
      blueprintRevisionId, blueprintRecordRevision: 1, status: 'accepted', acceptedAt: now, timezone: 'UTC', createdAt: now, updatedAt: now })
    await ctx.db.patch(studyPlanId, { activeRevisionId: studyPlanRevisionId })
    const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'planned', revision: 1, scheduledStartAt: now })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'synthetic-rule.v1' })
    const sourceContentHash = await measurementDigest('Synthetic source: total = groups * members.')
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId, blueprintRevisionId, sourceIdentityId,
      revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear',
      contentHash: sourceContentHash, sourceRevision: 'source.v1', createdAt: now })
    const excerpt = 'Synthetic rule: total equals groups multiplied by members per group. Source worked example: 2 groups of 3 yield 6.'
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId, locator: 'rule:1', excerpt, rightsStatus: 'permitted' })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId, coverage: 'strong' })
    const catalogId = await ctx.db.insert('learnAssessmentCatalogs', { userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: now,
      catalogRevision: 1, instrumentationEpoch: 'synthetic.epoch.v1', historyCompleteness: 'prospective_complete', historyBasisVersion: 'synthetic.history.v1',
      historyCoverageWatermark: 'synthetic.coverage.v1', measurementCapability: { enabled: true } })
    const support = { sourceSnapshotId, sourceSnapshotRevision: 1, sourceRecordRevision: 1, sourceContentHash, sourceRevision: 'source.v1',
      sourceExcerptId, excerptDigest: await measurementDigest(excerpt), locatorDigest: await measurementDigest('rule:1'), supportRevision: 1,
      rightsStatus: 'permitted' as const, accessStatus: 'available' as const, conflictStatus: 'none' as const, entailment: 'entailed' as const,
      verifierVersion: 'fixture.rule-verifier.v1', verifierModel: 'deterministic-fixture' }
    return { learningVoidId, blueprintRevisionId, objectiveId, studyPlanId, studyPlanRevisionId, studySessionId, sourceIdentityId,
      sourceSnapshotId, sourceExcerptId, catalogId, support: { ...support, supportDigest: await measurementDigest(support) } }
  })
  const core = options.core ?? 3
  const labels = 'ABC'.slice(0, core) + 'DEF'.slice(0, options.reserveCount ?? (options.reserve ? 1 : 0))
  const members = [...labels].map((formLabel, index) => {
    const groups = index + 3
    const size = index + 5
    const prompt = `Hypothetical ${formLabel}: ${groups} groups of ${size} members. Find the total.`
    return { formLabel, reserve: index >= core, prompt, declaredStimulus: `Hypothetical givens: groups=${groups}, size=${size}.`,
      responseSpec: options.rubric ? { kind: 'bounded_rubric', version: 'response.v1', maxCodeUnits: 12000 }
        : options.keyed ? { kind: 'keyed', version: 'response.v1', maxSelections: 1 } : { kind: 'numeric', version: 'response.v1', unit: 'members' },
      privateScoring: options.rubric ? privateRubric : options.keyed ? { kind: 'keyed', acceptedSets: [[String(groups * size)]], normalizationVersion: 'normalize.v1' }
        : { kind: 'numeric', expected: groups * size, unit: 'members', absoluteTolerance: 0, relativeTolerance: 0, normalizationVersion: 'normalize.v1' },
      referenceSolution: `PRIVATE-SOLUTION-${formLabel}: ${groups} * ${size} = ${groups * size}.`, derivation: `${groups} * ${size} follows the source multiplication rule.`,
      scoringBinding: options.scorerBinding ?? (options.rubric ? modelBinding : binding),
      claims: (['stimulus', options.rubric ? 'rubric' : 'key', 'solution'] as const).map((part, order) => ({ order, part,
        claim: `${part} uses the multiplication rule.`, revision: 1, supports: [graph.support] })) }
  })
  if (options.inventory) {
    const inventory = options.inventory
    const supports = await t.run(async ctx => {
      const { _id: _identityId, _creationTime: _identityTime, ...identity } = (await ctx.db.get(graph.sourceIdentityId))!
      const { _id: _sourceId, _creationTime: _sourceTime, ...source } = (await ctx.db.get(graph.sourceSnapshotId))!
      const { _id: _excerptId, _creationTime: _excerptTime, ...excerpt } = (await ctx.db.get(graph.sourceExcerptId))!
      const rows = [graph.support]
      for (let index = 1; index < inventory.sources; index++) {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { ...identity, externalKey: `inventory-source-${index}` })
        const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { ...source, sourceIdentityId })
        const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { ...excerpt, sourceSnapshotId })
        await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: graph.objectiveId, sourceSnapshotId, coverage: 'strong' })
        const { supportDigest: _digest, ...fields } = graph.support
        const pin = { ...fields, sourceSnapshotId, sourceExcerptId }
        rows.push({ ...pin, supportDigest: await measurementDigest(pin) })
      }
      if (inventory.backingDocuments) for (const pin of rows) {
        const snapshot = (await ctx.db.get(pin.sourceSnapshotId))!
        const folderId = await ctx.db.insert('folders', { userId, name: 'Inventory document', documentCount: 1 })
        const folderDocumentId = await ctx.db.insert('documents', { userId, folderId, filename: 'inventory.txt', fileSize: 1,
          status: 'success', contentHash: snapshot.contentHash, sourceRevision: snapshot.sourceRevision })
        await ctx.db.patch(snapshot.sourceIdentityId, { origin: 'folder_document', folderDocumentId })
      }
      return rows
    })
    for (const member of members) member.claims = Array.from({ length: inventory.claims }, (_, order) => ({ ...member.claims[order % 3]!, order,
      supports: Array.from({ length: Math.min(8, inventory.supports + Math.max(0, (inventory.extraSupports ?? 0) - order * (8 - inventory.supports))) }, (_, index) => supports[(order * inventory.supports + index) % supports.length]!) }))
  }
  const generated = { generatorVersion: 'fixture.generation.v1', members }
  if (options.adapters !== false) {
    vi.spyOn(measurementItemAdapters, 'generate').mockResolvedValue(generated)
    vi.spyOn(measurementItemAdapters, 'sourceKey').mockImplementation(async ({ member }) => {
      const numbers = /groups=(\d+), size=(\d+)/u.exec(member.declaredStimulus ?? '')
      const correct = !!numbers && (member.privateScoring.kind !== 'numeric' || member.privateScoring.expected === Number(numbers[1]) * Number(numbers[2]))
      return { decision: correct ? 'pass' : 'reject', coverage: 'complete', coveredParts: member.claims.map(claim => claim.part) }
    })
    vi.spyOn(measurementItemAdapters, 'compare').mockImplementation(async ({ content, corpus, sources, purpose }) => ({
      decision: JSON.stringify(content).includes('PARAPHRASE-CLONE') || purpose === 'instructional' && JSON.stringify(content).includes('PRIVATE-SOLUTION') && corpus.length > 0 ? 'reject' : 'pass',
      coverage: purpose === 'measurement' && !sources.length ? 'unknown' : 'complete',
    }))
    vi.spyOn(measurementItemAdapters, 'equivalence').mockResolvedValue({ decision: 'pass', coverage: 'complete' })
    vi.spyOn(measurementItemAdapters, 'harness').mockImplementation(async ({ itemDigest, scoringDigest, sourceKeyDigest }) => ({
      version: MEASUREMENT_HARNESS_VERSION, evidenceStatus: 'offline_contract_only', artifactDigest: await measurementDigest({ itemDigest, scoringDigest, sourceKeyDigest }),
      itemDigest, scoringDigest, sourceKeyDigest, checks: { sourceKeyProof: true, wrong: true, partial: true, injection: true, scorer: true },
    }))
  }
  const descriptor = { operation: 'Apply multiplication', contentCoverage: 'One accepted synthetic rule', transferDemand: 'A different hypothetical case',
    responseModality: options.rubric ? 'bounded_rubric' : options.keyed ? 'keyed' : 'numeric', scoreScale: 'percent_0_100',
    criteriaDigest: await measurementDigest(options.rubric ? privateRubric.criteria : { kind: options.keyed ? 'keyed' : 'numeric' }), thresholdVersion: 'threshold.v1',
    rationale: 'Synthetic comparability fixture only.', difficultyPrior: 'Unverified outside this fixture.' }
  const begun = await t.mutation(commands.beginFamilyGeneration, { tokenIdentifier: userId, studySessionId: graph.studySessionId, expectedSessionRevision: 1,
    familyKey: 'synthetic.family.v1', revision: 1, coreFormCount: core, equivalenceVersion: 'equivalence.v1', equivalenceDescriptorJson: JSON.stringify(descriptor), idempotencyKey: 'fixture-generation' })
  if (!begun.leaseToken) throw new Error('Expected an active lease')
  const args = { tokenIdentifier: userId, jobId: begun.jobId, leaseToken: begun.leaseToken, expectedRevision: begun.revision }
  const staged = await t.mutation(commands.generateFamilyCandidates, args)
  if (!('revision' in staged)) throw new Error('Synthetic family did not stage')
  const validated = await t.mutation(commands.validateFamily, { ...args, expectedRevision: staged.revision })
  if (validated.status !== 'validated') throw new Error('Synthetic family did not validate')
  await t.mutation(commands.publishFamily, { ...args, expectedRevision: validated.revision })
  return { t, owner, graph, begun, args, generated, descriptor }
}

export async function publishDeliveryTeaching(f: Pick<Awaited<ReturnType<typeof assessmentDeliveryFixture>>, 't' | 'graph'>) {
  const session = await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))
  if (!session) throw new Error('Missing teaching session')
  const userId = session.userId
  const jobId = await f.t.run(ctx => ctx.db.insert('learnJobs', { userId, learningVoidId: f.graph.learningVoidId,
    blueprintRevisionId: f.graph.blueprintRevisionId, studyPlanRevisionId: f.graph.studyPlanRevisionId, studySessionId: f.graph.studySessionId,
    type: 'session_content_generation', status: 'running', revision: 1, providerResponseModel: 'synthetic/model', idempotencyKey: 'synthetic-teaching-job', inputDigest: `sha256:${'a'.repeat(64)}`,
    expectedVoidRevision: 2, expectedBlueprintRecordRevision: 1, expectedSessionRevision: 1, attempts: 1,
    leaseToken: 'synthetic-teaching-lease', leaseExpiresAt: Date.now() + 60_000, dispatchSupportingSourceSnapshotIds: [f.graph.sourceSnapshotId] }))
  const candidate = { version: 'learn-v2.session-content.v1', generatorVersion: 'synthetic.teaching.v1', assessmentRubric: rubric,
    blocks: LEARN_V2_MASTERY_LOOP_BLOCKS.map((kind, order) => ({ order, kind, content: `TEACHING-CANARY-${kind}: a separate practice case.`, claimOrders: [0] })),
    claims: [{ order: 0, claim: 'TEACHING-CLAIM-CANARY: the source supports the separate practice case.', supportSourceSnapshotIds: [String(f.graph.sourceSnapshotId)] }] }
  const published = await f.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, {
    tokenIdentifier: userId, jobId, leaseToken: 'synthetic-teaching-lease', expectedRevision: 1, candidateJson: JSON.stringify(candidate),
    verifierDecisionsJson: JSON.stringify({ version: 'learn-v2.entailment.v2', decisions: [{ claimOrder: 0, sourceSnapshotId: String(f.graph.sourceSnapshotId),
      sourceExcerptId: String(f.graph.sourceExcerptId), decision: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.99 }] }),
  })
  if (published.status !== 'ready') throw new Error('Synthetic teaching did not publish')
  return published.sessionContentId
}
