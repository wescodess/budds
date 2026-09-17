import { describe, expect, test } from 'vitest'
import { reflowFutureIncomplete, scheduleStudyPlan } from '../../shared/learn-v2-scheduling'

describe('Learn V2 pure feasibility and scheduling', () => {
  test('orders prerequisites and calendar-day reviews inside buffered availability', () => {
    const result = scheduleStudyPlan({
      version: 'learn-v2.schedule-input.v1',
      nowUtcMs: Date.parse('2026-09-14T08:00:00.000Z'),
      timezone: 'UTC',
      startLocalDate: '2026-09-14',
      targetLocalDate: '2026-09-18',
      sessionMinutes: 25,
      minRestMinutes: 5,
      availability: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '12:00' })),
      blackoutDates: [],
      reviewIntervalsDays: [1, 3],
      objectives: [
        { id: 'foundation', order: 0, estimatedMinutes: 25, prerequisiteIds: [], priority: 'new_learning' },
        { id: 'application', order: 1, estimatedMinutes: 25, prerequisiteIds: ['foundation'], priority: 'new_learning' },
      ],
      retainedReviews: [],
    })

    expect(result.status).toBe('feasible')
    expect(result.placements.map(row => [row.kind, row.objectiveId, row.localDate, row.startUtcMs])).toEqual([
      ['learning', 'foundation', '2026-09-14', Date.parse('2026-09-14T09:00:00.000Z')],
      ['learning', 'application', '2026-09-14', Date.parse('2026-09-14T09:30:00.000Z')],
      ['review', 'foundation', '2026-09-15', Date.parse('2026-09-15T09:00:00.000Z')],
      ['review', 'application', '2026-09-15', Date.parse('2026-09-15T09:20:00.000Z')],
      ['review', 'foundation', '2026-09-17', Date.parse('2026-09-17T09:00:00.000Z')],
      ['review', 'application', '2026-09-17', Date.parse('2026-09-17T09:20:00.000Z')],
    ])
    expect(result.capacity).toMatchObject({ requiredMinutes: 110, totalAvailableMinutes: 900, usableMinutesAfterBuffer: 765 })
    expect(result.bufferBlocks.some(block => block.localDate === '2026-09-18')).toBe(true)
  })

  test('moves a nonexistent Toronto wall time forward and chooses the earlier repeated offset', () => {
    const base = {
      version: 'learn-v2.schedule-input.v1' as const,
      nowUtcMs: Date.parse('2027-01-01T00:00:00.000Z'),
      timezone: 'America/Toronto',
      sessionMinutes: 30,
      minRestMinutes: 0,
      blackoutDates: [],
      reviewIntervalsDays: [],
      objectives: [{ id: 'dst', order: 0, estimatedMinutes: 30, prerequisiteIds: [], priority: 'new_learning' as const }],
      retainedReviews: [],
    }
    const spring = scheduleStudyPlan({ ...base, startLocalDate: '2027-03-14', targetLocalDate: '2027-03-14', availability: [{ weekday: 7, start: '02:00', end: '06:30' }] })
    expect(spring).toMatchObject({ status: 'feasible', placements: [{ startUtcMs: Date.parse('2027-03-14T07:00:00.000Z'), offsetMinutes: -240, adjustment: 'dst_gap_forward' }] })
    expect(spring.capacity.totalAvailableMinutes).toBe(210)

    const fall = scheduleStudyPlan({ ...base, startLocalDate: '2027-11-07', targetLocalDate: '2027-11-07', availability: [{ weekday: 7, start: '01:30', end: '04:00' }] })
    expect(fall).toMatchObject({ status: 'feasible', placements: [{ startUtcMs: Date.parse('2027-11-07T05:30:00.000Z'), offsetMinutes: -240, adjustment: 'dst_repeat_earlier_offset' }] })
  })

  test('reflows only requested future incomplete sessions in the canonical priority order', () => {
    const sessions = [
      { id: 'past-ready', status: 'ready' as const, startsAtUtcMs: 90, moveRequested: true, priority: 'due_review' as const, objectiveOrder: 0 },
      { id: 'completed', status: 'completed' as const, startsAtUtcMs: 110, moveRequested: true, priority: 'due_review' as const, objectiveOrder: 0 },
      { id: 'future-new', status: 'planned' as const, startsAtUtcMs: 130, moveRequested: true, priority: 'new_learning' as const, objectiveOrder: 0 },
      { id: 'future-retained', status: 'needs_reschedule' as const, startsAtUtcMs: 140, moveRequested: true, priority: 'overdue_retained_review' as const, objectiveOrder: 2 },
      { id: 'future-progress', status: 'in_progress' as const, startsAtUtcMs: 150, moveRequested: true, priority: 'prerequisite_remediation' as const, objectiveOrder: 1 },
      { id: 'missed', status: 'missed' as const, startsAtUtcMs: 155, moveRequested: true, priority: 'due_review' as const, objectiveOrder: 1 },
      { id: 'future-unrequested', status: 'planned' as const, startsAtUtcMs: 160, moveRequested: false, priority: 'optional_enrichment' as const, objectiveOrder: 3 },
    ]
    const expected = {
      version: 'learn-v2.reflow.v1',
      changedSessionIds: ['future-retained', 'future-new'],
      preservedSessionIds: ['past-ready', 'completed', 'future-progress', 'missed', 'future-unrequested'],
    }
    expect(reflowFutureIncomplete({ version: 'learn-v2.reflow-input.v1', nowUtcMs: 100, sessions })).toEqual(expected)
    expect(reflowFutureIncomplete({ version: 'learn-v2.reflow-input.v1', nowUtcMs: 100, sessions: [...sessions].reverse() })).toEqual(expected)
  })

  test('returns the earliest completion date and explicit alternatives for an infeasible deadline', () => {
    const input = {
      version: 'learn-v2.schedule-input.v1' as const,
      nowUtcMs: Date.parse('2026-09-14T08:00:00.000Z'),
      timezone: 'UTC',
      startLocalDate: '2026-09-14',
      targetLocalDate: '2026-09-14',
      sessionMinutes: 30,
      minRestMinutes: 0,
      availability: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '10:00' })),
      blackoutDates: [],
      reviewIntervalsDays: [],
      objectives: [{ id: 'deep-work', order: 0, estimatedMinutes: 60, prerequisiteIds: [], priority: 'new_learning' as const }],
      retainedReviews: [],
    }
    const dated = scheduleStudyPlan(input)
    expect(dated.status).toBe('infeasible')
    expect(dated.alternatives[0]).toEqual({ code: 'extend_deadline', earliestCompletionLocalDate: '2026-09-15' })
    const added = dated.alternatives.find(row => row.code === 'add_availability')
    expect(added).toEqual({ code: 'add_availability', additionalMinutes: 135, weekday: 1, windowStart: '09:00', minutesPerOccurrence: 135 })
    const expandedEnd = `${String(10 + Math.floor(added!.minutesPerOccurrence / 60)).padStart(2, '0')}:${String(added!.minutesPerOccurrence % 60).padStart(2, '0')}`
    expect(scheduleStudyPlan({ ...input, availability: input.availability.map(window => window.weekday === added!.weekday ? { ...window, end: expandedEnd } : window) }).status).toBe('feasible')

    const undated = scheduleStudyPlan({ ...input, targetLocalDate: null })
    expect(undated).toMatchObject({ status: 'feasible', earliestCompletionLocalDate: '2026-09-15' })
  })

  test('rejects a dated plan without a full buffer block in its final ten percent', () => {
    const result = scheduleStudyPlan({
      version: 'learn-v2.schedule-input.v1',
      nowUtcMs: Date.parse('2026-09-14T08:00:00.000Z'),
      timezone: 'UTC',
      startLocalDate: '2026-09-14',
      targetLocalDate: '2026-09-14',
      sessionMinutes: 15,
      minRestMinutes: 0,
      availability: [{ weekday: 1, start: '09:00', end: '09:30' }],
      blackoutDates: [],
      reviewIntervalsDays: [],
      objectives: [{ id: 'small', order: 0, estimatedMinutes: 15, prerequisiteIds: [], priority: 'new_learning' }],
      retainedReviews: [],
    })
    expect(result.status).toBe('infeasible')
    expect(result.reasonCodes).toContain('final_buffer_missing')
  })

  test('keeps blackout and retained-review scheduling deterministic across input order', () => {
    const input = {
      version: 'learn-v2.schedule-input.v1' as const,
      nowUtcMs: Date.parse('2026-10-01T00:00:00.000Z'),
      timezone: 'America/Toronto',
      startLocalDate: '2026-10-05',
      targetLocalDate: '2026-10-16',
      sessionMinutes: 25,
      minRestMinutes: 5,
      availability: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '11:00' })),
      blackoutDates: ['2026-10-05'],
      reviewIntervalsDays: [],
      objectives: [
        { id: 'optional', order: 2, estimatedMinutes: 25, prerequisiteIds: ['core'], priority: 'optional_enrichment' as const },
        { id: 'core', order: 1, estimatedMinutes: 25, prerequisiteIds: [], priority: 'new_learning' as const },
      ],
      retainedReviews: [{ objectiveId: 'core', independentLocalDate: '2026-10-01' }],
    }
    const scheduled = scheduleStudyPlan(input)
    const reordered = scheduleStudyPlan({ ...input, objectives: [...input.objectives].reverse(), availability: [...input.availability].reverse() })

    expect(scheduled).toEqual(reordered)
    expect(scheduled.placements.every(row => row.localDate !== '2026-10-05')).toBe(true)
    expect(scheduled.placements.find(row => row.kind === 'retained_review')?.localDate).toBe('2026-10-08')
  })

  test('enforces rest across midnight and interleaves independent objectives', () => {
    const result = scheduleStudyPlan({
      version: 'learn-v2.schedule-input.v1',
      nowUtcMs: Date.parse('2026-09-14T00:00:00.000Z'),
      timezone: 'UTC',
      startLocalDate: '2026-09-14',
      targetLocalDate: null,
      sessionMinutes: 30,
      minRestMinutes: 60,
      availability: [{ weekday: 1, start: '23:00', end: '23:59' }, { weekday: 2, start: '00:00', end: '03:00' }],
      blackoutDates: [],
      reviewIntervalsDays: [],
      objectives: [
        { id: 'a', order: 1, estimatedMinutes: 60, prerequisiteIds: [], priority: 'new_learning' },
        { id: 'b', order: 2, estimatedMinutes: 60, prerequisiteIds: [], priority: 'new_learning' },
      ],
      retainedReviews: [],
    })
    expect(result.placements.map(row => row.id)).toEqual(['learning:a:1', 'learning:b:1', 'learning:a:2', 'learning:b:2'])
    expect(result.placements[1]!.startUtcMs - result.placements[0]!.endUtcMs).toBe(60 * 60_000)
  })

  test('reserves overdue retained work ahead of new learning and rejects duplicate retained identities', () => {
    const input = {
      version: 'learn-v2.schedule-input.v1' as const,
      nowUtcMs: Date.parse('2026-09-14T00:00:00.000Z'),
      timezone: 'UTC',
      startLocalDate: '2026-09-14',
      targetLocalDate: null,
      sessionMinutes: 30,
      minRestMinutes: 0,
      availability: [{ weekday: 1, start: '09:00', end: '10:00' }],
      blackoutDates: [],
      reviewIntervalsDays: [],
      objectives: [{ id: 'core', order: 0, estimatedMinutes: 30, prerequisiteIds: [], priority: 'new_learning' as const }],
      retainedReviews: [{ objectiveId: 'core', independentLocalDate: '2026-09-07' }],
    }
    expect(scheduleStudyPlan(input).placements.map(row => row.kind)).toEqual(['retained_review', 'learning'])
    expect(() => scheduleStudyPlan({ ...input, retainedReviews: [input.retainedReviews[0]!, input.retainedReviews[0]!] })).toThrow('Retained review identities must be unique')
  })

  test('requires a preferred-session-sized final buffer block', () => {
    const result = scheduleStudyPlan({
      version: 'learn-v2.schedule-input.v1',
      nowUtcMs: Date.parse('2026-09-14T00:00:00.000Z'),
      timezone: 'UTC',
      startLocalDate: '2026-09-14',
      targetLocalDate: '2026-09-14',
      sessionMinutes: 60,
      minRestMinutes: 0,
      availability: [{ weekday: 1, start: '09:00', end: '13:00' }],
      blackoutDates: [],
      reviewIntervalsDays: [],
      objectives: [{ id: 'core', order: 0, estimatedMinutes: 60, prerequisiteIds: [], priority: 'new_learning' }],
      retainedReviews: [],
    })
    expect(result.status).toBe('infeasible')
    expect(result.reasonCodes).toContain('final_buffer_missing')
  })

  test('skips overlapping availability alternatives and validates boundary enums', () => {
    const input = {
      version: 'learn-v2.schedule-input.v1' as const,
      nowUtcMs: Date.parse('2026-09-14T00:00:00.000Z'),
      timezone: 'UTC',
      startLocalDate: '2026-09-14',
      targetLocalDate: '2026-09-14',
      sessionMinutes: 60,
      minRestMinutes: 0,
      availability: [{ weekday: 1, start: '09:00', end: '10:00' }, { weekday: 1, start: '10:30', end: '11:00' }],
      blackoutDates: [],
      reviewIntervalsDays: [],
      objectives: [{ id: 'core', order: 0, estimatedMinutes: 60, prerequisiteIds: [], priority: 'new_learning' as const }],
      retainedReviews: [],
    }
    expect(() => scheduleStudyPlan(input)).not.toThrow()
    expect(() => scheduleStudyPlan({ ...input, objectives: [{ ...input.objectives[0]!, priority: 'unknown' as 'new_learning' }] })).toThrow('Objective order and priority must be valid')
    expect(() => reflowFutureIncomplete({
      version: 'learn-v2.reflow-input.v1',
      nowUtcMs: 0,
      sessions: [{ id: 'bad', status: 'planned', startsAtUtcMs: 1, moveRequested: true, priority: 'unknown' as 'new_learning', objectiveOrder: 0 }],
    })).toThrow('Reflow session fields must be valid')
  })
})
