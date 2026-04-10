<script setup lang="ts">
import { TreeRoot, TreeItem } from 'reka-ui'
import { ChevronRight, FolderOpen, Folder, Plus } from 'lucide-vue-next'
import type { Doc, Id } from '~~/convex/_generated/dataModel'

interface FolderNode {
  _id: Id<'folders'>
  name: string
  children: FolderNode[]
  depth: number
}

const props = defineProps<{
  folders: Doc<'folders'>[] | null
  activeFolder?: string | null
}>()

const emit = defineEmits<{
  select: [folderId: Id<'folders'>]
  createSubfolder: [parentId: Id<'folders'>]
}>()

const expanded = ref<string[]>([])

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
  emit('select', item._id)
  navigateTo(`/app/folders/${item._id}`)
}

function onAddSubfolder(e: Event, item: FolderNode) {
  e.stopPropagation()
  emit('createSubfolder', item._id)
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
        <TreeItem
          v-for="item in flattenItems"
          :key="item._id"
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

          <FolderOpen
            v-if="isExpanded"
            class="h-4 w-4 shrink-0 text-primary"
          />
          <Folder
            v-else
            class="h-4 w-4 shrink-0 text-muted-foreground"
          />

          <span class="flex-1 truncate">{{ item.value.name }}</span>

          <button
            v-if="item.value.depth < 3"
            :data-testid="`add-subfolder-${item.value._id}`"
            class="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover:flex group-focus-within:flex"
            @click="onAddSubfolder($event, item.value)"
          >
            <Plus class="h-3 w-3" />
          </button>
        </TreeItem>
      </div>
    </template>
  </TreeRoot>
</template>
