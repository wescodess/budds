<script setup lang="ts">
import type { Id, Doc } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellTree' })

type F = Doc<'folders'>

const props = withDefaults(defineProps<{
  folders: F[]
  activeId?: Id<'folders'> | null
  selectedId?: Id<'folders'> | null
  initiallyExpandPath?: boolean
  rootParentId?: Id<'folders'> | null
  directCounts?: Map<string, number>
  totalCounts?: Map<string, number>
  disabledIds?: string[]
  showActions?: boolean
  countMode?: 'documents' | 'subfolders' | 'none'
  expandRootsInitially?: boolean
}>(), {
  activeId: null,
  selectedId: null,
  initiallyExpandPath: true,
  rootParentId: null,
  disabledIds: () => [],
  showActions: true,
  countMode: 'documents',
  expandRootsInitially: false,
})

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

const roots = computed(() => {
  const key = (props.rootParentId as string | null | undefined) ?? null
  return byParent.value.get(key) ?? []
})

const ancestorIds = computed(() => {
  const ids = new Set<string>()
  if (!props.activeId) return ids
  const byId = new Map(props.folders.map(f => [f._id as string, f]))
  let cur = byId.get(props.activeId as unknown as string)
  while (cur?.parentId) {
    ids.add(cur.parentId as unknown as string)
    cur = byId.get(cur.parentId as unknown as string)
  }
  return ids
})

const expanded = ref(new Set<string>())
const seededRootIds = ref(new Set<string>())

watchEffect(() => {
  if (!props.initiallyExpandPath) return
  const next = new Set(expanded.value)
  let changed = false
  for (const id of ancestorIds.value) {
    if (next.has(id)) continue
    next.add(id)
    changed = true
  }
  if (changed) expanded.value = next
})

watch(roots, (items) => {
  if (!props.expandRootsInitially) return
  const next = new Set(expanded.value)
  let changed = false

  for (const folder of items) {
    const id = folder._id as unknown as string
    if (seededRootIds.value.has(id)) continue
    seededRootIds.value.add(id)
    if ((byParent.value.get(id)?.length ?? 0) === 0) continue
    next.add(id)
    changed = true
  }

  if (changed) expanded.value = next
}, { immediate: true })

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
      :active-id="activeId ?? null"
      :selected-id="selectedId ?? null"
      :expanded="expanded"
      :depth="0"
      :direct-counts="directCounts"
      :total-counts="totalCounts"
      :disabled-ids="disabledIds"
      :show-actions="showActions"
      :count-mode="countMode"
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
