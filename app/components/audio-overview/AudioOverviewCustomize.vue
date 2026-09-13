<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { X, Sparkles, Clock, FolderTree } from '@lucide/vue'
import type { Id } from '../../../convex/_generated/dataModel'
import { AUDIO_OVERVIEW_PROFILE_CURRENT } from '~~/shared/audio-overview-profile'
import type { useReferenceScope } from '~/composables/useReferenceScope'
import type { Complexity, LengthMinutes, CustomizeSubmit } from './customize-types'

const props = withDefaults(defineProps<{
  open: boolean
  initialLengthMinutes?: LengthMinutes
  initialComplexity?: Complexity
  initialHostNames?: { hostA: string, hostB: string }
  submitting?: boolean
  submitLabel?: string
  quotaState?: { used: number, cap: number } | null
  folderScopeDocCount?: number
  folderScopeIsNarrowed?: boolean
  folderId?: Id<'folders'>
  scope?: ReturnType<typeof useReferenceScope>
}>(), {
  initialLengthMinutes: 10,
  initialComplexity: 'beginner',
  initialHostNames: () => ({ hostA: 'Maya', hostB: 'Leo' }),
  submitting: false,
  submitLabel: 'Generate',
  quotaState: null,
  folderScopeDocCount: 0,
  folderScopeIsNarrowed: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [value: CustomizeSubmit]
}>()

const length = ref<LengthMinutes>(props.initialLengthMinutes)
const complexity = ref<Complexity>(props.initialComplexity)
const hostAName = ref(props.initialHostNames.hostA)
const hostBName = ref(props.initialHostNames.hostB)

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      length.value = props.initialLengthMinutes
      complexity.value = props.initialComplexity
      hostAName.value = props.initialHostNames.hostA
      hostBName.value = props.initialHostNames.hostB
    }
  },
)

const lengthOptions: LengthMinutes[] = [5, 10, 20]
const complexityOptions: Complexity[] = ['beginner', 'expert']

function close() {
  if (props.submitting) return
  emit('update:open', false)
}

function handleSubmit() {
  if (props.submitting || !hostNamesValid.value) return
  emit('submit', {
    lengthMinutes: length.value,
    complexity: complexity.value,
    hostNames: { hostA: hostAName.value.trim(), hostB: hostBName.value.trim() },
  })
}

const hostNamesValid = computed(() => {
  const hostA = hostAName.value.trim()
  const hostB = hostBName.value.trim()
  const validName = (value: string) => /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,29}$/u.test(value)
  return validName(hostA) && validName(hostB)
    && hostA.toLocaleLowerCase() !== hostB.toLocaleLowerCase()
})

const quotaExceeded = computed(() => {
  const q = props.quotaState
  return q ? q.used >= q.cap : false
})

const scopePickerExpanded = ref(false)

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) scopePickerExpanded.value = false
  },
)
</script>

<template>
  <UiDialog :open="props.open" @update:open="(val) => emit('update:open', val)">
    <UiDialogContent
      data-testid="audio-overview-customize-dialog"
      class="max-w-[min(32rem,calc(100%-1rem))] gap-0 p-4 sm:max-w-[32rem] sm:p-6"
    >
      <UiDialogHeader class="space-y-1.5 pr-10">
        <UiDialogTitle class="font-dm-sans text-xl font-bold">
          Customize Audio Overview
        </UiDialogTitle>
        <UiDialogDescription
          v-if="quotaExceeded"
          data-testid="audio-overview-quota-exceeded-subtitle"
          class="font-inter text-[13px] text-rose-300"
        >
          You've hit the daily limit of {{ quotaState!.cap }} audio overviews.
        </UiDialogDescription>
        <UiDialogDescription
          v-else
          class="font-inter text-[13px] text-muted-foreground"
        >
          Two AI hosts will discuss this folder. Pick the vibe.
        </UiDialogDescription>
      </UiDialogHeader>

      <div
        v-if="quotaExceeded"
        data-testid="audio-overview-quota-banner"
        class="mt-4 flex items-start gap-2 rounded-lg border border-rose-400/40 bg-rose-950/25 p-3"
      >
        <Clock class="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
        <p class="font-inter text-[13px] text-foreground">
          Your daily reservation quota resets at midnight UTC. Come back tomorrow to create another Audio Overview.
        </p>
      </div>

      <div class="mt-5 space-y-4" :class="quotaExceeded ? 'opacity-40 pointer-events-none' : ''">
        <div v-if="props.folderScopeDocCount > 0 || props.scope" data-testid="audio-overview-customize-scope-section">
          <div
            data-testid="audio-overview-customize-scope-row"
            class="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
          >
            <FolderTree class="h-3.5 w-3.5 shrink-0 text-primary" />
            <p class="min-w-0 flex-1 truncate font-inter text-[12px] text-foreground">
              <span class="font-medium">Scope:</span>
              {{ props.folderScopeIsNarrowed ? `${props.folderScopeDocCount} selected` : `all ${props.folderScopeDocCount} docs in this folder` }}
            </p>
            <button
              v-if="props.scope && props.folderId"
              type="button"
              data-testid="audio-overview-customize-scope-toggle"
              class="shrink-0 font-inter text-[11px] font-medium text-primary hover:underline"
              @click="scopePickerExpanded = !scopePickerExpanded"
            >
              {{ scopePickerExpanded ? 'Close' : 'Edit scope' }}
            </button>
            <span v-else class="shrink-0 font-inter text-[11px] text-muted-foreground">
              Edit in chat input
            </span>
          </div>
          <div v-if="scopePickerExpanded && props.scope && props.folderId" class="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-background/40">
            <ChatDirectoryPicker
              :folder-id="props.folderId"
              :scope="props.scope"
              presentation="popover"
              @close="scopePickerExpanded = false"
            />
          </div>
        </div>

        <div data-testid="audio-overview-length">
          <p class="font-inter text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Length
          </p>
          <div class="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Length">
            <button
              v-for="opt in lengthOptions"
              :key="opt"
              type="button"
              role="radio"
              :aria-checked="length === opt"
              :data-testid="`audio-overview-length-${opt}`"
              :class="[
                'rounded-lg border px-3 py-2 font-inter text-sm font-medium transition-colors',
                length === opt
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/60 bg-transparent text-foreground hover:border-primary/40',
              ]"
              @click="length = opt"
            >
              {{ opt }} min
            </button>
          </div>
        </div>

        <div data-testid="audio-overview-complexity">
          <p class="font-inter text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Complexity
          </p>
          <div class="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Complexity">
            <button
              v-for="opt in complexityOptions"
              :key="opt"
              type="button"
              role="radio"
              :aria-checked="complexity === opt"
              :data-testid="`audio-overview-complexity-${opt}`"
              :class="[
                'rounded-lg border px-3 py-2 font-inter text-sm font-medium capitalize transition-colors',
                complexity === opt
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/60 bg-transparent text-foreground hover:border-primary/40',
              ]"
              @click="complexity = opt"
            >
              {{ opt }}
            </button>
          </div>
        </div>

        <div data-testid="audio-overview-voices">
          <p class="font-inter text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Managed voices
          </p>
          <p class="mt-1 font-inter text-[11px] text-muted-foreground">
            Fixed across every scene for consistent host identities.
          </p>
          <div class="mt-2 space-y-2 rounded-xl border border-border/60 bg-background/40 p-2">
            <div class="flex items-center gap-3 rounded-lg px-3 py-2">
              <span class="h-8 w-8 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <label for="audio-overview-host-a-name" class="font-dm-sans text-sm font-medium text-foreground">Expert host</label>
                <p class="font-inter text-[11px] text-muted-foreground">Speaks first</p>
              </div>
              <UiInput
                id="audio-overview-host-a-name"
                v-model="hostAName"
                data-testid="audio-overview-host-a-name"
                maxlength="30"
                class="h-9 w-28"
                aria-label="Expert host name"
              />
              <span class="rounded-lg border border-border/60 bg-background px-2.5 py-1.5 font-inter text-xs font-medium text-foreground">
                {{ AUDIO_OVERVIEW_PROFILE_CURRENT.hostA.voiceName }}
              </span>
            </div>
            <div class="flex items-center gap-3 rounded-lg px-3 py-2">
              <span class="h-8 w-8 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <label for="audio-overview-host-b-name" class="font-dm-sans text-sm font-medium text-foreground">Learner host</label>
                <p class="font-inter text-[11px] text-muted-foreground">Clarifying questions</p>
              </div>
              <UiInput
                id="audio-overview-host-b-name"
                v-model="hostBName"
                data-testid="audio-overview-host-b-name"
                maxlength="30"
                class="h-9 w-28"
                aria-label="Learner host name"
              />
              <span class="rounded-lg border border-border/60 bg-background px-2.5 py-1.5 font-inter text-xs font-medium text-foreground">
                {{ AUDIO_OVERVIEW_PROFILE_CURRENT.hostB.voiceName }}
              </span>
            </div>
          </div>
          <p v-if="!hostNamesValid" data-testid="audio-overview-host-names-error" class="mt-2 font-inter text-xs text-destructive">
            Enter two distinct names using letters, spaces, apostrophes, periods, or hyphens.
          </p>
        </div>
      </div>

      <UiDialogFooter class="mt-5 flex flex-col-reverse items-stretch gap-2 border-t border-border pt-4 sm:mt-6 sm:flex-row sm:items-center sm:justify-end sm:pt-5">
        <UiButton type="button" variant="ghost" class="w-full sm:w-auto" :disabled="props.submitting" @click="close">
          Cancel
        </UiButton>
        <UiButton
          type="button"
          data-testid="audio-overview-customize-submit"
          class="w-full sm:w-auto"
          :disabled="props.submitting || quotaExceeded || !hostNamesValid"
          @click="handleSubmit"
        >
          <Sparkles v-if="!quotaExceeded" class="mr-2 h-4 w-4" />
          {{ quotaExceeded ? 'Generate (quota reached)' : props.submitLabel }}
        </UiButton>
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
