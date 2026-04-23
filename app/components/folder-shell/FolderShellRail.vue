<script setup lang="ts">
import {
  Users,
  BookOpen,
  MessageSquare,
  Layers,
  ClipboardList,
  Plus,
  Settings,
  HelpCircle,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  Trash2,
} from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import { api } from '#convex/api'
import type { Id, Doc } from '~~/convex/_generated/dataModel'
import { useHorizontalSwipeGesture } from '~/composables/useHorizontalSwipeGesture'
import { PANEL_DISMISS_THRESHOLD_PX, useGestureGuards } from '~/composables/useGestureGuards'

defineOptions({ name: 'FolderShellRail' })

type TabValue = 'chat' | 'flashcards' | 'quiz' | 'audio-overview' | 'documents'
type VoidKind = 'chat' | 'flashcards' | 'quiz'
type VoidItem = { id: string; type: VoidKind; title: string; updatedAt: number }

const props = defineProps<{
  folderId: Id<'folders'>
  folder: Doc<'folders'> | null
  activeTab: TabValue
  activeConversationId?: string | null
  activeVoidId?: string | null
  compact?: boolean
  hidden?: boolean
  mobileExpanded?: boolean
  drawerSection?: 'knowledge' | 'members' | null
}>()

const emit = defineEmits<{
  'update:activeTab': [value: TabValue]
  'open-drawer': [section: 'knowledge' | 'members']
  'new-void': []
  'select-void': [value: { type: VoidKind; id: string }]
  'request-delete-void': [value: { type: VoidKind; id: string; title: string }]
  'toggle-mobile-expanded': []
  'collapse-mobile-expanded': []
  'hide-mobile': []
}>()

const { signOut } = useUserSession()

const { data: convosData } = useConvexQuery(api.conversations.listRecentForUser, {})

const { data: flashRoomsData } = useConvexQuery(
  api.flashcardRooms.listRoomsByFolder,
  computed(() => ({ folderId: props.folderId })),
)

const { data: quizzesData } = useConvexQuery(
  api.quizzes.listByFolder,
  computed(() => ({ folderId: props.folderId })),
)

const voids = computed<VoidItem[]>(() => {
  const folderIdStr = props.folderId as unknown as string
  const chats = ((convosData.value as Array<any> | undefined) ?? [])
    .filter(c => (c.folderId as unknown as string) === folderIdStr)
    .map<VoidItem>(c => ({
      id: c._id as string,
      type: 'chat',
      title: c.title?.trim() || 'Untitled chat',
      updatedAt: (c._creationTime as number) ?? 0,
    }))
  const flashes = ((flashRoomsData.value as Array<any> | undefined) ?? []).map<VoidItem>(f => ({
    id: f._id as string,
    type: 'flashcards',
    title: f.title?.trim() || 'Flash cards',
    updatedAt: (f.updatedAt as number) ?? (f.legacyCreatedAt as number) ?? (f._creationTime as number) ?? 0,
  }))
  const quizs = ((quizzesData.value as Array<any> | undefined) ?? []).map<VoidItem>(q => ({
    id: q._id as string,
    type: 'quiz',
    title: q.title?.trim() || 'Quiz',
    updatedAt: (q._creationTime as number) ?? 0,
  }))
  return [...chats, ...flashes, ...quizs].sort((a, b) => b.updatedAt - a.updatedAt)
})

const hasVoids = computed(() => voids.value.length > 0)

const voidIcon: Record<VoidKind, typeof MessageSquare> = {
  chat: MessageSquare,
  flashcards: Layers,
  quiz: ClipboardList,
}

function isVoidActive(v: VoidItem): boolean {
  if (v.type !== props.activeTab) return false
  if (v.type === 'chat') return props.activeConversationId === v.id
  return props.activeVoidId === v.id
}

const { allFolders } = useFolders()
const { data: folderCounts } = useConvexQuery(api.documents.countsByFolder, {})
const knowledgeCount = computed(() => {
  const counts = new Map<string, number>()
  for (const c of (folderCounts.value ?? []) as Array<{ folderId: string; count: number }>) {
    counts.set(c.folderId, c.count)
  }
  const all = allFolders.value ?? []
  const childrenByParent = new Map<string, string[]>()
  for (const f of all) {
    const p = (f.parentId as unknown as string | undefined) ?? ''
    if (!p) continue
    if (!childrenByParent.has(p)) childrenByParent.set(p, [])
    childrenByParent.get(p)!.push(f._id as unknown as string)
  }
  const byId = new Map(all.map(f => [f._id as unknown as string, f]))
  let cursor = byId.get(props.folderId as unknown as string) ?? null
  const visited = new Set<string>()
  while (cursor?.parentId) {
    const pid = cursor.parentId as unknown as string
    if (visited.has(pid)) break
    visited.add(pid)
    const parent = byId.get(pid)
    if (!parent) break
    cursor = parent
  }
  const rootId = (cursor?._id as unknown as string) ?? (props.folderId as unknown as string)
  const seen = new Set<string>()
  const stack = [rootId]
  let total = 0
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    total += counts.get(id) ?? 0
    for (const c of childrenByParent.get(id) ?? []) stack.push(c)
  }
  return total
})

const knowledgeActive = computed(() => props.activeTab === 'documents')
const railRef = ref<HTMLElement | null>(null)
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const resolvedCompact = computed(() => mounted.value ? props.compact : false)
const { shouldStartHorizontalGesture } = useGestureGuards()
const SIDEBAR_SWIPE_EDGE_GUARD_PX = 12
const railInlineStyle = computed(() => {
  if (props.hidden) {
    return {
      width: '0rem',
      maxWidth: '0rem',
      minWidth: '0rem',
    }
  }

  if (props.mobileExpanded) {
    return {
      width: 'fit-content',
      minWidth: 'min(15rem, 85vw)',
      maxWidth: '15rem',
    }
  }

  return {
    width: props.compact ? '4rem' : '15rem',
  }
})

async function onLogout() {
  try { await signOut() } catch { /* ignore */ }
}

onClickOutside(railRef, () => {
  if (!props.mobileExpanded || props.hidden) return
  emit('collapse-mobile-expanded')
})

useHorizontalSwipeGesture({
  target: railRef,
  threshold: 24,
  shouldStart(event) {
    return !props.hidden && shouldStartHorizontalGesture(event, {
      allowGestureOwners: true,
      edgeGuardPx: SIDEBAR_SWIPE_EDGE_GUARD_PX,
    })
  },
  onSwipeEnd({ deltaX }) {
    if (props.hidden) return
    if (props.mobileExpanded) {
      if (deltaX <= -PANEL_DISMISS_THRESHOLD_PX) emit('collapse-mobile-expanded')
    } else if (props.compact) {
      if (deltaX >= PANEL_DISMISS_THRESHOLD_PX) emit('toggle-mobile-expanded')
      else if (deltaX <= -PANEL_DISMISS_THRESHOLD_PX) emit('hide-mobile')
    }
  },
})
</script>

<template>
  <aside
    ref="railRef"
    data-testid="folder-rail"
    data-gesture-owner="folder-rail"
    :class="[
      'relative z-30 flex shrink-0 flex-col overflow-hidden bg-card/80 backdrop-blur-sm transition-[width,max-width,min-width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
      hidden ? 'pointer-events-none border-r-0' : 'border-r border-border/60',
    ]"
    :aria-hidden="hidden ? 'true' : 'false'"
    :style="[railInlineStyle, { touchAction: 'pan-y' }]"
  >
    <UiTooltipProvider :delay-duration="0">
      <NuxtLink
        to="/"
        :class="[
          'flex w-full items-center px-4 pt-5 pb-3 transition-[gap] duration-200 ease-out',
          resolvedCompact ? 'justify-center gap-0' : 'gap-2.5',
        ]"
      >
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpen class="h-4 w-4" />
        </div>
        <div
          :class="[
            'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out',
            resolvedCompact ? 'max-w-0 translate-x-1 opacity-0' : 'max-w-40 translate-x-0 opacity-100',
          ]"
        >
          <p class="text-sm font-semibold leading-tight tracking-tight text-sidebar-foreground">Budds</p>
          <p class="text-[10px] uppercase tracking-widest text-sidebar-foreground/50">Learning Compiler</p>
        </div>
      </NuxtLink>

      <nav class="flex-1 overflow-y-auto px-2 pb-4">
        <div
          :class="[
            'overflow-hidden px-2 text-[10px] uppercase tracking-widest text-muted-foreground transition-[max-height,opacity,padding] duration-200 ease-out',
            resolvedCompact ? 'max-h-0 pb-0 opacity-0' : 'max-h-6 pb-1 opacity-100',
          ]"
        >
          Workspace
        </div>
        <FolderShellRailItem
          label="Members"
          :compact="compact"
          :count="3"
          :active="drawerSection === 'members'"
          :icon="Users"
          @click="emit('open-drawer', 'members')"
        />
        <FolderShellRailItem
          label="Knowledge"
          :compact="compact"
          :count="knowledgeCount"
          :active="drawerSection === 'knowledge' || knowledgeActive"
          :icon="BookOpen"
          @click="emit('open-drawer', 'knowledge')"
        />

        <div class="my-3 h-px bg-border/60" />
        <div
          :class="[
            'overflow-hidden px-2 text-[10px] uppercase tracking-widest text-muted-foreground transition-[max-height,opacity,padding] duration-200 ease-out',
            resolvedCompact ? 'max-h-0 pb-0 opacity-0' : 'max-h-6 pb-1 opacity-100',
          ]"
        >
          Voids
        </div>

        <template v-if="hasVoids">
          <UiContextMenu v-for="v in voids" :key="`${v.type}-${v.id}`">
            <UiContextMenuTrigger as-child>
              <FolderShellRailItem
                :label="v.title"
                :compact="compact"
                :active="isVoidActive(v)"
                :icon="voidIcon[v.type]"
                :data-testid="`rail-void-${v.type}-${v.id}`"
                @click="emit('select-void', { type: v.type, id: v.id })"
              >
                <template #compact-touch-content="{ close }">
                  <div class="overflow-hidden rounded-lg border border-border/60 bg-popover text-popover-foreground shadow-sm">
                    <div class="border-b border-border/60 px-3 py-2">
                      <p class="truncate text-sm font-medium text-foreground">{{ v.title }}</p>
                      <p class="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {{ v.type === 'chat' ? 'Chat' : v.type === 'flashcards' ? 'Flash cards' : 'Quiz' }}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted/60"
                      @click="close(); emit('select-void', { type: v.type, id: v.id })"
                    >
                      <Eye class="h-4 w-4 shrink-0" />
                      Open
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive transition hover:bg-destructive/10"
                      @click="close(); emit('request-delete-void', { type: v.type, id: v.id, title: v.title })"
                    >
                      <Trash2 class="h-4 w-4 shrink-0" />
                      Delete
                    </button>
                  </div>
                </template>
              </FolderShellRailItem>
            </UiContextMenuTrigger>
            <UiContextMenuContent class="w-48">
              <UiContextMenuItem @select="emit('select-void', { type: v.type, id: v.id })">
                <Eye class="mr-2 h-4 w-4" />
                Open
              </UiContextMenuItem>
              <UiContextMenuSeparator />
              <UiContextMenuItem class="text-destructive focus:text-destructive" @select="emit('request-delete-void', { type: v.type, id: v.id, title: v.title })">
                <Trash2 class="mr-2 h-4 w-4" />
                Delete
              </UiContextMenuItem>
            </UiContextMenuContent>
          </UiContextMenu>
        </template>
        <div
          v-else-if="!resolvedCompact"
          class="mt-2 rounded-md border border-dashed border-border/60 bg-card/40 p-3"
          data-testid="rail-voids-empty"
        >
          <p class="text-xs leading-relaxed text-muted-foreground">
            No voids in this folder yet.
          </p>
          <UiButton
            size="sm"
            data-testid="rail-voids-empty-cta"
            class="mt-2 w-full gap-1.5 rounded-full"
            @click="emit('new-void')"
          >
            <Plus class="h-3.5 w-3.5" />
            Create your first void
          </UiButton>
        </div>
        <button
          v-else
          type="button"
          data-testid="rail-voids-empty-compact"
          class="mx-auto mt-2 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90"
          aria-label="Create your first void"
          @click="emit('new-void')"
        >
          <Plus class="h-4 w-4" />
        </button>
      </nav>

      <div class="border-t border-border/60 p-3">
        <UiButton
          v-if="hasVoids"
          size="sm"
          data-testid="rail-new-void"
          :class="[
            'w-full rounded-full transition-[gap,padding] duration-200 ease-out',
            resolvedCompact ? 'gap-0 px-0' : 'gap-1.5',
          ]"
          @click="emit('new-void')"
        >
          <Plus class="h-4 w-4" />
          <span
            :class="[
              'overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out',
              resolvedCompact ? 'max-w-0 translate-x-1 opacity-0' : 'max-w-24 translate-x-0 opacity-100',
            ]"
          >
            New Void
          </span>
        </UiButton>
        <button
          type="button"
          :class="[
            hasVoids ? 'mt-3' : '',
            'flex h-9 w-full items-center justify-center rounded-lg border border-border/60 px-2 text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground lg:hidden',
          ]"
          :aria-label="mobileExpanded ? 'Collapse folder sidebar details' : 'Expand folder sidebar details'"
          @click="emit('toggle-mobile-expanded')"
        >
          <component :is="mobileExpanded ? ChevronsLeft : ChevronsRight" class="h-4 w-4 shrink-0" />
        </button>
        <div :class="[hasVoids && 'mt-3', 'flex items-center gap-1', resolvedCompact ? 'flex-col' : 'justify-between px-1']">
          <button class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Settings">
            <Settings class="h-4 w-4" />
          </button>
          <button class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Help">
            <HelpCircle class="h-4 w-4" />
          </button>
          <button
            class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Logout"
            @click="onLogout"
          >
            <LogOut class="h-4 w-4" />
          </button>
        </div>
      </div>
    </UiTooltipProvider>
  </aside>
</template>
