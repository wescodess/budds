<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
  subtitle: string
}>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    data-testid="dashboard-action-card"
    class="group flex h-[120px] w-full flex-col items-start justify-between rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    @click="$emit('select')"
  >
    <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <component :is="icon" class="h-4 w-4" />
    </span>
    <div class="w-full">
      <p class="font-dm-sans text-sm font-semibold text-foreground">{{ title }}</p>
      <p class="mt-0.5 font-inter text-xs text-muted-foreground">{{ subtitle }}</p>
    </div>
  </button>
</template>
