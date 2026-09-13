<script setup lang="ts">
import { toast } from 'vue-sonner'
import { getErrorMessage } from '~~/shared/errors'
import { Layers, MoreHorizontal, Plus, Trash2 } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useGestureGuards } from '~/composables/useGestureGuards'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

const props = defineProps<{
  folderId: Id<'folders'>
  selectedRoomId?: string | null
}>()

const emit = defineEmits<{
  'select-room': [roomId: string | null]
  generationStarted: []
}>()

const { rooms, hasIndexedDocuments } = useFlashcardRooms(toRef(props, 'folderId'))

const deleteRoomMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.deleteRoom)
  : createSsrMutationStub<typeof api.flashcardRooms.deleteRoom>()

const createRoomMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.createRoom)
  : createSsrMutationStub<typeof api.flashcardRooms.createRoom>()

const activeRoomId = ref<Id<'flashcardRooms'> | null>(null)
const openMenuId = ref<string | null>(null)
const confirmingDeleteId = ref<string | null>(null)
const deleting = ref(false)
const creating = ref(false)
const { isTouchLike } = useGestureGuards()

watch(
  () => props.selectedRoomId,
  (next) => {
    activeRoomId.value = (next as Id<'flashcardRooms'> | null | undefined) ?? null
  },
  { immediate: true },
)

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
  if (openMenuId.value !== id) confirmingDeleteId.value = null
}

function handleOpen(id: string) {
  activeRoomId.value = id as Id<'flashcardRooms'>
  emit('select-room', id)
}

function handleBack() {
  activeRoomId.value = null
  emit('select-room', null)
}

function handleDeleteClick(id: string) {
  confirmingDeleteId.value = id
}

function handleDeleteCancel() {
  confirmingDeleteId.value = null
}

async function handleDeleteConfirm(id: string) {
  deleting.value = true
  try {
    await deleteRoomMutation.mutate({ roomId: id as Id<'flashcardRooms'> })
    confirmingDeleteId.value = null
    openMenuId.value = null
    if (activeRoomId.value === id) handleBack()
    toast.success('Room deleted')
  }
  catch (e) {
    toast.error(getErrorMessage(e, 'Failed to delete room'))
  }
  finally {
    deleting.value = false
  }
}

async function handleCreate() {
  if (creating.value) return
  creating.value = true
  try {
    const result = await createRoomMutation.mutate({
      folderId: props.folderId,
    })
    if (result?.roomId) {
      activeRoomId.value = result.roomId
      emit('select-room', result.roomId as unknown as string)
    }
  }
  catch (e) {
    toast.error(getErrorMessage(e, 'Failed to create room'))
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col" data-testid="flashcards-tab-content">
    <FlashcardsRoomShell
      v-if="activeRoomId"
      :room-id="activeRoomId"
      :folder-id="folderId"
      @back="handleBack"
      @room-deleted="handleBack"
      @generation-started="emit('generationStarted')"
    />

    <template v-else>
      <div class="flex flex-col gap-4 overflow-y-auto p-6">
        <template v-if="!hasIndexedDocuments && rooms.length === 0">
          <div
            data-testid="flashcards-empty-no-docs"
            class="flex flex-1 items-center justify-center py-12 text-muted-foreground"
          >
            <div class="text-center">
              <Layers class="mx-auto mb-3 h-12 w-12 opacity-40" />
              <p class="text-lg font-medium">Upload and index documents to generate flash cards</p>
            </div>
          </div>
        </template>

        <template v-else-if="rooms.length === 0">
          <div
            data-testid="flashcards-empty-ready"
            class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-muted-foreground"
          >
            <Layers class="h-12 w-12 opacity-40" />
            <p class="text-lg font-medium">No flash card rooms yet</p>
            <UiButton
              data-testid="flashcards-create-room-button"
              :disabled="creating"
              @click="handleCreate"
            >
              <Plus class="mr-1.5 h-4 w-4" />
              Create flash card room
            </UiButton>
          </div>
        </template>

        <template v-else>
          <div class="flex items-center justify-between">
            <h2 class="font-dm-sans text-lg font-semibold">Rooms</h2>
            <UiButton
              size="sm"
              data-testid="flashcards-create-room-button"
              :disabled="creating"
              @click="handleCreate"
            >
              <Plus class="mr-1.5 h-4 w-4" />
              New room
            </UiButton>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="room in rooms"
              :key="room._id"
              data-testid="flashcards-room-card"
              class="group relative flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4 transition hover:border-primary/50"
            >
              <button
                type="button"
                class="flex flex-col items-start gap-1 text-left"
                :data-testid="`flashcards-room-open-${room._id}`"
                @click="handleOpen(String(room._id))"
              >
                <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers class="h-4 w-4" />
                </div>
                <p class="mt-2 font-dm-sans text-sm font-semibold text-foreground">{{ room.title }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ room.cardCount }} card{{ room.cardCount === 1 ? '' : 's' }}
                </p>
              </button>

              <button
                v-if="!isTouchLike"
                type="button"
                class="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                data-testid="flashcards-room-menu"
                aria-label="Room actions"
                @click.stop="toggleMenu(String(room._id))"
              >
                <MoreHorizontal class="h-4 w-4" />
              </button>

              <div
                v-if="openMenuId === room._id"
                data-testid="flashcards-room-actions"
                class="mt-1 flex items-center gap-2 border-t border-border/60 pt-2"
              >
                <template v-if="confirmingDeleteId === room._id">
                  <UiButton
                    variant="destructive"
                    size="sm"
                    :disabled="deleting"
                    data-testid="flashcards-room-delete-confirm"
                    @click.stop="handleDeleteConfirm(String(room._id))"
                  >
                    <Trash2 class="mr-1.5 h-3 w-3" />
                    Confirm
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="deleting"
                    data-testid="flashcards-room-delete-cancel"
                    @click.stop="handleDeleteCancel"
                  >
                    Cancel
                  </UiButton>
                </template>
                <template v-else>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    data-testid="flashcards-room-delete"
                    @click.stop="handleDeleteClick(String(room._id))"
                  >
                    <Trash2 class="mr-1.5 h-3 w-3" />
                    Delete
                  </UiButton>
                </template>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
