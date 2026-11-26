import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, learnAcceptResponseRequestSchema, learnResponseIdempotencyKeySchema, learnResponseReceiptSchema } from '~~/shared/learn-v2-responses'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, LEARN_V2_POST_SEAL_TEACHING_VERSION, learnAttemptHistorySchema, learnAuthorizePracticeAssistanceSchema, learnDeliveredAssessmentSchema, learnPostSealPracticeSchema, learnPostSealTeachingReferenceSchema, learnPostSealTeachingSchema, learnPracticeAssistanceAuthorizationSchema } from '~~/shared/learn-v2-assessment-disclosure'
import { LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, learnAssessmentCapabilitiesSchema, type LearnAssessmentPhase } from '~~/shared/learn-v2-delayed-check'
import { acceptMasterySubmissionSchema, scoreMasterySubmissionSchema, LEARN_V2_PUBLIC_API_VERSION } from '~~/convex/lib/learnV2PublicContract'
import { serverAssessmentCanvas, serverCheckReceipt, serverSavedCheckCanvas } from '../support/canvas-check-projection'
import { adaptiveRecoveryCopy } from '~~/shared/learn-adaptive-recovery'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const stateData = shallowRef<unknown>(null)
const deliveryData = shallowRef<unknown>(null)
const workData = shallowRef<unknown>(null)
const teachingData = shallowRef<unknown>(null)
const practiceWorkData = shallowRef<unknown>(null)
const subscriptions = vi.fn()
const isOnline = ref(true)
const grant = vi.fn()
const attach = vi.fn()
const accept = vi.fn()
const acceptPractice = vi.fn()
const score = vi.fn()
const authorizePractice = vi.fn()
const openPracticeCommand = vi.fn()
const publishFeedbackCommand = vi.fn()
const authorizeLegacy = vi.fn()
const recordAssistance = vi.fn()
const stageLegacy = vi.fn()
const scoreLegacy = vi.fn()

mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexQuery', () => (reference: never, args: unknown) => {
  const name = getFunctionName(reference) ?? ''
  subscriptions(name, args)
  return { data: name.includes('getPostSealTeaching') ? teachingData : name.includes('getAssessmentState') ? stateData : name.includes('getAssessment') ? deliveryData : name.includes('getResponseState') ? ((args as { target?: { responseSlotId?: string } } | undefined)?.target?.responseSlotId ? practiceWorkData : workData) : ref(null), pending: ref(false) }
})
mockNuxtImport('useConvexMutation', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { mutate: name.includes('learnAdaptiveCanvas:attachReadySession') ? attach : name.includes('learnV2PostSealTeaching:openPractice') ? openPracticeCommand : name.includes('learnV2PostSealTeaching:publishFeedback') ? publishFeedbackCommand : name.includes('grantAssessmentDelivery') ? grant : name.includes('acceptMasterySubmission') ? accept : name.includes('acceptResponse') ? acceptPractice : name.includes('authorizePracticeAssistance') ? authorizePractice : name.includes('authorizeAssistance') ? authorizeLegacy : name.includes('recordAssistanceUse') ? recordAssistance : name.includes('submitCanvasResponse') ? stageLegacy : vi.fn() }
})
mockNuxtImport('useConvexAction', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { mutate: name.includes('scoreMasterySubmission') ? score : name.includes('submitResponse') ? scoreLegacy : vi.fn() }
})

const OPPORTUNITY = 'opportunity_1'
const SUBMISSION = 'submission_1'
const DRAFT_KEY = `learn-response:owner_1:thread_1:check:${OPPORTUNITY}`
const ANSWER = 'Enzyme B loses its shape at 85°C so the substrate no longer fits.'
const SCORE_CANARY = 73

const capabilities = (overrides: Partial<Record<'status' | 'canDeliver' | 'canSubmit' | 'canRequestAssistance' | 'canTeachSeparateCase' | 'canReadFeedback', unknown>> = {}) =>
  learnAssessmentCapabilitiesSchema.parse({ version: LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, status: 'available', canDeliver: false, canSubmit: false, canRequestAssistance: false, canTeachSeparateCase: false, canReadFeedback: false, reasonCodes: [], ...overrides })

function available(phase: LearnAssessmentPhase, submissionId: string | null, revision: number, caps: ReturnType<typeof capabilities>) {
  return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY, revision, phase, submissionId, capabilities: caps }
}
const ready = () => available('ready', null, 1, capabilities({ canDeliver: true }))
const open = () => available('test_open', null, 2, capabilities({ canSubmit: true }))
const sealed = (phase: LearnAssessmentPhase = 'scoring_pending') => available(phase, SUBMISSION, 3, capabilities({ canRequestAssistance: true, canTeachSeparateCase: true }))
const scored = (phase: 'scored_pass' | 'scored_fail') => available(phase, SUBMISSION, 4, capabilities({ canRequestAssistance: true, canTeachSeparateCase: true, canReadFeedback: true }))

const delivered = (overrides: Record<string, unknown> = {}) => learnDeliveredAssessmentSchema.parse({
  status: 'delivered', version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, assessmentOpportunityId: OPPORTUNITY, deliveryGrantId: 'grant_1',
  identity: { kind: 'measurement', itemId: 'item_1', itemRevision: 1, promptDigest: 'a'.repeat(64) }, phase: 'test_open',
  prompt: 'Explain why both results make sense.', declaredStimulus: 'Two enzymes are tested at 40°C and at 85°C.', instructions: 'Answer in your own words.',
  responseSpec: { kind: 'bounded_rubric', version: 'learn-v2.response-format.v1', maxCodeUnits: 12000 }, ...overrides,
})

const assistanceSnapshot = { policyVersion: 'learn-v2.assistance.session-wide.v1', state: 'unassisted', assistanceRevision: 0, substantiveHintUsedAt: null, answerRevealedAt: null, priorExposure: 'prospectively_unexposed', outsideHelp: 'unknown', pasteObserved: 'unknown', focusLossObserved: 'unknown', instrumentationVersion: 'learn-v2.instrumentation.unknown.v1', instrumentationProvenance: 'test' }
const validSnapshot = { policyVersion: 'learn-v2.assessment-validity.v1', status: 'valid', measurementEligible: true, masteryEligible: true, exclusionReasons: [] }

function workState(input: { result?: Record<string, unknown> | null, body?: unknown, validity?: unknown, eligibility?: string } = {}) {
  const work = learnAttemptHistorySchema.parse({
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, submissionId: SUBMISSION, acceptedAt: 1_800_000_000_000, confidence: 4,
    assistanceSnapshot, validitySnapshot: input.validity ?? validSnapshot, currentEligibility: input.eligibility ?? 'eligible',
    body: input.body ?? { bodyAvailability: 'available', payload: { kind: 'text', text: ANSWER } },
    result: input.result === undefined ? null : input.result,
  })
  return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'available', target: { assessmentOpportunityId: OPPORTUNITY }, revision: 3, state: 'accepted', work }
}
const result = (feedbackCodes: string[]) => ({ attemptId: 'attempt_1', scorePercent: SCORE_CANARY, thresholdPercent: 80, scoreCommittedAt: 1_800_000_100_000, feedbackCodes })

const acceptedReceipt = () => learnResponseReceiptSchema.parse({ kind: 'accepted', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, target: { assessmentOpportunityId: OPPORTUNITY }, submissionId: SUBMISSION, acceptedAt: 1_800_000_000_000, revision: 3, phase: 'submitted_sealed', bodyAvailability: 'available' })
const rejectedReceipt = (reasonCode: string) => learnResponseReceiptSchema.parse({ kind: 'rejected', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode })

const practice = { responseSlotId: 'slot_1', revision: 1, tier: 'T2' as const, prompt: 'Cod digestive enzymes work well at 4°C.' }
const feedback = { tier: 'T0' as const, text: 'You explained both results.', citations: [{ sourceRef: 'source_1', label: 'Biology notes' }] }
const lesson = { tier: 'T1' as const, paragraphs: ['Every enzyme has a range.'], citations: [{ sourceRef: 'source_1', label: 'Biology notes' }] }
const HINT = 'Think about habitat.'
const WORKED = 'Compare to a hot spring.'
const helpOpen = { remaining: 8, hint: { status: 'available' }, worked_example: { status: 'available' } }
function availabilityFor(input: { feedback?: unknown, lesson?: unknown, practice?: unknown }) {
  const practiceOn = input.practice !== null
  return { feedback: input.feedback ? 'available' : 'unavailable', practice: { status: practiceOn ? 'available' : 'not_opened' }, help: practiceOn ? helpOpen : null }
}
const teachingAvailable = (overrides: Record<string, unknown> = {}) => {
  const value = { feedback, lesson, practice, ...overrides }
  return learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY, availability: availabilityFor(value), ...value })
}
const unavailableTeaching = (reasonCode: string) => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'unavailable', reasonCode })
const teachingUnavailable = (reasonCode: string) => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'unavailable', reasonCode })
const helpAuthorized = (kind: 'hint' | 'worked_example', text: string, revision = 1, workedTier: 'T0' | 'T2' = 'T2') => learnPracticeAssistanceAuthorizationSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'authorized', assessmentOpportunityId: OPPORTUNITY, target: { responseSlotId: 'slot_1' }, revision, authorizationId: 'exposure_1', deliveredAt: 1_800_000_200_000, content: kind === 'hint' ? { kind, tier: 'T0', text } : { kind, tier: workedTier, text } })
const helpDenied = (reasonCode: string) => learnPracticeAssistanceAuthorizationSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'denied', reasonCode })
const canvas = (overrides: Record<string, unknown> = {}) => ({ ...serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'test_open' }), ...overrides })

beforeAll(async () => {
  await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
})

const wrappers: VueWrapper[] = []
async function mountCheck(props: Record<string, unknown> = {}) {
  const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
  const wrapper = await mountSuspended(Comp.default, { props: { canvas: canvas(), ...props } as never, attachTo: document.body })
  wrappers.push(wrapper)
  await nextTick()
  return wrapper
}
const receiptKind = (wrapper: VueWrapper) => wrapper.find('[data-testid="learn-canvas-check-receipt"]').attributes('data-receipt')

async function fillAnswer(wrapper: VueWrapper, text = ANSWER) {
  await wrapper.get('[data-testid="learn-canvas-check-answer"]').setValue(text)
  await wrapper.get('[data-testid="learn-canvas-check-confidence-3"]').setValue()
}
function acceptArgs(call = 0) { return accept.mock.calls[call]![0] as { submission: { idempotencyKey: string, response: Record<string, unknown> } } }

describe('Canvas check', () => {
  beforeEach(() => {
    stateData.value = open()
    deliveryData.value = delivered()
    workData.value = null
    teachingData.value = teachingAvailable()
    practiceWorkData.value = null
    subscriptions.mockClear()
    isOnline.value = true
    attach.mockReset().mockResolvedValue({ kind: 'attached', threadId: 'thread_1', activityId: 'activity_1', replayed: false })
    grant.mockReset().mockResolvedValue({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'granted', assessmentOpportunityId: OPPORTUNITY, deliveryGrantId: 'grant_1', revision: 2, phase: 'test_open' })
    accept.mockReset().mockResolvedValue(acceptedReceipt())
    acceptPractice.mockReset().mockResolvedValue(learnResponseReceiptSchema.parse({ kind: 'accepted', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, target: { responseSlotId: 'slot_1' }, submissionId: 'submission_2', acceptedAt: 1, revision: 2, phase: 'accepted', bodyAvailability: 'available' }))
    score.mockReset().mockResolvedValue({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'scoring_pending', submissionId: SUBMISSION, reasonCodes: [] })
    authorizePractice.mockReset().mockImplementation(async (input: { kind: 'hint' | 'worked_example' }) => helpAuthorized(input.kind, input.kind === 'hint' ? HINT : WORKED))
    authorizeLegacy.mockReset()
    openPracticeCommand.mockReset().mockImplementation(async () => { teachingData.value = teachingAvailable(); return teachingData.value })
    publishFeedbackCommand.mockReset().mockImplementation(async () => teachingData.value)
    recordAssistance.mockReset()
    stageLegacy.mockReset()
    scoreLegacy.mockReset()
    sessionStorage.clear()
  })
  afterEach(() => {
    while (wrappers.length) wrappers.pop()!.unmount()
    vi.unstubAllGlobals()
  })

  describe('admission', () => {
    it.each([
      ['disabled', { version: LEARN_V2_PUBLIC_API_VERSION, status: 'disabled', reasonCodes: ['disabled'] }],
      ['unavailable', { version: LEARN_V2_PUBLIC_API_VERSION, status: 'unavailable', reasonCodes: ['assessment_unavailable'] }],
      ['capability-denied', available('test_open', null, 2, capabilities({ status: 'unavailable', canSubmit: false }))],
      ['undelivered', available('ready', null, 1, capabilities({ status: 'available', canDeliver: false }))],
    ])('shows the unavailable card and no question when admission is %s', async (_name, value) => {
      stateData.value = value
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-unavailable"]').text()).toContain('Your check isn’t ready yet')
      expect(wrapper.find('[data-testid="learn-canvas-check-question"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-start"]').exists()).toBe(false)
      expect(grant).not.toHaveBeenCalled()
      expect(wrapper.text()).not.toContain('Let’s rebuild')
    })

    it.each([
      [{ status: 'unavailable', version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, reasonCode: 'not_delivered' }],
      [delivered({ responseSpec: { kind: 'keyed', version: 'learn-v2.response-format.v1', maxSelections: 2 } })],
    ])('fails closed on an undelivered or unapproved response format', async (delivery) => {
      deliveryData.value = delivery
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-unavailable"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="learn-canvas-check-answer"]').exists()).toBe(false)
    })

    it('leaves through Back to Learn', async () => {
      stateData.value = { version: LEARN_V2_PUBLIC_API_VERSION, status: 'disabled', reasonCodes: ['disabled'] }
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-leave"]').trigger('click')
      expect(wrapper.emitted('leave')).toHaveLength(1)
    })

    it('renders the ordinary Canvas when no check is bound', async () => {
      const { assessment: _assessment, ...ordinary } = canvas({ status: 'started', activity: { ...canvas().activity, controls: undefined } })
      const wrapper = await mountCheck({ canvas: ordinary })
      expect(wrapper.find('[data-testid="learn-canvas-check"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    })
  })

  describe('entry and open check', () => {
    const awaiting = (overrides: Parameters<typeof serverAssessmentCanvas>[0] = { opportunityId: OPPORTUNITY, phase: 'ready' }) =>
      serverAssessmentCanvas({ ...overrides, awaitingStart: true })

    it('renders the approved entry card for a check awaiting its start', async () => {
      stateData.value = ready()
      deliveryData.value = null
      const projection = awaiting({ opportunityId: OPPORTUNITY, phase: 'ready', timing: 'about_a_week' })
      expect(projection.assessment).toMatchObject({ reasonCode: 'awaiting_start' })
      expect(projection.assessment).not.toHaveProperty('observations')
      const wrapper = await mountCheck({ canvas: projection })
      const entry = wrapper.get('[data-testid="learn-canvas-check-entry"]')
      expect(entry.get('h2').text()).toBe('A check on last week’s work')
      expect(entry.get('[data-testid="learn-canvas-check-start"]').text()).toBe('Start check')
      expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
    })

    it('starts through the Canvas attach with a generated key, then renders the delivered check', async () => {
      stateData.value = ready()
      deliveryData.value = null
      const wrapper = await mountCheck({ canvas: awaiting() })
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce())
      const request = attach.mock.calls[0]![0] as { studySessionId: string, expectedSessionRevision: number, idempotencyKey: string }
      expect(request).toMatchObject({ studySessionId: 'session_1', expectedSessionRevision: 2 })
      expect(learnResponseIdempotencyKeySchema.parse(request.idempotencyKey)).toBe(request.idempotencyKey)
      expect(grant).not.toHaveBeenCalled()
      await wrapper.setProps({ canvas: canvas() })
      stateData.value = open()
      deliveryData.value = delivered()
      await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Your question'))
      expect(wrapper.get('[data-testid="learn-canvas-check-question"]').text()).toContain('Two enzymes are tested')
      expect(wrapper.get('[data-testid="learn-canvas-check-question"]').text()).toContain('Explain why both results make sense.')
    })

    it('keeps the Start focus intent through loading and focuses the question once delivery arrives', async () => {
      stateData.value = ready()
      deliveryData.value = null
      const wrapper = await mountCheck({ canvas: awaiting() })
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce())
      await flushPromises()
      await wrapper.setProps({ canvas: canvas() })
      stateData.value = open()
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-loading"]').exists()).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 0))
      deliveryData.value = delivered()
      await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Your question'))
    })

    it('does not move focus to the question when it opens without a Start', async () => {
      stateData.value = open()
      deliveryData.value = null
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-loading"]').exists()).toBe(true)
      deliveryData.value = delivered()
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-question"]').exists()).toBe(true)
      expect(document.activeElement?.textContent).not.toBe('Your question')
    })

    it('keeps Start and its key after an ambiguous failure', async () => {
      stateData.value = ready()
      attach.mockRejectedValueOnce(new Error('network'))
      const wrapper = await mountCheck({ canvas: awaiting() })
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-start-error"]').exists()).toBe(true))
      expect(wrapper.get('[data-testid="learn-canvas-check-start-error"]').text()).toBe('Could not start this session. Try again.')
      expect(wrapper.text()).not.toContain('This check isn’t available right now.')
      expect(wrapper.text()).toContain('You’ll get one question')
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
      expect(attach.mock.calls[1]![0].idempotencyKey).toBe(attach.mock.calls[0]![0].idempotencyKey)
    })

    it.each(['outside_window', 'canvas_not_admitted', 'session_unavailable'])('treats a %s refusal as final for this view, leaving a way out', async (reasonCode) => {
      stateData.value = ready()
      attach.mockResolvedValueOnce({ kind: 'not_admitted', reasonCode, observations: 'no_observations' })
      const wrapper = await mountCheck({ canvas: awaiting() })
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-start-error"]').exists()).toBe(true))
      expect(wrapper.get('[data-testid="learn-canvas-check-start-error"]').text()).toBe('This check isn’t available right now.')
      expect(wrapper.text()).not.toContain('Try again')
      expect(wrapper.text()).not.toContain('You’ll get one question')
      expect(wrapper.get('[data-testid="learn-canvas-check-entry"] h2').text()).toBe('A check on this topic')
      expect(wrapper.find('[data-testid="learn-canvas-check-start"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-entry"] [data-testid="learn-canvas-check-leave"]').text()).toBe('Back to Learn')
      expect(wrapper.text()).not.toContain(reasonCode)
      await wrapper.setProps({ canvas: awaiting() })
      expect(wrapper.find('[data-testid="learn-canvas-check-start"]').exists()).toBe(false)
      expect(attach).toHaveBeenCalledOnce()
      await wrapper.get('[data-testid="learn-canvas-check-leave"]').trigger('click')
      expect(wrapper.emitted('leave')).toHaveLength(1)
    })

    it('lets the awaiting-start check take precedence over the blocked projection around it', async () => {
      stateData.value = ready()
      deliveryData.value = null
      const projection = awaiting()
      const recovery = adaptiveRecoveryCopy('blocked')
      expect(projection).toMatchObject({ status: 'blocked', recoveryState: 'blocked', recovery, activity: { evidenceScope: { integrityState: 'blocked' }, primitive: null } })
      expect(projection.assessment).toMatchObject({ reasonCode: 'awaiting_start' })
      expect(projection.assessment).not.toHaveProperty('observations')
      const wrapper = await mountCheck({ canvas: projection })
      expect(wrapper.find('[data-testid="learn-canvas-check-entry"]').exists()).toBe(true)
      for (const text of [recovery.title, recovery.body]) expect(wrapper.text()).not.toContain(text)
      const actions = wrapper.findAll('button, a').filter(node => node.text().trim() === recovery.action)
      expect(actions.map(node => node.attributes('data-testid'))).toEqual(['learn-canvas-check-leave'])
      expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-adaptive-canvas-fallback-action"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-activity-fallback"]').exists()).toBe(false)
    })

    it('gives a Canvas-native check awaiting its start the entry card without Today timing', async () => {
      stateData.value = ready()
      deliveryData.value = null
      const projection = awaiting({ opportunityId: OPPORTUNITY, phase: 'ready', timing: null, purpose: 'measurement_delayed' })
      expect(projection.assessment).not.toHaveProperty('checkTiming')
      const wrapper = await mountCheck({ canvas: projection })
      expect(wrapper.get('[data-testid="learn-canvas-check-entry"] h2').text()).toBe('A check on an earlier topic')
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce())
    })

    it('keeps the dev Canvas for a not-admitted check and never attaches', async () => {
      stateData.value = ready()
      const projection = serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'ready', delivered: false })
      expect(projection.assessment).toMatchObject({ reasonCode: 'not_admitted', observations: 'no_observations' })
      const wrapper = await mountCheck({ canvas: projection })
      expect(wrapper.find('[data-testid="learn-canvas-check"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
      expect(attach).not.toHaveBeenCalled()
    })

    it('hides every help, Why, Evidence and activity control while the check is open', async () => {
      const wrapper = await mountCheck()
      expect(wrapper.text()).toContain('Hints, examples, sources and chat come back after you submit.')
      for (const testId of ['learn-canvas-hint', 'learn-canvas-reveal', 'learn-canvas-source-1', 'learn-canvas-check-hint', 'learn-canvas-check-worked-example']) {
        expect(wrapper.find(`[data-testid="${testId}"]`).exists()).toBe(false)
      }
      expect(wrapper.text()).not.toContain(canvas().activity.controls.reasonText.text)
      expect(wrapper.text()).not.toContain(canvas().activity.purpose)
      expect(wrapper.text()).not.toContain('Answer in your own words.')
      expect(recordAssistance).not.toHaveBeenCalled()
      expect(authorizePractice).not.toHaveBeenCalled()
      expect(authorizeLegacy).not.toHaveBeenCalled()
    })

    it('never renders practice, feedback or a lesson before the answer is sealed', async () => {
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain(practice.prompt)
      expect(wrapper.text()).not.toContain(feedback.text)
      expect(wrapper.text()).not.toContain(lesson.paragraphs[0])
    })

    it('ties validation errors to fields, focuses the first, and sends nothing', async () => {
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="learn-canvas-check-answer-error"]').text()).toBe('Write your answer before you submit.')
      expect(wrapper.get('[data-testid="learn-canvas-check-confidence-error"]').text()).toBe('Choose how sure you are.')
      const field = wrapper.get('[data-testid="learn-canvas-check-answer"]')
      expect(field.attributes('aria-invalid')).toBe('true')
      expect(field.attributes('aria-describedby')).toBe(wrapper.get('[data-testid="learn-canvas-check-answer-error"]').attributes('id'))
      expect(document.activeElement).toBe(field.element)
      expect(accept).not.toHaveBeenCalled()
    })

    it('marks every confidence choice when confidence is missing', async () => {
      const wrapper = await mountCheck()
      const borders = () => [1, 2, 3, 4, 5].map(value => wrapper.get(`[data-testid="learn-canvas-check-confidence-${value}"]`).element.nextElementSibling!.classList)
      expect(borders().every(list => list.contains('border-input') && !list.contains('border-destructive'))).toBe(true)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await flushPromises()
      expect(borders().every(list => list.contains('border-destructive') && !list.contains('border-input'))).toBe(true)
    })

    it('maps a server confidence rejection to the same field error and rotates the key', async () => {
      accept.mockResolvedValueOnce(rejectedReceipt('confidence_required'))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-confidence-error"]').exists()).toBe(true))
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(2))
      expect(acceptArgs(1).submission.idempotencyKey).not.toBe(acceptArgs(0).submission.idempotencyKey)
    })

    it('does not submit offline and keeps the answer editable', async () => {
      isOnline.value = false
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await flushPromises()
      expect(accept).not.toHaveBeenCalled()
      expect(wrapper.get('[data-testid="learn-canvas-check-submit-error"]').attributes('role')).toBe('alert')
      expect(wrapper.get('[data-testid="learn-canvas-check-submit-error"]').text()).toContain('You’re offline.')
      expect((wrapper.get('[data-testid="learn-canvas-check-answer"]').element as HTMLTextAreaElement).value).toBe(ANSWER)
    })
  })

  describe('header eyebrow', () => {
    it('names the open check', async () => {
      stateData.value = open()
      deliveryData.value = delivered()
      const wrapper = await mountCheck()
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-open"]').exists()).toBe(true))
      expect(wrapper.get('header p').text()).toBe('Check · understand')
    })

    it.each([
      ['ready', () => ready()],
      ['scoring_pending', () => sealed('scoring_pending')],
      ['scored_fail', () => scored('scored_fail')],
    ])('stays Void in %s', async (_name, value) => {
      stateData.value = value()
      workData.value = workState({ result: result(['needs_review']) })
      const wrapper = await mountCheck()
      expect(wrapper.get('header p').text()).toBe('Void · understand')
    })
  })

  describe('keys and acceptance', () => {
    it('sends a real URL-safe key and a contract-valid single submission', async () => {
      const wrapper = await mountCheck()
      await fillAnswer(wrapper, `  ${ANSWER}  `)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce())
      const request = acceptMasterySubmissionSchema.parse(accept.mock.calls[0]![0])
      expect('response' in request.submission).toBe(true)
      const parsed = learnAcceptResponseRequestSchema.parse(request.submission)
      expect(learnResponseIdempotencyKeySchema.safeParse(parsed.idempotencyKey).success).toBe(true)
      expect(parsed.response).toMatchObject({ target: { assessmentOpportunityId: OPPORTUNITY }, expectedRevision: 2, payload: { kind: 'text', text: ANSWER }, confidence: 3 })
      expect(stageLegacy).not.toHaveBeenCalled()
      expect(scoreLegacy).not.toHaveBeenCalled()
    })

    it('reuses the same key after an ambiguous failure with an unchanged answer', async () => {
      accept.mockRejectedValueOnce(new Error('network'))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-submit-error"]').exists()).toBe(true))
      expect(wrapper.get('[data-testid="learn-canvas-check-submit-error"]').text()).toContain('Your answer wasn’t submitted')
      expect(wrapper.get('[data-testid="learn-canvas-check-submit-error"]').text()).toContain('It’s still here on this device. Submit again.')
      expect(wrapper.get('[data-testid="learn-canvas-check-submit"]').attributes('disabled')).toBeUndefined()
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(2))
      expect(acceptArgs(1).submission.idempotencyKey).toBe(acceptArgs(0).submission.idempotencyKey)
    })

    it('rotates the key when the answer changes after a failure', async () => {
      accept.mockRejectedValueOnce(new Error('network'))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-submit-error"]').exists()).toBe(true))
      await wrapper.get('[data-testid="learn-canvas-check-answer"]').setValue(`${ANSWER} More.`)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(2))
      expect(acceptArgs(1).submission.idempotencyKey).not.toBe(acceptArgs(0).submission.idempotencyKey)
    })

    it('recovers the canonical receipt on a cross-key replay without a second acceptance or an error', async () => {
      accept.mockResolvedValueOnce(rejectedReceipt('already_accepted'))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper, 'A later attempt from another tab.')
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce())
      expect(wrapper.find('[data-testid="learn-canvas-check-submit-error"]').exists()).toBe(false)
      stateData.value = sealed()
      workData.value = workState()
      await vi.waitFor(() => expect(receiptKind(wrapper)).toBe('saved'))
      expect(wrapper.get('[data-testid="learn-canvas-check-saved-answer"]').text()).toContain(ANSWER)
      expect(wrapper.get('[data-testid="learn-canvas-check-saved-answer"]').text()).not.toContain('A later attempt')
      expect(accept).toHaveBeenCalledOnce()
    })

    it('shows the receipt only after the server returns a submission ID', async () => {
      let release!: (value: unknown) => void
      accept.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-receipt"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-submit"]').text()).toContain('Submitting…')
      release(acceptedReceipt())
      await vi.waitFor(() => expect(receiptKind(wrapper)).toBe('saved'))
      await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Answer saved'))
      expect(wrapper.text()).toContain('Answer saved and locked')
    })

    it('does not treat a staged activity status as an accepted submission', async () => {
      const wrapper = await mountCheck({ canvas: canvas({ status: 'submitted', savedResponse: { response: 'Staged copy.', confidence: 2 } }) })
      expect(wrapper.find('[data-testid="learn-canvas-check-receipt"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-open"]').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('Staged copy.')
    })

    it('does not show a receipt for a non-sealing acceptance phase', async () => {
      accept.mockResolvedValueOnce(learnResponseReceiptSchema.parse({ ...acceptedReceipt(), phase: 'accepted' }))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-submit-error"]').exists()).toBe(true))
      expect(wrapper.find('[data-testid="learn-canvas-check-receipt"]').exists()).toBe(false)
    })
  })

  describe('scoring recovery', () => {
    it('starts scoring the saved submission once, with a stable URL-safe key', async () => {
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(score).toHaveBeenCalledOnce())
      const request = scoreMasterySubmissionSchema.parse(score.mock.calls[0]![0])
      expect(request.submissionId).toBe(SUBMISSION)
      stateData.value = sealed('submitted_sealed')
      await flushPromises()
      expect(score).toHaveBeenCalledOnce()
    })

    it('resumes scoring a saved answer left unscored after a refresh', async () => {
      stateData.value = sealed('submitted_sealed')
      workData.value = workState()
      await mountCheck()
      await vi.waitFor(() => expect(score).toHaveBeenCalledOnce())
    })

    it('shows the waiting line with the processing colour and no retry or guess', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('saved')
      const status = wrapper.get('[data-testid="learn-canvas-check-receipt"] [role="status"]')
      expect(status.text()).toContain('Getting your result. It will appear here.')
      expect(status.get('svg').classes()).toContain('text-[var(--learn-attention)]')
      expect(status.get('svg').classes()).toContain('animate-spin')
      expect(wrapper.find('[data-testid="learn-canvas-check-retry-score"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Passed')
      expect(wrapper.text()).not.toContain('Not yet')
      expect(score).not.toHaveBeenCalled()
    })

    it('retries a failed score against the same submission and key', async () => {
      stateData.value = sealed('retryable_failure')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('scoring_failed')
      expect(wrapper.text()).toContain('This wasn’t your answer’s fault. Your answer is saved.')
      expect(wrapper.find('[data-testid="learn-canvas-check-answer"]').exists()).toBe(false)
      await wrapper.get('[data-testid="learn-canvas-check-retry-score"]').trigger('click')
      await vi.waitFor(() => expect(score).toHaveBeenCalledOnce())
      await wrapper.get('[data-testid="learn-canvas-check-retry-score"]').trigger('click')
      await vi.waitFor(() => expect(score).toHaveBeenCalledTimes(2))
      expect(score.mock.calls[1]![0]).toEqual(score.mock.calls[0]![0])
      expect(score.mock.calls[0]![0].submissionId).toBe(SUBMISSION)
    })

    it('offers a retry when the score request itself fails', async () => {
      score.mockRejectedValueOnce(new Error('network'))
      stateData.value = sealed('submitted_sealed')
      workData.value = workState()
      const wrapper = await mountCheck()
      await vi.waitFor(() => expect(receiptKind(wrapper)).toBe('scoring_failed'))
      expect(wrapper.find('[data-testid="learn-canvas-check-retry-score"]').exists()).toBe(true)
    })

    it('has no retry and no guess for an unconfirmed result', async () => {
      stateData.value = sealed('reconciliation_required')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('unconfirmed')
      expect(wrapper.text()).toContain('We couldn’t confirm your result')
      expect(wrapper.text()).toContain('Budds won’t guess.')
      expect(wrapper.find('[data-testid="learn-canvas-check-retry-score"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Passed')
      expect(score).not.toHaveBeenCalled()
    })

    it('says a check will not count without implying a result', async () => {
      stateData.value = sealed('invalid')
      workData.value = workState({ validity: { policyVersion: 'p', status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['evidence_unavailable'] }, eligibility: 'excluded' })
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('invalid')
      expect(wrapper.text()).toContain('A source this question relied on changed')
      expect(wrapper.text()).toContain('It won’t count for or against you.')
      expect(wrapper.text()).not.toContain('Passed')
    })

    it('does not name a source change when the check is invalid for another reason', async () => {
      stateData.value = sealed('invalid')
      workData.value = workState({ validity: { policyVersion: 'p', status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['assisted'] }, eligibility: 'excluded' })
      const wrapper = await mountCheck()
      expect(wrapper.text()).toContain('This check won’t count')
      expect(wrapper.text()).not.toContain('A source this question relied on changed')
    })
  })

  describe('results and later teaching', () => {
    it('leads with Passed, then the learner answer, then cited feedback, and never a score', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('passed')
      const heading = wrapper.get('[data-testid="learn-canvas-check-receipt"] h2')
      expect(heading.text()).toBe('Passed: you still had it')
      const answerNode = wrapper.get('[data-testid="learn-canvas-check-your-answer"]').element
      const feedbackNode = wrapper.get('[data-testid="learn-canvas-check-feedback"]').element
      expect(heading.element.compareDocumentPosition(answerNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(answerNode.compareDocumentPosition(feedbackNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(wrapper.get('button[aria-label="Source 1: Biology notes"]').text()).toBe('1')
      expect(wrapper.html()).not.toContain(String(SCORE_CANARY))
      expect(wrapper.html()).not.toContain('thresholdPercent')
      expect(wrapper.find('[data-testid="learn-canvas-check-continue"]').text()).toContain('Continue to today’s session')
      expect(wrapper.find('[data-testid="learn-canvas-check-lesson"]').exists()).toBe(false)
    })

    it('opens the Evidence drawer from a citation', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      const wrapper = await mountCheck()
      await wrapper.get('button[aria-label="Source 1: Biology notes"]').trigger('click')
      expect(wrapper.emitted('inspectEvidence')).toHaveLength(1)
    })

    it('adds the cited lesson and a practice case after a valid miss', async () => {
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('not_yet')
      expect(wrapper.get('[data-testid="learn-canvas-check-receipt"] h2').text()).toBe('Not yet: part of this slipped')
      expect(wrapper.get('[data-testid="learn-canvas-check-receipt"]').text()).toContain('That’s common, and it’s why we check.')
      expect(wrapper.text()).not.toContain('after a week')
      expect(wrapper.get('[data-testid="learn-canvas-check-lesson"]').text()).toContain('Every enzyme has a range.')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      await wrapper.get('[data-testid="learn-canvas-check-try-practice"]').trigger('click')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true)
    })

    it.each([
      ['an assisted result', ['pass', 'assisted_result'], {}],
      ['an excluded result', ['pass', 'excluded_result'], {}],
      ['an excluded snapshot', ['pass'], { validity: { policyVersion: 'p', status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['assisted'] } }],
    ])('does not claim a pass for %s', async (_name, codes, overrides) => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(codes as string[]), ...overrides })
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('invalid')
      expect(wrapper.text()).not.toContain('you still had it')
      expect(wrapper.text()).not.toContain(feedback.text)
    })

    it.each([
      ['a result the phase contradicts', scored('scored_pass'), result(['needs_review'])],
      ['no result in the owner record', scored('scored_pass'), null],
      ['withheld feedback', available('scored_pass', SUBMISSION, 4, capabilities({ canReadFeedback: false })), result(['pass'])],
    ])('shows the unconfirmed state for %s', async (_name, state, value) => {
      stateData.value = state
      workData.value = workState({ result: value as Record<string, unknown> | null })
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('unconfirmed')
      expect(wrapper.text()).not.toContain('you still had it')
    })

    it('withholds feedback and lessons while the result is pending', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(wrapper.text()).not.toContain(feedback.text)
      expect(wrapper.text()).not.toContain(lesson.paragraphs[0])
    })

    it('omits a purged answer rather than showing an empty one', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState({ body: { bodyAvailability: 'purged', reasonCode: 'evidence_unavailable', purgedAt: 1 } })
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-saved-answer"]').exists()).toBe(false)
    })
  })

  describe('practice on a different case', () => {
    it('opens below the receipt while the result is pending and never asks for confidence', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      const practiceCard = wrapper.get('[data-testid="learn-canvas-check-practice"]')
      expect(wrapper.get('[data-testid="learn-canvas-check-receipt"]').element.compareDocumentPosition(practiceCard.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(practiceCard.text()).not.toContain('How sure are you?')
      await wrapper.get('[data-testid="learn-canvas-check-practice-answer"]').setValue('Habitat sets the range.')
      await wrapper.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await vi.waitFor(() => expect(acceptPractice).toHaveBeenCalledOnce())
      const request = learnAcceptResponseRequestSchema.parse(acceptPractice.mock.calls[0]![0])
      expect(request.response).toEqual({ target: { responseSlotId: 'slot_1' }, expectedRevision: 1, payload: { kind: 'text', text: 'Habitat sets the range.' } })
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-practice-saved"]').text()).toBe('Response submitted.'))
    })

    const expectOutlinedSubmit = (wrapper: VueWrapper) => {
      const submit = wrapper.get('[data-testid="learn-canvas-check-practice-submit"]')
      expect(submit.text()).toBe('Submit answer')
      expect(submit.classes()).toEqual(expect.arrayContaining(['border', 'border-border', 'bg-background', 'text-foreground']))
      expect(submit.classes()).not.toContain('bg-primary')
    }

    it('uses the outlined Submit answer while the result is pending', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expectOutlinedSubmit(wrapper)
      expect(wrapper.findAll('[data-testid="learn-canvas-check-practice"] button.bg-primary')).toHaveLength(0)
    })

    it('never shows two filled buttons when practice sits under a result', async () => {
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      teachingData.value = teachingAvailable()
      const wrapper = await mountCheck()
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-try-practice"]').exists()).toBe(true))
      await wrapper.get('[data-testid="learn-canvas-check-try-practice"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      expectOutlinedSubmit(wrapper)
      expect(wrapper.findAll('button.bg-primary:not([aria-label^="Source"])')).toHaveLength(0)
    })

    it('asks for a practice answer instead of sending an empty one', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="learn-canvas-check-practice-missing"]').text()).toBe('Write your answer before you submit.')
      expect(acceptPractice).not.toHaveBeenCalled()
    })

    it('reuses the practice key on an ambiguous failure', async () => {
      acceptPractice.mockRejectedValueOnce(new Error('network'))
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-practice-answer"]').setValue('Habitat sets the range.')
      await wrapper.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice-error"]').exists()).toBe(true))
      await wrapper.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await vi.waitFor(() => expect(acceptPractice).toHaveBeenCalledTimes(2))
      expect(acceptPractice.mock.calls[1]![0].idempotencyKey).toBe(acceptPractice.mock.calls[0]![0].idempotencyKey)
    })

    it.each(['retryable_failure', 'reconciliation_required', 'invalid'] as const)('stays collapsed behind Continue practising in %s', async (phase) => {
      stateData.value = sealed(phase)
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      await wrapper.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true)
    })

    it('is not offered without the separate-case capability', async () => {
      stateData.value = available('scoring_pending', SUBMISSION, 3, capabilities({ canTeachSeparateCase: false }))
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
    })

    it('offers help whenever practice is available, with no content held by the client', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-hint"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="learn-canvas-check-worked-example"]').exists()).toBe(true)
      expect(wrapper.html()).not.toContain(HINT)
      expect(wrapper.html()).not.toContain(WORKED)
      expect(authorizePractice).not.toHaveBeenCalled()
      expect(learnPostSealPracticeSchema.safeParse({ ...practice, hint: HINT }).success).toBe(false)
      expect(learnPostSealPracticeSchema.safeParse({ ...practice, workedExample: WORKED }).success).toBe(false)
    })

    it('shows help text only from the authorized response, targeting the practice slot', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(HINT))
      const request = learnAuthorizePracticeAssistanceSchema.parse(authorizePractice.mock.calls[0]![0])
      expect(request).toMatchObject({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: OPPORTUNITY, target: { responseSlotId: 'slot_1' }, expectedRevision: 1, kind: 'hint' })
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(WORKED))
      expect(authorizePractice.mock.calls[1]![0]).toMatchObject({ kind: 'worked_example' })
      expect(authorizePractice.mock.calls[1]![0].idempotencyKey).not.toBe(authorizePractice.mock.calls[0]![0].idempotencyKey)
      expect(authorizeLegacy).not.toHaveBeenCalled()
      expect(recordAssistance).not.toHaveBeenCalled()
    })

    it.each(['test_open', 'disabled', 'not_sealed', 'unavailable', 'evidence_unavailable', 'disclosure_unknown'])('shows the approved line and no content when help is denied for %s', async (reasonCode) => {
      authorizePractice.mockReset().mockResolvedValue(helpDenied(reasonCode))
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance-denied"]').text()).toBe('Could not load support. Try again.'))
      expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(false)
      expect(wrapper.html()).not.toContain(WORKED)
      expect(recordAssistance).not.toHaveBeenCalled()
    })

    it('reuses one help key per kind and revision across an ambiguous failure', async () => {
      authorizePractice.mockRejectedValueOnce(new Error('network'))
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance-denied"]').exists()).toBe(true))
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(true))
      expect(wrapper.find('[data-testid="learn-canvas-check-assistance-denied"]').exists()).toBe(false)
      expect(authorizePractice.mock.calls[1]![0]).toEqual(authorizePractice.mock.calls[0]![0])
    })

    it('uses a fresh help key after a definite denial or a new slot revision', async () => {
      authorizePractice.mockResolvedValueOnce(helpDenied('disabled'))
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance-denied"]').exists()).toBe(true))
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(authorizePractice).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(true))
      expect(authorizePractice.mock.calls[1]![0].idempotencyKey).not.toBe(authorizePractice.mock.calls[0]![0].idempotencyKey)
      teachingData.value = teachingAvailable({ practice: { ...practice, revision: 2 } })
      await nextTick()
      authorizePractice.mockResolvedValueOnce(helpAuthorized('hint', HINT, 2))
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(authorizePractice).toHaveBeenCalledTimes(3))
      expect(authorizePractice.mock.calls[2]![0]).toMatchObject({ expectedRevision: 2 })
      expect(authorizePractice.mock.calls[2]![0].idempotencyKey).not.toBe(authorizePractice.mock.calls[1]![0].idempotencyKey)
    })
  })

  describe('post-seal teaching read', () => {
    const teachingCalls = () => subscriptions.mock.calls.filter(([name]) => String(name).includes('getPostSealTeaching'))

    it.each([
      ['loading', () => null],
      ['denied admission', () => ({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'disabled', reasonCodes: ['disabled'] })],
      ['ready', ready],
      ['test_open', open],
      ['invalid without an accepted answer', () => available('invalid', null, 2, capabilities())],
      ['cancelled', () => available('cancelled', null, 2, capabilities())],
      ['abandoned', () => available('abandoned', null, 2, capabilities())],
    ])('does not subscribe or render teaching in %s', async (_name, state) => {
      stateData.value = state()
      const wrapper = await mountCheck()
      expect(teachingCalls()).toHaveLength(0)
      expect(wrapper.text()).not.toContain(feedback.text)
      expect(wrapper.text()).not.toContain(lesson.paragraphs[0])
      expect(wrapper.text()).not.toContain(practice.prompt)
    })

    it('stays unsubscribed while an accepted receipt is still awaited', async () => {
      let release!: (value: unknown) => void
      accept.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await flushPromises()
      expect(teachingCalls()).toHaveLength(0)
      release(acceptedReceipt())
      await vi.waitFor(() => expect(teachingCalls()).toHaveLength(1))
      expect(learnPostSealTeachingReferenceSchema.parse(teachingCalls()[0]![1])).toEqual({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: OPPORTUNITY })
    })

    it('reads the same teaching on a refresh of a sealed check', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(teachingCalls()).toHaveLength(1)
      expect(wrapper.get('[data-testid="learn-canvas-check-practice-prompt"]').text()).toBe(practice.prompt)
    })

    it.each(['disabled', 'unavailable', 'not_sealed', 'test_open', 'evidence_unavailable', 'disclosure_unknown'])('keeps the receipt and shows no teaching sections for %s', async (reasonCode) => {
      teachingData.value = teachingUnavailable(reasonCode)
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      const wrapper = await mountCheck()
      expect(wrapper.get('[data-testid="learn-canvas-check-receipt"] h2').text()).toBe('Not yet: part of this slipped')
      expect(wrapper.get('[data-testid="learn-canvas-check-your-answer"]').text()).toBe(ANSWER)
      for (const testId of ['feedback', 'lesson', 'practice', 'practice-collapsed', 'try-practice']) expect(wrapper.find(`[data-testid="learn-canvas-check-${testId}"]`).exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Feedback on your answer')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    })

    it('keeps the waiting receipt when the read has not arrived or is unavailable', async () => {
      teachingData.value = null
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('saved')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      teachingData.value = teachingUnavailable('test_open')
      await nextTick()
      expect(receiptKind(wrapper)).toBe('saved')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
    })

    it('renders only the sections the server returned', async () => {
      teachingData.value = teachingAvailable({ feedback: null, lesson: null })
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      const wrapper = await mountCheck()
      expect(receiptKind(wrapper)).toBe('passed')
      expect(wrapper.find('[data-testid="learn-canvas-check-feedback"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-your-answer"]').text()).toBe(ANSWER)
    })

    it('keeps practice reachable after a miss with no lesson', async () => {
      teachingData.value = teachingAvailable({ lesson: null })
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true)
    })

    it.each([
      ['no lesson in the teaching read', () => teachingAvailable({ lesson: null, practice: null })],
      ['no teaching at all', () => teachingUnavailable('unavailable')],
    ])('offers Back to Today on the result card with %s', async (_name, teaching) => {
      teachingData.value = teaching()
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      const wrapper = await mountCheck()
      const leave = wrapper.get('[data-testid="learn-canvas-check-receipt"] [data-testid="learn-canvas-check-leave"]')
      expect(leave.text()).toBe('Back to Today')
      await leave.trigger('click')
      expect(wrapper.emitted('today')).toHaveLength(1)
      expect(wrapper.emitted('leave')).toBeUndefined()
    })

    it('keeps Back to Today off the result card while a lesson exists or the read is pending', async () => {
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      const wrapper = await mountCheck()
      const onCard = () => wrapper.find('[data-testid="learn-canvas-check-receipt"] [data-testid="learn-canvas-check-leave"]').exists()
      expect(onCard()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-lesson"] [data-testid="learn-canvas-check-leave"]').text()).toBe('Back to Today')
      teachingData.value = null
      await nextTick()
      expect(onCard()).toBe(false)
    })

    it('ignores teaching fields passed on the binding', async () => {
      teachingData.value = teachingUnavailable('disabled')
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      const wrapper = await mountCheck({ canvas: canvas({ assessment: { ...canvas().assessment, laterTeaching: { feedback: { text: 'Binding canary', citations: [] }, practice: { prompt: 'Binding canary' } } } }) })
      expect(wrapper.text()).not.toContain('Binding canary')
    })

    it('carries the tier through the composable without rendering it', async () => {
      const { useCanvasCheck } = await import('~/composables/useCanvasCheck')
      let check!: ReturnType<typeof useCanvasCheck>
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      const probe = await mountSuspended(defineComponent({ setup() {
        check = useCanvasCheck({ ownerId: 'owner_1', threadId: 'thread_1', binding: () => ({ assessmentOpportunityId: OPPORTUNITY, receipt: null }), isOnline })
        return () => h('div')
      } }))
      wrappers.push(probe)
      expect(check.feedback.value?.tier).toBe('T0')
      expect(check.lesson.value?.tier).toBe('T1')
      expect(check.practice.value?.tier).toBe('T2')
      expect(Object.keys(check.practice.value!)).not.toEqual(expect.arrayContaining(['hint']))
      await check.requestAssistance('worked_example')
      expect(check.assistance.value).toEqual({ kind: 'worked_example', tier: 'T2', text: WORKED })
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-try-practice"]').trigger('click')
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(true))
      expect(wrapper.text()).not.toMatch(/\bT[012]\b/)
    })
  })

  describe('post-seal runtime states', () => {
    const reference = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: OPPORTUNITY }
    const runtime = (input: { feedbackState: string, practiceState: Record<string, unknown>, help?: unknown, feedback?: unknown, lesson?: unknown, practice?: unknown }) => learnPostSealTeachingSchema.parse({
      version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
      feedback: input.feedback ?? null, lesson: input.lesson ?? null, practice: input.practice ?? null,
      availability: { feedback: input.feedbackState, practice: input.practiceState, help: input.help ?? null },
    })
    const notOpened = (feedbackState = 'scoring_pending', extra: Record<string, unknown> = {}) => runtime({ feedbackState, practiceState: { status: 'not_opened' }, ...extra })
    const withHelp = (help: unknown) => runtime({ feedbackState: 'scoring_pending', practiceState: { status: 'available' }, practice, help })

    it('opens practice once below a pending receipt, with the reference only and no confidence', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = notOpened()
      openPracticeCommand.mockImplementation(async () => {
        teachingData.value = runtime({ feedbackState: 'scoring_pending', practiceState: { status: 'available' }, practice, help: helpOpen })
        return teachingData.value
      })
      const wrapper = await mountCheck()
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      expect(openPracticeCommand).toHaveBeenCalledOnce()
      expect(learnPostSealTeachingReferenceSchema.parse(openPracticeCommand.mock.calls[0]![0])).toEqual(reference)
      expect(publishFeedbackCommand).not.toHaveBeenCalled()
      expect(wrapper.get('[data-testid="learn-canvas-check-practice"]').text()).not.toContain('How sure are you?')
      expect(receiptKind(wrapper)).toBe('saved')
      teachingData.value = { ...(teachingData.value as object) }
      await flushPromises()
      expect(openPracticeCommand).toHaveBeenCalledOnce()
    })

    it('waits for the learner before opening practice after a recovery receipt', async () => {
      stateData.value = sealed('reconciliation_required')
      workData.value = workState()
      teachingData.value = notOpened()
      const wrapper = await mountCheck()
      await flushPromises()
      expect(openPracticeCommand).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      await wrapper.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      expect(openPracticeCommand).toHaveBeenCalledOnce()
      expect(receiptKind(wrapper)).toBe('unconfirmed')
    })

    it('keeps the practice row and says so when opening practice fails, then retries on request', async () => {
      stateData.value = sealed('retryable_failure')
      workData.value = workState()
      teachingData.value = notOpened()
      openPracticeCommand.mockRejectedValueOnce(new Error('network'))
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="learn-canvas-check-practice-open-error"]').text()).toBe('Could not load support. Try again.')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      await wrapper.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      expect(openPracticeCommand).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-open-error"]').exists()).toBe(false)
    })

    it('opens practice from the lesson after a valid miss', async () => {
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      teachingData.value = notOpened('available', { feedback, lesson })
      const wrapper = await mountCheck()
      await flushPromises()
      expect(openPracticeCommand).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="learn-canvas-check-try-practice"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      expect(openPracticeCommand).toHaveBeenCalledOnce()
    })

    it('offers no practice when the server says practice is unavailable', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = runtime({ feedbackState: 'scoring_pending', practiceState: { status: 'unavailable', reasonCode: 'test_open' } })
      const wrapper = await mountCheck()
      await flushPromises()
      expect(openPracticeCommand).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-collapsed"]').exists()).toBe(false)
      expect(receiptKind(wrapper)).toBe('saved')
    })

    it('retries publication only while feedback is publishing, and never opens practice for it', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      teachingData.value = notOpened('feedback_publishing')
      publishFeedbackCommand.mockImplementation(async () => {
        teachingData.value = notOpened('available', { feedback })
        return teachingData.value
      })
      const wrapper = await mountCheck()
      expect(wrapper.get('[data-testid="learn-canvas-check-receipt"] h2').text()).toBe('Passed: you still had it')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-feedback"]').exists()).toBe(true))
      expect(publishFeedbackCommand).toHaveBeenCalledOnce()
      expect(learnPostSealTeachingReferenceSchema.parse(publishFeedbackCommand.mock.calls[0]![0])).toEqual(reference)
      expect(openPracticeCommand).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="learn-canvas-check-feedback-publishing"]').exists()).toBe(false)
    })

    it('shows the processing line under the answer while publishing, and holds Back to Today until it settles', async () => {
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      teachingData.value = notOpened('feedback_publishing')
      publishFeedbackCommand.mockRejectedValueOnce(new Error('network')).mockImplementation(async () => teachingData.value)
      const wrapper = await mountCheck()
      await flushPromises()
      const line = wrapper.get('[data-testid="learn-canvas-check-feedback-publishing"]')
      expect(line.text()).toBe('Getting feedback on your answer.')
      expect(line.attributes('role')).toBe('status')
      expect(line.get('svg').classes()).toEqual(expect.arrayContaining(['animate-spin', 'motion-reduce:animate-none', 'text-[var(--learn-attention)]']))
      expect(wrapper.get('[data-testid="learn-canvas-check-your-answer"]').element.compareDocumentPosition(line.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(wrapper.find('[data-testid="learn-canvas-check-receipt"] [data-testid="learn-canvas-check-leave"]').exists()).toBe(false)
      expect(publishFeedbackCommand).toHaveBeenCalledOnce()
      isOnline.value = false
      await nextTick()
      isOnline.value = true
      await flushPromises()
      expect(publishFeedbackCommand).toHaveBeenCalledTimes(2)
      expect(openPracticeCommand).not.toHaveBeenCalled()
      teachingData.value = notOpened('unavailable')
      await nextTick()
      expect(wrapper.find('[data-testid="learn-canvas-check-feedback-publishing"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-receipt"] [data-testid="learn-canvas-check-leave"]').exists()).toBe(true)
    })

    it('shows only the help the server says it can give', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = withHelp({ remaining: 8, hint: { status: 'unavailable', reasonCode: 'unavailable' }, worked_example: { status: 'available' } })
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-hint"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-worked-example"]').attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="learn-canvas-check-help-limit"]').exists()).toBe(false)
    })

    it('replays delivered help on request', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = withHelp({ remaining: 7, hint: { status: 'unavailable', reasonCode: 'unavailable' }, worked_example: { status: 'delivered' } })
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(WORKED))
      expect(learnAuthorizePracticeAssistanceSchema.parse(authorizePractice.mock.calls[0]![0]).kind).toBe('worked_example')
    })

    it('shows the help limit honestly from the read, with the limited control disabled', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = withHelp({ remaining: 0, hint: { status: 'unavailable', reasonCode: 'help_limit_reached' }, worked_example: { status: 'delivered' } })
      const wrapper = await mountCheck()
      expect(wrapper.get('[data-testid="learn-canvas-check-hint"]').attributes('disabled')).toBeDefined()
      expect(wrapper.get('[data-testid="learn-canvas-check-worked-example"]').attributes('disabled')).toBeUndefined()
      const limit = wrapper.get('[data-testid="learn-canvas-check-help-limit"]')
      expect(limit.text()).toBe('You’ve used all the help for this practice case.')
      expect(limit.attributes('role')).toBe('status')
      expect(wrapper.find('[data-testid="learn-canvas-check-assistance-denied"]').exists()).toBe(false)
    })

    it('treats a help_limit_reached denial as the limit, not an error', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = withHelp(helpOpen)
      authorizePractice.mockResolvedValueOnce(helpDenied('help_limit_reached'))
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-help-limit"]').exists()).toBe(true))
      expect(wrapper.find('[data-testid="learn-canvas-check-assistance-denied"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(false)
    })

    it('shows no help controls when the read carries no help state', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = withHelp(null)
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="learn-canvas-check-hint"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-worked-example"]').exists()).toBe(false)
    })

    it('releases nothing from an outer unavailable read and never shows scores', async () => {
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      teachingData.value = teachingUnavailable('test_open')
      const wrapper = await mountCheck()
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-feedback"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-lesson"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-collapsed"]').exists()).toBe(false)
      expect(openPracticeCommand).not.toHaveBeenCalled()
      expect(publishFeedbackCommand).not.toHaveBeenCalled()
      expect(wrapper.html()).not.toContain(String(SCORE_CANARY))
      expect(wrapper.text()).not.toMatch(/rubric|criteri|score|mastery|delayed|retained/i)
    })
  })

  describe('server projections', () => {
    const subscribed = (name: string) => subscriptions.mock.calls.some(([called]) => String(called).includes(name))

    it.each([
      ['closed', 'invalid', 'This check won’t count'],
      ['result_unconfirmed', 'unconfirmed', 'We couldn’t confirm your result'],
    ] as const)('renders a %s recovery receipt from checkReceipt alone, with its saved answer', async (state, kind, title) => {
      teachingData.value = unavailableTeaching('test_open')
      const receipt = serverCheckReceipt({ reference: 'check_ref_1', state, answer: ANSWER, confidence: 4 })
      const wrapper = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: OPPORTUNITY, phase: 'invalid', receipt }) })
      expect(receiptKind(wrapper)).toBe(kind)
      expect(wrapper.get('[data-testid="learn-canvas-check-receipt"] h2').text()).toBe(title)
      expect(wrapper.get('[data-testid="learn-canvas-check-saved-answer"]').text()).toContain(ANSWER)
      expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
      expect(subscribed('getAssessmentState')).toBe(false)
      expect(subscribed('getResponseState')).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-retry-score"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
    })

    it('names a source change on a closed receipt only when the server withheld the body for evidence', async () => {
      const bySource = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: OPPORTUNITY, phase: 'invalid', receipt: serverCheckReceipt({ reference: 'r', state: 'closed', bodyReason: 'evidence_unavailable' }) }) })
      expect(bySource.text()).toContain('A source this question relied on changed')
      expect(bySource.find('[data-testid="learn-canvas-check-saved-answer"]').exists()).toBe(false)
      const other = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: OPPORTUNITY, phase: 'invalid', receipt: serverCheckReceipt({ reference: 'r2', state: 'closed', answer: ANSWER }) }) })
      expect(other.text()).not.toContain('A source this question relied on changed')
    })

    it('follows the check state when a saved projection still carries its assessment', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = null
      const receipt = serverCheckReceipt({ reference: 'check_ref_1', state: 'saved_scoring', answer: ANSWER, confidence: 3 })
      const wrapper = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: OPPORTUNITY, phase: 'scoring_pending', receipt }) })
      expect(receiptKind(wrapper)).toBe('saved')
      expect(wrapper.get('[data-testid="learn-canvas-check-saved-answer"]').text()).toContain(ANSWER)
      expect(subscribed('getAssessmentState')).toBe(true)
    })

    it('drops the locally held answer once the server withdraws the saved body', async () => {
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce())
      stateData.value = sealed('scoring_pending')
      await flushPromises()
      expect(wrapper.get('[data-testid="learn-canvas-check-saved-answer"]').text()).toContain(ANSWER)
      workData.value = workState({ body: { bodyAvailability: 'purged', reasonCode: 'evidence_unavailable', purgedAt: 1 } })
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-saved-answer"]').exists()).toBe(false)
      expect(wrapper.html()).not.toContain(ANSWER)
      workData.value = { version: LEARN_V2_PUBLIC_API_VERSION, status: 'unavailable', reasonCodes: ['evidence_unavailable'] }
      await flushPromises()
      expect(wrapper.html()).not.toContain(ANSWER)
    })

    it('keeps a practice draft across a remount and an ambiguous failure, then clears it once accepted', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const practiceKey = `learn-response:owner_1:thread_1:practice:${OPPORTUNITY}`
      const first = await mountCheck()
      await first.get('[data-testid="learn-canvas-check-practice-answer"]').setValue('Habitat sets the range.')
      await nextTick()
      expect(JSON.parse(sessionStorage.getItem(practiceKey)!).response).toBe('Habitat sets the range.')
      first.unmount()
      wrappers.splice(wrappers.indexOf(first), 1)
      const second = await mountCheck()
      await nextTick()
      expect((second.get('[data-testid="learn-canvas-check-practice-answer"]').element as HTMLTextAreaElement).value).toBe('Habitat sets the range.')
      acceptPractice.mockRejectedValueOnce(new Error('network'))
      await second.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await vi.waitFor(() => expect(second.find('[data-testid="learn-canvas-check-practice-error"]').exists()).toBe(true))
      expect(JSON.parse(sessionStorage.getItem(practiceKey)!).response).toBe('Habitat sets the range.')
      await second.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await vi.waitFor(() => expect(second.find('[data-testid="learn-canvas-check-practice-saved"]').exists()).toBe(true))
      expect(sessionStorage.getItem(practiceKey)).toBeNull()
    })

    const practiceSlotState = (state: 'open' | 'accepted') => ({
      version: LEARN_V2_PUBLIC_API_VERSION, status: 'available', target: { responseSlotId: 'slot_1' }, revision: state === 'accepted' ? 2 : 1, state,
      work: state === 'accepted' ? learnAttemptHistorySchema.parse({ version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, submissionId: 'submission_2', acceptedAt: 1_800_000_300_000,
        assistanceSnapshot, validitySnapshot: validSnapshot, currentEligibility: 'eligible', body: { bodyAvailability: 'available', payload: { kind: 'text', text: 'Habitat sets the range.' } }, result: null }) : null,
    })
    const practiceKey = `learn-response:owner_1:thread_1:practice:${OPPORTUNITY}`

    it('shows an accepted practice answer as saved after a remount, with no form and no stored draft', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      sessionStorage.setItem(practiceKey, JSON.stringify({ response: 'Habitat sets the range.', confidence: null, savedAt: Date.now() }))
      practiceWorkData.value = practiceSlotState('accepted')
      const wrapper = await mountCheck()
      await flushPromises()
      expect(wrapper.get('[data-testid="learn-canvas-check-practice-saved"]').text()).toBe('Response submitted.')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-answer"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-submit"]').exists()).toBe(false)
      expect(sessionStorage.getItem(practiceKey)).toBeNull()
      const reads = subscriptions.mock.calls.filter(([name, args]) => String(name).includes('getResponseState') && (args as { target?: { responseSlotId?: string } })?.target?.responseSlotId)
      expect(reads[0]![1]).toEqual({ version: LEARN_V2_PUBLIC_API_VERSION, target: { responseSlotId: 'slot_1' } })
      expect(acceptPractice).not.toHaveBeenCalled()
    })

    it('converges on the server’s acceptance after an ambiguous practice submit, before and after a refresh', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      practiceWorkData.value = practiceSlotState('open')
      acceptPractice.mockRejectedValueOnce(new Error('network'))
      const first = await mountCheck()
      await first.get('[data-testid="learn-canvas-check-practice-answer"]').setValue('Habitat sets the range.')
      await first.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await vi.waitFor(() => expect(first.find('[data-testid="learn-canvas-check-practice-error"]').exists()).toBe(true))
      practiceWorkData.value = practiceSlotState('accepted')
      await flushPromises()
      expect(first.get('[data-testid="learn-canvas-check-practice-saved"]').exists()).toBe(true)
      expect(first.find('[data-testid="learn-canvas-check-practice-error"]').exists()).toBe(false)
      expect(sessionStorage.getItem(practiceKey)).toBeNull()
      first.unmount()
      wrappers.splice(wrappers.indexOf(first), 1)
      const second = await mountCheck()
      await flushPromises()
      expect(second.get('[data-testid="learn-canvas-check-practice-saved"]').exists()).toBe(true)
      expect(second.find('[data-testid="learn-canvas-check-practice-answer"]').exists()).toBe(false)
      expect(acceptPractice).toHaveBeenCalledOnce()
    })

    it('treats an already-accepted practice answer as saved, not as an error', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      practiceWorkData.value = practiceSlotState('open')
      acceptPractice.mockResolvedValueOnce(rejectedReceipt('already_accepted'))
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-practice-answer"]').setValue('Habitat sets the range.')
      await wrapper.get('[data-testid="learn-canvas-check-practice-submit"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice-saved"]').exists()).toBe(true))
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-error"]').exists()).toBe(false)
      expect(sessionStorage.getItem(practiceKey)).toBeNull()
    })

    it.each([
      ['result_unconfirmed', 'reconciliation_required'],
      ['closed', 'invalid'],
    ] as const)('clears a stale check draft when a %s receipt confirms the answer was accepted', async (state, phase) => {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ response: ANSWER, confidence: 3, savedAt: Date.now() }))
      teachingData.value = unavailableTeaching('test_open')
      const receipt = serverCheckReceipt({ reference: 'check_ref_1', state, answer: ANSWER, confidence: 3, postSealOpportunityId: OPPORTUNITY })
      const projection = serverSavedCheckCanvas({ opportunityId: OPPORTUNITY, phase, receipt })
      expect(projection).not.toHaveProperty('assessment')
      const wrapper = await mountCheck({ canvas: projection })
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-receipt"]').exists()).toBe(true)
      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('drops delivered help once its authorization is withdrawn', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = teachingAvailable({ feedback: null, lesson: null })
      authorizePractice.mockResolvedValueOnce(helpAuthorized('worked_example', WORKED)).mockResolvedValueOnce(helpDenied('evidence_unavailable'))
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(WORKED))
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance-denied"]').exists()).toBe(true))
      expect(wrapper.html()).not.toContain(WORKED)
    })

    it('shows cached help only for the slot and revision it was authorized for', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = teachingAvailable({ feedback: null, lesson: null })
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(WORKED))
      teachingData.value = teachingAvailable({ feedback: null, lesson: null, practice: { ...practice, revision: 2 } })
      await flushPromises()
      expect(wrapper.html()).not.toContain(WORKED)
      teachingData.value = teachingAvailable({ feedback: null, lesson: null })
      await flushPromises()
      expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(WORKED)
      const withdrawn = teachingAvailable({ feedback: null, lesson: null }) as { availability: Record<string, unknown> }
      teachingData.value = { ...withdrawn, availability: { ...withdrawn.availability, help: { remaining: 7, hint: { status: 'available' }, worked_example: { status: 'unavailable', reasonCode: 'evidence_unavailable' } } } }
      await flushPromises()
      expect(wrapper.html()).not.toContain(WORKED)
    })

    it('offers the practice retry once practice can open again after a definite refusal, without retrying by itself', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const notOpened = () => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
        feedback: null, lesson: null, practice: null, availability: { feedback: 'scoring_pending', practice: { status: 'not_opened' }, help: null } })
      teachingData.value = notOpened()
      openPracticeCommand.mockImplementationOnce(async () => {
        teachingData.value = learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
          feedback: null, lesson: null, practice: null, availability: { feedback: 'scoring_pending', practice: { status: 'unavailable', reasonCode: 'test_open' }, help: null } })
        return teachingData.value
      })
      const wrapper = await mountCheck()
      await vi.waitFor(() => expect(openPracticeCommand).toHaveBeenCalledOnce())
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-collapsed"]').exists()).toBe(false)
      teachingData.value = notOpened()
      await flushPromises()
      expect(openPracticeCommand).toHaveBeenCalledOnce()
      const row = wrapper.get('[data-testid="learn-canvas-check-practice-collapsed"]')
      expect(row.get('[data-testid="learn-canvas-check-practice-open-error"]').text()).toBe('Could not load support. Try again.')
      await row.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      expect(openPracticeCommand).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-open-error"]').exists()).toBe(false)
    })

    it('keeps an open practice answer through the switch from pending to a passed result', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = teachingAvailable({ feedback: null, lesson: null })
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-practice-answer"]').setValue('Habitat sets the range.')
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      teachingData.value = teachingAvailable({ lesson: null })
      await flushPromises()
      expect(receiptKind(wrapper)).toBe('passed')
      const field = wrapper.get('[data-testid="learn-canvas-check-practice-answer"]').element as HTMLTextAreaElement
      expect(field.value).toBe('Habitat sets the range.')
      expect(JSON.parse(sessionStorage.getItem(`learn-response:owner_1:thread_1:practice:${OPPORTUNITY}`)!).response).toBe('Habitat sets the range.')
      expect(wrapper.findAll('button').filter(button => button.classes().includes('bg-primary') && button.classes().includes('rounded-xl'))).toHaveLength(1)
      teachingData.value = teachingAvailable({ lesson: null, practice: null })
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-answer"]').exists()).toBe(false)
    })

    it('retries publication once authority returns after a denial, without looping', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      const publishing = () => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
        feedback: null, lesson: null, practice: null, availability: { feedback: 'feedback_publishing', practice: { status: 'not_opened' }, help: null } })
      teachingData.value = publishing()
      publishFeedbackCommand
        .mockImplementationOnce(async () => { teachingData.value = unavailableTeaching('test_open'); return teachingData.value })
        .mockImplementationOnce(async () => { teachingData.value = teachingAvailable({ lesson: null, practice: null }); return teachingData.value })
      const wrapper = await mountCheck()
      await vi.waitFor(() => expect(publishFeedbackCommand).toHaveBeenCalledOnce())
      await flushPromises()
      expect(wrapper.find('[data-testid="learn-canvas-check-feedback"]').exists()).toBe(false)
      teachingData.value = publishing()
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-feedback"]').exists()).toBe(true))
      expect(publishFeedbackCommand).toHaveBeenCalledTimes(2)
      expect(openPracticeCommand).not.toHaveBeenCalled()
    })

    it('stops retrying publication after a bounded number of attempts', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      const publishing = () => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
        feedback: null, lesson: null, practice: null, availability: { feedback: 'feedback_publishing', practice: { status: 'not_opened' }, help: null } })
      teachingData.value = publishing()
      publishFeedbackCommand.mockImplementation(async () => unavailableTeaching('test_open'))
      await mountCheck()
      for (let round = 0; round < 5; round++) {
        await flushPromises()
        teachingData.value = unavailableTeaching('test_open')
        await flushPromises()
        teachingData.value = publishing()
      }
      await flushPromises()
      expect(publishFeedbackCommand).toHaveBeenCalledTimes(3)
    })

    it('sends Today actions to Today and Learn exits to Learn', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      const passed = await mountCheck()
      await passed.get('[data-testid="learn-canvas-check-continue"]').trigger('click')
      expect(passed.emitted('today')).toHaveLength(1)
      expect(passed.emitted('leave')).toBeUndefined()
      stateData.value = ready()
      const entry = await mountCheck({ canvas: serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'ready', awaitingStart: true }) })
      await entry.get('[data-testid="learn-canvas-check-leave"]').trigger('click')
      expect(entry.emitted('leave')).toHaveLength(1)
      expect(entry.emitted('today')).toBeUndefined()
    })

    const publishingRead = () => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
      feedback: null, lesson: null, practice: null, availability: { feedback: 'feedback_publishing', practice: { status: 'not_opened' }, help: null } })
    const deferred = <T>() => {
      let resolve!: (value: T) => void
      let reject!: (cause: unknown) => void
      const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
      return { promise, resolve, reject }
    }

    it('recovers publication that returned to publishing while a request was in flight, within the bound', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      teachingData.value = publishingRead()
      const first = deferred<unknown>()
      publishFeedbackCommand.mockImplementationOnce(() => first.promise).mockImplementation(async () => teachingData.value)
      const wrapper = await mountCheck()
      await vi.waitFor(() => expect(publishFeedbackCommand).toHaveBeenCalledOnce())
      teachingData.value = unavailableTeaching('test_open')
      await flushPromises()
      teachingData.value = publishingRead()
      await flushPromises()
      expect(publishFeedbackCommand).toHaveBeenCalledOnce()
      first.resolve(unavailableTeaching('test_open'))
      await vi.waitFor(() => expect(publishFeedbackCommand).toHaveBeenCalledTimes(2))
      await flushPromises()
      expect(publishFeedbackCommand).toHaveBeenCalledTimes(2)
      for (let round = 0; round < 4; round++) {
        teachingData.value = unavailableTeaching('test_open')
        await flushPromises()
        teachingData.value = publishingRead()
        await flushPromises()
      }
      expect(publishFeedbackCommand).toHaveBeenCalledTimes(3)
      expect(wrapper.find('[data-testid="learn-canvas-check-feedback-publishing"]').exists()).toBe(true)
    })

    it('scores a sealed answer whose phase arrived while another command was busy', async () => {
      const pending = deferred<unknown>()
      accept.mockImplementationOnce(() => pending.promise)
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce())
      stateData.value = available('submitted_sealed', SUBMISSION, 3, capabilities({ canRequestAssistance: true, canTeachSeparateCase: true }))
      await flushPromises()
      expect(score).not.toHaveBeenCalled()
      pending.reject(new Error('network'))
      await vi.waitFor(() => expect(score).toHaveBeenCalledOnce())
      expect(scoreMasterySubmissionSchema.parse(score.mock.calls[0]![0]).submissionId).toBe(SUBMISSION)
    })

    it('still makes its one automatic practice opening after a manual opening settles', async () => {
      stateData.value = sealed('reconciliation_required')
      workData.value = workState()
      const notOpened = () => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
        feedback: null, lesson: null, practice: null, availability: { feedback: 'scoring_pending', practice: { status: 'not_opened' }, help: null } })
      teachingData.value = notOpened()
      const manual = deferred<unknown>()
      openPracticeCommand.mockImplementationOnce(() => manual.promise)
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      await vi.waitFor(() => expect(openPracticeCommand).toHaveBeenCalledOnce())
      stateData.value = sealed('scoring_pending')
      await flushPromises()
      expect(openPracticeCommand).toHaveBeenCalledOnce()
      manual.resolve(unavailableTeaching('test_open'))
      await vi.waitFor(() => expect(openPracticeCommand).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      await flushPromises()
      expect(openPracticeCommand).toHaveBeenCalledTimes(2)
    })

    it('keeps focus in practice input when a result arrives, and announces it', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      teachingData.value = teachingAvailable({ feedback: null, lesson: null })
      const wrapper = await mountCheck()
      const field = wrapper.get('[data-testid="learn-canvas-check-practice-answer"]')
      ;(field.element as HTMLTextAreaElement).focus()
      await field.setValue('Habitat sets')
      expect(document.activeElement).toBe(field.element)
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      teachingData.value = teachingAvailable({ lesson: null })
      await flushPromises()
      await nextTick()
      expect(receiptKind(wrapper)).toBe('passed')
      expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-canvas-check-practice-answer"]').element)
      expect(wrapper.get('p.sr-only[aria-live="polite"]').text()).toBe('Passed: you still had it')
    })

    it('moves focus to an arriving result when nothing in the check has focus', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      ;(document.activeElement as HTMLElement | null)?.blur()
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Not yet: part of this slipped'))
      expect(wrapper.get('p.sr-only[aria-live="polite"]').text()).toBe('Not yet: part of this slipped')
    })

    it.each([
      ['about_a_week', 'A check on last week’s work'],
      ['about_a_month', 'A check on work from about a month ago'],
      ['this_session', 'A check on this topic'],
      ['earlier', 'A check on an earlier topic'],
      ['retained', 'A check on an earlier topic'],
      ['a_future_class', 'A check on an earlier topic'],
    ])('heads the entry from the server timing %s', async (timing, heading) => {
      stateData.value = ready()
      deliveryData.value = null
      const base = serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'ready', awaitingStart: true })
      const projection = { ...base, assessment: { ...base.assessment, checkTiming: { version: 'learn-v2.canvas-check-timing.v1', timing } } }
      const wrapper = await mountCheck({ canvas: projection })
      const entry = wrapper.get('[data-testid="learn-canvas-check-entry"]')
      const title = entry.get('h2')
      expect(title.text()).toBe(heading)
      expect(entry.attributes('aria-labelledby')).toBe(title.attributes('id'))
    })

    it.each([
      ['an ordinary application check', () => serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'test_open', timing: null, purpose: null })],
      ['a not-admitted projection that carries a measurement purpose', () => serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'ready', timing: null, delivered: false })],
      ['a receipt without a measurement purpose', () => serverSavedCheckCanvas({ opportunityId: OPPORTUNITY, phase: 'invalid', receipt: serverCheckReceipt({ reference: 'r', state: 'closed', answer: ANSWER, purpose: null, timing: null, postSealOpportunityId: null }) })],
    ])('keeps the dev Canvas for %s and reads no check state', async (_name, projection) => {
      const wrapper = await mountCheck({ canvas: projection() })
      expect(wrapper.find('[data-testid="learn-canvas-check"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
      expect(wrapper.text()).not.toMatch(/A check on/)
      expect(subscribed('getAssessmentState')).toBe(false)
      expect(subscribed('getPostSealTeaching')).toBe(false)
    })

    it.each(['measurement_cold', 'measurement_delayed', 'retained_transfer'] as const)('gives a Canvas-native %s check the check experience without Today timing', async (purpose) => {
      const projection = serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'test_open', timing: null, purpose })
      expect(projection.assessment).not.toHaveProperty('checkTiming')
      const wrapper = await mountCheck({ canvas: projection })
      expect(wrapper.find('[data-testid="learn-canvas-check"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="learn-canvas-check-question"]').text()).toContain('Explain why both results make sense.')
      expect(wrapper.text()).not.toMatch(/measurement|retained|transfer|cold|delayed/i)
    })

    it.each([
      ['no timing', null],
      ['malformed timing', { version: 'learn-v2.canvas-check-timing.v0', timing: 'about_a_week' }],
    ])('uses the generic heading for a measurement check with %s', async (_name, checkTiming) => {
      stateData.value = ready()
      deliveryData.value = null
      const base = serverAssessmentCanvas({ opportunityId: OPPORTUNITY, phase: 'ready', timing: null, awaitingStart: true })
      const wrapper = await mountCheck({ canvas: { ...base, assessment: checkTiming ? { ...base.assessment, checkTiming } : base.assessment } })
      const entry = wrapper.get('[data-testid="learn-canvas-check-entry"]')
      expect(entry.get('h2').text()).toBe('A check on an earlier topic')
      expect(entry.attributes('aria-labelledby')).toBe(entry.get('h2').attributes('id'))
    })

    it.each([
      ['saved_scoring', 'saved'],
      ['result_unconfirmed', 'unconfirmed'],
      ['closed', 'invalid'],
    ] as const)('renders a frozen-cohort %s receipt after rollback as a check, with no post-seal reads', async (state, kind) => {
      stateData.value = sealed('scoring_pending')
      workData.value = null
      teachingData.value = null
      const receipt = serverCheckReceipt({ reference: 'frozen_ref', state, answer: ANSWER, confidence: 3, timing: null, postSealOpportunityId: null })
      expect(receipt).not.toHaveProperty('checkTiming')
      expect(receipt).not.toHaveProperty('postSealReference')
      const wrapper = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: OPPORTUNITY, phase: 'scoring_pending', receipt }) })
      expect(wrapper.find('[data-testid="learn-canvas-check"]').exists()).toBe(true)
      expect(receiptKind(wrapper)).toBe(kind)
      expect(wrapper.get('[data-testid="learn-canvas-check-saved-answer"]').text()).toContain(ANSWER)
      if (state !== 'saved_scoring') {
        expect(subscribed('getAssessmentState')).toBe(false)
        expect(subscribed('getPostSealTeaching')).toBe(false)
      }
    })

    it('opens practice from an unconfirmed receipt through its post-seal reference only', async () => {
      const receipt = serverCheckReceipt({ reference: 'check_ref_9', state: 'result_unconfirmed', answer: ANSWER, confidence: 4, postSealOpportunityId: 'opportunity_9' })
      teachingData.value = learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: 'opportunity_9',
        feedback: null, lesson: null, practice: null, availability: { feedback: 'scoring_pending', practice: { status: 'not_opened' }, help: null } })
      openPracticeCommand.mockImplementation(async () => {
        teachingData.value = learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: 'opportunity_9',
          feedback: null, lesson: null, practice, availability: { feedback: 'scoring_pending', practice: { status: 'available' }, help: helpOpen } })
        return teachingData.value
      })
      const wrapper = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: 'opportunity_9', phase: 'reconciliation_required', receipt }) })
      expect(receiptKind(wrapper)).toBe('unconfirmed')
      const reads = subscriptions.mock.calls.filter(([name]) => String(name).includes('getPostSealTeaching')).map(([, args]) => args)
      expect(reads.map(args => learnPostSealTeachingReferenceSchema.parse(args))).toContainEqual({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: 'opportunity_9' })
      expect(openPracticeCommand).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="learn-canvas-check-continue-practice"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(true))
      expect(learnPostSealTeachingReferenceSchema.parse(openPracticeCommand.mock.calls[0]![0])).toEqual({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: 'opportunity_9' })
      expect(wrapper.get('[data-testid="learn-canvas-check-practice"]').text()).not.toContain('How sure are you?')
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(authorizePractice).toHaveBeenCalledOnce())
      expect(learnAuthorizePracticeAssistanceSchema.parse(authorizePractice.mock.calls[0]![0])).toMatchObject({ assessmentOpportunityId: 'opportunity_9', target: { responseSlotId: 'slot_1' } })
      expect(subscribed('getAssessmentState')).toBe(false)
      expect(wrapper.text()).not.toContain('Passed')
    })

    it.each([
      ['the read is unavailable', () => unavailableTeaching('evidence_unavailable')],
      ['practice is unavailable', () => learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: 'opportunity_9',
        feedback: null, lesson: null, practice: null, availability: { feedback: 'unavailable', practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' }, help: null } })],
    ])('offers no practice on a closed receipt when %s', async (_name, read) => {
      teachingData.value = read()
      const receipt = serverCheckReceipt({ reference: 'check_ref_9', state: 'closed', answer: ANSWER, postSealOpportunityId: 'opportunity_9' })
      const wrapper = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: 'opportunity_9', phase: 'invalid', receipt }) })
      await flushPromises()
      expect(receiptKind(wrapper)).toBe('invalid')
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-collapsed"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice"]').exists()).toBe(false)
      expect(openPracticeCommand).not.toHaveBeenCalled()
    })

    it('makes no post-seal reads for a receipt without a post-seal reference', async () => {
      const receipt = serverCheckReceipt({ reference: 'check_ref_9', state: 'result_unconfirmed', answer: ANSWER, postSealOpportunityId: null })
      const wrapper = await mountCheck({ canvas: serverSavedCheckCanvas({ opportunityId: 'opportunity_9', phase: 'reconciliation_required', receipt }) })
      expect(receiptKind(wrapper)).toBe('unconfirmed')
      expect(subscribed('getPostSealTeaching')).toBe(false)
      expect(wrapper.find('[data-testid="learn-canvas-check-practice-collapsed"]').exists()).toBe(false)
    })
  })

  describe('status text and citations', () => {
    it('names the waiting state in foreground text beside the warning spinner', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      const line = wrapper.get('[data-testid="learn-canvas-check-receipt"] [role="status"] > div')
      expect(line.text()).toBe('Getting your result. It will appear here.')
      expect(line.classes()).toContain('text-foreground')
      expect(line.classes()).not.toContain('text-muted-foreground')
      expect(line.get('svg').classes()).toContain('text-[var(--learn-attention)]')
    })

    it('names feedback publishing in foreground text beside the warning spinner', async () => {
      stateData.value = scored('scored_pass')
      workData.value = workState({ result: result(['pass']) })
      teachingData.value = learnPostSealTeachingSchema.parse({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
        feedback: null, lesson: null, practice: null, availability: { feedback: 'feedback_publishing', practice: { status: 'not_opened' }, help: null } })
      publishFeedbackCommand.mockImplementation(async () => teachingData.value)
      const wrapper = await mountCheck()
      const line = wrapper.get('[data-testid="learn-canvas-check-feedback-publishing"]')
      expect(line.classes()).toContain('text-foreground')
      expect(line.classes()).not.toContain('text-muted-foreground')
      expect(line.get('svg').classes()).toContain('text-[var(--learn-attention)]')
    })

    it('keeps each first citation badge attached to the word before it', async () => {
      stateData.value = scored('scored_fail')
      workData.value = workState({ result: result(['needs_review']) })
      const extra = { sourceRef: 'source_2', label: 'Lab handout' }
      teachingData.value = teachingAvailable({ feedback: { ...feedback, text: 'You explained both results.  ', citations: [feedback.citations[0], extra] }, lesson: { ...lesson, citations: [lesson.citations[0], extra] } })
      const wrapper = await mountCheck()
      const paragraph = wrapper.get('[data-testid="learn-canvas-check-feedback"]')
      const joined = paragraph.get('span.whitespace-nowrap')
      expect(joined.text()).toBe('results.1')
      expect(joined.get('button').attributes('aria-label')).toBe('Source 1: Biology notes')
      expect(paragraph.findAll('button').map(button => button.attributes('aria-label'))).toEqual(['Source 1: Biology notes', 'Source 2: Lab handout'])
      expect(paragraph.text()).toBe('You explained both results.12')
      const lessonJoined = wrapper.get('[data-testid="learn-canvas-check-lesson"] span.whitespace-nowrap')
      expect(lessonJoined.text()).toBe('range.1')
      expect(wrapper.get('[data-testid="learn-canvas-check-lesson"]').text()).toContain('Every enzyme has a range.12')
    })
  })

  describe('content labels', () => {
    const label = (wrapper: VueWrapper, name: string) => wrapper.find(`[data-testid="learn-canvas-check-${name}-label"]`)
    const expectForegroundLabel = (wrapper: VueWrapper, name: string, text: string) => {
      expect(label(wrapper, name).text().replace(/\s+/g, ' ')).toBe(text)
      expect(label(wrapper, name).classes()).toContain('text-foreground')
      expect(label(wrapper, name).classes().some(name => name.includes('learn-attention') || name.includes('destructive') || name.includes('primary') || name.includes('green'))).toBe(false)
    }
    const expectNoCodes = (wrapper: VueWrapper) => expect(wrapper.text()).not.toMatch(/\bT[012]\b/)
    async function mountResult(phase: 'scored_pass' | 'scored_fail', teaching: Record<string, unknown>) {
      teachingData.value = teachingAvailable(teaching)
      stateData.value = scored(phase)
      workData.value = workState({ result: result([phase === 'scored_pass' ? 'pass' : 'needs_review']) })
      return await mountCheck()
    }
    async function mountPractice(tier: 'T0' | 'T2') {
      teachingData.value = teachingAvailable({ feedback: null, lesson: null, practice: { ...practice, tier } })
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      return await mountCheck()
    }

    it('adds the web label to the feedback caption as its own element', async () => {
      const wrapper = await mountResult('scored_pass', { feedback: { ...feedback, tier: 'T1' } })
      expectForegroundLabel(wrapper, 'feedback', 'from the web, not yet verified')
      expect(wrapper.get('[data-testid="learn-canvas-check-feedback-caption"]').text()).toBe('Feedback on your answer · from the web, not yet verified')
      const feedbackText = wrapper.get('[data-testid="learn-canvas-check-feedback"]')
      expect(feedbackText.text()).not.toContain('from the web')
      expect(label(wrapper, 'feedback').element.compareDocumentPosition(feedbackText.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expectNoCodes(wrapper)
    })

    it('shows no mark on source-checked feedback', async () => {
      const wrapper = await mountResult('scored_pass', { feedback: { ...feedback, tier: 'T0' } })
      expect(label(wrapper, 'feedback').exists()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-feedback-caption"]').text()).toBe('Feedback on your answer')
      expectNoCodes(wrapper)
    })

    it('labels a web lesson above its text', async () => {
      const wrapper = await mountResult('scored_fail', { lesson: { ...lesson, tier: 'T1' } })
      expectForegroundLabel(wrapper, 'lesson', 'From the web, not yet verified')
      const card = wrapper.get('[data-testid="learn-canvas-check-lesson"]')
      expect(card.findAll('p').find(node => node.text().startsWith('Every enzyme'))!.text()).not.toContain('From the web')
      expect(label(wrapper, 'lesson').element.compareDocumentPosition(card.findAll('p').find(node => node.text().startsWith('Every enzyme'))!.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expectNoCodes(wrapper)
    })

    it('shows no mark on a source-checked lesson', async () => {
      const wrapper = await mountResult('scored_fail', { lesson: { ...lesson, tier: 'T0' } })
      expect(label(wrapper, 'lesson').exists()).toBe(false)
      expectNoCodes(wrapper)
    })

    it('labels a Budds-written practice prompt above its text', async () => {
      const wrapper = await mountPractice('T2')
      expectForegroundLabel(wrapper, 'practice', 'Written by Budds, not source-checked')
      const prompt = wrapper.get('[data-testid="learn-canvas-check-practice-prompt"]')
      expect(prompt.text()).toBe(practice.prompt)
      expect(prompt.classes()).toContain('mt-2')
      expect(label(wrapper, 'practice').get('span').classes()).toContain('whitespace-nowrap')
      expect(label(wrapper, 'practice').element.compareDocumentPosition(prompt.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expectNoCodes(wrapper)
    })

    it('shows no mark on a source-checked practice prompt', async () => {
      const wrapper = await mountPractice('T0')
      expect(label(wrapper, 'practice').exists()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-practice-prompt"]').classes()).toContain('mt-4')
      expectNoCodes(wrapper)
    })

    it('labels a Budds-written worked example only once it arrives', async () => {
      const wrapper = await mountPractice('T0')
      expect(label(wrapper, 'worked').exists()).toBe(false)
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(true))
      expectForegroundLabel(wrapper, 'worked', 'Worked example · written by Budds, not source-checked')
      expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(WORKED)
      expect(label(wrapper, 'practice').exists()).toBe(false)
      expectNoCodes(wrapper)
    })

    it('shows no mark on a source-checked worked example', async () => {
      authorizePractice.mockReset().mockResolvedValue(helpAuthorized('worked_example', WORKED, 1, 'T0'))
      const wrapper = await mountPractice('T0')
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(true))
      expect(label(wrapper, 'worked').exists()).toBe(false)
      expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').classes()).not.toContain('mt-1')
      expectNoCodes(wrapper)
    })

    it('shows no mark on a hint, even under a Budds-written prompt', async () => {
      const wrapper = await mountPractice('T2')
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(HINT))
      expect(label(wrapper, 'worked').exists()).toBe(false)
      expectForegroundLabel(wrapper, 'practice', 'Written by Budds, not source-checked')
      expectNoCodes(wrapper)
    })

    it('reads the labels from the server tier, not from the check result', async () => {
      const wrapper = await mountResult('scored_fail', { feedback: { ...feedback, tier: 'T0' }, lesson: { ...lesson, tier: 'T1' } })
      expect(label(wrapper, 'feedback').exists()).toBe(false)
      expect(label(wrapper, 'lesson').exists()).toBe(true)
    })
  })

  describe('refresh and draft buffer', () => {
    it('restores the same question and draft with a neutral notice', async () => {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ response: 'Half an answer', confidence: 2, savedAt: Date.now() }))
      const wrapper = await mountCheck()
      await nextTick()
      const notice = wrapper.get('[data-testid="learn-canvas-check-restored"]')
      expect(notice.attributes('role')).toBe('status')
      expect(notice.attributes('data-tone')).toBe('neutral')
      expect(notice.text()).toContain('Same check, same question')
      expect((wrapper.get('[data-testid="learn-canvas-check-answer"]').element as HTMLTextAreaElement).value).toBe('Half an answer')
      expect((wrapper.get('[data-testid="learn-canvas-check-confidence-2"]').element as HTMLInputElement).checked).toBe(true)
      expect(wrapper.get('[data-testid="learn-canvas-check-question"]').text()).toContain('Explain why both results make sense.')
      expect(grant).not.toHaveBeenCalled()
    })

    it('shows no restored notice without a stored draft', async () => {
      const wrapper = await mountCheck()
      expect(wrapper.find('[data-testid="learn-canvas-check-restored"]').exists()).toBe(false)
    })

    it('buffers the draft under an owner-scoped key cleared by sign-out', async () => {
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-answer"]').setValue('In progress')
      await nextTick()
      expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!).response).toBe('In progress')
      expect(DRAFT_KEY.startsWith('learn-response:')).toBe(true)
    })

    it('clears the draft on authoritative acceptance', async () => {
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await nextTick()
      expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull()
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull())
    })

    it('keeps the draft when the submission is rejected', async () => {
      accept.mockResolvedValueOnce(rejectedReceipt('stale_revision'))
      const wrapper = await mountCheck()
      await fillAnswer(wrapper)
      await nextTick()
      await wrapper.get('[data-testid="learn-canvas-check-submit"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-submit-error"]').exists()).toBe(true))
      expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull()
    })

    it('clears a stale draft when the server already holds the sealed answer', async () => {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ response: 'Old draft', confidence: 2, savedAt: Date.now() }))
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
      expect(wrapper.get('[data-testid="learn-canvas-check-saved-answer"]').text()).toContain(ANSWER)
      expect(wrapper.text()).not.toContain('Old draft')
    })

    it('shows the loading state until the authoritative state arrives', async () => {
      stateData.value = null
      const wrapper = await mountCheck()
      expect(wrapper.get('[data-testid="learn-canvas-check-loading"]').attributes('role')).toBe('status')
      expect(wrapper.find('[data-testid="learn-canvas-check-open"]').exists()).toBe(false)
    })
  })
})
