<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, BookOpenCheck, ChevronDown, ChevronUp, CircleAlert, GripVertical, Link2, Plus, Route, Scissors, Trash2, X } from '@lucide/vue'
import type { LearnMapEdit, LearnMasteryState, LearnObjectiveDraft, LearnObjectiveSnapshot, LearnSourceSnapshot } from '~/types/learn-v2-journey'

const { objectives, sources = [], selectedObjectiveId = null, busy = false } = defineProps<{
  objectives: LearnObjectiveSnapshot[]
  sources?: LearnSourceSnapshot[]
  selectedObjectiveId?: string | null
  busy?: boolean
}>()
const emit = defineEmits<{ selectObjective: [objectiveId: string]; editMap: [edit: LearnMapEdit] }>()

const selectedKey = ref<string | null>(null)
const selected = computed(() => objectives.find(item => item.id === selectedObjectiveId)
  ?? objectives.find(item => item.stableKey === selectedKey.value)
  ?? objectives[0]
  ?? null)
const editor = ref<LearnObjectiveDraft | null>(null)
const split = ref<{ objectiveKey: string; firstTitle: string; secondTitle: string } | null>(null)
const pendingRemovalKey = ref<string | null>(null)
const milestones = computed(() => [...new Map(objectives.map(item => [item.milestoneKey, item.milestone])).entries()].map(([key, title]) => ({ key, title })))
const acceptedSources = computed(() => sources.filter(source => source.lifecycle === 'user_accepted'))
const reviewedSources = computed(() => sources.filter(source => !['rejected', 'unavailable'].includes(source.lifecycle)))
const criterionWeight = computed(() => editor.value?.assessmentContract.criteria.reduce((total, item) => total + Number(item.weightPercent || 0), 0) ?? 0)
const editorValid = computed(() => {
  const draft = editor.value
  if (!draft?.title.trim() || !draft.capability.trim() || !draft.milestoneKey || draft.effortMinutes < 5 || draft.effortMinutes > 480) return false
  if (!draft.assessmentContract.instructions.trim() || !draft.assessmentContract.criteria.length || criterionWeight.value !== 100) return false
  if (draft.assessmentContract.criteria.some(item => !item.description.trim() || item.weightPercent < 1 || item.weightPercent > 100)) return false
  if (draft.coverage === 'strong' && draft.supportingSourceKeys.length === 0) return false
  if (draft.coverage === 'partial' && (draft.supportingSourceKeys.length === 0 || !draft.gapReason?.trim())) return false
  return draft.coverage !== 'gap' || Boolean(draft.gapReason?.trim())
})

watch(selected, (item) => {
  if (!item) return
  selectedKey.value = item.stableKey
  if (editor.value?.objectiveKey === item.stableKey) editor.value = draftFrom(item)
}, { flush: 'sync' })

function draftFrom(item: LearnObjectiveSnapshot): LearnObjectiveDraft {
  return {
    objectiveKey: item.stableKey,
    title: item.title,
    capability: item.capability,
    milestoneKey: item.milestoneKey,
    effortMinutes: item.effortMinutes,
    depth: item.depth,
    coverage: item.coverage,
    gapReason: item.gapReason,
    supportingSourceKeys: item.sourceLinks.filter(link => link.coverage !== 'gap').map(link => link.sourceKey),
    gapSourceKeys: item.sourceLinks.filter(link => link.coverage === 'gap').map(link => link.sourceKey),
    prerequisiteKeys: [...item.prerequisiteKeys],
    assessmentContract: { ...item.assessmentContract, criteria: item.assessmentContract.criteria.map(criterion => ({ ...criterion })) },
  }
}

function blankDraft(): LearnObjectiveDraft {
  const template = selected.value ?? objectives.at(-1)
  if (!template) throw new Error('A generated map is required before adding objectives')
  return {
    title: '', capability: '', milestoneKey: template.milestoneKey, effortMinutes: 25, depth: template.depth,
    coverage: template.coverage, gapReason: template.gapReason,
    supportingSourceKeys: template.sourceLinks.filter(link => link.coverage !== 'gap').map(link => link.sourceKey),
    gapSourceKeys: template.sourceLinks.filter(link => link.coverage === 'gap').map(link => link.sourceKey),
    prerequisiteKeys: [template.stableKey],
    assessmentContract: { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric', responseFormat: 'short_text', instructions: 'Demonstrate the capability using the accepted evidence.', passingScorePercent: 80, criteria: [{ key: 'correct', description: 'The response is correct and supported by the accepted evidence.', weightPercent: 100 }] },
  }
}

function choose(item: LearnObjectiveSnapshot) { selectedKey.value = item.stableKey; emit('selectObjective', item.id) }
function editSelected() { if (selected.value) editor.value = draftFrom(selected.value) }
function addNew() { if (objectives.length < 15) editor.value = blankDraft() }
function save() {
  if (!editor.value || !editorValid.value) return
  const objective: LearnObjectiveDraft = {
    ...editor.value,
    supportingSourceKeys: [...editor.value.supportingSourceKeys],
    gapSourceKeys: [...editor.value.gapSourceKeys],
    prerequisiteKeys: [...editor.value.prerequisiteKeys],
    assessmentContract: { ...editor.value.assessmentContract, criteria: editor.value.assessmentContract.criteria.map(criterion => ({ ...criterion })) },
  }
  if (objective.coverage === 'gap') objective.supportingSourceKeys = []
  if (objective.coverage === 'strong') { objective.gapSourceKeys = []; objective.gapReason = undefined }
  else objective.gapSourceKeys = objective.gapSourceKeys.filter(sourceKey => !objective.supportingSourceKeys.includes(sourceKey))
  emit('editMap', { kind: 'save_objective', objective })
  editor.value = null
}
function move(objectiveKey: string, direction: 'up' | 'down') { emit('editMap', { kind: 'move_objective', objectiveKey, direction }) }
function confirmRemove() {
  if (!pendingRemovalKey.value || objectives.length <= 6) return
  emit('editMap', { kind: 'remove_objective', objectiveKey: pendingRemovalKey.value })
  pendingRemovalKey.value = null
}
function openSplit(item: LearnObjectiveSnapshot) { split.value = { objectiveKey: item.stableKey, firstTitle: item.title, secondTitle: `${item.title}: apply` } }
function saveSplit() {
  if (!split.value?.firstTitle.trim() || !split.value.secondTitle.trim() || objectives.length >= 15) return
  emit('editMap', { kind: 'split_objective', objectiveKey: split.value.objectiveKey, firstTitle: split.value.firstTitle.trim(), secondTitle: split.value.secondTitle.trim() })
  split.value = null
}
function addCriterion() {
  if (!editor.value || editor.value.assessmentContract.criteria.length >= 8) return
  const keys = new Set(editor.value.assessmentContract.criteria.map(criterion => criterion.key))
  let ordinal = editor.value.assessmentContract.criteria.length + 1
  while (keys.has(`criterion-${ordinal}`)) ordinal += 1
  editor.value.assessmentContract.criteria.push({ key: `criterion-${ordinal}`, description: '', weightPercent: 0 })
}
function removeCriterion(index: number) { if (editor.value && editor.value.assessmentContract.criteria.length > 1) editor.value.assessmentContract.criteria.splice(index, 1) }

const stateLabel: Record<LearnMasteryState, string> = { unseen: 'Not started', learning: 'Learning', guided: 'Guided', independent: 'Independent', retained: 'Retained', needs_review: 'Needs review', blocked: 'Blocked', provisionally_known: 'Provisionally known' }
const coverageClass = { strong: 'text-emerald-300', partial: 'text-amber-300', gap: 'text-rose-300' }
const depthLabel = { foundational: 'Foundation', working: 'Working fluency', advanced: 'Advanced application' }
</script>

<template>
  <section data-testid="learn-v2-learning-trail">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p class="font-inter text-xs uppercase tracking-wide text-primary">Learning map</p><h2 class="mt-1 font-dm-sans text-xl font-bold">Build the trail to your outcome</h2><p class="mt-1 max-w-2xl text-sm text-muted-foreground">Shape the order, evidence, prerequisites, depth, and proof of learning. Every saved change becomes a new draft revision; accepted work stays intact.</p></div>
      <UiButton size="sm" :disabled="busy || objectives.length >= 15" data-testid="learn-v2-map-add-objective" @click="addNew"><Plus class="mr-2 h-4 w-4" />Add objective</UiButton>
    </header>

    <div v-if="editor" class="mt-5 rounded-2xl border border-primary/30 bg-card p-5 shadow-sm" data-testid="learn-v2-objective-editor">
      <div class="flex items-start justify-between gap-4"><div><p class="font-inter text-xs uppercase tracking-wide text-primary">Draft revision</p><h3 class="mt-1 font-dm-sans text-lg font-semibold">{{ editor.objectiveKey ? 'Edit capability' : 'Add capability' }}</h3></div><button type="button" class="rounded-md p-2 text-muted-foreground hover:bg-accent" aria-label="Close editor" @click="editor = null"><X class="h-4 w-4" /></button></div>
      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        <label class="text-sm font-medium">Objective title<input v-model="editor.title" data-testid="learn-v2-objective-title" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2" maxlength="200"></label>
        <label class="text-sm font-medium">Milestone<select v-model="editor.milestoneKey" data-testid="learn-v2-objective-milestone" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2"><option v-for="milestone in milestones" :key="milestone.key" :value="milestone.key">{{ milestone.title }}</option></select></label>
        <label class="text-sm font-medium lg:col-span-2">Capability<textarea v-model="editor.capability" data-testid="learn-v2-objective-capability" class="mt-1.5 min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2" maxlength="500" /></label>
        <label class="text-sm font-medium">Depth<select v-model="editor.depth" data-testid="learn-v2-objective-depth" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="foundational">Foundation</option><option value="working">Working fluency</option><option value="advanced">Advanced application</option></select></label>
        <label class="text-sm font-medium">Estimated effort<input v-model.number="editor.effortMinutes" data-testid="learn-v2-objective-effort" type="number" min="5" max="480" step="5" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2"><span class="mt-1 block text-xs text-muted-foreground">5–480 minutes across learning and practice.</span></label>
      </div>

      <div class="mt-6 grid gap-5 xl:grid-cols-2">
        <fieldset class="rounded-xl border border-border p-4"><legend class="px-1 text-sm font-semibold">Evidence coverage</legend><label class="mt-2 block text-sm">Coverage<select v-model="editor.coverage" data-testid="learn-v2-objective-coverage" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="strong">Strong</option><option value="partial">Partial</option><option value="gap">Gap</option></select></label><label v-if="editor.coverage !== 'strong'" class="mt-3 block text-sm">What remains unsupported?<textarea v-model="editor.gapReason" data-testid="learn-v2-objective-gap-reason" class="mt-1.5 min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2" maxlength="500" /></label>
          <div v-if="editor.coverage !== 'gap'" class="mt-4"><p class="text-sm font-medium">Supporting evidence</p><p class="mt-1 text-xs text-muted-foreground">Choose accepted sources that can support teaching and assessment.</p><label v-for="source in acceptedSources" :key="source.sourceKey" class="mt-2 flex gap-2 rounded-lg border border-border p-2 text-sm"><input v-model="editor.supportingSourceKeys" type="checkbox" :value="source.sourceKey"><span><span class="font-medium">{{ source.title }}</span><span class="block text-xs text-muted-foreground">{{ source.publisher ?? source.origin.replaceAll('_', ' ') }}</span></span></label></div>
          <div v-if="editor.coverage !== 'strong'" class="mt-4"><p class="text-sm font-medium">Reviewed sources that expose the gap</p><label v-for="source in reviewedSources" :key="`gap-${source.sourceKey}`" class="mt-2 flex gap-2 rounded-lg border border-border p-2 text-sm"><input v-model="editor.gapSourceKeys" type="checkbox" :value="source.sourceKey" :disabled="editor.supportingSourceKeys.includes(source.sourceKey)"><span>{{ source.title }}</span></label></div>
        </fieldset>
        <fieldset class="rounded-xl border border-border p-4"><legend class="px-1 text-sm font-semibold">Prerequisites</legend><p class="text-xs text-muted-foreground">A learner should demonstrate these capabilities first. Cycles are rejected before publication.</p><label v-for="objective in objectives.filter(item => item.stableKey !== editor?.objectiveKey)" :key="objective.stableKey" class="mt-2 flex gap-2 rounded-lg border border-border p-2 text-sm"><input v-model="editor.prerequisiteKeys" type="checkbox" :value="objective.stableKey"><span>{{ objective.title }}</span></label></fieldset>
      </div>

      <fieldset class="mt-5 rounded-xl border border-border p-4"><legend class="px-1 text-sm font-semibold">Assessment contract</legend><div class="grid gap-4 md:grid-cols-2"><label class="text-sm">Method<select v-model="editor.assessmentContract.kind" data-testid="learn-v2-assessment-kind" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="machine_checkable">Machine checkable</option><option value="bounded_rubric">Bounded rubric</option></select></label><label class="text-sm">Response format<select v-model="editor.assessmentContract.responseFormat" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="short_text">Short text</option><option value="structured">Structured response</option></select></label><label class="text-sm md:col-span-2">Learner instructions<textarea v-model="editor.assessmentContract.instructions" data-testid="learn-v2-assessment-instructions" class="mt-1.5 min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2" maxlength="1000" /></label></div>
        <div class="mt-4 flex items-center justify-between"><div><p class="text-sm font-medium">Success criteria</p><p class="text-xs" :class="criterionWeight === 100 ? 'text-emerald-300' : 'text-amber-300'">Weights total {{ criterionWeight }}% · passing score remains 80%</p></div><UiButton type="button" size="sm" variant="outline" :disabled="editor.assessmentContract.criteria.length >= 8" @click="addCriterion"><Plus class="mr-1 h-4 w-4" />Criterion</UiButton></div>
        <div v-for="(criterion, index) in editor.assessmentContract.criteria" :key="criterion.key" class="mt-3 grid gap-2 rounded-lg bg-muted/30 p-3 md:grid-cols-[1fr_7rem_auto]"><label class="text-xs text-muted-foreground">Criterion<textarea v-model="criterion.description" :data-testid="`learn-v2-assessment-criterion-${index}`" class="mt-1 min-h-16 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" maxlength="300" /></label><label class="text-xs text-muted-foreground">Weight<input v-model.number="criterion.weightPercent" type="number" min="1" max="100" class="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"></label><button type="button" class="self-end rounded-md p-2 text-muted-foreground hover:bg-accent" :aria-label="`Remove criterion ${index + 1}`" :disabled="editor.assessmentContract.criteria.length === 1" @click="removeCriterion(index)"><Trash2 class="h-4 w-4" /></button></div>
      </fieldset>
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3"><p class="text-xs text-muted-foreground">Saving forks a complete draft and keeps the accepted revision immutable.</p><div class="flex gap-2"><UiButton variant="ghost" @click="editor = null">Cancel</UiButton><UiButton :disabled="busy || !editorValid" data-testid="learn-v2-save-objective" @click="save">Save draft revision</UiButton></div></div>
    </div>

    <div v-if="split" class="mt-5 rounded-xl border border-primary/30 bg-card p-5" data-testid="learn-v2-objective-split-editor"><h3 class="font-dm-sans text-lg font-semibold">Split into two focused capabilities</h3><p class="mt-1 text-sm text-muted-foreground">Evidence and assessment stay attached. The second capability follows the first, and existing dependants wait for the second.</p><div class="mt-4 grid gap-3 md:grid-cols-2"><label class="text-sm font-medium">First objective<input v-model="split.firstTitle" data-testid="learn-v2-split-first-title" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2" maxlength="200"></label><label class="text-sm font-medium">Second objective<input v-model="split.secondTitle" data-testid="learn-v2-split-second-title" class="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2" maxlength="200"></label></div><div class="mt-4 flex justify-end gap-2"><UiButton variant="ghost" @click="split = null">Cancel</UiButton><UiButton data-testid="learn-v2-save-split" :disabled="busy || !split.firstTitle.trim() || !split.secondTitle.trim()" @click="saveSplit">Split objective</UiButton></div></div>

    <div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div class="overflow-hidden rounded-xl border border-border bg-card"><div class="border-b border-border px-4 py-3 text-sm text-muted-foreground"><Route class="mr-2 inline h-4 w-4 text-primary" />Ordered capability trail · {{ objectives.length }} objectives</div><ol class="divide-y divide-border"><li v-for="(objective, index) in objectives" :key="objective.stableKey" class="group flex items-stretch"><div class="flex w-11 shrink-0 flex-col items-center justify-center border-r border-border bg-muted/20"><button type="button" class="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-25" :aria-label="`Move ${objective.title} earlier`" :disabled="busy || index === 0" :data-testid="`learn-v2-map-move-up-${objective.stableKey}`" @click="move(objective.stableKey, 'up')"><ChevronUp class="h-4 w-4" /></button><GripVertical class="h-4 w-4 text-muted-foreground/60" /><button type="button" class="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-25" :aria-label="`Move ${objective.title} later`" :disabled="busy || index === objectives.length - 1" :data-testid="`learn-v2-map-move-down-${objective.stableKey}`" @click="move(objective.stableKey, 'down')"><ChevronDown class="h-4 w-4" /></button></div><button type="button" class="flex min-w-0 flex-1 items-start gap-3 p-4 text-left transition-colors hover:bg-accent/30" :class="selected?.stableKey === objective.stableKey ? 'bg-primary/5' : ''" @click="choose(objective)"><span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border font-inter text-xs text-muted-foreground">{{ index + 1 }}</span><span class="min-w-0 flex-1"><span class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="font-medium">{{ objective.title }}</span><span class="font-inter text-[11px]" :class="coverageClass[objective.coverage]">{{ objective.coverage }} evidence</span></span><span class="mt-1 block text-sm text-muted-foreground">{{ objective.capability }}</span><span class="mt-2 block font-inter text-xs text-muted-foreground">{{ objective.milestone }} · {{ depthLabel[objective.depth] }} · {{ objective.effortMinutes }} min · {{ stateLabel[objective.mastery] }}</span></span><ArrowRight class="mt-1 h-4 w-4 text-muted-foreground" /></button></li></ol></div>
      <aside v-if="selected" class="h-fit rounded-xl border border-border bg-card p-5 lg:sticky lg:top-4" data-testid="learn-v2-objective-inspector"><p class="font-inter text-xs uppercase tracking-wide text-muted-foreground">{{ selected.milestone }}</p><h3 class="mt-1 font-dm-sans text-lg font-semibold">{{ selected.title }}</h3><p class="mt-2 text-sm text-muted-foreground">{{ selected.detail ?? selected.capability }}</p><div class="mt-4 flex flex-wrap gap-2 text-xs"><span class="rounded-full bg-muted px-2.5 py-1">{{ depthLabel[selected.depth] }}</span><span class="rounded-full bg-muted px-2.5 py-1">{{ selected.effortMinutes }} min</span><span class="rounded-full bg-muted px-2.5 py-1">{{ selected.coverage }} coverage</span></div><dl class="mt-5 space-y-4 text-sm"><div><dt class="flex items-center gap-2 text-xs text-muted-foreground"><BookOpenCheck class="h-3.5 w-3.5" />Assessment</dt><dd class="mt-1">{{ selected.assessment }}</dd><dd class="mt-1 text-xs text-muted-foreground">{{ selected.assessmentContract.criteria.length }} success {{ selected.assessmentContract.criteria.length === 1 ? 'criterion' : 'criteria' }} · 80% pass</dd></div><div><dt class="text-xs text-muted-foreground">Prerequisites</dt><dd class="mt-1">{{ selected.prerequisiteIds.length ? `${selected.prerequisiteIds.length} linked objective${selected.prerequisiteIds.length === 1 ? '' : 's'}` : 'None' }}</dd></div><div><dt class="flex items-center gap-2 text-xs text-muted-foreground"><Link2 class="h-3.5 w-3.5" />Evidence</dt><dd v-if="selected.sourceLinks.length" class="mt-1 space-y-1"><span v-for="link in selected.sourceLinks" :key="`${link.sourceKey}-${link.coverage}`" class="block rounded-md bg-muted/40 px-2 py-1.5"><span class="font-medium">{{ link.title }}</span><span class="block text-xs text-muted-foreground">{{ link.coverage === 'gap' ? 'Gap attribution' : 'Supporting evidence' }} · {{ link.origin.replaceAll('_', ' ') }}</span></span></dd><dd v-else class="mt-1 text-amber-200">No source linked</dd></div></dl><p v-if="selected.coverage !== 'strong'" class="mt-4 flex gap-2 text-sm text-amber-200"><CircleAlert class="h-4 w-4 shrink-0" />{{ selected.gapReason ?? 'Resolve this evidence gap before publishing this objective.' }}</p><div class="mt-5 grid grid-cols-2 gap-2"><UiButton variant="secondary" data-testid="learn-v2-map-edit-objective" @click="editSelected">Edit details</UiButton><UiButton variant="outline" :disabled="objectives.length >= 15" data-testid="learn-v2-map-split-objective" @click="openSplit(selected)"><Scissors class="mr-1 h-4 w-4" />Split</UiButton></div><div v-if="pendingRemovalKey === selected.stableKey" class="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3"><p class="text-sm">Remove this objective and its prerequisite links?</p><div class="mt-2 flex justify-end gap-2"><UiButton size="sm" variant="ghost" @click="pendingRemovalKey = null">Keep</UiButton><UiButton size="sm" variant="destructive" data-testid="learn-v2-confirm-remove-objective" @click="confirmRemove">Remove</UiButton></div></div><UiButton v-else class="mt-2 w-full" variant="ghost" :disabled="busy || objectives.length <= 6" data-testid="learn-v2-map-remove-objective" @click="pendingRemovalKey = selected.stableKey"><Trash2 class="mr-2 h-4 w-4" />Remove objective</UiButton></aside>
    </div>
  </section>
</template>
