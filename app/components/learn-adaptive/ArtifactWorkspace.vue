<script setup lang="ts">
import { api } from '#convex/api'
import { adaptiveActivityFallbackForReason } from '~~/shared/learn-adaptive-activity-registry'
import { resolveAdaptiveActivityRenderer } from '~~/shared/learn-adaptive-renderer-contract'
import { boundedArtifactText } from '~~/shared/learn-adaptive-artifact'

type Artifact = { id: string, activityId: string, artifactKind: 'note' | 'plan' | 'draft' | 'answer' | 'other', title: string, summary: string, status: 'draft' | 'saved' | 'deleted', readOnly: boolean, historical: boolean, evidenceLabel: string | null, createdAt?: number }
type Canvas = { ownerId: string, status: string, thread: { id: string, revision: number, outcome: string }, activity: {
  id: string, planRevision: number, status: string, primitive: null | { contractVersion: string, rendererVersion: string, type: string, action: string, testId: string, props: unknown },
  fallback: { title: string, body: string, testId: string, primaryAction: { label: string } }
}, recovery?: { title: string, body: string, action: string } }
const props = withDefaults(defineProps<{ canvas: Canvas, authoritativeRevision?: number, active?: boolean }>(), { active: true })
const emit = defineEmits<{ leave: [] }>()
const { isOnline } = useOnlineStatus()
const artifactQuery = import.meta.client ? useConvexQuery(api.learnAdaptive.listThreadArtifacts, computed(() => ({ threadId: props.canvas.thread.id as never }))) : { data: ref<Artifact[] | null>(null), pending: ref(false) }
const listHydrated = computed(() => !artifactQuery.pending.value && Array.isArray(artifactQuery.data.value))
const saveMutation = import.meta.client ? useConvexMutation(api.learnAdaptive.saveArtifact) : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
const deleteMutation = import.meta.client ? useConvexMutation(api.learnAdaptive.deleteArtifact) : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
const validation = computed(() => {
  const primitive = props.canvas.activity.primitive
  if (!primitive || props.canvas.status === 'blocked') return { value: null, reason: 'renderer_unavailable' as const }
  const result = resolveAdaptiveActivityRenderer(primitive, 'artifact')
  if (!result.ok) return { value: null, reason: result.reason }
  if (result.value.type !== 'artifact_workspace' || result.value.action !== 'save_artifact') return { value: null, reason: 'unsupported_action' as const }
  return { value: result.value, reason: null }
})
const workspace = computed(() => validation.value.value)
const fallback = computed(() => props.canvas.status === 'blocked' && props.canvas.recovery
  ? { title: props.canvas.recovery.title, body: props.canvas.recovery.body, testId: 'learn-activity-fallback', primaryAction: { label: props.canvas.recovery.action } }
  : validation.value.reason ? adaptiveActivityFallbackForReason(validation.value.reason) : props.canvas.activity.fallback)
const currentArtifacts = computed(() => (artifactQuery.data.value ?? []).filter((item: Artifact) => item.activityId === props.canvas.activity.id
  && item.artifactKind === workspace.value?.props.artifactKind && item.id !== locallyDeletedArtifactId.value))
const latest = computed<Artifact | null>(() => localArtifactId.value
  ? currentArtifacts.value.find((item: Artifact) => item.id === localArtifactId.value) ?? knownSnapshot.value
  : currentArtifacts.value[0] ?? null)
const threadRevision = ref(Math.max(props.canvas.thread.revision, props.authoritativeRevision ?? 0))
watch([() => props.canvas.thread.revision, () => props.authoritativeRevision], ([a, b]) => { threadRevision.value = Math.max(threadRevision.value, a, b ?? 0) })
const draftKey = computed(() => `learn-artifact:${props.canvas.ownerId}:${props.canvas.thread.id}:${props.canvas.activity.id}:plan:${props.canvas.activity.planRevision}`)
const pendingCreateKey = computed(() => `${draftKey.value}:pending-create`)
const knownArtifactKey = computed(() => `${draftKey.value}:known-id`)
const title = ref('')
const summary = ref('')
const dirty = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const localSavedStatus = ref<'draft' | 'saved' | null>(null)
const saveKey = ref<string | null>(null)
const saveUnconfirmed = ref(false)
type SaveSnapshot = { title: string, summary: string, artifactId: string | undefined, artifactKind: 'note' | 'plan' | 'draft' | 'answer' | 'other',
  status: 'draft' | 'saved', expectedRevision: number, idempotencyKey: string }
const pendingSave = ref<SaveSnapshot | null>(null)
const localArtifactId = ref<string | null>(null)
const knownSnapshot = ref<Artifact | null>(null)
const locallyDeletedArtifactId = ref<string | null>(null)
const deleteKey = ref<string | null>(null)
const titleField = ref<HTMLInputElement | null>(null)
const summaryField = ref<HTMLTextAreaElement | null>(null)
const fallbackAction = ref<HTMLButtonElement | null>(null)
const savedHeading = ref<HTMLElement | null>(null)
const storageReady = ref(false)
let baselineTitle = ''
let baselineSummary = ''
const OPERATION_TTL_MS = 29 * 24 * 60 * 60 * 1000
function operationScope() {
  return { ownerId: props.canvas.ownerId, threadId: props.canvas.thread.id, activityId: props.canvas.activity.id, planRevision: props.canvas.activity.planRevision }
}
function validAge(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value <= Date.now() + 5 * 60_000 && Date.now() - value <= OPERATION_TTL_MS
}
function scopedRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const scope = operationScope()
  return record.version === 1 && validAge(record.savedAt) && record.ownerId === scope.ownerId
    && record.threadId === scope.threadId && record.activityId === scope.activityId && record.planRevision === scope.planRevision
}
function clearStored(key: string) { try { sessionStorage.removeItem(key) } catch { /* Storage is optional for editing. */ } }
function persistPendingCreate(snapshot: SaveSnapshot) {
  try {
    sessionStorage.setItem(pendingCreateKey.value, JSON.stringify({ version: 1, savedAt: Date.now(), ...operationScope(), snapshot }))
    return true
  }
  catch { return false }
}
function persistKnownArtifactId(artifactId: string, snapshot: SaveSnapshot) {
  try { sessionStorage.setItem(knownArtifactKey.value, JSON.stringify({ version: 1, savedAt: Date.now(), ...operationScope(), artifactId,
    title: snapshot.title, summary: snapshot.summary, status: snapshot.status, artifactKind: snapshot.artifactKind })) }
  catch { /* The mounted editor still retains the returned artifact ID. */ }
}
function restoreCommandState() {
  locallyDeletedArtifactId.value = null
  localArtifactId.value = null
  knownSnapshot.value = null
  pendingSave.value = null
  saveUnconfirmed.value = false
  saveKey.value = null
  let known: unknown = null
  try { const raw = sessionStorage.getItem(knownArtifactKey.value); if (raw) known = JSON.parse(raw) }
  catch { clearStored(knownArtifactKey.value) }
  if (known) {
    if (scopedRecord(known) && typeof known.artifactId === 'string' && known.artifactId.length > 0 && known.artifactId.length <= 200
      && typeof known.title === 'string' && typeof known.summary === 'string'
      && (known.status === 'draft' || known.status === 'saved') && known.artifactKind === workspace.value?.props.artifactKind) {
      try {
        boundedArtifactText(known.title, known.summary, known.status)
        localArtifactId.value = known.artifactId
        knownSnapshot.value = { id: known.artifactId, activityId: props.canvas.activity.id, artifactKind: known.artifactKind as Artifact['artifactKind'],
          title: known.title, summary: known.summary, status: known.status, readOnly: false, historical: false, evidenceLabel: null }
      }
      catch { clearStored(knownArtifactKey.value) }
    }
    else clearStored(knownArtifactKey.value)
  }
  let pending: unknown = null
  try { const raw = sessionStorage.getItem(pendingCreateKey.value); if (raw) pending = JSON.parse(raw) }
  catch { clearStored(pendingCreateKey.value) }
  if (pending) {
    if (!scopedRecord(pending) || localArtifactId.value) { clearStored(pendingCreateKey.value); return }
    const snapshot = pending.snapshot as Partial<SaveSnapshot> | undefined
    if (!snapshot || snapshot.artifactId !== undefined || !['draft', 'saved'].includes(snapshot.status ?? '')
      || snapshot.artifactKind !== workspace.value?.props.artifactKind
      || typeof snapshot.title !== 'string' || typeof snapshot.summary !== 'string'
      || !Number.isSafeInteger(snapshot.expectedRevision) || (snapshot.expectedRevision ?? -1) < 0
      || typeof snapshot.idempotencyKey !== 'string' || !/^artifact-save:[\w-]{1,80}$/.test(snapshot.idempotencyKey)) {
      clearStored(pendingCreateKey.value); return
    }
    try { boundedArtifactText(snapshot.title, snapshot.summary, snapshot.status as 'draft' | 'saved') }
    catch { clearStored(pendingCreateKey.value); return }
    pendingSave.value = snapshot as SaveSnapshot
    saveKey.value = snapshot.idempotencyKey
    saveUnconfirmed.value = true
    title.value = snapshot.title
    summary.value = snapshot.summary
    dirty.value = true
    error.value = 'Save outcome is unconfirmed. Retry to reconcile the original artifact.'
  }
}
function restoreDraft() {
  storageReady.value = false
  if (latest.value) localSavedStatus.value = null
  baselineTitle = latest.value?.title ?? ''
  baselineSummary = latest.value?.summary ?? workspace.value?.props.starterText ?? ''
  title.value = baselineTitle
  summary.value = baselineSummary
  dirty.value = false
  try {
    const raw = sessionStorage.getItem(draftKey.value)
    if (raw) {
      const saved = JSON.parse(raw) as { title?: unknown, summary?: unknown }
      if (typeof saved.title === 'string' && typeof saved.summary === 'string' && saved.title.length <= 160 && saved.summary.length <= 4096) {
        title.value = saved.title
        summary.value = saved.summary
        dirty.value = saved.title !== baselineTitle || saved.summary !== baselineSummary
      }
    }
  }
  catch { /* Storage is optional; the server copy remains authoritative. */ }
  storageReady.value = true
}
onMounted(async () => {
  restoreDraft()
  restoreCommandState()
  await nextTick()
  if (!workspace.value && props.active) fallbackAction.value?.focus()
})
watch([draftKey, () => latest.value?.id, () => latest.value?.title, () => latest.value?.summary], ([key], [previousKey]) => {
  const hasUnsavedEdits = title.value !== baselineTitle || summary.value !== baselineSummary
  if (key !== previousKey) { restoreDraft(); restoreCommandState() }
  else if (!hasUnsavedEdits && !busy.value) restoreDraft()
})
watch([title, summary], () => {
  if (!storageReady.value) return
  dirty.value = title.value !== baselineTitle || summary.value !== baselineSummary
  try {
    if (dirty.value) sessionStorage.setItem(draftKey.value, JSON.stringify({ title: title.value, summary: summary.value }))
    else sessionStorage.removeItem(draftKey.value)
  }
  catch { /* Editing remains available when local storage is full. */ }
})
watch([workspace, () => props.active], async ([value, active]) => {
  if (value || !active) return
  await nextTick()
  fallbackAction.value?.focus()
})

async function save(status: 'draft' | 'saved') {
  if (!workspace.value || busy.value || !isOnline.value || !listHydrated.value || latest.value?.readOnly || saveUnconfirmed.value && pendingSave.value?.status !== status) return
  try { boundedArtifactText(title.value, summary.value, status) }
  catch { error.value = status === 'saved' ? 'Add a title and a summary within the size limits before saving.' : 'Add a title within the size limit before saving a draft.'; titleField.value?.focus(); return }
  busy.value = true; error.value = ''
  saveKey.value ??= `artifact-save:${crypto.randomUUID()}`
  const snapshot: SaveSnapshot = pendingSave.value ?? { title: title.value, summary: summary.value, artifactId: localArtifactId.value ?? latest.value?.id,
    artifactKind: workspace.value.props.artifactKind, status, expectedRevision: threadRevision.value, idempotencyKey: saveKey.value }
  if (!snapshot.artifactId && !pendingSave.value && !persistPendingCreate(snapshot)) {
    saveKey.value = null
    busy.value = false
    error.value = 'This browser cannot preserve a safe retry for a new artifact. Enable session storage and try again.'
    return
  }
  try {
    const result = await saveMutation.mutate({ threadId: props.canvas.thread.id as never, activityId: props.canvas.activity.id,
      artifactId: snapshot.artifactId as never, artifactKind: snapshot.artifactKind,
      title: snapshot.title, summary: snapshot.summary, status: snapshot.status, expectedRevision: snapshot.expectedRevision, idempotencyKey: snapshot.idempotencyKey }) as { kind: string, revision?: number, value?: { artifactId?: string } }
    if (result.kind !== 'ok') { clearStored(pendingCreateKey.value); saveKey.value = null; pendingSave.value = null; saveUnconfirmed.value = false; error.value = result.kind === 'conflict' ? 'This thread changed. Refresh before saving again; your draft remains here.' : 'The artifact could not be saved. Your draft remains here.'; return }
    const returnedArtifactId = result.value?.artifactId ?? snapshot.artifactId
    if (!returnedArtifactId) {
      pendingSave.value = snapshot
      saveUnconfirmed.value = true
      error.value = 'The save was acknowledged without an artifact ID. Retry the original command to reconcile it.'
      return
    }
    threadRevision.value = result.revision ?? threadRevision.value
    localArtifactId.value = returnedArtifactId
    knownSnapshot.value = { id: returnedArtifactId, activityId: props.canvas.activity.id, artifactKind: snapshot.artifactKind,
      title: snapshot.title, summary: snapshot.summary, status: snapshot.status, readOnly: false, historical: false, evidenceLabel: null }
    persistKnownArtifactId(returnedArtifactId, snapshot)
    clearStored(pendingCreateKey.value)
    saveKey.value = null
    pendingSave.value = null
    saveUnconfirmed.value = false
    dirty.value = false
    localSavedStatus.value = status
    try { sessionStorage.removeItem(draftKey.value) }
    catch { /* The server save succeeded. */ }
    notice.value = status === 'saved' ? 'Artifact saved. This is a useful work product, not a mastery result.' : 'Artifact draft saved.'
    await nextTick()
    savedHeading.value?.focus()
  }
  catch { pendingSave.value = snapshot; saveUnconfirmed.value = true; error.value = 'Save outcome is unconfirmed. Your draft remains here; retry to reconcile it.' }
  finally { busy.value = false }
}

async function remove() {
  if (!latest.value || latest.value.readOnly || busy.value || saveUnconfirmed.value || !isOnline.value || !listHydrated.value) return
  busy.value = true; error.value = ''
  deleteKey.value ??= `artifact-delete:${crypto.randomUUID()}`
  try {
    const artifactId = latest.value.id
    const result = await deleteMutation.mutate({ threadId: props.canvas.thread.id as never, artifactId: latest.value.id as never,
      expectedRevision: threadRevision.value, idempotencyKey: deleteKey.value }) as { kind: string, revision?: number, value?: { cleanupPending?: boolean } }
    if (result.kind !== 'ok') { deleteKey.value = null; error.value = 'This artifact could not be deleted. Refresh before retrying.'; return }
    threadRevision.value = result.revision ?? threadRevision.value
    deleteKey.value = null
    locallyDeletedArtifactId.value = artifactId
    localArtifactId.value = null
    knownSnapshot.value = null
    clearStored(knownArtifactKey.value)
    localSavedStatus.value = null
    notice.value = result.value?.cleanupPending ? 'Artifact removed. File cleanup is pending.' : 'Artifact removed.'
  }
  catch { error.value = 'Delete outcome is unconfirmed. Retry to reconcile it.' }
  finally { busy.value = false }
}
</script>

<template>
  <section data-testid="learn-artifact-canvas" aria-label="Artifact workspace" class="min-w-0">
    <p v-if="!isOnline" role="status" class="mt-4 text-sm">A connection is required to save or delete an artifact. Your draft remains on this device.</p>
    <p v-if="!listHydrated" role="status" class="mt-4 text-sm">Checking saved artifacts before editing. Your draft remains available.</p>
    <p v-if="error" role="alert" class="mt-4 rounded-lg border border-destructive p-3 text-sm">{{ error }}</p>
    <p v-if="notice" role="status" aria-live="polite" class="mt-3 text-sm">{{ notice }}</p>
    <div v-if="!workspace" :data-testid="fallback.testId" role="alert" class="rounded-xl border border-border bg-card p-5">
      <h2 class="text-xl font-semibold">{{ fallback.title }}</h2>
      <p class="mt-2 text-sm">{{ fallback.body }}</p>
      <p v-if="dirty" role="status" class="mt-2 text-sm">Your unfinished artifact remains on this device.</p>
      <button ref="fallbackAction" type="button" class="mt-4 min-h-11 rounded-lg border border-border px-4" @click="emit('leave')">{{ fallback.primaryAction.label }}</button>
    </div>
    <article v-else :data-testid="workspace.testId" class="rounded-xl border border-border bg-card p-5">
      <h2 class="text-xl font-semibold">Build a useful artifact</h2>
      <p class="mt-2 whitespace-pre-wrap break-words">{{ workspace.props.prompt }}</p>
      <p class="mt-2 text-sm">{{ workspace.props.artifactKind }} · Saving an artifact does not score your learning or prove mastery.</p>
      <p v-if="latest" ref="savedHeading" tabindex="-1" role="status" data-testid="learn-artifact-saved-status" class="mt-3 text-sm focus:outline-none">{{ latest.readOnly ? 'Historical artifact · read-only' : latest.status === 'saved' ? 'Saved artifact' : 'Saved draft' }}{{ dirty ? ' · unsaved edits' : '' }}.</p>
      <p v-else ref="savedHeading" tabindex="-1" role="status" class="mt-3 text-sm focus:outline-none">{{ localSavedStatus === 'saved' ? 'Saved artifact' : localSavedStatus === 'draft' ? 'Saved draft' : dirty ? 'Draft on this device' : 'Ready to create' }}.</p>
      <div v-if="latest?.readOnly" class="mt-3 rounded-lg border border-border p-3 text-sm">The original activity or evidence is unavailable. This artifact is read-only.</div>
      <label class="mt-4 block text-sm font-medium">Title<input ref="titleField" v-model="title" data-testid="learn-artifact-title" maxlength="160" :disabled="busy || saveUnconfirmed || latest?.readOnly" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"></label>
      <label class="mt-4 block text-sm font-medium">Content<textarea ref="summaryField" v-model="summary" data-testid="learn-artifact-content" rows="8" maxlength="4096" :disabled="busy || saveUnconfirmed || latest?.readOnly" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
      <div class="mt-4 flex flex-wrap gap-2 pb-[env(safe-area-inset-bottom)]">
        <button type="button" data-testid="learn-artifact-save-draft" :disabled="busy || !isOnline || !listHydrated || latest?.readOnly || saveUnconfirmed && pendingSave?.status !== 'draft'" class="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50" @click="save('draft')">Save draft</button>
        <button type="button" data-testid="learn-artifact-save" :disabled="busy || !isOnline || !listHydrated || latest?.readOnly || saveUnconfirmed && pendingSave?.status !== 'saved'" class="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50" @click="save('saved')">Save artifact</button>
        <button v-if="latest && !latest.readOnly" type="button" data-testid="learn-artifact-delete" :disabled="busy || saveUnconfirmed || !isOnline || !listHydrated" class="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50" @click="remove">Delete artifact</button>
        <button type="button" class="min-h-11 rounded-lg border border-border px-4" @click="emit('leave')">Leave workspace</button>
      </div>
    </article>
  </section>
</template>
