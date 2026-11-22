import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { api } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { LEARN_HELP_ADMISSION_VERSION, helpAdmissionKey, type LearnHelpAdmission, type LearnHelpRequest } from './learnV2HelpContract'

export async function admitActionHelp(ctx: Pick<ActionCtx, 'runMutation'>, request: Pick<LearnHelpRequest, 'kind' | 'scope'>, key: string, delivery = false): Promise<LearnHelpAdmission> {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' }
  return await ctx.runMutation(delivery ? api.learnV2Assistance.deliverHelp : api.learnV2Assistance.admitHelp, { version: LEARN_HELP_ADMISSION_VERSION,
    ...request, idempotencyKey: await helpAdmissionKey(`action:${request.kind}`, key) })
}
