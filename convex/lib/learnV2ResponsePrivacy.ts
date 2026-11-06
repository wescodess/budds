import { learnResponsePayloadSchema } from '../../shared/learn-v2-responses'
import { z } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export function canonicalPrivacyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPrivacyJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalPrivacyJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function privacyDigest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPrivacyJson(value)))
  return `sha256:${[...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function digestLegacyFingerprint(value: string) {
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value
  try { return await privacyDigest(JSON.parse(value)) }
  catch { return await privacyDigest(value) }
}

// This is a retention/access predicate, independent of product flags. A
// tombstone revokes every revision before its bounded byte purge completes.
export async function sourceBodyAvailable(ctx: QueryCtx | MutationCtx, userId: string, id: Id<'learnSourceSnapshots'>, options: { allowUnaccepted?: boolean } = {}) {
  const source = await ctx.db.get(id)
  const allowed = options.allowUnaccepted ? ['fetched', 'evaluated', 'user_accepted'] : ['user_accepted']
  if (!source || source.userId !== userId || !allowed.includes(source.effectiveStatus ?? source.status)
    || !allowed.includes(source.status) || source.evidencePurgedAt !== undefined
    || source.rightsStatus === 'prohibited' || source.conflictStatus === 'unresolved') return false
  const identity = await ctx.db.get(source.sourceIdentityId)
  if (!identity || identity.userId !== userId || identity.learningVoidId !== source.learningVoidId
    || identity.tombstonedAt !== undefined) return false
  const aggregate = await ctx.db.get(source.learningVoidId)
  const folder = aggregate && await ctx.db.get(aggregate.folderId)
  if (!aggregate || aggregate.userId !== userId || aggregate.status === 'archived' || !folder || folder.userId !== userId) return false
  if (identity.origin === 'folder_document' && !identity.folderDocumentId) return false
  if (identity.folderDocumentId) {
    const document = await ctx.db.get(identity.folderDocumentId)
    const documentFolder = document && await ctx.db.get(document.folderId)
    if (!document || document.userId !== userId || document.status !== 'success'
      || document.sourceRevision !== source.sourceRevision || !documentFolder || documentFolder.userId !== userId) return false
  }
  return true
}

export async function retainedSourceExcerpt(ctx: QueryCtx | MutationCtx, userId: string, id: Id<'learnSourceSnapshots'>, options: { allowUnaccepted?: boolean } = {}) {
  if (!await sourceBodyAvailable(ctx, userId, id, options)) return null
  // Locator-based scoring has its own rights policy. Retained text disclosure
  // always requires permission on both the snapshot and the excerpt.
  if ((await ctx.db.get(id))?.rightsStatus !== 'permitted') return null
  const excerpt = await ctx.db.query('learnSourceExcerpts')
    .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', id)).unique()
  return excerpt?.rightsStatus === 'permitted' && excerpt.evidencePurgedAt === undefined && excerpt.excerpt?.trim() ? excerpt : null
}

// Re-serialize only scheduling preferences and closed result metadata. Stored
// plan JSON is a cache, never authority to disclose arbitrary extra fields.
const planDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const planTime = z.string().regex(/^\d{2}:\d{2}$/)
const publicPlanInput = z.object({
  version: z.literal('learn-v2.schedule-input.v1'),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }),
  startLocalDate: planDate, targetLocalDate: planDate.nullable(), sessionMinutes: z.number().int().min(15).max(60),
  minRestMinutes: z.number().int().nonnegative(),
  availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: planTime, end: planTime })).max(28),
  blackoutDates: z.array(planDate).max(90), reviewIntervalsDays: z.array(z.number().int().positive()).max(4),
})
const publicPlanResult = z.object({
  version: z.literal('learn-v2.scheduler.v1'), status: z.enum(['feasible', 'infeasible']),
  reasonCodes: z.array(z.enum(['capacity_available', 'prerequisites_ordered', 'reviews_spaced', 'buffer_reserved', 'insufficient_capacity', 'final_buffer_missing'])).max(8),
  alternatives: z.array(z.object({ code: z.enum(['extend_deadline', 'add_availability', 'shorten_sessions_increase_cadence', 'reduce_depth', 'remove_lower_priority_objectives']) })).max(8),
})

export function retainedPlanCache(value: string | undefined, kind: 'input' | 'result') {
  if (!value || value.length > 256 * 1024) return undefined
  try {
    const parsed = (kind === 'input' ? publicPlanInput : publicPlanResult).safeParse(JSON.parse(value))
    return parsed.success ? JSON.stringify(parsed.data) : undefined
  }
  catch { return undefined }
}

export function privateFields<T extends Record<string, unknown>>(row: T & { _id: string, _creationTime: number }, names: readonly string[]) {
  const result: Record<string, unknown> & { _id: string, _creationTime: number } = { _id: row._id, _creationTime: row._creationTime }
  for (const name of names) if (row[name] !== undefined) result[name] = row[name]
  return result
}

export function legacySourceIds(ctx: QueryCtx | MutationCtx, json: string | undefined): Id<'learnSourceSnapshots'>[] | null {
  if (!json) return []
  try {
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value) || value.length > 64) return null
    const ids: Id<'learnSourceSnapshots'>[] = []
    for (const entry of value) {
      if (typeof entry !== 'string') return null
      const id = ctx.db.normalizeId('learnSourceSnapshots', entry)
      if (!id) return null
      ids.push(id)
    }
    return ids
  }
  catch { return null }
}

export async function retainedResponsePayload(ctx: QueryCtx | MutationCtx, userId: string, response: Doc<'learnResponses'>) {
  if (response.userId !== userId || response.bodyAvailability !== 'available' || response.evidenceStatus !== 'available' || response.invalidatedAt !== undefined) return null
  const target = 'assessmentOpportunityId' in response
    ? await ctx.db.get(response.assessmentOpportunityId) : await ctx.db.get(response.responseSlotId)
  if (!target || target.userId !== userId || target.submissionId !== response._id) return null
  if (response.scopeKind === 'v2') {
    const aggregate = await ctx.db.get(response.learningVoidId)
    const folder = aggregate && await ctx.db.get(aggregate.folderId)
    if (!aggregate || aggregate.userId !== userId || aggregate.status === 'archived' || !folder || folder.userId !== userId) return null
  }
  else {
    const thread = await ctx.db.get(response.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) return null
  }
  const links = await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', response._id)).take(65)
  if (links.length > 64 || (response.scopeKind === 'v2' && links.length === 0)) return null
  for (const link of links) {
    if (link.evidenceStatus !== 'available' || link.invalidatedAt !== undefined) return null
    const dependency = link.dependency
    if (dependency.kind === 'snapshot') {
      if (!await sourceBodyAvailable(ctx, userId, dependency.sourceSnapshotId)) return null
      const source = (await ctx.db.get(dependency.sourceSnapshotId))!
      if (source.revision !== dependency.sourceSnapshotRevision || (source.recordRevision ?? 1) !== dependency.sourceRecordRevision) return null
    }
    else if (dependency.kind === 'document') {
      const document = await ctx.db.get(dependency.documentId)
      const folder = document && await ctx.db.get(document.folderId)
      if (!document || document.userId !== userId || document.status !== 'success' || document.sourceRevision !== dependency.sourceRevision || !folder || folder.userId !== userId) return null
    }
    else {
      const folder = await ctx.db.get(dependency.folderId)
      if (!folder || folder.userId !== userId) return null
    }
  }
  const bodies = await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', response._id)).take(2)
  const body = bodies[0]
  if (bodies.length !== 1 || !body || body.payloadDigest !== response.payloadDigest
    || ('learningVoidId' in body ? response.scopeKind !== 'v2' || body.learningVoidId !== response.learningVoidId
      : response.scopeKind !== 'standalone' || body.threadId !== response.threadId)) return null
  const parsed = learnResponsePayloadSchema.safeParse(body.payload)
  if (!parsed.success) return null
  if (await privacyDigest(parsed.data) !== response.payloadDigest || new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength !== body.payloadBytes || body.payloadBytes > 48 * 1024) return null
  return parsed.data
}

export async function legacyResponseAvailable(ctx: QueryCtx, userId: string, attempt: Doc<'masteryAttempts'>) {
  if (attempt.userId !== userId) return false
  if (attempt.submissionId) {
    const response = await ctx.db.get(attempt.submissionId)
    return !!response && !!await retainedResponsePayload(ctx, userId, response)
  }
  if (!attempt.response) return false
  let ids = legacySourceIds(ctx, attempt.sourceSnapshotIdsJson)
  if (!ids) return false
  if (!ids.length) {
    const links = await ctx.db.query('learnObjectiveSources')
      .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', attempt.objectiveId)).take(65)
    if (links.length > 64) return false
    ids = links.map(link => link.sourceSnapshotId)
  }
  for (const id of ids) if (!await retainedSourceExcerpt(ctx, userId, id)) return false
  return true
}
