import { z } from 'zod'
import { CalendarDateTime, toZoned } from '@internationalized/date'
import { addCalendarDays, localDateAt } from '../../shared/learn-v2-mastery'
import { learnAssessmentClockSchema } from '../../shared/learn-v2-delayed-check'
import {
  LEARN_V2_FORM_ORDERS, learnMeasurementAllocationSchema, learnMeasurementFlowSchema,
  learnMeasurementHorizonSchema, learnScorerBindingSchema, type LearnMeasurementItemPins,
} from '../../shared/learn-v2-measurement'
import { learnTimestampSchema, learnVersionSchema, parseLearnContract } from '../../shared/learn-v2-responses'
import { privacyDigest } from './learnV2ResponsePrivacy'

export const LEARN_MEASUREMENT_ALLOCATION_VERSION = 'learn-v2.uniform-form-order.v1'
export const LEARN_MEASUREMENT_ELIGIBILITY_VERSION = 'learn-v2.measurement-eligibility.v1'
const minute = z.number().int().min(0).max(1439)
const windowSchema = z.strictObject({
  horizonDays: learnMeasurementHorizonSchema, dueMinute: minute,
  openDayOffset: z.number().int().min(0).max(30), openMinute: minute,
  closeDayOffset: z.number().int().min(0).max(31), closeMinute: minute,
}).refine(value => value.openDayOffset * 1440 + value.openMinute <= value.dueMinute
  && value.dueMinute < value.closeDayOffset * 1440 + value.closeMinute)
export const learnMeasurementProtocolSchema = z.strictObject({
  version: learnVersionSchema, epoch: learnVersionSchema, baselineSha: z.string().regex(/^[a-f0-9]{40}$/),
  cohortVersion: learnVersionSchema, schedulingPolicyVersion: learnVersionSchema,
  enrollmentStartAt: learnTimestampSchema, enrollmentEndAt: learnTimestampSchema,
  flows: z.array(learnMeasurementFlowSchema).min(1).max(2),
  anchorKind: z.enum(['enrollment', 'sealed_cold']),
  coldWindowMs: z.number().int().positive().max(31 * 86_400_000),
  disambiguation: z.enum(['earlier', 'later', 'reject']),
  replacementReasons: z.array(z.enum(['novel_item_unavailable', 'evidence_unavailable', 'contaminated', 'abandoned'])).max(4),
  windows: z.array(windowSchema).min(1).max(2), scoringBinding: learnScorerBindingSchema,
}).refine(value => value.enrollmentStartAt < value.enrollmentEndAt
  && new Set(value.flows).size === value.flows.length
  && new Set(value.windows.map(window => window.horizonDays)).size === value.windows.length)
export type LearnMeasurementProtocol = z.infer<typeof learnMeasurementProtocolSchema>

// Owner protocol #362 has not been frozen. No request can supply a protocol.
export function getFrozenLearnMeasurementProtocol(): LearnMeasurementProtocol | null { return null }

export async function measurementWindowPolicyDigest(protocol: LearnMeasurementProtocol) {
  return await privacyDigest(parseLearnContract(learnMeasurementProtocolSchema, protocol))
}

export function allocateLearnMeasurementItems(items: LearnMeasurementItemPins[], horizonDays?: 7 | 30) {
  if (items.length !== 2 && items.length !== 3) throw new Error('Measurement core inventory is invalid')
  const count = items.length === 3 ? 6 : 2
  const limit = Math.floor(0x1_0000_0000 / count) * count
  let word = 0
  let accepted = false
  for (let attempt = 0; attempt < 16; attempt++) {
    word = Math.floor(Math.random() * 0x1_0000_0000)
    if (word < limit) { accepted = true; break }
  }
  if (!accepted) throw new Error('Measurement allocation entropy is unavailable')
  const sequenceIndex = word % count
  const order = items.length === 3 ? LEARN_V2_FORM_ORDERS[sequenceIndex]! : sequenceIndex === 0 ? 'AB' : 'BA'
  const ordered = [...order].map(label => {
    const item = items.find(pin => pin.formLabel === label)
    if (!item) throw new Error('Measurement core form is missing')
    return item
  })
  if (items.length === 2 && horizonDays === undefined) throw new Error('Two-form horizon is not declared')
  const allocation = parseLearnContract(learnMeasurementAllocationSchema, items.length === 3
    ? { kind: 'three_case', order, cold: ordered[0], day7: ordered[1], day30: ordered[2] }
    : { kind: 'two_case', horizonDays, cold: ordered[0], delayed: ordered[1] })
  return { allocation, sequenceIndex, randomizationSeed: word.toString(16).padStart(8, '0'), allocationVersion: LEARN_MEASUREMENT_ALLOCATION_VERSION }
}

export function measurementClock(protocol: LearnMeasurementProtocol, anchor: { at: number, eventId: string }, timezone: string, horizonDays: 7 | 30) {
  const policy = protocol.windows.find(window => window.horizonDays === horizonDays)
  if (!policy) throw new Error('Measurement horizon is not assigned')
  const dueLocalDate = addCalendarDays(localDateAt(anchor.at, timezone), horizonDays)
  const instant = (dayOffset: number, minutes: number) => {
    const date = addCalendarDays(dueLocalDate, dayOffset)
    const [year, month, day] = date.split('-').map(Number) as [number, number, number]
    return toZoned(new CalendarDateTime(year, month, day, Math.floor(minutes / 60), minutes % 60), timezone, protocol.disambiguation).toDate().getTime()
  }
  return parseLearnContract(learnAssessmentClockSchema, {
    protocolVersion: protocol.version, schedulingPolicyVersion: protocol.schedulingPolicyVersion,
    anchorKind: protocol.anchorKind, anchorEventId: anchor.eventId, anchorAt: anchor.at, horizonDays, timezone, dueLocalDate,
    dueAt: instant(0, policy.dueMinute), openAt: instant(policy.openDayOffset, policy.openMinute),
    closeAt: instant(policy.closeDayOffset, policy.closeMinute),
  })
}
