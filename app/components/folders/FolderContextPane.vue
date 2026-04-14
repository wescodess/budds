<script setup lang="ts">
import { MoreHorizontal, FolderPlus, Pencil, Trash2 } from 'lucide-vue-next'
import type { Doc } from '~~/convex/_generated/dataModel'

defineProps<{
  folder: Doc<'folders'> | null
  ancestors?: Array<{ _id: string; name: string }>
  canCreateSubfolder?: boolean
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  newSubfolder: []
}>()
</script>

<template>
  <aside
    data-testid="folder-context-pane"
    class="flex h-full w-full flex-col gap-4 overflow-y-auto border-r bg-background p-4"
  >
    <header class="flex items-start gap-3">
      <FoldersFolderBadge
        v-if="folder"
        :color="folder.color"
        :icon="folder.icon"
        size="md"
      />
      <UiSkeleton v-else class="h-7 w-7 rounded-md" />
      <div class="min-w-0 flex-1">
        <UiSkeleton v-if="!folder" class="h-5 w-32 rounded-md" />
        <div v-else data-testid="folder-heading">
          <h2
            data-testid="folder-context-name"
            class="truncate text-lg font-bold tracking-tight"
          >
            {{ folder.name }}
          </h2>
        </div>
        <p
          v-if="ancestors && ancestors.length"
          class="mt-0.5 truncate text-xs text-muted-foreground"
        >
          <span v-for="(a, i) in ancestors" :key="a._id">
            {{ a.name }}<span v-if="i < ancestors.length - 1"> / </span>
          </span>
        </p>
      </div>
      <UiDropdownMenu>
        <UiDropdownMenuTrigger as-child>
          <button
            type="button"
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Folder menu"
            data-testid="folder-context-menu"
          >
            <MoreHorizontal class="h-4 w-4" />
          </button>
        </UiDropdownMenuTrigger>
        <UiDropdownMenuContent align="end">
          <UiDropdownMenuItem data-testid="folder-context-edit" @click="emit('edit')">
            <Pencil class="mr-2 h-4 w-4" />
            Edit folder
          </UiDropdownMenuItem>
          <UiDropdownMenuItem
            v-if="canCreateSubfolder"
            data-testid="folder-context-new-subfolder"
            @click="emit('newSubfolder')"
          >
            <FolderPlus class="mr-2 h-4 w-4" />
            New subfolder
          </UiDropdownMenuItem>
          <UiDropdownMenuSeparator />
          <UiDropdownMenuItem
            class="text-destructive focus:text-destructive"
            data-testid="folder-context-delete"
            @click="emit('delete')"
          >
            <Trash2 class="mr-2 h-4 w-4" />
            Delete folder
          </UiDropdownMenuItem>
        </UiDropdownMenuContent>
      </UiDropdownMenu>
    </header>

    <section
      data-testid="folder-context-knowledge"
      class="flex min-h-0 flex-1 flex-col rounded-xl border bg-card p-3"
    >
      <slot name="knowledge">
        <div data-testid="folder-context-knowledge-placeholder" class="space-y-2">
          <div v-for="i in 3" :key="i" class="h-3 w-full rounded bg-muted/60" />
        </div>
      </slot>
    </section>
  </aside>
</template>
