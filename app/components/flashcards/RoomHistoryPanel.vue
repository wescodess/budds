<script setup lang="ts">
import { X, ChevronDown, RotateCcw, Sparkles, History } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  open: boolean
  roomId: Id<'flashcardRooms'>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { data: versionsData } = useConvexQuery(
  api.flashcardRooms.listRoomVersions,
  computed(() => ({ roomId: props.roomId })),
)

const versions = computed(() => (versionsData.value as any[] | undefined) ?? [])

const expandedVersionId = ref<Id<'flashcardRoomVersions'> | null>(null)
const restoreTargetId = ref<Id<'flashcardRoomVersions'> | null>(null)
const restoring = ref(false)

const { data: versionDetail } = useConvexQuery(
  api.flashcardRooms.getRoomVersion,
  computed(() => expandedVersionId.value ? { versionId: expandedVersionId.value } : 'skip'),
)

const restoreMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.restoreRoomVersion)
  : { mutate: async (_a: unknown) => null, isLoading: ref(false) }

function toggleExpand(id: Id<'flashcardRoomVersions'>) {
  expandedVersionId.value = expandedVersionId.value === id ? null : id
}

function openRestore(id: Id<'flashcardRoomVersions'>) {
  restoreTargetId.value = id
}

async function confirmRestore() {
  if (!restoreTargetId.value) return
  restoring.value = true
  try {
    await restoreMutation.mutate({ roomId: props.roomId, versionId: restoreTargetId.value } as any)
    const { toast } = await import('vue-sonner')
    toast.success('Version restored')
    restoreTargetId.value = null
    emit('update:open', false)
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Restore failed')
  }
  finally {
    restoring.value = false
  }
}

function formatDate(ts: number) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  catch {
    return ''
  }
}
</script>

<template>
  <UiSheet :open="props.open" @update:open="(v) => emit('update:open', v)">
    <UiSheetContent
      side="right"
      data-testid="flashcard-room-history-panel"
      class="w-[min(26rem,85vw)] gap-0 p-0"
    >
      <UiSheetHeader class="border-b border-border/60 p-5">
        <UiSheetTitle class="flex items-center gap-2 font-dm-sans text-lg">
          <History class="h-5 w-5 text-primary" />
          History
        </UiSheetTitle>
        <UiSheetDescription>
          Every generation and restore creates a new version. Restore any past version at any time.
        </UiSheetDescription>
      </UiSheetHeader>

      <div class="max-h-full flex-1 overflow-y-auto p-4">
        <div
          v-if="versions.length === 0"
          data-testid="flashcard-room-history-empty"
          class="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground"
        >
          No history yet — generate or manually edit cards to start versioning.
        </div>

        <ul v-else class="space-y-3">
          <li
            v-for="version in versions"
            :key="version._id"
            class="rounded-lg border border-border/60 bg-card"
            data-testid="flashcard-room-history-version"
          >
            <div class="flex items-start gap-3 p-3">
              <span
                :class="[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  version.origin === 'ai' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                ]"
              >
                <Sparkles v-if="version.origin === 'ai'" class="h-4 w-4" />
                <History v-else class="h-4 w-4" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate font-dm-sans text-sm font-semibold">{{ version.title }}</p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ formatDate(version._creationTime) }} • {{ version.cardCount }} cards
                </p>
              </div>
              <button
                type="button"
                class="rounded-md p-1 text-muted-foreground transition hover:bg-muted/60"
                :aria-label="expandedVersionId === version._id ? 'Collapse' : 'Expand'"
                data-testid="flashcard-room-history-expand"
                @click="toggleExpand(version._id)"
              >
                <ChevronDown
                  class="h-4 w-4 transition-transform"
                  :class="expandedVersionId === version._id ? 'rotate-180' : ''"
                />
              </button>
            </div>

            <div
              v-if="expandedVersionId === version._id"
              data-testid="flashcard-room-history-preview"
              class="border-t border-border/60 p-3"
            >
              <div v-if="!versionDetail || !Array.isArray(versionDetail.cards)" class="space-y-2">
                <UiSkeleton class="h-4 w-2/3" />
                <UiSkeleton class="h-4 w-full" />
              </div>
              <ol v-else class="space-y-1 text-xs">
                <li
                  v-for="(card, i) in versionDetail.cards.slice(0, 6)"
                  :key="card._id"
                  class="rounded-md border border-border/30 bg-background/40 px-2 py-1.5"
                >
                  <span class="font-medium">{{ i + 1 }}.</span>
                  {{ card.term }}
                </li>
                <li v-if="versionDetail.cards.length > 6" class="text-muted-foreground">
                  +{{ versionDetail.cards.length - 6 }} more
                </li>
              </ol>
              <div class="mt-3 flex justify-end">
                <UiButton
                  size="sm"
                  variant="outline"
                  data-testid="flashcard-room-history-restore"
                  @click="openRestore(version._id)"
                >
                  <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
                  Restore
                </UiButton>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <UiAlertDialog :open="restoreTargetId !== null" @update:open="(v) => { if (!v) restoreTargetId = null }">
        <UiAlertDialogContent>
          <UiAlertDialogHeader>
            <UiAlertDialogTitle>Restore this version?</UiAlertDialogTitle>
            <UiAlertDialogDescription>
              Your current cards will be archived to a new history version before the restore.
            </UiAlertDialogDescription>
          </UiAlertDialogHeader>
          <UiAlertDialogFooter>
            <UiAlertDialogCancel :disabled="restoring">Cancel</UiAlertDialogCancel>
            <UiAlertDialogAction
              data-testid="flashcard-room-history-restore-confirm"
              :disabled="restoring"
              @click="confirmRestore"
            >
              Restore
            </UiAlertDialogAction>
          </UiAlertDialogFooter>
        </UiAlertDialogContent>
      </UiAlertDialog>
    </UiSheetContent>
  </UiSheet>
</template>
