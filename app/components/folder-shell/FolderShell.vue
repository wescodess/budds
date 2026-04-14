<script setup lang="ts">
import { useLocalStorage, useMagicKeys, whenever, useMediaQuery } from '@vueuse/core'
import type { Id } from '~~/convex/_generated/dataModel'
import type { Doc } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShell' })

const props = defineProps<{
  folderId: Id<'folders'>
  folder: Doc<'folders'> | null
  activeTab: 'chat' | 'flashcards' | 'quiz' | 'documents'
}>()

const emit = defineEmits<{
  'update:activeTab': [value: 'chat' | 'flashcards' | 'quiz' | 'documents']
  'new-void': []
}>()

const drawerOpen = useLocalStorage('g3.drawer.open', false)
const drawerSection = useLocalStorage<'knowledge' | 'members'>('g3.drawer.section', 'knowledge')
const isDesktop = useMediaQuery('(min-width: 1024px)')

const keys = useMagicKeys()
const toggleKey = computed(() => Boolean(keys['Meta+B']?.value || keys['Ctrl+B']?.value))
whenever(toggleKey, () => { drawerOpen.value = !drawerOpen.value })

function closeDrawer() { drawerOpen.value = false }
function toggleDrawer() { drawerOpen.value = !drawerOpen.value }
function openDrawerSection(section: 'knowledge' | 'members') {
  if (drawerOpen.value && drawerSection.value === section) {
    drawerOpen.value = false
    return
  }
  drawerSection.value = section
  drawerOpen.value = true
}

function onTabChange(tab: 'chat' | 'flashcards' | 'quiz' | 'documents') {
  emit('update:activeTab', tab)
}
</script>

<template>
  <div class="relative flex h-screen overflow-hidden">
    <FolderShellRail
      :folder="folder"
      :folder-id="folderId"
      :active-tab="activeTab"
      :compact="!isDesktop"
      :drawer-section="drawerOpen ? drawerSection : null"
      @update:active-tab="onTabChange"
      @open-drawer="openDrawerSection"
      @new-void="emit('new-void')"
    />

    <div class="relative flex flex-1 flex-col overflow-hidden">
      <slot name="top-bar" :drawer-open="drawerOpen" :toggle-drawer="toggleDrawer" />
      <div class="flex-1 overflow-hidden">
        <slot />
      </div>
    </div>

    <FolderShellHierarchyDrawer
      v-if="drawerOpen"
      :folder-id="folderId"
      :folder="folder"
      :rail-width="isDesktop ? 240 : 64"
      :full-width="!isDesktop"
      :section="drawerSection"
      @close="closeDrawer"
    />
  </div>
</template>
