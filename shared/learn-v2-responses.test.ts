import { describe, expect, it } from 'vitest'
import { deriveLearnAssessmentResponseContext } from './learn-v2-measurement'
import {
  LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_CONTEXT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION,
  learnAssessmentResponseContextSchema, learnResponseDeliveryPinsSchema, learnResponseSlotPinsSchema,
  learnResponseTerminalizedResultSchema, resolveLearnResponseConfidenceRequested, validateLearnAcceptResponseRequest,
} from './learn-v2-responses'

const plan = { studyPlanId: 'plan1', studyPlanRevisionId: 'planRevision1', planRevision: 1, planRecordRevision: 1 }
const planned = { kind: 'planned_measurement', ...plan }
const session = { kind: 'session', ...plan, studySessionId: 'session1', sessionRevision: 1, sessionContentId: 'content1', contentRevision: 1,
  contentInputDigest: `sha256:${'a'.repeat(64)}`, generatorVersion: 'generator.v1' }
const canvas = { threadId: 'thread1', threadRevision: 1, activityId: 'activity1', activityRevision: 1, planVersion: 'plan.v1',
  replayVersion: 'replay.v1', rendererVersion: 'renderer.v1', evaluationVersion: 'evaluation.v1', pilotConfigurationVersion: 'pilot.v1' }
const assignment = { status: 'admitted', assignmentId: 'assignment1', epoch: 'epoch.v1', flow: 'v2_today' }
const request = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'response_1234567890',
  response: { target: { responseSlotId: 'slot1' }, expectedRevision: 1, payload: { kind: 'text', text: 'Answer' } } }

describe('response context v1', () => {
  it.each([
    [session, 'today'], [{ ...session, canvas }, 'canvas'],
    [{ kind: 'calibration', origin: 'today' }, 'today'], [{ kind: 'calibration', origin: 'canvas' }, 'canvas'],
  ])('derives ordinary response flow from authoritative context: %j', (contextPins, flow) => {
    for (const admission of [null, { status: 'considered' }, { status: 'not_admitted' }]) {
      expect(deriveLearnAssessmentResponseContext({ contextPins, assignment: admission })).toEqual({
        responseContextVersion: LEARN_V2_RESPONSE_CONTEXT_VERSION, flow, measurementContext: { status: 'not_enrolled' },
      })
    }
  })

  it.each(['v2_today', 'v2_canvas'])('uses the admitted assignment for planned measurement: %s', flow => {
    expect(deriveLearnAssessmentResponseContext({ contextPins: planned, assignment: { ...assignment, flow } })).toEqual({
      responseContextVersion: LEARN_V2_RESPONSE_CONTEXT_VERSION, flow: flow === 'v2_today' ? 'today' : 'canvas',
      measurementContext: { status: 'admitted', assignmentId: 'assignment1', baselineEpoch: 'epoch.v1' },
    })
  })

  it.each([session, { kind: 'calibration', origin: 'today' }])('pins admitted measurement on other assessment contexts: %j', contextPins => {
    expect(deriveLearnAssessmentResponseContext({ contextPins, assignment }).measurementContext).toEqual({ status: 'admitted', assignmentId: 'assignment1', baselineEpoch: 'epoch.v1' })
  })

  it.each([
    { contextPins: planned, assignment: null }, { contextPins: planned, assignment: { status: 'considered' } },
    { contextPins: planned, assignment: { status: 'not_admitted' } }, { contextPins: { kind: 'calibration' }, assignment: null },
    { contextPins: { kind: 'calibration', origin: 'unknown' }, assignment: null },
    { contextPins: { ...session, canvas }, assignment }, { contextPins: { kind: 'calibration', origin: 'canvas' }, assignment },
    { contextPins: planned, assignment: { ...assignment, epoch: undefined } }, { contextPins: planned, assignment: { ...assignment, flow: 'today' } },
    { contextPins: { ...session, canvas: {} }, assignment: null }, { contextPins: { kind: 'unknown' }, assignment: null },
    { contextPins: session, assignment: null, flow: 'canvas' },
  ])('fails closed on missing, mismatched or forged provenance: %j', source => {
    expect(() => deriveLearnAssessmentResponseContext(source)).toThrow()
  })

  it('does not accept an invented epoch or an admitted assignment without an epoch', () => {
    const context = deriveLearnAssessmentResponseContext({ contextPins: session, assignment: null })
    expect(() => learnAssessmentResponseContextSchema.parse({ ...context, measurementContext: { status: 'not_enrolled', baselineEpoch: 'invented' } })).toThrow()
    expect(() => learnAssessmentResponseContextSchema.parse({ ...context, measurementContext: { status: 'admitted', assignmentId: 'assignment1' } })).toThrow()
  })
})

describe('server-pinned confidence', () => {
  it.each([undefined, false, true])('compares acceptance to a slot confidence pin: %s', confidenceRequested => {
    const pin = confidenceRequested === undefined ? { diagnostic: false } : { diagnostic: false, confidenceRequested }
    expect(resolveLearnResponseConfidenceRequested(pin)).toBe(confidenceRequested === true)
    const withConfidence = { ...request, response: { ...request.response, confidence: 3 } }
    expect(() => validateLearnAcceptResponseRequest(confidenceRequested ? withConfidence : request, pin)).not.toThrow()
    expect(() => validateLearnAcceptResponseRequest(confidenceRequested ? request : withConfidence, pin)).toThrow()
  })

  it.each([false, true])('uses the assessment delivery confidence pin: %s', confidenceRequested => {
    const deliveryPins = learnResponseDeliveryPinsSchema.parse({ version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested })
    const response = confidenceRequested ? { ...request.response, confidence: 4 } : request.response
    expect(() => validateLearnAcceptResponseRequest({ ...request, response }, { diagnostic: false, deliveryPins })).not.toThrow()
    expect(() => validateLearnAcceptResponseRequest({ ...request, response: confidenceRequested ? request.response : { ...response, confidence: 4 } }, { diagnostic: false, deliveryPins })).toThrow()
  })

  it('normalizes legacy slot confidence to false and rejects client confidence policy', () => {
    const pins = { stage: 'practice', slotKey: 'slot.v1', blockId: 'block.v1', promptDigest: 'a'.repeat(64), promptRevision: 1,
      responseFormatVersion: 'text.v1', deliveryExposureId: 'exposure1', revision: 1 }
    expect(learnResponseSlotPinsSchema.parse(pins).confidenceRequested).toBe(false)
    expect(() => validateLearnAcceptResponseRequest({ ...request, response: { ...request.response, confidenceRequested: true } }, { diagnostic: false })).toThrow()
    expect(() => learnResponseDeliveryPinsSchema.parse({ version: 'unknown.v1', confidenceRequested: false })).toThrow()
  })
})

describe('terminalized receipt result', () => {
  it.each([{ responseSlotId: 'slot1' }, { assessmentOpportunityId: 'opportunity1' }])('preserves the terminal outcome for %j', target => {
    for (const reasonCode of ['cancelled', 'abandoned']) {
      const result = { kind: 'terminalized', target, revision: 2, reasonCode, terminalizedAt: 1000 }
      expect(learnResponseTerminalizedResultSchema.parse(result)).toEqual(result)
      for (const invalid of [{ ...result, revision: 0 }, { ...result, revision: 1.5 }, { ...result, terminalizedAt: -1 },
        { ...result, reasonCode: 'browser_closed' }, { ...result, expiresAt: 2000 }, { ...result, payload: 'private' }]) {
        expect(() => learnResponseTerminalizedResultSchema.parse(invalid)).toThrow()
      }
    }
  })
})
