<script setup lang="ts">
import { useMagicKeys, whenever } from '@vueuse/core'
import type { Id } from '~~/convex/_generated/dataModel'
import type { Doc } from '~~/convex/_generated/dataModel'
import { getColor, DEFAULT_COLOR_KEY } from '~~/convex/folderPalette'

defineOptions({ name: 'FolderShell' })

const props = defineProps<{
  folderId: Id<'folders'>
  folder: Doc<'folders'> | null
  activeTab: 'chat' | 'flashcards' | 'quiz' | 'documents'
  activeConversationId?: string | null
}>()

const emit = defineEmits<{
  'update:activeTab': [value: 'chat' | 'flashcards' | 'quiz' | 'documents']
  'new-void': []
  'select-void': [value: { type: 'chat' | 'flashcards' | 'quiz'; id: string }]
}>()

const drawerOpen = ref(false)
const drawerSection = ref<'knowledge' | 'members'>('knowledge')
const isDesktop = ref(true)
const railCollapsed = ref(false)
const RAIL_COLLAPSED_KEY = 'g4.folder-shell.rail-collapsed'

onMounted(() => {
  try {
    const stored = localStorage.getItem('g3.drawer.open')
    if (stored !== null) drawerOpen.value = stored === 'true'
    const sec = localStorage.getItem('g3.drawer.section')
    if (sec === 'knowledge' || sec === 'members') drawerSection.value = sec
    const rail = localStorage.getItem(RAIL_COLLAPSED_KEY)
    if (rail !== null) railCollapsed.value = rail === 'true'
  } catch { /* ignore */ }
  const mq = window.matchMedia('(min-width: 1024px)')
  isDesktop.value = mq.matches
  const onChange = (e: MediaQueryListEvent) => { isDesktop.value = e.matches }
  mq.addEventListener('change', onChange)
  onBeforeUnmount(() => mq.removeEventListener('change', onChange))
})

watch(drawerOpen, (v) => { try { localStorage.setItem('g3.drawer.open', String(v)) } catch { /* ignore */ } })
watch(drawerSection, (v) => { try { localStorage.setItem('g3.drawer.section', v) } catch { /* ignore */ } })
watch(railCollapsed, (v) => { try { localStorage.setItem(RAIL_COLLAPSED_KEY, String(v)) } catch { /* ignore */ } })

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

function toggleRail() {
  if (!isDesktop.value) return
  railCollapsed.value = !railCollapsed.value
}

const railCompact = computed(() => !isDesktop.value || railCollapsed.value)
const railWidth = computed(() => railCompact.value ? 64 : 240)

function onTabChange(tab: 'chat' | 'flashcards' | 'quiz' | 'documents') {
  emit('update:activeTab', tab)
}

function hexToRgb(hex: string) {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map(c => c + c).join('') : m
  const int = parseInt(n, 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function mix(a: { r: number, g: number, b: number }, b: { r: number, g: number, b: number }, t: number) {
  const ch = (x: number, y: number) => Math.round(x * (1 - t) + y * t)
  return `rgb(${ch(a.r, b.r)} ${ch(a.g, b.g)} ${ch(a.b, b.b)})`
}

const themeStyle = computed(() => {
  const hex = getColor(props.folder?.color || DEFAULT_COLOR_KEY).hex
  const tint = hexToRgb(hex)
  const ink = { r: 12, g: 12, b: 14 }
  const slate = { r: 28, g: 25, b: 23 }
  const luminance = (0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255
  const fg = luminance > 0.55 ? '#0b0b0b' : '#ffffff'
  return {
    '--primary': hex,
    '--primary-foreground': fg,
    '--ring': hex,
    '--sidebar-primary': hex,
    '--sidebar-primary-foreground': fg,
    '--sidebar-ring': hex,
    '--background': mix(ink, tint, 0.22 - luminance * 0.14),
    '--card': mix(slate, tint, 0.24 - luminance * 0.14),
    '--popover': mix(slate, tint, 0.24 - luminance * 0.14),
    '--muted': mix(slate, tint, 0.28 - luminance * 0.14),
    '--accent': mix(slate, tint, 0.34 - luminance * 0.16),
    '--sidebar': mix(ink, tint, 0.24 - luminance * 0.16),
    '--sidebar-accent': mix(slate, tint, 0.34 - luminance * 0.16),
    '--border': mix(slate, tint, 0.36 - luminance * 0.12),
  } as Record<string, string>
})

provide('folderShellThemeStyle', themeStyle)
</script>

<template>
  <div class="relative flex h-screen overflow-hidden bg-background text-foreground transition-colors duration-300" :style="themeStyle">
    <FolderShellRail
      :folder="folder"
      :folder-id="folderId"
      :active-tab="activeTab"
      :active-conversation-id="activeConversationId"
      :compact="railCompact"
      :drawer-section="drawerOpen ? drawerSection : null"
      @update:active-tab="onTabChange"
      @open-drawer="openDrawerSection"
      @new-void="emit('new-void')"
      @select-void="(payload) => emit('select-void', payload)"
    />

    <div class="relative flex flex-1 flex-col overflow-hidden">
      <slot
        name="top-bar"
        :drawer-open="drawerOpen"
        :toggle-drawer="toggleDrawer"
        :rail-collapsed="railCollapsed"
        :toggle-rail="toggleRail"
      />
      <div class="flex-1 overflow-hidden">
        <slot />
      </div>
    </div>

    <FolderShellHierarchyDrawer
      :open="drawerOpen"
      :folder-id="folderId"
      :folder="folder"
      :rail-width="railWidth"
      :full-width="!isDesktop"
      :section="drawerSection"
      @close="closeDrawer"
    />
  </div>
</template>
