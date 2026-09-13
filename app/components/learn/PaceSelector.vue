<script setup lang="ts">
import { getErrorMessage } from '~~/shared/errors'
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

type Pace = 'intensive' | 'steady' | 'relaxed'

const props = defineProps<{
  courseId: Id<'courses'>
  currentPace: Pace
}>()

const PACE_OPTIONS: { value: Pace; label: string; description: string }[] = [
  { value: 'intensive', label: 'Intensive', description: 'Learn faster, more per session' },
  { value: 'steady', label: 'Steady', description: 'Balanced pace' },
  { value: 'relaxed', label: 'Relaxed', description: 'Take it slow, fewer items per session' },
]

const updatePaceMutation = import.meta.client
  ? useConvexMutation(api.courses.updatePace)
  : createSsrMutationStub<typeof api.courses.updatePace>()

const selectedPace = ref<Pace>(props.currentPace)

watch(() => props.currentPace, (v) => { selectedPace.value = v })

async function onPaceChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value as Pace
  const prev = selectedPace.value
  selectedPace.value = value
  try {
    await updatePaceMutation.mutate({ courseId: props.courseId, pace: value })
  } catch (e) {
    selectedPace.value = prev
    toast.error(getErrorMessage(e, 'Failed to update pace'))
  }
}
</script>

<template>
  <div class="w-full" data-testid="pace-selector">
    <label class="mb-1 block text-sm font-medium text-stone-400" for="pace-select">
      Pace
    </label>
    <select
      id="pace-select"
      :value="selectedPace"
      class="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-500"
      data-testid="pace-select"
      @change="onPaceChange"
    >
      <option
        v-for="opt in PACE_OPTIONS"
        :key="opt.value"
        :value="opt.value"
        data-testid="pace-option"
      >
        {{ opt.label }} &mdash; {{ opt.description }}
      </option>
    </select>
  </div>
</template>
