<script setup lang="ts">
import { BookOpen } from 'lucide-vue-next'

defineProps<{ content: string }>()
</script>

<template>
  <div class="p-6" data-testid="text-block">
    <div class="mb-4 flex items-center gap-2">
      <BookOpen class="h-4 w-4 text-amber-500" />
      <span class="text-xs font-medium uppercase tracking-wide text-stone-400">Explanation</span>
    </div>

    <div
      class="prose prose-invert prose-sm max-w-none prose-headings:text-stone-100 prose-p:text-stone-300 prose-strong:text-stone-100 prose-a:text-amber-500 prose-code:text-amber-400"
      v-html="renderMarkdown(content)"
    />
  </div>
</template>

<script lang="ts">
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderMarkdown(text: string): string {
  if (!text) return ''

  const escaped = escapeHtml(text)

  let html = escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (_match, linkText, url) => {
      const safeUrl = url.startsWith('http://') || url.startsWith('https://') ? url : '#'
      return `<a href="${safeUrl}" target="_blank" rel="noopener">${linkText}</a>`
    })

  const lines = html.split('\n')
  const result: string[] = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        result.push('<ul>')
        inList = true
      }
      result.push(`<li>${trimmed.slice(2)}</li>`)
    } else {
      if (inList) {
        result.push('</ul>')
        inList = false
      }
      if (trimmed.length > 0 && !trimmed.startsWith('<h')) {
        result.push(`<p>${trimmed}</p>`)
      } else {
        result.push(trimmed)
      }
    }
  }
  if (inList) result.push('</ul>')

  return result.join('\n')
}
</script>
