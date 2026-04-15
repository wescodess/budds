<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  count: number
}>()

const trackRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function updateScrollState() {
  const el = trackRef.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 4
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}

function scrollBy(direction: 1 | -1) {
  const el = trackRef.value
  if (!el) return
  const step = Math.max(el.clientWidth * 0.8, 240)
  el.scrollBy({ left: direction * step, behavior: 'smooth' })
}

onMounted(() => {
  updateScrollState()
  const el = trackRef.value
  if (!el) return
  el.addEventListener('scroll', updateScrollState, { passive: true })
  const resize = new ResizeObserver(updateScrollState)
  resize.observe(el)
  onUnmounted(() => {
    el.removeEventListener('scroll', updateScrollState)
    resize.disconnect()
  })
})

watch(() => props.count, () => nextTick(updateScrollState))
</script>

<template>
  <div class="relative" data-testid="dashboard-courses-carousel">
    <div
      ref="trackRef"
      data-gesture-owner="courses-carousel"
      class="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <slot />
    </div>

    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent"
      :class="canScrollLeft ? 'opacity-100' : 'opacity-0'"
    />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent"
      :class="canScrollRight ? 'opacity-100' : 'opacity-0'"
    />

    <button
      v-show="canScrollLeft"
      type="button"
      data-testid="carousel-prev"
      aria-label="Scroll courses left"
      class="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="scrollBy(-1)"
    >
      <ChevronLeft class="h-4 w-4" />
    </button>
    <button
      v-show="canScrollRight"
      type="button"
      data-testid="carousel-next"
      aria-label="Scroll courses right"
      class="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="scrollBy(1)"
    >
      <ChevronRight class="h-4 w-4" />
    </button>
  </div>
</template>
