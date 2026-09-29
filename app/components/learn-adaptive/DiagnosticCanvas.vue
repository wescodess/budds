<script setup lang="ts">
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'
import { useAdaptiveResponseDraft } from '~/composables/useAdaptiveResponseDraft'
import type { AdaptiveFixedNextPlan, AdaptiveOverrideOption } from '~~/shared/learn-adaptive-controls'
import { resolveAdaptiveActivityRenderer } from '~~/shared/learn-adaptive-renderer-contract'

type Canvas = {
  ownerId: string
  thread: { id: string, outcome: string, intent: string, revision: number }
  status: string
  evidenceState: string
  decisionPending: boolean
  recovery: { title: string, body: string, action: string }
  activity: null | {
    id: string
    planRevision?: number
    status: string
    controls?: { reasonText: { version: string, purpose: string, text: string }, selected: AdaptiveOverrideOption | null, fixedNextPlan: AdaptiveFixedNextPlan | null,
      options: Array<{ key: AdaptiveOverrideOption, label: string, available: boolean, unavailableReason: 'evidence' | 'mastery' | 'state' | 'policy' | null }> }
    primitive: null | { contractVersion: string, rendererVersion: string, type: string, action: string, testId: string, props: unknown }
    response: string | null
    requiredAction: { kind: string, label: string }
  }
}

const props = withDefaults(defineProps<{ canvas: Canvas, authoritativeRevision?: number, showHeader?: boolean, active?: boolean }>(), { showHeader: true, active: true })
const emit = defineEmits<{ leave: [] }>()
const { isOnline } = useOnlineStatus()
const continueMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveRecovery.continueDraft) : { mutate: async () => ({}) }
const submitMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveRecovery.submitDiagnosticResponse) : { mutate: async () => ({}) }
const renderAckMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveRecovery.recordDiagnosticRendered) : { mutate: async () => ({}) }
const reportRenderFailureMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.reportRenderFailure) : { mutate: async () => ({}) }
const busy = ref(false)
const threadRevision = ref(Math.max(props.canvas.thread.revision, props.authoritativeRevision ?? 0))
watch([() => props.canvas.thread.revision, () => props.authoritativeRevision], ([canvasRevision, authoritativeRevision]) => {
  threadRevision.value = Math.max(threadRevision.value, canvasRevision, authoritativeRevision ?? 0)
})
const error = ref<string | null>(null)
const response = ref('')
const localSaved = ref<string | null>(null)
const continueKey = ref<string | null>(null)
const submitKey = ref<string | null>(null)
const responseField = ref<HTMLTextAreaElement | null>(null)
const saveAction = ref<HTMLButtonElement | null>(null)
const recoveryAction = ref<HTMLButtonElement | null>(null)
const blocked = computed(() => props.canvas.status === 'blocked')
const renderAckTick = ref(0)
const renderAckRecorded = ref(false)
const renderAckPending = ref(false)
let renderAckAttempts = 0
let renderAckTimer: ReturnType<typeof setTimeout> | undefined
let renderAckDisposed = false
let renderOperableSeen = false

const diagnosticValidation = computed(() => {
  const primitive = props.canvas.activity?.primitive
  if (!primitive) return { primitive: null, reason: null }
  if (props.canvas.activity?.requiredAction.kind !== 'submit_response'
    || props.canvas.activity.requiredAction.label !== 'Save response') return { primitive: null, reason: 'invalid_props' as const }
  const validated = resolveAdaptiveActivityRenderer(primitive, 'diagnostic')
  if (!validated.ok) return { primitive: null, reason: validated.reason }
  if (validated.value.type !== 'diagnostic_prompt') return { primitive: null, reason: 'renderer_unavailable' as const }
  return { primitive: validated.value, reason: null }
})
const diagnostic = computed(() => diagnosticValidation.value.primitive)
const reportedRenderFailures = new Set<string>()
watch([diagnosticValidation, isOnline, () => props.canvas.activity?.id, () => props.canvas.activity?.planRevision], async ([result, online, activityId, planRevision]) => {
  if (!online || !result.reason || !activityId || !Number.isSafeInteger(planRevision) || !planRevision || planRevision < 1) return
  const reportKey = `${activityId}:${planRevision}:${result.reason}`
  if (reportedRenderFailures.has(reportKey)) return
  reportedRenderFailures.add(reportKey)
  try { await reportRenderFailureMutation.mutate({ threadId: props.canvas.thread.id as never, activityId, expectedPlanRevision: planRevision, reasonCode: result.reason }) }
  catch { reportedRenderFailures.delete(reportKey) }
}, { immediate: true })
const saved = computed(() => props.canvas.activity?.response ?? localSaved.value)
useAdaptiveResponseDraft(props.canvas.activity ? `learn-response:${props.canvas.ownerId}:${props.canvas.thread.id}:${props.canvas.activity.id}` : null, response, computed(() => Boolean(saved.value)))
const canSubmit = computed(() => !blocked.value && !!diagnostic.value && !saved.value && isOnline.value && !busy.value && response.value.trim().length > 0 && new TextEncoder().encode(response.value.trim()).byteLength <= 12_000)
const safeAction = computed(() => props.canvas.recovery.action)

function commandKey(prefix: string) { return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
watch(() => props.canvas.activity?.id, () => { localSaved.value = null; response.value = ''; submitKey.value = null; renderAckRecorded.value = false; renderAckAttempts = 0; renderOperableSeen = false })

function retryRenderAck() {
  const delays = [50, 250, 1_000] as const
  if (renderAckDisposed || renderAckTimer || renderAckAttempts >= delays.length || (saved.value && !renderOperableSeen)) return
  const delay = delays[renderAckAttempts++]!
  renderAckTimer = setTimeout(() => { renderAckTimer = undefined; renderAckTick.value += 1 }, delay)
}

onBeforeUnmount(() => { renderAckDisposed = true; if (renderAckTimer) clearTimeout(renderAckTimer) })
onMounted(() => { if (blocked.value && props.active) recoveryAction.value?.focus() })
watch([blocked, () => props.active], async ([isBlocked, active]) => {
  if (isBlocked && active) { await nextTick(); recoveryAction.value?.focus() }
}, { flush: 'post' })
watch([diagnostic, saved, isOnline, busy, renderAckTick, blocked, () => props.active], async ([primitive, currentSaved, online, busyNow, , isBlocked, visible]) => {
  if (!visible || isBlocked || !primitive || (currentSaved && !renderOperableSeen) || !online || busyNow || renderAckRecorded.value || renderAckPending.value || !props.canvas.activity) return
  renderAckPending.value = true
  try {
    await nextTick()
    if (!renderOperableSeen) {
      if (!responseField.value || responseField.value.disabled || !saveAction.value || saveAction.value.disabled
        || saveAction.value.textContent?.trim() !== props.canvas.activity.requiredAction.label) { retryRenderAck(); return }
      renderOperableSeen = true
    }
    await renderAckMutation.mutate({ threadId: props.canvas.thread.id as never, activityId: props.canvas.activity.id })
    renderAckRecorded.value = true
  }
  catch { retryRenderAck() }
  finally { renderAckPending.value = false }
}, { flush: 'post', immediate: true })

async function continueDraft() {
  if (blocked.value || busy.value || !isOnline.value || props.canvas.activity || props.canvas.decisionPending) return
  busy.value = true; error.value = null
  continueKey.value ??= commandKey('adaptive-diagnostic-continue')
  try {
    const result = await continueMutation.mutate({ threadId: props.canvas.thread.id as never, expectedRevision: threadRevision.value, idempotencyKey: continueKey.value }) as { kind: string }
    if (result.kind !== 'ok') { continueKey.value = null; throw new Error('This thread changed. Reload it to continue.') }
  }
  catch (cause) { error.value = getErrorMessage(cause, 'Could not start the diagnostic. Try again.') }
  finally { busy.value = false }
}

async function submit() {
  if (blocked.value || !props.canvas.activity || busy.value || !isOnline.value || saved.value) return
  if (!canSubmit.value) { error.value = 'Add a response under 12 KB before saving.'; responseField.value?.focus(); return }
  const submission = response.value.trim()
  busy.value = true; error.value = null
  submitKey.value ??= commandKey('adaptive-diagnostic-submit')
  try {
    const result = await submitMutation.mutate({ threadId: props.canvas.thread.id as never,
      activityId: props.canvas.activity.id, expectedRevision: threadRevision.value,
      response: submission, idempotencyKey: submitKey.value }) as { kind: string }
    if (result.kind !== 'ok') { submitKey.value = null; throw new Error('This response boundary changed. Reload it to continue.') }
    localSaved.value = submission
  }
  catch (cause) { error.value = getErrorMessage(cause, 'Could not save your response. Try again.') }
  finally { busy.value = false }
}
</script>

<template>
  <section class="w-full" data-testid="learn-diagnostic-canvas" :aria-labelledby="showHeader ? 'learn-diagnostic-title' : undefined" :aria-label="showHeader ? undefined : 'Current activity'">
    <p v-if="showHeader" class="text-xs font-medium uppercase tracking-wide text-primary">Learning thread · {{ canvas.thread.intent }}</p>
    <h1 v-if="showHeader" id="learn-diagnostic-title" class="mt-2 font-dm-sans text-3xl font-bold">{{ canvas.thread.outcome }}</h1>
    <LearnAdaptiveWhyControls v-if="!blocked && canvas.activity?.controls" :controls="canvas.activity.controls" :thread-id="canvas.thread.id" :activity-id="canvas.activity.id" :revision="threadRevision" @revision="threadRevision = $event" />
    <div class="mt-6 rounded-xl border border-border bg-card p-5" data-testid="learn-diagnostic-recovery" :role="blocked ? 'alert' : undefined">
      <h2 class="font-dm-sans text-xl font-semibold">{{ canvas.recovery.title }}</h2>
      <p class="mt-2 text-sm text-muted-foreground" :role="blocked ? undefined : 'status'">{{ canvas.recovery.body }}</p>
      <button ref="recoveryAction" type="button" data-testid="learn-diagnostic-recovery-action" class="learn-adaptive-recovery-action mt-3 inline-flex min-h-11 items-center text-sm text-primary underline" style="min-height: 44px" @click="emit('leave')">{{ safeAction }}</button>
    </div>
    <p v-if="!isOnline" class="mt-4 text-sm" role="status">Reconnect to save your response.</p>
    <p v-if="error" class="mt-4 text-sm text-destructive" role="alert" data-testid="learn-diagnostic-error">{{ error }}</p>
    <div v-if="blocked" class="sr-only">Activity blocked; use the recovery action above.</div>
    <div v-else-if="canvas.decisionPending" class="mt-6 rounded-xl border border-border p-5" data-testid="learn-diagnostic-decision-pending">
      Resolve or skip your initial clarification from Learn to continue.
    </div>
    <div v-else-if="!canvas.activity" class="mt-6 rounded-xl border border-border bg-card p-5" data-testid="learn-diagnostic-ready">
      <h2 class="font-dm-sans text-xl font-semibold">A useful first step</h2>
      <p class="mt-2 text-sm text-muted-foreground">Record your starting point. This diagnostic is not scored.</p>
      <button type="button" data-testid="learn-diagnostic-start" :disabled="busy || !isOnline" class="mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" @click="continueDraft">{{ busy ? 'Starting…' : 'Start diagnostic' }}</button>
    </div>
    <div v-else-if="!diagnostic" class="mt-6 rounded-xl border border-border bg-card p-5" role="status" data-testid="learn-diagnostic-fallback">
      <p>This activity cannot be displayed safely.</p>
      <p v-if="saved" class="mt-2">Your saved response remains available.</p>
      <p v-else-if="response.trim()" class="mt-2">Your unfinished response is kept on this device and will return when this activity is available.</p>
      <p class="mt-2">Return to Learn to continue.</p>
    </div>
    <div v-else :data-testid="diagnostic.testId" class="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 class="font-dm-sans text-xl font-semibold">Your starting point</h2>
      <p class="mt-3 whitespace-pre-wrap leading-7" data-testid="learn-diagnostic-prompt">{{ diagnostic.props.prompt }}</p>
      <p class="mt-2 text-sm text-muted-foreground">This is a non-factual reflection. It will not be scored.</p>
      <div v-if="saved" class="mt-4" role="status" data-testid="learn-diagnostic-saved">
        <p>Your response is saved.</p>
        <p class="mt-2 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{{ saved }}</p>
      </div>
      <template v-else>
        <label class="mt-4 block text-sm font-medium">Your response<textarea ref="responseField" v-model="response" data-testid="learn-diagnostic-response" aria-label="Your response" :rows="diagnostic.props.responseFormat === 'long_text' ? 8 : 3" maxlength="12000" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
        <button ref="saveAction" type="button" data-testid="learn-diagnostic-submit" :disabled="busy || !isOnline" class="mt-4 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" @click="submit">{{ busy ? 'Saving…' : canvas.activity.requiredAction.label }}</button>
      </template>
    </div>
  </section>
</template>
