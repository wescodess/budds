<script setup lang="ts">
defineProps<{
  label: string
  columns?: 2 | 3
}>()
</script>

<template>
  <section data-testid="dashboard-action-section">
    <p class="mb-3 font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {{ label }}
    </p>
    <div
      :class="[
        'grid gap-3',
        columns === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2',
      ]"
    >
      <slot />
    </div>
  </section>
</template>
