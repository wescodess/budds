import { deferred } from '../tests/support/timeout-isolation'
import { expect, test } from 'vitest'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'

const gate = deferred<undefined>()
const fixture = { summary: 'Goal:', nested: { evidenceRows: 64 }, rows: ['original'] }
const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const originalEnv = process.env.BUDDS_TIMEOUT_ISOLATION_PROBE
let counter = 0

test.fails('expires a predecessor before its deferred shared writes and finally cleanup', async () => {
  const previous = ADAPTIVE_V2_PILOT_MANIFEST.pilotApproved
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true })
  fixture.summary = 'predecessor'
  fixture.nested.evidenceRows = 1
  fixture.rows.push('predecessor')
  process.env.BUDDS_TIMEOUT_ISOLATION_PROBE = 'predecessor'
  counter++
  try {
    await gate.promise
    fixture.summary = 'Review daily.'
    fixture.nested.evidenceRows = 0
    process.env.BUDDS_TIMEOUT_ISOLATION_PROBE = 'late predecessor'
  } finally {
    Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: previous })
    fixture.summary = 'late cleanup'
  }
}, 30)

test('restores shared state and ignores the expired predecessor after a successor starts', async () => {
  expect(ADAPTIVE_V2_PILOT_MANIFEST).toEqual(originalManifest)
  expect(fixture).toEqual({ summary: 'Goal:', nested: { evidenceRows: 64 }, rows: ['original'] })
  expect(process.env.BUDDS_TIMEOUT_ISOLATION_PROBE).toBe(originalEnv)
  expect(counter).toBe(0)
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  fixture.summary = 'successor'
  gate.resolve(undefined)
  await Promise.resolve()
  await Promise.resolve()
  expect(ADAPTIVE_V2_PILOT_MANIFEST.pilotApproved).toBe(false)
  expect(fixture.summary).toBe('successor')
  expect(fixture.nested.evidenceRows).toBe(64)
  expect(process.env.BUDDS_TIMEOUT_ISOLATION_PROBE).toBe(originalEnv)
})

test.fails('preserves assertion failures in an active test', () => {
  expect('actual').toBe('expected')
})
