<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { useReferenceScope } from '~/composables/useReferenceScope'

const props = defineProps<{
  folderId: Id<'folders'>
  depth: number
  scope: ReturnType<typeof useReferenceScope>
  expanded: Set<string>
}>()

const emit = defineEmits<{
  'toggle-expand': [folderId: Id<'folders'>]
}>()

const { data, pending } = useConvexQuery(api.folders.listSubtree, { folderId: props.folderId })

const subfolders = computed(() => data.value?.subfolders ?? [])
const files = computed(() => data.value?.files ?? [])
const isEmpty = computed(() =>
  !pending.value && subfolders.value.length === 0 && files.value.length === 0,
)

function folderState(id: Id<'folders'>) {
  return props.scope.isFolderSelected(id) ? 'on' : 'off'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div>
    <ChatDirectoryPickerRow
      v-for="sub in subfolders"
      :key="sub.id"
      kind="folder"
      :label="sub.name"
      :badge="`${sub.descendantFileCount} file${sub.descendantFileCount === 1 ? '' : 's'}`"
      :state="folderState(sub.id)"
      :depth="props.depth"
      :expandable="sub.hasChildren || sub.fileCount > 0"
      :expanded="props.expanded.has(sub.id as unknown as string)"
      @toggle="props.scope.toggleFolder(sub)"
      @toggle-expand="emit('toggle-expand', sub.id)"
    />
    <template v-for="sub in subfolders" :key="`${sub.id}-children`">
      <ChatDirectoryPickerBranch
        v-if="props.expanded.has(sub.id as unknown as string)"
        :folder-id="sub.id"
        :depth="props.depth + 1"
        :scope="props.scope"
        :expanded="props.expanded"
        @toggle-expand="(id) => emit('toggle-expand', id)"
      />
    </template>
    <ChatDirectoryPickerRow
      v-for="file in files"
      :key="file.id"
      kind="file"
      :label="file.filename"
      :sublabel="formatSize(file.fileSize)"
      :state="props.scope.isFileSelected(file.id) ? 'on' : 'off'"
      :depth="props.depth"
      @toggle="props.scope.toggleFile(file)"
    />
    <div
      v-if="pending"
      :style="{ paddingLeft: `${props.depth * 16 + 40}px` }"
      class="flex items-center gap-2 py-1.5 text-xs text-muted-foreground"
      data-testid="picker-loading"
    >
      <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
      <span class="inline-block h-3 w-24 animate-pulse rounded bg-muted" />
    </div>
    <div
      v-else-if="isEmpty"
      :style="{ paddingLeft: `${props.depth * 16 + 40}px` }"
      class="py-1.5 text-xs italic text-muted-foreground"
      data-testid="picker-empty"
    >
      No files
    </div>
  </div>
</template>
