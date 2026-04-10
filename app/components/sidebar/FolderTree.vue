<script setup lang="ts">
import { TreeRoot, TreeItem } from 'reka-ui'
import { ChevronRight, FolderOpen, Folder } from 'lucide-vue-next'
import type { Doc, Id } from '~~/convex/_generated/dataModel'

interface FolderNode {
  _id: Id<'folders'>
  name: string
  children: FolderNode[]
}

const props = defineProps<{
  folders: Doc<'folders'>[] | null
}>()

const emit = defineEmits<{
  select: [folderId: Id<'folders'>]
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

  function build(parentId: string | undefined): FolderNode[] {
    const items = byParent.get(parentId ?? 'root') ?? []
    return items.map((f) => ({
      _id: f._id,
      name: f.name,
      children: build(f._id),
    }))
  }

  return build(undefined)
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
          class="group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring data-[selected]:bg-muted"
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

          <span class="truncate">{{ item.value.name }}</span>
        </TreeItem>
      </div>
    </template>
  </TreeRoot>
</template>
