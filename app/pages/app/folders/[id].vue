<script setup lang="ts">
import { toast } from 'vue-sonner'
import { getErrorMessage } from '~~/shared/errors'
import { PanelRight, Pencil, FolderPlus, ListTodo, Mic, ArrowLeftRight } from '@lucide/vue'
import type { Id } from '~~/convex/_generated/dataModel'
import type { VoidType } from '~/components/voids/CreateVoidDialog.vue'
import MoveToFolderDialog from '~/components/documents/MoveToFolderDialog.vue'
import FolderTasksPane from '~/components/folders/FolderTasksPane.vue'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { provideFolderPageContext } from '~/composables/useFolderPageContext'
import { useHorizontalSwipeGesture } from '~/composables/useHorizontalSwipeGesture'
import { useGestureGuards } from '~/composables/useGestureGuards'

definePageMeta({ layout: 'folder' })

const route = useRoute()
const router = useRouter()

const ctx = provideFolderPageContext()
const {
  folderId, folder, seededFolder, allFolders,
  documents, helperPane, isDesktop,
  togglePodcastMain,
  indexedDocumentCount, tasksActiveCount,
  deleteDocument, deleteDocuments, moveDocument, moveDocuments,
  createConversation, createFlashcardRoom, createAudioOverviewRoom,
  deleteConversation, deleteFlashcardRoom, deleteAudioOverviewRoom, deleteQuiz, deleteCourse,
} = ctx

type FolderShellHandle = {
  showMobileRailCompact: () => void
  expandMobileRail: () => void
  collapseMobileRailToCompact: () => void
  hideMobileRail: () => void
  getMobileRailState: () => 'hidden' | 'compact' | 'expanded'
}

const folderShellRef = ref<FolderShellHandle | null>(null)
const workspaceRef = ref<HTMLElement | null>(null)

const hasIndexedDocuments = computed(() => indexedDocumentCount.value > 0)
const isChatRoute = computed(() => route.path.includes('/chat'))

const activeConversationId = computed(() => {
  const id = route.params.conversationId
  return typeof id === 'string' ? id : null
})

const activeVoidId = computed(() => {
  const roomId = route.params.roomId
  if (typeof roomId === 'string') return roomId
  const quizId = route.params.quizId
  if (typeof quizId === 'string') return quizId
  const courseId = route.params.courseId
  if (typeof courseId === 'string') return courseId
  return null
})

const activeTab = computed(() => {
  const path = route.path
  if (path.includes('/chat')) return 'chat' as const
  if (path.includes('/flashcards')) return 'flashcards' as const
  if (path.includes('/audio-overview')) return 'audio-overview' as const
  if (path.includes('/quiz')) return 'quiz' as const
  if (path.includes('/learn')) return 'learn' as const
  return 'documents' as const
})

const newVoidOpen = ref(false)
const creatingVoid = ref(false)
const folderEditOpen = ref(false)
const subfolderCreateOpen = ref(false)

const { shouldStartHorizontalGesture } = useGestureGuards()

function hideSidebarOnMobile() {
  folderShellRef.value?.hideMobileRail()
}

function unwrapConvexError(error: unknown): string {
  return getErrorMessage(error, '')
    .replace(/^\[CONVEX [^\]]+\]\s*/, '')
    .replace(/^ConvexError:\s*/, '')
    .trim()
}

async function onCreateVoid(payload: { type: VoidType; name?: string }) {
  if (creatingVoid.value) return
  creatingVoid.value = true
  try {
    const { type, name } = payload
    const trimmedName = name?.trim()
    if (type === 'chat') {
      const newId = await createConversation(trimmedName || 'New chat')
      await navigateTo(`/app/folders/${folderId.value}/chat/${newId}`)
    } else if (type === 'flashcards') {
      const result = await createFlashcardRoom(trimmedName)
      await navigateTo(`/app/folders/${folderId.value}/flashcards/${result.roomId}`)
    } else if (type === 'audio-overview') {
      const result = await createAudioOverviewRoom(trimmedName)
      await navigateTo(`/app/folders/${folderId.value}/audio-overview/${result.roomId}`)
    } else if (type === 'quiz') {
      await navigateTo(`/app/folders/${folderId.value}/quiz`)
    } else if (type === 'course') {
      await navigateTo(`/app/folders/${folderId.value}/learn/create`)
    }
    newVoidOpen.value = false
    hideSidebarOnMobile()
  } catch (e) {
    toast.error(unwrapConvexError(e) || 'Failed to create void')
  } finally {
    creatingVoid.value = false
  }
}

async function onSelectVoid({ type, id }: { type: 'chat' | 'flashcards' | 'audio-overview' | 'quiz' | 'course'; id: string }) {
  if (type === 'chat') {
    await navigateTo(`/app/folders/${folderId.value}/chat/${id}`)
  } else if (type === 'flashcards') {
    await navigateTo(`/app/folders/${folderId.value}/flashcards/${id}`)
  } else if (type === 'audio-overview') {
    await navigateTo(`/app/folders/${folderId.value}/audio-overview/${id}`)
  } else if (type === 'quiz') {
    await navigateTo(`/app/folders/${folderId.value}/quiz/${id}`)
  } else if (type === 'course') {
    await navigateTo(`/app/folders/${folderId.value}/learn/${id}`)
  }
  hideSidebarOnMobile()
}

const voidDeleteTarget = ref<{ type: 'chat' | 'flashcards' | 'audio-overview' | 'quiz' | 'course'; id: string; title: string } | null>(null)
const deletingVoid = ref(false)
const showDeleteVoidDialog = computed({
  get: () => voidDeleteTarget.value !== null,
  set: (value: boolean) => { if (!value) voidDeleteTarget.value = null },
})
const deleteVoidDescription = computed(() => {
  if (!voidDeleteTarget.value) return ''
  const label = voidDeleteTarget.value.title || 'this void'
  const kindMap: Record<string, string> = { flashcards: 'flash card set', 'audio-overview': 'audio overview', quiz: 'quiz', chat: 'chat', course: 'course' }
  const kind = kindMap[voidDeleteTarget.value.type] ?? 'void'
  return `Delete "${label}"? This will permanently remove the ${kind}.`
})

async function confirmDeleteVoid() {
  const target = voidDeleteTarget.value
  if (!target || deletingVoid.value) return
  deletingVoid.value = true
  try {
    if (target.type === 'chat') await deleteConversation(target.id as Id<'conversations'>)
    else if (target.type === 'flashcards') await deleteFlashcardRoom(target.id as Id<'flashcardRooms'>)
    else if (target.type === 'audio-overview') await deleteAudioOverviewRoom(target.id as Id<'audioOverviewRooms'>)
    else if (target.type === 'course') await deleteCourse(target.id as Id<'courses'>)
    else await deleteQuiz(target.id as Id<'quizzes'>)

    const currentPath = route.path
    if (currentPath.includes(`/${target.type === 'chat' ? 'chat' : target.type}/${target.id}`)) {
      await navigateTo(`/app/folders/${folderId.value}/chat`)
    }
    voidDeleteTarget.value = null
    const kindLabels: Record<string, string> = { flashcards: 'Flash card set', 'audio-overview': 'Audio Overview', quiz: 'Quiz', chat: 'Chat', course: 'Course' }
    const kind = kindLabels[target.type] ?? 'Void'
    toast.success(`${kind} deleted`)
  } catch (e) {
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
  set: (value: boolean) => { if (!value) deleteTargetIds.value = [] },
})
const documentsDeletePending = ref(false)

const moveTargetIds = ref<string[]>([])
const movePending = ref(false)
const showMoveDialog = computed({
  get: () => moveTargetIds.value.length > 0,
  set: (val: boolean) => { if (!val) moveTargetIds.value = [] },
})

async function confirmDelete() {
  const ids = [...deleteTargetIds.value]
  showDeleteDialog.value = false
  if (ids.length === 0 || documentsDeletePending.value) return
  documentsDeletePending.value = true
  try {
    if (ids.length === 1) {
      await deleteDocument(ids[0] as Id<'documents'>)
      toast.success('Document deleted')
    } else {
      const { deletedCount, failureMessages } = await deleteDocuments(ids as Id<'documents'>[])
      if (deletedCount > 0) toast.success(deletedCount === 1 ? 'Document deleted' : `${deletedCount} documents deleted`)
      if (failureMessages.length > 0) toast.error(failureMessages[0] || 'Failed to delete')
    }
  } catch (e) {
    toast.error(getErrorMessage(e, 'Failed to delete document'))
  } finally {
    documentsDeletePending.value = false
  }
}

async function confirmMove(destFolderId: Id<'folders'>) {
  if (moveTargetIds.value.length === 0 || movePending.value) return
  movePending.value = true
  try {
    const destFolder = allFolders.value?.find((f) => f._id === destFolderId)
    const ids = [...moveTargetIds.value]
    if (ids.length > 1) {
      const { movedCount, failureMessages } = await moveDocuments(ids as Id<'documents'>[], destFolderId)
      if (movedCount > 0) toast.success(movedCount === 1 ? `Moved to ${destFolder?.name ?? 'folder'}` : `${movedCount} documents moved`)
      if (failureMessages.length > 0) toast.error(failureMessages[0] || 'Failed to move')
    } else {
      await moveDocument(ids[0] as Id<'documents'>, destFolderId)
      toast.success(`Moved to ${destFolder?.name ?? 'folder'}`)
    }
  } catch (e) {
    toast.error(getErrorMessage(e, 'Failed to move document'))
  } finally {
    movePending.value = false
    moveTargetIds.value = []
  }
}

function handleTaskViewRoom(roomId: string) {
  helperPane.close()
  navigateTo(`/app/folders/${folderId.value}/flashcards/${roomId}`)
}

function hasBlockingOverlay() {
  if (!import.meta.client) return false
  return Boolean(document.querySelector(
    '[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="drawer-content"], [data-slot="alert-dialog-content"]',
  ))
}

function handleWorkspaceSidebarSwipe(deltaX: number) {
  const railState = folderShellRef.value?.getMobileRailState() ?? 'hidden'
  if (deltaX > 0) {
    if (railState === 'hidden') { folderShellRef.value?.showMobileRailCompact(); return true }
    if (railState === 'compact') { folderShellRef.value?.expandMobileRail(); return true }
    return false
  }
  if (railState === 'expanded') { folderShellRef.value?.collapseMobileRailToCompact(); return true }
  if (railState === 'compact') { folderShellRef.value?.hideMobileRail(); return true }
  return false
}

useHorizontalSwipeGesture({
  target: workspaceRef,
  threshold: 24,
  shouldStart(event) {
    return !isDesktop.value && !hasBlockingOverlay() && shouldStartHorizontalGesture(event, { edgeGuardPx: 12 })
  },
  onSwipeEnd({ deltaX }) {
    if (Math.abs(deltaX) >= 64) handleWorkspaceSidebarSwipe(deltaX)
  },
})

const HELPER_SIDE_KEY = 'g4.folder.helper-pane.side'
const helperSide = ref<'left' | 'right'>('right')
const isHelperLeading = computed(() => helperSide.value === 'left')

function toggleHelperSide() {
  helperSide.value = helperSide.value === 'left' ? 'right' : 'left'
}

onMounted(() => {
  try {
    const stored = localStorage.getItem(HELPER_SIDE_KEY)
    if (stored === 'left' || stored === 'right') helperSide.value = stored
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
})

watch(helperSide, (v) => {
  try {
    localStorage.setItem(HELPER_SIDE_KEY, v)
  } catch {
    // Helper placement remains usable for the current session.
  }
})

watch(() => route.path, (next, prev) => {
  const wasChatRoute = prev?.includes('/chat')
  const isChatRoute_ = next?.includes('/chat')
  if (wasChatRoute && isChatRoute_) return
  helperPane.close()
})
</script>

<template>
  <FolderShell
    ref="folderShellRef"
    :folder-id="folderId"
    :folder="seededFolder"
    :active-tab="activeTab"
    :active-conversation-id="activeConversationId"
    :active-void-id="activeVoidId"
    @update:active-tab="() => {}"
    @new-void="newVoidOpen = true"
    @select-void="onSelectVoid"
    @request-delete-void="(t) => voidDeleteTarget = t"
    @navigate-learn="router.push(`/app/folders/${folderId}/learn/`)"
  >
    <template #top-bar="{ railCollapsed, railHidden, toggleRail }">
      <div class="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 sm:px-6 sm:py-4">
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
            <p class="truncate text-xs text-muted-foreground">
              <NuxtLink to="/" class="transition-colors hover:text-foreground">Home</NuxtLink>
              <span class="px-1">›</span>
              <span>{{ folder?.name ?? '…' }}</span>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" data-testid="folder-header-edit" aria-label="Edit folder" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" @click="folderEditOpen = true">
            <Pencil class="h-4 w-4" />
          </button>
          <button type="button" data-testid="folder-header-add-subfolder" aria-label="Add subfolder" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" @click="subfolderCreateOpen = true">
            <FolderPlus class="h-4 w-4" />
          </button>
          <button v-if="hasIndexedDocuments" type="button" data-testid="folder-header-podcast" aria-label="Podcast" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden" @click="togglePodcastMain()">
            <Mic class="h-4 w-4" />
          </button>
          <button type="button" data-testid="folder-header-tasks" aria-label="Toggle tasks" class="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" @click="helperPane.toggle('tasks')">
            <ListTodo class="h-4 w-4" />
            <span v-if="tasksActiveCount > 0" data-testid="folder-header-tasks-badge" class="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium leading-none text-white">
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
      <template v-if="isChatRoute || !isDesktop || !helperPane.isOpen.value">
        <NuxtPage />
      </template>
      <template v-else>
        <ResizablePanelGroup direction="horizontal" class="h-full min-w-0 flex-1">
          <template v-if="isHelperLeading">
            <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-h-0 min-w-0">
              <FolderShellHelperPane :exclude-tabs="['podcast']">
                <template #default="{ activeTabId: tid }">
                  <FolderTasksPane v-if="tid === 'tasks'" :folder-id="folderId" embedded @close="helperPane.close()" @view-room="handleTaskViewRoom" />
                </template>
              </FolderShellHelperPane>
            </ResizablePanel>
            <ResizableHandle with-handle>
              <button type="button" aria-label="Flip panel side" class="absolute z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" @click="toggleHelperSide()">
                <ArrowLeftRight class="h-3 w-3" />
              </button>
            </ResizableHandle>
            <ResizablePanel :default-size="72" :min-size="40" class="min-h-0 min-w-0">
              <NuxtPage />
            </ResizablePanel>
          </template>
          <template v-else>
            <ResizablePanel :default-size="72" :min-size="40" class="min-h-0 min-w-0">
              <NuxtPage />
            </ResizablePanel>
            <ResizableHandle with-handle>
              <button type="button" aria-label="Flip panel side" class="absolute z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" @click="toggleHelperSide()">
                <ArrowLeftRight class="h-3 w-3" />
              </button>
            </ResizableHandle>
            <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-h-0 min-w-0">
              <FolderShellHelperPane :exclude-tabs="['podcast']">
                <template #default="{ activeTabId: tid }">
                  <FolderTasksPane v-if="tid === 'tasks'" :folder-id="folderId" embedded @close="helperPane.close()" @view-room="handleTaskViewRoom" />
                </template>
              </FolderShellHelperPane>
            </ResizablePanel>
          </template>
        </ResizablePanelGroup>
      </template>
    </div>

    <FolderShellHelperPane v-if="!isDesktop && !isChatRoute" mobile :exclude-tabs="['podcast']">
      <template #default="{ activeTabId: tid }">
        <FolderTasksPane v-if="tid === 'tasks'" :folder-id="folderId" embedded @close="helperPane.close()" @view-room="handleTaskViewRoom" />
      </template>
    </FolderShellHelperPane>

    <UiAlertDialog v-model:open="showDeleteDialog">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>{{ deleteTargetIds.length > 1 ? 'Delete documents' : 'Delete document' }}</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            <template v-if="deleteTargetIds.length > 1">This will remove {{ deleteTargetIds.length }} documents and their indexed content.</template>
            <template v-else>Are you sure you want to delete {{ deleteTargetDocs[0]?.filename }}? This will remove the document and its indexed content.</template>
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
          <UiAlertDialogDescription>{{ deleteVoidDescription }}</UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel :disabled="deletingVoid">Cancel</UiAlertDialogCancel>
          <UiButton variant="destructive" :disabled="deletingVoid" @click="confirmDeleteVoid">
            {{ deletingVoid ? 'Deleting…' : 'Delete' }}
          </UiButton>
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

    <FoldersFolderFormModal v-model:open="folderEditOpen" mode="edit" :folder="folder" @deleted="router.replace('/')" />
    <FoldersFolderFormModal v-model:open="subfolderCreateOpen" mode="create" :parent-id="folderId" />
  </FolderShell>
</template>
