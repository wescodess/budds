<script setup lang="ts">
import { Layers, Plus } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'

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
</script>

<template>
  <div data-testid="flashcards-tab-content">
    <template v-if="activeSetId">
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
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
