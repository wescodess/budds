<script setup lang="ts">
import { cn } from '@/lib/utils'
import { expandCitations } from '~/utils/expand-citations'
import type { Source } from '~/composables/useChat'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  streaming?: boolean
}>()

const emit = defineEmits<{
  'citation-click': [index: number]
  'open-in-knowledge': [index: number]
}>()

const sourcesRef = computed<Source[]>(() => props.sources ?? [])
provide('chatCitationSources', sourcesRef)
provide('chatCitationClick', (i: number) => emit('citation-click', i))
provide('chatCitationOpenInKnowledge', (i: number) => emit('open-in-knowledge', i))

const processedContent = computed(() => {
  if (props.role === 'user') return props.content
  return expandCitations(props.content)
})

const isAssistant = computed(() => props.role === 'assistant')
</script>

<template>
  <div
    data-testid="chat-message"
    :aria-label="`${props.role} message`"
    :class="cn(
      'rounded-lg px-4 py-3',
      props.role === 'user' && 'ml-auto max-w-[85%] bg-muted',
      props.role === 'assistant' && 'mr-auto w-full border',
    )"
  >
    <div v-if="!isAssistant" class="text-sm leading-relaxed">{{ props.content }}</div>
    <div v-else class="text-sm leading-relaxed">
      <MDC
        :value="processedContent"
        tag="div"
        class="prose-chat space-y-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#0f0d0c] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:p-2 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_em]:italic"
      />
      <span
        v-if="props.streaming"
        data-testid="streaming-cursor"
        class="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-foreground animate-pulse motion-reduce:hidden"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
