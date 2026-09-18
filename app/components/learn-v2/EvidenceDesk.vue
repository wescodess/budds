<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ExternalLink, FileText, Link, Search, ShieldAlert, X } from '@lucide/vue'
import type { LearnSourceOrigin, LearnSourceSnapshot } from '~/types/learn-v2-journey'

const { sources, selectedSourceId = null, canResearch = true, researchBusy = false, researchResults = [] } = defineProps<{
  sources: LearnSourceSnapshot[]
  selectedSourceId?: string | null
  canResearch?: boolean
  researchBusy?: boolean
  researchResults?: Array<{ title: string; url: string; snippet?: string }>
}>()
const emit = defineEmits<{
  selectSource: [sourceId: string]
  acceptSource: [sourceId: string]
  rejectSource: [sourceId: string]
  prepareSource: [sourceId: string]
  replaceSource: [sourceId: string]
  research: [query: string]
  addUrl: [url: string, title?: string]
}>()
const url = ref('')
const urlInput = ref<HTMLInputElement | null>(null)
const replacingSourceId = ref<string | null>(null)
const internalSelectedSourceId = ref<string | null>(selectedSourceId)
const researchQuery = ref('')
const lanes: Array<{ id: LearnSourceOrigin; label: string }> = [
  { id: 'folder_document', label: 'Your folder' }, { id: 'user_url', label: 'Added by you' },
  { id: 'open_database', label: 'Open databases' }, { id: 'general_web_search', label: 'Web research' },
]
watch(() => selectedSourceId, value => { if (value) internalSelectedSourceId.value = value })
const selected = computed(() => sources.find(source => source.id === (selectedSourceId ?? internalSelectedSourceId.value)) ?? sources[0] ?? null)
const coverageClass = { strong: 'text-emerald-300', partial: 'text-amber-300', gap: 'text-rose-300' }
function addUrl() { if (!url.value.trim()) return; emit('addUrl', url.value); url.value = '' }
function research() { if (canResearch && researchQuery.value.trim()) emit('research', researchQuery.value.trim()) }
function selectSource(sourceId: string) {
  internalSelectedSourceId.value = sourceId
  emit('selectSource', sourceId)
}
function replaceSource(sourceId: string) {
  replacingSourceId.value = sourceId
  url.value = ''
  emit('replaceSource', sourceId)
  requestAnimationFrame(() => urlInput.value?.focus())
}
</script>

<template>
  <section class="space-y-5" data-testid="learn-v2-evidence-desk">
    <header><p class="font-inter text-xs uppercase tracking-wide text-primary">Evidence review</p><h2 class="mt-1 font-dm-sans text-xl font-bold">Choose what can support this plan</h2><p class="mt-1 text-sm text-muted-foreground">Search results are discovery hints. Teaching evidence is accepted only after the original source is fetched and reviewed.</p></header>
    <form class="flex gap-2 rounded-xl border border-border bg-card p-3" @submit.prevent="research"><label class="sr-only" for="learn-v2-research-query">Research query</label><input id="learn-v2-research-query" v-model="researchQuery" data-testid="learn-v2-research-query" :disabled="!canResearch || researchBusy" placeholder="Search the public web for a source" class="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UiButton data-testid="learn-v2-source-research" type="submit" size="sm" :disabled="!canResearch || researchBusy || !researchQuery.trim()"><Search class="mr-1 h-4 w-4" />{{ researchBusy ? 'Researching…' : 'Research' }}</UiButton></form>
    <p v-if="!canResearch" class="text-sm text-muted-foreground">This plan is limited to your folder, so public-web research is unavailable.</p>
    <section v-if="researchResults.length" class="rounded-xl border border-border bg-card p-4" aria-label="Research results"><p class="font-inter text-xs uppercase tracking-wide text-muted-foreground">Discovery results</p><div class="mt-3 space-y-3"><article v-for="result in researchResults" :key="result.url" class="rounded-lg border border-border p-3"><a :href="result.url" target="_blank" rel="noopener noreferrer" class="font-medium underline decoration-primary/40 underline-offset-4 hover:decoration-primary">{{ result.title }}</a><p v-if="result.snippet" class="mt-1 text-sm text-muted-foreground">{{ result.snippet }}</p><UiButton class="mt-3" size="sm" variant="secondary" @click="emit('addUrl', result.url, result.title)">Review this source</UiButton></article></div></section>
    <form class="rounded-xl border border-border bg-card p-3" @submit.prevent="addUrl"><div class="flex gap-2"><label class="sr-only" for="learn-v2-source-url">Original source URL</label><input id="learn-v2-source-url" ref="urlInput" v-model="url" data-testid="learn-v2-source-url" type="url" required placeholder="https://example.org/source" :aria-describedby="replacingSourceId ? 'learn-v2-source-replacement-help' : undefined" class="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UiButton data-testid="learn-v2-source-add-url" type="submit" variant="secondary"><Link class="mr-1 h-4 w-4" />{{ replacingSourceId ? 'Add replacement' : 'Add URL' }}</UiButton></div><p v-if="replacingSourceId" id="learn-v2-source-replacement-help" class="mt-2 text-sm text-muted-foreground">Choose a different public source that supports the same topic. The unavailable source will not be used as teaching evidence.</p></form>
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><div class="space-y-5"><section v-for="lane in lanes" :key="lane.id" :aria-labelledby="`learn-v2-source-lane-${lane.id}`"><h3 :id="`learn-v2-source-lane-${lane.id}`" class="mb-2 font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ lane.label }}</h3><div class="space-y-2"><button v-for="source in sources.filter(item => item.origin === lane.id)" :key="source.id" type="button" :data-testid="`learn-v2-source-row-${source.id}`" class="w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="selected?.id === source.id ? 'border-primary/60 bg-primary/5' : 'border-border bg-card hover:border-primary/30'" @click="selectSource(source.id)"><div class="flex items-start justify-between gap-3"><div><p class="font-medium">{{ source.title }}</p><p class="mt-1 text-xs text-muted-foreground">{{ source.publisher ?? 'Unknown publisher' }} · {{ source.retrievedLabel }}</p></div><span class="font-inter text-xs capitalize" :class="coverageClass[source.coverage]">{{ source.coverage }} coverage</span></div><p class="mt-2 text-xs text-muted-foreground">Supports: {{ source.objectives.join(', ') || 'Not mapped yet' }}</p></button><p v-if="!sources.some(item => item.origin === lane.id)" class="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">No sources in this lane yet.</p></div></section></div>
      <aside v-if="selected" data-testid="learn-v2-source-inspector" class="h-fit rounded-xl border border-border bg-card p-5 lg:sticky lg:top-4"><div class="flex items-start gap-3"><FileText class="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h3 class="font-dm-sans text-lg font-semibold">{{ selected.title }}</h3><p class="mt-1 text-sm text-muted-foreground">{{ selected.publisher ?? 'Unknown publisher' }}</p></div></div><p class="mt-4 text-sm text-muted-foreground">{{ selected.accessNote ?? 'Original source metadata is available for review.' }}</p><blockquote v-if="selected.excerpt" class="mt-4 border-l-2 border-primary/60 pl-3 font-mono text-xs leading-5 text-muted-foreground">{{ selected.excerpt }}</blockquote><div class="mt-4"><p class="font-inter text-xs uppercase tracking-wide text-muted-foreground">Supported objectives</p><ul class="mt-2 space-y-1 text-sm"><li v-for="objective in selected.objectives" :key="objective">{{ objective }}</li></ul></div><p v-if="selected.lifecycle === 'unavailable'" class="mt-4 flex gap-2 text-sm text-amber-200"><ShieldAlert class="h-4 w-4 shrink-0" />Evidence is unavailable; this source cannot support published teaching.</p><div class="mt-5 flex flex-wrap gap-2"><UiButton v-if="selected.lifecycle === 'evaluated'" :data-testid="`learn-v2-source-accept-${selected.id}`" size="sm" @click="emit('acceptSource', selected.id)"><Check class="mr-1 h-4 w-4" />Accept evidence</UiButton><UiButton v-else-if="selected.lifecycle === 'user_accepted'" variant="secondary" size="sm" disabled><Check class="mr-1 h-4 w-4" />Accepted</UiButton><UiButton v-else-if="selected.lifecycle === 'candidate' || selected.lifecycle === 'fetched'" :data-testid="`learn-v2-source-prepare-${selected.id}`" variant="secondary" size="sm" @click="emit('prepareSource', selected.id)">{{ selected.lifecycle === 'candidate' ? 'Prepare evidence' : 'Finish evidence review' }}</UiButton><UiButton v-else-if="selected.lifecycle === 'unavailable'" :data-testid="`learn-v2-source-replace-${selected.id}`" variant="secondary" size="sm" @click="replaceSource(selected.id)">Add a replacement</UiButton><UiButton v-else variant="secondary" size="sm" disabled>Removed</UiButton><UiButton v-if="!['unavailable', 'rejected'].includes(selected.lifecycle)" variant="ghost" size="sm" @click="emit('rejectSource', selected.id)"><X class="mr-1 h-4 w-4" />Reject</UiButton><a v-if="selected.originalUrl" :href="selected.originalUrl" target="_blank" rel="noopener noreferrer" class="ml-auto inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ExternalLink class="h-4 w-4" /><span class="sr-only">Open original source</span></a></div></aside>
      <aside v-else class="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">Select a source to inspect its evidence and coverage.</aside>
    </div>
  </section>
</template>
