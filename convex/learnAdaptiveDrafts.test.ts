/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|need-draft-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|need-draft-other' }
const originalFlag = process.env.LEARN_V2_ENABLED

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function setup() {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  return { t, owner: t.withIdentity(OWNER), other: t.withIdentity(OTHER) }
}

describe('need-first thread draft authority', () => {
  test('creates and replays a server-owned standalone draft without mission or schedule prerequisites', async () => {
    const { t, owner, other } = await setup()
    const args = { need: '  Help me understand why this proof works.  ', outcome: 'Explain the proof clearly in my own words.', intent: 'understand' as const, availableTime: '15' as const, sourceScope: { kind: 'none' as const }, idempotencyKey: 'need-draft-draft-token-01' }
    const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)
    if (created.kind !== 'created') throw new Error('expected created draft')
    expect(await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)).toEqual({ ...created, replayed: true })
    expect(created).toMatchObject({ kind: 'created', replayed: false, status: 'draft_created', thread: { originalNeed: args.need, outcome: args.outcome, authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'draft', revision: 1 } })
    const rows = await t.run(async ctx => ({
      threads: await ctx.db.query('learningThreads').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
      receipts: await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
      jobs: await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
      attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
    }))
    expect(rows.threads).toHaveLength(1)
    expect(rows.receipts).toHaveLength(1)
    expect(rows.receipts[0]!.resultReference).not.toContain(args.need)
    expect(rows.receipts[0]!.resultReference).not.toContain(args.outcome)
    expect(rows.receipts[0]!.resultReference!.length).toBeLessThanOrEqual(4_096)
    expect(JSON.parse(rows.receipts[0]!.resultReference!)).toEqual({ kind: 'created', threadId: created.thread.id, revision: 1, status: 'draft_created', receiptId: created.receiptId })
    expect(rows.events).toEqual([expect.objectContaining({ eventType: 'thread_drafted', outcomeCode: 'draft_created' })])
    expect(rows.events.some(event => event.eventType === 'thread_command_committed')).toBe(false)
    expect(rows.jobs).toEqual([])
    expect(rows.attempts).toEqual([])
    await t.run(ctx => ctx.db.patch(created.thread.id, { lifecycle: 'ready', revision: 2, updatedAt: 2 }))
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)).resolves.toMatchObject({ kind: 'created', replayed: true, thread: { id: created.thread.id, lifecycle: 'ready', revision: 2 } })
    expect(await t.run(ctx => ctx.db.query('learningThreads').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2))).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2))).toHaveLength(1)
    await expect(owner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId: created.thread.id })).resolves.toMatchObject({ id: created.thread.id, outcome: args.outcome, lifecycle: 'ready', revision: 2 })
    await expect(other.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId: created.thread.id })).resolves.toBeNull()
    await expect(owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreads', paginationOpts: { cursor: null, numItems: 8 } })).resolves.toMatchObject({ page: [expect.objectContaining({ originalNeed: args.need, outcome: args.outcome })] })
  })

  test('creates from a goal alone and defaults the distinct outcome projection to the exact need', async () => {
    const { owner } = await setup()
    const args = { need: 'Teach me how this mechanism works.', intent: 'understand' as const, availableTime: '15' as const, sourceScope: { kind: 'none' as const }, idempotencyKey: 'need-draft-goal-only-01' }
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)).resolves.toMatchObject({
      kind: 'created',
      thread: { originalNeed: args.need, outcome: args.need },
    })
  })

  test('projects a legacy thread outcome without rewriting the aggregate', async () => {
    const { t, owner } = await setup()
    const threadId = await t.run(ctx => ctx.db.insert('learningThreads', {
      userId: OWNER.tokenIdentifier,
      originalNeed: 'Preserve this legacy learner wording.',
      intent: 'understand',
      availableTime: '15',
      authorityKind: 'standalone',
      sourceScope: { kind: 'none' },
      evidenceState: 'none',
      lifecycle: 'draft',
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }))
    await expect(owner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId })).resolves.toMatchObject({
      originalNeed: 'Preserve this legacy learner wording.',
      outcome: 'Preserve this legacy learner wording.',
    })
    expect((await t.run(ctx => ctx.db.get(threadId)))?.outcome).toBeUndefined()
  })

  test('retains owned folder and document scopes while denying foreign anchors', async () => {
    const { t, owner } = await setup()
    const ids = await t.run(async ctx => {
      const folderId = await ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Owned', documentCount: 1 })
      const documentId = await ctx.db.insert('documents', { userId: OWNER.tokenIdentifier, folderId, filename: 'proof.pdf', status: 'success', fileSize: 20 })
      const foreignFolderId = await ctx.db.insert('folders', { userId: OTHER.tokenIdentifier, name: 'Foreign', documentCount: 0 })
      return { folderId, documentId, foreignFolderId }
    })
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Use my folder', outcome: 'Prepare successfully with grounded material.', intent: 'prepare', availableTime: '25', sourceScope: { kind: 'folder', folderId: ids.folderId }, idempotencyKey: 'need-draft-folder-01' })).resolves.toMatchObject({ thread: { sourceScope: { kind: 'folder', sourceId: String(ids.folderId) }, evidenceState: 'preparing' } })
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Use my document', outcome: 'Build a working result from this document.', intent: 'build', availableTime: '45', sourceScope: { kind: 'document', documentId: ids.documentId }, idempotencyKey: 'need-draft-document-1' })).resolves.toMatchObject({ thread: { sourceScope: { kind: 'document', sourceId: String(ids.documentId) }, evidenceState: 'preparing' } })
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Steal a folder', outcome: 'Use material I do not own.', intent: 'explore', availableTime: '15', sourceScope: { kind: 'folder', folderId: ids.foreignFolderId }, idempotencyKey: 'need-draft-foreign-01' })).rejects.toThrow(/source is unavailable/i)
  })

  test('stores only URL hashes and pasted digest metadata, never raw paste or URLs', async () => {
    const { t, owner } = await setup()
    const rawPaste = 'PRIVATE pasted learner material that must remain local'
    const pasted = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Help with my notes', outcome: 'Explain the key idea without unsupported claims.', intent: 'understand', availableTime: 'no_limit', sourceScope: { kind: 'pasted', contentDigest: `sha256:${'b'.repeat(64)}`, byteCount: new TextEncoder().encode(rawPaste).byteLength }, idempotencyKey: 'need-draft-pasted-01' })
    const url = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Understand this guide', outcome: 'Summarize what I can safely learn from it.', intent: 'explore', availableTime: '15', sourceScope: { kind: 'url', url: 'https://private.example/guide?q=secret' }, idempotencyKey: 'need-draft-url-00001' })
    if (pasted.kind !== 'created' || url.kind !== 'created') throw new Error('expected created drafts')
    expect(pasted.thread).toMatchObject({ sourceScope: { kind: 'pasted', contentDigest: `sha256:${'b'.repeat(64)}`, byteCount: expect.any(Number) }, evidenceState: 'preparing' })
    expect(url.thread.sourceScope).toMatchObject({ kind: 'url', urlHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
    const durable = await t.run(async ctx => ({
      threads: await ctx.db.query('learningThreads').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8),
      receipts: await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8),
      activities: await ctx.db.query('learningThreadActivities').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8),
    }))
    expect(JSON.stringify(durable)).not.toContain(rawPaste)
    expect(JSON.stringify(durable)).not.toContain('private.example')
    expect(durable.activities).toEqual([])
  })

  test('rejects malformed, forged, gated, and duplicate-key requests before a second thread is written', async () => {
    const { t, owner } = await setup()
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: ' ', outcome: 'Explain this clearly', intent: 'understand', availableTime: '15', sourceScope: { kind: 'none' }, idempotencyKey: 'need-draft-empty-001' })).rejects.toThrow(/need/i)
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Learn safely', outcome: 'Explain this clearly', intent: 'understand', availableTime: '15', sourceScope: { kind: 'pasted', contentDigest: `sha256:${'c'.repeat(64)}`, byteCount: 10, rawPaste: 'must reject' }, idempotencyKey: 'need-draft-raw-0001' } as never)).rejects.toThrow()
    const args = { need: 'First need', outcome: 'Explain the result in my own words.', intent: 'understand' as const, availableTime: '15' as const, sourceScope: { kind: 'none' as const }, idempotencyKey: 'need-draft-duplicate-1' }
    await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { ...args, need: 'Changed need' })).resolves.toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { ...args, idempotencyKey: 'need-draft-gated-001' })).rejects.toThrow(/denied/i)
    expect(await t.run(ctx => ctx.db.query('learningThreads').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8))).toHaveLength(1)
  })

  test('serializes concurrent same-key creation to one thread and one event', async () => {
    const { t, owner } = await setup()
    const args = { need: 'Understand concurrency safely', outcome: 'Explain the concurrency result safely.', intent: 'understand' as const, availableTime: '15' as const, sourceScope: { kind: 'none' as const }, idempotencyKey: 'need-draft-concurrent-1' }
    const results = await Promise.all([owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args), owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)])
    expect(results.map(result => result.kind)).toEqual(['created', 'created'])
    expect(results.map(result => result.kind === 'created' ? result.replayed : null).sort()).toEqual([false, true])
    expect(await t.run(ctx => ctx.db.query('learningThreads').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(3))).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(3))).toHaveLength(1)
  })
})
