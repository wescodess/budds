import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireAuth } from './auth'
import type { artifactSourceDependencyValidator } from './learnV2ArtifactLineageContract'
import {
  LEARN_ARTIFACT_LINEAGE_LIMITS as limits, LEARN_ARTIFACT_LINEAGE_VERSION,
  learnArtifactCaseSchema, learnArtifactRegistrationArgsSchema, learnArtifactRegistrationResultSchema,
  learnArtifactReferenceSchema, learnArtifactSourceDependencySchema, learnArtifactValidationSchema, validateLearnArtifactLookup, validateLearnArtifactLookupResult,
  type LearnArtifactReference, type LearnArtifactLookupResult,
} from '../../shared/learn-v2-artifact-lineage'
import { learnSequenceSchema, learnVersionSchema, learnSerializedBytes, parseLearnContract } from '../../shared/learn-v2-responses'

type ReadCtx = QueryCtx | MutationCtx
type Lineage = Doc<'learnArtifactLineages'>
type Dependency = Infer<typeof artifactSourceDependencyValidator>
class Unavailable extends Error {}
function unavailable(): never { throw new Unavailable('Artifact lineage unavailable') }
function available(row: { evidenceStatus: string, invalidatedAt?: number } | null) {
  return row?.evidenceStatus === 'available' && row.invalidatedAt === undefined
}

async function readCatalog(ctx: ReadCtx, userId: string) {
  const rows = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  if (rows.length !== 1 || !learnSequenceSchema.safeParse(rows[0]!.catalogRevision).success) unavailable()
  return rows[0]!
}

async function findLineage(ctx: ReadCtx, userId: string, reference: LearnArtifactReference) {
  const rows = await ctx.db.query('learnArtifactLineages')
    .withIndex('by_userId_and_artifact_kind_and_artifact_id_and_key_and_revision', q => q.eq('userId', userId)
      .eq('artifact.kind', reference.artifact.kind).eq('artifact.id', reference.artifact.id).eq('key', reference.key).eq('revision', reference.revision)).take(2)
  if (rows.length !== 1 || rows[0]!.payloadDigest !== reference.payloadDigest) unavailable()
  return rows[0]!
}

async function sourceAvailable(ctx: ReadCtx, userId: string, source: Dependency) {
  if (source.kind === 'document') {
    const document = await ctx.db.get(source.documentId)
    return document?.userId === userId && document.status === 'success' && document.sourceRevision === source.sourceRevision
  }
  if (source.kind === 'folder') return (await ctx.db.get(source.folderId))?.userId === userId
  const snapshot = await ctx.db.get(source.sourceSnapshotId)
  if (!snapshot || snapshot.userId !== userId || (snapshot.effectiveStatus ?? snapshot.status) !== 'user_accepted'
    || snapshot.evidencePurgedAt !== undefined || snapshot.rightsStatus !== 'permitted' || snapshot.conflictStatus !== 'clear'
    || snapshot.revision !== source.revision || (snapshot.recordRevision ?? 1) !== source.recordRevision || snapshot.contentHash !== source.contentHash) return false
  const identity = await ctx.db.get(snapshot.sourceIdentityId)
  if (!identity || identity.userId !== userId) return false
  if (identity.folderDocumentId) {
    const document = await ctx.db.get(identity.folderDocumentId)
    if (!document || document.userId !== userId) return false
  }
  if (source.kind === 'snapshot') return true
  const excerpt = await ctx.db.get(source.sourceExcerptId)
  return excerpt?.userId === userId && excerpt.sourceSnapshotId === snapshot._id && excerpt.rightsStatus === 'permitted'
    && excerpt.evidencePurgedAt === undefined && excerpt.excerpt !== undefined
}

function validationProjection(row: Doc<'learnArtifactValidations'>) {
  return { lineageId: row.lineageId, payloadDigest: row.payloadDigest, manifestDigest: row.manifestDigest, decision: row.decision,
    comparedCatalogRevision: row.comparedCatalogRevision, coverage: row.coverage, coverageWatermark: row.coverageWatermark,
    corpusDigest: row.corpusDigest, identityPolicyVersion: row.identityPolicyVersion, noveltyPolicyVersion: row.noveltyPolicyVersion,
    validatorVersion: row.validatorVersion, validatorModel: row.validatorModel, harnessArtifactDigest: row.harnessArtifactDigest }
}

export async function artifactManifestDigest(
  row: Lineage, origins: Doc<'learnArtifactLineageOrigins'>[], cases: Doc<'learnArtifactCaseBindings'>[], sources: Doc<'learnArtifactSourceLinks'>[],
) {
  if (origins.length > limits.maxOrigins || cases.length > limits.maxCases || sources.length > limits.maxSources) unavailable()
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, canonical(child)]))
    return value
  }
  const sorted = (values: unknown[]) => values.map(value => JSON.stringify(canonical(value))).sort()
  const manifest = { version: row.lineageVersion, userId: row.userId, artifact: row.artifact, key: row.key, revision: row.revision,
    payloadDigest: row.payloadDigest, classification: row.classification, authority: row.authority, authorityVersion: row.authorityVersion, derivation: row.derivation,
    origins: sorted(origins.map(origin => ({ lineageId: origin.originLineageId, revision: origin.originRevision, payloadDigest: origin.originPayloadDigest,
      manifestDigest: origin.originManifestDigest, classification: origin.classification, transformation: origin.transformation }))),
    cases: sorted(cases.map(binding => ({ caseId: binding.caseId, scenarioFingerprint: binding.scenarioFingerprint,
      solutionFingerprint: binding.solutionFingerprint, identityPolicyVersion: binding.identityPolicyVersion }))),
    sources: sorted(sources.map(link => link.dependency ?? null)) }
  learnSerializedBytes(manifest, limits.maxLookupBytes)
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(manifest)))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
}

async function inspectGraph(ctx: ReadCtx, userId: string, root: Lineage, catalogRevision: number, requirePublication: boolean) {
  const nodes = new Map<Id<'learnArtifactLineages'>, Lineage>()
  const active = new Set<Id<'learnArtifactLineages'>>()
  const cases = new Map<Id<'learnAssessmentCases'>, Doc<'learnArtifactCaseBindings'>>()
  const usage = new Map<Id<'learnAssessmentCases'>, Doc<'learnAssessmentCases'>['usageClass']>()
  let sourceCount = 0
  let caseCount = 0
  const validations = new Map<Id<'learnArtifactLineages'>, ReturnType<typeof validationProjection> & { validationId: Id<'learnArtifactValidations'> }>()
  const visit = async (row: Lineage, depth: number): Promise<void> => {
    if (depth > limits.maxDepth || active.has(row._id)) unavailable()
    if (nodes.has(row._id)) return
    if (nodes.size >= limits.maxNodes || row.userId !== userId || !available(row)
      || row.lineageVersion !== LEARN_ARTIFACT_LINEAGE_VERSION || row.classification === 'unknown'
      || row.classification !== root.classification || !learnVersionSchema.safeParse(row.authorityVersion).success) unavailable()
    if ((row.classification === 'genuine_personal_work' && row.authority !== (row.derivation === 'original' ? 'personal_authorship' : 'server_producer'))
      || (row.classification === 'legacy_history' && row.authority !== (row.derivation === 'original' ? 'legacy_record' : 'server_producer'))
      || (row.classification !== 'genuine_personal_work' && row.classification !== 'legacy_history' && row.authority !== 'server_producer')) unavailable()
    if ((row.artifact.kind === 'measurement_item' && row.classification !== 'measurement')
      || (row.artifact.kind === 'scoring_spec' && row.classification !== 'private_scoring')) unavailable()
    const record = await ctx.db.get(row.artifact.id)
    if (!record || record.userId !== userId) unavailable()
    if (!learnArtifactReferenceSchema.safeParse({ artifact: row.artifact, key: row.key, revision: row.revision, payloadDigest: row.payloadDigest }).success) unavailable()
    if (!row.validationId) unavailable()
    const validation = await ctx.db.get(row.validationId)
    if (!validation || validation.userId !== userId || !available(validation)) unavailable()
    const parsed = learnArtifactValidationSchema.safeParse(validationProjection(validation))
    if (!parsed.success || parsed.data.lineageId !== row._id || parsed.data.payloadDigest !== row.payloadDigest || parsed.data.manifestDigest !== row.manifestDigest
      || parsed.data.decision !== 'pass' || parsed.data.coverage !== 'complete' || parsed.data.comparedCatalogRevision > catalogRevision) unavailable()
    validations.set(row._id, { ...parsed.data, validationId: validation._id })
    const [origins, bindings, sources] = await Promise.all([
      ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxOrigins + 1),
      ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxCases + 1),
      ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxSources + 1),
    ])
    sourceCount += sources.length
    caseCount += bindings.length
    if (origins.length > limits.maxOrigins || caseCount > limits.maxCases || sourceCount > limits.maxSources
      || row.originCount !== origins.length || row.caseCount !== bindings.length || row.sourceCount !== sources.length
      || (row.derivation === 'original' ? origins.length !== 0 : origins.length === 0)
      || new Set(origins.map(origin => origin.originLineageId)).size !== origins.length
      || new Set(bindings.map(binding => binding.caseId)).size !== bindings.length) unavailable()
    try {
      if (await artifactManifestDigest(row, origins, bindings, sources) !== row.manifestDigest) unavailable()
    }
    catch { unavailable() }
    nodes.set(row._id, row)
    active.add(row._id)
    for (const link of sources) {
      const dependency = learnArtifactSourceDependencySchema.safeParse(link.dependency)
      if (!available(link) || !dependency.success || !(await sourceAvailable(ctx, userId, dependency.data))) unavailable()
    }
    for (const binding of bindings) {
      const pin = learnArtifactCaseSchema.safeParse({ caseId: binding.caseId, scenarioFingerprint: binding.scenarioFingerprint,
        solutionFingerprint: binding.solutionFingerprint, identityPolicyVersion: binding.identityPolicyVersion })
      const candidate = await ctx.db.get(binding.caseId)
      if (!pin.success || !candidate || candidate.userId !== userId || candidate.scenarioFingerprint !== binding.scenarioFingerprint
        || candidate.solutionFingerprint !== binding.solutionFingerprint || candidate.identityPolicyVersion !== binding.identityPolicyVersion
        || binding.identityPolicyVersion !== parsed.data.identityPolicyVersion) unavailable()
      const [scenarios, solutions] = await Promise.all([
        ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint', q => q.eq('userId', userId).eq('scenarioFingerprint', binding.scenarioFingerprint)).take(2),
        ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_solutionFingerprint', q => q.eq('userId', userId).eq('solutionFingerprint', binding.solutionFingerprint)).take(2),
      ])
      if (scenarios.length !== 1 || solutions.length !== 1) unavailable()
      cases.set(binding.caseId, binding)
      usage.set(binding.caseId, candidate.reservedAt === undefined ? candidate.usageClass : 'measurement_reserved')
    }
    for (const origin of origins) {
      const parent = await ctx.db.get(origin.originLineageId)
      if (!parent || parent.userId !== userId || parent.revision !== origin.originRevision || parent.payloadDigest !== origin.originPayloadDigest || parent.manifestDigest !== origin.originManifestDigest
        || parent.classification !== origin.classification) unavailable()
      await visit(parent, depth + 1)
    }
    active.delete(row._id)
  }
  await visit(root, 0)
  const rootValidation = validations.get(root._id)
  if (!rootValidation) unavailable()
  const publication = root.publication
  if (publication && (publication.validationId !== root.validationId || !Number.isSafeInteger(publication.catalogRevision)
    || publication.catalogRevision !== rootValidation.comparedCatalogRevision + 1 || publication.catalogRevision > catalogRevision)) unavailable()
  if (requirePublication && (root.classification === 'teaching') && !publication) unavailable()
  if (publication && [...usage.values()].some(value => value !== 'instructional')) unavailable()
  return { nodes, cases, usage, validation: rootValidation }
}

export async function resolveArtifactLineageForOwner(ctx: ReadCtx, userId: string, input: unknown): Promise<LearnArtifactLookupResult> {
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  const { reference } = validateLearnArtifactLookup(input)
  try {
    const catalog = await readCatalog(ctx, userId)
    const root = await findLineage(ctx, userId, reference)
    const graph = await inspectGraph(ctx, userId, root, catalog.catalogRevision, true)
    return validateLearnArtifactLookupResult({ status: 'bound', version: LEARN_ARTIFACT_LINEAGE_VERSION,
      lineageId: root._id, reference, classification: root.classification, instructionalRegistered: root.publication !== undefined,
      catalogRevision: catalog.catalogRevision, originLineageIds: [...graph.nodes.keys()].filter(id => id !== root._id),
      cases: [...graph.cases.values()].map(binding => ({ caseId: binding.caseId, scenarioFingerprint: binding.scenarioFingerprint,
        solutionFingerprint: binding.solutionFingerprint, identityPolicyVersion: binding.identityPolicyVersion, usageClass: graph.usage.get(binding.caseId)! })),
      validation: graph.validation })
  }
  catch (error) {
    if (!(error instanceof Unavailable)) throw error
    return { status: 'unavailable', version: LEARN_ARTIFACT_LINEAGE_VERSION }
  }
}

export async function advanceAssessmentCatalogForOwner(ctx: MutationCtx, userId: string, expectedRevision: number) {
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  const catalog = await readCatalog(ctx, userId)
  if (!learnSequenceSchema.safeParse(expectedRevision).success || catalog.catalogRevision !== expectedRevision
    || !Number.isSafeInteger(expectedRevision + 1)) unavailable()
  await ctx.db.patch(catalog._id, { catalogRevision: expectedRevision + 1 })
  return expectedRevision + 1
}

// Dormant transaction seam; callers must write their artifact in this mutation.
export async function registerInstructionalArtifactForOwner(ctx: MutationCtx, userId: string, input: unknown) {
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  const args = parseLearnContract(learnArtifactRegistrationArgsSchema, input)
  const catalog = await readCatalog(ctx, userId)
  const root = await findLineage(ctx, userId, args.reference)
  if (root.classification !== 'teaching' && root.classification !== 'genuine_personal_work') unavailable()
  if (root.publication || root.validationId !== args.validationId || catalog.catalogRevision !== args.expectedCatalogRevision) unavailable()
  const graph = await inspectGraph(ctx, userId, root, catalog.catalogRevision, false)
  if (graph.validation.comparedCatalogRevision !== catalog.catalogRevision || catalog.historyCompleteness !== 'prospective_complete'
    || graph.validation.coverageWatermark !== catalog.historyCoverageWatermark) unavailable()
  for (const binding of graph.cases.values()) {
    if (graph.usage.get(binding.caseId) === 'measurement_reserved') unavailable()
    await ctx.db.patch(binding.caseId, { usageClass: 'instructional', artifactIdentityValidationId: args.validationId })
  }
  const catalogRevision = await advanceAssessmentCatalogForOwner(ctx, userId, args.expectedCatalogRevision)
  await ctx.db.patch(root._id, { publication: { validationId: args.validationId, catalogRevision, publishedAt: Date.now() } })
  return parseLearnContract(learnArtifactRegistrationResultSchema, { version: LEARN_ARTIFACT_LINEAGE_VERSION, lineageId: root._id, catalogRevision })
}
