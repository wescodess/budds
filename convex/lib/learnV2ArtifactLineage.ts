import { getDocumentSize, type Infer, type Value } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireAuth } from './auth'
import { requireActiveBlueprint } from './learnV2BlueprintAuthority'
import { liveEvidenceState } from '../learnAdaptiveRecovery'
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

// Keep three quarters of the transaction's 16 MiB read allowance for C4.3.
export const ARTIFACT_LINEAGE_READ_BYTES = 4 * 1024 * 1024
const MAX_DOCUMENT_READ_BYTES = 1024 * 1024 + 64
const budgetContext = Symbol('artifactLineageReadBudget')

// All reads, including those inside shared authority helpers and indexed
// queries, use one budget. Reserve a maximum-size document BEFORE each read;
// charge the SDK's document size plus 64 bytes of conservative overhead.
function withReadBudget<T extends ReadCtx>(ctx: T): T {
  if (Reflect.get(ctx, budgetContext)) return ctx
  let bytes = 0
  let reserved = 0
  const read = async <R>(operation: () => Promise<R>): Promise<R> => {
    if (bytes + reserved + MAX_DOCUMENT_READ_BYTES > ARTIFACT_LINEAGE_READ_BYTES) unavailable()
    reserved += MAX_DOCUMENT_READ_BYTES
    try {
      const result = await operation()
      if (result !== null && result !== undefined) {
        // Iterator results are unwrapped before reaching this function.
        const size = getDocumentSize(result as Record<string, Value>) + 64
        if (size > MAX_DOCUMENT_READ_BYTES) unavailable()
        bytes += size
      }
      return result
    }
    finally { reserved -= MAX_DOCUMENT_READ_BYTES }
  }
  const iterate = async function* (query: object) {
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
      if (property === 'get') return (...args: unknown[]) => read(() => Reflect.apply(method, target, args))
      if (property === 'query') return (...args: unknown[]) => boundedQuery(Reflect.apply(method, target, args) as object)
      return method.bind(target)
    },
  })
  return new Proxy(ctx, { get: (target, property) => property === budgetContext ? true : property === 'db' ? db : Reflect.get(target, property) })
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
        return { ...objectIdentity(d), folderId: d.folderId, sourceRevision: d.sourceRevision, contentHash: d.contentHash, r2Key: d.r2Key, fileId: d.fileId,
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
  return { version: 'learn-v2.artifact-content.v1', kind: input.kind, payload }
}

// Server producers use this same bounded encoding when capturing payload pins.
// Hash artifactContentProjection, never a whole operational record. Legacy
// records without a revision counter use this content digest as their revision.
export async function artifactPayloadDigest(payload: unknown) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]))
    return value
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(payload)))
  if (bytes.length > 500_000) unavailable()
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
}

async function liveFolder(ctx: ReadCtx, userId: string, id: Id<'folders'>) {
  if ((await ctx.db.get(id))?.userId !== userId) unavailable()
}

// Mirrors learnV2Sources.ts:225-242, including revocation before cleanup.
async function liveVoid(ctx: ReadCtx, userId: string, id: Id<'learningVoids'>) {
  const row = await ctx.db.get(id)
  if (!row || row.userId !== userId || row.status === 'archived') unavailable()
  await liveFolder(ctx, userId, row.folderId)
  return row
}

async function liveDocument(ctx: ReadCtx, userId: string, id: Id<'documents'>) {
  const row = await ctx.db.get(id)
  // learnAdaptive.ts:78-82; revision/object pins are additionally bound below.
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

async function pinned(row: Lineage, payload: unknown, revision?: string | number) {
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

export async function audioOverviewContentProjection(ctx: ReadCtx, overview: Doc<'audioOverviews'>) {
  ctx = withReadBudget(ctx)
  return artifactContentProjection({ kind: 'audio_overview', overview, playback: await readAudioPlayback(ctx, overview) })
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

async function liveSessionBlock(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'sessionContentBlocks'>) {
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
  // getSessionContent (learnV2SessionContent.ts:1424-1457) and loadReadyCanvas.
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

async function liveDocumentArtifact(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'documents'>) {
  const document = await liveDocument(ctx, userId, id)
  if (!document.sourceRevision?.trim() || !document.contentHash?.trim()) unavailable()
  await pinned(row, artifactContentProjection({ kind: row.artifact.kind === 'document_chunk' ? 'document_chunk' : 'document', document }), document.sourceRevision)
}

async function liveDocumentChunk(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'documents'>) {
  // Chunks have no independent table: any backing revision/object change
  // revokes every component, without trusting a retrieved snippet as a pin.
  await liveDocumentArtifact(ctx, userId, row, id)
}

async function liveQuizQuestion(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'quizQuestions'>) {
  const question = await ctx.db.get(id)
  if (!question || question.userId !== userId) unavailable()
  const quiz = await ctx.db.get(question.quizId)
  // loadContributionSource, learnAdaptive.ts:65-74 (also course deletion).
  if (!quiz || quiz.userId !== userId || quiz.status !== 'ready' || quiz.deletedAt !== undefined) unavailable()
  await liveFolder(ctx, userId, quiz.folderId)
  if (quiz.courseId) await liveCourse(ctx, userId, quiz.courseId)
  await pinned(row, artifactContentProjection({ kind: 'quiz_question', question }))
}

async function liveSectionBlock(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'courseSections'>) {
  const section = await ctx.db.get(id)
  if (!section || section.userId !== userId || !['ready', 'completed'].includes(section.status)) unavailable()
  // courseSections.ts:341 and courses.ts:237 reject a deleting aggregate.
  await liveCourse(ctx, userId, section.courseId)
  await pinned(row, await sectionContentProjection(ctx, section))
}

async function liveFlashcardVersion(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'flashcardRoomVersions'>) {
  const version = await ctx.db.get(id)
  if (!version || version.userId !== userId) unavailable()
  const room = await ctx.db.get(version.roomId)
  // loadContributionSource, learnAdaptive.ts:58-62. Historical versions stay
  // live; restoring one never replaces its original lineage or case identity.
  if (!room || room.userId !== userId) unavailable()
  await liveFolder(ctx, userId, room.folderId)
  const cards = await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', version._id)).take(201)
  if (cards.length > 200 || cards.some(card => card.userId !== userId || card.roomId !== room._id)) unavailable()
  await pinned(row, artifactContentProjection({ kind: 'flashcard_version', version, cards }), version._id)
}

async function liveAudioOverview(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'audioOverviews'>) {
  const overview = await ctx.db.get(id)
  // loadContributionSource, learnAdaptive.ts:78-82.
  if (!overview || overview.userId !== userId || overview.status !== 'ready') unavailable()
  await liveAudioScope(ctx, overview)
  await pinned(row, await audioOverviewContentProjection(ctx, overview))
}

async function liveLearnerArtifact(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'learningThreadArtifacts'>) {
  const artifact = await ctx.db.get(id)
  if (!artifact || artifact.userId !== userId || !['draft', 'saved'].includes(artifact.status)) unavailable()
  const thread = await ctx.db.get(artifact.threadId)
  if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || thread.lifecycle === 'rollback') unavailable()
  if (thread.learningVoidId) await liveVoid(ctx, userId, thread.learningVoidId)
  if (['unavailable', 'invalidated', 'stale'].includes(await liveEvidenceState(ctx, thread))) unavailable()
  const activity = await ctx.db.get(artifact.activityId)
  if (!activity || activity.userId !== userId || activity.threadId !== thread._id) unavailable()
  // artifactEvidenceUnavailable/listThreadArtifacts, learnAdaptive.ts:564-570,660-685.
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
  // C1's published-item/evidence union, learnV2MeasurementStorage.ts:157-167.
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

async function liveMeasurementItem(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'learnMeasurementItems'>) {
  const { item, family, spec } = await liveMeasurementInventory(ctx, userId, await ctx.db.get(id))
  await pinned(row, artifactContentProjection({ kind: 'measurement_item', item, family, spec }), item.revision)
}

async function liveScoringSpec(ctx: ReadCtx, userId: string, row: Lineage, id: Id<'learnMeasurementScoringSpecs'>) {
  const spec = await ctx.db.get(id)
  if (!spec || spec.userId !== userId || !available(spec) || spec.payload === undefined || spec.referenceSolution === undefined) unavailable()
  const { item, family } = await liveMeasurementInventory(ctx, userId, await ctx.db.get(spec.itemId))
  if (item.scoringSpecId !== spec._id) unavailable()
  await pinned(row, artifactContentProjection({ kind: 'scoring_spec', item, family, spec }), spec.revision)
}

async function requireLiveArtifact(ctx: ReadCtx, userId: string, row: Lineage) {
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
    .withIndex('by_userId_and_artifact_kind_and_artifact_id_and_key_and_revision', q => q.eq('userId', userId)
      .eq('artifact.kind', reference.artifact.kind).eq('artifact.id', reference.artifact.id).eq('key', reference.key).eq('revision', reference.revision)).take(2)
  if (rows.length !== 1 || rows[0]!.payloadDigest !== reference.payloadDigest) unavailable()
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
    // learnV2Sources.ts:877-881 and learnAdaptive.ts:133-137. Compare
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
    validatorVersion: row.validatorVersion, validatorModel: row.validatorModel, harnessArtifactDigest: row.harnessArtifactDigest }
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
    sources: sorted(sourcePins) }
  learnSerializedBytes(manifest, limits.maxLookupBytes)
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(manifest)))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
}

async function inspectGraph(ctx: ReadCtx, userId: string, root: Lineage, catalogRevision: number, requirePublication: boolean) {
  const nodes = new Map<Id<'learnArtifactLineages'>, Lineage>()
  const heights = new Map<Id<'learnArtifactLineages'>, number>()
  const active = new Set<Id<'learnArtifactLineages'>>()
  const cases = new Map<Id<'learnAssessmentCases'>, Doc<'learnArtifactCaseBindings'>>()
  const usage = new Map<Id<'learnAssessmentCases'>, Doc<'learnAssessmentCases'>['usageClass']>()
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
    if (nodes.size >= limits.maxNodes || row.userId !== userId || !available(row)
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
      cases.set(binding.caseId, binding)
      usage.set(binding.caseId, candidate.reservedAt === undefined ? candidate.usageClass : 'measurement_reserved')
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
  return { nodes, cases, usage, validation: rootValidation }
}

export async function resolveArtifactLineageForOwner(ctx: ReadCtx, userId: string, input: unknown): Promise<LearnArtifactLookupResult> {
  ctx = withReadBudget(ctx)
  try {
    if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
    const { reference } = validateLearnArtifactLookup(input)
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
  ctx = withReadBudget(ctx)
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  const catalog = await readCatalog(ctx, userId)
  if (!learnSequenceSchema.safeParse(expectedRevision).success || catalog.catalogRevision !== expectedRevision
    || !Number.isSafeInteger(expectedRevision + 1)) unavailable()
  await ctx.db.patch(catalog._id, { catalogRevision: expectedRevision + 1 })
  return expectedRevision + 1
}

// Dormant transaction seam; callers must write their artifact in this mutation.
export async function registerInstructionalArtifactForOwner(ctx: MutationCtx, userId: string, input: unknown) {
  ctx = withReadBudget(ctx)
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
