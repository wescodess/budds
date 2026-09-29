<script setup lang="ts">
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'
import { useAdaptiveResponseDraft } from '~/composables/useAdaptiveResponseDraft'
import { useAdaptiveComparisonDraft } from '~/composables/useAdaptiveComparisonDraft'
import type { AdaptiveFixedNextPlan, AdaptiveOverrideOption } from '~~/shared/learn-adaptive-controls'
import { adaptiveActivityFallbackForReason, type AdaptiveActivityValidationReason, type ValidatedAdaptiveActivityPrimitive } from '~~/shared/learn-adaptive-activity-registry'
import { resolveAdaptiveActivityRenderer } from '~~/shared/learn-adaptive-renderer-contract'
import { decodeSourceComparisonResponse, encodeSourceComparisonResponse, sourceComparisonResponseFitsLimit } from '~~/shared/learn-adaptive-source-comparison-response'

type Canvas = {
  ownerId: string
  status: string
  thread: { id: string, outcome: string, intent: string, revision: number }
  activity: {
    id: string, status: string, purpose: string, reasonCode: string, planRevision?: number, draftKind?: 'source_comparison' | null
    evidenceScope?: { version: string, integrityState: string, sourceRefs: string[] }
    controls?: { reasonText: { version: string, purpose: string, text: string }, selected: AdaptiveOverrideOption | null, fixedNextPlan: AdaptiveFixedNextPlan | null,
      options: Array<{ key: AdaptiveOverrideOption, label: string, available: boolean, unavailableReason: 'evidence' | 'mastery' | 'state' | 'policy' | null }> }
    primitive: { contractVersion?: string, rendererVersion?: string, type: string, action: string, testId: string, props: unknown } | null
    fallback: { title: string, body: string, testId: string, primaryAction: { label: string } }
    requiredAction: { kind: string, label: string }
  }
  session: { studySessionId: string, revision: number, contentRevision: number, planRecordRevision: number, blueprintRecordRevision: number, scheduledStartAt: number, scheduledEndAt: number | null, timezone: string }
  responsePrompt: string | null
  recoveryState?: string | null
  recoveryEvidenceIssue?: 'conflict' | 'gap' | null
  recovery?: { title: string, body: string, action: string } | null
  savedResponse?: { response: string, confidence: number } | null
}

type ReadyPrimitive = Extract<ValidatedAdaptiveActivityPrimitive, { type: 'cited_explanation' | 'worked_example' | 'source_comparison' | 'independent_application' }>
function readyPrimitiveForCanvas(primitive: ValidatedAdaptiveActivityPrimitive): ReadyPrimitive | null {
  switch (primitive.type) {
    case 'cited_explanation':
    case 'worked_example':
    case 'source_comparison':
    case 'independent_application': return primitive
    case 'diagnostic_prompt':
    case 'artifact_workspace':
    case 'reflection_next_move': return null
    default: {
      const missing: never = primitive
      throw new Error(`No Ready Canvas branch for ${String(missing)}`)
    }
  }
}

const props = withDefaults(defineProps<{ canvas: Canvas, authoritativeRevision?: number, showHeader?: boolean, active?: boolean }>(), { showHeader: true, active: true })
const emit = defineEmits<{ leave: [], inspectEvidence: [origin: HTMLButtonElement] }>()
const { isOnline } = useOnlineStatus()
const startMutation = import.meta.client ? useConvexMutation(api.learnV2SessionContent.startStudySession) : { mutate: async () => ({}) }
const assistanceMutation = import.meta.client ? useConvexMutation(api.learnV2Mastery.recordAssistanceUse) : { mutate: async () => ({}) }
const stageMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.submitCanvasResponse) : { mutate: async () => ({}) }
const meaningfulStartMutation = import.meta.client ? useConvexMutation(api.learnV2SessionContent.recordMeaningfulActivityStarted) : { mutate: async () => ({}) }
const reportRenderFailureMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.reportRenderFailure) : { mutate: async () => ({}) }
const submitAction = import.meta.client ? useConvexAction(api.learnAdaptive.submitResponse) : { mutate: async () => ({}) }

const sessionRevision = ref(props.canvas.session.revision)
const threadRevision = ref(Math.max(props.canvas.thread.revision, props.authoritativeRevision ?? 0))
const started = ref(['started', 'submitted', 'scoring', 'reconciling', 'feedback'].includes(props.canvas.status))
const responseStep = ref(['source_comparison', 'independent_application'].includes(props.canvas.activity.primitive?.type ?? '') || ['submitted', 'scoring', 'reconciling', 'feedback'].includes(props.canvas.status))
const exampleRevealed = ref(props.canvas.activity.primitive?.type !== 'worked_example' || ['submitted', 'scoring', 'reconciling', 'feedback'].includes(props.canvas.status))
const exampleRevealPending = ref(false)
const exampleStepsHeading = ref<HTMLElement | null>(null)
const responseHeading = ref<HTMLElement | null>(null)
const comparisonHeading = ref<HTMLElement | null>(null)
const response = ref(props.canvas.savedResponse?.response ?? '')
const comparisonDraftKey = computed(() => {
  const activity = props.canvas.activity
  if ((activity.draftKind ?? (activity.primitive?.type === 'source_comparison' ? 'source_comparison' : null)) !== 'source_comparison') return null
  if (!Number.isSafeInteger(activity.planRevision) || !activity.planRevision || activity.planRevision < 1) return null
  return `learn-comparison:${props.canvas.ownerId}:${props.canvas.thread.id}:${activity.id}:plan:${activity.planRevision}`
})
const comparisonChoice = ref(decodeSourceComparisonResponse(response.value, undefined, true)?.sourceRef ?? '')
const comparisonRationale = ref(decodeSourceComparisonResponse(response.value, undefined, true)?.rationale ?? '')
const comparisonChoiceGroup = ref<HTMLElement | null>(null)
const comparisonRationaleField = ref<HTMLTextAreaElement | null>(null)
let locallyEncodedComparisonDraft = ''
watch([comparisonChoice, comparisonRationale], ([sourceRef, rationale]) => {
  if (comparisonDraftKey.value && !staged.value) {
    locallyEncodedComparisonDraft = sourceRef || rationale ? encodeSourceComparisonResponse(sourceRef, rationale) : ''
    response.value = locallyEncodedComparisonDraft
  }
})
watch(response, (value) => {
  if (!comparisonDraftKey.value || value === locallyEncodedComparisonDraft) return
  const parsed = decodeSourceComparisonResponse(value, undefined, true)
  if ((parsed?.sourceRef ?? '') !== comparisonChoice.value) comparisonChoice.value = parsed?.sourceRef ?? ''
  if ((parsed?.rationale ?? '') !== comparisonRationale.value) comparisonRationale.value = parsed?.rationale ?? ''
})
const confidence = ref<number | null>(props.canvas.savedResponse?.confidence ?? null)
const authoritativeSavedResponse = ref(props.canvas.savedResponse ? { ...props.canvas.savedResponse } : null)
const assistanceText = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref('')
const scoreState = ref<'idle' | 'pending' | 'complete' | 'unconfirmed' | 'reconciling' | 'blocked'>('idle')
const staged = ref(!!props.canvas.savedResponse || props.canvas.status === 'submitted' || props.canvas.status === 'scoring' || props.canvas.status === 'reconciling' || props.canvas.status === 'feedback')
useAdaptiveResponseDraft(comparisonDraftKey.value ? null : `learn-response:${props.canvas.ownerId}:${props.canvas.thread.id}:${props.canvas.activity.id}`, response, staged, confidence)
useAdaptiveComparisonDraft(comparisonDraftKey, comparisonChoice, comparisonRationale, staged)
const startKey = ref<string | null>(null)
const stageKey = ref<string | null>(null)
const scoreKey = ref<string | null>(null)
const meaningfulStartRecorded = ref(false)
const meaningfulStartPending = ref(false)
const meaningfulStartRetryTick = ref(0)
const meaningfulStartAction = ref<HTMLButtonElement | null>(null)
let meaningfulStartAttempts = 0
let meaningfulStartRetryTimer: ReturnType<typeof setTimeout> | undefined
let meaningfulStartDisposed = false
let meaningfulStartOperableSeen = false

watch(() => props.canvas.session.revision, value => { sessionRevision.value = Math.max(sessionRevision.value, value) })
watch([() => props.canvas.thread.revision, () => props.authoritativeRevision], ([canvasRevision, authoritativeRevision]) => {
  threadRevision.value = Math.max(threadRevision.value, canvasRevision, authoritativeRevision ?? 0)
})
watch(() => props.canvas.status, value => {
  if (value === 'started') { started.value = true; if (['source_comparison', 'independent_application'].includes(props.canvas.activity.primitive?.type ?? '')) responseStep.value = true }
  if (['submitted', 'scoring', 'reconciling', 'feedback'].includes(value)) { started.value = true; staged.value = true; responseStep.value = true }
  if (value === 'reconciling') scoreState.value = 'reconciling'
  if (value === 'feedback') scoreState.value = 'complete'
  if (['submitted', 'scoring', 'reconciling', 'feedback'].includes(value)) exampleRevealed.value = true
})
watch([
  () => props.canvas.activity.id,
  () => props.canvas.activity.primitive?.type,
  () => props.canvas.activity.primitive?.action,
], () => {
  exampleRevealed.value = props.canvas.activity.primitive?.type !== 'worked_example' || responseStep.value
  if (['source_comparison', 'independent_application'].includes(props.canvas.activity.primitive?.type ?? '')) responseStep.value = true
})
watch(() => props.canvas.savedResponse, (saved) => {
  if (!saved) return
  const snapshot = { response: saved.response, confidence: saved.confidence }
  authoritativeSavedResponse.value = snapshot
  response.value = snapshot.response
  confidence.value = snapshot.confidence
  staged.value = true
}, { deep: true })

function scheduleMeaningfulStartRetry() {
  const delays = [50, 250, 1_000] as const
  if (meaningfulStartDisposed || meaningfulStartRetryTimer || meaningfulStartAttempts >= delays.length) return
  const delay = delays[meaningfulStartAttempts++]!
  meaningfulStartRetryTimer = setTimeout(() => {
    meaningfulStartRetryTimer = undefined
    meaningfulStartRetryTick.value += 1
  }, delay)
}

onBeforeUnmount(() => {
  meaningfulStartDisposed = true
  if (meaningfulStartRetryTimer) clearTimeout(meaningfulStartRetryTimer)
})

watch([started, responseStep, exampleRevealed, isOnline, busy, meaningfulStartRetryTick, () => props.active], async ([hasStarted, showingResponse, , online, , , visible]) => {
  if (!visible || !hasStarted || !online || meaningfulStartRecorded.value || meaningfulStartPending.value) return
  meaningfulStartPending.value = true
  try {
    await nextTick()
    if (!meaningfulStartOperableSeen) {
      if ((showingResponse && !['source_comparison', 'independent_application'].includes(renderedPrimitive.value?.type ?? '')) || !renderedPrimitive.value || !props.canvas.responsePrompt || !meaningfulStartAction.value || meaningfulStartAction.value.disabled
        || meaningfulStartAction.value.textContent?.trim() !== props.canvas.activity.requiredAction.label) {
        scheduleMeaningfulStartRetry()
        return
      }
      meaningfulStartOperableSeen = true
    }
    await meaningfulStartMutation.mutate({
      studySessionId: props.canvas.session.studySessionId as never,
      expectedContentRevision: props.canvas.session.contentRevision,
    })
    meaningfulStartRecorded.value = true
  }
  catch {
    // First-value telemetry is intentionally non-blocking. Bounded retries use
    // the server's semantic-key dedupe, while the rendered activity stays usable.
    scheduleMeaningfulStartRetry()
  }
  finally { meaningfulStartPending.value = false }
}, { flush: 'post', immediate: true })

function key(prefix: string) { return `${prefix}:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
const renderValidation = computed(() => {
  if (props.canvas.status === 'blocked') return { reason: null, primitive: null }
  const primitive = props.canvas.activity.primitive
  const scope = props.canvas.activity.evidenceScope
  if (!primitive || !scope || scope.version !== 'learn-adaptive.canvas-evidence-scope.v1'
    || scope.integrityState !== 'accepted' || !Array.isArray(scope.sourceRefs)
    || scope.sourceRefs.length < 1 || scope.sourceRefs.length > 16
    || new Set(scope.sourceRefs).size !== scope.sourceRefs.length) {
    return { reason: 'invalid_evidence_link' as const, primitive: null }
  }
  const context = Object.fromEntries(scope.sourceRefs.map(sourceRef => [sourceRef, { integrityState: 'accepted' as const }]))
  let inputProps = primitive.props
  if (primitive.type === 'source_comparison') {
    const raw = primitive.props as { prompt?: unknown, sources?: unknown }
    if (!raw || typeof raw !== 'object' || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'prompt')
      || !Object.hasOwn(raw, 'sources') || !Array.isArray(raw.sources) || raw.sources.length !== 2) return { reason: 'invalid_props' as const, primitive: null }
    const sources = raw.sources.map((source: unknown) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return null
      const value = source as Record<string, unknown>
      if (Object.keys(value).length !== 4 || value.integrityState !== 'accepted'
        || typeof value.sourceRef !== 'string' || !scope.sourceRefs.includes(value.sourceRef)) return null
      return { sourceRef: value.sourceRef, label: value.label, summary: value.summary }
    })
    if (sources.includes(null)) return { reason: 'invalid_evidence_link' as const, primitive: null }
    inputProps = { prompt: raw.prompt, sources }
  }
  const validated = resolveAdaptiveActivityRenderer({ ...primitive, props: inputProps }, 'ready_session', context)
  if (!validated.ok) return { reason: validated.reason, primitive: null }
  const readyPrimitive = readyPrimitiveForCanvas(validated.value)
  if (!readyPrimitive) return { reason: 'renderer_unavailable' as const, primitive: null }
  if (readyPrimitive.type === 'cited_explanation' && readyPrimitive.action !== 'continue'
    || readyPrimitive.type === 'independent_application' && readyPrimitive.action !== 'submit_response'
    || props.canvas.activity.requiredAction.kind !== readyPrimitive.action
    || props.canvas.activity.requiredAction.label !== (readyPrimitive.type === 'source_comparison' ? (readyPrimitive.action === 'choose_source' ? 'Choose source' : 'Submit comparison') : readyPrimitive.type === 'independent_application' ? 'Submit response' : readyPrimitive.action === 'reveal_example' ? 'Reveal example' : 'Continue')) return { reason: 'unsupported_action' as const, primitive: null }
  const prompt = props.canvas.responsePrompt
  if (typeof prompt !== 'string' || !prompt.trim()) return { reason: 'invalid_props' as const, primitive: null }
  if (readyPrimitive.type === 'independent_application' && readyPrimitive.props.prompt !== prompt.trim()) return { reason: 'invalid_props' as const, primitive: null }
  if (prompt.length > 4_000) return { reason: 'oversized_prop' as const, primitive: null }
  if (/\b(?:javascript|vbscript|file)\s*:|\bdata\s*:\s*text\/html/iu.test(prompt)) return { reason: 'unsafe_url' as const, primitive: null }
  if (/<\/?[a-z][^>]*>|\bon[a-z]+\s*=/iu.test(prompt)) return { reason: 'executable_content' as const, primitive: null }
  return { reason: null, primitive: readyPrimitive }
})
const renderFailureCode = computed<AdaptiveActivityValidationReason | null>(() => renderValidation.value.reason)
const renderedPrimitive = computed(() => renderValidation.value.primitive)
const citedExplanation = computed(() => renderedPrimitive.value?.type === 'cited_explanation' ? renderedPrimitive.value : null)
const workedExample = computed(() => renderedPrimitive.value?.type === 'worked_example' ? renderedPrimitive.value : null)
const sourceComparison = computed(() => renderedPrimitive.value?.type === 'source_comparison' ? renderedPrimitive.value : null)
const independentApplication = computed(() => renderedPrimitive.value?.type === 'independent_application' ? renderedPrimitive.value : null)
async function recordWorkedExampleGuidance() {
  if (!workedExample.value || !started.value || staged.value || exampleRevealed.value || exampleRevealPending.value || !isOnline.value) return false
  exampleRevealPending.value = true
  error.value = null
  try {
    const result = await assistanceMutation.mutate({ studySessionId: props.canvas.session.studySessionId as never, expectedSessionRevision: sessionRevision.value, kind: 'answer_reveal' }) as { revision: number }
    sessionRevision.value = Math.max(sessionRevision.value, result.revision)
    exampleRevealed.value = true
    notice.value = 'Worked example revealed and recorded as guided support, not an independent attempt.'
    return true
  }
  catch {
    error.value = 'Could not record guided support. The worked steps remain hidden; try again.'
    return false
  }
  finally { exampleRevealPending.value = false }
}
async function revealExample() {
  if (!await recordWorkedExampleGuidance()) return
  await nextTick()
  exampleStepsHeading.value?.focus()
}
watch([started, workedExample, isOnline, () => props.active], ([hasStarted, example, online, active]) => {
  if (hasStarted && example?.action === 'continue' && online && active && !exampleRevealed.value) void recordWorkedExampleGuidance()
}, { immediate: true })
async function continueActivity() {
  responseStep.value = true
  await nextTick()
  responseHeading.value?.focus()
}
function inspectEvidence(event: MouseEvent) {
  if (event.currentTarget instanceof HTMLButtonElement) emit('inspectEvidence', event.currentTarget)
}
const renderFallback = computed(() => renderFailureCode.value ? adaptiveActivityFallbackForReason(renderFailureCode.value) : null)
const fallbackAction = ref<HTMLButtonElement | null>(null)
onMounted(() => {
  if (props.active && (renderFailureCode.value || (props.canvas.status === 'blocked' && props.canvas.recoveryState !== 'preparing'))) fallbackAction.value?.focus()
})
watch([renderFailureCode, () => props.canvas.status, () => props.canvas.recoveryState, () => props.active], async ([reasonCode, status, recoveryState, active]) => {
  if (!active || (!reasonCode && (status !== 'blocked' || recoveryState === 'preparing'))) return
  await nextTick()
  fallbackAction.value?.focus()
})
const reportedRenderFailures = new Set<string>()
const renderReportAttempts = new Map<string, number>()
const renderReportTimers = new Map<string, ReturnType<typeof setTimeout>>()
const renderReportsInFlight = new Set<string>()
let renderReportsDisposed = false
onBeforeUnmount(() => {
  renderReportsDisposed = true
  for (const timer of renderReportTimers.values()) clearTimeout(timer)
  renderReportTimers.clear()
})
async function reportCanvasFailure(reasonCode: AdaptiveActivityValidationReason, activityId: string, planRevision: number) {
  const semanticKey = `${activityId}:${planRevision}:${reasonCode}`
  if (renderReportsDisposed || !isOnline.value || renderFailureCode.value !== reasonCode
    || props.canvas.activity.id !== activityId || props.canvas.activity.planRevision !== planRevision
    || reportedRenderFailures.has(semanticKey) || renderReportsInFlight.has(semanticKey) || renderReportTimers.has(semanticKey)) return
  const attempt = (renderReportAttempts.get(semanticKey) ?? 0) + 1
  if (attempt > 3) return
  renderReportAttempts.set(semanticKey, attempt)
  renderReportsInFlight.add(semanticKey)
  try {
    await reportRenderFailureMutation.mutate({ threadId: props.canvas.thread.id as never, activityId, expectedPlanRevision: planRevision, reasonCode })
    reportedRenderFailures.add(semanticKey)
  }
  catch {
    if (!renderReportsDisposed && attempt < 3) {
      const timer = setTimeout(() => {
        renderReportTimers.delete(semanticKey)
        void reportCanvasFailure(reasonCode, activityId, planRevision)
      }, [100, 500][attempt - 1])
      renderReportTimers.set(semanticKey, timer)
    }
  }
  finally { renderReportsInFlight.delete(semanticKey) }
}
watch([renderFailureCode, isOnline, () => props.canvas.activity.id, () => props.canvas.activity.planRevision], ([reasonCode, online, activityId, planRevision], previous) => {
  if (!online) {
    for (const timer of renderReportTimers.values()) clearTimeout(timer)
    renderReportTimers.clear()
    return
  }
  if (previous?.[1] === false) {
    renderReportAttempts.clear()
    for (const timer of renderReportTimers.values()) clearTimeout(timer)
    renderReportTimers.clear()
  }
  if (!reasonCode || !Number.isSafeInteger(planRevision) || !planRevision || planRevision < 1) return
  void reportCanvasFailure(reasonCode, activityId, planRevision)
}, { immediate: true })
const canSubmit = computed(() => isOnline.value && !busy.value && !staged.value && response.value.trim().length > 0 && response.value.length <= 12_000 && confidence.value !== null
  && (!sourceComparison.value || sourceComparison.value.props.sources.some(source => source.sourceRef === comparisonChoice.value) && comparisonRationale.value.trim().length > 0))
async function start() {
  if (!isOnline.value || busy.value || started.value || props.canvas.status !== 'ready') return
  busy.value = true; error.value = null
  startKey.value ??= key('adaptive-canvas-start')
  try {
    const dispatchedRevision = sessionRevision.value
    await startMutation.mutate({ studySessionId: props.canvas.session.studySessionId as never, expectedSessionRevision: dispatchedRevision, expectedContentRevision: props.canvas.session.contentRevision, idempotencyKey: startKey.value })
    sessionRevision.value = Math.max(sessionRevision.value, dispatchedRevision + 1)
    started.value = true
    notice.value = sourceComparison.value ? 'Session started. Compare the two supported sources.' : independentApplication.value ? 'Session started. Apply the evidence independently.' : workedExample.value ? 'Session started. Review the guided example.' : 'Session started. Read the supported explanation.'
    if (sourceComparison.value) {
      await nextTick()
      comparisonHeading.value?.focus()
    }
    else if (independentApplication.value) {
      await nextTick()
      responseHeading.value?.focus()
    }
  }
  catch (cause) { error.value = getErrorMessage(cause, 'Could not start this session. Try again.') }
  finally { busy.value = false }
}

async function assistance(kind: 'substantive_hint' | 'answer_reveal') {
  if (!isOnline.value || busy.value || !started.value || staged.value) return
  busy.value = true; error.value = null
  try {
    const result = await assistanceMutation.mutate({ studySessionId: props.canvas.session.studySessionId as never, expectedSessionRevision: sessionRevision.value, kind }) as { revision: number, assistance: { content: string } }
    sessionRevision.value = Math.max(sessionRevision.value, result.revision)
    assistanceText.value = result.assistance.content
    notice.value = kind === 'substantive_hint' ? 'Hint added.' : 'Worked example revealed.'
  }
  catch (cause) { error.value = getErrorMessage(cause, 'Could not load support. Try again.') }
  finally { busy.value = false }
}

async function score(snapshot = authoritativeSavedResponse.value) {
  if (!isOnline.value || busy.value || !staged.value || ['complete', 'reconciling', 'blocked'].includes(scoreState.value) || props.canvas.status === 'reconciling' || !snapshot) return
  const scoringSnapshot = { response: snapshot.response, confidence: snapshot.confidence }
  busy.value = true; error.value = null
  scoreKey.value ??= `adaptive-canvas-score:${props.canvas.activity.id}`
  try {
    const result = await submitAction.mutate({
      threadId: props.canvas.thread.id as never, activityId: props.canvas.activity.id,
      studySessionId: props.canvas.session.studySessionId as never,
      expectedSessionRevision: sessionRevision.value, expectedContentRevision: props.canvas.session.contentRevision,
      expectedPlanRecordRevision: props.canvas.session.planRecordRevision,
      expectedBlueprintRecordRevision: props.canvas.session.blueprintRecordRevision,
      response: scoringSnapshot.response, confidence: scoringSnapshot.confidence, idempotencyKey: scoreKey.value,
    }) as { kind: string, status?: string, code?: string, retryable?: boolean }
    if (result.kind !== 'accepted') {
      if (result.code === 'provider_outcome_requires_reconciliation') {
        scoreState.value = 'reconciling'
        notice.value = 'Scoring needs reconciliation. Your response remains saved.'
      }
      else if (result.retryable) {
        scoreState.value = 'unconfirmed'
        error.value = 'Scoring did not confirm. Your response is saved. Retry scoring to check the outcome.'
      }
      else {
        scoreState.value = 'blocked'
        error.value = 'Scoring is unavailable for this response. Your response is saved. Return to Learn for the next safe step.'
      }
      return
    }
    scoreState.value = result.status === 'completed' ? 'complete' : 'pending'
    notice.value = result.status === 'completed' ? 'Response scored.' : 'Scoring is in progress.'
  }
  catch { scoreState.value = 'unconfirmed'; error.value = 'Scoring did not confirm. Your response is saved. Retry scoring to check the outcome.' }
  finally { busy.value = false }
}

async function submit() {
  if (!canSubmit.value) return
  const submissionSnapshot = { response: response.value.trim(), confidence: confidence.value as number }
  let stageSucceeded = false
  busy.value = true; error.value = null
  stageKey.value ??= key('adaptive-canvas-submit')
  try {
    const result = await stageMutation.mutate({
      threadId: props.canvas.thread.id as never, activityId: props.canvas.activity.id,
      studySessionId: props.canvas.session.studySessionId as never,
      expectedSessionRevision: sessionRevision.value, expectedRevision: threadRevision.value,
      response: submissionSnapshot.response, confidence: submissionSnapshot.confidence, idempotencyKey: stageKey.value,
    }) as { kind: string, revision?: number }
    if (result.kind !== 'ok') throw new Error('This Canvas changed in another session. Refresh before retrying.')
    threadRevision.value = result.revision ?? threadRevision.value + 1
    authoritativeSavedResponse.value = submissionSnapshot
    response.value = submissionSnapshot.response
    confidence.value = submissionSnapshot.confidence
    staged.value = true
    stageSucceeded = true
  }
  catch { error.value = 'Submission did not confirm. Your draft remains here. Retry submission to reconcile it.' }
  finally { busy.value = false }
  if (stageSucceeded) await score(submissionSnapshot)
}

async function submitWithValidation() {
  if (sourceComparison.value && !staged.value && isOnline.value && !busy.value) {
    if (!sourceComparison.value.props.sources.some(source => source.sourceRef === comparisonChoice.value)) {
      error.value = 'Choose one of the two sources before submitting.'
      comparisonChoiceGroup.value?.focus()
      return
    }
    if (!comparisonRationale.value.trim()) {
      error.value = 'Explain why you chose that source before submitting.'
      comparisonRationaleField.value?.focus()
      return
    }
    if (confidence.value === null) {
      error.value = 'Choose your confidence before submitting.'
      return
    }
    const candidate = encodeSourceComparisonResponse(comparisonChoice.value, comparisonRationale.value)
    if (!sourceComparisonResponseFitsLimit(candidate)) {
      error.value = 'This comparison exceeds 12 KB. Shorten your rationale before submitting.'
      comparisonRationaleField.value?.focus()
      return
    }
    response.value = candidate
  }
  await submit()
}
</script>

<template>
  <section class="w-full" data-testid="learn-adaptive-canvas" :aria-labelledby="showHeader ? 'learn-canvas-title' : undefined" :aria-label="showHeader ? undefined : 'Current activity'">
    <p v-if="showHeader" class="text-xs font-medium uppercase tracking-wide text-primary">Learning thread · {{ canvas.thread.intent }}</p>
    <h1 v-if="showHeader" id="learn-canvas-title" class="mt-2 font-dm-sans text-3xl font-bold">{{ canvas.thread.outcome }}</h1>
    <p class="mt-2 text-sm text-muted-foreground">{{ canvas.activity.purpose }}</p>
    <LearnAdaptiveWhyControls v-if="canvas.activity.controls" :controls="canvas.activity.controls" :thread-id="canvas.thread.id" :activity-id="canvas.activity.id" :revision="threadRevision" @revision="threadRevision = $event" />
    <p class="sr-only" aria-live="polite">{{ notice }}</p>
    <p v-if="!isOnline" role="status" class="mt-4 rounded-lg border border-amber-500/40 p-3 text-sm">A connection is required to start, get support, or submit a response.</p>
    <p v-if="error" role="alert" data-testid="learn-canvas-error" class="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{{ error }}</p>

    <div v-if="canvas.status === 'blocked' || !renderedPrimitive || !canvas.responsePrompt" :data-testid="renderFallback?.testId ?? canvas.activity.fallback.testId" :role="canvas.recoveryState === 'preparing' ? 'status' : 'alert'" class="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 class="font-dm-sans text-lg font-semibold">{{ renderFallback?.title ?? canvas.recovery?.title ?? canvas.activity.fallback.title }}</h2>
      <p class="mt-2 text-sm text-muted-foreground">{{ renderFallback?.body ?? canvas.recovery?.body ?? canvas.activity.fallback.body }}</p>
      <p v-if="canvas.status === 'blocked' && canvas.recoveryEvidenceIssue" data-testid="learn-canvas-evidence-issue" class="mt-2 text-sm" role="status">{{ canvas.recoveryEvidenceIssue === 'conflict' ? 'An unresolved source conflict blocks this activity.' : 'An evidence gap blocks this activity.' }} Review the source in Learn before continuing.</p>
      <div v-if="authoritativeSavedResponse" data-testid="learn-canvas-saved-fallback" class="mt-4 rounded-lg border border-border p-3 text-sm">
        <p role="status">Your response is saved. This activity must become available before scoring can continue.</p>
      </div>
      <p v-if="response && !authoritativeSavedResponse" data-testid="learn-canvas-draft-fallback" class="mt-3 text-sm">Your unfinished response remains on this device.</p>
      <button ref="fallbackAction" type="button" data-testid="learn-canvas-fallback-action" class="learn-adaptive-recovery-action mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="emit('leave')">{{ renderFallback?.primaryAction.label ?? canvas.recovery?.action ?? canvas.activity.fallback.primaryAction.label }}</button>
    </div>
    <div v-else-if="!started" data-testid="learn-canvas-ready" class="mt-6 rounded-xl border border-border bg-card p-5">
      <article :data-testid="`${renderedPrimitive.testId}-ready`" aria-label="Activity ready">
        <h2 class="font-dm-sans text-xl font-semibold">{{ renderedPrimitive.type === 'source_comparison' ? 'Compare two sources' : renderedPrimitive.type === 'independent_application' ? 'Apply it independently' : renderedPrimitive.props.heading }}</h2>
        <p v-if="renderedPrimitive.type === 'cited_explanation'" class="mt-2 text-sm text-muted-foreground">A cited explanation supported by {{ renderedPrimitive.props.sourceRefs.length }} accepted {{ renderedPrimitive.props.sourceRefs.length === 1 ? 'source is' : 'sources are' }} ready.</p>
        <p v-else-if="renderedPrimitive.type === 'source_comparison'" class="mt-2 whitespace-pre-wrap break-words text-sm">{{ renderedPrimitive.props.prompt }} Two accepted sources are ready for comparison.</p>
        <p v-else-if="renderedPrimitive.type === 'independent_application'" class="mt-2 whitespace-pre-wrap break-words text-sm">{{ renderedPrimitive.props.prompt }} Your response will be evaluated by the server after submission.</p>
        <template v-else>
          <p class="mt-2 whitespace-pre-wrap break-words text-sm">{{ renderedPrimitive.props.problem }}</p>
          <p data-testid="learn-canvas-ready-guided-consequence" class="mt-3 rounded-lg border border-border bg-muted p-3 text-sm">Guided support: {{ renderedPrimitive.props.guidedConsequence }} The steps remain hidden until the session starts; viewing them is recorded as guided support.</p>
        </template>
      </article>
      <button type="button" data-testid="learn-canvas-start" :disabled="busy || !isOnline" class="mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" @click="start">{{ busy ? 'Starting…' : 'Start' }}</button>
    </div>
    <div v-else class="mt-6 space-y-5">
      <article v-if="citedExplanation" :data-testid="citedExplanation.testId" class="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 class="font-dm-sans text-xl font-semibold">{{ citedExplanation.props.heading }}</h2>
        <p class="mt-3 whitespace-pre-wrap break-words leading-7">{{ citedExplanation.props.explanation }}</p>
        <p data-testid="learn-canvas-explanation-citations" class="mt-3 text-xs text-muted-foreground">This explanation cites {{ citedExplanation.props.sourceRefs.length }} accepted {{ citedExplanation.props.sourceRefs.length === 1 ? 'source' : 'sources' }}.</p>
        <div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Explanation evidence">
          <button v-for="(_, index) in citedExplanation.props.sourceRefs" :key="index" type="button" :data-testid="`learn-canvas-source-${index + 1}`" :aria-label="`Open Evidence for explanation source ${index + 1}`" class="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-[var(--learn-action)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="inspectEvidence">Source {{ index + 1 }} · Evidence</button>
        </div>
        <p data-testid="learn-canvas-evidence-scope" class="mt-2 text-xs text-muted-foreground">Activity scope: {{ canvas.activity.evidenceScope?.sourceRefs.length ?? 0 }} accepted {{ canvas.activity.evidenceScope?.sourceRefs.length === 1 ? 'source' : 'sources' }}. Inspect sources in the Evidence drawer.</p>
      </article>
      <article v-if="workedExample" :data-testid="workedExample.testId" class="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 class="font-dm-sans text-xl font-semibold">{{ workedExample.props.heading }}</h2>
        <p class="mt-3 whitespace-pre-wrap break-words leading-7">{{ workedExample.props.problem }}</p>
        <p class="mt-3 rounded-lg border border-border bg-muted p-3 text-sm" data-testid="learn-canvas-guided-consequence">Guided support: {{ workedExample.props.guidedConsequence }} This example does not count as an independent attempt or mastery.</p>
        <section v-if="exampleRevealed" class="mt-4" aria-label="Worked example steps">
          <h3 ref="exampleStepsHeading" tabindex="-1" class="font-semibold focus:outline-none">Worked steps</h3>
          <ol class="mt-2 list-decimal space-y-2 pl-5 leading-7"><li v-for="(step, index) in workedExample.props.steps" :key="index" class="whitespace-pre-wrap break-words">{{ step }}</li></ol>
        </section>
        <p v-if="exampleRevealed && !responseStep" data-testid="learn-canvas-worked-status" role="status" class="mt-3 text-sm">Guided support reviewed. It is not an independent attempt or proof of mastery.</p>
        <div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Worked example evidence">
          <button v-for="(_, index) in workedExample.props.sourceRefs" :key="index" type="button" :data-testid="`learn-canvas-source-${index + 1}`" :aria-label="`Open Evidence for worked example source ${index + 1}`" class="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-[var(--learn-action)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="inspectEvidence">Source {{ index + 1 }} · Evidence</button>
        </div>
      </article>
      <article v-if="sourceComparison" :data-testid="sourceComparison.testId" class="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Source comparison">
        <h2 ref="comparisonHeading" tabindex="-1" data-testid="learn-canvas-comparison-heading" class="font-dm-sans text-xl font-semibold focus:outline-none">Compare two sources</h2>
        <p class="mt-2 whitespace-pre-wrap break-words">{{ sourceComparison.props.prompt }}</p>
        <fieldset ref="comparisonChoiceGroup" tabindex="-1" class="mt-4 rounded-lg focus:outline-none"><legend class="text-sm font-medium">Choose the source that better supports the claim</legend>
          <div class="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
            <div v-for="(source, index) in sourceComparison.props.sources" :key="source.sourceRef" :data-testid="`learn-canvas-comparison-source-${index + 1}`" class="min-w-0 rounded-lg border border-border p-3">
              <label class="flex min-h-11 items-center gap-2 text-sm font-semibold"><input v-model="comparisonChoice" type="radio" name="canvas-comparison-source" :value="source.sourceRef" :data-testid="`learn-canvas-comparison-choice-${index + 1}`" :disabled="staged">{{ source.label }}</label>
              <p class="mt-1 break-words text-xs">Accepted evidence</p>
              <p class="mt-2 whitespace-pre-wrap break-words text-sm">{{ source.summary }}</p>
              <button type="button" :data-testid="`learn-canvas-source-${index + 1}`" :aria-label="`Open Evidence for ${source.label}`" class="mt-2 min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-[var(--learn-action)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="inspectEvidence">Inspect evidence</button>
            </div>
          </div>
        </fieldset>
      </article>
      <article v-if="independentApplication" :data-testid="independentApplication.testId" class="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Independent application">
        <h2 class="font-dm-sans text-xl font-semibold">Apply it independently</h2>
        <p class="mt-2 whitespace-pre-wrap break-words">{{ independentApplication.props.prompt }}</p>
        <p class="mt-2 text-sm text-muted-foreground">Your answer is saved before server evaluation. Hints or reveals can affect the evaluation.</p>
      </article>
      <template v-if="!responseStep">
        <button v-if="citedExplanation" ref="meaningfulStartAction" type="button" data-testid="learn-canvas-continue" class="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="continueActivity">Continue</button>
        <button v-else-if="workedExample && !exampleRevealed" ref="meaningfulStartAction" type="button" data-testid="learn-canvas-reveal-example" :disabled="exampleRevealPending || !isOnline" class="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)] disabled:opacity-50" @click="revealExample">{{ exampleRevealPending ? 'Recording guided support…' : 'Reveal example' }}</button>
        <button v-else-if="workedExample" ref="meaningfulStartAction" type="button" data-testid="learn-canvas-continue" class="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="continueActivity">Continue</button>
      </template>
      <div v-else class="rounded-xl border border-border bg-card p-5">
        <h2 ref="responseHeading" tabindex="-1" :data-testid="independentApplication ? 'learn-canvas-independent-response-heading' : undefined" class="font-dm-sans text-xl font-semibold focus:outline-none">{{ sourceComparison ? 'Explain your source choice' : workedExample ? 'Respond after guided support' : independentApplication ? 'Your independent response' : 'Apply what you learned' }}</h2>
        <p v-if="workedExample" data-testid="learn-canvas-worked-status" role="status" class="mt-2 text-sm">Guided support reviewed. This response follows a worked example and is not an independent attempt or proof of mastery.</p>
        <p v-if="!sourceComparison" data-testid="learn-canvas-response-prompt" class="mt-3 whitespace-pre-wrap leading-7">{{ canvas.responsePrompt }}</p>
        <template v-if="!staged">
          <div v-if="!sourceComparison" class="mt-4 flex flex-wrap gap-2">
            <button type="button" data-testid="learn-canvas-hint" :disabled="busy || !isOnline" class="min-h-11 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" @click="assistance('substantive_hint')">Get a hint</button>
            <button type="button" data-testid="learn-canvas-reveal" :disabled="busy || !isOnline" class="min-h-11 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" @click="assistance('answer_reveal')">Reveal example</button>
          </div>
          <p v-if="assistanceText" class="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{{ assistanceText }}</p>
          <label v-if="sourceComparison" class="mt-4 block text-sm font-medium">Why did you choose this source?<textarea ref="comparisonRationaleField" v-model="comparisonRationale" data-testid="learn-canvas-comparison-rationale" rows="5" maxlength="12000" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
          <label v-else class="mt-4 block text-sm font-medium">Your response<textarea v-model="response" data-testid="learn-canvas-response" rows="5" maxlength="12000" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
          <fieldset class="mt-4"><legend class="text-sm font-medium">How confident are you?</legend><div class="mt-2 flex flex-wrap gap-3"><label v-for="value in [1, 2, 3, 4, 5]" :key="value" class="flex min-h-11 items-center gap-1 text-sm"><input v-model.number="confidence" type="radio" name="canvas-confidence" :value="value" :data-testid="`learn-canvas-confidence-${value}`">{{ value }}</label></div></fieldset>
          <button :ref="sourceComparison || independentApplication ? 'meaningfulStartAction' : undefined" type="button" data-testid="learn-canvas-submit" :disabled="sourceComparison ? busy || !isOnline : !canSubmit" class="mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" @click="submitWithValidation">{{ busy ? 'Submitting…' : sourceComparison ? canvas.activity.requiredAction.label : 'Submit response' }}</button>
        </template>
        <div v-else data-testid="learn-canvas-status" role="status" class="mt-4 text-sm">
          <p v-if="sourceComparison && authoritativeSavedResponse" data-testid="learn-canvas-comparison-saved" class="mb-2">Chosen source: {{ sourceComparison.props.sources.find(source => source.sourceRef === decodeSourceComparisonResponse(authoritativeSavedResponse!.response)?.sourceRef)?.label ?? 'Saved choice' }}. Rationale: {{ decodeSourceComparisonResponse(authoritativeSavedResponse!.response)?.rationale ?? '' }}</p>
          {{ scoreState === 'complete' || canvas.status === 'feedback' ? 'Response scored.' : scoreState === 'reconciling' || canvas.status === 'reconciling' ? 'Scoring needs reconciliation. Your response is saved.' : scoreState === 'unconfirmed' ? 'Scoring outcome is unconfirmed. Your response is saved.' : scoreState === 'blocked' ? 'Scoring is unavailable. Your response is saved.' : scoreState === 'pending' || canvas.status === 'scoring' ? 'Scoring is in progress.' : 'Response submitted.' }}
          <button v-if="!['complete', 'reconciling', 'blocked'].includes(scoreState) && canvas.status !== 'reconciling' && authoritativeSavedResponse" type="button" data-testid="learn-canvas-retry-scoring" :disabled="busy || !isOnline" class="ml-2 min-h-11 underline disabled:opacity-50" @click="score()">Retry scoring</button>
          <button v-if="scoreState === 'reconciling' || scoreState === 'blocked' || canvas.status === 'reconciling'" type="button" data-testid="learn-canvas-scoring-safe-action" class="ml-2 min-h-11 underline" @click="emit('leave')">Back to Learn</button>
        </div>
      </div>
    </div>
  </section>
</template>
