import { z } from 'zod'
import { LEARN_MEASUREMENT_CAPABILITIES } from './learn-v2-measurement-storage-manifest'
import { learnIdSchema } from './learn-v2-responses'

export const LEARN_TODAY_CHECK_POINTER_VERSION = 'learn-v2.today-check-pointer.v1' as const
export const LEARN_TODAY_CHECK_LIMIT = 32
export const learnTodayCheckPointerSchema = z.strictObject({
  version: z.literal(LEARN_TODAY_CHECK_POINTER_VERSION),
  reference: z.string().min(1).max(256),
  state: z.enum(['ready', 'saved_scoring', 'result_unconfirmed', 'result_ready', 'closed']),
  destination: z.strictObject({ kind: z.literal('canvas'), threadId: learnIdSchema<'learningThreads'>(), route: z.string().max(512) }),
}).refine(value => value.destination.route === `/app/learn/void/${encodeURIComponent(value.destination.threadId)}`, 'Invalid Canvas destination')

export type LearnTodayCheckPointer = z.infer<typeof learnTodayCheckPointerSchema>

export function todayCanvasChecksEnabled() {
  return LEARN_MEASUREMENT_CAPABILITIES.responses && LEARN_MEASUREMENT_CAPABILITIES.todayCanvasChecks
}
