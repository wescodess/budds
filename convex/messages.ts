import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'
import type { Doc } from './_generated/dataModel'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { admitLearnHelpForOwner } from './lib/learnV2HelpAdmission'
import { LEARN_HELP_ADMISSION_VERSION, LEARN_HELP_LIMITS, helpAdmissionValidator, messageProvenanceFields, messageHelpScope } from './lib/learnV2HelpContract'
import { signMessageProvenance, verifyMessageProvenance, type MessageScopeReference } from '../shared/learn-v2-message-provenance'
import { messageSigningSecret, projectStoredMessage, inspectStoredMessageProof } from './lib/learnV2MessageProvenance'
import { currentMessageSourceAccess } from './lib/learnV2ReplayAccess'
import type { QueryCtx, MutationCtx } from './_generated/server'
import { responsePrivacyReadContext } from './lib/learnV2PrivacyReadContext'

const sourcesValidator = v.array(
  v.object({
    content: v.string(),
    score: v.number(),
    filename: v.string(),
  }),
)

async function replayScope(ctx: QueryCtx | MutationCtx, userId: string, rows: Doc<'messages'>[]) {
  ctx = responsePrivacyReadContext(ctx, userId)
  const references = new Map<string, MessageScopeReference>()
  const proofs = new Map<string, Awaited<ReturnType<typeof inspectStoredMessageProof>>>()
  const invalidIds = new Set<string>()
  for (const row of rows) {
    const proof = await inspectStoredMessageProof(userId, row)
    proofs.set(row._id, proof)
    if (proof.state === 'invalid') invalidIds.add(row._id)
    if (proof.state === 'known') for (const reference of proof.references) references.set(`${reference.kind}:${reference.id}`, reference)
  }
  const sourceAccess = references.size > 0 && references.size <= LEARN_HELP_LIMITS.references && await currentMessageSourceAccess(ctx, userId, [...references.values()])
  const availableIds = new Set<string>()
  const unavailableIds = new Set<string>()
  let independent = false
  let delivery = false
  for (const row of rows) {
    const proof = proofs.get(row._id)!
    const teaching = row.role === 'assistant' || Boolean(row.sources?.length || row.model || row.interjectionContext)
    const available = proof.state === 'independent' || proof.state === 'known' && sourceAccess
    if (available) availableIds.add(row._id)
    if (teaching && !available) unavailableIds.add(row._id)
    if (teaching && available && (row.content.length > 0 || row.sources?.length)) {
      delivery = true
      independent ||= proof.state === 'independent'
    }
  }
  return { invalidIds, availableIds, unavailableIds, delivery, scope: sourceAccess && !independent ? { references: [...references.values()] } : null }
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
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return rows
    // Queries cannot commit assistance. With the capability active this is a
    // metadata/learner-text read; substantive replay uses the mutation below.
    const replay = await replayScope(ctx, userId, rows)
    return rows.map(row => ({ ...projectStoredMessage(row, !LEARN_MEASUREMENT_CAPABILITIES.responses && replay.availableIds.has(row._id), !replay.invalidIds.has(row._id)),
      ...(replay.unavailableIds.has(row._id) ? { evidenceStatus: 'evidence_unavailable' as const } : {}) }))
  },
})

export const replayByConversation = mutation({
  args: { conversationId: v.id('conversations'), idempotencyKey: v.string() },
  returns: v.object({ admission: helpAdmissionValidator, messages: v.array(v.object({
    _id: v.id('messages'), _creationTime: v.number(), conversationId: v.id('conversations'), userId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')), content: v.string(), model: v.optional(v.string()),
    evidenceStatus: v.optional(v.literal('evidence_unavailable')), helpScope: v.optional(v.object(messageHelpScope)),
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
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return { admission: { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }, messages: rows }
    const replay = await replayScope(ctx, userId, rows)
    let admission = replay.delivery || replay.unavailableIds.size ? await admitLearnHelpForOwner(ctx, userId, { version: LEARN_HELP_ADMISSION_VERSION,
      kind: 'replay', idempotencyKey: args.idempotencyKey,
      scope: replay.scope }, replay.delivery) : { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }
    if (!replay.delivery && replay.unavailableIds.size && admission.status !== 'denied') admission = { version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' }
    return { admission, messages: rows.map(row => ({ ...projectStoredMessage(row, admission.status !== 'denied' && replay.availableIds.has(row._id), !replay.invalidIds.has(row._id)),
      ...(replay.unavailableIds.has(row._id) ? { evidenceStatus: 'evidence_unavailable' as const } : {}) })) }
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
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) {
      if (args.model === undefined && !args.interjectionContext) {
        helpScope = args.role === 'assistant' && args.provenance
          && await verifyMessageProvenance(messageSigningSecret(), userId, args.content, args.sources ?? [], args.provenance).catch(() => false)
          ? args.provenance
          : await signMessageProvenance(messageSigningSecret(), userId, args.content, args.sources ?? [], null, args.role).catch(() => undefined)
      }
      return await ctx.db.insert('messages', { conversationId: args.conversationId, userId, role: args.role, content: args.content,
        sources: args.sources, model: args.model, interjectionContext: args.interjectionContext, helpScope })
    }
    if (args.role === 'assistant') {
      if (!args.provenance || !await verifyMessageProvenance(messageSigningSecret(), userId, args.content, args.sources ?? [], args.provenance).catch(() => false)) {
        throw new Error('Assistant message verification failed')
      }
      for (const reference of args.provenance.scope === 'known' ? args.provenance.references! : []) {
        const row = await ctx.db.get(reference.id)
        if (!row || row.userId !== userId) throw new Error('Assistant message verification failed')
      }
      helpScope = args.provenance.scope === 'unknown'
        ? await signMessageProvenance(messageSigningSecret(), userId, '', [], null)
        : args.provenance
    } else {
      helpScope = await signMessageProvenance(messageSigningSecret(), userId, args.content, [], null, 'user')
    }
    if (!helpScope) throw new Error('Message verification unavailable')

    return await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      userId,
      role: args.role,
      content: args.role === 'assistant' && helpScope.scope === 'unknown' ? '' : args.content,
      helpScope,
      sources: args.role === 'assistant' && helpScope.scope !== 'unknown' ? args.sources ?? [] : [],
    })
  },
})
