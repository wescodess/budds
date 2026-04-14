<script setup lang="ts">
import { UserPlus, Crown } from 'lucide-vue-next'
import type { Doc } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellMembersPanel' })

defineProps<{
  folder: Doc<'folders'> | null
}>()

const { user } = useUserSession()

const ownerName = computed(() => {
  const u = user.value as any
  return u?.name || u?.email || 'You'
})
const ownerEmail = computed(() => (user.value as any)?.email ?? '')
const ownerInitial = computed(() => ownerName.value.slice(0, 1).toUpperCase())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <section class="px-5 pt-4 pb-2">
      <div class="flex items-center justify-between">
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">People with access</p>
        <span class="text-[10px] text-muted-foreground">Inherits to subfolders</span>
      </div>
    </section>

    <section class="px-3">
      <div class="px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Owner</div>
      <div class="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          {{ ownerInitial }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-foreground">{{ ownerName }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ ownerEmail || 'Workspace owner' }}</p>
        </div>
        <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <Crown class="h-3 w-3" /> Owner
        </span>
      </div>
    </section>

    <div class="mx-5 my-4 border-t border-border/60" />

    <section class="flex-1 px-5 pb-4">
      <div class="flex items-center justify-between pb-2">
        <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Members</div>
        <UiButton variant="ghost" size="sm" disabled class="gap-1.5 text-primary">
          <UserPlus class="h-3.5 w-3.5" /> Invite
        </UiButton>
      </div>
      <div class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 px-6 py-10 text-center">
        <p class="text-sm font-medium text-foreground">No members yet</p>
        <p class="max-w-xs text-xs text-muted-foreground">
          Invite collaborators to share "{{ folder?.name ?? 'this folder' }}" and all its subfolders. Coming soon.
        </p>
      </div>
    </section>
  </div>
</template>
