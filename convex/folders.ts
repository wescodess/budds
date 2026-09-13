import { ConvexError, v } from 'convex/values'
import type { Id, Doc } from './_generated/dataModel'
import type { QueryCtx, MutationCtx } from './_generated/server'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { enqueueDocumentCleanup } from './accountDeletion'
import { cancelActiveAudioOverviewTasksForFolders } from './tasks'
import { DEFAULT_COLOR_KEY, isValidColorKey } from './folderPalette'
import { DEFAULT_ICON_KEY, isValidIconKey } from './folderIcons'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'

function normalizeName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 100) {
    throw new ConvexError('Folder name must be between 1 and 100 characters')
  }
  return trimmed
}

function normalizeDescription(description: string | undefined): string {
  const value = description ?? ''
  if (value.length > 280) {
    throw new ConvexError('Description must be 280 characters or fewer')
  }
  return value
}

function resolveColor(color: string | undefined): string {
  if (color === undefined) return DEFAULT_COLOR_KEY
  if (!isValidColorKey(color)) {
    throw new ConvexError(`Invalid color: ${color}`)
  }
  return color
}

function resolveIcon(icon: string | undefined): string {
  if (icon === undefined) return DEFAULT_ICON_KEY
  if (!isValidIconKey(icon)) {
    throw new ConvexError(`Invalid icon: ${icon}`)
  }
  return icon
}

export const listAllFolders = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    return await ctx.db
      .query('folders')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
  },
})

export const listTopLevelFolders = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    return await ctx.db
      .query('folders')
      .withIndex('by_userId_and_parentId', (q) =>
        q.eq('userId', userId).eq('parentId', undefined),
      )
      .order('desc')
      .take(50)
  },
})

export const createFolder = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const name = normalizeName(args.name)
    const description = normalizeDescription(args.description)
    const color = resolveColor(args.color)
    const icon = resolveIcon(args.icon)

    return await ctx.db.insert('folders', {
      userId,
      name,
      parentId: undefined,
      documentCount: 0,
      updatedAt: Date.now(),
      description,
      color,
      icon,
    })
  },
})

export const createSubfolder = mutation({
  args: {
    name: v.string(),
    parentId: v.id('folders'),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const name = normalizeName(args.name)
    const description = normalizeDescription(args.description)
    const color = resolveColor(args.color)
    const icon = resolveIcon(args.icon)

    const parent = await ctx.db.get(args.parentId)
    if (!parent || parent.userId !== userId) {
      throw new Error('Parent folder not found')
    }

    let depth = 1
    let current: Id<'folders'> | undefined = parent.parentId
    const seen = new Set<string>()
    while (current) {
      if (seen.has(current)) break
      seen.add(current)
      depth++
      const ancestor = await ctx.db.get(current)
      if (!ancestor) break
      current = ancestor.parentId
    }

    if (depth >= 3) {
      throw new Error('Maximum folder depth (3 levels) reached')
    }

    return await ctx.db.insert('folders', {
      userId,
      name,
      parentId: args.parentId,
      documentCount: 0,
      updatedAt: Date.now(),
      description,
      color,
      icon,
    })
  },
})

export const listChildFolders = query({
  args: { parentId: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    return await ctx.db
      .query('folders')
      .withIndex('by_userId_and_parentId', (q) =>
        q.eq('userId', userId).eq('parentId', args.parentId),
      )
      .take(100)
  },
})

export const getFolder = query({
  args: { id: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) return null

    return folder
  },
})

async function collectDescendants(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  folderId: Id<'folders'>,
): Promise<Doc<'folders'>[]> {
  const children = await ctx.db
    .query('folders')
    .withIndex('by_userId_and_parentId', (q) =>
      q.eq('userId', userId).eq('parentId', folderId),
    )
    .collect()
  const all = [...children]
  for (const child of children) {
    all.push(...(await collectDescendants(ctx, userId, child._id)))
  }
  return all
}

async function getFolderDocumentStats(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  folderId: Id<'folders'>,
) {
  const directDocs = await ctx.db
    .query('documents')
    .withIndex('by_userId_and_folderId', (q) =>
      q.eq('userId', userId).eq('folderId', folderId),
    )
    .collect()
  const successfulDirectDocs = directDocs.filter(doc => doc.status === 'success')

  const descendants = await collectDescendants(ctx, userId, folderId)
  let descendantFileCount = successfulDirectDocs.length

  for (const descendant of descendants) {
    const docs = await ctx.db
      .query('documents')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', descendant._id),
      )
      .collect()
    descendantFileCount += docs.filter(doc => doc.status === 'success').length
  }

  return {
    fileCount: successfulDirectDocs.length,
    descendantFileCount,
    hasChildren: descendants.length > 0,
  }
}

export const renameFolder = mutation({
  args: { id: v.id('folders'), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const name = normalizeName(args.name)

    await ctx.db.patch(args.id, { name, updatedAt: Date.now() })
  },
})

export const updateFolder = mutation({
  args: {
    id: v.id('folders'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const patch: Partial<Doc<'folders'>> = { updatedAt: Date.now() }

    if (args.name !== undefined) patch.name = normalizeName(args.name)
    if (args.description !== undefined) patch.description = normalizeDescription(args.description)
    if (args.color !== undefined) {
      if (!isValidColorKey(args.color)) {
        throw new ConvexError(`Invalid color: ${args.color}`)
      }
      patch.color = args.color
    }
    if (args.icon !== undefined) {
      if (!isValidIconKey(args.icon)) {
        throw new ConvexError(`Invalid icon: ${args.icon}`)
      }
      patch.icon = args.icon
    }

    await ctx.db.patch(args.id, patch)
  },
})

export const setPreferredMainPane = mutation({
  args: {
    folderId: v.id('folders'),
    pane: v.union(v.literal('chat'), v.literal('podcast')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')
    await ctx.db.patch(args.folderId, { preferredMainPane: args.pane, updatedAt: Date.now() })
    return { pane: args.pane }
  },
})

export const setReferenceScope = mutation({
  args: {
    folderId: v.id('folders'),
    scope: v.optional(v.object({
      folderIds: v.optional(v.array(v.id('folders'))),
      fileIds: v.optional(v.array(v.id('documents'))),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const ownedFolderIds: Id<'folders'>[] = []
    const ownedFileIds: Id<'documents'>[] = []

    if (args.scope) {
      for (const fid of args.scope.folderIds ?? []) {
        const f = await ctx.db.get(fid)
        if (f && f.userId === userId) ownedFolderIds.push(fid)
      }
      for (const did of args.scope.fileIds ?? []) {
        const d = await ctx.db.get(did)
        if (d && d.userId === userId) ownedFileIds.push(did)
      }
    }

    const nothingSelected = ownedFolderIds.length === 0 && ownedFileIds.length === 0

    await ctx.db.patch(args.folderId, {
      referenceScope: nothingSelected
        ? undefined
        : { folderIds: ownedFolderIds, fileIds: ownedFileIds },
      updatedAt: Date.now(),
    })
    return { cleared: nothingSelected }
  },
})

export const deleteFolder = mutation({
  args: { id: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const descendants = await collectDescendants(ctx, userId, args.id)
    const folderIds: Id<'folders'>[] = [...descendants.map((d) => d._id), args.id]

    await cancelActiveAudioOverviewTasksForFolders(
      ctx,
      userId,
      new Set(folderIds.map(String)),
    )

    let deletedDocuments = 0
    let anyCleanupEnqueued = false

    for (const folderId of folderIds) {
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_folderId', (q) => q.eq('folderId', folderId))
        .collect()

      for (const doc of docs) {
        if (doc.userId !== userId) continue

        const { r2Enqueued, aiSearchEnqueued } = await enqueueDocumentCleanup(ctx, {
          userId,
          documentId: String(doc._id),
          status: doc.status,
          r2Key: doc.r2Key,
        })
        if (r2Enqueued || aiSearchEnqueued) anyCleanupEnqueued = true

        if (doc.fileId) {
          try {
            await ctx.storage.delete(doc.fileId)
          } catch {
            // best-effort; blob may already be gone
          }
        }
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentSources, {
          userId,
          documentId: doc._id,
        })
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentManifestHeaders, {
          userId,
          documentId: doc._id,
        })
        await ctx.db.delete(doc._id)
        deletedDocuments++
      }
    }

    for (let i = descendants.length - 1; i >= 0; i--) {
      await ctx.db.delete(descendants[i]!._id)
    }
    await ctx.db.delete(args.id)

    for (const folderId of folderIds) {
      // The folder is already gone, so V2's public commands reject the
      // aggregate immediately. Its bounded foundational cleanup continues
      // independently and never broadens the established V1 cascade.
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.deleteFolderFoundation, {
        userId,
        folderId,
      })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderManifestFolder, {
        userId,
        folderId,
      })
      await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteFolderOverviews, {
        folderId,
        userId,
        cursor: null,
      })
      const audioRooms = await ctx.db
        .query('audioOverviewRooms')
        .withIndex('by_userId_and_folderId', q => q.eq('userId', userId).eq('folderId', folderId))
        .take(100)
      for (const room of audioRooms) await ctx.db.delete(room._id)
    }

    if (anyCleanupEnqueued) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })
    }

    return { deletedFolders: descendants.length + 1, deletedDocuments }
  },
})

export const listSubtree = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return { subfolders: [], files: [] }
    const root = await ctx.db.get(args.folderId)
    if (!root || root.userId !== userId) return { subfolders: [], files: [] }

    const children = await ctx.db
      .query('folders')
      .withIndex('by_userId_and_parentId', (q) =>
        q.eq('userId', userId).eq('parentId', args.folderId),
      )
      .take(200)

    const subfolders = []
    for (const child of children) {
      const stats = await getFolderDocumentStats(ctx, userId, child._id)
      subfolders.push({
        id: child._id,
        name: child.name,
        color: child.color,
        icon: child.icon,
        fileCount: stats.fileCount,
        descendantFileCount: stats.descendantFileCount,
        hasChildren: stats.hasChildren,
      })
    }

    const docs = await ctx.db
      .query('documents')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .take(500)

    const files = docs
      .filter((d) => d.status === 'success')
      .map((d) => ({
        id: d._id,
        filename: d.filename,
        fileSize: d.fileSize,
      }))

    return { subfolders, files }
  },
})

export const searchScopeItems = query({
  args: {
    rootFolderId: v.id('folders'),
    search: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return { folders: [], files: [] }
    const root = await ctx.db.get(args.rootFolderId)
    if (!root || root.userId !== userId) return { folders: [], files: [] }

    const descendants = await collectDescendants(ctx, userId, args.rootFolderId)
    const descendantIds: Id<'folders'>[] = [args.rootFolderId, ...descendants.map(folder => folder._id)]

    const rootStats = await getFolderDocumentStats(ctx, userId, args.rootFolderId)
    const folders = [{
      id: args.rootFolderId,
      name: root.name,
      parentId: undefined as string | undefined,
      color: root.color,
      icon: root.icon,
      fileCount: rootStats.fileCount,
      descendantFileCount: rootStats.descendantFileCount,
      hasChildren: rootStats.hasChildren || descendants.length > 0,
    }]
    for (const folder of descendants) {
      const stats = await getFolderDocumentStats(ctx, userId, folder._id)
      folders.push({
        id: folder._id,
        name: folder.name,
        parentId: (folder.parentId ?? args.rootFolderId) as string | undefined,
        color: folder.color,
        icon: folder.icon,
        fileCount: stats.fileCount,
        descendantFileCount: stats.descendantFileCount,
        hasChildren: stats.hasChildren,
      })
      if (folders.length >= 20) break
    }

    const files = []
    for (const fId of descendantIds) {
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_userId_and_folderId', (q) =>
          q.eq('userId', userId).eq('folderId', fId),
        )
        .take(200)

      for (const doc of docs) {
        if (doc.status !== 'success') continue
        files.push({
          id: doc._id,
          folderId: fId as string,
          filename: doc.filename,
          fileSize: doc.fileSize,
        })
        if (files.length >= 50) break
      }

      if (files.length >= 50) break
    }

    return { folders, files }
  },
})

export const resolveScope = query({
  args: {
    folderIds: v.optional(v.array(v.id('folders'))),
    fileIds: v.optional(v.array(v.id('documents'))),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return { documentIds: [], documents: [], ownedFolderIds: [] }
    const documentIds = new Set<string>()
    const documents = new Map<string, {
      id: Id<'documents'>
      folderId: Id<'folders'>
      filename: string
      r2Key?: string
    }>()
    const ownedFolderIds: Id<'folders'>[] = []

    for (const folderId of args.folderIds ?? []) {
      const folder = await ctx.db.get(folderId)
      if (!folder || folder.userId !== userId) continue
      ownedFolderIds.push(folderId)
      const descendantIds: Id<'folders'>[] = [folderId]
      const descendants = await collectDescendants(ctx, userId, folderId)
      for (const d of descendants) descendantIds.push(d._id)
      for (const fid of descendantIds) {
        const docs = await ctx.db
          .query('documents')
          .withIndex('by_userId_and_folderId', (q) =>
            q.eq('userId', userId).eq('folderId', fid),
          )
          .collect()
        for (const doc of docs) {
          if (doc.status !== 'success') continue
          const key = doc._id as unknown as string
          documentIds.add(key)
          documents.set(key, {
            id: doc._id,
            folderId: doc.folderId,
            filename: doc.filename,
            r2Key: doc.r2Key,
          })
        }
      }
    }

    for (const fileId of args.fileIds ?? []) {
      const doc = await ctx.db.get(fileId)
      if (!doc || doc.userId !== userId) continue
      if (doc.status !== 'success') continue
      const key = doc._id as unknown as string
      documentIds.add(key)
      documents.set(key, {
        id: doc._id,
        folderId: doc.folderId,
        filename: doc.filename,
        r2Key: doc.r2Key,
      })
    }

    return { documentIds: [...documentIds], documents: [...documents.values()], ownedFolderIds }
  },
})

export const getFolderDescendantCounts = query({
  args: { id: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) return null

    const descendants = await collectDescendants(ctx, userId, args.id)

    let documentCount = folder.documentCount ?? 0
    for (const d of descendants) {
      documentCount += d.documentCount ?? 0
    }

    return { subfolderCount: descendants.length, documentCount }
  },
})

export const backfillFolderDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const folders = await ctx.db.query('folders').take(2000)
    let patched = 0
    for (const folder of folders) {
      const patch: Partial<Doc<'folders'>> = {}
      if (folder.color === undefined) patch.color = DEFAULT_COLOR_KEY
      if (folder.icon === undefined) patch.icon = DEFAULT_ICON_KEY
      if (folder.description === undefined) patch.description = ''
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(folder._id, patch)
        patched++
      }
    }
    return { patched }
  },
})
