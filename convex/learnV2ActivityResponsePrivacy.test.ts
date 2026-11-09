/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { ACTIVITY_RESPONSE_CASES, LEGACY_ACTIVITY_CASES, activityResponseFixture, legacyActivityResponseFixture, exerciseActivityResponseLimit } from '../tests/fixtures/learn-v2-activity-responses'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'

vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001); vi.stubEnv('LEARN_V2_ENABLED', 'true') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test.each(LEGACY_ACTIVITY_CASES)('legacy %s aliases share activity authority through %s on direct pages and Journey', async (kind, scenario) => {
  const f = await legacyActivityResponseFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|legacy-activity-limit', kind)
  await exerciseActivityResponseLimit(f, scenario, async disclosed => {
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const authorizationId = await authorizeExport(f.owner)
    const page = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
    const attempt = page.page.find(row => row._id === f.legacyAttemptId)
    expect(attempt).toMatchObject({ serverScorePercent: 80, confidence: 4, attemptedAt: expect.any(Number), kind,
      bodyAvailability: disclosed ? 'available' : 'unavailable' })
    if (disclosed) expect(attempt).toHaveProperty('response', f.answer)
    else { expect(attempt).not.toHaveProperty('response'); expect(attempt).toHaveProperty('bodyUnavailableReason', 'evidence_unavailable') }
    vi.stubEnv('LEARN_V2_ENABLED', 'true')
    const response = (await f.t.run(ctx => ctx.db.get(f.submissionId!)))!
    if (response.scopeKind !== 'v2') throw new Error('Expected V2 history')
    const journey = await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: response.learningVoidId })
    const history = journey?.mastery.flatMap(row => row.attempts).filter(row => row._id === f.legacyAttemptId) ?? []
    if (kind === 'calibration') history.push(...journey?.calibration.attempts.filter(row => row._id === f.legacyAttemptId) ?? [])
    expect(history).toHaveLength(kind === 'calibration' ? 2 : 1)
    for (const alias of history) {
      expect(alias).toMatchObject({ serverScorePercent: 80, confidence: 4, attemptedAt: expect.any(Number),
        bodyAvailability: disclosed ? 'available' : 'unavailable' })
      if (disclosed) expect(alias).toHaveProperty('response', f.answer)
      else expect(alias).not.toHaveProperty('response')
    }
  })
})

test.each(ACTIVITY_RESPONSE_CASES)('%s activity targets stay local and bounded through %s on pages, Canvas and recovery', async (kind, scenario) => {
  const f = await activityResponseFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|activity-response-limit', kind)
  await exerciseActivityResponseLimit(f, scenario, async disclosed => {
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const authorizationId = await authorizeExport(f.owner)
    const page = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 16 } })
    const activity = page.page.find(row => row._id === f.activityId)
    expect(activity).toMatchObject({ threadId: f.threadId, status: 'submitted', updatedAt: expect.any(Number) })
    if (disclosed) expect(activity).toMatchObject({ submittedResponse: f.answer, diagnosticResponse: f.answer })
    else {
      expect(activity).toMatchObject({ bodyAvailability: 'unavailable', bodyUnavailableReason: 'evidence_unavailable' })
      expect(activity).not.toHaveProperty('submittedResponse')
      expect(activity).not.toHaveProperty('diagnosticResponse')
    }
    if (f.submissionId && f.target) {
      const bodies = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })
      const body = bodies.page.find(row => row.submissionId === f.submissionId)
      expect(body).toMatchObject({ submissionId: f.submissionId, bodyAvailability: disclosed ? 'available' : 'unavailable' })
      if (disclosed) expect(body).toMatchObject({ payload: { kind: 'text', text: f.answer } })
      else expect(body).not.toHaveProperty('payload')
      vi.stubEnv('LEARN_V2_ENABLED', 'true')
      const state = await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target })
      expect(state).toMatchObject({ work: { submissionId: f.submissionId, acceptedAt: expect.any(Number), assistanceSnapshot: expect.any(Object),
        body: { bodyAvailability: disclosed ? 'available' : 'unavailable' } } })
      if (disclosed) expect(JSON.stringify(state)).toContain(f.answer)
      else expect(JSON.stringify(state)).not.toContain(f.answer)
      vi.stubEnv('LEARN_V2_ENABLED', 'false')
    }
    if (kind !== 'snapshot') {
      vi.stubEnv('LEARN_V2_ENABLED', 'true')
      const canvas = await f.owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId: f.threadId })
      expect(canvas?.activity).toMatchObject({ planRevision: 1, response: disclosed ? f.answer : null })
    }
  })
})
