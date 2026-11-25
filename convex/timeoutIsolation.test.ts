import { createTimeoutScope, deferred } from '../tests/support/timeout-isolation'
import { expect, test, vi } from 'vitest'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'

const gate = deferred<undefined>()
const fixture = { summary: 'Goal:', nested: { evidenceRows: 64 }, rows: ['original'] }
const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const originalEnv = process.env.BUDDS_TIMEOUT_ISOLATION_PROBE
const sharedQueue = vi.fn().mockResolvedValue('default')
const expiredSignal = deferred<AbortSignal>()
let counter = 0

test.fails('expires a predecessor before its deferred shared writes and finally cleanup', async ({ signal }) => {
  const previous = ADAPTIVE_V2_PILOT_MANIFEST.pilotApproved
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true })
  fixture.summary = 'predecessor'
  fixture.nested.evidenceRows = 1
  fixture.rows.push('predecessor')
  process.env.BUDDS_TIMEOUT_ISOLATION_PROBE = 'predecessor'
  counter++
  expiredSignal.resolve(signal)
  sharedQueue.mockResolvedValueOnce('predecessor')
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
  const signal = await expiredSignal.promise
  expect(signal.aborted).toBe(true)
  expect(String(signal.reason)).toContain('timed out in 30ms')
  expect(await sharedQueue()).toBe('default')
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


test('keeps fake-clock callbacks owned by their expired predecessor', async () => {
  vi.useFakeTimers()
  const predecessor = createTimeoutScope()
  const lateWrite = () => { fixture.summary = 'late timer' }
  predecessor.run(() => { setTimeout(lateWrite, 10) })
  predecessor.close()
  fixture.summary = 'successor'
  await vi.advanceTimersByTimeAsync(10)
  expect(fixture.summary).toBe('successor')
  vi.useRealTimers()
})

test('rolls back interleaved stubs and direct writes without resurrecting a fake clock', () => {
  const original = process.env.BUDDS_TIMEOUT_ISOLATION_INTERLEAVE
  const predecessor = createTimeoutScope()
  predecessor.run(() => {
    vi.stubEnv('BUDDS_TIMEOUT_ISOLATION_INTERLEAVE', 'stub')
    process.env.BUDDS_TIMEOUT_ISOLATION_INTERLEAVE = 'direct'
    vi.stubGlobal('__buddsInterleaveProbe', 'stub')
    Object.assign(globalThis, { __buddsInterleaveProbe: 'direct' })
    vi.useFakeTimers()
    Object.assign(globalThis, { __buddsPropertyProbe: true })
    vi.useRealTimers()
  })
  predecessor.close()
  expect(process.env.BUDDS_TIMEOUT_ISOLATION_INTERLEAVE).toBe(original)
  expect('__buddsInterleaveProbe' in globalThis).toBe(false)
  expect('__buddsPropertyProbe' in globalThis).toBe(false)
  expect(Date).not.toHaveProperty('isFake')
  expect(setTimeout).not.toHaveProperty('clock')
})

test('evaluates assignment targets and keys once and restores shared array length', () => {
  const rows = [{ value: 0 }, { value: 0 }]
  let calls = 0
  let index = 0
  const target = () => { calls++; return rows[0]! }
  target().value = 7
  rows[index++]!.value += 2
  expect(calls).toBe(1)
  expect(index).toBe(1)
  expect(rows[0]!.value).toBe(9)
  const predecessor = createTimeoutScope()
  predecessor.run(() => { fixture.rows[4] = 'late array slot' })
  predecessor.close()
  expect(fixture.rows).toEqual(['original'])
})

test('expired background clock reads use the original function without entering a successor spy', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(123)
  expect(Date.now()).toBe(123)
  const predecessor = createTimeoutScope()
  predecessor.close()
  expect(typeof predecessor.run(Date.now)).toBe('number')
  expect(clock).toHaveBeenCalledTimes(1)
  clock.mockRestore()
})
