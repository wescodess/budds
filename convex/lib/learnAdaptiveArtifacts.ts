import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { internal } from '../_generated/api'

export async function privateAdaptiveArtifactR2Key(userId: string, artifactId: Id<'learningThreadArtifacts'>) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId)))
  const ownerHash = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `learn-adaptive/artifacts/${ownerHash}/${String(artifactId)}/body`
}

// Returns true only after local deletion is safe. A retained R2 object always
// leaves a durable cleanup row and write-blocked artifact until confirmation.
export async function queueAdaptiveArtifactDeletion(ctx: MutationCtx, artifact: Doc<'learningThreadArtifacts'>) {
  if (!artifact.r2ObjectKey) {
    await ctx.db.delete(artifact._id)
    return true
  }
  if (artifact.r2ObjectKey !== await privateAdaptiveArtifactR2Key(artifact.userId, artifact._id)) throw new Error('Artifact R2 ownership mismatch')
  const existing = await ctx.db.query('pendingCleanup')
    .withIndex('by_learningThreadArtifactId', q => q.eq('learningThreadArtifactId', artifact._id)).unique()
  if (existing && (existing.userId !== artifact.userId || existing.kind !== 'r2' || existing.r2Key !== artifact.r2ObjectKey)) throw new Error('Artifact cleanup ownership mismatch')
  if (!existing) {
    await ctx.db.insert('pendingCleanup', { userId: artifact.userId, documentId: String(artifact._id),
      learningThreadArtifactId: artifact._id, r2Key: artifact.r2ObjectKey, kind: 'r2', attempts: 0 })
    await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId: artifact.userId })
  }
  if (artifact.status !== 'deleted') await ctx.db.patch(artifact._id, { status: 'deleted', revision: artifact.revision + 1, updatedAt: Date.now() })
  return false
}
