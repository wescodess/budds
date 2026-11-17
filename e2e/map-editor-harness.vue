<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import type { LearnMapSaveResult, LearnObjectiveSnapshot, LearnSourceSnapshot } from '~/types/learn-v2-journey'

definePageMeta({ layout: false })

// Static, synthetic map fixtures for design captures. They are not learner data.
// The production map editor and workspace shell render unchanged.
const states = ['full', 'order', 'unsaved', 'sources', 'first', 'saving', 'failed', 'changed', 'long', 'empty'] as const
const route = useRoute()
const state = states.find(value => value === route.query.state) ?? states[0]
const ready = ref(false)

const milestones = ['Reading the trial', 'Reading the numbers', 'Making a call']
const sourceRows: Array<[string, LearnSourceSnapshot['origin'], string | undefined]> = [
  ['CONSORT 2010 explanation and elaboration', 'general_web_search', 'bmj.com'],
  ['Designing Clinical Research, chapter 10', 'folder_document', undefined],
  ['Week 4 lecture notes: survival analysis', 'folder_document', undefined],
  ['Number needed to treat: a practical guide', 'user_url', 'cebm.ox.ac.uk'],
  ['How to read a subgroup analysis', 'open_database', 'pmc.ncbi.nlm.nih.gov'],
]
const sources: LearnSourceSnapshot[] = sourceRows.map(([title, origin, publisher], index) => ({
  id: `source-${index + 1}`, sourceKey: `identity-${index + 1}`, title, origin, publisher, retrievedLabel: 'Accepted', coverage: 'strong', lifecycle: 'user_accepted', objectives: [],
}))
const longTitle = 'Work out why a trial’s registered endpoint, its analysis plan and the results it finally reports can disagree, and what that disagreement should change about how far you trust the headline finding'
type Row = [number, string, string, number, LearnObjectiveSnapshot['depth'], number[], number[], LearnObjectiveSnapshot['coverage']?, string?]
const rows: Row[] = [
  [0, 'Explain what randomisation protects a trial against', 'Describe how random assignment balances known and unknown differences between groups, and what can still go wrong.', 25, 'foundational', [1, 2], []],
  [0, 'Explain how blinding keeps expectations out of the results', 'Say who was kept unaware of the treatment, and what could change if they weren’t.', 20, 'foundational', [1, 2], [1]],
  [0, 'Tell intention-to-treat apart from per-protocol analysis', 'Say which analysis a paper used and how that choice changes what its result means.', 30, 'working', [1, 2], [1]],
  [0, 'Follow patients through a trial’s flow diagram', 'Trace people from enrolment to analysis, and spot where and why they dropped out.', 25, 'foundational', [1], [3]],
  [0, longTitle, 'Compare what a trial said it would measure with what it reported, and explain what any difference means for the result.', 45, 'working', [1], [3], 'partial', 'Your sources explain trial registration, but not how to spot an outcome that was quietly changed.'],
  [1, 'Read a hazard ratio and its confidence interval', 'Explain what a hazard ratio says about risk over time, and use its confidence interval to say how sure the trial can be.', 35, 'working', [3, 2], [1]],
  [1, 'Read a Kaplan–Meier curve', 'Read survival over time from the curve, and say what the numbers at risk tell you.', 30, 'working', [3], [6]],
  [1, 'Turn relative risk into absolute risk and number needed to treat', 'Work from a relative effect to what it means for a typical patient.', 30, 'working', [3, 4], [6]],
  [1, 'Say what a p-value can and can’t tell you', 'Explain a p-value in plain words, and why a small one doesn’t make an effect large.', 30, 'foundational', [2], [6]],
  [1, 'Decide whether a subgroup finding is believable', 'Explain why a subgroup result may be chance, and what makes one more convincing.', 40, 'advanced', [5], [6], 'partial', 'Your sources cover the warning signs, but not how to tell whether an effect really differs between groups.'],
  [2, 'Spot the common ways a trial overstates its benefit', 'Find selective reporting, surrogate outcomes and short follow-up in a real paper.', 45, 'working', [1, 4, 5], [5, 8]],
  [2, 'Check whether the trial’s patients look like yours', 'Compare who was enrolled with the people you care about, and say how far the result carries over.', 30, 'working', [1, 4], [11]],
  [2, 'Weigh a single trial against the wider research', 'Place one result alongside earlier trials and say how much it should change your view.', 40, 'advanced', [], [11], 'gap', 'None of your sources explain meta-analysis or how to read a forest plot.'],
  [2, 'Spot harms that a trial under-reports', 'Find where side effects were recorded, how they were reported and what’s left out.', 35, 'working', [1], [11], 'partial', 'Your sources mention how harms are reported, but not what a complete harms table looks like.'],
  [2, 'Summarise a trial for someone who has to act on it', 'Write a short, honest summary of what a trial found and who it applies to.', 30, 'advanced', [3, 4], [8, 11]],
]
const objectives: LearnObjectiveSnapshot[] = state === 'empty' ? [] : rows.map(([milestone, title, capability, effortMinutes, depth, cited, after, coverage = 'strong', gapReason], index) => ({
  id: `objective_${index + 1}`, stableKey: `objective-${index + 1}`, title, capability, milestoneKey: `milestone-${milestone + 1}`, milestone: milestones[milestone]!,
  effortMinutes, depth, mastery: 'unseen', coverage, gapReason, prerequisiteIds: [], prerequisiteKeys: after.map(number => `objective-${number}`),
  sourceLinks: cited.map(number => ({ sourceKey: `identity-${number}`, title: sources[number - 1]!.title, origin: sources[number - 1]!.origin, coverage: 'strong', evidenceStatus: 'evidence_available' })),
}))
const mission = { id: 'map-editor-fixture', title: 'Read and interpret clinical trial results', folderName: 'Epidemiology 301', lifecycle: 'map_review' as const, nextAction: { kind: 'review_map' as const, label: 'Review learning map', detail: 'Confirm what you’ll learn and in what order.' }, mastery: { retained: 0, independent: 0, learning: 0, needsReview: 0, total: objectives.length } }
const readiness = [{ id: 'outcome', label: 'Outcome', state: 'complete' as const }, { id: 'sources', label: 'Sources', state: 'complete' as const, detail: '5 accepted' }, { id: 'map', label: 'Learning map', state: 'current' as const }, { id: 'plan', label: 'Study plan', state: 'locked' as const }]
const save = (): Promise<LearnMapSaveResult> => state === 'saving' ? new Promise(() => {}) : Promise.resolve({ ok: false, reason: state === 'changed' ? 'changed' : 'failed' })

const find = <T extends Element>(selector: string) => document.querySelector<T>(selector)
async function click(selector: string) {
  find<HTMLElement>(selector)!.click()
  await nextTick()
}
async function type(selector: string, value: string) {
  const field = find<HTMLInputElement | HTMLTextAreaElement>(selector)!
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
const chip = (label: string) => [...document.querySelectorAll<HTMLElement>('[aria-expanded]')].find(element => element.textContent?.includes(label))!

onMounted(async () => {
  await nextTick()
  if (state === 'order') {
    await click('[data-testid=learn-v2-map-select-objective-10]')
    await click('[data-testid=learn-v2-map-order]')
  }
  if (state === 'unsaved' || state === 'sources') {
    await click('[data-testid=learn-v2-map-select-objective-10]')
    await click('[data-testid=learn-v2-objective-sources]')
    if (state === 'unsaved') {
      await click('input[type=checkbox][value=identity-4]')
      await click('[role=dialog] [data-slot=button]')
    }
  }
  if (state === 'first') {
    await click('[data-testid=learn-v2-map-select-objective-8]')
    chip('change what to learn first').click()
    await nextTick()
  }
  if (state === 'saving' || state === 'failed' || state === 'changed') {
    await click('[data-testid=learn-v2-map-select-objective-3]')
    chip('change time').click()
    await nextTick()
    await type('[data-testid=learn-v2-objective-effort]', '40')
    await click('[role=dialog] [data-slot=button]')
    await click('[data-testid=learn-v2-save-objective]')
  }
  if (state === 'long') {
    await click('[data-testid=learn-v2-map-select-objective-5]')
    await type('[data-testid=learn-v2-objective-title]', `${longTitle.slice(0, 160)}, and what you’d ask the authors`)
  }
  await new Promise(resolve => setTimeout(resolve, 0))
  ready.value = true
})
</script>

<template>
  <div data-testid="map-editor-harness" :data-state="state" :data-ready="ready">
    <LearnV2MissionWorkspaceShell :mission="mission" active-section="map" :readiness="readiness">
      <LearnV2LearningTrail :objectives="objectives" :sources="sources" :can-accept="true" :save="save" />
    </LearnV2MissionWorkspaceShell>
  </div>
</template>
