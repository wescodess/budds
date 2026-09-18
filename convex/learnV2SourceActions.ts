"use node"

import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action, type ActionCtx } from './_generated/server'
import {
  LEARN_V2_FETCH_POLICY_VERSION,
  SafeFetchError,
  safeFetchSource,
  type SafeFetchResult,
} from '../server/utils/learn-v2-safe-fetch'
import { deterministicLearnV2Source } from '../server/utils/learn-v2-e2e-fixtures'

type FetchSourceArgs = {
  sourceSnapshotId: Id<'learnSourceSnapshots'>
  expectedRevision: number
  idempotencyKey: string
}

export async function orchestrateSourceFetch(
  ctx: Pick<ActionCtx, 'auth' | 'runMutation'>,
  args: FetchSourceArgs,
  fetcher: (url: string) => Promise<SafeFetchResult> = safeFetchSource,
): Promise<Record<string, unknown>> {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Learn V2 access denied')
    const admission: Record<string, unknown> = await ctx.runMutation(
      internal.learnV2Sources.replayOrAcquireFetch,
      { tokenIdentifier: identity.tokenIdentifier, ...args },
    )
    if (admission.kind === 'replayed') return admission.response as Record<string, unknown>
    if (admission.kind === 'retryable_denial') {
      return { ok: false, retryable: true, reason: admission.reason }
    }
    const leaseId = admission.leaseId as never
    const leaseToken = String(admission.leaseToken)
    let leaseSettled = false
    try {
      const fetched = await fetcher(String(admission.url))
      const committed = await ctx.runMutation(internal.learnV2Sources.commitFetchResult, {
        tokenIdentifier: identity.tokenIdentifier,
        ...args,
        leaseId,
        leaseToken,
        requestFingerprint: String(admission.requestFingerprint),
        result: {
          kind: 'success',
          finalUrl: fetched.finalUrl,
          publicLocator: fetched.publicLocator,
          contentHash: fetched.contentHash,
          contentType: fetched.contentType,
          wireBytes: fetched.wireBytes,
          decodedBytes: fetched.decodedBytes,
          excerpt: fetched.excerpt,
          trustClassification: fetched.trustClassification,
          rightsStatus: fetched.rights.status,
          rightsProvenance: fetched.rights.provenance,
          rightsPolicyVersion: fetched.rights.policyVersion,
          fetchPolicyVersion: fetched.fetchPolicyVersion,
        },
      })
      leaseSettled = true
      return committed
    }
    catch (error) {
      if (error instanceof SafeFetchError && !error.retryable) {
        const committed = await ctx.runMutation(internal.learnV2Sources.commitFetchResult, {
          tokenIdentifier: identity.tokenIdentifier,
          ...args,
          leaseId,
          leaseToken,
          requestFingerprint: String(admission.requestFingerprint),
          result: {
            kind: 'failure',
            reason: error.code,
            fetchPolicyVersion: LEARN_V2_FETCH_POLICY_VERSION,
          },
        })
        leaseSettled = true
        return committed
      }
      if (error instanceof SafeFetchError) {
        return { ok: false, retryable: true, reason: error.code, infrastructureFailure: true }
      }
      throw error
    }
    finally {
      if (!leaseSettled) {
        try {
          await ctx.runMutation(internal.learnV2Sources.releaseFetchLease, {
            tokenIdentifier: identity.tokenIdentifier,
            leaseId,
            leaseToken,
          })
        }
        catch {
          // Lease expiry is the fail-safe. Cleanup failure must never replace
          // the already-determined structured fetch result/error.
        }
      }
    }
}

export const fetchSource = action({
  args: {
    sourceSnapshotId: v.id('learnSourceSnapshots'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: (ctx, args) => orchestrateSourceFetch(ctx, args, async (url) => deterministicLearnV2Source(url) ?? await safeFetchSource(url)),
})
