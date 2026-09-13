<script setup lang="ts">
import { TreeRoot, TreeItem } from 'reka-ui'
import { ChevronRight, Plus, MoreHorizontal, Pencil, Settings2, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { Doc, Id } from '~~/convex/_generated/dataModel'

interface FolderNode {
  _id: Id<'folders'>
  name: string
  color: string | undefined
  icon: string | undefined
  children: FolderNode[]
  depth: number
}

const props = defineProps<{
  folders: Doc<'folders'>[] | null
  activeFolder?: string | null
}>()

const emit = defineEmits<{
  select: [folderId: Id<'folders'>]
  newSubfolder: [parentId: Id<'folders'>]
  rename: [folderId: Id<'folders'>, name: string]
  delete: [folder: { _id: Id<'folders'>; name: string }]
  edit: [folder: Doc<'folders'>]
}>()

const expanded = ref<string[]>([])
const editingId = ref<Id<'folders'> | null>(null)
const editName = ref('')

const tree = computed<FolderNode[]>(() => {
  if (!props.folders) return []

  const byParent = new Map<string | undefined, Doc<'folders'>[]>()
  for (const f of props.folders) {
    const key = f.parentId ?? 'root'
    const list = byParent.get(key) ?? []
    list.push(f)
    byParent.set(key, list)
  }

  function build(parentId: string | undefined, depth: number): FolderNode[] {
    const items = byParent.get(parentId ?? 'root') ?? []
    return items.map((f) => ({
      _id: f._id,
      name: f.name,
      color: f.color,
      icon: f.icon,
      depth,
      children: build(f._id, depth + 1),
    }))
  }

  return build(undefined, 1)
})

function getKey(item: FolderNode) {
  return item._id
}

function getChildren(item: FolderNode) {
  return item.children.length > 0 ? item.children : undefined
}

function onSelect(item: FolderNode) {
  if (editingId.value === item._id) return
  emit('select', item._id)
  navigateTo(`/app/folders/${item._id}`)
}

function requestNewSubfolder(item: FolderNode) {
  emit('newSubfolder', item._id)
}

function startRename(item: FolderNode) {
  editingId.value = item._id
  editName.value = item.name
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-rename-input="${item._id}"]`)
    if (input) {
      input.focus()
      input.select()
    }
  })
}

function submitRename(folderId: Id<'folders'>) {
  if (editingId.value === null) return
  const trimmed = editName.value.trim()
  editingId.value = null
  editName.value = ''
  if (!trimmed || trimmed.length > 100) {
    toast.error('Folder name must be between 1 and 100 characters')
    return
  }
  emit('rename', folderId, trimmed)
}

function cancelRename() {
  if (editingId.value === null) return
  editingId.value = null
  editName.value = ''
}

function confirmDelete(item: FolderNode) {
  emit('delete', { _id: item._id, name: item.name })
}

function requestEdit(item: FolderNode) {
  cancelRename()
  const source = props.folders?.find((f) => f._id === item._id)
  if (source) emit('edit', source)
}
</script>

<template>
  <TreeRoot
    v-model:expanded="expanded"
    :items="tree"
    :get-key="getKey"
    :get-children="getChildren"
    class="w-full"
  >
    <template #default="{ flattenItems }">
      <div role="tree" class="space-y-0.5 px-2">
        <template v-for="item in flattenItems" :key="item._id">
        <UiContextMenu>
          <UiContextMenuTrigger as-child>
            <TreeItem
              v-slot="{ isExpanded }"
              :value="item.value"
              :level="item.level"
              :data-testid="`folder-tree-item-${item.value._id}`"
              class="group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring data-selected:bg-muted"
              :class="{ 'bg-muted': activeFolder && item.value._id === activeFolder }"
              :style="{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }"
              @click="onSelect(item.value)"
            >
              <ChevronRight
                v-if="item.hasChildren"
                class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform"
                :class="{ 'rotate-90': isExpanded }"
              />
              <span v-else class="w-3.5" />

              <FoldersFolderBadge
                :color="item.value.color ?? undefined"
                :icon="item.value.icon ?? undefined"
                size="sm"
              />

              <input
                v-if="editingId === item.value._id"
                v-model="editName"
                :data-rename-input="item.value._id"
                data-testid="folder-rename-input"
                autocapitalize="words"
                autocorrect="off"
                spellcheck="false"
                enterkeyhint="done"
                class="flex-1 rounded border bg-background px-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                @keydown.enter="submitRename(item.value._id)"
                @keydown.escape="cancelRename"
                @blur="cancelRename"
                @click.stop
              />
              <span v-else class="flex-1 truncate">{{ item.value.name }}</span>

              <UiDropdownMenu>
                <UiDropdownMenuTrigger as-child>
                  <button
                    :data-testid="`folder-actions-${item.value._id}`"
                    class="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover:flex group-focus-within:flex"
                    @click.stop
                  >
                    <MoreHorizontal class="h-3 w-3" />
                  </button>
                </UiDropdownMenuTrigger>
                <UiDropdownMenuContent side="right" align="start">
                  <UiDropdownMenuItem @select="startRename(item.value)">
                    <Pencil class="mr-2 h-4 w-4" /> Rename
                  </UiDropdownMenuItem>
                  <UiDropdownMenuItem
                    :data-testid="`folder-edit-${item.value._id}`"
                    @select="requestEdit(item.value)"
                  >
                    <Settings2 class="mr-2 h-4 w-4" /> Edit
                  </UiDropdownMenuItem>
                  <UiDropdownMenuItem v-if="item.value.depth < 3" @select="requestNewSubfolder(item.value)">
                    <Plus class="mr-2 h-4 w-4" /> New subfolder
                  </UiDropdownMenuItem>
                  <UiDropdownMenuItem class="text-destructive" @select="confirmDelete(item.value)">
                    <Trash2 class="mr-2 h-4 w-4" /> Delete
                  </UiDropdownMenuItem>
                </UiDropdownMenuContent>
              </UiDropdownMenu>
            </TreeItem>
          </UiContextMenuTrigger>
          <UiContextMenuContent>
            <UiContextMenuItem @select="startRename(item.value)">
              <Pencil class="mr-2 h-4 w-4" /> Rename
            </UiContextMenuItem>
            <UiContextMenuItem @select="requestEdit(item.value)">
              <Settings2 class="mr-2 h-4 w-4" /> Edit
            </UiContextMenuItem>
            <UiContextMenuItem v-if="item.value.depth < 3" @select="requestNewSubfolder(item.value)">
              <Plus class="mr-2 h-4 w-4" /> New subfolder
            </UiContextMenuItem>
            <UiContextMenuItem class="text-destructive" @select="confirmDelete(item.value)">
              <Trash2 class="mr-2 h-4 w-4" /> Delete
            </UiContextMenuItem>
          </UiContextMenuContent>
        </UiContextMenu>
        </template>
      </div>
    </template>
  </TreeRoot>
</template>
