import { z } from 'zod'
import type { StudyPlanSchedulingInput, StudyPlanScheduleResult, StudyPlacement, StudySessionReflowResult } from '../../shared/learn-v2-scheduling'

// Writers validate scheduling policy. Readers allowlist its data without adding policy limits.
export const schedulingPreferences = z.object({
  version: z.literal('learn-v2.schedule-input.v1'), timezone: z.string(),
  startLocalDate: z.string(), targetLocalDate: z.string().nullable(),
  sessionMinutes: z.number(), minRestMinutes: z.number(),
  availability: z.array(z.object({ weekday: z.number(), start: z.string(), end: z.string() })),
  blackoutDates: z.array(z.string()), reviewIntervalsDays: z.array(z.number()),
}) satisfies z.ZodType<Omit<StudyPlanSchedulingInput, 'nowUtcMs' | 'objectives' | 'retainedReviews'>>

const schedulingInput = schedulingPreferences.extend({
  nowUtcMs: z.number().optional().catch(undefined),
  objectives: z.array(z.object({ id: z.string(), order: z.number(), estimatedMinutes: z.number(), prerequisiteIds: z.array(z.string()),
    priority: z.enum(['prerequisite_remediation', 'new_learning', 'optional_enrichment']) })).optional().catch(undefined),
  retainedReviews: z.array(z.object({ objectiveId: z.string(), independentLocalDate: z.string(), durationMinutes: z.number().optional() })).optional().catch(undefined),
}) satisfies z.ZodType<Omit<StudyPlanSchedulingInput, 'nowUtcMs' | 'objectives' | 'retainedReviews'> & Partial<StudyPlanSchedulingInput>>

const placement = z.object({
  id: z.string(), kind: z.enum(['learning', 'review', 'retained_review']), objectiveId: z.string(),
  startUtcMs: z.number(), endUtcMs: z.number(), localDate: z.string(), offsetMinutes: z.number(),
  priority: z.enum(['overdue_retained_review', 'prerequisite_remediation', 'due_review', 'new_learning', 'optional_enrichment']),
  adjustment: z.enum(['dst_gap_forward', 'dst_repeat_earlier_offset']).optional(),
}) satisfies z.ZodType<StudyPlacement>

export const schedulingResultSummary = z.object({
  version: z.literal('learn-v2.scheduler.v1'), status: z.enum(['feasible', 'infeasible']), reasonCodes: z.array(z.string()),
  alternatives: z.array(z.object({ code: z.enum(['extend_deadline', 'add_availability', 'shorten_sessions_increase_cadence', 'reduce_depth', 'remove_lower_priority_objectives']) })),
})
const schedulingResult = schedulingResultSummary.extend({
  timezone: z.string(), placements: z.array(placement),
  bufferBlocks: z.array(z.object({ localDate: z.string(), startUtcMs: z.number(), endUtcMs: z.number(), offsetMinutes: z.number() })),
  earliestCompletionLocalDate: z.string().nullable(),
  capacity: z.object({ requiredMinutes: z.number(), totalAvailableMinutes: z.number(), usableMinutesAfterBuffer: z.number(), reservedBufferMinutes: z.number(), unallocatedMinutes: z.number() }),
  alternatives: z.array(z.discriminatedUnion('code', [
    z.object({ code: z.literal('extend_deadline'), earliestCompletionLocalDate: z.string() }),
    z.object({ code: z.literal('add_availability'), additionalMinutes: z.number(), weekday: z.number(), windowStart: z.string(), minutesPerOccurrence: z.number() }),
    z.object({ code: z.literal('shorten_sessions_increase_cadence'), sessionMinutes: z.number() }),
    z.object({ code: z.literal('reduce_depth'), minutesToRemove: z.number() }),
    z.object({ code: z.literal('remove_lower_priority_objectives'), objectiveIds: z.array(z.string()) }),
  ])),
}) satisfies z.ZodType<StudyPlanScheduleResult>
const reflowResult = z.object({ version: z.literal('learn-v2.session-reflow.v1'), replacements: z.array(placement),
  replacedSessionIds: z.array(z.string()), preservedSessionIds: z.array(z.string()) }) satisfies z.ZodType<StudySessionReflowResult>

function storedOrder(raw: unknown, safe: unknown): unknown {
  if (Array.isArray(raw) && Array.isArray(safe)) return safe.map((value, index) => storedOrder(raw[index], value))
  if (raw && typeof raw === 'object' && safe && typeof safe === 'object') {
    const fields = safe as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter(([key]) => Object.hasOwn(fields, key) && fields[key] !== undefined)
      .map(([key, value]) => [key, storedOrder(value, fields[key])]))
  }
  return safe
}

export function projectSchedulingSnapshot(value: string | undefined, kind: 'input' | 'result', summary = false) {
  if (!value) return undefined
  try {
    const raw: unknown = JSON.parse(value)
    const schema = summary ? kind === 'input' ? schedulingPreferences : z.union([schedulingResultSummary, reflowResult])
      : kind === 'input' ? schedulingInput : z.union([schedulingResult, reflowResult])
    const parsed = schema.safeParse(raw)
    return parsed.success ? JSON.stringify(summary ? parsed.data : storedOrder(raw, parsed.data)) : undefined
  }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}
