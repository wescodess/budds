/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER = {
  tokenIdentifier: 'https://auth.example.com|audio_job_owner',
  name: 'Audio Job Owner',
  email: 'audio-job@example.com',
}

const JOB_SECRET = 'local-test-audio-overview-job-secret'
const IDEMPOTENCY_KEY = 'audio_job_request_0001'
const PREFERENCES = { lengthMinutes: 5, complexity: 'beginner' } as const
const VOICE_PROFILE = { hostA: 'asteria', hostB: 'orion' } as const
const HOST_NAMES = { hostA: 'Maya', hostB: 'Leo' } as const

afterEach(() => {
  delete process.env.AUDIO_OVERVIEW_JOB_SECRET
  vi.clearAllTimers()
  vi.useRealTimers()
})

beforeEach(() => {
  process.env.AUDIO_OVERVIEW_JOB_SECRET = JOB_SECRET
})

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function deriveCapability(idempotencyKey = IDEMPOTENCY_KEY): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JOB_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`audio-overview-job:v1\n${USER.tokenIdentifier}\n${idempotencyKey}`),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

async function setup() {
  const t = convexTest(schema, modules)
  const asUser = t.withIdentity(USER)
  await asUser.mutation(api.users.upsertUser, {})
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Audio jobs' })
  const roomId = (await asUser.mutation(api.audioOverviewRooms.create, {
    folderId,
    title: 'Test room',
  })).roomId
  const documentId = await t.run(ctx => ctx.db.insert('documents', {
    userId: USER.tokenIdentifier,
    folderId,
    filename: 'grounded-source.txt',
    r2Key: 'audio-job-owner/grounded-source.txt',
    status: 'success',
    fileSize: 512,
    contentHash: 'a'.repeat(64),
    sourceRevision: `sha256:${'a'.repeat(64)}`,
  }))
  const capability = await deriveCapability()
  const request = {
    folderId,
    roomId,
    scope: { mode: 'explicit' as const, documentIds: [documentId] },
    preferences: PREFERENCES,
    voiceProfile: VOICE_PROFILE,
    hostNames: HOST_NAMES,
    idempotencyKey: IDEMPOTENCY_KEY,
    capability,
  }
  return { t, asUser, folderId, roomId, documentId, request, capability }
}

async function scheduledNames(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const scheduled = await ctx.db.system.query('_scheduled_functions').collect()
    return scheduled.map(job => job.name.replace('.', ':'))
  })
}

describe('audioOverviewJobs.request', () => {
  test('[P0] retries return the original reservation without consuming quota twice', async () => {
    const { t, asUser, documentId, request } = await setup()

    const first = await asUser.mutation(api.audioOverviewJobs.request, request)
    const duplicate = await asUser.mutation(api.audioOverviewJobs.request, request)

    expect(first.duplicate).toBe(false)
    expect(first.budget).toEqual({ reservedMicrousd: 187_100 })
    expect(duplicate).toMatchObject({
      duplicate: true,
      jobId: first.jobId,
      taskId: first.taskId,
      quota: { used: 1, cap: 100 },
      budget: { reservedMicrousd: 187_100 },
    })
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(1)

    const rows = await t.run(async (ctx) => ({
      jobs: await ctx.db.query('audioOverviewJobs').collect(),
      tasks: await ctx.db.query('tasks').collect(),
    }))
    expect(rows.jobs).toHaveLength(1)
    expect(rows.jobs[0]?.budgetReservedMicrousd).toBe(187_100)
    expect(rows.tasks).toHaveLength(1)
    expect(rows.tasks[0]?.audioOverviewRequest?.documents).toEqual([
      expect.objectContaining({ documentId, filename: 'grounded-source.txt' }),
    ])
  })

  test('[P0] reopens a legacy pre-launch failure without consuming quota twice', async () => {
    const { t, asUser, request, capability } = await setup()
    const first = await asUser.mutation(api.audioOverviewJobs.request, request)
    await asUser.mutation(api.audioOverviewJobs.fail, {
      jobId: first.jobId,
      capability,
      error: 'Audio overview Workflow could not be started after bounded retries',
    })

    const retry = await asUser.mutation(api.audioOverviewJobs.request, request)

    expect(retry).toMatchObject({
      duplicate: true,
      jobId: first.jobId,
      taskId: first.taskId,
      status: 'accepted',
      quota: { used: 1, cap: 100 },
    })
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(1)
    const state = await t.run(async ctx => ({
      job: await ctx.db.get(first.jobId),
      task: await ctx.db.get(first.taskId),
    }))
    expect(state.job).toMatchObject({ status: 'accepted', stage: 'accepted' })
    expect(state.job?.error).toBeUndefined()
    expect(state.job?.completedAt).toBeUndefined()
    expect(state.task).toMatchObject({ status: 'pending', progress: 'Preparing…' })
    expect(state.task?.error).toBeUndefined()
    expect(state.task?.completedAt).toBeUndefined()
  })

  test('[P0] rejects reuse of an idempotency key with changed preferences', async () => {
    const { asUser, request } = await setup()
    await asUser.mutation(api.audioOverviewJobs.request, request)

    await expect(asUser.mutation(api.audioOverviewJobs.request, {
      ...request,
      preferences: { ...request.preferences, complexity: 'expert' },
    })).rejects.toThrow(/different audio overview request/i)
  })

  test('[P0] an authenticated caller cannot choose its own Workflow capability', async () => {
    const { t, asUser, request } = await setup()

    await expect(asUser.mutation(api.audioOverviewJobs.request, {
      ...request,
      capability: 'c'.repeat(43),
    })).rejects.toThrow(/invalid job capability/i)

    expect(await t.run(ctx => ctx.db.query('audioOverviewJobs').collect())).toEqual([])
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(0)
  })

  test('[P0] a rejected reservation creates no job, task, or quota charge', async () => {
    const { t, asUser, request } = await setup()

    await expect(asUser.mutation(api.audioOverviewJobs.request, {
      ...request,
      scope: { mode: 'explicit', documentIds: [] },
      idempotencyKey: 'audio_job_request_0002',
      capability: await deriveCapability('audio_job_request_0002'),
    })).rejects.toThrow(/at least one source/i)

    const rows = await t.run(async (ctx) => ({
      jobs: await ctx.db.query('audioOverviewJobs').collect(),
      tasks: await ctx.db.query('tasks').collect(),
    }))
    expect(rows.jobs).toEqual([])
    expect(rows.tasks).toEqual([])
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(0)
  })

  test('[P0] rejects a ready source without an authoritative hash and revision before reserving quota', async () => {
    const { t, asUser, documentId, request } = await setup()
    await t.run(ctx => ctx.db.patch(documentId, {
      contentHash: undefined,
      sourceRevision: undefined,
    }))

    await expect(asUser.mutation(api.audioOverviewJobs.request, request))
      .rejects.toThrow(/immutable revision/i)

    expect(await t.run(ctx => ctx.db.query('audioOverviewJobs').collect())).toEqual([])
    expect(await t.run(ctx => ctx.db.query('tasks').collect())).toEqual([])
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(0)
  })

  test('[P0] rejects a source whose revision does not identify its frozen content hash', async () => {
    const { t, asUser, documentId, request } = await setup()
    await t.run(ctx => ctx.db.patch(documentId, {
      sourceRevision: `sha256:${'b'.repeat(64)}`,
    }))

    await expect(asUser.mutation(api.audioOverviewJobs.request, request))
      .rejects.toThrow(/immutable revision/i)
  })
})

describe('audioOverviewJobs durable publication', () => {
  test('[P0] bounds and debits replacement Dialogue attempts after definitive invalid output', async () => {
    const { t, asUser, request, capability } = await setup()
    const { jobId } = await asUser.mutation(api.audioOverviewJobs.request, request)

    const first = await asUser.mutation(api.audioOverviewJobs.beginScriptGeneration, { jobId, capability })
    expect(first).toMatchObject({ proceed: true, attempt: 1 })
    if (!first.proceed) throw new Error('Expected first Dialogue attempt')
    await asUser.mutation(api.audioOverviewJobs.releaseScriptGeneration, {
      jobId,
      capability,
      attemptId: first.attemptId,
    })

    const second = await asUser.mutation(api.audioOverviewJobs.beginScriptGeneration, { jobId, capability })
    expect(second).toMatchObject({ proceed: true, attempt: 2 })
    if (!second.proceed) throw new Error('Expected second Dialogue attempt')
    await asUser.mutation(api.audioOverviewJobs.releaseScriptGeneration, {
      jobId,
      capability,
      attemptId: second.attemptId,
    })

    const third = await asUser.mutation(api.audioOverviewJobs.beginScriptGeneration, { jobId, capability })
    expect(third).toMatchObject({ proceed: true, attempt: 3 })
    if (!third.proceed) throw new Error('Expected third Dialogue attempt')
    await asUser.mutation(api.audioOverviewJobs.releaseScriptGeneration, {
      jobId,
      capability,
      attemptId: third.attemptId,
    })

    await expect(asUser.mutation(api.audioOverviewJobs.beginScriptGeneration, { jobId, capability }))
      .rejects.toThrow(/retry limit/i)

    const state = await t.run(ctx => ctx.db.get(jobId))
    expect(state).toMatchObject({
      scriptAttemptsStarted: 3,
      budgetDebitedMicrousd: 99_000,
      budgetDebitKeys: ['script', 'script:2', 'script:3'],
    })
  })

  test('[P0] debits the exact-evidence fallback verification once', async () => {
    const { t, asUser, request, capability } = await setup()
    const { jobId } = await asUser.mutation(api.audioOverviewJobs.request, request)

    const first = await asUser.mutation(api.audioOverviewJobs.claimProviderBudget, {
      jobId,
      capability,
      kind: 'entailment-fallback',
    })
    const duplicate = await asUser.mutation(api.audioOverviewJobs.claimProviderBudget, {
      jobId,
      capability,
      kind: 'entailment-fallback',
    })

    expect(first).toMatchObject({
      allowed: true,
      duplicate: false,
      amountMicrousd: 8_000,
      debitedMicrousd: 41_000,
      reservedMicrousd: 187_100,
    })
    expect(duplicate).toMatchObject({ allowed: true, duplicate: true, debitedMicrousd: 41_000 })
    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({
      budgetDebitKeys: ['script', 'entailment-fallback'],
      budgetDebitedMicrousd: 41_000,
    })
  })

  test('[P0] provider budget claims are idempotent and stop retries before overspend', async () => {
    const { t, asUser, request, capability, documentId } = await setup()
    const { jobId } = await asUser.mutation(api.audioOverviewJobs.request, request)
    const hash = 'a'.repeat(64)
    await t.mutation(api.audioOverviewV2.createPlan, {
      jobId,
      capability,
      planFingerprint: hash,
      title: 'Budget bounded overview',
      model: 'gemini-2.5-flash',
      audioProfile: {
        id: 'budds-two-host-gemini-v1',
        version: '1',
        renderer: 'gemini-native-multi-speaker',
        hostAVoice: 'Kore',
        hostBVoice: 'Puck',
      },
      manifest: {
        revision: `sha256:${hash}`,
        contentHash: hash,
        entries: [{
          sourceId: 'source-1',
          documentId,
          revision: `sha256:${hash}`,
          contentHash: hash,
          displayReference: 'Source',
          objectKey: 'audio-job-owner/grounded-source.txt',
        }],
      },
      outline: {
        narrativeArc: 'Explain one bounded idea.',
        learningObjectives: ['Understand the budget.'],
        plannedSourceIds: ['source-1'],
      },
      claims: [{
        claimId: 'claim-1',
        text: 'The budget is bounded.',
        status: 'supported',
        sourceEntryOrders: [0],
        verification: {
          version: 'claim-entailment.v1',
          model: 'google/gemini-2.5-flash',
          decision: 'entailed',
          reason: 'The evidence directly states the claim.',
        },
      }],
      scenes: [{
        sceneId: 'budget',
        title: 'Budget',
        narrativePurpose: 'Explain the bound.',
        targetDurationMs: 5 * 60_000,
        utterances: [
          {
            speaker: 'host_a', text: 'The budget is bounded.', emotionalIntent: 'clear', deliveryIntent: 'measured', sourceEntryOrders: [0], claimIds: ['claim-1'],
            verification: { version: 'claim-entailment.v1', utteranceId: 'scene:0:budget:utterance:0', model: 'google/gemini-2.5-flash', decision: 'entailed', reason: 'Exact text is supported.' },
          },
          {
            speaker: 'host_b', text: 'That prevents overspend.', emotionalIntent: 'assured', deliveryIntent: 'warm', sourceEntryOrders: [0], claimIds: ['claim-1'],
            verification: { version: 'claim-entailment.v1', utteranceId: 'scene:0:budget:utterance:1', model: 'google/gemini-2.5-flash', decision: 'entailed', reason: 'Exact text is supported.' },
          },
        ],
      }],
    })

    const first = await asUser.mutation(api.audioOverviewJobs.claimProviderBudget, {
      jobId,
      capability,
      kind: 'scene',
      sceneOrder: 0,
      attempt: 1,
    })
    expect(first).toMatchObject({
      allowed: true,
      duplicate: false,
      amountMicrousd: 77_550,
      debitedMicrousd: 110_550,
      reservedMicrousd: 187_100,
    })
    await expect(asUser.mutation(api.audioOverviewJobs.claimProviderBudget, {
      jobId,
      capability,
      kind: 'scene',
      sceneOrder: 0,
      attempt: 1,
    })).resolves.toMatchObject({ duplicate: true, debitedMicrousd: 110_550 })
    await expect(asUser.mutation(api.audioOverviewJobs.claimProviderBudget, {
      jobId,
      capability,
      kind: 'scene',
      sceneOrder: 0,
      attempt: 2,
    })).rejects.toThrow(/budget exhausted/i)
  })

})

describe('audioOverviewJobs terminal-state protection', () => {
  test('[P0] cancellation propagates to the job and late workflow steps cannot revive it', async () => {
    vi.useFakeTimers()
    const { t, asUser, request, capability } = await setup()
    const { jobId, taskId } = await asUser.mutation(api.audioOverviewJobs.request, request)

    expect(await asUser.mutation(api.audioOverviewJobs.setProgress, {
      jobId,
      capability,
      progress: 'Retrieving sources…',
      stage: 'preparing',
    })).toEqual({ active: true })

    await asUser.mutation(api.tasks.cancel, { taskId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(await asUser.mutation(api.audioOverviewJobs.setProgress, {
      jobId,
      capability,
      progress: 'Late progress',
      stage: 'synthesizing',
    })).toEqual({ active: false })
    await expect(asUser.mutation(api.audioOverviewJobs.commitScript, {
      jobId,
      capability,
      title: 'Late script',
      model: 'google/gemini-2.5-flash',
      ttsEngine: 'aura-1',
      sourceDocumentIds: [],
      turns: [{ speaker: 'host_a', text: 'This must not be persisted.' }],
    })).rejects.toThrow(/Legacy Audio Overview generation is disabled/i)
    await expect(asUser.mutation(api.audioOverviewJobs.finalize, {
      jobId,
      capability,
    })).rejects.toThrow(/Legacy Audio Overview generation is disabled/i)
    expect(await asUser.mutation(api.audioOverviewJobs.fail, {
      jobId,
      capability,
      error: 'Late failure',
    })).toEqual({ changed: false })

    const state = await t.run(async (ctx) => ({
      job: await ctx.db.get(jobId),
      task: await ctx.db.get(taskId),
      turns: await ctx.db.query('audioOverviewJobTurns').collect(),
      overviews: await ctx.db.query('audioOverviews').collect(),
    }))
    expect(state.job?.status).toBe('cancelled')
    expect(state.task?.status).toBe('cancelled')
    expect(state.task?.progress).toBe('Retrieving sources…')
    expect(state.turns).toEqual([])
    expect(state.overviews).toEqual([])
  })

  test('[P0] a caller without the job capability cannot mutate progress', async () => {
    const { t, asUser, request } = await setup()
    const { jobId, taskId } = await asUser.mutation(api.audioOverviewJobs.request, request)

    await expect(asUser.mutation(api.audioOverviewJobs.setProgress, {
      jobId,
      capability: 'wrong-capability',
      progress: 'Forged progress',
      stage: 'preparing',
    })).rejects.toThrow(/job not found/i)

    const state = await t.run(async ctx => ({
      job: await ctx.db.get(jobId),
      task: await ctx.db.get(taskId),
    }))
    expect(state.job?.status).toBe('accepted')
    expect(state.task?.status).toBe('pending')
    expect(state.task?.progress).toBe('Preparing…')
  })
})

describe('audioOverviewJobs retention', () => {
  test('[P1] removes terminal operational records after the idempotency window', async () => {
    const { t, asUser, request } = await setup()
    const { jobId, taskId } = await asUser.mutation(api.audioOverviewJobs.request, request)
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: 'failed', stage: 'failed', updatedAt: old, completedAt: old })
      await ctx.db.patch(taskId, { status: 'failed', updatedAt: old, completedAt: old })
    })

    await expect(t.mutation(internal.audioOverviewJobs.cleanupTerminalJobs, {}))
      .resolves.toEqual({ deleted: 1 })
    await expect(t.run(ctx => ctx.db.get(jobId))).resolves.toBeNull()
    await expect(t.run(ctx => ctx.db.get(taskId))).resolves.toBeNull()
  })

  test('[P1] drains child turns before deleting terminal job and task records', async () => {
    vi.useFakeTimers()
    const { t, asUser, request } = await setup()
    const { jobId, taskId } = await asUser.mutation(api.audioOverviewJobs.request, request)
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: 'failed', stage: 'failed', updatedAt: old, completedAt: old })
      await ctx.db.patch(taskId, { status: 'failed', updatedAt: old, completedAt: old })
      for (let order = 0; order < 51; order++) {
        await ctx.db.insert('audioOverviewJobTurns', {
          jobId,
          taskId,
          userId: USER.tokenIdentifier,
          order,
          speaker: order % 2 === 0 ? 'host_a' : 'host_b',
          text: `Legacy utterance ${order}`,
          status: 'pending',
          updatedAt: old,
        })
      }
    })

    await expect(t.mutation(internal.audioOverviewJobs.cleanupTerminalJobs, {}))
      .resolves.toEqual({ deleted: 0 })

    const firstPass = await t.run(async ctx => ({
      job: await ctx.db.get(jobId),
      task: await ctx.db.get(taskId),
      turns: await ctx.db
        .query('audioOverviewJobTurns')
        .withIndex('by_jobId_and_order', q => q.eq('jobId', jobId))
        .collect(),
    }))
    expect(firstPass.job).not.toBeNull()
    expect(firstPass.task).not.toBeNull()
    expect(firstPass.turns).toHaveLength(1)
    expect(await scheduledNames(t)).toContain('audioOverviewJobs:cleanupTerminalJobs')

    await t.finishAllScheduledFunctions(vi.runAllTimers)
    await expect(t.run(ctx => ctx.db.get(jobId))).resolves.toBeNull()
    await expect(t.run(ctx => ctx.db.get(taskId))).resolves.toBeNull()
    await expect(t.run(ctx => ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', jobId))
      .collect())).resolves.toEqual([])
  })
})

describe('audioOverviewJobs staged-media cleanup', () => {
  test('[P1] schedules continuation when more than one turn batch remains', async () => {
    vi.useFakeTimers()
    const { t, asUser, request } = await setup()
    const { jobId, taskId } = await asUser.mutation(api.audioOverviewJobs.request, request)
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: 'failed', stage: 'failed' })
      await ctx.db.patch(taskId, { status: 'failed' })
      for (let order = 0; order < 51; order++) {
        await ctx.db.insert('audioOverviewJobTurns', {
          jobId,
          taskId,
          userId: USER.tokenIdentifier,
          order,
          speaker: order % 2 === 0 ? 'host_a' : 'host_b',
          text: `Staged utterance ${order}`,
          status: 'pending',
          updatedAt: Date.now(),
        })
      }
    })

    await t.mutation(internal.audioOverviewJobs.cleanupStagedMedia, { jobId })
    await expect(t.run(ctx => ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', jobId))
      .collect())).resolves.toHaveLength(1)
    expect(await scheduledNames(t)).toContain('audioOverviewJobs:cleanupStagedMedia')

    await t.finishAllScheduledFunctions(vi.runAllTimers)
    await expect(t.run(ctx => ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', jobId))
      .collect())).resolves.toEqual([])
  })

  test('[P1] immediate overflow cleanup preserves a late upload claim until its reconciliation deadline', async () => {
    vi.useFakeTimers()
    const { t, asUser, request } = await setup()
    const { jobId, taskId } = await asUser.mutation(api.audioOverviewJobs.request, request)
    const begunAt = Date.now()
    const late = await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: 'failed', stage: 'failed' })
      await ctx.db.patch(taskId, { status: 'failed' })
      const turnIds = []
      for (let order = 0; order < 51; order++) {
        turnIds.push(await ctx.db.insert('audioOverviewJobTurns', {
          jobId,
          taskId,
          userId: USER.tokenIdentifier,
          order,
          speaker: order % 2 === 0 ? 'host_a' : 'host_b',
          text: `Late upload utterance ${order}`,
          status: 'pending',
          updatedAt: begunAt,
        }))
      }
      const claimId = await ctx.db.insert('audioOverviewUploadClaims', {
        userId: USER.tokenIdentifier,
        taskId,
        nonce: 'late-upload-claim',
        expectedSha256: 'd'.repeat(64),
        expectedSize: 48_000,
        begunAt,
        uploadAttempts: 1,
        jobTurnId: turnIds[0],
        expiresAt: begunAt + 60_000,
      })
      await ctx.db.patch(turnIds[0]!, { uploadClaimId: claimId })
      return { claimId, turnId: turnIds[0]! }
    })

    await t.mutation(internal.audioOverviewJobs.cleanupStagedMedia, { jobId })
    vi.advanceTimersByTime(0)
    await t.finishInProgressScheduledFunctions()

    const state = await t.run(async ctx => ({
      claim: await ctx.db.get(late.claimId),
      turn: await ctx.db.get(late.turnId),
      turns: await ctx.db
        .query('audioOverviewJobTurns')
        .withIndex('by_jobId_and_order', q => q.eq('jobId', jobId))
        .collect(),
    }))
    expect(state.claim?.expiresAt).toBe(begunAt + 24 * 60 * 60 * 1000)
    expect(state.turn).not.toBeNull()
    expect(state.turns).toHaveLength(1)
  })

  test('[P1] schedules continuation when more than one artifact batch remains', async () => {
    vi.useFakeTimers()
    const { t, asUser, request, folderId } = await setup()
    const { jobId, taskId } = await asUser.mutation(api.audioOverviewJobs.request, request)
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: 'failed', stage: 'failed' })
      await ctx.db.patch(taskId, { status: 'failed' })
      const createdAt = Date.now()
      const sourceManifestId = await ctx.db.insert('audioOverviewSourceManifests', {
        jobId,
        taskId,
        userId: USER.tokenIdentifier,
        folderId,
        schemaVersion: 2,
        revision: `sha256:${'a'.repeat(64)}`,
        contentHash: 'a'.repeat(64),
        planFingerprint: 'b'.repeat(64),
        entryCount: 0,
        frozenAt: createdAt,
      })
      const outlineId = await ctx.db.insert('audioOverviewOutlines', {
        jobId,
        taskId,
        userId: USER.tokenIdentifier,
        narrativeArc: 'Cleanup overflow fixture',
        learningObjectiveCount: 0,
        createdAt,
      })
      const claimLedgerId = await ctx.db.insert('audioOverviewClaimLedgers', {
        jobId,
        taskId,
        userId: USER.tokenIdentifier,
        claimCount: 0,
        supportedClaimCount: 0,
        createdAt,
      })
      const episodeId = await ctx.db.insert('audioOverviewEpisodes', {
        jobId,
        taskId,
        userId: USER.tokenIdentifier,
        folderId,
        sourceManifestId,
        outlineId,
        claimLedgerId,
        schemaVersion: 2,
        title: 'Cleanup overflow fixture',
        model: 'test',
        audioProfileId: 'test',
        audioProfileVersion: '1',
        renderer: 'test',
        hostAVoice: 'Host A',
        hostBVoice: 'Host B',
        requestedLengthMinutes: 5,
        complexity: 'beginner',
        status: 'failed',
        sceneCount: 0,
        utteranceCount: 0,
        createdAt,
        updatedAt: createdAt,
      })
      for (let order = 0; order < 501; order++) {
        await ctx.db.insert('audioOverviewAudioArtifacts', {
          episodeId,
          jobId,
          userId: USER.tokenIdentifier,
          kind: 'scene',
          status: 'staged',
          storageProvider: 'r2',
          objectKey: `audio-overviews/jobs/${jobId}/scenes/${String(order).padStart(3, '0')}.pcm`,
          checksumSha256: 'c'.repeat(64),
          byteLength: 48_000,
          contentType: 'audio/L16;codec=pcm;rate=24000',
          container: 'pcm',
          sampleRateHz: 24000,
          channelCount: 1,
          bitsPerSample: 16,
          durationMs: 1_000,
          createdAt,
        })
      }
    })

    await expect(t.mutation(internal.audioOverviewJobs.cleanupStagedMedia, { jobId }))
      .resolves.toMatchObject({ r2Enqueued: 500 })
    const artifacts = await t.run(ctx => ctx.db
      .query('audioOverviewAudioArtifacts')
      .withIndex('by_jobId_and_objectKey', q => q.eq('jobId', jobId))
      .collect())
    expect(artifacts.filter(artifact => artifact.status === 'deleting')).toHaveLength(500)
    expect(artifacts.filter(artifact => artifact.status === 'staged')).toHaveLength(1)
    expect(await scheduledNames(t)).toContain('audioOverviewJobs:cleanupStagedMedia')
  })
})

describe('audioOverviewJobs stale reconciliation', () => {
  test.each(['accepted', 'running'] as const)(
    '[P1] schedules continuation when the %s batch reaches its bound',
    async (status) => {
      vi.useFakeTimers()
      const { t, folderId } = await setup()
      const old = Date.now() - 3 * 60 * 60 * 1000
      await t.run(async (ctx) => {
        for (let index = 0; index < 26; index++) {
          const taskId = await ctx.db.insert('tasks', {
            userId: USER.tokenIdentifier,
            folderId,
            type: 'audio-overview-generation',
            status: status === 'accepted' ? 'pending' : 'running',
            title: `Stale ${status} task ${index}`,
            createdAt: old,
            updatedAt: old,
          })
          await ctx.db.insert('audioOverviewJobs', {
            userId: USER.tokenIdentifier,
            taskId,
            folderId,
            idempotencyKey: `stale_${status}_${String(index).padStart(16, '0')}`,
            capabilityHash: `stale-capability-${index}`,
            status,
            stage: status === 'accepted' ? 'accepted' : 'preparing',
            completedTurns: 0,
            createdAt: old,
            updatedAt: old,
          })
        }
      })

      await expect(t.mutation(internal.audioOverviewJobs.reconcileStale, {}))
        .resolves.toEqual({ failed: 25 })
      await expect(t.run(ctx => ctx.db
        .query('audioOverviewJobs')
        .withIndex('by_status_and_updatedAt', q => q.eq('status', status).lt('updatedAt', Date.now()))
        .collect())).resolves.toHaveLength(1)
      expect(await scheduledNames(t)).toContain('audioOverviewJobs:reconcileStale')

      await t.finishAllScheduledFunctions(vi.runAllTimers)
      await expect(t.run(ctx => ctx.db
        .query('audioOverviewJobs')
        .withIndex('by_status_and_updatedAt', q => q.eq('status', status).lt('updatedAt', Date.now()))
        .collect())).resolves.toEqual([])
    },
  )
})
