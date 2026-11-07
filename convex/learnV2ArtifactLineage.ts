import { internalQuery } from './_generated/server'
import { requireAuth } from './lib/auth'
import { artifactLookupArgs, artifactLookupResultValidator, artifactOwnerRecordValidator } from './lib/learnV2ArtifactLineageContract'
import { createArtifactLineageReadContext, resolveArtifactLineageForOwner, resolveArtifactLineageForRecord } from './lib/learnV2ArtifactLineage'

export const resolve = internalQuery({
  args: artifactLookupArgs,
  returns: artifactLookupResultValidator,
  handler: async (ctx, args) => {
    const budget = createArtifactLineageReadContext(ctx)
    return resolveArtifactLineageForOwner(budget.ctx, await requireAuth(budget.ctx), args)
  },
})

// Internal actions can preflight from a record without a session. Capability
// routes call the helper inside their already-authorized Convex handler.
export const resolveForRecord = internalQuery({
  args: { ...artifactLookupArgs, ownerRecord: artifactOwnerRecordValidator },
  returns: artifactLookupResultValidator,
  handler: (ctx, { ownerRecord, reference }) => resolveArtifactLineageForRecord(ctx, ownerRecord, { reference }),
})
