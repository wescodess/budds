<script setup lang="ts">
import { X, FolderPlus, Search, Plus, Link as LinkIcon, Upload } from 'lucide-vue-next'
import { onClickOutside, onKeyStroke } from '@vueuse/core'
import type { Doc, Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellHierarchyDrawer' })

const props = withDefaults(defineProps<{
  folderId: Id<'folders'>
  folder: Doc<'folders'> | null
  railWidth: number
  fullWidth?: boolean
  section?: 'knowledge' | 'members'
}>(), { section: 'knowledge' })

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const { allFolders } = useFolders()
const { documents, uploadFiles, deleteDocument, moveDocument } = useDocuments(computed(() => props.folderId))

const panelRef = ref<HTMLElement | null>(null)
onClickOutside(panelRef, () => emit('close'))
onKeyStroke('Escape', () => emit('close'))

const search = ref('')
const filteredFolders = computed(() => {
  const all = allFolders.value ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return all
  return all.filter(f => f.name.toLowerCase().includes(q))
})

const filteredDocs = computed(() => {
  const docs = documents.value ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return docs
  return docs.filter(d => d.filename.toLowerCase().includes(q))
})

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

const showDeleteDoc = ref(false)
const docToDelete = ref<string | null>(null)
function onDeleteDoc(id: string) { docToDelete.value = id; showDeleteDoc.value = true }
async function confirmDeleteDoc() {
  const id = docToDelete.value
  showDeleteDoc.value = false
  docToDelete.value = null
  if (!id) return
  try {
    await deleteDocument(id as Id<'documents'>)
    const { toast } = await import('vue-sonner')
    toast.success('Document deleted')
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to delete document')
  }
}

const moveTargetId = ref<string | null>(null)
const movePending = ref(false)
const showMoveDialog = computed({
  get: () => moveTargetId.value !== null,
  set: (v: boolean) => { if (!v) moveTargetId.value = null },
})
function onMoveDoc(id: string) { moveTargetId.value = id }
async function confirmMove(destId: Id<'folders'>) {
  if (!moveTargetId.value || movePending.value) return
  movePending.value = true
  try {
    await moveDocument(moveTargetId.value as Id<'documents'>, destId)
    const { toast } = await import('vue-sonner')
    toast.success('Moved')
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to move')
  } finally {
    movePending.value = false
    moveTargetId.value = null
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
function triggerUpload() { fileInput.value?.click() }
async function onFiles(e: Event) {
  const t = e.target as HTMLInputElement
  const files = Array.from(t.files ?? [])
  if (files.length > 0) {
    try { await uploadFiles(files, props.folderId) }
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
    class="pointer-events-auto fixed inset-0 z-40"
    data-testid="folder-drawer-root"
  >
    <div
      class="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
      :style="!fullWidth ? { left: railWidth + 'px' } : undefined"
      @click="emit('close')"
    />
    <aside
      ref="panelRef"
      data-testid="folder-drawer"
      class="absolute top-0 flex h-full flex-col border-r border-border/60 bg-card shadow-2xl"
      :style="fullWidth
        ? { left: '0px', width: '100vw' }
        : { left: railWidth + 'px', width: 'min(55vw, 720px)' }"
    >
      <span class="absolute left-0 top-0 h-2/5 w-0.5 bg-primary/80" />

      <header class="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div class="min-w-0">
          <p class="text-[10px] uppercase tracking-widest text-muted-foreground">
            {{ section === 'members' ? 'Collaboration' : 'Folder hierarchy' }}
          </p>
          <h2 class="truncate text-lg font-semibold text-foreground">
            {{ section === 'members' ? 'Members' : (folder?.name ?? 'My folder') }}
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <UiButton v-if="section === 'knowledge'" variant="ghost" size="sm" class="gap-1.5 text-primary hover:text-primary" @click="openNewFolder(null)">
            <FolderPlus class="h-4 w-4" />
            New folder
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
          <span>Folders</span>
        </div>
        <div class="max-h-[45%] overflow-y-auto pr-1">
          <FolderShellTree
            :folders="filteredFolders"
            :active-id="folderId"
            @select="selectFolder"
            @rename="onRenameFolder"
            @delete="onDeleteFolderRequest"
            @new-subfolder="(pid) => openNewFolder(pid)"
          />
        </div>
      </section>

      <div class="mx-5 my-3 border-t border-border/60" />

      <section class="flex items-center justify-between px-5 pb-2 text-xs">
        <div class="flex min-w-0 items-center gap-1 text-muted-foreground">
          <span>Files in</span>
          <span class="mx-1">›</span>
          <span class="truncate font-medium text-primary">{{ folder?.name ?? '…' }}</span>
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
          @delete="onDeleteDoc"
          @move="onMoveDoc"
          @open="() => undefined"
          @rename="() => undefined"
          @download="() => undefined"
        />
      </div>

      </template>

      <template v-else-if="section === 'members'">
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderPlus class="h-5 w-5" />
          </div>
          <p class="text-sm font-medium text-foreground">Invite collaborators</p>
          <p class="max-w-xs text-xs text-muted-foreground">
            Members management is coming soon. You'll be able to invite teammates and manage access here.
          </p>
        </div>
      </template>

      <footer class="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3 text-xs">
        <div class="min-w-0 truncate text-muted-foreground">
          <template v-for="(f, i) in breadcrumb" :key="f._id">
            <span v-if="i > 0" class="mx-1">›</span>
            <span :class="f._id === folderId ? 'font-medium text-primary' : ''">{{ f.name }}</span>
          </template>
        </div>
        <UiButton variant="ghost" size="sm" class="gap-1 text-primary hover:text-primary" @click="emit('close')">
          Open folder →
        </UiButton>
      </footer>
    </aside>

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
          <UiAlertDialogTitle>Delete document</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            This will remove the document and its indexed content.
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
          <UiButton variant="destructive" @click="confirmDeleteDoc">Delete</UiButton>
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
