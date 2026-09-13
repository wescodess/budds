<script setup lang="ts">
import { getErrorMessage } from '~~/shared/errors'
import { ref, computed } from 'vue'
import { X, Link2, Copy, Check, ShieldAlert, Sparkles } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

const props = defineProps<{
  open: boolean
  overviewId: Id<'audioOverviews'>
  shareToken?: string | null
  publishedAt?: number | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const publishMutation = import.meta.client
  ? useConvexMutation(api.audioOverviews.publishOverview)
  : createSsrMutationStub<typeof api.audioOverviews.publishOverview>()

const unpublishMutation = import.meta.client
  ? useConvexMutation(api.audioOverviews.unpublishOverview)
  : createSsrMutationStub<typeof api.audioOverviews.unpublishOverview>()

const submitting = ref(false)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function clearCopiedTimer() {
  if (copiedTimer) {
    clearTimeout(copiedTimer)
    copiedTimer = null
  }
}

const origin = computed(() => {
  if (!import.meta.client) return ''
  return window.location.origin
})

const shareUrl = computed(() => {
  if (!props.shareToken) return ''
  return `${origin.value}/audio/${props.shareToken}`
})

const publishedLabel = computed(() => {
  if (!props.publishedAt) return ''
  const d = new Date(props.publishedAt)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
})

function close() {
  if (submitting.value) return
  clearCopiedTimer()
  copied.value = false
  emit('update:open', false)
}

async function handlePublish() {
  if (submitting.value) return
  submitting.value = true
  try {
    await publishMutation.mutate({ id: props.overviewId })
  }
  catch (err) {
    const { toast } = await import('vue-sonner')
    toast.error(getErrorMessage(err, 'Failed to create share link'))
  }
  finally {
    submitting.value = false
  }
}

async function handleUnpublish() {
  if (submitting.value) return
  submitting.value = true
  try {
    await unpublishMutation.mutate({ id: props.overviewId })
    clearCopiedTimer()
    copied.value = false
    const { toast } = await import('vue-sonner')
    toast.success('Share link revoked')
  }
  catch (err) {
    const { toast } = await import('vue-sonner')
    toast.error(getErrorMessage(err, 'Failed to revoke share link'))
  }
  finally {
    submitting.value = false
  }
}

async function handleCopy() {
  if (!shareUrl.value || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    clearCopiedTimer()
    copied.value = true
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 2000)
  }
  catch {
    const { toast } = await import('vue-sonner')
    toast.error('Could not copy link — copy it manually')
  }
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="(val) => emit('update:open', val)">
    <UiDialogContent
      data-testid="audio-overview-share-dialog"
      class="max-w-[min(30rem,calc(100%-1rem))] gap-0 p-6 sm:max-w-[30rem]"
    >
      <UiDialogHeader class="space-y-1.5 pr-10">
        <UiDialogTitle class="font-dm-sans text-xl font-bold">
          Share Audio Overview
        </UiDialogTitle>
        <UiDialogDescription class="font-inter text-[13px] text-muted-foreground">
          <template v-if="props.shareToken">
            Anyone with this link can listen. Revoke any time.
          </template>
          <template v-else>
            Create a public link so anyone can listen — you stay in control and can revoke any time.
          </template>
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="mt-5 space-y-4">
        <template v-if="props.shareToken">
          <div class="flex items-center gap-2 rounded-lg border border-border/60 bg-background p-1 pl-3">
            <Link2 class="h-3.5 w-3.5 shrink-0 text-primary" />
            <span
              data-testid="audio-overview-share-url"
              class="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
            >
              {{ shareUrl }}
            </span>
            <UiButton
              type="button"
              size="sm"
              data-testid="audio-overview-share-copy-btn"
              class="h-8 shrink-0"
              :disabled="submitting"
              @click="handleCopy"
            >
              <Check v-if="copied" class="mr-1.5 h-3.5 w-3.5" />
              <Copy v-else class="mr-1.5 h-3.5 w-3.5" />
              {{ copied ? 'Copied' : 'Copy' }}
            </UiButton>
          </div>

          <p v-if="publishedLabel" class="font-inter text-[11px] text-muted-foreground">
            Shared on {{ publishedLabel }}
          </p>

          <div class="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-950/20 p-3">
            <ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <p class="font-inter text-xs text-foreground">
              Anyone with this link can play, download, or share this audio overview. They cannot access the original folder or documents.
            </p>
          </div>
        </template>

        <template v-else>
          <div class="rounded-lg border border-border/60 bg-background p-4">
            <div class="flex items-start gap-3">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <Link2 class="h-4 w-4 text-primary" />
              </div>
              <div class="min-w-0">
                <p class="font-dm-sans text-sm font-medium text-foreground">
                  No share link yet
                </p>
                <p class="mt-1 font-inter text-[12px] text-muted-foreground">
                  A share link is a one-URL, revokable invitation to listen. It does not expose your folder or documents.
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>

      <UiDialogFooter class="mt-6 flex flex-col-reverse items-stretch gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        <template v-if="props.shareToken">
          <UiButton
            type="button"
            variant="ghost"
            class="border border-destructive/40 text-destructive hover:bg-destructive/10 sm:w-auto"
            data-testid="audio-overview-share-unshare-btn"
            :disabled="submitting"
            @click="handleUnpublish"
          >
            Unshare
          </UiButton>
          <UiButton type="button" class="sm:w-auto" :disabled="submitting" @click="close">
            Done
          </UiButton>
        </template>
        <template v-else>
          <UiButton type="button" variant="ghost" class="sm:w-auto" :disabled="submitting" @click="close">
            Cancel
          </UiButton>
          <UiButton
            type="button"
            data-testid="audio-overview-share-publish-btn"
            class="sm:w-auto"
            :disabled="submitting"
            @click="handlePublish"
          >
            <Sparkles class="mr-2 h-4 w-4" />
            {{ submitting ? 'Creating link…' : 'Create share link' }}
          </UiButton>
        </template>
      </UiDialogFooter>

      <UiDialogClose
        class="absolute right-4 top-4 rounded-md text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close"
      >
        <X class="h-4 w-4" />
      </UiDialogClose>
    </UiDialogContent>
  </UiDialog>
</template>
