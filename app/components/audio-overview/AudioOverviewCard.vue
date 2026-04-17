<script setup lang="ts">
import { Headphones, Play } from 'lucide-vue-next'

const props = defineProps<{
  indexedCount: number
  generating?: boolean
}>()

const emit = defineEmits<{
  generate: []
}>()

const canGenerate = computed(() => props.indexedCount > 0 && !props.generating)
const helperCopy = computed(() =>
  props.indexedCount === 0
    ? 'Index at least one document in this folder to enable audio overviews.'
    : 'Takes 2–4 minutes. You can keep working — we\'ll notify you when it\'s ready.',
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center p-6">
    <div
      data-testid="audio-overview-card"
      class="w-full max-w-xl rounded-xl border border-border/60 bg-card p-8 sm:p-10"
    >
      <div class="flex items-center gap-3">
        <div class="relative flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden">
          <span class="absolute inset-0 bg-primary opacity-10" />
          <Headphones class="relative z-10 h-5 w-5 text-primary" />
        </div>
        <div class="flex min-w-0 flex-col">
          <h2 class="font-dm-sans text-2xl font-bold leading-tight text-foreground">
            Audio Overview
          </h2>
          <p class="font-inter text-xs text-muted-foreground">
            A conversational podcast grounded in your folder's sources. Two AI hosts, ~10 minutes.
          </p>
        </div>
      </div>

      <div class="mt-6 flex items-center gap-3">
        <span
          class="inline-flex items-center rounded-full border border-border/60 bg-background/40 px-3 py-1 font-inter text-[11px] font-medium text-muted-foreground"
          data-testid="audio-overview-sources-chip"
        >
          {{ props.indexedCount }} {{ props.indexedCount === 1 ? 'document' : 'documents' }} indexed
        </span>
      </div>

      <div class="mt-5 flex items-center gap-3">
        <span class="flex items-center gap-2 font-inter text-[13px] text-muted-foreground">
          <span class="flex -space-x-2">
            <span class="h-6 w-6 rounded-full bg-primary/80 ring-2 ring-card" aria-hidden="true" />
            <span class="h-6 w-6 rounded-full bg-accent/80 ring-2 ring-card" aria-hidden="true" />
          </span>
          Hosts: Expert + Learner
        </span>
      </div>

      <UiButton
        type="button"
        data-testid="audio-overview-generate-btn"
        class="mt-8 w-full"
        :disabled="!canGenerate"
        @click="emit('generate')"
      >
        <Play class="mr-2 h-4 w-4" />
        Generate audio overview
      </UiButton>

      <p
        class="mt-3 text-center font-inter text-[11px] font-medium leading-relaxed text-muted-foreground"
        data-testid="audio-overview-helper-copy"
      >
        {{ helperCopy }}
      </p>
    </div>
  </div>
</template>
