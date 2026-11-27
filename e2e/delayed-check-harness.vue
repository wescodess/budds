<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { CONVEX_INJECTION_KEY } from '@convex-vue/core'
import { getFunctionName } from 'convex/server'
import TodaySession from '~/components/learn-v2/TodaySession.vue'
import CanvasCheck from '~/components/learn-adaptive/CanvasCheck.vue'
import type { CanvasCheckBinding } from '~/composables/useCanvasCheck'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, LEARN_V2_POST_SEAL_TEACHING_VERSION, learnAttemptHistorySchema, learnDeliveredAssessmentSchema, learnPostSealTeachingSchema } from '~~/shared/learn-v2-assessment-disclosure'
import { LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, learnAssessmentCapabilitiesSchema } from '~~/shared/learn-v2-delayed-check'
import { learnTodayCheckPointerSchema, learnTodayCheckRoute, type LearnTodayCheckPointer } from '~~/shared/learn-v2-today-check'

definePageMeta({ layout: false })
useHead({ title: 'Delayed check fixture', htmlAttrs: { lang: 'en' } })

// Static, synthetic projections for design captures. They are not learner data
// and carry no answer keys or rubrics. The shipped Today and Canvas check
// components render unchanged; a local client answers their reads and commands.
const states = [
  'today-locked', 'today-saved', 'today-unconfirmed', 'today-result-ready', 'today-closed',
  'entry', 'entry-refused', 'open', 'rejected', 'restored', 'save-failed', 'pending', 'help-limit', 'practice-submitted', 'scoring-failed',
  'unconfirmed', 'invalid', 'passed', 'publishing', 'not-yet', 'unavailable',
] as const
type State = typeof states[number]
const route = useRoute()
const state: State = states.find(value => value === route.query.state) ?? states[0]
const ready = ref(false)
const failed = ref<string | null>(null)

const OWNER = 'fixture_owner'
const THREAD = 'fixture_thread'
const OPPORTUNITY = 'fixture_opportunity'
const SUBMISSION = 'fixture_submission'
const ACCEPTED_AT = Date.UTC(2026, 10, 24, 10, 42)
const TITLE = 'Explain how temperature changes enzyme activity'
const ANSWER = 'Higher temperature makes molecules move faster, so the enzyme and substrate collide more often. That is why enzyme A speeds up. Enzyme B normally works at body temperature, so at 85°C its shape changes and the substrate no longer fits the active site.'
const NOT_YET_ANSWER = 'Higher temperature makes molecules move faster, so they collide more often. That is why enzyme A is faster. Enzyme B is probably just a slower enzyme.'
const SOURCE = { sourceRef: 'fixture_source_1', label: 'Biology notes: Enzymes and temperature' }
const PRACTICE = { responseSlotId: 'fixture_slot', revision: 1, tier: 'T0' as const, prompt: 'Cod live in water close to 4°C. One of their digestive enzymes works well at 4°C but loses most of its activity at 30°C, a temperature that barely affects the same enzyme in humans. What does this tell you about where an enzyme’s best temperature comes from?' }

const pointer = (reference: string, pointerState: LearnTodayCheckPointer['state']) => learnTodayCheckPointerSchema.parse({
  version: 'learn-v2.today-check-pointer.v2', reference, state: pointerState, timing: 'about_a_week', topic: 'Enzymes and temperature',
  destination: { kind: 'canvas', threadId: THREAD, route: learnTodayCheckRoute(THREAD, reference) },
})
const legacyPointer = (reference: string) => learnTodayCheckPointerSchema.parse({
  version: 'learn-v2.today-check-pointer.v1', reference, state: 'ready',
  destination: { kind: 'canvas', threadId: THREAD, route: learnTodayCheckRoute(THREAD, reference) },
})
const envelope = (checks: LearnTodayCheckPointer[]) => ({ status: 'available' as const, reasonCode: null, checks, isDone: true, continueCursor: null })
const candidate = {
  studySessionId: 'fixture_session', sessionRevision: 2, contentRevision: 1, planRecordRevision: 1, blueprintRecordRevision: 1,
  objectiveTitle: TITLE, estimatedMinutes: 15, scheduledStartAt: 0, timezone: 'UTC', reason: 'today', progress: { retained: 0, independent: 0, total: 0 },
}
const today = {
  'today-locked': { checkPointers: envelope([pointer('fixture_check', 'ready')]), checkLock: legacyPointer('fixture_check') },
  'today-saved': { checkPointers: envelope([pointer('fixture_check', 'saved_scoring')]), checkLock: null },
  'today-unconfirmed': { checkPointers: envelope([pointer('fixture_check', 'result_unconfirmed')]), checkLock: null },
  'today-result-ready': { checkPointers: envelope([pointer('fixture_check', 'result_ready')]), checkLock: null },
  'today-closed': { checkPointers: envelope([pointer('fixture_check', 'closed')]), checkLock: null },
} as Partial<Record<State, { checkPointers: ReturnType<typeof envelope>, checkLock: LearnTodayCheckPointer | null }>>
const todayProps = today[state] ?? null

const capabilities = (overrides: Partial<Record<'canDeliver' | 'canSubmit' | 'canRequestAssistance' | 'canTeachSeparateCase' | 'canReadFeedback', boolean>>) => learnAssessmentCapabilitiesSchema.parse({
  version: LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, status: 'available', canDeliver: false, canSubmit: false, canRequestAssistance: false,
  canTeachSeparateCase: false, canReadFeedback: false, reasonCodes: [], ...overrides,
})
const assessmentState = (phase: string, revision: number, submissionId: string | null, caps: ReturnType<typeof capabilities>) => ({
  version: 'learn-v2.public-api.v1', status: 'available', assessmentOpportunityId: OPPORTUNITY, revision, phase, submissionId, capabilities: caps,
})
const sealedCaps = capabilities({ canRequestAssistance: true, canTeachSeparateCase: true })
const scoredCaps = capabilities({ canRequestAssistance: true, canTeachSeparateCase: true, canReadFeedback: true })
const delivery = learnDeliveredAssessmentSchema.parse({
  status: 'delivered', version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, assessmentOpportunityId: OPPORTUNITY, deliveryGrantId: 'fixture_grant',
  identity: { kind: 'measurement', itemId: 'fixture_item', itemRevision: 1, promptDigest: 'a'.repeat(64) }, phase: 'test_open',
  declaredStimulus: 'Two enzymes are tested at 40°C and at 85°C. Enzyme A comes from a bacterium that lives in a hot spring. Enzyme B comes from the human liver.',
  prompt: 'At 85°C, enzyme A works faster than at 40°C, but enzyme B almost stops. Explain why both results make sense.',
  instructions: 'Answer in your own words.',
  responseSpec: { kind: 'bounded_rubric', version: 'learn-v2.response-format.v1', maxCodeUnits: 12000 },
})
const assistanceSnapshot = { policyVersion: 'learn-v2.assistance.session-wide.v1', state: 'unassisted', assistanceRevision: 0, substantiveHintUsedAt: null, answerRevealedAt: null, priorExposure: 'prospectively_unexposed', outsideHelp: 'unknown', pasteObserved: 'unknown', focusLossObserved: 'unknown', instrumentationVersion: 'learn-v2.instrumentation.unknown.v1', instrumentationProvenance: 'fixture' }
const validSnapshot = { policyVersion: 'learn-v2.assessment-validity.v1', status: 'valid', measurementEligible: true, masteryEligible: true, exclusionReasons: [] }
const excludedSnapshot = { policyVersion: 'learn-v2.assessment-validity.v1', status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['evidence_unavailable'] }
const work = (input: { answer?: string, feedbackCodes?: string[], excluded?: boolean } = {}) => ({
  version: 'learn-v2.public-api.v1', status: 'available', target: { assessmentOpportunityId: OPPORTUNITY }, revision: 3, state: 'accepted',
  work: learnAttemptHistorySchema.parse({
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, submissionId: SUBMISSION, acceptedAt: ACCEPTED_AT, confidence: 4, assistanceSnapshot,
    validitySnapshot: input.excluded ? excludedSnapshot : validSnapshot, currentEligibility: input.excluded ? 'excluded' : 'eligible',
    body: { bodyAvailability: 'available', payload: { kind: 'text', text: input.answer ?? ANSWER } },
    result: input.feedbackCodes ? { attemptId: 'fixture_attempt', scorePercent: 50, thresholdPercent: 80, scoreCommittedAt: ACCEPTED_AT + 60_000, feedbackCodes: input.feedbackCodes } : null,
  }),
})
const helpOpen = { remaining: 8, hint: { status: 'unavailable', reasonCode: 'unavailable' }, worked_example: { status: 'available' } }
const teaching = (input: { feedbackState: string, practiceState: 'not_opened' | 'available', help?: unknown, feedback?: unknown, lesson?: unknown, practice?: unknown }) => learnPostSealTeachingSchema.parse({
  version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: OPPORTUNITY,
  feedback: input.feedback ?? null, lesson: input.lesson ?? null, practice: input.practice ?? null,
  availability: { feedback: input.feedbackState, practice: { status: input.practiceState }, help: input.practiceState === 'available' ? input.help ?? helpOpen : null },
})
const feedbackPass = { tier: 'T0', text: 'You explained both results. Heat speeds up enzyme A because its shape holds at high temperatures, and the same heat stops enzyme B because it changes shape and the substrate no longer fits.', citations: [SOURCE] }
const feedbackMiss = { tier: 'T0', text: 'You explained why enzyme A speeds up. The part about enzyme B is missing: heat sped up enzyme A, so why would the same heat stop enzyme B? Being “a slower enzyme” doesn’t explain a drop to almost nothing.', citations: [SOURCE] }
const lesson = { tier: 'T0', citations: [SOURCE], paragraphs: [
  'Every enzyme has a temperature range where its shape holds and its active site fits the substrate. Inside that range, warming speeds the reaction because molecules collide more often. Past the top of the range, the bonds holding the shape break, the active site deforms, and activity falls fast.',
  'Where that range sits depends on where the organism lives. Enzymes from hot springs hold their shape far above body temperature; enzymes from cold-water fish start to unfold at temperatures we would call mild.',
] }
const practiceSlot = (accepted: boolean) => ({
  version: 'learn-v2.public-api.v1', status: 'available', target: { responseSlotId: PRACTICE.responseSlotId }, revision: accepted ? 2 : 1,
  state: accepted ? 'accepted' : 'open',
  work: accepted ? learnAttemptHistorySchema.parse({
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, submissionId: 'fixture_practice_submission', acceptedAt: ACCEPTED_AT + 120_000, assistanceSnapshot,
    validitySnapshot: validSnapshot, currentEligibility: 'eligible', result: null,
    body: { bodyAvailability: 'available', payload: { kind: 'text', text: 'Each enzyme’s best temperature matches where its organism lives.' } },
  }) : null,
})
const practiceTeaching = (feedbackState: string, help?: unknown) => teaching({ feedbackState, practiceState: 'available', practice: PRACTICE, help })

type CanvasFixture = { binding: CanvasCheckBinding, queries: Record<string, unknown>, attach?: unknown, offline?: boolean, practiceAccepted?: boolean }
const delivered: CanvasCheckBinding = { assessmentOpportunityId: OPPORTUNITY, submissionId: null, receipt: null, timing: 'about_a_week', start: null }
const awaiting: CanvasCheckBinding = { ...delivered, start: { studySessionId: 'fixture_session', expectedSessionRevision: 2 } }
const readyState = assessmentState('ready', 1, null, capabilities({ canDeliver: true }))
const openState = assessmentState('test_open', 2, null, capabilities({ canSubmit: true }))
const openQueries = { getAssessmentState: openState, getAssessment: delivery }
const canvasFixtures: Partial<Record<State, CanvasFixture>> = {
  'entry': { binding: awaiting, queries: { getAssessmentState: readyState } },
  'entry-refused': { binding: awaiting, queries: { getAssessmentState: readyState }, attach: { kind: 'not_admitted', reasonCode: 'outside_window', observations: 'no_observations' } },
  'open': { binding: delivered, queries: openQueries },
  'rejected': { binding: delivered, queries: openQueries },
  'restored': { binding: delivered, queries: openQueries },
  'save-failed': { binding: delivered, queries: openQueries, offline: true },
  'pending': { binding: delivered, queries: { getAssessmentState: assessmentState('scoring_pending', 3, SUBMISSION, sealedCaps), getResponseState: work(), getPostSealTeaching: practiceTeaching('scoring_pending') } },
  'help-limit': { binding: delivered, queries: { getAssessmentState: assessmentState('scoring_pending', 3, SUBMISSION, sealedCaps), getResponseState: work(),
    getPostSealTeaching: practiceTeaching('scoring_pending', { remaining: 0, hint: { status: 'unavailable', reasonCode: 'help_limit_reached' }, worked_example: { status: 'delivered' } }) } },
  'practice-submitted': { binding: delivered, practiceAccepted: true, queries: { getAssessmentState: assessmentState('scoring_pending', 3, SUBMISSION, sealedCaps), getResponseState: work(), getPostSealTeaching: practiceTeaching('scoring_pending') } },
  'scoring-failed': { binding: delivered, queries: { getAssessmentState: assessmentState('retryable_failure', 3, SUBMISSION, sealedCaps), getResponseState: work(), getPostSealTeaching: practiceTeaching('scoring_pending') } },
  'unconfirmed': { binding: delivered, queries: { getAssessmentState: assessmentState('reconciliation_required', 3, SUBMISSION, sealedCaps), getResponseState: work(), getPostSealTeaching: practiceTeaching('scoring_pending') } },
  'invalid': { binding: delivered, queries: { getAssessmentState: assessmentState('invalid', 3, SUBMISSION, sealedCaps), getResponseState: work({ excluded: true }), getPostSealTeaching: practiceTeaching('unavailable') } },
  'passed': { binding: delivered, queries: { getAssessmentState: assessmentState('scored_pass', 4, SUBMISSION, scoredCaps), getResponseState: work({ feedbackCodes: ['pass'] }),
    getPostSealTeaching: teaching({ feedbackState: 'available', practiceState: 'not_opened', feedback: feedbackPass }) } },
  'publishing': { binding: delivered, queries: { getAssessmentState: assessmentState('scored_pass', 4, SUBMISSION, scoredCaps), getResponseState: work({ feedbackCodes: ['pass'] }),
    getPostSealTeaching: teaching({ feedbackState: 'feedback_publishing', practiceState: 'not_opened' }) } },
  'not-yet': { binding: delivered, queries: { getAssessmentState: assessmentState('scored_fail', 4, SUBMISSION, scoredCaps), getResponseState: work({ answer: NOT_YET_ANSWER, feedbackCodes: ['needs_review'] }),
    getPostSealTeaching: teaching({ feedbackState: 'available', practiceState: 'available', feedback: feedbackMiss, lesson, practice: PRACTICE }) } },
  'unavailable': { binding: delivered, queries: { getAssessmentState: { version: 'learn-v2.public-api.v1', status: 'unavailable', reasonCodes: ['assessment_unavailable'] } } },
}
const canvasFixture = canvasFixtures[state] ?? null

const expected: Record<State, string> = {
  'today-locked': '[data-testid=learn-v2-session-locked]',
  'today-saved': '[data-testid=learn-v2-check-row-saved_scoring]',
  'today-unconfirmed': '[data-testid=learn-v2-check-row-result_unconfirmed]',
  'today-result-ready': '[data-testid=learn-v2-check-row-result_ready]',
  'today-closed': '[data-testid=learn-v2-check-row-closed]',
  'entry': '[data-testid=learn-canvas-check-start]',
  'entry-refused': '[data-testid=learn-canvas-check-start-error]',
  'open': '[data-testid=learn-canvas-check-question]',
  'rejected': '[data-testid=learn-canvas-check-answer-error]',
  'restored': '[data-testid=learn-canvas-check-restored]',
  'save-failed': '[data-testid=learn-canvas-check-submit-error]',
  'pending': '[data-testid=learn-canvas-check-practice] [data-testid=learn-canvas-check-practice-answer]',
  'help-limit': '[data-testid=learn-canvas-check-help-limit]',
  'practice-submitted': '[data-testid=learn-canvas-check-practice-saved]',
  'scoring-failed': '[data-testid=learn-canvas-check-practice-collapsed]',
  'unconfirmed': '[data-testid=learn-canvas-check-practice-collapsed]',
  'invalid': '[data-testid=learn-canvas-check-receipt][data-receipt=invalid]',
  'passed': '[data-testid=learn-canvas-check-feedback]',
  'publishing': '[data-testid=learn-canvas-check-feedback-publishing]',
  'not-yet': '[data-testid=learn-canvas-check-lesson]',
  'unavailable': '[data-testid=learn-canvas-check-unavailable]',
}

function queryValue(name: string, args?: unknown) {
  if (!canvasFixture) return null
  if (name.endsWith(':getResponseState') && (args as { target?: { responseSlotId?: string } } | undefined)?.target?.responseSlotId) return practiceSlot(canvasFixture.practiceAccepted === true)
  const key = Object.keys(canvasFixture.queries).find(suffix => name.endsWith(`:${suffix}`))
  return key ? canvasFixture.queries[key] : null
}
function command(name: string) {
  if (name.endsWith(':attachReadySession')) return canvasFixture?.attach ?? { kind: 'not_admitted', reasonCode: 'fixture', observations: 'no_observations' }
  if (name.endsWith(':publishFeedback')) return queryValue('learnV2Assessments:getPostSealTeaching')
  throw new Error(`Delayed check fixture does not dispatch ${name}`)
}
const fixtureClient = {
  onUpdate(query: never, args: unknown, onValue: (value: unknown) => void) {
    const value = queryValue(getFunctionName(query), args)
    queueMicrotask(() => onValue(value))
    return () => {}
  },
  mutation: async (reference: never) => command(getFunctionName(reference)),
  action: async (reference: never) => command(getFunctionName(reference)),
  query: async (query: never, args: unknown) => queryValue(getFunctionName(query), args),
  client: { localQueryResult: () => undefined },
}
if (import.meta.client) {
  useNuxtApp().vueApp.provide(CONVEX_INJECTION_KEY, fixtureClient as never)
  if (state === 'restored') {
    sessionStorage.setItem(`learn-response:${OWNER}:${THREAD}:check:${OPPORTUNITY}`, JSON.stringify({
      response: 'Higher temperature makes molecules move faster, so the enzyme and substrate collide more often. That is why enzyme A speeds up. Enzyme B', confidence: 3, savedAt: Date.now(),
    }))
  }
}

const find = <T extends Element>(selector: string) => document.querySelector<T>(selector)
async function frame() { await new Promise(resolve => requestAnimationFrame(() => resolve(null))) }
async function waitFor(selector: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (find(selector)) return find(selector)!
    await frame()
  }
  throw new Error(`Fixture state ${state} did not render ${selector}`)
}
async function click(selector: string) {
  (await waitFor(selector) as HTMLElement).click()
  await nextTick()
}

onMounted(async () => {
  try {
    if (state === 'entry-refused') await click('[data-testid=learn-canvas-check-start]')
    if (state === 'rejected') {
      await click('[data-testid=learn-canvas-check-confidence-3]')
      await click('[data-testid=learn-canvas-check-submit]')
    }
    if (state === 'save-failed') {
      const field = await waitFor('[data-testid=learn-canvas-check-answer]') as HTMLTextAreaElement
      if (canvasFixture?.offline) window.dispatchEvent(new Event('offline'))
      await nextTick()
      field.value = ANSWER
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await click('[data-testid=learn-canvas-check-confidence-4]')
      await click('[data-testid=learn-canvas-check-submit]')
    }
    await waitFor(expected[state])
    ;(document.activeElement as HTMLElement | null)?.blur()
    await frame()
    await frame()
    ready.value = true
  }
  catch (error) {
    failed.value = error instanceof Error ? error.message : String(error)
  }
})
</script>

<template>
  <main data-testid="delayed-check-harness" :data-state="state" :data-ready="ready" :data-error="failed ?? undefined" class="min-h-screen bg-background text-foreground">
    <ClientOnly>
      <div data-testid="delayed-check-frame">
        <TodaySession v-if="todayProps" :candidate :check-pointers="todayProps.checkPointers" :check-lock="todayProps.checkLock" />
        <div v-else-if="canvasFixture" class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          <CanvasCheck :owner-id="OWNER" :thread-id="THREAD" :outcome="TITLE" intent="Biology" :binding="canvasFixture.binding" />
        </div>
      </div>
    </ClientOnly>
  </main>
</template>
