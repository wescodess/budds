<script setup lang="ts">
import { X, FolderPlus, Search, Plus, Link as LinkIcon, Upload, Pencil } from 'lucide-vue-next'
import { onKeyStroke } from '@vueuse/core'
import { api } from '#convex/api'
import type { Doc, Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellHierarchyDrawer' })

const props = withDefaults(defineProps<{
  open?: boolean
  folderId: Id<'folders'>
  folder: Doc<'folders'> | null
  railWidth: number
  fullWidth?: boolean
  section?: 'knowledge' | 'members'
}>(), {
  open: false,
  section: 'knowledge',
})

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const { allFolders } = useFolders()
const { documents, uploadFiles, moveDocument, deleteDocuments, moveDocuments } = useDocuments(computed(() => props.folderId))
const { data: folderCounts } = useConvexQuery(api.documents.countsByFolder, computed(() => ({})))

const directCountByFolder = computed(() => {
  const map = new Map<string, number>()
  for (const c of folderCounts.value ?? []) map.set(c.folderId, c.count)
  return map
})

const totalCountByFolder = computed(() => {
  const all = allFolders.value ?? []
  const direct = directCountByFolder.value
  const childrenByParent = new Map<string, Doc<'folders'>[]>()
  for (const f of all) {
    const p = (f.parentId as unknown as string | undefined) ?? ''
    if (!p) continue
    if (!childrenByParent.has(p)) childrenByParent.set(p, [])
    childrenByParent.get(p)!.push(f)
  }
  const totals = new Map<string, number>()
  function walk(id: string): number {
    if (totals.has(id)) return totals.get(id)!
    let sum = direct.get(id) ?? 0
    for (const child of childrenByParent.get(id) ?? []) {
      sum += walk(child._id as unknown as string)
    }
    totals.set(id, sum)
    return sum
  }
  for (const f of all) walk(f._id as unknown as string)
  return totals
})

const panelRef = ref<HTMLElement | null>(null)
onKeyStroke('Escape', () => emit('close'))

const drawerShellStyle = computed<Record<string, string>>(() => ({
  '--drawer-target-width': props.fullWidth ? '90vw' : 'min(55vw, 90vw, 720px)',
  left: props.fullWidth ? '0px' : `${props.railWidth}px`,
  width: props.open ? 'var(--drawer-target-width)' : '0px',
}))

const drawerOverlayStyle = computed<Record<string, string>>(() => ({
  left: props.fullWidth ? '0px' : `${props.railWidth}px`,
}))

const drawerPanelStyle = computed<Record<string, string>>(() => ({
  width: 'var(--drawer-target-width)',
}))

const search = ref('')
const descendantFolders = computed(() => {
  const all = allFolders.value ?? []
  const rootId = props.folderId as unknown as string
  const childrenByParent = new Map<string, Doc<'folders'>[]>()
  for (const f of all) {
    const p = (f.parentId as unknown as string | undefined) ?? ''
    if (!p) continue
    if (!childrenByParent.has(p)) childrenByParent.set(p, [])
    childrenByParent.get(p)!.push(f)
  }
  const out: Doc<'folders'>[] = []
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    for (const child of childrenByParent.get(id) ?? []) {
      const cid = child._id as unknown as string
      if (seen.has(cid)) continue
      seen.add(cid)
      out.push(child)
      stack.push(cid)
    }
  }
  return out
})
const directChildren = computed(() => {
  const rootId = props.folderId as unknown as string
  return descendantFolders.value.filter(f => (f.parentId as unknown as string) === rootId)
})
const filteredFolders = computed(() => {
  const scoped = descendantFolders.value
  const q = search.value.trim().toLowerCase()
  if (!q) return scoped
  return scoped.filter(f => f.name.toLowerCase().includes(q))
})

const filteredDocs = computed(() => {
  const docs = documents.value ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return docs
  return docs.filter(d => d.filename.toLowerCase().includes(q))
})

const bulkMode = ref(false)
const selectedDocIds = ref<string[]>([])
const bulkActionPending = ref(false)

function clearSelectedDocs() {
  selectedDocIds.value = []
}

function exitBulkMode() {
  bulkMode.value = false
  clearSelectedDocs()
}

function toggleBulkMode(next: boolean) {
  if (!next) {
    exitBulkMode()
    return
  }
  if ((filteredDocs.value?.length ?? 0) === 0) return
  bulkMode.value = true
}

function toggleDocSelection(id: string) {
  if (!bulkMode.value) bulkMode.value = true
  const next = new Set(selectedDocIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedDocIds.value = [...next]
}

function selectAllVisibleDocs() {
  selectedDocIds.value = filteredDocs.value.map(doc => String(doc._id))
}

watch(
  () => filteredDocs.value.map(doc => String(doc._id)),
  (visibleIds) => {
    const visible = new Set(visibleIds)
    const pruned = selectedDocIds.value.filter(id => visible.has(id))
    if (pruned.length !== selectedDocIds.value.length) selectedDocIds.value = pruned
    if (visibleIds.length === 0 && bulkMode.value) exitBulkMode()
  },
  { immediate: true },
)

watch(
  () => [props.folderId, props.section, props.open] as const,
  () => exitBulkMode(),
)

function selectFolder(id: Id<'folders'>) {
  if (id === props.folderId) return
  void router.push(`/app/folders/${id}`)
}

const breadcrumb = computed(() => {
  const all = allFolders.value ?? []
  const byId = new Map(all.map(f => [f._id as string, f]))
  const chain: Doc<'folders'>[] = []
  let cur = props.folder ?? byId.get(props.folderId as unknown as string) ?? null
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur._id as unknown as string)) break
    seen.add(cur._id as unknown as string)
    chain.unshift(cur)
    cur = cur.parentId ? (byId.get(cur.parentId as unknown as string) ?? null) : null
  }
  return chain
})

const showFolderModal = ref(false)
const folderModalMode = ref<'create' | 'edit'>('create')
const editingFolder = ref<Doc<'folders'> | null>(null)
const folderModalParentId = ref<Id<'folders'> | null>(null)

function openNewFolder(parentId: Id<'folders'> | null = null) {
  folderModalMode.value = 'create'
  editingFolder.value = null
  folderModalParentId.value = parentId
  showFolderModal.value = true
}

function onRenameFolder(f: Doc<'folders'>) {
  folderModalMode.value = 'edit'
  editingFolder.value = f
  folderModalParentId.value = null
  showFolderModal.value = true
}

const { deleteFolder } = useFolders()
const showDeleteFolder = ref(false)
const folderToDelete = ref<Doc<'folders'> | null>(null)

function onDeleteFolderRequest(f: Doc<'folders'>) {
  folderToDelete.value = f
  showDeleteFolder.value = true
}
async function confirmDeleteFolder() {
  const f = folderToDelete.value
  showDeleteFolder.value = false
  folderToDelete.value = null
  if (!f) return
  try {
    await deleteFolder(f._id)
    const { toast } = await import('vue-sonner')
    toast.success('Folder deleted')
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to delete folder')
  }
}

const deleteTargetIds = ref<string[]>([])
const showDeleteDoc = computed({
  get: () => deleteTargetIds.value.length > 0,
  set: (v: boolean) => { if (!v) deleteTargetIds.value = [] },
})
function onDeleteDoc(id: string) { deleteTargetIds.value = [id] }
function onDeleteSelectedDocs() {
  if (selectedDocIds.value.length === 0 || bulkActionPending.value) return
  deleteTargetIds.value = [...selectedDocIds.value]
}
async function confirmDeleteDocs() {
  const ids = [...deleteTargetIds.value]
  showDeleteDoc.value = false
  deleteTargetIds.value = []
  if (ids.length === 0 || bulkActionPending.value) return
  bulkActionPending.value = true
  try {
    const { deletedCount, failedIds, failureMessages } = await deleteDocuments(ids as Id<'documents'>[])
    const { toast } = await import('vue-sonner')

    if (deletedCount > 0) {
      toast.success(deletedCount === 1 ? 'Document deleted' : `${deletedCount} documents deleted`)
    }
    if (failureMessages.length > 0) {
      toast.error(failureMessages[0] || 'Failed to delete selected documents')
    }

    selectedDocIds.value = failedIds.map(id => String(id))
    if (failedIds.length === 0 && bulkMode.value) exitBulkMode()
  } finally {
    bulkActionPending.value = false
  }
}

const moveTargetIds = ref<string[]>([])
const movePending = ref(false)
const showMoveDialog = computed({
  get: () => moveTargetIds.value.length > 0,
  set: (v: boolean) => { if (!v) moveTargetIds.value = [] },
})
function onMoveDoc(id: string) { moveTargetIds.value = [id] }
function onMoveSelectedDocs() {
  if (selectedDocIds.value.length === 0 || movePending.value) return
  moveTargetIds.value = [...selectedDocIds.value]
}
async function confirmMove(destId: Id<'folders'>) {
  if (moveTargetIds.value.length === 0 || movePending.value) return
  movePending.value = true
  try {
    const ids = [...moveTargetIds.value]
    const isBulk = ids.length > 1
    const { toast } = await import('vue-sonner')

    if (isBulk) {
      const { movedCount, failedIds, failureMessages } = await moveDocuments(ids as Id<'documents'>[], destId)
      if (movedCount > 0) {
        toast.success(movedCount === 1 ? 'Moved' : `${movedCount} documents moved`)
      }
      if (failureMessages.length > 0) {
        toast.error(failureMessages[0] || 'Failed to move selected documents')
      }
      selectedDocIds.value = failedIds.map(id => String(id))
      if (failedIds.length === 0 && bulkMode.value) exitBulkMode()
    } else {
      await moveDocument(ids[0] as Id<'documents'>, destId)
      toast.success('Moved')
      if (bulkMode.value) exitBulkMode()
    }
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to move')
  } finally {
    movePending.value = false
    moveTargetIds.value = []
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
function triggerUpload() { fileInput.value?.click() }
async function onFiles(e: Event) {
  const t = e.target as HTMLInputElement
  const files = Array.from(t.files ?? [])
  if (files.length > 0) {
    try {
      await uploadFiles(files, props.folderId)
      const { toast } = await import('vue-sonner')
      toast.success(files.length === 1 ? 'Document indexed' : `${files.length} documents indexed`)
    }
    catch (err: any) {
      const { toast } = await import('vue-sonner')
      toast.error(err?.message || 'Upload failed')
    }
  }
  t.value = ''
}
</script>

<template>
  <div
    :class="[
      'pointer-events-none fixed inset-0',
      fullWidth ? 'z-40' : 'z-20',
    ]"
    data-testid="folder-drawer-root"
    :aria-hidden="props.open ? 'false' : 'true'"
  >
    <div
      :class="[
        'absolute inset-y-0 right-0 bg-black/45 backdrop-blur-[3px] transition-opacity duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
        props.open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      ]"
      :style="drawerOverlayStyle"
      @click="emit('close')"
    />
    <div
      :class="[
        'absolute top-0 h-full overflow-hidden transition-[left,width] duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
        props.open ? 'pointer-events-auto' : 'pointer-events-none',
      ]"
      :style="drawerShellStyle"
    >
      <aside
        ref="panelRef"
        data-testid="folder-drawer"
        class="absolute inset-y-0 left-0 flex h-full flex-col border-r border-border/60 bg-card shadow-2xl"
        :style="drawerPanelStyle"
      >
        <span class="absolute left-0 top-0 h-2/5 w-0.5 bg-primary/80" />

      <header class="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div class="min-w-0">
          <p class="text-[10px] uppercase tracking-widest text-muted-foreground">
            {{ section === 'members' ? 'Collaboration' : 'Folder hierarchy' }}
          </p>
          <div
            v-if="section === 'knowledge'"
            class="mt-1 flex min-w-0 items-center truncate text-xs text-muted-foreground"
          >
            <template v-for="(f, i) in breadcrumb" :key="f._id">
              <span v-if="i > 0" class="mx-1 shrink-0">›</span>
              <button
                type="button"
                :disabled="f._id === folderId"
                :class="[
                  'truncate rounded px-1 transition',
                  f._id === folderId
                    ? 'cursor-default text-lg font-semibold text-foreground'
                    : 'hover:bg-muted hover:text-foreground',
                ]"
                @click="selectFolder(f._id)"
              >
                {{ f.name }}
              </button>
            </template>
          </div>
          <h2 v-if="section === 'members'" class="truncate text-lg font-semibold text-foreground">
            Members
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <UiButton
            v-if="section === 'knowledge' && folder"
            variant="ghost"
            size="icon"
            class="text-primary hover:text-primary"
            aria-label="Edit folder"
            @click="onRenameFolder(folder)"
          >
            <Pencil class="h-4 w-4" />
          </UiButton>
          <UiButton
            v-if="section === 'knowledge'"
            variant="ghost"
            size="icon"
            class="text-primary hover:text-primary"
            aria-label="New subfolder"
            @click="openNewFolder(folderId)"
          >
            <FolderPlus class="h-4 w-4" />
          </UiButton>
          <UiKbd class="hidden md:inline-flex">⌘B</UiKbd>
          <button
            class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close drawer"
            data-testid="folder-drawer-close"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </header>

      <template v-if="section === 'knowledge'">
      <div class="px-5 pt-3">
        <div class="relative">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="search"
            type="text"
            placeholder="Search folders & files…"
            class="h-10 w-full rounded-lg border border-border/60 bg-background/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </div>

      <section class="mt-3 flex min-h-0 flex-col px-3">
        <div class="flex items-center justify-between px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Subfolders</span>
        </div>
        <div class="max-h-[65%] min-h-60 overflow-y-auto pr-1">
          <FolderShellTree
            v-if="directChildren.length > 0"
            :folders="filteredFolders"
            :active-id="folderId"
            :root-parent-id="folderId"
            :direct-counts="directCountByFolder"
            :total-counts="totalCountByFolder"
            @select="selectFolder"
            @rename="onRenameFolder"
            @delete="onDeleteFolderRequest"
            @new-subfolder="(pid) => openNewFolder(pid)"
          />
          <div
            v-else
            class="mx-2 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center"
          >
            <p class="text-sm font-medium text-foreground">No subfolders yet</p>
            <p class="text-xs text-muted-foreground">Organize this folder by adding a subfolder or files.</p>
            <div class="mt-1 flex items-center gap-2">
              <UiButton size="sm" variant="secondary" class="gap-1.5" @click="openNewFolder(folderId)">
                <FolderPlus class="h-3.5 w-3.5" /> New subfolder
              </UiButton>
              <UiButton size="sm" variant="ghost" class="gap-1.5 text-primary hover:text-primary" @click="triggerUpload">
                <Upload class="h-3.5 w-3.5" /> Add files
              </UiButton>
            </div>
          </div>
        </div>
      </section>

      <div class="mx-5 my-3 border-t border-border/60" />

      <section class="flex items-center justify-between gap-2 px-5 pb-2 text-xs">
        <div class="flex min-w-0 items-center gap-1 text-muted-foreground">
          <span class="shrink-0">Files</span>
          <span class="ml-1.5 shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {{ directCountByFolder.get(folderId as unknown as string) ?? 0 }}
          </span>
        </div>
        <UiDropdownMenu>
          <UiDropdownMenuTrigger as-child>
            <UiButton variant="ghost" size="sm" class="gap-1 text-primary hover:text-primary">
              <Plus class="h-3.5 w-3.5" />
              Add files
            </UiButton>
          </UiDropdownMenuTrigger>
          <UiDropdownMenuContent align="end" class="w-44">
            <UiDropdownMenuItem disabled>
              <LinkIcon class="mr-2 h-4 w-4" /> From link
            </UiDropdownMenuItem>
            <UiDropdownMenuItem @click="triggerUpload">
              <Upload class="mr-2 h-4 w-4" /> From computer
            </UiDropdownMenuItem>
          </UiDropdownMenuContent>
        </UiDropdownMenu>
        <input ref="fileInput" type="file" multiple class="hidden" @change="onFiles">
      </section>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <FolderShellFilesPanel
          :documents="filteredDocs"
          :bulk-mode="bulkMode"
          :selected-ids="selectedDocIds"
          :pending="bulkActionPending || movePending"
          @delete="onDeleteDoc"
          @move="onMoveDoc"
          @open="() => undefined"
          @rename="() => undefined"
          @download="() => undefined"
          @toggle-bulk-mode="toggleBulkMode"
          @select-all="selectAllVisibleDocs"
          @clear-selection="clearSelectedDocs"
          @bulk-move="onMoveSelectedDocs"
          @bulk-delete="onDeleteSelectedDocs"
          @toggle-select="toggleDocSelection"
        />
      </div>

      </template>

      <template v-else-if="section === 'members'">
        <FolderShellMembersPanel :folder="folder" />
      </template>

      </aside>
    </div>

    <FoldersFolderFormModal
      v-model:open="showFolderModal"
      :mode="folderModalMode"
      :folder="editingFolder"
      :parent-id="folderModalParentId ?? undefined"
    />

    <UiAlertDialog v-model:open="showDeleteFolder">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>Delete folder</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            Delete "{{ folderToDelete?.name }}" and all contents inside?
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
          <UiButton variant="destructive" @click="confirmDeleteFolder">Delete</UiButton>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>

    <UiAlertDialog v-model:open="showDeleteDoc">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>{{ deleteTargetIds.length > 1 ? 'Delete documents' : 'Delete document' }}</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            This will remove {{ deleteTargetIds.length > 1 ? `${deleteTargetIds.length} documents` : 'the document' }} and its indexed content.
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
          <UiButton variant="destructive" :disabled="bulkActionPending" @click="confirmDeleteDocs">Delete</UiButton>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>

    <UiDialog v-model:open="showMoveDialog">
      <UiDialogContent>
        <UiDialogHeader>
          <UiDialogTitle>Move to folder</UiDialogTitle>
          <UiDialogDescription>Choose a destination folder.</UiDialogDescription>
        </UiDialogHeader>
        <div class="max-h-64 space-y-1 overflow-y-auto py-2">
          <button
            v-for="f in allFolders ?? []"
            :key="f._id"
            :disabled="f._id === folderId || movePending"
            class="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            @click="confirmMove(f._id)"
          >
            {{ f.name }}
          </button>
        </div>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
