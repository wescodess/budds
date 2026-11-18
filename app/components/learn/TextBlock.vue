<script setup lang="ts">
import { BookOpen } from '@lucide/vue'
import type { MDCRoot } from '@nuxtjs/mdc'
import { parseGeneratedMarkdown } from '~/utils/generated-markdown'
import { generatedMdcComponents } from '~/utils/generated-mdc-components'

const props = defineProps<{ content: string }>()
const body = shallowRef<MDCRoot | null>(null)
const parseError = ref(false)
const applicationOrigins = [useRequestURL().origin, useRuntimeConfig().public.siteUrl].filter(Boolean)
let generation = 0
let parsing: Promise<void> | undefined

async function parse(content: string) {
  const current = ++generation
  body.value = null
  parseError.value = false
  if (!content.trim()) return
  const result = await parseGeneratedMarkdown(content, { applicationOrigins })
  if (current !== generation) return
  body.value = result.body
  parseError.value = !result.body
}
watch(() => props.content, content => { parsing = parse(content) }, { immediate: true, flush: 'sync' })
await parsing
onBeforeUnmount(() => generation++)
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
      :components="generatedMdcComponents"
      :prose="false"
      tag="div"
      class="prose prose-invert prose-sm max-w-none space-y-3 prose-headings:text-stone-100 prose-p:text-stone-300 prose-p:leading-relaxed prose-strong:text-stone-100 prose-a:text-amber-500 prose-a:underline prose-a:underline-offset-2 prose-code:rounded prose-code:bg-stone-800 prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-amber-400 prose-code:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#0f0d0c] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-stone-300 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:text-stone-300 [&_blockquote]:border-l-2 [&_blockquote]:border-amber-500 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-stone-400 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-stone-700 [&_th]:bg-stone-800 [&_th]:p-2 [&_th]:text-left [&_th]:text-stone-200 [&_td]:border [&_td]:border-stone-700 [&_td]:p-2 [&_td]:text-stone-300 [&_hr]:border-stone-700"
    />

    <div
      v-else-if="parseError"
      class="whitespace-pre-wrap text-sm leading-relaxed text-stone-300"
    >{{ content }}</div>
  </div>
</template>
