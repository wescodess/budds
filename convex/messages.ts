import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'
import type { Doc } from './_generated/dataModel'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { admitLearnHelpForOwner } from './lib/learnV2HelpAdmission'
import { LEARN_HELP_ADMISSION_VERSION, LEARN_HELP_LIMITS, helpAdmissionValidator, messageProvenanceFields, type LearnHelpReference } from './lib/learnV2HelpContract'
import { MESSAGE_PROVENANCE_VERSION, signMessageProvenance, verifyMessageProvenance } from '../shared/learn-v2-message-provenance'
import { messageSigningSecret, verifiedStoredMessageScope } from './lib/learnV2MessageProvenance'

const sourcesValidator = v.array(
  v.object({
    content: v.string(),
    score: v.number(),
    filename: v.string(),
  }),
)

function projectMessage(row: Doc<'messages'>, allowContent: boolean, allowOwnText = true) {
  return {
    _id: row._id, _creationTime: row._creationTime, conversationId: row.conversationId,
    userId: row.userId, role: row.role, content: allowContent || row.role === 'user' && allowOwnText ? row.content : '',
    ...(allowContent && row.model ? { model: row.model } : {}),
    ...(allowContent && row.sources ? { sources: row.sources } : {}),
    ...(allowContent && row.interjectionContext ? { interjectionContext: row.interjectionContext } : {}),
  }
}

async function replayScope(userId: string, rows: Doc<'messages'>[]) {
  const references = new Map<string, LearnHelpReference>()
  let unknown = false
  let invalid = false
  const invalidIds = new Set<string>()
  for (const row of rows) {
    const verified = await verifiedStoredMessageScope(userId, row)
    const malformed = row.helpScope?.version === MESSAGE_PROVENANCE_VERSION && verified === null
    invalid ||= malformed
    if (malformed) invalidIds.add(row._id)
    if (!malformed && row.role === 'user' && !row.sources?.length && !row.interjectionContext && row.model === undefined) continue
    if (!verified?.length) unknown = true
    for (const reference of verified ?? []) references.set(`${reference.kind}:${reference.id}`, reference)
    if (references.size > LEARN_HELP_LIMITS.references) unknown = true
  }
  return { invalid, invalidIds, scope: !unknown && references.size ? { references: [...references.values()] } : null }
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
    return await Promise.all(rows.map(async row => {
      const valid = row.helpScope?.version !== MESSAGE_PROVENANCE_VERSION || await verifiedStoredMessageScope(userId, row) !== null
      return projectMessage(row, !LEARN_MEASUREMENT_CAPABILITIES.responses && valid, valid)
    }))
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
    const replay = await replayScope(userId, rows)
    let admission = await admitLearnHelpForOwner(ctx, userId, { version: LEARN_HELP_ADMISSION_VERSION,
      kind: 'replay', idempotencyKey: args.idempotencyKey,
      scope: replay.scope }, !replay.invalid && rows.some(row => row.role === 'assistant' && row.content.length > 0 || row.sources?.length || row.interjectionContext))
    if (replay.invalid && admission.status === 'ordinary') admission = { version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' }
    return { admission, messages: rows.map(row => projectMessage(row, admission.status !== 'denied', !replay.invalidIds.has(row._id))) }
  },
})

export const appendMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    provenance: v.optional(v.object(messageProvenanceFields)),
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
    if (args.role === 'assistant') {
      if (!args.provenance || !await verifyMessageProvenance(messageSigningSecret(), userId, args.content, args.sources ?? [], args.provenance).catch(() => false)) {
        throw new Error('Assistant message verification failed')
      }
      for (const reference of args.provenance.references) {
        const row = await ctx.db.get(reference.id)
        if (!row || row.userId !== userId) throw new Error('Assistant message verification failed')
      }
      helpScope = args.provenance
    } else {
      helpScope = await signMessageProvenance(messageSigningSecret(), userId, args.content, args.sources ?? [], [], 'user')
      if (!helpScope) throw new Error('Message verification unavailable')
    }

    return await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      userId,
      role: args.role,
      content: args.content,
      helpScope,
      sources: args.sources ?? [],
    })
  },
})
