<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronRight, CircleCheck, CircleDashed, Clock, LoaderCircle, TriangleAlert } from '@lucide/vue'
import { LEARN_TODAY_CHECK_POINTER_VERSION, learnTodayCheckRoute, type LearnTodayCheckPointer } from '#shared/learn-v2-today-check'

const { pointer, primary = true } = defineProps<{ pointer: LearnTodayCheckPointer, primary?: boolean }>()

const attention = 'text-[var(--learn-attention)]'
const readyTitles = {
  this_session: 'Check on this topic',
  about_a_week: 'Check on last week’s topic',
  about_a_month: 'Check on a topic from about a month ago',
  earlier: 'Check on an earlier topic',
  retained: 'Check on an earlier topic',
} as const
const rows: Record<LearnTodayCheckPointer['state'], { title: string, body: string, action: string, icon: Component, iconClass: string }> = {
  ready: { title: '', body: 'One question, on your own. No time limit.', action: 'Start check', icon: CircleDashed, iconClass: 'text-foreground' },
  saved_scoring: { title: 'Check saved', body: 'Getting your result.', action: 'Open', icon: LoaderCircle, iconClass: `animate-spin motion-reduce:animate-none ${attention}` },
  result_unconfirmed: { title: 'Check saved, result not confirmed', body: 'Nothing to do. It will update here.', action: 'Open', icon: Clock, iconClass: attention },
  result_ready: { title: 'Your check result is ready', body: 'Read it with your answer.', action: 'Read it', icon: CircleCheck, iconClass: 'text-green-700 dark:text-green-400' },
  closed: { title: 'This check won’t count', body: 'It won’t count for or against you.', action: 'Open', icon: TriangleAlert, iconClass: attention },
}

const id = useId()
const v2 = computed(() => pointer.version === LEARN_TODAY_CHECK_POINTER_VERSION ? pointer : null)
const row = computed(() => pointer.state === 'ready' ? { ...rows.ready, title: readyTitles[v2.value?.timing ?? 'earlier'] } : rows[pointer.state])
const topic = computed(() => pointer.state === 'ready' ? v2.value?.topic?.trim() || null : null)
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
        <p v-if="topic" :id="`${id}-topic`" data-testid="learn-v2-check-row-topic" class="text-sm leading-6 text-foreground">{{ topic }}</p>
        <p :class="['text-sm leading-6', pointer.state === 'saved_scoring' ? 'text-foreground' : 'text-muted-foreground']">{{ row.body }}</p>
      </div>
    </div>
    <NuxtLink :to data-testid="learn-v2-check-row-link" :aria-describedby="topic ? `${id}-title ${id}-topic` : `${id}-title`" :class="pointer.state === 'ready' ? startClass : textLink">
      {{ row.action }}<ChevronRight v-if="pointer.state === 'ready'" class="h-4 w-4 shrink-0" aria-hidden="true" />
    </NuxtLink>
  </div>
</template>
