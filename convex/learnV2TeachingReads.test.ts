import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION } from '../shared/learn-v2-assessment-disclosure'
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import type { LearnHelpAdmission } from './lib/learnV2HelpContract'
import { seedTeachingReads } from '../tests/fixtures/learn-v2-teaching-reads'
import { composeAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { reasonTextForActivity } from '../shared/learn-adaptive-controls'
import { storedPlan } from './learnAdaptiveRecovery'
import { api, internal } from './_generated/api'
import { HELP_OWNER, helpConsumerFixture } from '../tests/fixtures/learn-v2-help-consumers'

const policy = vi.hoisted(() => ({ responses: true }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses } } }
})
const modules = import.meta.glob('./**/*.ts')
beforeEach(() => { policy.responses = true; vi.stubEnv('AUDIO_OVERVIEW_WORKER_TOKEN','fixture-worker-token-000000000000000000000'); vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

async function fixture() {
  const s = await helpConsumerFixture(modules, false)
  const overviewId = await s.t.run(async ctx => {
    const audioFileId = await ctx.storage.store(new Blob(['audio fixture']))
    return await ctx.db.insert('audioOverviews', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId,
      title: 'Teaching audio', status: 'ready', sourceDocumentIds: [s.f.documentId],
      turns: [{ speaker: 'host_a', text: 'TEACHING_AUDIO_CANARY', audioFileId, durationMs: 1000 }],
      voiceProfile: { hostA: 'a', hostB: 'b' }, totalDurationMs: 1000 })
  })
  return { ...s, overviewId }
}

test.each(['getWithTurns', 'getTurnUrls'] as const)('audioOverviews.%s cannot return formative content without delivery accounting', async name => {
  const s = await fixture()
  const before = await s.exposures()
  await expect(s.owner.query(api.audioOverviews[name], { id: s.overviewId })).rejects.toThrow(/help_delivery_required/)
  expect(await s.exposures()).toEqual(before)
})

test.each(['getWithTurnsDelivery', 'getTurnUrlsDelivery'] as const)('audioOverviews.%s accounts once and refuses a later held-out check', async name => {
  const s = await fixture()
  const args = { id: s.overviewId, idempotencyKey: `teaching_read_${name}` }
  const before = (await s.exposures()).length
  const result = await s.owner.mutation(api.audioOverviews[name], args)
  expect(result.admission.status).toBe('authorized')
  expect(result.value).not.toBeNull()
  expect(await s.owner.mutation(api.audioOverviews[name], args)).toEqual(result)
  expect((await s.exposures()).slice(before).map(row => row.status)).toEqual(['granted'])
  await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { purpose: {
    kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' }, revision: 2 }))
  const denied = await s.owner.mutation(api.audioOverviews[name], args)
  expect(denied).toMatchObject({ admission: { status: 'denied', reasonCode: 'test_open' }, value: null })
  expect(JSON.stringify(denied)).not.toContain('TEACHING_AUDIO_CANARY')
  await expect(s.owner.query(api.audioOverviews[name === 'getWithTurnsDelivery' ? 'getWithTurns' : 'getTurnUrls'], { id: s.overviewId })).rejects.toThrow(/test_open/)
})

const readPaths = [
  ['courses.listByUser', () => ({})],
  ['courses.listByFolder', s => ({ folderId: s.f.folderId })],
  ['courses.get', s => ({ id: s.r.courseId })],
  ['courseSections.get', s => ({ id: s.r.sectionId })],
  ['courseSections.listByCourse', s => ({ courseId: s.r.courseId })],
  ['courseSections.getNextSection', s => ({ courseId: s.r.courseId, currentOrder: -1 })],
  ['courseSections.getOfflineCachePayload', s => ({ sectionId: s.r.sectionId })],
  ['quizzes.getWithQuestions', s => ({ id: s.r.quizId })],
  ['quizzes.getAttemptResults', s => ({ attemptId: s.r.attemptId })],
  ['flashcardRooms.getRoom', s => ({ roomId: s.r.roomId })],
  ['flashcardRooms.getRoomVersion', s => ({ versionId: s.r.versionId })],
  ['flashcardRooms.listRoomVersions', s => ({ roomId: s.r.roomId })],
  ['reviewItems.listDueForUser', () => ({})],
  ['reviewItems.listDueWithContext', () => ({})],
  ['reviewItems.listBySection', s => ({ sectionId: s.r.sectionId })],
  ['audioOverviews.getCourseScopedOverview', s => ({ id: s.r.overviewId })],
  ['audioOverviews.getByShareToken', s => ({ token: s.r.token })],
  ['audioOverviews.getTurnUrlsByShareToken', s => ({ token: s.r.token })],
  ['audioOverviewInterjections.listByOverview', s => ({ audioOverviewId: s.r.overviewId })],
  ['audioOverviewInterjections.getTurnUrls', s => ({ id: s.r.interjectionId })],
  ['audioOverviewInterjectionsV2.getForOwner', s => ({ interjectionId: s.r.interjectionV2Id })],
  ['audioOverviewInterjectionsV2.resolveMediaForOwner', s => ({ interjectionId: s.r.interjectionV2Id })],
  ['audioOverviewV2.getPlaybackForOwner', s => ({ overviewId: s.r.overviewId })],
  ['audioOverviewV2.getPlaybackByShareToken', s => ({ token: s.r.token })],
  ['audioOverviewV2.resolveMediaForOwner', s => ({ artifactId: s.r.artifactId })],
  ['audioOverviewV2.resolveMediaByShareToken', s => ({ token: s.r.token })],
  ['learnV2Journey.getMission', s=>({learningVoidId:s.f.learningVoidId})],
  ['learnV2Journey.getCurrentMission', ()=>({})],
  ['learnV2SessionContent.getSessionContent', s => ({ studySessionId: s.f.studySessionId })],
  ['learnV2Sources.listSourceReview', s => ({ blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { numItems: 8, cursor: null } })],
] satisfies Array<[string, (s: Awaited<ReturnType<typeof readFixture>>) => Record<string, unknown>]>

async function readFixture() {
  const s = await helpConsumerFixture(modules, false)
  await s.t.run(async ctx=>{ await ctx.db.patch(s.f.documentId,{r2Key:'fixture/source',contentHash:'a'.repeat(64),sourceRevision:`sha256:${'a'.repeat(64)}`}); await ctx.db.patch(s.f.sourceSnapshotId,{objectKey:'fixture/source',contentHash:'a'.repeat(64),sourceRevision:`sha256:${'a'.repeat(64)}`}) })
  const r = await s.t.run(async ctx => await seedTeachingReads(ctx, HELP_OWNER.tokenIdentifier, s.f.folderId, s.f.documentId, await ctx.storage.store(new Blob(['audio fixture']))))
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.documentId, {r2Key:'fixture/source'})
    await ctx.db.patch(s.f.sourceSnapshotId, { blueprintRevisionId: s.f.scope.blueprintRevisionId,objectKey:'fixture/source' })
    const opportunity=(await ctx.db.get(s.f.rows.learnAssessmentOpportunities))!
    if(opportunity.assessmentPins.kind!=='calibration') throw new Error('Expected calibration fixture')
    await ctx.db.patch(opportunity._id,{deliveryPins:{version:'learn-v2.response-delivery-pins.v1',confidenceRequested:false}})
    await ctx.db.patch(s.f.rows.learnAssessmentExposures,{projectionDigest:opportunity.assessmentPins.promptDigest,policyVersion:LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION,purpose:'calibration',itemId:undefined,itemRevision:undefined,caseId:opportunity.assessmentPins.caseId})
    await ctx.db.insert('sessionContentBlocks', { userId: HELP_OWNER.tokenIdentifier, sessionContentId: s.f.scope.contextPins.sessionContentId, kind: 'explanation', order: 0, content: 'TEACHING_SESSION_CANARY' })
  })
  return { ...s, r }
}

test.each(readPaths)('%s requires an accounted delivery and rechecks held-out status', async (path, input) => {
  const s = await readFixture()
  const args = input(s)
  const query = makeFunctionReference<'query', Record<string, unknown>, unknown>(path.replace('.', ':'))
  const delivery = makeFunctionReference<'mutation', Record<string, unknown>, { admission: LearnHelpAdmission, value: unknown }>(`${path.replace('.', ':')}Delivery`)
  const before = (await s.exposures()).length
  await expect(s.owner.query(query, args)).rejects.toThrow(/help_delivery_required/)
  expect((await s.exposures()).length).toBe(before)
  const command = { ...args, idempotencyKey: 'registered_teaching_read', ...(path.includes('resolveMedia')?{orchestrationToken:process.env.AUDIO_OVERVIEW_WORKER_TOKEN}: {}) }
  const result = await s.owner.mutation(delivery, command)
  expect(result.admission.status).toBe('authorized')
  expect(result.value).not.toBeNull()
  expect(await s.owner.mutation(delivery, command)).toEqual(result)
  expect((await s.exposures()).slice(before).filter(row => row.status === 'granted')).toHaveLength(1)
  policy.responses = false
  expect(await s.owner.query(query, args)).toEqual(result.value)
  policy.responses = true
  await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { purpose: { kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' }, revision: 2 }))
  await expect(s.owner.query(query, args)).rejects.toThrow(/test_open/)
  expect(await s.owner.mutation(delivery, command)).toMatchObject({ admission: { status: 'denied', reasonCode: 'test_open' }, value: null })
})

test.each(['audioOverviewV2.resolveMediaForOwner', 'audioOverviewV2.resolveMediaByShareToken', 'audioOverviewInterjectionsV2.resolveMediaForOwner'])('%s preparation returns only a private locator without recording delivery', async path => {
  const s = await readFixture()
  const entry = readPaths.find(([name]) => name === path)!
  const before = await s.exposures()
  const prepare = makeFunctionReference<'mutation', Record<string, unknown>, { admission: LearnHelpAdmission, value: unknown }>(`${path.replace('.', ':')}Preparation`)
  const result = await s.owner.mutation(prepare, { ...entry[1](s), idempotencyKey: 'media_preparation_only' })
  expect(result.admission.status).toBe('authorized')
  expect(result.value).toHaveProperty('objectKey')
  expect(result.value).not.toHaveProperty('utterances')
  expect(result.value).not.toHaveProperty('turns')
  expect(await s.exposures()).toEqual(before)
})

test.each(['listPendingForAttempt', 'listPendingForShadowAttempt'] as const)('quiz grading input %s cannot serve as formative or held-out help', async name => {
  const s = await readFixture()
  const before = await s.exposures()
  await expect(s.owner.query(api.quizAnswerAssessments[name],{attemptId:s.r.attemptId})).rejects.toThrow(/unavailable/)
  expect(await s.exposures()).toEqual(before)
  await s.t.run(ctx=>ctx.db.patch(s.f.rows.learnAssessmentOpportunities,{purpose:{kind:'measurement_cold',assignmentId:s.f.rows.learnMeasurementAssignments,protocolVersion:'protocol.fixture'}}))
  await expect(s.owner.query(api.quizAnswerAssessments[name],{attemptId:s.r.attemptId})).rejects.toThrow(/test_open/)
  policy.responses=false
  expect(await s.owner.query(api.quizAnswerAssessments[name],{attemptId:s.r.attemptId})).toEqual([])
})

test.each(['quizzes.startAttempt','quizzes.submitAnswer','quizzes.submitAllAnswers','quizzes.submitAttempt','quizzes.updateQuiz','quizzes.updateQuestion','learnV2Mastery.recordAssistanceUse'])('%s cannot return teaching through a mutation during a held-out check',async path=>{
  const s=await readFixture()
  await s.t.run(ctx=>ctx.db.patch(s.f.rows.learnAssessmentOpportunities,{purpose:{kind:'measurement_cold',assignmentId:s.f.rows.learnMeasurementAssignments,protocolVersion:'protocol.fixture'}}))
  const args=path==='quizzes.startAttempt'?{quizId:s.r.quizId,settings:{shuffleQuestions:false,showAllQuestions:false,immediateFeedback:false}}
    :path==='quizzes.submitAnswer'?{attemptId:s.r.attemptId,questionId:s.r.questionId,userAnswer:'My answer'}
      :path==='quizzes.submitAllAnswers'?{attemptId:s.r.attemptId,answers:[{questionId:s.r.questionId,userAnswer:'My answer'}]}
        :path==='quizzes.submitAttempt'?{quizId:s.r.quizId,answers:[{questionId:s.r.questionId,response:'My answer'}]}
          :path==='quizzes.updateQuiz'?{quizId:s.r.quizId,title:'My title'}
            :path==='quizzes.updateQuestion'?{questionId:s.r.questionId,question:'My question'}
              :{studySessionId:s.f.studySessionId,expectedSessionRevision:1,kind:'substantive_hint'}
  const command=makeFunctionReference<'mutation',Record<string,unknown>,unknown>(path.replace('.',':'))
  await expect(s.owner.mutation(command,args)).rejects.toThrow(/test_open/)
  expect((await s.exposures()).filter(row=>row.purpose==='teaching')).toHaveLength(0)
})

test('a cross-folder Quiz uses its source provenance rather than only its container', async()=>{
  const s=await readFixture()
  const otherFolder=await s.owner.mutation(api.folders.createFolder,{name:'Unrelated container'})
  await s.t.run(async ctx=>{
    await ctx.db.patch(s.r.quizId,{folderId:otherFolder})
    await ctx.db.patch(s.f.rows.learnAssessmentOpportunities,{purpose:{kind:'measurement_cold',assignmentId:s.f.rows.learnMeasurementAssignments,protocolVersion:'protocol.fixture'}})
  })
  expect(await s.owner.mutation(api.quizzes.getWithQuestionsDelivery,{id:s.r.quizId,idempotencyKey:'cross_folder_quiz'})).toMatchObject({admission:{status:'denied',reasonCode:'test_open'},value:null})
})

test.each(['audioOverviewJobs.getStepContext','audioOverviewJobs.getAlignmentContext','audioOverviewV2.getForWorkflow','audioOverviewV2.listAlignmentSegments'])('%s keeps capability reads out of contextual help',async path=>{
  const s=await readFixture(),capability='c'.repeat(43)
  const capabilityHash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(capability))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  const alignmentId=await s.t.run(async ctx=>{
    const job=(await ctx.db.get(s.r.jobId))!,artifact=(await ctx.db.get(s.r.artifactId))!
    await ctx.db.patch(job._id,{capabilityHash})
    const overview=(await ctx.db.get(s.r.overviewId))!
    await ctx.db.insert('audioOverviewJobTurns',{userId:HELP_OWNER.tokenIdentifier,jobId:job._id,taskId:job.taskId,order:0,speaker:'host_a',text:'TEACHING_CAPABILITY_CANARY',status:'ready',audioFileId:overview.turns[0]!.audioFileId,durationMs:1000,updatedAt:Date.now()})
    return await ctx.db.insert('audioOverviewAlignments',{userId:HELP_OWNER.tokenIdentifier,episodeId:artifact.episodeId,artifactId:artifact._id,jobId:job._id,status:'pending',segmentCount:0,createdAt:Date.now(),updatedAt:Date.now()})
  })
  const query=makeFunctionReference<'query',Record<string,unknown>,unknown>(path.replace('.',':'))
  const args={jobId:s.r.jobId,capability,...(path.endsWith('getAlignmentContext')?{turnOrder:0}:{}),...(path.endsWith('listAlignmentSegments')?{alignmentId,paginationOpts:{cursor:null,numItems:10}}:{})}
  await expect(s.owner.query(query,args)).rejects.toThrow(/unavailable/)
  await s.t.run(ctx=>ctx.db.patch(s.f.rows.learnAssessmentOpportunities,{purpose:{kind:'measurement_cold',assignmentId:s.f.rows.learnMeasurementAssignments,protocolVersion:'protocol.fixture'}}))
  await expect(s.owner.query(query,args)).rejects.toThrow(/test_open/)
  await s.t.run(ctx=>ctx.db.patch(s.f.rows.learnAssessmentOpportunities,{phase:'submitted_sealed',submissionId:s.f.rows.learnResponses}))
  expect(await s.owner.query(query,args)).not.toBeNull()
})

test('unscoped legacy teaching cannot use its container to prove irrelevance',async()=>{
  const s=await readFixture(),folderId=await s.owner.mutation(api.folders.createFolder,{name:'Unrelated container'})
  await s.t.run(async ctx=>{
    await ctx.db.patch(s.r.quizId,{folderId})
    await ctx.db.patch(s.r.questionId,{sourceDocumentId:undefined})
  })
  expect(await s.owner.mutation(api.quizzes.getWithQuestionsDelivery,{id:s.r.quizId,idempotencyKey:'unknown_legacy_teaching'})).toMatchObject({admission:{status:'denied',reasonCode:'disclosure_unknown'},value:null})
  await s.t.run(ctx=>ctx.db.patch(s.f.rows.learnAssessmentOpportunities,{phase:'submitted_sealed',submissionId:s.f.rows.learnResponses}))
  expect((await s.owner.mutation(api.quizzes.getWithQuestionsDelivery,{id:s.r.quizId,idempotencyKey:'unknown_legacy_teaching'})).admission.status).toBe('ordinary')
})

async function adaptiveReadFixture(type:'artifact_workspace'|'reflection_next_move'|'cited_explanation') {
  const s=await readFixture()
  await s.owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement,{enabled:true})
  await s.t.run(async ctx=>{
    const userId=HELP_OWNER.tokenIdentifier, activity=(await ctx.db.get(s.f.activityId))!
    const factual=type==='cited_explanation'
    const claimId=await ctx.db.insert('sessionContentClaims',{userId,sessionContentId:s.f.scope.contextPins.sessionContentId,order:0,claim:'TEACHING_EVIDENCE_CANARY',verifierVersion:'verifier.fixture',confidence:1})
    const supportId=await ctx.db.insert('learnClaimSupports',{userId,sessionContentClaimId:claimId,sourceExcerptId:s.f.sourceExcerptId,sourceSnapshotId:s.f.sourceSnapshotId,entailment:'entailed',verifierVersion:'verifier.fixture',confidence:1,conflictStatus:'clear',evidenceStatus:'evidence_available'})
    await ctx.db.insert('sessionContentBlocks',{userId,sessionContentId:s.f.scope.contextPins.sessionContentId,order:1,kind:'independent_application',content:'A separate practice challenge'})
    const references=[{claimId,supportId,sourceSnapshotId:s.f.sourceSnapshotId,sourceSnapshotRevision:1,sourceRecordRevision:1,sourceEffectiveStatus:'user_accepted' as const,verifierVersion:'verifier.fixture',integrityState:'accepted' as const}]
    const sequence=type==='artifact_workspace'?[{type:'artifact_workspace' as const,action:'save_artifact' as const,props:{prompt:'Make a plan',artifactKind:'plan' as const,starterText:'TEACHING_STARTER_CANARY'}}]
      :type==='reflection_next_move'?[{type:'reflection_next_move' as const,action:'accept_next_move' as const,props:{feedback:'TEACHING_REFLECTION_CANARY',nextMove:'Try a separate example',allowedDecisions:['accept','override','end'] as ('accept'|'override'|'end')[]}}]
        :[{type:'cited_explanation' as const,action:'continue' as const,props:{heading:'Explanation',explanation:'TEACHING_CANVAS_CANARY',sourceRefs:[String(s.f.sourceSnapshotId)]}}]
    const plan=await composeAdaptiveActivityPlan({...storedPlan(activity),replacesActivityId:undefined,
      objectiveId:factual?String(s.f.scope.objectiveId):null,activityClass:factual?'factual':'non_factual',purpose:'Practice a separate case',reasonCode:factual?'accepted_evidence_explanation':type==='reflection_next_move'?'reflect_on_demonstration':activity.reasonCode,
      primitiveSequence:sequence,requiredAction:type==='artifact_workspace'?{kind:'save_artifact',label:'Save artifact'}:type==='reflection_next_move'?{kind:'accept_next_move',label:'Accept next move'}:{kind:'continue',label:'Continue'},
      evaluationContract:{version:'learn-adaptive.evaluation.v1',kind:type==='artifact_workspace'?'learner_response':'acknowledgement',responseFormat:type==='artifact_workspace'?'long_text':'none',passingScorePercent:null},
      accessibilityMetadata:{heading:'Practice',instructions:'Complete the activity',focusTargetTestId:`learn-primitive-${type.replaceAll('_','-')}`,liveRegionMode:'polite'},
      pins:{learningVoidId:factual?String(s.f.learningVoidId):null,blueprintRevisionId:factual?String(s.f.scope.blueprintRevisionId):null,objectiveId:factual?String(s.f.scope.objectiveId):null,sessionContentId:factual?String(s.f.scope.contextPins.sessionContentId):null},
      evidenceReferences:factual?references.map(ref=>({...ref,claimId:String(ref.claimId),supportId:String(ref.supportId),sourceSnapshotId:String(ref.sourceSnapshotId)})):[],
      generationInputs:factual?{sessionContentRevision:1,sessionContentInputDigest:`sha256:${'a'.repeat(64)}`,generatorVersion:s.f.scope.contextPins.generatorVersion}:activity.generationInputs,
      decisionInputs:{...activity.decisionInputs,sourceInputs:factual?[{sourceSnapshotId:String(s.f.sourceSnapshotId),effectiveStatus:'user_accepted',recordRevision:1}]:[],sourceState:factual?'ready':'none',priorActivityId:type==='reflection_next_move'?'guided:1':null,priorOutcome:type==='reflection_next_move'?'completed':null}})
    const {pins:_pins,...stored}=plan
    await ctx.db.patch(activity._id,{...stored,threadId:s.f.threadId,primitivePlan:plan.primitivePlan,
      learningVoidId:factual?s.f.learningVoidId:null,blueprintRevisionId:factual?s.f.scope.blueprintRevisionId:null,objectiveId:factual?s.f.scope.objectiveId:null,sessionContentId:factual?s.f.scope.contextPins.sessionContentId:null,
      evidenceReferences:factual?references:[],status:factual?'started':'eligible',reasonText:reasonTextForActivity({activityClass:plan.activityClass,purpose:plan.purpose,reasonCode:plan.reasonCode,sourceState:plan.decisionInputs.sourceState})})
    await ctx.db.patch(s.f.threadId,{currentActivityId:activity._id,authorityKind:factual?'v2_mission':'standalone',learningVoidId:factual?s.f.learningVoidId:undefined,sourceScope:{kind:'folder',sourceId:String(s.f.folderId)},evidenceState:'ready',lifecycle:'active'})
  })
  return s
}

test.each([
  ['learnAdaptive.getArtifactCanvas','artifact_workspace'],['learnAdaptive.getReflectionCanvas','reflection_next_move'],
  ['learnAdaptiveCanvas.getCanvas','cited_explanation'],['learnAdaptiveEvidence.getThreadActivityEvidence','cited_explanation'],
] as const)('%s accounts actual teaching and blocks a newly opened check',async(path,type)=>{
  const s=await adaptiveReadFixture(type)
  const args={threadId:s.f.threadId,...(path.includes('Evidence')?{activityId:(await s.t.run(ctx=>ctx.db.get(s.f.activityId)))!.activityId}:{})}
  const query=makeFunctionReference<'query',Record<string,unknown>,unknown>(path.replace('.',':'))
  const delivery=makeFunctionReference<'mutation',Record<string,unknown>,{admission:LearnHelpAdmission,value:unknown}>(`${path.replace('.',':')}Delivery`)
  await expect(s.owner.query(query,args)).rejects.toThrow(/help_delivery_required/)
  const before=(await s.exposures()).length
  const result=await s.owner.mutation(delivery,{...args,idempotencyKey:'adaptive_teaching_read'})
  expect(result.admission.status).toBe('authorized')
  expect(JSON.stringify(result.value)).toContain('TEACHING_')
  expect((await s.exposures()).slice(before).filter(row=>row.status==='granted')).toHaveLength(1)
  await s.t.run(ctx=>ctx.db.patch(s.f.rows.learnAssessmentOpportunities,{purpose:{kind:'measurement_cold',assignmentId:s.f.rows.learnMeasurementAssignments,protocolVersion:'protocol.fixture'}}))
  expect(await s.owner.mutation(delivery,{...args,idempotencyKey:'adaptive_teaching_read'})).toMatchObject({admission:{status:'denied',reasonCode:'test_open'},value:null})
})

test.each(['audioOverviewV2.resolveMediaForOwner','audioOverviewV2.resolveMediaByShareToken','audioOverviewInterjectionsV2.resolveMediaForOwner'])('%s cannot accept a learner-supplied media delivery acknowledgement',async path=>{
  const s=await readFixture(),entry=readPaths.find(([name])=>name===path)!
  const delivery=makeFunctionReference<'mutation',Record<string,unknown>,unknown>(`${path.replace('.',':')}Delivery`)
  const before=await s.exposures()
  for(const orchestrationToken of [undefined,'forged-credential-000000000000000000000']) {
    await expect(s.owner.mutation(delivery,{...entry[1](s),idempotencyKey:'forged_media_delivery',...(orchestrationToken?{orchestrationToken}:{})})).rejects.toThrow('Invalid Audio Overview orchestration credential')
  }
  expect(await s.exposures()).toEqual(before)
})
