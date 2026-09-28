<script setup lang="ts">
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

type PreferenceKey = 'representation' | 'pace' | 'practice_style'
type Memory = {
  threadRevision: number
  lifecycle: string
  unresolvedPoint: string | null
  nextAction: { label: string } | null
  evidenceState: string
  preferences: readonly { key: PreferenceKey, value: string | null, state: 'active' | 'disabled', revision: number }[]
  artifacts: readonly { id: string, kind: string, title: string, summary: string, status: string, revision: number, updatedAt: number,
    historical: boolean, readOnly: boolean, evidenceLabel: 'evidence_unavailable' | null }[]
  history: readonly { activityId: string, purpose: string, status: string, activityClass: string, updatedAt: number, readOnly: true,
    evidenceStatus: 'ready' | 'unavailable' | 'not_required',
    attempt: { id: string, scorePercent: number, masteryStateAfter: string | null } | null }[]
  promotionCandidates?: readonly { basis: 'useful_artifact' | 'representative_performance', sourceId: string,
    label: string, allowedKinds: readonly ('review' | 'mastery')[] }[]
  promotionProposals?: readonly { id: string, kind: 'review' | 'mastery',
    basis: 'useful_artifact' | 'representative_performance', sourceLabel: string }[]
}

const props = defineProps<{
  memory: Memory | null
  pending: boolean
  busy?: boolean
  error?: string | null
  notice?: string | null
  retryAvailable?: boolean
  openRequest?: number
  returnFocusTo?: HTMLButtonElement | null
}>()
const emit = defineEmits<{
  'set-preference': [payload: { key: PreferenceKey, operation: 'set' | 'disable' | 'clear', value?: string }]
  'delete-artifact': [artifactId: string]
  'request-promotion': [payload: { kind: 'review' | 'mastery', basis: 'useful_artifact' | 'representative_performance', sourceId: string }]
  'refresh': []
  'retry': []
}>()

const preferenceKeys = [
  { key: 'representation', label: 'Preferred representation' },
  { key: 'pace', label: 'Preferred pace' },
  { key: 'practice_style', label: 'Preferred practice style' },
] as const
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const externalReturnFocus = shallowRef<HTMLButtonElement | null>(null)
const drafts = reactive<Record<PreferenceKey, string>>({ representation: '', pace: '', practice_style: '' })
const dirty = reactive<Record<PreferenceKey, boolean>>({ representation: false, pace: false, practice_style: false })
const confirmArtifactId = ref<string | null>(null)
const localAnnouncement = ref('')
const editable = computed(() => props.memory !== null && !['ended', 'rollback'].includes(props.memory.lifecycle))
const artifactEditable = computed(() => editable.value && props.memory?.lifecycle !== 'paused')

function preference(key: PreferenceKey) {
  return props.memory?.preferences.find(row => row.key === key)
}
function loadDrafts() {
  for (const { key } of preferenceKeys) { drafts[key] = preference(key)?.value ?? ''; dirty[key] = false }
  confirmArtifactId.value = null
}
watch(() => props.memory?.preferences, () => {
  if (!open.value) return
  for (const { key } of preferenceKeys) if (!dirty[key]) drafts[key] = preference(key)?.value ?? ''
})
watch(open, async (value) => {
  if (value) loadDrafts()
  else { await nextTick(); trigger.value?.focus() }
})
watch(() => props.openRequest, (value, previous) => {
  if (value === previous) return
  externalReturnFocus.value = props.returnFocusTo?.isConnected ? props.returnFocusTo : null
  open.value = true
})
function restoreSourceFocus(event: Event) {
  const origin = externalReturnFocus.value
  externalReturnFocus.value = null
  if (!origin?.isConnected) return
  event.preventDefault()
  origin.focus()
}
function save(key: PreferenceKey) {
  const value = drafts[key].trim()
  if (value.length < 1 || value.length > 120) return
  emit('set-preference', { key, operation: 'set', value })
  localAnnouncement.value = 'Preference change requested. Waiting for confirmation.'
}
function changePreference(key: PreferenceKey, operation: 'disable' | 'clear') {
  emit('set-preference', { key, operation })
  localAnnouncement.value = 'Preference change requested. Waiting for confirmation.'
}
function deleteArtifact(id: string) {
  if (confirmArtifactId.value !== id) { confirmArtifactId.value = id; localAnnouncement.value = 'Confirm deletion to remove this artifact.'; return }
  emit('delete-artifact', id)
  localAnnouncement.value = 'Artifact deletion requested. Waiting for confirmation.'
  confirmArtifactId.value = null
}
function requestPromotion(kind: 'review' | 'mastery', candidate: NonNullable<Memory['promotionCandidates']>[number]) {
  emit('request-promotion', { kind, basis: candidate.basis, sourceId: candidate.sourceId })
  localAnnouncement.value = 'Proposal requested. Waiting for confirmation.'
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetTrigger as-child>
      <button ref="trigger" type="button" data-testid="learn-memory-open" class="min-h-11 rounded-lg border border-border px-4 text-sm font-medium text-[var(--learn-action)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="externalReturnFocus = null">Memory</button>
    </SheetTrigger>
    <SheetContent side="right" aria-modal="true" data-testid="learn-memory-drawer" class="w-screen max-w-none gap-4 overflow-y-auto bg-[var(--learn-context-surface)] p-4 md:w-[32rem] md:max-w-md" @close-auto-focus="restoreSourceFocus">
      <header class="pr-8">
        <SheetTitle class="font-dm-sans text-xl font-semibold">Learning memory</SheetTitle>
        <SheetDescription>Review and change what you explicitly asked Budds to remember. Past learning results stay read-only.</SheetDescription>
      </header>
      <p v-if="pending" role="status" aria-live="polite" class="text-sm">Loading memory…</p>
      <p v-if="error" role="alert" data-testid="learn-memory-error" class="rounded-lg border border-destructive p-3 text-sm">{{ error }} Your unsaved edits remain here.</p>
      <p v-if="!error && (notice || localAnnouncement)" role="status" aria-live="polite" data-testid="learn-memory-status" class="text-sm">{{ notice || localAnnouncement }}</p>
      <div v-if="error" class="flex flex-wrap gap-2">
        <button type="button" data-testid="learn-memory-refresh" class="min-h-11 rounded-lg border border-border px-4 text-sm" @click="emit('refresh')">Review current memory</button>
        <button v-if="retryAvailable" type="button" data-testid="learn-memory-retry" :disabled="busy" class="min-h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-50" @click="emit('retry')">Retry same change</button>
      </div>
      <p v-if="!pending && !memory" role="status" class="text-sm">Memory is unavailable. Try refreshing the thread.</p>
      <template v-else-if="memory">
        <section aria-labelledby="learn-memory-next-heading" class="rounded-xl border border-border p-4">
          <h3 id="learn-memory-next-heading" class="font-semibold">Where you left off</h3>
          <p class="mt-2 text-sm">Unresolved point: {{ memory.unresolvedPoint ?? 'None recorded' }}</p>
          <p class="mt-1 text-sm">Next move: {{ memory.nextAction?.label ?? 'None recorded' }}</p>
          <p class="mt-1 text-sm">Evidence state: {{ memory.evidenceState }}</p>
        </section>
        <section aria-labelledby="learn-memory-editable-heading" class="space-y-4">
          <h3 id="learn-memory-editable-heading" class="font-semibold">Editable memory</h3>
          <p class="text-sm text-muted-foreground">These preferences are set by you. Disabling one stops it from being used; clearing one removes it.</p>
          <div v-for="item in preferenceKeys" :key="item.key" class="rounded-xl border border-border p-3">
            <label :for="`learn-memory-input-${item.key}`" class="block text-sm font-medium">{{ item.label }}</label>
            <p class="my-1 text-xs">Status: {{ preference(item.key)?.state ?? 'not set' }}</p>
            <input :id="`learn-memory-input-${item.key}`" v-model="drafts[item.key]" :data-testid="`learn-memory-preference-${item.key}`" :disabled="!editable || busy" maxlength="120" type="text" class="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @input="dirty[item.key] = true">
            <div v-if="editable" class="mt-2 flex flex-wrap gap-2">
              <button type="button" :data-testid="`learn-memory-save-${item.key}`" :disabled="busy || !drafts[item.key].trim()" class="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50" @click="save(item.key)">Save preference</button>
              <button v-if="preference(item.key)?.state === 'active'" type="button" :disabled="busy" class="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50" @click="changePreference(item.key, 'disable')">Disable</button>
              <button v-if="preference(item.key)" type="button" :disabled="busy" class="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50" @click="changePreference(item.key, 'clear')">Clear</button>
            </div>
          </div>
          <h4 class="font-medium">Saved artifacts</h4>
          <p v-if="memory.lifecycle === 'paused'" class="text-sm text-muted-foreground">Resume this thread to delete an artifact.</p>
          <p v-if="memory.artifacts.length === 0" class="text-sm">No saved artifacts.</p>
          <ul v-else class="space-y-2">
            <li v-for="artifact in memory.artifacts" :key="artifact.id" class="rounded-xl border border-border p-3 text-sm">
              <p class="font-medium">{{ artifact.title }} · {{ artifact.status }}</p>
              <p class="mt-1">{{ artifact.summary }}</p>
              <p v-if="artifact.historical" class="mt-1">Historical artifact · supporting evidence unavailable · read-only content</p>
              <button v-if="artifactEditable" type="button" :disabled="busy" :data-testid="confirmArtifactId === artifact.id ? `learn-memory-confirm-delete-${artifact.id}` : `learn-memory-delete-${artifact.id}`" class="mt-2 min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50" @click="deleteArtifact(artifact.id)">{{ confirmArtifactId === artifact.id ? 'Confirm delete artifact' : 'Delete artifact' }}</button>
            </li>
          </ul>
        </section>
        <section aria-labelledby="learn-memory-promotion-heading" data-testid="learn-memory-promotion" class="space-y-3 border-t border-border pt-4">
          <h3 id="learn-memory-promotion-heading" class="font-semibold">Optional review and mastery</h3>
          <p class="text-sm text-muted-foreground">Choose a saved artifact or representative result to request a future path. A proposal does not award mastery or schedule a check. Assisted work still needs independent evidence before mastery can advance.</p>
          <p v-if="!memory.promotionCandidates?.length" class="text-sm">No work is ready for an optional proposal yet.</p>
          <ul v-else-if="editable" class="space-y-2">
            <li v-for="candidate in memory.promotionCandidates" :key="`${candidate.basis}:${candidate.sourceId}`" class="rounded-lg border border-border p-3 text-sm">
              <p>{{ candidate.label }} · {{ candidate.basis === 'useful_artifact' ? 'Saved artifact' : 'Representative result' }}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button v-for="kind in candidate.allowedKinds" :key="kind" type="button" :disabled="busy || Boolean(error)" :data-testid="`learn-memory-promote-${kind}-${candidate.sourceId}`" class="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50" @click="requestPromotion(kind, candidate)">{{ kind === 'mastery' ? 'Explore mastery path' : 'Propose review' }}</button>
              </div>
            </li>
          </ul>
          <p v-if="memory.lifecycle === 'ended'" class="text-sm text-muted-foreground">This ended thread is available for review only.</p>
          <ul v-if="memory.promotionProposals?.length" class="space-y-2" aria-label="Requested proposals">
            <li v-for="proposal in memory.promotionProposals" :key="proposal.id" class="rounded-lg border border-border p-3 text-sm">
              {{ proposal.kind === 'review' ? 'Review' : 'Mastery path' }} proposed from {{ proposal.sourceLabel }}. No check is scheduled and no mastery is awarded.
            </li>
          </ul>
        </section>
        <section aria-labelledby="learn-memory-history-heading" data-testid="learn-memory-history" class="space-y-2 border-t border-border pt-4">
          <h3 id="learn-memory-history-heading" class="font-semibold">Past activity, read-only</h3>
          <p class="text-sm text-muted-foreground">Attempts, scores, evidence decisions, and mastery history cannot be edited here.</p>
          <p v-if="memory.history.length === 0" class="text-sm">No past activity recorded.</p>
          <ul v-else class="space-y-2">
            <li v-for="activity in memory.history" :key="activity.activityId" class="rounded-lg border border-border p-3 text-sm">
              <p>{{ activity.purpose }} · {{ activity.status }}</p>
              <p v-if="activity.activityClass === 'factual'">Current evidence: {{ activity.evidenceStatus }}</p>
              <p v-if="activity.attempt">Verified attempt score: {{ activity.attempt.scorePercent }}% · Mastery after attempt: {{ activity.attempt.masteryStateAfter ?? 'not recorded' }}</p>
              <p v-else-if="activity.activityClass === 'factual'">No verified score recorded for this activity.</p>
            </li>
          </ul>
        </section>
      </template>
      <button type="button" data-testid="learn-memory-close" class="min-h-11 rounded-lg border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="open = false">Close memory</button>
    </SheetContent>
  </Sheet>
</template>
