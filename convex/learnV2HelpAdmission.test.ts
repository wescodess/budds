/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { LEARN_HELP_ADMISSION_VERSION, LEARN_HELP_LIMITS, type LearnHelpReference } from './lib/learnV2HelpContract'

const policy = vi.hoisted(() => ({ responses: true }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses } } }
})
const OWNER = { tokenIdentifier: 'https://owner.example|help-owner', subject: 'same-subject' }
const FOREIGN = { tokenIdentifier: 'https://foreign.example|help-owner', subject: OWNER.subject }
const modules = import.meta.glob('./**/*.ts')
const command = { version: LEARN_HELP_ADMISSION_VERSION, kind: 'chat' as const, idempotencyKey: 'help_command_1234567890' }
const HASH = `sha256:${'a'.repeat(64)}`
beforeEach(() => { policy.responses = true; vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

async function fixture(testOnly = true) {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, FOREIGN]) {
    await t.withIdentity(identity).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  }
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  const contract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const,
    instructions: 'Apply the rule.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'Correct application', weightPercent: 100 }] }
  const contractDigest = await privacyDigest(contract)
  await t.run(async ctx => {
    await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.scope.objectiveId, { depth: 'working', assessmentContract: contract })
    await ctx.db.insert('learnObjectiveSources', { userId: OWNER.tokenIdentifier, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
    await ctx.db.patch(f.scope.contextPins.studyPlanId, { activeRevisionId: f.scope.contextPins.studyPlanRevisionId })
    await ctx.db.patch(f.scope.contextPins.studyPlanRevisionId, { status: 'accepted', blueprintRevisionId: f.scope.blueprintRevisionId, blueprintRecordRevision: 1 })
    await ctx.db.patch(f.studySessionId, { status: 'in_progress', startedSessionContentId: f.scope.contextPins.sessionContentId, startedSessionContentRevision: 1, assistanceRevision: 0 })
    await ctx.db.patch(f.scope.contextPins.sessionContentId, { blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId,
      studyPlanRevisionId: f.scope.contextPins.studyPlanRevisionId, inputDigest: HASH, generatorVersion: f.scope.contextPins.generatorVersion })
    await ctx.db.patch(f.rows.learnAssessmentOpportunities, { assessmentContractVersion: contract.version, assessmentContractDigest: contractDigest, phase: 'test_open', submissionId: undefined,
      contextPins: { kind: 'planned_measurement', studyPlanId: f.scope.contextPins.studyPlanId,
        studyPlanRevisionId: f.scope.contextPins.studyPlanRevisionId, planRevision: 1, planRecordRevision: 1 },
      assessmentPins: { kind: 'measurement', itemPins: { ...f.itemPins, promptDigest: HASH, scoringSpecDigest: HASH, supportManifestDigest: HASH } },
      ...(!testOnly ? { purpose: { kind: 'calibration' as const }, contextPins: { kind: 'calibration' as const, origin: 'today' as const },
        assignmentId: undefined, assessmentPins: { kind: 'calibration' as const, caseId: f.itemPins.caseId, promptDigest: await privacyDigest(contract.instructions),
          assessmentContractVersion: contract.version, assessmentContractDigest: contractDigest, supportManifestDigest: HASH } } : {}) })
  })
  const owner = t.withIdentity(OWNER)
  const admit = (references: LearnHelpReference[] | null, key = command.idempotencyKey) => owner.mutation(api.learnV2Assistance.admitHelp, {
    ...command, idempotencyKey: key, scope: references ? { references } : null,
  })
  const exposures = () => t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(64))
  return { t, f, owner, admit, exposures }
}

describe('registered server-derived help admission', () => {
  test('ordinary with no open check needs no scope and creates no exposure', async () => {
    const s = await fixture()
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'submitted_sealed', submissionId: s.f.rows.learnResponses }))
    const before = await s.exposures()
    expect(await s.admit(null)).toEqual({ version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' })
    expect(await s.exposures()).toEqual(before)
  })
  test('capability off preserves ordinary help while opportunity-bound authorization remains disabled', async () => {
    const s = await fixture()
    policy.responses = false
    const before = await s.exposures()
    expect(await s.admit(null)).toMatchObject({ status: 'ordinary' })
    expect(await s.owner.mutation(api.learnV2Assistance.authorizeAssistance, { version: 'learn-v2.public-api.v1',
      kind: 'chat', idempotencyKey: command.idempotencyKey, assessmentOpportunityId: s.f.rows.learnAssessmentOpportunities }))
      .toMatchObject({ status: 'denied', reasonCode: 'disabled' })
    expect(await s.exposures()).toEqual(before)
  })
  test('context-free help fails closed rather than treating omitted context as unrelated', async () => {
    const s = await fixture()
    expect(await s.admit(null)).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  })
  test.each(['void', 'folder', 'document', 'snapshot', 'conversation', 'thread', 'audio'] as const)('shared %s context denies held-out help before dispatch and records only a denied fact', async kind => {
    const s = await fixture()
    if (kind === 'thread') await s.t.run(ctx => ctx.db.patch(s.f.threadId, { authorityKind: 'v2_mission', learningVoidId: s.f.learningVoidId }))
    const audioId = kind === 'audio' ? await s.t.run(ctx => ctx.db.insert('audioOverviews', { userId: OWNER.tokenIdentifier,
      folderId: s.f.folderId, title: 'Existing teaching', status: 'ready', turns: [], voiceProfile: { hostA: 'a', hostB: 'b' }, totalDurationMs: 0 })) : null
    const reference: LearnHelpReference = kind === 'void' ? { kind: 'learning_void', id: s.f.learningVoidId }
      : kind === 'folder' ? { kind: 'folder', id: s.f.folderId }
        : kind === 'document' ? { kind: 'document', id: s.f.documentId }
          : kind === 'snapshot' ? { kind: 'source_snapshot', id: s.f.sourceSnapshotId }
            : kind === 'thread' ? { kind: 'thread', id: s.f.threadId }
              : kind === 'audio' ? { kind: 'audio_overview', id: audioId! }
                : { kind: 'conversation', id: await s.owner.mutation(api.conversations.createConversation, { folderId: s.f.folderId, title: 'Old conversation' }) }
    const before = (await s.exposures()).length
    expect(await s.admit([reference])).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    expect(await s.admit([reference])).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    const after = await s.exposures()
    expect(after).toHaveLength(before + 1)
    expect(after.at(-1)).toMatchObject({ purpose: 'assistance_requested_denied', status: 'requested_denied' })
    expect((await s.t.run(ctx => ctx.db.get(s.f.studySessionId)))?.assistanceRevision).toBe(0)
  })
  test('disjoint owned work is ordinary; a client scope assertion alone is rejected', async () => {
    const s = await fixture()
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Separate work' })
    const before = await s.exposures()
    expect(await s.admit([{ kind: 'folder', id: folderId }])).toMatchObject({ status: 'ordinary' })
    expect(await s.exposures()).toEqual(before)
    await expect(s.owner.mutation(api.learnV2Assistance.admitHelp, { ...command, scope: null, unrelated: true } as never)).rejects.toThrow()
  })
  test('a source shared across disjoint Voids and folders still makes work relevant', async () => {
    const s = await fixture()
    const other = await s.t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
    await s.t.run(async ctx => {
      await ctx.db.patch(other.rows.learnAssessmentOpportunities, { phase: 'cancelled' })
      for (const id of [other.sourceIdentityId, s.f.sourceIdentityId]) await ctx.db.patch(id, {
        origin: 'user_url', folderDocumentId: undefined, externalKey: 'https://shared.example/rule', canonicalUrl: 'https://shared.example/rule' })
    })
    expect(await s.admit([{ kind: 'source_snapshot', id: other.sourceSnapshotId }])).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
  })
  test('foreign ownership, same subject under another issuer, and missing resources fail closed', async () => {
    const s = await fixture()
    const foreignFolder = await s.t.withIdentity(FOREIGN).mutation(api.folders.createFolder, { name: 'Foreign work' })
    expect(await s.admit([{ kind: 'folder', id: foreignFolder }])).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
    await s.t.run(ctx => ctx.db.delete(s.f.documentId))
    expect(await s.admit([{ kind: 'source_snapshot', id: s.f.sourceSnapshotId }])).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
    await expect(s.t.mutation(api.learnV2Assistance.admitHelp, { ...command, scope: null })).rejects.toThrow(/authenticated/)
  })
  test('bounded source overflow is unknown rather than proof of unrelated work', async () => {
    const s = await fixture()
    await s.t.run(async ctx => {
      const { _id: _id, _creationTime: _time, ...row } = (await ctx.db.get(s.f.sourceSnapshotId))!
      for (let index = 0; index < LEARN_HELP_LIMITS.sources; index++) await ctx.db.insert('learnSourceSnapshots', { ...row, revision: index + 2 })
    })
    const separate = await s.owner.mutation(api.folders.createFolder, { name: 'Separate' })
    expect(await s.admit([{ kind: 'folder', id: separate }])).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  })
  test('parent folder scope includes a check in a child folder, without treating sibling folders as the same scope', async () => {
    const s = await fixture()
    const parent = await s.owner.mutation(api.folders.createFolder, { name: 'Parent' })
    const sibling = await s.owner.mutation(api.folders.createFolder, { name: 'Sibling' })
    await s.t.run(async ctx => { await ctx.db.patch(s.f.folderId, { parentId: parent }); await ctx.db.patch(sibling, { parentId: parent }) })
    expect(await s.admit([{ kind: 'folder', id: parent }])).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    expect(await s.admit([{ kind: 'folder', id: sibling }])).toMatchObject({ status: 'ordinary' })
  })
  test.each(['preparing', 'ready', 'test_open'] as const)('owner-wide %s overflow denies even a disjoint scope', async phase => {
    const s = await fixture()
    await s.t.run(async ctx => {
      const { _id: _id, _creationTime: _time, ...row } = (await ctx.db.get(s.f.rows.learnAssessmentOpportunities))!
      await ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase })
      for (let index = 0; index < LEARN_HELP_LIMITS.openOpportunities; index++) await ctx.db.insert('learnAssessmentOpportunities', { ...row, phase, delayedCheckId: `extra-${phase}-${index}` })
    })
    const separate = await s.owner.mutation(api.folders.createFolder, { name: 'Separate' })
    expect(await s.admit([{ kind: 'folder', id: separate }])).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  })
  test('allowed opportunity help commits once, and a replay rechecks newly open held-out context', async () => {
    const s = await fixture(false)
    const refs: LearnHelpReference[] = [{ kind: 'folder', id: s.f.folderId }]
    const before = (await s.exposures()).length
    const first = await s.admit(refs)
    expect(first).toMatchObject({ status: 'authorized', authorizations: [{ assessmentOpportunityId: s.f.rows.learnAssessmentOpportunities }] })
    expect(await s.admit(refs)).toEqual(first)
    expect(await s.exposures()).toHaveLength(before + 1)
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { purpose: { kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' }, revision: 2 }))
    expect(await s.admit(refs)).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    expect((await s.exposures()).at(-1)).toMatchObject({ status: 'requested_denied' })
  })
})
