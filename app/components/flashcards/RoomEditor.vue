<script setup lang="ts">
import { getErrorMessage } from '~~/shared/errors'
import { GripVertical, Plus, Trash2 } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

interface RoomCard {
  _id: Id<'flashcardRoomCards'>
  displayOrder: number
  term: string
  definition: string
  metadata?: {
    source?: {
      documentId?: string
      filename: string
      chunkContent: string
    }
  }
}

const props = defineProps<{
  roomId: Id<'flashcardRooms'>
  cards: RoomCard[]
}>()

const createCardMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.createCard)
  : createSsrMutationStub<typeof api.flashcardRooms.createCard>()

const updateCardMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.updateCard)
  : createSsrMutationStub<typeof api.flashcardRooms.updateCard>()

const deleteCardMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.deleteCard)
  : createSsrMutationStub<typeof api.flashcardRooms.deleteCard>()

const reorderMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.reorderCards)
  : createSsrMutationStub<typeof api.flashcardRooms.reorderCards>()

const localCards = ref<RoomCard[]>([])
const drafts = ref<Record<string, { term: string; definition: string; error: string | null }>>({})
const editingId = ref<string | null>(null)
const savingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const addingNew = ref(false)
const newTerm = ref('')
const newDef = ref('')
const newError = ref<string | null>(null)
const submittingNew = ref(false)
const isReorderPending = ref(false)

watch(
  () => props.cards,
  (next) => {
    if (isReorderPending.value) return
    localCards.value = [...next]
  },
  { immediate: true, deep: true },
)

const dragId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

function onDragStart(cardId: string, e: DragEvent) {
  dragId.value = cardId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', cardId)
  }
}

function onDragOver(cardId: string, e: DragEvent) {
  if (!dragId.value || dragId.value === cardId) return
  e.preventDefault()
  dropTargetId.value = cardId
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDragLeave(cardId: string) {
  if (dropTargetId.value === cardId) dropTargetId.value = null
}

async function onDrop(cardId: string, e: DragEvent) {
  e.preventDefault()
  const sourceId = dragId.value
  dragId.value = null
  dropTargetId.value = null
  if (!sourceId || sourceId === cardId) return

  const prev = [...localCards.value]
  const src = prev.findIndex((c) => c._id === sourceId)
  const dst = prev.findIndex((c) => c._id === cardId)
  if (src === -1 || dst === -1) return

  const next = [...prev]
  const [moved] = next.splice(src, 1)
  next.splice(dst, 0, moved!)
  localCards.value = next

  const order = next.map((c, idx) => ({ cardId: c._id, displayOrder: idx }))
  isReorderPending.value = true
  try {
    await reorderMutation.mutate({ roomId: props.roomId, order })
    isReorderPending.value = false
  }
  catch {
    localCards.value = prev
    const { toast } = await import('vue-sonner')
    toast.error('Reorder failed — retry')
    await nextTick()
    isReorderPending.value = false
  }
}

function onDragEnd() {
  dragId.value = null
  dropTargetId.value = null
}

function startEdit(card: RoomCard) {
  drafts.value = {
    ...drafts.value,
    [card._id]: { term: card.term, definition: card.definition, error: null },
  }
  editingId.value = card._id
}

function cancelEdit(cardId: string) {
  const next = { ...drafts.value }
  Reflect.deleteProperty(next, cardId)
  drafts.value = next
  editingId.value = null
}

function setDraftField(
  cardId: string,
  patch: Partial<{ term: string; definition: string; error: string | null }>,
) {
  const current = drafts.value[cardId]
  if (!current) return
  drafts.value = { ...drafts.value, [cardId]: { ...current, ...patch } }
}

async function saveEdit(cardId: string) {
  const draft = drafts.value[cardId]
  if (!draft) return
  const term = draft.term.trim()
  if (!term) return setDraftField(cardId, { error: 'Term required' })
  const definition = draft.definition.trim()
  if (!definition) return setDraftField(cardId, { error: 'Definition required' })

  savingId.value = cardId
  try {
    await updateCardMutation.mutate({ cardId: cardId as Id<'flashcardRoomCards'>, term, definition })
    cancelEdit(cardId)
    const { toast } = await import('vue-sonner')
    toast.success('Card saved')
  }
  catch (e) {
    setDraftField(cardId, { error: getErrorMessage(e, 'Save failed') })
  }
  finally {
    savingId.value = null
  }
}

async function handleDelete(cardId: string) {
  deletingId.value = cardId
  try {
    await deleteCardMutation.mutate({ cardId: cardId as Id<'flashcardRoomCards'> })
    const { toast } = await import('vue-sonner')
    toast.success('Card deleted')
  }
  catch (e) {
    const { toast } = await import('vue-sonner')
    toast.error(getErrorMessage(e, 'Delete failed'))
  }
  finally {
    deletingId.value = null
  }
}

function startAdd() {
  addingNew.value = true
  newTerm.value = ''
  newDef.value = ''
  newError.value = null
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="flashcard-room-new-term"]')
    el?.focus()
  })
}

function cancelAdd() {
  addingNew.value = false
  newTerm.value = ''
  newDef.value = ''
  newError.value = null
}

async function submitAdd() {
  const term = newTerm.value.trim()
  if (!term) {
    newError.value = 'Term required'
    return
  }
  const definition = newDef.value.trim()
  if (!definition) {
    newError.value = 'Definition required'
    return
  }
  submittingNew.value = true
  try {
    await createCardMutation.mutate({
      roomId: props.roomId,
      term,
      definition,
    })
    cancelAdd()
  }
  catch (e) {
    newError.value = getErrorMessage(e, 'Failed to add card')
  }
  finally {
    submittingNew.value = false
  }
}
</script>

<template>
  <div data-testid="flashcard-room-editor" class="flex flex-col gap-3 p-5">
    <div v-if="localCards.length === 0 && !addingNew" class="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-card/40 p-12 text-center">
      <p class="font-dm-sans text-lg font-semibold text-foreground">No cards yet</p>
      <p class="max-w-md font-inter text-sm text-muted-foreground">
        Add your first card, or use Generate to let the AI build a deck from your folder documents.
      </p>
      <UiButton data-testid="flashcard-room-add-first-card" @click="startAdd">
        <Plus class="mr-1.5 h-4 w-4" />
        Add first card
      </UiButton>
    </div>

    <template v-else>
      <div class="flex items-center justify-end">
        <UiButton
          v-if="!addingNew"
          size="sm"
          data-testid="flashcard-room-add-card"
          @click="startAdd"
        >
          <Plus class="mr-1.5 h-4 w-4" />
          Add card
        </UiButton>
      </div>

      <div
        v-for="(card, i) in localCards"
        :key="card._id"
        :data-testid="`flashcard-room-card-row`"
        :class="[
          'group min-w-0 overflow-hidden rounded-lg border bg-card p-4 transition-colors',
          dropTargetId === card._id ? 'border-primary/70' : 'border-border/60',
          dragId === card._id ? 'opacity-50' : '',
        ]"
        :draggable="editingId !== card._id"
        @dragstart="(e) => onDragStart(card._id, e)"
        @dragover="(e) => onDragOver(card._id, e)"
        @dragleave="onDragLeave(card._id)"
        @drop="(e) => onDrop(card._id, e)"
        @dragend="onDragEnd"
      >
        <div v-if="editingId !== card._id" class="flex min-w-0 items-start gap-3">
          <button
            type="button"
            class="shrink-0 cursor-grab rounded-md p-1 text-muted-foreground opacity-60 transition group-hover:opacity-100"
            :data-testid="`flashcard-room-card-handle`"
            :aria-label="`Drag card ${i + 1}`"
          >
            <GripVertical class="h-4 w-4" />
          </button>
          <div class="min-w-0 flex-1 space-y-1">
            <p class="font-dm-sans text-[15px] font-medium text-foreground">
              <span class="pr-1 text-muted-foreground">{{ i + 1 }}.</span>
              {{ card.term }}
            </p>
            <p class="font-inter text-sm text-muted-foreground">{{ card.definition }}</p>
            <div
              v-if="card.metadata?.source?.filename"
              class="mt-2 flex min-w-0 items-start gap-2 text-xs text-muted-foreground"
            >
              <ChatCitationBadge :index="i + 1" :filename="card.metadata.source.filename" />
              <span class="min-w-0 flex-1 wrap-break-word line-clamp-4">{{ card.metadata.source.chunkContent }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <UiButton
              variant="outline"
              size="sm"
              :data-testid="`flashcard-room-card-edit`"
              @click="startEdit(card)"
            >
              Edit
            </UiButton>
            <UiButton
              variant="ghost"
              size="sm"
              class="text-destructive hover:text-destructive"
              :data-testid="`flashcard-room-card-delete`"
              :disabled="deletingId === card._id"
              @click="handleDelete(card._id)"
            >
              <Trash2 class="h-4 w-4" />
            </UiButton>
          </div>
        </div>

        <div v-else-if="drafts[card._id]" class="space-y-3">
          <div>
            <UiLabel class="text-xs font-medium">Term</UiLabel>
            <textarea
              :value="drafts[card._id]!.term"
              rows="2"
              data-testid="flashcard-room-card-term"
              class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @input="setDraftField(card._id, { term: ($event.target as HTMLTextAreaElement).value, error: null })"
            />
          </div>
          <div>
            <UiLabel class="text-xs font-medium">Definition</UiLabel>
            <textarea
              :value="drafts[card._id]!.definition"
              rows="3"
              data-testid="flashcard-room-card-definition"
              class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @input="setDraftField(card._id, { definition: ($event.target as HTMLTextAreaElement).value, error: null })"
            />
          </div>
          <div
            v-if="drafts[card._id]!.error"
            data-testid="flashcard-room-card-error"
            class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {{ drafts[card._id]!.error }}
          </div>
          <div class="flex items-center justify-end gap-2">
            <UiButton
              variant="ghost"
              size="sm"
              data-testid="flashcard-room-card-cancel"
              :disabled="savingId === card._id"
              @click="cancelEdit(card._id)"
            >
              Cancel
            </UiButton>
            <UiButton
              size="sm"
              data-testid="flashcard-room-card-save"
              :disabled="savingId === card._id"
              @click="saveEdit(card._id)"
            >
              Save
            </UiButton>
          </div>
        </div>
      </div>

      <div v-if="addingNew" class="space-y-3 rounded-lg border border-primary/40 bg-card p-4" data-testid="flashcard-room-new-row">
        <div>
          <UiLabel class="text-xs font-medium">Term</UiLabel>
          <input
            v-model="newTerm"
            type="text"
            data-testid="flashcard-room-new-term"
            class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
        </div>
        <div>
          <UiLabel class="text-xs font-medium">Definition</UiLabel>
          <textarea
            v-model="newDef"
            rows="3"
            data-testid="flashcard-room-new-definition"
            class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div
          v-if="newError"
          data-testid="flashcard-room-new-error"
          class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {{ newError }}
        </div>
        <div class="flex items-center justify-end gap-2">
          <UiButton
            variant="ghost"
            size="sm"
            data-testid="flashcard-room-new-cancel"
            :disabled="submittingNew"
            @click="cancelAdd"
          >
            Cancel
          </UiButton>
          <UiButton
            size="sm"
            data-testid="flashcard-room-new-save"
            :disabled="submittingNew"
            @click="submitAdd"
          >
            Save card
          </UiButton>
        </div>
      </div>
    </template>
  </div>
</template>
