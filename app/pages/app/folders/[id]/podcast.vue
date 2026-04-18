<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import AudioOverviewShell from '~/components/audio-overview/AudioOverviewShell.vue'
import type { Id } from '~~/convex/_generated/dataModel'

definePageMeta({
  layout: false,
  auth: 'user' as const,
})

const route = useRoute()
const folderId = computed(() => {
  const raw = route.params.id
  const id = typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw[0] ?? '') : ''
  return id as Id<'folders'>
})

const { allFolders } = useFolders()
const folderName = computed(() => {
  const fid = folderId.value
  if (!fid) return ''
  const match = (allFolders.value ?? []).find((f: any) => f._id === fid)
  return match?.name ?? 'Folder'
})

useHead({
  title: computed(() => folderName.value ? `${folderName.value} · Audio Overview` : 'Audio Overview'),
  meta: [
    { name: 'description', content: 'Listen to an audio overview on Budds.' },
    { name: 'robots', content: 'noindex' },
  ],
})

function handleBack() {
  const fid = folderId.value
  if (!fid) { void navigateTo('/'); return }
  void navigateTo(`/app/folders/${fid}`)
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background text-foreground">
    <header class="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <button
        type="button"
        data-testid="podcast-expand-back"
        aria-label="Back to chat"
        class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-inter text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground"
        @click="handleBack"
      >
        <ArrowLeft class="h-3.5 w-3.5" />
        Back to chat
      </button>
      <span class="ml-1 truncate font-dm-sans text-sm font-medium text-foreground">
        {{ folderName }}
      </span>
    </header>
    <div class="flex min-h-0 flex-1 flex-col">
      <AudioOverviewShell :folder-id="folderId" />
    </div>
  </div>
</template>
