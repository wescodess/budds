<script setup lang="ts">
import { FileText, MessageSquare, ClipboardList, Layers, PanelRight, ArrowLeftRight, Pencil, FolderPlus, ListTodo } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { api } from '#convex/api'
import type { Id } from '~~/convex/_generated/dataModel'
import type { VoidType } from '~/components/voids/CreateVoidDialog.vue'
import MoveToFolderDialog from '~/components/documents/MoveToFolderDialog.vue'
import FolderHelperPane from '~/components/folders/FolderHelperPane.vue'
import FolderTasksPane from '~/components/folders/FolderTasksPane.vue'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useHorizontalSwipeGesture } from '~/composables/useHorizontalSwipeGesture'
import { TAB_SWITCH_THRESHOLD_PX, useGestureGuards } from '~/composables/useGestureGuards'

definePageMeta({ layout: 'folder' })

const route = useRoute()
const router = useRouter()
type FolderShellHandle = {
  showMobileRailCompact: () => void
  expandMobileRail: () => void
  collapseMobileRailToCompact: () => void
  hideMobileRail: () => void
  getMobileRailState: () => 'hidden' | 'compact' | 'expanded'
}

const folderShellRef = ref<FolderShellHandle | null>(null)
const audioOverviewShellRef = ref<{ startGeneration: () => Promise<void> } | null>(null)
const folderId = computed(() => route.params.id as Id<'folders'>)
const conversationIdRef = computed<Id<'conversations'> | null>(() => {
  const q = route.query?.conversationId
  if (!q || Array.isArray(q)) return null
  return q as Id<'conversations'>
})

const { folder } = useFolderDetail(folderId)
const { allFolders } = useFolders()
const { documents, documentsForDisplay, dismissDisplayDocument, attachmentStatus, uploading, importingLink, uploadFiles, importDocumentFromUrl, deleteDocument, deleteDocuments, moveDocument, moveDocuments } = useDocuments(folderId)
const {
  messages,
  loading,
  streaming,
  thinking,
  error,
  hasIndexedDocuments,
  selectedModel,
  interjectionInFlight,
  sendMessage,
  selectModel,
  loadConversation,
  startNewConversation,
} = useChat(folderId, conversationIdRef)

import type { InterjectionContext } from '~/composables/useChat'
const pendingInterjectionContext = ref<InterjectionContext | null>(null)

const referenceScope = useFolderReferenceScope({ folderId })
const workspaceRef = ref<HTMLElement | null>(null)

const isPodcastMain = computed(() =>
  (folder.value as any)?.preferredMainPane === 'podcast',
)
const seededFolder = computed(() =>
  folder.value
  ?? allFolders.value?.find(candidate => candidate._id === folderId.value)
  ?? null,
)

const desktopMq = useMediaQuery('(min-width: 1024px)')
const isDesktopMounted = ref(false)
onMounted(() => { isDesktopMounted.value = true })
const isDesktop = computed(() => isDesktopMounted.value && desktopMq.value)
const { shouldStartHorizontalGesture } = useGestureGuards()
const SIDEBAR_SWIPE_EDGE_GUARD_PX = 12

const newVoidOpen = ref(false)
const creatingVoid = ref(false)

const createConversationMutation = import.meta.client
  ? useConvexMutation(api.conversations.createConversation)
  : {
      mutate: async (_args: { folderId: Id<'folders'>; title: string }) =>
        '' as unknown as Id<'conversations'>,
    }

const deleteConversationMutation = import.meta.client
  ? useConvexMutation(api.conversations.deleteConversation)
  : {
      mutate: async (_args: { id: Id<'conversations'> }) => null,
    }

const deleteFlashcardRoomMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.deleteRoom)
  : {
      mutate: async (_args: { roomId: Id<'flashcardRooms'> }) => null,
    }

const createFlashcardRoomMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.createRoom)
  : {
      mutate: async (_args: { folderId: Id<'folders'>; title?: string }) => ({
        roomId: '' as unknown as Id<'flashcardRooms'>,
      }),
    }

const setPreferredMainPaneMutation = import.meta.client
  ? useConvexMutation(api.folders.setPreferredMainPane)
  : {
      mutate: async (_args: { folderId: Id<'folders'>; pane: 'chat' | 'podcast' }) => ({ pane: 'chat' as const }),
    }

const deleteQuizMutation = import.meta.client
  ? useConvexMutation(api.quizzes.deleteQuiz)
  : {
      mutate: async (_args: { quizId: Id<'quizzes'> }) => null,
    }

function unwrapConvexError(err: any): string {
  if (err?.data?.message && typeof err.data.message === 'string') return err.data.message
  const raw = typeof err?.message === 'string' ? err.message : ''
  return raw.replace(/^\[CONVEX [^\]]+\]\s*/, '').replace(/^ConvexError:\s*/, '').trim()
}

function hideSidebarOnMobile() {
  folderShellRef.value?.hideMobileRail()
}

async function onCreateVoid(payload: { type: VoidType; name?: string }) {
  if (creatingVoid.value) return
  creatingVoid.value = true
  try {
    const { type, name } = payload
    const trimmedName = name?.trim()
    if (type === 'chat') {
      try {
        await setPreferredMainPaneMutation.mutate({ folderId: folderId.value, pane: 'chat' } as any)
      } catch { /* best-effort; pane preference falls back to default */ }
      const newId = (await createConversationMutation.mutate({
        folderId: folderId.value,
        title: trimmedName || 'New chat',
      })) as Id<'conversations'>
      activeTab.value = 'chat'
      await router.replace({ query: { ...(route.query ?? {}), tab: 'chat', conversationId: newId } })
    } else if (type === 'flashcards') {
      const result = (await createFlashcardRoomMutation.mutate({
        folderId: folderId.value,
        title: trimmedName,
      })) as { roomId: Id<'flashcardRooms'> }
      activeTab.value = 'flashcards'
      const { conversationId: _dropC, ...rest } = route.query ?? {}
      await router.replace({ query: { ...rest, tab: 'flashcards', voidId: result.roomId } })
    } else if (type === 'audio-overview') {
      try {
        await setPreferredMainPaneMutation.mutate({ folderId: folderId.value, pane: 'podcast' } as any)
      } catch { /* best-effort */ }
      activeTab.value = 'audio-overview'
      const { conversationId: _dropC, voidId: _dropV, ...rest } = route.query ?? {}
      await router.replace({ query: { ...rest, tab: 'audio-overview' } })
      await nextTick()
      try {
        await audioOverviewShellRef.value?.startGeneration?.()
      } catch { /* shell surfaces its own error toast */ }
    } else {
      activeTab.value = type
      await router.replace({ query: { ...(route.query ?? {}), tab: type } })
    }
    newVoidOpen.value = false
    hideSidebarOnMobile()
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(unwrapConvexError(e) || 'Failed to create void')
  } finally {
    creatingVoid.value = false
  }
}

async function onSelectVoid({ type, id }: { type: 'chat' | 'flashcards' | 'quiz'; id: string }) {
  activeTab.value = type
  const base = { ...(route.query ?? {}) }
  if (type === 'chat') {
    delete base.voidId
    await router.replace({ query: { ...base, tab: 'chat', conversationId: id } })
  } else {
    const { conversationId: _dropped, ...rest } = base
    await router.replace({ query: { ...rest, tab: type, voidId: id } })
  }
  hideSidebarOnMobile()
}

const voidDeleteTarget = ref<{ type: 'chat' | 'flashcards' | 'quiz'; id: string; title: string } | null>(null)
const deletingVoid = ref(false)

function handleDeleteVoidRequest(target: { type: 'chat' | 'flashcards' | 'quiz'; id: string; title: string }) {
  voidDeleteTarget.value = target
}

const showDeleteVoidDialog = computed({
  get: () => voidDeleteTarget.value !== null,
  set: (value: boolean) => {
    if (!value) voidDeleteTarget.value = null
  },
})

const deleteVoidDescription = computed(() => {
  if (!voidDeleteTarget.value) return ''
  const label = voidDeleteTarget.value.title || 'this void'
  const kind = voidDeleteTarget.value.type === 'flashcards'
    ? 'flash card set'
    : voidDeleteTarget.value.type === 'quiz'
      ? 'quiz'
      : 'chat'
  return `Delete "${label}"? This will permanently remove the ${kind}.`
})

async function clearRouteSelectionForDeletedVoid(target: { type: 'chat' | 'flashcards' | 'quiz'; id: string }) {
  const base = { ...(route.query ?? {}) }

  if (target.type === 'chat') {
    if (activeConversationId.value !== target.id) return
    const { conversationId: _drop, ...rest } = base
    await router.replace({ query: rest })
    return
  }

  if (activeTab.value === target.type && activeVoidId.value === target.id) {
    const { voidId: _drop, ...rest } = base
    await router.replace({ query: rest })
  }
}

async function confirmDeleteVoid() {
  const target = voidDeleteTarget.value
  if (!target || deletingVoid.value) return

  deletingVoid.value = true
  try {
    if (target.type === 'chat') {
      await deleteConversationMutation.mutate({ id: target.id as Id<'conversations'> })
    } else if (target.type === 'flashcards') {
      await deleteFlashcardRoomMutation.mutate({ roomId: target.id as Id<'flashcardRooms'> })
    } else {
      await deleteQuizMutation.mutate({ quizId: target.id as Id<'quizzes'> })
    }

    await clearRouteSelectionForDeletedVoid(target)
    voidDeleteTarget.value = null

    const { toast } = await import('vue-sonner')
    const kind = target.type === 'flashcards'
      ? 'Flash card set'
      : target.type === 'quiz'
        ? 'Quiz'
        : 'Chat'
    toast.success(`${kind} deleted`)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(unwrapConvexError(e) || 'Failed to delete void')
  } finally {
    deletingVoid.value = false
  }
}

const deleteTargetIds = ref<string[]>([])
const deleteTargetDocs = computed(() =>
  (documents.value ?? []).filter(doc => deleteTargetIds.value.includes(String(doc._id))),
)
const showDeleteDialog = computed({
  get: () => deleteTargetIds.value.length > 0,
  set: (value: boolean) => {
    if (!value) deleteTargetIds.value = []
  },
})

const moveTargetIds = ref<string[]>([])
const movePending = ref(false)
const showMoveDialog = computed({
  get: () => moveTargetIds.value.length > 0,
  set: (val: boolean) => { if (!val) moveTargetIds.value = [] },
})

const allowedTabs = ['chat', 'flashcards', 'quiz', 'audio-overview', 'documents'] as const
type TabValue = typeof allowedTabs[number]
const initialTab = computed<TabValue>(() => {
  const t = route.query?.tab
  return typeof t === 'string' && (allowedTabs as readonly string[]).includes(t) ? (t as TabValue) : 'chat'
})
const activeTab = ref<TabValue>(initialTab.value)
const activeConversationId = computed(() => conversationIdRef.value ? String(conversationIdRef.value) : null)
const activeVoidId = computed(() => {
  const q = route.query?.voidId
  return typeof q === 'string' && (activeTab.value === 'flashcards' || activeTab.value === 'quiz') ? q : null
})

type HelperMode = 'sources' | 'tasks' | 'podcast' | null
const helperMode = ref<HelperMode>(null)

watch(() => route.query?.tab, async () => {
  const raw = route.query?.tab
  if (typeof raw === 'string' && raw === 'audio-overview') {
    const { conversationId: _dropC, voidId: _dropV, ...rest } = route.query ?? {}
    try {
      await setPreferredMainPaneMutation.mutate({ folderId: folderId.value, pane: 'podcast' } as any)
    } catch { /* best-effort */ }
    await router.replace({ query: { ...rest, tab: 'chat' } })
    activeTab.value = 'chat'
    helperMode.value = 'podcast'
    return
  }
  activeTab.value = initialTab.value
})

watch(activeTab, (tab) => {
  if (tab === 'chat' && helperMode.value === null && isDesktopMounted.value) {
    helperMode.value = 'podcast'
  }
}, { immediate: true })

async function onTabChange(next: TabValue) {
  activeTab.value = next
  const base = { ...(route.query ?? {}) }
  if (next !== 'flashcards' && next !== 'quiz') delete base.voidId
  await router.replace({ query: { ...base, tab: next } })
  hideSidebarOnMobile()
}
const documentsBulkMode = ref(false)
const selectedDocumentIds = ref<string[]>([])
const documentsDeletePending = ref(false)
const sourcePanelOpen = computed({
  get: () => helperMode.value === 'sources',
  set: (v: boolean) => { helperMode.value = v ? 'sources' : null },
})
const chatHelperOpen = computed(() =>
  helperMode.value === 'sources' || helperMode.value === 'podcast',
)
type ChatHelperTab = 'podcast' | 'sources'
function setChatHelperTab(next: ChatHelperTab) {
  helperMode.value = next
}
const sourcePanelSide = ref<'left' | 'right'>('right')
const { activeCount: tasksActiveCount } = useTasks(folderId)
const indexedDocumentCount = computed(() =>
  (documents.value ?? []).filter(doc => doc.status === 'success').length,
)
const folderEditOpen = ref(false)
const subfolderCreateOpen = ref(false)
const activeCitationIndex = ref<number | null>(null)
const activeMessageIndex = ref<number | null>(null)
const chatInputRef = ref<{ focus: () => void } | null>(null)
const chatScrollRef = ref<HTMLElement | null>(null)
const SOURCE_PANEL_SIDE_KEY = 'g4.chat.source-panel.side'
const PANEL_FLIP_DRAG_THRESHOLD = 4

const isSourcePanelLeading = computed(() => sourcePanelSide.value === 'left')
const flipPanelAriaLabel = computed(() =>
  isSourcePanelLeading.value ? 'Move sources panel to the right' : 'Move sources panel to the left',
)

const panelFlipPointerStart = ref<{ x: number; y: number } | null>(null)
const suppressNextPanelFlipClick = ref(false)

function clearSelectedDocuments() {
  selectedDocumentIds.value = []
}

function exitDocumentsBulkMode() {
  documentsBulkMode.value = false
  clearSelectedDocuments()
}

function toggleDocumentsBulkMode(next: boolean) {
  if (!next) {
    exitDocumentsBulkMode()
    return
  }
  if ((documentsForDisplay.value?.length ?? 0) === 0) return
  documentsBulkMode.value = true
}

function toggleDocumentSelection(id: string) {
  if (!documentsBulkMode.value) documentsBulkMode.value = true
  const next = new Set(selectedDocumentIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedDocumentIds.value = [...next]
}

function selectAllVisibleDocuments() {
  selectedDocumentIds.value = (documentsForDisplay.value ?? [])
    .filter(doc => doc.status !== 'pending' && doc.status !== 'failed')
    .map(doc => String(doc._id))
}

watch(
  () => (documentsForDisplay.value ?? []).map(doc => String(doc._id)),
  (visibleIds) => {
    const visible = new Set(visibleIds)
    const next = selectedDocumentIds.value.filter(id => visible.has(id))
    if (next.length !== selectedDocumentIds.value.length) selectedDocumentIds.value = next
    if (visibleIds.length === 0 && documentsBulkMode.value) exitDocumentsBulkMode()
  },
  { immediate: true },
)

function getCurrentTabIndex() {
  return allowedTabs.indexOf(activeTab.value)
}

function hasBlockingOverlay() {
  if (!import.meta.client) return false
  return Boolean(document.querySelector(
    '[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="drawer-content"], [data-slot="alert-dialog-content"]',
  ))
}

useHorizontalSwipeGesture({
  target: workspaceRef,
  threshold: 24,
  shouldStart(event) {
    return !isDesktop.value
      && !hasBlockingOverlay()
      && shouldStartHorizontalGesture(event, { edgeGuardPx: SIDEBAR_SWIPE_EDGE_GUARD_PX })
  },
  onSwipeEnd({ deltaX }) {
    if (Math.abs(deltaX) >= TAB_SWITCH_THRESHOLD_PX) {
      const handledSidebarSwipe = handleWorkspaceSidebarSwipe(deltaX)
      if (!handledSidebarSwipe) {
        const currentIndex = getCurrentTabIndex()
        const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1
        const nextTab = allowedTabs[nextIndex]
        if (nextTab) void onTabChange(nextTab)
      }
    }
  },
})

const allSources = computed(() => {
  if (activeMessageIndex.value === null) return []
  const msg = messages.value[activeMessageIndex.value]
  return msg?.sources ?? []
})
const latestSourcedMessageIndex = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    if ((messages.value[i]?.sources?.length ?? 0) > 0) return i
  }
  return null
})
const canOpenSourcePanelFromSwipe = computed(() =>
  activeTab.value === 'chat' && latestSourcedMessageIndex.value !== null,
)

function getMobileRailState() {
  return folderShellRef.value?.getMobileRailState() ?? 'hidden'
}

function handleRightSidebarSwipeOpen() {
  if (!canOpenSourcePanelFromSwipe.value) return false
  const messageIndex = latestSourcedMessageIndex.value
  if (messageIndex === null) return false
  activeMessageIndex.value = messageIndex
  activeCitationIndex.value = null
  sourcePanelOpen.value = true
  return true
}

function handleWorkspaceSidebarSwipe(deltaX: number) {
  const railState = getMobileRailState()

  if (deltaX > 0) {
    if (sourcePanelOpen.value) {
      sourcePanelOpen.value = false
      return true
    }
    if (railState === 'hidden') {
      folderShellRef.value?.showMobileRailCompact()
      return true
    }
    if (railState === 'compact') {
      folderShellRef.value?.expandMobileRail()
      return true
    }
    return false
  }

  if (railState === 'expanded') {
    folderShellRef.value?.collapseMobileRailToCompact()
    return true
  }
  if (railState === 'compact') {
    folderShellRef.value?.hideMobileRail()
    return true
  }
  if (handleRightSidebarSwipeOpen()) return true
  return false
}

function handleCitationClick(messageIndex: number, citationIndex: number) {
  activeMessageIndex.value = messageIndex
  activeCitationIndex.value = citationIndex - 1

  if (isDesktop.value) {
    sourcePanelOpen.value = true
  } else {
    sourcePanelOpen.value = true
  }
}

function toggleSourcePanelSide() {
  sourcePanelSide.value = sourcePanelSide.value === 'left' ? 'right' : 'left'
}

function handlePanelFlipPointerDown(event: PointerEvent) {
  panelFlipPointerStart.value = { x: event.clientX, y: event.clientY }
  suppressNextPanelFlipClick.value = false
}

function handlePanelFlipPointerMove(event: PointerEvent) {
  const start = panelFlipPointerStart.value
  if (!start) return

  if (
    Math.abs(event.clientX - start.x) > PANEL_FLIP_DRAG_THRESHOLD
    || Math.abs(event.clientY - start.y) > PANEL_FLIP_DRAG_THRESHOLD
  ) {
    suppressNextPanelFlipClick.value = true
  }
}

function handlePanelFlipPointerEnd() {
  panelFlipPointerStart.value = null
}

function handlePanelFlipClick() {
  if (suppressNextPanelFlipClick.value) {
    suppressNextPanelFlipClick.value = false
    return
  }
  toggleSourcePanelSide()
}

watch(() => messages.value.length, () => {
  nextTick(() => {
    chatScrollRef.value?.scrollTo({ top: chatScrollRef.value.scrollHeight, behavior: 'smooth' })
  })
})

watch(
  () => messages.value[messages.value.length - 1]?.content.length,
  () => {
    if (streaming.value) {
      nextTick(() => {
        chatScrollRef.value?.scrollTo({ top: chatScrollRef.value.scrollHeight, behavior: 'auto' })
      })
    }
  },
)

function handleSlashShortcut(e: KeyboardEvent) {
  if (e.key !== '/' || activeTab.value !== 'chat') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  e.preventDefault()
  chatInputRef.value?.focus()
}

function handleNewChatShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'n' || !(e.ctrlKey || e.metaKey)) return
  if (activeTab.value !== 'chat') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  handleNewChat()
}

function handleNewChat() {
  startNewConversation()
  const { conversationId: _dropped, ...rest } = route.query ?? {}
  void router.replace({ query: rest })
}

async function hydrateFromRoute() {
  if (!import.meta.client) return
  if (conversationIdRef.value) {
    try {
      await loadConversation(conversationIdRef.value)
    } catch {
      // conversation may not exist; ignore
    }
    return
  }

  try {
    const client = useConvex()
    const convo = await client.query(api.conversations.getMostRecentForFolder, {
      folderId: folderId.value,
    })
    if (convo?._id) {
      await loadConversation(convo._id as Id<'conversations'>)
      void router.replace({ query: { ...route.query, conversationId: convo._id } })
    }
  } catch {
    // best-effort hydration
  }
}

watch(folderId, () => {
  startNewConversation()
  void hydrateFromRoute()
})

watch(conversationIdRef, async (next, prev) => {
  if (next === prev) return
  if (next) {
    try {
      await loadConversation(next)
    } catch {
      // ignore
    }
  } else {
    startNewConversation()
  }
})

onMounted(() => {
  try {
    const stored = localStorage.getItem(SOURCE_PANEL_SIDE_KEY)
    if (stored === 'left' || stored === 'right') sourcePanelSide.value = stored
  } catch {
    // ignore storage failures
  }
  document.addEventListener('keydown', handleSlashShortcut)
  document.addEventListener('keydown', handleNewChatShortcut)
  document.addEventListener('pointermove', handlePanelFlipPointerMove)
  document.addEventListener('pointerup', handlePanelFlipPointerEnd)
  document.addEventListener('pointercancel', handlePanelFlipPointerEnd)
  void hydrateFromRoute()
  const promptParam = route.query?.prompt
  if (typeof promptParam === 'string' && promptParam.trim()) {
    nextTick(() => chatInputRef.value?.focus())
    const { prompt: _drop, ...rest } = route.query ?? {}
    void router.replace({ query: rest })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleSlashShortcut)
  document.removeEventListener('keydown', handleNewChatShortcut)
  document.removeEventListener('pointermove', handlePanelFlipPointerMove)
  document.removeEventListener('pointerup', handlePanelFlipPointerEnd)
  document.removeEventListener('pointercancel', handlePanelFlipPointerEnd)
})

watch(sourcePanelSide, (value) => {
  try {
    localStorage.setItem(SOURCE_PANEL_SIDE_KEY, value)
  } catch {
    // ignore storage failures
  }
})

async function handleSendMessage(query: string) {
  activeMessageIndex.value = null
  activeCitationIndex.value = null
  const ctx = pendingInterjectionContext.value ?? undefined
  pendingInterjectionContext.value = null
  await sendMessage(query, referenceScope.toPayload(), ctx)
}

function handlePodcastAsk(context: InterjectionContext) {
  pendingInterjectionContext.value = context
  if (chatInputRef.value?.focus) chatInputRef.value.focus()
}

function handleViewAllReferences(messageIndex: number) {
  activeMessageIndex.value = messageIndex
  activeCitationIndex.value = null
  sourcePanelOpen.value = true
}

async function handleDeleteRequest(docId: string) {
  const doc = documents.value?.find((d) => d._id === docId)
  if (!doc) return

  if (doc.status === 'failed') {
    try {
      await deleteDocument(docId as Id<'documents'>)
    } catch (e: any) {
      const { toast } = await import('vue-sonner')
      toast.error(e.message || 'Failed to remove document')
    }
    return
  }

  deleteTargetIds.value = [docId]
}

function handleDeleteSelectedDocuments() {
  if (selectedDocumentIds.value.length === 0 || documentsDeletePending.value) return
  deleteTargetIds.value = [...selectedDocumentIds.value]
}

async function confirmDelete() {
  const ids = [...deleteTargetIds.value]
  showDeleteDialog.value = false
  if (ids.length === 0 || documentsDeletePending.value) return

  documentsDeletePending.value = true
  try {
    const { toast } = await import('vue-sonner')

    if (ids.length === 1) {
      await deleteDocument(ids[0] as Id<'documents'>)
      toast.success('Document deleted')
    } else {
      const { deletedCount, failedIds, failureMessages } = await deleteDocuments(ids as Id<'documents'>[])
      if (deletedCount > 0) {
        toast.success(deletedCount === 1 ? 'Document deleted' : `${deletedCount} documents deleted`)
      }
      if (failureMessages.length > 0) {
        toast.error(failureMessages[0] || 'Failed to delete selected documents')
      }
      selectedDocumentIds.value = failedIds.map(id => String(id))
      if (failedIds.length === 0 && documentsBulkMode.value) exitDocumentsBulkMode()
    }
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to delete document')
  } finally {
    documentsDeletePending.value = false
  }
}

function handleMoveRequest(docId: string) {
  moveTargetIds.value = [docId]
}

function handleMoveSelectedDocuments() {
  if (selectedDocumentIds.value.length === 0 || movePending.value) return
  moveTargetIds.value = [...selectedDocumentIds.value]
}

async function confirmMove(destFolderId: Id<'folders'>) {
  if (moveTargetIds.value.length === 0 || movePending.value) return
  movePending.value = true
  try {
    const { toast } = await import('vue-sonner')
    const destFolder = allFolders.value?.find((f) => f._id === destFolderId)
    const ids = [...moveTargetIds.value]

    if (ids.length > 1) {
      const { movedCount, failedIds, failureMessages } = await moveDocuments(ids as Id<'documents'>[], destFolderId)
      if (movedCount > 0) {
        toast.success(movedCount === 1 ? `Moved to ${destFolder?.name ?? 'folder'}` : `${movedCount} documents moved`)
      }
      if (failureMessages.length > 0) {
        toast.error(failureMessages[0] || 'Failed to move selected documents')
      }
      selectedDocumentIds.value = failedIds.map(id => String(id))
      if (failedIds.length === 0 && documentsBulkMode.value) exitDocumentsBulkMode()
    } else {
      await moveDocument(ids[0] as Id<'documents'>, destFolderId)
      toast.success(`Moved to ${destFolder?.name ?? 'folder'}`)
      if (documentsBulkMode.value) exitDocumentsBulkMode()
    }
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to move document')
  } finally {
    movePending.value = false
    moveTargetIds.value = []
  }
}

async function handleUpload(files: File[]) {
  if (isDesktop.value) helperMode.value = 'tasks'
  try {
    await uploadFiles(files, folderId.value)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Upload failed')
  }
}

async function handleImportLink(url: string) {
  if (isDesktop.value) helperMode.value = 'tasks'
  try {
    await importDocumentFromUrl(url, folderId.value)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Import failed')
  }
}
</script>

<template>
  <FolderShell
    ref="folderShellRef"
    :folder-id="folderId"
    :folder="seededFolder"
    :active-tab="activeTab"
    :active-conversation-id="activeConversationId"
    :active-void-id="activeVoidId"
    @update:active-tab="onTabChange"
    @new-void="newVoidOpen = true"
    @select-void="onSelectVoid"
    @request-delete-void="handleDeleteVoidRequest"
  >
    <template #top-bar="{ railCollapsed, railHidden, toggleRail }">
      <div class="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border/60 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-testid="drawer-toggle"
            class="group relative flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-primary overflow-hidden transition"
            :aria-label="isDesktop ? (railCollapsed ? 'Expand sidebar' : 'Collapse sidebar') : (railHidden ? 'Show folder sidebar' : 'Hide folder sidebar')"
            @click="toggleRail()"
          >
            <span 
              :class="[
                'absolute inset-0 bg-primary transition-opacity',
                (!isDesktop && !railHidden) || (isDesktop && !railCollapsed) ? 'opacity-10' : 'opacity-0 group-hover:opacity-10'
              ]" 
            />
            <PanelRight class="relative z-10 h-4 w-4" />
          </button>
          <div class="min-w-0">
            <UiSkeleton v-if="!folder" class="h-6 w-40 rounded-md" />
            <h1 v-else data-testid="folder-heading" class="truncate text-xl font-semibold tracking-tight text-foreground">
              {{ folder.name }}
            </h1>
            <p class="text-xs text-muted-foreground">
              <NuxtLink to="/" class="transition-colors hover:text-foreground">
                Home
              </NuxtLink>
              <span class="px-1">›</span>
              <span>{{ folder?.name ?? '…' }}</span>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            data-testid="folder-header-edit"
            aria-label="Edit folder"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            @click="folderEditOpen = true"
          >
            <Pencil class="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="folder-header-add-subfolder"
            aria-label="Add subfolder"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            @click="subfolderCreateOpen = true"
          >
            <FolderPlus class="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="folder-header-tasks"
            aria-label="Toggle tasks"
            class="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            @click="helperMode = helperMode === 'tasks' ? null : 'tasks'"
          >
            <ListTodo class="h-4 w-4" />
            <span
              v-if="tasksActiveCount > 0"
              data-testid="folder-header-tasks-badge"
              class="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium leading-none text-white"
            >
              {{ tasksActiveCount }}
            </span>
          </button>
        </div>
      </div>
    </template>

    <VoidsCreateVoidDialog
      v-model:open="newVoidOpen"
      :folder-name="folder?.name ?? ''"
      :submitting="creatingVoid"
      :indexed-count="indexedDocumentCount"
      @create="onCreateVoid"
    />

    <div ref="workspaceRef" class="flex min-h-0 min-w-0 flex-1" style="touch-action: pan-y">
      <UiTabs v-model="activeTab" class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <UiTabsList class="sr-only">
          <UiTabsTrigger value="chat">Chat</UiTabsTrigger>
          <UiTabsTrigger value="flashcards">Flash Cards</UiTabsTrigger>
          <UiTabsTrigger value="quiz">Quiz</UiTabsTrigger>
          <UiTabsTrigger value="documents">Documents</UiTabsTrigger>
        </UiTabsList>

      <UiTabsContent value="chat" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div v-if="isPodcastMain && isDesktop" class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal" class="min-w-0 flex-1">
            <ResizablePanel :default-size="72" :min-size="40" class="min-h-0 min-w-0">
              <AudioOverviewShell
                ref="audioOverviewShellRef"
                :folder-id="folderId"
                :scope="referenceScope"
                @generation-started="() => { if (isDesktop) helperMode = 'podcast' }"
                @podcast-ask="handlePodcastAsk"
              />
            </ResizablePanel>
            <ResizableHandle with-handle>
              <button
                type="button"
                data-testid="source-panel-flip"
                :aria-label="flipPanelAriaLabel"
                class="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground shadow-sm transition-colors hover:bg-accent"
                @pointerdown="handlePanelFlipPointerDown"
                @click.stop="handlePanelFlipClick"
              >
                <ArrowLeftRight class="h-3.5 w-3.5" />
              </button>
            </ResizableHandle>
            <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-w-[18rem]">
              <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <template v-if="!hasIndexedDocuments">
                  <div class="flex flex-1 items-center justify-center text-muted-foreground">
                    <div class="text-center">
                      <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
                      <p class="text-lg font-medium">Upload documents to start chatting</p>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div ref="chatScrollRef" data-testid="chat-scroll-area" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="keyboard-scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    <template v-for="(msg, i) in messages" :key="i">
                      <ChatMessage
                        :role="msg.role"
                        :content="msg.content"
                        :sources="msg.sources"
                        :streaming="streaming && i === messages.length - 1"
                        @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                        @citation-long-press="(citIndex: number) => handleCitationClick(i, citIndex)"
                      />
                      <ChatReferenceChips
                        v-if="msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0"
                        :sources="msg.sources ?? []"
                        @view-all="handleViewAllReferences(i)"
                        @chip-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                      />
                    </template>
                    <ChatThinkingRow v-if="thinking" :model="selectedModel" />
                    <div v-if="error" class="text-center text-sm text-destructive">
                      {{ error }}
                    </div>
                  </div>
                </template>
                <div data-testid="chat-composer-footer" class="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                  <div class="flex items-center px-4 pt-2">
                    <ChatModelSelector
                      :model-value="selectedModel"
                      :disabled="loading"
                      @update:model-value="selectModel"
                    />
                  </div>
                  <ChatInput
                    ref="chatInputRef"
                    :disabled="!hasIndexedDocuments || loading"
                    :attachment-status="attachmentStatus"
                    :busy="uploading || importingLink"
                    :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
                    :folder-id="folderId"
                    :scope="referenceScope"
                    @upload-files="handleUpload"
                    @import-link="handleImportLink"
                    :interjection-context="pendingInterjectionContext"
                    @submit="handleSendMessage"
                  />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <div v-else class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <template v-if="isDesktop && chatHelperOpen">
            <ResizablePanelGroup direction="horizontal" class="min-w-0 flex-1">
              <template v-if="isSourcePanelLeading">
                <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-w-[18rem]">
                  <div class="flex h-full min-h-0 flex-col overflow-hidden">
                    <FolderShellUnifiedHelperPaneTabs
                      :model-value="helperMode === 'sources' ? 'sources' : 'podcast'"
                      @update:model-value="setChatHelperTab"
                    />
                    <div v-if="helperMode === 'podcast'" class="min-h-0 flex-1 overflow-hidden">
                      <AudioOverviewShell :folder-id="folderId" :scope="referenceScope" @podcast-ask="handlePodcastAsk" />
                    </div>
                    <ChatSourcePanel
                      v-else
                      :sources="allSources"
                      :active-citation-index="activeCitationIndex"
                      :open="sourcePanelOpen"
                      side="left"
                      class="min-h-0 flex-1"
                      @close="helperMode = null"
                    />
                  </div>
                </ResizablePanel>
                <ResizableHandle with-handle>
                  <button
                    type="button"
                    data-testid="source-panel-flip"
                    :aria-label="flipPanelAriaLabel"
                    class="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground shadow-sm transition-colors hover:bg-accent"
                    @pointerdown="handlePanelFlipPointerDown"
                    @click.stop="handlePanelFlipClick"
                  >
                    <ArrowLeftRight class="h-3.5 w-3.5" />
                  </button>
                </ResizableHandle>
                <ResizablePanel :default-size="72" :min-size="40" class="min-h-0 min-w-0">
                  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <template v-if="!hasIndexedDocuments">
                      <div class="flex flex-1 items-center justify-center text-muted-foreground">
                        <div class="text-center">
                          <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
                          <p class="text-lg font-medium">Upload documents to start chatting</p>
                        </div>
                      </div>
                    </template>

                    <template v-else>
                      <div ref="chatScrollRef" data-testid="chat-scroll-area" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="keyboard-scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        <template v-for="(msg, i) in messages" :key="i">
                          <ChatMessage
                            :role="msg.role"
                            :content="msg.content"
                            :sources="msg.sources"
                            :streaming="streaming && i === messages.length - 1"
                            @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                            @citation-long-press="(citIndex: number) => handleCitationClick(i, citIndex)"
                          />
                          <ChatReferenceChips
                            v-if="msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0"
                            :sources="msg.sources ?? []"
                            @view-all="handleViewAllReferences(i)"
                            @chip-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                          />
                        </template>
                        <ChatThinkingRow v-if="thinking" :model="selectedModel" />
                        <div v-if="error" class="text-center text-sm text-destructive">
                          {{ error }}
                        </div>
                      </div>
                    </template>

                    <div data-testid="chat-composer-footer" class="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                      <div class="flex items-center px-4 pt-2">
                        <ChatModelSelector
                          :model-value="selectedModel"
                          :disabled="loading"
                          @update:model-value="selectModel"
                        />
                      </div>
                      <ChatInput
                        ref="chatInputRef"
                        :disabled="!hasIndexedDocuments || loading"
                        :attachment-status="attachmentStatus"
                        :busy="uploading || importingLink"
                        :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
                        :folder-id="folderId"
                        :scope="referenceScope"
                        @upload-files="handleUpload"
                        @import-link="handleImportLink"
                        @submit="handleSendMessage"
                      />
                    </div>
                  </div>
                </ResizablePanel>
              </template>

              <template v-else>
                <ResizablePanel :default-size="72" :min-size="40" class="min-h-0 min-w-0">
                  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <template v-if="!hasIndexedDocuments">
                      <div class="flex flex-1 items-center justify-center text-muted-foreground">
                        <div class="text-center">
                          <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
                          <p class="text-lg font-medium">Upload documents to start chatting</p>
                        </div>
                      </div>
                    </template>

                    <template v-else>
                      <div ref="chatScrollRef" data-testid="chat-scroll-area" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="keyboard-scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        <template v-for="(msg, i) in messages" :key="i">
                          <ChatMessage
                            :role="msg.role"
                            :content="msg.content"
                            :sources="msg.sources"
                            :streaming="streaming && i === messages.length - 1"
                            @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                            @citation-long-press="(citIndex: number) => handleCitationClick(i, citIndex)"
                          />
                          <ChatReferenceChips
                            v-if="msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0"
                            :sources="msg.sources ?? []"
                            @view-all="handleViewAllReferences(i)"
                            @chip-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                          />
                        </template>
                        <ChatThinkingRow v-if="thinking" :model="selectedModel" />
                        <div v-if="error" class="text-center text-sm text-destructive">
                          {{ error }}
                        </div>
                      </div>
                    </template>

                    <div data-testid="chat-composer-footer" class="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                      <div class="flex items-center px-4 pt-2">
                        <ChatModelSelector
                          :model-value="selectedModel"
                          :disabled="loading"
                          @update:model-value="selectModel"
                        />
                      </div>
                      <ChatInput
                        ref="chatInputRef"
                        :disabled="!hasIndexedDocuments || loading"
                        :attachment-status="attachmentStatus"
                        :busy="uploading || importingLink"
                        :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
                        :folder-id="folderId"
                        :scope="referenceScope"
                        @upload-files="handleUpload"
                        @import-link="handleImportLink"
                        @submit="handleSendMessage"
                      />
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle with-handle>
                  <button
                    type="button"
                    data-testid="source-panel-flip"
                    :aria-label="flipPanelAriaLabel"
                    class="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground shadow-sm transition-colors hover:bg-accent"
                    @pointerdown="handlePanelFlipPointerDown"
                    @click.stop="handlePanelFlipClick"
                  >
                    <ArrowLeftRight class="h-3.5 w-3.5" />
                  </button>
                </ResizableHandle>
                <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-w-[18rem]">
                  <div class="flex h-full min-h-0 flex-col overflow-hidden">
                    <FolderShellUnifiedHelperPaneTabs
                      :model-value="helperMode === 'sources' ? 'sources' : 'podcast'"
                      @update:model-value="setChatHelperTab"
                    />
                    <div v-if="helperMode === 'podcast'" class="min-h-0 flex-1 overflow-hidden">
                      <AudioOverviewShell :folder-id="folderId" :scope="referenceScope" @podcast-ask="handlePodcastAsk" />
                    </div>
                    <ChatSourcePanel
                      v-else
                      :sources="allSources"
                      :active-citation-index="activeCitationIndex"
                      :open="sourcePanelOpen"
                      side="right"
                      class="min-h-0 flex-1"
                      @close="helperMode = null"
                    />
                  </div>
                </ResizablePanel>
              </template>
            </ResizablePanelGroup>
          </template>

          <div v-else class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <template v-if="!hasIndexedDocuments">
              <div class="flex flex-1 items-center justify-center text-muted-foreground">
                <div class="text-center">
                  <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
                  <p class="text-lg font-medium">Upload documents to start chatting</p>
                </div>
              </div>
            </template>

            <template v-else>
              <div ref="chatScrollRef" data-testid="chat-scroll-area" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="keyboard-scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <template v-for="(msg, i) in messages" :key="i">
                  <ChatMessage
                    :role="msg.role"
                    :content="msg.content"
                    :sources="msg.sources"
                    :streaming="streaming && i === messages.length - 1"
                    @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                    @citation-long-press="(citIndex: number) => handleCitationClick(i, citIndex)"
                  />
                  <ChatReferenceChips
                    v-if="msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0"
                    :sources="msg.sources ?? []"
                    @view-all="handleViewAllReferences(i)"
                    @chip-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                  />
                </template>
                <ChatThinkingRow v-if="thinking" :model="selectedModel" />
                <div v-if="error" class="text-center text-sm text-destructive">
                  {{ error }}
                </div>
              </div>
            </template>

            <div data-testid="chat-composer-footer" class="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div class="flex items-center px-4 pt-2">
                <ChatModelSelector
                  :model-value="selectedModel"
                  :disabled="loading"
                  @update:model-value="selectModel"
                />
              </div>
              <ChatInput
                ref="chatInputRef"
                :disabled="!hasIndexedDocuments || loading"
                :attachment-status="attachmentStatus"
                :busy="uploading || importingLink"
                :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
                :folder-id="folderId"
                :scope="referenceScope"
                @upload-files="handleUpload"
                @import-link="handleImportLink"
                @submit="handleSendMessage"
              />
            </div>
          </div>
        </div>
        <Sheet v-if="!isDesktop" :open="sourcePanelOpen" @update:open="sourcePanelOpen = $event">
          <SheetContent
            side="right"
            class="w-[85vw] max-w-[85vw] gap-0 p-0 [&>button]:hidden"
          >
            <SheetHeader class="sr-only">
              <SheetTitle>Sources</SheetTitle>
              <SheetDescription>View the cited document excerpts for this chat.</SheetDescription>
            </SheetHeader>
            <FolderHelperPane
              :sources="allSources"
              :active-citation-index="activeCitationIndex"
              @close="sourcePanelOpen = false"
            />
          </SheetContent>
        </Sheet>
      </UiTabsContent>

      <UiTabsContent value="flashcards" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <FlashcardsTab
          :folder-id="folderId"
          :selected-room-id="activeTab === 'flashcards' ? activeVoidId : null"
          @select-room="(roomId) => {
            const base = { ...(route.query ?? {}) }
            const { conversationId: _dropC, ...rest } = base
            if (roomId) {
              router.replace({ query: { ...rest, tab: 'flashcards', voidId: roomId } })
            } else {
              const { voidId: _dropV, ...restNoVoid } = rest
              router.replace({ query: { ...restNoVoid, tab: 'flashcards' } })
            }
          }"
          @generation-started="() => { if (isDesktop) helperMode = 'tasks' }"
        />
      </UiTabsContent>

      <UiTabsContent value="quiz" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <QuizTab
          :folder-id="folderId"
          :selected-quiz-id="activeTab === 'quiz' ? activeVoidId : null"
          @generation-started="() => { if (isDesktop) helperMode = 'tasks' }"
        />
      </UiTabsContent>

      <UiTabsContent value="audio-overview" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AudioOverviewShell
          ref="audioOverviewShellRef"
          :folder-id="folderId"
          :scope="referenceScope"
          @generation-started="() => { if (isDesktop) helperMode = 'tasks' }"
          @podcast-ask="handlePodcastAsk"
        />
      </UiTabsContent>

        <UiTabsContent value="documents" class="keyboard-scroll-area flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
          <DocumentsFileUploadZone
            :folder-id="folderId"
            :disabled="uploading"
            @upload="handleUpload"
          />
          <FolderShellFilesPanel
            v-if="!isDesktop"
            :documents="documentsForDisplay"
            :bulk-mode="documentsBulkMode"
            :selected-ids="selectedDocumentIds"
            :pending="documentsDeletePending || movePending"
            @delete="handleDeleteRequest"
            @dismiss="dismissDisplayDocument"
            @move="handleMoveRequest"
            @open="() => undefined"
            @rename="() => undefined"
            @download="() => undefined"
            @toggle-bulk-mode="toggleDocumentsBulkMode"
            @select-all="selectAllVisibleDocuments"
            @clear-selection="clearSelectedDocuments"
            @bulk-move="handleMoveSelectedDocuments"
            @bulk-delete="handleDeleteSelectedDocuments"
            @toggle-select="toggleDocumentSelection"
          />
          <FolderShellFilesList
            v-else
            :documents="documentsForDisplay"
            @delete="handleDeleteRequest"
            @dismiss="dismissDisplayDocument"
            @move="handleMoveRequest"
            @open="() => undefined"
            @rename="() => undefined"
            @download="() => undefined"
          />
        </UiTabsContent>
      </UiTabs>

      <div
        v-if="isDesktop && helperMode === 'tasks'"
        class="h-full w-80 shrink-0 border-l border-border/60"
      >
        <FolderTasksPane
          :folder-id="folderId"
          @close="helperMode = null"
          @view-room="(roomId) => {
            helperMode = null
            activeTab = 'flashcards'
            const { conversationId: _dropC, ...rest } = route.query ?? {}
            router.replace({ query: { ...rest, tab: 'flashcards', voidId: roomId } })
          }"
        />
      </div>
    </div>

    <Sheet v-if="!isDesktop" :open="helperMode === 'tasks'" @update:open="(v) => { if (!v) helperMode = null }">
      <SheetContent
        side="right"
        class="w-[85vw] max-w-[85vw] gap-0 p-0 [&>button]:hidden"
      >
        <SheetHeader class="sr-only">
          <SheetTitle>Tasks</SheetTitle>
          <SheetDescription>View active tasks for this folder.</SheetDescription>
        </SheetHeader>
        <FolderTasksPane
          :folder-id="folderId"
          @close="helperMode = null"
          @view-room="(roomId) => {
            helperMode = null
            activeTab = 'flashcards'
            const { conversationId: _dropC, ...rest } = route.query ?? {}
            router.replace({ query: { ...rest, tab: 'flashcards', voidId: roomId } })
          }"
        />
      </SheetContent>
    </Sheet>

    <UiAlertDialog v-model:open="showDeleteDialog">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>{{ deleteTargetIds.length > 1 ? 'Delete documents' : 'Delete document' }}</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            <template v-if="deleteTargetIds.length > 1">
              This will remove {{ deleteTargetIds.length }} documents and their indexed content.
            </template>
            <template v-else>
              Are you sure you want to delete {{ deleteTargetDocs[0]?.filename }}? This will remove the document and its indexed content.
            </template>
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
          <UiButton variant="destructive" :disabled="documentsDeletePending" @click="confirmDelete">Delete</UiButton>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>

    <UiAlertDialog v-model:open="showDeleteVoidDialog">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>Delete void</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            {{ deleteVoidDescription }}
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel :disabled="deletingVoid">
            Cancel
          </UiAlertDialogCancel>
          <UiAlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
            :disabled="deletingVoid"
            @click="confirmDeleteVoid"
          >
            {{ deletingVoid ? 'Deleting…' : 'Delete' }}
          </UiAlertDialogAction>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>

    <MoveToFolderDialog
      v-model:open="showMoveDialog"
      :folders="allFolders"
      :current-folder-id="folderId"
      :pending="movePending"
      :item-count="moveTargetIds.length"
      @submit="confirmMove"
    />

    <FoldersFolderFormModal
      v-model:open="folderEditOpen"
      mode="edit"
      :folder="folder"
      @deleted="router.replace('/')"
    />

    <FoldersFolderFormModal
      v-model:open="subfolderCreateOpen"
      mode="create"
      :parent-id="folderId"
    />
  </FolderShell>
</template>
