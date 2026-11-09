import { api } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { LEARN_HELP_ADMISSION_VERSION, helpAdmissionKey, type LearnHelpAdmission, type LearnHelpRequest } from './learnV2HelpContract'

export async function admitActionHelp(ctx: Pick<ActionCtx, 'runMutation'>, request: Pick<LearnHelpRequest, 'kind' | 'scope'>, key: string): Promise<LearnHelpAdmission> {
  return await ctx.runMutation(api.learnV2Assistance.admitHelp, { version: LEARN_HELP_ADMISSION_VERSION,
    ...request, idempotencyKey: await helpAdmissionKey(`action:${request.kind}`, key) })
}
