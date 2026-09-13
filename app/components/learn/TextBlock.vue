<script setup lang="ts">
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import { BookOpen } from '@lucide/vue'

const props = defineProps<{ content: string }>()

type ParsedMarkdown = Awaited<ReturnType<typeof parseMarkdown>>
const parsed = shallowRef<ParsedMarkdown | null>(null)
const parseError = ref(false)

const body = computed(() => parsed.value?.body ?? null)
const data = computed(() => parsed.value?.data ?? {})

async function parse() {
  if (!props.content?.trim()) {
    parsed.value = null
    return
  }
  try {
    parsed.value = await parseMarkdown(props.content, { toc: false, contentHeading: false })
    parseError.value = false
  } catch {
    try {
      parsed.value = await parseMarkdown(props.content, { toc: false, contentHeading: false, highlight: false })
      parseError.value = false
    } catch {
      parsed.value = null
      parseError.value = true
    }
  }
}

watch(() => props.content, () => parse(), { immediate: true })
</script>

<template>
  <div class="p-6" data-testid="text-block">
    <div class="mb-4 flex items-center gap-2">
      <BookOpen class="h-4 w-4 text-amber-500" />
      <span class="text-xs font-medium uppercase tracking-wide text-stone-400">Explanation</span>
    </div>

    <MDCRenderer
      v-if="body"
      :body="body"
      :data="data"
      tag="div"
      class="prose prose-invert prose-sm max-w-none space-y-3 prose-headings:text-stone-100 prose-p:text-stone-300 prose-p:leading-relaxed prose-strong:text-stone-100 prose-a:text-amber-500 prose-a:underline prose-a:underline-offset-2 prose-code:rounded prose-code:bg-stone-800 prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-amber-400 prose-code:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#0f0d0c] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-stone-300 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:text-stone-300 [&_blockquote]:border-l-2 [&_blockquote]:border-amber-500 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-stone-400 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-stone-700 [&_th]:bg-stone-800 [&_th]:p-2 [&_th]:text-left [&_th]:text-stone-200 [&_td]:border [&_td]:border-stone-700 [&_td]:p-2 [&_td]:text-stone-300 [&_hr]:border-stone-700"
    />

    <div
      v-else-if="parseError"
      class="whitespace-pre-wrap text-sm leading-relaxed text-stone-300"
    >{{ content }}</div>
  </div>
</template>
