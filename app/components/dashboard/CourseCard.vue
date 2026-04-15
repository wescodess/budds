<script setup lang="ts">
import { useTimeAgo } from '@vueuse/core'
import { MessageSquare, BookOpen } from 'lucide-vue-next'

const props = defineProps<{
  folder: {
    _id: string
    _creationTime: number
    name: string
    documentCount: number
    updatedAt?: number
    color?: string
    icon?: string
  }
}>()

const lastActivity = useTimeAgo(() => props.folder.updatedAt ?? props.folder._creationTime)
</script>

<template>
  <NuxtLink :to="`/app/folders/${folder._id}`" class="group" data-testid="course-card">
    <UiCard class="h-[140px] border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div class="flex h-full flex-col justify-between">
        <div class="grid grid-cols-[3.5rem,1fr] items-start gap-3">
          <div class="flex min-w-0 flex-col items-start gap-2">
            <FoldersFolderBadge :color="folder.color" :icon="folder.icon" size="md" />
            <span
              class="font-inter text-[11px] leading-tight text-muted-foreground"
              data-testid="folder-doc-count"
            >
              {{ folder.documentCount }} {{ folder.documentCount === 1 ? 'doc' : 'docs' }}
            </span>
          </div>
          <div class="min-w-0 pt-0.5">
            <p class="line-clamp-2 font-dm-sans text-sm font-medium text-foreground">{{ folder.name }}</p>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="font-inter text-xs font-medium text-muted-foreground" data-testid="folder-last-activity">
            {{ lastActivity }}
          </span>
          <div class="flex gap-1">
            <UiButton variant="ghost" size="icon" class="h-7 w-7" data-testid="quick-action-chat" @click.prevent>
              <MessageSquare class="h-3.5 w-3.5" />
              <span class="sr-only">Chat</span>
            </UiButton>
            <UiButton variant="ghost" size="icon" class="h-7 w-7" data-testid="quick-action-cards" @click.prevent>
              <BookOpen class="h-3.5 w-3.5" />
              <span class="sr-only">Flash Cards</span>
            </UiButton>
          </div>
        </div>
      </div>
    </UiCard>
  </NuxtLink>
</template>
