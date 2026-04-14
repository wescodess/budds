<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-vue-next'
import { useSwipe } from '@vueuse/core'
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

const set = computed<FlashcardSetRow | null>(() => {
  const d = setData.value as { set: FlashcardSetRow; cards: FlashcardRow[] } | null | undefined
  return d?.set ?? null
})

const cards = computed<FlashcardRow[]>(() => {
  const d = setData.value as { set: FlashcardSetRow; cards: FlashcardRow[] } | null | undefined
  return d?.cards ?? []
})

const currentIndex = ref(0)
const isFlipped = ref(false)
const isComplete = ref(false)
const sourceExpanded = ref(false)

const currentCard = computed<FlashcardRow | null>(() => cards.value[currentIndex.value] ?? null)

function toggleFlip() {
  if (isComplete.value) return
  isFlipped.value = !isFlipped.value
}

function next() {
  if (isComplete.value) return
  if (currentIndex.value >= cards.value.length - 1) {
    isComplete.value = true
    isFlipped.value = false
    sourceExpanded.value = false
    return
  }
  currentIndex.value += 1
  isFlipped.value = false
  sourceExpanded.value = false
}

function prev() {
  if (isComplete.value) return
  if (currentIndex.value <= 0) return
  currentIndex.value -= 1
  isFlipped.value = false
  sourceExpanded.value = false
}

function restart() {
  currentIndex.value = 0
  isFlipped.value = false
  isComplete.value = false
  sourceExpanded.value = false
}

function handleBack() {
  emit('back')
}

function handleCardKeydown(e: KeyboardEvent) {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    toggleFlip()
  }
}

function handleGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  if (e.key === ' ') {
    if (isComplete.value) return
    e.preventDefault()
    toggleFlip()
  }
  else if (e.key === 'ArrowRight') {
    if (isComplete.value) return
    e.preventDefault()
    next()
  }
  else if (e.key === 'ArrowLeft') {
    if (isComplete.value) return
    e.preventDefault()
    prev()
  }
  else if (e.key === 'Escape') {
    e.preventDefault()
    handleBack()
  }
}

const cardBodyRef = ref<HTMLElement | null>(null)

useSwipe(cardBodyRef, {
  threshold: 40,
  onSwipeEnd(_e, direction) {
    if (isComplete.value) return
    if (direction === 'left') next()
    else if (direction === 'right') prev()
  },
})

onMounted(() => {
  if (import.meta.client) {
    document.addEventListener('keydown', handleGlobalKeydown)
  }
})

onUnmounted(() => {
  if (import.meta.client) {
    document.removeEventListener('keydown', handleGlobalKeydown)
  }
})

const progressLabel = computed(() => {
  if (cards.value.length === 0) return '0 / 0'
  return `${currentIndex.value + 1} / ${cards.value.length}`
})
</script>

<template>
  <div class="flex flex-1 flex-col" data-testid="flashcard-study-root">
    <div class="mb-4 flex items-center justify-between gap-3">
      <UiButton
        variant="ghost"
        size="sm"
        data-testid="flashcard-study-back"
        @click="handleBack"
      >
        <ArrowLeft class="mr-1.5 h-4 w-4" />
        Back
      </UiButton>
      <p v-if="set" class="truncate text-sm font-medium text-muted-foreground">
        {{ set.title }}
      </p>
      <div class="w-16" />
    </div>

    <template v-if="setData === undefined">
      <div class="space-y-3" data-testid="flashcard-study-loading">
        <UiSkeleton class="h-8 w-32 rounded-md" />
        <UiSkeleton class="h-64 w-full rounded-md" />
      </div>
    </template>

    <template v-else-if="setData === null || !set">
      <div
        data-testid="flashcard-study-unavailable"
        class="flex flex-1 items-center justify-center py-12 text-muted-foreground"
      >
        <p class="text-sm">Set not available.</p>
      </div>
    </template>

    <template v-else-if="cards.length === 0">
      <div
        data-testid="flashcard-study-empty"
        class="flex flex-1 items-center justify-center py-12 text-muted-foreground"
      >
        <p class="text-sm">This set has no cards.</p>
      </div>
    </template>

    <template v-else-if="isComplete">
      <div
        data-testid="flashcard-completion"
        class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center"
      >
        <h2 class="text-2xl font-semibold">You finished!</h2>
        <p class="text-muted-foreground">You reviewed {{ cards.length }} cards</p>
        <div class="flex items-center gap-2">
          <UiButton data-testid="flashcard-restart" @click="restart">
            <RotateCcw class="mr-1.5 h-4 w-4" />
            Restart set
          </UiButton>
          <UiButton variant="outline" data-testid="flashcard-back" @click="handleBack">
            Back to list
          </UiButton>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted-foreground" data-testid="flashcard-progress">
            {{ progressLabel }}
          </p>
        </div>

        <div
          ref="cardBodyRef"
          data-testid="flashcard-viewer"
          role="button"
          tabindex="0"
          :aria-pressed="isFlipped"
          :aria-label="isFlipped
            ? `Showing answer: ${currentCard?.back ?? ''}`
            : `Flash card ${currentIndex + 1} of ${cards.length} — click or press Space to flip`"
          class="flashcard-flip-outer select-none"
          @click="toggleFlip"
          @keydown="handleCardKeydown"
        >
          <div
            class="flashcard-flip-inner"
            :class="{ 'is-flipped': isFlipped }"
          >
            <div class="flashcard-flip-face flashcard-flip-front">
              <div class="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-md border bg-card p-6 text-center shadow-sm">
                <span class="text-xs uppercase tracking-wide text-muted-foreground">Front</span>
                <p class="text-lg font-medium">{{ currentCard?.front }}</p>
                <p class="mt-3 text-xs text-muted-foreground">Click, tap, or press Space to flip</p>
              </div>
            </div>
            <div class="flashcard-flip-face flashcard-flip-back">
              <div class="flex min-h-[220px] flex-col items-start justify-start gap-3 rounded-md border bg-card p-6 shadow-sm">
                <span class="text-xs uppercase tracking-wide text-muted-foreground">Back</span>
                <p class="text-lg font-medium">{{ currentCard?.back }}</p>

                <div v-if="currentCard?.sourceFilename" class="mt-3 flex w-full items-center gap-2 text-xs text-muted-foreground">
                  <ChatCitationBadge :index="1" :filename="currentCard.sourceFilename" />
                  <button
                    type="button"
                    class="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    data-testid="flashcard-source-toggle"
                    @click.stop="sourceExpanded = !sourceExpanded"
                  >
                    {{ sourceExpanded ? 'Hide passage' : 'Show passage' }}
                  </button>
                </div>

                <div v-if="isFlipped && sourceExpanded && currentCard?.sourceFilename" class="w-full" data-testid="flashcard-source-panel">
                  <ChatSourceCard
                    :index="1"
                    :filename="currentCard.sourceFilename"
                    :content="currentCard.sourceChunkContent"
                    :score="1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <UiButton
            variant="outline"
            size="sm"
            data-testid="flashcard-prev"
            :disabled="currentIndex === 0"
            :aria-disabled="currentIndex === 0 ? 'true' : 'false'"
            @click="prev"
          >
            <ChevronLeft class="mr-1.5 h-4 w-4" />
            Previous
          </UiButton>
          <UiButton
            size="sm"
            data-testid="flashcard-next"
            @click="next"
          >
            Next
            <ChevronRight class="ml-1.5 h-4 w-4" />
          </UiButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.flashcard-flip-outer {
  perspective: 1200px;
  cursor: pointer;
  outline: none;
}

.flashcard-flip-outer:focus-visible {
  box-shadow: 0 0 0 2px hsl(var(--ring));
  border-radius: 0.5rem;
}

.flashcard-flip-inner {
  position: relative;
  width: 100%;
  min-height: 220px;
  transition: transform 400ms cubic-bezier(0.4, 0.0, 0.2, 1);
  transform-style: preserve-3d;
}

.flashcard-flip-inner.is-flipped {
  transform: rotateY(180deg);
}

.flashcard-flip-face {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.flashcard-flip-back {
  transform: rotateY(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .flashcard-flip-inner {
    transition: none !important;
  }
}
</style>
