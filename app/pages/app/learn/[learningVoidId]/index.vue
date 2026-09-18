<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- session rows are an adapter boundary from the authoritative projection. */
import type { LearnMapEdit, LearnScheduleInput, LearnWorkspaceSection } from '~/types/learn-v2-journey'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.learningVoidId))
const rawSection = computed(() => String(route.query.section ?? 'overview'))
const activeSection = computed<LearnWorkspaceSection>(() => ['overview', 'sources', 'map', 'plan', 'progress'].includes(rawSection.value) ? rawSection.value as LearnWorkspaceSection : 'overview')
const journey = useLearnV2Journey(id)
const { allowed, checkingAccess, mission, snapshot, sources, objectives, readiness, plan, busy, error, generation, generationIsActive, canResearch, researching, researchResults } = journey
const editingPlan = ref(false)
const selectedSourceId = ref<string | null>(null)
function editMap(payload: LearnMapEdit) { void journey.editLearningMap(payload) }
function generationStatusLabel(status: string) { return ({ queued: 'Queued', leased: 'Preparing', running: 'Generating', awaiting_approval: 'Ready for review', completed: 'Completed', failed: 'Needs attention' } as Record<string, string>)[status] ?? status.replaceAll('_', ' ') }
function savePlan(input: LearnScheduleInput) { if (plan.value) void journey.editPlanPreview(input, 'availability_changed').then(() => { editingPlan.value = false }); else void journey.createPlanPreview(input) }
function navigate(section: LearnWorkspaceSection) { void router.replace({ query: { ...route.query, section } }) }
function nextAction() {
  const action = snapshot.value?.nextAction.kind
  if (action === 'calibrate') void router.push(`/app/learn/${id.value}/calibration`)
  else if (action === 'start_session' || action === 'resume_session') {
    const session = mission.value?.plan?.sessions?.find((row: any) => ['ready', 'in_progress'].includes(row.status))
    if (session) void router.push(`/app/learn/${id.value}/sessions/${session._id}`)
  }
  else navigate(action === 'review_sources' || action === 'finish_setup' ? 'sources' : action === 'review_map' ? 'map' : action === 'review_plan' ? 'plan' : 'overview')
}
</script>
<template>
  <main>
    <section v-if="checkingAccess" class="mx-auto max-w-2xl p-6" aria-live="polite">Checking learning access…</section>
    <section v-else-if="!allowed" class="mx-auto max-w-2xl p-6">This learning experience is not available for this account.</section>
    <section v-else-if="!mission" class="mx-auto max-w-2xl p-6" aria-live="polite">Loading learning workspace…</section>
    <section v-else-if="!snapshot" class="mx-auto max-w-2xl p-6">Learning workspace not found.</section>
    <LearnV2MissionWorkspaceShell v-else :mission="snapshot" :active-section="activeSection" :readiness="readiness" @navigate="navigate" @act="nextAction">
      <p v-if="error" role="alert" class="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{{ error }} Refresh this workspace before retrying if another change was made.</p>
      <section v-if="activeSection === 'overview'" class="space-y-6">
        <UiCard class="p-5"><h2 class="font-dm-sans text-xl font-bold">{{ snapshot.nextAction.label }}</h2><p class="mt-2 text-sm text-muted-foreground">{{ snapshot.nextAction.detail }}</p><UiButton class="mt-4" data-testid="learn-v2-workspace-continue" @click="nextAction">Continue</UiButton></UiCard>
        <LearnV2CapabilityShelf :objectives="objectives" @open-objective="navigate('progress')" @start-review="nextAction" />
      </section>
      <section v-else-if="activeSection === 'sources'" class="space-y-5">
        <LearnV2EvidenceDesk :sources="sources" :selected-source-id="selectedSourceId" :can-research="canResearch" :research-busy="researching" :research-results="researchResults" @select-source="selectedSourceId = $event" @research="journey.researchPublicSources" @accept-source="sourceId => { const source = sources.find(item => item.id === sourceId); if (source) journey.acceptSource(source) }" @prepare-source="sourceId => { const source = sources.find(item => item.id === sourceId); if (source) journey.prepareSource(source) }" @reject-source="sourceId => { const source = sources.find(item => item.id === sourceId); if (source) journey.rejectSource(source) }" @add-url="journey.addUrlSource" />
        <UiCard v-if="mission?.currentBlueprint" class="p-4"><p class="text-sm text-muted-foreground">When the accepted evidence is ready, generate an editable capability map.</p><p v-if="generation" class="mt-2 text-sm text-muted-foreground" data-testid="learn-v2-map-generation-status">Map generation: {{ generationStatusLabel(generation.status) }}<template v-if="generation.terminalReason"> · {{ generation.terminalReason.replaceAll('_', ' ') }}</template></p><UiButton class="mt-3" data-testid="learn-v2-generate-map" :disabled="busy || generationIsActive || !mission.sources.counts.accepted" @click="journey.startMapGeneration">{{ generationIsActive ? 'Generating learning map…' : 'Generate learning map' }}</UiButton></UiCard>
      </section>
      <section v-else-if="activeSection === 'map'" class="space-y-5">
        <LearnV2LearningTrail :objectives="objectives" :sources="sources" :busy="busy" @edit-map="editMap" />
        <UiButton v-if="snapshot.lifecycle === 'map_review'" data-testid="learn-v2-accept-map" :disabled="busy" @click="journey.acceptLearningMap">Accept learning map</UiButton>
      </section>
      <section v-else-if="activeSection === 'plan'" class="space-y-5">
        <LearnV2StudyPlanEditor v-if="!plan || editingPlan" :input="journey.planInput()" :busy="busy" :submit-label="plan ? 'Update plan preview' : 'Build plan preview'" @submit="savePlan" @cancel="editingPlan = false" />
        <LearnV2StudyRhythm v-else :plan="plan" @accept-plan="journey.acceptPlan" @edit-plan="editingPlan = true" @resolve-constraint="editingPlan = true" />
      </section>
      <LearnV2CapabilityShelf v-else-if="activeSection === 'progress'" :objectives="objectives" @start-review="nextAction" />
    </LearnV2MissionWorkspaceShell>
  </main>
</template>
