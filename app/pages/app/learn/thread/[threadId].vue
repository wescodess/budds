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
const artifactQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptive.getArtifactCanvas, computed(() => ({ threadId: threadId.value as never })), { enabled: allowed })
  : { data: ref(null), pending: ref(false) }
const reflectionQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptive.getReflectionCanvas, computed(() => ({ threadId: threadId.value as never })), { enabled: allowed })
  : { data: ref(null), pending: ref(false) }
const userQuery = import.meta.client
  ? useConvexQuery(api.users.getUser, {}, { enabled: allowed })
  : { data: ref(null), pending: ref(false) }

const ownerId = computed(() => userQuery.data.value?._id)
const thread = computed(() => {
  const value = threadQuery.data.value
  return allowed.value && value?.thread.id === threadId.value && value.ownerId === ownerId.value ? value : null
})
const memoryQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptive.getMemory, computed(() => ({ threadId: threadId.value as never })), { enabled: computed(() => allowed.value && Boolean(thread.value)) })
  : { data: ref(null), pending: ref(false) }
const memory = computed(() => {
  const value = memoryQuery.data.value
  const current = thread.value
  return current && value && value.ownerId === ownerId.value && value.threadId === current.thread.id
    && value.threadRevision >= current.thread.revision ? value : null
})
const setMemoryPreferenceMutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.setMemoryPreference)
  : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
const deleteMemoryArtifactMutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.deleteArtifact)
  : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
type MemoryPreferenceChange = { key: 'representation' | 'pace' | 'practice_style', operation: 'set' | 'disable' | 'clear', value?: string }
type MemoryCommand = { kind: 'preference', payload: MemoryPreferenceChange, threadId: string, ownerId: string, expectedRevision: number, idempotencyKey: string }
  | { kind: 'delete_artifact', artifactId: string, threadId: string, ownerId: string, expectedRevision: number, idempotencyKey: string }
const pendingMemoryCommand = ref<MemoryCommand | null>(null)
const memoryBusy = ref(false)
const memoryError = ref('')
const memoryNotice = ref('')
let memoryScopeEpoch = 0
watch([ownerId, threadId, allowed], () => {
  memoryScopeEpoch += 1
  pendingMemoryCommand.value = null
  memoryBusy.value = false
  memoryError.value = ''
  memoryNotice.value = ''
})
function memoryCommandKey() { return `memory:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
async function runMemoryCommand(command: MemoryCommand) {
  if (memoryBusy.value) return
  if (!thread.value || thread.value.thread.id !== command.threadId || ownerId.value !== command.ownerId) {
    pendingMemoryCommand.value = null
    memoryError.value = 'This memory belongs to another thread or account. Open your own thread to continue.'
    return
  }
  memoryBusy.value = true
  const scopeEpoch = memoryScopeEpoch
  memoryError.value = ''
  memoryNotice.value = ''
  try {
    const result = (command.kind === 'preference'
      ? await setMemoryPreferenceMutation.mutate({ threadId: command.threadId as never,
          ...command.payload, expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey })
      : await deleteMemoryArtifactMutation.mutate({ threadId: command.threadId as never, artifactId: command.artifactId as never,
          expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey })) as { kind: string, value?: { cleanupPending?: boolean } }
    if (scopeEpoch !== memoryScopeEpoch) return
    if (result.kind === 'ok') {
      pendingMemoryCommand.value = null
      memoryNotice.value = command.kind === 'preference' ? 'Preference change saved.'
        : result.value?.cleanupPending ? 'Artifact is hidden. Storage cleanup is pending.' : 'Artifact deletion recorded.'
    }
    else if (result.kind === 'conflict') {
      pendingMemoryCommand.value = null
      memoryError.value = 'Memory changed in another tab. Review current memory and retry your edit.'
    }
    else {
      pendingMemoryCommand.value = null
      memoryError.value = 'This memory change could not be saved. Review current memory and try again.'
    }
  }
  catch {
    if (scopeEpoch !== memoryScopeEpoch) return
    memoryError.value = 'The result could not be confirmed. Retry the same change to check its outcome.'
  }
  finally { if (scopeEpoch === memoryScopeEpoch) memoryBusy.value = false }
}
function requestMemoryCommand(input: MemoryPreferenceChange | { artifactId: string }) {
  const current = memory.value
  if (!current || !thread.value || !ownerId.value) {
    memoryError.value = 'Memory is unavailable for this thread. Review current memory before changing it.'
    return
  }
  if (pendingMemoryCommand.value) {
    memoryError.value = 'A previous change is not confirmed. Retry that same change before starting another.'
    return
  }
  const base = { threadId: current.threadId, ownerId: String(ownerId.value),
    expectedRevision: current.threadRevision, idempotencyKey: memoryCommandKey() }
  const command: MemoryCommand = 'artifactId' in input
    ? { ...base, kind: 'delete_artifact', artifactId: input.artifactId }
    : { ...base, kind: 'preference', payload: input }
  pendingMemoryCommand.value = command
  void runMemoryCommand(command)
}
function requestMemoryArtifactDeletion(artifactId: string) { requestMemoryCommand({ artifactId }) }
function reviewCurrentMemory() {
  if (pendingMemoryCommand.value) {
    memoryError.value = 'The previous change is still unconfirmed. Retry the same change to check its outcome.'
    return
  }
  memoryError.value = ''
  memoryNotice.value = 'Current memory is shown. Review it before trying another change.'
}
function retryMemoryCommand() { if (pendingMemoryCommand.value) void runMemoryCommand(pendingMemoryCommand.value) }
const canvas = computed(() => {
  const value = canvasQuery.data.value
  const current = thread.value
  return current?.thread.authorityKind === 'v2_mission' && value?.thread.id === current.thread.id
    && value.ownerId === ownerId.value && value.activity.id === current.currentActivity?.id ? value : null
})
const diagnostic = computed(() => {
  const value = diagnosticQuery.data.value
  const current = thread.value
  return current?.thread.authorityKind === 'standalone' && value?.thread.id === current.thread.id
    && value.ownerId === ownerId.value && (value.activity?.id ?? null) === (current.currentActivity?.id ?? null) ? value : null
})
const artifact = computed(() => {
  const value = artifactQuery.data.value
  const current = thread.value
  return current && value?.thread.id === current.thread.id && value.ownerId === ownerId.value
    && value.activity.id === current.currentActivity?.id ? value : null
})
const reflection = computed(() => {
  const value = reflectionQuery.data.value
  const current = thread.value
  return current && value?.thread.id === current.thread.id && value.ownerId === ownerId.value
    && value.activity.id === current.currentActivity?.id ? value : null
})
const projectionPending = computed(() => Boolean(threadQuery.pending.value || userQuery.pending.value))
const detailPending = computed(() => thread.value?.thread.authorityKind === 'v2_mission'
  ? canvasQuery.pending.value || artifactQuery.pending.value || reflectionQuery.pending.value
  : thread.value?.thread.authorityKind === 'standalone' ? diagnosticQuery.pending.value || artifactQuery.pending.value || reflectionQuery.pending.value : false)
const shellReady = computed(() => Boolean(thread.value))
const rollback = computed(() => thread.value?.thread.lifecycle === 'rollback')
const endedReadOnly = computed(() => thread.value?.thread.lifecycle === 'ended' && reflection.value?.status !== 'completed')
const selectedActivityId = computed(() => typeof route.query.activity === 'string' ? route.query.activity : null)
const selectedHistory = computed(() => thread.value?.history.find(item => item.id === selectedActivityId.value) ?? null)
const showCurrent = computed(() => !selectedActivityId.value || selectedActivityId.value === thread.value?.currentActivity?.id)
const canvasUnsafe = computed(() => Boolean(canvas.value && canvas.value.status !== 'blocked' && thread.value?.thread.evidenceState !== 'ready'))
const currentActivityUrl = computed(() => `/app/learn/thread/${encodeURIComponent(threadId.value)}`)
const evidenceActivityId = computed(() => selectedHistory.value?.id ?? (showCurrent.value ? thread.value?.currentActivity?.id : null))
const evidenceQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptiveEvidence.getThreadActivityEvidence, computed(() => ({ threadId: threadId.value as never, activityId: evidenceActivityId.value ?? '' })), { enabled: computed(() => allowed.value && Boolean(thread.value && evidenceActivityId.value)) })
  : { data: ref(null), pending: ref(false) }
const evidence = computed(() => {
  const value = evidenceQuery.data.value
  return value && value.ownerId === ownerId.value && value.threadId === thread.value?.thread.id
    && value.activityId === evidenceActivityId.value ? value : null
})
const safeDestination = computed(() => {
  const value = thread.value?.thread
  return value?.authorityKind === 'v2_mission' && value.learningVoidId
    ? `/app/learn/${encodeURIComponent(value.learningVoidId)}`
    : '/app/learn'
})
const safeDestinationLabel = computed(() => safeDestination.value === '/app/learn' ? 'Back to Learn' : 'Open your learning mission')
const evidenceOpenRequest = ref(0)
const evidenceReturnFocus = ref<HTMLButtonElement | null>(null)
function inspectEvidence(origin: HTMLButtonElement) {
  evidenceReturnFocus.value = origin
  evidenceOpenRequest.value += 1
}

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
        <p v-if="thread.thread.goal && thread.thread.goal !== thread.thread.outcome" class="mt-2 text-sm text-muted-foreground" data-testid="learn-thread-goal">Goal: {{ thread.thread.goal }}</p>
        <p v-if="thread.unresolvedPoint" class="mt-2 text-sm" data-testid="learn-thread-unresolved">Still open: {{ thread.unresolvedPoint }}</p>
        <p class="mt-3 rounded-lg bg-[var(--learn-evidence)] px-3 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">{{ thread.thread.lifecycle }} · Evidence {{ thread.thread.evidenceState }}</p>
        <div class="mt-3 flex items-center gap-3">
          <LearnAdaptiveEvidenceDrawer :evidence="evidence as never" :pending="evidenceQuery.pending.value" :source-state="selectedHistory ? evidence?.integrityState ?? 'unavailable' : thread.thread.evidenceState" :safe-destination="safeDestination" :safe-destination-label="safeDestinationLabel" :open-request="evidenceOpenRequest" :return-focus-to="evidenceReturnFocus" />
          <LearnAdaptiveMemoryDrawer :key="`${ownerId}:${threadId}`" :memory="memory as never" :pending="memoryQuery.pending.value" :busy="memoryBusy" :error="memoryError" :notice="memoryNotice" :retry-available="Boolean(pendingMemoryCommand)" @set-preference="requestMemoryCommand" @delete-artifact="requestMemoryArtifactDeletion" @refresh="reviewCurrentMemory" @retry="retryMemoryCommand" />
        </div>
      </header>

      <section v-if="thread.currentActivity || thread.artifact" class="mt-6 rounded-xl border border-border bg-card p-5" aria-label="Saved learning context" data-testid="learn-thread-resume-context">
        <p v-if="thread.currentActivity" class="text-sm">Current activity: {{ thread.currentActivity.purpose }} · {{ thread.currentActivity.status }}</p>
        <p v-if="thread.attemptContext?.priorOutcome" class="mt-2 text-sm">Previous attempt: {{ thread.attemptContext.priorOutcome }}</p>
        <p v-if="thread.attemptContext?.assistance && thread.attemptContext.assistance !== 'none'" class="mt-2 text-sm">Earlier work used {{ thread.attemptContext.assistance === 'hint' ? 'a hint' : 'a revealed example' }}.</p>
        <p v-if="thread.artifact" class="mt-2 text-sm">{{ thread.artifact.historical ? 'Historical artifact' : thread.artifact.status === 'saved' ? 'Saved artifact' : 'Draft artifact' }}: {{ thread.artifact.title }}</p>
      </section>

      <section class="mt-6 rounded-xl border border-border bg-[var(--learn-context-surface)] p-5" aria-labelledby="learn-thread-next-title">
        <h2 id="learn-thread-next-title" class="font-dm-sans text-lg font-semibold">Your next move</h2>
        <p v-if="thread.completion" class="mt-2 text-sm" data-testid="learn-representative-outcome" role="status">{{ thread.completion.status === 'passed' ? 'Representative task passed.' : 'Representative task needs more practice.' }} This result describes the scored task, not mastery.</p>
        <p class="mt-2 text-sm">{{ rollback ? 'Back to Learn' : thread.currentActivity || ['draft', 'ready'].includes(thread.thread.lifecycle) ? thread.nextAction.label : 'Review this thread from your learning home.' }}</p>
        <NuxtLink v-if="thread.completion && thread.thread.authorityKind === 'v2_mission'" :to="safeDestination" data-testid="learn-representative-next-move" class="mt-2 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]">{{ safeDestinationLabel }}</NuxtLink>
        <NuxtLink v-if="thread.nextAction.kind === 'clarify' && (canvas || diagnostic)" :to="safeDestination" class="mt-2 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]">{{ safeDestinationLabel }}</NuxtLink>
      </section>

      <section class="mt-6 rounded-xl bg-[var(--learn-activity-surface)] p-4" data-testid="learn-adaptive-canvas-frame" aria-label="Current learning activity">
        <div v-if="selectedActivityId && !showCurrent" data-testid="learn-selected-history" class="rounded-lg border border-border p-5">
          <template v-if="selectedHistory">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Past activity · {{ selectedHistory.status }}</p>
            <h2 class="mt-2 font-dm-sans text-lg font-semibold">{{ selectedHistory.purpose }}</h2>
            <p class="mt-2 text-sm text-muted-foreground">This past activity is read-only. Your current response remains in place.</p>
          </template>
          <p v-else role="status">This selected activity is unavailable.</p>
          <NuxtLink :to="currentActivityUrl" data-testid="learn-current-activity-link" class="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline">Return to current activity</NuxtLink>
        </div>
        <div v-if="showCurrent && canvasUnsafe" data-testid="learn-current-source-recovery" class="rounded-lg border border-border p-5" role="alert">
          <h2 class="font-dm-sans text-lg font-semibold">Evidence {{ thread.thread.evidenceState }}</h2>
          <p class="mt-2 text-sm text-muted-foreground">This factual activity cannot continue until its source is reviewed. Your response draft remains in place.</p>
          <NuxtLink :to="safeDestination" class="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline">{{ safeDestinationLabel }}</NuxtLink>
        </div>
        <div v-if="showCurrent && rollback" data-testid="learn-thread-rollback-recovery" class="rounded-lg border border-border p-5" role="status">
          <h2 class="font-dm-sans text-lg font-semibold">This activity is unavailable</h2>
          <p class="mt-2 text-sm text-muted-foreground">Your goal and past activity remain available for review. Open Learn to choose a safe next step.</p>
          <NuxtLink :to="safeDestination" class="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline">{{ safeDestinationLabel }}</NuxtLink>
        </div>
        <div v-if="showCurrent && endedReadOnly" data-testid="learn-thread-ended-history" class="rounded-lg border border-border p-5" role="status">
          <h2 class="font-dm-sans text-lg font-semibold">This thread has ended</h2>
          <p class="mt-2 text-sm text-muted-foreground">Your learning memory and past activity remain available for review.</p>
          <NuxtLink :to="safeDestination" class="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline">{{ safeDestinationLabel }}</NuxtLink>
        </div>
        <div v-show="showCurrent && !canvasUnsafe && !rollback && !endedReadOnly">
          <LearnAdaptiveReadySessionCanvas v-if="canvas" :key="`${ownerId}:${canvas.thread.id}:${canvas.activity.id}`" :canvas="canvas as never" :authoritative-revision="Math.max(thread.thread.revision, canvas.thread.revision)" :show-header="false" :active="showCurrent && !canvasUnsafe && !rollback" @leave="leave" @inspect-evidence="inspectEvidence" />
          <LearnAdaptiveArtifactWorkspace v-else-if="artifact" :key="`${ownerId}:${artifact.thread.id}:${artifact.activity.id}`" :canvas="artifact as never" :authoritative-revision="Math.max(thread.thread.revision, artifact.thread.revision)" @leave="leave" />
          <LearnAdaptiveReflectionNextMove v-else-if="reflection" :key="`${ownerId}:${reflection.thread.id}:${reflection.activity.id}`" :canvas="reflection as never" :authoritative-revision="Math.max(thread.thread.revision, reflection.thread.revision)" @leave="leave" />
          <LearnAdaptiveDiagnosticCanvas v-else-if="diagnostic" :key="`${ownerId}:${diagnostic.thread.id}:${diagnostic.activity?.id ?? 'draft'}`" :canvas="diagnostic as never" :authoritative-revision="Math.max(thread.thread.revision, diagnostic.thread.revision)" :show-header="false" :active="showCurrent" @leave="leave" />
          <div v-else-if="detailPending" data-testid="learn-adaptive-canvas-loading" class="rounded-lg border border-border p-5" role="status" aria-live="polite">
            <h2 class="font-dm-sans text-lg font-semibold">Loading current activity…</h2>
            <p class="mt-2 text-sm text-muted-foreground">Your thread and history are available while the activity loads.</p>
          </div>
          <div v-else data-testid="learn-adaptive-canvas-fallback" class="rounded-lg border border-border p-5" role="status">
            <h2 class="font-dm-sans text-lg font-semibold">Current activity unavailable</h2>
            <p class="mt-2 text-sm text-muted-foreground">Your thread and activity history are saved. Open the learning destination to continue safely.</p>
            <NuxtLink :to="safeDestination" data-testid="learn-adaptive-canvas-fallback-action" class="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]">{{ safeDestinationLabel }}</NuxtLink>
          </div>
        </div>
      </section>

      <section class="mt-6" aria-labelledby="learn-thread-history-title">
        <h2 id="learn-thread-history-title" class="font-dm-sans text-lg font-semibold">Recent activity</h2>
        <p v-if="thread.history.length === 0" class="mt-2 text-sm text-muted-foreground">Your activity history will appear here.</p>
        <ol v-else class="mt-3 space-y-2">
          <li v-for="item in thread.history" :key="item.id" class="rounded-lg border border-border px-4 py-3 text-sm">
            <NuxtLink :to="{ path: currentActivityUrl, query: { activity: item.id } }" class="inline-flex min-h-11 items-center font-medium text-[var(--learn-action)] underline">{{ item.purpose }}</NuxtLink>
            <p class="mt-1 text-xs text-muted-foreground">{{ item.status }}</p>
          </li>
        </ol>
      </section>
      <NuxtLink v-if="canvas || diagnostic || artifact || reflection" :to="safeDestination" data-testid="learn-adaptive-safe-destination" class="mt-6 inline-flex min-h-11 items-center text-sm text-muted-foreground underline">{{ safeDestinationLabel }}</NuxtLink>
    </div>
  </main>
</template>
