<script setup lang="ts">
import { Toaster as Sonner } from 'vue-sonner'

const props = withDefaults(
  defineProps<{
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'
    duration?: number
    richColors?: boolean
  }>(),
  {
    position: 'bottom-right',
    duration: 4000,
    richColors: true,
  },
)
</script>

<template>
  <Sonner
    :position="props.position"
    :duration="props.duration"
    :rich-colors="props.richColors"
    class="toaster group"
    :toast-options="{
      classes: {
        toast: 'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
        description: 'group-[.toast]:text-muted-foreground',
        actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
  />
</template>
