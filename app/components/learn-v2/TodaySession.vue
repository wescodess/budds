<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, BookOpenCheck, ChevronRight, CircleCheck, Eye, Lightbulb, ShieldCheck } from '@lucide/vue'
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
const emit = defineEmits<{ leave: [], started: [], completed: [] }>()
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
const reduceMotion = ref(false)
const enhancedContrast = ref(false)
const hideTimeGuidance = ref(false)

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
const sessionStages = [
  { id: 'retrieval', label: 'Retrieve' },
  { id: 'prediction', label: 'Predict' },
  { id: 'teaching', label: 'Learn' },
  { id: 'fading', label: 'Practice' },
  { id: 'transfer', label: 'Apply' },
  { id: 'confidence', label: 'Reflect' },
] as const
const currentStageIndex = computed(() => sessionStages.findIndex(stage => stage.id === phase.value))
const progressValue = computed(() => Math.max(0, currentStageIndex.value + 1))
const currentStageLabel = computed(() => currentStageIndex.value < 0 ? 'Ready when you are' : sessionStages[currentStageIndex.value]!.label)
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
    emit('started')
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
    feedback.value = result; scorePending.value = false; emit('completed'); move('feedback')
  } catch (cause) { error.value = getErrorMessage(cause, 'Could not submit your response. Try again.') }
  finally { busy.value = false }
}
async function retryScore() { await submit() }
</script>

<template>
  <section
    aria-labelledby="today-session-title"
    data-testid="learn-v2-session"
    class="learn-v2-session mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-8 pt-4 sm:px-6 sm:pt-6"
    :class="{ 'learn-v2-reduced-motion motion-reduce:transition-none': reduceMotion, 'learn-v2-enhanced-contrast contrast-125': enhancedContrast }"
  >
    <p aria-live="polite" data-testid="learn-v2-live" class="sr-only">{{ notice }}</p>
    <header class="border-b border-border pb-5">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="font-inter text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Today<span v-if="!hideTimeGuidance"> · about {{ candidate.estimatedMinutes }} minutes</span></p>
          <h1 id="today-session-title" class="mt-2 font-dm-sans text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{{ candidate.objectiveTitle }}</h1>
          <p v-if="candidate.capability" class="mt-2 text-sm leading-6 text-muted-foreground">{{ candidate.capability }}</p>
        </div>
        <button type="button" data-testid="learn-v2-leave" class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-stone-600 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none forced-colors:border-current" aria-label="Leave study session and return to your workspace" @click="emit('leave')">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          <span class="hidden sm:inline">Back to workspace</span><span class="sm:hidden">Leave</span>
        </button>
      </div>
      <div class="mt-5 flex items-center justify-between gap-3">
        <p id="learn-v2-current-stage" data-testid="learn-v2-current-stage" class="text-sm font-medium text-foreground">{{ currentStageLabel }}</p>
        <p class="font-inter text-xs text-muted-foreground"><span v-if="currentStageIndex >= 0">{{ progressValue }} of {{ sessionStages.length }}</span><span v-else>Focused practice</span></p>
      </div>
      <ol data-testid="learn-v2-session-path" aria-label="Session progress" class="mt-3 grid grid-cols-6 gap-1.5 sm:gap-2">
        <li v-for="(stage, index) in sessionStages" :key="stage.id" class="min-w-0">
          <span class="block h-1.5 rounded-full" :class="index <= currentStageIndex ? 'bg-primary' : 'bg-muted'" />
          <span class="mt-1.5 block truncate text-[10px] font-medium" :class="index === currentStageIndex ? 'text-foreground' : 'text-muted-foreground'">{{ stage.label }}</span>
        </li>
      </ol>
    </header>

    <div class="mt-5 space-y-4">
      <p v-if="!isOnline" id="learn-v2-offline-notice" data-testid="learn-v2-offline-notice" role="status" class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100 forced-colors:border-current">Server-scored sessions require a connection. No offline attempt is queued.</p>
      <p v-if="error" role="alert" data-testid="learn-v2-error" class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive forced-colors:border-current">{{ error }}</p>

      <details data-testid="learn-v2-evidence-context" class="rounded-lg border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground forced-colors:border-current">
        <summary class="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ShieldCheck class="h-4 w-4 text-primary" aria-hidden="true" />Evidence in this session</summary>
        <p class="mt-2 leading-6">Budds only publishes this session from evidence accepted for this learning plan. Source details appear with supported material when they are available.</p>
      </details>

      <details data-testid="learn-v2-accessibility-preferences" class="rounded-lg border border-border px-4 py-3 text-sm forced-colors:border-current">
        <summary class="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Session preferences</summary>
        <div class="mt-3 grid gap-2 text-muted-foreground">
          <label class="flex items-center gap-2"><input v-model="reduceMotion" type="checkbox" data-testid="learn-v2-reduce-motion" class="accent-primary"> Reduce motion</label>
          <label class="flex items-center gap-2"><input v-model="enhancedContrast" type="checkbox" data-testid="learn-v2-enhanced-contrast" class="accent-primary"> Increase contrast</label>
          <label class="flex items-center gap-2"><input v-model="hideTimeGuidance" type="checkbox" data-testid="learn-v2-hide-time" class="accent-primary"> Hide time guidance</label>
        </div>
      </details>

      <article v-if="phase === 'start'" class="rounded-xl border border-border bg-card p-5 sm:p-6 forced-colors:border-current">
        <BookOpenCheck class="h-6 w-6 text-primary" aria-hidden="true" />
        <h2 class="mt-4 font-dm-sans text-xl font-semibold text-foreground">A focused, evidence-grounded session</h2>
        <p class="mt-2 max-w-xl leading-7 text-muted-foreground">You will retrieve what you know, work through one capability, and finish with an independent application. Take the time you need.</p>
        <button type="button" data-testid="learn-v2-start" :disabled="busy || !isOnline" :aria-describedby="!isOnline ? 'learn-v2-offline-notice' : undefined" class="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none" @click="start">{{ busy ? 'Starting…' : 'Start' }}<ChevronRight v-if="!busy" class="h-4 w-4" aria-hidden="true" /></button>
      </article>

      <template v-else>
        <article v-if="phase !== 'feedback' && phase !== 'next_review'" class="rounded-xl border border-border bg-card p-5 sm:p-6 forced-colors:border-current" :data-testid="`learn-v2-phase-${phase}`">
          <p class="font-inter text-xs font-medium uppercase tracking-[0.16em] text-primary">{{ phaseLabel }}</p>
          <h2 class="mt-2 font-dm-sans text-xl font-semibold text-foreground">{{ phase === 'transfer' ? 'Apply it to a new case' : phase === 'confidence' ? 'Reflect on your answer' : phaseLabel }}</h2>
          <p v-if="currentContent" class="mt-5 whitespace-pre-wrap text-[15px] leading-7 text-foreground">{{ currentContent }}</p>
          <p v-else role="status" class="mt-5 text-sm leading-6 text-muted-foreground">Preparing the supported material for this part of your session…</p>

          <label v-if="phase === 'prediction'" class="mt-6 block text-sm font-medium text-foreground">Your prediction<textarea v-model="prediction" aria-label="Your prediction" placeholder="Write what you think before seeing the explanation." class="mt-2 min-h-32 w-full rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring forced-colors:border-current" /></label>

          <template v-if="phase === 'teaching'">
            <div data-testid="learn-v2-assistance-consequence" class="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100 forced-colors:border-current"><Eye class="mr-2 inline h-4 w-4 text-primary" aria-hidden="true" />A worked example supports learning. Using it records this attempt as guided, not independent.</div>
            <button type="button" data-testid="learn-v2-reveal" :disabled="busy || !isOnline || !!reveal" :aria-describedby="!isOnline ? 'learn-v2-offline-notice' : undefined" class="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none forced-colors:border-current" @click="assistance('answer_reveal')"><Eye class="h-4 w-4" aria-hidden="true" />{{ reveal ? 'Worked example shown' : 'Show worked example' }}</button>
            <p v-if="reveal" data-testid="learn-v2-reveal-content" class="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-4 text-sm leading-7 text-foreground forced-colors:border-current">{{ reveal }}</p>
          </template>

          <template v-if="phase === 'fading'">
            <label class="mt-6 block text-sm font-medium text-foreground">Your faded-practice response<textarea v-model="fadedResponse" aria-label="Your faded-practice response" placeholder="Try it independently first. You can ask for a hint if needed." class="mt-2 min-h-32 w-full rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring forced-colors:border-current" /></label>
            <div data-testid="learn-v2-assistance-consequence" class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100 forced-colors:border-current"><Lightbulb class="mr-2 inline h-4 w-4 text-primary" aria-hidden="true" />A hint keeps this attempt in the guided lane. It is useful support, not a penalty.</div>
            <button type="button" data-testid="learn-v2-hint" :disabled="busy || !isOnline || !!hint" :aria-describedby="!isOnline ? 'learn-v2-offline-notice' : undefined" class="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none forced-colors:border-current" @click="assistance('substantive_hint')"><Lightbulb class="h-4 w-4" aria-hidden="true" />{{ hint ? 'Hint shown' : 'Get a hint' }}</button>
            <p v-if="hint" data-testid="learn-v2-hint-content" class="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-4 text-sm leading-7 text-foreground forced-colors:border-current">{{ hint }}</p>
          </template>

          <label v-if="phase === 'transfer'" class="mt-6 block text-sm font-medium text-foreground">Your transfer response<textarea v-model="transferResponse" aria-label="Your transfer response" placeholder="Apply the idea to this new situation in your own words." class="mt-2 min-h-36 w-full rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring forced-colors:border-current" /></label>

          <template v-if="phase === 'confidence'">
            <label class="mt-6 block text-sm font-medium text-foreground">Teach it back<textarea v-model="teachBack" aria-label="Teach it back" placeholder="Explain the idea as you would to someone else." class="mt-2 min-h-32 w-full rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring forced-colors:border-current" /></label>
            <fieldset class="mt-5" aria-describedby="confidence-help">
              <legend class="text-sm font-medium text-foreground">How confident do you feel?</legend>
              <p id="confidence-help" class="mt-1 text-sm leading-6 text-muted-foreground">This helps Budds tailor review. It does not change your score.</p>
              <div class="mt-3 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Confidence from one to five">
                <label v-for="value in 5" :key="value" :data-testid="`learn-v2-confidence-${value}`" class="cursor-pointer"><input v-model="confidence" type="radio" name="confidence" :value="value" class="peer sr-only"><span class="flex min-h-11 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium text-muted-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary/15 peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:border-stone-600 motion-reduce:transition-none forced-colors:border-current">{{ value }}</span><span class="sr-only">{{ value }} out of 5</span></label>
              </div>
            </fieldset>
          </template>

          <button v-if="phase !== 'confidence'" type="button" data-testid="learn-v2-continue" :disabled="busy || !canContinue" class="mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none" @click="phase === 'retrieval' ? move('prediction') : phase === 'prediction' ? move('teaching') : phase === 'teaching' ? move('fading') : phase === 'fading' ? move('transfer') : move('confidence')">Continue<ChevronRight class="h-4 w-4" aria-hidden="true" /></button>
          <button v-else type="button" data-testid="learn-v2-submit" :disabled="busy || !isOnline || !canContinue" :aria-describedby="!isOnline ? 'learn-v2-offline-notice' : undefined" class="mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none" @click="submit">{{ busy ? 'Submitting…' : 'Submit for feedback' }}<ChevronRight v-if="!busy" class="h-4 w-4" aria-hidden="true" /></button>
        </article>

        <article v-if="scorePending" data-testid="learn-v2-score-pending" class="rounded-xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground forced-colors:border-current" role="status"><p class="font-medium text-foreground">Your response is being scored.</p><p class="mt-1">Keep this page open, or retry safely when you are ready.</p><button type="button" data-testid="learn-v2-score-retry" :disabled="busy || !isOnline" :aria-describedby="!isOnline ? 'learn-v2-offline-notice' : undefined" class="mt-4 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" @click="retryScore">Retry scoring</button></article>

        <article v-if="phase === 'feedback'" data-testid="learn-v2-feedback" class="rounded-xl border border-border bg-card p-5 sm:p-6 forced-colors:border-current"><CircleCheck class="h-6 w-6 text-primary" aria-hidden="true" /><p class="mt-4 font-inter text-xs font-medium uppercase tracking-[0.16em] text-primary">Session reflection</p><h2 class="mt-2 font-dm-sans text-xl font-semibold text-foreground">Here is what you demonstrated</h2><div v-if="feedback?.scorePercent !== undefined" class="mt-5 rounded-lg border border-border bg-background/60 px-4 py-3 forced-colors:border-current"><p class="text-sm text-muted-foreground">Score</p><p class="mt-1 text-2xl font-semibold text-foreground">Score: {{ feedback.scorePercent }}%</p><p v-if="feedback?.state" class="mt-1 text-sm text-muted-foreground">Current capability state: <span class="font-medium text-foreground">{{ feedback.state }}</span></p></div><ul v-if="feedback?.feedback?.criterionResults.length" class="mt-5 space-y-3"><li v-for="criterion in feedback.feedback.criterionResults" :key="criterion.key" class="rounded-lg border border-border px-4 py-3 text-sm leading-6 forced-colors:border-current"><span class="font-medium text-foreground">{{ criterion.key }}:</span> <span class="text-muted-foreground">{{ criterion.awarded ? 'met' : 'not yet' }}</span><span v-if="criterion.rationale" class="block mt-1 text-muted-foreground">{{ criterion.rationale }}</span></li></ul><p v-if="feedback?.feedback?.misconceptionTags.length" class="mt-5 rounded-lg bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">Review next: {{ feedback.feedback.misconceptionTags.join(', ') }}</p><button type="button" data-testid="learn-v2-next-review" class="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none" @click="move('next_review')">See next review<ChevronRight class="h-4 w-4" aria-hidden="true" /></button></article>

        <article v-if="phase === 'next_review'" data-testid="learn-v2-next-review-panel" class="rounded-xl border border-border bg-card p-5 sm:p-6 forced-colors:border-current"><p class="font-inter text-xs font-medium uppercase tracking-[0.16em] text-primary">What comes next</p><h2 class="mt-2 font-dm-sans text-xl font-semibold text-foreground">Your next review</h2><p class="mt-3 leading-7 text-muted-foreground">{{ feedback?.nextReviewAt ? new Date(feedback.nextReviewAt).toLocaleString() : 'No further review is scheduled yet.' }}</p><button type="button" data-testid="learn-v2-complete-leave" class="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none forced-colors:border-current" @click="emit('leave')"><ArrowLeft class="h-4 w-4" aria-hidden="true" />Back to workspace</button></article>
      </template>
    </div>
  </section>
</template>
