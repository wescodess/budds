/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { interjectionUtteranceVerificationId } from '../shared/audio-overview-grounding'
import schema from './schema'
import type { Id } from './_generated/dataModel'
import { enrollProducer, protectProducerArtifact } from '../tests/fixtures/learn-v2-producer-lineage'
import { admitArtifactInputByIdentity, prepareAndRegisterInstructionalArtifacts, createArtifactLineagePublicationContext, normalizedInstructionalCaseFingerprints } from './lib/learnV2ArtifactLineage'
import { LEARN_ARTIFACT_CASE_IDENTITY_VERSION } from '../shared/learn-v2-artifact-lineage'

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
      audioProfileId: 'budds-two-host-gemini-v2',
      audioProfileVersion: '2',
      renderer: 'gemini-interactions-multi-speaker',
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

async function contractFixture(kind: 'audio_interjection' | 'audio_interjection_v2', sources = 2, registered = true) {
  const f = await readyV2Overview()
  if (registered) await enrollProducer(f.t, OWNER.tokenIdentifier, [f.firstDocumentId, f.secondDocumentId])
  if (sources > 2) {
    const documents = await f.t.run(async ctx => {
      const folderId = (await ctx.db.get(f.firstDocumentId))!.folderId
      const documents = []
      for (let order = 2; order < sources; order++) {
        const id = await ctx.db.insert('documents', { userId: OWNER.tokenIdentifier, folderId, filename: `source-${order}.txt`, status: 'success', fileSize: 1, sourceRevision: `source-${order}`, contentHash: HASH, r2Key: `owned/source-${order}` })
        documents.push(id)
        await ctx.db.insert('audioOverviewSourceManifestEntries', { userId: OWNER.tokenIdentifier, manifestId: f.manifestId, jobId: f.jobId, order, sourceId: `source-${order}`, documentId: id, revision: `source-${order}`, contentHash: HASH, displayReference: `Source ${order}`, objectKey: `owned/source-${order}`, createdAt: 1 })
      }
      await ctx.db.patch(f.manifestId, { entryCount: sources })
      await ctx.db.patch(f.overviewId, { scopeDocIds: [f.firstDocumentId, f.secondDocumentId, ...documents] })
      return documents
    })
    for (let offset = 0; registered && offset < documents.length; offset += 25) await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: documents.slice(offset, offset + 25).flatMap(id => [
      { artifact: { kind: 'document' as const, id }, key: 'whole', sources: [], origins: [] },
      { artifact: { kind: 'document_chunk' as const, id }, key: 'chunk-set', sources: [], origins: [] },
    ]) }))
  }
  const parent = registered ? await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'audio_overview', id: f.overviewId }, key: 'whole', origins: [], sources: [] }] })) : { lineageIds: [] }
  const artifact = await f.t.run(async ctx => {
    if (kind === 'audio_interjection') {
      const audioFileId = await ctx.storage.store(new Blob(['answer audio']))
      const id = await ctx.db.insert('audioOverviewInterjections', { userId: OWNER.tokenIdentifier, audioOverviewId: f.overviewId, insertedAfterTurnIndex: 0, question: 'My own question', answerTurns: [{ speaker: 'host_a', text: 'Generated answer.', durationMs: 1_000, audioFileId }] })
      return { kind, id }
    }
    const id = await ctx.db.insert('audioOverviewInterjectionsV2', { userId: OWNER.tokenIdentifier, audioOverviewId: f.overviewId, episodeId: f.episodeId, sourceManifestId: f.manifestId, jobId: f.jobId, idempotencyKey: 'contract-interjection-0001', insertedAfterTurnIndex: 0, question: 'My own question', model: 'fixture', audioProfileId: 'profile', audioProfileVersion: '1', renderer: 'fixture', hostAVoice: 'Kore', hostBVoice: 'Puck', status: 'rendering', utteranceCount: 4, createdAt: 1, updatedAt: 1 })
    const entries = await ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_manifestId_and_order', q => q.eq('manifestId', f.manifestId)).take(50)
    for (let order = 0; order < 4; order++) {
      const utteranceId = await ctx.db.insert('audioOverviewInterjectionUtterances', { userId: OWNER.tokenIdentifier, interjectionId: id, episodeId: f.episodeId, order, speaker: order % 2 ? 'host_b' : 'host_a', text: `Generated answer ${order}. ${'Evidence '.repeat(190)}`, createdAt: 1 })
      for (const entry of entries.slice(0, 12)) await ctx.db.insert('audioOverviewInterjectionSources', { userId: OWNER.tokenIdentifier, interjectionId: id, utteranceId, manifestEntryId: entry._id, episodeId: f.episodeId, createdAt: 1 })
    }
    return { kind, id }
  })
  return { ...f, artifact, parent, input: { artifacts: [{ artifact, key: 'whole', sources: [], origins: [] }] } }
}

describe('#540 interjection preparation contract', () => {
  test.each(['audio_interjection', 'audio_interjection_v2'] as const)('%s registers its own answer, inherits parent provenance and replays idempotently', async kind => {
    const f = await contractFixture(kind)
    const registered = await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))
    expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'admitted_registered' })
    const row = (await f.t.run(ctx => ctx.db.get(registered.lineageIds[0]!)))!
    expect(row).toMatchObject({ classification: 'teaching', derivation: 'derived', originCount: 1, sourceCount: 2 })
    const origins = await f.t.run(ctx => ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', OWNER.tokenIdentifier).eq('lineageId', row._id)).take(8))
    expect(origins[0]?.originLineageId).toBe(f.parent.lineageIds[0])
    await f.t.run(ctx => ctx.db.patch(f.artifact.id, { question: 'My edited own question, outside teaching' }))
    const replay = await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))
    expect(replay.references).toEqual(registered.references)
    expect(replay.catalogRevision).toBe(registered.catalogRevision)
    expect(JSON.stringify(await f.t.run(ctx => ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(50)))).not.toContain('My own question')
    await protectProducerArtifact(f.t, OWNER.tokenIdentifier, { kind: 'audio_overview', id: f.overviewId }, 'private_scoring')
    expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'rejected' })
    await expect(f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))).rejects.toThrow()
  })
  test.each(['audio_interjection', 'audio_interjection_v2'] as const)('%s rejects a reserved answer and rolls back publication rows', async kind => {
    const f = await contractFixture(kind)
    const before = await f.t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(150))
    await f.t.run(async ctx => ctx.db.insert('learnAssessmentCases', { userId: OWNER.tokenIdentifier, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: 1, caseKey: 'retired', usageClass: 'unknown', reservedAt: 0, identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION, ...await normalizedInstructionalCaseFingerprints('Generated answer.', 'Generated answer.') }))
    await expect(f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))).rejects.toThrow(/reservation check/)
    expect(await f.t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(150))).toEqual(before)
  })
  test('a four-Utterance, thirty-two-source publication stays within the shared budgets', async () => {
    const f = await contractFixture('audio_interjection_v2', 32)
    const measured = await f.owner.run(async ctx => {
      const publication = createArtifactLineagePublicationContext(ctx)
      expect(await admitArtifactInputByIdentity(publication.admission.ctx, { kind: 'audio_overview', id: f.overviewId })).toMatchObject({ status: 'admitted_registered' })
      const registered = await prepareAndRegisterInstructionalArtifacts(publication.preparation.ctx, f.input)
      expect(await admitArtifactInputByIdentity(publication.admission.ctx, f.artifact)).toMatchObject({ status: 'admitted_registered' })
      return { total: { ...publication.readUsage, ranges: publication.indexRanges }, preparation: registered.readUsage, admission: { ...publication.admission.readUsage, ranges: publication.admission.indexRanges } }
    })
    expect(measured.total.chargedBytes).toBeLessThan(8 * 1024 * 1024)
    expect(measured.total.ranges).toBeLessThanOrEqual(3072)
    expect(measured.admission.ranges).toBeLessThanOrEqual(2048)
    console.info('interjection-budget', JSON.stringify(measured))
  })
})


describe('#540 interjection graph and pin limits', () => {
  test.each(['audio_interjection', 'audio_interjection_v2'] as const)('an unregistered %s still rejects its protected parent', async kind => {
    const f = await contractFixture(kind)
    await f.t.run(async ctx => {
      const catalog = (await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique())!
      await ctx.db.patch(catalog._id, { measurementCapability: { enabled: false } })
    })
    await protectProducerArtifact(f.t, OWNER.tokenIdentifier, { kind: 'audio_overview', id: f.overviewId }, 'private_scoring')
    expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })
  test.each(['object', 'hash', 'revision'] as const)('ordinary unregistered reads reject a changed frozen %s pin', async pin => {
    const f = await contractFixture('audio_interjection_v2', 2, false)
    expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'admitted_unregistered' })
    await f.t.run(ctx => ctx.db.patch(f.firstDocumentId, pin === 'object' ? { r2Key: 'owner/replaced-object' } : pin === 'hash' ? { contentHash: 'c'.repeat(64) } : { sourceRevision: 'changed.r2' }))
    expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'rejected' })
  })
  test('duplicated parent/source provenance above the existing 64-link graph bound fails closed', async () => {
    const f = await contractFixture('audio_interjection_v2', 50)
    const catalog = await f.t.run(ctx => ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique())
    await expect(f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))).rejects.toThrow('Artifact lineage unavailable')
    expect(await f.t.run(ctx => ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique())).toEqual(catalog)
  })
  test.each(['object', 'hash', 'revision', 'foreign', 'missing', 'duplicate'] as const)('rejects a substituted %s source or join', async change => {
    const f = await contractFixture('audio_interjection_v2')
    await f.t.run(async ctx => {
      if (change === 'object') await ctx.db.patch(f.firstEntryId, { objectKey: 'private/other-object' })
      if (change === 'hash') await ctx.db.patch(f.firstEntryId, { contentHash: 'c'.repeat(64) })
      if (change === 'revision') await ctx.db.patch(f.firstEntryId, { revision: 'different.r2' })
      const links = await ctx.db.query('audioOverviewInterjectionSources').withIndex('by_interjectionId', q => q.eq('interjectionId', f.artifact.id as Id<'audioOverviewInterjectionsV2'>)).take(48)
      if (change === 'foreign') await ctx.db.patch(links[0]!._id, { userId: STRANGER.tokenIdentifier })
      if (change === 'missing') for (const link of links.filter(link => link.utteranceId === links[0]!.utteranceId)) await ctx.db.delete(link._id)
      if (change === 'duplicate') { const { _id, _creationTime, ...fields } = links[0]!; await ctx.db.insert('audioOverviewInterjectionSources', fields) }
    })
    await expect(f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))).rejects.toThrow(change === 'hash' || change === 'revision' ? 'Artifact registration required' : 'Artifact lineage unavailable')
  })
  test('an oversized parent projection cannot enter an interjection through its retained origin', async () => {
    const f = await contractFixture('audio_interjection_v2')
    await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))
    await f.t.run(ctx => ctx.db.patch(f.episodeId, { title: 'x'.repeat(510_000) }))
    expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'rejected', reasonCode: 'projection_exceeds_budget' })
    await expect(f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))).rejects.toMatchObject({ data: { reasonCode: 'projection_exceeds_budget' } })
  })
})

test('#540 media publication advances the script binding and stale media never admits', async () => {
  const f = await contractFixture('audio_interjection_v2')
  if (f.artifact.kind !== 'audio_interjection_v2') throw new Error('Expected V2 Interjection')
  const id = f.artifact.id
  const script = await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))
  const mediaId = await f.t.run(async ctx => {
    const artifactId = await ctx.db.insert('audioOverviewAudioArtifacts', { userId: OWNER.tokenIdentifier, episodeId: f.episodeId, jobId: f.jobId, interjectionId: id, kind: 'interjection', status: 'published', storageProvider: 'r2', objectKey: `audio-overviews/jobs/${f.jobId}/interjections/${id}.wav`, checksumSha256: HASH, byteLength: 48_044, contentType: 'audio/wav', container: 'wav', sampleRateHz: 24000, channelCount: 1, bitsPerSample: 16, durationMs: 1_000, createdAt: 1, publishedAt: 1 })
    await ctx.db.patch(id, { status: 'ready', artifactId })
    return artifactId
  })
  const published = await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))
  expect(published.references[0]?.revision).not.toBe(script.references[0]?.revision)
  expect((await f.t.run(ctx => ctx.db.get(script.lineageIds[0]!)))?.nextId).toBe(published.lineageIds[0])
  expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'admitted_registered' })
  expect((await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, f.input))).lineageIds).toEqual(published.lineageIds)
  await f.t.run(ctx => ctx.db.patch(mediaId, { checksumSha256: 'd'.repeat(64) }))
  expect(await f.owner.run(ctx => admitArtifactInputByIdentity(ctx, f.artifact))).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
})


async function enrolledV2Interjection() {
  const f = await readyV2Overview()
  await enrollProducer(f.t, OWNER.tokenIdentifier, [f.firstDocumentId, f.secondDocumentId])
  await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'audio_overview', id: f.overviewId }, key: 'whole', sources: [], origins: [] }] }))
  const request = { audioOverviewId: f.overviewId, idempotencyKey: 'interjection-admission-0001', insertedAfterTurnIndex: 0, question: 'My own question' }
  const reserved = await f.owner.mutation(api.audioOverviewInterjectionsV2.reserve, request)
  const credentials = { interjectionId: reserved.interjectionId, orchestrationToken: ORCHESTRATION_TOKEN }
  await f.owner.mutation(api.audioOverviewInterjectionsV2.claimScripting, credentials)
  const script = { ...credentials, utterances: [groundedUtterance('host_a', 'Gravity bends the path.', 'gravity-source', 'gravity-claim', String(reserved.interjectionId), 0), groundedUtterance('host_b', 'An orbit is free fall.', 'orbits-source', 'orbit-claim', String(reserved.interjectionId), 1)] }
  const publish = { ...credentials, artifact: { objectKey: `audio-overviews/jobs/${f.jobId}/interjections/${reserved.interjectionId}.wav`, checksumSha256: HASH, byteLength: 48_044, contentType: 'audio/wav', durationMs: 1_000 } }
  return { ...f, request, credentials, script, publish, interjectionId: reserved.interjectionId }
}

describe('V2 Interjection publication and read admission', () => {
  test('script and media both register, exact publication replay is idempotent and own question remains independent', async () => {
    const f = await enrolledV2Interjection()
    await f.owner.mutation(api.audioOverviewInterjectionsV2.startRendering, f.script)
    const script = await f.t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'audio_interjection_v2').eq('artifact.id', f.interjectionId).eq('nextId', undefined)).unique())
    expect(script?.publication).toBeDefined()
    await f.owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, f.credentials)
    const result = await f.owner.mutation(api.audioOverviewInterjectionsV2.publish, f.publish)
    expect(await f.owner.mutation(api.audioOverviewInterjectionsV2.publish, f.publish)).toMatchObject({ duplicate: true, artifactId: result.artifactId })
    expect((await f.t.run(ctx => ctx.db.get(script!._id)))?.nextId).toBeDefined()
    expect(await f.owner.query(api.audioOverviewInterjectionsV2.getForOwner, { interjectionId: f.interjectionId })).toMatchObject({ question: f.request.question, answerAvailability: 'available', utterances: [{ text: 'Gravity bends the path.' }, { text: 'An orbit is free fall.' }] })
    expect(await f.owner.query(api.audioOverviewInterjectionsV2.resolveMediaForOwner, { interjectionId: f.interjectionId })).toHaveProperty('artifactId', result.artifactId)
  })
  test.each(['measurement', 'private_scoring', 'unknown'] as const)('%s answer and parent cannot pass renderer, publication, text or media replay', async classification => {
    for (const parent of [false, true]) {
      const f = await enrolledV2Interjection()
      await f.owner.mutation(api.audioOverviewInterjectionsV2.startRendering, f.script)
      await f.owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, f.credentials)
      await f.owner.mutation(api.audioOverviewInterjectionsV2.publish, f.publish)
      await protectProducerArtifact(f.t, OWNER.tokenIdentifier, parent ? { kind: 'audio_overview', id: f.overviewId } : { kind: 'audio_interjection_v2', id: f.interjectionId }, classification)
      for (const run of [() => f.owner.mutation(api.audioOverviewInterjectionsV2.reserve, f.request), () => f.owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, f.credentials), () => f.owner.mutation(api.audioOverviewInterjectionsV2.publish, f.publish), () => f.owner.query(api.audioOverviewInterjectionsV2.resolveMediaForOwner, { interjectionId: f.interjectionId })]) await expect(run()).rejects.toThrow(/unavailable/)
      expect(await f.owner.query(api.audioOverviewInterjectionsV2.getForOwner, { interjectionId: f.interjectionId })).toMatchObject({ question: f.request.question, idempotencyKey: f.request.idempotencyKey, answerAvailability: 'unavailable', utterances: [], artifact: null })
    }
  })
  test.each(['script', 'media'] as const)('a late reserved case rolls back the %s publication', async stage => {
    const f = await enrolledV2Interjection()
    if (stage === 'media') { await f.owner.mutation(api.audioOverviewInterjectionsV2.startRendering, f.script); await f.owner.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, f.credentials) }
    await f.t.run(async ctx => ctx.db.insert('learnAssessmentCases', { userId: OWNER.tokenIdentifier, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: 1, caseKey: 'retired-interjection', usageClass: 'unknown', reservedAt: 0, identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION, ...await normalizedInstructionalCaseFingerprints('Retired task', 'Retired solution') }))
    const before = await f.t.run(ctx => ctx.db.get(f.interjectionId))
    await expect(stage === 'script' ? f.owner.mutation(api.audioOverviewInterjectionsV2.startRendering, f.script) : f.owner.mutation(api.audioOverviewInterjectionsV2.publish, f.publish)).rejects.toThrow(/reservation check/)
    expect(await f.t.run(ctx => ctx.db.get(f.interjectionId))).toEqual(before)
    const artifacts = await f.t.run(ctx => ctx.db.query('audioOverviewAudioArtifacts').withIndex('by_episodeId_and_kind', q => q.eq('episodeId', f.episodeId)).take(10))
    expect(artifacts.filter(row => row.interjectionId === f.interjectionId)).toEqual([])
  })
})
