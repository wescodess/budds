import { internalQuery } from './_generated/server'
import { requireAuth } from './lib/auth'
import { artifactLookupArgs, artifactLookupResultValidator } from './lib/learnV2ArtifactLineageContract'
import { resolveArtifactLineageForOwner } from './lib/learnV2ArtifactLineage'

export const resolve = internalQuery({
  args: artifactLookupArgs,
  returns: artifactLookupResultValidator,
  handler: async (ctx, args) => resolveArtifactLineageForOwner(ctx, await requireAuth(ctx), args),
})
