import { ConvexError, convexToJson, v, type ObjectType, type PropertyValidators, type Validator, type Value } from 'convex/values'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import { getOptionalAuthUserId, requireAuth } from './auth'
import { admitLearnHelpForOwner, hasOpenLearnHelp, inspectLearnHelpForOwner } from './learnV2HelpAdmission'
import { LEARN_HELP_ADMISSION_VERSION, LEARN_HELP_LIMITS, LEARN_HELP_OPEN_PHASES, helpAdmissionKey, helpAdmissionValidator, type LearnHelpAdmission, type LearnHelpRequest } from './learnV2HelpContract'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { canonicalPrivacyJson, privacyDigest } from './learnV2ResponsePrivacy'
import { createResponsePrivacyReadContext, privacyReadBudgetExhausted } from './learnV2PrivacyReadContext'
import { requireAudioOverviewOrchestrationCredential } from './audioOverviewOrchestrationAuth'
import { messageSigningSecret } from './learnV2MessageProvenance'
import { isCurrentTeachingReadScope } from './learnV2TeachingReadScope'

type ReadScope = LearnHelpRequest['scope']
type Definition<Args extends PropertyValidators, Result> = {
  name: string
  args: Args
  returns?: Validator<Result, 'required', string>
  scope: (ctx: QueryCtx, userId: string, args: ObjectType<Args>) => Promise<ReadScope>
  handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Result>
  metadataPreparation?: boolean
  anonymousShare?: boolean
}

function readOnlyTeachingContext(ctx: MutationCtx): QueryCtx {
  const writes = new Set(['insert', 'patch', 'replace', 'delete'])
  const db = new Proxy(ctx.db, {
    has: (target, property) => !writes.has(String(property)) && Reflect.has(target, property),
    get(target, property) {
      if (writes.has(String(property))) throw new Error('Teaching read is unavailable')
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { ...ctx, db }
}

function reject(admission: LearnHelpAdmission, revision?: string): never {
  throw new ConvexError({ admission, ...(revision ? { code: 'help_delivery_required', revision } : {}) })
}

async function deliveryRevision(ctx: QueryCtx, userId: string, name: string, args: unknown, scope: ReadScope, value: unknown) {
  const secret = messageSigningSecret()
  if (!secret) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
  const opportunities: Array<[string, number, string]> = []
  for (const phase of LEARN_HELP_OPEN_PHASES) {
    const rows = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_phase', q => q.eq('userId', userId).eq('phase', phase))
      .take(LEARN_HELP_LIMITS.openOpportunities + 1 - opportunities.length)
    opportunities.push(...rows.map(row => [row._id, row.revision, row.phase] as [string, number, string]))
    if (opportunities.length > LEARN_HELP_LIMITS.openOpportunities) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new TextEncoder().encode(canonicalPrivacyJson(convexToJson(['learn-v2.teaching-read.v1', name, args, scope, opportunities, value ?? null] as Value)))
  const signature = await crypto.subtle.sign('HMAC', key, bytes)
  return `hmac-sha256:${Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function defineTeachingRead<Args extends PropertyValidators, Result>(definition: Definition<Args, Result>, options: { hasContent?: (result: Result) => boolean } = {}) {
  const readArgs = (input: ObjectType<Args> & { idempotencyKey: string }) => {
    const values: Record<string, unknown> = input
    return Object.fromEntries(Object.keys(definition.args).filter(key => values[key] !== undefined).map(key => [key, values[key]])) as ObjectType<Args>
  }
  const content = options.hasContent ?? ((result: Result) => result !== null && result !== undefined && (!Array.isArray(result) || result.length > 0))
  const request = async (ctx: QueryCtx, args: ObjectType<Args>, key: string, resolve = true) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) {
      if (definition.anonymousShare && resolve) return { userId: null, scope: await definition.scope(ctx, '', args).catch(() => null), input: null }
      return { userId: null, scope: null, input: null }
    }
    const scope = resolve ? await definition.scope(ctx, userId, args).catch(() => null) : null
    return { userId, scope, input: { version: LEARN_HELP_ADMISSION_VERSION, kind: 'replay' as const, scope: scope?.references.length ? scope : null,
      idempotencyKey: await helpAdmissionKey(`${definition.name}:${await privacyDigest(args)}`, key) } }
  }
  const read = {
    args: definition.args,
    ...(definition.returns ? { returns: definition.returns } : {}),
    handler: async (ctx: QueryCtx, args: ObjectType<Args>) => {
      const owner = await getOptionalAuthUserId(ctx)
      ctx = createResponsePrivacyReadContext(ctx, owner ?? 'anonymous_teaching_share').ctx
      try {
        const contextual = Boolean(owner && await hasOpenLearnHelp(ctx, owner))
        let authorization = await request(ctx, args, 'query_read_admission', contextual)
        const admission = LEARN_MEASUREMENT_CAPABILITIES.responses && authorization.userId && authorization.input
          ? await inspectLearnHelpForOwner(ctx, authorization.userId, authorization.input)
          : { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }
        if (admission.status === 'denied') reject(admission)
        const value = await definition.handler(ctx, args)
        if (content(value) && !contextual) authorization = await request(ctx, args, 'query_read_admission')
        if (content(value) && !isCurrentTeachingReadScope(authorization.scope)) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
        if (admission.status !== 'ordinary' && authorization.userId) {
          reject(admission, await deliveryRevision(ctx, authorization.userId, definition.name, args, authorization.scope, value))
        }
        return value
      } catch (error) {
        if (privacyReadBudgetExhausted(ctx)) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
        throw error
      }
    },
  }
  const deliver = async (ctx: MutationCtx, args: ObjectType<Args>, key: string, delivery: boolean) => {
    const owner = await getOptionalAuthUserId(ctx)
    const contextual = Boolean(owner && await hasOpenLearnHelp(ctx, owner))
    let authorization = await request(ctx, args, key, contextual)
    const admission = LEARN_MEASUREMENT_CAPABILITIES.responses && authorization.userId && authorization.input
      ? await admitLearnHelpForOwner(ctx, authorization.userId, authorization.input)
      : { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }
    if (admission.status === 'denied') return { admission, value: null }
    const result = await definition.handler(readOnlyTeachingContext(ctx), args)
    if (content(result) && !contextual) authorization = await request(ctx, args, key)
    const { userId, input } = authorization
    if (content(result) && !isCurrentTeachingReadScope(authorization.scope)) return { admission: { version: LEARN_HELP_ADMISSION_VERSION, status: 'denied' as const, reasonCode: 'unavailable' as const }, value: null }
    if (delivery && content(result) && LEARN_MEASUREMENT_CAPABILITIES.responses && userId && input) {
      const delivered = await admitLearnHelpForOwner(ctx, userId, input, true)
      if (delivered.status === 'denied') return { admission: delivered, value: null }
      return { admission: delivered, value: result }
    }
    return { admission, value: result }
  }

  const delivery = {
    args: { ...definition.args, idempotencyKey: v.string(), orchestrationToken: v.optional(v.string()) },
    ...(definition.returns ? { returns: v.object({ admission: helpAdmissionValidator, value: v.union(definition.returns, v.null()) }) } : {}),
    handler: async (ctx: MutationCtx, input: ObjectType<Args> & { idempotencyKey: string, orchestrationToken?: string }) => {
      if (LEARN_MEASUREMENT_CAPABILITIES.responses && definition.metadataPreparation
        && (!definition.anonymousShare || await getOptionalAuthUserId(ctx))) requireAudioOverviewOrchestrationCredential(input.orchestrationToken ?? '')
      return await deliver(ctx, readArgs(input), input.idempotencyKey, true)
    },
  }
  const preparation = {
    args: { ...definition.args, idempotencyKey: v.string() },
    ...(definition.returns ? { returns: v.object({ admission: helpAdmissionValidator, value: v.union(definition.returns, v.null()) }) } : {}),
    handler: async (ctx: MutationCtx, input: ObjectType<Args> & { idempotencyKey: string }) => {
      if (!definition.metadataPreparation) throw new Error('Content preparation is unavailable')
      return await deliver(ctx, readArgs(input), input.idempotencyKey, false)
    },
  }
  return { query: read, delivery, preparation }
}

export function defineTeachingMutation<Args extends PropertyValidators, Result>(definition: Omit<Definition<Args, Result>, 'handler'> & {
  handler: (ctx: MutationCtx, args: ObjectType<Args>) => Promise<Result>
}, options: { hasContent?: (result: Result) => boolean } = {}) {
  return {
    args: definition.args,
    ...(definition.returns ? { returns: definition.returns } : {}),
    handler: async (ctx: MutationCtx, args: ObjectType<Args>) => {
      const userId = await requireAuth(ctx)
      const scope = await definition.scope(ctx, userId, args).catch(() => null)
      const input = { version: LEARN_HELP_ADMISSION_VERSION, kind: 'replay' as const, scope: scope?.references.length ? scope : null,
        idempotencyKey: await helpAdmissionKey(definition.name, await privacyDigest(args)) }
      const admission = LEARN_MEASUREMENT_CAPABILITIES.responses ? await admitLearnHelpForOwner(ctx, userId, input) : { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }
      if (admission.status === 'denied') reject(admission)
      const value = await definition.handler(ctx, args)
      const current = await definition.scope(ctx, userId, args).catch(() => null)
      const hasContent = options.hasContent ? options.hasContent(value) : value !== null && value !== undefined
      if (hasContent && !isCurrentTeachingReadScope(current)) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
      if (LEARN_MEASUREMENT_CAPABILITIES.responses && hasContent) {
        const delivered = await admitLearnHelpForOwner(ctx, userId, { ...input, scope: current?.references.length ? current : null }, true)
        if (delivered.status === 'denied') reject(delivered)
      }
      return value
    },
  }
}

export async function assertOrdinaryTeachingRead(ctx: QueryCtx, userId: string, scope: () => Promise<ReadScope>) {
  const resolved = await scope()
  if (!isCurrentTeachingReadScope(resolved)) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return
  const admission = await inspectLearnHelpForOwner(ctx, userId, { version: LEARN_HELP_ADMISSION_VERSION,
    kind: 'replay', scope: resolved, ordinaryOnly: true, idempotencyKey: 'server_teaching_input_read' })
  if (admission.status !== 'ordinary') reject(admission)
}
