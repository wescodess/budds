<script setup lang="ts">
import { useTeachingQuery } from '~/composables/useTeachingQuery'

import { toast } from 'vue-sonner'
import { getErrorMessage } from '~~/shared/errors'
import { ChevronDown, CircleAlert, RotateCcw, Sparkles, History } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

const props = defineProps<{
  open: boolean
  roomId: Id<'flashcardRooms'>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const versionsQuery = useTeachingQuery(
  api.flashcardRooms.listRoomVersions,
  computed(() => ({ roomId: props.roomId })),
)

const versions = computed(() => versionsQuery.data.value ?? [])
const versionsFailure = computed(() => versionsQuery.failure.value)

const expandedVersionId = ref<Id<'flashcardRoomVersions'> | null>(null)
const restoreTargetId = ref<Id<'flashcardRoomVersions'> | null>(null)
const restoring = ref(false)

const versionDetailQuery = useTeachingQuery(
  api.flashcardRooms.getRoomVersion,
  computed(() => ({ versionId: expandedVersionId.value ?? undefined })),
)

const versionDetail = versionDetailQuery.data
const versionDetailFailure = computed(() => versionDetailQuery.failure.value)

watch(() => versionsFailure.value?.retryable === false, (paused) => {
  if (!paused) return
  expandedVersionId.value = null
  restoreTargetId.value = null
})

watch(() => versionDetailFailure.value?.retryable === false, (paused) => {
  if (paused) restoreTargetId.value = null
})

const restoreMutation = import.meta.client
  ? useConvexMutation(api.flashcardRooms.restoreRoomVersion)
  : createSsrMutationStub<typeof api.flashcardRooms.restoreRoomVersion>()

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
    await restoreMutation.mutate({ roomId: props.roomId, versionId: restoreTargetId.value })
    toast.success('Version restored')
    restoreTargetId.value = null
    emit('update:open', false)
  }
  catch (e) {
    toast.error(getErrorMessage(e, 'Restore failed'))
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
        <p v-if="versionsFailure && !versionsFailure.retryable" role="status" data-testid="flashcard-history-read-paused" class="flex items-start gap-2 rounded-lg border border-border px-4 py-3 text-sm leading-6 text-foreground forced-colors:border-current"><CircleAlert class="mt-1 size-4 shrink-0 text-[var(--learn-attention)]" aria-hidden="true" /><span class="min-w-0">{{ versionsFailure.message }}</span></p>
        <div v-else-if="versionsFailure" role="alert" data-testid="flashcard-history-read-error" class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive forced-colors:border-current"><p>Could not load version history.</p><button type="button" data-testid="flashcard-history-read-retry" class="mt-2 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="versionsQuery.refresh?.()">Try again</button></div>
        <div
          v-else-if="versions.length === 0"
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
              <p v-if="versionDetailFailure && !versionDetailFailure.retryable" role="status" data-testid="flashcard-version-read-paused" class="flex items-start gap-2 rounded-lg border border-border px-4 py-3 text-sm leading-6 text-foreground forced-colors:border-current"><CircleAlert class="mt-1 size-4 shrink-0 text-[var(--learn-attention)]" aria-hidden="true" /><span class="min-w-0">{{ versionDetailFailure.message }}</span></p>
              <div v-else-if="versionDetailFailure" role="alert" data-testid="flashcard-version-read-error" class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive forced-colors:border-current"><p>Could not load this version.</p><button type="button" data-testid="flashcard-version-read-retry" class="mt-2 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="versionDetailQuery.refresh?.()">Try again</button></div>
              <div v-else-if="!versionDetail || !Array.isArray(versionDetail.cards)" class="space-y-2">
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
