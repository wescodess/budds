<script setup lang="ts">
import { ArrowLeft, Pencil, Trash2 } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

interface FlashcardRow {
  _id: string
  setId: string
  userId: string
  order: number
  front: string
  back: string
  sourceDocumentId?: string
  sourceChunkContent: string
  sourceFilename: string
}

interface FlashcardSetRow {
  _id: string
  _creationTime: number
  userId: string
  folderId: string
  title: string
  status: 'generating' | 'ready' | 'failed'
  cardCount: number
}

interface Draft {
  front: string
  back: string
  error: string | null
}

const props = defineProps<{
  setId: Id<'flashcardSets'>
}>()

const emit = defineEmits<{
  back: []
}>()

const { data: setData } = useConvexQuery(
  api.flashcards.getSetWithCards,
  computed(() => ({ id: props.setId })),
)

const updateCardMutation = import.meta.client
  ? useConvexMutation(api.flashcards.updateCard)
  : {
      mutate: async (_args: unknown): Promise<any> => null,
      isLoading: ref(false),
    }

const deleteCardMutation = import.meta.client
  ? useConvexMutation(api.flashcards.deleteCard)
  : {
      mutate: async (_args: unknown): Promise<any> => null,
      isLoading: ref(false),
    }

type EditorState = 'loading' | 'ready' | 'error'
const state = ref<EditorState>('loading')
const editingCardId = ref<string | null>(null)
const confirmingDeleteCardId = ref<string | null>(null)
const drafts = ref<Record<string, Draft>>({})
const saving = ref(false)
const deleting = ref(false)

const set = computed<FlashcardSetRow | null>(() => {
  const d = setData.value as { set: FlashcardSetRow; cards: FlashcardRow[] } | null | undefined
  return d?.set ?? null
})

const cards = computed<FlashcardRow[]>(() => {
  const d = setData.value as { set: FlashcardSetRow; cards: FlashcardRow[] } | null | undefined
  return d?.cards ?? []
})

watch(
  setData,
  (val) => {
    if (val === undefined) {
      state.value = 'loading'
      return
    }
    if (val === null) {
      state.value = 'error'
      return
    }
    state.value = 'ready'
  },
  { immediate: true },
)

function startEdit(card: FlashcardRow) {
  drafts.value = {
    ...drafts.value,
    [card._id]: {
      front: card.front,
      back: card.back,
      error: null,
    },
  }
  editingCardId.value = card._id
  confirmingDeleteCardId.value = null
}

function cancelEdit(cardId: string) {
  const next = { ...drafts.value }
  delete next[cardId]
  drafts.value = next
  if (editingCardId.value === cardId) editingCardId.value = null
}

function setDraftField(cardId: string, patch: Partial<Draft>) {
  const current = drafts.value[cardId]
  if (!current) return
  drafts.value = { ...drafts.value, [cardId]: { ...current, ...patch } }
}

async function saveEdit(cardId: string) {
  const draft = drafts.value[cardId]
  if (!draft) return

  const trimmedFront = draft.front.trim()
  if (trimmedFront.length === 0) {
    setDraftField(cardId, { error: 'Front text required' })
    return
  }
  const trimmedBack = draft.back.trim()
  if (trimmedBack.length === 0) {
    setDraftField(cardId, { error: 'Back text required' })
    return
  }

  saving.value = true
  try {
    await updateCardMutation.mutate({
      cardId,
      front: trimmedFront,
      back: trimmedBack,
    } as any)
    cancelEdit(cardId)
    const { toast } = await import('vue-sonner')
    toast.success('Card updated')
  }
  catch (e: any) {
    const msg = e?.message || 'Failed to save card'
    setDraftField(cardId, { error: msg })
  }
  finally {
    saving.value = false
  }
}

function handleDeleteClick(cardId: string) {
  confirmingDeleteCardId.value = cardId
  if (editingCardId.value === cardId) {
    cancelEdit(cardId)
  }
}

function handleDeleteCancel() {
  confirmingDeleteCardId.value = null
}

async function handleDeleteConfirm(cardId: string) {
  deleting.value = true
  try {
    await deleteCardMutation.mutate({ cardId } as any)
    confirmingDeleteCardId.value = null
    const { toast } = await import('vue-sonner')
    toast.success('Card deleted')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to delete card')
  }
  finally {
    deleting.value = false
  }
}

function handleBack() {
  emit('back')
}
</script>

<template>
  <div data-testid="flashcards-editor" data-gesture-owner="flashcards-editor">
    <div v-if="state === 'loading'" class="space-y-3" data-testid="flashcards-editor-loading">
      <UiSkeleton v-for="i in 3" :key="i" class="h-32 w-full rounded-md animate-pulse" />
    </div>

    <div v-else-if="state === 'error'" class="rounded-md border p-6 text-center">
      <p class="font-medium">Flash card set not found</p>
      <p class="mt-1 text-sm text-muted-foreground">This set may have been deleted.</p>
      <UiButton class="mt-4" variant="outline" data-testid="flashcards-editor-back" @click="handleBack">
        <ArrowLeft class="mr-1.5 h-4 w-4" />
        Back
      </UiButton>
    </div>

    <div v-else class="space-y-4">
      <div class="flex items-center justify-between">
        <UiButton variant="ghost" size="sm" data-testid="flashcards-editor-back" @click="handleBack">
          <ArrowLeft class="mr-1.5 h-4 w-4" />
          Back to sets
        </UiButton>
        <h2 class="text-lg font-semibold">Edit: {{ set?.title }}</h2>
      </div>

      <div v-if="cards.length === 0" class="rounded-md border p-6 text-center text-sm text-muted-foreground">
        No cards remaining — return to the sets list and delete the set or regenerate.
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="(card, i) in cards"
          :key="card._id"
          class="rounded-md border p-4"
          data-testid="flashcards-editor-card-row"
        >
          <div v-if="editingCardId !== card._id && confirmingDeleteCardId !== card._id">
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 space-y-2">
                <p class="font-medium">
                  <span class="text-muted-foreground">{{ i + 1 }}.</span>
                  {{ card.front }}
                </p>
                <p class="text-sm text-muted-foreground">{{ card.back }}</p>
              </div>
              <div class="flex flex-shrink-0 items-center gap-2">
                <UiButton
                  variant="outline"
                  size="sm"
                  data-testid="flashcards-editor-card-edit"
                  @click="startEdit(card)"
                >
                  <Pencil class="mr-1.5 h-3 w-3" />
                  Edit
                </UiButton>
                <UiButton
                  variant="ghost"
                  size="sm"
                  class="text-destructive hover:text-destructive"
                  data-testid="flashcards-editor-card-delete"
                  @click="handleDeleteClick(card._id)"
                >
                  <Trash2 class="mr-1.5 h-3 w-3" />
                  Delete
                </UiButton>
              </div>
            </div>
          </div>

          <div v-else-if="editingCardId === card._id && drafts[card._id]" class="space-y-3">
            <div>
              <UiLabel class="text-xs font-medium">Front</UiLabel>
              <textarea
                :value="drafts[card._id]!.front"
                rows="2"
                autocapitalize="sentences"
                autocorrect="on"
                spellcheck="true"
                enterkeyhint="next"
                class="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="flashcards-editor-card-front"
                @input="setDraftField(card._id, { front: ($event.target as HTMLTextAreaElement).value })"
              />
            </div>
            <div>
              <UiLabel class="text-xs font-medium">Back</UiLabel>
              <textarea
                :value="drafts[card._id]!.back"
                rows="3"
                autocapitalize="sentences"
                autocorrect="on"
                spellcheck="true"
                enterkeyhint="done"
                class="mt-1 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="flashcards-editor-card-back"
                @input="setDraftField(card._id, { back: ($event.target as HTMLTextAreaElement).value })"
              />
            </div>

            <div
              v-if="drafts[card._id]!.error"
              class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="flashcards-editor-card-error"
            >
              {{ drafts[card._id]!.error }}
            </div>

            <div class="flex items-center justify-end gap-2">
              <UiButton
                variant="ghost"
                size="sm"
                :disabled="saving"
                data-testid="flashcards-editor-card-cancel"
                @click="cancelEdit(card._id)"
              >
                Cancel
              </UiButton>
              <UiButton
                size="sm"
                :disabled="saving"
                data-testid="flashcards-editor-card-save"
                @click="saveEdit(card._id)"
              >
                Save
              </UiButton>
            </div>
          </div>

          <div v-else-if="confirmingDeleteCardId === card._id" class="space-y-3">
            <p class="text-sm">
              <span class="font-medium">{{ card.front }}</span>
            </p>
            <p class="text-sm text-muted-foreground">Delete this card? This cannot be undone.</p>
            <div class="flex items-center justify-end gap-2">
              <UiButton
                variant="ghost"
                size="sm"
                :disabled="deleting"
                data-testid="flashcards-editor-card-delete-cancel"
                @click="handleDeleteCancel"
              >
                Cancel
              </UiButton>
              <UiButton
                variant="destructive"
                size="sm"
                :disabled="deleting"
                data-testid="flashcards-editor-card-delete-confirm"
                @click="handleDeleteConfirm(card._id)"
              >
                <Trash2 class="mr-1.5 h-3 w-3" />
                Confirm delete
              </UiButton>
            </div>
          </div>

          <div class="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <ChatCitationBadge :index="i + 1" :filename="card.sourceFilename" />
            <span class="flex-1 truncate">{{ card.sourceChunkContent }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
