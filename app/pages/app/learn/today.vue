<script setup lang="ts">
import { api } from '#convex/api'

type TodayResult = { status: 'ready', sessionId: string, sessionRevision: number, content: { revision: number }, plan: { recordRevision: number, blueprintRecordRevision: number }, objective: { title: string, capability?: string | null, estimatedMinutes?: number | null }, scheduledStartAt: number, scheduledEndAt?: number | null, timezone: string, mastery?: { state?: string, nextReviewAt?: number | null }, nextScheduledAt?: number | null } | { status: 'pending' | 'blocked' | 'empty', reason?: string, nextScheduledAt?: number | null }
const access = import.meta.client ? useConvexQuery(api.learnV2Access.status, {}) : { data: ref({ kind: 'denied' }), pending: ref(false) }
const allowed = computed(() => (access.data?.value as { kind?: string } | undefined)?.kind === 'allowed')
const checkingAccess = computed(() => access.pending?.value ?? false)
const today = import.meta.client ? useConvexQuery(api.learnV2Today.getToday, {}, { enabled: allowed }) : { data: ref<TodayResult | null>(null) }
const result = computed(() => today.data?.value as TodayResult | null | undefined)
const candidate = computed(() => {
  if (result.value?.status !== 'ready') return null
  const row = result.value
  return { studySessionId: row.sessionId, sessionRevision: row.sessionRevision, contentRevision: row.content.revision, planRecordRevision: row.plan.recordRevision, blueprintRecordRevision: row.plan.blueprintRecordRevision, objectiveTitle: row.objective.title, capability: row.objective.capability ?? undefined, estimatedMinutes: row.objective.estimatedMinutes ?? 10, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt ?? undefined, timezone: row.timezone, reason: 'today', masteryState: row.mastery?.state, nextScheduledAt: row.nextScheduledAt ?? row.mastery?.nextReviewAt ?? undefined, progress: { retained: 0, independent: 0, total: 0 } }
})
</script>

<template>
  <main class="min-h-full">
    <section v-if="checkingAccess" data-testid="learn-v2-today-access-pending" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">Checking access…</p></section>
    <section v-else-if="!allowed" data-testid="learn-v2-today-denied" class="mx-auto max-w-2xl p-6"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">This learning experience is not available for this account.</p></section>
    <section v-else-if="!result || result.status === 'pending'" data-testid="learn-v2-today-pending" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">{{ result?.reason ?? 'Preparing your study session…' }}</p></section>
    <section v-else-if="result.status !== 'ready'" :data-testid="`learn-v2-today-${result.status}`" class="mx-auto max-w-2xl p-6"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">{{ result.reason ?? (result.status === 'empty' ? 'Nothing is scheduled for today.' : 'This session needs attention before it can begin.') }}</p></section>
    <LearnV2TodaySession v-else-if="candidate" :candidate />
  </main>
</template>
