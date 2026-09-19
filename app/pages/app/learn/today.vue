<script setup lang="ts">
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'

type TodayResult = { status: 'ready', sessionId: string, sessionRevision: number, content: { revision: number }, plan: { recordRevision: number, blueprintRecordRevision: number }, objective: { title: string, capability?: string | null, estimatedMinutes?: number | null }, scheduledStartAt: number, scheduledEndAt?: number | null, timezone: string, mastery?: { state?: string, nextReviewAt?: number | null }, nextScheduledAt?: number | null } | { status: 'pending' | 'blocked' | 'empty', reason?: string, sessionId?: string, sessionRevision?: number, canRetryGeneration?: boolean, nextScheduledAt?: number | null }
const { allowed, checkingAccess } = useLearnV2Access()
const today = import.meta.client ? useConvexQuery(api.learnV2Today.getToday, {}, { enabled: allowed }) : { data: ref<TodayResult | null>(null) }
const retryMutation = import.meta.client ? useConvexMutation(api.learnV2SessionContent.retrySessionContentGeneration) : { mutate: async () => ({}) }
const result = computed(() => today.data?.value as TodayResult | null | undefined)
const retrying = ref(false)
const retryError = ref<string | null>(null)
const retryKey = ref<string | null>(null)
const sessionActive = ref(false)
watch(() => result.value?.status === 'blocked' ? `${result.value.sessionId ?? ''}:${result.value.sessionRevision ?? ''}` : null, (value, previous) => {
  if (value !== previous) retryKey.value = null
})
const blockedMessage = computed(() => {
  if (result.value?.status !== 'blocked') return ''
  if (result.value.reason === 'evidence_unavailable' || result.value.reason === 'content_evidence_unavailable') return 'The accepted source evidence is no longer available. Review the mission sources before retrying.'
  return 'The provider returned material, but Budds could not safely publish it as a learning session. Your accepted plan and evidence are preserved.'
})
async function retryGeneration() {
  if (result.value?.status !== 'blocked' || !result.value.sessionId || result.value.sessionRevision === undefined || retrying.value) return
  retrying.value = true
  retryError.value = null
  retryKey.value ??= `learn-v2-session-retry:${crypto.randomUUID()}`
  try {
    await retryMutation.mutate({
      studySessionId: result.value.sessionId as never,
      expectedSessionRevision: result.value.sessionRevision,
      idempotencyKey: retryKey.value,
    })
  } catch (cause) {
    retryError.value = getErrorMessage(cause, 'Could not retry this session yet. Your plan is unchanged.')
  } finally {
    retrying.value = false
  }
}
const liveCandidate = computed(() => {
  if (result.value?.status !== 'ready') return null
  const row = result.value
  return { studySessionId: row.sessionId, sessionRevision: row.sessionRevision, contentRevision: row.content.revision, planRecordRevision: row.plan.recordRevision, blueprintRecordRevision: row.plan.blueprintRecordRevision, objectiveTitle: row.objective.title, capability: row.objective.capability ?? undefined, estimatedMinutes: row.objective.estimatedMinutes ?? 10, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt ?? undefined, timezone: row.timezone, reason: 'today', masteryState: row.mastery?.state, nextScheduledAt: row.nextScheduledAt ?? row.mastery?.nextReviewAt ?? undefined, progress: { retained: 0, independent: 0, total: 0 } }
})
const retainedCandidate = shallowRef<NonNullable<typeof liveCandidate.value> | null>(null)
watch(liveCandidate, (value) => {
  if (value && !sessionActive.value) retainedCandidate.value = value
}, { immediate: true })
const candidate = computed(() => sessionActive.value ? retainedCandidate.value : liveCandidate.value)
function beginSession() {
  retainedCandidate.value = liveCandidate.value ?? retainedCandidate.value
  sessionActive.value = true
}
function completeSession() {
  sessionActive.value = true
}
function leaveSession() {
  sessionActive.value = false
  retainedCandidate.value = null
  void navigateTo('/app/learn')
}
</script>

<template>
  <main class="min-h-full">
    <section v-if="checkingAccess" data-testid="learn-v2-today-access-pending" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">Checking access…</p></section>
    <section v-else-if="!allowed" data-testid="learn-v2-today-denied" class="mx-auto max-w-2xl p-6"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">This learning experience is not available for this account.</p></section>
    <section v-else-if="!result || result.status === 'pending'" data-testid="learn-v2-today-pending" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">{{ result?.reason ?? 'Preparing your study session…' }}</p></section>
    <section v-else-if="result.status === 'blocked'" data-testid="learn-v2-today-blocked" class="mx-auto max-w-2xl p-6">
      <p class="font-inter text-xs font-medium uppercase tracking-[0.16em] text-primary">Session recovery</p>
      <h1 class="mt-2 font-dm-sans text-2xl font-semibold">Your learning plan is safe</h1>
      <p class="mt-3 leading-7 text-muted-foreground">{{ blockedMessage }}</p>
      <p v-if="retryError" role="alert" data-testid="learn-v2-retry-error" class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{{ retryError }}</p>
      <button v-if="result.canRetryGeneration" type="button" data-testid="learn-v2-retry-generation" :disabled="retrying" class="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" @click="retryGeneration">{{ retrying ? 'Preparing a fresh session…' : 'Retry session generation' }}</button>
    </section>
    <section v-else-if="result.status !== 'ready' && !candidate" :data-testid="`learn-v2-today-${result.status}`" class="mx-auto max-w-2xl p-6"><h1 class="text-2xl font-semibold">Today</h1><p class="mt-2 text-muted-foreground">{{ result.reason ?? (result.status === 'empty' ? 'Nothing is scheduled for today.' : 'This session needs attention before it can begin.') }}</p></section>
    <template v-else-if="candidate">
      <LearnV2TodaySession :candidate @started="beginSession" @completed="completeSession" @leave="leaveSession" />
      <div class="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6">
        <LearnV2CalendarProjectionCard :study-session-id="candidate.studySessionId" :scheduled-start-at="candidate.scheduledStartAt" />
      </div>
    </template>
  </main>
</template>
