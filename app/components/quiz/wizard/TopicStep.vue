<script setup lang="ts">
import { X, Plus, Loader2 } from 'lucide-vue-next'

defineProps<{
  suggestedTopics: string[]
  selectedTopics: string[]
  customTopics: string[]
  loading: boolean
}>()

const emit = defineEmits<{
  toggleTopic: [topic: string]
  addCustom: [topic: string]
  removeCustom: [topic: string]
}>()

const customInput = ref('')

function handleAdd() {
  const trimmed = customInput.value.trim()
  if (trimmed) {
    emit('addCustom', trimmed)
    customInput.value = ''
  }
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h3 class="text-lg font-semibold">Customize Topics</h3>
      <p class="text-sm text-muted-foreground">Refine the focus of your quiz</p>
    </div>

    <div>
      <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested Topics</p>
      <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        Generating topics...
      </div>
      <div v-else class="flex flex-wrap gap-2">
        <button
          v-for="topic in suggestedTopics"
          :key="topic"
          type="button"
          class="rounded-full border px-3 py-1.5 text-sm transition-colors"
          :class="selectedTopics.includes(topic)
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground hover:border-primary/50'"
          @click="emit('toggleTopic', topic)"
        >
          {{ topic }}
        </button>
        <p v-if="suggestedTopics.length === 0 && !loading" class="text-sm text-muted-foreground">
          No topics could be generated. Add custom topics below.
        </p>
      </div>
    </div>

    <div>
      <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Custom Topics</p>
      <div class="flex gap-2">
        <input
          v-model="customInput"
          type="text"
          placeholder="Add a topic..."
          class="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @keydown.enter="handleAdd"
        />
        <UiButton variant="outline" size="sm" @click="handleAdd">
          <Plus class="mr-1 h-3 w-3" />
          Add
        </UiButton>
      </div>
      <div v-if="customTopics.length > 0" class="mt-2 flex flex-wrap gap-2">
        <span
          v-for="topic in customTopics"
          :key="topic"
          class="flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm"
        >
          {{ topic }}
          <button type="button" class="text-muted-foreground hover:text-foreground" @click="emit('removeCustom', topic)">
            <X class="h-3 w-3" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>
