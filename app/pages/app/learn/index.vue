<script setup lang="ts">
import { useLearnV2Journey } from '~/composables/useLearnV2Journey'
import { useLearnAdaptiveAccess } from '~/composables/useLearnAdaptiveAccess'
import { getErrorMessage } from '~~/shared/errors'
import { api } from '#convex/api'
import type { NeedFirstDraftInput } from '~~/shared/learn-adaptive-draft'

type Intent = NeedFirstDraftInput['intent']

const router = useRouter()
const route = useRoute()
const { allowed, checkingAccess, hub } = useLearnV2Journey()
const { allowed: adaptiveAllowed, checkingAccess: checkingAdaptiveAccess } = useLearnAdaptiveAccess()
const legacyV2Mode = computed(() => adaptiveAllowed.value && route.query.legacy === 'v2')
const createDraftMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveDrafts.createThreadDraft) : { mutate: async () => null }
const prepareDecisionMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveClarifications.prepareInitialDecision) : { mutate: async () => null }
const resolveClarificationMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveClarifications.resolveClarification) : { mutate: async () => null }
const setIntentMutation = import.meta.client ? useConvexMutation(api.learnAdaptive.setIntent) : { mutate: async () => null }
const convex = import.meta.client ? useConvex() : null
const userQuery = import.meta.client ? useConvexQuery(api.users.getUser, {}) : { data: ref<{ _id: string } | null>(null) }
const readyTodayQuery = import.meta.client ? useConvexQuery(api.learnV2Today.getToday, {}, { enabled: adaptiveAllowed }) : { data: ref(null) }
const attachReadyMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.attachReadySession) : { mutate: async () => null }
const readyToday = computed(() => readyTodayQuery.data.value as { status: string, sessionId?: string, sessionRevision?: number, objective?: { title: string } } | null)
const readySession = computed(() => readyToday.value?.status === 'ready' && readyToday.value.sessionId && readyToday.value.sessionRevision !== undefined ? { id: readyToday.value.sessionId, revision: readyToday.value.sessionRevision, title: readyToday.value.objective?.title ?? 'Ready study session' } : null)
const attachBusy = ref(false)
const attachError = ref<string | null>(null)
const attachKey = ref<string | null>(null)
const draftBusy = ref(false)
const draftError = ref<string | null>(null)
const draftRequestKey = ref<string | null>(null)
const acknowledgedRequestKey = ref<string | null>(null)
type DraftPayload = { clientDraftId: string, need: string, outcome?: string, intent: string, availableTime: string, sourceScope: Record<string, unknown> }
type InitialDecision = { status: 'not_required' | 'pending' | 'answered' | 'skipped', continuationKind: 'ready_v2' | 'standalone_non_factual' | 'preparing_non_factual' | 'evidence_recovery', reasonCode?: string, question?: { key: 'useful_outcome', templateVersion: string, prompt: string, help: string } }
type InitialProjection = InitialDecision & { originalNeed: string, intent: Intent, revision: number }
const initialDecision = ref<{ threadId: string, originalNeed: string, intent: Intent, revision: number, decision: InitialDecision } | null>(null)
const clarificationBusy = ref(false)
const clarificationError = ref<string | null>(null)
const clarificationRequestKey = ref<string | null>(null)
const clarificationResolution = ref<{ kind: 'answer', answer: string } | { kind: 'skip' } | null>(null)
const intentBusy = ref(false)
const intentError = ref<string | null>(null)
const intentSaved = ref(false)
const intentRequestKey = ref<string | null>(null)
const pendingIntent = ref<Intent | null>(null)
const authorityConflict = ref<{ projection: InitialProjection, keptLocal: boolean } | null>(null)
const decisionHydrating = ref(false)
const decisionLoadError = ref<string | null>(null)
const decisionRestoreThreadId = ref<string | null>(null)
const ownerEpoch = ref(0)
const currentOwnerId = computed(() => userQuery.data.value?._id ? String(userQuery.data.value._id) : null)
const DECISION_POINTER_PREFIX = 'budds.learn.adaptive-initial-decision.v1'
const DECISION_POINTER_TTL_MS = 24 * 60 * 60 * 1_000
function decisionPointerKey(ownerId: string) { return `${DECISION_POINTER_PREFIX}:${ownerId}` }
function decisionAnswerKey(ownerId: string, threadId: string) { return `${DECISION_POINTER_PREFIX}:answer:${ownerId}:${threadId}` }
function storeDecisionPointer(ownerId: string, threadId: string) { try { sessionStorage.setItem(decisionPointerKey(ownerId), JSON.stringify({ threadId, savedAt: Date.now() })) } catch { return } }
function clearDecisionPointer(ownerId: string) { try { sessionStorage.removeItem(decisionPointerKey(ownerId)) } catch { return } }
function clearDecisionAnswers(ownerId: string, threadId?: string) {
  try {
    if (threadId) { sessionStorage.removeItem(decisionAnswerKey(ownerId, threadId)); return }
    const prefix = `${DECISION_POINTER_PREFIX}:answer:${ownerId}:`
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key)
    }
  }
  catch { return }
}
function readDecisionPointer(ownerId: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem(decisionPointerKey(ownerId)) ?? 'null') as { threadId?: unknown, savedAt?: unknown } | null
    if (!value || typeof value.threadId !== 'string' || typeof value.savedAt !== 'number' || Date.now() - value.savedAt > DECISION_POINTER_TTL_MS) {
      clearDecisionAnswers(ownerId, typeof value?.threadId === 'string' ? value.threadId : undefined)
      clearDecisionPointer(ownerId)
      return null
    }
    return value.threadId
  }
  catch { clearDecisionAnswers(ownerId); clearDecisionPointer(ownerId); return null }
}
async function hydrateInitialDecision(threadId: string, ownerId: string, epoch: number) {
  if (!convex) return null
  const projection = await convex.query(api.learnAdaptiveClarifications.getInitialDecision, { threadId: threadId as never }) as InitialProjection | null
  if (currentOwnerId.value !== ownerId || ownerEpoch.value !== epoch) return null
  if (!projection) { clearDecisionAnswers(ownerId, threadId); clearDecisionPointer(ownerId); initialDecision.value = null; return null }
  initialDecision.value = { threadId, originalNeed: projection.originalNeed, intent: projection.intent, revision: projection.revision, decision: projection }
  storeDecisionPointer(ownerId, threadId)
  return projection
}
async function reconcileClarificationConflict(threadId: string, ownerId: string, epoch: number) {
  if (!convex) return false
  const projection = await convex.query(api.learnAdaptiveClarifications.getInitialDecision, { threadId: threadId as never }) as InitialProjection | null
  if (currentOwnerId.value !== ownerId || ownerEpoch.value !== epoch || !projection) return false
  if (projection.status === 'pending') {
    if (initialDecision.value?.threadId === threadId && initialDecision.value.revision === projection.revision) return false
    initialDecision.value = { threadId, originalNeed: projection.originalNeed, intent: projection.intent, revision: projection.revision, decision: projection }
    clarificationRequestKey.value = null
    clarificationError.value = 'The thread changed in another session. Your original answer is retained; retry to apply it to the current revision.'
    return true
  }
  authorityConflict.value = { projection, keptLocal: false }
  return true
}
async function restoreInitialDecision() {
  const ownerId = currentOwnerId.value
  const threadId = decisionRestoreThreadId.value
  if (!ownerId || !threadId) return
  const epoch = ownerEpoch.value
  decisionHydrating.value = true
  decisionLoadError.value = null
  try { await hydrateInitialDecision(threadId, ownerId, epoch) }
  catch (cause) {
    if (currentOwnerId.value === ownerId && ownerEpoch.value === epoch) decisionLoadError.value = getErrorMessage(cause, 'Could not restore your saved clarification. Retry to continue safely.')
  }
  finally { if (currentOwnerId.value === ownerId && ownerEpoch.value === epoch) decisionHydrating.value = false }
}
function useAuthoritativeClarification() {
  const current = initialDecision.value
  const conflict = authorityConflict.value
  const ownerId = currentOwnerId.value
  if (!current || !conflict || !ownerId) return
  initialDecision.value = { threadId: current.threadId, originalNeed: conflict.projection.originalNeed, intent: conflict.projection.intent, revision: conflict.projection.revision, decision: conflict.projection }
  storeDecisionPointer(ownerId, current.threadId)
  authorityConflict.value = null
  clarificationRequestKey.value = null
  clarificationResolution.value = null
  clarificationError.value = null
}
function keepLocalClarification() { if (authorityConflict.value) authorityConflict.value.keptLocal = true }
watch(() => userQuery.data.value?._id ? String(userQuery.data.value._id) : null, (ownerId, priorOwnerId) => {
  if (ownerId === priorOwnerId) return
  ownerEpoch.value += 1
  initialDecision.value = null
  draftError.value = null
  draftRequestKey.value = null
  acknowledgedRequestKey.value = null
  draftBusy.value = false
  attachBusy.value = false
  attachError.value = null
  attachKey.value = null
  clarificationBusy.value = false
  clarificationError.value = null
  clarificationRequestKey.value = null
  clarificationResolution.value = null
  intentBusy.value = false
  intentError.value = null
  intentSaved.value = false
  intentRequestKey.value = null
  pendingIntent.value = null
  authorityConflict.value = null
  decisionHydrating.value = false
  decisionLoadError.value = null
  decisionRestoreThreadId.value = null
  if (ownerId) {
    const threadId = readDecisionPointer(ownerId)
    if (threadId) { decisionRestoreThreadId.value = threadId; void restoreInitialDecision() }
  }
}, { immediate: true })
function openMission(id: string) { void router.push(`/app/learn/${id}`) }
function resumeDraft(id: string) { void router.push(`/app/learn/create?draftId=${encodeURIComponent(id)}`) }
function openDiagnosticThread(threadId: string) {
  void router.push(`/app/learn/thread/${encodeURIComponent(threadId)}`)
}
watch(() => readySession.value && `${readySession.value.id}:${readySession.value.revision}`, (value, previous) => { if (value !== previous) attachKey.value = null })
async function continueReadySession() {
  const selected = readySession.value
  const ownerId = currentOwnerId.value
  const epoch = ownerEpoch.value
  if (!selected || !ownerId || attachBusy.value) return
  attachBusy.value = true
  attachError.value = null
  attachKey.value ??= `adaptive-ready:${crypto.randomUUID?.() ?? Date.now()}`
  try {
    const result = await attachReadyMutation.mutate({ studySessionId: selected.id as never, expectedSessionRevision: selected.revision, idempotencyKey: attachKey.value }) as { kind: string, threadId?: string }
    if (ownerEpoch.value !== epoch || currentOwnerId.value !== ownerId || readySession.value?.id !== selected.id || readySession.value.revision !== selected.revision) return
    if (result.kind !== 'attached' || !result.threadId) throw new Error('Could not open the ready learning thread.')
    await router.push(`/app/learn/thread/${result.threadId}`)
  }
  catch (cause) { if (ownerEpoch.value === epoch && currentOwnerId.value === ownerId) attachError.value = getErrorMessage(cause, 'Could not open the ready session. Try again.') }
  finally { if (ownerEpoch.value === epoch && currentOwnerId.value === ownerId) attachBusy.value = false }
}
async function createNeedDraft(payload: DraftPayload) {
  const dispatchOwnerId = currentOwnerId.value
  const dispatchEpoch = ownerEpoch.value
  if (!dispatchOwnerId) return
  const isCurrentDispatch = () => currentOwnerId.value === dispatchOwnerId && ownerEpoch.value === dispatchEpoch
  draftBusy.value = true
  draftError.value = null
  draftRequestKey.value ??= `need-draft-${payload.clientDraftId}`
  try {
    const { clientDraftId: _clientDraftId, ...serverPayload } = payload
    const result = await createDraftMutation.mutate({ ...serverPayload, idempotencyKey: draftRequestKey.value } as never) as { kind: string, thread?: { id: string, originalNeed: string, outcome: string, revision: number } }
    if (!isCurrentDispatch()) return
    if (result.kind !== 'created' || !result.thread) throw new Error(result.kind === 'conflict' ? 'This draft request conflicts with an earlier request. Refresh and try again.' : 'Could not create the learning draft.')
    storeDecisionPointer(dispatchOwnerId, result.thread.id)
    const prepared = await prepareDecisionMutation.mutate({ threadId: result.thread.id, expectedRevision: 1, idempotencyKey: `prepare-${payload.clientDraftId}` } as never) as { kind: string, revision?: number, value?: InitialDecision }
    if (!isCurrentDispatch()) return
    if (prepared.kind !== 'ok' || prepared.revision === undefined || !prepared.value) throw new Error(prepared.kind === 'conflict' ? 'This draft changed before preparation completed. Refresh and try again.' : 'Could not prepare the first learning step.')
    const authoritative = await hydrateInitialDecision(result.thread.id, dispatchOwnerId, dispatchEpoch)
    if (!authoritative || !isCurrentDispatch()) return
    acknowledgedRequestKey.value = draftRequestKey.value
    draftRequestKey.value = null
  }
  catch (cause) { if (isCurrentDispatch()) draftError.value = getErrorMessage(cause, 'Could not create the learning draft. Your input is still here.') }
  finally { if (isCurrentDispatch()) draftBusy.value = false }
}

async function resolveInitialClarification(resolution: { kind: 'answer', answer: string } | { kind: 'skip' }) {
  const current = initialDecision.value
  const dispatchOwnerId = currentOwnerId.value
  const dispatchEpoch = ownerEpoch.value
  if (!current || !dispatchOwnerId) return
  const isCurrentDispatch = () => currentOwnerId.value === dispatchOwnerId && ownerEpoch.value === dispatchEpoch && initialDecision.value?.threadId === current.threadId
  clarificationBusy.value = true
  clarificationError.value = null
  clarificationRequestKey.value ??= `clarify-${current.threadId}-${crypto.randomUUID?.() ?? Date.now()}`
  clarificationResolution.value ??= resolution
  try {
    const result = await resolveClarificationMutation.mutate({ threadId: current.threadId, expectedRevision: current.revision, idempotencyKey: clarificationRequestKey.value, resolution: clarificationResolution.value } as never) as { kind: string, revision?: number, value?: InitialDecision }
    if (!isCurrentDispatch()) return
    if (result.kind !== 'ok' || result.revision === undefined || !result.value) {
      if (result.kind === 'conflict') {
        if (await reconcileClarificationConflict(current.threadId, dispatchOwnerId, dispatchEpoch)) return
      }
      throw new Error(result.kind === 'conflict' ? 'This clarification changed in another session. Your answer is still here.' : 'Could not save the clarification.')
    }
    const authoritative = await hydrateInitialDecision(current.threadId, dispatchOwnerId, dispatchEpoch)
    if (!authoritative || !isCurrentDispatch()) return
    clarificationRequestKey.value = null
    clarificationResolution.value = null
  }
  catch (cause) {
    if (!isCurrentDispatch()) return
    try {
      if (await reconcileClarificationConflict(current.threadId, dispatchOwnerId, dispatchEpoch)) return
    }
    catch { /* Keep the pinned local answer when authority cannot be reloaded. */ }
    if (isCurrentDispatch()) clarificationError.value = getErrorMessage(cause, 'Could not save the clarification. Your answer is still here.')
  }
  finally { if (isCurrentDispatch()) clarificationBusy.value = false }
}

async function selectThreadIntent(intent: Intent) {
  const current = initialDecision.value
  const dispatchOwnerId = currentOwnerId.value
  const dispatchEpoch = ownerEpoch.value
  if (!current || !dispatchOwnerId || intentBusy.value || clarificationBusy.value) return
  const isCurrentDispatch = () => currentOwnerId.value === dispatchOwnerId && ownerEpoch.value === dispatchEpoch && initialDecision.value?.threadId === current.threadId
  if (pendingIntent.value !== intent) intentRequestKey.value = null
  pendingIntent.value = intent
  intentRequestKey.value ??= `set-intent-${current.threadId}-${crypto.randomUUID?.() ?? Date.now()}`
  intentBusy.value = true
  intentError.value = null
  intentSaved.value = false
  try {
    const result = await setIntentMutation.mutate({ threadId: current.threadId, intent, expectedRevision: current.revision, idempotencyKey: intentRequestKey.value } as never) as { kind: string, revision?: number }
    if (!isCurrentDispatch()) return
    if (result.kind === 'conflict') {
      await hydrateInitialDecision(current.threadId, dispatchOwnerId, dispatchEpoch)
      if (!isCurrentDispatch()) return
      intentRequestKey.value = null
      pendingIntent.value = null
      intentError.value = 'The thread changed in another session. Your selected intent is still here. Retry to save it.'
      return
    }
    if (result.kind !== 'ok') throw new Error('Could not save the selected intent.')
    const authoritative = await hydrateInitialDecision(current.threadId, dispatchOwnerId, dispatchEpoch)
    if (!authoritative || !isCurrentDispatch()) return
    intentRequestKey.value = null
    pendingIntent.value = null
    if (authoritative.intent !== intent) {
      intentError.value = 'The thread changed in another session. Your selected intent is still here. Retry to save it.'
      return
    }
    intentSaved.value = true
  }
  catch (cause) {
    if (isCurrentDispatch()) intentError.value = getErrorMessage(cause, 'Could not save the selected intent. Your choice is still here.')
  }
  finally { if (isCurrentDispatch()) intentBusy.value = false }
}
</script>
<template>
  <main>
    <section v-if="checkingAccess || checkingAdaptiveAccess" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">Checking access…</p></section>
    <section v-else-if="!allowed" class="mx-auto max-w-2xl p-6"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">This learning experience is not available for this account.</p></section>
    <template v-else-if="adaptiveAllowed && !legacyV2Mode">
      <section v-if="readySession" class="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6" data-testid="learn-adaptive-ready-session">
        <UiCard class="gap-3 p-5">
          <h2 class="font-dm-sans text-lg font-semibold">Ready to continue</h2>
          <p class="text-sm text-muted-foreground">{{ readySession.title }}</p>
          <p v-if="attachError" role="alert" data-testid="learn-adaptive-attach-error" class="text-sm text-destructive">{{ attachError }}</p>
          <UiButton type="button" class="min-h-11 self-start" data-testid="learn-adaptive-continue-ready" :disabled="attachBusy" @click="continueReadySession">{{ attachBusy ? 'Opening…' : 'Continue in your learning thread' }}</UiButton>
        </UiCard>
      </section>
      <template v-if="initialDecision">
        <LearnAdaptiveInitialClarification :original-need="initialDecision.originalNeed" :intent="initialDecision.intent" :decision="initialDecision.decision" :busy="clarificationBusy || intentBusy" :intent-saved="intentSaved" :server-error="clarificationError" :intent-error="intentError" :answer-storage-key="currentOwnerId ? decisionAnswerKey(currentOwnerId, initialDecision.threadId) : undefined" :locked-resolution-kind="clarificationResolution?.kind" :authority-conflict="authorityConflict ? { keptLocal: authorityConflict.keptLocal } : null" @resolve="resolveInitialClarification" @select-intent="selectThreadIntent" @use-authority="useAuthoritativeClarification" @keep-local="keepLocalClarification" />
        <div v-if="initialDecision.decision.status !== 'pending'" class="mx-auto max-w-3xl px-4 pb-6 sm:px-6">
          <UiButton type="button" class="min-h-11" data-testid="learn-adaptive-open-diagnostic" @click="openDiagnosticThread(initialDecision.threadId)">Open your learning thread</UiButton>
        </div>
      </template>
      <section v-else-if="decisionHydrating || decisionLoadError" class="mx-auto max-w-2xl p-6" aria-live="polite" data-testid="learn-clarification-restore"><p>{{ decisionHydrating ? 'Restoring your saved clarification…' : decisionLoadError }}</p><UiButton v-if="decisionLoadError" type="button" class="mt-3 min-h-11" data-testid="learn-clarification-restore-retry" @click="restoreInitialDecision">Retry</UiButton></section>
      <LearnAdaptiveLearningHome v-else :busy="draftBusy" :server-error="draftError" :acknowledged-request-key="acknowledgedRequestKey" @start="createNeedDraft" @resume="openDiagnosticThread" />
    </template>
    <LearnV2LearnHub v-else :snapshot="hub" @create="router.push('/app/learn/create')" @open-mission="openMission" @start-session="openMission" @continue-setup="openMission" @resume-draft="resumeDraft" />
    <nav v-if="allowed && adaptiveAllowed" aria-label="Existing learning routes" class="mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6" data-testid="learn-legacy-handoffs">
      <h2 class="font-dm-sans text-lg font-semibold">Existing learning routes</h2>
      <p class="mt-1 text-sm text-muted-foreground">Your existing courses and learning missions remain available.</p>
      <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <NuxtLink v-if="legacyV2Mode" to="/app/learn" class="min-h-11 content-center text-[var(--learn-action)] underline">Return to adaptive Learn</NuxtLink>
        <NuxtLink v-else to="/app/learn?legacy=v2" data-testid="learn-legacy-v2-hub" class="min-h-11 content-center text-[var(--learn-action)] underline">Open V2 learning plans</NuxtLink>
        <NuxtLink to="/app/learn/today" data-testid="learn-legacy-v2-today" class="min-h-11 content-center text-[var(--learn-action)] underline">Open today's sessions</NuxtLink>
        <NuxtLink to="/app/learn/review" data-testid="learn-legacy-v2-review" class="min-h-11 content-center text-[var(--learn-action)] underline">Open review</NuxtLink>
        <NuxtLink to="/app/learn/create" data-testid="learn-legacy-v2-create" class="min-h-11 content-center text-[var(--learn-action)] underline">Create a V2 learning plan</NuxtLink>
      </div>
      <p class="mt-3 text-sm text-muted-foreground">Classic courses remain in each folder's Learn tab.</p>
      <NuxtLink to="/" data-testid="learn-legacy-v1-home" class="min-h-11 content-center text-sm text-[var(--learn-action)] underline">Open your folders for classic courses</NuxtLink>
    </nav>
  </main>
</template>
