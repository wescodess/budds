<script setup lang="ts">
import { Play } from 'lucide-vue-next'

defineProps<{
  name?: string | null
  continueHref?: string | null
  continueLabel?: string | null
}>()

const { springGentle } = useMotionPresets()

const hour = new Date().getHours()
const timeGreeting = computed(() => {
  if (hour < 5) return 'Studying late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
})
</script>

<template>
  <Motion
    :initial="{ opacity: 0, y: 10 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="springGentle"
    class="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
  >
    <div class="min-w-0 flex-1">
      <h1 class="font-dm-sans text-2xl font-bold tracking-tight text-foreground">
        {{ timeGreeting }}<span v-if="name">, {{ name }}</span>.
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Ready to dive back into your studies?
      </p>
    </div>

    <NuxtLink
      v-if="continueHref && continueLabel"
      :to="continueHref"
      data-testid="dashboard-continue-chip"
      class="group inline-flex min-h-9 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-auto sm:shrink-0 sm:py-0"
    >
      <span class="relative flex h-5 w-5 items-center justify-center rounded-full text-primary overflow-hidden">
        <span class="absolute inset-0 bg-primary opacity-10" />
        <Play class="relative z-10 h-3 w-3 fill-current" />
      </span>
      <span class="text-muted-foreground">Continue:</span>
      <span class="min-w-0 flex-1 truncate font-medium text-foreground sm:max-w-[220px] sm:flex-none">{{ continueLabel }}</span>
    </NuxtLink>
  </Motion>
</template>
