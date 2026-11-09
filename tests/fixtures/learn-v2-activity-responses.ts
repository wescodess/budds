import type { TestConvex } from 'convex-test'
import type schema from '../../convex/schema'
import type { Id } from '../../convex/_generated/dataModel'
import { backingResponseFixture } from './learn-v2-backing-response'

export const ACTIVITY_RESPONSE_CASES = [
  ['legacy', 'unrelated_slots'], ['direct', 'unrelated_slots'], ['snapshot', 'unrelated_slots'],
  ['snapshot', 'unrelated_canvas_slots'], ['snapshot', 'unrelated_opportunities'],
  ['legacy', 'own_overflow'], ['direct', 'own_overflow'], ['snapshot', 'own_slot_overflow'],
  ['snapshot', 'own_opportunity_overflow'], ['snapshot', 'mixed_overflow'],
  ['snapshot', 'mismatched_slot_session'], ['snapshot', 'mismatched_opportunity_session'],
] as const
type TargetKind = 'standalone' | 'canvas_slot' | 'opportunity'
type TargetFixture = { t: TestConvex<typeof schema>, userId: string, threadId: Id<'learningThreads'>,
  activityId: Id<'learningThreadActivities'>, submissionId?: Id<'learnResponses'> }
type Scenario = typeof ACTIVITY_RESPONSE_CASES[number][1]
let ordinal = 0

export async function appendActivityResponseTargets(f: TargetFixture, count: number, related: boolean, kind: TargetKind) {
  await f.t.run(async ctx => {
    const activity = (await ctx.db.get(f.activityId))!
    const { _id: _activityId, _creationTime: _activityTime, ...activityFields } = activity
    const activityId = related ? f.activityId : await ctx.db.insert('learningThreadActivities', {
      ...activityFields, activityId: `unrelated-${++ordinal}`, boundaryOrdinal: ordinal + 100,
    })
    const base = { userId: f.userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: Date.now() }
    const hash = `sha256:${'a'.repeat(64)}`
    if (kind === 'standalone') {
      const deliveryExposureId = await ctx.db.insert('learnAssessmentExposures', { ...base, threadId: f.threadId, activityId,
        purpose: 'practice', status: 'granted', projectionDigest: hash, deliveryReceiptHash: hash, serverTime: Date.now(), policyVersion: 'delivery.v1', provenanceVersion: 'delivery.v1' })
      for (let index = 0; index < count; index++) await ctx.db.insert('learnResponseSlots', { ...base,
        scopeKind: 'standalone', threadId: f.threadId, activityId, threadRevision: 3, activityRevision: 1,
        activityContractVersion: activity.contractVersion, stage: 'diagnostic', slotKey: `terminal-${++ordinal}`, blockId: 'history',
        promptDigest: hash, promptRevision: 1, responseFormatVersion: 'text.v1', deliveryExposureId,
        revision: 1, status: 'terminal', terminalReason: 'cancelled', evidenceStatus: 'available' })
      return
    }
    const response = f.submissionId && await ctx.db.get(f.submissionId)
    if (!response || response.scopeKind !== 'v2' || response.contextPins.kind !== 'session' || !response.contextPins.canvas) throw new Error('Missing Canvas fixture')
    const contextPins = { ...response.contextPins, canvas: { ...response.contextPins.canvas, activityId } }
    if (kind === 'opportunity') {
      if (!('assessmentOpportunityId' in response)) throw new Error('Missing opportunity fixture')
      const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(response.assessmentOpportunityId))!
      for (let index = 0; index < count; index++) await ctx.db.insert('learnAssessmentOpportunities', {
        ...fields, contextPins, delayedCheckId: `terminal-${++ordinal}`, phase: 'cancelled', submissionId: undefined,
      })
      return
    }
    const template = await ctx.db.query('learnResponseSlots').withIndex('by_userId', q => q.eq('userId', f.userId)).first()
    if (!template || template.scopeKind !== 'v2') throw new Error('Missing session slot fixture')
    const { _id: _id, _creationTime: _time, ...fields } = template
    for (let index = 0; index < count; index++) await ctx.db.insert('learnResponseSlots', {
      ...fields, learningVoidId: response.learningVoidId, blueprintRevisionId: response.blueprintRevisionId,
      objectiveId: response.objectiveId, contextPins, slotKey: `terminal-${++ordinal}`, status: 'terminal',
      terminalReason: 'cancelled', submissionId: undefined,
    })
  })
}

export async function activityResponseFixture(t: TestConvex<typeof schema>, userId: string, kind: typeof ACTIVITY_RESPONSE_CASES[number][0]) {
  return await backingResponseFixture(t, userId, kind)
}

export const LEGACY_ACTIVITY_CASES = (['calibration', 'independent_application'] as const).flatMap(kind =>
  (['mixed_overflow', 'mismatched_slot_session', 'mismatched_opportunity_session'] as const).map(scenario => [kind, scenario] as const))

export async function legacyActivityResponseFixture(t: TestConvex<typeof schema>, userId: string, legacyKind: typeof LEGACY_ACTIVITY_CASES[number][0]) {
  const f = await activityResponseFixture(t, userId, 'snapshot')
  const legacyAttemptId = await t.run(async ctx => {
    if (!f.submissionId || !f.sourceSnapshotId) throw new Error('Expected snapshot fixture')
    const response = (await ctx.db.get(f.submissionId))!
    if (response.scopeKind !== 'v2' || response.contextPins.kind !== 'session') throw new Error('Expected session response')
    await ctx.db.patch(response.learningVoidId, { activeBlueprintRevisionId: response.blueprintRevisionId })
    await ctx.db.patch(response.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.sourceSnapshotId, { blueprintRevisionId: response.blueprintRevisionId })
    const attemptId = await ctx.db.insert('masteryAttempts', { userId, blueprintRevisionId: response.blueprintRevisionId,
      objectiveId: response.objectiveId, sessionContentId: response.contextPins.sessionContentId, studySessionId: response.contextPins.studySessionId,
      attemptedAt: Date.now(), idempotencyKey: `legacy-${legacyKind}`, kind: legacyKind, response: f.answer,
      serverScorePercent: 80, confidence: 4, usedHint: false, usedReveal: false, result: 'passed',
      sourceSnapshotIdsJson: JSON.stringify([f.sourceSnapshotId]) })
    await ctx.db.patch(f.activityId, { masteryAttemptId: attemptId })
    return attemptId
  })
  return { ...f, legacyAttemptId, legacyKind }
}

async function mismatchActivitySession(f: TargetFixture, kind: TargetKind) {
  await f.t.run(async ctx => {
    const contentId = (await ctx.db.get(f.activityId))!.sessionContentId!
    const content = (await ctx.db.get(contentId))!
    const { _id: _sessionId, _creationTime: _sessionTime, ...session } = (await ctx.db.get(content.studySessionId))!
    const studySessionId = await ctx.db.insert('studySessions', { ...session, revision: session.revision + 1 })
    const target = kind === 'canvas_slot'
      ? (await ctx.db.query('learnResponseSlots').withIndex('by_userId_and_contextPins_canvas_activityId', q => q.eq('userId', f.userId).eq('contextPins.canvas.activityId', f.activityId)).take(64)).find(row => row.status === 'terminal')
      : (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_canvas_activityId', q => q.eq('userId', f.userId).eq('contextPins.canvas.activityId', f.activityId)).take(64)).find(row => row.phase === 'cancelled')
    if (!target || target.scopeKind !== 'v2' || target.contextPins.kind !== 'session') throw new Error('Expected terminal Canvas target')
    await ctx.db.patch(target._id, { contextPins: { ...target.contextPins, studySessionId } })
  })
}

export async function exerciseActivityResponseLimit(f: Awaited<ReturnType<typeof activityResponseFixture>>, scenario: Scenario,
  assertDisclosure: (disclosed: boolean) => Promise<void>) {
  await assertDisclosure(true)
  const unrelated = scenario.startsWith('unrelated')
  const kind: TargetKind = scenario.includes('opportunit') ? 'opportunity'
    : scenario.includes('canvas') || scenario === 'own_slot_overflow' || scenario === 'mismatched_slot_session' ? 'canvas_slot' : 'standalone'
  if (scenario.startsWith('mismatched')) {
    await appendActivityResponseTargets(f, 1, true, kind)
    await assertDisclosure(true)
    await mismatchActivitySession(f, kind)
    await assertDisclosure(false)
  } else if (unrelated) {
    await appendActivityResponseTargets(f, f.kind === 'direct' ? 63 : 64, false, kind)
    await assertDisclosure(true)
    await appendActivityResponseTargets(f, 1, false, kind)
    await assertDisclosure(true)
    await appendActivityResponseTargets(f, 70, false, kind)
    await assertDisclosure(true)
  } else {
    if (scenario === 'mixed_overflow') {
      await appendActivityResponseTargets(f, 32, true, 'canvas_slot')
      await appendActivityResponseTargets(f, 31, true, 'opportunity')
    } else await appendActivityResponseTargets(f, f.kind === 'legacy' ? 64 : 63, true, kind)
    await assertDisclosure(true)
    await appendActivityResponseTargets(f, 1, true, scenario === 'mixed_overflow' ? 'opportunity' : kind)
    await assertDisclosure(false)
  }
}
