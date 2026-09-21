<script setup lang="ts">
import { useLearnV2Journey } from '~/composables/useLearnV2Journey'
import { useLearnAdaptiveAccess } from '~/composables/useLearnAdaptiveAccess'
import { getErrorMessage } from '~~/shared/errors'
import { api } from '#convex/api'

const router = useRouter()
const { allowed, checkingAccess, hub } = useLearnV2Journey()
const { allowed: adaptiveAllowed, checkingAccess: checkingAdaptiveAccess } = useLearnAdaptiveAccess()
const createDraftMutation = import.meta.client ? useConvexMutation(api.learnAdaptiveDrafts.createThreadDraft) : { mutate: async () => null }
const userQuery = import.meta.client ? useConvexQuery(api.users.getUser, {}) : { data: ref<{ _id: string } | null>(null) }
const draftBusy = ref(false)
const draftError = ref<string | null>(null)
const draftRequestKey = ref<string | null>(null)
const acknowledgedRequestKey = ref<string | null>(null)
type DraftPayload = { clientDraftId: string, need: string, outcome?: string, intent: string, availableTime: string, sourceScope: Record<string, unknown> }
const createdDraft = ref<{ threadId: string } | null>(null)
const ownerEpoch = ref(0)
const currentOwnerId = computed(() => userQuery.data.value?._id ? String(userQuery.data.value._id) : null)
watch(() => userQuery.data.value?._id ? String(userQuery.data.value._id) : null, (ownerId, priorOwnerId) => {
  if (ownerId === priorOwnerId) return
  ownerEpoch.value += 1
  createdDraft.value = null
  draftError.value = null
  draftRequestKey.value = null
  acknowledgedRequestKey.value = null
  draftBusy.value = false
})
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
    const result = await createDraftMutation.mutate({ ...serverPayload, idempotencyKey: draftRequestKey.value } as never) as { kind: string, thread?: { id: string, originalNeed: string, outcome: string } }
    if (!isCurrentDispatch()) return
    if (result.kind !== 'created' || !result.thread) throw new Error(result.kind === 'conflict' ? 'This draft request conflicts with an earlier request. Refresh and try again.' : 'Could not create the learning draft.')
    createdDraft.value = { threadId: result.thread.id }
    acknowledgedRequestKey.value = draftRequestKey.value
    draftRequestKey.value = null
  }
  catch (cause) { if (isCurrentDispatch()) draftError.value = getErrorMessage(cause, 'Could not create the learning draft. Your input is still here.') }
  finally { if (isCurrentDispatch()) draftBusy.value = false }
}
</script>
<template><main><section v-if="checkingAccess || checkingAdaptiveAccess" class="mx-auto max-w-2xl p-6" aria-live="polite"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">Checking access…</p></section><section v-else-if="!allowed" class="mx-auto max-w-2xl p-6"><h1 class="font-dm-sans text-2xl font-bold">Learn</h1><p class="mt-2 text-muted-foreground">This learning experience is not available for this account.</p></section><template v-else-if="adaptiveAllowed"><section v-if="createdDraft" class="mx-auto max-w-3xl px-4 pt-6 sm:px-6" data-testid="learn-adaptive-created" aria-live="polite"><UiAlert><UiAlertTitle>Learning draft created</UiAlertTitle><UiAlertDescription>Your need and intended outcome are saved in this draft.</UiAlertDescription></UiAlert></section><LearnAdaptiveLearningHome :busy="draftBusy" :server-error="draftError" :acknowledged-request-key="acknowledgedRequestKey" @start="createNeedDraft" /></template><LearnV2LearnHub v-else :snapshot="hub" @create="router.push('/app/learn/create')" @open-mission="openMission" @start-session="openMission" @continue-setup="openMission" @resume-draft="resumeDraft" /></main></template>
