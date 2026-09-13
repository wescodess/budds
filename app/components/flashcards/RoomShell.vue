<script setup lang="ts">
import { History, Pencil, Play, Sparkles, Loader2, X as XIcon } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

type Mode = 'editor' | 'practice'

const props = defineProps<{
  roomId: Id<'flashcardRooms'>
  folderId: Id<'folders'>
}>()

const emit = defineEmits<{
  back: []
  'room-deleted': [roomId: Id<'flashcardRooms'>]
  generationStarted: []
}>()

const { data: roomData } = useConvexQuery(
  api.flashcardRooms.getRoom,
  computed(() => ({ roomId: props.roomId })),
)

const renameMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.renameRoom)
  : { mutate: async (_a: unknown) => null, isLoading: ref(false) }

const deleteMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.deleteRoom)
  : { mutate: async (_a: unknown) => null, isLoading: ref(false) }

const room = computed(() => (roomData.value as any)?.room ?? null)
const cards = computed(() => (roomData.value as any)?.cards ?? [])
const cardCount = computed(() => cards.value.length)

const { tasks, cancel: cancelTask } = useTasks(toRef(props, 'folderId'))

const runningTaskForRoom = computed(() =>
  tasks.value.find(
    (t) =>
      (t.status === 'pending' || t.status === 'running') &&
      t.type === 'flashcard-generation' &&
      (t.metadata as any)?.roomId === props.roomId,
  ) ?? null,
)

const mode = ref<Mode>('editor')
const historyOpen = ref(false)
const generateOpen = ref(false)
const confirmDeleteOpen = ref(false)

const lastUpdated = computed<number | null>(() => {
  if (!room.value) return null
  return room.value.updatedAt ?? room.value.legacyCreatedAt ?? room.value._creationTime
})

async function handleRename(next: string) {
  try {
    await renameMutation.mutate({ roomId: props.roomId, title: next } as any)
    const { toast } = await import('vue-sonner')
    toast.success('Room renamed')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to rename room')
  }
}

async function handleConfirmDelete() {
  try {
    await deleteMutation.mutate({ roomId: props.roomId } as any)
    const { toast } = await import('vue-sonner')
    toast.success('Room deleted')
    confirmDeleteOpen.value = false
    emit('room-deleted', props.roomId)
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to delete room')
  }
}
</script>

<template>
  <div data-testid="flashcard-room-shell" class="flex h-full min-h-0 flex-col">
    <FlashcardsRoomHeader
      v-if="room"
      :title="room.title"
      :last-updated="lastUpdated"
      :card-count="cardCount"
      @rename="handleRename"
      @delete="confirmDeleteOpen = true"
      @back="emit('back')"
    />
    <div v-else class="flex items-center gap-3 border-b border-border/60 px-5 py-4">
      <UiSkeleton class="h-9 w-9 rounded-lg" />
      <UiSkeleton class="h-6 w-40 rounded-md" />
    </div>

    <div class="flex items-center justify-between gap-3 border-b border-border/60 bg-card/40 px-5 py-3">
      <div class="flex items-center gap-1 rounded-full border border-border/60 bg-background p-1">
        <button
          type="button"
          :class="[
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition',
            mode === 'editor' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          ]"
          data-testid="flashcard-room-mode-editor"
          @click="mode = 'editor'"
        >
          <Pencil class="h-3.5 w-3.5" />
          Editor
        </button>
        <button
          type="button"
          :class="[
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition',
            mode === 'practice' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          ]"
          data-testid="flashcard-room-mode-practice"
          @click="mode = 'practice'"
        >
          <Play class="h-3.5 w-3.5" />
          Practice
        </button>
      </div>

      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          data-testid="flashcard-room-history-toggle"
          @click="historyOpen = true"
        >
          <History class="mr-1.5 h-4 w-4" />
          History
        </UiButton>
        <UiButton
          size="sm"
          data-testid="flashcard-room-generate-trigger"
          @click="generateOpen = true"
        >
          <Sparkles class="mr-1.5 h-4 w-4" />
          Generate
        </UiButton>
      </div>
    </div>

    <div
      v-if="runningTaskForRoom"
      data-testid="flashcard-room-generating-banner"
      class="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/5 px-5 py-2 text-sm"
    >
      <Loader2 class="h-3.5 w-3.5 animate-spin text-amber-500" />
      <span class="text-foreground/80">{{ runningTaskForRoom.progress || 'Generating cards…' }}</span>
      <button
        type="button"
        data-testid="flashcard-room-generating-cancel"
        class="ml-auto text-xs text-muted-foreground hover:text-foreground"
        @click="cancelTask(runningTaskForRoom!._id)"
      >
        Cancel
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <FlashcardsRoomEditor
        v-if="mode === 'editor'"
        :room-id="roomId"
        :cards="cards"
      />
      <FlashcardsRoomPractice
        v-else
        :cards="cards"
      />
    </div>

    <FlashcardsRoomHistoryPanel
      v-model:open="historyOpen"
      :room-id="roomId"
    />

    <FlashcardsRoomGenerateDialog
      v-if="generateOpen"
      :open="generateOpen"
      :room-id="roomId"
      :folder-id="folderId"
      :has-existing-cards="cardCount > 0"
      @update:open="(v) => (generateOpen = v)"
      @generation-started="emit('generationStarted')"
    />

    <UiAlertDialog v-model:open="confirmDeleteOpen">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>Delete flash card room?</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            This permanently removes the room and every version in its history.
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
          <UiAlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="flashcard-room-delete-confirm"
            @click="handleConfirmDelete"
          >
            Delete
          </UiAlertDialogAction>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>
  </div>
</template>
