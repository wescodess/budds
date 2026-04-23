<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '#convex/api'

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

const ssrStub = {
  mutate: async () => { throw new Error('Mutations are client-only') },
  isLoading: ref(false),
} as { mutate: (_args: any) => Promise<any>; isLoading: Ref<boolean> }

const updatePaceMutation = import.meta.client
  ? useConvexMutation(api.courses.updatePace)
  : ssrStub

const selectedPace = ref<Pace>(props.currentPace)

watch(() => props.currentPace, (v) => { selectedPace.value = v })

async function onPaceChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value as Pace
  selectedPace.value = value
  await updatePaceMutation.mutate({ courseId: props.courseId, pace: value } as any)
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
