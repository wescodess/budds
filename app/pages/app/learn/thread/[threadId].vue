<script setup lang="ts">
import { api } from '#convex/api'

const route = useRoute()
const router = useRouter()
const threadId = computed(() => String(route.params.threadId))
const { allowed, checkingAccess, fallbackRoute } = useLearnAdaptiveAccess()
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
const convex = import.meta.client ? useConvex() : null

const ownerId = computed(() => userQuery.data.value?._id)
const thread = computed(() => {
  const value = threadQuery.data.value
  return allowed.value && value?.thread.id === threadId.value && value.ownerId === ownerId.value ? value : null
})
const CONTRIBUTION_FEATURE_LABELS: Record<string, string> = { chat: 'Chat', quiz: 'Quiz', flashcards: 'Flashcards', podcast: 'Audio Overview', documents: 'Document' }
function contributionOrigin(feature: string, classification: string, sourceStatus: string) {
  const kind = classification === 'non_factual' ? 'non-factual context'
    : classification === 'inference' ? 'inference' : classification === 'synthesis' ? 'synthesis'
      : classification === 'unknown' ? 'unverified context' : 'accepted evidence'
  return `From ${CONTRIBUTION_FEATURE_LABELS[feature] ?? 'another feature'} · ${kind}${sourceStatus === 'available' ? '' : sourceStatus === 'source_revision_changed' ? ' · source changed' : ' · source unavailable'}`
}
const memoryQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptive.getMemory, computed(() => ({ threadId: threadId.value as never })), { enabled: computed(() => allowed.value && Boolean(thread.value)) })
  : { data: ref(null), pending: ref(false) }
const memory = computed(() => {
  const value = memoryQuery.data.value
  const current = thread.value
  return current && value && value.ownerId === ownerId.value && value.threadId === current.thread.id
    && value.threadRevision >= current.thread.revision ? value : null
})
type ContributionRow = { _id: string, threadId: string, sourceFeature: string, contributionKind: string, classification: string, sourceStatus: string, evidenceIntegrity: 'not_required' | 'accepted' | 'conflict' | 'unavailable', createdAt: number }
type ContributionPage = { page: ContributionRow[], isDone: boolean, continueCursor: string }
const contributionsQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptive.listThreadContributions,
    computed(() => ({ threadId: threadId.value as never, paginationOpts: { numItems: 20, cursor: null } })),
    { enabled: computed(() => allowed.value && Boolean(thread.value)) })
  : { data: ref<ContributionPage | null>(null), pending: ref(false) }
const contributions = computed(() => {
  const current = thread.value
  const value = contributionsQuery.data.value as ContributionPage | null
  return current && value ? value.page.filter(row => row.threadId === current.thread.id) : []
})
type ThreadDocument = { _id: string, folderId: string, filename: string, status: string }
const sourceScopeKey = computed(() => {
  const scope = thread.value?.thread.sourceScope
  return scope?.kind === 'folder' || scope?.kind === 'document' ? `${scope.kind}:${scope.sourceId}` : ''
})
const folderSourceId = computed(() => thread.value?.thread.sourceScope?.kind === 'folder' ? thread.value.thread.sourceScope.sourceId : '')
const documentRows = ref<ThreadDocument[]>([])
const documentsPending = ref(false)
watch([allowed, folderSourceId], ([hasAccess, selectedFolder], _previous, onCleanup) => {
  documentRows.value = []
  documentsPending.value = false
  if (!convex || !hasAccess || !selectedFolder) return
  documentsPending.value = true
  const unsubscribe = convex.onUpdate(api.documents.listDocumentsByFolder, { folderId: selectedFolder as never }, (rows: ThreadDocument[]) => {
    documentRows.value = rows
    documentsPending.value = false
  })
  onCleanup(unsubscribe)
}, { immediate: true })
const folderDocuments = computed(() => documentRows.value
  .filter(document => document.folderId === folderSourceId.value && document.status === 'success'))
const selectedDocumentId = ref('')
const recordSourceId = computed(() => {
  const scope = thread.value?.thread.sourceScope
  if (scope?.kind === 'document') return scope.sourceId
  if (scope?.kind === 'folder' && folderDocuments.value.some(document => document._id === selectedDocumentId.value)) return selectedDocumentId.value
  return ''
})
const canRecordDocument = computed(() => Boolean(recordSourceId.value && thread.value
  && !['ended', 'rollback'].includes(thread.value.thread.lifecycle)))
const sourceInspector = import.meta.client ? useConvex() : null
const recordMutation = import.meta.client ? useConvexMutation(api.learnAdaptive.recordContribution) : { mutate: async (_: unknown) => ({ kind: 'rejected' }) }
type RecordDocumentCommand = { threadId: string, ownerId: string, sourceId: string, sourceRevision: string, expectedRevision: number, idempotencyKey: string }
const pendingRecord = ref<RecordDocumentCommand | null>(null)
const recordBusy = ref(false)
const recordError = ref('')
const recordNotice = ref('')
let recordScopeEpoch = 0
watch([ownerId, threadId, allowed, sourceScopeKey], () => {
  recordScopeEpoch += 1
  selectedDocumentId.value = ''
  pendingRecord.value = null
  recordBusy.value = false
  recordError.value = ''
  recordNotice.value = ''
})
function recordDocumentKey() { return `document-contribution:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
async function runDocumentRecord(command: RecordDocumentCommand) {
  if (recordBusy.value) return
  if (!thread.value || thread.value.thread.id !== command.threadId || ownerId.value !== command.ownerId
    || !allowed.value || recordSourceId.value !== command.sourceId) {
    pendingRecord.value = null
    recordError.value = 'This document is no longer selected for your thread. Review the source before trying again.'
    return
  }
  const scopeEpoch = recordScopeEpoch
  recordBusy.value = true
  recordError.value = ''
  recordNotice.value = ''
  try {
    const result = await recordMutation.mutate({ threadId: command.threadId as never,
      source: { feature: 'documents', id: command.sourceId, revision: command.sourceRevision },
      contributionKind: 'source', classification: 'non_factual', metadata: { role: 'background' },
      expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey }) as { kind: string, code?: string }
    if (scopeEpoch !== recordScopeEpoch) return
    pendingRecord.value = null
    if (result.kind === 'recorded') recordNotice.value = 'Document context recorded. Choose it below for an unscored planning activity; no facts were verified or mastery awarded.'
    else if (result.kind === 'conflict') recordError.value = 'The thread changed in another tab. Review the refreshed thread and select the document again.'
    else recordError.value = result.code === 'source_revision_changed' || result.code === 'source_unavailable'
      ? 'The document changed or is unavailable. Review the source before trying again.'
      : 'This document could not be recorded. Review the thread and source before trying again.'
  }
  catch {
    if (scopeEpoch === recordScopeEpoch) recordError.value = 'The outcome could not be confirmed. Retry the same record to check its result.'
  }
  finally { if (scopeEpoch === recordScopeEpoch) recordBusy.value = false }
}
async function requestDocumentRecord() {
  const current = thread.value
  const sourceId = recordSourceId.value
  if (!sourceInspector || !current || !ownerId.value || !canRecordDocument.value || !allowed.value || recordBusy.value) return
  if (pendingRecord.value) {
    recordError.value = 'A previous record is unconfirmed. Retry it before starting another.'
    return
  }
  const scopeEpoch = recordScopeEpoch
  recordBusy.value = true
  recordError.value = ''
  recordNotice.value = ''
  try {
    const inspected = await sourceInspector.query(api.learnAdaptive.inspectContributionSource,
      { source: { feature: 'documents', id: sourceId as never } })
    if (scopeEpoch !== recordScopeEpoch) return
    if (inspected.status !== 'available' || !inspected.revision) {
      recordError.value = 'This document is unavailable. Review the source before trying again.'
      return
    }
    const command = { threadId: current.thread.id, ownerId: String(ownerId.value), sourceId,
      sourceRevision: inspected.revision, expectedRevision: current.thread.revision, idempotencyKey: recordDocumentKey() }
    pendingRecord.value = command
  }
  catch {
    if (scopeEpoch === recordScopeEpoch) recordError.value = 'Could not check the document. Try again when it is available.'
    return
  }
  finally { if (scopeEpoch === recordScopeEpoch) recordBusy.value = false }
  if (pendingRecord.value) void runDocumentRecord(pendingRecord.value)
}
function retryDocumentRecord() { if (pendingRecord.value) void runDocumentRecord(pendingRecord.value) }
const convertedContributionIds = computed(() => new Set([
  thread.value?.currentActivity?.attribution?.contributionId,
  ...(thread.value?.history ?? []).map((item: { attribution?: { contributionId: string } | null }) => item.attribution?.contributionId),
  ...locallyConvertedContributionIds.value,
].filter((id): id is string => typeof id === 'string')))
const conversionMutation = import.meta.client ? useConvexMutation(api.learnAdaptive.convertContributionToActivity) : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
type ContributionConversionCommand = { threadId: string, ownerId: string, contributionId: string, expectedRevision: number, idempotencyKey: string }
const pendingContributionConversion = ref<ContributionConversionCommand | null>(null)
const locallyConvertedContributionIds = ref(new Set<string>())
const locallyRejectedSources = ref(new Map<string, 'source_revision_changed' | 'source_unavailable'>())
const contributionConversionBusy = ref(false)
const contributionConversionError = ref('')
const contributionConversionNotice = ref('')
let contributionScopeEpoch = 0
watch([ownerId, threadId, allowed], () => {
  contributionScopeEpoch += 1
  pendingContributionConversion.value = null
  locallyConvertedContributionIds.value = new Set()
  locallyRejectedSources.value = new Map()
  contributionConversionBusy.value = false
  contributionConversionError.value = ''
  contributionConversionNotice.value = ''
})
function canConvertContribution(row: ContributionRow) {
  const current = thread.value
  const currentStatus = current?.currentActivity?.status
  return Boolean(current && row.classification !== 'accepted_evidence' && row.classification !== 'factual'
    && row.sourceStatus === 'available' && !locallyRejectedSources.value.has(row._id) && !convertedContributionIds.value.has(row._id)
    && !['draft', 'paused', 'ended', 'rollback'].includes(current.thread.lifecycle)
    && !(currentStatus && ['started', 'submitted', 'scoring', 'feedback', 'reconciling'].includes(currentStatus)))
}
function contributionFeatureLabel(feature: string) {
  return CONTRIBUTION_FEATURE_LABELS[feature] ?? 'Another feature'
}
function contributionClassificationLabel(classification: string) {
  return ({ non_factual: 'non-factual context', inference: 'inference', synthesis: 'synthesis', unknown: 'unverified context', accepted_evidence: 'accepted evidence' } as Record<string, string>)[classification] ?? 'unclassified context'
}
function contributionStatusLabel(row: ContributionRow) {
  if (row.evidenceIntegrity === 'conflict') return 'Linked evidence has an unresolved conflict. Review the source before using it.'
  if (row.evidenceIntegrity === 'unavailable') return 'Linked evidence is no longer available or accepted. Review the source before using it.'
  if (row.classification === 'accepted_evidence' || row.classification === 'factual') return 'Factual activity unavailable until independent factual authority is available.'
  if (locallyRejectedSources.value.get(row._id) === 'source_revision_changed') return 'Source changed; review it before using this contribution.'
  if (locallyRejectedSources.value.get(row._id) === 'source_unavailable') return 'Source unavailable; this contribution cannot be used.'
  if (row.sourceStatus === 'source_revision_changed') return 'Source changed; review it before using this contribution.'
  if (row.sourceStatus !== 'available') return 'Source unavailable; this contribution cannot be used.'
  if (convertedContributionIds.value.has(row._id)) return 'Already used in an activity.'
  const lifecycle = thread.value?.thread.lifecycle
  if (lifecycle === 'paused' || lifecycle === 'ended' || lifecycle === 'rollback' || lifecycle === 'draft') return 'This thread cannot accept a contribution activity right now.'
  const currentStatus = thread.value?.currentActivity?.status
  if (currentStatus && ['started', 'submitted', 'scoring', 'feedback', 'reconciling'].includes(currentStatus)) return 'Finish the current activity before choosing another next move.'
  return 'Recorded as available. Its source will be checked when selected; the activity is unscored.'
}
function conversionErrorMessage(code: string) {
  if (code === 'contribution_already_converted') return 'This contribution is already represented by an activity in this thread. Review that activity before choosing another source.'
  if (code === 'evidence_conflict') return 'Linked evidence has an unresolved conflict. Review the source before choosing another next move.'
  if (code === 'evidence_unavailable') return 'Linked evidence is no longer available or accepted. Review the source before choosing another next move.'
  if (code === 'source_revision_changed' || code === 'source_unavailable' || code === 'contribution_unavailable') return 'This source changed or is unavailable. Review the contribution list before trying again.'
  if (code === 'factual_authority_unavailable') return 'This contribution cannot create a factual activity until independent factual authority is available.'
  if (['thread_not_active', 'thread_not_ready', 'thread_deleting', 'clarification_pending', 'activity_boundary_unavailable'].includes(code)) return 'The thread or current activity changed. Review the current state before choosing another next move.'
  return 'This contribution could not be used. Review the current thread and try again if it is still available.'
}
function contributionConversionKey() { return `contribution-conversion:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
async function runContributionConversion(command: ContributionConversionCommand) {
  if (contributionConversionBusy.value) return
  if (!thread.value || thread.value.thread.id !== command.threadId || ownerId.value !== command.ownerId || !allowed.value) {
    pendingContributionConversion.value = null
    contributionConversionError.value = 'This contribution belongs to another thread or account. Open your own thread to continue.'
    return
  }
  contributionConversionBusy.value = true
  const scopeEpoch = contributionScopeEpoch
  contributionConversionError.value = ''
  contributionConversionNotice.value = ''
  try {
    const result = await conversionMutation.mutate({ threadId: command.threadId as never, contributionId: command.contributionId as never,
      expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey }) as { kind: string, code?: string }
    if (scopeEpoch !== contributionScopeEpoch) return
    if (result.kind === 'ok') {
      pendingContributionConversion.value = null
      locallyConvertedContributionIds.value = new Set([...locallyConvertedContributionIds.value, command.contributionId])
      contributionConversionNotice.value = 'Your next planning activity is ready. It is unscored and does not award mastery.'
    }
    else if (result.kind === 'conflict') {
      pendingContributionConversion.value = null
      contributionConversionError.value = 'The thread changed in another tab. Review the refreshed thread, then choose the contribution again.'
    }
    else {
      pendingContributionConversion.value = null
      if (result.code === 'source_revision_changed' || result.code === 'source_unavailable' || result.code === 'contribution_unavailable') {
        locallyRejectedSources.value = new Map(locallyRejectedSources.value).set(command.contributionId,
          result.code === 'source_revision_changed' ? 'source_revision_changed' : 'source_unavailable')
      }
      contributionConversionError.value = conversionErrorMessage(result.code ?? '')
    }
  }
  catch {
    if (scopeEpoch !== contributionScopeEpoch) return
    contributionConversionError.value = 'The outcome could not be confirmed. Retry the same conversion to check its result.'
  }
  finally { if (scopeEpoch === contributionScopeEpoch) contributionConversionBusy.value = false }
}
function requestContributionConversion(row: ContributionRow) {
  const current = thread.value
  if (!current || !ownerId.value || !canConvertContribution(row)) return
  if (pendingContributionConversion.value) {
    contributionConversionError.value = 'A previous conversion is unconfirmed. Retry that same conversion before starting another.'
    return
  }
  const command = { threadId: current.thread.id, ownerId: String(ownerId.value), contributionId: row._id,
    expectedRevision: current.thread.revision, idempotencyKey: contributionConversionKey() }
  pendingContributionConversion.value = command
  void runContributionConversion(command)
}
function retryContributionConversion() {
  if (pendingContributionConversion.value) void runContributionConversion(pendingContributionConversion.value)
}
const setMemoryPreferenceMutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.setMemoryPreference)
  : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
const deleteMemoryArtifactMutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.deleteArtifact)
  : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
const requestPromotionMutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.requestPromotion)
  : { mutate: async (_: unknown) => ({ kind: 'blocked' }) }
type MemoryPreferenceChange = { key: 'representation' | 'pace' | 'practice_style', operation: 'set' | 'disable' | 'clear', value?: string }
type PromotionChange = { kind: 'review' | 'mastery', basis: 'useful_artifact' | 'representative_performance', sourceId: string }
type MemoryCommand = { kind: 'preference', payload: MemoryPreferenceChange, threadId: string, ownerId: string, expectedRevision: number, idempotencyKey: string }
  | { kind: 'delete_artifact', artifactId: string, threadId: string, ownerId: string, expectedRevision: number, idempotencyKey: string }
  | { kind: 'promotion', payload: PromotionChange, threadId: string, ownerId: string, expectedRevision: number, idempotencyKey: string }
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
      : command.kind === 'delete_artifact'
        ? await deleteMemoryArtifactMutation.mutate({ threadId: command.threadId as never, artifactId: command.artifactId as never,
            expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey })
        : await requestPromotionMutation.mutate({ threadId: command.threadId as never, kind: command.payload.kind,
            ...(command.payload.basis === 'useful_artifact'
              ? { artifactId: command.payload.sourceId as never }
              : { activityId: command.payload.sourceId as never }),
            expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey })) as { kind: string, value?: { cleanupPending?: boolean } }
    if (scopeEpoch !== memoryScopeEpoch) return
    if (result.kind === 'ok') {
      pendingMemoryCommand.value = null
      memoryNotice.value = command.kind === 'preference' ? 'Preference change saved.'
        : command.kind === 'promotion' ? 'Your proposal was saved. No check was scheduled and no mastery was awarded.'
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
function requestMemoryCommand(input: MemoryPreferenceChange | { artifactId: string } | { promotion: PromotionChange }) {
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
    : 'promotion' in input
      ? { ...base, kind: 'promotion', payload: input.promotion }
      : { ...base, kind: 'preference', payload: input }
  pendingMemoryCommand.value = command
  void runMemoryCommand(command)
}
function requestMemoryArtifactDeletion(artifactId: string) { requestMemoryCommand({ artifactId }) }
function requestMemoryPromotion(promotion: PromotionChange) { requestMemoryCommand({ promotion }) }
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
const selectedHistory = computed(() => thread.value?.history.find((item: { id: string }) => item.id === selectedActivityId.value) ?? null)
const showCurrent = computed(() => !selectedActivityId.value || selectedActivityId.value === thread.value?.currentActivity?.id)
const acceptedAttemptHandoff = computed(() => (showCurrent.value ? thread.value?.currentActivity : selectedHistory.value)?.acceptedAttemptHandoff ?? null)
const acceptedAttemptOrigins = computed(() => (showCurrent.value ? thread.value?.currentActivity : selectedHistory.value)?.attemptOrigins ?? [])
const canvasUnsafe = computed(() => Boolean(canvas.value && canvas.value.status !== 'blocked' && thread.value?.thread.evidenceState !== 'ready'))
const currentCanvasVisible = computed(() => showCurrent.value && !canvasUnsafe.value && !rollback.value && !endedReadOnly.value)
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
  <section aria-label="Learning thread" data-testid="learn-adaptive-thread-route" class="learn-adaptive-surface min-h-full bg-[var(--learn-thread-surface)]">
    <section v-if="checkingAccess" class="mx-auto max-w-3xl p-6" aria-live="polite">Checking learning access…</section>
    <section v-else-if="!allowed" class="mx-auto max-w-3xl p-6" data-testid="learn-adaptive-thread-denied">
      <p role="status">This learning thread is not available for this account.</p>
      <NuxtLink v-if="fallbackRoute" :to="{ name: fallbackRoute.name, query: fallbackRoute.name === 'app-learn' ? { legacy: 'v2' } : {} }" data-testid="learn-adaptive-safe-destination" class="mt-4 inline-flex min-h-11 items-center text-primary underline">{{ fallbackRoute.label }}</NuxtLink>
      <NuxtLink v-else :to="{ name: 'index' }" data-testid="learn-adaptive-safe-destination" class="mt-4 inline-flex min-h-11 items-center text-primary underline">Open your folders for classic courses</NuxtLink>
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
          <LearnAdaptiveMemoryDrawer :key="`${ownerId}:${threadId}`" :memory="memory as never" :pending="memoryQuery.pending.value" :busy="memoryBusy" :error="memoryError" :notice="memoryNotice" :retry-available="Boolean(pendingMemoryCommand)" @set-preference="requestMemoryCommand" @delete-artifact="requestMemoryArtifactDeletion" @request-promotion="requestMemoryPromotion" @refresh="reviewCurrentMemory" @retry="retryMemoryCommand" />
        </div>
      </header>

      <section v-if="thread.currentActivity || thread.artifact" class="mt-6 rounded-xl border border-border bg-card p-5" aria-label="Saved learning context" data-testid="learn-thread-resume-context">
        <p v-if="thread.currentActivity" class="text-sm">Current activity: {{ thread.currentActivity.purpose }} · {{ thread.currentActivity.status }}</p>
        <p v-if="thread.currentActivity?.attribution" class="mt-2 text-sm text-muted-foreground" data-testid="learn-current-contribution-origin">{{ contributionOrigin(thread.currentActivity.attribution.sourceFeature, thread.currentActivity.attribution.classification, thread.currentActivity.attribution.sourceStatus) }}</p>
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

      <section class="mt-6 rounded-xl border border-border bg-card p-5" aria-labelledby="learn-thread-contributions-title" data-testid="learn-thread-contributions">
        <h2 id="learn-thread-contributions-title" class="font-dm-sans text-lg font-semibold">Recent contributions</h2>
        <p class="mt-2 text-sm text-muted-foreground">Choose a recorded contribution to make an attributed, unscored planning activity. Its source will be checked first. This does not verify facts or award mastery.</p>
        <div v-if="thread.thread.sourceScope?.kind === 'document' || thread.thread.sourceScope?.kind === 'folder'" class="mt-4 rounded-lg border border-border p-3" data-testid="learn-thread-document-producer">
          <p class="text-sm font-medium">Add document context</p>
          <p class="mt-1 text-sm text-muted-foreground">Record a document already selected for this thread as context only. This does not verify its claims.</p>
          <p v-if="thread.thread.sourceScope.kind === 'document'" class="mt-2 text-sm">Selected thread document</p>
          <template v-else>
            <label for="learn-document-select" class="mt-2 block text-sm">Document in this thread’s folder</label>
            <select
              id="learn-document-select" v-model="selectedDocumentId" data-testid="learn-document-select" :disabled="recordBusy || Boolean(pendingRecord)"
              class="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm">
              <option value="">Choose a ready document</option>
              <option v-for="document in folderDocuments" :key="document._id" :value="document._id">{{ document.filename }}</option>
            </select>
            <p v-if="documentsPending" class="mt-1 text-xs" role="status">Loading documents…</p>
            <p v-else-if="folderDocuments.length === 0" class="mt-1 text-xs text-muted-foreground">No ready documents are available in this folder.</p>
          </template>
          <button
            type="button" data-testid="learn-record-document" :disabled="!canRecordDocument || recordBusy || Boolean(pendingRecord)"
            class="mt-2 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            @click="requestDocumentRecord">{{ recordBusy ? 'Checking document…' : 'Record document context' }}</button>
          <p v-if="recordError" data-testid="learn-thread-record-error" class="mt-2 text-sm text-destructive" role="alert">{{ recordError }}</p>
          <button
            v-if="pendingRecord && recordError" type="button" data-testid="learn-thread-record-retry" :disabled="recordBusy"
            class="mt-2 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm underline" @click="retryDocumentRecord">Retry same record</button>
          <p v-if="recordNotice" data-testid="learn-thread-record-notice" class="mt-2 text-sm" role="status">{{ recordNotice }}</p>
        </div>
        <LearnAdaptiveQuizContributionPicker
          v-if="thread.thread.sourceScope?.kind === 'folder'"
          :key="`${ownerId}:${thread.thread.id}:${thread.thread.sourceScope.sourceId}`"
          :thread-id="thread.thread.id" :owner-id="String(ownerId)" :folder-id="thread.thread.sourceScope.sourceId"
          :expected-revision="thread.thread.revision" :lifecycle="thread.thread.lifecycle" />
        <p v-if="contributionsQuery.pending.value" class="mt-3 text-sm" role="status">Loading recent contributions…</p>
        <p v-else-if="contributions.length === 0" class="mt-3 text-sm text-muted-foreground">No contributions are available for this thread yet.</p>
        <ol v-else class="mt-3 space-y-3">
          <li v-for="item in contributions" :key="item._id" data-testid="learn-thread-contribution-row" class="rounded-lg border border-border p-3">
            <p class="text-sm font-medium">{{ contributionFeatureLabel(item.sourceFeature) }} · {{ item.contributionKind }}</p>
            <p class="mt-1 text-sm text-muted-foreground">{{ contributionClassificationLabel(item.classification) }}</p>
            <p v-if="item.classification === 'accepted_evidence'" class="mt-1 text-xs text-muted-foreground" data-testid="learn-contribution-evidence-integrity">Evidence integrity: {{ item.evidenceIntegrity === 'accepted' ? 'accepted' : item.evidenceIntegrity === 'conflict' ? 'conflict unresolved' : 'unavailable' }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ contributionStatusLabel(item) }}</p>
            <button
              v-if="canConvertContribution(item)" type="button" data-testid="learn-convert-contribution"
              :disabled="contributionConversionBusy || Boolean(pendingContributionConversion)"
              class="mt-2 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]"
              @click="requestContributionConversion(item)">{{ contributionConversionBusy ? 'Preparing next activity…' : 'Use for my next move' }}</button>
          </li>
        </ol>
        <p v-if="!contributionsQuery.pending.value && contributions.length > 0" class="mt-3 text-xs text-muted-foreground">Showing up to 20 recent contributions.</p>
        <p v-if="contributionConversionError" class="mt-3 text-sm text-destructive" role="alert" data-testid="learn-thread-conversion-error">{{ contributionConversionError }}</p>
        <button
          v-if="pendingContributionConversion && contributionConversionError" type="button" data-testid="learn-thread-conversion-retry"
          class="mt-2 inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium underline disabled:opacity-50"
          :disabled="contributionConversionBusy" @click="retryContributionConversion">Retry same conversion</button>
        <p v-if="contributionConversionNotice" class="mt-3 text-sm" role="status" data-testid="learn-thread-conversion-notice">{{ contributionConversionNotice }}</p>
      </section>

      <section class="mt-6 rounded-xl bg-[var(--learn-activity-surface)] p-4" data-testid="learn-adaptive-canvas-frame" aria-label="Current learning activity">
        <LearnAdaptiveAcceptedAttemptHandoff
v-if="acceptedAttemptHandoff && ownerId && !rollback"
          :owner-id="ownerId" :thread-id="threadId" :thread-revision="thread.thread.revision" :candidate="acceptedAttemptHandoff" />
        <p v-if="acceptedAttemptOrigins.length" data-testid="learn-accepted-attempt-origins" class="mt-3 text-sm">
          One accepted attempt · <span v-for="origin in acceptedAttemptOrigins" :key="origin.contributionId">{{ contributionFeatureLabel(origin.sourceFeature) }}{{ origin.sourceStatus === 'available' ? '' : ' (unavailable)' }} · </span>
        </p>
        <div v-if="selectedActivityId && !showCurrent" data-testid="learn-selected-history" class="rounded-lg border border-border p-5">
          <template v-if="selectedHistory">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Past activity · {{ selectedHistory.status }}</p>
            <h2 class="mt-2 font-dm-sans text-lg font-semibold">{{ selectedHistory.purpose }}</h2>
            <p v-if="selectedHistory.attribution" class="mt-2 text-sm text-muted-foreground">{{ contributionOrigin(selectedHistory.attribution.sourceFeature, selectedHistory.attribution.classification, selectedHistory.attribution.sourceStatus) }}</p>
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
        <div v-show="currentCanvasVisible">
          <LearnAdaptiveReadySessionCanvas v-if="canvas" :key="`${ownerId}:${canvas.thread.id}:${canvas.activity.id}`" :canvas="canvas as never" :authoritative-revision="Math.max(thread.thread.revision, canvas.thread.revision)" :show-header="false" :active="currentCanvasVisible" @leave="leave" @inspect-evidence="inspectEvidence" />
          <LearnAdaptiveArtifactWorkspace v-else-if="artifact" :key="`${ownerId}:${artifact.thread.id}:${artifact.activity.id}`" :canvas="artifact as never" :authoritative-revision="Math.max(thread.thread.revision, artifact.thread.revision)" :active="currentCanvasVisible" @leave="leave" />
          <LearnAdaptiveReflectionNextMove v-else-if="reflection" :key="`${ownerId}:${reflection.thread.id}:${reflection.activity.id}`" :canvas="reflection as never" :authoritative-revision="Math.max(thread.thread.revision, reflection.thread.revision)" :active="currentCanvasVisible" @leave="leave" />
          <LearnAdaptiveDiagnosticCanvas v-else-if="diagnostic" :key="`${ownerId}:${diagnostic.thread.id}:${diagnostic.activity?.id ?? 'draft'}`" :canvas="diagnostic as never" :authoritative-revision="Math.max(thread.thread.revision, diagnostic.thread.revision)" :show-header="false" :active="currentCanvasVisible" @leave="leave" />
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
            <p v-if="item.attribution" class="mt-1 text-xs text-muted-foreground">{{ contributionOrigin(item.attribution.sourceFeature, item.attribution.classification, item.attribution.sourceStatus) }}</p>
          </li>
        </ol>
      </section>
      <NuxtLink v-if="canvas || diagnostic || artifact || reflection" :to="safeDestination" data-testid="learn-adaptive-safe-destination" class="mt-6 inline-flex min-h-11 items-center text-sm text-muted-foreground underline">{{ safeDestinationLabel }}</NuxtLink>
    </div>
  </section>
</template>
