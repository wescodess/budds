/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { BACKING_SOURCE_CASES, BACKING_SOURCE_KINDS, backingResponseFixture, replaceBackingDocument, purgeBackingResponse } from '../tests/fixtures/learn-v2-backing-response'

vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001); vi.stubEnv('LEARN_V2_ENABLED', 'true') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test.each(BACKING_SOURCE_KINDS.flatMap((kind, index) => BACKING_SOURCE_CASES.map(([change, ...allowed]) => [kind, change, allowed[index]!] as const)))(
  '%s backing authority after %s retains metadata and discloses=%s on pages, recovery and aliases', async (kind, change, allowed) => {
    const f = await backingResponseFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|backing-response', kind)
    const pages = async () => {
      vi.stubEnv('LEARN_V2_ENABLED', 'false')
      const authorizationId = await authorizeExport(f.owner)
      const read = (collection: 'learnResponseBodies' | 'learningThreadActivities') => f.owner.query(api.dataExport.getUserDataPage, {
        authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 },
      })
      const bodies = await read('learnResponseBodies')
      const activities = await read('learningThreadActivities')
      vi.stubEnv('LEARN_V2_ENABLED', 'true')
      return { bodies: bodies.page, activities: activities.page }
    }
    const assertDisclosure = async (disclosed: boolean, purged = false) => {
      const rows = await pages()
      const activity = rows.activities.find(row => row._id === f.activityId)
      expect(activity).toMatchObject({ threadId: f.threadId, updatedAt: expect.any(Number), status: purged && kind === 'snapshot' ? 'blocked' : 'submitted' })
      if (disclosed) expect(activity).toMatchObject({ submittedResponse: f.answer, diagnosticResponse: f.answer })
      else {
        expect(activity).toMatchObject({ bodyAvailability: 'unavailable', bodyUnavailableReason: 'evidence_unavailable' })
        expect(activity).not.toHaveProperty('submittedResponse')
        expect(activity).not.toHaveProperty('diagnosticResponse')
      }
      if (f.submissionId && f.target) {
        const body = rows.bodies.find(row => row.submissionId === f.submissionId)
        if (disclosed) expect(body).toMatchObject({ bodyAvailability: 'available', payload: { kind: 'text', text: f.answer } })
        else if (body) { expect(body).toMatchObject({ bodyAvailability: 'unavailable' }); expect(body).not.toHaveProperty('payload') }
        const state = await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target })
        expect(state).toMatchObject({ work: { submissionId: f.submissionId, acceptedAt: expect.any(Number), assistanceSnapshot: expect.any(Object) } })
        if (disclosed) expect(state).toMatchObject({ work: { body: { bodyAvailability: 'available', payload: { kind: 'text', text: f.answer } } } })
        else expect(JSON.stringify(state)).not.toContain(f.answer)
      }
      if (kind !== 'snapshot') {
        const canvas = await f.owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId: f.threadId })
        expect(canvas?.activity).toMatchObject({ response: disclosed ? f.answer : null, planRevision: 1 })
      }
    }
    await assertDisclosure(true)
    await replaceBackingDocument(f, change)
    await assertDisclosure(allowed)
    if (!allowed) {
      expect((await f.t.run(ctx => ctx.db.get(f.activityId)))?.submittedResponse).toBe(f.answer)
      await purgeBackingResponse(f)
      await f.t.finishAllScheduledFunctions(vi.runAllTimers)
      await assertDisclosure(false, true)
      expect((await f.t.run(ctx => ctx.db.get(f.activityId)))?.submittedResponse).toBeUndefined()
      if (f.submissionId) {
        expect(await f.t.run(ctx => ctx.db.get(f.submissionId!))).toMatchObject({ bodyAvailability: 'purged' })
        expect(await f.t.run(ctx => ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', f.userId).eq('submissionId', f.submissionId!)).take(2))).toEqual([])
      }
    }
  },
)
