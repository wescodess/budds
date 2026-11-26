import { z } from 'zod'
import { LEARN_MEASUREMENT_CAPABILITIES } from './learn-v2-measurement-storage-manifest'
import { learnIdSchema } from './learn-v2-responses'
import { learnAttemptHistorySchema, learnPostSealTeachingReferenceSchema, learnSafeAssessmentResultSchema } from './learn-v2-assessment-disclosure'

export const LEARN_TODAY_CHECK_POINTER_VERSION = 'learn-v2.today-check-pointer.v2' as const
export const LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION = 'learn-v2.today-check-pointer.v1' as const
export const LEARN_TODAY_CHECK_TIMINGS = ['this_session', 'about_a_week', 'about_a_month', 'earlier', 'retained'] as const
export const LEARN_TODAY_CHECK_LIMIT = 4
export function learnTodayCheckRoute(threadId: string, reference: string) {
  return `/app/learn/void/${encodeURIComponent(threadId)}?check=${encodeURIComponent(reference)}`
}
export const LEARN_TODAY_CLOSED_CHECK_DAYS = 90
export const LEARN_CANVAS_CHECK_RECEIPT_VERSION = 'learn-v2.canvas-check-receipt.v1' as const
export const LEARN_CANVAS_CHECK_TIMING_VERSION = 'learn-v2.canvas-check-timing.v1' as const
export const LEARN_CANVAS_ASSESSMENT_PURPOSES = ['measurement_cold', 'measurement_delayed', 'retained_transfer'] as const
export const learnCanvasCheckTimingSchema = z.strictObject({
  version: z.literal(LEARN_CANVAS_CHECK_TIMING_VERSION), timing: z.enum(LEARN_TODAY_CHECK_TIMINGS),
})
export type LearnCanvasCheckTiming = z.infer<typeof learnCanvasCheckTimingSchema>
const receiptFields = {
  version: z.literal(LEARN_CANVAS_CHECK_RECEIPT_VERSION), reference: z.string().min(1).max(256),
  submissionId: learnIdSchema<'learnResponses'>(), acceptedAt: z.number().finite().nonnegative(),
  confidence: z.number().optional(), body: learnAttemptHistorySchema.shape.body,
  assessmentPurpose: z.enum(LEARN_CANVAS_ASSESSMENT_PURPOSES).optional(),
  checkTiming: learnCanvasCheckTimingSchema.optional(),
  postSealReference: learnPostSealTeachingReferenceSchema.optional(),
}
export const learnCanvasCheckReceiptSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...receiptFields, state: z.literal('result_ready'), result: learnSafeAssessmentResultSchema }),
  z.strictObject({ ...receiptFields, state: z.enum(['saved_scoring', 'result_unconfirmed', 'closed']) }),
])
export type LearnCanvasCheckReceipt = z.infer<typeof learnCanvasCheckReceiptSchema>
const pointerFields = {
  reference: z.string().min(1).max(256),
  state: z.enum(['ready', 'saved_scoring', 'result_unconfirmed', 'result_ready', 'closed']),
  destination: z.strictObject({ kind: z.literal('canvas'), threadId: learnIdSchema<'learningThreads'>(), route: z.string().max(512) }),
}
export const learnTodayCheckPointerSchema = z.discriminatedUnion('version', [
  z.strictObject({ ...pointerFields, version: z.literal(LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION) }),
  z.strictObject({ ...pointerFields, version: z.literal(LEARN_TODAY_CHECK_POINTER_VERSION),
    topic: z.string().refine(value => value.trim().length > 0).optional(), timing: z.enum(LEARN_TODAY_CHECK_TIMINGS) }),
]).refine(value => value.destination.route === learnTodayCheckRoute(value.destination.threadId, value.reference), 'Invalid Canvas destination')

export type LearnTodayCheckPointer = z.infer<typeof learnTodayCheckPointerSchema>

export function todayCanvasChecksEnabled() {
  return LEARN_MEASUREMENT_CAPABILITIES.responses && LEARN_MEASUREMENT_CAPABILITIES.todayCanvasChecks
}

export function isFrozenTodayCanvasAssignment(assignment: { status: string, flow: string, entryPoint: string,
  checkSurface?: { surface: string, measurementFlow: string } } | null) {
  return assignment?.status === 'admitted'
    && (assignment.checkSurface ? assignment.checkSurface.surface === 'canvas' && assignment.checkSurface.measurementFlow === assignment.flow : assignment.flow === 'v2_canvas')
    && (assignment.entryPoint === 'today' || assignment.entryPoint === 'session_deep_link')
}
