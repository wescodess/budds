import { ConvexError, getDocumentSize, type Infer, type Value } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireAuth } from './auth'
import { rejectAccountDeletion } from './accountDeletionTombstone'
import { requireActiveBlueprint } from './learnV2BlueprintAuthority'
import { liveEvidenceState } from '../learnAdaptiveRecovery'
import type { artifactSourceDependencyValidator } from './learnV2ArtifactLineageContract'
import {
  LEARN_ARTIFACT_LINEAGE_LIMITS as limits, LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_CONTENT_VERSION, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY,
  LEARN_ARTIFACT_PREPARATION_VERSION, LEARN_ARTIFACT_CASE_IDENTITY_VERSION, LEARN_ARTIFACT_RESERVATION_VERSION, LEARN_ARTIFACT_SEMANTIC_VERSION,
  LEARN_ARTIFACT_INPUT_ADMISSION_VERSION,
  learnArtifactCaseSchema, learnArtifactRegistrationArgsSchema, learnArtifactRegistrationResultSchema,
  learnArtifactBatchRegistrationArgsSchema, learnArtifactBatchRegistrationResultSchema, learnArtifactOwnerRecordSchema, learnArtifactSupersessionArgsSchema,
  learnArtifactReferenceSchema, learnArtifactSourceDependencySchema, learnArtifactValidationSchema, validateLearnArtifactLookup, validateLearnArtifactLookupResult,
  learnArtifactPreparationArgsSchema, learnArtifactPreparationResultSchema,
  type LearnArtifactReference, type LearnArtifactLookupResult, type LearnArtifactOwnerRecord, type LearnArtifactPreparationArgs, type LearnArtifactInputAdmissionResult,
} from '../../shared/learn-v2-artifact-lineage'
import { learnSequenceSchema, learnVersionSchema, learnSerializedBytes, parseLearnContract } from '../../shared/learn-v2-responses'

type ReadCtx = QueryCtx | MutationCtx
type Lineage = Doc<'learnArtifactLineages'>
type ArtifactPin = Pick<Lineage, 'artifact' | 'key' | 'revision' | 'payloadDigest'>
type Dependency = Infer<typeof artifactSourceDependencyValidator>
class Unavailable extends Error {}
class ReadBudgetExceeded extends Unavailable {}
export class ArtifactProjectionBudgetError extends ConvexError<Extract<LearnArtifactInputAdmissionResult, { status: 'rejected' }>> {
  constructor() { super({ version: LEARN_ARTIFACT_INPUT_ADMISSION_VERSION, status: 'rejected', reasonCode: 'projection_exceeds_budget' }) }
}
function unavailable(): never { throw new Unavailable('Artifact lineage unavailable') }
function available(row: { evidenceStatus: string, invalidatedAt?: number } | null) {
  return row?.evidenceStatus === 'available' && row.invalidatedAt === undefined
}

// Keep three quarters of the transaction's 16 MiB read allowance for C4.3.
export const ARTIFACT_LINEAGE_READ_BYTES = 4 * 1024 * 1024
// Empty index ranges cost no bytes; keep half of Convex's 4,096 for C4.3.
export const ARTIFACT_LINEAGE_INDEX_RANGES = 2048
export const ARTIFACT_LINEAGE_PUBLICATION_READ_BYTES = 8 * 1024 * 1024
export const ARTIFACT_LINEAGE_PUBLICATION_INDEX_RANGES = 3072
const MAX_DOCUMENT_READ_BYTES = 1024 * 1024 + 64
const budgetContext = Symbol('artifactLineageReadBudget')
const ARTIFACT_CONTENT_BYTES = 500_000

// All reads, including those inside shared authority helpers and indexed
// queries, use one budget. Reserve a maximum-size document BEFORE each read;
// charge the SDK's document size plus 64 bytes of conservative overhead.
export function createArtifactLineageReadContext<T extends ReadCtx>(ctx: T) {
  const existing = Reflect.get(ctx, budgetContext) as { usage: () => ArtifactLineageReadUsage, indexRanges: () => number } | undefined
  if (existing) return { ctx, get readUsage() { return existing.usage() }, get indexRanges() { return existing.indexRanges() } }
  return createReadBudget(ctx, ARTIFACT_LINEAGE_READ_BYTES, ARTIFACT_LINEAGE_INDEX_RANGES)
}

function createReadBudget<T extends ReadCtx>(ctx: T, byteLimit: number, rangeLimit: number) {
  let bytes = 0
  let documentsRead = 0
  let readRequests = 0
  const state = { usage: () => ({ chargedBytes: bytes, documentsRead, readRequests, limitBytes: byteLimit }), indexRanges: () => ranges }
  let reserved = 0
  let ranges = 0
  const range = () => {
    if (ranges >= rangeLimit) throw new ReadBudgetExceeded('Artifact lineage unavailable')
    ranges++
  }
  const read = async <R>(operation: () => Promise<R>): Promise<R> => {
    if (bytes + reserved + MAX_DOCUMENT_READ_BYTES > byteLimit) throw new ReadBudgetExceeded('Artifact lineage unavailable')
    reserved += MAX_DOCUMENT_READ_BYTES
    readRequests++
    try {
      const result = await operation()
      if (result !== null && result !== undefined) {
        // Iterator results are unwrapped before reaching this function.
        const size = getDocumentSize(result as Record<string, Value>) + 64
        if (size > MAX_DOCUMENT_READ_BYTES) throw new ReadBudgetExceeded('Artifact lineage unavailable')
        bytes += size
        documentsRead++
      }
      return result
    }
    finally { reserved -= MAX_DOCUMENT_READ_BYTES }
  }
  const iterate = async function* (query: object) {
    range()
    const iterator = (query as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    try {
      while (true) {
        let done = false
        const row = await read(async () => {
          const next = await iterator.next()
          done = next.done === true
          return done ? null : next.value
        })
        if (done) return
        yield row
      }
    }
    finally { await iterator.return?.() }
  }
  const boundedQuery = <Q extends object>(query: Q): Q => new Proxy(query, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return () => iterate(target)
      if (property === 'take' || property === 'first' || property === 'unique') return async (count?: number) => {
        const limit = property === 'take' ? count : property === 'first' ? 1 : 2
        if (limit === undefined || !Number.isSafeInteger(limit) || limit < 0) unavailable()
        const rows: unknown[] = []
        if (limit > 0) {
          for await (const row of iterate(target)) {
            rows.push(row)
            if (rows.length === limit) break
          }
        }
        if (property === 'take') return rows
        if (property === 'unique' && rows.length > 1) unavailable()
        return rows[0] ?? null
      }
      // No batch terminal can bypass per-document reservation.
      if (property !== 'withIndex' && property !== 'order') unavailable()
      const method: unknown = Reflect.get(target, property)
      if (typeof method !== 'function') unavailable()
      return (...args: unknown[]) => boundedQuery(Reflect.apply(method, target, args) as object)
    },
  })
  const db = new Proxy(ctx.db, {
    get(target, property) {
      const method: unknown = Reflect.get(target, property)
      if (typeof method !== 'function') return method
      if (property === 'get') return async (...args: unknown[]) => {
        range()
        return read(() => Reflect.apply(method, target, args))
      }
      if (property === 'query') return (...args: unknown[]) => boundedQuery(Reflect.apply(method, target, args) as object)
      return method.bind(target)
    },
  })
  const budgeted = new Proxy(ctx, { get: (target, property) => property === budgetContext ? state : property === 'db' ? db : Reflect.get(target, property) })
  return { ctx: budgeted, get readUsage() { return state.usage() }, get indexRanges() { return state.indexRanges() } }
}
export function createArtifactLineagePublicationContext<T extends ReadCtx>(ctx: T) {
  const total = createReadBudget(ctx, ARTIFACT_LINEAGE_PUBLICATION_READ_BYTES, ARTIFACT_LINEAGE_PUBLICATION_INDEX_RANGES)
  return { admission: createReadBudget(total.ctx, ARTIFACT_LINEAGE_READ_BYTES, ARTIFACT_LINEAGE_INDEX_RANGES),
    preparation: createReadBudget(total.ctx, 6 * 1024 * 1024, ARTIFACT_LINEAGE_INDEX_RANGES),
    get readUsage() { return total.readUsage }, get indexRanges() { return total.indexRanges } }
}
export type ArtifactLineageReadUsage = { chargedBytes: number, documentsRead: number, readRequests: number, limitBytes: number }
function withReadBudget<T extends ReadCtx>(ctx: T): T { return createArtifactLineageReadContext(ctx).ctx }

function preparationSourceSnapshot<T extends ReadCtx>(ctx: T): T {
  // These tables are immutable during preparation. Each call gets a fresh
  // snapshot; producer edits between publications must always be reread.
  const reads = new Map<string, Promise<unknown>>()
  const db = new Proxy(ctx.db, { get(target, property) {
    const method: unknown = Reflect.get(target, property)
    if (property !== 'get' || typeof method !== 'function') return typeof method === 'function' ? method.bind(target) : method
    return (...args: unknown[]) => {
      const id = args.at(-1)
      if (typeof id !== 'string' || !(['documents', 'folders', 'courses'] as const).some(table => target.normalizeId(table, id))) return Reflect.apply(method, target, args)
      let read = reads.get(id)
      if (!read) { read = Reflect.apply(method, target, args) as Promise<unknown>; reads.set(id, read) }
      return read
    }
  } })
  return new Proxy(ctx, { get: (target, property) => property === 'db' ? db : Reflect.get(target, property) })
}

type SessionEvidence = { claims: Doc<'sessionContentClaims'>[], supports: Doc<'learnClaimSupports'>[] }
type AudioPlayback = {
  episode: Doc<'audioOverviewEpisodes'>, media: Doc<'audioOverviewAudioArtifacts'>,
  manifest: Doc<'audioOverviewSourceManifests'>, entries: Doc<'audioOverviewSourceManifestEntries'>[],
  outline: Doc<'audioOverviewOutlines'>, objectives: Doc<'audioOverviewLearningObjectives'>[], outlineSources: Doc<'audioOverviewOutlineSources'>[],
  claims: Doc<'audioOverviewClaims'>[], claimSources: Doc<'audioOverviewClaimSources'>[], scenes: Doc<'audioOverviewScenes'>[],
  utterances: Doc<'audioOverviewUtterances'>[], utteranceSources: Doc<'audioOverviewUtteranceSources'>[], utteranceClaims: Doc<'audioOverviewUtteranceClaims'>[],
  segments: Doc<'audioOverviewAlignmentSegments'>[],
}
type SectionLinks = Array<
  | { kind: 'quiz', questions: Doc<'quizQuestions'>[] }
  | { kind: 'flashcard', cards: Doc<'flashcardRoomCards'>[] }
  | { kind: 'audio', content: ReturnType<typeof sectionAudioContent> }
  | null
>
type ArtifactContent =
  | { kind: 'session_block', block: Doc<'sessionContentBlocks'>, content: Doc<'sessionContent'>, evidence: SessionEvidence }
  | { kind: 'document' | 'document_chunk', document: Doc<'documents'> }
  | { kind: 'quiz_question', question: Doc<'quizQuestions'> }
  | { kind: 'section_block', section: Doc<'courseSections'>, linked: SectionLinks }
  | { kind: 'flashcard_version', version: Doc<'flashcardRoomVersions'>, cards: Doc<'flashcardVersionCards'>[] }
  | { kind: 'audio_overview', overview: Doc<'audioOverviews'>, playback: AudioPlayback | null }
  | { kind: 'learner_artifact', artifact: Doc<'learningThreadArtifacts'> }
  | { kind: 'measurement_item' | 'scoring_spec', item: Doc<'learnMeasurementItems'>, family: Doc<'learnMeasurementFamilies'>, spec: Doc<'learnMeasurementScoringSpecs'> }

function objectIdentity(row: { _id: string, userId: string }) { return { id: row._id, userId: row.userId } }
function capability(row: Doc<'learnMeasurementItems'> | Doc<'learnMeasurementFamilies'> | Doc<'learnMeasurementScoringSpecs'>) {
  return { learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, blueprintRecordRevision: row.blueprintRecordRevision,
    objectiveId: row.objectiveId, assessmentContractVersion: row.assessmentContractVersion, assessmentContractDigest: row.assessmentContractDigest, depth: row.depth }
}

function questionContent(q: Doc<'quizQuestions'>) {
  return { ...objectIdentity(q), quizId: q.quizId, order: q.order, question: q.question, type: q.type, options: q.options, correctAnswer: q.correctAnswer,
    gradingCriteria: q.gradingCriteria, explanation: q.explanation, correctedAnswer: q.correctedAnswer, correctedExplanation: q.correctedExplanation,
    sourceDocumentId: q.sourceDocumentId, sourceChunkContent: q.sourceChunkContent }
}

function cardContent(c: Doc<'flashcardVersionCards'> | Doc<'flashcardRoomCards'>) {
  return { ...objectIdentity(c), roomId: c.roomId, displayOrder: c.displayOrder, term: c.term, definition: c.definition,
    sourceDocumentId: c.sourceDocumentId, sourceChunkContent: c.sourceChunkContent,
    source: c.metadata?.source ? { documentId: c.metadata.source.documentId, chunkContent: c.metadata.source.chunkContent } : undefined,
    ...('correctedDefinition' in c ? { correctedDefinition: c.correctedDefinition } : {}) }
}

// AudioBlock reads getCourseScopedOverview, including compatibility turns for
// V2. Its content surface is smaller than the standalone V2 playback player.
function sectionAudioContent(o: Doc<'audioOverviews'>) {
  return { ...objectIdentity(o), title: o.title, turns: o.turns, voiceProfile: o.voiceProfile,
    hostNames: o.hostNames, totalDurationMs: o.totalDurationMs, sourceDocumentIds: o.sourceDocumentIds ?? [] }
}

// Mirrors loadPlaybackProjection's teaching fields, including its joins and
// ordering. Share state, provider/model diagnostics and alignment progress are
// operational; only timing/words visible after alignment completion are content.
function audioContent(o: Doc<'audioOverviews'>, p: AudioPlayback | null) {
  if (!p) return { ...objectIdentity(o), folderId: o.folderId, roomId: o.roomId, title: o.title, turns: o.turns,
    voiceProfile: o.voiceProfile, hostNames: o.hostNames, preferences: o.preferences, totalDurationMs: o.totalDurationMs,
    sourceDocumentIds: o.sourceDocumentIds, scopeDocIds: o.scopeDocIds, courseScoped: o.courseScoped }
  const { episode: e, media: m } = p
  const entryById = new Map(p.entries.map(entry => [String(entry._id), entry]))
  const claimById = new Map(p.claims.map(claim => [String(claim._id), claim]))
  const sourceId = (id: Id<'audioOverviewSourceManifestEntries'>) => entryById.get(String(id))?.sourceId
  const sources = (links: Array<{ manifestEntryId: Id<'audioOverviewSourceManifestEntries'> }>) => links.map(link => sourceId(link.manifestEntryId)).filter((id): id is string => id !== undefined)
  return { ...objectIdentity(o), episodeId: e._id, schemaVersion: 2, title: e.title,
    voiceProfile: { hostA: e.hostAVoice, hostB: e.hostBVoice }, hostNames: { hostA: e.hostAName ?? 'Host A', hostB: e.hostBName ?? 'Host B' },
    preferences: { lengthMinutes: e.requestedLengthMinutes, complexity: e.complexity }, totalDurationMs: m.durationMs,
    sourceManifest: { revision: p.manifest.revision, contentHash: p.manifest.contentHash, sources: p.entries.map(entry => ({ sourceId: entry.sourceId,
      documentId: entry.documentId, revision: entry.revision, contentHash: entry.contentHash, displayReference: entry.displayReference })) },
    outline: { narrativeArc: p.outline.narrativeArc, learningObjectives: p.objectives.map(objective => objective.text), plannedSourceIds: sources(p.outlineSources) },
    claims: p.claims.filter(claim => claim.status === 'supported').map(claim => ({ claimId: claim.claimId, text: claim.text,
      sourceIds: sources(p.claimSources.filter(link => link.claimRecordId === claim._id)) })),
    scenes: p.scenes.map(scene => ({ sceneId: scene._id, order: scene.order, title: scene.title, narrativePurpose: scene.narrativePurpose, durationMs: scene.durationMs ?? scene.targetDurationMs })),
    utterances: p.utterances.map((u) => {
      const timings = p.segments.filter(segment => segment.utteranceId === u._id).sort((a, b) => a.wordIndex - b.wordIndex)
      return { utteranceId: u._id, sceneId: u.sceneId, order: u.order, sceneOrder: u.sceneOrder, speaker: u.speaker, text: u.text,
        emotionalIntent: u.emotionalIntent, deliveryIntent: u.deliveryIntent, pauseAfterMs: u.pauseAfterMs,
        sourceIds: sources(p.utteranceSources.filter(link => link.utteranceId === u._id)),
        claimIds: p.utteranceClaims.filter(link => link.utteranceId === u._id).flatMap((link) => {
          const claim = claimById.get(String(link.claimRecordId))
          return claim?.status === 'supported' ? [claim.claimId] : []
        }),
        alignmentStartMs: timings[0]?.startMs,
        wordTimings: timings.length ? timings.map(t => ({ word: t.word, start: t.startMs / 1000, end: t.endMs / 1000 })) : undefined }
    }),
    finalArtifact: { artifactId: m._id, storageProvider: m.storageProvider, objectKey: m.objectKey, checksumSha256: m.checksumSha256, byteLength: m.byteLength,
      contentType: m.contentType, container: m.container, sampleRateHz: m.sampleRateHz, channelCount: m.channelCount, bitsPerSample: m.bitsPerSample, durationMs: m.durationMs } }
}

// Explicit allowlists: new operational fields never silently enter a content
// pin. Section/audio titles are instructional headings; room/version labels
// and document filenames are organizational metadata. Liveness is separate.
export function artifactContentProjection(input: ArtifactContent) {
  const payload = (() => {
    switch (input.kind) {
      case 'session_block': {
        const { block: b, content: c } = input
        return { block: { ...objectIdentity(b), sessionContentId: b.sessionContentId, order: b.order, kind: b.kind, content: b.content, claimOrdersJson: b.claimOrdersJson },
          content: { ...objectIdentity(c), studySessionId: c.studySessionId, studyPlanRevisionId: c.studyPlanRevisionId, blueprintRevisionId: c.blueprintRevisionId,
            objectiveId: c.objectiveId, revision: c.revision, inputDigest: c.inputDigest, candidateDigest: c.candidateDigest,
            assessmentRubricSnapshot: c.assessmentRubricSnapshot, generatorVersion: c.generatorVersion,
            assessmentOpportunityId: c.assessmentOpportunityId, assessmentPurpose: c.assessmentPurpose },
          claims: input.evidence.claims.map(c => ({ ...objectIdentity(c), sessionContentId: c.sessionContentId, order: c.order, claim: c.claim, verifierVersion: c.verifierVersion, confidence: c.confidence })),
          supports: input.evidence.supports.map(s => ({ ...objectIdentity(s), sessionContentClaimId: s.sessionContentClaimId, sourceSnapshotId: s.sourceSnapshotId,
            entailment: s.entailment, verifierVersion: s.verifierVersion, confidence: s.confidence, conflictStatus: s.conflictStatus })) }
      }
      case 'document': case 'document_chunk': {
        const d = input.document
        return { ...objectIdentity(d), sourceRevision: d.sourceRevision, contentHash: d.contentHash, r2Key: d.r2Key, fileId: d.fileId,
          fileSize: d.fileSize, sourceType: d.sourceType, sourceUrl: d.sourceUrl, mimeType: d.mimeType }
      }
      case 'quiz_question': {
        return questionContent(input.question)
      }
      case 'section_block': {
        const s = input.section
        return { ...objectIdentity(s), courseId: s.courseId, order: s.order, title: s.title, knowledgeType: s.knowledgeType, contentBlocks: s.contentBlocks,
          linked: input.linked.map(link => !link ? null : link.kind === 'quiz' ? { kind: link.kind, questions: link.questions.map(questionContent) }
            : link.kind === 'flashcard' ? { kind: link.kind, cards: link.cards.map(cardContent) } : link) }
      }
      case 'flashcard_version': {
        const v = input.version
        return { version: { ...objectIdentity(v), roomId: v.roomId, prompt: v.prompt }, cards: [...input.cards].sort((a, b) => a.displayOrder - b.displayOrder)
          .map(c => ({ ...cardContent(c), versionId: c.versionId })) }
      }
      case 'audio_overview': {
        return audioContent(input.overview, input.playback)
      }
      case 'learner_artifact': {
        const a = input.artifact
        return { ...objectIdentity(a), threadId: a.threadId, activityId: a.activityId, artifactKind: a.artifactKind, revision: a.revision,
          title: a.title, summary: a.summary, r2ObjectKey: a.r2ObjectKey }
      }
      case 'measurement_item': case 'scoring_spec': {
        const { item: i, family: f, spec: s } = input
        return { item: { ...objectIdentity(i), ...capability(i), itemKey: i.itemKey, revision: i.revision, familyId: i.familyId, familyRevision: i.familyRevision,
          caseId: i.caseId, formLabel: i.formLabel, reserve: i.reserve, prompt: i.prompt, declaredStimulus: i.declaredStimulus, promptDigest: i.promptDigest,
          responseSpec: i.responseSpec, scoringSpecId: i.scoringSpecId, scoringSpecRevision: i.scoringSpecRevision, scoringSpecDigest: i.scoringSpecDigest,
          generatorVersion: i.generatorVersion, generationJobId: i.generationJobId, inputDigest: i.inputDigest, supportManifestDigest: i.supportManifestDigest,
          publicationValidationId: i.publicationValidationId },
        family: { ...objectIdentity(f), ...capability(f), familyKey: f.familyKey, revision: f.revision, recordRevision: f.recordRevision,
          equivalenceVersion: f.equivalenceVersion, equivalenceDescriptor: f.equivalenceDescriptor, coreFormCount: f.coreFormCount,
          totalFormCount: f.totalFormCount, validationId: f.validationId, validationArtifactDigest: f.validationArtifactDigest },
        spec: { ...objectIdentity(s), ...capability(s), itemId: s.itemId, revision: s.revision, digest: s.digest, payload: s.payload,
          referenceSolution: s.referenceSolution, derivation: s.derivation, scoringBinding: s.scoringBinding } }
      }
    }
  })()
  return { version: LEARN_ARTIFACT_CONTENT_VERSION, kind: input.kind, payload }
}

// Server producers use this same bounded encoding when capturing payload pins.
// Hash artifactContentProjection, never a whole operational record. Legacy
// records without a revision counter use this content digest as their revision.
function canonicalJson(value: unknown): string {
  const canonical = (child: unknown): unknown => {
    if (Array.isArray(child)) return child.map(canonical)
    if (child !== null && typeof child === 'object') return Object.fromEntries(Object.entries(child)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
    return child
  }
  return JSON.stringify(canonical(value))
}
async function canonicalDigest(value: unknown, maxBytes: number) {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  if (bytes.length > maxBytes) unavailable()
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function artifactPayloadDigest(payload: unknown) { return canonicalDigest(payload, ARTIFACT_CONTENT_BYTES) }

async function liveFolder(ctx: ReadCtx, userId: string, id: Id<'folders'>) {
  if ((await ctx.db.get(id))?.userId !== userId) unavailable()
}

// Mirrors learnV2Sources.requireLiveVoid, including revocation before cleanup.
async function liveVoid(ctx: ReadCtx, userId: string, id: Id<'learningVoids'>) {
  const row = await ctx.db.get(id)
  if (!row || row.userId !== userId || row.status === 'archived') unavailable()
  await liveFolder(ctx, userId, row.folderId)
  return row
}

async function liveDocument(ctx: ReadCtx, userId: string, id: Id<'documents'>) {
  const row = await ctx.db.get(id)
  // Mirrors learnAdaptive.loadContributionSource; content pins are bound below.
  if (!row || row.userId !== userId || row.status !== 'success') unavailable()
  await liveFolder(ctx, userId, row.folderId)
  return row
}

async function liveCourse(ctx: ReadCtx, userId: string, id: Id<'courses'>) {
  const row = await ctx.db.get(id)
  if (!row || row.userId !== userId || row.status !== 'ready') unavailable()
  await liveFolder(ctx, userId, row.folderId)
  return row
}

async function pinned(row: ArtifactPin, payload: unknown, revision?: string | number) {
  if (typeof revision === 'number' && (!Number.isSafeInteger(revision) || revision < 1)) unavailable()
  const digest = await artifactPayloadDigest(payload)
  if (row.payloadDigest !== digest || row.revision !== (revision === undefined ? `sha256:${digest}` : String(revision))) unavailable()
}

async function boundedRows<T>(rows: Promise<T[]>, maximum: number) {
  const result = await rows
  if (result.length > maximum) unavailable()
  return result
}

// These producer-facing readers use the very same budget as graph inspection.
// They return content only; access/lifecycle admission remains below.
export async function sessionBlockContentProjection(ctx: ReadCtx, block: Doc<'sessionContentBlocks'>, content: Doc<'sessionContent'>) {
  ctx = withReadBudget(ctx)
  const claims = await boundedRows(ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', content.userId).eq('sessionContentId', content._id)).take(33), 32)
  const supports: Doc<'learnClaimSupports'>[] = []
  for (const claim of claims) {
    const rows = await boundedRows(ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', content.userId).eq('sessionContentClaimId', claim._id)).take(9), 8)
    if (!rows.length || rows.some(row => row.evidenceStatus === 'evidence_unavailable')) unavailable()
    supports.push(...rows)
  }
  return artifactContentProjection({ kind: 'session_block', block, content, evidence: { claims, supports } })
}

async function liveAudioScope(ctx: ReadCtx, overview: Doc<'audioOverviews'>) {
  await liveFolder(ctx, overview.userId, overview.folderId)
  if (overview.roomId) {
    const room = await ctx.db.get(overview.roomId)
    if (!room || room.userId !== overview.userId || room.folderId !== overview.folderId) unavailable()
    if (room.conversationId) {
      const conversation = await ctx.db.get(room.conversationId)
      if (!conversation || conversation.userId !== overview.userId || conversation.folderId !== room.folderId || conversation.archivedAt !== undefined) unavailable()
    }
  }
}

async function readAudioMedia(ctx: ReadCtx, overview: Doc<'audioOverviews'>) {
  if (!overview.episodeId && !overview.finalArtifactId) return null
  const episode = overview.episodeId ? await ctx.db.get(overview.episodeId) : null
  const media = overview.finalArtifactId ? await ctx.db.get(overview.finalArtifactId) : null
  if (!episode || !media || episode.userId !== overview.userId || media.userId !== overview.userId
    || episode.status !== 'ready' || episode.folderId !== overview.folderId || episode.roomId !== overview.roomId
    || episode.compatibilityOverviewId !== overview._id || episode.finalArtifactId !== media._id || media.episodeId !== episode._id
    || media.kind !== 'final' || media.status !== 'published' || media.storageProvider !== 'r2' || media.container !== 'wav') unavailable()
  return { episode, media }
}

async function readAudioPlayback(ctx: ReadCtx, overview: Doc<'audioOverviews'>): Promise<AudioPlayback | null> {
  const current = await readAudioMedia(ctx, overview)
  if (!current) return null
  const { episode, media } = current
  const manifest = await ctx.db.get(episode.sourceManifestId)
  const outline = await ctx.db.get(episode.outlineId)
  const ledger = await ctx.db.get(episode.claimLedgerId)
  if (!manifest || !outline || !ledger || [manifest, outline, ledger].some(row => row.userId !== overview.userId)) unavailable()
  // Limits and index orders mirror audioOverviewV2.loadPlaybackProjection.
  const entries = await boundedRows(ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_manifestId_and_order', q => q.eq('manifestId', manifest._id)).take(51), 50)
  const objectives = await boundedRows(ctx.db.query('audioOverviewLearningObjectives').withIndex('by_outlineId_and_order', q => q.eq('outlineId', outline._id)).take(13), 12)
  const outlineSources = await boundedRows(ctx.db.query('audioOverviewOutlineSources').withIndex('by_outlineId_and_order', q => q.eq('outlineId', outline._id)).take(51), 50)
  const claims = await boundedRows(ctx.db.query('audioOverviewClaims').withIndex('by_ledgerId_and_order', q => q.eq('ledgerId', ledger._id)).take(501), 500)
  const claimSources = await boundedRows(ctx.db.query('audioOverviewClaimSources').withIndex('by_ledgerId', q => q.eq('ledgerId', ledger._id)).take(6001), 6000)
  const scenes = await boundedRows(ctx.db.query('audioOverviewScenes').withIndex('by_episodeId_and_order', q => q.eq('episodeId', episode._id)).take(25), 24)
  const utterances = await boundedRows(ctx.db.query('audioOverviewUtterances').withIndex('by_episodeId_and_order', q => q.eq('episodeId', episode._id)).take(401), 400)
  const utteranceSources = await boundedRows(ctx.db.query('audioOverviewUtteranceSources').withIndex('by_episodeId', q => q.eq('episodeId', episode._id)).take(4801), 4800)
  const utteranceClaims = await boundedRows(ctx.db.query('audioOverviewUtteranceClaims').withIndex('by_episodeId', q => q.eq('episodeId', episode._id)).take(8001), 8000)
  const alignment = episode.alignmentId ? await ctx.db.get(episode.alignmentId) : null
  const segments = alignment?.status === 'ready'
    ? await boundedRows(ctx.db.query('audioOverviewAlignmentSegments').withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q.eq('alignmentId', alignment._id)).take(10001), 10000) : []
  if ([...entries, ...objectives, ...outlineSources, ...claims, ...claimSources, ...scenes, ...utterances, ...utteranceSources, ...utteranceClaims, ...segments].some(row => row.userId !== overview.userId)
    || (alignment && (alignment.userId !== overview.userId || alignment.episodeId !== episode._id || alignment.artifactId !== media._id))) unavailable()
  return { episode, media, manifest, entries, outline, objectives, outlineSources, claims, claimSources, scenes, utterances, utteranceSources, utteranceClaims, segments }
}

async function withinAudioProjection<T>(operation: () => Promise<T>) {
  try { return await operation() }
  catch (error) {
    if (error instanceof ReadBudgetExceeded) throw new ArtifactProjectionBudgetError()
    throw error
  }
}

export async function audioOverviewContentProjection(ctx: ReadCtx, overview: Doc<'audioOverviews'>) {
  ctx = withReadBudget(ctx)
  return withinAudioProjection(async () => {
    const projection = artifactContentProjection({ kind: 'audio_overview', overview, playback: await readAudioPlayback(ctx, overview) })
    if (new TextEncoder().encode(canonicalJson(projection)).length > ARTIFACT_CONTENT_BYTES) throw new ArtifactProjectionBudgetError()
    return projection
  })
}

export async function sectionContentProjection(ctx: ReadCtx, section: Doc<'courseSections'>) {
  ctx = withReadBudget(ctx)
  const linked: SectionLinks = []
  for (const block of section.contentBlocks) {
    if (!block.entityId || block.type === 'text') { linked.push(null); continue }
    if (block.type === 'quiz') {
      const id = ctx.db.normalizeId('quizzes', block.entityId)
      if (!id) unavailable()
      const quiz = await ctx.db.get(id)
      if (!quiz || quiz.userId !== section.userId || quiz.status !== 'ready' || quiz.deletedAt !== undefined) unavailable()
      await liveFolder(ctx, section.userId, quiz.folderId)
      if (quiz.courseId) await liveCourse(ctx, section.userId, quiz.courseId)
      // Online Quiz reads expose up to 200 questions (offline caches take 50).
      const questions = await boundedRows(ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', id)).take(201), 200)
      if (questions.some(q => q.userId !== section.userId)) unavailable()
      linked.push({ kind: 'quiz', questions })
    }
    else if (block.type === 'flashcard') {
      const id = ctx.db.normalizeId('flashcardRooms', block.entityId)
      if (!id) unavailable()
      const room = await ctx.db.get(id)
      if (!room || room.userId !== section.userId) unavailable()
      await liveFolder(ctx, section.userId, room.folderId)
      const cards = await boundedRows(ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', id)).take(201), 200)
      if (cards.some(c => c.userId !== section.userId)) unavailable()
      linked.push({ kind: 'flashcard', cards })
    }
    else {
      const id = ctx.db.normalizeId('audioOverviews', block.entityId)
      if (!id) unavailable()
      const overview = await ctx.db.get(id)
      if (!overview || overview.userId !== section.userId || overview.status !== 'ready') unavailable()
      await liveAudioScope(ctx, overview)
      await readAudioMedia(ctx, overview)
      linked.push({ kind: 'audio', content: sectionAudioContent(overview) })
    }
  }
  return artifactContentProjection({ kind: 'section_block', section, linked })
}

async function liveSessionBlock(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'sessionContentBlocks'>) {
  const block = await ctx.db.get(id)
  if (!block || block.userId !== userId) unavailable()
  const content = await ctx.db.get(block.sessionContentId)
  if (!content || content.userId !== userId || content.status !== 'published') unavailable()
  const session = await ctx.db.get(content.studySessionId)
  if (!session || session.userId !== userId || !['ready', 'in_progress', 'completed'].includes(session.status)) unavailable()
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  if (!plan || plan.userId !== userId || plan.status !== 'accepted' || !plan.blueprintRevisionId) unavailable()
  const stable = await ctx.db.get(plan.studyPlanId)
  const learningVoid = await liveVoid(ctx, userId, plan.learningVoidId)
  // Mirrors learnV2SessionContent.getSessionContent and learnAdaptiveCanvas.loadReadyCanvas.
  if (!stable || stable.userId !== userId || stable.learningVoidId !== learningVoid._id || stable.activeRevisionId !== plan._id
    || content.studyPlanRevisionId !== plan._id || content.blueprintRevisionId !== plan.blueprintRevisionId
    || content.objectiveId !== session.primaryObjectiveId
    || (session.status !== 'ready' && (session.startedSessionContentId !== content._id || session.startedSessionContentRevision !== content.revision))) unavailable()
  try {
    const blueprint = await requireActiveBlueprint(ctx, userId, learningVoid, plan.blueprintRevisionId)
    if (blueprint.recordRevision !== plan.blueprintRecordRevision) unavailable()
  }
  catch { unavailable() }
  await pinned(row, await sessionBlockContentProjection(ctx, block, content), content.revision)
}

async function liveDocumentArtifact(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'documents'>) {
  const document = await liveDocument(ctx, userId, id)
  if (!document.sourceRevision?.trim() || !document.contentHash?.trim()) unavailable()
  await pinned(row, artifactContentProjection({ kind: row.artifact.kind === 'document_chunk' ? 'document_chunk' : 'document', document }), document.sourceRevision)
}

async function liveDocumentChunk(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'documents'>) {
  // Chunks have no independent table: any backing revision/object change
  // revokes every component, without trusting a retrieved snippet as a pin.
  // One chunk-set row covers them all, so chunk count never sizes a batch.
  if (row.key !== LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY) unavailable()
  await liveDocumentArtifact(ctx, userId, row, id)
}

async function liveQuizQuestion(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'quizQuestions'>) {
  const question = await ctx.db.get(id)
  if (!question || question.userId !== userId) unavailable()
  const quiz = await ctx.db.get(question.quizId)
  // Mirrors learnAdaptive.loadContributionSource, including course deletion.
  if (!quiz || quiz.userId !== userId || quiz.status !== 'ready' || quiz.deletedAt !== undefined) unavailable()
  await liveFolder(ctx, userId, quiz.folderId)
  if (quiz.courseId) await liveCourse(ctx, userId, quiz.courseId)
  await pinned(row, artifactContentProjection({ kind: 'quiz_question', question }))
}

async function liveSectionBlock(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'courseSections'>) {
  const section = await ctx.db.get(id)
  if (!section || section.userId !== userId || !['ready', 'completed'].includes(section.status)) unavailable()
  // Mirrors courseSections.get and courses.get: a deleting aggregate is unavailable.
  await liveCourse(ctx, userId, section.courseId)
  await pinned(row, await sectionContentProjection(ctx, section))
}

async function liveFlashcardVersion(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'flashcardRoomVersions'>) {
  const version = await ctx.db.get(id)
  if (!version || version.userId !== userId) unavailable()
  const room = await ctx.db.get(version.roomId)
  // Mirrors learnAdaptive.loadContributionSource. Historical versions stay
  // live; restoring one never replaces its original lineage or case identity.
  if (!room || room.userId !== userId) unavailable()
  await liveFolder(ctx, userId, room.folderId)
  const cards = await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', version._id)).take(201)
  if (cards.length > 200 || cards.some(card => card.userId !== userId || card.roomId !== room._id)) unavailable()
  await pinned(row, artifactContentProjection({ kind: 'flashcard_version', version, cards }), version._id)
}

async function liveAudioOverview(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'audioOverviews'>) {
  return withinAudioProjection(async () => {
    const overview = await ctx.db.get(id)
    // Mirrors learnAdaptive.loadContributionSource.
    if (!overview || overview.userId !== userId || overview.status !== 'ready') unavailable()
    await liveAudioScope(ctx, overview)
    await pinned(row, await audioOverviewContentProjection(ctx, overview))
  })
}

async function liveLearnerArtifact(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'learningThreadArtifacts'>) {
  const artifact = await ctx.db.get(id)
  if (!artifact || artifact.userId !== userId || !['draft', 'saved'].includes(artifact.status)) unavailable()
  const thread = await ctx.db.get(artifact.threadId)
  if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || thread.lifecycle === 'rollback') unavailable()
  if (thread.learningVoidId) await liveVoid(ctx, userId, thread.learningVoidId)
  if (['unavailable', 'invalidated', 'stale'].includes(await liveEvidenceState(ctx, thread))) unavailable()
  const activity = await ctx.db.get(artifact.activityId)
  if (!activity || activity.userId !== userId || activity.threadId !== thread._id) unavailable()
  // Mirrors learnAdaptive.artifactEvidenceUnavailable and listThreadArtifacts.
  if (activity.activityClass === 'factual') {
    if (activity.status === 'blocked' || await liveEvidenceState(ctx, thread) !== 'ready') unavailable()
    const invalidated = await ctx.db.query('learnActivityEvidenceLinks')
      .withIndex('by_userId_and_activityId_and_invalidatedAt', q => q.eq('userId', userId).eq('activityId', activity._id).gt('invalidatedAt', undefined)).first()
    if (invalidated) unavailable()
  }
  await pinned(row, artifactContentProjection({ kind: 'learner_artifact', artifact }), artifact.revision)
}

async function liveMeasurementInventory(ctx: ReadCtx, userId: string, item: Doc<'learnMeasurementItems'> | null) {
  if (!item || item.userId !== userId || item.status !== 'published' || !available(item) || item.prompt === undefined) unavailable()
  const learningVoid = await liveVoid(ctx, userId, item.learningVoidId)
  try {
    const blueprint = await requireActiveBlueprint(ctx, userId, learningVoid, item.blueprintRevisionId)
    if (blueprint.recordRevision !== item.blueprintRecordRevision) unavailable()
  }
  catch { unavailable() }
  const objective = await ctx.db.get(item.objectiveId)
  if (!objective || objective.userId !== userId || objective.blueprintRevisionId !== item.blueprintRevisionId) unavailable()
  const family = await ctx.db.get(item.familyId)
  // Mirrors learnV2MeasurementStorage.measurementItemValidator's published branch.
  if (!family || family.userId !== userId || !available(family) || !['provisional_equivalent', 'empirically_supported'].includes(family.status)
    || family.revision !== item.familyRevision || family.learningVoidId !== item.learningVoidId
    || family.blueprintRevisionId !== item.blueprintRevisionId || family.blueprintRecordRevision !== item.blueprintRecordRevision
    || family.objectiveId !== item.objectiveId) unavailable()
  const spec = item.scoringSpecId ? await ctx.db.get(item.scoringSpecId) : null
  if (!spec || spec.userId !== userId || !available(spec) || spec.itemId !== item._id || spec.learningVoidId !== item.learningVoidId
    || spec.blueprintRevisionId !== item.blueprintRevisionId || spec.blueprintRecordRevision !== item.blueprintRecordRevision
    || spec.objectiveId !== item.objectiveId || spec.revision !== item.scoringSpecRevision || spec.digest !== item.scoringSpecDigest
    || spec.payload === undefined || spec.referenceSolution === undefined) unavailable()
  return { item, family, spec }
}

async function liveMeasurementItem(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'learnMeasurementItems'>) {
  const { item, family, spec } = await liveMeasurementInventory(ctx, userId, await ctx.db.get(id))
  await pinned(row, artifactContentProjection({ kind: 'measurement_item', item, family, spec }), item.revision)
}

async function liveScoringSpec(ctx: ReadCtx, userId: string, row: ArtifactPin, id: Id<'learnMeasurementScoringSpecs'>) {
  const spec = await ctx.db.get(id)
  if (!spec || spec.userId !== userId || !available(spec) || spec.payload === undefined || spec.referenceSolution === undefined) unavailable()
  const { item, family } = await liveMeasurementInventory(ctx, userId, await ctx.db.get(spec.itemId))
  if (item.scoringSpecId !== spec._id) unavailable()
  await pinned(row, artifactContentProjection({ kind: 'scoring_spec', item, family, spec }), spec.revision)
}

async function requireLiveArtifact(ctx: ReadCtx, userId: string, row: ArtifactPin) {
  const artifact = row.artifact
  switch (artifact.kind) {
    case 'session_block': return liveSessionBlock(ctx, userId, row, artifact.id)
    case 'document': return liveDocumentArtifact(ctx, userId, row, artifact.id)
    case 'document_chunk': return liveDocumentChunk(ctx, userId, row, artifact.id)
    case 'quiz_question': return liveQuizQuestion(ctx, userId, row, artifact.id)
    case 'section_block': return liveSectionBlock(ctx, userId, row, artifact.id)
    case 'flashcard_version': return liveFlashcardVersion(ctx, userId, row, artifact.id)
    case 'audio_overview': return liveAudioOverview(ctx, userId, row, artifact.id)
    case 'learner_artifact': return liveLearnerArtifact(ctx, userId, row, artifact.id)
    case 'measurement_item': await liveMeasurementItem(ctx, userId, row, artifact.id); return
    case 'scoring_spec': return liveScoringSpec(ctx, userId, row, artifact.id)
    default: unavailable()
  }
}

async function readCatalog(ctx: ReadCtx, userId: string) {
  const rows = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  if (rows.length !== 1 || !learnSequenceSchema.safeParse(rows[0]!.catalogRevision).success) unavailable()
  return rows[0]!
}

async function findLineage(ctx: ReadCtx, userId: string, reference: LearnArtifactReference) {
  const rows = await ctx.db.query('learnArtifactLineages')
    .withIndex('by_artifact_kind_and_artifact_id_and_key_and_revision_and_nextId', q => q.eq('artifact.kind', reference.artifact.kind).eq('artifact.id', reference.artifact.id).eq('key', reference.key).eq('revision', reference.revision).eq('nextId', undefined)).take(2)
  if (rows.length !== 1 || rows[0]!.userId !== userId || rows[0]!.payloadDigest !== reference.payloadDigest) unavailable()
  return rows[0]!
}

async function sourceAvailable(ctx: ReadCtx, userId: string, source: Dependency) {
  if (source.kind === 'document') {
    // inspectGraph has already verified this document's hash and object key
    // through its sealed manifest commitment, using the same read budget.
    const document = await liveDocument(ctx, userId, source.documentId)
    return document.sourceRevision === source.sourceRevision
  }
  if (source.kind === 'folder') return (await ctx.db.get(source.folderId))?.userId === userId
  const snapshot = await ctx.db.get(source.sourceSnapshotId)
  if (!snapshot || snapshot.userId !== userId || snapshot.status !== 'user_accepted' || (snapshot.effectiveStatus ?? snapshot.status) !== 'user_accepted'
    || snapshot.evidencePurgedAt !== undefined || snapshot.rightsStatus !== 'permitted' || snapshot.conflictStatus !== 'clear'
    || snapshot.revision !== source.revision || (snapshot.recordRevision ?? 1) !== source.recordRevision || snapshot.contentHash !== source.contentHash) return false
  await liveVoid(ctx, userId, snapshot.learningVoidId)
  const identity = await ctx.db.get(snapshot.sourceIdentityId)
  if (!identity || identity.userId !== userId || identity.learningVoidId !== snapshot.learningVoidId || identity.tombstonedAt !== undefined) return false
  if (identity.folderDocumentId) {
    const document = await liveDocument(ctx, userId, identity.folderDocumentId)
    // Mirrors learnV2Sources.prepareFetchedSourceForReview and learnAdaptive.loadContributionSource. Compare
    // every current pin, even when the document is still marked successful.
    if ((!document.sourceRevision && !document.contentHash)
      || document.sourceRevision?.trim() !== snapshot.sourceRevision
      || document.contentHash?.trim().toLowerCase() !== snapshot.contentHash
      || document.r2Key?.trim() !== snapshot.objectKey) return false
  }
  else if (identity.origin === 'folder_document') return false
  if (source.kind === 'snapshot') return true
  const excerpt = await ctx.db.get(source.sourceExcerptId)
  return excerpt?.userId === userId && excerpt.sourceSnapshotId === snapshot._id && excerpt.rightsStatus === 'permitted'
    && excerpt.evidencePurgedAt === undefined && excerpt.excerpt !== undefined
}

function validationProjection(row: Doc<'learnArtifactValidations'>) {
  return { lineageId: row.lineageId, payloadDigest: row.payloadDigest, manifestDigest: row.manifestDigest, decision: row.decision,
    comparedCatalogRevision: row.comparedCatalogRevision, coverage: row.coverage, coverageWatermark: row.coverageWatermark,
    corpusDigest: row.corpusDigest, identityPolicyVersion: row.identityPolicyVersion, noveltyPolicyVersion: row.noveltyPolicyVersion,
    validatorVersion: row.validatorVersion, validatorModel: row.validatorModel, harnessArtifactDigest: row.harnessArtifactDigest,
    ...(row.preparation ? { preparation: row.preparation } : {}) }
}

export async function artifactManifestDigest(
  ctx: ReadCtx, row: Lineage, origins: Doc<'learnArtifactLineageOrigins'>[], cases: Doc<'learnArtifactCaseBindings'>[], sources: Doc<'learnArtifactSourceLinks'>[],
) {
  ctx = withReadBudget(ctx)
  if (origins.length > limits.maxOrigins || cases.length > limits.maxCases || sources.length > limits.maxSources) unavailable()
  const sourcePins = []
  for (const link of sources) {
    const source = link.dependency
    if (source?.kind !== 'document') { sourcePins.push(source ?? null); continue }
    // The existing sealed manifest stores the commitment, so no new schema
    // fields are necessary. Every direct document link captures all three
    // identity pins at seal time and recomputes them at both admission seams.
    const document = await liveDocument(ctx, row.userId, source.documentId)
    if (document.sourceRevision !== source.sourceRevision || !document.contentHash?.trim()) unavailable()
    sourcePins.push({ ...source, contentHash: document.contentHash, objectKey: document.r2Key ?? null })
  }
  const sorted = (values: unknown[]) => values.map(canonicalJson).sort()
  const manifest = { version: row.lineageVersion, userId: row.userId, artifact: row.artifact, key: row.key, revision: row.revision,
    payloadDigest: row.payloadDigest, classification: row.classification, authority: row.authority, authorityVersion: row.authorityVersion, derivation: row.derivation,
    origins: sorted(origins.map(origin => ({ lineageId: origin.originLineageId, revision: origin.originRevision, payloadDigest: origin.originPayloadDigest,
      manifestDigest: origin.originManifestDigest, classification: origin.classification, transformation: origin.transformation }))),
    cases: sorted(cases.map(binding => ({ caseId: binding.caseId, scenarioFingerprint: binding.scenarioFingerprint,
      solutionFingerprint: binding.solutionFingerprint, identityPolicyVersion: binding.identityPolicyVersion }))),
    sources: sorted(sourcePins) }
  learnSerializedBytes(manifest, limits.maxLookupBytes)
  return canonicalDigest(manifest, limits.maxLookupBytes)
}

async function inspectGraph(ctx: ReadCtx, userId: string, root: Lineage, catalogRevision: number, requirePublication: boolean) {
  const nodes = new Map<Id<'learnArtifactLineages'>, Lineage>()
  const heights = new Map<Id<'learnArtifactLineages'>, number>()
  const active = new Set<Id<'learnArtifactLineages'>>()
  const cases = new Map<Id<'learnAssessmentCases'>, Doc<'learnArtifactCaseBindings'>>()
  const usage = new Map<Id<'learnAssessmentCases'>, Doc<'learnAssessmentCases'>['usageClass']>()
  const proofs = new Map<Id<'learnAssessmentCases'>, Id<'learnArtifactValidations'> | undefined>()
  const dependencies: Dependency[] = []
  let sourceCount = 0
  let caseCount = 0
  const validations = new Map<Id<'learnArtifactLineages'>, ReturnType<typeof validationProjection> & { validationId: Id<'learnArtifactValidations'> }>()
  const visit = async (row: Lineage, depth: number): Promise<number> => {
    if (depth > limits.maxDepth || active.has(row._id)) unavailable()
    const cachedHeight = heights.get(row._id)
    if (cachedHeight !== undefined) {
      if (depth + cachedHeight > limits.maxDepth) unavailable()
      return cachedHeight
    }
    if (nodes.size >= limits.maxNodes || row.userId !== userId || !available(row) || row.nextId !== undefined
      || row.lineageVersion !== LEARN_ARTIFACT_LINEAGE_VERSION || row.classification === 'unknown'
      || row.classification !== root.classification || !learnVersionSchema.safeParse(row.authorityVersion).success) unavailable()
    if ((row.classification === 'genuine_personal_work' && row.authority !== (row.derivation === 'original' ? 'personal_authorship' : 'server_producer'))
      || (row.classification === 'legacy_history' && row.authority !== (row.derivation === 'original' ? 'legacy_record' : 'server_producer'))
      || (row.classification !== 'genuine_personal_work' && row.classification !== 'legacy_history' && row.authority !== 'server_producer')) unavailable()
    if ((row.artifact.kind === 'measurement_item' && row.classification !== 'measurement')
      || (row.artifact.kind === 'scoring_spec' && row.classification !== 'private_scoring')) unavailable()
    if (!learnArtifactReferenceSchema.safeParse({ artifact: row.artifact, key: row.key, revision: row.revision, payloadDigest: row.payloadDigest }).success) unavailable()
    await requireLiveArtifact(ctx, userId, row)
    if (!row.validationId) unavailable()
    const validation = await ctx.db.get(row.validationId)
    if (!validation || validation.userId !== userId || !available(validation)) unavailable()
    const parsed = learnArtifactValidationSchema.safeParse(validationProjection(validation))
    if (!parsed.success || parsed.data.lineageId !== row._id || parsed.data.payloadDigest !== row.payloadDigest || parsed.data.manifestDigest !== row.manifestDigest
      || parsed.data.decision !== 'pass' || parsed.data.coverage !== 'complete' || parsed.data.comparedCatalogRevision > catalogRevision) unavailable()
    validations.set(row._id, { ...parsed.data, validationId: validation._id })
    const origins = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxOrigins + 1)
    const bindings = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxCases + 1)
    const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxSources + 1)
    sourceCount += sources.length
    caseCount += bindings.length
    if (origins.length > limits.maxOrigins || caseCount > limits.maxCases || sourceCount > limits.maxSources
      || row.originCount !== origins.length || row.caseCount !== bindings.length || row.sourceCount !== sources.length
      || (row.derivation === 'original' ? origins.length !== 0 : origins.length === 0)
      || new Set(origins.map(origin => origin.originLineageId)).size !== origins.length
      || new Set(bindings.map(binding => binding.caseId)).size !== bindings.length) unavailable()
    try {
      if (await artifactManifestDigest(ctx, row, origins, bindings, sources) !== row.manifestDigest) unavailable()
    }
    catch { unavailable() }
    nodes.set(row._id, row)
    active.add(row._id)
    for (const link of sources) {
      const dependency = learnArtifactSourceDependencySchema.safeParse(link.dependency)
      if (!available(link) || !dependency.success || !(await sourceAvailable(ctx, userId, dependency.data))) unavailable()
      dependencies.push(dependency.data)
    }
    for (const binding of bindings) {
      const pin = learnArtifactCaseSchema.safeParse({ caseId: binding.caseId, scenarioFingerprint: binding.scenarioFingerprint,
        solutionFingerprint: binding.solutionFingerprint, identityPolicyVersion: binding.identityPolicyVersion })
      const candidate = await ctx.db.get(binding.caseId)
      if (!pin.success || !candidate || candidate.userId !== userId || candidate.scenarioFingerprint !== binding.scenarioFingerprint
        || candidate.solutionFingerprint !== binding.solutionFingerprint || candidate.identityPolicyVersion !== binding.identityPolicyVersion
        || binding.identityPolicyVersion !== parsed.data.identityPolicyVersion) unavailable()
      const scenarios = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint', q => q.eq('userId', userId).eq('scenarioFingerprint', binding.scenarioFingerprint)).take(2)
      const solutions = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_solutionFingerprint', q => q.eq('userId', userId).eq('solutionFingerprint', binding.solutionFingerprint)).take(2)
      if (scenarios.length !== 1 || solutions.length !== 1) unavailable()
      if (!cases.has(binding.caseId)) cases.set(binding.caseId, binding)
      usage.set(binding.caseId, candidate.reservedAt === undefined ? candidate.usageClass : 'measurement_reserved')
      proofs.set(binding.caseId, candidate.artifactIdentityValidationId)
    }
    let height = 0
    for (const origin of origins) {
      const parent = await ctx.db.get(origin.originLineageId)
      if (!parent || parent.userId !== userId || parent.revision !== origin.originRevision || parent.payloadDigest !== origin.originPayloadDigest || parent.manifestDigest !== origin.originManifestDigest
        || parent.classification !== origin.classification) unavailable()
      height = Math.max(height, 1 + await visit(parent, depth + 1))
    }
    active.delete(row._id)
    heights.set(row._id, height)
    return height
  }
  await visit(root, 0)
  const rootValidation = validations.get(root._id)
  if (!rootValidation) unavailable()
  const publication = root.publication
  if (publication && (publication.validationId !== root.validationId || !Number.isSafeInteger(publication.catalogRevision)
    || publication.catalogRevision !== rootValidation.comparedCatalogRevision + 1 || publication.catalogRevision > catalogRevision)) unavailable()
  if (requirePublication && (root.classification === 'teaching') && !publication) unavailable()
  if (publication && [...usage.values()].some(value => value !== 'instructional')) unavailable()
  return { nodes, cases, usage, proofs, dependencies, validation: rootValidation }
}

// Only server-owned record references cross an identity-less seam. Public
// capability handlers must validate the capability before calling this helper.
async function requireRecordOwner(ctx: ReadCtx, input: LearnArtifactOwnerRecord) {
  const record = parseLearnContract(learnArtifactOwnerRecordSchema, input)
  if (record.kind === 'document') {
    const document = await ctx.db.get(record.id)
    if (!document || !['success', 'indexing'].includes(document.status)) unavailable()
    await rejectAccountDeletion(ctx, document.userId)
    await liveFolder(ctx, document.userId, document.folderId)
    return document.userId
  }
  const job = await ctx.db.get(record.id)
  if (!job || ['failed', 'cancelled'].includes(job.status)) unavailable()
  await rejectAccountDeletion(ctx, job.userId)
  await liveFolder(ctx, job.userId, job.folderId)
  const task = await ctx.db.get(job.taskId)
  if (!task || task.userId !== job.userId || task.folderId !== job.folderId || task.type !== 'audio-overview-generation'
    || !task.audioOverviewRequest || ['failed', 'cancelled'].includes(task.status)) unavailable()
  if (job.roomId) {
    const room = await ctx.db.get(job.roomId)
    if (!room || room.userId !== job.userId || room.folderId !== job.folderId) unavailable()
    if (room.conversationId) {
      const conversation = await ctx.db.get(room.conversationId)
      if (!conversation || conversation.userId !== job.userId || conversation.folderId !== job.folderId || conversation.archivedAt !== undefined) unavailable()
    }
  }
  return job.userId
}

async function resolveForOwner(ctx: ReadCtx, userId: string, input: unknown, capture?: (graph: Awaited<ReturnType<typeof inspectGraph>>) => void): Promise<LearnArtifactLookupResult> {
  const { reference } = validateLearnArtifactLookup(input)
  const catalog = await readCatalog(ctx, userId)
  const root = await findLineage(ctx, userId, reference)
  const graph = await inspectGraph(ctx, userId, root, catalog.catalogRevision, true)
  capture?.(graph)
  return validateLearnArtifactLookupResult({ status: 'bound', version: LEARN_ARTIFACT_LINEAGE_VERSION,
    lineageId: root._id, reference, classification: root.classification, instructionalRegistered: root.publication !== undefined,
    catalogRevision: catalog.catalogRevision, originLineageIds: [...graph.nodes.keys()].filter(id => id !== root._id),
    cases: [...graph.cases.values()].map(binding => ({ caseId: binding.caseId, scenarioFingerprint: binding.scenarioFingerprint,
      solutionFingerprint: binding.solutionFingerprint, identityPolicyVersion: binding.identityPolicyVersion, usageClass: graph.usage.get(binding.caseId)! })),
    validation: graph.validation })
}

async function lookup(operation: () => Promise<LearnArtifactLookupResult>): Promise<LearnArtifactLookupResult> {
  try { return await operation() }
  catch (error) {
    if (!(error instanceof Unavailable) && !(error instanceof ArtifactProjectionBudgetError)) throw error
    return { status: 'unavailable', version: LEARN_ARTIFACT_LINEAGE_VERSION }
  }
}

export async function resolveArtifactLineageForOwner(ctx: ReadCtx, userId: string, input: unknown): Promise<LearnArtifactLookupResult> {
  ctx = withReadBudget(ctx)
  return lookup(async () => {
    if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
    return resolveForOwner(ctx, userId, input)
  })
}

export async function resolveArtifactLineageForRecord(ctx: ReadCtx, record: LearnArtifactOwnerRecord, input: unknown): Promise<LearnArtifactLookupResult> {
  ctx = withReadBudget(ctx)
  return lookup(async () => resolveForOwner(ctx, await requireRecordOwner(ctx, record), input))
}

async function advanceCatalog(ctx: MutationCtx, userId: string, expectedRevision: number) {
  const catalog = await readCatalog(ctx, userId)
  if (!learnSequenceSchema.safeParse(expectedRevision).success || catalog.catalogRevision !== expectedRevision
    || !Number.isSafeInteger(expectedRevision + 1)) unavailable()
  await ctx.db.patch(catalog._id, { catalogRevision: expectedRevision + 1 })
  return expectedRevision + 1
}

export async function advanceAssessmentCatalogForOwner(ctx: MutationCtx, userId: string, expectedRevision: number) {
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  return advanceCatalog(ctx, userId, expectedRevision)
}

async function registerBatch(ctx: MutationCtx, userId: string, input: unknown) {
  const budget = createArtifactLineageReadContext(ctx)
  ctx = budget.ctx
  const args = parseLearnContract(learnArtifactBatchRegistrationArgsSchema, input)
  const catalog = await readCatalog(ctx, userId)
  if (catalog.catalogRevision !== args.expectedCatalogRevision || catalog.historyCompleteness !== 'prospective_complete') unavailable()
  const pending = []
  const ids = new Set<Id<'learnArtifactLineages'>>()
  for (const artifact of args.artifacts) {
    const root = await findLineage(ctx, userId, artifact.reference)
    if (ids.has(root._id) || (root.classification !== 'teaching' && root.classification !== 'genuine_personal_work')
      || root.publication || root.validationId !== artifact.validationId) unavailable()
    ids.add(root._id)
    const graph = await inspectGraph(ctx, userId, root, catalog.catalogRevision, false)
    if (graph.validation.comparedCatalogRevision !== catalog.catalogRevision
      || graph.validation.coverageWatermark !== catalog.historyCoverageWatermark
      || [...graph.usage.values()].some(value => value === 'measurement_reserved')) unavailable()
    pending.push({ root, graph, validationId: artifact.validationId })
  }
  // Nothing is written until every member passes against the same catalogue.
  // No reads follow this guard advance: even a budget denial leaves no receipts.
  const catalogRevision = await advanceCatalog(ctx, userId, args.expectedCatalogRevision)
  const publishedAt = Date.now()
  // A recorded proof is never rewritten. Otherwise the member that binds the
  // case itself, then the first member in batch order, supplies its decision.
  const proofs = new Map<Id<'learnAssessmentCases'>, Id<'learnArtifactValidations'>>()
  for (const direct of [true, false]) {
    for (const { root, graph, validationId } of pending) {
      for (const [caseId, binding] of graph.cases) {
        if (!proofs.has(caseId) && (!direct || binding.lineageId === root._id)) proofs.set(caseId, graph.proofs.get(caseId) ?? validationId)
      }
    }
  }
  for (const [caseId, artifactIdentityValidationId] of proofs) await ctx.db.patch(caseId, { usageClass: 'instructional', artifactIdentityValidationId })
  for (const { root, validationId } of pending) await ctx.db.patch(root._id, { publication: { validationId, catalogRevision, publishedAt } })
  return parseLearnContract(learnArtifactBatchRegistrationResultSchema, {
    version: LEARN_ARTIFACT_LINEAGE_VERSION, lineageIds: [...ids], catalogRevision, readUsage: budget.readUsage,
  })
}

export async function registerInstructionalArtifactsForOwner(ctx: MutationCtx, userId: string, input: unknown) {
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  return registerBatch(ctx, userId, input)
}
export async function registerInstructionalArtifactsForRecord(ctx: MutationCtx, record: LearnArtifactOwnerRecord, input: unknown) {
  ctx = withReadBudget(ctx)
  return registerBatch(ctx, await requireRecordOwner(ctx, record), input)
}

async function registerOne(ctx: MutationCtx, userId: string, input: unknown) {
  const { reference, validationId, expectedCatalogRevision } = parseLearnContract(learnArtifactRegistrationArgsSchema, input)
  const result = await registerBatch(ctx, userId, { artifacts: [{ reference, validationId }], expectedCatalogRevision })
  return parseLearnContract(learnArtifactRegistrationResultSchema, { version: result.version, lineageId: result.lineageIds[0], catalogRevision: result.catalogRevision })
}

// Dormant transaction seams; callers write their artifacts in this mutation.
export async function registerInstructionalArtifactForOwner(ctx: MutationCtx, userId: string, input: unknown) {
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  return registerOne(ctx, userId, input)
}
export async function registerInstructionalArtifactForRecord(ctx: MutationCtx, record: LearnArtifactOwnerRecord, input: unknown) {
  ctx = withReadBudget(ctx)
  return registerOne(ctx, await requireRecordOwner(ctx, record), input)
}

async function registrationRequired(ctx: ReadCtx, userId: string) {
  const catalogs = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  if (catalogs.length > 1) unavailable()
  return catalogs[0]?.measurementCapability?.enabled === true
}

export async function isArtifactRegistrationRequiredForOwner(ctx: ReadCtx, userId: string) {
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  return registrationRequired(ctx, userId)
}
export async function isArtifactRegistrationRequiredForRecord(ctx: ReadCtx, record: LearnArtifactOwnerRecord) {
  ctx = withReadBudget(ctx)
  return registrationRequired(ctx, await requireRecordOwner(ctx, record))
}
export async function isArtifactRegistrationRequired(ctx: ReadCtx) {
  ctx = withReadBudget(ctx)
  return registrationRequired(ctx, await requireAuth(ctx))
}

class RestrictedLineage extends Unavailable {}
function restrictedLineage(): never { throw new RestrictedLineage('Artifact lineage unavailable') }
type InputBinding = Extract<LearnArtifactLookupResult, { status: 'bound' }> & { dependencies: Dependency[], origins: LearnArtifactReference[] }

async function inspectInputRepresentations(ctx: ReadCtx, userId: string, artifact: LearnArtifactReference['artifact']) {
  const kinds = artifact.kind === 'document' || artifact.kind === 'document_chunk' ? ['document', 'document_chunk'] as const : [artifact.kind]
  const bindings: InputBinding[] = []
  let rowCount = 0
  for (const kind of kinds) {
    const rows = await ctx.db.query('learnArtifactLineages')
      .withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', kind).eq('artifact.id', artifact.id).eq('nextId', undefined)).take(limits.maxNodes + 1)
    rowCount += rows.length
    if (rowCount > limits.maxNodes) unavailable()
    for (const row of rows) {
      if (row.userId !== userId) unavailable()
      if (!['teaching', 'genuine_personal_work'].includes(row.classification)) restrictedLineage()
      const reference = learnArtifactReferenceSchema.safeParse({ artifact: row.artifact, key: row.key, revision: row.revision, payloadDigest: row.payloadDigest })
      if (!reference.success) unavailable()
      const dependencies: Dependency[] = []
      const origins: LearnArtifactReference[] = []
      const resolved = await resolveForOwner(ctx, userId, { reference: reference.data }, graph => {
        dependencies.push(...graph.dependencies)
        for (const node of graph.nodes.values()) origins.push({ artifact: node.artifact, key: node.key, revision: node.revision, payloadDigest: node.payloadDigest })
      })
      if (resolved.status !== 'bound') unavailable()
      if (resolved.cases.some(pin => pin.usageClass === 'measurement_reserved')) restrictedLineage()
      bindings.push({ ...resolved, dependencies, origins })
    }
  }
  return bindings
}

type InputAdmissionGraph = { active: Set<string>, admitted: Map<string, LearnArtifactInputAdmissionResult> }
async function admitInput(ctx: ReadCtx, userId: string, input: unknown, graph: InputAdmissionGraph = { active: new Set(), admitted: new Map() }): Promise<LearnArtifactInputAdmissionResult> {
  const { reference } = validateLearnArtifactLookup(input)
  const identity = canonicalJson(reference)
  const cached = graph.admitted.get(identity)
  if (cached) return cached
  if (graph.active.has(identity) || graph.active.size > limits.maxDepth) unavailable()
  graph.active.add(identity)
  try {
    const result = await admitInputGraph(ctx, userId, reference, graph)
    graph.admitted.set(identity, result)
    return result
  }
  catch (error) {
    if (error instanceof ReadBudgetExceeded && reference.artifact.kind === 'audio_overview') throw new ArtifactProjectionBudgetError()
    throw error
  }
  finally { graph.active.delete(identity) }
}

async function admitInputGraph(ctx: ReadCtx, userId: string, reference: LearnArtifactReference, graph: InputAdmissionGraph): Promise<LearnArtifactInputAdmissionResult> {
  const version = LEARN_ARTIFACT_INPUT_ADMISSION_VERSION
  if (reference.artifact.kind === 'measurement_item' || reference.artifact.kind === 'scoring_spec') restrictedLineage()
  if (reference.artifact.kind === 'session_block') {
    const block = await ctx.db.get(reference.artifact.id)
    const content = block ? await ctx.db.get(block.sessionContentId) : null
    if (!block || block.userId !== userId || !content || content.userId !== userId) unavailable()
    await requireInstructionalSession(ctx, userId, content)
  }
  const enrolled = await registrationRequired(ctx, userId)
  const bindings = await inspectInputRepresentations(ctx, userId, reference.artifact)
  let result: LearnArtifactInputAdmissionResult
  if (!bindings.length) {
    if (enrolled) return { version, status: 'rejected', reasonCode: 'registration_required' }
    await requireLiveArtifact(ctx, userId, reference)
    result = { version, status: 'admitted_unregistered', reasonCode: 'unregistered_ordinary_input' }
  }
  else {
    const resolved = bindings.find(binding => canonicalJson(binding.reference) === canonicalJson(reference))
    if (!resolved) unavailable()
    if (!resolved.instructionalRegistered) return { version, status: 'rejected', reasonCode: 'registration_required' }
    result = { version, status: 'admitted_registered', reasonCode: 'registered_lineage' }
  }
  const nestedInputs = await inputReferences(ctx, userId, reference, bindings)
  if (nestedInputs.ordinaryComponent) {
    if (enrolled) return { version, status: 'rejected', reasonCode: 'registration_required' }
    result = { version, status: 'admitted_unregistered', reasonCode: 'unregistered_ordinary_input' }
  }
  for (const nested of nestedInputs.references) {
    const admission = await admitInput(ctx, userId, { reference: nested }, graph)
    if (admission.status === 'rejected') return admission
    if (admission.status === 'admitted_unregistered') result = admission
  }
  return result
}

async function requireInstructionalSession(ctx: ReadCtx, userId: string, content: Doc<'sessionContent'>) {
  if (content.assessmentPurpose !== undefined || content.assessmentOpportunityId !== undefined) restrictedLineage()
  const session = await ctx.db.get(content.studySessionId)
  if (!session || session.userId !== userId) unavailable()
  if (session.assessmentPurpose !== undefined || session.assessmentOpportunityId !== undefined) restrictedLineage()
}

async function inputContent(ctx: ReadCtx, userId: string, artifact: LearnArtifactReference['artifact']) {
  if (artifact.kind === 'measurement_item' || artifact.kind === 'scoring_spec') restrictedLineage()
  if (artifact.kind === 'learner_artifact') {
    const row = await ctx.db.get(artifact.id)
    if (!row || row.userId !== userId) unavailable()
    return { projection: artifactContentProjection({ kind: artifact.kind, artifact: row }), revision: String(row.revision) }
  }
  return preparationContent(ctx, userId, artifact)
}

async function inputReferences(ctx: ReadCtx, userId: string, root: LearnArtifactReference, bindings: InputBinding[]) {
  const documents = new Set<Id<'documents'>>()
  const snapshots = new Set<Id<'learnSourceSnapshots'>>()
  const components = new Map<string, LearnArtifactReference['artifact']>()
  const references = new Map<string, LearnArtifactReference>()
  const documentPins: Array<{ id: Id<'documents'>, revision: string, contentHash: string }> = []
  const roomCards = new Map<string, unknown[]>()
  let ordinaryComponent = false
  const sameArtifact = (artifact: LearnArtifactReference['artifact']) => artifact.id === root.artifact.id
    && (artifact.kind === root.artifact.kind || (['document', 'document_chunk'].includes(artifact.kind) && ['document', 'document_chunk'].includes(root.artifact.kind)))
  const addComponent = (artifact: LearnArtifactReference['artifact']) => {
    if (!sameArtifact(artifact)) components.set(canonicalJson(artifact), artifact)
  }
  const documentId = (value: string) => {
    const id = ctx.db.normalizeId('documents', value)
    if (!id) unavailable()
    documents.add(id)
  }
  const rooms = new Set<Id<'flashcardRooms'>>()
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      if (['documentId', 'sourceDocumentId', 'sourceDocumentIds', 'scopeDocIds'].includes(key)) documentId(value)
      if (key === 'sourceSnapshotId') {
        const id = ctx.db.normalizeId('learnSourceSnapshots', value)
        if (!id) unavailable()
        snapshots.add(id)
      }
      return
    }
    if (Array.isArray(value)) { for (const child of value) visit(child, key); return }
    if (value === null || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (typeof row.documentId === 'string' && typeof row.revision === 'string' && typeof row.contentHash === 'string') {
      const id = ctx.db.normalizeId('documents', row.documentId)
      if (!id) unavailable()
      documentPins.push({ id, revision: row.revision, contentHash: row.contentHash })
    }
    if (row.kind === 'flashcard' && Array.isArray(row.cards)) {
      for (const card of row.cards) {
        if (!card || typeof card !== 'object' || typeof card.roomId !== 'string') unavailable()
        roomCards.set(card.roomId, row.cards)
      }
    }
    if (typeof row.question === 'string' && typeof row.id === 'string') {
      const id = ctx.db.normalizeId('quizQuestions', row.id)
      if (!id) unavailable()
      addComponent({ kind: 'quiz_question', id })
    }
    if (row.type === 'flashcard' && typeof row.entityId === 'string') {
      const id = ctx.db.normalizeId('flashcardRooms', row.entityId)
      if (!id) unavailable()
      rooms.add(id)
    }
    if (row.type === 'audio' && typeof row.entityId === 'string') {
      const id = ctx.db.normalizeId('audioOverviews', row.entityId)
      if (!id) unavailable()
      addComponent({ kind: 'audio_overview', id })
    }
    for (const [field, child] of Object.entries(row)) visit(child, field)
  }
  if (root.artifact.kind !== 'document' && root.artifact.kind !== 'document_chunk') visit((await inputContent(ctx, userId, root.artifact)).projection.payload)
  for (const roomId of rooms) {
    const room = await ctx.db.get(roomId)
    if (!room || room.userId !== userId) unavailable()
    if (room.activeVersionId) addComponent({ kind: 'flashcard_version', id: room.activeVersionId })
    else ordinaryComponent = true
  }
  for (const binding of bindings) {
    for (const ref of binding.origins) if (!sameArtifact(ref.artifact)) references.set(canonicalJson(ref), ref)
    for (const dependency of binding.dependencies) {
      if (dependency.kind === 'document') documents.add(dependency.documentId)
      if (dependency.kind === 'snapshot' || dependency.kind === 'excerpt') snapshots.add(dependency.sourceSnapshotId)
    }
  }
  for (const id of snapshots) {
    const snapshot = await ctx.db.get(id)
    if (!snapshot || snapshot.userId !== userId || !snapshot.contentHash) unavailable()
    if (!await sourceAvailable(ctx, userId, { kind: 'snapshot', sourceSnapshotId: id, revision: snapshot.revision, recordRevision: snapshot.recordRevision ?? 1, contentHash: snapshot.contentHash })) unavailable()
    const source = await ctx.db.get(snapshot.sourceIdentityId)
    if (!source || source.userId !== userId) unavailable()
    if (source.folderDocumentId) documents.add(source.folderDocumentId)
  }
  for (const pin of documentPins) {
    const document = await liveDocument(ctx, userId, pin.id)
    if (document.sourceRevision !== pin.revision || document.contentHash !== pin.contentHash) unavailable()
  }
  for (const id of documents) addComponent({ kind: 'document', id })
  for (const artifact of components.values()) {
    const content = await inputContent(ctx, userId, artifact)
    if (artifact.kind === 'flashcard_version') {
      const payload = content.projection.payload as { version: { roomId: string }, cards: Record<string, unknown>[] }
      const current = roomCards.get(payload.version.roomId)
      const signature = (cards: unknown[]) => cards.map(card => canonicalJson(Object.fromEntries(Object.entries(card as Record<string, unknown>).filter(([key]) => key !== 'id' && key !== 'versionId')))).sort()
      if (current && canonicalJson(signature(current)) !== canonicalJson(signature(payload.cards))) ordinaryComponent = true
    }
    const payloadDigest = await artifactPayloadDigest(content.projection)
    const ref = { artifact, key: artifact.kind === 'document_chunk' ? LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY : 'whole', revision: content.revision ?? `sha256:${payloadDigest}`, payloadDigest }
    references.set(canonicalJson(ref), ref)
  }
  return { references: [...references.values()], ordinaryComponent }
}

async function inputAdmission(operation: () => Promise<LearnArtifactInputAdmissionResult>): Promise<LearnArtifactInputAdmissionResult> {
  try { return await operation() }
  catch (error) {
    if (error instanceof ArtifactProjectionBudgetError) return error.data
    if (!(error instanceof Unavailable)) throw error
    return { version: LEARN_ARTIFACT_INPUT_ADMISSION_VERSION, status: 'rejected', reasonCode: error instanceof RestrictedLineage ? 'restricted_lineage' : 'lineage_unavailable' }
  }
}

export async function admitArtifactInputForOwner(ctx: ReadCtx, userId: string, input: unknown) {
  ctx = withReadBudget(ctx)
  return inputAdmission(async () => {
    if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
    return admitInput(ctx, userId, input)
  })
}
export async function admitArtifactInputForRecord(ctx: ReadCtx, record: LearnArtifactOwnerRecord, input: unknown) {
  ctx = withReadBudget(ctx)
  return inputAdmission(async () => admitInput(ctx, await requireRecordOwner(ctx, record), input))
}
export async function admitArtifactInput(ctx: ReadCtx, input: unknown) {
  ctx = withReadBudget(ctx)
  return inputAdmission(async () => admitInput(ctx, await requireAuth(ctx), input))
}

type PreparationMember = LearnArtifactPreparationArgs['artifacts'][number]
type CaseFingerprints = Pick<Doc<'learnAssessmentCases'>, 'scenarioFingerprint' | 'solutionFingerprint'>
type ContentProjection = ReturnType<typeof artifactContentProjection>
export type InstructionalReservationSemanticAdapter = {
  version: string
  compare: (input: {
    ctx: ReadCtx, projection: ContentProjection, fingerprints: CaseFingerprints[],
    reservedCases: ReadonlyArray<Doc<'learnAssessmentCases'>>, catalog: Readonly<Doc<'learnAssessmentCatalogs'>>,
  }) => Promise<{ decision: 'pass' | 'reject' | 'unknown', coverage: 'complete' | 'unknown' }>
}

// C5.1 replaces this implementation with the shared validator. It is never a
// producer argument, and no generator verdict can substitute for its result.
export const instructionalReservationSemanticAdapter: InstructionalReservationSemanticAdapter = {
  version: LEARN_ARTIFACT_SEMANTIC_VERSION,
  async compare() { return { decision: 'unknown', coverage: 'unknown' } },
}

export async function normalizedInstructionalCaseFingerprints(scenario: string, solution: string): Promise<CaseFingerprints> {
  const fingerprint = (text: string) => canonicalDigest({ version: LEARN_ARTIFACT_CASE_IDENTITY_VERSION,
    text: text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim() }, ARTIFACT_CONTENT_BYTES)
  return { scenarioFingerprint: await fingerprint(scenario), solutionFingerprint: await fingerprint(solution) }
}

function caseTexts(projection: ContentProjection) {
  const cases: Array<{ scenario: string, solution: string }> = []
  const prose: string[] = []
  const proseFields = new Set(['content', 'claim', 'text', 'title', 'summary', 'prompt', 'narrativeArc', 'narrativePurpose', 'explanation', 'correctedExplanation', 'sourceChunkContent', 'chunkContent', 'assessmentRubricSnapshot'])
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') { if (proseFields.has(key) && value.trim()) prose.push(value); return }
    if (Array.isArray(value)) { for (const child of value) visit(child, key); return }
    if (value === null || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (typeof row.question === 'string' && typeof row.correctAnswer === 'string') {
      cases.push({ scenario: row.question, solution: typeof row.correctedAnswer === 'string' ? row.correctedAnswer : row.correctAnswer })
      return
    }
    if (typeof row.term === 'string' && typeof row.definition === 'string') {
      cases.push({ scenario: row.term, solution: typeof row.correctedDefinition === 'string' ? row.correctedDefinition : row.definition })
      return
    }
    for (const [field, child] of Object.entries(row)) visit(child, field)
  }
  visit(projection.payload)
  if (prose.length) cases.push({ scenario: prose.join('\n'), solution: prose.join('\n') })
  if (!cases.length) unavailable()
  return cases
}

async function preparationContent(ctx: ReadCtx, userId: string, artifact: PreparationMember['artifact']) {
  const owned = <T extends { userId: string }>(row: T | null): T => {
    if (!row || row.userId !== userId) unavailable()
    return row
  }
  switch (artifact.kind) {
    case 'document': case 'document_chunk': {
      const document = owned(await ctx.db.get(artifact.id))
      if (!document.sourceRevision?.trim() || !document.contentHash?.trim()) unavailable()
      return { projection: artifactContentProjection({ kind: artifact.kind, document }), revision: document.sourceRevision }
    }
    case 'quiz_question': return { projection: artifactContentProjection({ kind: artifact.kind, question: owned(await ctx.db.get(artifact.id)) }) }
    case 'section_block': return { projection: await sectionContentProjection(ctx, owned(await ctx.db.get(artifact.id))) }
    case 'flashcard_version': {
      const version = owned(await ctx.db.get(artifact.id))
      const cards = await boundedRows(ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', version._id)).take(201), 200)
      if (cards.some(card => card.userId !== userId || card.roomId !== version.roomId)) unavailable()
      return { projection: artifactContentProjection({ kind: artifact.kind, version, cards }), revision: String(version._id) }
    }
    case 'audio_overview': return withinAudioProjection(async () => ({ projection: await audioOverviewContentProjection(ctx, owned(await ctx.db.get(artifact.id))) }))
    case 'session_block': {
      const block = owned(await ctx.db.get(artifact.id))
      const content = owned(await ctx.db.get(block.sessionContentId))
      await requireInstructionalSession(ctx, userId, content)
      return { projection: await sessionBlockContentProjection(ctx, block, content), revision: String(content.revision) }
    }
  }
}

async function preparationSources(ctx: ReadCtx, userId: string, member: PreparationMember, projection: ContentProjection) {
  const documents = new Set<Id<'documents'>>()
  const snapshots = new Set<Id<'learnSourceSnapshots'>>()
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      if (['documentId', 'sourceDocumentId', 'sourceDocumentIds', 'scopeDocIds'].includes(key)) {
        const id = ctx.db.normalizeId('documents', value)
        if (!id) unavailable()
        documents.add(id)
      }
      if (key === 'sourceSnapshotId') {
        const id = ctx.db.normalizeId('learnSourceSnapshots', value)
        if (!id) unavailable()
        snapshots.add(id)
      }
      return
    }
    if (Array.isArray(value)) { for (const child of value) visit(child, key); return }
    if (value !== null && typeof value === 'object') for (const [field, child] of Object.entries(value)) visit(child, field)
  }
  visit(projection.payload)
  if (member.artifact.kind === 'document' || member.artifact.kind === 'document_chunk') documents.add(member.artifact.id)
  const sources: Dependency[] = [...member.sources]
  for (const documentId of documents) {
    const document = await liveDocument(ctx, userId, documentId)
    if (!document.sourceRevision?.trim()) unavailable()
    sources.push({ kind: 'document', documentId, sourceRevision: document.sourceRevision })
  }
  for (const sourceSnapshotId of snapshots) {
    const snapshot = await ctx.db.get(sourceSnapshotId)
    if (!snapshot || snapshot.userId !== userId || !snapshot.contentHash) unavailable()
    sources.push({ kind: 'snapshot', sourceSnapshotId, revision: snapshot.revision, recordRevision: snapshot.recordRevision ?? 1, contentHash: snapshot.contentHash })
  }
  const unique = [...new Map(sources.map(source => [canonicalJson(source), source])).values()]
  if (unique.length > limits.maxSources) unavailable()
  for (const source of unique) if (!await sourceAvailable(ctx, userId, source)) unavailable()
  return unique
}

async function reservedCases(ctx: ReadCtx, userId: string) {
  const byClass = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_usageClass', q => q.eq('userId', userId).eq('usageClass', 'measurement_reserved')).take(limits.maxReservedCases + 1)
  const byReservation = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_reservedAt', q => q.eq('userId', userId).gt('reservedAt', undefined)).take(limits.maxReservedCases + 1)
  const rows = [...new Map([...byClass, ...byReservation].map(row => [row._id, row])).values()]
  if (rows.length > limits.maxReservedCases) unavailable()
  return rows
}

async function instructionalCase(ctx: ReadCtx, userId: string, fingerprints: CaseFingerprints) {
  const scenarios = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint', q => q.eq('userId', userId).eq('scenarioFingerprint', fingerprints.scenarioFingerprint)).take(2)
  const solutions = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_solutionFingerprint', q => q.eq('userId', userId).eq('solutionFingerprint', fingerprints.solutionFingerprint)).take(2)
  const matches = [...new Map([...scenarios, ...solutions].map(row => [row._id, row])).values()]
  if (scenarios.length > 1 || solutions.length > 1 || matches.length > 1) unavailable()
  const existing = matches[0]
  if (existing && (existing.identityPolicyVersion !== LEARN_ARTIFACT_CASE_IDENTITY_VERSION || existing.usageClass === 'measurement_reserved' || existing.reservedAt !== undefined)) {
    throw new Error('Instructional reservation check rejected')
  }
  return existing
}

async function prepareAndRegister(ctx: MutationCtx, userId: string, input: unknown) {
  try { return await prepareAndRegisterBatch(ctx, userId, input) }
  catch (error) {
    if (error instanceof ReadBudgetExceeded) throw new ArtifactProjectionBudgetError()
    throw error
  }
}

async function prepareAndRegisterBatch(ctx: MutationCtx, userId: string, input: unknown) {
  const budget = createArtifactLineageReadContext(ctx)
  ctx = preparationSourceSnapshot(budget.ctx)
  const args = parseLearnContract(learnArtifactPreparationArgsSchema, input, ARTIFACT_LINEAGE_READ_BYTES)
  const catalog = await readCatalog(ctx, userId)
  if (catalog.measurementCapability?.enabled !== true || catalog.historyCompleteness !== 'prospective_complete'
    || ![catalog.instrumentationEpoch, catalog.historyBasisVersion, catalog.historyCoverageWatermark].every(value => learnVersionSchema.safeParse(value).success)) unavailable()
  const reservations = args.artifacts.some(member => member.artifact.kind !== 'document' && member.artifact.kind !== 'document_chunk') ? await reservedCases(ctx, userId) : []
  const reservedFingerprints = new Set(reservations.flatMap(row => [row.scenarioFingerprint, row.solutionFingerprint]))
  const corpusDigest = await artifactPayloadDigest({ version: LEARN_ARTIFACT_RESERVATION_VERSION, catalogRevision: catalog.catalogRevision,
    instrumentationEpoch: catalog.instrumentationEpoch, historyCompleteness: catalog.historyCompleteness, historyBasisVersion: catalog.historyBasisVersion,
    coverageWatermark: catalog.historyCoverageWatermark, reservations: reservations.map(row => ({ id: row._id, scenarioFingerprint: row.scenarioFingerprint,
      solutionFingerprint: row.solutionFingerprint, identityPolicyVersion: row.identityPolicyVersion, usageClass: row.usageClass, reservedAt: row.reservedAt })).sort((a, b) => String(a.id).localeCompare(String(b.id))) })
  const history = { instrumentationEpoch: catalog.instrumentationEpoch, historyCompleteness: catalog.historyCompleteness, historyBasisVersion: catalog.historyBasisVersion }
  const pending = []
  const distinct = new Set<string>()
  type CasePlan = { pin: CaseFingerprints, existing: Doc<'learnAssessmentCases'> | undefined }
  const plannedFingerprints = new Map<string, CasePlan>()
  const plannedIdentities = new Map<Id<'learnAssessmentCases'>, CasePlan>()
  for (const member of args.artifacts) {
    const personal = member.artifact.kind === 'document' || member.artifact.kind === 'document_chunk'
    if (personal && member.origins.length) unavailable()
    if (member.artifact.kind === 'document' || member.artifact.kind === 'document_chunk') await personalWorkDocument(ctx, userId, member.artifact.id)
    if (member.artifact.kind === 'document_chunk' && member.key !== LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY) unavailable()
    const content = await preparationContent(ctx, userId, member.artifact)
    const payloadDigest = await artifactPayloadDigest(content.projection)
    const reference = { artifact: member.artifact, key: member.key, revision: content.revision ?? `sha256:${payloadDigest}`, payloadDigest }
    const identity = canonicalJson({ artifact: reference.artifact, key: reference.key, revision: reference.revision })
    if (distinct.has(identity)) unavailable()
    distinct.add(identity)
    const active = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_key_and_revision_and_nextId', q => q.eq('artifact.kind', reference.artifact.kind).eq('artifact.id', reference.artifact.id).eq('key', reference.key).eq('revision', reference.revision).eq('nextId', undefined)).take(1)
    if (active.length) unavailable()
    const fingerprints: CaseFingerprints[] = []
    if (!personal) {
      for (const text of caseTexts(content.projection)) fingerprints.push(await normalizedInstructionalCaseFingerprints(text.scenario, text.solution))
      if (fingerprints.some(pin => reservedFingerprints.has(pin.scenarioFingerprint) || reservedFingerprints.has(pin.solutionFingerprint))) throw new Error('Instructional reservation check rejected')
    }
    const cases: CasePlan[] = []
    for (const pin of new Map(fingerprints.map(pin => [canonicalJson(pin), pin])).values()) {
      const existing = await instructionalCase(ctx, userId, pin)
      const scenario = plannedFingerprints.get(`scenario:${pin.scenarioFingerprint}`)
      const solution = plannedFingerprints.get(`solution:${pin.solutionFingerprint}`)
      const identity = existing ? plannedIdentities.get(existing._id) : undefined
      const matches = new Set([scenario, solution, identity].filter((plan): plan is CasePlan => plan !== undefined))
      if (matches.size > 1) unavailable()
      const plan = scenario ?? solution ?? identity ?? { pin, existing }
      if (existing && plan.existing?._id !== existing._id) unavailable()
      plannedFingerprints.set(`scenario:${pin.scenarioFingerprint}`, plan)
      plannedFingerprints.set(`solution:${pin.solutionFingerprint}`, plan)
      if (existing) plannedIdentities.set(existing._id, plan)
      cases.push(plan)
    }
    if (cases.length > limits.maxCases) unavailable()
    const origins = []
    for (const origin of member.origins) {
      const row = await findLineage(ctx, userId, origin.reference)
      if (row.classification !== 'teaching') throw new Error('Instructional reservation check rejected')
      const graph = await inspectGraph(ctx, userId, row, catalog.catalogRevision, true)
      if ([...graph.usage.values()].some(usage => usage === 'measurement_reserved')) throw new Error('Instructional reservation check rejected')
      origins.push({ row, transformation: origin.transformation })
    }
    let semanticDecision: 'not_required' | 'pass' | 'reject' | 'unknown' = 'not_required'
    if (!personal && reservations.length) {
      const semantic = await instructionalReservationSemanticAdapter.compare({ ctx, projection: content.projection, fingerprints, reservedCases: reservations, catalog })
      semanticDecision = semantic.decision
      if (semantic.decision !== 'pass' || semantic.coverage !== 'complete') throw new Error('Instructional reservation check unknown')
    }
    const sources = await preparationSources(ctx, userId, member, content.projection)
    const preparation = personal ? { kind: 'personal_work' as const, version: LEARN_ARTIFACT_PREPARATION_VERSION, ...history }
      : { kind: 'instructional_reservation' as const, version: LEARN_ARTIFACT_PREPARATION_VERSION, ...history, reservedCaseCount: reservations.length,
          deterministicDecision: 'pass' as const, semanticDecision, semanticVersion: instructionalReservationSemanticAdapter.version }
    pending.push({ reference, personal, cases, origins, sources, preparation })
  }
  const base = { userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: Date.now() }
  const harnessArtifactDigest = await artifactPayloadDigest({ version: LEARN_ARTIFACT_PREPARATION_VERSION, identity: LEARN_ARTIFACT_CASE_IDENTITY_VERSION,
    reservation: LEARN_ARTIFACT_RESERVATION_VERSION, semantic: instructionalReservationSemanticAdapter.version })
  const registeredCases = new Map<CasePlan, Doc<'learnAssessmentCases'>>()
  const artifacts = []
  for (const member of pending) {
    const bindings = []
    for (const plan of member.cases) {
      const { pin, existing } = plan
      let row = existing ?? registeredCases.get(plan)
      if (!row) {
        const caseId = await ctx.db.insert('learnAssessmentCases', { ...base, ...pin, caseKey: `instructional:${await artifactPayloadDigest(pin)}`,
          identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION, usageClass: 'unknown' })
        row = (await ctx.db.get(caseId))!
      }
      registeredCases.set(plan, row)
      bindings.push({ caseId: row._id, scenarioFingerprint: row.scenarioFingerprint, solutionFingerprint: row.solutionFingerprint, identityPolicyVersion: row.identityPolicyVersion })
    }
    const uniqueBindings = [...new Map(bindings.map(binding => [binding.caseId, binding])).values()]
    const lineageId = await ctx.db.insert('learnArtifactLineages', { ...base, ...member.reference, lineageVersion: LEARN_ARTIFACT_LINEAGE_VERSION,
      manifestDigest: '0'.repeat(64), classification: member.personal ? 'genuine_personal_work' : 'teaching', evidenceStatus: 'available',
      authority: member.personal ? 'personal_authorship' : 'server_producer', authorityVersion: LEARN_ARTIFACT_PREPARATION_VERSION,
      derivation: member.origins.length ? 'derived' : 'original', originCount: member.origins.length, caseCount: uniqueBindings.length, sourceCount: member.sources.length })
    for (const binding of uniqueBindings) await ctx.db.insert('learnArtifactCaseBindings', { ...base, lineageId, ...binding })
    for (const { row, transformation } of member.origins) await ctx.db.insert('learnArtifactLineageOrigins', { ...base, lineageId, originLineageId: row._id,
      originRevision: row.revision, originPayloadDigest: row.payloadDigest, originManifestDigest: row.manifestDigest, classification: row.classification, transformation })
    for (const dependency of member.sources) await ctx.db.insert('learnArtifactSourceLinks', { ...base, lineageId, evidenceStatus: 'available', dependency })
    const row = (await ctx.db.get(lineageId))!
    const originRows = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', lineageId)).take(limits.maxOrigins + 1)
    const caseRows = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', lineageId)).take(limits.maxCases + 1)
    const sourceRows = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', lineageId)).take(limits.maxSources + 1)
    const manifestDigest = await artifactManifestDigest(ctx, row, originRows, caseRows, sourceRows)
    const validationId = await ctx.db.insert('learnArtifactValidations', { ...base, lineageId, payloadDigest: row.payloadDigest, manifestDigest,
      evidenceStatus: 'available', decision: 'pass', comparedCatalogRevision: catalog.catalogRevision, coverage: 'complete', coverageWatermark: catalog.historyCoverageWatermark,
      corpusDigest, identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION, noveltyPolicyVersion: member.personal ? LEARN_ARTIFACT_PREPARATION_VERSION : LEARN_ARTIFACT_RESERVATION_VERSION,
      validatorVersion: LEARN_ARTIFACT_PREPARATION_VERSION, validatorModel: null, harnessArtifactDigest, preparation: member.preparation })
    await ctx.db.patch(lineageId, { manifestDigest, validationId })
    artifacts.push({ reference: member.reference, validationId })
  }
  const result = await registerBatch(ctx, userId, { artifacts, expectedCatalogRevision: catalog.catalogRevision })
  return parseLearnContract(learnArtifactPreparationResultSchema, { ...result, references: artifacts.map(member => member.reference) })
}

export async function prepareAndRegisterInstructionalArtifactsForOwner(ctx: MutationCtx, userId: string, input: unknown) {
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  return prepareAndRegister(ctx, userId, input)
}
export async function prepareAndRegisterInstructionalArtifactsForRecord(ctx: MutationCtx, record: LearnArtifactOwnerRecord, input: unknown) {
  ctx = withReadBudget(ctx)
  return prepareAndRegister(ctx, await requireRecordOwner(ctx, record), input)
}
export async function prepareAndRegisterInstructionalArtifacts(ctx: MutationCtx, input: unknown) {
  ctx = withReadBudget(ctx)
  return prepareAndRegister(ctx, await requireAuth(ctx), input)
}

async function personalWorkDocument(ctx: ReadCtx, userId: string, documentId: Id<'documents'>) {
  const document = await ctx.db.get(documentId)
  if (!document || document.userId !== userId || !['indexing', 'success'].includes(document.status)
    || !document.sourceRevision?.trim() || !document.contentHash?.trim()) unavailable()
  await liveFolder(ctx, userId, document.folderId)
  const bindings = await inspectInputRepresentations(ctx, userId, { kind: 'document', id: documentId })
  if (bindings.some(binding => binding.classification !== 'genuine_personal_work')) restrictedLineage()
  return { classification: 'genuine_personal_work' as const, reference: { artifact: { kind: 'document' as const, id: documentId }, key: 'whole', revision: document.sourceRevision,
    payloadDigest: await artifactPayloadDigest(artifactContentProjection({ kind: 'document', document })) } }
}
export async function classifyPersonalWorkDocumentForOwner(ctx: ReadCtx, userId: string, documentId: Id<'documents'>) {
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  return personalWorkDocument(ctx, userId, documentId)
}
export async function classifyPersonalWorkDocumentForRecord(ctx: ReadCtx, record: Extract<LearnArtifactOwnerRecord, { kind: 'document' }>) {
  ctx = withReadBudget(ctx)
  const userId = await requireRecordOwner(ctx, record)
  if (record.kind !== 'document') unavailable()
  return personalWorkDocument(ctx, userId, record.id)
}

async function supersede(ctx: MutationCtx, userId: string, input: unknown) {
  const args = parseLearnContract(learnArtifactSupersessionArgsSchema, input)
  const previous = await ctx.db.get(args.previousLineageId)
  const replacement = await ctx.db.get(args.replacementLineageId)
  const repinnable = ['document', 'document_chunk', 'session_block', 'flashcard_version', 'learner_artifact', 'measurement_item', 'scoring_spec']
  // A content-addressed revision is its payload digest, so only the manifest
  // commitment can change at the same revision: an origin or source re-pin.
  const contentAddressed = ['quiz_question', 'section_block', 'audio_overview']
  const sameContent = (a: Lineage, b: Lineage) => contentAddressed.includes(a.artifact.kind) && a.payloadDigest === b.payloadDigest
  if (!previous || !replacement || previous._id === replacement._id || previous.userId !== userId || replacement.userId !== userId
    || !available(previous) || previous.nextId !== undefined || replacement.nextId !== undefined || replacement.publication
    || !(repinnable.includes(previous.artifact.kind) || sameContent(previous, replacement)) || canonicalJson(previous.artifact) !== canonicalJson(replacement.artifact)
    || previous.key !== replacement.key || previous.revision !== replacement.revision
    || (previous.payloadDigest === replacement.payloadDigest && previous.manifestDigest === replacement.manifestDigest)
    || previous.classification !== replacement.classification || previous.authority !== replacement.authority || previous.derivation !== replacement.derivation) unavailable()
  const active = await ctx.db.query('learnArtifactLineages')
    .withIndex('by_artifact_kind_and_artifact_id_and_key_and_revision_and_nextId', q => q.eq('artifact.kind', previous.artifact.kind).eq('artifact.id', previous.artifact.id).eq('key', previous.key).eq('revision', previous.revision).eq('nextId', undefined)).take(3)
  if (active.length !== 2 || !active.some(row => row._id === previous._id) || !active.some(row => row._id === replacement._id)) unavailable()
  // A descendant can explicitly re-pin to an origin's recorded successor.
  // The old edge stays immutable; unrelated origins cannot replace it.
  const currentOrigin = async (edge: Doc<'learnArtifactLineageOrigins'>) => {
    const initial = await ctx.db.get(edge.originLineageId)
    if (!initial || initial.userId !== userId || initial.revision !== edge.originRevision || initial.payloadDigest !== edge.originPayloadDigest
      || initial.manifestDigest !== edge.originManifestDigest || initial.classification !== edge.classification) unavailable()
    let row: Lineage = initial
    const visited = new Set<Id<'learnArtifactLineages'>>()
    while (row.nextId !== undefined) {
      if (visited.has(row._id) || visited.size >= limits.maxNodes) unavailable()
      visited.add(row._id)
      const next: Lineage | null = await ctx.db.get(row.nextId)
      if (!next || next.userId !== userId || canonicalJson(next.artifact) !== canonicalJson(row.artifact)
        || next.key !== row.key || next.revision !== row.revision || next.classification !== row.classification) unavailable()
      row = next
    }
    return { id: row._id, revision: row.revision, payloadDigest: row.payloadDigest, manifestDigest: row.manifestDigest,
      classification: row.classification, transformation: edge.transformation }
  }
  const components = async (row: Lineage) => {
    const origins = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxOrigins + 1)
    const cases = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxCases + 1)
    const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(limits.maxSources + 1)
    if (origins.length > limits.maxOrigins || cases.length > limits.maxCases || sources.length > limits.maxSources
      || origins.length !== row.originCount || cases.length !== row.caseCount || sources.length !== row.sourceCount || sources.some(source => !available(source))) unavailable()
    const sorted = (values: unknown[]) => values.map(canonicalJson).sort()
    const currentOrigins = []
    for (const origin of origins) currentOrigins.push(await currentOrigin(origin))
    return canonicalJson({
      origins: sorted(currentOrigins),
      cases: sorted(cases.map(binding => ({ caseId: binding.caseId, scenarioFingerprint: binding.scenarioFingerprint,
        solutionFingerprint: binding.solutionFingerprint, identityPolicyVersion: binding.identityPolicyVersion }))),
      sources: sorted(sources.map(source => source.dependency)),
    })
  }
  if (await components(previous) !== await components(replacement)) unavailable()
  const catalog = await readCatalog(ctx, userId)
  const graph = await inspectGraph(ctx, userId, replacement, catalog.catalogRevision, false)
  if (graph.validation.comparedCatalogRevision !== catalog.catalogRevision || graph.validation.coverageWatermark !== catalog.historyCoverageWatermark) unavailable()
  // Existing reservations and publication history live on their original rows.
  // A teaching successor needs fresh registration in this same transaction.
  await ctx.db.patch(previous._id, { nextId: replacement._id })
  return replacement._id
}

export async function supersedeArtifactLineageForOwner(ctx: MutationCtx, userId: string, input: unknown) {
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  return supersede(ctx, userId, input)
}
export async function supersedeArtifactLineageForRecord(ctx: MutationCtx, record: LearnArtifactOwnerRecord, input: unknown) {
  ctx = withReadBudget(ctx)
  return supersede(ctx, await requireRecordOwner(ctx, record), input)
}
