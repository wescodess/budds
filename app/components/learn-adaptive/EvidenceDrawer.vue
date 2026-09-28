<script setup lang="ts">
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { AdaptiveClaimIntegrityProjection, AdaptiveEvidenceIntegrityState } from '~~/shared/adaptive-claim-adapter'

type Evidence = {
  kind: 'factual' | 'non_factual'
  activityId: string
  eligibility: 'eligible' | 'blocked' | 'historical' | 'not_applicable'
  readOnly: boolean
  integrityState: AdaptiveEvidenceIntegrityState | null
  claims: AdaptiveClaimIntegrityProjection[]
}

const props = defineProps<{
  evidence: Evidence | null
  pending: boolean
  sourceState: string
  safeDestination: string
  safeDestinationLabel: string
}>()

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const originLabels = {
  folder_document: 'Your folder', user_url: 'Added by you', open_database: 'Open databases', general_web_search: 'Web research',
} as const
const claimStatusLabels = { fact: 'Fact', synthesis: 'Synthesis', inference: 'Inference', unknown: 'Unknown' } as const
const recoveryCopy: Record<string, string> = {
  preparing: 'The source is still preparing.',
  blocked: 'This activity cannot use its current evidence.',
  stale: 'This activity uses an older source revision.',
  invalidated: 'The source can no longer support this activity.',
  deleted: 'The supporting source was deleted.',
  unavailable: 'The supporting source is unavailable.',
  insufficient: 'The evidence does not sufficiently support this claim.',
  conflicting: 'The source conflict is unresolved.',
}
const status = computed(() => props.sourceState === 'ready' ? props.evidence?.integrityState ?? 'ready' : props.sourceState)
const recovery = computed(() => recoveryCopy[status.value] ?? null)
const needsRecovery = computed(() => recovery.value !== null)
const locatorUnavailable = computed(() => ['preparing', 'blocked', 'invalidated', 'deleted', 'unavailable'].includes(status.value))
watch(open, async value => { if (!value) { await nextTick(); trigger.value?.focus() } })
</script>

<template>
  <Sheet v-model:open="open">
    <SheetTrigger as-child>
      <button ref="trigger" type="button" data-testid="learn-evidence-open" class="min-h-11 rounded-lg border border-border px-4 text-sm font-medium text-[var(--learn-action)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]">Evidence</button>
    </SheetTrigger>
    <SheetContent side="right" data-testid="learn-evidence-drawer" class="w-screen max-w-none gap-3 bg-[var(--learn-context-surface)] p-4 md:w-[32rem] md:max-w-md">
      <header class="pr-8">
        <SheetTitle class="font-dm-sans text-xl font-semibold">Evidence</SheetTitle>
        <SheetDescription>Sources currently supporting this activity. Source locators are shown only when permitted.</SheetDescription>
      </header>
      <p data-testid="learn-evidence-status" :role="needsRecovery ? 'alert' : 'status'" class="rounded-lg border border-border p-3 text-sm">Evidence {{ status }}{{ evidence?.readOnly ? ' · Past activity, read-only' : '' }}</p>
      <p v-if="recovery" data-testid="learn-evidence-recovery-copy" class="text-sm text-muted-foreground">{{ recovery }} This drawer is read-only; the named destination is the smallest authorized place to check source status or make changes.</p>
      <p v-if="pending" role="status" aria-live="polite" class="text-sm">Loading evidence…</p>
      <p v-else-if="!evidence" class="text-sm text-muted-foreground">Evidence details are unavailable. Your response remains in place.</p>
      <p v-else-if="evidence.kind === 'non_factual'" class="text-sm text-muted-foreground">No factual sources are needed for this reflection.</p>
      <p v-else-if="evidence.claims.length === 0" class="text-sm text-muted-foreground">No inspectable support is available for this activity.</p>
      <ol v-else class="space-y-3 overflow-y-auto pb-4">
        <li v-for="claim in evidence.claims" :key="claim.claimId" class="rounded-xl border border-border bg-[var(--learn-activity-surface)] p-4 text-sm" :data-testid="`learn-source-${claim.claimId}`">
          <p class="font-medium">{{ claim.claimText ?? 'Claim unavailable' }}</p>
          <p class="mt-2 text-muted-foreground">Claim type: {{ claimStatusLabels[sourceState === 'ready' ? claim.claimStatus : 'unknown'] }}</p>
          <p class="mt-1 text-muted-foreground">{{ claim.source.origin ? originLabels[claim.source.origin] : 'Source unavailable' }} · Integrity: {{ sourceState === 'ready' ? claim.integrityState : status }}</p>
          <p class="mt-1 text-muted-foreground">{{ locatorUnavailable ? 'Locator unavailable' : claim.source.locator ?? 'Locator unavailable' }}</p>
          <p class="mt-1 text-xs text-muted-foreground">Revision {{ claim.source.sourceSnapshotRevision }} · Record {{ claim.source.sourceRecordRevision }}</p>
        </li>
      </ol>
      <NuxtLink v-if="recovery" :to="safeDestination" data-testid="learn-evidence-recovery" class="inline-flex min-h-11 items-center text-sm text-[var(--learn-action)] underline">{{ safeDestinationLabel }}</NuxtLink>
      <button type="button" data-testid="learn-evidence-close" class="min-h-11 rounded-lg border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--learn-focus-ring)]" @click="open = false">Close evidence</button>
    </SheetContent>
  </Sheet>
</template>
