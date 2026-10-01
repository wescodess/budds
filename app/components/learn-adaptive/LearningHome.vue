<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api } from '#convex/api'
import { NEED_FIRST_DRAFT_MAX_NEED_BYTES, NEED_FIRST_DRAFT_MAX_PASTE_BYTES, canonicalNeedFirstUrl } from '~~/shared/learn-adaptive-draft'

type SourceScope =
  | { kind: 'none' }
  | { kind: 'folder', folderId: string }
  | { kind: 'document', documentId: string }
  | { kind: 'url', url: string }
  | { kind: 'pasted', contentDigest: string, byteCount: number }
type StartPayload = { clientDraftId: string, need: string, outcome?: string, intent: 'understand' | 'prepare' | 'build' | 'master' | 'refresh' | 'explore', availableTime: '15' | '25' | '45' | '60' | 'no_limit', sourceScope: SourceScope }
type Folder = { _id: string, name: string }
type Document = { _id: string, folderId: string, filename: string, status: string }
type Stored<T> = { savedAt: number, value: T }
type ThreadHistoryRow = { threadId: string, outcome: string, lifecycle: string, updatedAt: number }
type ThreadHistoryPage = { page: ThreadHistoryRow[], continueCursor: string, isDone: boolean }
type ResumeCandidate = { ownerId: string, threadId: string, outcome: string, reason: string, unresolvedPoint: string | null, nextAction: { label: string }, reviewCapability?: string }

const props = withDefaults(defineProps<{ busy?: boolean, serverError?: string | null, acknowledgedRequestKey?: string | null }>(), { busy: false, serverError: null, acknowledgedRequestKey: null })
const emit = defineEmits<{ start: [payload: StartPayload]; resume: [threadId: string]; legacyHandoff: [route: string] }>()

const DRAFT_STORAGE_PREFIX = 'budds.learn.adaptive-draft.v1'
const PASTE_STORAGE_PREFIX = 'budds.learn.adaptive-paste.v1'
const STORAGE_TTL_MS = 24 * 60 * 60 * 1_000
const ERROR_ID = 'learn-adaptive-validation-error'
const need = ref('')
const outcome = ref('')
const intent = ref<StartPayload['intent']>('understand')
const availableTime = ref<StartPayload['availableTime']>('15')
const sourceKind = ref<SourceScope['kind']>('none')
const folderId = ref('')
const documentFolderId = ref('')
const documentId = ref('')
const sourceUrl = ref('')
const pastedMaterial = ref('')
const clientDraftId = ref('')
const validationError = ref<string | null>(null)
const invalidField = ref<'need' | 'outcome' | 'folder' | 'document' | 'url' | 'paste' | null>(null)
const mounted = ref(false)
const loadedOwnerId = ref<string | null>(null)
const suppressPersistence = ref(false)
const needField = ref<HTMLTextAreaElement | null>(null)
const outcomeField = ref<HTMLTextAreaElement | null>(null)
const folderField = ref<HTMLSelectElement | null>(null)
const documentField = ref<HTMLSelectElement | null>(null)
const urlField = ref<HTMLInputElement | null>(null)
const pasteField = ref<HTMLTextAreaElement | null>(null)

const userQuery = import.meta.client ? useConvexQuery(api.users.getUser, {}) : { data: ref<{ _id: string } | null>(null) }
const convex = import.meta.client ? useConvex() : null
const resumeQuery = import.meta.client ? useConvexQuery(api.learnAdaptive.listResumeCandidates, {}) : { data: ref([]) }
const foldersQuery = import.meta.client ? useConvexQuery(api.folders.listAllFolders, {}) : { data: ref<Folder[]>([]) }
const documentRows = ref<Document[]>([])
watch([sourceKind, documentFolderId], ([kind, selectedFolder], _previous, onCleanup) => {
  documentRows.value = []
  if (!convex || kind !== 'document' || !selectedFolder) return
  const unsubscribe = convex.onUpdate(api.documents.listDocumentsByFolder, { folderId: selectedFolder as never }, (rows: Document[]) => {
    documentRows.value = rows as Document[]
  })
  onCleanup(unsubscribe)
}, { immediate: true })
const ownerId = computed(() => userQuery.data.value?._id ? String(userQuery.data.value._id) : null)
const folders = computed(() => (foldersQuery.data.value ?? []) as Folder[])
const documents = computed(() => documentRows.value.filter(document => document.status === 'success'))
const resumeCandidates = computed(() => ownerId.value ? ((resumeQuery.data.value ?? []) as ResumeCandidate[]).filter(candidate => candidate.ownerId === ownerId.value) : [])
const primaryResume = computed(() => resumeCandidates.value[0] ?? null)
const worthRevisiting = computed(() => resumeCandidates.value.find(candidate => candidate.reviewCapability
  && (candidate.threadId !== primaryResume.value?.threadId || primaryResume.value.reason !== 'needs_review')) ?? null)
const historyRows = ref<ThreadHistoryRow[]>([])
const historyCursor = ref<string | null>(null)
const historyDone = ref(false)
const historyLoaded = ref(false)
const historyBusy = ref(false)
const historyError = ref<string | null>(null)
let historyEpoch = 0
async function loadHistory() {
  const userId = ownerId.value
  if (!convex || !userId || historyBusy.value || historyDone.value) return
  const epoch = historyEpoch
  historyBusy.value = true
  historyError.value = null
  try {
    const result = await convex.query(api.learnAdaptive.listThreadHistory, { cursor: historyCursor.value }) as ThreadHistoryPage
    if (historyEpoch !== epoch || ownerId.value !== userId) return
    historyRows.value = [...historyRows.value, ...result.page.filter(row => !historyRows.value.some(existing => existing.threadId === row.threadId))]
    historyCursor.value = result.continueCursor
    historyDone.value = result.isDone
    historyLoaded.value = true
  }
  catch {
    if (historyEpoch === epoch && ownerId.value === userId) historyError.value = 'Could not load your learning history. Try again.'
  }
  finally { if (historyEpoch === epoch && ownerId.value === userId) historyBusy.value = false }
}
watch(ownerId, (userId) => {
  historyEpoch += 1
  historyRows.value = []
  historyCursor.value = null
  historyDone.value = false
  historyLoaded.value = false
  historyBusy.value = false
  historyError.value = null
  if (userId) void loadHistory()
}, { immediate: true })
function resumeReason(reason: string) {
  return reason === 'unfinished_activity' ? 'Unfinished activity' : reason === 'needs_review' ? 'Knowledge to review'
    : reason === 'source_recovery' ? 'Source needs attention' : 'Recent thread'
}
function openResume(event: MouseEvent, threadId: string) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('resume', threadId)
}

function newDraftId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function draftStorageKey(userId: string) { return `${DRAFT_STORAGE_PREFIX}:${userId}` }
function pasteStorageKey(userId: string) { return `${PASTE_STORAGE_PREFIX}:${userId}` }
function safeRemove(key: string) { try { sessionStorage.removeItem(key) } catch { return } }
function safeWrite<T>(key: string, value: T) { try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value } satisfies Stored<T>)) } catch { return } }
function safeRead<T>(key: string): T | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Stored<T> | null
    if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > STORAGE_TTL_MS) { safeRemove(key); return null }
    return parsed.value
  }
  catch { safeRemove(key); return null }
}
function ordinaryDraft() {
  return { clientDraftId: clientDraftId.value, need: need.value, outcome: outcome.value, intent: intent.value, availableTime: availableTime.value, sourceKind: sourceKind.value, folderId: folderId.value, documentFolderId: documentFolderId.value, documentId: documentId.value, sourceUrl: sourceUrl.value }
}
function resetForm() {
  need.value = ''
  outcome.value = ''
  intent.value = 'understand'
  availableTime.value = '15'
  sourceKind.value = 'none'
  folderId.value = ''
  documentFolderId.value = ''
  documentId.value = ''
  sourceUrl.value = ''
  clientDraftId.value = newDraftId()
  validationError.value = null
  invalidField.value = null
}
function loadOwnerDraft(userId: string) {
  suppressPersistence.value = true
  const preservePendingInput = loadedOwnerId.value === null && !!(need.value || outcome.value || pastedMaterial.value)
  if (!preservePendingInput) resetForm()
  else if (!clientDraftId.value) clientDraftId.value = newDraftId()
  const value = safeRead<Partial<ReturnType<typeof ordinaryDraft>>>(draftStorageKey(userId))
  if (value && !preservePendingInput) {
    if (typeof value.clientDraftId === 'string' && /^[A-Za-z0-9._~-]+$/.test(value.clientDraftId)) clientDraftId.value = value.clientDraftId
    if (typeof value.need === 'string') need.value = value.need
    if (typeof value.outcome === 'string') outcome.value = value.outcome
    if (['understand', 'prepare', 'build', 'master', 'refresh', 'explore'].includes(value.intent ?? '')) intent.value = value.intent as StartPayload['intent']
    if (['15', '25', '45', '60', 'no_limit'].includes(value.availableTime ?? '')) availableTime.value = value.availableTime as StartPayload['availableTime']
    if (['none', 'folder', 'document', 'url', 'pasted'].includes(value.sourceKind ?? '')) sourceKind.value = value.sourceKind as SourceScope['kind']
    folderId.value = typeof value.folderId === 'string' ? value.folderId : ''
    documentFolderId.value = typeof value.documentFolderId === 'string' ? value.documentFolderId : ''
    documentId.value = typeof value.documentId === 'string' ? value.documentId : ''
    sourceUrl.value = typeof value.sourceUrl === 'string' ? value.sourceUrl : ''
  }
  const paste = safeRead<{ clientDraftId: string, text: string }>(pasteStorageKey(userId))
  if (!preservePendingInput) pastedMaterial.value = typeof paste?.text === 'string' ? paste.text : ''
  loadedOwnerId.value = userId
  void nextTick(() => {
    suppressPersistence.value = false
    if (preservePendingInput) {
      safeWrite(draftStorageKey(userId), ordinaryDraft())
      if (pastedMaterial.value) safeWrite(pasteStorageKey(userId), { clientDraftId: clientDraftId.value, text: pastedMaterial.value })
    }
  })
}

onMounted(() => { mounted.value = true })
watch([mounted, ownerId], ([isMounted, userId]) => {
  if (!isMounted || !userId || loadedOwnerId.value === userId) return
  loadOwnerDraft(userId)
}, { immediate: true })
watch([clientDraftId, need, outcome, intent, availableTime, sourceKind, folderId, documentFolderId, documentId, sourceUrl], () => {
  if (mounted.value && ownerId.value && loadedOwnerId.value === ownerId.value && !suppressPersistence.value) safeWrite(draftStorageKey(ownerId.value), ordinaryDraft())
})
watch(pastedMaterial, (text) => {
  if (!mounted.value || !ownerId.value || loadedOwnerId.value !== ownerId.value || suppressPersistence.value) return
  if (text) safeWrite(pasteStorageKey(ownerId.value), { clientDraftId: clientDraftId.value, text })
})
watch(documentFolderId, (value, prior) => { if (mounted.value && value !== prior) documentId.value = '' })

watch(() => props.acknowledgedRequestKey, (value, prior) => {
  if (!value || value === prior || !ownerId.value) return
  safeRemove(draftStorageKey(ownerId.value))
  suppressPersistence.value = true
  resetForm()
  void nextTick(() => { suppressPersistence.value = false })
})

async function fail(message: string, fieldName: NonNullable<typeof invalidField.value>, field: { value: HTMLElement | null }) {
  validationError.value = message
  invalidField.value = fieldName
  await nextTick()
  field.value?.focus()
}
async function pasteDigest(value: string) {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength < 1) throw new Error('empty')
  if (bytes.byteLength > NEED_FIRST_DRAFT_MAX_PASTE_BYTES) throw new Error('too_large')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return { contentDigest: `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`, byteCount: bytes.byteLength }
}

async function submit() {
  validationError.value = null
  invalidField.value = null
  if (need.value.trim().length < 8) return fail('Use at least 8 meaningful characters so Budds knows what you need.', 'need', needField)
  if (new TextEncoder().encode(need.value).byteLength > NEED_FIRST_DRAFT_MAX_NEED_BYTES) return fail('Keep your goal or question under 8 KB.', 'need', needField)
  if (outcome.value.trim().length > 0 && outcome.value.trim().length < 8) return fail('Use at least 8 meaningful characters for an optional outcome.', 'outcome', outcomeField)
  if (new TextEncoder().encode(outcome.value).byteLength > NEED_FIRST_DRAFT_MAX_NEED_BYTES) return fail('Keep the optional outcome under 8 KB.', 'outcome', outcomeField)
  let sourceScope: SourceScope
  if (sourceKind.value === 'none') sourceScope = { kind: 'none' }
  else if (sourceKind.value === 'folder') {
    if (!folderId.value) return fail('Choose one folder, or select no material.', 'folder', folderField)
    sourceScope = { kind: 'folder', folderId: folderId.value }
  }
  else if (sourceKind.value === 'document') {
    if (!documentId.value) return fail('Choose one document, or select no material.', 'document', documentField)
    sourceScope = { kind: 'document', documentId: documentId.value }
  }
  else if (sourceKind.value === 'url') {
    try { canonicalNeedFirstUrl(sourceUrl.value) }
    catch { return fail('Enter a valid public http or https URL.', 'url', urlField) }
    sourceScope = { kind: 'url', url: sourceUrl.value }
  }
  else {
    try { sourceScope = { kind: 'pasted', ...await pasteDigest(pastedMaterial.value) } }
    catch (cause) { return fail(cause instanceof Error && cause.message === 'too_large' ? 'Keep pasted material under 64 KB.' : 'Paste material, or select no material.', 'paste', pasteField) }
  }
  emit('start', { clientDraftId: clientDraftId.value, need: need.value, ...(outcome.value.trim() ? { outcome: outcome.value } : {}), intent: intent.value, availableTime: availableTime.value, sourceScope })
}

function discardPaste() {
  pastedMaterial.value = ''
  if (ownerId.value) safeRemove(pasteStorageKey(ownerId.value))
  if (sourceKind.value === 'pasted') sourceKind.value = 'none'
}
</script>

<template>
  <section class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6" data-testid="learn-adaptive-home" :data-hydrated="mounted && !!ownerId && loadedOwnerId === ownerId ? 'true' : 'false'">
    <header><p class="font-inter text-xs uppercase tracking-wide text-primary">Learn anything</p><h1 class="mt-2 font-dm-sans text-3xl font-bold">What do you need to understand or do?</h1><p class="mt-2 text-sm text-muted-foreground">Start with the real need. You do not need a course, rubric, schedule, or Calendar connection.</p></header>
    <section v-if="primaryResume" class="mt-6 rounded-xl border border-border bg-card p-4" aria-labelledby="learn-resume-heading" data-testid="learn-adaptive-primary-resume">
      <h2 id="learn-resume-heading" class="font-dm-sans text-xl font-semibold">Resume</h2>
      <p v-if="primaryResume.reason === 'needs_review'" class="mt-2 text-sm font-medium">Worth revisiting: {{ primaryResume.reviewCapability }} needs review.</p>
      <p class="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ resumeReason(primaryResume.reason) }}</p>
      <h3 class="mt-1 font-medium">{{ primaryResume.outcome }}</h3>
      <p v-if="primaryResume.unresolvedPoint" class="mt-1 text-sm text-muted-foreground">Still open: {{ primaryResume.unresolvedPoint }}</p>
      <p class="mt-1 text-sm text-muted-foreground">Next: {{ primaryResume.nextAction.label }}</p>
      <NuxtLink :to="`/app/learn/thread/${encodeURIComponent(primaryResume.threadId)}`" class="mt-2 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline" @click="openResume($event, primaryResume.threadId)">{{ primaryResume.reason === 'needs_review' ? 'Review capability in thread' : primaryResume.reason === 'source_recovery' ? 'Review thread' : 'Continue' }}</NuxtLink>
    </section>
    <section v-if="worthRevisiting" class="mt-5 rounded-xl border border-border bg-card p-4" aria-labelledby="learn-review-heading" data-testid="learn-adaptive-worth-revisiting">
      <h2 id="learn-review-heading" class="font-dm-sans text-lg font-semibold">Worth revisiting</h2>
      <p class="mt-1 text-sm text-muted-foreground">{{ worthRevisiting.reviewCapability }} is marked as needing review.</p>
      <h3 class="mt-2 font-medium">{{ worthRevisiting.outcome }}</h3>
      <NuxtLink :to="`/app/learn/thread/${encodeURIComponent(worthRevisiting.threadId)}`" class="mt-2 inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline" @click="openResume($event, worthRevisiting.threadId)">Review capability in thread</NuxtLink>
    </section>
    <form aria-label="Start a learning thread" @submit.prevent="submit"><UiCard class="mt-6 gap-5 p-5">
      <label class="text-sm font-medium">Your goal or question<textarea ref="needField" v-model="need" data-testid="learn-adaptive-need" rows="4" maxlength="8000" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" placeholder="For example: Help me understand why this proof works." :aria-describedby="invalidField === 'need' ? ERROR_ID : undefined" :aria-invalid="invalidField === 'need' ? true : undefined" /></label>
      <label class="text-sm font-medium">Useful outcome <span class="font-normal text-muted-foreground">(optional)</span><textarea ref="outcomeField" v-model="outcome" data-testid="learn-adaptive-outcome" rows="2" maxlength="8000" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" placeholder="For example: Explain the proof clearly in my own words." :aria-describedby="invalidField === 'outcome' ? ERROR_ID : undefined" :aria-invalid="invalidField === 'outcome' ? true : undefined" /></label>
      <LearnAdaptiveIntentChips v-model="intent" />
      <label class="text-sm font-medium">Time available<select v-model="availableTime" data-testid="learn-adaptive-time" class="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="15">15 minutes</option><option value="25">25 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="no_limit">No limit</option></select></label>
      <fieldset><legend class="text-sm font-medium">Optional material</legend><div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"><label v-for="option in ['none', 'folder', 'document', 'url', 'pasted']" :key="option" class="flex min-h-11 items-center rounded-lg border border-input px-3 py-2 text-sm capitalize"><input v-model="sourceKind" type="radio" name="adaptive-source-kind" :value="option" class="mr-2">{{ option === 'none' ? 'No material' : option }}</label></div></fieldset>
      <label v-if="sourceKind === 'folder'" class="text-sm font-medium">Folder<select ref="folderField" v-model="folderId" data-testid="learn-adaptive-folder" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" :aria-describedby="invalidField === 'folder' ? ERROR_ID : undefined" :aria-invalid="invalidField === 'folder' ? true : undefined"><option value="">Choose a folder</option><option v-for="folder in folders" :key="folder._id" :value="String(folder._id)">{{ folder.name }}</option></select></label>
      <div v-else-if="sourceKind === 'document'" class="grid gap-4 sm:grid-cols-2"><label class="text-sm font-medium">Folder<select v-model="documentFolderId" data-testid="learn-adaptive-document-folder" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="">Choose a folder</option><option v-for="folder in folders" :key="folder._id" :value="String(folder._id)">{{ folder.name }}</option></select></label><label class="text-sm font-medium">Document<select ref="documentField" v-model="documentId" data-testid="learn-adaptive-document" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" :aria-describedby="invalidField === 'document' ? ERROR_ID : undefined" :aria-invalid="invalidField === 'document' ? true : undefined"><option value="">Choose a document</option><option v-for="document in documents" :key="document._id" :value="String(document._id)">{{ document.filename }}</option></select></label></div>
      <label v-else-if="sourceKind === 'url'" class="text-sm font-medium">URL<input ref="urlField" v-model="sourceUrl" data-testid="learn-adaptive-url" type="url" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" placeholder="https://example.com/article" :aria-describedby="invalidField === 'url' ? ERROR_ID : undefined" :aria-invalid="invalidField === 'url' ? true : undefined"></label>
      <div v-else-if="sourceKind === 'pasted'"><label class="text-sm font-medium">Pasted material<textarea ref="pasteField" v-model="pastedMaterial" data-testid="learn-adaptive-paste" rows="6" maxlength="65536" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" :aria-describedby="invalidField === 'paste' ? ERROR_ID : undefined" :aria-invalid="invalidField === 'paste' ? true : undefined" /></label><p class="mt-1 text-xs text-muted-foreground">This text stays in this signed-in browser session. Budds stores only its digest and byte count until you import it as an owned document.</p><UiButton type="button" variant="ghost" size="sm" class="mt-2 min-h-11" data-testid="learn-adaptive-discard-paste" @click="discardPaste">Discard pasted material</UiButton></div>
      <p v-if="validationError || serverError" :id="ERROR_ID" role="alert" class="text-sm text-destructive">{{ validationError ?? serverError }}</p>
      <p role="status" aria-live="polite" class="sr-only">{{ busy ? 'Saving your learning thread…' : '' }}</p>
      <div class="flex justify-end"><UiButton type="submit" class="min-h-11" data-testid="learn-adaptive-start" :disabled="busy || !ownerId">{{ busy ? 'Saving…' : 'Start learning' }}</UiButton></div>
    </UiCard></form>
    <section class="mt-8" aria-labelledby="learn-history-heading" data-testid="learn-adaptive-thread-history">
      <h2 id="learn-history-heading" class="font-dm-sans text-lg font-semibold">Learning history</h2>
      <p v-if="historyLoaded && !historyRows.length && historyDone" class="mt-2 text-sm text-muted-foreground">Your learning threads will appear here.</p>
      <ol v-if="historyRows.length" class="mt-3 space-y-2">
        <li v-for="thread in historyRows" :key="thread.threadId" class="rounded-lg border border-border p-3">
          <NuxtLink :to="`/app/learn/thread/${encodeURIComponent(thread.threadId)}`" class="inline-flex min-h-11 items-center text-sm font-medium text-[var(--learn-action)] underline">{{ thread.outcome }}</NuxtLink>
          <p class="text-xs capitalize text-muted-foreground">{{ thread.lifecycle }}</p>
        </li>
      </ol>
      <p v-if="historyError" role="alert" class="mt-2 text-sm text-destructive">{{ historyError }}</p>
      <UiButton v-if="!historyDone || historyError" type="button" variant="ghost" class="mt-3 min-h-11" data-testid="learn-adaptive-history-more" :disabled="historyBusy" @click="loadHistory">{{ historyBusy ? 'Loading…' : historyError ? 'Retry history' : 'More history' }}</UiButton>
    </section>
  </section>
</template>

<style scoped>
select,
input[type='url'] {
  min-height: 44px;
}
</style>
