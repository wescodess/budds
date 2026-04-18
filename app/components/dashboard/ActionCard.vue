<script setup lang="ts">
import type { Component } from 'vue'

const props = defineProps<{
  icon: Component
  title: string
  subtitle: string
  staggerIndex?: number
}>()

defineEmits<{ select: [] }>()

const { springSnappy } = useMotionPresets()
const transition = computed(() => ({
  ...springSnappy,
  delay: (props.staggerIndex ?? 0) * 0.04,
}))
</script>

<template>
  <Motion
    :initial="{ opacity: 0, y: 16 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="transition"
    as="button"
    type="button"
    data-testid="dashboard-action-card"
    class="group flex h-[120px] w-full flex-col items-start justify-between rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    @click="$emit('select')"
  >
    <span class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary overflow-hidden">
      <span class="absolute inset-0 bg-primary opacity-10" />
      <component :is="icon" class="relative z-10 h-4 w-4" />
    </span>
    <div class="w-full">
      <p class="font-dm-sans text-sm font-semibold text-foreground">{{ title }}</p>
      <p class="mt-0.5 font-inter text-xs text-muted-foreground">{{ subtitle }}</p>
    </div>
  </Motion>
</template>
