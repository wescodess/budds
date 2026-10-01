<script setup lang="ts">
import { api } from '#convex/api'
import type { FunctionArgs } from 'convex/server'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

const props = defineProps<{
  ownerId: string
  threadId: string
  threadRevision: number
  candidate: { attemptId: string, eligible: boolean }
}>()
const router = useRouter()
const mutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.projectAcceptedAttemptToQuiz)
  : createSsrMutationStub<typeof api.learnAdaptive.projectAcceptedAttemptToQuiz>()
const busy = ref(false)
const error = ref('')
const pending = ref<FunctionArgs<typeof api.learnAdaptive.projectAcceptedAttemptToQuiz> | null>(null)
let epoch = 0
watch(() => [props.ownerId, props.threadId, props.candidate.attemptId, props.candidate.eligible], () => {
  epoch += 1
  pending.value = null
  busy.value = false
  error.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => { epoch += 1 })

async function openQuiz() {
  if (busy.value || !props.candidate.eligible) return
  const command = pending.value ?? {
    threadId: props.threadId as never, attemptId: props.candidate.attemptId as never,
    expectedRevision: props.threadRevision, idempotencyKey: `accepted-quiz-${crypto.randomUUID()}`,
  }
  pending.value = command
  const requestEpoch = epoch
  busy.value = true
  error.value = ''
  try {
    const result = await mutation.mutate(command)
    if (requestEpoch !== epoch) return
    if (!result) {
      error.value = 'The outcome could not be confirmed. Retry to check the same result.'
      return
    }
    pending.value = null
    if (result.kind === 'ok') {
      await router.push({ name: 'app-folders-id-quiz-quizId', params: { id: result.value.folderId, quizId: result.value.quizId } })
    }
    else error.value = result.kind === 'conflict'
      ? 'The thread changed. Review the refreshed result before trying again.'
      : 'This accepted result is unavailable for handoff. Your saved learning attempt remains unchanged.'
  }
  catch {
    if (requestEpoch === epoch) error.value = 'The outcome could not be confirmed. Retry to check the same result.'
  }
  finally { if (requestEpoch === epoch) busy.value = false }
}
</script>

<template>
  <section class="mt-4 rounded-lg border border-border p-4" aria-label="Accepted result handoff">
    <p class="text-sm">This displays your accepted result; it does not score another attempt.</p>
    <button
v-if="candidate.eligible" type="button" data-testid="learn-accepted-attempt-open-quiz"
      class="mt-3 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      :aria-disabled="busy" @click="openQuiz">{{ busy ? 'Opening result…' : pending ? 'Retry opening result' : 'Open result in Quiz' }}</button>
    <p v-else class="mt-2 text-sm" role="status">This result is unavailable for handoff. Your saved learning attempt remains unchanged.</p>
    <p v-if="error" class="mt-2 text-sm" role="status" aria-live="polite">{{ error }}</p>
  </section>
</template>
