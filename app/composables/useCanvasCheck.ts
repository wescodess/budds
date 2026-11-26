import type { Ref } from 'vue'
import type { LEARN_V2_PUBLIC_API_VERSION, LearnV2AssessmentDelivery, LearnV2AssessmentState, LearnV2PracticeAssistanceAuthorization, LearnV2ResponseState } from '~~/convex/lib/learnV2PublicContract'
import { learnV2CanvasMeasurementApi as checkApi } from '~~/convex/learnV2ApiAdapters'
import { api } from '#convex/api'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, type LearnResponsePayload } from '~~/shared/learn-v2-responses'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '~~/shared/learn-v2-assessment-disclosure'
import type { LearnAssessmentPhase } from '~~/shared/learn-v2-delayed-check'
import { LEARN_CANVAS_ASSESSMENT_PURPOSES, LEARN_CANVAS_CHECK_TIMING_VERSION, LEARN_TODAY_CHECK_TIMINGS, learnCanvasCheckReceiptSchema, type LearnCanvasCheckReceipt } from '~~/shared/learn-v2-today-check'
import { LEARN_MEASUREMENT_CAPABILITIES } from '~~/shared/learn-v2-measurement-storage-manifest'
import { useAdaptiveResponseDraft } from '~/composables/useAdaptiveResponseDraft'

const PUBLIC_API_VERSION: typeof LEARN_V2_PUBLIC_API_VERSION = 'learn-v2.public-api.v1'
const MAX_ANSWER_LENGTH = 12_000
const PRE_SEAL_PHASES: readonly LearnAssessmentPhase[] = ['preparing', 'ready', 'test_open']

export type CanvasCheckTiming = typeof LEARN_TODAY_CHECK_TIMINGS[number]
export type CanvasCheckStart = { studySessionId: string, expectedSessionRevision: number }
export type CanvasCheckBinding = { assessmentOpportunityId: string | null, receipt: LearnCanvasCheckReceipt | null, timing: CanvasCheckTiming | null, start: CanvasCheckStart | null }
type CanvasCheckProjection = {
  assessment?: { assessmentOpportunityId: string, checkTiming?: unknown, assessmentPurpose?: unknown, reasonCode?: string | null, observations?: unknown } | null
  checkReceipt?: unknown
  session?: { studySessionId: string, revision: number } | null
} | null | undefined

function measurementPurpose(value: unknown) {
  return typeof value === 'string' && (LEARN_CANVAS_ASSESSMENT_PURPOSES as readonly string[]).includes(value)
}

function checkTiming(value: unknown): CanvasCheckTiming | null {
  if (!value || typeof value !== 'object') return null
  const { version, timing } = value as { version?: unknown, timing?: unknown }
  if (version !== LEARN_CANVAS_CHECK_TIMING_VERSION || typeof timing !== 'string') return null
  return (LEARN_TODAY_CHECK_TIMINGS as readonly string[]).includes(timing) ? timing as CanvasCheckTiming : 'earlier'
}

function parseReceipt(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const raw = value as { checkTiming?: unknown }
  const timing = checkTiming(raw.checkTiming)
  const parsed = learnCanvasCheckReceiptSchema.safeParse(timing ? { ...raw, checkTiming: { version: LEARN_CANVAS_CHECK_TIMING_VERSION, timing } } : raw)
  return parsed.success ? parsed.data : null
}

export function canvasCheckBinding(canvas: CanvasCheckProjection): CanvasCheckBinding | null {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || !canvas) return null
  const receipt = canvas.checkReceipt === undefined ? null : parseReceipt(canvas.checkReceipt)
  if (canvas.checkReceipt !== undefined && !receipt) return null
  const assessment = canvas.assessment ?? null
  if (!measurementPurpose(assessment?.assessmentPurpose ?? receipt?.assessmentPurpose)) return null
  const awaitingStart = !receipt && assessment?.reasonCode === 'awaiting_start' && assessment.observations === undefined
  const delivered = Boolean(receipt) || (assessment !== null && !awaitingStart && assessment.reasonCode !== 'not_admitted' && assessment.observations === undefined)
  if (!delivered && !awaitingStart) return null
  const timing = checkTiming(assessment?.checkTiming) ?? receipt?.checkTiming?.timing ?? null
  const assessmentOpportunityId = assessment?.assessmentOpportunityId ?? null
  const start = awaitingStart && canvas.session ? { studySessionId: canvas.session.studySessionId, expectedSessionRevision: canvas.session.revision } : null
  return assessmentOpportunityId || receipt ? { assessmentOpportunityId, receipt, timing, start } : null
}

export function canvasCheckIdentity(binding: CanvasCheckBinding) {
  return binding.assessmentOpportunityId ?? `receipt:${binding.receipt?.reference ?? ''}`
}
export type CanvasCheckHelpKind = 'hint' | 'worked_example'
export type CanvasCheckReceiptKind = 'saved' | 'scoring_failed' | 'unconfirmed' | 'invalid' | 'passed' | 'not_yet'
export type CanvasCheckView =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'entry' }
  | { kind: 'open', question: string | null }
  | { kind: 'receipt', receipt: CanvasCheckReceiptKind, answer: string | null, acceptedAt: number | null }

type AvailableState = Extract<LearnV2AssessmentState, { status: 'available' }>
type AvailableWork = NonNullable<Extract<LearnV2ResponseState, { status: 'available' }>['work']>
type LocalReceipt = { submissionId: string, acceptedAt: number, answer: string }
type SubmitFailure = 'offline' | 'request' | null
type PracticeHelpContent = Extract<LearnV2PracticeAssistanceAuthorization, { status: 'authorized' }>['content']

function commandKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function bodyText(work: { body: AvailableWork['body'] } | null) {
  return work?.body.bodyAvailability === 'available' && work.body.payload.kind === 'text' ? work.body.payload.text : null
}

function receiptOnlyKind(receipt: LearnCanvasCheckReceipt): CanvasCheckReceiptKind {
  if (receipt.state === 'closed') return 'invalid'
  if (receipt.state === 'saved_scoring') return 'saved'
  if (receipt.state === 'result_ready' && receipt.result.feedbackCodes.includes('pass')) return 'passed'
  if (receipt.state === 'result_ready' && receipt.result.feedbackCodes.includes('needs_review')) return 'not_yet'
  return 'unconfirmed'
}

function scoredReceipt(state: AvailableState, work: AvailableWork | null): CanvasCheckReceiptKind {
  const result = work?.result
  if (!state.capabilities.canReadFeedback || !result) return 'unconfirmed'
  if (work.validitySnapshot.status === 'excluded' || work.currentEligibility === 'excluded') return 'invalid'
  if (result.feedbackCodes.some(code => code === 'assisted_result' || code === 'excluded_result')) return 'invalid'
  if (work.validitySnapshot.status !== 'valid' || work.currentEligibility !== 'eligible') return 'unconfirmed'
  if (state.phase === 'scored_pass' && result.feedbackCodes.includes('pass')) return 'passed'
  if (state.phase === 'scored_fail' && result.feedbackCodes.includes('needs_review')) return 'not_yet'
  return 'unconfirmed'
}

function questionText(delivery: LearnV2AssessmentDelivery | null | undefined) {
  if (delivery?.status !== 'delivered' || delivery.responseSpec.kind !== 'bounded_rubric') return null
  return [delivery.declaredStimulus, delivery.prompt].filter(Boolean).join('\n\n')
}

export function useCanvasCheckLock(binding: () => CanvasCheckBinding | null | undefined) {
  const stateQuery = useSkippableConvexQuery(checkApi.getAssessmentState, () => {
    const opportunityId = binding()?.assessmentOpportunityId
    return import.meta.client && opportunityId ? { version: PUBLIC_API_VERSION, assessmentOpportunityId: opportunityId as never } : 'skip'
  })
  const state = computed(() => binding()?.assessmentOpportunityId ? stateQuery.data.value : null)
  const locked = computed(() => Boolean(binding()?.assessmentOpportunityId) && (state.value?.status !== 'available' || PRE_SEAL_PHASES.includes(state.value.phase)))
  const open = computed(() => state.value?.status === 'available' && state.value.phase === 'test_open' && state.value.capabilities.canSubmit)
  return { locked, open }
}

export function useCanvasCheck(options: {
  ownerId: string
  threadId: string
  binding: () => CanvasCheckBinding
  isOnline: Readonly<Ref<boolean>>
}) {
  const opportunityId = options.binding().assessmentOpportunityId
  const postSealId = opportunityId ?? options.binding().receipt?.postSealReference?.assessmentOpportunityId ?? null
  const assessmentOpportunityId = opportunityId as never
  const serverReceipt = computed(() => options.binding().receipt)
  const reference = { version: PUBLIC_API_VERSION, assessmentOpportunityId }
  const stateQuery = useSkippableConvexQuery(checkApi.getAssessmentState, () => import.meta.client && opportunityId ? reference : 'skip')
  const state = computed(() => stateQuery.data.value)
  const available = computed(() => state.value?.status === 'available' ? state.value : null)

  const local = shallowRef<LocalReceipt | null>(null)
  const submissionId = computed(() => available.value?.submissionId ?? serverReceipt.value?.submissionId ?? local.value?.submissionId ?? null)
  const deliveryQuery = useSkippableConvexQuery(checkApi.getAssessment, () => import.meta.client && opportunityId && available.value?.phase === 'test_open' ? reference : 'skip')
  const workQuery = useSkippableConvexQuery(checkApi.getResponseState, () => import.meta.client && opportunityId && submissionId.value
    ? { version: PUBLIC_API_VERSION, target: { assessmentOpportunityId } }
    : 'skip')
  const work = computed(() => {
    const value = workQuery.data.value
    return value?.status === 'available' ? value.work : null
  })
  const canonicalAnswer = computed(() => {
    if (workQuery.data.value) return { text: bodyText(work.value) }
    if (serverReceipt.value) return { text: bodyText(serverReceipt.value) }
    return null
  })

  const attachMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.attachReadySession) : { mutate: async () => undefined }
  const acceptMutation = import.meta.client ? useConvexMutation(checkApi.acceptMasterySubmission) : { mutate: async () => undefined }
  const acceptPracticeMutation = import.meta.client ? useConvexMutation(checkApi.acceptResponse) : { mutate: async () => undefined }
  const scoreAction = import.meta.client ? useConvexAction(checkApi.scoreMasterySubmission) : { mutate: async () => undefined }
  const authorizePracticeMutation = import.meta.client ? useConvexMutation(checkApi.authorizePracticeAssistance) : { mutate: async () => undefined }
  const openPracticeMutation = import.meta.client ? useConvexMutation(checkApi.openPostSealPractice) : { mutate: async () => undefined }
  const publishFeedbackMutation = import.meta.client ? useConvexMutation(checkApi.publishPostSealFeedback) : { mutate: async () => undefined }

  const answer = ref('')
  const confidence = ref<number | null>(null)
  const answerMissing = ref(false)
  const confidenceMissing = ref(false)
  const submitFailure = ref<SubmitFailure>(null)
  const startFailed = ref(false)
  const startRefused = ref(false)
  const scoreFailed = ref(false)
  const busy = ref(false)

  let submitKey: string | null = null
  let submitPayload: string | null = null
  let startKey: string | null = null
  let scoreRequestedFor: string | null = null

  const view = computed<CanvasCheckView>(() => {
    const receipt = (kind: CanvasCheckReceiptKind): CanvasCheckView => ({
      kind: 'receipt', receipt: kind,
      answer: canonicalAnswer.value ? canonicalAnswer.value.text : local.value?.answer ?? null,
      acceptedAt: work.value?.acceptedAt ?? serverReceipt.value?.acceptedAt ?? local.value?.acceptedAt ?? null,
    })
    if (!opportunityId) return serverReceipt.value ? receipt(receiptOnlyKind(serverReceipt.value)) : { kind: 'unavailable' }
    if (state.value === null) return { kind: 'loading' }
    if (!available.value) return { kind: 'unavailable' }
    const { phase, capabilities } = available.value
    if (local.value && (phase === 'test_open' || phase === 'ready')) return receipt('saved')
    switch (phase) {
      case 'ready': return capabilities.canDeliver ? { kind: 'entry' } : { kind: 'unavailable' }
      case 'test_open': {
        if (!capabilities.canSubmit) return { kind: 'unavailable' }
        const delivery = deliveryQuery.data.value
        if (!delivery) return { kind: 'loading' }
        if (delivery.status !== 'delivered') return { kind: 'unavailable' }
        const question = questionText(delivery)
        return question ? { kind: 'open', question } : { kind: 'unavailable' }
      }
      case 'submitted_sealed':
      case 'scoring_pending': return submissionId.value ? receipt(scoreFailed.value ? 'scoring_failed' : 'saved') : { kind: 'loading' }
      case 'retryable_failure': return submissionId.value ? receipt('scoring_failed') : { kind: 'loading' }
      case 'reconciliation_required': return submissionId.value ? receipt('unconfirmed') : { kind: 'loading' }
      case 'invalid': return receipt('invalid')
      case 'scored_pass':
      case 'scored_fail': return submissionId.value ? (work.value ? receipt(scoredReceipt(available.value, work.value)) : { kind: 'loading' }) : { kind: 'loading' }
      default: return { kind: 'unavailable' }
    }
  })

  const sealed = computed(() => view.value.kind === 'receipt')
  const draftKey = postSealId ? `learn-response:${options.ownerId}:${options.threadId}:check:${postSealId}` : null
  const { restored } = useAdaptiveResponseDraft(draftKey, answer, sealed, confidence)

  const canTeachSeparateCase = computed(() => opportunityId ? available.value?.capabilities.canTeachSeparateCase === true : Boolean(postSealId))
  const invalidBySource = computed(() => {
    const current = work.value
    if (!current) return serverReceipt.value?.body.bodyAvailability === 'unavailable' && serverReceipt.value.body.reasonCode === 'evidence_unavailable'
    return current.body.bodyAvailability !== 'available'
      || current.validitySnapshot.exclusionReasons.some(reason => reason === 'evidence_unavailable' || reason === 'pins_mismatch')
  })
  const hasSealedReceipt = computed(() => Boolean(postSealId) && view.value.kind === 'receipt' && submissionId.value !== null)
  const teachingReference = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: postSealId as never }
  const teachingQuery = useSkippableConvexQuery(checkApi.getPostSealTeaching, () => import.meta.client && hasSealedReceipt.value ? teachingReference : 'skip')
  const teaching = computed(() => {
    const value = teachingQuery.data.value
    return hasSealedReceipt.value && value?.status === 'available' ? value : null
  })
  const availability = computed(() => teaching.value?.availability ?? null)
  const feedbackPublishing = computed(() => availability.value?.feedback === 'feedback_publishing')
  const teachingSettled = computed(() => hasSealedReceipt.value && (teachingQuery.data.value?.status === 'unavailable'
    || availability.value?.feedback === 'available' || availability.value?.feedback === 'unavailable'))
  const feedback = computed(() => {
    const current = view.value
    return current.kind === 'receipt' && (current.receipt === 'passed' || current.receipt === 'not_yet') ? teaching.value?.feedback ?? null : null
  })
  const lesson = computed(() => {
    const current = view.value
    return current.kind === 'receipt' && current.receipt === 'not_yet' ? teaching.value?.lesson ?? null : null
  })
  const lessonUnavailable = computed(() => {
    const current = view.value
    return current.kind === 'receipt' && current.receipt === 'not_yet' && teachingSettled.value && !lesson.value
  })
  const practice = computed(() => canTeachSeparateCase.value && availability.value?.practice.status === 'available' ? teaching.value?.practice ?? null : null)
  const practiceOffered = computed(() => canTeachSeparateCase.value
    && (availability.value?.practice.status === 'available' || availability.value?.practice.status === 'not_opened'))
  const help = computed(() => practice.value ? availability.value?.help ?? null : null)

  async function start() {
    const current = available.value
    const attach = options.binding().start
    if (!current || !current.capabilities.canDeliver || busy.value || startRefused.value || !options.isOnline.value) return
    startFailed.value = false
    if (!attach) {
      startFailed.value = true
      startRefused.value = true
      return
    }
    busy.value = true
    startKey ??= commandKey('adaptive-canvas-check-start')
    try {
      const result = await attachMutation.mutate({ studySessionId: attach.studySessionId as never, expectedSessionRevision: attach.expectedSessionRevision, idempotencyKey: startKey })
      if (result?.kind !== 'attached') {
        startKey = null
        startFailed.value = true
        startRefused.value = true
      }
    }
    catch { startFailed.value = true }
    finally { busy.value = false }
  }

  function validate() {
    const text = answer.value.trim()
    answerMissing.value = text.length === 0
    confidenceMissing.value = confidence.value === null
    return !answerMissing.value && !confidenceMissing.value && text.length <= MAX_ANSWER_LENGTH
  }

  async function score(id: string) {
    if (!options.isOnline.value || busy.value) return
    busy.value = true
    scoreFailed.value = false
    scoreRequestedFor = id
    try {
      const result = await scoreAction.mutate({ version: PUBLIC_API_VERSION, submissionId: id as never, idempotencyKey: `adaptive-canvas-check-score-${id}` })
      if (result?.status === 'disabled' || result?.status === 'unavailable') scoreFailed.value = true
    }
    catch { scoreFailed.value = true }
    finally { busy.value = false }
  }

  async function submit() {
    const current = available.value
    if (!current || busy.value) return { sealed: false }
    if (!validate()) return { sealed: false }
    const text = answer.value.trim()
    submitFailure.value = null
    if (!options.isOnline.value) {
      submitFailure.value = 'offline'
      return { sealed: false }
    }
    const fingerprint = JSON.stringify([text, confidence.value])
    if (fingerprint !== submitPayload) {
      submitKey = commandKey('adaptive-canvas-check-submit')
      submitPayload = fingerprint
    }
    busy.value = true
    let id: string | null = null
    try {
      const receipt = await acceptMutation.mutate(checkApi.masterySubmissionArgs({
        version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
        idempotencyKey: submitKey!,
        response: {
          target: { assessmentOpportunityId },
          expectedRevision: current.revision,
          payload: { kind: 'text', text } satisfies LearnResponsePayload,
          confidence: confidence.value ?? undefined,
        },
      }))
      if (receipt?.kind === 'accepted' && receipt.phase === 'submitted_sealed') {
        local.value = { submissionId: receipt.submissionId, acceptedAt: receipt.acceptedAt, answer: text }
        id = receipt.submissionId
      }
      else {
        submitKey = null
        submitPayload = null
        if (receipt?.kind === 'rejected' && receipt.reasonCode === 'empty_response') answerMissing.value = true
        else if (receipt?.kind === 'rejected' && receipt.reasonCode === 'confidence_required') confidenceMissing.value = true
        else if (receipt?.kind !== 'rejected' || (receipt.reasonCode !== 'already_accepted' && receipt.reasonCode !== 'idempotency_conflict')) submitFailure.value = 'request'
      }
    }
    catch { submitFailure.value = 'request' }
    finally { busy.value = false }
    if (id) void score(id)
    return { sealed: id !== null }
  }

  function retryScore() {
    const id = submissionId.value
    if (id) void score(id)
  }

  watch([() => available.value?.phase, submissionId, options.isOnline], ([phase, id, online]) => {
    if (phase === 'submitted_sealed' && id && online && scoreRequestedFor !== id) void score(id)
  }, { flush: 'post', immediate: true })

  const MAX_PUBLISH_ATTEMPTS = 3
  const feedbackPublishBusy = ref(false)
  let publishFor: string | null = null
  let publishAttempts = 0

  async function publishFeedback(id: string) {
    if (publishFor !== id) {
      publishFor = id
      publishAttempts = 0
    }
    if (publishAttempts >= MAX_PUBLISH_ATTEMPTS) return
    publishAttempts += 1
    feedbackPublishBusy.value = true
    try { await publishFeedbackMutation.mutate(teachingReference).catch(() => undefined) }
    finally { feedbackPublishBusy.value = false }
  }

  watch([feedbackPublishing, submissionId, options.isOnline], ([publishing, id, online]) => {
    if (publishing && id && online && !feedbackPublishBusy.value) void publishFeedback(id)
  }, { flush: 'post', immediate: true })

  const practiceAnswer = ref('')
  const practiceMissing = ref(false)
  const practiceBusy = ref(false)
  const practiceFailed = ref(false)
  const practiceAcceptedHere = ref(false)
  const practiceStateQuery = useSkippableConvexQuery(checkApi.getResponseState, () => import.meta.client && practice.value
    ? { version: PUBLIC_API_VERSION, target: { responseSlotId: practice.value.responseSlotId as never } }
    : 'skip')
  const practiceAcceptedOnServer = computed(() => {
    const value = practiceStateQuery.data.value
    return Boolean(practice.value) && value?.status === 'available' && value.state === 'accepted'
  })
  const practiceSaved = computed(() => practiceAcceptedHere.value || practiceAcceptedOnServer.value)
  watch(practiceAcceptedOnServer, accepted => { if (accepted) practiceFailed.value = false })
  useAdaptiveResponseDraft(postSealId ? `learn-response:${options.ownerId}:${options.threadId}:practice:${postSealId}` : null, practiceAnswer, practiceSaved)
  const cachedAssistance = shallowRef<{ content: PracticeHelpContent, responseSlotId: string, revision: number } | null>(null)
  const assistance = computed(() => {
    const cached = cachedAssistance.value
    const current = practice.value
    if (!cached || !current || cached.responseSlotId !== current.responseSlotId || cached.revision !== current.revision) return null
    const state = help.value?.[cached.content.kind]
    return state?.status === 'unavailable' && state.reasonCode !== 'help_limit_reached' ? null : cached.content
  })
  const assistanceDenied = ref(false)
  const assistanceLimit = ref(false)
  const practiceOpening = ref(false)
  const practiceOpenFailed = ref(false)
  let autoOpenedFor: string | null = null
  const helpKeys = new Map<string, string>()
  let practiceKey: string | null = null
  let practicePayload: string | null = null

  async function openPractice() {
    if (practice.value) return true
    if (!practiceOffered.value || practiceOpening.value || !options.isOnline.value) return false
    practiceOpening.value = true
    practiceOpenFailed.value = false
    try {
      const result = await openPracticeMutation.mutate(teachingReference)
      const opened = result?.status === 'available' && result.availability.practice.status === 'available' && result.practice !== null
      if (!opened) practiceOpenFailed.value = true
      return opened
    }
    catch {
      practiceOpenFailed.value = true
      return false
    }
    finally { practiceOpening.value = false }
  }

  watch([() => view.value.kind === 'receipt' ? view.value.receipt : null, () => availability.value?.practice.status, submissionId, options.isOnline], ([receipt, status, id, online]) => {
    if (receipt === 'saved' && status === 'not_opened' && id && online && canTeachSeparateCase.value && autoOpenedFor !== id) {
      autoOpenedFor = id
      void openPractice()
    }
  }, { flush: 'post', immediate: true })

  async function submitPractice() {
    const current = practice.value
    const text = practiceAnswer.value.trim()
    practiceMissing.value = text.length === 0
    if (!current || !text || practiceBusy.value || practiceSaved.value || !options.isOnline.value) return
    if (text !== practicePayload) {
      practiceKey = commandKey('adaptive-canvas-check-practice')
      practicePayload = text
    }
    practiceBusy.value = true
    practiceFailed.value = false
    try {
      const receipt = await acceptPracticeMutation.mutate({
        version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
        idempotencyKey: practiceKey!,
        response: { target: { responseSlotId: current.responseSlotId }, expectedRevision: current.revision, payload: { kind: 'text', text } },
      })
      if (receipt?.kind === 'accepted' || (receipt?.kind === 'rejected' && receipt.reasonCode === 'already_accepted')) practiceAcceptedHere.value = true
      else {
        practiceKey = null
        practicePayload = null
        practiceFailed.value = true
      }
    }
    catch { practiceFailed.value = true }
    finally { practiceBusy.value = false }
  }

  async function requestAssistance(kind: CanvasCheckHelpKind) {
    const current = practice.value
    if (!current || practiceBusy.value || !options.isOnline.value) return
    const helpKey = `${kind}:${current.revision}`
    const idempotencyKey = helpKeys.get(helpKey) ?? commandKey('adaptive-canvas-check-help')
    helpKeys.set(helpKey, idempotencyKey)
    practiceBusy.value = true
    assistanceDenied.value = false
    assistanceLimit.value = false
    try {
      const result = await authorizePracticeMutation.mutate({
        ...teachingReference,
        target: { responseSlotId: current.responseSlotId }, expectedRevision: current.revision, kind, idempotencyKey,
      })
      if (result?.status === 'authorized' && result.content.kind === kind) {
        cachedAssistance.value = { content: result.content, responseSlotId: current.responseSlotId, revision: current.revision }
      }
      else {
        helpKeys.delete(helpKey)
        if (result?.status === 'denied' && result.reasonCode === 'help_limit_reached') assistanceLimit.value = true
        else {
          if (result?.status === 'denied') cachedAssistance.value = null
          assistanceDenied.value = true
        }
      }
    }
    catch { assistanceDenied.value = true }
    finally { practiceBusy.value = false }
  }

  return {
    view, answer, confidence, answerMissing, confidenceMissing, submitFailure, startFailed, startRefused, busy, restored,
    canTeachSeparateCase, invalidBySource, feedback, feedbackPublishing, lesson, lessonUnavailable, practice, practiceOffered, help,
    practiceAnswer, practiceMissing, practiceBusy, practiceFailed, practiceSaved, practiceOpening, practiceOpenFailed,
    assistance, assistanceDenied, assistanceLimit,
    start, submit, retryScore, openPractice, submitPractice, requestAssistance,
  }
}
