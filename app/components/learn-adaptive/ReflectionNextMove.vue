<script setup lang="ts">
import { api } from '#convex/api'
import { adaptiveActivityFallbackForReason } from '~~/shared/learn-adaptive-activity-registry'
import { resolveAdaptiveActivityRenderer } from '~~/shared/learn-adaptive-renderer-contract'

type ReflectionDecision = 'accept' | 'override' | 'end'
type Canvas = {
  ownerId: string
  status: string
  decision: null | { outcome: 'accepted' | 'overridden' | 'ended', nextMove: string, decidedAt: number }
  thread: { id: string, revision: number, outcome: string, lifecycle: string }
  activity: {
    id: string
    planRevision: number
    status: string
    purpose: string
    reason: string
    primitive: null | { contractVersion: string, rendererVersion: string, type: string, action: string, testId: string, props: unknown }
    fallback: { title: string, body: string, testId: string, primaryAction: { label: string } }
  }, recovery?: { title: string, body: string, action: string }
}

const props = withDefaults(defineProps<{ canvas: Canvas, authoritativeRevision?: number, active?: boolean }>(), { active: true })
const emit = defineEmits<{ leave: [] }>()
const { isOnline } = useOnlineStatus()
const mutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.decideReflectionNextMove)
  : { mutate: async (_: unknown) => ({ kind: 'blocked' as const }) }
const reportRenderFailureMutation = import.meta.client
  ? useConvexMutation(api.learnAdaptiveCanvas.reportRenderFailure)
  : { mutate: async (_: unknown) => ({ recorded: false }) }
const busy = ref(false)
const notice = ref('')
const error = ref('')
const commandKey = ref<string | null>(null)
const commandDecision = ref<ReflectionDecision | null>(null)
const completedHeading = useTemplateRef<HTMLElement>('completed-heading')
const fallbackAction = useTemplateRef<HTMLButtonElement>('fallback-action')

const validation = computed(() => {
  const primitive = props.canvas.activity.primitive
  if (!primitive || props.canvas.status === 'blocked') return { value: null, reason: 'renderer_unavailable' as const }
  const result = resolveAdaptiveActivityRenderer(primitive, 'reflection')
  if (!result.ok) return { value: null, reason: result.reason }
  if (result.value.type !== 'reflection_next_move') return { value: null, reason: 'renderer_unavailable' as const }
  const primaryDecision = result.value.action === 'accept_next_move' ? 'accept'
    : result.value.action === 'override_next_move' ? 'override' : result.value.action === 'end_thread' ? 'end' : null
  if (!primaryDecision || !result.value.props.allowedDecisions.includes(primaryDecision)) return { value: null, reason: 'unsupported_action' as const }
  return { value: result.value, reason: null }
})
const reflection = computed(() => validation.value.value)
const fallback = computed(() => props.canvas.status === 'blocked' && props.canvas.recovery
  ? { title: props.canvas.recovery.title, body: props.canvas.recovery.body, testId: 'learn-reflection-fallback', primaryAction: { label: props.canvas.recovery.action } }
  : validation.value.reason ? adaptiveActivityFallbackForReason(validation.value.reason) : props.canvas.activity.fallback)
const completed = computed(() => props.canvas.status === 'completed' && props.canvas.decision !== null)
const revision = computed(() => Math.max(props.canvas.thread.revision, props.authoritativeRevision ?? 0))
const choiceCommitted = computed(() => notice.value.length > 0)
const reportedFailures = new Set<string>()

watch([validation, isOnline, () => props.canvas.activity.id, () => props.canvas.activity.planRevision], async ([result, online, activityId, planRevision]) => {
  if (!online || !result.reason || !activityId || !Number.isSafeInteger(planRevision) || planRevision < 1) return
  const key = `${activityId}:${planRevision}:${result.reason}`
  if (reportedFailures.has(key)) return
  reportedFailures.add(key)
  try {
    await reportRenderFailureMutation.mutate({ threadId: props.canvas.thread.id as never, activityId,
      expectedPlanRevision: planRevision, reasonCode: result.reason })
  }
  catch { reportedFailures.delete(key) }
}, { immediate: true })

watch(completed, async (value, previous) => {
  if (!value || previous) return
  await nextTick()
  completedHeading.value?.focus()
})
onMounted(() => {
  if (!props.active) return
  if (completed.value) completedHeading.value?.focus()
  else if (validation.value.reason) fallbackAction.value?.focus()
})
watch([() => validation.value.reason, () => props.active], async ([reason, active]) => {
  if (!reason || !active) return
  await nextTick()
  fallbackAction.value?.focus()
}, { immediate: true })

function newCommandKey() {
  return `reflection-${crypto.randomUUID()}`
}

async function decide(decision: ReflectionDecision) {
  if (busy.value || choiceCommitted.value || completed.value || !isOnline.value || !reflection.value?.props.allowedDecisions.includes(decision)) return
  if (commandDecision.value !== decision) {
    commandKey.value = null
    commandDecision.value = decision
  }
  commandKey.value ||= newCommandKey()
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await mutation.mutate({ threadId: props.canvas.thread.id as never, activityId: props.canvas.activity.id,
      decision, expectedRevision: revision.value, idempotencyKey: commandKey.value })
    if (result?.kind === 'ok') {
      notice.value = 'Choice saved. Updating your learning thread…'
      return
    }
    commandKey.value = null
    error.value = result?.kind === 'conflict'
      ? 'This activity changed. Review the latest next move before choosing again.'
      : 'That choice could not be saved. Review the current activity and try again.'
  }
  catch {
    error.value = 'Your choice is unconfirmed. Reconnect and retry the same choice safely.'
  }
  finally { busy.value = false }
}

const completedLabel = computed(() => props.canvas.decision?.outcome === 'accepted'
  ? 'Next move accepted.'
  : props.canvas.decision?.outcome === 'overridden' ? 'You chose a different next move.' : 'Thread ended.')
</script>

<template>
  <section v-if="reflection" :data-testid="reflection.testId" aria-labelledby="learn-reflection-title" class="rounded-xl border border-border bg-[var(--learn-activity-surface)] p-4 sm:p-6">
    <template v-if="completed">
      <div data-testid="learn-reflection-completed" class="rounded-lg border border-[var(--learn-success)] p-4" role="status" aria-live="polite">
        <h2 id="learn-reflection-title" ref="completed-heading" tabindex="-1" class="font-dm-sans text-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]">{{ completedLabel }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ canvas.decision?.nextMove }}</p>
        <p class="mt-2 text-sm">This saved choice is not a mastery result.</p>
        <button type="button" data-testid="learn-reflection-completed-action" class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--learn-action)] px-4 py-2 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)] sm:w-auto" @click="emit('leave')">
          {{ canvas.decision?.outcome === 'ended' ? 'Back to Learn' : canvas.decision?.outcome === 'overridden' ? 'Choose a different next move' : canvas.decision?.nextMove }}
        </button>
      </div>
    </template>
    <template v-else>
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reflection and next move</p>
      <h2 id="learn-reflection-title" class="mt-2 font-dm-sans text-xl font-semibold">Choose your next move</h2>
      <p class="mt-3 text-sm text-muted-foreground" data-testid="learn-reflection-reason">{{ canvas.activity.reason }}</p>
      <div class="mt-4 rounded-lg bg-[var(--learn-context-surface)] p-4">
        <h3 class="font-medium">Feedback</h3>
        <p class="mt-2 whitespace-pre-wrap text-sm">{{ reflection.props.feedback }}</p>
      </div>
      <div class="mt-3 rounded-lg border border-border p-4">
        <h3 class="font-medium">Recommended next action</h3>
        <p class="mt-2 whitespace-pre-wrap text-sm">{{ reflection.props.nextMove }}</p>
      </div>
      <p class="mt-3 text-sm text-muted-foreground">This reflection, confidence selection, or click does not record mastery. Only a separately scored representative task can do that.</p>
      <p v-if="!isOnline" class="mt-3 rounded-lg border border-[var(--learn-attention)] p-3 text-sm" role="status">You are offline. Your options remain visible, but no choice will be saved until you reconnect.</p>
      <p v-else-if="notice" class="mt-3 text-sm" role="status" aria-live="polite">{{ notice }}</p>
      <p v-if="error" class="mt-3 rounded-lg border border-[var(--learn-error)] p-3 text-sm" role="alert">{{ error }}</p>
      <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button v-if="reflection.props.allowedDecisions.includes('accept')" type="button" data-testid="learn-reflection-accept" class="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--learn-action)] px-4 py-2 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)] sm:w-auto" :disabled="busy || choiceCommitted || !isOnline" @click="decide('accept')">Accept next move</button>
        <button v-if="reflection.props.allowedDecisions.includes('override')" type="button" data-testid="learn-reflection-override" class="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)] sm:w-auto" :disabled="busy || choiceCommitted || !isOnline" @click="decide('override')">Choose another</button>
        <button v-if="reflection.props.allowedDecisions.includes('end')" type="button" data-testid="learn-reflection-end" class="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)] sm:w-auto" :disabled="busy || choiceCommitted || !isOnline" @click="decide('end')">End this thread</button>
      </div>
    </template>
  </section>
  <section v-else :data-testid="fallback.testId" class="rounded-xl border border-[var(--learn-attention)] bg-[var(--learn-context-surface)] p-5" role="alert" aria-labelledby="learn-reflection-fallback-title">
    <h2 id="learn-reflection-fallback-title" class="font-dm-sans text-lg font-semibold">{{ fallback.title }}</h2>
    <p class="mt-2 text-sm text-muted-foreground">{{ fallback.body }}</p>
    <button ref="fallback-action" type="button" class="learn-adaptive-recovery-action mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)] sm:w-auto" @click="emit('leave')">{{ fallback.primaryAction.label }}</button>
  </section>
</template>
