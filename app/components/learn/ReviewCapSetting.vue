<script setup lang="ts">
import { Settings } from '@lucide/vue'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'

const props = defineProps<{
  currentCap: number
}>()

const open = ref(false)
const localCap = ref(props.currentCap)
const saving = ref(false)
const containerRef = ref<HTMLElement | null>(null)

const updateCapMutation = import.meta.client
  ? useConvexMutation(api.learnProfile.updateDailyReviewCap)
  : { mutate: async () => {} }

watch(() => props.currentCap, (val) => {
  if (!open.value) localCap.value = val
})

function toggleSettings() {
  if (!open.value) localCap.value = props.currentCap
  open.value = !open.value
}

function handleClickOutside(e: MouseEvent) {
  if (!open.value || !containerRef.value) return
  if (!containerRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})

async function saveCap() {
  const val = Math.round(localCap.value)
  if (val < 5 || val > 200) return
  saving.value = true
  try {
    await updateCapMutation.mutate({ cap: val })
    open.value = false
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to update review cap')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div ref="containerRef" class="relative">
    <button
      type="button"
      class="rounded p-1 text-stone-500 transition-colors hover:text-stone-300"
      :aria-label="open ? 'Close review settings' : 'Open review settings'"
      data-testid="review-cap-toggle"
      @click="toggleSettings"
    >
      <Settings class="h-4 w-4" />
    </button>
    <div
      v-if="open"
      class="absolute right-0 top-8 z-10 w-56 rounded-lg border border-stone-700 bg-stone-900 p-3 shadow-lg"
      data-testid="review-cap-panel"
      @keydown.escape="open = false"
    >
      <label class="block text-xs text-stone-400">
        Daily review cap
        <input
          v-model.number="localCap"
          type="number"
          min="5"
          max="200"
          class="mt-1 w-full rounded border border-stone-700 bg-stone-950 px-2.5 py-1.5 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
          data-testid="review-cap-input"
        >
      </label>
      <p class="mt-1 text-xs text-stone-600">5 - 200 items per session</p>
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          class="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          :disabled="saving || localCap < 5 || localCap > 200"
          data-testid="review-cap-save"
          @click="saveCap"
        >
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button
          type="button"
          class="rounded border border-stone-700 px-3 py-1 text-xs text-stone-400 transition-colors hover:text-stone-200"
          @click="open = false"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
