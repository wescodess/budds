/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { FunctionArgs } from 'convex/server'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|operational-events-owner' }
const originalFlag = process.env.LEARN_V2_ENABLED
beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

test('reconciles a committed diagnostic with a discarded save acknowledgement through public Canvas and paginated exports', async () => {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })

  const exportPages = async (collection: FunctionArgs<typeof api.dataExport.getUserDataPage>['collection']) => {
    const rows: unknown[] = []
    let cursor: string | null = null
    let pages = 0
    for (;;) {
      const result: { page: unknown[], isDone: boolean, continueCursor: string } = await owner.query(api.dataExport.getUserDataPage, {
        collection, paginationOpts: { cursor, numItems: 2 },
      })
      expect(result.page.length).toBeLessThanOrEqual(2)
      rows.push(...result.page)
      pages++
      if (result.isDone) return { rows, pages }
      expect(result.continueCursor).not.toBe(cursor)
      cursor = result.continueCursor
      if (pages >= 16) throw new Error('Expected bounded fixture export to finish')
    }
  }

  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Explain what I already understand while my evidence prepares.', outcome: 'State a gap for later practice.',
    intent: 'understand', availableTime: '15', sourceScope: { kind: 'pasted', contentDigest: `sha256:${'a'.repeat(64)}`, byteCount: 128 },
    idempotencyKey: 'operational-create-diagnostic',
  })
  if (created.kind !== 'created') throw new Error('Expected a public draft')
  const threadId = created.thread.id
  await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
    threadId, expectedRevision: 1, idempotencyKey: 'operational-prepare-diagnostic',
  })).resolves.toMatchObject({ kind: 'ok', revision: 2, value: { status: 'not_required' } })
  const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
    threadId, expectedRevision: 2, idempotencyKey: 'operational-continue-diagnostic',
  })
  if (continued.kind !== 'ok') throw new Error('Expected a public diagnostic')
  const saveArgs = {
    threadId, activityId: continued.value.activityId, expectedRevision: 3,
    response: 'My private diagnostic response identifies a gap without proving mastery.',
    idempotencyKey: 'operational-save-lost-acknowledgement',
  }
  const attemptsBeforeSave = await exportPages('masteryAttempts')
  const masteryBeforeSave = await exportPages('masteryRecords')
  expect(attemptsBeforeSave.rows).toEqual([])
  expect(masteryBeforeSave.rows).toEqual([])

  // Synthetic commit-with-lost-acknowledgement protocol: deliberately discard
  // the successful result. This does not simulate a real transport timeout.
  await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, saveArgs)
  const reconciledCanvas = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
  expect(reconciledCanvas).toMatchObject({ evidenceState: 'preparing', activity: {
    id: continued.value.activityId, status: 'submitted', response: saveArgs.response,
  } })
  const committedEvents = await exportPages('learnActivityEvents')
  expect(committedEvents.pages).toBeGreaterThan(1)
  expect(committedEvents.rows).toMatchObject([
    { eventType: 'thread_drafted' }, { eventType: 'thread_command_committed' }, { eventType: 'activity_eligible' },
    { eventType: 'activity_started' }, { eventType: 'meaningful_activity_started' },
    { eventType: 'meaningful_response', metadata: { activityClass: 'non_factual', boundaryOrdinal: 1, planRevision: 1 } },
    { eventType: 'activity_completed', metadata: { activityClass: 'non_factual', boundaryOrdinal: 1, planRevision: 1 } },
  ])
  const committedReceipts = await exportPages('learnActivityCommandReceipts')
  expect(committedReceipts.pages).toBeGreaterThan(1)
  expect(committedReceipts.rows).toMatchObject([
    { commandName: 'createThreadDraft' }, { commandName: 'prepareInitialDecision' },
    { commandName: 'continueStandaloneDiagnostic' }, { commandName: 'submitStandaloneDiagnostic', resultKind: 'ok' },
  ])
  for (const event of committedEvents.rows) expect(event).not.toHaveProperty('dedupeKeyHash')
  for (const receipt of committedReceipts.rows) {
    expect(receipt).not.toHaveProperty('requestFingerprint')
    expect(receipt).not.toHaveProperty('resultReference')
    expect(receipt).not.toHaveProperty('idempotencyKeyHash')
  }
  expect(JSON.stringify(committedEvents.rows)).not.toContain(saveArgs.response)
  expect(JSON.stringify(committedReceipts.rows)).not.toContain(saveArgs.response)

  const replay = await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, saveArgs)
  expect(replay).toMatchObject({ kind: 'ok', revision: 4, value: { status: 'submitted', activityId: continued.value.activityId } })
  expect(await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, saveArgs)).toEqual(replay)
  expect(await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })).toEqual(reconciledCanvas)
  expect(await exportPages('learnActivityEvents')).toEqual(committedEvents)
  expect(await exportPages('learnActivityCommandReceipts')).toEqual(committedReceipts)
  expect(await exportPages('masteryAttempts')).toEqual(attemptsBeforeSave)
  expect(await exportPages('masteryRecords')).toEqual(masteryBeforeSave)
  expect((await exportPages('learnJobs')).rows).toEqual([])
})
