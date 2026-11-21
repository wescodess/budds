import type { MutationCtx } from '../../convex/_generated/server'
import type { Id } from '../../convex/_generated/dataModel'

export async function seedTeachingReads(ctx: Pick<MutationCtx, 'db'>, userId: string, folderId: Id<'folders'>, documentId: Id<'documents'>, audioFileId: Id<'_storage'>) {
  const now = Date.now(), text = 'TEACHING_READ_CANARY', hash = 'a'.repeat(64)
  const document=(await ctx.db.get(documentId))!
  const revision=document.sourceRevision!, contentHash=document.contentHash!, objectKey=document.r2Key??'fixture/source'
  const courseId = await ctx.db.insert('courses', { userId, folderId, title: 'Teaching course', status: 'ready', sourceType: 'folder', sourceConfidence: { docCount: 1, webPercent: 0 }, pace: 'steady', outlineSections: [{ title: 'Section', description: text, knowledgeType: 'conceptual', order: 0 }], completedSectionCount: 1, totalSectionCount: 1, webSearchEnabled: false, createdAt: now, updatedAt: now })
  await ctx.db.insert('courseSourceDocs', { userId, courseId, folderId, documentId })
  const sectionId = await ctx.db.insert('courseSections', { userId, courseId, order: 0, title: 'Section', knowledgeType: 'conceptual', status: 'completed', contentBlocks: [{ type: 'text', content: text, order: 0 }], masteryLevel: 'new' })
  const quizId = await ctx.db.insert('quizzes', { userId, folderId, title: 'Quiz', status: 'ready' })
  const questionId = await ctx.db.insert('quizQuestions', { userId, quizId, order: 0, question: text, type: 'free-response', correctAnswer: text, explanation: text, sourceDocumentId: documentId })
  const attemptId = await ctx.db.insert('quizAttempts', { userId, quizId, score: 0, total: 1, status: 'completed', completedAt: now })
  await ctx.db.insert('attemptAnswers', { attemptId, questionId, userAnswer: 'My own answer', isCorrect: false, answeredAt: now })
  const roomId = await ctx.db.insert('flashcardRooms', { userId, folderId, title: 'Cards', updatedAt: now, cardCount: 1 })
  const versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId, title: 'Cards', origin: 'ai', prompt: text, cardCount: 1 })
  await ctx.db.patch(roomId, { activeVersionId: versionId })
  const card = { userId, roomId, displayOrder: 0, term: text, definition: text, sourceDocumentId: documentId }
  const cardId = await ctx.db.insert('flashcardRoomCards', card)
  await ctx.db.insert('flashcardVersionCards', { ...card, versionId })
  await ctx.db.insert('reviewItems', { userId, courseId, sectionId, flashcardRoomCardId: cardId, prompt: text, answer: text, easeFactor: 2.5, interval: 1, repetitions: 0, nextReviewDate: '2000-01-01', flagged: false, createdAt: now })
  const taskId = await ctx.db.insert('tasks', { userId, folderId, type: 'audio-overview-generation', title: 'Audio', status: 'completed', createdAt: now, updatedAt: now })
  await ctx.db.patch(taskId, { audioOverviewRequest: { scope: {mode:'explicit', documentIds:[documentId]}, documents:[{documentId,folderId,filename:'fixture.txt',r2Key:objectKey,contentHash,sourceRevision:revision}], preferences:{lengthMinutes:5,complexity:'beginner'}, voiceProfile:{hostA:'asteria',hostB:'orion'},quotaDate:'2027-01-01' } })
  const jobId = await ctx.db.insert('audioOverviewJobs', { userId, folderId, taskId, idempotencyKey: 'teaching_audio_job', capabilityHash: 'fixture', status: 'completed', stage: 'complete', completedTurns: 1, createdAt: now, updatedAt: now })
  const manifestId = await ctx.db.insert('audioOverviewSourceManifests', { userId, folderId, taskId, jobId, schemaVersion: 2, revision: 'manifest.r1', contentHash: hash, planFingerprint: hash, entryCount: 1, frozenAt: now })
  const entryId = await ctx.db.insert('audioOverviewSourceManifestEntries', { userId, jobId, manifestId, order: 0, sourceId: 'source', documentId, revision, contentHash, displayReference: 'Source', objectKey, createdAt: now })
  const outlineId = await ctx.db.insert('audioOverviewOutlines', { userId, jobId, taskId, narrativeArc: text, learningObjectiveCount: 0, createdAt: now })
  const claimLedgerId = await ctx.db.insert('audioOverviewClaimLedgers', { userId, jobId, taskId, claimCount: 0, supportedClaimCount: 0, createdAt: now })
  const episodeId = await ctx.db.insert('audioOverviewEpisodes', { userId, folderId, jobId, taskId, sourceManifestId: manifestId, outlineId, claimLedgerId, schemaVersion: 2, title: 'Audio', model: 'fixture', audioProfileId: 'fixture', audioProfileVersion: '2', renderer: 'fixture', hostAVoice: 'a', hostBVoice: 'b', requestedLengthMinutes: 5, complexity: 'beginner', status: 'ready', sceneCount: 0, utteranceCount: 0, createdAt: now, updatedAt: now })
  const sceneId=await ctx.db.insert('audioOverviewScenes',{userId,episodeId,jobId,order:0,title:'Scene',narrativePurpose:'Explain',targetDurationMs:1000,status:'ready',currentAttempt:1,updatedAt:now})
  const utteranceId=await ctx.db.insert('audioOverviewUtterances',{userId,episodeId,sceneId,jobId,order:0,sceneOrder:0,speaker:'host_a',text,emotionalIntent:'calm',deliveryIntent:'clear',createdAt:now})
  await ctx.db.insert('audioOverviewUtteranceSources',{userId,episodeId,utteranceId,manifestEntryId:entryId,jobId,createdAt:now})
  await ctx.db.patch(episodeId,{sceneCount:1,utteranceCount:1})
  const artifact = { userId, jobId, episodeId, kind: 'final' as const, status: 'published' as const, storageProvider: 'r2' as const, objectKey: 'fixture/audio.wav', checksumSha256: hash, byteLength: 48044, contentType: 'audio/wav', container: 'wav' as const, sampleRateHz: 24000 as const, channelCount: 1 as const, bitsPerSample: 16 as const, durationMs: 1000, createdAt: now, publishedAt: now }
  const artifactId = await ctx.db.insert('audioOverviewAudioArtifacts', artifact)
  const overviewId = await ctx.db.insert('audioOverviews', { userId, folderId, title: 'Audio', taskId, episodeId, finalArtifactId: artifactId, status: 'ready', sourceDocumentIds: [documentId], turns: [{ speaker: 'host_a', text, audioFileId, durationMs: 1000 }], voiceProfile: { hostA: 'a', hostB: 'b' }, totalDurationMs: 1000, shareToken: 'a'.repeat(32), publishedAt: now })
  await ctx.db.patch(episodeId, { finalArtifactId: artifactId, compatibilityOverviewId: overviewId })
  const interjectionId = await ctx.db.insert('audioOverviewInterjections', { userId, audioOverviewId: overviewId, question: 'My own question', insertedAfterTurnIndex: 0, answerTurns: [{ speaker: 'host_a', text, audioFileId, durationMs: 1000 }] })
  const interjectionV2Id = await ctx.db.insert('audioOverviewInterjectionsV2', { userId, audioOverviewId: overviewId, jobId, episodeId, sourceManifestId: manifestId, idempotencyKey: 'interjection', insertedAfterTurnIndex: 0, question: 'My own question', model: 'fixture', audioProfileId: 'fixture', audioProfileVersion: '2', renderer: 'fixture', hostAVoice: 'a', hostBVoice: 'b', status: 'ready', utteranceCount: 2, createdAt: now, updatedAt: now })
  for (let order=0; order<2; order++) {
    const utteranceId = await ctx.db.insert('audioOverviewInterjectionUtterances', { userId, interjectionId: interjectionV2Id, episodeId, order, speaker: order===0?'host_a':'host_b', text, createdAt: now })
    await ctx.db.insert('audioOverviewInterjectionSources', { userId, interjectionId:interjectionV2Id, episodeId, utteranceId, manifestEntryId:entryId, createdAt:now })
  }
  const interjectionArtifactId = await ctx.db.insert('audioOverviewAudioArtifacts', { ...artifact, kind: 'interjection', interjectionId: interjectionV2Id })
  await ctx.db.patch(interjectionV2Id, { artifactId: interjectionArtifactId })
  return { courseId, sectionId, quizId, questionId, attemptId, roomId, versionId, overviewId, artifactId, interjectionId, interjectionV2Id, jobId, token: 'a'.repeat(32) }
}
