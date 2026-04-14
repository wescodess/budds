<script setup lang="ts">
import { ChevronRight, Folder, MoreHorizontal, Pencil, FolderInput, Trash2 } from 'lucide-vue-next'
import type { Id, Doc } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellTree' })

type F = Doc<'folders'>

const props = defineProps<{
  folders: F[]
  activeId: Id<'folders'>
  initiallyExpandPath?: boolean
}>()

const emit = defineEmits<{
  'select': [id: Id<'folders'>]
  'rename': [folder: F]
  'delete': [folder: F]
  'new-subfolder': [parentId: Id<'folders'>]
}>()

const byParent = computed(() => {
  const map = new Map<string | null, F[]>()
  for (const f of props.folders) {
    const key = (f.parentId as string | undefined | null) ?? null
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name))
  return map
})

const roots = computed(() => byParent.value.get(null) ?? [])

const ancestorIds = computed(() => {
  const ids = new Set<string>()
  const byId = new Map(props.folders.map(f => [f._id as string, f]))
  let cur = byId.get(props.activeId as unknown as string)
  while (cur?.parentId) {
    ids.add(cur.parentId as unknown as string)
    cur = byId.get(cur.parentId as unknown as string)
  }
  return ids
})

const expanded = ref(new Set<string>())
watchEffect(() => {
  for (const id of ancestorIds.value) expanded.value.add(id)
})

function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}

function childrenOf(id: string): F[] {
  return byParent.value.get(id) ?? []
}
</script>

<template>
  <div class="space-y-0.5" data-testid="folder-tree">
    <FolderShellTreeNode
      v-for="f in roots"
      :key="f._id"
      :folder="f"
      :children-of="childrenOf"
      :active-id="activeId"
      :expanded="expanded"
      :depth="0"
      @toggle="toggle"
      @select="(id) => emit('select', id)"
      @rename="(folder) => emit('rename', folder)"
      @delete="(folder) => emit('delete', folder)"
      @new-subfolder="(parentId) => emit('new-subfolder', parentId)"
    />
    <div v-if="roots.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
      No folders yet
    </div>
  </div>
</template>
