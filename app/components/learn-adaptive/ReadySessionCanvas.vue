<script setup lang="ts">
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'
import { useAdaptiveResponseDraft } from '~/composables/useAdaptiveResponseDraft'

type Canvas = {
  ownerId: string
  status: string
  thread: { id: string, outcome: string, intent: string, revision: number }
  activity: {
    id: string, status: string, purpose: string, reasonCode: string
    primitive: { type: string, action: string, testId: string, props: { heading?: string, explanation?: string, sourceRefs?: string[] } } | null
    fallback: { title: string, body: string, testId: string, primaryAction: { label: string } }
    requiredAction: { kind: string, label: string }
  }
  session: { studySessionId: string, revision: number, contentRevision: number, planRecordRevision: number, blueprintRecordRevision: number, scheduledStartAt: number, scheduledEndAt: number | null, timezone: string }
  responsePrompt: string | null
  recovery?: { title: string, body: string, action: string } | null
  savedResponse?: { response: string, confidence: number } | null
}

const props = withDefaults(defineProps<{ canvas: Canvas, showHeader?: boolean, active?: boolean }>(), { showHeader: true, active: true })
const emit = defineEmits<{ leave: [] }>()
const { isOnline } = useOnlineStatus()
const startMutation = import.meta.client ? useConvexMutation(api.learnV2SessionContent.startStudySession) : { mutate: async () => ({}) }
const assistanceMutation = import.meta.client ? useConvexMutation(api.learnV2Mastery.recordAssistanceUse) : { mutate: async () => ({}) }
const stageMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.submitCanvasResponse) : { mutate: async () => ({}) }
const meaningfulStartMutation = import.meta.client ? useConvexMutation(api.learnV2SessionContent.recordMeaningfulActivityStarted) : { mutate: async () => ({}) }
const submitAction = import.meta.client ? useConvexAction(api.learnAdaptive.submitResponse) : { mutate: async () => ({}) }

const sessionRevision = ref(props.canvas.session.revision)
const threadRevision = ref(props.canvas.thread.revision)
const started = ref(['started', 'submitted', 'scoring', 'reconciling', 'feedback'].includes(props.canvas.status))
const responseStep = ref(['submitted', 'scoring', 'reconciling', 'feedback'].includes(props.canvas.status))
const response = ref(props.canvas.savedResponse?.response ?? '')
const confidence = ref<number | null>(props.canvas.savedResponse?.confidence ?? null)
const authoritativeSavedResponse = ref(props.canvas.savedResponse ? { ...props.canvas.savedResponse } : null)
const assistanceText = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref('')
const scoreState = ref<'idle' | 'pending' | 'complete'>('idle')
const staged = ref(!!props.canvas.savedResponse || props.canvas.status === 'submitted' || props.canvas.status === 'scoring' || props.canvas.status === 'reconciling' || props.canvas.status === 'feedback')
useAdaptiveResponseDraft(`learn-response:${props.canvas.ownerId}:${props.canvas.thread.id}:${props.canvas.activity.id}`, response, staged, confidence)
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
watch(() => props.canvas.thread.revision, value => { threadRevision.value = Math.max(threadRevision.value, value) })
watch(() => props.canvas.status, value => {
  if (value === 'started') started.value = true
  if (['submitted', 'scoring', 'reconciling', 'feedback'].includes(value)) { started.value = true; staged.value = true; responseStep.value = true }
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

watch([started, responseStep, isOnline, busy, meaningfulStartRetryTick, () => props.active], async ([hasStarted, showingResponse, online, , , visible]) => {
  if (!visible || !hasStarted || !online || meaningfulStartRecorded.value || meaningfulStartPending.value) return
  meaningfulStartPending.value = true
  try {
    await nextTick()
    if (!meaningfulStartOperableSeen) {
      if (showingResponse || !citedExplanation.value || !props.canvas.responsePrompt || !meaningfulStartAction.value || meaningfulStartAction.value.disabled
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
const citedExplanation = computed(() => props.canvas.activity.primitive?.type === 'cited_explanation' && props.canvas.activity.primitive.action === 'continue' ? props.canvas.activity.primitive : null)
const canSubmit = computed(() => isOnline.value && !busy.value && !staged.value && response.value.trim().length > 0 && response.value.length <= 12_000 && confidence.value !== null)

async function start() {
  if (!isOnline.value || busy.value || started.value || props.canvas.status !== 'ready') return
  busy.value = true; error.value = null
  startKey.value ??= key('adaptive-canvas-start')
  try {
    const dispatchedRevision = sessionRevision.value
    await startMutation.mutate({ studySessionId: props.canvas.session.studySessionId as never, expectedSessionRevision: dispatchedRevision, expectedContentRevision: props.canvas.session.contentRevision, idempotencyKey: startKey.value })
    sessionRevision.value = Math.max(sessionRevision.value, dispatchedRevision + 1)
    started.value = true
    notice.value = 'Session started. Read the supported explanation.'
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
  if (!isOnline.value || busy.value || !staged.value || scoreState.value === 'complete' || !snapshot) return
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
    }) as { kind: string, status?: string, message?: string, retryable?: boolean }
    if (result.kind !== 'accepted') {
      error.value = result.message ?? 'Scoring is unavailable for this session.'
      return
    }
    scoreState.value = result.status === 'completed' ? 'complete' : 'pending'
    notice.value = result.status === 'completed' ? 'Response scored.' : 'Scoring is in progress.'
  }
  catch (cause) { error.value = getErrorMessage(cause, 'Could not score your response. Retry to reconcile it.') }
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
  catch (cause) { error.value = getErrorMessage(cause, 'Could not submit your response. Try again.') }
  finally { busy.value = false }
  if (stageSucceeded) await score(submissionSnapshot)
}
</script>

<template>
  <section class="w-full" data-testid="learn-adaptive-canvas" :aria-labelledby="showHeader ? 'learn-canvas-title' : undefined" :aria-label="showHeader ? undefined : 'Current activity'">
    <p v-if="showHeader" class="text-xs font-medium uppercase tracking-wide text-primary">Learning thread · {{ canvas.thread.intent }}</p>
    <h1 v-if="showHeader" id="learn-canvas-title" class="mt-2 font-dm-sans text-3xl font-bold">{{ canvas.thread.outcome }}</h1>
    <p class="mt-2 text-sm text-muted-foreground">{{ canvas.activity.purpose }}</p>
    <p class="sr-only" aria-live="polite">{{ notice }}</p>
    <p v-if="!isOnline" role="status" class="mt-4 rounded-lg border border-amber-500/40 p-3 text-sm">A connection is required to start, get support, or submit a response.</p>
    <p v-if="error" role="alert" data-testid="learn-canvas-error" class="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{{ error }}</p>

    <div v-if="canvas.status === 'blocked' || !citedExplanation || !canvas.responsePrompt" :data-testid="canvas.activity.fallback.testId" class="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 class="font-dm-sans text-lg font-semibold">{{ canvas.recovery?.title ?? canvas.activity.fallback.title }}</h2>
      <p role="status" class="mt-2 text-sm text-muted-foreground">{{ canvas.recovery?.body ?? canvas.activity.fallback.body }}</p>
      <div v-if="authoritativeSavedResponse" data-testid="learn-canvas-saved-fallback" class="mt-4 rounded-lg border border-border p-3 text-sm">
        <p role="status">Your response is saved. This activity must become available before scoring can continue.</p>
      </div>
      <button type="button" data-testid="learn-canvas-fallback-action" class="mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground" @click="emit('leave')">{{ canvas.recovery?.action ?? canvas.activity.fallback.primaryAction.label }}</button>
    </div>
    <div v-else-if="!started" data-testid="learn-canvas-ready" class="mt-6 rounded-xl border border-border bg-card p-5">
      <p class="text-sm text-muted-foreground">The supported activity is ready to begin.</p>
      <button type="button" data-testid="learn-canvas-start" :disabled="busy || !isOnline" class="mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" @click="start">{{ busy ? 'Starting…' : 'Start' }}</button>
    </div>
    <div v-else class="mt-6 space-y-5">
      <article :data-testid="citedExplanation.testId" class="rounded-xl border border-border bg-card p-5">
        <h2 class="font-dm-sans text-xl font-semibold">{{ citedExplanation.props.heading }}</h2>
        <p class="mt-3 whitespace-pre-wrap leading-7">{{ citedExplanation.props.explanation }}</p>
        <p class="mt-3 text-xs text-muted-foreground">Supported by {{ citedExplanation.props.sourceRefs?.length ?? 0 }} accepted source.</p>
      </article>
      <button v-if="!responseStep" ref="meaningfulStartAction" type="button" data-testid="learn-canvas-continue" class="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground" @click="responseStep = true">{{ canvas.activity.requiredAction.label }}</button>
      <div v-else class="rounded-xl border border-border bg-card p-5">
        <h2 class="font-dm-sans text-xl font-semibold">Apply what you learned</h2>
        <p data-testid="learn-canvas-response-prompt" class="mt-3 whitespace-pre-wrap leading-7">{{ canvas.responsePrompt }}</p>
        <template v-if="!staged">
          <div class="mt-4 flex flex-wrap gap-2">
            <button type="button" data-testid="learn-canvas-hint" :disabled="busy || !isOnline" class="min-h-11 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" @click="assistance('substantive_hint')">Get a hint</button>
            <button type="button" data-testid="learn-canvas-reveal" :disabled="busy || !isOnline" class="min-h-11 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" @click="assistance('answer_reveal')">Reveal example</button>
          </div>
          <p v-if="assistanceText" class="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{{ assistanceText }}</p>
          <label class="mt-4 block text-sm font-medium">Your response<textarea v-model="response" data-testid="learn-canvas-response" rows="5" maxlength="12000" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
          <fieldset class="mt-4"><legend class="text-sm font-medium">How confident are you?</legend><div class="mt-2 flex flex-wrap gap-3"><label v-for="value in [1, 2, 3, 4, 5]" :key="value" class="flex min-h-11 items-center gap-1 text-sm"><input v-model.number="confidence" type="radio" name="canvas-confidence" :value="value" :data-testid="`learn-canvas-confidence-${value}`">{{ value }}</label></div></fieldset>
          <button type="button" data-testid="learn-canvas-submit" :disabled="!canSubmit" class="mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" @click="submit">{{ busy ? 'Submitting…' : 'Submit response' }}</button>
        </template>
        <div v-else data-testid="learn-canvas-status" role="status" class="mt-4 text-sm">
          {{ scoreState === 'complete' || canvas.status === 'feedback' ? 'Response scored.' : scoreState === 'pending' || canvas.status === 'scoring' ? 'Scoring is in progress.' : 'Response submitted.' }}
          <button v-if="scoreState !== 'complete' && authoritativeSavedResponse" type="button" data-testid="learn-canvas-retry-scoring" :disabled="busy || !isOnline" class="ml-2 min-h-11 underline disabled:opacity-50" @click="score()">Retry scoring</button>
        </div>
      </div>
    </div>
  </section>
</template>
