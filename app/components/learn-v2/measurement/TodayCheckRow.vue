<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronRight, CircleCheck, CircleDashed, Clock, LoaderCircle, TriangleAlert } from '@lucide/vue'
import { learnTodayCheckRoute, type LearnTodayCheckPointer } from '#shared/learn-v2-today-check'

const { pointer, primary = true } = defineProps<{ pointer: LearnTodayCheckPointer, primary?: boolean }>()

const attention = 'text-[var(--learn-attention)]'
const rows: Record<LearnTodayCheckPointer['state'], { title: string, body: string, action: string, icon: Component, iconClass: string }> = {
  ready: { title: 'Your check is ready', body: 'One question, on your own. No time limit.', action: 'Start check', icon: CircleDashed, iconClass: 'text-foreground' },
  saved_scoring: { title: 'Check saved', body: 'Getting your result.', action: 'Open', icon: LoaderCircle, iconClass: `animate-spin motion-reduce:animate-none ${attention}` },
  result_unconfirmed: { title: 'Check saved, result not confirmed', body: 'Nothing to do. It will update here.', action: 'Open', icon: Clock, iconClass: attention },
  result_ready: { title: 'Your check result is ready', body: 'Read it with your answer.', action: 'Read it', icon: CircleCheck, iconClass: 'text-green-700 dark:text-green-400' },
  closed: { title: 'This check won’t count', body: 'It won’t count for or against you.', action: 'Open', icon: TriangleAlert, iconClass: attention },
}

const id = useId()
const row = computed(() => rows[pointer.state])
const to = computed(() => learnTodayCheckRoute(pointer.destination.threadId, pointer.reference))
const startClass = computed(() => primary
  ? 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
  : 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background')
const textLink = 'inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
</script>

<template>
  <div :data-testid="`learn-v2-check-row-${pointer.state}`" :data-check-reference="pointer.reference" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3 forced-colors:border-current">
    <div class="flex min-w-0 flex-1 basis-60 items-start gap-3" :role="pointer.state === 'ready' ? 'none' : 'status'">
      <component :is="row.icon" :class="['mt-0.5 h-5 w-5 shrink-0', row.iconClass]" aria-hidden="true" />
      <div class="min-w-0">
        <p :id="`${id}-title`" class="font-medium text-foreground">{{ row.title }}</p>
        <p class="text-sm leading-6 text-muted-foreground">{{ row.body }}</p>
      </div>
    </div>
    <NuxtLink :to data-testid="learn-v2-check-row-link" :aria-describedby="`${id}-title`" :class="pointer.state === 'ready' ? startClass : textLink">
      {{ row.action }}<ChevronRight v-if="pointer.state === 'ready'" class="h-4 w-4 shrink-0" aria-hidden="true" />
    </NuxtLink>
  </div>
</template>
