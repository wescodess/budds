<script setup lang="ts">
import { useColorMode, useMediaQuery } from '@vueuse/core'
import {
  FolderOpen,
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
          <UiSidebarGroupLabel>
            <FolderOpen class="mr-2 h-4 w-4" />
            Folders
          </UiSidebarGroupLabel>
          <UiSidebarGroupContent>
            <div
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
              <template v-if="isMobileView">
                <UiBreadcrumbItem data-testid="breadcrumb-mobile">
                  <UiBreadcrumbLink as-child>
                    <NuxtLink to="/app" data-testid="breadcrumb-back" class="flex items-center gap-1">
                      <ArrowLeft class="h-4 w-4" />
                      Home
                    </NuxtLink>
                  </UiBreadcrumbLink>
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
        <UiTabs v-model="activeTab" class="flex flex-1 flex-col">
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
</template>
