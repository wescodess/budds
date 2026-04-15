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
  activeVoidId?: string | null
}>()

const emit = defineEmits<{
  'update:activeTab': [value: 'chat' | 'flashcards' | 'quiz' | 'documents']
  'new-void': []
  'select-void': [value: { type: 'chat' | 'flashcards' | 'quiz'; id: string }]
}>()

const drawerOpen = ref(false)
const drawerSection = ref<'knowledge' | 'members'>('knowledge')
const isDesktop = ref(import.meta.client ? window.matchMedia('(min-width: 1024px)').matches : false)
const railCollapsed = ref(false)
const mobileRailHidden = ref(false)
const mobileRailExpanded = ref(false)
const RAIL_COLLAPSED_KEY = 'g4.folder-shell.rail-collapsed'
const MOBILE_RAIL_HIDDEN_KEY = 'g4.folder-shell.mobile-rail-hidden'
const MOBILE_RAIL_COMPACT_WIDTH = '4rem'
const cachedFolderColor = ref<string | null>(null)
const FOLDER_THEME_CACHE_PREFIX = 'g4.folder-shell.theme.'
const folderThemeCacheKey = computed(() => `${FOLDER_THEME_CACHE_PREFIX}${props.folderId as string}`)
const { mode } = useAppTheme()
const managedBodyThemeKeys = [
  '--foreground',
  '--primary',
  '--primary-foreground',
  '--ring',
  '--background',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--input',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-ring',
] as const
const originalBodyThemeValues = new Map<string, string>()
let bodyThemeSnapshotCaptured = false

onMounted(() => {
  try {
    const stored = localStorage.getItem('g3.drawer.open')
    if (stored !== null) drawerOpen.value = stored === 'true'
    const sec = localStorage.getItem('g3.drawer.section')
    if (sec === 'knowledge' || sec === 'members') drawerSection.value = sec
    const rail = localStorage.getItem(RAIL_COLLAPSED_KEY)
    if (rail !== null) railCollapsed.value = rail === 'true'
    const mobileRail = localStorage.getItem(MOBILE_RAIL_HIDDEN_KEY)
    if (mobileRail !== null) mobileRailHidden.value = mobileRail === 'true'
    const cachedColor = localStorage.getItem(folderThemeCacheKey.value)
    if (cachedColor) cachedFolderColor.value = cachedColor
  } catch { /* ignore */ }
  const mq = window.matchMedia('(min-width: 1024px)')
  isDesktop.value = mq.matches
  const onChange = (e: MediaQueryListEvent) => {
    isDesktop.value = e.matches
    if (e.matches) mobileRailExpanded.value = false
  }
  mq.addEventListener('change', onChange)
  onBeforeUnmount(() => mq.removeEventListener('change', onChange))
})

watch(drawerOpen, (v) => { try { localStorage.setItem('g3.drawer.open', String(v)) } catch { /* ignore */ } })
watch(drawerSection, (v) => { try { localStorage.setItem('g3.drawer.section', v) } catch { /* ignore */ } })
watch(railCollapsed, (v) => { try { localStorage.setItem(RAIL_COLLAPSED_KEY, String(v)) } catch { /* ignore */ } })
watch(mobileRailHidden, (v) => { try { localStorage.setItem(MOBILE_RAIL_HIDDEN_KEY, String(v)) } catch { /* ignore */ } })
watch(folderThemeCacheKey, (key) => {
  if (!import.meta.client) return
  try {
    cachedFolderColor.value = localStorage.getItem(key)
  } catch {
    cachedFolderColor.value = null
  }
})
watch(() => props.folder?.color, (color) => {
  if (!import.meta.client || !color) return
  cachedFolderColor.value = color
  try {
    localStorage.setItem(folderThemeCacheKey.value, color)
  } catch {
    // ignore storage failures
  }
}, { immediate: true })

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
  if (isDesktop.value) {
    railCollapsed.value = !railCollapsed.value
    return
  }
  mobileRailExpanded.value = false
  mobileRailHidden.value = !mobileRailHidden.value
}

const railHidden = computed(() => !isDesktop.value && mobileRailHidden.value)
const railCompact = computed(() => isDesktop.value ? railCollapsed.value : !mobileRailExpanded.value)
const railWidth = computed(() => railHidden.value ? 0 : railCompact.value ? 64 : 240)
const shouldPushMainPane = computed(() => !isDesktop.value && mobileRailExpanded.value && !railHidden.value)
const mainPaneStyle = computed<Record<string, string>>(() => (
  shouldPushMainPane.value
    ? {
        flex: `0 0 calc(100% - ${MOBILE_RAIL_COMPACT_WIDTH})`,
        minWidth: `calc(100% - ${MOBILE_RAIL_COMPACT_WIDTH})`,
      }
    : {}
))
const resolvedThemeColor = computed(() => props.folder?.color || cachedFolderColor.value || null)

function toggleMobileRailExpanded() {
  if (isDesktop.value || railHidden.value) return
  mobileRailExpanded.value = !mobileRailExpanded.value
}

function showMobileRailCompact() {
  if (isDesktop.value) return
  mobileRailHidden.value = false
  mobileRailExpanded.value = false
}

function expandMobileRail() {
  if (isDesktop.value) return
  mobileRailHidden.value = false
  mobileRailExpanded.value = true
}

function collapseMobileRailToCompact() {
  if (isDesktop.value || railHidden.value) return
  mobileRailExpanded.value = false
}

function hideMobileRail() {
  if (isDesktop.value) return
  mobileRailExpanded.value = false
  mobileRailHidden.value = true
}

function getMobileRailState() {
  if (isDesktop.value) return railCollapsed.value ? 'compact' : 'expanded'
  if (mobileRailHidden.value) return 'hidden'
  return mobileRailExpanded.value ? 'expanded' : 'compact'
}

defineExpose({
  showMobileRailCompact,
  expandMobileRail,
  collapseMobileRailToCompact,
  hideMobileRail,
  getMobileRailState,
})

watch(railHidden, (hidden) => {
  if (hidden) mobileRailExpanded.value = false
})

watch(isDesktop, (desktop) => {
  if (desktop) mobileRailExpanded.value = false
})

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function captureOriginalBodyThemeValues() {
  if (!import.meta.client || bodyThemeSnapshotCaptured || !document.body) return
  const body = document.body
  for (const key of managedBodyThemeKeys) {
    originalBodyThemeValues.set(key, body.style.getPropertyValue(key))
  }
  bodyThemeSnapshotCaptured = true
}

function syncBodyTheme(style: Record<string, string>) {
  if (!import.meta.client || !document.body) return
  captureOriginalBodyThemeValues()
  const body = document.body
  const hasTheme = Object.keys(style).length > 0
  for (const key of managedBodyThemeKeys) {
    const nextValue = style[key]
    if (nextValue) {
      body.style.setProperty(key, nextValue)
    } else {
      body.style.removeProperty(key)
    }
  }
  if (hasTheme) {
    body.dataset.folderTheme = 'active'
  } else {
    delete body.dataset.folderTheme
  }
}

const themeStyle = computed(() => {
  if (!resolvedThemeColor.value) return {} as Record<string, string>

  const hex = getColor(resolvedThemeColor.value || DEFAULT_COLOR_KEY).hex
  const tint = hexToRgb(hex)
  const isDarkMode = mode.value === 'dark'
  const palette = isDarkMode
    ? {
        background: { r: 12, g: 12, b: 14 },
        card: { r: 28, g: 25, b: 23 },
        popover: { r: 28, g: 25, b: 23 },
        secondary: { r: 34, g: 30, b: 28 },
        muted: { r: 38, g: 34, b: 31 },
        accent: { r: 52, g: 46, b: 42 },
        input: { r: 46, g: 41, b: 38 },
        sidebar: { r: 18, g: 16, b: 15 },
        sidebarAccent: { r: 42, g: 38, b: 34 },
        border: { r: 88, g: 80, b: 73 },
        backgroundMix: clamp(0.22 - ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.14, 0.06, 0.22),
        cardMix: clamp(0.24 - ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.14, 0.08, 0.24),
        mutedMix: clamp(0.28 - ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.14, 0.1, 0.28),
        accentMix: clamp(0.34 - ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.16, 0.14, 0.34),
        inputMix: clamp(0.26 - ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.12, 0.1, 0.26),
        sidebarMix: clamp(0.24 - ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.16, 0.08, 0.24),
        borderMix: clamp(0.36 - ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.12, 0.14, 0.36),
      }
    : {
        background: { r: 247, g: 244, b: 239 },
        card: { r: 255, g: 251, b: 246 },
        popover: { r: 255, g: 250, b: 244 },
        secondary: { r: 243, g: 236, b: 229 },
        muted: { r: 240, g: 233, b: 225 },
        accent: { r: 235, g: 225, b: 214 },
        input: { r: 226, g: 217, b: 208 },
        sidebar: { r: 244, g: 238, b: 231 },
        sidebarAccent: { r: 236, g: 227, b: 217 },
        border: { r: 214, g: 205, b: 194 },
        backgroundMix: clamp(0.08 + ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.04, 0.08, 0.14),
        cardMix: clamp(0.06 + ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.03, 0.06, 0.12),
        mutedMix: clamp(0.1 + ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.04, 0.1, 0.18),
        accentMix: clamp(0.16 + ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.04, 0.16, 0.24),
        inputMix: clamp(0.11 + ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.04, 0.11, 0.19),
        sidebarMix: clamp(0.09 + ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.04, 0.09, 0.16),
        borderMix: clamp(0.14 + ((0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255) * 0.04, 0.14, 0.22),
      }
  const luminance = (0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255
  const fg = luminance > 0.55 ? '#0b0b0b' : '#ffffff'
  const text = isDarkMode ? '#fbfbf8' : '#221f1b'
  const mutedText = isDarkMode ? '#aca294' : '#746b60'
  return {
    '--foreground': text,
    '--primary': hex,
    '--primary-foreground': fg,
    '--ring': hex,
    '--card-foreground': text,
    '--popover-foreground': text,
    '--secondary': mix(palette.secondary, tint, palette.mutedMix),
    '--secondary-foreground': text,
    '--sidebar-primary': hex,
    '--sidebar-primary-foreground': fg,
    '--sidebar-ring': hex,
    '--background': mix(palette.background, tint, palette.backgroundMix),
    '--card': mix(palette.card, tint, palette.cardMix),
    '--popover': mix(palette.popover, tint, palette.cardMix),
    '--muted': mix(palette.muted, tint, palette.mutedMix),
    '--muted-foreground': mutedText,
    '--accent': mix(palette.accent, tint, palette.accentMix),
    '--accent-foreground': text,
    '--input': mix(palette.input, tint, palette.inputMix),
    '--sidebar': mix(palette.sidebar, tint, palette.sidebarMix),
    '--sidebar-foreground': text,
    '--sidebar-accent': mix(palette.sidebarAccent, tint, palette.accentMix),
    '--sidebar-accent-foreground': text,
    '--border': mix(palette.border, tint, palette.borderMix),
    '--sidebar-border': mix(palette.border, tint, palette.borderMix),
  } as Record<string, string>
})

onMounted(() => syncBodyTheme(themeStyle.value))

watch(themeStyle, (style) => {
  syncBodyTheme(style)
}, { immediate: true })

onBeforeUnmount(() => {
  if (!import.meta.client || !bodyThemeSnapshotCaptured || !document.body) return
  const body = document.body
  for (const key of managedBodyThemeKeys) {
    const original = originalBodyThemeValues.get(key) ?? ''
    if (original) {
      body.style.setProperty(key, original)
    } else {
      body.style.removeProperty(key)
    }
  }
  delete body.dataset.folderTheme
})

provide('folderShellThemeStyle', themeStyle)
</script>

<template>
  <div class="app-viewport-frame relative flex overflow-hidden bg-background text-foreground transition-colors duration-300" :style="themeStyle">
    <FolderShellRail
      :folder="folder"
      :folder-id="folderId"
      :active-tab="activeTab"
      :active-conversation-id="activeConversationId"
      :active-void-id="activeVoidId"
      :compact="railCompact"
      :hidden="railHidden"
      :mobile-expanded="mobileRailExpanded"
      :drawer-section="drawerOpen ? drawerSection : null"
      @update:active-tab="onTabChange"
      @open-drawer="openDrawerSection"
      @new-void="emit('new-void')"
      @select-void="(payload) => emit('select-void', payload)"
      @toggle-mobile-expanded="toggleMobileRailExpanded"
      @collapse-mobile-expanded="collapseMobileRailToCompact"
      @hide-mobile="hideMobileRail"
    />

    <div
      data-testid="folder-main-pane"
      class="relative flex min-w-0 flex-1 flex-col overflow-hidden transition-[flex,min-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
      :style="mainPaneStyle"
    >
      <slot
        name="top-bar"
        :drawer-open="drawerOpen"
        :toggle-drawer="toggleDrawer"
        :rail-collapsed="railCollapsed"
        :rail-hidden="railHidden"
        :toggle-rail="toggleRail"
      />
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
