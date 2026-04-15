<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
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
  MoreHorizontal,
  Pencil,
  Trash2,
  Download,
} from 'lucide-vue-next'
import type { Doc, Id } from '~~/convex/_generated/dataModel'
import { useHorizontalSwipeGesture } from '~/composables/useHorizontalSwipeGesture'
import { PANEL_DISMISS_THRESHOLD_PX, useGestureGuards } from '~/composables/useGestureGuards'

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
  ],
})

const { signOut, user } = useUserSession()
const { mode, toggleTheme } = useAppTheme()

const activeTab = ref('chat')
const isMobileView = useMediaQuery('(max-width: 767px)')
const route = useRoute()
const isDashboard = computed(() => route.path === '/')
const isChatRoute = computed(() => route.path === '/chat')
const isStandaloneRoute = computed(() => isDashboard.value || isChatRoute.value)
const mainContentRef = ref<HTMLElement | null>(null)
const mobileSidebarOpen = ref(false)
const { isTouchLike, isMobileViewport, isInteractiveTarget, isWithinEdgeGuard } = useGestureGuards()
const DASHBOARD_SWIPE_EDGE_GUARD_PX = 28

const { allFolders, allFoldersLoading, deleteFolder } = useFolders()

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

const showFolderModal = ref(false)
const folderModalMode = ref<'create' | 'edit'>('create')
const editingFolder = ref<Doc<'folders'> | null>(null)
const folderModalParentId = ref<Id<'folders'> | null>(null)

function openCreateFolder() {
  folderModalMode.value = 'create'
  editingFolder.value = null
  folderModalParentId.value = null
  showFolderModal.value = true
}

function openEditFolder(folder: Doc<'folders'>) {
  folderModalMode.value = 'edit'
  editingFolder.value = folder
  folderModalParentId.value = null
  showFolderModal.value = true
}

function handleNewSubfolder(parentId: Id<'folders'>) {
  folderModalMode.value = 'create'
  editingFolder.value = null
  folderModalParentId.value = parentId
  showFolderModal.value = true
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

const rootFolders = computed(() => (allFolders.value ?? []).filter(folder => !folder.parentId))

const showDeleteAccountDialog = ref(false)
const deleteAccountConfirmInput = ref('')
const isDeletingAccount = ref(false)
const isExportingData = ref(false)

async function onSignOut() {
  try {
    await signOut()
  } catch {
    // Better Auth may already have invalidated the session.
  }

  await navigateTo('/login', { replace: true })
}

function parseFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? null
}

async function executeExportData() {
  if (isExportingData.value) return
  isExportingData.value = true
  try {
    const res = await fetch('/api/export/me', { method: 'GET', credentials: 'include' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Export failed (${res.status})`)
    }
    const blob = await res.blob()
    const filename =
      parseFilenameFromDisposition(res.headers.get('content-disposition'))
      ?? `budds-export-${new Date().toISOString().slice(0, 10)}.zip`

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    const { toast } = await import('vue-sonner')
    toast.success('Your data export is ready.')
  } catch (e: any) {
    console.error('Data export failed', e)
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'We could not export your data. Please try again.')
  } finally {
    isExportingData.value = false
  }
}

const canConfirmDeleteAccount = computed(() => {
  const value = deleteAccountConfirmInput.value.trim()
  if (value === 'DELETE') return true
  const email = user.value?.email
  if (typeof email === 'string' && email.length > 0) {
    return value.toLowerCase() === email.toLowerCase()
  }
  return false
})

function openDeleteAccountDialog() {
  deleteAccountConfirmInput.value = ''
  showDeleteAccountDialog.value = true
}

async function executeDeleteAccount() {
  if (!canConfirmDeleteAccount.value || isDeletingAccount.value) return
  isDeletingAccount.value = true
  try {
    await $fetch('/api/auth/delete-user', {
      method: 'POST',
      body: {},
    })
    const { toast } = await import('vue-sonner')
    toast.success('Your account and all data have been deleted.')
    await onSignOut()
  } catch (e: any) {
    console.error('Account deletion failed', e)
    const { toast } = await import('vue-sonner')
    toast.error(e?.data?.message || e?.message || 'We could not delete your account. Please try again.')
  } finally {
    isDeletingAccount.value = false
    showDeleteAccountDialog.value = false
    deleteAccountConfirmInput.value = ''
  }
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
      navigateTo('/')
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

function hasBlockingOverlay() {
  if (!import.meta.client) return false
  return Boolean(document.querySelector(
    '[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="drawer-content"], [data-slot="alert-dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"]',
  ))
}

useHorizontalSwipeGesture({
  target: mainContentRef,
  threshold: PANEL_DISMISS_THRESHOLD_PX,
  shouldStart(event) {
    if (!isDashboard.value || mobileSidebarOpen.value) return false
    if (!isTouchLike.value || !isMobileViewport.value) return false
    if (!isWithinEdgeGuard(event, DASHBOARD_SWIPE_EDGE_GUARD_PX)) return false
    if (isInteractiveTarget(event)) return false
    if (hasBlockingOverlay()) return false
    return true
  },
  onSwipeEnd({ deltaX }) {
    if (deltaX >= PANEL_DISMISS_THRESHOLD_PX) {
      mobileSidebarOpen.value = true
    }
  },
})
</script>

<template>
  <a
    href="#main-content"
    data-testid="skip-to-content"
    class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
  >
    Skip to content
  </a>

  <UiSidebarProvider v-model:open-mobile="mobileSidebarOpen">
    <UiSidebar
      data-testid="app-sidebar"
      collapsible="icon"
      class="border-r border-sidebar-border"
    >
      <UiSidebarHeader class="px-3 py-4">
        <div class="flex items-center justify-between">
          <NuxtLink to="/" class="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:justify-center">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <BookOpen class="h-4 w-4" />
            </div>
            <div class="min-w-0 group-data-[collapsible=icon]:hidden">
              <p class="font-dm-sans text-lg font-bold tracking-tight text-sidebar-foreground">
                Budds
              </p>
              <p class="text-[10px] uppercase tracking-widest text-muted-foreground">
                Learning Compiler
              </p>
            </div>
          </NuxtLink>
          <UiButton
            variant="ghost"
            size="icon"
            data-testid="theme-toggle"
            class="h-7 w-7 text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden"
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
          </UiSidebarGroupLabel>
          <UiSidebarGroupContent>
            <div v-if="allFoldersLoading || !allFolders" class="space-y-1 px-3 py-2">
              <UiSkeleton v-for="i in 3" :key="i" class="h-7 w-full rounded-md" />
            </div>
            <template v-else-if="rootFolders.length > 0">
              <UiSidebarMenu>
                <UiSidebarMenuItem
                  v-for="folder in rootFolders"
                  :key="folder._id"
                  class="group/folder-item relative"
                >
                  <UiSidebarMenuButton
                    as-child
                    class="h-auto py-2 group-data-[collapsible=icon]:justify-center"
                    :tooltip="folder.name"
                    :is-active="currentFolderId === folder._id"
                    :data-testid="`sidebar-folder-${folder._id}`"
                  >
                    <NuxtLink
                      :to="`/app/folders/${folder._id}`"
                      class="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
                    >
                      <FoldersFolderBadge :color="folder.color ?? undefined" :icon="folder.icon ?? undefined" size="md" />
                      <span class="group-data-[collapsible=icon]:hidden">{{ folder.name }}</span>
                    </NuxtLink>
                  </UiSidebarMenuButton>
                  <UiDropdownMenu>
                    <UiDropdownMenuTrigger as-child>
                      <UiSidebarMenuAction
                        :data-testid="`sidebar-folder-actions-${folder._id}`"
                        class="opacity-0 transition-opacity group-hover/folder-item:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 group-data-[collapsible=icon]:hidden"
                      >
                        <MoreHorizontal class="h-4 w-4" />
                        <span class="sr-only">Folder actions</span>
                      </UiSidebarMenuAction>
                    </UiDropdownMenuTrigger>
                    <UiDropdownMenuContent align="end">
                      <UiDropdownMenuItem @select="openEditFolder(folder)">
                        <Pencil class="mr-2 h-4 w-4" />
                        Edit
                      </UiDropdownMenuItem>
                      <UiDropdownMenuItem @select="handleNewSubfolder(folder._id)">
                        <FolderPlus class="mr-2 h-4 w-4" />
                        New subfolder
                      </UiDropdownMenuItem>
                      <UiDropdownMenuItem
                        class="text-destructive focus:text-destructive"
                        @select="handleDeleteRequest({ _id: folder._id, name: folder.name })"
                      >
                        <Trash2 class="mr-2 h-4 w-4" />
                        Delete
                      </UiDropdownMenuItem>
                    </UiDropdownMenuContent>
                  </UiDropdownMenu>
                </UiSidebarMenuItem>
              </UiSidebarMenu>
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
      </UiSidebarContent>

      <div class="border-t border-sidebar-border p-3">
        <UiButton
          variant="default"
          data-testid="new-root-folder-button"
          class="w-full gap-2 rounded-xl group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          @click="openCreateFolder"
        >
          <FolderPlus class="h-4 w-4 shrink-0" />
          <span class="group-data-[collapsible=icon]:hidden">Create Folder</span>
        </UiButton>
      </div>

      <UiSidebarFooter class="border-t border-sidebar-border p-3">
        <UiButton
          variant="ghost"
          size="icon"
          data-testid="theme-toggle-collapsed"
          class="mb-2 hidden h-8 w-8 self-center text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:inline-flex"
          @click="toggleTheme"
        >
          <Sun v-if="mode === 'dark'" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
          <span class="sr-only">Toggle theme</span>
        </UiButton>
        <div class="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
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
            class="flex-1 truncate text-sm font-medium text-sidebar-foreground group-data-[collapsible=icon]:hidden"
          >
            {{ user?.name || 'User' }}
          </span>
          <UiDropdownMenu>
            <UiDropdownMenuTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                data-testid="sidebar-user-menu-trigger"
                class="h-7 w-7 text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden"
              >
                <MoreHorizontal class="h-4 w-4" />
                <span class="sr-only">User menu</span>
              </UiButton>
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent align="end" class="w-48">
              <UiDropdownMenuItem
                data-testid="sidebar-menu-sign-out"
                @click="onSignOut"
              >
                <LogOut class="mr-2 h-4 w-4" />
                Sign out
              </UiDropdownMenuItem>
              <UiDropdownMenuSeparator />
              <UiDropdownMenuItem
                data-testid="sidebar-menu-export-data"
                :disabled="isExportingData"
                @select.prevent="executeExportData"
              >
                <Download class="mr-2 h-4 w-4" />
                {{ isExportingData ? 'Exporting…' : 'Export my data' }}
              </UiDropdownMenuItem>
              <UiDropdownMenuItem
                data-testid="sidebar-menu-delete-account"
                class="text-destructive focus:text-destructive"
                @click="openDeleteAccountDialog"
              >
                <Trash2 class="mr-2 h-4 w-4" />
                Delete account
              </UiDropdownMenuItem>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
        </div>
      </UiSidebarFooter>
    </UiSidebar>

    <UiSidebarInset
      ref="mainContentRef"
      id="main-content"
      data-testid="main-content"
      :class="['min-h-0', isStandaloneRoute ? 'overflow-hidden' : 'overflow-y-auto']"
    >
      <header class="sticky top-0 z-20 shrink-0 flex items-center gap-2 border-b border-border bg-background/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <UiSidebarTrigger data-testid="sidebar-trigger" />

        <nav data-testid="breadcrumb-nav" class="flex-1">
          <UiBreadcrumb>
            <UiBreadcrumbList>
              <template v-if="isMobileView && !isDashboard">
                <UiBreadcrumbItem data-testid="breadcrumb-mobile">
                  <UiBreadcrumbLink as-child>
                    <NuxtLink to="/" data-testid="breadcrumb-back" class="flex items-center gap-1">
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
              <template v-else-if="isChatRoute">
                <UiBreadcrumbItem>
                  <UiBreadcrumbLink as-child>
                    <NuxtLink to="/">Home</NuxtLink>
                  </UiBreadcrumbLink>
                </UiBreadcrumbItem>
                <UiBreadcrumbSeparator />
                <UiBreadcrumbItem>
                  <UiBreadcrumbPage>General Chat</UiBreadcrumbPage>
                </UiBreadcrumbItem>
              </template>
              <template v-else-if="isFolderRoute">
                <UiBreadcrumbItem>
                  <UiBreadcrumbLink as-child>
                    <NuxtLink to="/">Home</NuxtLink>
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
                    <NuxtLink to="/">Home</NuxtLink>
                  </UiBreadcrumbLink>
                </UiBreadcrumbItem>
              </template>
            </UiBreadcrumbList>
          </UiBreadcrumb>
        </nav>
      </header>

      <div :class="['flex min-h-0 flex-1 flex-col', isDashboard ? '' : 'overflow-hidden']">
        <template v-if="isStandaloneRoute">
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

  <UiAlertDialog v-model:open="showDeleteAccountDialog">
    <UiAlertDialogContent data-testid="delete-account-dialog">
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>Delete your account?</UiAlertDialogTitle>
        <UiAlertDialogDescription>
          This will permanently delete your account, all folders, documents, chat history, quizzes, and flash cards. This action cannot be undone.
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <div class="grid gap-2 py-2">
        <label for="delete-account-confirm" class="text-sm text-muted-foreground">
          Type <span class="font-mono font-semibold text-foreground">DELETE</span> or your email to confirm.
        </label>
        <UiInput
          id="delete-account-confirm"
          v-model="deleteAccountConfirmInput"
          data-testid="delete-account-confirm-input"
          :disabled="isDeletingAccount"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          enterkeyhint="done"
          spellcheck="false"
        />
      </div>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel
          data-testid="delete-account-cancel-button"
          :disabled="isDeletingAccount"
        >
          Cancel
        </UiAlertDialogCancel>
        <UiAlertDialogAction
          data-testid="delete-account-confirm-button"
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
          :disabled="!canConfirmDeleteAccount || isDeletingAccount"
          @click="executeDeleteAccount"
        >
          {{ isDeletingAccount ? 'Deleting…' : 'Delete account' }}
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>

  <FoldersFolderFormModal
    v-model:open="showFolderModal"
    :mode="folderModalMode"
    :folder="editingFolder"
    :parent-id="folderModalParentId ?? undefined"
  />

</template>
