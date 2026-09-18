<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'
import { getErrorMessage } from '~~/shared/errors'

const { legacyCourseId } = defineProps<{ legacyCourseId: Id<'courses'> }>()

const access = import.meta.client
  ? useConvexQuery(api.learnV2Access.status, {})
  : { data: ref({ kind: 'denied' }), pending: ref(false) }
const upgradeMutation = import.meta.client
  ? useConvexMutation(api.learnV2Upgrade.upgradeLegacyCourse)
  : { mutate: async () => ({}) }

const allowed = computed(() => (access.data?.value as { kind?: string } | undefined)?.kind === 'allowed')
const checkingAccess = computed(() => access.pending?.value ?? false)
const busy = ref(false)
const error = ref<string | null>(null)
const success = ref(false)
const idempotencyKey = ref<string | null>(null)

function makeKey() {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `learn-v2-upgrade:${id}`
}

async function upgrade() {
  if (!allowed.value || busy.value || success.value) return
  busy.value = true
  error.value = null
  idempotencyKey.value ??= makeKey()
  try {
    await upgradeMutation.mutate({ legacyCourseId, idempotencyKey: idempotencyKey.value })
    success.value = true
  } catch (cause) {
    error.value = getErrorMessage(cause, 'Could not create your V2 draft. Try again.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section aria-labelledby="learn-v2-upgrade-title" class="rounded-lg border border-stone-800 bg-stone-900/50 p-4">
    <h2 id="learn-v2-upgrade-title" class="text-base font-semibold text-stone-100">Try the new learning experience</h2>
    <p class="mt-1 text-sm text-stone-400">Create a V2 draft from this course’s title and selected sources. V1 progress and mastery stay in V1.</p>
    <p v-if="checkingAccess" data-testid="learn-v2-upgrade-pending" aria-live="polite" class="mt-3 text-sm text-stone-400">Checking whether this experience is available…</p>
    <p v-else-if="!allowed" data-testid="learn-v2-upgrade-denied" role="status" class="mt-3 text-sm text-stone-400">The new learning experience is not available for this account.</p>
    <template v-else>
      <p v-if="error" data-testid="learn-v2-upgrade-error" role="alert" class="mt-3 text-sm text-red-300">{{ error }}</p>
      <p v-if="success" data-testid="learn-v2-upgrade-success" role="status" class="mt-3 text-sm text-green-300">Your V2 draft is ready. V1 progress and mastery stay in V1.</p>
      <button
        type="button"
        data-testid="learn-v2-upgrade"
        :disabled="busy || success"
        class="mt-3 rounded border border-stone-700 px-3 py-2 text-sm font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none forced-colors:border-current"
        @click="upgrade"
      >
        {{ success ? 'V2 draft created' : busy ? 'Creating V2 draft…' : 'Create V2 draft' }}
      </button>
    </template>
  </section>
</template>
