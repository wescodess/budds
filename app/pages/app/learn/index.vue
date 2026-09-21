<script setup lang="ts">
import { useLearnV2Journey } from '~/composables/useLearnV2Journey'
import { useLearnAdaptiveAccess } from '~/composables/useLearnAdaptiveAccess'
import { getErrorMessage } from '~~/shared/errors'
import { api } from '#convex/api'

const router = useRouter()
const { allowed, checkingAccess, hub } = useLearnV2Journey()
const { allowed: adaptiveAllowed, checkingAccess: checkingAdaptiveAccess } = useLearnAdaptiveAccess()
const createDraftMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveDrafts.createThreadDraft) : { mutate: async () => null }
const prepareDecisionMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveClarifications.prepareInitialDecision) : { mutate: async () => null }
const resolveClarificationMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveClarifications.resolveClarification) : { mutate: async () => null }
const convex = import.meta.client ? useConvex() : null
const userQuery = import.meta.client ? useConvexQuery(api.users.getUser, {}) : { data: ref<{ _id: string } | null>(null) }
const draftBusy = ref(false)
const draftError = ref<string | null>(null)
const draftRequestKey = ref<string | null>(null)
const acknowledgedRequestKey = ref<string | null>(null)
type DraftPayload = { clientDraftId: string, need: string, outcome?: string, intent: string, availableTime: string, sourceScope: Record<string, unknown> }
type InitialDecision = { status: 'not_required' | 'pending' | 'answered' | 'skipped', continuationKind: 'ready_v2' | 'standalone_non_factual' | 'preparing_non_factual' | 'evidence_recovery', reasonCode?: string, question?: { key: 'useful_outcome', templateVersion: string, prompt: string, help: string } }
type InitialProjection = InitialDecision & { originalNeed: string, revision: number }
const initialDecision = ref<{ threadId: string, originalNeed: string, revision: number, decision: InitialDecision } | null>(null)
const clarificationBusy = ref(false)
const clarificationError = ref<string | null>(null)
const clarificationRequestKey = ref<string | null>(null)
const clarificationResolution = ref<{ kind: 'answer', answer: string } | { kind: 'skip' } | null>(null)
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
  initialDecision.value = { threadId, originalNeed: projection.originalNeed, revision: projection.revision, decision: projection }
  if (projection.status === 'pending') storeDecisionPointer(ownerId, threadId)
  else clearDecisionPointer(ownerId)
  return projection
}
async function reconcileClarificationConflict(threadId: string, ownerId: string, epoch: number) {
  if (!convex) return false
  const projection = await convex.query(api.learnAdaptiveClarifications.getInitialDecision, { threadId: threadId as never }) as InitialProjection | null
  if (currentOwnerId.value !== ownerId || ownerEpoch.value !== epoch || !projection) return false
  if (projection.status === 'pending') {
    if (initialDecision.value?.threadId === threadId && initialDecision.value.revision === projection.revision) return false
    initialDecision.value = { threadId, originalNeed: projection.originalNeed, revision: projection.revision, decision: projection }
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
  initialDecision.value = { threadId: current.threadId, originalNeed: conflict.projection.originalNeed, revision: conflict.projection.revision, decision: conflict.projection }
  clearDecisionPointer(ownerId)
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
  clarificationBusy.value = false
  clarificationError.value = null
  clarificationRequestKey.value = null
  clarificationResolution.value = null
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
</script>
<template><main><section v-if="checkingAccess || checkingAdaptiveAccess" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">Checking access…</p></section><section v-else-if="!allowed" class="mx-auto max-w-2xl p-6"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">This learning experience is not available for this account.</p></section><template v-else-if="adaptiveAllowed"><LearnAdaptiveInitialClarification v-if="initialDecision" :original-need="initialDecision.originalNeed" :decision="initialDecision.decision" :busy="clarificationBusy" :server-error="clarificationError" :answer-storage-key="currentOwnerId ? decisionAnswerKey(currentOwnerId, initialDecision.threadId) : undefined" :locked-resolution-kind="clarificationResolution?.kind" :authority-conflict="authorityConflict ? { keptLocal: authorityConflict.keptLocal } : null" @resolve="resolveInitialClarification" @use-authority="useAuthoritativeClarification" @keep-local="keepLocalClarification" /><section v-else-if="decisionHydrating || decisionLoadError" class="mx-auto max-w-2xl p-6" aria-live="polite" data-testid="learn-clarification-restore"><p>{{ decisionHydrating ? 'Restoring your saved clarification…' : decisionLoadError }}</p><UiButton v-if="decisionLoadError" type="button" class="mt-3 min-h-11" data-testid="learn-clarification-restore-retry" @click="restoreInitialDecision">Retry</UiButton></section><LearnAdaptiveLearningHome v-else :busy="draftBusy" :server-error="draftError" :acknowledged-request-key="acknowledgedRequestKey" @start="createNeedDraft" /></template><LearnV2LearnHub v-else :snapshot="hub" @create="router.push('/app/learn/create')" @open-mission="openMission" @start-session="openMission" @continue-setup="openMission" @resume-draft="resumeDraft" /></main></template>
