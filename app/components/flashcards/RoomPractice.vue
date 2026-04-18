<script setup lang="ts">
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle } from 'lucide-vue-next'
import { usePointerSwipe } from '@vueuse/core'
import type { Id } from '../../../convex/_generated/dataModel'

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
  cards: RoomCard[]
  _seedForTests?: number
}>()

function createPrng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleFn<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

const order = ref<RoomCard[]>([])
const currentIndex = ref(0)
const isFlipped = ref(false)
const isComplete = ref(false)
const sourceExpanded = ref(false)
const dealDirection = ref<'next' | 'prev' | null>(null)
const cardKey = ref(0)

function resetToSource() {
  order.value = [...props.cards]
  currentIndex.value = 0
  isFlipped.value = false
  isComplete.value = false
  sourceExpanded.value = false
}

watch(
  () => props.cards,
  () => resetToSource(),
  { immediate: true, deep: true },
)

const currentCard = computed(() => order.value[currentIndex.value] ?? null)

const progressLabel = computed(() =>
  order.value.length === 0 ? '0 / 0' : `${currentIndex.value + 1} / ${order.value.length}`,
)

function shuffle() {
  const rng = typeof props._seedForTests === 'number' ? createPrng(props._seedForTests) : Math.random
  order.value = shuffleFn(order.value, rng)
  currentIndex.value = 0
  isFlipped.value = false
  isComplete.value = false
}

function reset() {
  resetToSource()
}

function toggleFlip() {
  if (isComplete.value) return
  if (suppressNextClick.value) {
    suppressNextClick.value = false
    return
  }
  isFlipped.value = !isFlipped.value
}

function next() {
  if (isComplete.value) return
  if (currentIndex.value >= order.value.length - 1) {
    isComplete.value = true
    isFlipped.value = false
    return
  }
  dealDirection.value = 'next'
  currentIndex.value += 1
  cardKey.value++
  isFlipped.value = false
  sourceExpanded.value = false
}

function prev() {
  if (isComplete.value) return
  if (currentIndex.value <= 0) return
  dealDirection.value = 'prev'
  currentIndex.value -= 1
  cardKey.value++
  isFlipped.value = false
  sourceExpanded.value = false
}

const { springBouncy } = useMotionPresets()
const dealInitial = computed(() => {
  if (!dealDirection.value) return { opacity: 0, x: 0, scale: 0.96 }
  return {
    opacity: 0,
    x: dealDirection.value === 'next' ? 60 : -60,
    scale: 0.96,
  }
})

function handleCardKeydown(e: KeyboardEvent) {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    toggleFlip()
  }
}

function isInsideOverlay(el: Element | null): boolean {
  if (!el) return false
  return !!el.closest('[role="dialog"], [role="menu"], [aria-modal="true"]')
}

function handleGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (target?.isContentEditable) return
  if (isInsideOverlay(document.activeElement)) return

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
}

const cardBodyRef = ref<HTMLElement | null>(null)
const suppressNextClick = ref(false)
let suppressClickTimer: ReturnType<typeof setTimeout> | null = null

usePointerSwipe(cardBodyRef, {
  threshold: 40,
  pointerTypes: ['touch', 'pen'],
  onSwipeEnd(_e, direction) {
    if (isComplete.value) return
    if (direction === 'left' || direction === 'right') {
      suppressNextClick.value = true
      if (suppressClickTimer) clearTimeout(suppressClickTimer)
      suppressClickTimer = setTimeout(() => { suppressNextClick.value = false }, 300)
    }
    if (direction === 'left') next()
    else if (direction === 'right') prev()
  },
})

onMounted(() => {
  if (import.meta.client) document.addEventListener('keydown', handleGlobalKeydown)
})
onUnmounted(() => {
  if (import.meta.client) document.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div data-testid="flashcard-room-practice" class="flex h-full min-h-0 flex-col gap-5 p-5">
    <template v-if="order.length === 0">
      <div
        data-testid="flashcard-room-practice-empty"
        class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/60 bg-card/40 p-12 text-center text-muted-foreground"
      >
        <p class="text-sm">No cards to practice. Add some in Editor first.</p>
      </div>
    </template>

    <template v-else-if="isComplete">
      <div
        data-testid="flashcard-room-practice-complete"
        class="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-border/60 bg-card/40 p-12 text-center"
      >
        <h3 class="font-dm-sans text-2xl font-semibold">You finished!</h3>
        <p class="text-muted-foreground">Reviewed {{ order.length }} cards</p>
        <div class="flex gap-2">
          <UiButton data-testid="flashcard-room-practice-reset" @click="reset">
            <RotateCcw class="mr-1.5 h-4 w-4" />
            Reset
          </UiButton>
          <UiButton variant="outline" data-testid="flashcard-room-practice-shuffle" @click="shuffle">
            <Shuffle class="mr-1.5 h-4 w-4" />
            Shuffle
          </UiButton>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center justify-between">
        <p class="text-xs font-medium text-muted-foreground" data-testid="flashcard-room-practice-progress">
          {{ progressLabel }}
        </p>
        <div class="flex gap-2">
          <UiButton
            variant="ghost"
            size="sm"
            data-testid="flashcard-room-practice-shuffle"
            @click="shuffle"
          >
            <Shuffle class="mr-1.5 h-4 w-4" />
            Shuffle
          </UiButton>
          <UiButton
            variant="ghost"
            size="sm"
            data-testid="flashcard-room-practice-reset"
            @click="reset"
          >
            <RotateCcw class="mr-1.5 h-4 w-4" />
            Reset
          </UiButton>
        </div>
      </div>

      <Motion
        :key="cardKey"
        :initial="dealInitial"
        :animate="{ opacity: 1, x: 0, scale: 1 }"
        :transition="springBouncy"
      >
        <div
          ref="cardBodyRef"
          data-testid="flashcard-room-practice-viewer"
        data-gesture-owner="flashcard-room-practice"
        role="button"
        tabindex="0"
        :aria-pressed="isFlipped"
        :aria-label="isFlipped
          ? `Showing definition: ${currentCard?.definition ?? ''}`
          : `Card ${currentIndex + 1} of ${order.length} — press Space to flip`"
        class="flashcard-flip-outer select-none"
        @click="toggleFlip"
        @keydown="handleCardKeydown"
      >
        <div class="flashcard-flip-inner" :class="{ 'is-flipped': isFlipped }">
          <div class="flashcard-flip-face flashcard-flip-front">
            <div class="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
              <span class="text-xs uppercase tracking-wide text-muted-foreground">Term</span>
              <p class="font-dm-sans text-xl font-medium">{{ currentCard?.term }}</p>
              <p class="mt-2 text-xs text-muted-foreground">Click or press Space to flip</p>
            </div>
          </div>
          <div class="flashcard-flip-face flashcard-flip-back">
            <div class="flex min-h-[260px] flex-col gap-3 rounded-xl border border-border/60 bg-card p-8 shadow-sm">
              <span class="text-xs uppercase tracking-wide text-muted-foreground">Definition</span>
              <p class="font-dm-sans text-lg font-medium">{{ currentCard?.definition }}</p>

              <div
                v-if="currentCard?.metadata?.source?.filename"
                class="mt-3 flex w-full items-center gap-2 text-xs text-muted-foreground"
              >
                <ChatCitationBadge :index="1" :filename="currentCard.metadata.source.filename" />
                <button
                  type="button"
                  class="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                  data-testid="flashcard-room-practice-source-toggle"
                  @click.stop="sourceExpanded = !sourceExpanded"
                >
                  {{ sourceExpanded ? 'Hide passage' : 'Show passage' }}
                </button>
              </div>

              <div
                v-if="isFlipped && sourceExpanded && currentCard?.metadata?.source?.filename"
                data-testid="flashcard-room-practice-source-panel"
                class="w-full"
              >
                <ChatSourceCard
                  :index="1"
                  :filename="currentCard.metadata.source.filename"
                  :content="currentCard.metadata.source.chunkContent"
                  :score="1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      </Motion>

      <div class="flex items-center justify-between gap-2">
        <UiButton
          variant="outline"
          size="sm"
          data-testid="flashcard-room-practice-prev"
          :disabled="currentIndex === 0"
          :aria-disabled="currentIndex === 0 ? 'true' : 'false'"
          @click="prev"
        >
          <ChevronLeft class="mr-1.5 h-4 w-4" />
          Previous
        </UiButton>
        <UiButton
          size="sm"
          data-testid="flashcard-room-practice-next"
          @click="next"
        >
          Next
          <ChevronRight class="ml-1.5 h-4 w-4" />
        </UiButton>
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
  border-radius: 0.75rem;
}

.flashcard-flip-inner {
  position: relative;
  width: 100%;
  min-height: 260px;
  transition: transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
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
