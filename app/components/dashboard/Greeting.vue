<script setup lang="ts">
import { Play } from 'lucide-vue-next'

defineProps<{
  name?: string | null
  continueHref?: string | null
  continueLabel?: string | null
}>()

const hour = new Date().getHours()
const timeGreeting = computed(() => {
  if (hour < 5) return 'Studying late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
})
</script>

<template>
  <div class="flex items-start justify-between gap-4">
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
      class="group inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span class="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Play class="h-3 w-3 fill-current" />
      </span>
      <span class="hidden text-muted-foreground sm:inline">Continue:</span>
      <span class="max-w-[220px] truncate font-medium text-foreground">{{ continueLabel }}</span>
    </NuxtLink>
  </div>
</template>
