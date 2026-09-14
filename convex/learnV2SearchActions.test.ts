import { describe, expect, test, vi } from 'vitest'
import type { Id } from './_generated/dataModel'
import { orchestratePublicSearch, orchestrateSearchReconciliation } from './learnV2SearchActions'
import { TavilyFreeSearchError } from '../server/utils/tavily-free-search'

const args = {
  learningVoidId: 'void-id' as Id<'learningVoids'>,
  blueprintRevisionId: 'blueprint-id' as Id<'learnBlueprintRevisions'>,
  expectedVoidRevision: 2,
  expectedBlueprintRecordRevision: 1,
  query: 'history of solar energy in Ontario',
  idempotencyKey: 'public-search-1',
}
const config = { apiKey: 'tvly-test-key', projectId: 'budds-v2' }
const usage = { plan: 'Researcher' as const, keyUsage: 0, keyLimit: 800, planUsage: 0, planLimit: 1000, paygoUsage: 0, paygoLimit: 0 as const }

function context(runMutation: ReturnType<typeof vi.fn>) {
  return {
    auth: { getUserIdentity: async () => ({ tokenIdentifier: 'owner' }) },
    runMutation,
  } as never
}

describe('Learn V2 public search action', () => {
  test('preflights free usage, authorizes one dispatch, and exposes results only after consume', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', reservationId: 'reservation-id', executionToken: 'execution-token', revision: 1, productMonthConsumed: 0 })
      .mockResolvedValueOnce({ kind: 'acquired', revision: 1 })
      .mockResolvedValueOnce({ kind: 'authorized', revision: 2 })
      .mockResolvedValueOnce({ status: 'consumed', revision: 3 })
    const search = vi.fn(async () => ({
      requestIdHashInput: 'provider-request',
      credits: 1 as const,
      results: [{ title: 'Solar', url: 'https://example.org/solar', snippet: 'Discovery only.' }],
    }))

    await expect(orchestratePublicSearch(context(runMutation), args, {
      config: () => config,
      usage: async () => usage,
      search,
    })).resolves.toEqual({
      ok: true,
      status: 'consumed',
      credits: 1,
      discoveryOnly: true,
      results: [{ title: 'Solar', url: 'https://example.org/solar', snippet: 'Discovery only.' }],
    })
    expect(search).toHaveBeenCalledTimes(1)
    expect(runMutation).toHaveBeenCalledTimes(4)
  })

  test('fails closed before search when usage cannot prove zero-paid configuration', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', reservationId: 'reservation-id', executionToken: 'execution-token', revision: 1, productMonthConsumed: 0 })
      .mockResolvedValueOnce({ kind: 'acquired', revision: 1 })
      .mockResolvedValueOnce({ status: 'released' })
    const search = vi.fn()

    await expect(orchestratePublicSearch(context(runMutation), args, {
      config: () => config,
      usage: async () => { throw new TavilyFreeSearchError('free_plan_required', false) },
      search,
    })).resolves.toMatchObject({ ok: false, status: 'released', results: [] })
    expect(search).not.toHaveBeenCalled()
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({ openCircuit: true, outcomeCode: 'usage_policy_denied' })
  })

  test('never dispatches for a durable replay or in-flight reservation', async () => {
    for (const admission of [
      { kind: 'replayed_consumed', status: 'consumed' },
      { kind: 'reconciliation_required', status: 'reserved' },
      { kind: 'in_flight', status: 'reserved' },
      { kind: 'replayed_released', status: 'released', reconciliationRequired: true },
    ]) {
      const runMutation = vi.fn().mockResolvedValueOnce(admission)
      const providerUsage = vi.fn()
      const search = vi.fn()
      const result = await orchestratePublicSearch(context(runMutation), args, {
        config: () => config,
        usage: providerUsage,
        search,
      })
      expect(providerUsage).not.toHaveBeenCalled()
      expect(search).not.toHaveBeenCalled()
      expect(runMutation).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        ok: admission.kind === 'replayed_consumed',
        replayed: true,
        status: admission.status,
        reconciliationRequired: Boolean(admission.reconciliationRequired),
        results: [],
      })
    }
  })

  test.each([
    { kind: 'period_stale', status: 'released', reconciliationRequired: false },
    { kind: 'usage_drift', status: 'released', reconciliationRequired: true },
  ])('does not search after dispatch authorization returns $kind', async (dispatch) => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', reservationId: 'reservation-id', executionToken: 'execution-token', revision: 1 })
      .mockResolvedValueOnce({ kind: 'acquired', revision: 1 })
      .mockResolvedValueOnce(dispatch)
    const search = vi.fn()
    const result = await orchestratePublicSearch(context(runMutation), args, {
      config: () => config,
      usage: async () => usage,
      search,
    })
    expect(search).not.toHaveBeenCalled()
    expect(runMutation).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      ok: false,
      status: 'released',
      reconciliationRequired: dispatch.reconciliationRequired,
      results: [],
    })
  })

  test('keeps every post-dispatch provider failure reserved and reconciliation-required', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', reservationId: 'reservation-id', executionToken: 'execution-token', revision: 1, productMonthConsumed: 0 })
      .mockResolvedValueOnce({ kind: 'acquired', revision: 1 })
      .mockResolvedValueOnce({ kind: 'authorized', revision: 2 })
      .mockResolvedValueOnce({ status: 'reserved', reconciliationRequired: true, revision: 3 })
    const rawQuery = args.query
    const result = await orchestratePublicSearch(context(runMutation), args, {
      config: () => config,
      usage: async () => usage,
      search: async () => { throw new TavilyFreeSearchError('provider_unavailable', true) },
    })
    expect(result).toEqual({
      ok: false,
      status: 'reserved',
      reconciliationRequired: true,
      reason: 'public_search_unavailable',
      results: [],
    })
    expect(JSON.stringify(result)).not.toContain(rawQuery)
    expect(runMutation.mock.calls[3]?.[1]).toMatchObject({ outcomeCode: 'provider_unavailable' })
  })

  test('withholds transient results when authoritative settlement fails', async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce({ kind: 'acquired', reservationId: 'reservation-id', executionToken: 'execution-token', revision: 1, productMonthConsumed: 0 })
      .mockResolvedValueOnce({ kind: 'acquired', revision: 1 })
      .mockResolvedValueOnce({ kind: 'authorized', revision: 2 })
      .mockRejectedValueOnce(new Error('ledger unavailable'))
      .mockResolvedValueOnce({ status: 'reserved', reconciliationRequired: true })
    const result = await orchestratePublicSearch(context(runMutation), args, {
      config: () => config,
      usage: async () => usage,
      search: async () => ({ requestIdHashInput: 'provider-request', credits: 1, results: [{ title: 'Private result', url: 'https://example.org', snippet: 'must not escape' }] }),
    })
    expect(result).toMatchObject({ ok: false, status: 'reserved', reconciliationRequired: true, results: [] })
    expect(JSON.stringify(result)).not.toContain('must not escape')
    expect(runMutation).toHaveBeenCalledTimes(5)
  })

  test('rejects unsafe query text before config, ledger, or network work', async () => {
    const runMutation = vi.fn()
    const configAdapter = vi.fn(() => config)
    const providerUsage = vi.fn()
    const search = vi.fn()
    await expect(orchestratePublicSearch(context(runMutation), {
      ...args,
      query: 'read /Users/alice/private-notes.md',
    }, { config: configAdapter, usage: providerUsage, search })).rejects.toThrow('Public search query denied')
    expect(configAdapter).not.toHaveBeenCalled()
    expect(runMutation).not.toHaveBeenCalled()
    expect(providerUsage).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
  })

  test('passes only strict fresh usage evidence into reconciliation', async () => {
    const runMutation = vi.fn().mockResolvedValue({ status: 'consumed' })
    await orchestrateSearchReconciliation({ runMutation } as never, {
      reservationId: 'reservation-id' as Id<'searchReservations'>,
      expectedRevision: 3,
      idempotencyKey: 'reconcile-from-provider',
    }, {
      config: () => config,
      usage: async () => ({ ...usage, keyUsage: 1 }),
    })
    expect(runMutation).toHaveBeenCalledTimes(1)
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      reservationId: 'reservation-id',
      expectedRevision: 3,
      idempotencyKey: 'reconcile-from-provider',
      providerKeyUsage: 1,
    })
    expect(runMutation.mock.calls[0]?.[1]).not.toHaveProperty('outcome')
  })

  test('persists unavailable reconciliation evidence through the dedicated mutation', async () => {
    const durable = { status: 'reserved', reconciliationRequired: true, outcomeCode: 'reconciliation_unknown' }
    const runMutation = vi.fn().mockResolvedValue(durable)
    await expect(orchestrateSearchReconciliation({ runMutation } as never, {
      reservationId: 'reservation-id' as Id<'searchReservations'>,
      expectedRevision: 3,
      idempotencyKey: 'reconcile-provider-unavailable',
    }, {
      config: () => config,
      usage: async () => { throw new TavilyFreeSearchError('provider_unavailable', false) },
    })).resolves.toEqual(durable)
    expect(runMutation).toHaveBeenCalledTimes(1)
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      reservationId: 'reservation-id', expectedRevision: 3, idempotencyKey: 'reconcile-provider-unavailable',
    })
  })
})
