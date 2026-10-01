<script setup lang="ts">
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'
import type { AdaptiveFixedNextPlan, AdaptiveOverrideOption } from '~~/shared/learn-adaptive-controls'

type Controls = {
  reasonText: { version: string, purpose: string, text: string }
  selected: AdaptiveOverrideOption | null
  fixedNextPlan: AdaptiveFixedNextPlan | null
  options: Array<{ key: AdaptiveOverrideOption, label: string, available: boolean, unavailableReason: 'evidence' | 'mastery' | 'state' | 'policy' | null }>
}

const props = defineProps<{ controls: Controls, threadId: string, activityId: string, revision: number }>()
const emit = defineEmits<{ revision: [value: number], selected: [value: AdaptiveOverrideOption] }>()
const mutation = import.meta.client ? useConvexMutation(api.learnAdaptive.applyOverride) : { mutate: async () => ({}) }
const { isOnline } = useOnlineStatus()
const expanded = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const selected = ref<AdaptiveOverrideOption | null>(props.controls.selected)
const acceptedPlan = ref<AdaptiveFixedNextPlan | null>(props.controls.fixedNextPlan)
const currentRevision = ref(props.revision)
const pendingKey = ref<string | null>(null)
const pendingOption = ref<AdaptiveOverrideOption | null>(null)
const unavailableCopy = {
  evidence: 'Current evidence cannot support this choice.',
  mastery: 'A current mastery result is not available for this choice.',
  state: 'This activity is not in a state that permits this choice.',
  policy: 'This choice is not supported for this activity.',
} as const
function unavailableExplanation(option: Controls['options'][number]) {
  if (option.key === 'harder' && option.unavailableReason === 'policy') return 'Difficulty changes need a supported next activity; this fixed continuation cannot safely offer harder yet.'
  return option.unavailableReason ? unavailableCopy[option.unavailableReason] : ''
}
const nextActivityLabels: Record<AdaptiveFixedNextPlan['nextActivity'], string> = {
  alternate_explanation: 'Another supported explanation', worked_example: 'Worked example',
  independent_try: 'Independent try', knowledge_check: 'Knowledge check', source_comparison: 'Source comparison',
  practical_application: 'Practical application', guided_step: 'Guided step', challenge_step: 'Challenge step',
  answer_step: 'Answer step', continue_with_time: 'Continue',
}
const nextPlanLabel = computed(() => acceptedPlan.value
  ? `${nextActivityLabels[acceptedPlan.value.nextActivity]} with ${acceptedPlan.value.availableTime === 'no_limit' ? 'no time limit' : `${acceptedPlan.value.availableTime} minutes`}`
  : null)
watch(() => props.revision, revision => { currentRevision.value = Math.max(currentRevision.value, revision) })
watch(() => props.controls.selected, value => { selected.value = value })
watch(() => props.controls.fixedNextPlan, value => { acceptedPlan.value = value })

async function choose(option: Controls['options'][number]) {
  if (!option.available || busy.value || !isOnline.value) return
  busy.value = true
  error.value = null
  if (pendingOption.value !== option.key) pendingKey.value = null
  pendingOption.value = option.key
  pendingKey.value ??= `adaptive-override-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
  try {
    const result = await mutation.mutate({ threadId: props.threadId as never, activityId: props.activityId,
      option: option.key, expectedRevision: currentRevision.value, idempotencyKey: pendingKey.value }) as { kind: string, revision?: number, value?: { fixedNextPlan?: AdaptiveFixedNextPlan } } | undefined
    if (!result) throw new Error('Could not save this choice. Try again.')
    if (result.kind !== 'ok' || result.revision === undefined || !result.value?.fixedNextPlan) {
      pendingKey.value = null
      throw new Error('This activity changed. Refresh before choosing again.')
    }
    selected.value = option.key
    acceptedPlan.value = result.value.fixedNextPlan
    currentRevision.value = result.revision
    emit('revision', result.revision)
    emit('selected', option.key)
    pendingKey.value = null
  }
  catch (cause) { error.value = getErrorMessage(cause, 'Could not save this choice. Try again.') }
  finally { busy.value = false }
}
</script>

<template>
  <section class="mt-5 rounded-xl border border-border bg-[var(--learn-context-surface)] p-4" data-testid="learn-why-controls">
    <button type="button" data-testid="learn-why-toggle" :aria-expanded="expanded" aria-controls="learn-why-controls-panel" class="min-h-11 rounded-lg text-sm font-semibold text-[var(--learn-action)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="expanded = !expanded">Why this?</button>
    <div v-if="expanded" id="learn-why-controls-panel">
      <p class="mt-2 text-sm" data-testid="learn-why-purpose">{{ controls.reasonText.purpose }}</p>
      <p class="mt-2 text-sm" data-testid="learn-why-reason">{{ controls.reasonText.text }}</p>
      <p class="mt-3 text-sm text-muted-foreground">Choose one adjustment for the next activity. Your current response stays in place.</p>
      <p v-if="selected" class="mt-2 text-sm" role="status">Selected: {{ controls.options.find(option => option.key === selected)?.label }}</p>
      <p v-if="nextPlanLabel" class="mt-2 text-sm" role="status" data-testid="learn-fixed-next-plan">Next activity: {{ nextPlanLabel }}. This plan will be rechecked at the next boundary.</p>
      <p v-if="error" class="mt-2 text-sm text-destructive" role="alert">{{ error }}</p>
      <ul class="mt-3 grid gap-2 sm:grid-cols-2">
        <li v-for="option in controls.options" :key="option.key" class="rounded-lg border border-border p-2">
          <button type="button" :data-testid="`learn-override-${option.key}`" :disabled="!option.available || !isOnline" :aria-disabled="!option.available || busy || !isOnline" :aria-describedby="option.unavailableReason ? `learn-override-reason-${option.key}` : undefined" class="min-h-11 text-left text-sm text-[var(--learn-action)] disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="choose(option)">{{ option.label }}</button>
          <p v-if="option.unavailableReason" :id="`learn-override-reason-${option.key}`" class="text-xs text-muted-foreground">{{ unavailableExplanation(option) }}</p>
        </li>
      </ul>
      <p v-if="!isOnline" role="status" class="mt-2 text-sm">Reconnect to save an adjustment.</p>
    </div>
  </section>
</template>
