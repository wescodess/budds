<script setup lang="ts">
import type { Doc, Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'MoveToFolderDialog' })

const props = withDefaults(defineProps<{
  open: boolean
  folders: Doc<'folders'>[] | null
  currentFolderId: Id<'folders'>
  pending?: boolean
  itemCount?: number
}>(), {
  pending: false,
  itemCount: 1,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [folderId: Id<'folders'>]
}>()

const selectedFolderId = ref<Id<'folders'> | null>(null)

const folderById = computed(() => new Map((props.folders ?? []).map(folder => [folder._id as string, folder])))
const selectedFolder = computed(() => (
  selectedFolderId.value
    ? folderById.value.get(selectedFolderId.value as unknown as string) ?? null
    : null
))

const dialogDescription = computed(() => (
  props.itemCount > 1
    ? `Choose the destination folder for ${props.itemCount} documents.`
    : 'Choose the destination folder for this document.'
))

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    selectedFolderId.value = null
    return
  }
  selectedFolderId.value = null
})

function closeDialog() {
  emit('update:open', false)
}

function handleSubmit() {
  if (!selectedFolderId.value || props.pending) return
  emit('submit', selectedFolderId.value)
}
</script>

<template>
  <UiDialog :open="open" @update:open="(value: boolean) => emit('update:open', value)">
    <UiDialogContent class="sm:max-w-2xl">
      <UiDialogHeader>
        <UiDialogTitle>Move to folder</UiDialogTitle>
        <UiDialogDescription>{{ dialogDescription }}</UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-3">
        <div class="rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <div class="mb-2 flex items-center justify-between gap-2 px-1">
            <p class="text-sm font-medium text-foreground">Folder tree</p>
            <p class="text-xs text-muted-foreground">Root folders start expanded. Counts show direct subfolders.</p>
          </div>
          <div class="max-h-[22rem] overflow-y-auto pr-1">
            <FolderShellTree
              :folders="folders ?? []"
              :selected-id="selectedFolderId"
              :disabled-ids="[currentFolderId as unknown as string]"
              :show-actions="false"
              count-mode="subfolders"
              :initially-expand-path="false"
              :expand-roots-initially="true"
              @select="selectedFolderId = $event"
            />
          </div>
        </div>

        <div class="rounded-lg border border-dashed border-border/60 px-3 py-2 text-sm">
          <span class="text-muted-foreground">Selected destination:</span>
          <span v-if="selectedFolder" class="ml-2 font-medium text-foreground">{{ selectedFolder.name }}</span>
          <span v-else class="ml-2 text-muted-foreground">Choose a folder from the tree.</span>
        </div>
      </div>

      <UiDialogFooter class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <UiButton variant="ghost" :disabled="pending" @click="closeDialog">
          Cancel
        </UiButton>
        <UiButton
          data-testid="move-folder-submit"
          :disabled="!selectedFolderId || pending"
          @click="handleSubmit"
        >
          {{ pending ? 'Moving...' : 'Move here' }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
