/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const USER_ID = 'https://auth.example.com|audio-v2-owner'
const CAPABILITY = 'c'.repeat(43)
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function setup() {
  const t = convexTest(schema, modules)
  const asUser = t.withIdentity({ tokenIdentifier: USER_ID, name: 'Audio v2 Owner' })
  const seeded = await t.run(async (ctx) => {
    const folderId = await ctx.db.insert('folders', {
      userId: USER_ID,
      name: 'Audio v2',
      documentCount: 2,
    })
    const firstDocumentId = await ctx.db.insert('documents', {
      userId: USER_ID,
      folderId,
      filename: 'chapter-one.pdf',
      status: 'success',
      fileSize: 1_024,
      r2Key: `${USER_ID}/chapter-one.txt`,
      contentHash: HASH_A,
      sourceRevision: `sha256:${HASH_A}`,
    })
    const secondDocumentId = await ctx.db.insert('documents', {
      userId: USER_ID,
      folderId,
      filename: 'chapter-two.pdf',
      status: 'success',
      fileSize: 2_048,
      r2Key: `${USER_ID}/chapter-two.txt`,
      contentHash: HASH_B,
      sourceRevision: `sha256:${HASH_B}`,
    })
    const taskId = await ctx.db.insert('tasks', {
      userId: USER_ID,
      folderId,
      type: 'audio-overview-generation',
      status: 'running',
      title: 'Generate audio overview',
      createdAt: 1,
      updatedAt: 1,
      audioOverviewRequest: {
        scope: { mode: 'explicit', documentIds: [firstDocumentId, secondDocumentId] },
        documents: [
          {
            documentId: firstDocumentId,
            folderId,
            filename: 'chapter-one.pdf',
            r2Key: `${USER_ID}/chapter-one.txt`,
            contentHash: HASH_A,
            sourceRevision: `sha256:${HASH_A}`,
          },
          {
            documentId: secondDocumentId,
            folderId,
            filename: 'chapter-two.pdf',
            r2Key: `${USER_ID}/chapter-two.txt`,
            contentHash: HASH_B,
            sourceRevision: `sha256:${HASH_B}`,
          },
        ],
        preferences: { lengthMinutes: 5, complexity: 'beginner' },
        voiceProfile: { hostA: 'asteria', hostB: 'orion' },
        quotaDate: '2026-09-03',
      },
    })
    const jobId = await ctx.db.insert('audioOverviewJobs', {
      userId: USER_ID,
      taskId,
      folderId,
      idempotencyKey: 'audio_overview_v2_test',
      capabilityHash: await sha256Base64Url(CAPABILITY),
      status: 'running',
      stage: 'preparing',
      completedTurns: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    return { folderId, firstDocumentId, secondDocumentId, taskId, jobId }
  })

  const plan = {
    jobId: seeded.jobId,
    capability: CAPABILITY,
    planFingerprint: HASH_A,
    title: 'A grounded conversation',
    model: 'gemini-2.5-flash',
    audioProfile: {
      id: 'gemini-two-host',
      version: '1',
      renderer: 'gemini-2.5-flash-preview-tts',
      hostAVoice: 'Kore',
      hostBVoice: 'Puck',
    },
    manifest: {
      revision: 'manifest-v1',
      contentHash: HASH_B,
      entries: [
        {
          sourceId: 'source-one',
          documentId: seeded.firstDocumentId,
          revision: `sha256:${HASH_A}`,
          contentHash: HASH_A,
          displayReference: 'Chapter One',
          objectKey: `${USER_ID}/chapter-one.txt`,
        },
        {
          sourceId: 'source-two',
          documentId: seeded.secondDocumentId,
          revision: `sha256:${HASH_B}`,
          contentHash: HASH_B,
          displayReference: 'Chapter Two',
          objectKey: `${USER_ID}/chapter-two.txt`,
        },
      ],
    },
    outline: {
      narrativeArc: 'Move from the central claim to the qualification that makes it useful.',
      learningObjectives: [
        'Explain the central claim.',
        'Recognize the important qualification.',
      ],
      plannedSourceIds: ['source-one', 'source-two'],
    },
    claims: [
      {
        claimId: 'central-claim',
        text: 'The first source establishes the central claim.',
        status: 'supported' as const,
        sourceEntryOrders: [0],
        verification: {
          version: 'claim-entailment.v1' as const,
          model: 'google/gemini-2.5-flash',
          decision: 'entailed' as const,
          reason: 'The evidence directly states the claim.',
        },
      },
      {
        claimId: 'unused-draft',
        text: 'This unverified planning claim must not be spoken.',
        status: 'unsupported' as const,
        sourceEntryOrders: [],
      },
    ],
    scenes: [
      {
        sceneId: 'opening',
        title: 'Opening',
        narrativePurpose: 'Introduce the central idea and establish curiosity.',
        targetDurationMs: 30_000,
        utterances: [
          {
            speaker: 'host_a' as const,
            text: 'Let us start with the central claim.',
            emotionalIntent: 'curious',
            deliveryIntent: 'warm and measured',
            pauseAfterMs: 350,
            sourceEntryOrders: [0],
            claimIds: ['central-claim'],
            verification: {
              version: 'claim-entailment.v1' as const,
              utteranceId: 'scene:0:opening:utterance:0',
              model: 'google/gemini-2.5-flash',
              decision: 'entailed' as const,
              reason: 'The exact spoken text follows from the cited claim evidence.',
            },
          },
          {
            speaker: 'host_b' as const,
            text: 'The second source adds an important qualification.',
            emotionalIntent: 'thoughtful',
            deliveryIntent: 'clear emphasis on the qualification',
            sourceEntryOrders: [0, 1],
            claimIds: ['central-claim'],
            verification: {
              version: 'claim-entailment.v1' as const,
              utteranceId: 'scene:0:opening:utterance:1',
              model: 'google/gemini-2.5-flash',
              decision: 'entailed' as const,
              reason: 'The exact spoken text follows from the cited claim evidence.',
            },
          },
        ],
      },
    ],
  }
  return { t, asUser, ...seeded, plan }
}

describe('audioOverviewV2 normalized plan', () => {
  test('[P0] freezes an exact manifest and writes bounded scene, utterance, and source records atomically', async () => {
    const { t, jobId, plan } = await setup()

    const created = await t.mutation(api.audioOverviewV2.createPlan, plan)
    const duplicate = await t.mutation(api.audioOverviewV2.createPlan, plan)
    const projection = await t.query(api.audioOverviewV2.getForWorkflow, { jobId, capability: CAPABILITY })

    expect(created.duplicate).toBe(false)
    expect(duplicate).toMatchObject({ duplicate: true, episodeId: created.episodeId, manifestId: created.manifestId })
    expect(projection).toMatchObject({
      episode: {
        schemaVersion: 2,
        status: 'planning',
        sceneCount: 1,
        utteranceCount: 2,
        renderer: 'gemini-2.5-flash-preview-tts',
      },
      manifest: { schemaVersion: 2, entryCount: 2, planFingerprint: HASH_A },
      outline: { narrativeArc: 'Move from the central claim to the qualification that makes it useful.' },
      claimLedger: { claimCount: 2, supportedClaimCount: 1 },
    })
    expect(projection?.entries.map(entry => entry.displayReference)).toEqual(['Chapter One', 'Chapter Two'])
    expect(projection?.scenes).toHaveLength(1)
    expect(projection?.utterances.map(utterance => ({
      speaker: utterance.speaker,
      emotionalIntent: utterance.emotionalIntent,
      deliveryIntent: utterance.deliveryIntent,
      pauseAfterMs: utterance.pauseAfterMs,
    }))).toEqual([
      {
        speaker: 'host_a',
        emotionalIntent: 'curious',
        deliveryIntent: 'warm and measured',
        pauseAfterMs: 350,
      },
      {
        speaker: 'host_b',
        emotionalIntent: 'thoughtful',
        deliveryIntent: 'clear emphasis on the qualification',
        pauseAfterMs: undefined,
      },
    ])
    expect(projection?.utteranceSources).toHaveLength(3)
    expect(projection?.learningObjectives.map(objective => objective.text)).toEqual([
      'Explain the central claim.',
      'Recognize the important qualification.',
    ])
    expect(projection?.outlineSources).toHaveLength(2)
    expect(projection?.claims.map(claim => ({ claimId: claim.claimId, status: claim.status }))).toEqual([
      { claimId: 'central-claim', status: 'supported' },
      { claimId: 'unused-draft', status: 'unsupported' },
    ])
    expect(projection?.claimSources).toHaveLength(1)
    expect(projection?.utteranceClaims).toHaveLength(2)
  })

  test('[P0] rejects scope expansion and refuses to replace a frozen plan', async () => {
    const { t, folderId, jobId, plan } = await setup()
    const unrelatedDocumentId = await t.run(ctx => ctx.db.insert('documents', {
      userId: USER_ID,
      folderId,
      filename: 'unrelated.pdf',
      status: 'success',
      fileSize: 1,
    }))

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      manifest: {
        ...plan.manifest,
        entries: [plan.manifest.entries[0]!, { ...plan.manifest.entries[1]!, documentId: unrelatedDocumentId }],
      },
    })).rejects.toThrow(/frozen source scope/i)

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      manifest: {
        ...plan.manifest,
        entries: [{ ...plan.manifest.entries[0]!, contentHash: HASH_C }, plan.manifest.entries[1]!],
      },
    })).rejects.toThrow(/content hash does not match/i)

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      outline: { ...plan.outline, plannedSourceIds: ['source-one', 'outside-scope'] },
    })).rejects.toThrow(/outside the frozen manifest/i)

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      claims: [{ ...plan.claims[0]!, verification: undefined }, plan.claims[1]!],
    })).rejects.toThrow(/entailment verification/i)

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      scenes: [{
        ...plan.scenes[0]!,
        utterances: [{ ...plan.scenes[0]!.utterances[0]!, claimIds: [], sourceEntryOrders: [] }],
      }],
    })).rejects.toThrow(/supported claim evidence/i)

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      scenes: [{
        ...plan.scenes[0]!,
        utterances: [{
          ...plan.scenes[0]!.utterances[0]!,
          verification: {
            ...plan.scenes[0]!.utterances[0]!.verification,
            utteranceId: 'scene:0:opening:utterance:99',
          },
        }],
      }],
    })).rejects.toThrow(/exact semantic entailment verification/i)

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      scenes: [{
        ...plan.scenes[0]!,
        utterances: [{ ...plan.scenes[0]!.utterances[0]!, claimIds: ['missing-claim'] }],
      }],
    })).rejects.toThrow(/unknown claim/i)

    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      scenes: [{
        ...plan.scenes[0]!,
        utterances: [{ ...plan.scenes[0]!.utterances[0]!, claimIds: ['unused-draft'] }],
      }],
    })).rejects.toThrow(/unsupported claim/i)

    await t.mutation(api.audioOverviewV2.createPlan, plan)
    await expect(t.mutation(api.audioOverviewV2.createPlan, {
      ...plan,
      planFingerprint: HASH_C,
    })).rejects.toThrow(/already frozen/i)
    await expect(t.query(api.audioOverviewV2.getForWorkflow, {
      jobId,
      capability: 'x'.repeat(43),
    })).rejects.toThrow(/not found/i)
  })
})

describe('audioOverviewV2 artifact and alignment lifecycle', () => {
  test('[P0] publishes only quality-approved homogeneous scenes and keeps alignment asynchronous', async () => {
    vi.useFakeTimers()
    const { t, asUser, jobId, plan } = await setup()
    const { episodeId } = await t.mutation(api.audioOverviewV2.createPlan, plan)
    const beforeRender = await t.query(api.audioOverviewV2.getForWorkflow, { jobId, capability: CAPABILITY })
    const scene = beforeRender?.scenes[0]
    if (!scene) throw new Error('Expected seeded scene')

    const sceneBytes = 30_000 * 48
    const sceneResult = await t.mutation(api.audioOverviewV2.recordSceneEvaluation, {
      jobId,
      capability: CAPABILITY,
      sceneId: scene._id,
      attempt: 1,
      passed: true,
      artifact: {
        objectKey: `audio-overviews/jobs/${jobId}/scenes/0-1.pcm`,
        checksumSha256: HASH_A,
        byteLength: sceneBytes,
        contentType: 'audio/L16;codec=pcm;rate=24000',
        container: 'pcm',
        sampleRateHz: 24000,
        channelCount: 1,
        bitsPerSample: 16,
        durationMs: 30_000,
        rendererRequestId: 'gemini-request-1',
      },
      checks: {
        claimsSupported: true,
        scriptedSpeakerPairValid: true,
        audioProfileMatches: true,
        speakerCountEvidence: 'not_measured',
        speakerConsistencyEvidence: 'not_measured',
        durationWithinTolerance: true,
        silenceWithinTolerance: true,
        clippingWithinTolerance: true,
        truncationFree: true,
        tempoWithinTolerance: true,
        directionsNotSpoken: true,
        transcriptDivergence: 0.02,
        transcriptDivergenceThreshold: 0.08,
      },
    })
    const replay = await t.mutation(api.audioOverviewV2.recordSceneEvaluation, {
      jobId,
      capability: CAPABILITY,
      sceneId: scene._id,
      attempt: 1,
      passed: true,
      artifact: {
        objectKey: `audio-overviews/jobs/${jobId}/scenes/0-1.pcm`,
        checksumSha256: HASH_A,
        byteLength: sceneBytes,
        contentType: 'audio/L16;codec=pcm;rate=24000',
        container: 'pcm',
        sampleRateHz: 24000,
        channelCount: 1,
        bitsPerSample: 16,
        durationMs: 30_000,
        rendererRequestId: 'gemini-request-1',
      },
      checks: {
        claimsSupported: true,
        scriptedSpeakerPairValid: true,
        audioProfileMatches: true,
        speakerCountEvidence: 'not_measured',
        speakerConsistencyEvidence: 'not_measured',
        durationWithinTolerance: true,
        silenceWithinTolerance: true,
        clippingWithinTolerance: true,
        truncationFree: true,
        tempoWithinTolerance: true,
        directionsNotSpoken: true,
        transcriptDivergence: 0.02,
        transcriptDivergenceThreshold: 0.08,
      },
    })
    expect(replay).toMatchObject({ duplicate: true, artifactId: sceneResult.artifactId })

    const finalArtifactArgs = {
      jobId,
      capability: CAPABILITY,
      artifact: {
        objectKey: `audio-overviews/jobs/${jobId}/episode.wav`,
        checksumSha256: HASH_B,
        byteLength: sceneBytes + 44,
        contentType: 'audio/wav',
        container: 'wav',
        sampleRateHz: 24000,
        channelCount: 1,
        bitsPerSample: 16,
        durationMs: 30_000,
      },
      alignment: { aligner: 'whisper', alignerVersion: '1' },
    } as const
    const published = await t.mutation(api.audioOverviewV2.publishFinalArtifact, finalArtifactArgs)
    expect(await t.mutation(api.audioOverviewV2.publishFinalArtifact, finalArtifactArgs)).toMatchObject({
      duplicate: true,
      overviewId: published.overviewId,
      artifactId: published.artifactId,
      alignmentId: published.alignmentId,
    })
    const projection = await t.query(api.audioOverviewV2.getForWorkflow, { jobId, capability: CAPABILITY })
    expect(projection?.episode).toMatchObject({
      _id: episodeId,
      status: 'ready',
      finalArtifactId: published.artifactId,
      alignmentId: published.alignmentId,
    })
    expect(projection?.alignment).toMatchObject({ status: 'pending', segmentCount: 0 })
    const state = await t.run(async (ctx) => ({
      compatibilityRoots: await ctx.db.query('audioOverviews').withIndex('by_episodeId', q => q.eq('episodeId', episodeId)).take(2),
      job: await ctx.db.get(jobId),
      task: projection?.episode.taskId ? await ctx.db.get(projection.episode.taskId) : null,
    }))
    expect(state.compatibilityRoots).toHaveLength(1)
    expect(state.compatibilityRoots[0]).toMatchObject({
      _id: published.overviewId,
      finalArtifactId: published.artifactId,
      turns: [],
      status: 'ready',
    })
    expect(state.job).toMatchObject({
      status: 'completed',
      stage: 'complete',
      estimatedCostMicrousd: 41_010,
    })
    expect(state.task).toMatchObject({
      status: 'completed',
      progress: 'Complete',
      result: {
        overviewId: published.overviewId,
        episodeId,
        finalArtifactId: published.artifactId,
        schemaVersion: 2,
      },
    })

    expect(await asUser.query(api.audioOverviewV2.resolveMediaForOwner, {
      artifactId: published.artifactId,
    })).toMatchObject({
      artifactId: published.artifactId,
      objectKey: `audio-overviews/jobs/${jobId}/episode.wav`,
      storageProvider: 'r2',
      container: 'wav',
    })
    expect(await t.query(api.audioOverviewV2.resolveMediaForOwner, {
      artifactId: published.artifactId,
    })).toBeNull()
    expect(await asUser.query(api.audioOverviewV2.resolveMediaForOwner, {
      artifactId: sceneResult.artifactId,
    })).toBeNull()

    const ownerPlayback = await asUser.query(api.audioOverviewV2.getPlaybackForOwner, {
      overviewId: published.overviewId,
    })
    expect(await t.query(api.audioOverviewV2.getPlaybackForOwner, {
      overviewId: published.overviewId,
    })).toBeNull()
    expect(await t.withIdentity({ tokenIdentifier: 'https://auth.example.com|other-user' }).query(
      api.audioOverviewV2.getPlaybackForOwner,
      { overviewId: published.overviewId },
    )).toBeNull()
    expect(ownerPlayback).toMatchObject({
      overviewId: published.overviewId,
      schemaVersion: 2,
      outline: {
        learningObjectives: ['Explain the central claim.', 'Recognize the important qualification.'],
        plannedSourceIds: ['source-one', 'source-two'],
      },
      claims: [{ claimId: 'central-claim', sourceIds: ['source-one'] }],
      finalArtifact: {
        artifactId: published.artifactId,
        objectKey: `audio-overviews/jobs/${jobId}/episode.wav`,
        container: 'wav',
        sampleRateHz: 24000,
      },
      alignment: { status: 'pending' },
    })
    expect(ownerPlayback?.utterances[0]).toMatchObject({
      claimIds: ['central-claim'],
      sourceIds: ['source-one'],
    })
    expect(JSON.stringify(ownerPlayback)).not.toContain('https://')

    const shareToken = '1'.repeat(32)
    await t.run(ctx => ctx.db.patch(published.overviewId, { shareToken, publishedAt: Date.now() }))
    const sharedPlayback = await t.query(api.audioOverviewV2.getPlaybackByShareToken, { token: shareToken })
    expect(sharedPlayback).toMatchObject({ overviewId: published.overviewId, schemaVersion: 2 })
    expect(JSON.stringify(sharedPlayback)).not.toContain(HASH_A)
    expect(JSON.stringify(sharedPlayback)).not.toContain(HASH_B)
    expect(JSON.stringify(sharedPlayback)).not.toContain(String(plan.manifest.entries[0]!.documentId))
    expect(sharedPlayback).not.toHaveProperty('finalArtifact')
    expect(sharedPlayback).not.toHaveProperty('claims')
    expect(await t.query(api.audioOverviewV2.resolveMediaByShareToken, { token: shareToken })).toMatchObject({
      artifactId: published.artifactId,
      objectKey: `audio-overviews/jobs/${jobId}/episode.wav`,
      storageProvider: 'r2',
      container: 'wav',
    })
    expect(await t.query(api.audioOverviewV2.getPlaybackByShareToken, { token: 'invalid' })).toBeNull()
    expect(await t.query(api.audioOverviewV2.resolveMediaByShareToken, { token: 'invalid' })).toBeNull()

    const utteranceId = projection?.utterances[0]?._id
    if (!utteranceId) throw new Error('Expected seeded utterance')
    await expect(t.mutation(api.audioOverviewV2.completeAlignment, {
      jobId,
      capability: CAPABILITY,
      alignmentId: published.alignmentId,
    })).rejects.toThrow(/empty alignment/i)
    expect(await t.mutation(api.audioOverviewV2.appendAlignmentSegments, {
      jobId,
      capability: CAPABILITY,
      alignmentId: published.alignmentId,
      segments: [
        { utteranceId, wordIndex: 0, word: 'Let', startMs: 0, endMs: 180, confidence: 0.99 },
        { utteranceId, wordIndex: 1, word: 'us', startMs: 190, endMs: 290, confidence: 0.98 },
      ],
    })).toEqual({ inserted: 2, duplicate: 0 })
    await expect(t.mutation(api.audioOverviewV2.completeAlignment, {
      jobId,
      capability: CAPABILITY,
      alignmentId: published.alignmentId,
    })).rejects.toThrow(/partial audio overview alignment/i)
    const secondUtteranceId = projection?.utterances[1]?._id
    if (!secondUtteranceId) throw new Error('Expected second seeded utterance')
    expect(await t.mutation(api.audioOverviewV2.appendAlignmentSegments, {
      jobId,
      capability: CAPABILITY,
      alignmentId: published.alignmentId,
      segments: [
        { utteranceId: secondUtteranceId, wordIndex: 0, word: 'The', startMs: 2_000, endMs: 2_180, confidence: 0.97 },
      ],
    })).toEqual({ inserted: 1, duplicate: 0 })
    expect(await t.mutation(api.audioOverviewV2.completeAlignment, {
      jobId,
      capability: CAPABILITY,
      alignmentId: published.alignmentId,
    })).toEqual({ duplicate: false })
    const alignedPlayback = await asUser.query(api.audioOverviewV2.getPlaybackForOwner, {
      overviewId: published.overviewId,
    })
    expect(alignedPlayback?.alignment).toMatchObject({ status: 'ready', segmentCount: 3 })
    expect(alignedPlayback?.utterances[0]).toMatchObject({
      alignmentStartMs: 0,
      wordTimings: [
        { word: 'Let', start: 0, end: 0.18 },
        { word: 'us', start: 0.19, end: 0.29 },
      ],
    })
    expect(alignedPlayback?.utterances[1]).toMatchObject({
      alignmentStartMs: 2_000,
      wordTimings: [{ word: 'The', start: 2, end: 2.18 }],
    })
    const page = await t.query(api.audioOverviewV2.listAlignmentSegments, {
      jobId,
      capability: CAPABILITY,
      alignmentId: published.alignmentId,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page.map(segment => segment.word)).toEqual(['Let', 'us', 'The'])

    const foreignArtifactId = await t.run(ctx => ctx.db.insert('audioOverviewAudioArtifacts', {
      episodeId,
      jobId,
      userId: 'https://auth.example.com|other-user',
      kind: 'interjection',
      status: 'published',
      storageProvider: 'r2',
      objectKey: `audio-overviews/jobs/${jobId}/foreign.wav`,
      checksumSha256: HASH_C,
      byteLength: 48_044,
      contentType: 'audio/wav',
      container: 'wav',
      sampleRateHz: 24000,
      channelCount: 1,
      bitsPerSample: 16,
      durationMs: 1_000,
      createdAt: Date.now(),
      publishedAt: Date.now(),
    }))
    await expect(asUser.mutation(api.audioOverviews.deleteOverview, {
      id: published.overviewId,
    })).rejects.toThrow(/artifact ownership mismatch/i)
    expect((await t.run(ctx => ctx.db.get(published.overviewId)))?.status).toBe('ready')
    expect(await t.run(ctx => ctx.db.query('pendingCleanup').withIndex('by_userId', q => q.eq('userId', USER_ID)).take(10))).toEqual([])
    await t.run(ctx => ctx.db.delete(foreignArtifactId))

    await asUser.mutation(api.audioOverviews.deleteOverview, { id: published.overviewId })
    const stagedDeletion = await t.run(async (ctx) => ({
      overview: await ctx.db.get(published.overviewId),
      episode: await ctx.db.get(episodeId),
      artifacts: await ctx.db.query('audioOverviewAudioArtifacts').withIndex('by_episodeId_and_kind', q => q.eq('episodeId', episodeId)).take(10),
      cleanup: await ctx.db.query('pendingCleanup').withIndex('by_userId', q => q.eq('userId', USER_ID)).take(10),
    }))
    expect(stagedDeletion.overview).toMatchObject({ status: 'deleting' })
    expect(stagedDeletion.overview?.shareToken).toBeUndefined()
    expect(stagedDeletion.episode).toMatchObject({ status: 'deleting' })
    expect(stagedDeletion.artifacts).toHaveLength(2)
    expect(stagedDeletion.artifacts.every(artifact => artifact.status === 'deleting')).toBe(true)
    expect(stagedDeletion.cleanup).toHaveLength(2)
    expect(stagedDeletion.cleanup.map(row => row.r2Key).sort()).toEqual([
      `audio-overviews/jobs/${jobId}/episode.wav`,
      `audio-overviews/jobs/${jobId}/scenes/0-1.pcm`,
    ])
    expect(stagedDeletion.cleanup.every(row => row.audioArtifactId && row.userId === USER_ID)).toBe(true)

    for (const row of stagedDeletion.cleanup) {
      await t.mutation(internal.accountDeletion.removePendingCleanup, { id: row._id })
    }
    const scheduledAfterCleanup = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect()
      return jobs.map(job => job.name.replace('.', ':'))
    })
    expect(scheduledAfterCleanup).toContain('audioOverviewV2:deleteEpisodeBatch')
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await t.mutation(internal.audioOverviewV2.deleteEpisodeBatch, {
        overviewId: published.overviewId,
        userId: USER_ID,
      })
      if (result.state === 'metadata-removed') break
    }
    await t.mutation(internal.audioOverviews.deleteOverviewBatch, {
      overviewId: published.overviewId,
      userId: USER_ID,
    })
    expect(await t.run(ctx => ctx.db.get(published.overviewId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(episodeId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(published.artifactId))).toBeNull()
  })

  test('[P0] rejects publication before the scene quality gate passes', async () => {
    const { t, jobId, plan } = await setup()
    await t.mutation(api.audioOverviewV2.createPlan, plan)

    await expect(t.mutation(api.audioOverviewV2.publishFinalArtifact, {
      jobId,
      capability: CAPABILITY,
      artifact: {
        objectKey: `audio-overviews/jobs/${jobId}/episode.wav`,
        checksumSha256: HASH_B,
        byteLength: 44,
        contentType: 'audio/wav',
        container: 'wav',
        sampleRateHz: 24000,
        channelCount: 1,
        bitsPerSample: 16,
        durationMs: 30_000,
      },
      alignment: {},
    })).rejects.toThrow(/quality gate/i)
  })

  test('[P1] a failed pre-publication job stages every recorded R2 artifact for deletion', async () => {
    vi.useFakeTimers()
    const { t, jobId, taskId, plan } = await setup()
    await t.mutation(api.audioOverviewV2.createPlan, plan)
    const projection = await t.query(api.audioOverviewV2.getForWorkflow, { jobId, capability: CAPABILITY })
    const scene = projection?.scenes[0]
    if (!scene) throw new Error('Expected seeded scene')

    const recorded = await t.mutation(api.audioOverviewV2.recordSceneEvaluation, {
      jobId,
      capability: CAPABILITY,
      sceneId: scene._id,
      attempt: 1,
      passed: false,
      artifact: {
        objectKey: `audio-overviews/jobs/${jobId}/scenes/0/attempts/1.pcm`,
        checksumSha256: HASH_A,
        byteLength: 48_000,
        contentType: 'audio/L16;codec=pcm;rate=24000',
        container: 'pcm',
        sampleRateHz: 24000,
        channelCount: 1,
        bitsPerSample: 16,
        durationMs: 1_000,
      },
      checks: {
        claimsSupported: true,
        scriptedSpeakerPairValid: true,
        audioProfileMatches: true,
        speakerCountEvidence: 'not_measured',
        speakerConsistencyEvidence: 'not_measured',
        durationWithinTolerance: false,
        silenceWithinTolerance: true,
        clippingWithinTolerance: true,
        truncationFree: true,
        tempoWithinTolerance: true,
        directionsNotSpoken: true,
      },
      failureCode: 'duration',
      failureMessage: 'Too short',
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: 'failed', stage: 'failed' })
      await ctx.db.patch(taskId, { status: 'failed' })
    })

    await expect(t.mutation(internal.audioOverviewJobs.cleanupStagedMedia, { jobId }))
      .resolves.toMatchObject({ r2Enqueued: 1 })
    const state = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(recorded.artifactId),
      cleanup: await ctx.db.query('pendingCleanup')
        .withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', recorded.artifactId))
        .unique(),
    }))
    expect(state.artifact?.status).toBe('deleting')
    expect(state.cleanup).toMatchObject({
      userId: USER_ID,
      r2Key: `audio-overviews/jobs/${jobId}/scenes/0/attempts/1.pcm`,
      kind: 'r2',
    })
  })
})
