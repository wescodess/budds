<script setup lang="ts">
import ReadySessionCanvas from '~/components/learn-adaptive/ReadySessionCanvas.vue'
import DiagnosticCanvas from '~/components/learn-adaptive/DiagnosticCanvas.vue'
import ArtifactWorkspace from '~/components/learn-adaptive/ArtifactWorkspace.vue'
import ReflectionNextMove from '~/components/learn-adaptive/ReflectionNextMove.vue'

definePageMeta({ layout: false })

// Static, bounded projections. They are browser fixtures, not learner data or
// evidence of a server decision. The production renderer components remain real.
const route = useRoute()
const projectionOnly = Reflect.get(globalThis, '__buddsCanvasProjectionOnly') === true
const kinds = ['cited_explanation', 'diagnostic_prompt', 'worked_example', 'independent_application', 'source_comparison', 'artifact_workspace', 'reflection_next_move'] as const
const states = ['ready', 'active', 'completed', 'fallback', 'blocked', 'preparing', 'offline'] as const
const kind = computed(() => kinds.find(value => value === route.query.kind) ?? kinds[0])
const state = computed(() => states.find(value => value === route.query.state) ?? states[0])
const fixtureId = computed(() => `browser-${kind.value}`)
const fallback = { title: 'Activity unavailable', body: 'Your work remains available. Return to Learn to continue safely.', testId: 'learn-activity-fallback', primaryAction: { label: 'Back to Learn' } }
const contractVersion = 'learn-adaptive.activity-contract.v1'
const rendererVersion = 'learn-adaptive.renderer.v1'
const sourceRefs = ['source_1', 'source_2']
const descriptors = {
  cited_explanation: { action: 'continue', label: 'Continue', props: { heading: 'An accepted explanation', explanation: 'A bounded explanation supported by reviewed source material.', sourceRefs: ['source_1'] } },
  diagnostic_prompt: { action: 'submit_response', label: 'Save response', props: { prompt: 'What do you already know about this topic?', responseFormat: 'long_text', assistance: 'none' } },
  worked_example: { action: 'reveal_example', label: 'Reveal example', props: { heading: 'Guided example', problem: 'Work through one bounded example.', steps: ['Identify the premise.', 'Apply the rule.'], guidedConsequence: 'Reviewing this is guided support.', sourceRefs: ['source_1'] } },
  independent_application: { action: 'submit_response', label: 'Submit response', props: { prompt: 'Explain the result in your own words.', responseFormat: 'long_text', draftPersistence: true } },
  source_comparison: { action: 'choose_source', label: 'Choose source', props: { prompt: 'Which source best supports the claim?', sources: [
    { sourceRef: 'source_1', label: 'Source A', summary: 'A primary observation.', integrityState: 'accepted' },
    { sourceRef: 'source_2', label: 'Source B', summary: 'A later review.', integrityState: 'accepted' },
  ] } },
  artifact_workspace: { action: 'save_artifact', label: 'Save artifact', props: { prompt: 'Make a short plan.', artifactKind: 'plan', starterText: 'First step:' } },
  reflection_next_move: { action: 'accept_next_move', label: 'Accept next move', props: { feedback: 'You completed a guided step.', nextMove: 'Try one independent example.', allowedDecisions: ['accept', 'override', 'end'] } },
} as const
const primitive = computed(() => {
  const descriptor = descriptors[kind.value]
  return {
    contractVersion,
    rendererVersion: state.value === 'fallback' ? 'learn-adaptive.renderer.unknown' : rendererVersion,
    type: kind.value,
    action: descriptor.action,
    testId: `learn-primitive-${kind.value.replaceAll('_', '-')}`,
    props: descriptor.props,
  }
})
const common = computed(() => ({ ownerId: 'browser-fixture-owner', thread: { id: `browser-${kind.value}-thread`, revision: 3, outcome: 'Practice this topic', intent: 'understand', lifecycle: 'active' } }))
const readyCanvas = computed(() => ({
  ...common.value,
  status: state.value === 'completed' ? 'feedback' : state.value === 'blocked' || state.value === 'preparing' ? 'blocked' : state.value === 'ready' ? 'ready' : 'started',
  activity: {
    id: fixtureId.value, status: 'eligible', purpose: 'Practice one bounded activity.', reasonCode: 'browser_fixture', planRevision: state.value === 'fallback' ? 0 : 1,
    evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: 'accepted', sourceRefs },
    primitive: primitive.value, fallback,
    requiredAction: { kind: descriptors[kind.value].action, label: descriptors[kind.value].label },
  },
  session: { studySessionId: 'browser-fixture-session', revision: 2, contentRevision: 1, planRecordRevision: 1, blueprintRecordRevision: 1, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' },
  responsePrompt: kind.value === 'independent_application' ? descriptors.independent_application.props.prompt : 'Explain the result in your own words.',
  recoveryState: state.value === 'preparing' ? 'preparing' : state.value === 'blocked' ? 'blocked' : null,
  recovery: { title: state.value === 'preparing' ? 'Preparing activity' : 'Activity blocked', body: 'Your response remains available. Check the source in Learn.', action: 'Back to Learn' },
  savedResponse: state.value === 'completed' ? { response: 'A saved fixture response.', confidence: 3 } : null,
}))
const diagnosticCanvas = computed(() => ({
  ...common.value,
  status: state.value === 'blocked' || state.value === 'preparing' ? 'blocked' : 'eligible', evidenceState: 'non_factual', decisionPending: false,
  recovery: { title: 'Starting point', body: 'This response is not scored.', action: 'Back to Learn' },
  activity: { id: fixtureId.value, planRevision: state.value === 'fallback' ? 0 : 1, status: 'eligible', primitive: primitive.value,
    response: state.value === 'completed' ? 'A saved starting point.' : null,
    requiredAction: { kind: 'submit_response', label: 'Save response' } },
}))
const artifactCanvas = computed(() => ({
  ...common.value,
  status: state.value === 'blocked' ? 'blocked' : 'eligible',
  activity: { id: fixtureId.value, planRevision: state.value === 'fallback' ? 0 : 1, status: 'eligible', primitive: primitive.value, fallback },
}))
const reflectionCanvas = computed(() => ({
  ...common.value,
  status: state.value === 'blocked' ? 'blocked' : state.value === 'completed' ? 'completed' : 'eligible',
  decision: state.value === 'completed' ? { outcome: 'accepted', nextMove: 'Try one independent example.', decidedAt: 1 } : null,
  activity: { id: fixtureId.value, planRevision: state.value === 'fallback' ? 0 : 1, status: 'eligible', purpose: 'Choose what to do next.', reason: 'A guided step has ended.', primitive: primitive.value, fallback },
}))
const left = ref(false)
</script>

<template>
  <main class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" data-testid="canvas-browser-harness" :data-projection-only="projectionOnly">
    <h1 class="text-2xl font-semibold">Canvas browser fixture</h1>
    <p class="mt-2 text-sm">Static projection for local browser testing. No learning result is saved here.</p>
    <p v-if="left" role="status">Back to Learn was requested.</p>
    <section class="mt-6 rounded-xl bg-[var(--learn-activity-surface)] p-4" data-testid="learn-adaptive-canvas-frame" aria-label="Current learning activity">
      <ReadySessionCanvas v-if="['cited_explanation', 'worked_example', 'independent_application', 'source_comparison'].includes(kind)" :key="`${kind}:${state}`" :canvas="readyCanvas as never" :show-header="false" :active="false" @leave="left = true" />
      <DiagnosticCanvas v-else-if="kind === 'diagnostic_prompt'" :key="`${kind}:${state}`" :canvas="diagnosticCanvas as never" :show-header="false" :active="false" @leave="left = true" />
      <ArtifactWorkspace v-else-if="kind === 'artifact_workspace'" :key="`${kind}:${state}`" :canvas="artifactCanvas as never" @leave="left = true" />
      <ReflectionNextMove v-else :key="`${kind}:${state}`" :canvas="reflectionCanvas as never" @leave="left = true" />
    </section>
  </main>
</template>
