<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { X, Sparkles, ChevronDown, Clock } from 'lucide-vue-next'
import {
  ALL_VOICES,
  type HostVoice,
  type Complexity,
  type LengthMinutes,
  type CustomizeSubmit,
} from './customize-types'

const props = withDefaults(defineProps<{
  open: boolean
  initialLengthMinutes?: LengthMinutes
  initialComplexity?: Complexity
  initialVoiceA?: HostVoice
  initialVoiceB?: HostVoice
  submitting?: boolean
  submitLabel?: string
  quotaState?: { used: number, cap: number } | null
}>(), {
  initialLengthMinutes: 10,
  initialComplexity: 'beginner',
  initialVoiceA: 'asteria',
  initialVoiceB: 'orion',
  submitting: false,
  submitLabel: 'Generate',
  quotaState: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [value: CustomizeSubmit]
}>()

const length = ref<LengthMinutes>(props.initialLengthMinutes)
const complexity = ref<Complexity>(props.initialComplexity)
const voiceA = ref<HostVoice>(props.initialVoiceA)
const voiceB = ref<HostVoice>(props.initialVoiceB)

const voiceAOpen = ref(false)
const voiceBOpen = ref(false)

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      length.value = props.initialLengthMinutes
      complexity.value = props.initialComplexity
      voiceA.value = props.initialVoiceA
      voiceB.value = props.initialVoiceB
      voiceAOpen.value = false
      voiceBOpen.value = false
    }
  },
)

const lengthOptions: LengthMinutes[] = [5, 10, 20]
const complexityOptions: Complexity[] = ['beginner', 'expert']

function voiceLabel(v: HostVoice): string {
  return `EN-US · ${v.charAt(0).toUpperCase() + v.slice(1)}`
}

function close() {
  if (props.submitting) return
  emit('update:open', false)
}

function handleSubmit() {
  if (props.submitting) return
  emit('submit', {
    lengthMinutes: length.value,
    complexity: complexity.value,
    voiceProfile: { hostA: voiceA.value, hostB: voiceB.value },
  })
}

function pickVoiceA(v: HostVoice) { voiceA.value = v; voiceAOpen.value = false }
function pickVoiceB(v: HostVoice) { voiceB.value = v; voiceBOpen.value = false }

const complexityLabel = computed(() =>
  complexity.value === 'beginner' ? 'Beginner' : 'Expert',
)

const quotaExceeded = computed(() => {
  const q = props.quotaState
  return q ? q.used >= q.cap : false
})
</script>

<template>
  <UiDialog :open="props.open" @update:open="(val) => emit('update:open', val)">
    <UiDialogContent
      data-testid="audio-overview-customize-dialog"
      class="max-w-[min(32rem,calc(100%-1rem))] gap-0 p-6 sm:max-w-[32rem]"
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
          Your quota resets at midnight local time. Come back tomorrow, or delete an existing overview to free up a slot.
        </p>
      </div>

      <div class="mt-5 space-y-4" :class="quotaExceeded ? 'opacity-40 pointer-events-none' : ''">
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
            Voices
          </p>
          <div class="mt-2 space-y-2 rounded-xl border border-border/60 bg-background/40 p-2">
            <div class="flex items-center gap-3 rounded-lg px-3 py-2">
              <span class="h-8 w-8 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="font-dm-sans text-sm font-medium text-foreground">Host A · Expert</p>
                <p class="font-inter text-[11px] text-muted-foreground">Speaks first</p>
              </div>
              <div class="relative">
                <button
                  type="button"
                  data-testid="audio-overview-voice-a-trigger"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 font-inter text-xs font-medium text-foreground hover:border-primary/40"
                  @click="voiceAOpen = !voiceAOpen"
                >
                  {{ voiceLabel(voiceA) }}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <div
                  v-if="voiceAOpen"
                  data-testid="audio-overview-voice-a-menu"
                  class="absolute right-0 top-full z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded-lg border border-border/60 bg-card p-1 shadow-lg"
                >
                  <button
                    v-for="v in ALL_VOICES"
                    :key="v"
                    type="button"
                    :data-testid="`audio-overview-voice-a-${v}`"
                    :class="[
                      'block w-full rounded-md px-3 py-1.5 text-left font-inter text-xs',
                      v === voiceA ? 'bg-accent/20 text-primary' : 'text-foreground hover:bg-accent/10',
                    ]"
                    @click="pickVoiceA(v)"
                  >
                    {{ voiceLabel(v) }}
                  </button>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg px-3 py-2">
              <span class="h-8 w-8 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="font-dm-sans text-sm font-medium text-foreground">Host B · Learner</p>
                <p class="font-inter text-[11px] text-muted-foreground">Clarifying questions</p>
              </div>
              <div class="relative">
                <button
                  type="button"
                  data-testid="audio-overview-voice-b-trigger"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 font-inter text-xs font-medium text-foreground hover:border-primary/40"
                  @click="voiceBOpen = !voiceBOpen"
                >
                  {{ voiceLabel(voiceB) }}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <div
                  v-if="voiceBOpen"
                  data-testid="audio-overview-voice-b-menu"
                  class="absolute right-0 top-full z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded-lg border border-border/60 bg-card p-1 shadow-lg"
                >
                  <button
                    v-for="v in ALL_VOICES"
                    :key="v"
                    type="button"
                    :data-testid="`audio-overview-voice-b-${v}`"
                    :class="[
                      'block w-full rounded-md px-3 py-1.5 text-left font-inter text-xs',
                      v === voiceB ? 'bg-accent/20 text-primary' : 'text-foreground hover:bg-accent/10',
                    ]"
                    @click="pickVoiceB(v)"
                  >
                    {{ voiceLabel(v) }}
                  </button>
                </div>
              </div>
            </div>
          </div>
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
          :disabled="props.submitting || quotaExceeded"
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
