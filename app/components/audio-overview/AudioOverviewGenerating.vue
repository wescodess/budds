<script setup lang="ts">
import { Check, Loader2 } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  taskId: Id<'tasks'>
  progress: string
  cancelling?: boolean
}>()

const emit = defineEmits<{
  cancel: [taskId: Id<'tasks'>]
}>()

type StepStatus = 'pending' | 'active' | 'done'
type Step = { label: string; status: StepStatus }

const steps = computed<Step[]>(() => {
  const p = (props.progress ?? '').toLowerCase()
  const result: Step[] = [
    { label: 'Retrieving sources', status: 'pending' },
    { label: 'Writing dialogue', status: 'pending' },
    { label: 'Synthesizing voices', status: 'pending' },
  ]
  if (p.includes('retriev')) {
    result[0]!.status = 'active'
  }
  else if (p.includes('writ')) {
    result[0]!.status = 'done'
    result[1]!.status = 'active'
  }
  else if (p.includes('synth')) {
    result[0]!.status = 'done'
    result[1]!.status = 'done'
    result[2]!.status = 'active'
  }
  else if (p.includes('complete')) {
    result.forEach(s => { s.status = 'done' })
  }
  else {
    result[0]!.status = 'active'
  }
  return result
})

const percent = computed(() => {
  const p = (props.progress ?? '').toLowerCase()
  const turnMatch = p.match(/turn\s+(\d+)\s*\/\s*(\d+)/)
  if (turnMatch) {
    const done = Number(turnMatch[1])
    const total = Number(turnMatch[2])
    if (total > 0) return Math.min(95, Math.round(30 + (done / total) * 60))
  }
  if (p.includes('retriev')) return 10
  if (p.includes('writ')) return 25
  if (p.includes('synth')) return 40
  return 5
})

function handleCancel() {
  if (props.cancelling) return
  emit('cancel', props.taskId)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center p-6">
    <div
      data-testid="audio-overview-generating"
      class="relative w-full max-w-xl overflow-hidden rounded-xl border border-border/60 bg-card p-8 sm:p-10"
    >
      <div
        class="absolute inset-x-0 top-0 h-1 bg-primary/80 transition-[width] duration-500"
        :style="{ width: `${percent}%` }"
      />

      <div class="flex items-center justify-between">
        <h2 class="font-dm-sans text-xl font-semibold text-foreground">
          {{ props.progress || 'Preparing…' }}
        </h2>
        <span class="font-inter text-xs text-muted-foreground">{{ percent }}%</span>
      </div>

      <ul class="mt-6 space-y-3" data-testid="audio-overview-steps">
        <li
          v-for="step in steps"
          :key="step.label"
          class="flex items-center gap-3 font-dm-sans text-sm"
          :class="step.status === 'done' ? 'text-foreground' : step.status === 'active' ? 'text-foreground' : 'text-muted-foreground'"
        >
          <span
            class="inline-flex h-5 w-5 items-center justify-center rounded-full"
            :class="{
              'bg-primary text-primary-foreground': step.status === 'done',
              'border border-primary text-primary': step.status === 'active',
              'border border-border/60 text-muted-foreground': step.status === 'pending',
            }"
          >
            <Check v-if="step.status === 'done'" class="h-3 w-3" />
            <Loader2 v-else-if="step.status === 'active'" class="h-3 w-3 animate-spin" />
            <span v-else class="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
          </span>
          <span>{{ step.label }}</span>
        </li>
      </ul>

      <div class="mt-8 flex items-center justify-end">
        <button
          type="button"
          data-testid="audio-overview-cancel-btn"
          class="font-inter text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.cancelling"
          @click="handleCancel"
        >
          {{ props.cancelling ? 'Cancelling…' : 'Cancel generation' }}
        </button>
      </div>
    </div>
  </div>
</template>
