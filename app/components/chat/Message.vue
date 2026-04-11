<script setup lang="ts">
import { cn } from '@/lib/utils'
import type { Source } from '~/composables/useChat'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}>()

const emit = defineEmits<{
  'citation-click': [index: number]
}>()

interface ContentPart {
  type: 'text' | 'citation'
  value: string
  index?: number
}

const parsedContent = computed((): ContentPart[] => {
  if (props.role === 'user') {
    return [{ type: 'text', value: props.content }]
  }

  const parts: ContentPart[] = []
  const regex = /\[(\d+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(props.content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: props.content.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'citation', value: match[0], index: parseInt(match[1]!) })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < props.content.length) {
    parts.push({ type: 'text', value: props.content.slice(lastIndex) })
  }

  return parts
})

function getFilenameForIndex(index: number): string {
  return props.sources?.[index - 1]?.filename ?? ''
}
</script>

<template>
  <div
    data-testid="chat-message"
    :aria-label="`${props.role} message`"
    :class="cn(
      'max-w-[85%] rounded-lg px-4 py-3',
      props.role === 'user' && 'ml-auto bg-muted',
      props.role === 'assistant' && 'mr-auto border',
    )"
  >
    <div class="text-sm leading-relaxed">
      <template v-for="(part, i) in parsedContent" :key="i">
        <span v-if="part.type === 'text'">{{ part.value }}</span>
        <ChatCitationBadge
          v-else-if="part.type === 'citation' && part.index"
          :index="part.index"
          :filename="getFilenameForIndex(part.index)"
          @click="emit('citation-click', part.index)"
        />
      </template>
    </div>
  </div>
</template>
