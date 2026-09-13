<script setup lang="ts">
import { computed } from 'vue'
import { FolderPlus } from '@lucide/vue'
import type { Doc } from '~~/convex/_generated/dataModel'

const props = defineProps<{
  folders: Doc<'folders'>[] | null
  loading: boolean
  activeRootId: string | null
  isHome: boolean
}>()

defineEmits<{
  (e: 'create'): void
}>()

const rootFolders = computed(() => {
  if (!props.folders) return []
  return props.folders.filter((f) => !f.parentId)
})
</script>

<template>
  <nav
    data-testid="sidebar-home-rail"
    aria-label="Primary"
    class="flex h-full w-full flex-col items-center gap-1 py-3"
  >
    <UiTooltip>
      <UiTooltipTrigger as-child>
        <NuxtLink
          to="/"
          data-testid="rail-home-link"
          :data-active="isHome ? 'true' : undefined"
          class="relative flex h-10 w-10 items-center justify-center rounded-lg font-dm-sans text-base font-bold text-sidebar-foreground transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:before:absolute data-[active=true]:before:-left-1.5 data-[active=true]:before:top-2 data-[active=true]:before:h-6 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary"
        >
          <span class="text-primary">B</span>
          <span class="sr-only">Home</span>
        </NuxtLink>
      </UiTooltipTrigger>
      <UiTooltipContent side="right">Home</UiTooltipContent>
    </UiTooltip>

    <UiSeparator class="my-2 w-6" />

    <div
      data-testid="rail-folders"
      class="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <template v-if="loading">
        <UiSkeleton
          v-for="i in 3"
          :key="`rail-skel-${i}`"
          class="h-7 w-7 rounded-[10px]"
        />
      </template>

      <template v-else>
        <UiTooltip
          v-for="folder in rootFolders"
          :key="folder._id"
        >
          <UiTooltipTrigger as-child>
            <NuxtLink
              :to="`/app/folders/${folder._id}`"
              :data-testid="`rail-folder-${folder._id}`"
              :data-active="activeRootId === folder._id ? 'true' : undefined"
              class="relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:before:absolute data-[active=true]:before:-left-1.5 data-[active=true]:before:top-2 data-[active=true]:before:h-6 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary"
            >
              <FoldersFolderBadge
                :color="folder.color"
                :icon="folder.icon"
                size="md"
              />
              <span class="sr-only">{{ folder.name }}</span>
            </NuxtLink>
          </UiTooltipTrigger>
          <UiTooltipContent side="right">{{ folder.name }}</UiTooltipContent>
        </UiTooltip>

        <UiTooltip>
          <UiTooltipTrigger as-child>
            <button
              type="button"
              data-testid="rail-create-folder"
              class="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              @click="$emit('create')"
            >
              <FolderPlus class="h-4 w-4" />
              <span class="sr-only">{{ rootFolders.length === 0 ? 'Create your first folder' : 'New folder' }}</span>
            </button>
          </UiTooltipTrigger>
          <UiTooltipContent side="right">
            {{ rootFolders.length === 0 ? 'Create your first folder' : 'New folder' }}
          </UiTooltipContent>
        </UiTooltip>
      </template>
    </div>
  </nav>
</template>
