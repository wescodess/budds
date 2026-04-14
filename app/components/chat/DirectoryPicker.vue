<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'
import type { useReferenceScope } from '~/composables/useReferenceScope'

const props = defineProps<{
  folderId: Id<'folders'>
  scope: ReturnType<typeof useReferenceScope>
}>()

const emit = defineEmits<{
  close: []
}>()

const expanded = ref<Set<string>>(new Set())
const search = ref('')

function toggleExpand(id: Id<'folders'>) {
  const key = id as unknown as string
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
</script>

<template>
  <div
    data-testid="directory-picker"
    class="flex w-[360px] flex-col overflow-hidden rounded-xl border bg-card text-sm shadow-lg"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div class="flex flex-col">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Reference scope
        </span>
        <span class="text-sm font-semibold">
          {{ props.scope.totalFileCount.value }} file{{ props.scope.totalFileCount.value === 1 ? '' : 's' }} selected
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="props.scope.hasSelection.value"
          type="button"
          class="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
          @click="props.scope.clear()"
        >
          Clear
        </button>
        <button
          type="button"
          aria-label="Close directory picker"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="border-b px-3 py-2">
      <input
        v-model="search"
        type="search"
        placeholder="Search files and folders"
        class="w-full rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
    </div>

    <div class="max-h-80 flex-1 overflow-y-auto py-1">
      <ChatDirectoryPickerBranch
        :folder-id="props.folderId"
        :depth="0"
        :scope="props.scope"
        :expanded="expanded"
        @toggle-expand="toggleExpand"
      />
    </div>
  </div>
</template>
