<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import type { Source } from '~/composables/useChat'
import type { ComponentPublicInstance } from 'vue'

const props = defineProps<{
  sources: Source[]
  activeCitationIndex: number | null
  open: boolean
  side?: 'left' | 'right'
}>()

const emit = defineEmits<{
  close: []
}>()

const cardRefs = ref<HTMLElement[]>([])
const { springSnappy } = useMotionPresets()

function setCardRef(index: number, element: Element | ComponentPublicInstance | null) {
  const resolved = element && '$el' in element ? element.$el : element
  if (resolved instanceof HTMLElement) cardRefs.value[index] = resolved
}

function setCardRefAt(index: number) {
  return (element: Element | ComponentPublicInstance | null) => setCardRef(index, element)
}

watch(() => props.activeCitationIndex, (index) => {
  if (index !== null && cardRefs.value[index]) {
    nextTick(() => {
      cardRefs.value[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
})
</script>

<template>
  <aside
    v-if="props.open"
    data-testid="source-panel"
    :class="cn(
      'flex h-full min-w-0 flex-col bg-card',
      props.side === 'left' ? 'border-r' : 'border-l',
    )"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <h3 class="text-sm font-semibold">Sources</h3>
      <button
        type="button"
        data-testid="source-panel-close"
        aria-label="Close sources panel"
        class="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent"
        @click="emit('close')"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-4">
      <div class="space-y-3">
        <Motion
          v-for="(source, i) in props.sources"
          :key="i"
          :ref="setCardRefAt(i)"
          :initial="{ opacity: 0, y: 10 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ ...springSnappy, delay: i * 0.03 }"
        >
          <ChatSourceCard
            :index="i + 1"
            :filename="source.filename"
            :content="source.content"
            :score="source.score"
            :highlighted="props.activeCitationIndex === i"
          />
        </Motion>
      </div>
    </div>
  </aside>
</template>
