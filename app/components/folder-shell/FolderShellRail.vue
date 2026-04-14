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
  ArrowLeft,
} from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id, Doc } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellRail' })

type TabValue = 'chat' | 'flashcards' | 'quiz' | 'documents'
type VoidKind = 'chat' | 'flashcards' | 'quiz'
type VoidItem = { id: string; type: VoidKind; title: string; updatedAt: number }

const props = defineProps<{
  folderId: Id<'folders'>
  folder: Doc<'folders'> | null
  activeTab: TabValue
  activeConversationId?: string | null
  compact?: boolean
  drawerSection?: 'knowledge' | 'members' | null
}>()

const emit = defineEmits<{
  'update:activeTab': [value: TabValue]
  'open-drawer': [section: 'knowledge' | 'members']
  'new-void': []
  'select-void': [value: { type: VoidKind; id: string }]
}>()

const { signOut } = useUserSession()

const { data: convosData } = useConvexQuery(api.conversations.listRecentForUser, {})

const { data: flashSetsData } = useConvexQuery(
  api.flashcards.listByFolder,
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
  const flashes = ((flashSetsData.value as Array<any> | undefined) ?? []).map<VoidItem>(f => ({
    id: f._id as string,
    type: 'flashcards',
    title: f.title?.trim() || 'Flash card set',
    updatedAt: (f._creationTime as number) ?? 0,
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
  return false
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

async function onLogout() {
  try { await signOut() } catch { /* ignore */ }
  await navigateTo('/')
}
</script>

<template>
  <aside
    data-testid="folder-rail"
    :class="[
      'relative z-30 flex shrink-0 flex-col border-r border-border/60 bg-card/80 backdrop-blur-sm',
      compact ? 'w-16' : 'w-60',
    ]"
  >
    <div class="flex items-center gap-2 px-4 pt-5 pb-3">
      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <BookOpen class="h-4 w-4" />
      </div>
      <div v-if="!compact" class="min-w-0">
        <p class="text-sm font-semibold leading-tight tracking-tight text-foreground">Budds</p>
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">Learning Compiler</p>
      </div>
    </div>

    <NuxtLink
      to="/"
      :class="[
        'mx-3 mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-primary/80 transition hover:bg-primary/10 hover:text-primary',
        compact && 'justify-center px-0',
      ]"
    >
      <ArrowLeft class="h-3.5 w-3.5 shrink-0" />
      <span v-if="!compact" class="truncate">{{ folder?.name ?? 'Back' }}</span>
    </NuxtLink>

    <nav class="flex-1 overflow-y-auto px-2 pb-4">
      <div v-if="!compact" class="px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Workspace</div>
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
      <div v-if="!compact" class="px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Voids</div>

      <template v-if="hasVoids">
        <FolderShellRailItem
          v-for="v in voids"
          :key="`${v.type}-${v.id}`"
          :label="v.title"
          :compact="compact"
          :active="isVoidActive(v)"
          :icon="voidIcon[v.type]"
          :data-testid="`rail-void-${v.type}-${v.id}`"
          @click="emit('select-void', { type: v.type, id: v.id })"
        />
      </template>
      <div
        v-else-if="!compact"
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
        :class="['w-full gap-1.5 rounded-full', compact && 'px-0']"
        @click="emit('new-void')"
      >
        <Plus class="h-4 w-4" />
        <span v-if="!compact">New Void</span>
      </UiButton>
      <div :class="[hasVoids && 'mt-3', 'flex items-center gap-1', compact ? 'flex-col' : 'justify-between px-1']">
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
  </aside>
</template>
