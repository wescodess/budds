<script setup lang="ts">
import { useColorMode } from '@vueuse/core'

useColorMode({
  attribute: 'class',
  modes: { dark: 'dark', light: 'light' },
  initialValue: 'dark',
})
</script>

<template>
  <div class="min-h-screen bg-background text-foreground antialiased">
    <slot />
  </div>
</template>
