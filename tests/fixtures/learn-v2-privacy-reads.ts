import type { TestConvex } from 'convex-test'
import type { QueryCtx } from '../../convex/_generated/server'
import type { DefaultFunctionArgs, RegisteredQuery } from 'convex/server'
import schema from '../../convex/schema'
import { legacyActivityResponseFixture } from './learn-v2-activity-responses'
import { seedMeasurementStorage, STORAGE_CANARIES } from './learn-v2-measurement-storage'
import { api } from '../../convex/_generated/api'

function fields<T extends { _id: string, _creationTime: number }>(row: T) {
  const { _id: _id, _creationTime: _time, ...rest } = row
  return rest
}

export async function privacyHistoryFixture(t: TestConvex<typeof schema>, userId: string, activitiesPerSession = 7, sessions = 8) {
  const f = await legacyActivityResponseFixture(t, userId, 'calibration')
  const history = await t.run(async ctx => {
    const source = (await ctx.db.get(f.sourceSnapshotId!))!
    const identity = (await ctx.db.get(source.sourceIdentityId))!
    const document = (await ctx.db.get(f.documentId))!
    const excerpt = (await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', source._id)).unique())!
    const sources = [source._id]
    for (let index = 1; index < 4; index++) {
      const documentId = await ctx.db.insert('documents', fields(document))
      const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { ...fields(identity), folderDocumentId: documentId, externalKey: `read-source-${index}` })
      const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { ...fields(source), sourceIdentityId })
      await ctx.db.insert('learnSourceExcerpts', { ...fields(excerpt), sourceSnapshotId })
      sources.push(sourceSnapshotId)
    }
    const activity = (await ctx.db.get(f.activityId))!
    const content = (await ctx.db.get(activity.sessionContentId!))!
    const session = (await ctx.db.get(content.studySessionId))!
    const attempt = (await ctx.db.get(f.legacyAttemptId))!
    const attempts = []
    const activities = []
    for (let index = 0; index < sessions; index++) {
      const studySessionId = index === 0 ? session._id : await ctx.db.insert('studySessions', fields(session))
      const sessionContentId = index === 0 ? content._id : await ctx.db.insert('sessionContent', { ...fields(content), studySessionId })
      const values = { userId, objectiveId: attempt.objectiveId, blueprintRevisionId: attempt.blueprintRevisionId,
        kind: 'calibration' as const, response: f.answer, confidence: 4, serverScorePercent: 80, usedHint: false, usedReveal: false,
        studySessionId, sessionContentId, sourceSnapshotIdsJson: JSON.stringify(sources), idempotencyKey: `read-attempt-${index}`, attemptedAt: attempt.attemptedAt + index }
      const attemptId = index === 0 ? attempt._id : await ctx.db.insert('masteryAttempts', values)
      if (index === 0) await ctx.db.patch(attemptId, values)
      attempts.push(attemptId)
      for (let ordinal = 0; ordinal < activitiesPerSession; ordinal++) {
        const values = { ...fields(activity), masteryAttemptId: attemptId, sessionContentId,
          activityId: `read-activity-${index}-${ordinal}`, boundaryOrdinal: index * activitiesPerSession + ordinal + 1,
          decisionInputs: { ...activity.decisionInputs, sourceInputs: sources.map(id => ({ sourceSnapshotId: String(id), effectiveStatus: 'user_accepted' as const, recordRevision: 1 })) } }
        const activityId = index === 0 && ordinal === 0 ? activity._id : await ctx.db.insert('learningThreadActivities', values)
        if (index === 0 && ordinal === 0) await ctx.db.patch(activityId, values)
        activities.push(activityId)
        for (const sourceSnapshotId of sources) await ctx.db.insert('learnActivityEvidenceLinks', { userId, threadId: f.threadId, activityId, sourceSnapshotId, boundaryOrdinal: values.boundaryOrdinal, createdAt: Date.now() })
      }
    }
    return { attempts, activities, sources, learningVoidId: identity.learningVoidId }
  })
  return { ...f, ...history }
}

export async function addDistinctActivitySources(f: Awaited<ReturnType<typeof privacyHistoryFixture>>, sourcesPerActivity = 16) {
  await f.t.run(async ctx => {
    const source = (await ctx.db.get(f.sourceSnapshotId!))!
    const identity = (await ctx.db.get(source.sourceIdentityId))!
    const document = (await ctx.db.get(f.documentId))!
    for (const activityId of f.activities) {
      const activity = (await ctx.db.get(activityId))!
      const sourceInputs = []
      for (let ordinal = 0; ordinal < sourcesPerActivity; ordinal++) {
        const objectKey = `${activityId}/${ordinal}.txt`
        const documentId = await ctx.db.insert('documents', { ...fields(document), r2Key: objectKey })
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { ...fields(identity), folderDocumentId: documentId, externalKey: objectKey })
        const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { ...fields(source), sourceIdentityId, blueprintRevisionId: undefined, objectKey })
        await ctx.db.insert('learnSourceExcerpts', { userId: f.userId, sourceSnapshotId, locator: 'p:1', excerpt: 'Retained historical source', rightsStatus: 'permitted' })
        sourceInputs.push({ sourceSnapshotId: String(sourceSnapshotId), effectiveStatus: 'user_accepted' as const, recordRevision: 1 })
      }
      await ctx.db.patch(activityId, { decisionInputs: { ...activity.decisionInputs, sourceInputs } })
    }
  })
}

export async function canonicalPrivacyPageFixture(t: TestConvex<typeof schema>, userId: string) {
  const owner = t.withIdentity({ tokenIdentifier: userId })
  await owner.mutation(api.users.upsertUser, {})
  await t.run(async ctx => {
    for (let index = 0; index < 8; index++) {
      const f = await seedMeasurementStorage(ctx, userId)
      const source = (await ctx.db.get(f.sourceSnapshotId))!
      const identity = (await ctx.db.get(f.sourceIdentityId))!
      const document = (await ctx.db.get(f.documentId))!
      for (let ordinal = 0; ordinal < 63; ordinal++) {
        const documentId = await ctx.db.insert('documents', fields(document))
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { ...fields(identity), folderDocumentId: documentId, externalKey: `${index}-${ordinal}` })
        const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { ...fields(source), sourceIdentityId })
        await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId, locator: 'p:1', excerpt: 'Maximum-cardinality retained source', rightsStatus: 'permitted' })
        await ctx.db.insert('learnResponseEvidenceLinks', { ...f.base, evidenceStatus: 'available', submissionId: f.rows.learnResponses,
          learningVoidId: f.learningVoidId, aggregate: { learningVoidId: f.learningVoidId },
          dependency: { kind: 'snapshot', sourceSnapshotId, sourceSnapshotRevision: 1, sourceRecordRevision: 1, supportManifestDigest: 'support-hash' } })
      }
    }
  })
  return { t, owner, userId, answer: STORAGE_CANARIES.answer }
}

export function invokePrivacyQuery<A extends DefaultFunctionArgs, R>(fn: RegisteredQuery<'public', A, R>, ctx: QueryCtx, args: A): R {
  const handler: unknown = Reflect.get(fn, '_handler')
  if (typeof handler !== 'function') throw new Error('Registered query handler unavailable')
  return Reflect.apply(handler, undefined, [ctx, args]) as R
}

export function tracePrivacyReads(ctx: QueryCtx, ceiling = 4096) {
  const stats = { calls: 0, byTable: {} as Record<string, number> }
  const charge = (key: string) => {
    stats.byTable[key] = (stats.byTable[key] ?? 0) + 1
    if (++stats.calls > ceiling) throw new Error('Synthetic index range limit exceeded')
  }
  const db = new Proxy(ctx.db, {
    get(target, property) {
      const method: unknown = Reflect.get(target, property)
      if (typeof method !== 'function') return method
      if (property === 'query') return (table: string) => { charge(`query:${table}`); return Reflect.apply(method, target, [table]) }
      if (property === 'get') return (...args: unknown[]) => {
        const table = args.length === 2 ? args[0] : Object.keys(schema.tables).find(table => target.normalizeId(table as keyof typeof schema.tables, String(args[0])))
        charge(`get:${table}`)
        return Reflect.apply(method, target, args)
      }
      return method.bind(target)
    },
  })
  return { ctx: { ...ctx, db }, stats }
}
