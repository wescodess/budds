<script setup lang="ts">
import type { Component, Ref } from 'vue'
import { BookOpen, ChevronRight, CircleAlert, CircleCheck, Clock, Eye, Lightbulb, LoaderCircle, Lock, RotateCw, TriangleAlert, WifiOff } from '@lucide/vue'
import { useCanvasCheck, type CanvasCheckBinding, type CanvasCheckReceiptKind } from '~/composables/useCanvasCheck'

const props = withDefaults(defineProps<{
  ownerId: string
  threadId: string
  outcome: string
  intent: string
  binding: CanvasCheckBinding
  showHeader?: boolean
  active?: boolean
}>(), { showHeader: true, active: true })
const emit = defineEmits<{ leave: [], inspectEvidence: [origin: HTMLButtonElement] }>()

const { isOnline } = useOnlineStatus()
const {
  view, answer, confidence, answerMissing, confidenceMissing, submitFailure, startFailed, busy, restored,
  invalidBySource, feedback, lesson, practice,
  practiceAnswer, practiceMissing, practiceBusy, practiceFailed, practiceSaved, assistance, assistanceDenied,
  start, submit, retryScore, submitPractice, requestAssistance,
} = useCanvasCheck({ ownerId: props.ownerId, threadId: props.threadId, binding: props.binding, isOnline })

const id = useId()
const notice = ref('')
const questionHeading = ref<HTMLElement | null>(null)
const receiptHeading = ref<HTMLElement | null>(null)
const answerField = ref<HTMLTextAreaElement | null>(null)
const confidenceChoices = ref<HTMLInputElement[]>([])
const practiceExpanded = ref(false)

const primaryAction = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const secondaryAction = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const textLink = 'inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const fieldBase = 'mt-2 w-full rounded-lg border bg-background px-3 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const card = 'mt-6 first:mt-0 rounded-xl border border-border bg-card p-4 sm:p-6'
const citationBadge = 'mx-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground align-baseline transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const sourceBadge = 'inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground'
const attention = 'text-[var(--learn-attention)]'

const receiptContent: Record<CanvasCheckReceiptKind, { title: string, icon: Component, iconClass: string }> = {
  saved: { title: 'Answer saved', icon: Lock, iconClass: 'text-foreground' },
  scoring_failed: { title: 'Scoring stopped before it finished', icon: TriangleAlert, iconClass: attention },
  unconfirmed: { title: 'We couldn’t confirm your result', icon: Clock, iconClass: attention },
  invalid: { title: 'This check won’t count', icon: TriangleAlert, iconClass: attention },
  passed: { title: 'Passed: you still had it', icon: CircleCheck, iconClass: 'text-green-700 dark:text-green-400' },
  not_yet: { title: 'Not yet: part of this slipped', icon: BookOpen, iconClass: attention },
}

const viewKey = computed(() => view.value.kind === 'receipt' ? view.value.receipt : view.value.kind)
const receipt = computed(() => view.value.kind === 'receipt' ? view.value : null)
const receiptCopy = computed(() => receipt.value ? receiptContent[receipt.value.receipt] : null)
const isResult = computed(() => receipt.value?.receipt === 'passed' || receipt.value?.receipt === 'not_yet')
const receiptBody = computed(() => {
  switch (receipt.value?.receipt) {
    case 'scoring_failed': return 'This wasn’t your answer’s fault. Your answer is saved.'
    case 'unconfirmed': return 'Budds won’t guess. Your saved answer will be checked again and the result will appear here. You don’t need to answer again.'
    case 'invalid': return invalidBySource.value
      ? 'A source this question relied on changed after you started, so your answer can’t be scored. It won’t count for or against you. You’ll get a new check with a different question later.'
      : 'It won’t count for or against you. You’ll get a new check with a different question later.'
    case 'not_yet': return 'That’s common, and it’s why we check.'
    default: return null
  }
})
const showFullPractice = computed(() => Boolean(practice.value) && (receipt.value?.receipt === 'saved' || practiceExpanded.value))
const showCollapsedPractice = computed(() => Boolean(practice.value) && !showFullPractice.value
  && (receipt.value?.receipt === 'scoring_failed' || receipt.value?.receipt === 'unconfirmed' || receipt.value?.receipt === 'invalid' || (receipt.value?.receipt === 'not_yet' && !lesson.value)))
const submitFailureBody = computed(() => submitFailure.value === 'offline'
  ? 'You’re offline. It’s still here on this device. Submit again when you’re back online.'
  : 'It’s still here on this device.')

const savedAtFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const savedAtLabel = computed(() => receipt.value?.acceptedAt ? savedAtFormat.format(receipt.value.acceptedAt) : null)

async function focusOn(target: Ref<HTMLElement | null>) {
  await nextTick()
  if (props.active) target.value?.focus()
}

watch(viewKey, (next, previous) => {
  if (next === 'open' && previous === 'entry') void focusOn(questionHeading)
  if (next === 'saved' && previous === 'open') {
    notice.value = 'Answer saved and locked'
    void focusOn(receiptHeading)
  }
  if (next === 'invalid' || next === 'passed' || next === 'not_yet') void focusOn(receiptHeading)
})

async function onSubmit() {
  await submit()
  if (answerMissing.value) answerField.value?.focus()
  else if (confidenceMissing.value) confidenceChoices.value[0]?.focus()
}

function inspectCitation(event: MouseEvent) {
  if (event.currentTarget instanceof HTMLButtonElement) emit('inspectEvidence', event.currentTarget)
}

function openPractice() {
  practiceExpanded.value = true
}
</script>

<template>
  <section class="w-full" data-testid="learn-canvas-check" :aria-labelledby="showHeader ? 'learn-canvas-title' : undefined" :aria-label="showHeader ? undefined : 'Current activity'">
    <header v-if="showHeader">
      <p class="font-inter text-xs font-medium text-muted-foreground">{{ view.kind === 'open' ? 'Check' : 'Void' }} · {{ intent }}</p>
      <h1 id="learn-canvas-title" class="mt-2 font-dm-sans text-2xl font-bold text-foreground sm:text-3xl">{{ outcome }}</h1>
    </header>
    <p v-if="view.kind === 'open'" class="mt-3 first:mt-0 flex items-start gap-2 text-sm leading-6 text-muted-foreground"><Lock class="mt-1 h-4 w-4 shrink-0" aria-hidden="true" /><span>Hints, examples, sources and chat come back after you submit.</span></p>

    <div v-if="view.kind === 'loading'" data-testid="learn-canvas-check-loading" :class="card" role="status" aria-live="polite">
      <h2 class="font-dm-sans text-lg font-semibold">Loading current activity…</h2>
    </div>

    <section v-else-if="view.kind === 'unavailable'" data-testid="learn-canvas-check-unavailable" :aria-labelledby="`${id}-unavailable`" :class="card">
      <h2 :id="`${id}-unavailable`" class="font-dm-sans text-xl font-semibold text-foreground focus:outline-none">Your check isn’t ready yet</h2>
      <p class="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">Budds needs a question you haven’t seen before, and it isn’t ready. Keep studying as usual; the check will show on Today when it is.</p>
      <div class="mt-6 flex flex-wrap gap-3"><button type="button" data-testid="learn-canvas-check-leave" :class="primaryAction" @click="emit('leave')">Back to Learn<ChevronRight class="h-4 w-4 shrink-0" aria-hidden="true" /></button></div>
    </section>

    <section v-else-if="view.kind === 'entry'" data-testid="learn-canvas-check-entry" :aria-labelledby="`${id}-entry`" :class="card">
      <h2 :id="`${id}-entry`" class="font-dm-sans text-xl font-semibold text-foreground focus:outline-none">A check on last week’s work</h2>
      <p class="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">You’ll get one question you haven’t seen. Answer on your own. Once you submit, your answer is locked, practice opens right away, and your result arrives on this page.</p>
      <div class="mt-6 flex flex-wrap gap-3">
        <button type="button" data-testid="learn-canvas-check-start" :disabled="busy || !isOnline" :class="primaryAction" @click="start">Start check<ChevronRight class="h-4 w-4 shrink-0" aria-hidden="true" /></button>
        <button type="button" data-testid="learn-canvas-check-leave" :class="textLink" @click="emit('leave')">Back to Learn</button>
      </div>
      <div v-if="startFailed" role="alert" data-testid="learn-canvas-check-start-error" class="mt-5 flex items-start gap-3 border-t border-border pt-4"><CircleAlert class="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" /><p class="min-w-0 font-medium text-foreground">Could not start this session. Try again.</p></div>
    </section>

    <template v-else-if="view.kind === 'open'">
      <section data-testid="learn-canvas-check-open" :aria-labelledby="`${id}-question`" :class="card">
        <div v-if="restored" role="status" data-tone="neutral" data-testid="learn-canvas-check-restored" class="mb-5 flex items-start gap-3 border-b border-border pb-4"><RotateCw class="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden="true" /><div class="min-w-0"><p class="font-medium text-foreground">Same check, same question</p><p class="mt-1 text-sm leading-6 text-muted-foreground">We brought back your unfinished answer from this device. Nothing was sent.</p></div></div>
        <h2 :id="`${id}-question`" ref="questionHeading" tabindex="-1" class="font-dm-sans text-xl font-semibold text-foreground focus:outline-none">Your question</h2>
        <p data-testid="learn-canvas-check-question" class="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-foreground">{{ view.question }}</p>
        <div class="mt-6">
          <label :for="`${id}-answer`" class="block text-sm font-medium text-foreground">Your answer</label>
          <textarea :id="`${id}-answer`" ref="answerField" v-model="answer" data-testid="learn-canvas-check-answer" rows="6" maxlength="12000" :aria-invalid="answerMissing || undefined" :aria-describedby="answerMissing ? `${id}-answer-error` : undefined" :class="[fieldBase, 'min-h-36', answerMissing ? 'border-destructive' : 'border-input']" placeholder="Explain it in your own words." />
          <p v-if="answerMissing" :id="`${id}-answer-error`" data-testid="learn-canvas-check-answer-error" class="mt-2 flex items-start gap-2 text-sm font-medium text-foreground"><CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />Write your answer before you submit.</p>
        </div>
        <fieldset class="mt-5" :aria-describedby="confidenceMissing ? `${id}-confidence-help ${id}-confidence-error` : `${id}-confidence-help`">
          <legend class="text-sm font-medium text-foreground">How sure are you?</legend>
          <p :id="`${id}-confidence-help`" class="mt-1 text-sm leading-6 text-muted-foreground">This doesn’t change your result.</p>
          <div class="mt-3 grid grid-cols-5 gap-2">
            <label v-for="value in [1, 2, 3, 4, 5]" :key="value" class="cursor-pointer">
              <input ref="confidenceChoices" v-model.number="confidence" type="radio" :name="`${id}-confidence`" :value="value" :data-testid="`learn-canvas-check-confidence-${value}`" class="peer sr-only">
              <span class="flex min-h-11 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium text-muted-foreground peer-checked:border-primary peer-checked:bg-primary/15 peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:border-primary">{{ value }}<span class="sr-only"> out of 5{{ value === 1 ? ', guessing' : value === 5 ? ', certain' : '' }}</span></span>
            </label>
          </div>
          <div class="mt-1.5 flex justify-between font-inter text-xs font-medium text-muted-foreground" aria-hidden="true"><span>Guessing</span><span>Certain</span></div>
          <p v-if="confidenceMissing" :id="`${id}-confidence-error`" data-testid="learn-canvas-check-confidence-error" class="mt-2 flex items-start gap-2 text-sm font-medium text-foreground"><CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />Choose how sure you are.</p>
        </fieldset>
        <div class="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" data-testid="learn-canvas-check-submit" :aria-disabled="busy || undefined" :class="[primaryAction, busy && 'cursor-not-allowed opacity-50']" @click="onSubmit">{{ busy ? 'Submitting…' : 'Submit answer' }}<ChevronRight class="h-4 w-4 shrink-0" aria-hidden="true" /></button>
          <p class="font-inter text-xs font-medium text-muted-foreground">One answer. You can’t change it after you submit.</p>
        </div>
        <div v-if="submitFailure" role="alert" data-testid="learn-canvas-check-submit-error" class="mt-5 flex items-start gap-3 border-t border-border pt-4"><WifiOff v-if="submitFailure === 'offline'" class="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" /><CircleAlert v-else class="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" /><div class="min-w-0"><p class="font-medium text-foreground">Your answer wasn’t submitted</p><p class="mt-1 text-sm leading-6 text-muted-foreground">{{ submitFailureBody }}</p></div></div>
      </section>
      <p class="mt-4 font-inter text-xs font-medium text-muted-foreground">Your unfinished answer stays on this device until you submit. There’s no time limit.</p>
    </template>

    <template v-else-if="receipt && receiptCopy">
      <section data-testid="learn-canvas-check-receipt" :data-receipt="receipt.receipt" :aria-labelledby="`${id}-receipt`" :class="card">
        <div class="flex items-start gap-3">
          <component :is="receiptCopy.icon" :class="['mt-1 h-5 w-5 shrink-0', receiptCopy.iconClass]" aria-hidden="true" />
          <div class="min-w-0 flex-1" role="status">
            <h2 :id="`${id}-receipt`" ref="receiptHeading" tabindex="-1" class="font-dm-sans text-xl font-semibold text-foreground focus:outline-none">{{ receiptCopy.title }}</h2>
            <div v-if="receipt.receipt === 'saved'" class="mt-1 text-sm leading-6 text-muted-foreground"><span class="flex items-center gap-2"><LoaderCircle :class="['h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none', attention]" aria-hidden="true" />Getting your result. It will appear here.</span></div>
            <div v-else-if="receiptBody" class="mt-1 text-sm leading-6 text-muted-foreground">{{ receiptBody }}</div>
          </div>
        </div>
        <div v-if="receipt.receipt === 'scoring_failed'" class="mt-5 flex flex-wrap items-center gap-3"><button type="button" data-testid="learn-canvas-check-retry-score" :disabled="busy || !isOnline" :class="secondaryAction" @click="retryScore"><RotateCw class="h-4 w-4 shrink-0" aria-hidden="true" />Try scoring again</button></div>
        <div v-if="!isResult && receipt.answer" class="mt-4 border-t border-border">
          <details class="group" data-testid="learn-canvas-check-saved-answer">
            <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="flex items-center gap-2"><Lock class="h-4 w-4 shrink-0" aria-hidden="true" />Your saved answer</span><span v-if="savedAtLabel" class="font-inter text-xs font-medium text-muted-foreground">Saved {{ savedAtLabel }}</span></summary>
            <p class="mt-1 whitespace-pre-wrap break-words pb-2 text-sm leading-6 text-foreground">{{ receipt.answer }}</p>
          </details>
        </div>
        <div v-if="isResult && (receipt.answer || feedback)" class="mt-5 border-t border-border pt-4">
          <template v-if="receipt.answer">
            <p class="font-inter text-xs font-medium text-muted-foreground">You wrote<template v-if="savedAtLabel"> · {{ savedAtLabel }}</template></p>
            <blockquote data-testid="learn-canvas-check-your-answer" class="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm leading-6 text-foreground">{{ receipt.answer }}</blockquote>
          </template>
          <template v-if="feedback">
            <p class="mt-4 font-inter text-xs font-medium text-muted-foreground">Feedback on your answer</p>
            <p data-testid="learn-canvas-check-feedback" class="mt-2 whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">{{ feedback.text }}<button v-for="(citation, index) in feedback.citations" :key="citation.sourceRef" type="button" :aria-label="`Source ${index + 1}: ${citation.label}`" :class="citationBadge" @click="inspectCitation">{{ index + 1 }}</button></p>
            <p v-for="(citation, index) in feedback.citations" :key="citation.sourceRef" class="mt-1 flex items-center gap-2 text-sm"><span aria-hidden="true" :class="sourceBadge">{{ index + 1 }}</span><button type="button" :class="[textLink, 'gap-2']" @click="inspectCitation">{{ citation.label }}</button></p>
          </template>
        </div>
        <div v-if="receipt.receipt === 'passed'" class="mt-5 flex flex-wrap items-center gap-3"><button type="button" data-testid="learn-canvas-check-continue" :class="primaryAction" @click="emit('leave')">Continue to today’s session<ChevronRight class="h-4 w-4 shrink-0" aria-hidden="true" /></button></div>
      </section>

      <section v-if="lesson" data-testid="learn-canvas-check-lesson" :aria-labelledby="`${id}-lesson`" :class="card">
        <h2 :id="`${id}-lesson`" class="font-dm-sans text-lg font-semibold text-foreground">Let’s rebuild the missing part</h2>
        <p v-for="(paragraph, paragraphIndex) in lesson.paragraphs" :key="paragraphIndex" class="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">{{ paragraph }}<button v-for="(citation, index) in lesson.citations" :key="citation.sourceRef" type="button" :aria-label="`Source ${index + 1}: ${citation.label}`" :class="citationBadge" @click="inspectCitation">{{ index + 1 }}</button></p>
        <p v-for="(citation, index) in lesson.citations" :key="citation.sourceRef" class="mt-1 flex items-center gap-2 text-sm"><span aria-hidden="true" :class="sourceBadge">{{ index + 1 }}</span><button type="button" :class="[textLink, 'gap-2']" @click="inspectCitation">{{ citation.label }}</button></p>
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <button v-if="practice && !practiceExpanded" type="button" data-testid="learn-canvas-check-try-practice" :class="primaryAction" @click="openPractice">Try a practice case<ChevronRight class="h-4 w-4 shrink-0" aria-hidden="true" /></button>
          <button type="button" data-testid="learn-canvas-check-leave" :class="secondaryAction" @click="emit('leave')">Back to Today</button>
        </div>
      </section>

      <section v-if="showCollapsedPractice" data-testid="learn-canvas-check-practice-collapsed" :aria-labelledby="`${id}-practice-row`" :class="card">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0"><h2 :id="`${id}-practice-row`" class="font-medium text-foreground">Practice with a different case</h2><p class="mt-1 text-sm leading-6 text-muted-foreground">Separate from your check. Hints and worked examples are on.</p></div>
          <button type="button" data-testid="learn-canvas-check-continue-practice" :class="secondaryAction" @click="openPractice">Continue practising</button>
        </div>
      </section>

      <section v-if="showFullPractice && practice" data-testid="learn-canvas-check-practice" :aria-labelledby="`${id}-practice`" :class="card">
        <h2 :id="`${id}-practice`" class="font-dm-sans text-lg font-semibold text-foreground">Practice with a different case</h2>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">Separate from your check. It won’t change the result.</p>
        <p data-testid="learn-canvas-check-practice-prompt" class="mt-4 whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">{{ practice.prompt }}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" data-testid="learn-canvas-check-hint" :disabled="practiceBusy || !isOnline" :class="secondaryAction" @click="requestAssistance('hint')"><Lightbulb class="h-4 w-4 shrink-0" aria-hidden="true" />Get a hint</button>
          <button type="button" data-testid="learn-canvas-check-worked-example" :disabled="practiceBusy || !isOnline" :class="secondaryAction" @click="requestAssistance('worked_example')"><Eye class="h-4 w-4 shrink-0" aria-hidden="true" />Show worked example</button>
        </div>
        <p v-if="assistance" data-testid="learn-canvas-check-assistance" class="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">{{ assistance.text }}</p>
        <p v-if="assistanceDenied" role="alert" data-testid="learn-canvas-check-assistance-denied" class="mt-3 flex items-start gap-2 text-sm font-medium text-foreground"><CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />Could not load support. Try again.</p>
        <template v-if="!practiceSaved">
          <label :for="`${id}-practice-answer`" class="mt-5 block text-sm font-medium text-foreground">Your practice answer</label>
          <textarea :id="`${id}-practice-answer`" v-model="practiceAnswer" data-testid="learn-canvas-check-practice-answer" rows="3" maxlength="12000" :aria-invalid="practiceMissing || undefined" :aria-describedby="practiceMissing ? `${id}-practice-error` : undefined" :class="[fieldBase, 'min-h-24', practiceMissing ? 'border-destructive' : 'border-input']" placeholder="Try it first. Hints are here if you want them." />
          <p v-if="practiceMissing" :id="`${id}-practice-error`" data-testid="learn-canvas-check-practice-missing" class="mt-2 flex items-start gap-2 text-sm font-medium text-foreground"><CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />Write your answer before you submit.</p>
          <div class="mt-4 flex flex-wrap items-center gap-3"><button type="button" data-testid="learn-canvas-check-practice-submit" :disabled="practiceBusy || !isOnline" :class="primaryAction" @click="submitPractice">{{ practiceBusy ? 'Submitting…' : 'Submit response' }}</button></div>
          <p v-if="practiceFailed" role="alert" data-testid="learn-canvas-check-practice-error" class="mt-3 flex items-start gap-2 text-sm font-medium text-foreground"><CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />Submission did not confirm. Your draft remains here. Retry submission to reconcile it.</p>
        </template>
        <p v-else role="status" data-tone="neutral" data-testid="learn-canvas-check-practice-saved" class="mt-5 text-sm font-medium text-foreground">Response submitted.</p>
      </section>
    </template>
    <p class="sr-only" aria-live="polite">{{ notice }}</p>
  </section>
</template>
