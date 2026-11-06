import { z } from 'zod'
import type { GenericId } from 'convex/values'
import { LEARN_MEASUREMENT_STORAGE_LIMITS } from './learn-v2-measurement-storage-manifest'

export const LEARN_V2_RESPONSE_CONTRACT_VERSION = 'learn-v2.responses.v1' as const
export const LEARN_V2_ASSISTANCE_POLICY_VERSION = 'learn-v2.assistance.session-wide.v1' as const
export const LEARN_V2_VALIDITY_POLICY_VERSION = 'learn-v2.assessment-validity.v1' as const
export const LEARN_V2_RETAINED_PROMOTION_INELIGIBLE = 'retained_promotion_ineligible' as const
export const LEARN_V2_RESPONSE_LIMITS = {
  ...LEARN_MEASUREMENT_STORAGE_LIMITS,
  maxStructuredEntries: 32,
  maxEntryCodeUnits: 200,
  maxReasonCodes: 32,
} as const

export const learnVersionSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/)
export const learnCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9_:-]{0,95}$/)
export const learnDigestSchema = z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/)
export const learnResponseIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._~-]{16,128}$/)
export const learnLegacyResponseKeySchema = z.string().min(1).max(128).refine(value => value.length <= 128 && value.trim().length > 0)
export const learnRevisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const learnSequenceSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const learnTimestampSchema = z.number().int().min(0).max(8_640_000_000_000_000)
export const learnScoreSchema = z.number().finite().min(0).max(100)
export const learnReasonCodesSchema = z.array(learnCodeSchema).max(32).refine(values => new Set(values).size === values.length, 'Duplicate reason codes')
export const learnObservationSchema = z.union([z.boolean(), z.literal('unknown')])
export const learnTimezoneSchema = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true }
  catch { return false }
}, 'Invalid timezone')
export const learnLocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const instant = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value
}, 'Invalid local date')

export function learnIdSchema<T extends string>() {
  return z.custom<GenericId<T>>(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value), 'Invalid owned reference')
}

export function learnTextSchema(maximum = 12_000) {
  return z.string().min(1).max(maximum).refine(value => value.length <= maximum && value.trim().length > 0, 'Text exceeds its code-unit ceiling or is empty')
}

// Bound the original wire representation before a schema can strip or transform it.
export function learnSerializedBytes(value: unknown, maximum: number = LEARN_V2_RESPONSE_LIMITS.maxEnvelopeBytes): number {
  let nodes = 0
  let bytes = 0
  const encoder = new TextEncoder()
  const seen = new Set<object>()
  const add = (amount: number) => {
    bytes += amount
    if (bytes > maximum) throw new Error('Learn payload exceeds its byte ceiling')
  }
  const visit = (input: unknown, depth: number) => {
    if (++nodes > 32_768 || depth > 16) throw new Error('Learn payload exceeds its structural ceiling')
    if (input === null) { add(4); return }
    if (typeof input === 'string') {
      if (input.length > maximum) throw new Error('Learn text exceeds its byte ceiling')
      add(encoder.encode(JSON.stringify(input)).byteLength)
      return
    }
    if (typeof input === 'boolean') { add(input ? 4 : 5); return }
    if (typeof input === 'number' && Number.isFinite(input)) { add(String(input).length); return }
    if (typeof input !== 'object' || seen.has(input)) throw new Error('Learn payload must be finite JSON data')
    const array = Array.isArray(input)
    if (!array && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new Error('Learn payload must be plain data')
    seen.add(input)
    add(2)
    const keys = Reflect.ownKeys(input)
    const entries = array ? keys.filter(key => key !== 'length') : keys
    if (array && entries.length !== input.length) throw new Error('Learn payload has a sparse or extended array')
    for (let index = 0; index < entries.length; index++) {
      const key = entries[index]!
      if (typeof key !== 'string' || (array && key !== String(index))) throw new Error('Learn payload has unsupported fields')
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!
      if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Learn payload must be plain data')
      if (index) add(1)
      if (!array) { visit(key, depth + 1); add(1) }
      visit(descriptor.value, depth + 1)
    }
    seen.delete(input)
  }
  visit(value, 0)
  return bytes
}

export function parseLearnContract<S extends z.ZodType>(schema: S, input: unknown, maximum?: number): z.output<S> {
  learnSerializedBytes(input, maximum)
  return schema.parse(input)
}

export const learnResponseTargetSchema = z.union([
  z.strictObject({ assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>() }),
  z.strictObject({ responseSlotId: learnIdSchema<'learnResponseSlots'>() }),
])
export const learnResponseStageSchema = z.enum(['retrieval', 'prediction', 'practice', 'teach_back', 'diagnostic'])
export const learnResponseSlotPinsSchema = z.strictObject({
  stage: learnResponseStageSchema, slotKey: learnVersionSchema, blockId: learnVersionSchema,
  promptDigest: learnDigestSchema, promptRevision: learnRevisionSchema, responseFormatVersion: learnVersionSchema,
  deliveryExposureId: learnIdSchema<'learnAssessmentExposures'>(), revision: learnRevisionSchema,
})
export const learnResponsePayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: learnTextSchema() }),
  z.strictObject({ kind: z.literal('keyed'), keys: z.array(learnTextSchema(200)).min(1).max(32).refine(values => new Set(values).size === values.length) }),
  z.strictObject({ kind: z.literal('numeric'), value: z.number().finite(), unit: learnTextSchema(100) }),
  z.strictObject({ kind: z.literal('ordered'), entries: z.array(learnTextSchema(200)).min(1).max(32) }),
  z.strictObject({ kind: z.literal('source_comparison'), sourceRef: learnTextSchema(200), comparison: learnTextSchema() }),
]).superRefine((payload, ctx) => {
  try { learnSerializedBytes(payload, LEARN_V2_RESPONSE_LIMITS.maxResponseBytes) }
  catch { ctx.addIssue({ code: 'custom', message: 'Response exceeds its byte ceiling' }) }
})

export const learnAssistanceSnapshotSchema = z.strictObject({
  policyVersion: learnVersionSchema,
  state: z.enum(['unassisted', 'assisted', 'unknown']),
  assistanceRevision: learnSequenceSchema,
  substantiveHintUsedAt: learnTimestampSchema.nullable(),
  answerRevealedAt: learnTimestampSchema.nullable(),
  priorExposure: z.enum(['known', 'unknown', 'prospectively_unexposed']),
  outsideHelp: z.enum(['reported', 'not_reported', 'unknown']),
  pasteObserved: learnObservationSchema,
  focusLossObserved: learnObservationSchema,
  instrumentationVersion: learnVersionSchema,
  instrumentationProvenance: learnVersionSchema,
}).refine(value => value.state !== 'unassisted' || (value.substantiveHintUsedAt === null && value.answerRevealedAt === null && value.outsideHelp !== 'reported'), 'Delivered assistance cannot be unassisted')

export const learnValiditySnapshotSchema = z.strictObject({
  policyVersion: learnVersionSchema,
  status: z.enum(['valid', 'excluded', 'unknown']),
  measurementEligible: z.boolean(), masteryEligible: z.boolean(), exclusionReasons: learnReasonCodesSchema,
}).refine(value => value.status === 'valid'
  ? value.exclusionReasons.length === 0 || (value.measurementEligible && !value.masteryEligible
    && value.exclusionReasons.length === 1 && value.exclusionReasons[0] === LEARN_V2_RETAINED_PROMOTION_INELIGIBLE)
  : !value.measurementEligible && !value.masteryEligible && value.exclusionReasons.length > 0, 'Inconsistent validity')

export const learnAssistanceDeliverySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('requested_denied'), reasonCode: learnCodeSchema, requestedAt: learnTimestampSchema }),
  z.strictObject({ kind: z.literal('delivered'), exposureId: learnIdSchema<'learnAssessmentExposures'>(), deliveredAt: learnTimestampSchema, level: z.enum(['hint', 'reveal', 'explanation', 'outside_help']) }),
])

export const learnResponseDependencySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('snapshot'), sourceSnapshotId: learnIdSchema<'learnSourceSnapshots'>(), sourceSnapshotRevision: learnRevisionSchema, sourceRecordRevision: learnRevisionSchema, supportManifestDigest: learnDigestSchema }),
  z.strictObject({ kind: z.literal('document'), documentId: learnIdSchema<'documents'>(), sourceRevision: learnVersionSchema }),
  z.strictObject({ kind: z.literal('folder'), folderId: learnIdSchema<'folders'>(), scopeRevision: learnVersionSchema }),
])

export const learnAcceptResponseEntrySchema = z.strictObject({
  target: learnResponseTargetSchema, expectedRevision: learnRevisionSchema,
  payload: learnResponsePayloadSchema, confidence: z.number().int().min(1).max(5).optional(),
  instrumentation: z.strictObject({ pasteObserved: learnObservationSchema, focusLossObserved: learnObservationSchema, version: learnVersionSchema }).optional(),
})
export const learnAcceptResponseRequestSchema = z.strictObject({
  version: z.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION),
  idempotencyKey: learnResponseIdempotencyKeySchema,
  response: learnAcceptResponseEntrySchema,
})
export const learnFinalResponseBundleSchema = z.strictObject({
  version: z.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION),
  idempotencyKey: learnResponseIdempotencyKeySchema,
  teachBack: learnAcceptResponseEntrySchema.refine(entry => 'responseSlotId' in entry.target),
  application: learnAcceptResponseEntrySchema.refine(entry => 'assessmentOpportunityId' in entry.target),
})
export const LEARN_V2_RESPONSE_REJECTION_CODES = [
  'disabled', 'unavailable', 'invalid_payload', 'empty_response', 'payload_too_large',
  'stale_revision', 'idempotency_conflict', 'already_accepted', 'not_delivered',
  'evidence_unavailable', 'outside_window', 'pins_mismatch', 'unauthorized',
  'confidence_required', 'confidence_not_requested', 'source_scope_too_large',
] as const
export const learnResponseReceiptSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accepted'), version: z.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION), target: learnResponseTargetSchema,
    submissionId: learnIdSchema<'learnResponses'>(), acceptedAt: learnTimestampSchema, revision: learnRevisionSchema,
    phase: z.enum(['accepted', 'submitted_sealed']), bodyAvailability: z.literal('available') }),
  z.strictObject({ kind: z.literal('rejected'), version: z.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION), reasonCode: z.enum(LEARN_V2_RESPONSE_REJECTION_CODES) }),
])
export const learnResponseBodyStateSchema = z.discriminatedUnion('bodyAvailability', [
  z.strictObject({ bodyAvailability: z.literal('available'), payload: learnResponsePayloadSchema }),
  z.strictObject({ bodyAvailability: z.literal('unavailable'), reasonCode: z.literal('evidence_unavailable') }),
  z.strictObject({ bodyAvailability: z.literal('purged'), reasonCode: z.literal('evidence_unavailable'), purgedAt: learnTimestampSchema }),
])

export type LearnResponseTarget = z.infer<typeof learnResponseTargetSchema>
export type LearnResponsePayload = z.infer<typeof learnResponsePayloadSchema>
export type LearnAssistanceSnapshot = z.infer<typeof learnAssistanceSnapshotSchema>
export type LearnValiditySnapshot = z.infer<typeof learnValiditySnapshotSchema>
export type LearnResponseReceipt = z.infer<typeof learnResponseReceiptSchema>

export function validateLearnAcceptResponseRequest(input: unknown, slot: { confidenceRequested: boolean, diagnostic: boolean }) {
  const request = parseLearnContract(learnAcceptResponseRequestSchema, input)
  if (slot.confidenceRequested !== (request.response.confidence !== undefined)) throw new Error('Confidence does not match the owned slot')
  if (slot.diagnostic) learnSerializedBytes(request.response.payload, LEARN_V2_RESPONSE_LIMITS.maxDiagnosticBytes)
  return request
}

export function resolveLearnInstrumentation(input: z.infer<typeof learnAcceptResponseEntrySchema>['instrumentation']) {
  return input ?? { pasteObserved: 'unknown' as const, focusLossObserved: 'unknown' as const, version: 'learn-v2.instrumentation.unknown.v1' }
}
