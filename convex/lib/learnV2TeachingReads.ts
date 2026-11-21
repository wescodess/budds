import { ConvexError, convexToJson, v, type ObjectType, type PropertyValidators, type Validator, type Value } from 'convex/values'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import { getOptionalAuthUserId } from './auth'
import { admitLearnHelpForOwner, hasOpenLearnHelp, inspectLearnHelpForOwner } from './learnV2HelpAdmission'
import { LEARN_HELP_ADMISSION_VERSION, LEARN_HELP_LIMITS, LEARN_HELP_OPEN_PHASES, helpAdmissionKey, helpAdmissionValidator, type LearnHelpAdmission, type LearnHelpRequest } from './learnV2HelpContract'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { canonicalPrivacyJson, privacyDigest } from './learnV2ResponsePrivacy'
import { createResponsePrivacyReadContext } from './learnV2PrivacyReadContext'
import { requireAudioOverviewOrchestrationCredential } from './audioOverviewOrchestrationAuth'
import { messageSigningSecret } from './learnV2MessageProvenance'

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
  const request = async (ctx: QueryCtx, args: ObjectType<Args>, key: string) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) {
      if (definition.anonymousShare) return null
      reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
    }
    const scope = await hasOpenLearnHelp(ctx, userId) ? await definition.scope(ctx, userId, args).catch(() => null) : null
    return { userId, input: { version: LEARN_HELP_ADMISSION_VERSION, kind: 'replay' as const, scope,
      idempotencyKey: await helpAdmissionKey(`${definition.name}:${await privacyDigest(args)}`, key) } }
  }
  const read = {
    args: definition.args,
    ...(definition.returns ? { returns: definition.returns } : {}),
    handler: async (ctx: QueryCtx, args: ObjectType<Args>) => {
      if (LEARN_MEASUREMENT_CAPABILITIES.responses) {
        const owner = await getOptionalAuthUserId(ctx)
        if (owner) ctx = createResponsePrivacyReadContext(ctx, owner).ctx
        const authorization = await request(ctx, args, 'query_read_admission')
        if (!authorization) return await definition.handler(ctx, args)
        const { userId, input } = authorization
        const admission = await inspectLearnHelpForOwner(ctx, userId, input)
        if (admission.status === 'denied') reject(admission)
        if (admission.status !== 'ordinary') {
          const value = await definition.handler(ctx, args)
          reject(admission, await deliveryRevision(ctx, userId, definition.name, args, input.scope, value))
        }
      }
      return await definition.handler(ctx, args)
    },
  }
  const deliver = async (ctx: MutationCtx, args: ObjectType<Args>, key: string, delivery: boolean) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return { admission: { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }, value: await definition.handler(ctx, args) }
    const authorization = await request(ctx, args, key)
    if (!authorization) return { admission: { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }, value: await definition.handler(ctx, args) }
    const { userId, input } = authorization
    const admission = await admitLearnHelpForOwner(ctx, userId, input)
    if (admission.status === 'denied') return { admission, value: null }
    const result = await definition.handler(ctx, args)
    if (delivery && content(result)) {
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
      if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return await definition.handler(ctx, args)
      const userId = await getOptionalAuthUserId(ctx)
      if (!userId) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
      const scope = await hasOpenLearnHelp(ctx, userId) ? await definition.scope(ctx, userId, args).catch(() => null) : null
      const input = { version: LEARN_HELP_ADMISSION_VERSION, kind: 'replay' as const, scope,
        idempotencyKey: await helpAdmissionKey(definition.name, await privacyDigest(args)) }
      const admission = await admitLearnHelpForOwner(ctx, userId, input)
      if (admission.status === 'denied') reject(admission)
      const value = await definition.handler(ctx, args)
      if (options.hasContent ? options.hasContent(value) : value !== null && value !== undefined) {
        const delivered = await admitLearnHelpForOwner(ctx, userId, input, true)
        if (delivered.status === 'denied') reject(delivered)
      }
      return value
    },
  }
}

export async function assertOrdinaryTeachingRead(ctx: QueryCtx, userId: string, scope: () => Promise<ReadScope>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return
  const admission = await inspectLearnHelpForOwner(ctx, userId, { version: LEARN_HELP_ADMISSION_VERSION,
    kind: 'replay', scope: await scope(), ordinaryOnly: true, idempotencyKey: 'server_teaching_input_read' })
  if (admission.status !== 'ordinary') reject(admission)
}
