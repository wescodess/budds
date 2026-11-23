import { z } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { hasLearnV2Access } from './learnV2Access'
import { requireActiveBlueprint } from './learnV2BlueprintAuthority'
import { normalizedInstructionalCaseFingerprints } from './learnV2ArtifactLineage'
import { LEARN_ARTIFACT_CASE_IDENTITY_VERSION } from '../../shared/learn-v2-artifact-lineage'
import {
  LEARN_V2_MEASUREMENT_VERSION, learnMeasurementEquivalenceSchema, learnMeasurementResponseSpecSchema,
  learnPrivateScoringPayloadSchema, learnScorerBindingSchema, learnMeasurementSupportSchema,
  learnMeasurementFamilyManifestSchema, learnMeasurementPublicationCandidateSchema,
  type LearnMeasurementItemPins,
} from '../../shared/learn-v2-measurement'
import { learnTextSchema, learnVersionSchema, parseLearnContract } from '../../shared/learn-v2-responses'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { requireLearnActiveWorkPlan } from './learnV2FixedChecks'

export const MEASUREMENT_PUBLICATION_VERSION = 'learn-v2.measurement-publication.v1'
export const MEASUREMENT_NOVELTY_VERSION = 'learn-v2.measurement-novelty.v1'
export const MEASUREMENT_HARNESS_VERSION = 'learn-v2.measurement-harness.v1'
export const MEASUREMENT_JOB_TYPE = 'measurement_family_generation'
const MAX_CORPUS = 256
const MAX_BYTES = 512 * 1024
const LEASE_MS = 5 * 60_000
type ReadCtx = Pick<QueryCtx, 'db'>
type Capability = Pick<Doc<'learnMeasurementFamilies'>, 'learningVoidId' | 'blueprintRevisionId' | 'objectiveId' | 'blueprintRecordRevision' | 'assessmentContractVersion' | 'assessmentContractDigest' | 'depth'>
type Support = z.infer<typeof learnMeasurementSupportSchema>
type Case = Doc<'learnAssessmentCases'>
const claimSchema = z.strictObject({ order: z.number().int().min(0).max(31), part: z.enum(['stimulus', 'key', 'rubric', 'solution']),
  claim: learnTextSchema(1000), revision: z.number().int().min(1), supports: z.array(learnMeasurementSupportSchema).min(1).max(8) })
const memberSchema = z.strictObject({ formLabel: z.enum(['A', 'B', 'C', 'D', 'E', 'F']), reserve: z.boolean(),
  prompt: learnTextSchema(), declaredStimulus: learnTextSchema().nullable(), responseSpec: learnMeasurementResponseSpecSchema,
  privateScoring: learnPrivateScoringPayloadSchema, referenceSolution: learnTextSchema(), derivation: learnTextSchema(),
  scoringBinding: learnScorerBindingSchema, claims: z.array(claimSchema).min(1).max(32) })
const generationSchema = z.strictObject({ generatorVersion: learnVersionSchema, members: z.array(memberSchema).min(2).max(6) })
type Member = z.infer<typeof memberSchema>
type Decision = { decision: 'pass' | 'reject' | 'unknown', coverage: 'complete' | 'unknown' }
export type MeasurementHarnessArtifact = {
  version: string, evidenceStatus: 'offline_contract_only' | 'live_validated', artifactDigest: string,
  itemDigest: string, scoringDigest: string, sourceKeyDigest: string,
  checks: { sourceKeyProof: boolean, wrong: boolean, partial: boolean, injection: boolean, scorer: boolean },
}
type ValidationInput = { member: Member, itemDigest: string, scoringDigest: string, sourceKeyDigest: string }

// Adapters are code-owned. Missing validation never admits inventory.
export const measurementItemAdapters: {
  version: string
  generate: (input: { job: Doc<'learnJobs'>, family: Doc<'learnMeasurementFamilies'>, sources: Doc<'learnSourceSnapshots'>[] }) => Promise<unknown>
  sourceKey: (input: ValidationInput) => Promise<Decision & { coveredParts: Member['claims'][number]['part'][] }>
  harness: (input: ValidationInput) => Promise<MeasurementHarnessArtifact | null>
  compare: (input: { purpose: 'measurement' | 'instructional', content: unknown, corpus: Case[], sources: Doc<'learnSourceExcerpts'>[], corpusDigest: string }) => Promise<Decision>
  equivalence: (input: { family: Doc<'learnMeasurementFamilies'>, members: Member[] }) => Promise<Decision>
} = {
  version: MEASUREMENT_PUBLICATION_VERSION,
  async generate() { return null },
  async sourceKey() { return { decision: 'unknown', coverage: 'unknown', coveredParts: [] } },
  async harness() { return null },
  async compare() { return { decision: 'unknown', coverage: 'unknown' } },
  async equivalence() { return { decision: 'unknown', coverage: 'unknown' } },
}

export function measurementCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(measurementCanonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${measurementCanonical(row[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export async function measurementDigest(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(measurementCanonical(value))))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
export class MeasurementValidationError extends Error {}
function fail(reason: string): never { throw new MeasurementValidationError(reason) }
function capability(row: Capability): Capability {
  return { learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId,
    blueprintRecordRevision: row.blueprintRecordRevision, assessmentContractVersion: row.assessmentContractVersion,
    assessmentContractDigest: row.assessmentContractDigest, depth: row.depth }
}
function base(userId: string, scope: Capability) {
  return { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, ...capability(scope), evidenceStatus: 'available' as const, createdAt: Date.now() }
}
export async function requireMeasurementCapability(ctx: ReadCtx, userId: string) {
  const rows = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  if (rows.length !== 1 || rows[0]!.measurementCapability?.enabled !== true) fail('measurement_disabled')
  const catalog = rows[0]!
  if (!Number.isSafeInteger(catalog.catalogRevision) || catalog.catalogRevision < 0 || catalog.historyCompleteness !== 'prospective_complete'
    || ![catalog.instrumentationEpoch, catalog.historyBasisVersion, catalog.historyCoverageWatermark].every(value => learnVersionSchema.safeParse(value).success)) fail('unknown_history')
  return catalog
}
export async function requireMeasurementScope(ctx: QueryCtx | MutationCtx, userId: string, scope: Capability) {
  if (!await hasLearnV2Access(ctx, userId)) fail('access_revoked')
  const [learningVoid, blueprint, objective] = await Promise.all([
    ctx.db.get(scope.learningVoidId), ctx.db.get(scope.blueprintRevisionId), ctx.db.get(scope.objectiveId),
  ])
  if (!learningVoid || !blueprint || !objective || learningVoid.userId !== userId || blueprint.userId !== userId || objective.userId !== userId
    || blueprint.learningVoidId !== learningVoid._id || objective.blueprintRevisionId !== blueprint._id || blueprint.recordRevision !== scope.blueprintRecordRevision
    || objective.depth !== scope.depth || !objective.assessmentContract || typeof objective.assessmentContract === 'string'
    || objective.assessmentContract.version !== scope.assessmentContractVersion || await measurementDigest(objective.assessmentContract) !== scope.assessmentContractDigest) fail('pins_mismatch')
  const folder = await ctx.db.get(learningVoid.folderId)
  if (!folder || folder.userId !== userId) fail('evidence_unavailable')
  await requireActiveBlueprint(ctx, userId, learningVoid, blueprint._id)
}
export async function sessionMeasurementScope(ctx: QueryCtx | MutationCtx, userId: string, session: Doc<'studySessions'>) {
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  const objective = await ctx.db.get(session.primaryObjectiveId)
  const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId)
  const root = plan && await ctx.db.get(plan.studyPlanId)
  if (!plan || plan.userId !== userId || plan.status !== 'accepted' || !root || root.userId !== userId || root.activeRevisionId !== plan._id
    || !blueprint || blueprint.recordRevision !== plan.blueprintRecordRevision || !objective?.assessmentContract
    || typeof objective.assessmentContract === 'string' || !objective.depth) fail('pins_mismatch')
  const scope: Capability = { learningVoidId: plan.learningVoidId, blueprintRevisionId: blueprint._id, objectiveId: objective._id,
    blueprintRecordRevision: blueprint.recordRevision, assessmentContractVersion: objective.assessmentContract.version,
    assessmentContractDigest: await measurementDigest(objective.assessmentContract), depth: objective.depth }
  await requireMeasurementScope(ctx, userId, scope)
  await requireLearnActiveWorkPlan(ctx, userId, plan)
  return { scope, plan }
}
async function liveSupport(ctx: ReadCtx, userId: string, scope: Capability, pin: Support) {
  const [source, excerpt] = await Promise.all([ctx.db.get(pin.sourceSnapshotId), ctx.db.get(pin.sourceExcerptId)])
  if (!source || !excerpt || source.userId !== userId || excerpt.userId !== userId || source.learningVoidId !== scope.learningVoidId
    || excerpt.sourceSnapshotId !== source._id || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted'
    || source.evidencePurgedAt !== undefined || excerpt.evidencePurgedAt !== undefined || source.conflictStatus !== 'clear'
    || source.rightsStatus !== 'permitted' || excerpt.rightsStatus !== 'permitted' || !excerpt.excerpt?.trim()
    || source.revision !== pin.sourceSnapshotRevision || (source.recordRevision ?? 1) !== pin.sourceRecordRevision
    || source.contentHash !== pin.sourceContentHash || source.sourceRevision !== pin.sourceRevision
    || await measurementDigest(excerpt.excerpt) !== pin.excerptDigest || await measurementDigest(excerpt.locator) !== pin.locatorDigest) fail('evidence_unavailable')
  const identity = await ctx.db.get(source.sourceIdentityId)
  const latest = await ctx.db.query('learnSourceSnapshots').withIndex('by_userId_and_sourceIdentityId_and_revision', q => q.eq('userId', userId).eq('sourceIdentityId', source.sourceIdentityId)).order('desc').first()
  const link = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', scope.objectiveId).eq('sourceSnapshotId', source._id)).unique()
  if (!identity || identity.userId !== userId || identity.learningVoidId !== scope.learningVoidId || identity.tombstonedAt !== undefined
    || latest?._id !== source._id || !link || link.coverage === 'gap') fail('evidence_unavailable')
  if (identity.origin === 'folder_document') {
    const document = identity.folderDocumentId && await ctx.db.get(identity.folderDocumentId)
    if (!document || document.userId !== userId || document.status !== 'success' || document.contentHash !== source.contentHash
      || document.sourceRevision !== source.sourceRevision) fail('evidence_unavailable')
  }
  const { supportDigest: _digest, ...fields } = pin
  if (await measurementDigest(fields) !== pin.supportDigest) fail('support_pins_mismatch')
  return excerpt
}
async function corpus(ctx: ReadCtx, userId: string, catalog: Doc<'learnAssessmentCatalogs'>, exclude: Set<string>) {
  const all = await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(MAX_CORPUS + 1)
  if (all.length > MAX_CORPUS) fail('comparison_coverage_unknown')
  const cases = all.filter(row => !exclude.has(row._id))
  const digest = await measurementDigest({ revision: catalog.catalogRevision, instrumentationEpoch: catalog.instrumentationEpoch,
    historyBasisVersion: catalog.historyBasisVersion, watermark: catalog.historyCoverageWatermark,
    cases: cases.map(row => ({ id: row._id, scenario: row.scenarioFingerprint, solution: row.solutionFingerprint,
      policy: row.identityPolicyVersion, usage: row.usageClass, reservedAt: row.reservedAt ?? null })).sort((a, b) => a.id.localeCompare(b.id)) })
  return { cases, digest }
}
export async function requireFamilyJob(ctx: QueryCtx | MutationCtx, userId: string, jobId: Id<'learnJobs'>, leaseToken: string, revision: number) {
  const job = await ctx.db.get(jobId)
  if (!job || job.userId !== userId || job.type !== MEASUREMENT_JOB_TYPE || job.leaseToken !== leaseToken || job.revision !== revision
    || !['leased', 'running'].includes(job.status) || (job.leaseExpiresAt ?? 0) <= Date.now() || !job.familyId || !job.studySessionId) fail('measurement_lease_unavailable')
  const family = await ctx.db.get(job.familyId)
  const session = await ctx.db.get(job.studySessionId)
  if (!family || family.userId !== userId || !session || session.userId !== userId || session.revision !== job.expectedSessionRevision
    || session.status !== 'planned') fail('pins_mismatch')
  const { scope, plan } = await sessionMeasurementScope(ctx, userId, session)
  if (measurementCanonical(capability(family)) !== measurementCanonical(scope) || plan._id !== job.studyPlanRevisionId) fail('pins_mismatch')
  await requireMeasurementCapability(ctx, userId)
  return { job, family }
}
export async function beginMeasurementFamily(ctx: MutationCtx, userId: string, args: {
  studySessionId: Id<'studySessions'>, expectedSessionRevision: number, familyKey: string, revision: number,
  coreFormCount: 2 | 3, equivalenceVersion: string, equivalenceDescriptorJson: string, idempotencyKey: string,
}) {
  const catalog = await requireMeasurementCapability(ctx, userId)
  const session = await ctx.db.get(args.studySessionId)
  if (!session || session.userId !== userId || session.status !== 'planned' || session.revision !== args.expectedSessionRevision) fail('pins_mismatch')
  const { scope, plan } = await sessionMeasurementScope(ctx, userId, session)
  parseLearnContract(z.strictObject({ familyKey: learnVersionSchema, revision: z.number().int().positive(), equivalenceVersion: learnVersionSchema,
    idempotencyKey: learnTextSchema(128) }), { familyKey: args.familyKey, revision: args.revision, equivalenceVersion: args.equivalenceVersion, idempotencyKey: args.idempotencyKey })
  const descriptor = parseLearnContract(learnMeasurementEquivalenceSchema, JSON.parse(args.equivalenceDescriptorJson))
  const inputDigest = await measurementDigest({ ...args, equivalenceDescriptorJson: measurementCanonical(descriptor), scope, planRevision: plan.recordRevision, adapter: measurementItemAdapters.version })
  const prior = await ctx.db.query('learnJobs').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', userId).eq('idempotencyKey', args.idempotencyKey)).unique()
  if (prior) {
    if (prior.type !== MEASUREMENT_JOB_TYPE || prior.inputDigest !== inputDigest) fail('idempotency_conflict')
    return { jobId: prior._id, familyId: prior.familyId!, revision: prior.revision, leaseToken: prior.leaseToken ?? null }
  }
  const existing = await ctx.db.query('learnMeasurementFamilies').withIndex('by_userId_and_familyKey_and_revision', q => q.eq('userId', userId).eq('familyKey', args.familyKey).eq('revision', args.revision)).unique()
  if (existing) fail('family_revision_exists')
  const familyId = await ctx.db.insert('learnMeasurementFamilies', { ...base(userId, scope), familyKey: args.familyKey, revision: args.revision,
    recordRevision: 1, equivalenceVersion: args.equivalenceVersion, equivalenceDescriptor: descriptor, coreFormCount: args.coreFormCount,
    totalFormCount: 0, validationArtifactDigest: inputDigest, status: 'quarantined', reasonCode: 'candidate_pending' })
  const now = Date.now()
  const leaseToken = crypto.randomUUID()
  const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId: scope.learningVoidId, blueprintRevisionId: scope.blueprintRevisionId,
    studyPlanRevisionId: plan._id, studySessionId: session._id, familyId, type: MEASUREMENT_JOB_TYPE, status: 'leased', revision: 1,
    idempotencyKey: args.idempotencyKey, inputDigest, requestFingerprint: measurementCanonical({ catalogRevision: catalog.catalogRevision, adapter: measurementItemAdapters.version }),
    expectedSessionRevision: session.revision, expectedBlueprintRecordRevision: scope.blueprintRecordRevision, attempts: 1,
    providerEnabled: false, providerPolicyVersion: MEASUREMENT_PUBLICATION_VERSION, leaseToken, leaseExpiresAt: now + LEASE_MS,
    checkpoint: 'family_generation_pending', createdAt: now, updatedAt: now })
  return { jobId, familyId, revision: 1, leaseToken }
}
async function findCase(ctx: MutationCtx, userId: string, prompt: string, solution: string) {
  const fingerprints = await normalizedInstructionalCaseFingerprints(prompt, solution)
  const scenario = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint', q => q.eq('userId', userId).eq('scenarioFingerprint', fingerprints.scenarioFingerprint)).take(2)
  const solutions = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_solutionFingerprint', q => q.eq('userId', userId).eq('solutionFingerprint', fingerprints.solutionFingerprint)).take(2)
  const matches = new Map([...scenario, ...solutions].map(row => [row._id, row]))
  if (matches.size > 1) fail('case_collision')
  if (matches.size) return [...matches.values()][0]!._id
  return ctx.db.insert('learnAssessmentCases', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, ...fingerprints,
    identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION, caseKey: `measurement:${await measurementDigest(fingerprints)}`, usageClass: 'unknown', createdAt: Date.now() })
}
export async function stageMeasurementFamily(ctx: MutationCtx, job: Doc<'learnJobs'>, family: Doc<'learnMeasurementFamilies'>) {
  if (job.checkpoint !== 'family_generation_pending' || family.totalFormCount !== 0 || family.status !== 'quarantined'
    || family.reasonCode !== 'candidate_pending') fail('generation_already_consumed')
  const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', job.userId).eq('objectiveId', family.objectiveId)).take(65)
  if (!links.length || links.length > 64) fail('unmeasurable_no_t0')
  const sources = await Promise.all(links.map(link => ctx.db.get(link.sourceSnapshotId)))
  if (sources.some(source => !source || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted'
    || source.evidencePurgedAt !== undefined || source.rightsStatus !== 'permitted' || source.conflictStatus !== 'clear')) fail('unmeasurable_no_t0')
  const generated = parseLearnContract(generationSchema, await measurementItemAdapters.generate({ job, family, sources: sources as Doc<'learnSourceSnapshots'>[] }), MAX_BYTES)
  if (new Set(generated.members.map(member => member.formLabel)).size !== generated.members.length
    || generated.members.filter(member => !member.reserve).map(member => member.formLabel).sort().join('') !== 'ABC'.slice(0, family.coreFormCount)) fail('family_members_invalid')
  for (const member of generated.members) {
    const caseId = await findCase(ctx, job.userId, member.prompt, member.referenceSolution)
    const claimManifest = await Promise.all(member.claims.map(async claim => ({ ...claim, claimDigest: await measurementDigest(claim.claim) })))
    const promptDigest = await measurementDigest({ prompt: member.prompt, declaredStimulus: member.declaredStimulus, responseSpec: member.responseSpec })
    const scoringSpecDigest = await measurementDigest({ payload: member.privateScoring, referenceSolution: member.referenceSolution, derivation: member.derivation, scoringBinding: member.scoringBinding })
    const supportManifestDigest = await measurementDigest(claimManifest)
    const itemId = await ctx.db.insert('learnMeasurementItems', { ...base(job.userId, family), familyId: family._id, familyRevision: family.revision,
      itemKey: `${family.familyKey}:${member.formLabel}`, revision: family.revision, caseId, formLabel: member.formLabel, reserve: member.reserve,
      prompt: member.prompt, ...(member.declaredStimulus === null ? {} : { declaredStimulus: member.declaredStimulus }), promptDigest, responseSpec: member.responseSpec,
      scoringSpecRevision: family.revision, scoringSpecDigest, generatorVersion: generated.generatorVersion, generationJobId: job._id,
      inputDigest: job.inputDigest ?? fail('pins_mismatch'), catalogRevision: 0, supportManifestDigest, status: 'candidate' })
    const scoringSpecId = await ctx.db.insert('learnMeasurementScoringSpecs', { ...base(job.userId, family), itemId, revision: family.revision,
      digest: scoringSpecDigest, payload: member.privateScoring, referenceSolution: member.referenceSolution, derivation: member.derivation, scoringBinding: member.scoringBinding })
    await ctx.db.patch(itemId, { scoringSpecId })
    for (const claim of claimManifest) {
      const { supports, ...fields } = claim
      const claimId = await ctx.db.insert('learnMeasurementClaims', { ...base(job.userId, family), itemId, scoringSpecId, ...fields })
      for (const support of supports) await ctx.db.insert('learnMeasurementSupports', { ...base(job.userId, family), claimId, itemId, scoringSpecId, ...support })
    }
  }
  await ctx.db.patch(family._id, { totalFormCount: generated.members.length, reasonCode: 'validation_pending', recordRevision: family.recordRevision + 1 })
  await ctx.db.patch(job._id, { status: 'running', checkpoint: 'family_validation_pending', revision: job.revision + 1, updatedAt: Date.now() })
  return { status: 'quarantined' as const, revision: job.revision + 1 }
}
type Loaded = Awaited<ReturnType<typeof loadFamily>>
async function loadFamily(ctx: QueryCtx | MutationCtx, family: Doc<'learnMeasurementFamilies'>) {
  const userId = family.userId
  await requireMeasurementScope(ctx, userId, family)
  const items = await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q => q.eq('userId', userId).eq('familyId', family._id).eq('familyRevision', family.revision)).take(7)
  if (items.length < 2 || items.length > 6 || items.length !== family.totalFormCount) fail('family_members_invalid')
  const members: Array<{ item: Doc<'learnMeasurementItems'>, spec: Doc<'learnMeasurementScoringSpecs'>, member: Member, caseRow: Case }> = []
  const excerpts = new Map<Id<'learnSourceExcerpts'>, Doc<'learnSourceExcerpts'>>()
  const evidenceChecks = new Map<string, Doc<'learnSourceExcerpts'>>()
  for (const item of items) {
    const spec = item.scoringSpecId && await ctx.db.get(item.scoringSpecId)
    const caseRow = await ctx.db.get(item.caseId)
    if (!spec || !caseRow || caseRow.userId !== userId || spec.userId !== userId || spec.itemId !== item._id
      || [family, item, spec].some(row => row.evidenceStatus !== 'available' || row.invalidatedAt !== undefined || measurementCanonical(capability(row)) !== measurementCanonical(capability(family)))
      || spec.revision !== item.scoringSpecRevision || !item.prompt || !spec.payload || !spec.referenceSolution || !spec.derivation) fail('evidence_unavailable')
    const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', item._id)).take(33)
    const claimManifest = []
    for (const claim of claims) {
      if (claim.evidenceStatus !== 'available' || claim.invalidatedAt !== undefined || !claim.claim || claim.scoringSpecId !== spec._id
        || await measurementDigest(claim.claim) !== claim.claimDigest) fail('claim_pins_mismatch')
      const rows = await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_claimId', q => q.eq('userId', userId).eq('claimId', claim._id)).take(9)
      const supports: Support[] = []
      for (const row of rows) {
        if (row.evidenceStatus !== 'available' || row.invalidatedAt !== undefined || row.itemId !== item._id || row.scoringSpecId !== spec._id) fail('evidence_unavailable')
        const pin = learnMeasurementSupportSchema.parse({ sourceSnapshotId: row.sourceSnapshotId, sourceSnapshotRevision: row.sourceSnapshotRevision,
          sourceRecordRevision: row.sourceRecordRevision, sourceContentHash: row.sourceContentHash, sourceRevision: row.sourceRevision,
          sourceExcerptId: row.sourceExcerptId, excerptDigest: row.excerptDigest, locatorDigest: row.locatorDigest, supportRevision: row.supportRevision,
          supportDigest: row.supportDigest, rightsStatus: row.rightsStatus, accessStatus: row.accessStatus, conflictStatus: row.conflictStatus,
          entailment: row.entailment, verifierVersion: row.verifierVersion, verifierModel: row.verifierModel })
        const { supportDigest, supportRevision: _revision, verifierVersion: _version, verifierModel: _model, ...evidencePins } = pin
        const { supportDigest: _digest, ...supportFields } = pin
        if (await measurementDigest(supportFields) !== supportDigest) fail('support_pins_mismatch')
        const evidenceKey = measurementCanonical(evidencePins)
        const excerpt = evidenceChecks.get(evidenceKey) ?? await liveSupport(ctx, userId, family, pin)
        evidenceChecks.set(evidenceKey, excerpt)
        excerpts.set(excerpt._id, excerpt)
        if (excerpts.size > 64) fail('comparison_coverage_unknown')
        supports.push(pin)
      }
      claimManifest.push({ order: claim.order, part: claim.part, claim: claim.claim, claimDigest: claim.claimDigest, revision: claim.revision, supports })
    }
    if (await measurementDigest(claimManifest) !== item.supportManifestDigest || await measurementDigest({ payload: spec.payload,
      referenceSolution: spec.referenceSolution, derivation: spec.derivation, scoringBinding: spec.scoringBinding }) !== item.scoringSpecDigest
      || spec.digest !== item.scoringSpecDigest || await measurementDigest({ prompt: item.prompt, declaredStimulus: item.declaredStimulus ?? null, responseSpec: item.responseSpec }) !== item.promptDigest) fail('item_pins_mismatch')
    const member = memberSchema.parse({ formLabel: item.formLabel, reserve: item.reserve, prompt: item.prompt, declaredStimulus: item.declaredStimulus ?? null,
      responseSpec: item.responseSpec, privateScoring: spec.payload, referenceSolution: spec.referenceSolution, derivation: spec.derivation,
      scoringBinding: spec.scoringBinding, claims: claimManifest.map(({ claimDigest: _digest, ...claim }) => claim) })
    // The frozen shared validator also enforces modality, deterministic scoring and source bounds.
    const publicationValidationId = item.publicationValidationId ?? family.validationId ?? 'pending-validation'
    parseLearnContract(learnMeasurementPublicationCandidateSchema, { version: LEARN_V2_MEASUREMENT_VERSION, ...capability(family),
      pins: itemPins(item, family, publicationValidationId), prompt: member.prompt, declaredStimulus: member.declaredStimulus, responseSpec: member.responseSpec,
      privateScoring: member.privateScoring, referenceSolution: member.referenceSolution, derivation: member.derivation,
      scoringBinding: member.scoringBinding, claims: claimManifest })
    members.push({ item, spec, member, caseRow })
  }
  if (excerpts.size > 64 || new Set(members.map(row => row.item.caseId)).size !== members.length
    || members.filter(row => !row.item.reserve).map(row => row.item.formLabel).sort().join('') !== 'ABC'.slice(0, family.coreFormCount)) fail('case_collision')
  const manifestDigest = await measurementDigest({ scope: capability(family), revision: family.revision, equivalenceVersion: family.equivalenceVersion,
    descriptor: family.equivalenceDescriptor, coreFormCount: family.coreFormCount, validator: measurementItemAdapters.version, novelty: MEASUREMENT_NOVELTY_VERSION,
    members: members.map(({ item, caseRow }) => ({ itemId: item._id, revision: item.revision, caseId: item.caseId, formLabel: item.formLabel, reserve: item.reserve,
      prompt: item.promptDigest, scoring: item.scoringSpecDigest, supports: item.supportManifestDigest, generator: item.generatorVersion, input: item.inputDigest,
      scenario: caseRow.scenarioFingerprint, solution: caseRow.solutionFingerprint, identity: caseRow.identityPolicyVersion })) })
  return { members, excerpts: [...excerpts.values()], manifestDigest }
}
function itemPins(item: Doc<'learnMeasurementItems'>, family: Doc<'learnMeasurementFamilies'>, validationId: string): LearnMeasurementItemPins {
  return { itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest, caseId: item.caseId, familyId: family._id,
    familyRevision: family.revision, formLabel: item.formLabel as LearnMeasurementItemPins['formLabel'], equivalenceVersion: family.equivalenceVersion,
    noveltyPolicyVersion: MEASUREMENT_NOVELTY_VERSION, scoringSpecId: item.scoringSpecId!, scoringSpecRevision: item.scoringSpecRevision,
    scoringSpecDigest: item.scoringSpecDigest, supportManifestDigest: item.supportManifestDigest, publicationValidationId: validationId as Id<'learnMeasurementValidations'> }
}
function passed(decision: Decision) { return decision.decision === 'pass' && decision.coverage === 'complete' }
export async function validateMeasurementFamily(ctx: MutationCtx, job: Doc<'learnJobs'>, family: Doc<'learnMeasurementFamilies'>) {
  if (job.checkpoint !== 'family_validation_pending' || family.status !== 'quarantined' || family.reasonCode !== 'validation_pending') fail('validation_already_consumed')
  const loaded = await loadFamily(ctx, family)
  const catalog = await requireMeasurementCapability(ctx, job.userId)
  const compared = await corpus(ctx, job.userId, catalog, new Set(loaded.members.map(row => row.item.caseId)))
  const fingerprints = new Set<string>()
  for (const { caseRow } of loaded.members) {
    if (caseRow.usageClass !== 'unknown' || caseRow.reservedAt !== undefined || caseRow.identityPolicyVersion !== LEARN_ARTIFACT_CASE_IDENTITY_VERSION) fail('case_collision')
    for (const fingerprint of [caseRow.scenarioFingerprint, caseRow.solutionFingerprint]) {
      if (fingerprints.has(fingerprint) || compared.cases.some(row => row.scenarioFingerprint === fingerprint || row.solutionFingerprint === fingerprint)) fail('case_collision')
      fingerprints.add(fingerprint)
    }
  }
  const semantic = await measurementItemAdapters.compare({ purpose: 'measurement', content: loaded.members.map(row => row.member), corpus: compared.cases,
    sources: loaded.excerpts, corpusDigest: compared.digest })
  if (!passed(semantic)) fail(semantic.decision === 'reject' ? 'case_collision' : 'comparison_coverage_unknown')
  const first = loaded.members[0]!.member
  const criteria = (member: Member) => member.privateScoring.kind === 'bounded_rubric' ? member.privateScoring.criteria : { kind: member.privateScoring.kind }
  if (family.equivalenceDescriptor.responseModality !== first.responseSpec.kind
    || family.equivalenceDescriptor.criteriaDigest !== await measurementDigest(criteria(first))
    || family.equivalenceDescriptor.thresholdVersion !== first.scoringBinding.thresholdVersion
    || loaded.members.some(({ member }) => measurementCanonical(member.responseSpec) !== measurementCanonical(first.responseSpec)
      || measurementCanonical(member.scoringBinding) !== measurementCanonical(first.scoringBinding)
      || measurementCanonical(criteria(member)) !== measurementCanonical(criteria(first)))) fail('form_comparability_unknown')
  if (!passed(await measurementItemAdapters.equivalence({ family, members: loaded.members.map(row => row.member) }))) fail('form_comparability_unknown')
  const artifacts: MeasurementHarnessArtifact[] = []
  for (const row of loaded.members) {
    const parts = new Set(row.member.claims.map(claim => claim.part))
    const required = ['solution', row.member.privateScoring.kind === 'bounded_rubric' ? 'rubric' : 'key', ...(row.member.declaredStimulus ? ['stimulus'] : [])]
    const input = { member: row.member, itemDigest: row.item.promptDigest, scoringDigest: row.item.scoringSpecDigest, sourceKeyDigest: row.item.supportManifestDigest }
    const correctness = await measurementItemAdapters.sourceKey(input)
    if (!passed(correctness) || required.some(part => !parts.has(part as Member['claims'][number]['part']) || !correctness.coveredParts.includes(part as Member['claims'][number]['part']))) fail('source_key_coverage_unknown')
    const artifact = await measurementItemAdapters.harness(input)
    if (!artifact || artifact.version !== MEASUREMENT_HARNESS_VERSION || !/^sha256:[a-f0-9]{64}$/.test(artifact.artifactDigest)
      || artifact.itemDigest !== input.itemDigest || artifact.scoringDigest !== input.scoringDigest || artifact.sourceKeyDigest !== input.sourceKeyDigest
      || !Object.values(artifact.checks).every(value => value === true) || Object.keys(artifact.checks).sort().join(',') !== 'injection,partial,scorer,sourceKeyProof,wrong'
      || !['offline_contract_only', 'live_validated'].includes(artifact.evidenceStatus)) fail('harness_artifact_unavailable')
    artifacts.push(artifact)
  }
  const artifactDigest = await measurementDigest({ manifest: loaded.manifestDigest, artifacts })
  const reasonCode = artifacts.some(artifact => artifact.evidenceStatus === 'offline_contract_only') ? 'offline_contract_only' : 'validated_inventory'
  const insertValidation = (subject: Doc<'learnMeasurementValidations'>['subject'], check: Doc<'learnMeasurementValidations'>['check']) => ctx.db.insert('learnMeasurementValidations', {
    ...base(job.userId, family), subject, subjectRevision: family.revision, subjectDigest: loaded.manifestDigest, check, decision: 'pass', reasonCode,
    validatorVersion: measurementItemAdapters.version, validatorModel: null, promptVersion: MEASUREMENT_PUBLICATION_VERSION,
    harnessArtifactDigest: artifactDigest, comparedCatalogRevision: catalog.catalogRevision, corpusDigest: compared.digest, coverageWatermark: catalog.historyCoverageWatermark,
  })
  const validationId = await insertValidation({ kind: 'family', familyId: family._id }, 'comparable_forms')
  for (const { item, spec, caseRow } of loaded.members) {
    await insertValidation({ kind: 'item', itemId: item._id }, 'source_key_correctness')
    await insertValidation({ kind: 'scoring_spec', scoringSpecId: spec._id }, 'source_key_correctness')
    const identityValidationId = await insertValidation({ kind: 'case', caseId: caseRow._id }, 'same_case_novelty')
    await ctx.db.patch(caseRow._id, { identityValidationId })
    const publicationValidationId = await insertValidation({ kind: 'item', itemId: item._id }, 'publication')
    await ctx.db.patch(item._id, { publicationValidationId, catalogRevision: catalog.catalogRevision, status: 'quarantined' })
  }
  await ctx.db.patch(family._id, { validationId, validationArtifactDigest: artifactDigest, reasonCode, recordRevision: family.recordRevision + 1 })
  await ctx.db.patch(job._id, { checkpoint: 'family_publication_pending', publicationValidationId: validationId, revision: job.revision + 1, updatedAt: Date.now() })
  return { status: 'validated' as const, revision: job.revision + 1, evidenceStatus: reasonCode }
}
async function requireValidation(ctx: ReadCtx, family: Doc<'learnMeasurementFamilies'>, loaded: Loaded) {
  const validation = family.validationId && await ctx.db.get(family.validationId)
  if (!validation || validation.userId !== family.userId || validation.subject.kind !== 'family' || validation.subject.familyId !== family._id
    || validation.check !== 'comparable_forms' || validation.decision !== 'pass' || validation.evidenceStatus !== 'available' || validation.invalidatedAt !== undefined
    || validation.subjectRevision !== family.revision || validation.subjectDigest !== loaded.manifestDigest || validation.harnessArtifactDigest !== family.validationArtifactDigest
    || validation.validatorVersion !== measurementItemAdapters.version
    || measurementCanonical(capability(validation)) !== measurementCanonical(capability(family))) fail('validation_pins_mismatch')
  for (const { item, caseRow } of loaded.members) {
    const publication = item.publicationValidationId && await ctx.db.get(item.publicationValidationId)
    const novelty = caseRow.identityValidationId && await ctx.db.get(caseRow.identityValidationId)
    if (!publication || !novelty || publication.subject.kind !== 'item' || publication.subject.itemId !== item._id || publication.check !== 'publication'
      || novelty.subject.kind !== 'case' || novelty.subject.caseId !== caseRow._id || novelty.check !== 'same_case_novelty'
      || [publication, novelty].some(row => row.userId !== family.userId || row.decision !== 'pass' || row.evidenceStatus !== 'available' || row.invalidatedAt !== undefined
        || row.subjectRevision !== family.revision || row.subjectDigest !== loaded.manifestDigest || row.harnessArtifactDigest !== family.validationArtifactDigest
        || row.validatorVersion !== measurementItemAdapters.version || row.comparedCatalogRevision !== validation.comparedCatalogRevision
        || row.corpusDigest !== validation.corpusDigest || row.coverageWatermark !== validation.coverageWatermark
        || measurementCanonical(capability(row)) !== measurementCanonical(capability(family)))) fail('validation_pins_mismatch')
  }
  return validation
}
export async function publishMeasurementFamily(ctx: MutationCtx, job: Doc<'learnJobs'>, family: Doc<'learnMeasurementFamilies'>) {
  if (job.checkpoint !== 'family_publication_pending' || family.status !== 'quarantined'
    || !['offline_contract_only', 'validated_inventory'].includes(family.reasonCode) || family.validationId !== job.publicationValidationId) fail('publication_not_validated')
  const loaded = await loadFamily(ctx, family)
  const validation = await requireValidation(ctx, family, loaded)
  const catalog = await requireMeasurementCapability(ctx, job.userId)
  const compared = await corpus(ctx, job.userId, catalog, new Set(loaded.members.map(row => row.item.caseId)))
  if (catalog.catalogRevision !== validation.comparedCatalogRevision || compared.digest !== validation.corpusDigest
    || catalog.historyCoverageWatermark !== validation.coverageWatermark) fail('catalog_revision_conflict')
  if (loaded.members.some(({ item, caseRow }) => caseRow.usageClass !== 'unknown' || caseRow.reservedAt !== undefined || item.status !== 'quarantined')) fail('case_collision')
  const now = Date.now()
  for (const { item, caseRow } of loaded.members) {
    await ctx.db.patch(caseRow._id, { usageClass: 'measurement_reserved', reservedAt: now })
    await ctx.db.patch(item._id, { status: 'published' })
  }
  await ctx.db.patch(catalog._id, { catalogRevision: catalog.catalogRevision + 1 })
  await ctx.db.patch(family._id, { status: 'provisional_equivalent', recordRevision: family.recordRevision + 1 })
  await ctx.db.patch(job._id, { status: 'succeeded', checkpoint: undefined, leaseToken: undefined, leaseExpiresAt: undefined,
    revision: job.revision + 1, updatedAt: now })
  return { status: 'published' as const, familyId: family._id, catalogRevision: catalog.catalogRevision + 1, evidenceStatus: validation.reasonCode }
}
export async function quarantineMeasurementFamily(ctx: MutationCtx, family: Doc<'learnMeasurementFamilies'>, reason: string, retire = false) {
  await ctx.db.patch(family._id, { status: retire ? 'retired' : 'quarantined', reasonCode: reason, recordRevision: family.recordRevision + 1 })
  const items = await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q => q.eq('userId', family.userId).eq('familyId', family._id).eq('familyRevision', family.revision)).take(7)
  for (const item of items) await ctx.db.patch(item._id, { status: retire ? 'retired' : 'quarantined' })
}
export async function getValidatedMeasurementFamily(ctx: QueryCtx | MutationCtx, userId: string, familyId: Id<'learnMeasurementFamilies'>) {
  await requireMeasurementCapability(ctx, userId)
  const family = await ctx.db.get(familyId)
  if (!family || family.userId !== userId || family.status !== 'provisional_equivalent' && family.status !== 'empirically_supported') fail('family_quarantined')
  const loaded = await loadFamily(ctx, family)
  await requireValidation(ctx, family, loaded)
  if (loaded.members.some(row => row.item.status !== 'published' || row.caseRow.usageClass !== 'measurement_reserved' || row.caseRow.reservedAt === undefined)) fail('family_quarantined')
  return parseLearnContract(learnMeasurementFamilyManifestSchema, { version: LEARN_V2_MEASUREMENT_VERSION, ...capability(family), familyId: family._id,
    revision: family.revision, equivalenceVersion: family.equivalenceVersion, equivalenceDescriptor: family.equivalenceDescriptor, status: family.status,
    coreFormCount: family.coreFormCount, members: loaded.members.map(({ item }) => ({ pins: itemPins(item, family, item.publicationValidationId!), reserve: item.reserve })) })
}
export async function selectUnusedMeasurementReserve(ctx: QueryCtx, userId: string, familyId: Id<'learnMeasurementFamilies'>, excludedCaseIds: string[]) {
  const manifest = await getValidatedMeasurementFamily(ctx, userId, familyId)
  for (const member of manifest.members.filter(member => member.reserve && !excludedCaseIds.includes(member.pins.caseId))) {
    const exposures = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_caseId_and_serverTime', q => q.eq('userId', userId).eq('caseId', member.pins.caseId)).take(65)
    if (exposures.length <= 64 && !exposures.some(row => row.status !== 'requested_denied')) return { status: 'available' as const, pins: member.pins }
  }
  return { status: 'unavailable' as const, reasonCode: 'novel_item_unavailable' as const }
}

export function isTestOnlyMeasurementSession(session: Pick<Doc<'studySessions'>, 'assessmentPurpose' | 'assessmentOpportunityId' | 'placementKind'>) {
  return session.assessmentPurpose === 'measurement_cold' || session.assessmentPurpose === 'measurement_delayed'
    || session.assessmentPurpose === 'retained_transfer' || session.assessmentPurpose === 'calibration'
    || LEARN_MEASUREMENT_CAPABILITIES.responses && session.placementKind === 'retained_review' || session.assessmentOpportunityId !== undefined && session.assessmentPurpose !== 'independent_application'
}
export async function validatedSessionMeasurement(ctx: QueryCtx | MutationCtx, userId: string, session: Doc<'studySessions'>) {
  if (!session.assessmentOpportunityId) fail('assessment_opportunity_unavailable')
  const opportunity = await ctx.db.get(session.assessmentOpportunityId)
  if (!opportunity || opportunity.userId !== userId || opportunity.purpose.kind !== session.assessmentPurpose
    || opportunity.assessmentPins.kind !== 'measurement' || opportunity.objectiveId !== session.primaryObjectiveId
    || opportunity.contextPins.kind === 'calibration' || opportunity.contextPins.studyPlanRevisionId !== session.studyPlanRevisionId
    || opportunity.phase !== 'preparing' && opportunity.phase !== 'ready' || opportunity.evidenceStatus !== 'available' || opportunity.invalidatedAt !== undefined) fail('assessment_opportunity_unavailable')
  const pins = opportunity.assessmentPins.itemPins
  const manifest = await getValidatedMeasurementFamily(ctx, userId, pins.familyId)
  const { scope, plan } = await sessionMeasurementScope(ctx, userId, session)
  if (measurementCanonical(capability(manifest)) !== measurementCanonical(capability(opportunity))
    || measurementCanonical(capability(manifest)) !== measurementCanonical(scope)
    || opportunity.contextPins.studyPlanId !== plan.studyPlanId || opportunity.contextPins.planRevision !== plan.revision
    || opportunity.contextPins.planRecordRevision !== plan.recordRevision
    || !manifest.members.some(member => measurementCanonical(member.pins) === measurementCanonical(pins))) fail('item_pins_mismatch')
  return { kind: 'validated_item' as const, assessmentOpportunityId: opportunity._id, itemPins: pins }
}

export async function publishInstructionalSessionCases(ctx: MutationCtx, userId: string, scope: Capability | null, candidate: { blocks: Array<{ content: string }>, claims: Array<{ claim: string }>, assessmentRubric: unknown }) {
  const catalogs = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  if (catalogs.length > 1) fail('comparison_coverage_unknown')
  const catalog = catalogs[0]
  if (!catalog) return
  const compared = await corpus(ctx, userId, catalog, new Set())
  const reservations = compared.cases.filter(row => row.usageClass === 'measurement_reserved' || row.reservedAt !== undefined)
  const texts = [...candidate.blocks.map(row => row.content), ...candidate.claims.map(row => row.claim), measurementCanonical(candidate.assessmentRubric)]
  const fingerprints = await Promise.all(texts.map(text => normalizedInstructionalCaseFingerprints(text, text)))
  if (fingerprints.some(pin => reservations.some(row => row.scenarioFingerprint === pin.scenarioFingerprint || row.solutionFingerprint === pin.solutionFingerprint))) fail('instructional_case_reserved')
  if (reservations.length && !passed(await measurementItemAdapters.compare({ purpose: 'instructional', content: candidate, corpus: reservations, sources: [], corpusDigest: compared.digest }))) fail('instructional_holdout_unknown')
  if (catalog.measurementCapability?.enabled !== true) {
    if (reservations.length) fail('measurement_disabled')
    return
  }
  if (!scope) fail('pins_mismatch')
  await requireMeasurementScope(ctx, userId, scope)
  await requireMeasurementCapability(ctx, userId)
  for (let index = 0; index < texts.length; index++) {
    const caseId = await findCase(ctx, userId, texts[index]!, texts[index]!)
    const row = await ctx.db.get(caseId)
    if (!row || row.usageClass === 'measurement_reserved' || row.reservedAt !== undefined) fail('instructional_case_reserved')
    if (row.usageClass === 'instructional') continue
    const identityValidationId = await ctx.db.insert('learnMeasurementValidations', { ...base(userId, scope), subject: { kind: 'case', caseId }, subjectRevision: 1,
      subjectDigest: await measurementDigest(fingerprints[index]), check: 'same_case_novelty', decision: 'pass', reasonCode: 'instructional_holdout_checked',
      validatorVersion: measurementItemAdapters.version, validatorModel: null, promptVersion: MEASUREMENT_PUBLICATION_VERSION,
      harnessArtifactDigest: await measurementDigest({ policy: MEASUREMENT_NOVELTY_VERSION, corpus: compared.digest }),
      comparedCatalogRevision: catalog.catalogRevision, corpusDigest: compared.digest, coverageWatermark: catalog.historyCoverageWatermark })
    await ctx.db.patch(caseId, { usageClass: 'instructional', identityValidationId })
  }
  await ctx.db.patch(catalog._id, { catalogRevision: catalog.catalogRevision + 1 })
}
