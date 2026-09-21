import { describe, expect, test } from 'vitest'
import { prepareAdaptiveCommand } from './adaptive-command-authority'

describe('Adaptive Learn command authority', () => {
  test('creates stable owner-scoped hashes and fingerprints without retaining the raw key', async () => {
    const first = await prepareAdaptiveCommand({
      userId: 'issuer|owner', commandName: 'endThread', targetId: 'thread-1',
      expectedRevision: 4, idempotencyKey: 'opaque-retry-key-0001', payload: { reasonCode: 'learner_done' },
    })
    const retry = await prepareAdaptiveCommand({
      userId: 'issuer|owner', commandName: 'endThread', targetId: 'thread-1',
      expectedRevision: 4, idempotencyKey: 'opaque-retry-key-0001', payload: { reasonCode: 'learner_done' },
    })
    const otherOwner = await prepareAdaptiveCommand({
      userId: 'issuer|other', commandName: 'endThread', targetId: 'thread-1',
      expectedRevision: 4, idempotencyKey: 'opaque-retry-key-0001', payload: { reasonCode: 'learner_done' },
    })

    expect(first).toEqual(retry)
    expect(first.idempotencyKeyHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.idempotencyKeyHash).not.toBe(otherOwner.idempotencyKeyHash)
    expect(JSON.stringify(first)).not.toContain('opaque-retry-key-0001')
  })

  test.each([
    { serverScorePercent: 90 },
    { verdict: 'pass' },
    { mastery: 'retained' },
    { nested: { providerModel: 'client-choice' } },
    { evidenceAcceptance: true },
  ])('rejects client-supplied authority before preparing a command: %j', async payload => {
    await expect(prepareAdaptiveCommand({
      userId: 'issuer|owner', commandName: 'submitResponse', targetId: 'thread-1',
      expectedRevision: 1, idempotencyKey: 'opaque-retry-key-0002', payload,
    })).rejects.toThrow(/authoritative field/i)
  })

  test('rejects malformed revisions, identifiers, keys, and oversized payloads', async () => {
    const base = { userId: 'issuer|owner', commandName: 'setIntent', targetId: 'thread-1', expectedRevision: 1, idempotencyKey: 'opaque-retry-key-0003', payload: {} }
    await expect(prepareAdaptiveCommand({ ...base, expectedRevision: 0 })).rejects.toThrow(/revision/i)
    await expect(prepareAdaptiveCommand({ ...base, idempotencyKey: 'short' })).rejects.toThrow(/idempotency/i)
    await expect(prepareAdaptiveCommand({ ...base, payload: { note: 'x'.repeat(12_001) } })).rejects.toThrow(/payload/i)
  })
})
