/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { getFunctionName } from 'convex/server'
import { orchestrateSourceFetch } from './learnV2SourceActions'
import { orchestratePublicSearch } from './learnV2SearchActions'
import { LEARN_HELP_LIMITS } from './lib/learnV2HelpContract'
import { HELP_OWNER, helpConsumerFixture } from '../tests/fixtures/learn-v2-help-consumers'

const policy = vi.hoisted(() => ({ responses: true }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses } } }
})
const modules = import.meta.glob('./**/*.ts')
beforeEach(() => { policy.responses = true; vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('registered message and source help consumers', () => {
  test.each(['depth', 'cycle'] as const)('folder %s cannot prove irrelevance', async kind => {
    const s = await helpConsumerFixture(modules)
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Other work' })
    if (kind === 'cycle') await s.t.run(ctx => ctx.db.patch(folderId, { parentId: folderId }))
    else {
      let parent = folderId
      for (let index = 0; index < LEARN_HELP_LIMITS.folderDepth; index++) {
        const next = await s.owner.mutation(api.folders.createFolder, { name: 'Ancestor' })
        await s.t.run(ctx => ctx.db.patch(parent, { parentId: next }))
        parent = next
      }
    }
    expect(await s.admit([{ kind: 'folder', id: folderId }])).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  })
  test('an audio job in another folder is relevant when its resolved source is shared', async () => {
    const s = await helpConsumerFixture(modules)
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Other audio folder' })
    const jobId = await s.t.run(async ctx => {
      const taskId = await ctx.db.insert('tasks', { userId: HELP_OWNER.tokenIdentifier, type: 'audio', status: 'ready', title: 'Teaching', createdAt: Date.now(), updatedAt: Date.now() })
      return await ctx.db.insert('audioOverviewJobs', { userId: HELP_OWNER.tokenIdentifier, taskId, folderId,
        idempotencyKey: 'audio-job', capabilityHash: 'capability', status: 'completed', stage: 'complete',
        sourceDocumentIds: [s.f.documentId], completedTurns: 0, createdAt: Date.now(), updatedAt: Date.now() })
    })
    expect(await s.admit([{ kind: 'audio_job', id: jobId }])).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
  })
  test('a shared thread is relevant even without a shared folder or source', async () => {
    const s = await helpConsumerFixture(modules)
    await s.t.run(async ctx => {
      const activity = (await ctx.db.get(s.f.activityId))!
      await ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'ready', contextPins: {
        ...s.f.scope.contextPins, canvas: { threadId: s.f.threadId, threadRevision: 1, activityId: s.f.activityId, activityRevision: 1,
          planVersion: activity.planVersion, replayVersion: activity.replayVersion, rendererVersion: activity.rendererVersion,
          evaluationVersion: activity.evaluationContract.version, pilotConfigurationVersion: 'pilot.fixture' },
      } })
    })
    expect(await s.admit([{ kind: 'thread', id: s.f.threadId }])).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
  })
  test.each(['preparing', 'ready'] as const)('a relevant %s opportunity denies unavailable without a delivered exposure', async phase => {
    const s = await helpConsumerFixture(modules)
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase }))
    const before = (await s.exposures()).length
    expect(await s.admit([{ kind: 'folder', id: s.f.folderId }])).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
    expect((await s.exposures()).slice(before).map(row => row.status)).toEqual(['requested_denied'])
  })
  test('a denied member of the matching open set prevents every permitted exposure in that transaction', async () => {
    const s = await helpConsumerFixture(modules, false)
    await s.t.run(async ctx => {
      const { _id: _id, _creationTime: _time, ...row } = (await ctx.db.get(s.f.rows.learnAssessmentOpportunities))!
      await ctx.db.insert('learnAssessmentOpportunities', { ...row, purpose: { kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' } })
    })
    const before = (await s.exposures()).length
    expect(await s.admit([{ kind: 'folder', id: s.f.folderId }])).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    expect((await s.exposures()).slice(before).map(row => row.status)).toEqual(['requested_denied', 'requested_denied'])
  })
  test('source loss revokes an authorized receipt before content replay', async () => {
    const s = await helpConsumerFixture(modules, false)
    const refs = [{ kind: 'folder' as const, id: s.f.folderId }]
    expect((await s.admit(refs)).status).toBe('authorized')
    const before = (await s.exposures()).length
    await s.t.run(ctx => ctx.db.delete(s.f.documentId))
    expect(await s.admit(refs)).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
    expect((await s.exposures()).slice(before).map(row => row.status)).toEqual(['requested_denied'])
  })
  test('a newly open check releases the acquired source lease before retrieval', async () => {
    const s = await helpConsumerFixture(modules)
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'submitted_sealed', submissionId: s.f.rows.learnResponses }))
    const runMutation = vi.fn(async (reference, args) => {
      const name = getFunctionName(reference)
      if (name === 'learnV2Assistance:admitHelp') return s.owner.mutation(reference, args)
      if (name === 'learnV2Sources:replayOrAcquireFetch') {
        await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
        return { kind: 'acquired', leaseId: 'lease', leaseToken: 'lease-token', url: 'https://source.example', requestFingerprint: 'fingerprint' }
      }
      if (name === 'learnV2Sources:releaseFetchLease') return true
      throw new Error(`Unexpected mutation ${name}`)
    })
    const fetcher = vi.fn()
    const result = await orchestrateSourceFetch({ auth: { getUserIdentity: async () => HELP_OWNER }, runMutation } as never,
      { sourceSnapshotId: s.f.sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'source-race-key' }, fetcher)
    expect(result).toMatchObject({ ok: false, status: 'denied', reasonCode: 'test_open' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(runMutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual([
      'learnV2Assistance:admitHelp', 'learnV2Sources:replayOrAcquireFetch', 'learnV2Assistance:admitHelp', 'learnV2Sources:releaseFetchLease',
    ])
  })
  test.each(['usage', 'search'] as const)('public search rechecks after %s and withholds results if a check opened', async openAt => {
    const s = await helpConsumerFixture(modules)
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'submitted_sealed', submissionId: s.f.rows.learnResponses }))
    const runMutation = vi.fn(async (reference, args) => {
      const name = getFunctionName(reference)
      if (name === 'learnV2Assistance:admitHelp') return s.owner.mutation(reference, args)
      if (name === 'learnV2Search:replayOrReserve') return { kind: 'acquired', reservationId: 'reservation', executionToken: 'execution', revision: 1 }
      if (name === 'learnV2Search:acquireDispatchLease') return { kind: 'acquired', revision: 1 }
      if (name === 'learnV2Search:authorizeDispatch') return { kind: 'authorized', revision: 2 }
      if (name === 'learnV2Search:consume') return { status: 'consumed', revision: 3 }
      if (name === 'learnV2Search:releasePreDispatch') return { status: 'released' }
      throw new Error(`Unexpected mutation ${name}`)
    })
    const open = () => s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
    const search = vi.fn(async () => { if (openAt === 'search') await open(); return { requestIdHashInput: 'provider', credits: 1 as const,
      results: [{ title: 'PRIVATE_SOURCE', snippet: 'PRIVATE_SNIPPET', url: 'https://example.org' }] } })
    const result = await orchestratePublicSearch({ auth: { getUserIdentity: async () => HELP_OWNER }, runMutation } as never,
      { learningVoidId: s.f.learningVoidId, blueprintRevisionId: s.f.scope.blueprintRevisionId, expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1, query: 'A public rule', idempotencyKey: 'search-race-key' }, {
        config: () => ({ apiKey: 'test-key', projectId: 'test-project' }),
        usage: async () => { if (openAt === 'usage') await open(); return { plan: 'Researcher', keyUsage: 0, keyLimit: 800,
          planUsage: 0, planLimit: 1000, paygoUsage: 0, paygoLimit: 0 } }, search,
      })
    expect(result).toMatchObject({ ok: false, status: 'denied', reasonCode: 'test_open', results: [] })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
    expect(search).toHaveBeenCalledTimes(openAt === 'usage' ? 0 : 1)
    const mutations = runMutation.mock.calls.map(([ref]) => getFunctionName(ref))
    if (openAt === 'usage') expect(mutations).toContain('learnV2Search:releasePreDispatch')
  })
  test.each(['fetchSource', 'fetchAndPrepareSourceForReview'] as const)('%s denies before fetch, lease or evaluation, including receipt replay', async name => {
    const s = await helpConsumerFixture(modules)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const before = await s.exposures()
    const args = { sourceSnapshotId: s.f.sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'source-replay-key' }
    for (let replay = 0; replay < 2; replay++) {
      expect(await s.owner.action(api.learnV2SourceActions[name], args)).toMatchObject({ ok: false, status: 'denied', reasonCode: 'test_open' })
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(await s.t.run(ctx => ctx.db.query('learnSourceFetchLeases').take(8))).toEqual([])
    expect((await s.t.run(ctx => ctx.db.get(s.f.sourceSnapshotId)))?.revision).toBe(1)
    const after = await s.exposures()
    expect(after).toHaveLength(before.length + 1)
    expect(after.at(-1)).toMatchObject({ status: 'requested_denied', purpose: 'assistance_requested_denied' })
  })
  test('public search denies before usage, reservation and provider dispatch', async () => {
    const s = await helpConsumerFixture(modules)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const args = { learningVoidId: s.f.learningVoidId, blueprintRevisionId: s.f.scope.blueprintRevisionId,
      expectedVoidRevision: 1, expectedBlueprintRecordRevision: 1, query: 'A public rule', idempotencyKey: 'search-replay-key' }
    for (let replay = 0; replay < 2; replay++) expect(await s.owner.action(api.learnV2SearchActions.searchPublicWeb, args))
      .toMatchObject({ ok: false, status: 'denied', reasonCode: 'test_open', results: [] })
    expect(fetch).not.toHaveBeenCalled()
    expect(await s.t.run(ctx => ctx.db.query('searchReservations').take(8))).toEqual([])
  })
  test('both message aliases preserve learner text and metadata while withholding assistant, quoted and expanded source content', async () => {
    const s = await helpConsumerFixture(modules)
    const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId: s.f.folderId, title: 'Old teaching' })
    const overviewId = await s.t.run(ctx => ctx.db.insert('audioOverviews', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId,
      title: 'Old audio', status: 'ready', turns: [], voiceProfile: { hostA: 'a', hostB: 'b' }, totalDurationMs: 0 }))
    await s.owner.mutation(api.messages.appendMessage, { conversationId, role: 'user', content: 'My own question',
      sources: [{ content: 'EXPANDED_SOURCE', score: 1, filename: 'source.pdf' }],
      interjectionContext: { overviewId, turnIndex: 0, timeMs: 0, quotedText: 'AUDIO_SOURCE' } })
    await s.owner.mutation(api.messages.appendMessage, { conversationId, role: 'assistant', content: 'OLD_ANSWER',
      sources: [{ content: 'EXPANDED_SOURCE', score: 1, filename: 'source.pdf' }], model: 'example-model' })
    const rows = await s.owner.query(api.messages.listByConversation, { conversationId })
    const args = { conversationId, idempotencyKey: 'message-replay-key' }
    for (let replay = 0; replay < 2; replay++) {
      const response = await s.owner.mutation(api.messages.replayByConversation, args)
      expect(response.admission).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
      expect(response.messages).toEqual(rows)
    }
    expect(rows.map(row => row.content)).toEqual(['My own question', ''])
    expect(rows[1]).toMatchObject({ role: 'assistant', model: 'example-model', conversationId })
    for (const secret of ['OLD_ANSWER', 'EXPANDED_SOURCE', 'AUDIO_SOURCE']) expect(JSON.stringify(rows)).not.toContain(secret)
    expect((await s.exposures()).filter(row => row.provenanceVersion === 'learn-v2.help-admission.v1')).toHaveLength(1)
    expect((await s.exposures()).at(-1)).toMatchObject({ status: 'requested_denied' })
    policy.responses = false
    expect(JSON.stringify(await s.owner.query(api.messages.listByConversation, { conversationId }))).toContain('OLD_ANSWER')
    expect((await s.owner.mutation(api.messages.replayByConversation, args)).admission.status).toBe('ordinary')
  })
  test('authorized message replay commits one assistance fact; the same receipt is denied against a later held-out check', async () => {
    const s = await helpConsumerFixture(modules, false)
    const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId: s.f.folderId, title: 'Teaching' })
    await s.owner.mutation(api.messages.appendMessage, { conversationId, role: 'assistant', content: 'Separate case teaching',
      sources: [{ content: 'Teaching source', score: 1, filename: 'case.pdf' }] })
    const before = (await s.exposures()).length
    const args = { conversationId, idempotencyKey: 'message-replay-key' }
    const first = await s.owner.mutation(api.messages.replayByConversation, args)
    expect(first.admission.status).toBe('authorized')
    expect(first.messages[0]?.content).toBe('Separate case teaching')
    expect(first.messages[0]?.sources?.[0]?.content).toBe('Teaching source')
    expect(await s.owner.mutation(api.messages.replayByConversation, args)).toEqual(first)
    expect(await s.exposures()).toHaveLength(before + 1)
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { purpose: { kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' }, revision: 2 }))
    const denied = await s.owner.mutation(api.messages.replayByConversation, args)
    expect(denied.admission).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    expect(denied.messages[0]?.content).toBe('')
    expect(denied.messages[0]?.sources).toBeUndefined()
    expect(await s.exposures()).toHaveLength(before + 2)
  })
  test('unrelated message replay remains ordinary and does not contaminate the open check', async () => {
    const s = await helpConsumerFixture(modules)
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Other course' })
    const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId, title: 'Other course' })
    await s.owner.mutation(api.messages.appendMessage, { conversationId, role: 'assistant', content: 'Other course answer' })
    const before = await s.exposures()
    const result = await s.owner.mutation(api.messages.replayByConversation, { conversationId, idempotencyKey: 'unrelated-replay-key' })
    expect(result.admission.status).toBe('ordinary')
    expect(result.messages[0]?.content).toBe('Other course answer')
    expect(await s.exposures()).toEqual(before)
  })
})
