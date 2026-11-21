import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'
import type { Doc } from './_generated/dataModel'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { admitLearnHelpForOwner } from './lib/learnV2HelpAdmission'
import { LEARN_HELP_ADMISSION_VERSION, LEARN_HELP_LIMITS, helpAdmissionValidator, messageHelpScope, type LearnHelpReference } from './lib/learnV2HelpContract'
import { verifyMessageProvenance } from '../shared/learn-v2-message-provenance'

const sourcesValidator = v.array(
  v.object({
    content: v.string(),
    score: v.number(),
    filename: v.string(),
  }),
)

function projectMessage(row: Doc<'messages'>, allowContent: boolean) {
  return {
    _id: row._id, _creationTime: row._creationTime, conversationId: row.conversationId,
    userId: row.userId, role: row.role, content: allowContent || row.role === 'user' ? row.content : '',
    ...(allowContent && row.model ? { model: row.model } : {}),
    ...(allowContent && row.sources ? { sources: row.sources } : {}),
    ...(allowContent && row.interjectionContext ? { interjectionContext: row.interjectionContext } : {}),
  }
}

function replayScope(rows: Doc<'messages'>[]) {
  const references = new Map<string, LearnHelpReference>()
  for (const row of rows) {
    if (row.interjectionContext || row.model !== undefined) return null
    if (row.role === 'user' && !row.sources?.length && !row.interjectionContext) continue
    if (!row.helpScope?.references.length) return null
    for (const reference of row.helpScope.references) references.set(`${reference.kind}:${reference.id}`, reference)
    if (references.size > LEARN_HELP_LIMITS.references) return null
  }
  return references.size ? { references: [...references.values()] } : null
}

export const listByConversation = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const convo = await ctx.db.get(args.conversationId)
    if (!convo || convo.userId !== userId) {
      throw new Error('Conversation not found')
    }

    const rows = await ctx.db
      .query('messages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId))
      .order('asc')
      .take(500)
    // Queries cannot commit assistance. With the capability active this is a
    // metadata/learner-text read; substantive replay uses the mutation below.
    return rows.map(row => projectMessage(row, !LEARN_MEASUREMENT_CAPABILITIES.responses))
  },
})

export const replayByConversation = mutation({
  args: { conversationId: v.id('conversations'), idempotencyKey: v.string() },
  returns: v.object({ admission: helpAdmissionValidator, messages: v.array(v.object({
    _id: v.id('messages'), _creationTime: v.number(), conversationId: v.id('conversations'), userId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')), content: v.string(), model: v.optional(v.string()),
    sources: v.optional(sourcesValidator), interjectionContext: v.optional(v.object({
      overviewId: v.id('audioOverviews'), turnIndex: v.number(), timeMs: v.number(), quotedText: v.string(),
      sourceFilename: v.optional(v.string()), interjectionId: v.optional(v.id('audioOverviewInterjections')),
    })),
  })) }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== userId) throw new Error('Conversation not found')
    const rows = await ctx.db.query('messages').withIndex('by_conversationId', q => q.eq('conversationId', conversation._id)).order('asc').take(500)
    const admission = await admitLearnHelpForOwner(ctx, userId, { version: LEARN_HELP_ADMISSION_VERSION,
      kind: 'replay', idempotencyKey: args.idempotencyKey,
      scope: replayScope(rows) }, rows.some(row => row.role === 'assistant' && row.content.length > 0 || row.sources?.length || row.interjectionContext))
    return { admission, messages: rows.map(row => projectMessage(row, admission.status !== 'denied')) }
  },
})

export const appendMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    provenance: v.optional(v.object({ ...messageHelpScope, signature: v.string() })),
    sources: v.optional(sourcesValidator),
    model: v.optional(v.string()),
    interjectionContext: v.optional(v.object({
      overviewId: v.id('audioOverviews'),
      turnIndex: v.number(),
      timeMs: v.number(),
      quotedText: v.string(),
      sourceFilename: v.optional(v.string()),
      interjectionId: v.optional(v.id('audioOverviewInterjections')),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const convo = await ctx.db.get(args.conversationId)
    if (!convo || convo.userId !== userId) {
      throw new Error('Conversation not found')
    }

    let helpScope: Doc<'messages'>['helpScope']
    if (args.role === 'assistant' && args.provenance) {
      const secret = process.env.NUXT_BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || ''
      if (await verifyMessageProvenance(secret, userId, args.content, args.sources ?? [], args.provenance).catch(() => false)) {
        let owned = true
        for (const reference of args.provenance.references) {
          const row = await ctx.db.get(reference.id)
          if (!row || row.userId !== userId) { owned = false; break }
        }
        if (owned) helpScope = { version: args.provenance.version, references: args.provenance.references }
      }
    }

    return await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      userId,
      role: args.role,
      content: args.content,
      helpScope,
      sources: args.sources,
      model: helpScope ? undefined : args.model,
      interjectionContext: helpScope ? undefined : args.interjectionContext,
    })
  },
})
