import { describe, expect, test, vi } from 'vitest'
import type { Id } from './_generated/dataModel'
import { orchestrateSourceFetch } from './learnV2SourceActions'
import { SafeFetchError } from '../server/utils/learn-v2-safe-fetch'

const sourceSnapshotId = 'source-id' as Id<'learnSourceSnapshots'>

describe('Learn V2 source action orchestration', () => {
  test('returns the authoritative committed response rather than the local fetch branch', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', leaseId: 'lease-id', leaseToken: 'lease-token', url: 'https://example.com', requestFingerprint: 'fingerprint' })
      .mockResolvedValueOnce({ sourceSnapshotId, status: 'unavailable', effectiveStatus: 'unavailable', unavailableReason: 'policy_denied', recordRevision: 2 })
    const result = await orchestrateSourceFetch({
      auth: { getUserIdentity: async () => ({ tokenIdentifier: 'owner' }) },
      runMutation,
    } as never, { sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'fetch' }, async () => ({
      finalUrl: 'https://example.com',
      publicLocator: 'https://example.com/',
      contentHash: 'a'.repeat(64),
      contentType: 'text/plain',
      wireBytes: 4,
      decodedBytes: 4,
      excerpt: 'text',
      trustClassification: 'untrusted_source_data',
      rights: { status: 'permitted', provenance: 'link_license', policyVersion: 'learn-v2.rights.v2' },
      fetchPolicyVersion: 'learn-v2.fetch.v2',
    }))
    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'policy_denied' })
    expect(runMutation).toHaveBeenCalledTimes(2)
  })

  test('releases the lease when post-I/O authorization rejects the commit', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', leaseId: 'lease-id', leaseToken: 'lease-token', url: 'https://example.com', requestFingerprint: 'fingerprint' })
      .mockRejectedValueOnce(new Error('Learn V2 access denied'))
      .mockResolvedValueOnce(true)
    await expect(orchestrateSourceFetch({
      auth: { getUserIdentity: async () => ({ tokenIdentifier: 'owner' }) },
      runMutation,
    } as never, { sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'fetch' }, async () => ({
      finalUrl: 'https://example.com',
      publicLocator: 'https://example.com/',
      contentHash: 'a'.repeat(64),
      contentType: 'text/plain',
      wireBytes: 4,
      decodedBytes: 4,
      trustClassification: 'untrusted_source_data',
      rights: { status: 'unknown', provenance: 'none', policyVersion: 'learn-v2.rights.v2' },
      fetchPolicyVersion: 'learn-v2.fetch.v2',
    }))).rejects.toThrow(/access denied/)
    expect(runMutation).toHaveBeenCalledTimes(3)
  })

  test('does not let lease cleanup failure replace a structured fetch outcome', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', leaseId: 'lease-id', leaseToken: 'lease-token', url: 'https://example.com', requestFingerprint: 'fingerprint' })
      .mockRejectedValueOnce(new Error('cleanup unavailable'))
    await expect(orchestrateSourceFetch({
      auth: { getUserIdentity: async () => ({ tokenIdentifier: 'owner' }) },
      runMutation,
    } as never, { sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'fetch' }, async () => {
      throw new SafeFetchError('network_failure', true)
    })).resolves.toMatchObject({ ok: false, retryable: true, reason: 'network_failure' })
    expect(runMutation).toHaveBeenCalledTimes(2)
  })

  test('returns retryable admission denial without fetching or committing', async () => {
    const runMutation = vi.fn().mockResolvedValueOnce({ kind: 'retryable_denial', reason: 'owner_concurrency' })
    const fetcher = vi.fn()
    await expect(orchestrateSourceFetch({
      auth: { getUserIdentity: async () => ({ tokenIdentifier: 'owner' }) },
      runMutation,
    } as never, { sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'fetch' }, fetcher)).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: 'owner_concurrency',
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(runMutation).toHaveBeenCalledTimes(1)
  })

  test('keeps every deadline outcome retryable through orchestration', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', leaseId: 'lease-id', leaseToken: 'lease-token', url: 'https://example.com', requestFingerprint: 'fingerprint' })
      .mockResolvedValueOnce(true)
    await expect(orchestrateSourceFetch({
      auth: { getUserIdentity: async () => ({ tokenIdentifier: 'owner' }) },
      runMutation,
    } as never, { sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'fetch' }, async () => {
      throw new SafeFetchError('deadline_exceeded')
    })).resolves.toMatchObject({ ok: false, retryable: true, reason: 'deadline_exceeded' })
    expect(runMutation).toHaveBeenCalledTimes(2)
  })
})
