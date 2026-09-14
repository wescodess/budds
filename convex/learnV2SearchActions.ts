"use node"

import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { action, internalAction, type ActionCtx } from './_generated/server'
import { admitLearnV2PublicQuery } from '../server/utils/learn-v2-public-query'
import {
  readTavilyFreeConfig,
  searchTavilyFree,
  TavilyFreeSearchError,
  verifyTavilyFreeUsage,
  type TavilyFreeConfig,
  type TavilyFreeUsage,
  type TavilySearchSuccess,
} from '../server/utils/tavily-free-search'

type SearchArgs = {
  learningVoidId: Id<'learningVoids'>
  blueprintRevisionId: Id<'learnBlueprintRevisions'>
  expectedVoidRevision: number
  expectedBlueprintRecordRevision: number
  query: string
  idempotencyKey: string
}

type SearchAdapters = {
  config: () => TavilyFreeConfig
  usage: (config: TavilyFreeConfig) => Promise<TavilyFreeUsage>
  search: (query: string, config: TavilyFreeConfig) => Promise<TavilySearchSuccess>
}

const defaultAdapters: SearchAdapters = {
  config: readTavilyFreeConfig,
  usage: async config => await verifyTavilyFreeUsage(config),
  search: async (query, config) => await searchTavilyFree(query, config),
}

async function digest(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function validateIdempotencyKey(value: string) {
  const containsControl = [...value].some((character) => {
    const code = character.codePointAt(0)!
    return code <= 31 || code === 127
  })
  if (!value.trim() || value.length > 128 || containsControl) {
    throw new Error('Invalid idempotency key')
  }
}

async function bestEffortAmbiguous(
  ctx: Pick<ActionCtx, 'runMutation'>,
  args: { tokenIdentifier: string, reservationId: Id<'searchReservations'>, executionToken: string, expectedRevision: number, outcomeCode: string },
) {
  try {
    await ctx.runMutation(internal.learnV2Search.markAmbiguous, args)
  }
  catch {
    // The durable started state already prevents another provider dispatch.
    // Reconciliation remains conservative even if this annotation is delayed.
  }
}

export async function orchestratePublicSearch(
  ctx: Pick<ActionCtx, 'auth' | 'runMutation'>,
  args: SearchArgs,
  adapters: SearchAdapters = defaultAdapters,
): Promise<Record<string, unknown>> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Learn V2 access denied')

  const query = admitLearnV2PublicQuery(args.query)
  validateIdempotencyKey(args.idempotencyKey)
  const idempotencyKeyHash = await digest({ idempotencyKey: args.idempotencyKey })
  const queryDigest = await digest({ query })
  const requestFingerprint = await digest({
    learningVoidId: String(args.learningVoidId),
    blueprintRevisionId: String(args.blueprintRevisionId),
    expectedVoidRevision: args.expectedVoidRevision,
    expectedBlueprintRecordRevision: args.expectedBlueprintRecordRevision,
    queryDigest,
    searchClass: 'broad',
  })

  const admission = await ctx.runMutation(internal.learnV2Search.replayOrReserve, {
    tokenIdentifier: identity.tokenIdentifier,
    learningVoidId: args.learningVoidId,
    blueprintRevisionId: args.blueprintRevisionId,
    expectedVoidRevision: args.expectedVoidRevision,
    expectedBlueprintRecordRevision: args.expectedBlueprintRecordRevision,
    idempotencyKeyHash,
    requestFingerprint,
    queryDigest,
  }) as Record<string, unknown>

  if (admission.kind !== 'acquired') {
    return {
      ok: admission.kind === 'replayed_consumed',
      replayed: true,
      status: admission.status,
      reconciliationRequired: Boolean(admission.reconciliationRequired),
      results: [],
    }
  }

  const reservationId = admission.reservationId as Id<'searchReservations'>
  const executionToken = String(admission.executionToken)
  const reservationRevision = Number(admission.revision)
  let config: TavilyFreeConfig
  try {
    config = adapters.config()
  }
  catch {
    await ctx.runMutation(internal.learnV2Search.releasePreDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: reservationRevision,
      outcomeCode: 'config_invalid',
      openCircuit: false,
    })
    return { ok: false, status: 'released', reason: 'public_search_unavailable', results: [] }
  }

  let lease: Record<string, unknown>
  try {
    lease = await ctx.runMutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: reservationRevision,
    }) as Record<string, unknown>
  }
  catch {
    await ctx.runMutation(internal.learnV2Search.releasePreDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: reservationRevision,
      outcomeCode: 'dispatch_lease_denied',
      openCircuit: false,
    })
    return { ok: false, status: 'released', reason: 'public_search_unavailable', results: [] }
  }
  if (lease.kind !== 'acquired') {
    await ctx.runMutation(internal.learnV2Search.releasePreDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: reservationRevision,
      outcomeCode: lease.kind === 'busy' ? 'dispatch_busy' : 'dispatch_lease_denied',
      openCircuit: false,
    })
    return { ok: false, status: 'released', reason: 'public_search_unavailable', results: [] }
  }
  let usage: TavilyFreeUsage
  try {
    usage = await adapters.usage(config)
  }
  catch (error) {
    const openCircuit = error instanceof TavilyFreeSearchError
      && (error.code === 'free_plan_required' || error.code === 'provider_response_invalid')
    await ctx.runMutation(internal.learnV2Search.releasePreDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: reservationRevision,
      outcomeCode: openCircuit ? 'usage_policy_denied' : 'usage_unavailable',
      openCircuit,
    })
    return { ok: false, status: 'released', reason: 'public_search_unavailable', results: [] }
  }

  let dispatch: Record<string, unknown>
  try {
    dispatch = await ctx.runMutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: reservationRevision,
      providerKeyUsage: usage.keyUsage,
    }) as Record<string, unknown>
  }
  catch {
    try {
      await ctx.runMutation(internal.learnV2Search.releasePreDispatch, {
        tokenIdentifier: identity.tokenIdentifier,
        reservationId,
        executionToken,
        expectedRevision: reservationRevision,
        outcomeCode: 'dispatch_authorization_denied',
        openCircuit: false,
      })
      return { ok: false, status: 'released', reason: 'public_search_unavailable', results: [] }
    }
    catch {
      return { ok: false, status: 'reserved', reconciliationRequired: true, reason: 'public_search_unavailable', results: [] }
    }
  }
  if (dispatch.kind !== 'authorized') {
    return { ok: false, status: dispatch.status, reconciliationRequired: Boolean(dispatch.reconciliationRequired), results: [] }
  }

  const dispatchRevision = Number(dispatch.revision)
  let searched: TavilySearchSuccess
  try {
    searched = await adapters.search(query, config)
  }
  catch (error) {
    await bestEffortAmbiguous(ctx, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: dispatchRevision,
      outcomeCode: error instanceof TavilyFreeSearchError ? error.code : 'provider_outcome_unknown',
    })
    return { ok: false, status: 'reserved', reconciliationRequired: true, reason: 'public_search_unavailable', results: [] }
  }

  try {
    const settled = await ctx.runMutation(internal.learnV2Search.consume, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: dispatchRevision,
      providerRequestId: searched.requestIdHashInput,
    }) as Record<string, unknown>
    if (settled.status !== 'consumed') throw new Error('Search settlement unavailable')
  }
  catch {
    await bestEffortAmbiguous(ctx, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId,
      executionToken,
      expectedRevision: dispatchRevision,
      outcomeCode: 'settlement_unavailable',
    })
    return { ok: false, status: 'reserved', reconciliationRequired: true, reason: 'public_search_unavailable', results: [] }
  }

  return {
    ok: true,
    status: 'consumed',
    credits: 1,
    discoveryOnly: true,
    results: searched.results,
  }
}

export const searchPublicWeb = action({
  args: {
    learningVoidId: v.id('learningVoids'),
    blueprintRevisionId: v.id('learnBlueprintRevisions'),
    expectedVoidRevision: v.number(),
    expectedBlueprintRecordRevision: v.number(),
    query: v.string(),
    idempotencyKey: v.string(),
  },
  handler: orchestratePublicSearch,
})

export async function orchestrateSearchReconciliation(
  ctx: Pick<ActionCtx, 'runMutation'>,
  args: { reservationId: Id<'searchReservations'>, expectedRevision: number, idempotencyKey: string },
  adapters: Pick<SearchAdapters, 'config' | 'usage'> = defaultAdapters,
): Promise<Record<string, unknown>> {
  validateIdempotencyKey(args.idempotencyKey)
  let usage: TavilyFreeUsage
  try {
    usage = await adapters.usage(adapters.config())
  }
  catch {
    return await ctx.runMutation(internal.learnV2Search.reconcileUsageUnavailable, args) as Record<string, unknown>
  }
  return await ctx.runMutation(internal.learnV2Search.reconcileFromUsageEvidence, {
    ...args,
    providerKeyUsage: usage.keyUsage,
  }) as Record<string, unknown>
}

export const reconcileSearchReservation = internalAction({
  args: {
    reservationId: v.id('searchReservations'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: orchestrateSearchReconciliation,
})
