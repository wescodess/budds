<script setup lang="ts">
import { ChevronLeft, ChevronRight, Layers, Flag } from 'lucide-vue-next'
import { usePointerSwipe } from '@vueuse/core'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{ roomId: string }>()

const roomQuery = import.meta.client
  ? useConvexQuery(
      api.flashcardRooms.getRoom,
      computed(() => ({ roomId: props.roomId as Id<'flashcardRooms'> })),
    )
  : { data: ref(null) }

const roomData = computed(() => roomQuery.data?.value as {
  room: { title: string }
  cards: Array<{
    _id: string
    term: string
    definition: string
    displayOrder: number
    flagged?: boolean
    correctedDefinition?: string
  }>
} | null)

const cards = computed(() => roomData.value?.cards ?? [])

const currentIndex = ref(0)
const isFlipped = ref(false)
const cardKey = ref(0)

const flaggingOpen = ref(false)
const flagCorrectedDef = ref('')
const flagSaving = ref(false)
const flagError = ref('')

const flagMutation = import.meta.client
  ? useConvexMutation(api.contentFlags.flagFlashcard)
  : { mutate: async () => ({ success: true }) }

const currentCard = computed(() => cards.value[currentIndex.value] ?? null)
const progressLabel = computed(() =>
  cards.value.length === 0 ? '0/0' : `${currentIndex.value + 1}/${cards.value.length}`,
)

function effectiveDefinition(card: { definition: string; flagged?: boolean; correctedDefinition?: string } | null) {
  if (!card) return ''
  return (card.flagged && card.correctedDefinition) ? card.correctedDefinition : card.definition
}

function next() {
  if (currentIndex.value >= cards.value.length - 1) return
  currentIndex.value++
  isFlipped.value = false
  flaggingOpen.value = false
  cardKey.value++
}

function prev() {
  if (currentIndex.value <= 0) return
  currentIndex.value--
  isFlipped.value = false
  flaggingOpen.value = false
  cardKey.value++
}

function toggleFlip() {
  if (suppressNextClick.value) {
    suppressNextClick.value = false
    return
  }
  isFlipped.value = !isFlipped.value
}

function handleCardKeydown(e: KeyboardEvent) {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    toggleFlip()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    next()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prev()
  }
}

function openFlagEditor() {
  if (!currentCard.value) return
  flagCorrectedDef.value = effectiveDefinition(currentCard.value)
  flaggingOpen.value = true
}

function closeFlagEditor() {
  flaggingOpen.value = false
}

async function saveFlag() {
  if (!currentCard.value) return
  const trimmed = flagCorrectedDef.value.trim()
  if (!trimmed) return

  flagSaving.value = true
  flagError.value = ''
  try {
    await flagMutation.mutate({
      cardId: currentCard.value._id as Id<'flashcardRoomCards'>,
      correctedDefinition: trimmed,
    })
    closeFlagEditor()
  } catch {
    flagError.value = 'Failed to save correction. Please try again.'
  } finally {
    flagSaving.value = false
  }
}

const cardBodyRef = ref<HTMLElement | null>(null)
const suppressNextClick = ref(false)
let suppressTimer: ReturnType<typeof setTimeout> | null = null

if (import.meta.client) {
  usePointerSwipe(cardBodyRef, {
    threshold: 40,
    pointerTypes: ['touch', 'pen'],
    onSwipeEnd(_e, direction) {
      if (direction === 'left' || direction === 'right') {
        suppressNextClick.value = true
        if (suppressTimer) clearTimeout(suppressTimer)
        suppressTimer = setTimeout(() => { suppressNextClick.value = false }, 300)
      }
      if (direction === 'left') next()
      else if (direction === 'right') prev()
    },
  })
}
</script>

<template>
  <div class="p-6" data-testid="flashcard-block">
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Layers class="h-4 w-4 text-amber-500" />
        <span class="text-xs font-medium uppercase tracking-wide text-stone-400">Key Concepts</span>
      </div>
      <span class="text-xs text-stone-500">{{ progressLabel }}</span>
    </div>

    <div v-if="!roomData" class="py-8 text-center text-sm text-stone-400">
      Loading flashcards...
    </div>

    <div v-else-if="cards.length === 0" class="py-8 text-center text-sm text-stone-400">
      No flashcards available.
    </div>

    <div v-else>
      <div
        ref="cardBodyRef"
        role="button"
        tabindex="0"
        :aria-pressed="isFlipped"
        :aria-label="isFlipped
          ? `Showing definition: ${effectiveDefinition(currentCard)}`
          : `Card ${currentIndex + 1} of ${cards.length} — press Space to flip`"
        class="fc-flip-outer select-none"
        @click="toggleFlip"
        @keydown="handleCardKeydown"
      >
        <div class="fc-flip-inner" :class="{ 'is-flipped': isFlipped }">
          <div class="fc-flip-face fc-flip-front">
            <div class="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-stone-800 bg-stone-950 p-6 text-center">
              <div class="flex w-full items-center justify-between">
                <span class="text-xs uppercase tracking-wide text-stone-500">Term</span>
                <span
                  v-if="currentCard?.flagged"
                  class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400"
                  data-testid="flag-badge"
                >
                  <Flag class="h-3 w-3" /> Corrected
                </span>
              </div>
              <p class="text-lg font-medium text-stone-100">{{ currentCard?.term }}</p>
              <p class="text-xs text-stone-600">Tap to flip</p>
            </div>
          </div>
          <div class="fc-flip-face fc-flip-back">
            <div class="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-stone-800 bg-stone-950 p-6 text-center">
              <span class="text-xs uppercase tracking-wide text-stone-500">Definition</span>
              <p class="text-base text-stone-200">{{ effectiveDefinition(currentCard) }}</p>
              <p
                v-if="currentCard?.flagged && currentCard?.correctedDefinition"
                class="text-xs text-stone-500 line-through"
              >
                {{ currentCard.definition }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg border border-stone-800 px-3 py-2 text-xs text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200 disabled:opacity-40"
          :disabled="currentIndex === 0"
          aria-label="Previous card"
          @click="prev"
        >
          <ChevronLeft class="h-4 w-4" />
          Prev
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs text-stone-500 transition-colors hover:text-amber-400"
          data-testid="flag-button"
          @click.stop="openFlagEditor"
        >
          <Flag class="h-3 w-3" />
          {{ currentCard?.flagged ? 'Edit correction' : 'Flag' }}
        </button>

        <button
          type="button"
          class="flex items-center gap-1 rounded-lg border border-stone-800 px-3 py-2 text-xs text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200 disabled:opacity-40"
          :disabled="currentIndex >= cards.length - 1"
          aria-label="Next card"
          @click="next"
        >
          Next
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>

      <div v-if="flaggingOpen" class="mt-3 space-y-2 rounded-lg border border-stone-700 bg-stone-900 p-3" data-testid="flag-editor">
        <label class="block text-xs text-stone-400">
          Corrected definition
          <textarea
            class="mt-1 w-full rounded border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
            rows="2"
            :value="flagCorrectedDef"
            @input="flagCorrectedDef = ($event.target as HTMLTextAreaElement).value"
          />
        </label>
        <p v-if="flagError" class="text-xs text-red-400" data-testid="flag-error">
          {{ flagError }}
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            :disabled="flagSaving"
            data-testid="flag-save"
            @click="saveFlag"
          >
            {{ flagSaving ? 'Saving...' : 'Save' }}
          </button>
          <button
            type="button"
            class="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:text-stone-200"
            @click="closeFlagEditor"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fc-flip-outer {
  perspective: 1200px;
  cursor: pointer;
  outline: none;
}

.fc-flip-outer:focus-visible {
  box-shadow: 0 0 0 2px rgb(245 158 11 / 0.5);
  border-radius: 0.5rem;
}

.fc-flip-inner {
  position: relative;
  width: 100%;
  min-height: 180px;
  transition: transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-style: preserve-3d;
}

.fc-flip-inner.is-flipped {
  transform: rotateY(180deg);
}

.fc-flip-face {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.fc-flip-back {
  transform: rotateY(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .fc-flip-inner {
    transition: none !important;
  }
}
</style>
