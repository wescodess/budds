<script setup lang="ts">
import { Headphones, Play, Settings2 } from 'lucide-vue-next'

const props = defineProps<{
  indexedCount: number
  generating?: boolean
}>()

const emit = defineEmits<{
  generate: []
  customize: []
}>()

const canGenerate = computed(() => props.indexedCount > 0 && !props.generating)
const helperCopy = computed(() =>
  props.indexedCount === 0
    ? 'Index at least one document in this folder to enable audio overviews.'
    : 'Takes 2–4 minutes. You can keep working — we\'ll notify you when it\'s ready.',
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center p-4">
    <div
      data-testid="audio-overview-card"
      class="w-full max-w-xl rounded-xl border border-border/60 bg-card p-5 @container sm:p-8"
    >
      <div class="flex items-start gap-3">
        <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg overflow-hidden sm:h-12 sm:w-12 sm:rounded-xl">
          <span class="absolute inset-0 bg-primary opacity-10" />
          <Headphones class="relative z-10 h-4 w-4 text-primary sm:h-5 sm:w-5" />
        </div>
        <div class="flex min-w-0 flex-col">
          <h2 class="font-dm-sans text-lg font-bold leading-tight text-foreground sm:text-2xl">
            Audio Overview
          </h2>
          <p class="mt-0.5 font-inter text-[11px] text-muted-foreground sm:text-xs">
            A conversational podcast grounded in your folder's sources. Two AI hosts, ~10 minutes.
          </p>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2 sm:mt-6 sm:gap-3">
        <span
          class="inline-flex items-center rounded-full border border-border/60 bg-background/40 px-2.5 py-0.5 font-inter text-[11px] font-medium text-muted-foreground sm:px-3 sm:py-1"
          data-testid="audio-overview-sources-chip"
        >
          {{ props.indexedCount }} {{ props.indexedCount === 1 ? 'doc' : 'docs' }} indexed
        </span>
        <span class="flex items-center gap-1.5 font-inter text-[11px] text-muted-foreground sm:text-[13px] sm:gap-2">
          <span class="flex -space-x-1.5 sm:-space-x-2">
            <span class="h-5 w-5 rounded-full bg-primary/80 ring-2 ring-card sm:h-6 sm:w-6" aria-hidden="true" />
            <span class="h-5 w-5 rounded-full bg-accent/80 ring-2 ring-card sm:h-6 sm:w-6" aria-hidden="true" />
          </span>
          Expert + Learner
        </span>
      </div>

      <div class="mt-5 flex flex-col gap-2 sm:mt-8">
        <UiButton
          type="button"
          data-testid="audio-overview-generate-btn"
          class="w-full"
          :disabled="!canGenerate"
          @click="emit('generate')"
        >
          <Play class="mr-2 h-4 w-4" />
          Generate audio overview
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          data-testid="audio-overview-card-customize-btn"
          class="w-full border border-border/60"
          :disabled="!canGenerate"
          @click="emit('customize')"
        >
          <Settings2 class="mr-2 h-4 w-4" />
          Customize
        </UiButton>
      </div>

      <p
        class="mt-3 text-center font-inter text-[11px] font-medium leading-relaxed text-muted-foreground"
        data-testid="audio-overview-helper-copy"
      >
        {{ helperCopy }}
      </p>
    </div>
  </div>
</template>
