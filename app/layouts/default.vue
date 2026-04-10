<script setup lang="ts">
import { useColorMode, useMediaQuery } from '@vueuse/core'
import {
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Sun,
  Moon,
  LogOut,
  ArrowLeft,
  BookOpen,
  HelpCircle,
  FileText,
  MessagesSquare,
} from 'lucide-vue-next'
import type { Id } from '~~/convex/_generated/dataModel'

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
  ],
})

const { signOut, user } = useUserSession()

const mode = useColorMode({
  attribute: 'class',
  modes: {
    dark: 'dark',
    light: 'light',
  },
  initialValue: 'dark',
})

function toggleTheme() {
  mode.value = mode.value === 'dark' ? 'light' : 'dark'
}

const activeTab = ref('chat')
const isMobileView = useMediaQuery('(max-width: 767px)')
const route = useRoute()
const isDashboard = computed(() => route.path === '/app')

const { allFolders, allFoldersLoading, createFolder, createSubfolder, renameFolder, deleteFolder } = useFolders()

const isFolderRoute = computed(() => route.path.startsWith('/app/folders/'))
const currentFolderId = computed(() => {
  if (!isFolderRoute.value) return null
  return route.params.id as string
})

const currentFolderData = computed(() => {
  if (!isFolderRoute.value || !allFolders?.value || !currentFolderId.value) return null
  return allFolders.value.find((f: any) => f._id === currentFolderId.value) ?? null
})

const folderAncestors = computed(() => {
  if (!currentFolderData.value || !allFolders?.value) return []
  const folderMap = new Map(allFolders.value.map((f: any) => [f._id, f]))
  const ancestors: { _id: string; name: string }[] = []
  let parentId = currentFolderData.value.parentId
  const seen = new Set<string>()
  while (parentId) {
    if (seen.has(parentId)) break
    seen.add(parentId)
    const parent = folderMap.get(parentId)
    if (!parent) break
    ancestors.unshift({ _id: parent._id, name: parent.name })
    parentId = parent.parentId
  }
  return ancestors
})

const showNewFolderInput = ref(false)
const newFolderName = ref('')

async function handleCreateFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  try {
    await createFolder(name)
    newFolderName.value = ''
    showNewFolderInput.value = false
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to create folder')
  }
}

async function handleCreateSubfolder(parentId: string) {
  const name = prompt('Subfolder name')
  if (!name?.trim()) return
  try {
    await createSubfolder(name.trim(), parentId as any)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to create subfolder')
  }
}

async function handleRename(folderId: Id<'folders'>, name: string) {
  try {
    await renameFolder(folderId, name)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to rename folder')
  }
}

const showDeleteDialog = ref(false)
const isDeleting = ref(false)
const folderToDelete = ref<{ _id: Id<'folders'>; name: string } | null>(null)

function countDescendants(folderId: string): { subfolderCount: number; documentCount: number } {
  if (!allFolders?.value) return { subfolderCount: 0, documentCount: 0 }
  let count = 0
  const stack = [folderId]
  while (stack.length > 0) {
    const parentId = stack.pop()!
    for (const f of allFolders.value) {
      if (f.parentId === parentId) {
        count++
        stack.push(f._id)
      }
    }
  }
  return { subfolderCount: count, documentCount: 0 }
}

const deleteDescription = computed(() => {
  if (!folderToDelete.value) return ''
  const c = countDescendants(folderToDelete.value._id)
  if (c.subfolderCount === 0 && c.documentCount === 0) {
    return `Are you sure you want to delete "${folderToDelete.value.name}"?`
  }
  const parts: string[] = []
  if (c.subfolderCount > 0) parts.push(`${c.subfolderCount} subfolder${c.subfolderCount > 1 ? 's' : ''}`)
  if (c.documentCount > 0) parts.push(`${c.documentCount} document${c.documentCount > 1 ? 's' : ''}`)
  return `Delete "${folderToDelete.value.name}" and all ${parts.join(' and ')} inside?`
})

function handleDeleteRequest(folder: { _id: Id<'folders'>; name: string }) {
  folderToDelete.value = folder
  showDeleteDialog.value = true
}

function collectDescendantIds(folderId: string): Set<string> {
  const ids = new Set<string>([folderId])
  if (!allFolders?.value) return ids
  const stack = [folderId]
  while (stack.length > 0) {
    const parentId = stack.pop()!
    for (const f of allFolders.value) {
      if (f.parentId === parentId && !ids.has(f._id)) {
        ids.add(f._id)
        stack.push(f._id)
      }
    }
  }
  return ids
}

async function executeDelete() {
  if (!folderToDelete.value || isDeleting.value) return
  isDeleting.value = true
  const deletedId = folderToDelete.value._id
  const affectedIds = collectDescendantIds(deletedId)
  try {
    await deleteFolder(deletedId)
    const { toast } = await import('vue-sonner')
    toast.success('Folder deleted')
    if (route.params.id && affectedIds.has(route.params.id as string)) {
      navigateTo('/app')
    }
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to delete folder')
  } finally {
    showDeleteDialog.value = false
    folderToDelete.value = null
    isDeleting.value = false
  }
}
</script>

<template>
  <a
    href="#main-content"
    data-testid="skip-to-content"
    class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
  >
    Skip to content
  </a>

  <UiSidebarProvider>
    <UiSidebar
      data-testid="app-sidebar"
      collapsible="offcanvas"
      class="border-r border-sidebar-border"
    >
      <UiSidebarHeader class="px-3 py-4">
        <div class="flex items-center justify-between">
          <span class="font-dm-sans text-lg font-bold tracking-tight text-sidebar-foreground">
            Budds
          </span>
          <UiButton
            variant="ghost"
            size="icon"
            data-testid="theme-toggle"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            @click="toggleTheme"
          >
            <Sun v-if="mode === 'dark'" class="h-4 w-4" />
            <Moon v-else class="h-4 w-4" />
            <span class="sr-only">Toggle theme</span>
          </UiButton>
        </div>
      </UiSidebarHeader>

      <UiSidebarContent>
        <UiSidebarGroup data-testid="sidebar-folders-group">
          <UiSidebarGroupLabel class="flex items-center justify-between">
            <span class="flex items-center">
              <FolderOpen class="mr-2 h-4 w-4" />
              Folders
            </span>
            <UiButton
              variant="ghost"
              size="icon"
              data-testid="new-root-folder-button"
              class="h-5 w-5 text-muted-foreground hover:text-foreground"
              @click="showNewFolderInput = !showNewFolderInput"
            >
              <FolderPlus class="h-3.5 w-3.5" />
              <span class="sr-only">New folder</span>
            </UiButton>
          </UiSidebarGroupLabel>
          <UiSidebarGroupContent>
            <div v-if="showNewFolderInput" class="px-3 py-1">
              <UiInput
                v-model="newFolderName"
                placeholder="Folder name"
                class="h-7 text-sm"
                data-testid="new-folder-input"
                @keydown.enter="handleCreateFolder"
                @keydown.escape="showNewFolderInput = false"
              />
            </div>
            <div v-if="allFoldersLoading || !allFolders" class="space-y-1 px-3 py-2">
              <UiSkeleton v-for="i in 3" :key="i" class="h-7 w-full rounded-md" />
            </div>
            <template v-else-if="allFolders.length > 0">
              <SidebarFolderTree
                :folders="allFolders"
                :active-folder="currentFolderId"
                @create-subfolder="handleCreateSubfolder"
                @rename="handleRename"
                @delete="handleDeleteRequest"
              />
            </template>
            <div
              v-else
              data-testid="sidebar-folders-empty"
              class="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              <FolderOpen class="mx-auto mb-2 h-8 w-8 opacity-40" />
              No folders yet
            </div>
          </UiSidebarGroupContent>
        </UiSidebarGroup>

        <UiSeparator />

        <UiSidebarGroup data-testid="sidebar-chats-group">
          <UiSidebarGroupLabel>
            <MessagesSquare class="mr-2 h-4 w-4" />
            Recent Chats
          </UiSidebarGroupLabel>
          <UiSidebarGroupContent>
            <div
              data-testid="sidebar-chats-empty"
              class="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              <MessageSquare class="mx-auto mb-2 h-8 w-8 opacity-40" />
              No recent chats
            </div>
          </UiSidebarGroupContent>
        </UiSidebarGroup>
      </UiSidebarContent>

      <UiSidebarFooter class="border-t border-sidebar-border p-3">
        <div class="flex items-center gap-3">
          <UiAvatar data-testid="sidebar-user-avatar" class="h-8 w-8">
            <UiAvatarImage
              v-if="user?.image"
              :src="user.image"
              :alt="user?.name || 'User'"
            />
            <UiAvatarFallback class="bg-primary/10 text-xs text-primary">
              {{ user?.name?.charAt(0)?.toUpperCase() || 'U' }}
            </UiAvatarFallback>
          </UiAvatar>
          <span
            data-testid="sidebar-user-name"
            class="flex-1 truncate text-sm font-medium text-sidebar-foreground"
          >
            {{ user?.name || 'User' }}
          </span>
          <UiButton
            variant="ghost"
            size="icon"
            data-testid="sidebar-sign-out"
            class="h-7 w-7 text-muted-foreground hover:text-destructive"
            @click="signOut()"
          >
            <LogOut class="h-4 w-4" />
            <span class="sr-only">Sign out</span>
          </UiButton>
        </div>
      </UiSidebarFooter>
    </UiSidebar>

    <UiSidebarInset id="main-content" data-testid="main-content">
      <header class="flex items-center gap-2 border-b border-border px-4 py-2">
        <UiSidebarTrigger data-testid="sidebar-trigger" />

        <nav data-testid="breadcrumb-nav" class="flex-1">
          <UiBreadcrumb>
            <UiBreadcrumbList>
              <template v-if="isMobileView && !isDashboard">
                <UiBreadcrumbItem data-testid="breadcrumb-mobile">
                  <UiBreadcrumbLink as-child>
                    <NuxtLink to="/app" data-testid="breadcrumb-back" class="flex items-center gap-1">
                      <ArrowLeft class="h-4 w-4" />
                      Home
                    </NuxtLink>
                  </UiBreadcrumbLink>
                </UiBreadcrumbItem>
              </template>
              <template v-else-if="isDashboard">
                <UiBreadcrumbItem>
                  <UiBreadcrumbPage>Home</UiBreadcrumbPage>
                </UiBreadcrumbItem>
              </template>
              <template v-else-if="isFolderRoute">
                <UiBreadcrumbItem>
                  <UiBreadcrumbLink as-child>
                    <NuxtLink to="/app">Home</NuxtLink>
                  </UiBreadcrumbLink>
                </UiBreadcrumbItem>
                <template v-for="ancestor in folderAncestors" :key="ancestor._id">
                  <UiBreadcrumbSeparator />
                  <UiBreadcrumbItem>
                    <UiBreadcrumbLink
                      as-child
                      :data-testid="`breadcrumb-folder-${ancestor._id}`"
                    >
                      <NuxtLink :to="`/app/folders/${ancestor._id}`">{{ ancestor.name }}</NuxtLink>
                    </UiBreadcrumbLink>
                  </UiBreadcrumbItem>
                </template>
                <UiBreadcrumbSeparator />
                <UiBreadcrumbItem>
                  <UiBreadcrumbPage data-testid="breadcrumb-folder-current">
                    {{ currentFolderData?.name ?? '...' }}
                  </UiBreadcrumbPage>
                </UiBreadcrumbItem>
              </template>
              <template v-else>
                <UiBreadcrumbItem>
                  <UiBreadcrumbLink as-child>
                    <NuxtLink to="/app">Home</NuxtLink>
                  </UiBreadcrumbLink>
                </UiBreadcrumbItem>
              </template>
            </UiBreadcrumbList>
          </UiBreadcrumb>
        </nav>
      </header>

      <div class="flex flex-1 flex-col overflow-hidden">
        <template v-if="isDashboard">
          <slot />
        </template>

        <UiTabs v-else v-model="activeTab" class="flex flex-1 flex-col">
          <div data-testid="tabs-container" class="overflow-x-auto border-b border-border px-4">
            <UiTabsList class="h-10 w-full justify-start gap-0 rounded-none bg-transparent p-0">
              <UiTabsTrigger
                value="chat"
                class="rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <MessageSquare class="mr-1.5 h-4 w-4" />
                Chat
              </UiTabsTrigger>
              <UiTabsTrigger
                value="flash-cards"
                class="rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <BookOpen class="mr-1.5 h-4 w-4" />
                Flash Cards
              </UiTabsTrigger>
              <UiTabsTrigger
                value="quiz"
                class="rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <HelpCircle class="mr-1.5 h-4 w-4" />
                Quiz
              </UiTabsTrigger>
              <UiTabsTrigger
                value="documents"
                class="rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <FileText class="mr-1.5 h-4 w-4" />
                Documents
              </UiTabsTrigger>
            </UiTabsList>
          </div>

          <UiTabsContent value="chat" class="mt-0 flex-1 overflow-hidden">
            <slot />
          </UiTabsContent>

          <UiTabsContent value="flash-cards" class="mt-0 flex-1">
            <div class="flex h-full items-center justify-center text-muted-foreground">
              <div class="text-center">
                <BookOpen class="mx-auto mb-3 h-12 w-12 opacity-40" />
                <p class="text-lg font-medium">Flash Cards</p>
                <p class="mt-1 text-sm">Coming soon</p>
              </div>
            </div>
          </UiTabsContent>

          <UiTabsContent value="quiz" class="mt-0 flex-1">
            <div class="flex h-full items-center justify-center text-muted-foreground">
              <div class="text-center">
                <HelpCircle class="mx-auto mb-3 h-12 w-12 opacity-40" />
                <p class="text-lg font-medium">Quiz</p>
                <p class="mt-1 text-sm">Coming soon</p>
              </div>
            </div>
          </UiTabsContent>

          <UiTabsContent value="documents" class="mt-0 flex-1">
            <div class="flex h-full items-center justify-center text-muted-foreground">
              <div class="text-center">
                <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
                <p class="text-lg font-medium">Documents</p>
                <p class="mt-1 text-sm">Coming soon</p>
              </div>
            </div>
          </UiTabsContent>
        </UiTabs>
      </div>
    </UiSidebarInset>
  </UiSidebarProvider>

  <UiAlertDialog v-model:open="showDeleteDialog">
    <UiAlertDialogContent>
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>Delete folder</UiAlertDialogTitle>
        <UiAlertDialogDescription>
          {{ deleteDescription }}
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
        <UiAlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          @click="executeDelete"
        >
          Delete
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>

  <UiSonner />
</template>
