import type { TestConvex } from 'convex-test'
import type { GenericValidator } from 'convex/values'
import { api, internal } from '../../convex/_generated/api'
import schema from '../../convex/schema'
import { privacyDigest } from '../../convex/lib/learnV2ResponsePrivacy'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../../shared/learn-v2-responses'
import { seedMeasurementStorage } from './learn-v2-measurement-storage'

// Each case names a field actually disclosed by an export projection. This
// audit stays independent of the authorization inventory and tests real pages.
export const PERSONAL_EXPORT_CONTENT_CASES = [
  ['folders', 'description'], ['documents', 'filename'], ['messages', 'content'], ['quizzes', 'description'],
  ['quizQuestions', 'question'], ['quizAttempts', 'answers'], ['quizAnswerAssessments', 'learnerAnswerSnapshot'],
  ['flashcardSets', 'failureReason'], ['flashcards', 'front'], ['flashcardRoomCards', 'definition'],
  ['flashcardRoomVersions', 'prompt'], ['flashcardVersionCards', 'definition'], ['courses', 'outlineSections'],
  ['courseSections', 'contentBlocks'], ['tasks', 'result'], ['reviewItems', 'answer'], ['calendarEvents', 'description'],
  ['audioOverviewJobs', 'error'], ['audioOverviewOutlines', 'narrativeArc'], ['audioOverviewLearningObjectives', 'text'],
  ['audioOverviewClaims', 'text'], ['audioOverviewEpisodes', 'failureReason'], ['audioOverviewScenes', 'narrativePurpose'],
  ['audioOverviewUtterances', 'text'], ['audioOverviewSceneQualityGates', 'failureMessage'], ['audioOverviewAlignments', 'error'],
  ['audioOverviewAlignmentSegments', 'word'], ['audioOverviewJobTurns', 'text'], ['audioOverviews', 'turns'],
  ['audioOverviewInterjections', 'question'], ['audioOverviewInterjectionsV2', 'question'], ['audioOverviewInterjectionUtterances', 'text'],
  ['learnObjectives', 'capability'], ['learningThreads', 'originalNeed'],
  ['learningThreadActivities', 'submittedResponse'], ['learningThreadArtifacts', 'summary'], ['learningThreadPreferences', 'value'],
  ['masteryAttempts', 'response'], ['learnResponseBodies', 'payload'],
] as const

export async function measurementExportFixture(t: TestConvex<typeof schema>, tokenIdentifier: string) {
  const owner = t.withIdentity({ tokenIdentifier })
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier, enabled: true })
  const f = await t.run(ctx => seedMeasurementStorage(ctx, tokenIdentifier))
  const hash = `sha256:${'a'.repeat(64)}`
  const contract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const,
    instructions: 'Apply the rule.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'Correct application', weightPercent: 100 }] }
  const capability = { ...f.scope, assessmentContractVersion: contract.version, assessmentContractDigest: await privacyDigest(contract) }
  const { scopeKind: _scope, contextPins: context, ...pins } = capability
  const assessmentOpportunityId = await t.run(async ctx => {
    for (const table of ['learnResponses', 'learnResponseBodies', 'learnResponseEvidenceLinks', 'learnResponseIntegrityEvents',
      'learnResponseCommandReceipts', 'learnScoringExecutions', 'learnMeasurementReportFacts', 'learnMeasurementSourceWatermarks', 'learnAssessmentExposures'] as const) {
      for (const row of await ctx.db.query(table).take(8)) await ctx.db.delete(row._id)
    }
    await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: pins.blueprintRevisionId })
    await ctx.db.patch(pins.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(pins.objectiveId, { depth: 'working', assessmentContract: contract })
    await ctx.db.patch(context.studyPlanId, { activeRevisionId: context.studyPlanRevisionId })
    await ctx.db.patch(context.studyPlanRevisionId, { status: 'accepted', blueprintRevisionId: pins.blueprintRevisionId, blueprintRecordRevision: 1 })
    const assignment = (await ctx.db.get(f.rows.learnMeasurementAssignments))!
    if (assignment.status !== 'admitted' || assignment.allocation.kind !== 'three_case') throw new Error('Missing admitted fixture')
    const allocation = { ...assignment.allocation }
    for (const horizon of ['cold', 'day7', 'day30'] as const) {
      allocation[horizon] = { ...allocation[horizon], promptDigest: hash, scoringSpecDigest: hash, supportManifestDigest: hash }
      await ctx.db.patch(allocation[horizon].itemId, { ...pins, promptDigest: hash, scoringSpecDigest: hash, supportManifestDigest: hash })
      await ctx.db.patch(allocation[horizon].scoringSpecId, { ...pins, digest: hash })
    }
    await ctx.db.patch(f.rows.learnMeasurementFamilies, pins)
    await ctx.db.patch(f.rows.learnMeasurementValidations, pins)
    await ctx.db.patch(assignment._id, { ...pins, allocation })
    const opportunity = (await ctx.db.get(f.rows.learnAssessmentOpportunities))!
    await ctx.db.patch(opportunity._id, { ...pins, contextPins: { kind: 'planned_measurement', studyPlanId: context.studyPlanId,
      studyPlanRevisionId: context.studyPlanRevisionId, planRevision: 1, planRecordRevision: 1 },
    assessmentPins: { kind: 'measurement', itemPins: allocation.cold }, phase: 'test_open', submissionId: undefined, revision: 1,
    openAt: Date.now() - 1000, closeAt: Date.now() + 100000,
    deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: false } })
    const grant = await ctx.db.insert('learnAssessmentExposures', { ...f.base, learningVoidId: f.learningVoidId,
      blueprintRevisionId: pins.blueprintRevisionId, objectiveId: pins.objectiveId, assessmentOpportunityId: opportunity._id,
      ...{ caseId: allocation.cold.caseId, itemId: allocation.cold.itemId, itemRevision: 1, familyId: allocation.cold.familyId, formLabel: allocation.cold.formLabel },
      purpose: 'cold_measurement', status: 'granted', projectionDigest: hash, deliveryReceiptHash: hash, serverTime: Date.now() - 1,
      policyVersion: 'delivery.v1', provenanceVersion: 'delivery.v1' })
    await ctx.db.patch(opportunity._id, { deliveryGrantId: grant })
    return opportunity._id
  })
  const submission = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'export_response_1234567890',
    response: { target: { assessmentOpportunityId }, expectedRevision: 1, payload: { kind: 'text' as const, text: 'An independent response' } } }
  return { t, f, owner, submission, assessmentOpportunityId, tokenIdentifier }
}

// Minimum structurally valid rows for unrelated product collections. Opaque
// reference IDs need no target for raw owner export; guarded response/activity
// cases below use real owned parents and canonical evidence instead.
function fixtureValue(validator: GenericValidator, text: string, includeOptional = false): unknown {
  switch (validator.kind) {
    case 'id': return `0${validator.tableName}`
    case 'string': case 'any': return text
    case 'float64': return 1
    case 'int64': case 'commitTs': return 1n
    case 'boolean': return false
    case 'null': return null
    case 'bytes': return new ArrayBuffer(0)
    case 'literal': return validator.value
    case 'array': return [fixtureValue(validator.element, text, includeOptional)]
    case 'union': return fixtureValue(validator.members.find((value: GenericValidator) => value.kind !== 'null') ?? validator.members[0]!, text, includeOptional)
    case 'object': return Object.fromEntries(Object.entries(validator.fields as Record<string, GenericValidator>).filter(([, field]) => includeOptional || field.isOptional !== 'optional')
      .map(([key, field]) => [key, fixtureValue(field, text, includeOptional)]))
    case 'record': return {}
    default: throw new Error('Unsupported fixture validator')
  }
}

export async function seedExportContent(fixture: Awaited<ReturnType<typeof measurementExportFixture>>,
  entry: readonly [typeof PERSONAL_EXPORT_CONTENT_CASES[number][0], typeof PERSONAL_EXPORT_CONTENT_CASES[number][1]]) {
  const [collection, field] = entry
  const canary = `exported ${collection} answer canary`
  const { t, f, tokenIdentifier } = fixture
  const id = await t.run(async ctx => {
    if (collection === 'learningThreadActivities') {
      const { _id: _id, _creationTime: _time, ...activity } = (await ctx.db.get(f.activityId))!
      return await ctx.db.insert(collection, { ...activity, submittedResponse: canary })
    }
    if (collection === 'masteryAttempts') return await ctx.db.insert(collection, { userId: tokenIdentifier,
      objectiveId: f.scope.objectiveId, attemptedAt: Date.now() - 1, idempotencyKey: 'exported-legacy-answer', response: canary,
      sourceSnapshotIdsJson: JSON.stringify([f.sourceSnapshotId]) })
    if (collection === 'learnResponseBodies') {
      const slot = (await ctx.db.get(f.rows.learnResponseSlots))!
      const payload = { kind: 'text' as const, text: canary }
      const payloadDigest = await privacyDigest(payload)
      const receiptId = await ctx.db.insert('learnResponseCommandReceipts', { ...f.base, learningVoidId: f.learningVoidId,
        idempotencyKeyHash: 'prior-response', requestDigest: 'prior-response', commandVersion: 'response.v1',
        result: { kind: 'rejected', reasonCode: 'preparation' }, expiresAt: Date.now() + 90 * 86400000 })
      const responseId = await ctx.db.insert('learnResponses', { ...f.base, ...f.scope, evidenceStatus: 'available', responseSlotId: slot._id,
        payloadDigest, acceptedAt: Date.now() - 1, receiptId, assistanceSnapshot: f.assistanceSnapshot,
        validitySnapshot: { ...f.validitySnapshot, status: 'excluded', measurementEligible: false, exclusionReasons: ['formative'] },
        currentEligibility: 'excluded', bodyAvailability: 'available', responseContractVersion: 'response.v1', disclosurePolicyVersion: 'disclosure.v1' })
      await ctx.db.patch(slot._id, { status: 'accepted', submissionId: responseId })
      await ctx.db.insert('learnResponseEvidenceLinks', { ...f.base, learningVoidId: f.learningVoidId, aggregate: { learningVoidId: f.learningVoidId },
        submissionId: responseId, evidenceStatus: 'available', dependency: { kind: 'snapshot', sourceSnapshotId: f.sourceSnapshotId,
          sourceSnapshotRevision: 1, sourceRecordRevision: 1, supportManifestDigest: 'support-hash' } })
      return await ctx.db.insert(collection, { ...f.base, learningVoidId: f.learningVoidId, submissionId: responseId,
        payload, payloadDigest, payloadBytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength })
    }
    const validator = schema.tables[collection].validator
    const fields = validator.fields as Record<string, GenericValidator>
    if (!fields[field]) throw new Error(`Missing ${collection}.${field}`)
    const row = fixtureValue(validator, 'fixture') as Record<string, unknown>
    row[field] = fixtureValue(fields[field], canary, true)
    row.userId = tokenIdentifier
    if (collection === 'learningThreadArtifacts') row.status = 'saved'
    return await ctx.db.insert(collection, row as never)
  })
  return { collection, field, canary, id }
}
