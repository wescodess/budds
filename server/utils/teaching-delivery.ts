import type { LearnHelpAdmission } from '../../convex/lib/learnV2HelpContract'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'

export function needsTeachingDelivery() { return LEARN_MEASUREMENT_CAPABILITIES.responses }

export function teachingDeliveryValue<T>(result: { admission: LearnHelpAdmission, value: T | null }): T | null {
  if (result.admission.status === 'denied') {
    throw createError({ statusCode: 409, message: 'Teaching content is unavailable.', data: { admission: result.admission } })
  }
  return result.value
}
