<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { ArrowRight, Check, ChevronDown, ChevronUp, CircleAlert, CircleDot, ListOrdered, LoaderCircle, Pencil, Plus, Scissors, Trash2 } from '@lucide/vue'
import type { LearnCoverage, LearnMapEdit, LearnMapSaveResult, LearnObjectiveDraft, LearnObjectiveSnapshot, LearnSourceOrigin, LearnSourceSnapshot } from '~/types/learn-v2-journey'

type Depth = LearnObjectiveDraft['depth']
type Panel = 'time' | 'depth' | 'first' | 'sources'
type Row = { key: string; milestoneKey: string; view: LearnObjectiveDraft & { objectiveKey?: string } }

const { objectives, sources = [], busy = false, loading = false, canAccept = false, save } = defineProps<{
  objectives: LearnObjectiveSnapshot[]
  sources?: LearnSourceSnapshot[]
  busy?: boolean
  loading?: boolean
  canAccept?: boolean
  save: (edit: LearnMapEdit) => Promise<LearnMapSaveResult>
}>()
const emit = defineEmits<{ accept: []; manageSources: [] }>()

const NEW = 'new-objective'
const uid = useId()
const depthLabel: Record<Depth, string> = { foundational: 'Foundation', working: 'Working fluency', advanced: 'Advanced application' }
const coverageLabel: Record<LearnCoverage, string> = { strong: 'Yes', partial: 'Partly', gap: 'Not yet' }
const originLabel: Record<LearnSourceOrigin, string> = { folder_document: 'Your folder', user_url: 'Added by you', open_database: 'Open databases', general_web_search: 'Web research' }
const destructiveGhost = 'text-foreground hover:bg-destructive/10 hover:text-foreground dark:text-destructive dark:hover:bg-destructive/15 dark:hover:text-destructive [&>svg]:text-destructive aria-pressed:bg-destructive/10'
const chipClass = 'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 font-inter text-xs font-medium text-foreground hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const citeClass = 'inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-primary px-1 font-inter text-xs font-medium text-primary-foreground'
const numberClass = 'flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-inter text-xs'
const checkBoxClass = 'mt-0.5 grid size-4 shrink-0 place-content-center rounded-[4px] border border-input text-transparent shadow-xs peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:opacity-50'
const segmentClass = 'inline-flex min-h-7 flex-1 cursor-pointer items-center justify-center rounded-lg px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50'

const selectedKey = ref<string | null>(null)
const draft = ref<LearnObjectiveDraft | null>(null)
const baseline = ref<LearnObjectiveDraft | null>(null)
const heldOrder = ref<string[] | null>(null)
const removing = ref(false)
const splitting = ref(false)
const saving = ref(false)
const failure = ref<{ number: number; reason: 'changed' | 'failed' } | null>(null)
const panel = ref<Panel | null>(null)
const orderOpen = ref(false)
const editor = shallowRef<HTMLElement | null>(null)
const editorInView = ref(true)

useIntersectionObserver(editor, ([entry]) => { editorInView.value = entry?.isIntersecting ?? true })
const setEditor = (element: unknown) => { editor.value = element instanceof HTMLElement ? element : null }

const rowId = (key: string) => `${uid}-objective-${key}`
const sourceId = (number: number) => `${uid}-source-${number}`
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(item => b.includes(item))
const listJoin = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
const objectiveCount = (count: number) => count === 1 ? '1 objective' : `${count} objectives`
const duration = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `about ${hours ? `${hours} hr` : ''}${hours && rest ? ' ' : ''}${rest || !hours ? `${rest} min` : ''}`
}

const milestones = computed(() => [...new Map(objectives.map(item => [item.milestoneKey, item.milestone])).entries()].map(([key, title]) => ({ key, title })))
const acceptedSources = computed(() => sources.filter(source => source.lifecycle === 'user_accepted'))
const reviewedSources = computed(() => sources.filter(source => !['rejected', 'unavailable'].includes(source.lifecycle)))
const sourceNumber = computed(() => new Map(acceptedSources.value.map((source, index) => [source.sourceKey, index + 1])))

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
  }
}

function blankDraft(): LearnObjectiveDraft {
  const template = objectives.at(-1)!
  return {
    title: '', capability: '', milestoneKey: template.milestoneKey, effortMinutes: 25, depth: template.depth,
    coverage: template.coverage, gapReason: template.gapReason,
    supportingSourceKeys: template.sourceLinks.filter(link => link.coverage !== 'gap').map(link => link.sourceKey),
    gapSourceKeys: template.sourceLinks.filter(link => link.coverage === 'gap').map(link => link.sourceKey),
    prerequisiteKeys: [template.stableKey],
  }
}

const copy = (value: LearnObjectiveDraft): LearnObjectiveDraft => ({ ...value, supportingSourceKeys: [...value.supportingSourceKeys], gapSourceKeys: [...value.gapSourceKeys], prerequisiteKeys: [...value.prerequisiteKeys] })

const rows = computed(() => {
  const order = heldOrder.value ?? objectives.map(item => item.stableKey)
  const rank = new Map(order.map((key, index) => [key, index]))
  const entries: Row[] = objectives.map(item => item.stableKey === selectedKey.value && draft.value
    ? { key: item.stableKey, milestoneKey: draft.value.milestoneKey, view: draft.value }
    : { key: item.stableKey, milestoneKey: item.milestoneKey, view: draftFrom(item) })
  if (selectedKey.value === NEW && draft.value) entries.push({ key: NEW, milestoneKey: draft.value.milestoneKey, view: draft.value })
  entries.sort((a, b) => (rank.get(a.key) ?? order.length) - (rank.get(b.key) ?? order.length))
  return milestones.value.flatMap(milestone => entries.filter(entry => entry.milestoneKey === milestone.key)).map((entry, index) => ({ ...entry, number: index + 1 }))
})
const placed = computed(() => rows.value.filter(row => row.key !== NEW))
const numberOf = computed(() => new Map(rows.value.map(row => [row.key, row.number])))
const groups = computed(() => milestones.value.map(milestone => ({ ...milestone, rows: rows.value.filter(row => row.milestoneKey === milestone.key) })))
const totalMinutes = computed(() => placed.value.reduce((total, row) => total + (Number(row.view.effortMinutes) || 0), 0))
const baselineOrder = computed(() => milestones.value.flatMap(milestone => objectives.filter(item => item.milestoneKey === milestone.key)).map(item => item.stableKey).join())
const selectedNumber = computed(() => selectedKey.value ? numberOf.value.get(selectedKey.value) ?? 0 : 0)

const supporting = (view: LearnObjectiveDraft) => view.coverage === 'gap' ? [] : view.supportingSourceKeys
const citations = (view: LearnObjectiveDraft) => supporting(view).map(key => sourceNumber.value.get(key)).filter((value): value is number => value !== undefined).sort((a, b) => a - b)
function afterLabel(view: LearnObjectiveDraft) {
  const numbers = view.prerequisiteKeys.map(key => numberOf.value.get(key)).filter((value): value is number => value !== undefined).sort((a, b) => a - b)
  return numbers.length ? `After ${numbers.join(', ')}` : 'Start here'
}

const changes = computed(() => {
  const value = draft.value
  const original = baseline.value
  if (!value || !original) return []
  if (removing.value) return ['removal']
  const list: string[] = []
  if (value.title !== original.title || value.capability !== original.capability) list.push('wording')
  if (value.effortMinutes !== original.effortMinutes) list.push('time')
  if (value.depth !== original.depth) list.push('depth')
  if (!sameSet(value.prerequisiteKeys, original.prerequisiteKeys)) list.push('what comes first')
  if (value.coverage !== original.coverage || (value.gapReason ?? '') !== (original.gapReason ?? '') || !sameSet(value.supportingSourceKeys, original.supportingSourceKeys) || !sameSet(value.gapSourceKeys, original.gapSourceKeys)) list.push('sources')
  if (selectedKey.value !== NEW && (value.milestoneKey !== original.milestoneKey || placed.value.map(row => row.key).join() !== baselineOrder.value)) list.push('order')
  if (splitting.value) list.push('split')
  return list
})
const pending = computed(() => changes.value.length > 0 || failure.value !== null)
const waitingAway = computed(() => Boolean(selectedKey.value) && pending.value && !editorInView.value)
const mode = computed(() => saving.value ? 'saving' : failure.value ? 'failed' : changes.value.length ? 'dirty' : 'clean')
const valid = computed(() => {
  const value = draft.value
  if (!value) return false
  if (removing.value) return true
  if (!value.title.trim() || !value.capability.trim() || !Number.isInteger(value.effortMinutes) || value.effortMinutes < 5 || value.effortMinutes > 480) return false
  if (value.coverage !== 'gap' && !value.supportingSourceKeys.length) return false
  return value.coverage === 'strong' || Boolean(value.gapReason?.trim())
})
const canSave = computed(() => changes.value.length > 0 && valid.value && !saving.value && !busy)
const statusText = computed(() => ({
  clean: 'Changes to this objective are saved together.',
  dirty: `Not saved yet: ${listJoin(changes.value)}.`,
  saving: 'Saving your changes…',
  failed: 'Not saved. Your changes are still here.',
})[mode.value])

function step(direction: -1 | 1): { index: number; swap: number } | { milestoneKey: string } | null {
  const index = placed.value.findIndex(row => row.key === selectedKey.value)
  const current = placed.value[index]
  const other = placed.value[index + direction]
  if (!current || !other || removing.value) return null
  if (other.milestoneKey === current.milestoneKey) return { swap: index + direction, index }
  if (placed.value.filter(row => row.milestoneKey === current.milestoneKey).length === 1) return null
  return { milestoneKey: other.milestoneKey }
}
const canMoveEarlier = computed(() => step(-1) !== null)
const canMoveLater = computed(() => step(1) !== null)

const later = computed(() => {
  const found = new Set<string>()
  const walk = (key: string) => {
    for (const row of rows.value) {
      if (row.view.prerequisiteKeys.includes(key) && !found.has(row.key)) {
        found.add(row.key)
        walk(row.key)
      }
    }
  }
  if (selectedKey.value) walk(selectedKey.value)
  return found
})
const firstChoices = computed(() => placed.value.filter(row => row.key !== selectedKey.value))
const lookedChoices = computed(() => reviewedSources.value.filter(source => !draft.value?.supportingSourceKeys.includes(source.sourceKey)))

watch(() => objectives, () => {
  const key = selectedKey.value
  if (!key || key === NEW || saving.value || pending.value) return
  const latest = objectives.find(item => item.stableKey === key)
  if (!latest) return close(false)
  draft.value = draftFrom(latest)
  baseline.value = draftFrom(latest)
  heldOrder.value = null
})

function focusRow(key: string, target?: string) {
  void nextTick(() => {
    const row = document.getElementById(rowId(key))
    const control = target ? row?.querySelector<HTMLElement>(target) : null
    ;(control ?? row)?.focus({ preventScroll: !!control })
  })
}

function open(key: string, value: LearnObjectiveDraft) {
  selectedKey.value = key
  draft.value = copy(value)
  baseline.value = copy(value)
  heldOrder.value = null
  removing.value = false
  splitting.value = false
  failure.value = null
  panel.value = null
}

function close(restoreFocus = true) {
  const key = selectedKey.value
  selectedKey.value = null
  draft.value = null
  baseline.value = null
  heldOrder.value = null
  removing.value = false
  splitting.value = false
  failure.value = null
  panel.value = null
  if (restoreFocus && key && key !== NEW && objectives.some(item => item.stableKey === key)) focusRow(key, '[data-objective-title]')
}

function select(key: string) {
  if (selectedKey.value === key || saving.value || pending.value) return
  const item = objectives.find(entry => entry.stableKey === key)
  if (!item) return
  open(key, draftFrom(item))
  focusRow(key)
}

function addObjective() {
  if (saving.value || pending.value || !objectives.length || objectives.length >= 15) return
  open(NEW, blankDraft())
  focusRow(NEW, 'textarea')
}

function move(direction: -1 | 1) {
  const next = step(direction)
  if (!next || !draft.value) return
  const keys = placed.value.map(row => row.key)
  if ('swap' in next) [keys[next.index], keys[next.swap]] = [keys[next.swap]!, keys[next.index]!]
  heldOrder.value = keys
  if ('milestoneKey' in next) draft.value.milestoneKey = next.milestoneKey
  void nextTick(() => {
    const row = document.getElementById(rowId(selectedKey.value!))
    const button = row?.querySelector<HTMLButtonElement>(`[data-move="${direction}"]:not(:disabled)`) ?? row?.querySelector<HTMLButtonElement>('[data-move]:not(:disabled)')
    ;(button ?? row)?.focus()
  })
}

function togglePanel(name: Panel) {
  if (saving.value) return
  panel.value = panel.value === name ? null : name
  if (panel.value) {
    void nextTick(() => document.getElementById(`${uid}-panel`)?.querySelector<HTMLElement>('input:not(:disabled), textarea')?.focus())
  }
}

function closePanel() {
  const name = panel.value
  panel.value = null
  if (name) void nextTick(() => document.getElementById(`${uid}-chip-${name}`)?.focus())
}

function normalized(value: LearnObjectiveDraft): LearnObjectiveDraft {
  const objective = copy(value)
  if (objective.coverage === 'gap') objective.supportingSourceKeys = []
  if (objective.coverage === 'strong') {
    objective.gapSourceKeys = []
    objective.gapReason = undefined
  }
  else objective.gapSourceKeys = objective.gapSourceKeys.filter(key => !objective.supportingSourceKeys.includes(key))
  return objective
}

async function commit(edit: LearnMapEdit, after: 'keep' | 'close') {
  const key = selectedKey.value!
  const number = selectedNumber.value
  saving.value = true
  failure.value = null
  panel.value = null
  let result: LearnMapSaveResult
  try { result = await save(edit) }
  catch { result = { ok: false, reason: 'failed' } }
  saving.value = false
  if (!result.ok) {
    failure.value = { number, reason: result.reason }
    return
  }
  if (after === 'close') return close(false)
  await nextTick()
  const latest = objectives.find(item => item.stableKey === key)
  if (!latest) return close(false)
  open(key, draftFrom(latest))
  focusRow(key)
}

async function submit() {
  const value = draft.value
  const key = selectedKey.value
  if (!value || !key || !canSave.value) return
  if (removing.value) return await commit({ kind: 'remove_objective', objectiveKey: key }, 'close')
  const objective = normalized(value)
  if (key === NEW) return await commit({ kind: 'save_objective', objective }, 'close')
  const title = objective.title.trim()
  await commit({ kind: 'save_objective', objective, order: placed.value.map(row => row.key), ...(splitting.value ? { split: { secondTitle: `${title.slice(0, 193)}: apply` } } : {}) }, 'keep')
}

function reload() {
  const key = selectedKey.value
  const value = draft.value
  failure.value = null
  if (!key || !value) return
  const objectiveKeys = new Set(objectives.map(item => item.stableKey))
  const sourceKeys = new Set(sources.map(source => source.sourceKey))
  value.prerequisiteKeys = value.prerequisiteKeys.filter(item => objectiveKeys.has(item))
  value.supportingSourceKeys = value.supportingSourceKeys.filter(item => sourceKeys.has(item))
  value.gapSourceKeys = value.gapSourceKeys.filter(item => sourceKeys.has(item))
  if (!milestones.value.some(milestone => milestone.key === value.milestoneKey)) value.milestoneKey = milestones.value.at(-1)?.key ?? value.milestoneKey
  const latest = key === NEW ? undefined : objectives.find(item => item.stableKey === key)
  if (latest) baseline.value = draftFrom(latest)
  else if (key !== NEW) {
    selectedKey.value = NEW
    value.objectiveKey = undefined
    baseline.value = blankDraft()
  }
  if (heldOrder.value) {
    const kept = heldOrder.value.filter(item => objectiveKeys.has(item))
    heldOrder.value = [...kept, ...objectives.map(item => item.stableKey).filter(item => !kept.includes(item))]
  }
  focusRow(selectedKey.value!)
}

function reveal(id: string) {
  orderOpen.value = false
  const target = document.getElementById(id)
  target?.scrollIntoView({ block: 'center' })
  target?.focus({ preventScroll: true })
}

function toggleOrder(pointer = false) {
  orderOpen.value = !orderOpen.value
  if (!orderOpen.value) return
  void nextTick(() => {
    const region = document.getElementById(`${uid}-order`)
    const current = region?.querySelector<HTMLElement>('[aria-current="true"]')
    if (region && current) region.scrollTop += current.getBoundingClientRect().top - region.getBoundingClientRect().top - region.clientHeight / 2
    const target = pointer ? document.getElementById(`${uid}-order-dialog`) : current ?? region?.querySelector<HTMLElement>('a')
    target?.focus({ preventScroll: true })
  })
}

function closeOrder() {
  orderOpen.value = false
  void nextTick(() => document.getElementById(`${uid}-order-button`)?.focus())
}
</script>

<template>
  <section data-testid="learn-v2-learning-trail">
    <article class="mx-auto max-w-3xl">
      <p v-if="failure" role="alert" class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-destructive/40 p-3 text-sm text-foreground" data-testid="learn-v2-map-save-error">
        <span class="flex min-w-0 flex-1 basis-64 items-start gap-2">
          <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
          <span v-if="failure.reason === 'changed'" class="min-w-0">The map changed somewhere else, so objective {{ failure.number }} wasn’t saved. Your changes are still here.</span>
          <span v-else class="min-w-0">Couldn’t save objective {{ failure.number }}. Your changes are still here. Try again.</span>
        </span>
        <UiButton v-if="failure.reason === 'changed'" variant="outline" size="sm" data-testid="learn-v2-map-reload" @click="reload">Reload and keep my changes</UiButton>
      </p>

      <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <h2 class="font-dm-sans text-xl font-bold text-foreground">Your learning map</h2>
          <p class="mt-1 max-w-2xl text-sm text-muted-foreground">Change what each objective covers, the order and which sources back it. Changes stay in a draft until you accept this map.</p>
        </div>
        <div v-if="objectives.length && !loading" class="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <UiButton variant="outline" size="sm" :disabled="busy || saving || pending || objectives.length >= 15" :aria-describedby="objectives.length >= 15 ? `${uid}-full` : undefined" data-testid="learn-v2-map-add-objective" @click="addObjective"><Plus />Add objective</UiButton>
          <p v-if="objectives.length >= 15" :id="`${uid}-full`" class="font-inter text-xs font-medium text-foreground sm:max-w-56 sm:text-right" data-testid="learn-v2-map-full">A map holds up to 15 objectives. Remove one to add another.</p>
        </div>
      </header>

      <div v-if="loading && !objectives.length" role="status" aria-live="polite" class="mt-10 flex items-center justify-center gap-2 py-16 text-sm text-foreground" data-testid="learn-v2-map-loading"><LoaderCircle class="size-4 animate-spin text-primary motion-reduce:animate-none" />Loading your learning map…</div>

      <div v-else-if="!objectives.length" class="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center" data-testid="learn-v2-map-empty">
        <h3 class="font-dm-sans text-lg font-semibold text-foreground">No objectives yet</h3>
        <p class="mx-auto mt-2 max-w-md text-sm text-foreground">Budds builds this map from the sources you accept. <button type="button" class="inline-flex min-h-6 items-center font-medium underline underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="learn-v2-map-empty-sources" @click="emit('manageSources')">Go to Sources</button> to generate it.</p>
      </div>

      <template v-else>
        <div class="mt-6 space-y-8">
          <section v-for="(group, groupIndex) in groups" :key="group.key" :aria-labelledby="`${uid}-milestone-${groupIndex}`">
            <h3 :id="`${uid}-milestone-${groupIndex}`" class="font-dm-sans text-lg font-semibold text-foreground">{{ group.title }}</h3>
            <ol class="mt-1 divide-y divide-border">
              <template v-for="row in group.rows" :key="row.key">
                <li v-if="row.key === selectedKey && draft" :id="rowId(row.key)" :ref="setEditor" tabindex="-1" aria-current="true" :aria-busy="saving || undefined" class="flex scroll-mb-32 gap-3 border-l-2 border-primary bg-card py-4 pr-3 pl-3 outline-none" data-testid="learn-v2-objective-editor">
                  <span :class="numberClass" class="text-foreground">{{ row.number }}</span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <p class="flex items-center gap-1.5 font-inter text-xs font-medium text-foreground"><Pencil class="size-3.5 text-primary" />Type in the boxes to change the words</p>
                      <div class="-mr-1 flex flex-wrap items-center gap-1">
                        <UiButton variant="ghost" size="icon-sm" aria-label="Move earlier" data-move="-1" :disabled="saving || !canMoveEarlier" :data-testid="`learn-v2-map-move-up-${row.key}`" @click="move(-1)"><ChevronUp /></UiButton>
                        <UiButton variant="ghost" size="icon-sm" aria-label="Move later" data-move="1" :disabled="saving || !canMoveLater" :data-testid="`learn-v2-map-move-down-${row.key}`" @click="move(1)"><ChevronDown /></UiButton>
                        <UiButton variant="ghost" size="sm" :aria-pressed="splitting" :disabled="saving || removing || row.key === NEW || objectives.length >= 15" data-testid="learn-v2-map-split-objective" @click="splitting = !splitting"><Scissors />Split</UiButton>
                        <UiButton variant="ghost" size="sm" :class="destructiveGhost" :aria-pressed="removing" :disabled="saving || splitting || row.key === NEW || objectives.length <= 6" data-testid="learn-v2-map-remove-objective" @click="removing = !removing"><Trash2 />Remove</UiButton>
                      </div>
                    </div>
                    <div class="mt-2 space-y-2">
                      <label class="block"><span class="sr-only">Objective title</span><UiTextarea v-model="draft.title" :readonly="saving" maxlength="200" class="min-h-9 font-medium md:text-[15px]" data-testid="learn-v2-objective-title" /></label>
                      <label class="block"><span class="sr-only">What you’ll be able to do</span><UiTextarea v-model="draft.capability" :readonly="saving" maxlength="500" class="min-h-14" data-testid="learn-v2-objective-capability" /></label>
                    </div>
                    <div v-if="draft.coverage !== 'strong' && draft.gapReason?.trim()" class="mt-2 flex items-start gap-2 text-sm text-foreground"><CircleAlert class="mt-0.5 size-4 shrink-0 text-[var(--learn-attention)]" /><span class="min-w-0">{{ draft.gapReason }}</span></div>
                    <div class="relative mt-3">
                      <div class="flex flex-wrap gap-1.5">
                        <button :id="`${uid}-chip-time`" type="button" :aria-expanded="panel === 'time'" :class="[chipClass, panel === 'time' ? 'border-primary bg-primary/5' : 'border-border']" :aria-disabled="saving || undefined" @click="togglePanel('time')">{{ draft.effortMinutes }} min<span class="sr-only">, change time</span></button>
                        <button :id="`${uid}-chip-depth`" type="button" :aria-expanded="panel === 'depth'" :class="[chipClass, panel === 'depth' ? 'border-primary bg-primary/5' : 'border-border']" :aria-disabled="saving || undefined" @click="togglePanel('depth')">{{ depthLabel[draft.depth] }}<span class="sr-only">, change depth</span></button>
                        <button :id="`${uid}-chip-first`" type="button" :aria-expanded="panel === 'first'" :class="[chipClass, panel === 'first' ? 'border-primary bg-primary/5' : 'border-border']" :aria-disabled="saving || undefined" @click="togglePanel('first')">{{ afterLabel(draft) }}<span class="sr-only">, change what to learn first</span></button>
                        <button :id="`${uid}-chip-sources`" type="button" :aria-expanded="panel === 'sources'" :class="[chipClass, panel === 'sources' ? 'border-primary bg-primary/5' : 'border-border']" :aria-disabled="saving || undefined" data-testid="learn-v2-objective-sources" @click="togglePanel('sources')">
                          <template v-if="citations(draft).length">Sources<span class="inline-flex gap-0.5" aria-hidden="true"><span v-for="number in citations(draft)" :key="number" class="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-primary px-1 text-[11px] text-primary-foreground">{{ number }}</span></span><span class="sr-only"> {{ citations(draft).join(' and ') }}</span></template>
                          <template v-else><Plus class="size-3.5" />Add a source</template>
                        </button>
                      </div>
                      <div v-if="panel" :id="`${uid}-panel`" role="dialog" :aria-labelledby="`${uid}-panel-title`" class="z-10 mt-2 flex w-full flex-col rounded-lg border bg-popover text-popover-foreground shadow-md sm:absolute sm:top-full sm:left-0" :class="panel === 'first' ? 'sm:w-[26rem]' : 'sm:w-96'" @keydown.esc.stop="closePanel">
                        <p :id="`${uid}-panel-title`" class="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">{{ panel === 'time' ? `Time for objective ${row.number}` : panel === 'depth' ? `Depth of objective ${row.number}` : panel === 'first' ? `Learn first, before objective ${row.number}` : `Sources for objective ${row.number}` }}</p>
                        <div role="region" tabindex="0" :aria-label="`${panel === 'time' ? `Time for objective ${row.number}` : panel === 'depth' ? `Depth of objective ${row.number}` : panel === 'first' ? `Learn first, before objective ${row.number}` : `Sources for objective ${row.number}`}, scrolls`" class="max-h-[min(22rem,calc(100dvh-14rem))] overflow-y-auto overscroll-contain px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                          <label v-if="panel === 'time'" class="block text-sm font-medium text-foreground">Minutes<span class="mt-1.5 block font-normal"><UiInput v-model.number="draft.effortMinutes" type="number" min="5" max="480" step="5" data-testid="learn-v2-objective-effort" /></span><span class="mt-1 block text-xs font-normal text-muted-foreground">5 to 480</span></label>
                          <div v-else-if="panel === 'depth'" role="radiogroup" aria-label="Depth" class="flex flex-wrap gap-1 rounded-xl border border-input p-1">
                            <label v-for="(label, value) in depthLabel" :key="value" :class="segmentClass"><input v-model="draft.depth" type="radio" class="sr-only" :name="`${uid}-depth`" :value="value">{{ label }}</label>
                          </div>
                          <div v-else-if="panel === 'first'" class="mt-1 divide-y divide-border">
                            <label v-for="choice in firstChoices" :key="choice.key" class="flex min-h-9 items-start gap-2.5 py-2.5 text-sm" :class="later.has(choice.key) ? 'cursor-not-allowed' : 'cursor-pointer'">
                              <input v-model="draft.prerequisiteKeys" type="checkbox" class="peer sr-only" :value="choice.key" :disabled="later.has(choice.key)">
                              <span :class="checkBoxClass"><Check class="size-3" /></span>
                              <span class="min-w-0"><span class="block" :class="later.has(choice.key) ? 'text-muted-foreground' : 'text-foreground'">{{ choice.number }}. {{ choice.view.title }}</span><span v-if="later.has(choice.key)" class="block text-xs text-muted-foreground">Comes after this one</span></span>
                            </label>
                          </div>
                          <template v-else>
                            <p class="text-sm font-medium text-foreground">Do your sources cover this?</p>
                            <div class="mt-2"><div role="radiogroup" aria-label="Do your sources cover this?" class="flex flex-wrap gap-1 rounded-xl border border-input p-1">
                              <label v-for="(label, value) in coverageLabel" :key="value" :class="segmentClass"><input v-model="draft.coverage" type="radio" class="sr-only" :name="`${uid}-coverage`" :value="value">{{ label }}</label>
                            </div></div>
                            <div v-if="draft.coverage !== 'strong'" class="mt-4"><label class="block text-sm font-medium text-foreground">What’s missing?<span class="mt-1.5 block font-normal"><UiTextarea v-model="draft.gapReason" maxlength="500" data-testid="learn-v2-objective-gap-reason" /></span></label></div>
                            <div v-if="draft.coverage !== 'gap'" class="mt-4">
                              <p class="text-sm font-medium text-foreground">Teach this from</p>
                              <div class="mt-1 divide-y divide-border">
                                <label v-for="source in acceptedSources" :key="source.sourceKey" class="flex min-h-9 cursor-pointer items-start gap-2.5 py-2.5 text-sm">
                                  <input v-model="draft.supportingSourceKeys" type="checkbox" class="peer sr-only" :value="source.sourceKey">
                                  <span :class="checkBoxClass"><Check class="size-3" /></span>
                                  <span :class="citeClass" aria-hidden="true">{{ sourceNumber.get(source.sourceKey) }}</span>
                                  <span class="min-w-0"><span class="block text-foreground">{{ source.title }}</span><span class="block text-xs text-muted-foreground">{{ originLabel[source.origin] }}<template v-if="source.publisher"> · {{ source.publisher }}</template></span></span>
                                </label>
                              </div>
                            </div>
                            <div v-if="draft.coverage !== 'strong' && lookedChoices.length" class="mt-4">
                              <p class="text-sm font-medium text-foreground">Looked at, but not enough</p>
                              <p class="mt-0.5 text-xs text-muted-foreground">Optional. Budds won’t teach this objective from these.</p>
                              <div class="mt-1 divide-y divide-border">
                                <label v-for="source in lookedChoices" :key="source.sourceKey" class="flex min-h-9 cursor-pointer items-start gap-2.5 py-2.5 text-sm">
                                  <input v-model="draft.gapSourceKeys" type="checkbox" class="peer sr-only" :value="source.sourceKey">
                                  <span :class="checkBoxClass"><Check class="size-3" /></span>
                                  <span v-if="sourceNumber.get(source.sourceKey)" :class="citeClass" aria-hidden="true">{{ sourceNumber.get(source.sourceKey) }}</span>
                                  <span class="min-w-0"><span class="block text-foreground">{{ source.title }}</span><span class="block text-xs text-muted-foreground">{{ originLabel[source.origin] }}<template v-if="source.publisher"> · {{ source.publisher }}</template></span></span>
                                </label>
                              </div>
                            </div>
                          </template>
                        </div>
                        <div class="flex justify-end border-t border-border p-2"><UiButton variant="outline" size="sm" @click="closePanel">Done</UiButton></div>
                      </div>
                    </div>
                    <div class="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
                      <p role="status" class="flex min-w-0 flex-1 basis-52 items-start gap-2 text-sm text-foreground" data-testid="learn-v2-objective-status">
                        <CircleDot v-if="mode === 'dirty'" class="mt-0.5 size-4 shrink-0 text-[var(--learn-attention)]" />
                        <LoaderCircle v-else-if="mode === 'saving'" class="mt-0.5 size-4 shrink-0 animate-spin text-[var(--warning)] motion-reduce:animate-none" />
                        <CircleAlert v-else-if="mode === 'failed'" class="mt-0.5 size-4 shrink-0 text-destructive" />
                        <span class="min-w-0">{{ statusText }}</span>
                      </p>
                      <div class="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
                        <UiButton variant="ghost" class="max-sm:px-4" :disabled="saving" data-testid="learn-v2-objective-close" @click="close()">{{ mode === 'clean' ? 'Close' : 'Cancel' }}</UiButton>
                        <UiButton :variant="mode === 'clean' ? 'secondary' : 'default'" class="max-sm:px-4" :disabled="!canSave" data-testid="learn-v2-save-objective" @click="submit"><LoaderCircle v-if="saving" class="size-4 animate-spin motion-reduce:animate-none" />{{ saving ? 'Saving' : 'Save changes' }}</UiButton>
                      </div>
                    </div>
                  </div>
                </li>
                <li v-else :id="rowId(row.key)" tabindex="-1" class="flex cursor-pointer gap-3 py-4 pl-3 outline-none" @click="select(row.key)">
                  <span :class="numberClass" class="text-muted-foreground">{{ row.number }}</span>
                  <div class="min-w-0 flex-1 pt-0.5">
                    <h4 class="text-[15px] font-medium text-foreground"><button type="button" data-objective-title class="block min-h-6 w-full rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" :data-testid="`learn-v2-map-select-${row.key}`">{{ row.view.title }}<span class="sr-only">, change</span></button></h4>
                    <p class="mt-1 text-sm text-foreground">{{ row.view.capability }}<template v-if="citations(row.view).length">{{ ' ' }}<span class="inline-flex gap-1 align-middle"><a v-for="number in citations(row.view)" :key="number" :href="`#${sourceId(number)}`" :aria-label="`Source ${number}`" class="inline-flex h-6 min-w-6 items-center justify-center rounded-sm bg-primary px-1 align-middle font-inter text-xs font-medium text-primary-foreground no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" @click.prevent.stop="reveal(sourceId(number))">{{ number }}</a></span></template></p>
                    <div v-if="row.view.coverage !== 'strong' && row.view.gapReason" class="mt-2 flex items-start gap-2 text-sm text-foreground"><CircleAlert class="mt-0.5 size-4 shrink-0 text-[var(--learn-attention)]" /><span class="min-w-0">{{ row.view.gapReason }}</span></div>
                    <p class="mt-2 font-inter text-xs font-medium text-muted-foreground">{{ depthLabel[row.view.depth] }} · {{ row.view.effortMinutes }} min · {{ afterLabel(row.view) }}</p>
                  </div>
                </li>
              </template>
            </ol>
          </section>

          <section v-if="acceptedSources.length" :aria-labelledby="`${uid}-sources`">
            <div class="flex items-center justify-between gap-3">
              <h3 :id="`${uid}-sources`" class="font-dm-sans text-lg font-semibold text-foreground">Sources</h3>
              <UiButton variant="ghost" size="sm" data-testid="learn-v2-map-manage-sources" @click="emit('manageSources')"><ArrowRight />Manage sources</UiButton>
            </div>
            <ol class="mt-1 divide-y divide-border">
              <li v-for="(source, index) in acceptedSources" :id="sourceId(index + 1)" :key="source.sourceKey" tabindex="-1" class="flex items-start gap-2.5 py-2.5 outline-none">
                <span :class="citeClass" aria-hidden="true">{{ index + 1 }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-foreground"><span class="sr-only">Source {{ index + 1 }}: </span>{{ source.title }}</span>
                  <span class="block font-inter text-xs font-medium text-muted-foreground">{{ originLabel[source.origin] }}<template v-if="source.publisher"> · {{ source.publisher }}</template><template v-if="placed.some(row => supporting(row.view).includes(source.sourceKey))"> · backs {{ placed.filter(row => supporting(row.view).includes(source.sourceKey)).map(row => row.number).join(', ') }}</template></span>
                </span>
              </li>
            </ol>
          </section>
        </div>

        <div class="@container sticky bottom-0 z-20 bg-background pt-2 pb-4">
          <div class="relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card p-2">
            <button :id="`${uid}-order-button`" type="button" :aria-expanded="orderOpen" class="inline-flex min-h-9 min-w-9 items-center justify-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-foreground hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="learn-v2-map-order" @click="toggleOrder($event.detail > 0)">
              <ListOrdered class="size-4 shrink-0 text-primary" /><span class="@max-[21rem]:sr-only">Order</span><span class="hidden font-inter text-xs font-medium text-muted-foreground sm:inline">{{ objectiveCount(placed.length) }} · {{ duration(totalMinutes) }}</span><ChevronDown v-if="orderOpen" class="size-4 shrink-0 @max-[21rem]:hidden" /><ChevronUp v-else class="size-4 shrink-0 @max-[21rem]:hidden" />
            </button>
            <p v-if="selectedKey && waitingAway" role="status" class="flex min-w-0 flex-1 basis-48 items-center gap-2 text-sm text-foreground" data-testid="learn-v2-map-pending">
              <LoaderCircle v-if="saving" class="size-4 shrink-0 animate-spin text-[var(--warning)] motion-reduce:animate-none" />
              <CircleDot v-else class="size-4 shrink-0 text-[var(--learn-attention)]" />
              <span>{{ saving ? `Saving objective ${selectedNumber}…` : `Objective ${selectedNumber} isn’t saved yet.` }} <a :href="`#${rowId(selectedKey)}`" class="inline-flex min-h-6 items-center font-medium underline underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" @click.prevent="reveal(rowId(selectedKey))">Go to it</a></span>
            </p>
            <span v-else class="flex-1" />
            <UiButton v-if="canAccept" :variant="pending ? 'secondary' : 'default'" class="ml-auto" :disabled="busy || saving || pending" data-testid="learn-v2-accept-map" @click="emit('accept')">Accept learning map</UiButton>
            <div v-if="orderOpen" :id="`${uid}-order-dialog`" role="dialog" tabindex="-1" aria-label="Order of objectives" class="outline-none absolute bottom-full left-0 z-30 mb-2 flex w-full flex-col rounded-lg border bg-popover text-popover-foreground shadow-md sm:w-[26rem]" @keydown.esc.stop="closeOrder">
              <p class="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Order · {{ objectiveCount(placed.length) }}</p>
              <div :id="`${uid}-order`" role="region" tabindex="0" aria-label="Order of objectives, scrolls" class="max-h-[min(30rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain px-1 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
                <div v-for="(group, groupIndex) in groups" :key="group.key" :class="groupIndex ? 'mt-3' : ''">
                  <p class="px-2 font-inter text-xs font-medium text-foreground">{{ group.title }}</p>
                  <ol class="mt-1">
                    <li v-for="row in group.rows" :key="row.key">
                      <a :href="`#${rowId(row.key)}`" :aria-current="row.key === selectedKey ? 'true' : undefined" class="flex items-start gap-2 border-l-2 border-transparent py-1.5 pr-2 pl-2 text-sm text-foreground hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset aria-[current=true]:border-primary aria-[current=true]:bg-primary/8" @click.prevent="reveal(rowId(row.key))">
                        <span :class="numberClass" class="text-foreground">{{ row.number }}</span>
                        <span class="line-clamp-2 min-w-0 flex-1 pt-0.5">{{ row.view.title }}</span>
                        <span v-if="row.view.coverage !== 'strong'" class="mt-1 shrink-0" :title="row.view.coverage === 'gap' ? 'Not covered yet' : 'Partly covered'"><CircleAlert class="size-3.5 text-[var(--learn-attention)]" /><span class="sr-only">{{ row.view.coverage === 'gap' ? 'Not covered yet' : 'Partly covered' }}</span></span>
                      </a>
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </article>
  </section>
</template>
