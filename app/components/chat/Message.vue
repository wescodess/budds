<script setup lang="ts">
import type { MDCRoot } from '@nuxtjs/mdc'
import { cn } from '@/lib/utils'
import { generatedTextFallback, parseGeneratedMarkdown } from '~/utils/generated-markdown'
import { generatedMdcComponents } from '~/utils/generated-mdc-components'
import type { Source } from '~/composables/useChat'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  streaming?: boolean
  animate?: boolean
}>()

const { springSnappy } = useMotionPresets()
const motionInitial = computed(() => {
  if (props.animate === false) return false
  return { opacity: 0, x: props.role === 'user' ? 12 : -12, y: 4 }
})

const emit = defineEmits<{
  'citation-click': [index: number]
  'citation-long-press': [index: number]
  'open-in-knowledge': [index: number]
}>()

const sourcesRef = computed<Source[]>(() => props.sources ?? [])
provide('chatCitationSources', sourcesRef)
provide('chatCitationClick', (i: number) => emit('citation-click', i))
provide('chatCitationLongPress', (i: number) => emit('citation-long-press', i))
provide('chatCitationOpenInKnowledge', (i: number) => emit('open-in-knowledge', i))

const isAssistant = computed(() => props.role === 'assistant')
const markdownBody = shallowRef<MDCRoot | null>(null)
const markdownParseError = ref(false)
const isMarkdownParsing = ref(false)
const hasMarkdownResult = ref(false)
const applicationOrigins = [useRequestURL().origin, useRuntimeConfig().public.siteUrl].filter(Boolean)
let markdownParseGeneration = 0
let parsing: Promise<void> | undefined
let settledContent: string | null = null

const fallbackSegments = computed(() => generatedTextFallback(props.content, sourcesRef.value.length))
const showMarkdownSkeleton = computed(() => isAssistant.value && isMarkdownParsing.value && !hasMarkdownResult.value && props.content.trim().length > 0)
const showMarkdownFallback = computed(() => isAssistant.value && props.content.trim().length > 0 && !markdownBody.value && !showMarkdownSkeleton.value)

async function parseAssistantMarkdown(content: string) {
  const current = ++markdownParseGeneration
  if (!isAssistant.value || !content.trim()) {
    markdownBody.value = null
    markdownParseError.value = false
    isMarkdownParsing.value = false
    hasMarkdownResult.value = false
    settledContent = null
    return
  }
  isMarkdownParsing.value = true
  const result = await parseGeneratedMarkdown(content, { applicationOrigins, sourceCount: sourcesRef.value.length })
  if (current !== markdownParseGeneration) return
  isMarkdownParsing.value = false
  // A later chunk may still complete a token on the open line, so keep its last good render.
  const holdOpenBlock = props.streaming && result.tailRefused && settledContent !== null
    && content.startsWith(settledContent) && !content.slice(settledContent.length).trimStart().includes('\n')
  if (holdOpenBlock) return
  markdownBody.value = result.body
  markdownParseError.value = !result.body
  hasMarkdownResult.value = true
  settledContent = result.body && !result.tailRefused ? content : null
}
watch([() => props.content, isAssistant, () => sourcesRef.value.length, () => props.streaming], ([content]) => {
  parsing = parseAssistantMarkdown(content)
}, { immediate: true, flush: 'sync' })
await parsing
onBeforeUnmount(() => markdownParseGeneration++)
</script>

<template>
  <Motion
    :initial="motionInitial"
    :animate="{ opacity: 1, x: 0, y: 0 }"
    :transition="springSnappy"
    data-testid="chat-message"
    :aria-label="`${props.role} message`"
    :class="cn(
      'rounded-lg px-4 py-3',
      props.role === 'user' && 'ml-auto max-w-[85%] bg-muted',
      props.role === 'assistant' && 'mr-auto w-full border',
    )"
  >
    <div v-if="!isAssistant" class="text-sm leading-relaxed">{{ props.content }}</div>
    <div v-else class="relative text-sm leading-relaxed">
      <div v-if="showMarkdownSkeleton" class="pointer-events-none absolute inset-0 z-10 space-y-2">
        <UiSkeleton class="h-4 w-11/12 rounded-md" />
        <UiSkeleton class="h-4 w-full rounded-md" />
        <UiSkeleton class="h-4 w-10/12 rounded-md" />
        <UiSkeleton class="h-4 w-8/12 rounded-md" />
      </div>
      <MDCRenderer
        v-if="markdownBody"
        :body="markdownBody"
        :components="generatedMdcComponents"
        :prose="false"
        tag="div"
        :class="cn(
          'prose-chat space-y-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#0f0d0c] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:p-2 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_em]:italic',
        )"
      />
      <div
        v-else-if="showMarkdownFallback"
        :class="cn(
          'prose-chat whitespace-pre-wrap break-words',
          Boolean(markdownParseError) && 'text-foreground',
        )"
      >
        <template v-for="(segment, index) in fallbackSegments" :key="index">
          <template v-if="segment.type === 'text'">{{ segment.value }}</template>
          <Citation v-else :index="segment.index" />
        </template>
      </div>
      <span
        v-if="props.streaming && !showMarkdownSkeleton"
        data-testid="streaming-cursor"
        class="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-foreground animate-pulse motion-reduce:hidden"
        aria-hidden="true"
      />
    </div>
  </Motion>
</template>
