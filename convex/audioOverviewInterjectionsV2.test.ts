/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { interjectionUtteranceVerificationId } from '../shared/audio-overview-grounding'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|v2-interjection-owner', name: 'Owner' }
const STRANGER = { tokenIdentifier: 'https://auth.example.com|v2-interjection-stranger', name: 'Stranger' }
const HASH = 'a'.repeat(64)
const ORCHESTRATION_TOKEN = 'test-audio-overview-orchestration-token-0001'
process.env.AUDIO_OVERVIEW_WORKER_TOKEN = ORCHESTRATION_TOKEN

function groundedUtterance(
  speaker: 'host_a' | 'host_b',
  text: string,
  sourceId: string,
  claimId: string,
  interjectionId: string,
  utteranceOrder: number,
) {
  return {
    speaker,
    text,
    sourceIds: [sourceId],
    claimId,
    claimText: text,
    evidenceQuotes: [{ sourceId, quote: `Evidence for ${claimId}.` }],
    verification: {
      version: 'claim-entailment.v1' as const,
      utteranceId: interjectionUtteranceVerificationId(interjectionId, utteranceOrder),
      model: 'google/gemini-2.5-flash',
      decision: 'entailed' as const,
      reason: 'The evidence directly states the claim.',
    },
  }
}

async function readyV2Overview() {
  const t = convexTest(schema, modules)
  const seeded = await t.run(async (ctx) => {
    await ctx.db.insert('users', {
      tokenIdentifier: OWNER.tokenIdentifier,
      name: OWNER.name,
    })
    const folderId = await ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Physics', documentCount: 2 })
    const firstDocumentId = await ctx.db.insert('documents', {
      userId: OWNER.tokenIdentifier,
      folderId,
      filename: 'gravity.pdf',
      status: 'success',
      fileSize: 100,
      r2Key: 'owner/physics/gravity.pdf',
      contentHash: HASH,
      sourceRevision: 'gravity-r1',
    })
    const secondDocumentId = await ctx.db.insert('documents', {
      userId: OWNER.tokenIdentifier,
      folderId,
      filename: 'orbits.pdf',
      status: 'success',
      fileSize: 100,
      r2Key: 'owner/physics/orbits.pdf',
      contentHash: 'b'.repeat(64),
      sourceRevision: 'orbits-r1',
    })
    const taskId = await ctx.db.insert('tasks', {
      userId: OWNER.tokenIdentifier,
      folderId,
      type: 'audio-overview-generation',
      status: 'completed',
      title: 'Ready overview',
      createdAt: 1,
      updatedAt: 1,
    })
    const jobId = await ctx.db.insert('audioOverviewJobs', {
      userId: OWNER.tokenIdentifier,
      taskId,
      folderId,
      idempotencyKey: 'ready-v2-job',
      capabilityHash: 'capability-hash',
      status: 'completed',
      stage: 'complete',
      completedTurns: 2,
      createdAt: 1,
      updatedAt: 1,
    })
    const manifestId = await ctx.db.insert('audioOverviewSourceManifests', {
      jobId,
      taskId,
      userId: OWNER.tokenIdentifier,
      folderId,
      schemaVersion: 2,
      revision: 'manifest-r1',
      contentHash: HASH,
      planFingerprint: HASH,
      entryCount: 2,
      frozenAt: 1,
    })
    const firstEntryId = await ctx.db.insert('audioOverviewSourceManifestEntries', {
      manifestId,
      jobId,
      userId: OWNER.tokenIdentifier,
      order: 0,
      sourceId: 'gravity-source',
      documentId: firstDocumentId,
      revision: 'gravity-r1',
      contentHash: HASH,
      displayReference: 'Gravity',
      objectKey: 'owner/physics/gravity.pdf',
      createdAt: 1,
    })
    await ctx.db.insert('audioOverviewSourceManifestEntries', {
      manifestId,
      jobId,
      userId: OWNER.tokenIdentifier,
      order: 1,
      sourceId: 'orbits-source',
      documentId: secondDocumentId,
      revision: 'orbits-r1',
      contentHash: 'b'.repeat(64),
      displayReference: 'Orbits',
      objectKey: 'owner/physics/orbits.pdf',
      createdAt: 1,
    })
    const outlineId = await ctx.db.insert('audioOverviewOutlines', {
      jobId,
      taskId,
      userId: OWNER.tokenIdentifier,
      narrativeArc: 'Gravity to orbits',
      learningObjectiveCount: 1,
      createdAt: 1,
    })
    const claimLedgerId = await ctx.db.insert('audioOverviewClaimLedgers', {
      jobId,
      taskId,
      userId: OWNER.tokenIdentifier,
      claimCount: 1,
      supportedClaimCount: 1,
      createdAt: 1,
    })
    const episodeId = await ctx.db.insert('audioOverviewEpisodes', {
      jobId,
      taskId,
      userId: OWNER.tokenIdentifier,
      folderId,
      sourceManifestId: manifestId,
      outlineId,
      claimLedgerId,
      schemaVersion: 2,
      title: 'Gravity, explained',
      model: 'gemini-2.5-flash',
      audioProfileId: 'budds-two-host-gemini-v1',
      audioProfileVersion: '1',
      renderer: 'gemini-native-multi-speaker',
      hostAVoice: 'Kore',
      hostBVoice: 'Puck',
      requestedLengthMinutes: 5,
      complexity: 'beginner',
      status: 'ready',
      sceneCount: 1,
      utteranceCount: 2,
      totalDurationMs: 60_000,
      createdAt: 1,
      updatedAt: 1,
      publishedAt: 1,
    })
    const finalArtifactId = await ctx.db.insert('audioOverviewAudioArtifacts', {
      episodeId,
      jobId,
      userId: OWNER.tokenIdentifier,
      kind: 'final',
      status: 'published',
      storageProvider: 'r2',
      objectKey: `audio-overviews/jobs/${jobId}/overview.wav`,
      checksumSha256: HASH,
      byteLength: 48_044,
      contentType: 'audio/wav',
      container: 'wav',
      sampleRateHz: 24000,
      channelCount: 1,
      bitsPerSample: 16,
      durationMs: 1_000,
      createdAt: 1,
      publishedAt: 1,
    })
    const overviewId = await ctx.db.insert('audioOverviews', {
      userId: OWNER.tokenIdentifier,
      folderId,
      taskId,
      episodeId,
      finalArtifactId,
      title: 'Gravity, explained',
      status: 'ready',
      turns: [],
      voiceProfile: { hostA: 'Kore', hostB: 'Puck' },
      totalDurationMs: 1_000,
      scopeDocIds: [firstDocumentId, secondDocumentId],
    })
    await ctx.db.patch(episodeId, { finalArtifactId, compatibilityOverviewId: overviewId })
    return { overviewId, episodeId, manifestId, firstEntryId, firstDocumentId, secondDocumentId, jobId }
  })
  return { t, owner: t.withIdentity(OWNER), stranger: t.withIdentity(STRANGER), ...seeded }
}

describe('v2 Audio Overview Interjections', () => {
  test('[P0] owner cannot forge server orchestration lifecycle transitions', async () => {
    const { t, owner, overviewId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-authority-0001',
      insertedAfterTurnIndex: 0,
      question: 'Can a browser claim this work?',
    })

    // @ts-expect-error This deliberately exercises the public validator without the server credential.
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
    })).rejects.toThrow(/orchestrationToken|orchestration credential/i)
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: 'wrong-orchestration-token',
    })).rejects.toThrow(/orchestration credential/i)
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: 'wrong-orchestration-token',
      utterances: [],
    })).rejects.toThrow(/orchestration credential/i)
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: 'wrong-orchestration-token',
    })).rejects.toThrow(/orchestration credential/i)
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.publish, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: 'wrong-orchestration-token',
      artifact: {
        objectKey: 'forged.wav',
        checksumSha256: HASH,
        byteLength: 48_044,
        contentType: 'audio/wav',
        durationMs: 1_000,
      },
    })).rejects.toThrow(/orchestration credential/i)
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.fail, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: 'wrong-orchestration-token',
      error: 'forged terminal state',
    })).rejects.toThrow(/orchestration credential/i)

    const persisted = await t.run(ctx => ctx.db.get(reserved.interjectionId))
    expect(persisted?.status).toBe('reserved')
    expect(persisted && 'scriptingClaimedAt' in persisted).toBe(false)
  })

  test('[P0] reserves idempotently from only the immutable Source Manifest for the owner', async () => {
    const { t, owner, stranger, overviewId, manifestId, firstDocumentId, secondDocumentId } = await readyV2Overview()
    const args = {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-request-0001',
      insertedAfterTurnIndex: 1,
      question: 'Why does gravity affect an orbit?',
    }

    await expect(stranger.mutation(api.audioOverviewInterjectionsV2.reserve, args)).rejects.toThrow(/not found/)
    const first = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, args)
    const duplicate = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, args)

    expect(first).toMatchObject({ duplicate: false, sourceManifestId: manifestId, hostAVoice: 'Kore', hostBVoice: 'Puck' })
    expect(first.sources.map(source => source.documentId)).toEqual([firstDocumentId, secondDocumentId])
    expect(duplicate).toMatchObject({ duplicate: true, interjectionId: first.interjectionId })
    expect(first).toMatchObject({ budget: { reservedMicrousd: 40_000 } })
    const reservationEvidence = await t.run(async (ctx) => {
      const interjection = await ctx.db.get(first.interjectionId)
      const user = await ctx.db
        .query('users')
        .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier))
        .unique()
      return { interjection, user }
    })
    expect(reservationEvidence.interjection).toMatchObject({ budgetReservedMicrousd: 40_000 })
    expect(reservationEvidence.interjection?.quotaDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(reservationEvidence.user?.audioOverviewInterjectionQuota).toMatchObject({ count: 1 })
  })

  test('[P0] checks idempotency before quota so a retry never consumes a second reservation', async () => {
    const { t, owner, overviewId } = await readyV2Overview()
    const args = {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-retry-budget-0001',
      insertedAfterTurnIndex: 1,
      question: 'Explain the balance one more time.',
    }
    const first = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, args)
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier))
        .unique()
      if (!user) throw new Error('Missing fixture user')
      await ctx.db.patch(user._id, {
        audioOverviewInterjectionQuota: { date: new Date().toISOString().slice(0, 10), count: 10 },
      })
    })

    const duplicate = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, args)
    const evidence = await t.run(async (ctx) => ({
      rows: await ctx.db.query('audioOverviewInterjectionsV2').collect(),
      user: await ctx.db
        .query('users')
        .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier))
        .unique(),
    }))
    expect(duplicate).toMatchObject({ duplicate: true, interjectionId: first.interjectionId, budget: { reservedMicrousd: 40_000 } })
    expect(evidence.rows).toHaveLength(1)
    expect(evidence.user?.audioOverviewInterjectionQuota).toMatchObject({ count: 10 })
  })

  test('[P0] rejects a new interjection after the user daily cap of ten', async () => {
    const { owner, overviewId } = await readyV2Overview()
    for (let index = 0; index < 10; index++) {
      await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
        audioOverviewId: overviewId,
        idempotencyKey: `interjection-daily-${String(index).padStart(4, '0')}`,
        insertedAfterTurnIndex: 1,
        question: `Question ${index}?`,
      })
    }
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-daily-over-cap',
      insertedAfterTurnIndex: 1,
      question: 'One more question?',
    })).rejects.toThrow(/daily Interjection limit/)
  })

  test('[P0] rejects a new interjection after twenty reservations for an episode', async () => {
    const { t, owner, overviewId, episodeId, manifestId, jobId } = await readyV2Overview()
    await t.run(async (ctx) => {
      for (let index = 0; index < 20; index++) {
        await ctx.db.insert('audioOverviewInterjectionsV2', {
          audioOverviewId: overviewId,
          episodeId,
          sourceManifestId: manifestId,
          jobId,
          userId: OWNER.tokenIdentifier,
          idempotencyKey: `seeded-interjection-${String(index).padStart(4, '0')}`,
          insertedAfterTurnIndex: 1,
          question: `Seeded question ${index}`,
          model: 'gemini-2.5-flash',
          audioProfileId: 'budds-two-host-gemini-v1',
          audioProfileVersion: '1',
          renderer: 'gemini-native-multi-speaker',
          hostAVoice: 'Kore',
          hostBVoice: 'Puck',
          status: 'reserved',
          utteranceCount: 0,
          createdAt: index + 1,
          updatedAt: index + 1,
        })
      }
    })
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-episode-over-cap',
      insertedAfterTurnIndex: 1,
      question: 'One too many?',
    })).rejects.toThrow(/Interjection limit/)
  })

  test('[P0] rejects Dialogue Script source links outside the frozen manifest', async () => {
    const { owner, overviewId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-request-0002',
      insertedAfterTurnIndex: 0,
      question: 'What keeps an orbit stable?',
    })
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })).resolves.toEqual({ claimed: true, status: 'scripting' })
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })).resolves.toEqual({ claimed: false, status: 'scripting' })

    await expect(owner.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      utterances: [
        groundedUtterance('host_a', 'Gravity curves the path.', 'not-in-manifest', 'gravity-claim', String(reserved.interjectionId), 0),
        groundedUtterance('host_b', 'So motion and attraction interact.', 'gravity-source', 'motion-claim', String(reserved.interjectionId), 1),
      ],
    })).rejects.toThrow(/frozen Source Manifest/)
  })

  test('[P0] refuses to render a spoken Interjection Utterance without verified claim evidence', async () => {
    const { owner, overviewId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-grounding-0001',
      insertedAfterTurnIndex: 0,
      question: 'What keeps an orbit stable?',
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })

    await expect(owner.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      utterances: [
        { speaker: 'host_a', text: 'An unsupported assertion.', sourceIds: ['gravity-source'] },
        groundedUtterance('host_b', 'A supported response.', 'orbits-source', 'orbit-claim', String(reserved.interjectionId), 1),
      ],
    })).rejects.toThrow(/verified claim evidence/i)

    const forged = groundedUtterance(
      'host_a',
      'A supported assertion.',
      'gravity-source',
      'supported-claim',
      String(reserved.interjectionId),
      0,
    )
    forged.verification.utteranceId = interjectionUtteranceVerificationId(String(reserved.interjectionId), 99)
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      utterances: [
        forged,
        groundedUtterance('host_b', 'A supported response.', 'orbits-source', 'orbit-claim', String(reserved.interjectionId), 1),
      ],
    })).rejects.toThrow(/exact semantic entailment verification/i)
  })

  test('[P0] elects exactly one paid render attempt and expires a stale attempt into deterministic R2 cleanup', async () => {
    const { t, owner, overviewId, jobId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-render-claim-0001',
      insertedAfterTurnIndex: 0,
      question: 'How does this stay bounded?',
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      utterances: [
        groundedUtterance('host_a', 'The first caller owns rendering.', 'gravity-source', 'render-owner', String(reserved.interjectionId), 0),
        groundedUtterance('host_b', 'Retries fail closed.', 'orbits-source', 'retry-claim', String(reserved.interjectionId), 1),
      ],
    })
    const firstClaim = await owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })).resolves.toMatchObject({ claimed: false, status: 'rendering' })
    if (firstClaim.claimedAt === undefined) throw new Error('Missing render claim evidence')

    await t.mutation(internal.audioOverviewInterjectionsV2.expireStaleAttempt, {
      interjectionId: reserved.interjectionId,
      phase: 'rendering',
      claimedAt: firstClaim.claimedAt,
    })
    const evidence = await t.run(async (ctx) => ({
      interjection: await ctx.db.get(reserved.interjectionId),
      cleanup: await ctx.db
        .query('pendingCleanup')
        .withIndex('by_r2Key', q => q.eq('r2Key', `audio-overviews/jobs/${jobId}/interjections/${reserved.interjectionId}.wav`))
        .unique(),
    }))
    expect(evidence.interjection).toMatchObject({ status: 'failed', renderAttemptedAt: firstClaim.claimedAt })
    expect(evidence.cleanup).toMatchObject({ kind: 'r2', attempts: 0 })
  })

  test('[P0] terminal-fails a crash after script claim before render state is persisted', async () => {
    const { t, owner, overviewId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-stale-script-0001',
      insertedAfterTurnIndex: 0,
      question: 'What if the scripting request crashes?',
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })
    const claimedAt = await t.run(async (ctx) => (await ctx.db.get(reserved.interjectionId))?.scriptingClaimedAt)
    if (claimedAt === undefined) throw new Error('Missing scripting claim evidence')

    await t.mutation(internal.audioOverviewInterjectionsV2.expireStaleAttempt, {
      interjectionId: reserved.interjectionId,
      phase: 'scripting',
      claimedAt,
    })

    await expect(owner.query(api.audioOverviewInterjectionsV2.getForOwner, {
      interjectionId: reserved.interjectionId,
    })).resolves.toMatchObject({ status: 'failed', error: 'Interjection scripting attempt expired' })
  })

  test('[P0] cancellation after a paid render claim durably queues the deterministic artifact key', async () => {
    const { t, owner, overviewId, jobId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-cancel-render-0001',
      insertedAfterTurnIndex: 0,
      question: 'Cancel this render safely.',
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      utterances: [
        groundedUtterance('host_a', 'The render may already have written.', 'gravity-source', 'render-state', String(reserved.interjectionId), 0),
        groundedUtterance('host_b', 'The deterministic key must be cleaned.', 'orbits-source', 'cleanup-state', String(reserved.interjectionId), 1),
      ],
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })

    await expect(owner.mutation(api.audioOverviewInterjectionsV2.cancelOrDelete, {
      interjectionId: reserved.interjectionId,
    })).resolves.toMatchObject({ status: 'deleting' })
    const objectKey = `audio-overviews/jobs/${jobId}/interjections/${reserved.interjectionId}.wav`
    await expect(t.run(async (ctx) => ctx.db
      .query('pendingCleanup')
      .withIndex('by_r2Key', q => q.eq('r2Key', objectKey))
      .unique())).resolves.toMatchObject({ kind: 'r2', attempts: 0 })
  })

  test('[P0] accepts the shared fifty-source Source Manifest boundary', async () => {
    const { t, owner, overviewId, manifestId, jobId } = await readyV2Overview()
    await t.run(async (ctx) => {
      const overview = await ctx.db.get(overviewId)
      if (!overview) throw new Error('Missing fixture overview')
      for (let order = 2; order < 50; order++) {
        const documentId = await ctx.db.insert('documents', {
          userId: OWNER.tokenIdentifier,
          folderId: overview.folderId,
          filename: `source-${order}.txt`,
          status: 'success',
          fileSize: 100,
          r2Key: `owner/physics/source-${order}.txt`,
          contentHash: HASH,
          sourceRevision: `source-${order}-r1`,
        })
        await ctx.db.insert('audioOverviewSourceManifestEntries', {
          manifestId,
          jobId,
          userId: OWNER.tokenIdentifier,
          order,
          sourceId: `source-${order}`,
          documentId,
          revision: `source-${order}-r1`,
          contentHash: HASH,
          displayReference: `Source ${order}`,
          objectKey: `owner/physics/source-${order}.txt`,
          createdAt: 1,
        })
      }
      await ctx.db.patch(manifestId, { entryCount: 50 })
    })

    const reservation = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-fifty-sources-0001',
      insertedAfterTurnIndex: 0,
      question: 'Can every selected source remain eligible?',
    })
    expect(reservation.sources).toHaveLength(50)
  })

  test('[P0] publishes separate owner-only media, then cancel or delete makes it unresolvable and stages R2 cleanup', async () => {
    const { t, owner, stranger, overviewId, episodeId, jobId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-request-0003',
      insertedAfterTurnIndex: 1,
      question: 'Why does gravity affect an orbit?',
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      utterances: [
        groundedUtterance('host_a', 'Gravity continuously bends the path.', 'gravity-source', 'gravity-path', String(reserved.interjectionId), 0),
        groundedUtterance('host_b', 'So it keeps falling around the body.', 'orbits-source', 'orbit-fall', String(reserved.interjectionId), 1),
      ],
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
    })
    const objectKey = `audio-overviews/jobs/${jobId}/interjections/${reserved.interjectionId}.wav`
    const published = await owner.mutation(api.audioOverviewInterjectionsV2.publish, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      artifact: {
        objectKey,
        etag: 'etag-1',
        checksumSha256: HASH,
        byteLength: 48_044,
        contentType: 'audio/wav',
        durationMs: 1_000,
      },
    })

    expect(published.duplicate).toBe(false)
    expect(published).toMatchObject({ estimatedCostMicrousd: 1_250 })
    expect(await stranger.query(api.audioOverviewInterjectionsV2.resolveMediaForOwner, { interjectionId: reserved.interjectionId })).toBeNull()
    expect(await owner.query(api.audioOverviewInterjectionsV2.resolveMediaForOwner, { interjectionId: reserved.interjectionId })).toMatchObject({ objectKey })

    await owner.mutation(api.audioOverviewInterjectionsV2.cancelOrDelete, { interjectionId: reserved.interjectionId })
    expect(await owner.query(api.audioOverviewInterjectionsV2.resolveMediaForOwner, { interjectionId: reserved.interjectionId })).toBeNull()
    const evidence = await t.run(async (ctx) => {
      const interjection = await ctx.db.get(reserved.interjectionId)
      const artifact = await ctx.db.get(published.artifactId)
      const cleanup = await ctx.db.query('pendingCleanup').withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', published.artifactId)).unique()
      return { interjection, artifact, cleanup }
    })
    expect(evidence.interjection).toMatchObject({ status: 'deleting', episodeId, jobId, estimatedCostMicrousd: 1_250 })
    expect(evidence.artifact).toMatchObject({ status: 'deleting', kind: 'interjection' })
    expect(evidence.cleanup).toMatchObject({ kind: 'r2', r2Key: objectKey })

    await t.run(ctx => ctx.db.patch(published.artifactId, { status: 'deleted' }))
    await t.mutation(internal.audioOverviewInterjectionsV2.deleteInterjectionBatch, {
      interjectionId: reserved.interjectionId,
      userId: OWNER.tokenIdentifier,
    })
    expect(await t.run(ctx => ctx.db.get(reserved.interjectionId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(published.artifactId))).toBeNull()
  })

  test('[P0] cancellation is explicit before synthesis and prevents publication', async () => {
    const { owner, overviewId } = await readyV2Overview()
    const reserved = await owner.mutation(api.audioOverviewInterjectionsV2.reserve, {
      audioOverviewId: overviewId,
      idempotencyKey: 'interjection-request-0004',
      insertedAfterTurnIndex: 0,
      question: 'Stop this answer.',
    })
    await owner.mutation(api.audioOverviewInterjectionsV2.cancelOrDelete, { interjectionId: reserved.interjectionId })
    const state = await owner.query(api.audioOverviewInterjectionsV2.getForOwner, { interjectionId: reserved.interjectionId })
    expect(state).toMatchObject({ status: 'cancelled' })
    await expect(owner.mutation(api.audioOverviewInterjectionsV2.publish, {
      interjectionId: reserved.interjectionId,
      orchestrationToken: ORCHESTRATION_TOKEN,
      artifact: {
        objectKey: 'audio-overviews/episodes/invalid/interjections/invalid.wav',
        checksumSha256: HASH,
        byteLength: 48_044,
        contentType: 'audio/wav',
        durationMs: 1_000,
      },
    })).rejects.toThrow(/cancelled/)
  })
})
