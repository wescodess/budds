import { CalendarDate, CalendarDateTime, toZoned } from '@internationalized/date'

export const LEARN_V2_SCHEDULER_VERSION = 'learn-v2.scheduler.v1' as const
const MIN_SESSION_MINUTES = 15
const MAX_SESSION_MINUTES = 60
const BUFFER_PERCENT = 15
const MAX_PLANNING_DAYS = 730
const MINUTE_MS = 60_000

export type SchedulingPriority = 'overdue_retained_review' | 'prerequisite_remediation' | 'due_review' | 'new_learning' | 'optional_enrichment'
export type PlacementKind = 'learning' | 'review' | 'retained_review'
export type ScheduleAdjustment = 'dst_gap_forward' | 'dst_repeat_earlier_offset'

export type StudyPlanSchedulingInput = {
  version: 'learn-v2.schedule-input.v1'
  nowUtcMs: number
  timezone: string
  startLocalDate: string
  targetLocalDate: string | null
  sessionMinutes: number
  minRestMinutes: number
  availability: Array<{ weekday: number, start: string, end: string }>
  blackoutDates: string[]
  reviewIntervalsDays: number[]
  objectives: Array<{
    id: string
    order: number
    estimatedMinutes: number
    prerequisiteIds: string[]
    priority: Extract<SchedulingPriority, 'prerequisite_remediation' | 'new_learning' | 'optional_enrichment'>
  }>
  retainedReviews: Array<{ objectiveId: string, independentLocalDate: string, durationMinutes?: number }>
}

export type StudyPlacement = {
  id: string
  kind: PlacementKind
  objectiveId: string
  startUtcMs: number
  endUtcMs: number
  localDate: string
  offsetMinutes: number
  priority: SchedulingPriority
  adjustment?: ScheduleAdjustment
}

export type BufferBlock = {
  localDate: string
  startUtcMs: number
  endUtcMs: number
  offsetMinutes: number
}

export type ScheduleAlternative =
  | { code: 'extend_deadline', earliestCompletionLocalDate: string }
  | { code: 'add_availability', additionalMinutes: number, weekday: number, windowStart: string, minutesPerOccurrence: number }
  | { code: 'shorten_sessions_increase_cadence', sessionMinutes: number }
  | { code: 'reduce_depth', minutesToRemove: number }
  | { code: 'remove_lower_priority_objectives', objectiveIds: string[] }

export type StudyPlanScheduleResult = {
  version: typeof LEARN_V2_SCHEDULER_VERSION
  status: 'feasible' | 'infeasible'
  timezone: string
  placements: StudyPlacement[]
  bufferBlocks: BufferBlock[]
  earliestCompletionLocalDate: string | null
  capacity: {
    requiredMinutes: number
    totalAvailableMinutes: number
    usableMinutesAfterBuffer: number
    reservedBufferMinutes: number
    unallocatedMinutes: number
  }
  reasonCodes: string[]
  alternatives: ScheduleAlternative[]
}

export type ReflowInput = {
  version: 'learn-v2.reflow-input.v1'
  nowUtcMs: number
  sessions: Array<{
    id: string
    status: 'planned' | 'ready' | 'in_progress' | 'completed' | 'missed' | 'cancelled' | 'blocked' | 'generation_failed' | 'needs_reschedule'
    startsAtUtcMs: number
    moveRequested: boolean
    priority: SchedulingPriority
    objectiveOrder: number
  }>
}

export type ReflowResult = {
  version: 'learn-v2.reflow.v1'
  changedSessionIds: string[]
  preservedSessionIds: string[]
}

type LocalResolution = { instantMs: number, offsetMinutes: number, adjustment?: ScheduleAdjustment }
type Segment = {
  localDate: string
  startMs: number
  usableEndMs: number
  endMs: number
  startAdjustment?: ScheduleAdjustment
}
type PendingTask = { id: string, kind: PlacementKind, objectiveId: string, objectiveOrder: number, durationMinutes: number, earliestLocalDate: string, earliestUtcMs?: number, priority: SchedulingPriority }

function parseDate(value: string, label: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`${label} must use YYYY-MM-DD`)
  const date = new CalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  if (date.toString() !== value) throw new Error(`${label} is invalid`)
  return date
}

function parseTime(value: string, label: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`${label} must use HH:mm`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error(`${label} is invalid`)
  return { hour, minute, totalMinutes: hour * 60 + minute }
}

function assertTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(0)
  }
  catch {
    throw new Error('Timezone must be a valid IANA timezone')
  }
}

function localResolver(timezone: string) {
  return (date: CalendarDate, time: { hour: number, minute: number }): LocalResolution => {
    let local = new CalendarDateTime(date.year, date.month, date.day, time.hour, time.minute)
    const matches = (value: ReturnType<typeof toZoned>) => value.year === local.year && value.month === local.month
      && value.day === local.day && value.hour === local.hour && value.minute === local.minute
    const earlier = toZoned(local, timezone, 'earlier')
    const later = toZoned(local, timezone, 'later')
    if (matches(earlier) && matches(later) && earlier.toDate().getTime() !== later.toDate().getTime()) {
      return { instantMs: earlier.toDate().getTime(), offsetMinutes: earlier.offset / MINUTE_MS, adjustment: 'dst_repeat_earlier_offset' }
    }
    try {
      const exact = toZoned(local, timezone, 'reject')
      return { instantMs: exact.toDate().getTime(), offsetMinutes: exact.offset / MINUTE_MS }
    }
    catch {
      for (let minute = 1; minute <= 180; minute++) {
        local = local.add({ minutes: 1 })
        try {
          const selected = toZoned(local, timezone, 'reject')
          return { instantMs: selected.toDate().getTime(), offsetMinutes: selected.offset / MINUTE_MS, adjustment: 'dst_gap_forward' }
        }
        catch {
          // Continue to the first real wall-clock minute after the gap.
        }
      }
      throw new Error('Availability time cannot be resolved in the selected timezone')
    }
  }
}

function isoWeekday(date: CalendarDate) {
  const sundayBased = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  return ((sundayBased + 6) % 7) + 1
}

function offsetAt(instantMs: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, timeZoneName: 'longOffset' })
  const value = formatter.formatToParts(instantMs).find(part => part.type === 'timeZoneName')?.value ?? 'GMT'
  if (value === 'GMT') return 0
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Timezone offset could not be resolved')
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
}

function splitDuration(totalMinutes: number, preferredMinutes: number) {
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes < MIN_SESSION_MINUTES) throw new Error('Objective effort must be at least 15 whole minutes')
  let count = Math.ceil(totalMinutes / preferredMinutes)
  while (count > 1 && Math.floor(totalMinutes / count) < MIN_SESSION_MINUTES) count--
  const base = Math.floor(totalMinutes / count)
  const remainder = totalMinutes % count
  const chunks = Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
  if (chunks.some(value => value < MIN_SESSION_MINUTES || value > MAX_SESSION_MINUTES)) throw new Error('Objective effort cannot be split into valid sessions')
  return chunks
}

function sortedObjectives(input: StudyPlanSchedulingInput) {
  const byId = new Map(input.objectives.map(objective => [objective.id, objective]))
  if (byId.size !== input.objectives.length || input.objectives.some(objective => !objective.id.trim())) throw new Error('Objective ids must be unique and non-empty')
  const priorities = new Set(['prerequisite_remediation', 'new_learning', 'optional_enrichment'])
  if (input.objectives.some(objective => !Number.isSafeInteger(objective.order) || !priorities.has(objective.priority))) throw new Error('Objective order and priority must be valid')
  for (const objective of input.objectives) for (const prerequisiteId of objective.prerequisiteIds) if (!byId.has(prerequisiteId) || prerequisiteId === objective.id) throw new Error('Objective prerequisite is invalid')
  const pending = new Set(byId.keys())
  const result = []
  while (pending.size > 0) {
    const ready = [...pending].map(id => byId.get(id)!).filter(row => row.prerequisiteIds.every(id => !pending.has(id))).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    if (ready.length === 0) throw new Error('Objective prerequisite graph must be acyclic')
    for (const objective of ready) {
      result.push(objective)
      pending.delete(objective.id)
    }
  }
  return result
}

function addDays(value: string, days: number) {
  return parseDate(value, 'Local date').add({ days }).toString()
}

function planningSegments(input: StudyPlanSchedulingInput, horizonEnd: CalendarDate) {
  const resolve = localResolver(input.timezone)
  const blackouts = new Set(input.blackoutDates)
  const startDate = parseDate(input.startLocalDate, 'Start date')
  const segments: Segment[] = []
  const buffers: BufferBlock[] = []
  let totalAvailableMinutes = 0
  let usableMinutesAfterBuffer = 0
  for (let cursor = startDate; cursor.compare(horizonEnd) <= 0; cursor = cursor.add({ days: 1 })) {
    const localDate = cursor.toString()
    if (blackouts.has(localDate)) continue
    const windows = input.availability.filter(window => window.weekday === isoWeekday(cursor)).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
    for (const window of windows) {
      const startTime = parseTime(window.start, 'Availability start')
      const endTime = parseTime(window.end, 'Availability end')
      if (startTime.totalMinutes >= endTime.totalMinutes) throw new Error('Availability window end must be after its start')
      const start = resolve(cursor, startTime)
      const end = resolve(cursor, endTime)
      if (start.instantMs >= end.instantMs) throw new Error('Availability window has no usable time after timezone conversion')
      const availableMinutes = Math.floor((end.instantMs - start.instantMs) / MINUTE_MS)
      const usableMinutes = Math.floor(availableMinutes * (100 - BUFFER_PERCENT) / 100)
      const usableEndMs = start.instantMs + usableMinutes * MINUTE_MS
      totalAvailableMinutes += availableMinutes
      usableMinutesAfterBuffer += usableMinutes
      segments.push({ localDate, startMs: start.instantMs, usableEndMs, endMs: end.instantMs, startAdjustment: start.adjustment })
      if (usableEndMs < end.instantMs) buffers.push({ localDate, startUtcMs: usableEndMs, endUtcMs: end.instantMs, offsetMinutes: offsetAt(usableEndMs, input.timezone) })
    }
  }
  return { segments, buffers, totalAvailableMinutes, usableMinutesAfterBuffer }
}

function capacityForSegments(segments: Segment[]) {
  const totalAvailableMinutes = segments.reduce((sum, segment) => sum + (segment.endMs - segment.startMs) / MINUTE_MS, 0)
  const usableMinutesAfterBuffer = segments.reduce((sum, segment) => sum + (segment.usableEndMs - segment.startMs) / MINUTE_MS, 0)
  return { totalAvailableMinutes, usableMinutesAfterBuffer }
}

function placeTask(task: PendingTask, segments: Segment[], placements: StudyPlacement[], input: StudyPlanSchedulingInput) {
  for (const segment of segments) {
    if (segment.localDate < task.earliestLocalDate) continue
    const restMs = input.minRestMinutes * MINUTE_MS
    let startMs = Math.max(segment.startMs, input.nowUtcMs, task.earliestUtcMs ?? Number.NEGATIVE_INFINITY)
    const occupied = [...placements].sort((a, b) => a.startUtcMs - b.startUtcMs || a.id.localeCompare(b.id))
    for (const existing of occupied) {
      if (existing.endUtcMs + restMs <= startMs) continue
      if (startMs + task.durationMinutes * MINUTE_MS <= existing.startUtcMs - restMs) break
      startMs = Math.max(startMs, existing.endUtcMs + restMs)
    }
    const endMs = startMs + task.durationMinutes * MINUTE_MS
    if (endMs > segment.usableEndMs) continue
    const placement: StudyPlacement = {
      id: task.id,
      kind: task.kind,
      objectiveId: task.objectiveId,
      startUtcMs: startMs,
      endUtcMs: endMs,
      localDate: segment.localDate,
      offsetMinutes: offsetAt(startMs, input.timezone),
      priority: task.priority,
      ...(startMs === segment.startMs && segment.startAdjustment ? { adjustment: segment.startAdjustment } : {}),
    }
    placements.push(placement)
    return placement
  }
  return null
}

function addMinutesToTime(value: string, minutes: number) {
  const parsed = parseTime(value, 'Availability end').totalMinutes + minutes
  if (parsed >= 24 * 60) return null
  return `${String(Math.floor(parsed / 60)).padStart(2, '0')}:${String(parsed % 60).padStart(2, '0')}`
}

function smallestAlternatives(input: StudyPlanSchedulingInput, requiredMinutes: number, totalAvailableMinutes: number, usableMinutes: number, fallbackCompletionDate: string) {
  const alternatives: ScheduleAlternative[] = [{ code: 'extend_deadline', earliestCompletionLocalDate: fallbackCompletionDate }]
  let bestAvailability: Extract<ScheduleAlternative, { code: 'add_availability' }> | null = null
  for (const [windowIndex, window] of input.availability.entries()) {
    for (let added = MIN_SESSION_MINUTES; added <= 12 * 60; added += MIN_SESSION_MINUTES) {
      const end = addMinutesToTime(window.end, added)
      if (!end) break
      const availability = input.availability.map((candidate, index) => index === windowIndex ? { ...candidate, end } : candidate)
      try {
        const result = scheduleStudyPlanInternal({ ...input, availability }, false)
        if (result.status !== 'feasible') continue
        const candidate = {
          code: 'add_availability' as const,
          additionalMinutes: result.capacity.totalAvailableMinutes - totalAvailableMinutes,
          weekday: window.weekday,
          windowStart: window.start,
          minutesPerOccurrence: added,
        }
        if (!bestAvailability || candidate.additionalMinutes < bestAvailability.additionalMinutes
          || (candidate.additionalMinutes === bestAvailability.additionalMinutes && candidate.minutesPerOccurrence < bestAvailability.minutesPerOccurrence)
          || (candidate.additionalMinutes === bestAvailability.additionalMinutes && candidate.minutesPerOccurrence === bestAvailability.minutesPerOccurrence && candidate.weekday < bestAvailability.weekday)
          || (candidate.additionalMinutes === bestAvailability.additionalMinutes && candidate.minutesPerOccurrence === bestAvailability.minutesPerOccurrence && candidate.weekday === bestAvailability.weekday && candidate.windowStart.localeCompare(bestAvailability.windowStart) < 0)) bestAvailability = candidate
        break
      }
      catch {
        break
      }
    }
  }
  if (bestAvailability) alternatives.push(bestAvailability)
  if (input.sessionMinutes > MIN_SESSION_MINUTES
    && scheduleStudyPlanInternal({ ...input, sessionMinutes: MIN_SESSION_MINUTES }, false).status === 'feasible') {
    alternatives.push({ code: 'shorten_sessions_increase_cadence', sessionMinutes: MIN_SESSION_MINUTES })
  }
  const optional = input.objectives.filter(row => row.priority === 'optional_enrichment').sort((a, b) => b.estimatedMinutes - a.estimatedMinutes || b.order - a.order || a.id.localeCompare(b.id))
  const removedIds: string[] = []
  for (const objective of optional) {
    if (input.objectives.some(row => row.prerequisiteIds.includes(objective.id))) continue
    removedIds.push(objective.id)
    const objectives = input.objectives.filter(row => !removedIds.includes(row.id))
    if (objectives.length > 0 && scheduleStudyPlanInternal({ ...input, objectives }, false).status === 'feasible') {
      alternatives.push({ code: 'remove_lower_priority_objectives', objectiveIds: [...removedIds].sort() })
      break
    }
  }
  const missing = Math.max(MIN_SESSION_MINUTES, input.sessionMinutes, requiredMinutes - usableMinutes)
  for (let removed = missing; removed < requiredMinutes; removed += MIN_SESSION_MINUTES) {
    let remaining = removed
    const objectives = [...input.objectives].sort((a, b) => b.order - a.order || b.id.localeCompare(a.id)).map(objective => {
      const reduction = Math.min(remaining, Math.max(0, objective.estimatedMinutes - MIN_SESSION_MINUTES))
      remaining -= reduction
      return { ...objective, estimatedMinutes: objective.estimatedMinutes - reduction }
    })
    if (remaining === 0 && scheduleStudyPlanInternal({ ...input, objectives }, false).status === 'feasible') {
      alternatives.push({ code: 'reduce_depth', minutesToRemove: removed })
      break
    }
  }
  return alternatives
}

function scheduleStudyPlanInternal(input: StudyPlanSchedulingInput, includeAlternatives: boolean): StudyPlanScheduleResult {
  if (input.version !== 'learn-v2.schedule-input.v1') throw new Error('Unsupported scheduling input version')
  assertTimezone(input.timezone)
  if (!Number.isSafeInteger(input.nowUtcMs)) throw new Error('nowUtcMs must be an explicit UTC millisecond instant')
  if (!Number.isSafeInteger(input.sessionMinutes) || input.sessionMinutes < MIN_SESSION_MINUTES || input.sessionMinutes > MAX_SESSION_MINUTES) throw new Error('Session length must be between 15 and 60 whole minutes')
  if (!Number.isSafeInteger(input.minRestMinutes) || input.minRestMinutes < 0 || input.minRestMinutes > 24 * 60) throw new Error('Minimum rest must be a non-negative whole-minute value')
  if (input.availability.length === 0 || input.availability.some(window => !Number.isSafeInteger(window.weekday) || window.weekday < 1 || window.weekday > 7)) throw new Error('Availability must contain valid ISO weekdays')
  if (input.reviewIntervalsDays.some(day => !Number.isSafeInteger(day) || day < 1)) throw new Error('Review intervals must be positive calendar days')
  for (const blackout of input.blackoutDates) parseDate(blackout, 'Blackout date')
  if (input.objectives.length === 0) throw new Error('At least one objective is required')
  const windowsByWeekday = new Map<number, Array<{ start: number, end: number }>>()
  for (const window of input.availability) {
    const start = parseTime(window.start, 'Availability start').totalMinutes
    const end = parseTime(window.end, 'Availability end').totalMinutes
    if (start >= end) throw new Error('Availability window end must be after its start')
    const existing = windowsByWeekday.get(window.weekday) ?? []
    if (existing.some(row => start < row.end && end > row.start)) throw new Error('Availability windows must not overlap')
    existing.push({ start, end })
    windowsByWeekday.set(window.weekday, existing)
  }
  const startDate = parseDate(input.startLocalDate, 'Start date')
  const targetDate = input.targetLocalDate ? parseDate(input.targetLocalDate, 'Target date') : null
  if (targetDate && targetDate.compare(startDate) < 0) throw new Error('Target date must not precede the start date')
  const horizonEnd = targetDate ?? startDate.add({ days: MAX_PLANNING_DAYS - 1 })
  const { segments, buffers, totalAvailableMinutes, usableMinutesAfterBuffer } = planningSegments(input, horizonEnd)
  const objectives = sortedObjectives(input)
  const placements: StudyPlacement[] = []
  const completionByObjective = new Map<string, StudyPlacement>()
  const objectiveById = new Map(objectives.map(objective => [objective.id, objective]))
  const retainedKeys = new Set<string>()
  let failed = false
  for (const retained of [...input.retainedReviews].sort((a, b) => a.independentLocalDate.localeCompare(b.independentLocalDate) || a.objectiveId.localeCompare(b.objectiveId))) {
    const objective = objectiveById.get(retained.objectiveId)
    if (!objective) throw new Error('Retained review objective is invalid')
    parseDate(retained.independentLocalDate, 'Retained review independent date')
    const key = `${retained.objectiveId}:${retained.independentLocalDate}`
    if (retainedKeys.has(key)) throw new Error('Retained review identities must be unique')
    retainedKeys.add(key)
    const durationMinutes = retained.durationMinutes ?? MIN_SESSION_MINUTES
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes < MIN_SESSION_MINUTES || durationMinutes > MAX_SESSION_MINUTES) throw new Error('Retained review duration is invalid')
    const placed = placeTask({ id: `retained-review:${key}`, kind: 'retained_review', objectiveId: retained.objectiveId, objectiveOrder: objective.order, durationMinutes, earliestLocalDate: addDays(retained.independentLocalDate, 7), priority: 'overdue_retained_review' }, segments, placements, input)
    if (!placed) failed = true
  }

  const learningPriority = new Map<SchedulingPriority, number>([['prerequisite_remediation', 0], ['new_learning', 1], ['optional_enrichment', 2]])
  const chunksByObjective = new Map(objectives.map(objective => [objective.id, splitDuration(objective.estimatedMinutes, input.sessionMinutes)]))
  const nextChunk = new Map(objectives.map(objective => [objective.id, 0]))
  const lastByObjective = new Map<string, StudyPlacement>()
  while (!failed && completionByObjective.size < objectives.length) {
    const ready = objectives.filter(objective => !completionByObjective.has(objective.id)
      && objective.prerequisiteIds.every(id => completionByObjective.has(id)))
      .sort((a, b) => learningPriority.get(a.priority)! - learningPriority.get(b.priority)! || a.order - b.order || a.id.localeCompare(b.id))
    if (ready.length === 0) throw new Error('Objective prerequisite graph must be acyclic')
    for (const objective of ready) {
      const chunks = chunksByObjective.get(objective.id)!
      const index = nextChunk.get(objective.id)!
      const prerequisiteCompletion = objective.prerequisiteIds.map(id => completionByObjective.get(id)!).sort((a, b) => b.endUtcMs - a.endUtcMs)[0]
      const last = lastByObjective.get(objective.id)
      const priorEnd = Math.max(prerequisiteCompletion?.endUtcMs ?? Number.NEGATIVE_INFINITY, last?.endUtcMs ?? Number.NEGATIVE_INFINITY)
      const placed = placeTask({ id: `learning:${objective.id}:${index + 1}`, kind: 'learning', objectiveId: objective.id, objectiveOrder: objective.order, durationMinutes: chunks[index]!, earliestLocalDate: prerequisiteCompletion?.localDate ?? input.startLocalDate, earliestUtcMs: Number.isFinite(priorEnd) ? priorEnd : undefined, priority: objective.priority }, segments, placements, input)
      if (!placed) { failed = true; break }
      lastByObjective.set(objective.id, placed)
      nextChunk.set(objective.id, index + 1)
      if (index + 1 === chunks.length) {
        completionByObjective.set(objective.id, placed)
        for (const days of [...new Set(input.reviewIntervalsDays)].sort((a, b) => a - b)) {
          const review = placeTask({ id: `review:${objective.id}:${days}`, kind: 'review', objectiveId: objective.id, objectiveOrder: objective.order, durationMinutes: MIN_SESSION_MINUTES, earliestLocalDate: addDays(placed.localDate, days), priority: 'due_review' }, segments, placements, input)
          if (!review) { failed = true; break }
        }
      }
      if (failed) break
    }
  }

  const requiredMinutes = objectives.reduce((sum, row) => sum + row.estimatedMinutes, 0)
    + objectives.length * new Set(input.reviewIntervalsDays).size * MIN_SESSION_MINUTES
    + input.retainedReviews.reduce((sum, row) => sum + (row.durationMinutes ?? MIN_SESSION_MINUTES), 0)
  placements.sort((a, b) => a.startUtcMs - b.startUtcMs || a.id.localeCompare(b.id))
  const earliestCompletionLocalDate = placements.at(-1)?.localDate ?? null
  const dayCount = targetDate ? targetDate.compare(startDate) + 1 : 0
  const finalBufferStart = targetDate ? startDate.add({ days: Math.floor(dayCount * 0.9) }).toString() : null
  const hasFinalBuffer = !targetDate || buffers.some(block => block.localDate >= finalBufferStart! && (block.endUtcMs - block.startUtcMs) / MINUTE_MS >= input.sessionMinutes)
  const feasible = !failed && placements.length > 0 && requiredMinutes <= usableMinutesAfterBuffer && hasFinalBuffer
  const effectiveSegments = targetDate || !earliestCompletionLocalDate ? segments : segments.filter(segment => segment.localDate <= earliestCompletionLocalDate)
  const effectiveBuffers = targetDate || !earliestCompletionLocalDate ? buffers : buffers.filter(block => block.localDate <= earliestCompletionLocalDate)
  const effectiveCapacity = targetDate || !earliestCompletionLocalDate
    ? { totalAvailableMinutes, usableMinutesAfterBuffer }
    : capacityForSegments(effectiveSegments)
  const reservedBufferMinutes = effectiveCapacity.totalAvailableMinutes - effectiveCapacity.usableMinutesAfterBuffer
  const unallocatedMinutes = Math.max(0, effectiveCapacity.usableMinutesAfterBuffer - requiredMinutes) + reservedBufferMinutes
  const reasonCodes = feasible
    ? ['capacity_available', 'prerequisites_ordered', 'reviews_spaced', 'buffer_reserved']
    : [...(failed || requiredMinutes > usableMinutesAfterBuffer ? ['insufficient_capacity'] : []), ...(!hasFinalBuffer ? ['final_buffer_missing'] : [])]
  const extension = includeAlternatives && targetDate
    ? scheduleStudyPlanInternal({ ...input, targetLocalDate: null }, false)
    : null
  const fallbackCompletionDate = extension?.status === 'feasible'
    ? extension.earliestCompletionLocalDate!
    : earliestCompletionLocalDate ?? startDate.add({ days: MAX_PLANNING_DAYS - 1 }).toString()
  return {
    version: LEARN_V2_SCHEDULER_VERSION,
    status: feasible ? 'feasible' : 'infeasible',
    timezone: input.timezone,
    placements,
    bufferBlocks: effectiveBuffers,
    earliestCompletionLocalDate,
    capacity: { requiredMinutes, ...effectiveCapacity, reservedBufferMinutes, unallocatedMinutes },
    reasonCodes,
    alternatives: feasible || !includeAlternatives ? [] : smallestAlternatives(input, requiredMinutes, effectiveCapacity.totalAvailableMinutes, effectiveCapacity.usableMinutesAfterBuffer, fallbackCompletionDate),
  }
}

export function scheduleStudyPlan(input: StudyPlanSchedulingInput): StudyPlanScheduleResult {
  return scheduleStudyPlanInternal(input, true)
}

export function reflowFutureIncomplete(input: ReflowInput): ReflowResult {
  if (input.version !== 'learn-v2.reflow-input.v1') throw new Error('Unsupported reflow input version')
  if (!Number.isSafeInteger(input.nowUtcMs)) throw new Error('nowUtcMs must be an explicit UTC millisecond instant')
  const priorityOrder = new Map<SchedulingPriority, number>([
    ['overdue_retained_review', 0],
    ['prerequisite_remediation', 1],
    ['due_review', 2],
    ['new_learning', 3],
    ['optional_enrichment', 4],
  ])
  const validStatuses = new Set(['planned', 'ready', 'in_progress', 'completed', 'missed', 'cancelled', 'blocked', 'generation_failed', 'needs_reschedule'])
  if (new Set(input.sessions.map(row => row.id)).size !== input.sessions.length || input.sessions.some(row => !row.id.trim())) throw new Error('Reflow session ids must be unique and non-empty')
  if (input.sessions.some(row => !Number.isSafeInteger(row.startsAtUtcMs) || !Number.isSafeInteger(row.objectiveOrder) || !priorityOrder.has(row.priority) || !validStatuses.has(row.status))) throw new Error('Reflow session fields must be valid')
  const movableStates = new Set(['planned', 'ready', 'needs_reschedule'])
  const stable = [...input.sessions].sort((a, b) => a.startsAtUtcMs - b.startsAtUtcMs || a.objectiveOrder - b.objectiveOrder || a.id.localeCompare(b.id))
  const changed = stable.filter(row => row.moveRequested && row.startsAtUtcMs > input.nowUtcMs && movableStates.has(row.status))
    .sort((a, b) => priorityOrder.get(a.priority)! - priorityOrder.get(b.priority)! || a.objectiveOrder - b.objectiveOrder || a.id.localeCompare(b.id))
  const changedIds = new Set(changed.map(row => row.id))
  return {
    version: 'learn-v2.reflow.v1',
    changedSessionIds: changed.map(row => row.id),
    preservedSessionIds: stable.filter(row => !changedIds.has(row.id)).map(row => row.id),
  }
}
