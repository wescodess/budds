import type { Ref } from 'vue'
import type { LEARN_V2_PUBLIC_API_VERSION, LearnV2AssessmentDelivery, LearnV2AssessmentState, LearnV2ResponseState } from '~~/convex/lib/learnV2PublicContract'
import { learnV2CanvasMeasurementApi as checkApi } from '~~/convex/learnV2ApiAdapters'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, type LearnResponsePayload } from '~~/shared/learn-v2-responses'
import { useAdaptiveResponseDraft } from '~/composables/useAdaptiveResponseDraft'

const PUBLIC_API_VERSION: typeof LEARN_V2_PUBLIC_API_VERSION = 'learn-v2.public-api.v1'
const MAX_ANSWER_LENGTH = 12_000

export type CanvasCheckCitation = { sourceRef: string, label: string }
export type CanvasCheckLaterTeaching = {
  feedback?: { text: string, citations: CanvasCheckCitation[] } | null
  practice?: { responseSlotId: string, revision: number, prompt: string, hint?: string | null, workedExample?: string | null } | null
  lesson?: { paragraphs: string[], citations: CanvasCheckCitation[] } | null
}
export type CanvasCheckBinding = { assessmentOpportunityId: string, laterTeaching?: CanvasCheckLaterTeaching | null }
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

function commandKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function bodyText(work: AvailableWork | null) {
  return work?.body.bodyAvailability === 'available' && work.body.payload.kind === 'text' ? work.body.payload.text : null
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

export function useCanvasCheck(options: {
  ownerId: string
  threadId: string
  binding: CanvasCheckBinding
  isOnline: Readonly<Ref<boolean>>
}) {
  const assessmentOpportunityId = options.binding.assessmentOpportunityId as never
  const reference = { version: PUBLIC_API_VERSION, assessmentOpportunityId }
  const stateQuery = useSkippableConvexQuery(checkApi.getAssessmentState, () => import.meta.client ? reference : 'skip')
  const state = computed(() => stateQuery.data.value)
  const available = computed(() => state.value?.status === 'available' ? state.value : null)

  const local = shallowRef<LocalReceipt | null>(null)
  const submissionId = computed(() => available.value?.submissionId ?? local.value?.submissionId ?? null)
  const deliveryQuery = useSkippableConvexQuery(checkApi.getAssessment, () => import.meta.client && available.value?.phase === 'test_open' ? reference : 'skip')
  const workQuery = useSkippableConvexQuery(checkApi.getResponseState, () => import.meta.client && submissionId.value
    ? { version: PUBLIC_API_VERSION, target: { assessmentOpportunityId } }
    : 'skip')
  const work = computed(() => {
    const value = workQuery.data.value
    return value?.status === 'available' ? value.work : null
  })

  const grantMutation = import.meta.client ? useConvexMutation(checkApi.grantAssessmentDelivery) : { mutate: async () => undefined }
  const acceptMutation = import.meta.client ? useConvexMutation(checkApi.acceptMasterySubmission) : { mutate: async () => undefined }
  const acceptPracticeMutation = import.meta.client ? useConvexMutation(checkApi.acceptResponse) : { mutate: async () => undefined }
  const scoreAction = import.meta.client ? useConvexAction(checkApi.scoreMasterySubmission) : { mutate: async () => undefined }
  const authorizeMutation = import.meta.client ? useConvexMutation(checkApi.authorizeAssistance) : { mutate: async () => undefined }

  const answer = ref('')
  const confidence = ref<number | null>(null)
  const answerMissing = ref(false)
  const confidenceMissing = ref(false)
  const submitFailure = ref<SubmitFailure>(null)
  const startFailed = ref(false)
  const scoreFailed = ref(false)
  const busy = ref(false)

  let submitKey: string | null = null
  let submitPayload: string | null = null
  let startKey: string | null = null
  let scoreRequestedFor: string | null = null

  const view = computed<CanvasCheckView>(() => {
    if (state.value === null) return { kind: 'loading' }
    if (!available.value) return { kind: 'unavailable' }
    const { phase, capabilities } = available.value
    const receipt = (kind: CanvasCheckReceiptKind): CanvasCheckView => ({
      kind: 'receipt', receipt: kind,
      answer: bodyText(work.value) ?? local.value?.answer ?? null,
      acceptedAt: work.value?.acceptedAt ?? local.value?.acceptedAt ?? null,
    })
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
  const draftKey = `learn-response:${options.ownerId}:${options.threadId}:check:${options.binding.assessmentOpportunityId}`
  const { restored } = useAdaptiveResponseDraft(draftKey, answer, sealed, confidence)

  const canTeachSeparateCase = computed(() => available.value?.capabilities.canTeachSeparateCase === true)
  const invalidBySource = computed(() => {
    const current = work.value
    if (!current) return false
    return current.body.bodyAvailability !== 'available'
      || current.validitySnapshot.exclusionReasons.some(reason => reason === 'evidence_unavailable' || reason === 'pins_mismatch')
  })
  const feedback = computed(() => {
    const current = view.value
    return current.kind === 'receipt' && (current.receipt === 'passed' || current.receipt === 'not_yet')
      ? options.binding.laterTeaching?.feedback ?? null : null
  })
  const lesson = computed(() => {
    const current = view.value
    return current.kind === 'receipt' && current.receipt === 'not_yet' ? options.binding.laterTeaching?.lesson ?? null : null
  })
  const practice = computed(() => sealed.value && canTeachSeparateCase.value ? options.binding.laterTeaching?.practice ?? null : null)

  async function start() {
    const current = available.value
    if (!current || !current.capabilities.canDeliver || busy.value || !options.isOnline.value) return
    busy.value = true
    startFailed.value = false
    startKey ??= commandKey('adaptive-canvas-check-start')
    try {
      const result = await grantMutation.mutate({ ...reference, expectedRevision: current.revision, idempotencyKey: startKey })
      if (result?.status !== 'granted') {
        startKey = null
        startFailed.value = true
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

  const practiceAnswer = ref('')
  const practiceBusy = ref(false)
  const practiceFailed = ref(false)
  const practiceSaved = ref(false)
  const assistanceText = ref<string | null>(null)
  const assistanceDenied = ref(false)
  let practiceKey: string | null = null
  let practicePayload: string | null = null

  async function submitPractice() {
    const current = practice.value
    const text = practiceAnswer.value.trim()
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
        response: { target: { responseSlotId: current.responseSlotId as never }, expectedRevision: current.revision, payload: { kind: 'text', text } },
      })
      if (receipt?.kind === 'accepted') practiceSaved.value = true
      else {
        practiceKey = null
        practicePayload = null
        practiceFailed.value = true
      }
    }
    catch { practiceFailed.value = true }
    finally { practiceBusy.value = false }
  }

  async function requestAssistance(kind: 'hint' | 'reveal') {
    const current = practice.value
    if (!current || practiceBusy.value || !options.isOnline.value) return
    practiceBusy.value = true
    assistanceDenied.value = false
    try {
      const result = await authorizeMutation.mutate({ ...reference, kind, idempotencyKey: commandKey('adaptive-canvas-check-help') })
      if (result?.status === 'authorized') assistanceText.value = kind === 'hint' ? current.hint ?? null : current.workedExample ?? null
      else assistanceDenied.value = true
    }
    catch { assistanceDenied.value = true }
    finally { practiceBusy.value = false }
  }

  return {
    view, answer, confidence, answerMissing, confidenceMissing, submitFailure, startFailed, busy, restored,
    canTeachSeparateCase, invalidBySource, feedback, lesson, practice,
    practiceAnswer, practiceBusy, practiceFailed, practiceSaved, assistanceText, assistanceDenied,
    start, submit, retryScore, submitPractice, requestAssistance,
  }
}
