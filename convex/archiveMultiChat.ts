import { internalMutation } from './_generated/server'

export const archiveStaleConversations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allConversations = await ctx.db.query('conversations').collect()

    const byFolder = new Map<string, typeof allConversations>()
    for (const convo of allConversations) {
      const key = `${convo.userId}::${convo.folderId}`
      const list = byFolder.get(key) ?? []
      list.push(convo)
      byFolder.set(key, list)
    }

    let archived = 0
    for (const [, convos] of byFolder) {
      if (convos.length <= 1) continue
      convos.sort((a, b) => b._creationTime - a._creationTime)
      for (let i = 1; i < convos.length; i++) {
        const convo = convos[i]!
        if (convo.archivedAt) continue
        await ctx.db.patch(convo._id, { archivedAt: Date.now() })
        archived++
      }
    }

    return { archived, totalFolders: byFolder.size }
  },
})
