import { ConvexError, v, type ObjectType, type PropertyValidators, type Validator } from 'convex/values'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import { getOptionalAuthUserId } from './auth'
import { admitLearnHelpForOwner, hasOpenLearnHelp, inspectLearnHelpForOwner } from './learnV2HelpAdmission'
import { LEARN_HELP_ADMISSION_VERSION, helpAdmissionKey, helpAdmissionValidator, type LearnHelpAdmission, type LearnHelpRequest } from './learnV2HelpContract'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { privacyDigest } from './learnV2ResponsePrivacy'
import { createResponsePrivacyReadContext } from './learnV2PrivacyReadContext'
import { requireAudioOverviewOrchestrationCredential } from './audioOverviewOrchestrationAuth'

type ReadScope = LearnHelpRequest['scope']
type Definition<Args extends PropertyValidators, Result> = {
  name: string
  args: Args
  returns?: Validator<Result, 'required', string>
  scope: (ctx: QueryCtx, userId: string, args: ObjectType<Args>) => Promise<ReadScope>
  handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Result>
  metadataPreparation?: boolean
}

function reject(admission: LearnHelpAdmission, deliveryRequired = false): never {
  throw new ConvexError({ admission, ...(deliveryRequired ? { code: 'help_delivery_required' } : {}) })
}

export function defineTeachingRead<Args extends PropertyValidators, Result>(definition: Definition<Args, Result>, options: { hasContent?: (result: Result) => boolean } = {}) {
  const readArgs = (input: ObjectType<Args> & { idempotencyKey: string }) => {
    const values: Record<string, unknown> = input
    return Object.fromEntries(Object.keys(definition.args).filter(key => values[key] !== undefined).map(key => [key, values[key]])) as ObjectType<Args>
  }
  const content = options.hasContent ?? ((result: Result) => result !== null && result !== undefined && (!Array.isArray(result) || result.length > 0))
  const request = async (ctx: QueryCtx, args: ObjectType<Args>, key: string) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' })
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
        const { userId, input } = await request(ctx, args, 'query_read_admission')
        const admission = await inspectLearnHelpForOwner(ctx, userId, input)
        if (admission.status === 'denied') reject(admission)
        if (admission.status !== 'ordinary') reject({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode: 'unavailable' }, true)
      }
      return await definition.handler(ctx, args)
    },
  }
  const deliver = async (ctx: MutationCtx, args: ObjectType<Args>, key: string, delivery: boolean) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return { admission: { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' as const }, value: await definition.handler(ctx, args) }
    const { userId, input } = await request(ctx, args, key)
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
      if (LEARN_MEASUREMENT_CAPABILITIES.responses && definition.metadataPreparation) requireAudioOverviewOrchestrationCredential(input.orchestrationToken ?? '')
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
