<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'
import { getLearnV2CalendarCallbackFeedback } from '~/utils/learn-v2-calendar-callback'

type Connection = 'not_connected' | 'reconsent_required' | 'ready'
type ProjectionResult = { kind: 'projected' | 'already_projected' | 'busy' | 'conflict' }

const { studySessionId, scheduledStartAt } = defineProps<{
  studySessionId: string
  scheduledStartAt: number
}>()
const route = useRoute()
const router = useRouter()

const statusQuery = import.meta.client
  ? useConvexQuery(api.learnV2Calendar.getStatus, {})
  : { data: ref<{ enabled: false, connection: Connection, provider: null } | null>(null), pending: ref(false) }
const projectMutation = import.meta.client
  ? useConvexAction(api.learnV2Calendar.projectSession)
  : { mutate: async () => ({ kind: 'conflict' as const }) }
const proposalsQuery = import.meta.client
  ? useConvexQuery(api.learnV2CalendarReconciliation.listProposals, {})
  : { data: ref<Array<{ _id: string, kind: 'moved' | 'deleted' | 'conflict', proposedStartAt?: number, proposedEndAt?: number }>>([]) }
const rejectProposalMutation = import.meta.client
  ? useConvexMutation(api.learnV2CalendarReconciliation.rejectProposal)
  : { mutate: async () => ({ resolved: 'rejected' as const }) }

const status = computed(() => statusQuery.data?.value as { enabled: boolean, connection: Connection, provider: 'google' | null, attention?: string | null } | null | undefined)
const checkingStatus = computed(() => statusQuery.pending?.value ?? false)
const proposals = computed(() => proposalsQuery.data?.value ?? [])
const enabled = computed(() => status.value?.enabled === true)
const connection = computed<Connection>(() => status.value?.connection ?? 'not_connected')
const canProject = computed(() => enabled.value && connection.value === 'ready' && scheduledStartAt > Date.now())
const projecting = ref(false)
const disconnecting = ref(false)
const showDisconnectConfirm = ref(false)
const message = ref('')
const error = ref<string | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const resolvingProposal = ref<string | null>(null)

onMounted(() => {
  const feedback = getLearnV2CalendarCallbackFeedback(route.query)
  if (!feedback) return

  error.value = feedback.error ?? null
  message.value = feedback.message ?? ''

  void router.replace({ query: feedback.cleanedQuery })
})

function connect() {
  if (import.meta.client) window.location.assign('/api/learn-v2/calendar/connect')
}

async function rejectProposal(proposalId: string) {
  resolvingProposal.value = proposalId
  try {
    await rejectProposalMutation.mutate({ proposalId: proposalId as never })
    message.value = 'Calendar change dismissed. Your in-app study plan remains unchanged.'
  } catch (cause) {
    error.value = getErrorMessage(cause, 'Could not dismiss this calendar change. Try again.')
  } finally { resolvingProposal.value = null }
}

async function project() {
  if (!canProject.value || projecting.value) return
  projecting.value = true
  error.value = null
  message.value = ''
  try {
    const result = await projectMutation.mutate({ studySessionId: studySessionId as never }) as ProjectionResult
    message.value = {
      projected: 'Added to Google Calendar.',
      already_projected: 'This session is already on Google Calendar.',
      busy: 'That time is busy on your calendar. Your in-app study plan is unchanged.',
      conflict: 'Calendar needs attention before this session can be added. Your in-app study plan is unchanged.',
    }[result.kind]
  } catch (cause) {
    error.value = getErrorMessage(cause, 'Could not add this session to Google Calendar. Try again.')
  } finally {
    projecting.value = false
  }
}

function requestDisconnect() {
  showDisconnectConfirm.value = true
  nextTick(() => cancelButton.value?.focus())
}

function cancelDisconnect() {
  showDisconnectConfirm.value = false
}

async function disconnect() {
  if (disconnecting.value) return
  disconnecting.value = true
  error.value = null
  try {
    await globalThis.$fetch('/api/learn-v2/calendar/disconnect', { method: 'POST' })
    showDisconnectConfirm.value = false
    message.value = 'Google Calendar disconnected. Your in-app study plan is still available.'
  } catch (cause) {
    error.value = getErrorMessage(cause, 'Could not disconnect Google Calendar. Try again.')
  } finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <section aria-labelledby="learn-v2-calendar-title" data-testid="learn-v2-calendar-projection" class="rounded-lg border border-stone-800 bg-stone-900/50 p-4">
    <h2 id="learn-v2-calendar-title" class="text-base font-semibold text-stone-100">Google Calendar</h2>
    <p class="mt-1 text-sm text-stone-400">Add this scheduled session to your calendar when you choose. Your Budds study plan remains the source of truth.</p>

    <p v-if="checkingStatus" data-testid="learn-v2-calendar-pending" aria-live="polite" class="mt-3 text-sm text-stone-400">Checking calendar availability…</p>
    <template v-else-if="!enabled">
      <p data-testid="learn-v2-calendar-disabled" role="status" class="mt-3 text-sm text-stone-400">Calendar projection is not enabled. Your in-app study plan is available without calendar controls.</p>
    </template>
    <template v-else>
      <p v-if="error" data-testid="learn-v2-calendar-error" role="alert" class="mt-3 text-sm text-red-300">{{ error }}</p>
      <p v-if="message" data-testid="learn-v2-calendar-message" role="status" aria-live="polite" class="mt-3 text-sm text-green-300">{{ message }}</p>
      <p v-if="status?.attention" data-testid="learn-v2-calendar-attention" role="alert" class="mt-3 text-sm text-amber-200">Google Calendar needs updated access. Your in-app study plan remains available.</p>

      <button v-if="connection !== 'ready'" type="button" data-testid="learn-v2-calendar-connect" class="mt-3 rounded border border-stone-700 px-3 py-2 text-sm font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none" @click="connect">
        {{ connection === 'reconsent_required' ? 'Update Google Calendar access' : 'Connect Google Calendar' }}
      </button>
      <template v-else>
        <p data-testid="learn-v2-calendar-ready" class="mt-3 text-sm text-stone-400">Connected to Google Calendar with availability access.</p>
        <button v-if="canProject" type="button" data-testid="learn-v2-calendar-project" :disabled="projecting" class="mt-3 rounded border border-stone-700 px-3 py-2 text-sm font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none" @click="project">
          {{ projecting ? 'Adding to Google Calendar…' : 'Add to Google Calendar' }}
        </button>
        <p v-else data-testid="learn-v2-calendar-not-future" class="mt-3 text-sm text-stone-400">Only a future scheduled session can be added to Google Calendar.</p>
        <button type="button" data-testid="learn-v2-calendar-disconnect" :disabled="disconnecting" class="mt-3 block text-sm text-stone-400 underline underline-offset-4 hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" @click="requestDisconnect">Disconnect Google Calendar</button>
      </template>
      <section v-if="proposals.length" aria-label="Calendar change proposals" data-testid="learn-v2-calendar-proposals" class="mt-4 rounded border border-amber-800 p-3">
        <p class="text-sm text-amber-100">Google Calendar changed a Budds-managed session. Review it in Budds; your plan was not changed.</p>
        <div v-for="proposal in proposals" :key="proposal._id" class="mt-3 text-sm text-stone-300">
          <p v-if="proposal.kind === 'moved'">The projected calendar event was moved. Review the proposed time before resolving it in Budds.</p>
          <p v-else-if="proposal.kind === 'deleted'">The projected calendar event was deleted. Replacement or explicit resolution is required; your Budds plan remains unchanged.</p>
          <p v-else>Google Calendar returned an unsupported or invalid event time. Explicit resolution is required; your Budds plan remains unchanged.</p>
          <p v-if="proposal.kind === 'moved' && proposal.proposedStartAt">Proposed time: {{ new Date(proposal.proposedStartAt).toLocaleString() }}</p>
          <button type="button" :disabled="resolvingProposal === proposal._id" class="mt-1 underline" @click="rejectProposal(proposal._id)">{{ resolvingProposal === proposal._id ? 'Dismissing…' : 'Keep my Budds plan' }}</button>
        </div>
      </section>
    </template>

    <div v-if="showDisconnectConfirm" data-testid="learn-v2-calendar-disconnect-confirm" class="mt-4 rounded border border-stone-700 p-4" role="alertdialog" aria-modal="true" aria-labelledby="learn-v2-calendar-disconnect-title" aria-describedby="learn-v2-calendar-disconnect-description" @keydown.escape="cancelDisconnect">
      <h3 id="learn-v2-calendar-disconnect-title" class="font-medium text-stone-100">Disconnect Google Calendar?</h3>
      <p id="learn-v2-calendar-disconnect-description" class="mt-1 text-sm text-stone-400">Projected Budds sessions will be removed from Google Calendar. Your in-app study plan will remain available.</p>
      <div class="mt-3 flex gap-2">
        <button ref="cancelButton" type="button" data-testid="learn-v2-calendar-disconnect-cancel" class="rounded border border-stone-700 px-3 py-2 text-sm text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="cancelDisconnect">Cancel</button>
        <button type="button" data-testid="learn-v2-calendar-disconnect-confirm-button" :disabled="disconnecting" class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" @click="disconnect">{{ disconnecting ? 'Disconnecting…' : 'Disconnect' }}</button>
      </div>
    </div>
  </section>
</template>
