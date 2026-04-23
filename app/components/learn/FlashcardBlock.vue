<script setup lang="ts">
import { ChevronLeft, ChevronRight, Layers } from 'lucide-vue-next'
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
  }>
} | null)

const cards = computed(() => roomData.value?.cards ?? [])

const currentIndex = ref(0)
const isFlipped = ref(false)
const cardKey = ref(0)

const currentCard = computed(() => cards.value[currentIndex.value] ?? null)
const progressLabel = computed(() =>
  cards.value.length === 0 ? '0/0' : `${currentIndex.value + 1}/${cards.value.length}`,
)

function next() {
  if (currentIndex.value >= cards.value.length - 1) return
  currentIndex.value++
  isFlipped.value = false
  cardKey.value++
}

function prev() {
  if (currentIndex.value <= 0) return
  currentIndex.value--
  isFlipped.value = false
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
          ? `Showing definition: ${currentCard?.definition ?? ''}`
          : `Card ${currentIndex + 1} of ${cards.length} — press Space to flip`"
        class="fc-flip-outer select-none"
        @click="toggleFlip"
        @keydown="handleCardKeydown"
      >
        <div class="fc-flip-inner" :class="{ 'is-flipped': isFlipped }">
          <div class="fc-flip-face fc-flip-front">
            <div class="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-stone-800 bg-stone-950 p-6 text-center">
              <span class="text-xs uppercase tracking-wide text-stone-500">Term</span>
              <p class="text-lg font-medium text-stone-100">{{ currentCard?.term }}</p>
              <p class="text-xs text-stone-600">Tap to flip</p>
            </div>
          </div>
          <div class="fc-flip-face fc-flip-back">
            <div class="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-stone-800 bg-stone-950 p-6 text-center">
              <span class="text-xs uppercase tracking-wide text-stone-500">Definition</span>
              <p class="text-base text-stone-200">{{ currentCard?.definition }}</p>
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
          class="flex items-center gap-1 rounded-lg border border-stone-800 px-3 py-2 text-xs text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200 disabled:opacity-40"
          :disabled="currentIndex >= cards.length - 1"
          aria-label="Next card"
          @click="next"
        >
          Next
          <ChevronRight class="h-4 w-4" />
        </button>
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
