import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, learnAcceptResponseRequestSchema, learnResponseIdempotencyKeySchema, learnResponseReceiptSchema } from '~~/shared/learn-v2-responses'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, learnAttemptHistorySchema, learnDeliveredAssessmentSchema } from '~~/shared/learn-v2-assessment-disclosure'
import { LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, learnAssessmentCapabilitiesSchema, type LearnAssessmentPhase } from '~~/shared/learn-v2-delayed-check'
import { acceptMasterySubmissionSchema, scoreMasterySubmissionSchema, grantAssessmentDeliverySchema, authorizeAssistanceSchema, LEARN_V2_PUBLIC_API_VERSION } from '~~/convex/lib/learnV2PublicContract'

const stateData = shallowRef<unknown>(null)
const deliveryData = shallowRef<unknown>(null)
const workData = shallowRef<unknown>(null)
const isOnline = ref(true)
const grant = vi.fn()
const accept = vi.fn()
const acceptPractice = vi.fn()
const score = vi.fn()
const authorize = vi.fn()
const recordAssistance = vi.fn()
const stageLegacy = vi.fn()
const scoreLegacy = vi.fn()

mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexQuery', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { data: name.includes('getAssessmentState') ? stateData : name.includes('getAssessment') ? deliveryData : name.includes('getResponseState') ? workData : ref(null), pending: ref(false) }
})
mockNuxtImport('useConvexMutation', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { mutate: name.includes('grantAssessmentDelivery') ? grant : name.includes('acceptMasterySubmission') ? accept : name.includes('acceptResponse') ? acceptPractice : name.includes('authorizeAssistance') ? authorize : name.includes('recordAssistanceUse') ? recordAssistance : name.includes('submitCanvasResponse') ? stageLegacy : vi.fn() }
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

const practice = { responseSlotId: 'slot_1', revision: 1, prompt: 'Cod digestive enzymes work well at 4°C.', hint: 'Think about habitat.', workedExample: 'Compare to a hot spring.' }
const feedback = { text: 'You explained both results.', citations: [{ sourceRef: 'source_1', label: 'Biology notes' }] }
const lesson = { paragraphs: ['Every enzyme has a range.'], citations: [{ sourceRef: 'source_1', label: 'Biology notes' }] }
const canvas = (overrides: Record<string, unknown> = {}) => ({
  ownerId: 'owner_1', status: 'started', thread: { id: 'thread_1', outcome: 'Explain enzymes', intent: 'understand', revision: 2 },
  activity: { id: 'check_activity', status: 'eligible', purpose: 'Answer-bearing purpose text.', reasonCode: 'check', planRevision: 1, primitive: null,
    controls: { reasonText: { version: 'v', purpose: 'why', text: 'Why this canary.' }, selected: null, fixedNextPlan: null, options: [] },
    fallback: { testId: 'learn-activity-fallback', title: 'Activity unavailable', body: 'Try later.', primaryAction: { label: 'Continue safely' } },
    requiredAction: { kind: 'submit_response', label: 'Submit response' } },
  session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' },
  responsePrompt: null,
  assessmentCheck: { assessmentOpportunityId: OPPORTUNITY, laterTeaching: { practice, feedback, lesson } },
  ...overrides,
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
    isOnline.value = true
    grant.mockReset().mockResolvedValue({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'granted', assessmentOpportunityId: OPPORTUNITY, deliveryGrantId: 'grant_1', revision: 2, phase: 'test_open' })
    accept.mockReset().mockResolvedValue(acceptedReceipt())
    acceptPractice.mockReset().mockResolvedValue(learnResponseReceiptSchema.parse({ kind: 'accepted', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, target: { responseSlotId: 'slot_1' }, submissionId: 'submission_2', acceptedAt: 1, revision: 2, phase: 'accepted', bodyAvailability: 'available' }))
    score.mockReset().mockResolvedValue({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'scoring_pending', submissionId: SUBMISSION, reasonCodes: [] })
    authorize.mockReset().mockResolvedValue({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'authorized', authorizationId: 'auth_1', assessmentOpportunityId: OPPORTUNITY })
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
      const wrapper = await mountCheck({ canvas: canvas({ assessmentCheck: null, activity: { ...canvas().activity, controls: undefined } }) })
      expect(wrapper.find('[data-testid="learn-canvas-check"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    })
  })

  describe('entry and open check', () => {
    it('grants delivery with a generated key and moves focus to the question', async () => {
      stateData.value = ready()
      deliveryData.value = null
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(grant).toHaveBeenCalledOnce())
      const request = grantAssessmentDeliverySchema.parse(grant.mock.calls[0]![0])
      expect(request).toMatchObject({ assessmentOpportunityId: OPPORTUNITY, expectedRevision: 1 })
      stateData.value = open()
      deliveryData.value = delivered()
      await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Your question'))
      expect(wrapper.get('[data-testid="learn-canvas-check-question"]').text()).toContain('Two enzymes are tested')
      expect(wrapper.get('[data-testid="learn-canvas-check-question"]').text()).toContain('Explain why both results make sense.')
    })

    it('keeps the grant key on an ambiguous start failure', async () => {
      stateData.value = ready()
      grant.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'granted', assessmentOpportunityId: OPPORTUNITY, deliveryGrantId: 'grant_1', revision: 2, phase: 'test_open' })
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-start-error"]').exists()).toBe(true))
      await wrapper.get('[data-testid="learn-canvas-check-start"]').trigger('click')
      await vi.waitFor(() => expect(grant).toHaveBeenCalledTimes(2))
      expect(grant.mock.calls[1]![0].idempotencyKey).toBe(grant.mock.calls[0]![0].idempotencyKey)
    })

    it('hides every help, Why, Evidence and activity control while the check is open', async () => {
      const wrapper = await mountCheck()
      expect(wrapper.text()).toContain('Hints, examples, sources and chat come back after you submit.')
      for (const testId of ['learn-canvas-hint', 'learn-canvas-reveal', 'learn-canvas-source-1', 'learn-canvas-check-hint', 'learn-canvas-check-worked-example']) {
        expect(wrapper.find(`[data-testid="${testId}"]`).exists()).toBe(false)
      }
      expect(wrapper.text()).not.toContain('Why this canary.')
      expect(wrapper.text()).not.toContain('Answer-bearing purpose text.')
      expect(wrapper.text()).not.toContain('Answer in your own words.')
      expect(recordAssistance).not.toHaveBeenCalled()
      expect(authorize).not.toHaveBeenCalled()
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

    it('shows practice help only after the server authorizes it', async () => {
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      expect(wrapper.text()).not.toContain(practice.hint)
      await wrapper.get('[data-testid="learn-canvas-check-hint"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-check-assistance"]').text()).toBe(practice.hint))
      expect(authorizeAssistanceSchema.parse(authorize.mock.calls[0]![0])).toMatchObject({ kind: 'hint', assessmentOpportunityId: OPPORTUNITY })
    })

    it('renders no help content when the server denies it', async () => {
      authorize.mockResolvedValueOnce({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'denied', reasonCode: 'test_open' })
      stateData.value = sealed('scoring_pending')
      workData.value = workState()
      const wrapper = await mountCheck()
      await wrapper.get('[data-testid="learn-canvas-check-worked-example"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-check-assistance-denied"]').exists()).toBe(true))
      expect(wrapper.find('[data-testid="learn-canvas-check-assistance"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain(practice.workedExample)
      expect(recordAssistance).not.toHaveBeenCalled()
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
