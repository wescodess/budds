<script setup lang="ts">
import { useTeachingQuery } from '~/composables/useTeachingQuery'

import { toast } from 'vue-sonner'
import { getErrorMessage } from '~~/shared/errors'
import { CircleAlert, History, Pencil, Play, Sparkles, Loader2 } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

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

const roomQuery = useTeachingQuery(
  api.flashcardRooms.getRoom,
  computed(() => ({ roomId: props.roomId })),
)

const renameMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.renameRoom)
  : createSsrMutationStub<typeof api.flashcardRooms.renameRoom>()

const deleteMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.deleteRoom)
  : createSsrMutationStub<typeof api.flashcardRooms.deleteRoom>()

const roomData = roomQuery.data
const roomFailure = computed(() => roomQuery.failure.value)
const room = computed(() => roomData.value?.room ?? null)
const cards = computed(() => roomData.value?.cards ?? [])
const cardCount = computed(() => cards.value.length)

function metadataRoomId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !('roomId' in metadata)) return undefined
  return typeof metadata.roomId === 'string' ? metadata.roomId : undefined
}

const { tasks, cancel: cancelTask } = useTasks(toRef(props, 'folderId'))

const runningTaskForRoom = computed(() =>
  tasks.value.find(
    (t) =>
      (t.status === 'pending' || t.status === 'running') &&
      t.type === 'flashcard-generation' &&
      metadataRoomId(t.metadata) === props.roomId,
  ) ?? null,
)

const mode = ref<Mode>('editor')
const historyOpen = ref(false)
const generateOpen = ref(false)
const roomPaused = computed(() => roomFailure.value?.retryable === false)

watch(roomPaused, (paused) => {
  if (!paused) return
  mode.value = 'editor'
  historyOpen.value = false
  generateOpen.value = false
})
const confirmDeleteOpen = ref(false)

const lastUpdated = computed<number | null>(() => {
  if (!room.value) return null
  return room.value.updatedAt ?? room.value.legacyCreatedAt ?? room.value._creationTime
})

async function handleRename(next: string) {
  try {
    await renameMutation.mutate({ roomId: props.roomId, title: next })
    toast.success('Room renamed')
  }
  catch (e) {
    toast.error(getErrorMessage(e, 'Failed to rename room'))
  }
}

async function handleConfirmDelete() {
  try {
    await deleteMutation.mutate({ roomId: props.roomId })
    toast.success('Room deleted')
    confirmDeleteOpen.value = false
    emit('room-deleted', props.roomId)
  }
  catch (e) {
    toast.error(getErrorMessage(e, 'Failed to delete room'))
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
    <div v-else-if="!roomFailure" class="flex items-center gap-3 border-b border-border/60 px-5 py-4">
      <UiSkeleton class="h-9 w-9 rounded-lg" />
      <UiSkeleton class="h-6 w-40 rounded-md" />
    </div>

    <div class="flex items-center justify-between gap-3 border-b border-border/60 bg-card/40 px-5 py-3">
      <div class="flex items-center gap-1 rounded-full border border-border/60 bg-background p-1">
        <button
          type="button"
          :class="[
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
            mode === 'editor' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          ]"
          data-testid="flashcard-room-mode-editor"
          :disabled="roomPaused"
          @click="mode = 'editor'"
        >
          <Pencil class="h-3.5 w-3.5" />
          Editor
        </button>
        <button
          type="button"
          :class="[
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
            mode === 'practice' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          ]"
          data-testid="flashcard-room-mode-practice"
          :disabled="roomPaused"
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
          :disabled="roomPaused"
          @click="historyOpen = true"
        >
          <History class="mr-1.5 h-4 w-4" />
          History
        </UiButton>
        <UiButton
          size="sm"
          data-testid="flashcard-room-generate-trigger"
          :disabled="roomPaused"
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
      <div v-if="roomFailure" class="p-5">
        <p v-if="roomFailure && !roomFailure.retryable" role="status" data-testid="flashcards-read-paused" class="flex items-start gap-2 rounded-lg border border-border px-4 py-3 text-sm leading-6 text-foreground forced-colors:border-current"><CircleAlert class="mt-1 size-4 shrink-0 text-[var(--learn-attention)]" aria-hidden="true" /><span class="min-w-0">{{ roomFailure.message }}</span></p>
        <div v-else-if="roomFailure" role="alert" data-testid="flashcards-read-error" class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive forced-colors:border-current"><p>Could not load these flashcards.</p><button type="button" data-testid="flashcards-read-retry" class="mt-2 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="roomQuery.refresh?.()">Try again</button></div>
      </div>
      <FlashcardsRoomEditor
        v-else-if="mode === 'editor'"
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
