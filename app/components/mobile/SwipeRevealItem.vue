<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { useSwipeReveal } from '~/composables/useSwipeReveal'

const props = defineProps<{
  open?: boolean
  disabled?: boolean
  actionWidth?: number
  class?: HTMLAttributes['class']
  contentClass?: HTMLAttributes['class']
  actionsClass?: HTMLAttributes['class']
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  open: []
  close: []
}>()

const { rootRef, actionsStyle, contentStyle, isDragging } = useSwipeReveal({
  open: computed(() => Boolean(props.open)),
  disabled: computed(() => Boolean(props.disabled)),
  actionWidth: computed(() => props.actionWidth),
  onOpen() {
    emit('update:open', true)
    emit('open')
  },
  onClose() {
    emit('update:open', false)
    emit('close')
  },
})
</script>

<template>
  <div
    ref="rootRef"
    data-gesture-owner="swipe-reveal"
    :data-swipe-open="props.open ? 'true' : 'false'"
    :class="cn('relative overflow-hidden', props.class)"
  >
    <div
      data-swipe-reveal-actions
      class="absolute inset-y-0 right-0 z-0 flex items-stretch justify-end transition-opacity duration-150 ease-out"
      :class="cn(props.actionsClass)"
      :style="{
        width: `${props.actionWidth ?? 120}px`,
        ...actionsStyle,
      }"
    >
      <slot name="actions" />
    </div>

    <div
      data-swipe-reveal-content
      :class="cn(
        'relative z-10 overflow-hidden bg-background will-change-transform',
        isDragging ? 'transition-none' : 'transition-transform duration-200 ease-out',
        props.contentClass,
      )"
      :style="contentStyle"
    >
      <slot />
    </div>
  </div>
</template>
