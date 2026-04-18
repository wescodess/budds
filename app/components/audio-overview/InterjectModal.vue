<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { X, Mic, MessageSquare, Sparkles, Square, AlertCircle, Loader2 } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'

type SubmittedPayload = {
  interjectionId: Id<'audioOverviewInterjections'>
  insertedAfterTurnIndex: number
  turns: Array<{
    speaker: 'host_a' | 'host_b'
    text: string
    audioFileId: Id<'_storage'>
    durationMs: number
    sourceIndex?: number
  }>
  turnUrls: (string | null)[]
}

const props = withDefaults(defineProps<{
  open: boolean
  overviewId: Id<'audioOverviews'>
  afterIndex: number
}>(), {
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'submit-start': [value: { question: string }]
  submitted: [value: SubmittedPayload]
  aborted: []
}>()

type Mode = 'text' | 'voice'
type Status = 'idle' | 'listening' | 'submitting'

const mode = ref<Mode>('text')
const status = ref<Status>('idle')
const question = ref('')
const maxLength = 500

const voiceSupported = ref(false)
let recognition: any = null
let abortController: AbortController | null = null

if (import.meta.client) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  voiceSupported.value = !!SR
}

function createRecognition(): any {
  if (!import.meta.client) return null
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) return null
  const r = new SR()
  r.lang = 'en-US'
  r.continuous = true
  r.interimResults = true
  return r
}

function stopRecognition() {
  if (recognition) {
    try {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.stop()
    }
    catch { /* ignore */ }
    recognition = null
  }
}

function abortPendingSubmit() {
  if (abortController) {
    try { abortController.abort() } catch { /* ignore */ }
    abortController = null
  }
}

function startListening() {
  if (!voiceSupported.value) return
  stopRecognition()
  recognition = createRecognition()
  if (!recognition) return

  status.value = 'listening'
  recognition.onresult = (event: any) => {
    let transcript = ''
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript
    }
    question.value = transcript.slice(0, maxLength)
  }
  recognition.onerror = () => {
    status.value = 'idle'
    stopRecognition()
  }
  recognition.onend = () => {
    if (status.value === 'listening') {
      status.value = 'idle'
    }
    recognition = null
  }
  try { recognition.start() }
  catch {
    status.value = 'idle'
    recognition = null
  }
}

function stopListening() {
  stopRecognition()
  status.value = 'idle'
}

function setMode(next: Mode) {
  if (status.value === 'submitting') return
  if (next === 'voice' && !voiceSupported.value) return
  mode.value = next
  if (next === 'text' && status.value === 'listening') {
    stopListening()
  }
}

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      mode.value = 'text'
      status.value = 'idle'
      question.value = ''
    }
    else if (!isOpen && wasOpen) {
      stopListening()
      if (status.value === 'submitting') {
        abortPendingSubmit()
        emit('aborted')
      }
      status.value = 'idle'
    }
  },
)

onUnmounted(() => {
  stopListening()
  abortPendingSubmit()
})

function close() {
  stopListening()
  if (status.value === 'submitting') {
    abortPendingSubmit()
    emit('aborted')
    status.value = 'idle'
  }
  emit('update:open', false)
}

const canSubmit = computed(() =>
  status.value === 'idle' && question.value.trim().length > 0,
)

const characterCount = computed(() => question.value.length)

async function handleSubmit() {
  const trimmed = question.value.trim()
  if (!trimmed || status.value === 'submitting') return
  stopListening()
  status.value = 'submitting'
  emit('submit-start', { question: trimmed })

  abortPendingSubmit()
  abortController = new AbortController()
  const localController = abortController
  const timeout = setTimeout(() => localController.abort(), 20_000)

  try {
    const result = await $fetch<{
      interjectionId: Id<'audioOverviewInterjections'>
      insertedAfterTurnIndex: number
      turns: Array<{
        speaker: 'host_a' | 'host_b'
        text: string
        audioFileId: Id<'_storage'>
        durationMs: number
        sourceIndex?: number
        audioUrl: string | null
      }>
      totalDurationMs: number
    }>('/api/audio-overview/interject', {
      method: 'POST',
      body: {
        overviewId: props.overviewId,
        insertedAfterTurnIndex: props.afterIndex,
        question: trimmed,
      },
      signal: localController.signal as any,
    })

    const mappedTurns = result.turns.map(t => ({
      speaker: t.speaker,
      text: t.text,
      audioFileId: t.audioFileId,
      durationMs: t.durationMs,
      sourceIndex: t.sourceIndex,
    }))
    const turnUrls = result.turns.map(t => t.audioUrl)

    emit('submitted', {
      interjectionId: result.interjectionId,
      insertedAfterTurnIndex: result.insertedAfterTurnIndex,
      turns: mappedTurns,
      turnUrls,
    })
    emit('update:open', false)
  }
  catch (err: any) {
    if (localController.signal.aborted) {
      emit('aborted')
    }
    else {
      const { toast } = await import('vue-sonner')
      toast.error(err?.data?.message ?? err?.message ?? 'Interjection failed')
      emit('aborted')
    }
    status.value = 'idle'
  }
  finally {
    clearTimeout(timeout)
    if (abortController === localController) abortController = null
  }
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="(val) => emit('update:open', val)">
    <UiDialogContent
      data-testid="audio-overview-interject-dialog"
      class="max-w-[min(30rem,calc(100%-1rem))] gap-0 p-6 sm:max-w-[30rem]"
    >
      <UiDialogHeader class="space-y-1.5 pr-10">
        <UiDialogTitle class="font-dm-sans text-xl font-bold">
          Ask the hosts
        </UiDialogTitle>
        <UiDialogDescription class="font-inter text-[13px] text-muted-foreground">
          Interrupt with a follow-up. The hosts will answer before the podcast continues.
        </UiDialogDescription>
      </UiDialogHeader>

      <div
        v-if="status !== 'submitting'"
        class="mt-4 flex gap-2"
        role="tablist"
        aria-label="Input mode"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'text'"
          data-testid="audio-overview-interject-mode-text"
          :class="[
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-inter text-xs font-medium transition-colors',
            mode === 'text'
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 bg-transparent text-foreground hover:border-primary/40',
          ]"
          @click="setMode('text')"
        >
          <MessageSquare class="h-3.5 w-3.5" />
          Type
        </button>
        <button
          v-if="voiceSupported"
          type="button"
          role="tab"
          :aria-selected="mode === 'voice'"
          data-testid="audio-overview-interject-mode-voice"
          :class="[
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-inter text-xs font-medium transition-colors',
            mode === 'voice'
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 bg-transparent text-foreground hover:border-primary/40',
          ]"
          @click="setMode('voice')"
        >
          <Mic class="h-3.5 w-3.5" />
          Speak
        </button>
      </div>

      <p
        v-if="status !== 'submitting' && !voiceSupported"
        data-testid="audio-overview-interject-voice-unsupported"
        class="mt-2 font-inter text-[11px] text-muted-foreground"
      >
        (voice not supported on this browser)
      </p>

      <div v-if="status === 'submitting'" class="mt-5 space-y-3">
        <div class="rounded-lg border border-border/60 bg-background/40 p-3">
          <p class="font-inter text-[11px] font-medium uppercase tracking-wide text-muted-foreground">You asked</p>
          <p class="mt-1 font-dm-sans text-sm italic text-foreground">{{ question }}</p>
        </div>
        <div class="flex items-center justify-center gap-2 py-6">
          <Loader2 class="h-5 w-5 animate-spin text-primary" />
          <span class="font-inter text-sm text-foreground">Hosts are answering…</span>
        </div>
        <p class="text-center font-inter text-[12px] text-muted-foreground">
          This takes about 5–10 seconds.
        </p>
      </div>

      <div v-else-if="mode === 'text'" class="mt-4 space-y-2">
        <textarea
          v-model="question"
          :maxlength="maxLength"
          rows="4"
          data-testid="audio-overview-interject-textarea"
          placeholder="What's confusing? What follow-up should the hosts dig into?"
          class="w-full rounded-lg border border-border/60 bg-background p-3 font-inter text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div class="flex items-center justify-between">
          <span class="inline-flex items-center gap-1.5 font-inter text-[11px] text-muted-foreground">
            <AlertCircle class="h-3 w-3" />
            Takes about 5–10 seconds. Playback pauses while we listen.
          </span>
          <span class="font-inter text-[11px] tabular-nums text-muted-foreground">
            {{ characterCount }} / {{ maxLength }}
          </span>
        </div>
      </div>

      <div v-else class="mt-4 flex flex-col items-center gap-4 py-2">
        <div class="relative flex h-24 w-24 items-center justify-center">
          <span
            v-if="status === 'listening'"
            class="pointer-events-none absolute h-24 w-24 rounded-full border border-primary/40"
            style="animation: interjectionPulse 1.6s ease-out infinite"
            aria-hidden="true"
          />
          <span
            class="h-24 w-24 rounded-full bg-primary"
            :class="status === 'listening' ? 'shadow-[0_0_32px_rgba(245,158,11,0.55)]' : ''"
            aria-hidden="true"
          />
          <span
            v-if="status === 'listening'"
            class="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive"
            aria-hidden="true"
          />
        </div>
        <div class="text-center">
          <p class="font-dm-sans text-base font-semibold"
            :class="status === 'listening' ? 'text-primary' : 'text-foreground'"
          >
            {{ status === 'listening' ? 'Listening…' : 'Tap the mic to speak' }}
          </p>
          <p class="mt-1 font-inter text-[11px] text-muted-foreground">
            {{ status === 'listening' ? 'Speak normally, then stop & ask.' : 'Your transcript will appear below.' }}
          </p>
        </div>
        <div class="min-h-[60px] w-full rounded-lg border border-border/60 bg-background p-3">
          <p
            data-testid="audio-overview-interject-transcript"
            class="font-inter text-sm text-foreground"
          >
            {{ question || '…' }}
          </p>
        </div>
      </div>

      <UiDialogFooter class="mt-6 flex flex-col-reverse items-stretch gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        <UiButton
          type="button"
          variant="ghost"
          class="sm:w-auto"
          data-testid="audio-overview-interject-cancel-btn"
          @click="close"
        >
          Cancel
        </UiButton>

        <UiButton
          v-if="status === 'submitting'"
          type="button"
          disabled
          class="sm:w-auto"
        >
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          Asking…
        </UiButton>

        <template v-else-if="mode === 'voice'">
          <UiButton
            v-if="status === 'listening'"
            type="button"
            class="sm:w-auto"
            data-testid="audio-overview-interject-stop-btn"
            @click="stopListening"
          >
            <Square class="mr-2 h-4 w-4" />
            Stop & ask
          </UiButton>
          <UiButton
            v-else
            type="button"
            class="sm:w-auto"
            data-testid="audio-overview-interject-record-btn"
            @click="startListening"
          >
            <Mic class="mr-2 h-4 w-4" />
            Record
          </UiButton>
          <UiButton
            v-if="status !== 'listening' && canSubmit"
            type="button"
            class="sm:w-auto"
            data-testid="audio-overview-interject-submit-btn"
            :disabled="!canSubmit"
            @click="handleSubmit"
          >
            <Sparkles class="mr-2 h-4 w-4" />
            Ask
          </UiButton>
        </template>

        <UiButton
          v-else
          type="button"
          class="sm:w-auto"
          data-testid="audio-overview-interject-submit-btn"
          :disabled="!canSubmit"
          @click="handleSubmit"
        >
          <Sparkles class="mr-2 h-4 w-4" />
          Ask
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

<style scoped>
@keyframes interjectionPulse {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(1.35); opacity: 0;   }
}
</style>
