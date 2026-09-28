<script setup lang="ts">
import { api } from '#convex/api'

const route = useRoute()
const router = useRouter()
const threadId = computed(() => String(route.params.threadId))
const { allowed, checkingAccess } = useLearnAdaptiveAccess()
const threadQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptive.getThread, computed(() => ({ threadId: threadId.value as never })), { enabled: allowed })
  : { data: ref(null), pending: ref(false) }
const canvasQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptiveCanvas.getCanvas, computed(() => ({ threadId: threadId.value as never })), { enabled: allowed })
  : { data: ref(null), pending: ref(false) }
const diagnosticQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptiveRecovery.getDiagnosticCanvas, computed(() => ({ threadId: threadId.value as never })), { enabled: allowed })
  : { data: ref(null), pending: ref(false) }
const userQuery = import.meta.client
  ? useConvexQuery(api.users.getUser, {}, { enabled: allowed })
  : { data: ref(null), pending: ref(false) }

const ownerId = computed(() => userQuery.data.value?._id)
const thread = computed(() => {
  const value = threadQuery.data.value
  return allowed.value && value?.thread.id === threadId.value && value.ownerId === ownerId.value ? value : null
})
const canvas = computed(() => {
  const value = canvasQuery.data.value
  const current = thread.value
  return current?.thread.authorityKind === 'v2_mission' && value?.thread.id === current.thread.id
    && value.thread.revision === current.thread.revision
    && value.ownerId === ownerId.value && value.activity.id === current.currentActivity?.id ? value : null
})
const diagnostic = computed(() => {
  const value = diagnosticQuery.data.value
  const current = thread.value
  return current?.thread.authorityKind === 'standalone' && value?.thread.id === current.thread.id
    && value.thread.revision === current.thread.revision
    && value.ownerId === ownerId.value && (value.activity?.id ?? null) === (current.currentActivity?.id ?? null) ? value : null
})
const projectionPending = computed(() => Boolean(threadQuery.pending.value || userQuery.pending.value))
const detailPending = computed(() => thread.value?.thread.authorityKind === 'v2_mission'
  ? canvasQuery.pending.value
  : thread.value?.thread.authorityKind === 'standalone' ? diagnosticQuery.pending.value : false)
const shellReady = computed(() => thread.value && !['rollback', 'ended'].includes(thread.value.thread.lifecycle))
const safeDestination = computed(() => {
  const value = thread.value?.thread
  return value?.authorityKind === 'v2_mission' && value.learningVoidId
    ? `/app/learn/${encodeURIComponent(value.learningVoidId)}`
    : '/app/learn'
})
const safeDestinationLabel = computed(() => safeDestination.value === '/app/learn' ? 'Back to Learn' : 'Open your learning mission')

function leave() { void router.push(safeDestination.value) }
</script>

<template>
  <main data-testid="learn-adaptive-thread-route" class="min-h-full bg-[var(--learn-thread-surface)]">
    <section v-if="checkingAccess" class="mx-auto max-w-3xl p-6" aria-live="polite">Checking learning access…</section>
    <section v-else-if="!allowed" class="mx-auto max-w-3xl p-6" data-testid="learn-adaptive-thread-denied">
      <p role="status">This learning thread is not available for this account.</p>
      <NuxtLink to="/app/learn" data-testid="learn-adaptive-safe-destination" class="mt-4 inline-flex min-h-11 items-center text-primary underline">Back to Learn</NuxtLink>
    </section>
    <section v-else-if="projectionPending && !thread" class="mx-auto max-w-3xl p-6" aria-live="polite">Loading your learning thread…</section>
    <section v-else-if="!shellReady" class="mx-auto max-w-3xl p-6" data-testid="learn-adaptive-thread-unavailable">
      <p role="status">This learning thread is unavailable.</p>
      <NuxtLink :to="safeDestination" data-testid="learn-adaptive-safe-destination" class="mt-4 inline-flex min-h-11 items-center text-primary underline">{{ safeDestinationLabel }}</NuxtLink>
    </section>
    <div v-else-if="thread" class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6" data-testid="learn-adaptive-thread-shell">
      <header>
        <p class="text-xs font-medium uppercase tracking-wide text-primary">Learning thread · {{ thread.thread.intent }}</p>
        <h1 class="mt-2 font-dm-sans text-3xl font-bold">{{ thread.thread.outcome }}</h1>
        <p class="mt-3 rounded-lg bg-[var(--learn-evidence)] px-3 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">{{ thread.thread.lifecycle }} · Evidence {{ thread.thread.evidenceState }}</p>
      </header>

      <section class="mt-6 rounded-xl border border-border bg-[var(--learn-context-surface)] p-5" aria-labelledby="learn-thread-next-title">
        <h2 id="learn-thread-next-title" class="font-dm-sans text-lg font-semibold">Your next move</h2>
        <p class="mt-2 text-sm">{{ canvas || diagnostic ? thread.nextAction.label : detailPending ? 'Loading current activity…' : 'Review this thread from your learning home.' }}</p>
        <NuxtLink v-if="thread.nextAction.kind === 'clarify' && (canvas || diagnostic)" :to="safeDestination" class="mt-2 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]">{{ safeDestinationLabel }}</NuxtLink>
      </section>

      <section class="mt-6 rounded-xl bg-[var(--learn-activity-surface)] p-4" data-testid="learn-adaptive-canvas-frame" aria-label="Current learning activity">
        <LearnAdaptiveReadySessionCanvas v-if="canvas" :key="`${ownerId}:${canvas.thread.id}:${canvas.activity.id}`" :canvas="canvas as never" :show-header="false" @leave="leave" />
        <LearnAdaptiveDiagnosticCanvas v-else-if="diagnostic" :key="`${ownerId}:${diagnostic.thread.id}:${diagnostic.activity?.id ?? 'draft'}`" :canvas="diagnostic as never" :show-header="false" @leave="leave" />
        <div v-else-if="detailPending" data-testid="learn-adaptive-canvas-loading" class="rounded-lg border border-border p-5" role="status" aria-live="polite">
          <h2 class="font-dm-sans text-lg font-semibold">Loading current activity…</h2>
          <p class="mt-2 text-sm text-muted-foreground">Your thread and history are available while the activity loads.</p>
        </div>
        <div v-else data-testid="learn-adaptive-canvas-fallback" class="rounded-lg border border-border p-5" role="status">
          <h2 class="font-dm-sans text-lg font-semibold">Current activity unavailable</h2>
          <p class="mt-2 text-sm text-muted-foreground">Your thread and activity history are saved. Open the learning destination to continue safely.</p>
          <NuxtLink :to="safeDestination" data-testid="learn-adaptive-canvas-fallback-action" class="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]">{{ safeDestinationLabel }}</NuxtLink>
        </div>
      </section>

      <section class="mt-6" aria-labelledby="learn-thread-history-title">
        <h2 id="learn-thread-history-title" class="font-dm-sans text-lg font-semibold">Recent activity</h2>
        <p v-if="thread.history.length === 0" class="mt-2 text-sm text-muted-foreground">Your activity history will appear here.</p>
        <ol v-else class="mt-3 space-y-2">
          <li v-for="item in thread.history" :key="item.id" class="rounded-lg border border-border px-4 py-3 text-sm">
            <p class="font-medium">{{ item.purpose }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ item.status }}</p>
          </li>
        </ol>
      </section>
      <NuxtLink v-if="canvas || diagnostic" :to="safeDestination" data-testid="learn-adaptive-safe-destination" class="mt-6 inline-flex min-h-11 items-center text-sm text-muted-foreground underline">{{ safeDestinationLabel }}</NuxtLink>
    </div>
  </main>
</template>
