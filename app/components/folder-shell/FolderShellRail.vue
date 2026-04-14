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

const props = defineProps<{
  folderId: Id<'folders'>
  folder: Doc<'folders'> | null
  activeTab: TabValue
  compact?: boolean
  drawerSection?: 'knowledge' | 'members' | null
}>()

const emit = defineEmits<{
  'update:activeTab': [value: TabValue]
  'open-drawer': [section: 'knowledge' | 'members']
  'new-void': []
}>()

const { signOut } = useUserSession()

const { data: convosData } = useConvexQuery(api.conversations.listRecentForUser, {})
const chatCount = computed(() => {
  const all = (convosData.value as Array<{ folderId: string }> | undefined) ?? []
  return all.filter(c => c.folderId === props.folderId).length
})

const { data: flashSetsData } = useConvexQuery(
  api.flashcards.listByFolder,
  computed(() => ({ folderId: props.folderId })),
)
const flashCount = computed(() => (flashSetsData.value as any[] | undefined)?.length ?? 0)

const { data: quizzesData } = useConvexQuery(
  api.quizzes.listByFolder,
  computed(() => ({ folderId: props.folderId })),
)
const quizCount = computed(() => (quizzesData.value as any[] | undefined)?.length ?? 0)

const knowledgeActive = computed(() => props.activeTab === 'documents')
function select(tab: TabValue) { emit('update:activeTab', tab) }

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
        :active="drawerSection === 'knowledge' || knowledgeActive"
        :icon="BookOpen"
        @click="emit('open-drawer', 'knowledge')"
      />

      <div class="my-3 h-px bg-border/60" />
      <div v-if="!compact" class="px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Voids</div>
      <FolderShellRailItem
        label="Chats"
        :compact="compact"
        :count="chatCount"
        :active="activeTab === 'chat'"
        :icon="MessageSquare"
        @click="select('chat')"
      />
      <FolderShellRailItem
        label="Flashcards"
        :compact="compact"
        :count="flashCount"
        :active="activeTab === 'flashcards'"
        :icon="Layers"
        @click="select('flashcards')"
      />
      <FolderShellRailItem
        label="Quiz"
        :compact="compact"
        :count="quizCount"
        :active="activeTab === 'quiz'"
        :icon="ClipboardList"
        @click="select('quiz')"
      />
    </nav>

    <div class="border-t border-border/60 p-3">
      <UiButton
        size="sm"
        data-testid="rail-new-void"
        :class="['w-full gap-1.5 rounded-full', compact && 'px-0']"
        @click="emit('new-void')"
      >
        <Plus class="h-4 w-4" />
        <span v-if="!compact">New Void</span>
      </UiButton>
      <div :class="['mt-3 flex items-center gap-1', compact ? 'flex-col' : 'justify-between px-1']">
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
