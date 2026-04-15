<script setup lang="ts">
import { onLongPress } from '@vueuse/core'
import { ChevronRight, Folder, MoreHorizontal, Pencil, FolderPlus, Trash2 } from 'lucide-vue-next'
import type { Id, Doc } from '~~/convex/_generated/dataModel'
import { LONG_PRESS_MOVE_PX, LONG_PRESS_MS, useGestureGuards } from '~/composables/useGestureGuards'

defineOptions({ name: 'FolderShellTreeNode' })

type F = Doc<'folders'>

const props = defineProps<{
  folder: F
  childrenOf: (id: string) => F[]
  activeId?: Id<'folders'> | null
  selectedId?: Id<'folders'> | null
  expanded: Set<string>
  depth: number
  directCounts?: Map<string, number>
  totalCounts?: Map<string, number>
  disabledIds?: string[]
  showActions?: boolean
  countMode?: 'documents' | 'subfolders' | 'none'
}>()

const emit = defineEmits<{
  toggle: [id: string]
  select: [id: Id<'folders'>]
  rename: [folder: F]
  delete: [folder: F]
  'new-subfolder': [parentId: Id<'folders'>]
}>()

const kids = computed(() => props.childrenOf(props.folder._id as unknown as string))
const isOpen = computed(() => props.expanded.has(props.folder._id as unknown as string))
const isActive = computed(() => props.folder._id === props.activeId)
const isSelected = computed(() => props.folder._id === props.selectedId)
const isDisabled = computed(() => (props.disabledIds ?? []).includes(props.folder._id as unknown as string))
const hasKids = computed(() => kids.value.length > 0)
const folderKey = computed(() => props.folder._id as unknown as string)
const directCount = computed(() => props.directCounts?.get(folderKey.value) ?? 0)
const totalCount = computed(() => props.totalCounts?.get(folderKey.value) ?? directCount.value)
const subfolderCount = computed(() => kids.value.length)
const childConnectorStyle = computed(() => ({
  left: `${13 + (props.depth + 1) * 16}px`,
}))
const countLabel = computed(() => {
  if (props.countMode === 'none') return ''
  if (props.countMode === 'subfolders') return String(subfolderCount.value)
  if (hasKids.value && totalCount.value !== directCount.value) {
    return `${directCount.value} / ${totalCount.value}`
  }
  return String(directCount.value)
})
const countTitle = computed(() => {
  if (props.countMode === 'none') return undefined
  if (props.countMode === 'subfolders') {
    return subfolderCount.value === 1 ? '1 subfolder' : `${subfolderCount.value} subfolders`
  }
  if (hasKids.value) return `${directCount.value} here, ${totalCount.value} with subfolders`
  return `${directCount.value} files`
})
const rowRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const suppressNextSelect = ref(false)
const { isTouchLike } = useGestureGuards()

function handleSelect() {
  if (isDisabled.value) return
  if (suppressNextSelect.value) {
    suppressNextSelect.value = false
    return
  }

  emit('select', props.folder._id)
}

onLongPress(
  rowRef,
  () => {
    if (!isTouchLike.value) return
    menuOpen.value = true
  },
  {
    delay: LONG_PRESS_MS,
    distanceThreshold: LONG_PRESS_MOVE_PX,
    onMouseUp(_duration, _distance, isLongPress) {
      suppressNextSelect.value = isLongPress
    },
  },
)
</script>

<template>
  <div>
    <div
      ref="rowRef"
      :class="[
        'group relative flex items-center gap-1 rounded-md pr-1 text-sm transition',
        isDisabled
          ? 'cursor-not-allowed opacity-50'
          : isSelected
            ? 'bg-primary/15 text-foreground ring-1 ring-primary/20'
            : isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      ]"
      :style="{ paddingLeft: `${4 + depth * 16}px` }"
      :data-active="isActive ? 'true' : 'false'"
      :data-selected="isSelected ? 'true' : 'false'"
      :data-disabled="isDisabled ? 'true' : 'false'"
      :data-testid="`tree-node-${folder._id}`"
    >
      <span
        v-if="isActive"
        class="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-0.5 rounded-r bg-primary"
      />
      <button
        type="button"
        class="relative -mx-1 -my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md sm:mx-0 sm:my-0 sm:h-7 sm:w-6"
        :class="!hasKids && 'invisible'"
        :aria-label="isOpen ? 'Collapse' : 'Expand'"
        @click.stop="emit('toggle', folder._id as unknown as string)"
      >
        <ChevronRight :class="['h-4 w-4 transition sm:h-3.5 sm:w-3.5', isOpen && 'rotate-90']" />
      </button>
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        :data-testid="`tree-node-select-${folder._id}`"
        :disabled="isDisabled"
        @click="handleSelect"
      >
        <Folder :class="['h-3.5 w-3.5 shrink-0', isActive || isSelected ? 'text-primary' : 'text-muted-foreground']" />
        <span class="truncate">{{ folder.name }}</span>
        <span
          v-if="props.countMode !== 'none'"
          :title="countTitle"
          class="ml-auto shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {{ countLabel }}
        </span>
      </button>
      <UiDropdownMenu v-if="showActions" v-model:open="menuOpen">
        <UiDropdownMenuTrigger as-child>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
            :data-testid="`tree-kebab-${folder._id}`"
            @click.stop
          >
            <MoreHorizontal class="h-3.5 w-3.5" />
          </button>
        </UiDropdownMenuTrigger>
        <UiDropdownMenuContent align="end" class="w-40">
          <UiDropdownMenuItem @click="emit('rename', folder)">
            <Pencil class="mr-2 h-4 w-4" /> Edit details
          </UiDropdownMenuItem>
          <UiDropdownMenuItem @click="emit('new-subfolder', folder._id)">
            <FolderPlus class="mr-2 h-4 w-4" /> New subfolder
          </UiDropdownMenuItem>
          <UiDropdownMenuSeparator />
          <UiDropdownMenuItem class="text-destructive focus:text-destructive" @click="emit('delete', folder)">
            <Trash2 class="mr-2 h-4 w-4" /> Delete
          </UiDropdownMenuItem>
        </UiDropdownMenuContent>
      </UiDropdownMenu>
    </div>
    <div v-if="isOpen && hasKids" class="relative mt-0.5 space-y-0.5">
      <span
        class="pointer-events-none absolute inset-y-0 w-px rounded-full bg-border/80"
        :style="childConnectorStyle"
      />
      <FolderShellTreeNode
        v-for="child in kids"
        :key="child._id"
        :folder="child"
        :children-of="childrenOf"
        :active-id="activeId"
        :selected-id="selectedId"
        :expanded="expanded"
        :depth="depth + 1"
        :direct-counts="directCounts"
        :total-counts="totalCounts"
        :disabled-ids="disabledIds"
        :show-actions="showActions"
        :count-mode="countMode"
        @toggle="(id) => emit('toggle', id)"
        @select="(id) => emit('select', id)"
        @rename="(f) => emit('rename', f)"
        @delete="(f) => emit('delete', f)"
        @new-subfolder="(pid) => emit('new-subfolder', pid)"
      />
    </div>
  </div>
</template>
