import { convexTest } from 'convex-test'
import { anyApi, type ApiFromModules } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import schema from './schema'
import {
  MEASUREMENT_HARNESS_VERSION, measurementDigest, measurementItemAdapters,
} from './lib/learnV2MeasurementItems'
import { normalizedInstructionalCaseFingerprints } from './lib/learnV2ArtifactLineage'
import { LEARN_V2_MASTERY_LOOP_BLOCKS } from '../shared/learn-v2-session-content'
import { learnMeasurementCoverage, learnMeasurementAllocationSchema } from '../shared/learn-v2-measurement'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'

const commands = (anyApi as unknown as ApiFromModules<{ learnV2MeasurementItems: typeof import('./learnV2MeasurementItems') }>).learnV2MeasurementItems
const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example|measurement-publisher', subject: 'publisher' }
const foreign = { tokenIdentifier: 'https://foreign.example|measurement-publisher', subject: 'publisher' }
const userId = identity.tokenIdentifier
const rubric = { version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const, responseFormat: 'short_text' as const,
  instructions: 'Apply the source rule.', passingScorePercent: 80 as const,
  criteria: [{ key: 'accuracy', description: 'Apply the pinned rule correctly.', weightPercent: 100 }] }
const binding = { kind: 'deterministic' as const, engineVersion: 'fixture.numeric.v1', thresholdVersion: 'threshold.v1',
  thresholdPercent: 80 as const, transitionVersion: 'learn-v2.mastery-transition.v1' as const }
const privateRubric = { kind: 'bounded_rubric' as const, keyInsufficientReason: 'The capability requires written reasoning.',
  criteria: [{ key: 'private-criterion', description: 'PRIVATE-RUBRIC-CANARY', weightPercent: 100 }] }
const modelBinding = { kind: 'model' as const, configurationId: 'fixture-only', configurationVersion: 'config.v1',
  configurationDigest: `sha256:${'f'.repeat(64)}`, requestedModel: 'offline-fixture-model', routingMode: 'strict' as const,
  endpoint: 'https://fixture.invalid/scorer', scorerVersion: 'scorer.v1', promptVersion: 'prompt.v1', responseSchemaVersion: 'response.v1',
  parserVersion: 'parser.v1', guardVersion: 'guard.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80 as const,
  transitionVersion: 'learn-v2.mastery-transition.v1' as const }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

async function setup(options: { core?: 2 | 3, reserve?: boolean, reserveCount?: number, rubric?: boolean, keyed?: boolean, adapters?: boolean } = {}) {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  const graph = await t.run(async ctx => {
    const now = Date.now()
    const folderId = await ctx.db.insert('folders', { userId, name: 'Synthetic rules', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Synthetic capability', status: 'scheduled', revision: 2, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, learningVoidId, blueprintId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Apply a rule', depth: 'working', assessmentContract: rubric })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId, studyPlanId, revision: 1, recordRevision: 1,
      blueprintRevisionId, blueprintRecordRevision: 1, status: 'accepted', createdAt: now, updatedAt: now })
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
      scoringBinding: options.rubric ? modelBinding : binding,
      claims: (['stimulus', options.rubric ? 'rubric' : 'key', 'solution'] as const).map((part, order) => ({ order, part,
        claim: `${part} uses the multiplication rule.`, revision: 1, supports: [graph.support] })) }
  })
  const generated = { generatorVersion: 'fixture.generation.v1', members }
  if (options.adapters !== false) {
    vi.spyOn(measurementItemAdapters, 'generate').mockResolvedValue(generated)
    vi.spyOn(measurementItemAdapters, 'sourceKey').mockImplementation(async ({ member }) => {
      const numbers = /groups=(\d+), size=(\d+)/u.exec(member.declaredStimulus ?? '')
      const correct = !!numbers && (member.privateScoring.kind !== 'numeric' || member.privateScoring.expected === Number(numbers[1]) * Number(numbers[2]))
      return { decision: correct ? 'pass' : 'reject', coverage: 'complete', coveredParts: member.claims.map(claim => claim.part) }
    })
    vi.spyOn(measurementItemAdapters, 'compare').mockImplementation(async ({ content, corpus, sources, purpose }) => ({
      decision: JSON.stringify(content).includes('PARAPHRASE-CLONE') || purpose === 'instructional' && corpus.length > 0 ? 'reject' : 'pass',
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
  return { t, owner, graph, begun, args, generated, descriptor }
}
type Fixture = Awaited<ReturnType<typeof setup>>
async function stage(f: Fixture) {
  const result = await f.t.mutation(commands.generateFamilyCandidates, f.args)
  expect(result).toMatchObject({ status: 'quarantined', revision: 2 })
  return { ...f.args, expectedRevision: 2 }
}
async function validate(f: Fixture) {
  const args = await stage(f)
  expect(await f.t.mutation(commands.validateFamily, args)).toMatchObject({ status: 'validated', revision: 3, evidenceStatus: 'offline_contract_only' })
  return { ...args, expectedRevision: 3 }
}
async function publish(f: Fixture) {
  return f.t.mutation(commands.publishFamily, await validate(f))
}
async function inventory(f: Fixture) {
  return f.t.run(async ctx => ({
    family: await ctx.db.get(f.begun.familyId), job: await ctx.db.get(f.begun.jobId), catalog: await ctx.db.get(f.graph.catalogId),
    items: await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q => q.eq('userId', userId).eq('familyId', f.begun.familyId)).take(7),
    cases: await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(257),
    contents: await ctx.db.query('sessionContent').withIndex('by_userId_and_status', q => q.eq('userId', userId).eq('status', 'published')).take(16),
    exposures: await ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', userId)).take(8),
  }))
}
async function teachingJob(f: Fixture, content: string) {
  const studySessionId = await f.t.run(ctx => ctx.db.insert('studySessions', { userId, studyPlanRevisionId: f.graph.studyPlanRevisionId,
    primaryObjectiveId: f.graph.objectiveId, status: 'planned', revision: 1, scheduledStartAt: Date.now() }))
  const jobId = await f.t.run(ctx => ctx.db.insert('learnJobs', { userId, learningVoidId: f.graph.learningVoidId,
    blueprintRevisionId: f.graph.blueprintRevisionId, studyPlanRevisionId: f.graph.studyPlanRevisionId, studySessionId,
    type: 'session_content_generation', status: 'running', revision: 1, idempotencyKey: 'teaching-job', inputDigest: 'fixture-input',
    expectedVoidRevision: 2, expectedBlueprintRecordRevision: 1, expectedSessionRevision: 1, attempts: 1, leaseToken: 'teaching-lease', leaseExpiresAt: Date.now() + 60_000,
    dispatchSupportingSourceSnapshotIds: [f.graph.sourceSnapshotId] }))
  const candidate = { version: 'learn-v2.session-content.v1', generatorVersion: 'fixture.teaching.v1', assessmentRubric: rubric,
    blocks: LEARN_V2_MASTERY_LOOP_BLOCKS.map((kind, order) => ({ order, kind, content, claimOrders: [0] })),
    claims: [{ order: 0, claim: 'The synthetic source supports multiplication.', supportSourceSnapshotIds: [String(f.graph.sourceSnapshotId)] }] }
  return { tokenIdentifier: userId, jobId, leaseToken: 'teaching-lease', expectedRevision: 1, candidateJson: JSON.stringify(candidate),
    verifierDecisionsJson: JSON.stringify({ version: 'learn-v2.entailment.v2', decisions: [{ claimOrder: 0, sourceSnapshotId: String(f.graph.sourceSnapshotId),
      sourceExcerptId: String(f.graph.sourceExcerptId), decision: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.99 }] }) }
}

describe('held-out family publication commands', () => {
  test('publishes a keyed family at the six-member bound and preserves all reserved forms', async () => {
    const f = await setup({ keyed: true, reserveCount: 3 })
    expect(await publish(f)).toMatchObject({ status: 'published' })
    const state = await inventory(f)
    expect(state.items).toHaveLength(6)
    expect(state.cases).toHaveLength(6)
  })
  test.each([false, true])('publishes immutable source-bound numeric/rubric families, rubric=%s', async rubricFamily => {
    const f = await setup({ rubric: rubricFamily, reserve: true })
    expect(await publish(f)).toMatchObject({ status: 'published', evidenceStatus: 'offline_contract_only', catalogRevision: 2 })
    const state = await inventory(f)
    expect(state.family).toMatchObject({ status: 'provisional_equivalent', reasonCode: 'offline_contract_only' })
    expect(state.items).toHaveLength(4)
    expect(state.items.every(item => item.status === 'published' && item.scoringSpecId && item.publicationValidationId)).toBe(true)
    expect(state.cases.every(row => row.usageClass === 'measurement_reserved' && row.reservedAt !== undefined)).toBe(true)
    expect(state.contents).toEqual([])
    expect(state.exposures).toEqual([])
    expect(await f.t.query(commands.getValidatedFamily, { tokenIdentifier: userId, familyId: f.begun.familyId })).toMatchObject({ coreFormCount: 3, members: expect.any(Array) })
    expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })).toBeNull()
    expect(await f.t.withIdentity(foreign).query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId }).catch(() => null)).toBeNull()
    const authorizationId = await authorizeExport(f.owner)
    for (const collection of ['learnMeasurementFamilies', 'learnMeasurementItems', 'learnMeasurementScoringSpecs', 'learnMeasurementClaims', 'learnMeasurementSupports', 'learnMeasurementValidations']) {
      const exported = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 } })
      const serialized = JSON.stringify(exported)
      expect(serialized).not.toContain('PRIVATE-SOLUTION')
      expect(serialized).not.toContain('PRIVATE-RUBRIC-CANARY')
      expect(serialized).not.toContain('Hypothetical A')
      expect(serialized).not.toContain('"payload":')
    }
    await expect(f.t.mutation(commands.generateFamilyCandidates, f.args)).rejects.toThrow('measurement_lease_unavailable')
  })

  test('keeps admission and generation off without the code-owned adapters', async () => {
    const f = await setup({ adapters: false })
    expect(await f.t.mutation(commands.generateFamilyCandidates, f.args)).toMatchObject({ status: 'quarantined', reasonCode: 'validation_unavailable' })
    expect((await inventory(f)).items).toEqual([])
    await f.t.run(ctx => ctx.db.patch(f.graph.catalogId, { measurementCapability: undefined }))
    await expect(f.t.query(commands.getValidatedFamily, { tokenIdentifier: userId, familyId: f.begun.familyId })).rejects.toThrow('measurement_disabled')
  })

  test('unknown prose coverage, missing harnesses and incorrect source keys quarantine rather than publish', async () => {
    for (const failure of ['coverage', 'harness', 'key'] as const) {
      const f = await setup()
      const args = await stage(f)
      if (failure === 'coverage') vi.mocked(measurementItemAdapters.sourceKey).mockResolvedValueOnce({ decision: 'unknown', coverage: 'unknown', coveredParts: [] })
      if (failure === 'harness') vi.mocked(measurementItemAdapters.harness).mockResolvedValueOnce(null)
      if (failure === 'key') vi.mocked(measurementItemAdapters.sourceKey).mockResolvedValueOnce({ decision: 'reject', coverage: 'complete', coveredParts: ['key', 'solution', 'stimulus'] })
      expect(await f.t.mutation(commands.validateFamily, args)).toMatchObject({ status: 'quarantined' })
      const state = await inventory(f)
      expect(state.cases.every(row => row.usageClass === 'unknown' && row.reservedAt === undefined)).toBe(true)
      expect(state.catalog?.catalogRevision).toBe(1)
      vi.restoreAllMocks()
    }
  })

  test.each(['clone', 'coverage', 'source_example'])('semantic novelty includes siblings, existing cases and source examples: %s', async failure => {
    const f = await setup()
    f.generated.members[1]!.prompt = 'PARAPHRASE-CLONE with renamed characters and changed formatting.'
    const args = await stage(f)
    if (failure === 'coverage') vi.mocked(measurementItemAdapters.compare).mockResolvedValueOnce({ decision: 'pass', coverage: 'unknown' })
    if (failure === 'source_example') vi.mocked(measurementItemAdapters.compare).mockImplementationOnce(async ({ sources }) => {
      expect(sources[0]!.excerpt).toContain('Source worked example')
      return { decision: 'reject', coverage: 'complete' }
    })
    expect(await f.t.mutation(commands.validateFamily, args)).toMatchObject({ status: 'quarantined', reasonCode: failure === 'coverage' ? 'comparison_coverage_unknown' : 'case_collision' })
    expect((await inventory(f)).items.every(item => item.status === 'quarantined')).toBe(true)
  })

  test('modality/scale mismatches fail even when adapters claim equivalence', async () => {
    const f = await setup()
    f.descriptor.responseModality = 'bounded_rubric'
    await f.t.run(ctx => ctx.db.patch(f.begun.familyId, { equivalenceDescriptor: f.descriptor as Doc<'learnMeasurementFamilies'>['equivalenceDescriptor'] }))
    expect(await f.t.mutation(commands.validateFamily, await stage(f))).toMatchObject({ status: 'quarantined', reasonCode: 'form_comparability_unknown' })
  })

  test.each(['catalog', 'source', 'rubric', 'key', 'harness', 'watermark'])('rechecks all publication pins after validation: %s', async change => {
    const f = await setup()
    const args = await validate(f)
    const state = await inventory(f)
    await f.t.run(async ctx => {
      if (change === 'catalog') await ctx.db.patch(f.graph.catalogId, { catalogRevision: 2 })
      if (change === 'watermark') await ctx.db.patch(f.graph.catalogId, { historyCoverageWatermark: 'new.coverage.v2' })
      if (change === 'source') await ctx.db.delete(f.graph.sourceExcerptId)
      if (change === 'rubric') await ctx.db.patch(f.graph.objectiveId, { assessmentContract: { ...rubric, instructions: 'Changed accepted contract.' } })
      if (change === 'key') await ctx.db.patch(state.items[0]!.scoringSpecId!, { payload: { kind: 'numeric', expected: -999, unit: 'members', absoluteTolerance: 0, relativeTolerance: 0, normalizationVersion: 'normalize.v1' } })
      if (change === 'harness') await ctx.db.patch(state.family!.validationId!, { harnessArtifactDigest: `sha256:${'0'.repeat(64)}` })
    })
    const result = await f.t.mutation(commands.publishFamily, args).catch(error => ({ status: 'rejected', error }))
    expect(result.status).not.toBe('published')
    const after = await inventory(f)
    expect(after.items.every(item => item.status !== 'published')).toBe(true)
    expect(after.cases.every(row => row.reservedAt === undefined)).toBe(true)
  })

  test('instructional publication advances the same guard and invalidates older item validation', async () => {
    const f = await setup()
    const args = await validate(f)
    const teaching = await teachingJob(f, 'A separate instructional case with its own solution.')
    expect(await f.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, teaching)).toMatchObject({ status: 'ready' })
    expect((await inventory(f)).catalog?.catalogRevision).toBe(2)
    expect(await f.t.mutation(commands.publishFamily, args)).toMatchObject({ status: 'quarantined', reasonCode: 'catalog_revision_conflict' })
    expect((await inventory(f)).items.every(item => item.status !== 'published')).toBe(true)
  })

  test('racing item and instructional publication cannot publish both at the captured revision', async () => {
    const f = await setup()
    const args = await validate(f)
    const teaching = await teachingJob(f, f.generated.members[0]!.prompt)
    const results = await Promise.allSettled([
      f.t.mutation(commands.publishFamily, args), f.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, teaching),
    ])
    const successes = results.filter(result => result.status === 'fulfilled' && ['published', 'ready'].includes(result.value.status))
    expect(successes).toHaveLength(1)
    const state = await inventory(f)
    expect(state.catalog?.catalogRevision).toBe(2)
    expect(state.items.some(item => item.status === 'published') && state.contents.length > 0).toBe(false)
  })

  test('rejects teaching and feedback containing a reserved prompt or solution, including retirement', async () => {
    const f = await setup()
    await publish(f)
    const before = await inventory(f)
    await f.t.mutation(commands.invalidateFamily, { tokenIdentifier: userId, familyId: f.begun.familyId, expectedRecordRevision: before.family!.recordRevision, reasonCode: 'retired' })
    const teaching = await teachingJob(f, f.generated.members[0]!.referenceSolution)
    await expect(f.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, teaching)).rejects.toThrow('instructional_case_reserved')
    const after = await inventory(f)
    expect(after.contents).toEqual([])
    expect(after.cases.filter(row => row.usageClass === 'measurement_reserved')).toHaveLength(3)
    await expect(f.t.query(commands.getValidatedFamily, { tokenIdentifier: userId, familyId: f.begun.familyId })).rejects.toThrow('family_quarantined')
  })

  test('unknown semantic feedback comparisons fail closed before content publication', async () => {
    const f = await setup()
    await publish(f)
    vi.mocked(measurementItemAdapters.compare).mockResolvedValueOnce({ decision: 'unknown', coverage: 'unknown' })
    await expect(f.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, await teachingJob(f, 'A paraphrased explanation.'))).rejects.toThrow('instructional_holdout_unknown')
    expect((await inventory(f)).contents).toEqual([])
  })

  test('known instructional cases cannot be published as measurement, across edits and clones', async () => {
    const f = await setup()
    const prompt = f.generated.members[0]!.prompt
    const teaching = await teachingJob(f, prompt)
    await f.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, teaching)
    await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { status: 'planned', revision: 1 }))
    const args = await stage(f)
    expect(await f.t.mutation(commands.validateFamily, args)).toMatchObject({ status: 'quarantined', reasonCode: 'case_collision' })
    const exact = await normalizedInstructionalCaseFingerprints(prompt, prompt)
    const cases = (await inventory(f)).cases.filter(row => row.scenarioFingerprint === exact.scenarioFingerprint)
    expect(cases).toHaveLength(1)
    expect(cases[0]!.usageClass).toBe('instructional')
  })

  test('two core forms declare partial coverage, and consumed reserves cannot be regenerated', async () => {
    const f = await setup({ core: 2, reserve: true })
    await publish(f)
    const manifest = await f.t.query(commands.getValidatedFamily, { tokenIdentifier: userId, familyId: f.begun.familyId })
    expect(manifest).toMatchObject({ coreFormCount: 2 })
    expect(learnMeasurementCoverage({ kind: 'two_case', horizonDays: 7, cold: manifest.members[0]!.pins, delayed: manifest.members[1]!.pins }))
      .toEqual({ kind: 'partial', day7: true, day30: false })
    expect(learnMeasurementAllocationSchema.safeParse({ kind: 'three_case', order: 'ABC', cold: manifest.members[0]!.pins,
      day7: manifest.members[1]!.pins, day30: manifest.members[1]!.pins }).success).toBe(false)
    const reserve = await f.t.query(commands.getUnusedReserve, { tokenIdentifier: userId, familyId: f.begun.familyId, excludedCaseIds: [] })
    if (reserve.status !== 'available') throw new Error('Expected reserve')
    await f.t.run(ctx => ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(),
      caseId: reserve.pins.caseId, itemId: reserve.pins.itemId, itemRevision: reserve.pins.itemRevision, purpose: 'delayed_measurement', status: 'granted',
      projectionDigest: reserve.pins.promptDigest, deliveryReceiptHash: 'lost-network-receipt', serverTime: Date.now(), policyVersion: 'fixture.v1', provenanceVersion: 'fixture.v1' }))
    expect(await f.t.query(commands.getUnusedReserve, { tokenIdentifier: userId, familyId: f.begun.familyId, excludedCaseIds: [] }))
      .toEqual({ status: 'unavailable', reasonCode: 'novel_item_unavailable' })
    expect(measurementItemAdapters.generate).toHaveBeenCalledOnce()
  })

  test('a check job references the validated item without provider calls, blocks or public keys', async () => {
    const f = await setup()
    await publish(f)
    const manifest = await f.t.query(commands.getValidatedFamily, { tokenIdentifier: userId, familyId: f.begun.familyId })
    const basisAttemptId = await f.t.run(ctx => ctx.db.insert('masteryAttempts', { userId, objectiveId: f.graph.objectiveId,
      attemptedAt: Date.now() - 7 * 86400000, idempotencyKey: 'synthetic-basis' }))
    const opportunityId = await f.t.run(ctx => ctx.db.insert('learnAssessmentOpportunities', { userId, storageVersion: 'learn-v2.measurement-storage.v1',
      createdAt: Date.now(),
      scopeKind: 'v2', learningVoidId: manifest.learningVoidId, blueprintRevisionId: manifest.blueprintRevisionId, objectiveId: manifest.objectiveId,
      blueprintRecordRevision: 1, assessmentContractVersion: manifest.assessmentContractVersion, assessmentContractDigest: manifest.assessmentContractDigest, depth: manifest.depth,
      evidenceStatus: 'available', contextPins: { kind: 'planned_measurement', studyPlanId: f.graph.studyPlanId, studyPlanRevisionId: f.graph.studyPlanRevisionId, planRevision: 1, planRecordRevision: 1 },
      delayedCheckId: 'fixture-retained', purpose: { kind: 'retained_transfer', basisAttemptId, clock: { protocolVersion: 'synthetic.protocol.v1',
        schedulingPolicyVersion: 'synthetic.schedule.v1', anchorKind: 'fixture', anchorEventId: 'fixture-anchor', anchorAt: Date.now() - 7 * 86400000,
        horizonDays: 7, timezone: 'UTC', dueLocalDate: '2026-11-16', dueAt: Date.now(), openAt: Date.now() - 1000, closeAt: Date.now() + 60000 } },
      assessmentPins: { kind: 'measurement', itemPins: manifest.members[0]!.pins }, scoringBinding: binding,
      phase: 'ready', revision: 1, eligibilityPolicyVersion: 'fixture.v1', operationalEligibility: 'eligible', openAt: Date.now() - 1000, closeAt: Date.now() + 60000,
      checkSequence: 1, originalSlot: true }))
    await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { assessmentPurpose: 'retained_transfer', assessmentOpportunityId: opportunityId, placementKind: 'retained_review' }))
    const job = await teachingJob(f, 'This teaching payload must be ignored for a check.')
    await f.t.run(ctx => ctx.db.patch(job.jobId, { studySessionId: f.graph.studySessionId }))
    const input = await f.t.query(internal.learnV2SessionContent.getSessionContentGenerationInput, { tokenIdentifier: userId, jobId: job.jobId, leaseToken: job.leaseToken, expectedRevision: 1 })
    expect(input).toMatchObject({ kind: 'validated_item', itemPins: manifest.members[0]!.pins })
    await f.t.run(ctx => ctx.db.patch(job.jobId, { status: 'queued', attempts: 0, leaseToken: undefined, leaseExpiresAt: undefined }))
    const result = await f.t.action(internal.learnV2SessionContent.executeSessionContentGeneration, { tokenIdentifier: userId, jobId: job.jobId, expectedRevision: 1 })
    expect(result.status).toBe('ready')
    const state = await inventory(f)
    expect(state.contents).toHaveLength(1)
    expect(state.contents[0]).not.toHaveProperty('assessmentRubricSnapshot')
    expect(await f.t.run(ctx => ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', state.contents[0]!._id)).take(1))).toEqual([])
    expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })).toBeNull()
    await expect(f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'no-delivery-adapter' })).rejects.toThrow('Assessment delivery is unavailable')
    await expect(f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'no-reroll' })).rejects.toThrow('Assessment generation cannot be retried')
    expect(measurementItemAdapters.generate).toHaveBeenCalledOnce()
    expect(JSON.stringify(state.contents)).not.toContain('PRIVATE-SOLUTION')
  })

  test('wrong-key invalidation blocks new admission without changing a prior outcome or reservation', async () => {
    const f = await setup()
    await publish(f)
    const state = await inventory(f)
    const attemptId = await f.t.run(ctx => ctx.db.insert('masteryAttempts', { userId, objectiveId: f.graph.objectiveId,
      attemptedAt: Date.now(), idempotencyKey: 'saved-historical-outcome', serverScorePercent: 100, result: 'historical_pass' }))
    const before = await f.t.run(ctx => ctx.db.get(attemptId))
    await f.t.mutation(commands.invalidateFamily, { tokenIdentifier: userId, familyId: f.begun.familyId,
      expectedRecordRevision: state.family!.recordRevision, reasonCode: 'wrong_key' })
    await expect(f.t.query(commands.getValidatedFamily, { tokenIdentifier: userId, familyId: f.begun.familyId })).rejects.toThrow('family_quarantined')
    expect(await f.t.run(ctx => ctx.db.get(attemptId))).toEqual(before)
    expect((await inventory(f)).cases).toEqual(state.cases)
  })

  test('expired leases cannot regenerate a staged family', async () => {
    const f = await setup()
    const args = await stage(f)
    await f.t.run(ctx => ctx.db.patch(f.begun.jobId, { leaseExpiresAt: Date.now() - 1 }))
    await expect(f.t.mutation(commands.validateFamily, args)).rejects.toThrow('measurement_lease_unavailable')
    await expect(f.t.mutation(commands.generateFamilyCandidates, args)).rejects.toThrow('measurement_lease_unavailable')
    expect(measurementItemAdapters.generate).toHaveBeenCalledOnce()
    expect((await inventory(f)).items.every(item => item.status !== 'published')).toBe(true)
  })

  test('a wrong-key decision between validation and publication cannot reuse the older approval', async () => {
    const f = await setup()
    const args = await validate(f)
    const family = (await inventory(f)).family!
    await f.t.mutation(commands.invalidateFamily, { tokenIdentifier: userId, familyId: family._id,
      expectedRecordRevision: family.recordRevision, reasonCode: 'wrong_key' })
    expect(await f.t.mutation(commands.publishFamily, args)).toMatchObject({ status: 'quarantined' })
    const state = await inventory(f)
    expect(state.items.every(item => item.status !== 'published')).toBe(true)
    expect(state.cases.every(row => row.reservedAt === undefined)).toBe(true)
  })
})
