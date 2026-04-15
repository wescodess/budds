<script setup lang="ts">
import { Layers, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useGestureGuards } from '~/composables/useGestureGuards'

const props = defineProps<{
  folderId: Id<'folders'>
}>()

const {
  sets,
  hasIndexedDocuments,
  generating,
  lastError,
  generate,
} = useFlashcards(toRef(props, 'folderId'))

const activeSetId = ref<Id<'flashcardSets'> | null>(null)
const editingSetId = ref<Id<'flashcardSets'> | null>(null)
const openMenuSetId = ref<string | null>(null)
const confirmingDeleteSetId = ref<string | null>(null)
const deleting = ref(false)
const liveMessage = ref('')
const swipeOpenSetId = ref<string | null>(null)
const { isTouchLike } = useGestureGuards()

const deleteSetMutation = import.meta.client
  ? useConvexMutation(api.flashcards.deleteSet)
  : {
      mutate: async (_args: unknown): Promise<any> => null,
      isLoading: ref(false),
    }

async function handleGenerate() {
  try {
    await generate()
    const { toast } = await import('vue-sonner')
    toast.success('Flash cards generated')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(lastError.value || e?.message || 'Failed to generate flash cards')
  }
}

function handleSetSelect(setId: string) {
  activeSetId.value = setId as Id<'flashcardSets'>
}

function handleStudyBack() {
  activeSetId.value = null
}

function handleEditorBack() {
  editingSetId.value = null
}

function toggleMenu(setId: string) {
  openMenuSetId.value = openMenuSetId.value === setId ? null : setId
  if (openMenuSetId.value !== setId) {
    confirmingDeleteSetId.value = null
  }
}

function handleEditSet(setId: string) {
  openMenuSetId.value = null
  confirmingDeleteSetId.value = null
  swipeOpenSetId.value = null
  editingSetId.value = setId as Id<'flashcardSets'>
}

function handleDeleteClick(setId: string) {
  swipeOpenSetId.value = null
  confirmingDeleteSetId.value = setId
}

function handleDeleteCancel() {
  confirmingDeleteSetId.value = null
}

function handleSwipeSetOpen(setId: string, next: boolean) {
  swipeOpenSetId.value = next ? setId : (swipeOpenSetId.value === setId ? null : swipeOpenSetId.value)
}

async function handleDeleteConfirm(setId: string) {
  deleting.value = true
  try {
    await deleteSetMutation.mutate({ setId } as any)
    confirmingDeleteSetId.value = null
    openMenuSetId.value = null
    liveMessage.value = 'Flash card set deleted'
    setTimeout(() => {
      if (liveMessage.value === 'Flash card set deleted') liveMessage.value = ''
    }, 3000)
    const { toast } = await import('vue-sonner')
    toast.success('Flash card set deleted')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to delete flash card set')
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto p-6" data-testid="flashcards-tab-content">
    <span class="sr-only" aria-live="polite" data-testid="flashcards-tab-live">{{ liveMessage }}</span>

    <template v-if="editingSetId">
      <FlashcardsEditor :set-id="editingSetId" @back="handleEditorBack" />
    </template>

    <template v-else-if="activeSetId">
      <FlashcardsStudy :set-id="activeSetId" @back="handleStudyBack" />
    </template>

    <template v-else-if="!hasIndexedDocuments">
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

    <template v-else-if="generating">
      <div data-testid="flashcards-shimmer" class="space-y-3">
        <UiSkeleton v-for="i in 3" :key="i" class="h-30 w-full rounded-md" />
      </div>
    </template>

    <template v-else-if="sets.length === 0">
      <div
        data-testid="flashcards-empty-ready"
        class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-muted-foreground"
      >
        <Layers class="h-12 w-12 opacity-40" />
        <p class="text-lg font-medium">No flash card sets yet</p>
        <UiButton data-testid="flashcards-generate-button" @click="handleGenerate">
          <Plus class="mr-1.5 h-4 w-4" />
          Generate Flash Cards
        </UiButton>
      </div>
    </template>

    <template v-else>
      <div class="space-y-3">
        <div class="flex items-center justify-end">
          <UiButton data-testid="flashcards-generate-button" size="sm" @click="handleGenerate">
            <Plus class="mr-1.5 h-4 w-4" />
            Generate Flash Cards
          </UiButton>
        </div>
        <div
          v-for="set in sets"
          :key="set._id"
        >
          <MobileSwipeRevealItem
            :open="swipeOpenSetId === set._id"
            :disabled="!isTouchLike"
            :action-width="96"
            class="rounded-md"
            content-class="rounded-md"
            @update:open="(next) => handleSwipeSetOpen(set._id, next)"
          >
            <template #actions>
              <button
                type="button"
                data-swipe-reveal-action
                :aria-label="`Edit ${set.title}`"
                class="flex h-full w-1/2 items-center justify-center bg-muted text-foreground"
                @click="handleEditSet(set._id)"
              >
                <Pencil class="h-4 w-4" />
              </button>
              <button
                type="button"
                data-swipe-reveal-action
                :aria-label="`Delete ${set.title}`"
                class="flex h-full w-1/2 items-center justify-center bg-destructive text-destructive-foreground"
                @click="handleDeleteClick(set._id)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </template>

            <div
              class="rounded-md border"
              data-testid="flashcards-set-card"
            >
              <div
                role="button"
                tabindex="0"
                class="flex cursor-pointer items-center justify-between p-4 hover:bg-accent/50"
                @click="handleSetSelect(set._id)"
                @keydown.enter="handleSetSelect(set._id)"
                @keydown.space.prevent="handleSetSelect(set._id)"
              >
                <div class="flex flex-col gap-1">
                  <p class="font-medium">{{ set.title }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ new Date(set._creationTime).toLocaleDateString() }}
                    &middot;
                    {{ set.cardCount }} cards
                  </p>
                </div>
                <button
                  v-if="!isTouchLike"
                  type="button"
                  class="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  data-testid="flashcards-set-menu"
                  aria-label="Flash card set actions"
                  @click.stop="toggleMenu(set._id)"
                >
                  <MoreHorizontal class="h-4 w-4" />
                </button>
              </div>

              <div
                v-if="openMenuSetId === set._id"
                class="flex items-center gap-2 border-t px-4 py-2"
                data-testid="flashcards-set-actions"
              >
                <template v-if="confirmingDeleteSetId === set._id">
                  <UiButton
                    variant="destructive"
                    size="sm"
                    :disabled="deleting"
                    data-testid="flashcards-set-delete-confirm"
                    @click.stop="handleDeleteConfirm(set._id)"
                  >
                    <Trash2 class="mr-1.5 h-3 w-3" />
                    Confirm delete
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="deleting"
                    data-testid="flashcards-set-delete-cancel"
                    @click.stop="handleDeleteCancel"
                  >
                    Cancel
                  </UiButton>
                </template>
                <template v-else>
                  <UiButton
                    variant="outline"
                    size="sm"
                    data-testid="flashcards-set-edit"
                    @click.stop="handleEditSet(set._id)"
                  >
                    <Pencil class="mr-1.5 h-3 w-3" />
                    Edit
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    data-testid="flashcards-set-delete"
                    @click.stop="handleDeleteClick(set._id)"
                  >
                    <Trash2 class="mr-1.5 h-3 w-3" />
                    Delete
                  </UiButton>
                </template>
              </div>
            </div>
          </MobileSwipeRevealItem>
        </div>
      </div>
    </template>
  </div>
</template>
