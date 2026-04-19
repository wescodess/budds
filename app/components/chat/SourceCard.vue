<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{
  index: number
  filename: string
  content: string
  score: number
  highlighted?: boolean
}>()

const glowPulse = ref(false)

watch(() => props.highlighted, (isHighlighted) => {
  if (isHighlighted) {
    glowPulse.value = true
    setTimeout(() => { glowPulse.value = false }, 600)
  }
})
</script>

<template>
  <div
    :aria-label="`Source passage from ${props.filename}`"
    :class="cn(
      'rounded-lg border p-3 transition-all duration-200',
      props.highlighted && 'ring-2 ring-primary',
      glowPulse && 'shadow-[0_0_12px_rgba(215,165,51,0.3)]',
    )"
  >
    <div class="mb-2 flex items-center gap-2">
      <span class="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
        {{ props.index }}
      </span>
      <span class="truncate text-sm font-medium">{{ props.filename }}</span>
      <UiBadge variant="secondary" class="ml-auto shrink-0 text-xs">
        {{ Math.round(props.score * 100) }}%
      </UiBadge>
    </div>
    <p class="break-all font-mono text-sm text-muted-foreground">{{ props.content }}</p>
  </div>
</template>
