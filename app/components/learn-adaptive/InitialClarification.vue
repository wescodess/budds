<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { CLARIFICATION_MAX_ANSWER_BYTES } from '~~/shared/learn-adaptive-clarification'

type Decision = {
  status: 'not_required' | 'pending' | 'answered' | 'skipped'
  continuationKind: 'ready_v2' | 'standalone_non_factual' | 'preparing_non_factual' | 'evidence_recovery'
  reasonCode?: string
  question?: { key: 'useful_outcome', templateVersion: string, prompt: string, help: string }
}

const props = withDefaults(defineProps<{ originalNeed: string, decision: Decision, busy?: boolean, serverError?: string | null, answerStorageKey?: string, lockedResolutionKind?: 'answer' | 'skip', authorityConflict?: { keptLocal: boolean } | null }>(), { busy: false, serverError: null, answerStorageKey: undefined, lockedResolutionKind: undefined, authorityConflict: null })
const emit = defineEmits<{ resolve: [resolution: { kind: 'answer', answer: string } | { kind: 'skip' }]; useAuthority: []; keepLocal: [] }>()
const answer = ref('')
const validationError = ref<string | null>(null)
const answerField = ref<HTMLTextAreaElement | null>(null)
const ERROR_ID = 'learn-clarification-error'
const ANSWER_TTL_MS = 24 * 60 * 60 * 1_000

function safeRemoveAnswer() { if (props.answerStorageKey) { try { sessionStorage.removeItem(props.answerStorageKey) } catch { return } } }
onMounted(() => {
  if (!props.answerStorageKey) return
  if (props.decision.status !== 'pending') { safeRemoveAnswer(); return }
  try {
    const stored = JSON.parse(sessionStorage.getItem(props.answerStorageKey) ?? 'null') as { answer?: unknown, savedAt?: unknown } | null
    if (stored && typeof stored.answer === 'string' && typeof stored.savedAt === 'number' && Date.now() - stored.savedAt <= ANSWER_TTL_MS) answer.value = stored.answer
    else safeRemoveAnswer()
  }
  catch { safeRemoveAnswer() }
})
watch(answer, (value) => {
  if (!props.answerStorageKey || props.decision.status !== 'pending') return
  try { if (value) sessionStorage.setItem(props.answerStorageKey, JSON.stringify({ answer: value, savedAt: Date.now() })); else sessionStorage.removeItem(props.answerStorageKey) } catch { return }
})
watch(() => props.decision.status, status => { if (status !== 'pending') safeRemoveAnswer() })

async function submitAnswer() {
  validationError.value = null
  const trimmed = answer.value.trim()
  const bytes = new TextEncoder().encode(trimmed).byteLength
  if (!trimmed) validationError.value = 'Add an answer or skip this clarification.'
  else if (bytes > CLARIFICATION_MAX_ANSWER_BYTES) validationError.value = 'Keep the clarification answer under 1 KB.'
  if (validationError.value) {
    await nextTick()
    answerField.value?.focus()
    return
  }
  emit('resolve', { kind: 'answer', answer: trimmed })
}

function skip() {
  validationError.value = null
  emit('resolve', { kind: 'skip' })
}
</script>

<template>
  <section class="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6" aria-live="polite" data-testid="learn-initial-decision">
    <UiCard class="gap-5 p-5">
      <div><p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your original wording</p><pre class="mt-2 whitespace-pre-wrap font-sans text-sm" data-testid="learn-clarification-original-need">{{ originalNeed }}</pre></div>
      <template v-if="decision.status === 'pending' && decision.question">
        <label class="text-sm font-medium">{{ decision.question.prompt }}
          <textarea ref="answerField" v-model="answer" rows="3" maxlength="1000" class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" data-testid="learn-clarification-answer" :disabled="busy || !!lockedResolutionKind" :aria-describedby="validationError || serverError ? ERROR_ID : undefined" :aria-invalid="validationError || serverError ? true : undefined" />
        </label>
        <p class="text-xs text-muted-foreground">{{ decision.question.help }}</p>
        <p v-if="validationError || serverError" :id="ERROR_ID" role="alert" class="text-sm text-destructive">{{ validationError ?? serverError }}</p>
        <div v-if="authorityConflict" class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" role="status" data-testid="learn-clarification-conflict">
          <p class="text-sm font-medium">This clarification was resolved in another session.</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ authorityConflict.keptLocal ? 'Your local answer remains only in this browser session.' : 'Choose the saved thread result or keep your local answer without overwriting it.' }}</p>
          <div class="mt-3 flex flex-wrap gap-2"><UiButton type="button" class="min-h-11" data-testid="learn-clarification-use-authority" @click="emit('useAuthority')">Use saved result</UiButton><UiButton v-if="!authorityConflict.keptLocal" type="button" variant="outline" class="min-h-11" data-testid="learn-clarification-keep-local" @click="emit('keepLocal')">Keep local answer</UiButton></div>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <UiButton type="button" variant="ghost" class="min-h-11" data-testid="learn-clarification-skip" :disabled="busy || !!authorityConflict || lockedResolutionKind === 'answer'" @click="skip">Skip question</UiButton>
          <UiButton type="button" class="min-h-11" data-testid="learn-clarification-submit" :disabled="busy || !!authorityConflict || lockedResolutionKind === 'skip'" @click="submitAnswer">{{ busy ? 'Saving…' : 'Use this outcome' }}</UiButton>
        </div>
      </template>
      <div v-else data-testid="learn-continuation-ready">
        <p class="font-medium">Your next step is ready.</p>
        <p class="mt-1 text-sm text-muted-foreground">Budds has saved your goal, intent, and source state without asking another question.</p>
      </div>
    </UiCard>
  </section>
</template>
