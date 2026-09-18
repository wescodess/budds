<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'
import { useOnlineStatus } from '~/composables/useOnlineStatus'

type Candidate = {
  studySessionId: string
  sessionRevision: number
  contentRevision: number
  planRecordRevision: number
  blueprintRecordRevision: number
  objectiveTitle: string
  capability?: string
  estimatedMinutes: number
  scheduledStartAt: number
  scheduledEndAt?: number
  timezone: string
  reason: string
  masteryState?: string
  nextScheduledAt?: number
  progress: { retained: number, independent: number, total: number }
}
type Block = { kind: string, content: string, order?: number }
type SessionContent = { revision: number, blocks: Block[] } | null
type Feedback = {
  scorePercent?: number
  state?: string
  nextReviewAt?: number | null
  replayed?: boolean
  feedback?: { criterionResults: Array<{ key: string, awarded: boolean, rationale?: string }>, misconceptionTags: string[] }
}

const { candidate } = defineProps<{ candidate: Candidate }>()
const { isOnline } = useOnlineStatus()

const startMutation = import.meta.client ? useConvexMutation(api.learnV2SessionContent.startStudySession) : { mutate: async () => ({}) }
const assistanceMutation = import.meta.client ? useConvexMutation(api.learnV2Mastery.recordAssistanceUse) : { mutate: async () => ({}) }
const submitMutation = import.meta.client ? useConvexAction(api.learnV2Mastery.submitMasteryAttempt) : { mutate: async () => ({}) }

const started = ref(false)
const sessionRevision = ref(candidate.sessionRevision)
const contentRevision = ref(candidate.contentRevision)
const phase = ref<'start' | 'retrieval' | 'prediction' | 'teaching' | 'fading' | 'transfer' | 'confidence' | 'feedback' | 'next_review'>('start')
const prediction = ref('')
const fadedResponse = ref('')
const transferResponse = ref('')
const teachBack = ref('')
const confidence = ref<number | null>(null)
const hint = ref<string | null>(null)
const reveal = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref('')
const feedback = ref<Feedback | null>(null)
const scorePending = ref(false)
const startKey = ref<string | null>(null)
const submitKey = ref<string | null>(null)

function makeKey(prefix: string) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${id}`
}

const contentQuery = import.meta.client
  ? useConvexQuery(api.learnV2SessionContent.getSessionContent, { studySessionId: candidate.studySessionId as never }, { enabled: started })
  : { data: ref<SessionContent>(null) }

const blocks = computed(() => ((contentQuery.data?.value as SessionContent)?.blocks ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
function block(kind: string) { return blocks.value.find(item => item.kind === kind)?.content ?? '' }
const blockKind = computed(() => ({ retrieval: 'retrieval', prediction: 'cold_attempt', teaching: 'explanation', transfer: 'independent_application', confidence: 'confidence_teach_back' } as const)[phase.value as 'retrieval' | 'prediction' | 'teaching' | 'transfer' | 'confidence'])
const currentContent = computed(() => phase.value === 'fading' ? 'Try a faded practice response with as little support as you can. A server-recorded hint is available if you need it.' : blockKind.value ? block(blockKind.value) : '')
const phaseLabel = computed(() => ({ retrieval: 'Retrieval', prediction: 'Prediction', teaching: 'Teaching', fading: 'Fading practice', transfer: 'Transfer', confidence: 'Confidence and teach-back' } as const)[phase.value as 'retrieval' | 'prediction' | 'teaching' | 'fading' | 'transfer' | 'confidence'] ?? '')
const contentReady = computed(() => blocks.value.length > 0 && (phase.value === 'fading' || phase.value === 'feedback' || phase.value === 'next_review' || !!currentContent.value))
const canContinue = computed(() => {
  if (!contentReady.value) return false
  if (phase.value === 'prediction') return prediction.value.trim().length > 0
  if (phase.value === 'fading') return fadedResponse.value.trim().length > 0
  if (phase.value === 'transfer') return transferResponse.value.trim().length > 0
  if (phase.value === 'confidence') return confidence.value !== null && teachBack.value.trim().length > 0
  return true
})

function move(next: typeof phase.value) {
  error.value = null
  phase.value = next
  notice.value = `Now in ${next.replaceAll('_', ' ')}.`
}
async function start() {
  if (!isOnline.value || busy.value || started.value) return
  busy.value = true; error.value = null
  startKey.value ??= makeKey('learn-v2-start')
  try {
    const result = await startMutation.mutate({ studySessionId: candidate.studySessionId as never, expectedSessionRevision: sessionRevision.value, expectedContentRevision: contentRevision.value, idempotencyKey: startKey.value }) as { sessionContentRevision?: number }
    sessionRevision.value += 1
    contentRevision.value = result.sessionContentRevision ?? contentRevision.value
    started.value = true
    move('retrieval')
  } catch (cause) { error.value = getErrorMessage(cause, 'Could not start this study session. Try again.') }
  finally { busy.value = false }
}
async function assistance(kind: 'substantive_hint' | 'answer_reveal') {
  if (!isOnline.value || busy.value || (kind === 'substantive_hint' && hint.value) || (kind === 'answer_reveal' && reveal.value)) return
  busy.value = true; error.value = null
  try {
    const result = await assistanceMutation.mutate({ studySessionId: candidate.studySessionId as never, expectedSessionRevision: sessionRevision.value, kind }) as { revision: number, assistance: { content: string } }
    sessionRevision.value = result.revision
    if (kind === 'substantive_hint') hint.value = result.assistance.content
    else reveal.value = result.assistance.content
    notice.value = kind === 'substantive_hint' ? 'Hint added to this session.' : 'Worked example revealed for this session.'
  } catch (cause) { error.value = getErrorMessage(cause, 'Could not load that support. Try again.') }
  finally { busy.value = false }
}
async function submit() {
  if (!isOnline.value || busy.value || !canContinue.value) return
  busy.value = true; error.value = null
  submitKey.value ??= makeKey('learn-v2-attempt')
  try {
    const result = await submitMutation.mutate({ studySessionId: candidate.studySessionId as never, expectedSessionRevision: sessionRevision.value, expectedContentRevision: contentRevision.value, expectedPlanRecordRevision: candidate.planRecordRevision, expectedBlueprintRecordRevision: candidate.blueprintRecordRevision, response: transferResponse.value.trim(), confidence: confidence.value as number, idempotencyKey: submitKey.value }) as Feedback & { status: 'completed' | 'in_progress' }
    if (result.status === 'in_progress') { scorePending.value = true; notice.value = 'Scoring is still in progress. Use retry to reconcile this attempt.'; return }
    feedback.value = result; scorePending.value = false; move('feedback')
  } catch (cause) { error.value = getErrorMessage(cause, 'Could not submit your response. Try again.') }
  finally { busy.value = false }
}
async function retryScore() { await submit() }
</script>

<template>
  <section aria-labelledby="today-session-title" data-testid="learn-v2-session" class="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
    <header><p class="text-sm text-muted-foreground">Today · {{ candidate.estimatedMinutes }} minutes</p><h1 id="today-session-title" class="text-2xl font-semibold">{{ candidate.objectiveTitle }}</h1></header>
    <p aria-live="polite" data-testid="learn-v2-live" class="sr-only">{{ notice }}</p>
    <p v-if="!isOnline" id="learn-v2-offline-notice" data-testid="learn-v2-offline-notice" role="status" class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Server-scored sessions require a connection. No offline attempt is queued.</p>
    <p v-if="error" role="alert" data-testid="learn-v2-error" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{{ error }}</p>
    <div v-if="phase === 'start'" class="rounded-lg border p-5"><p>Ready for a focused, evidence-grounded session.</p><button type="button" data-testid="learn-v2-start" :disabled="busy || !isOnline" aria-describedby="learn-v2-offline-notice" class="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" @click="start">{{ busy ? 'Starting…' : 'Start' }}</button></div>
    <template v-else>
      <article v-if="phase !== 'feedback' && phase !== 'next_review'" class="rounded-lg border p-5" :data-testid="`learn-v2-phase-${phase}`"><h2 class="text-lg font-medium">{{ phaseLabel }}</h2><p v-if="currentContent" class="mt-3 whitespace-pre-wrap">{{ currentContent }}</p><p v-else role="status" class="mt-3 text-muted-foreground">Loading session content…</p>
        <label v-if="phase === 'prediction'" class="mt-4 block">Your prediction<textarea v-model="prediction" aria-label="Your prediction" class="mt-1 w-full rounded border p-2" /></label>
        <template v-if="phase === 'teaching'"><button type="button" data-testid="learn-v2-reveal" :disabled="busy || !isOnline || !!reveal" aria-describedby="learn-v2-offline-notice" class="mt-4 rounded border px-3 py-2 disabled:opacity-50" @click="assistance('answer_reveal')">Reveal worked example</button><p v-if="reveal" data-testid="learn-v2-reveal-content" class="mt-3 whitespace-pre-wrap">{{ reveal }}</p></template>
        <template v-if="phase === 'fading'"><label class="mt-4 block">Your faded-practice response<textarea v-model="fadedResponse" aria-label="Your faded-practice response" class="mt-1 w-full rounded border p-2" /></label><button type="button" data-testid="learn-v2-hint" :disabled="busy || !isOnline || !!hint" aria-describedby="learn-v2-offline-notice" class="mt-3 rounded border px-3 py-2 disabled:opacity-50" @click="assistance('substantive_hint')">Get a fading hint</button><p v-if="hint" data-testid="learn-v2-hint-content" class="mt-3 whitespace-pre-wrap">{{ hint }}</p></template>
        <label v-if="phase === 'transfer'" class="mt-4 block">Your transfer response<textarea v-model="transferResponse" aria-label="Your transfer response" class="mt-1 w-full rounded border p-2" /></label>
        <template v-if="phase === 'confidence'"><label class="mt-4 block">Teach it back<textarea v-model="teachBack" aria-label="Teach it back" class="mt-1 w-full rounded border p-2" /></label><fieldset class="mt-3"><legend>Confidence</legend><label v-for="value in 5" :key="value" class="mr-3"><input v-model="confidence" type="radio" name="confidence" :value="value"> {{ value }}</label></fieldset></template>
        <button v-if="phase !== 'confidence'" type="button" data-testid="learn-v2-continue" :disabled="busy || !canContinue" class="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" @click="phase === 'retrieval' ? move('prediction') : phase === 'prediction' ? move('teaching') : phase === 'teaching' ? move('fading') : phase === 'fading' ? move('transfer') : move('confidence')">Continue</button>
        <button v-else type="button" data-testid="learn-v2-submit" :disabled="busy || !isOnline || !canContinue" aria-describedby="learn-v2-offline-notice" class="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" @click="submit">{{ busy ? 'Submitting…' : 'Submit for feedback' }}</button>
      </article>
      <article v-if="scorePending" data-testid="learn-v2-score-pending" class="rounded-lg border p-5" role="status">Scoring is in progress. <button type="button" data-testid="learn-v2-score-retry" :disabled="busy" class="underline" @click="retryScore">Retry</button></article>
      <article v-if="phase === 'feedback'" data-testid="learn-v2-feedback" class="rounded-lg border p-5"><h2 class="text-lg font-medium">Server feedback</h2><p v-if="feedback?.scorePercent !== undefined">Score: {{ feedback.scorePercent }}%</p><p v-if="feedback?.state">Mastery state: {{ feedback.state }}</p><ul v-if="feedback?.feedback?.criterionResults.length" class="mt-3 list-disc space-y-1 pl-5"><li v-for="criterion in feedback.feedback.criterionResults" :key="criterion.key"><span class="font-medium">{{ criterion.key }}:</span> {{ criterion.awarded ? 'met' : 'not yet' }}<span v-if="criterion.rationale"> — {{ criterion.rationale }}</span></li></ul><p v-if="feedback?.feedback?.misconceptionTags.length" class="mt-3">Review: {{ feedback.feedback.misconceptionTags.join(', ') }}</p><button type="button" data-testid="learn-v2-next-review" class="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground" @click="move('next_review')">See next review</button></article>
      <article v-if="phase === 'next_review'" data-testid="learn-v2-next-review-panel" class="rounded-lg border p-5"><h2 class="text-lg font-medium">Next review</h2><p>{{ feedback?.nextReviewAt ? new Date(feedback.nextReviewAt).toLocaleString() : 'No further review is scheduled yet.' }}</p></article>
    </template>
  </section>
</template>
