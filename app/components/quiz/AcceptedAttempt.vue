<script setup lang="ts">
import { api } from '#convex/api'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

type Projection = NonNullable<FunctionReturnType<typeof api.quizzes.getAcceptedAttemptProjection>>
const props = defineProps<{ projection: Projection, ownerId: string }>()
const router = useRouter()
const mutation = import.meta.client
  ? useConvexMutation(api.learnAdaptive.handoffQuizAttemptToChat)
  : createSsrMutationStub<typeof api.learnAdaptive.handoffQuizAttemptToChat>()
const pending = ref<FunctionArgs<typeof api.learnAdaptive.handoffQuizAttemptToChat> | null>(null)
const busy = ref(false)
const error = ref('')
let epoch = 0
watch([() => props.ownerId, () => props.projection.quizId, () => props.projection.threadId, () => props.projection.handoffAllowed], () => {
  epoch += 1
  pending.value = null
  busy.value = false
  error.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => { epoch += 1 })
async function discuss() {
  const projection = props.projection
  if (busy.value || !projection.handoffAllowed || projection.threadRevision === null) return
  const command = pending.value ?? { threadId: projection.threadId, quizId: projection.quizId,
    expectedRevision: projection.threadRevision, idempotencyKey: `quiz-chat-${crypto.randomUUID()}` }
  pending.value = command
  const requestEpoch = epoch
  busy.value = true
  error.value = ''
  try {
    const result = await mutation.mutate(command)
    if (requestEpoch !== epoch) return
    if (!result) {
      error.value = 'The outcome could not be confirmed. Retry to check the same discussion.'
      return
    }
    pending.value = null
    if (result.kind === 'ok') await router.push({ name: 'app-folders-id-chat-conversationId', params: { id: result.value.folderId, conversationId: result.value.conversationId } })
    else error.value = result.kind === 'conflict'
      ? 'The thread changed. Review the refreshed result before trying again.'
      : 'Discussion is unavailable. Your accepted learning attempt remains unchanged.'
  }
  catch {
    if (requestEpoch === epoch) error.value = 'The outcome could not be confirmed. Retry to check the same discussion.'
  }
  finally { if (requestEpoch === epoch) busy.value = false }
}
</script>

<template>
  <section data-testid="quiz-accepted-attempt" class="mx-auto max-w-2xl p-5" aria-labelledby="quiz-accepted-attempt-title">
    <h1 id="quiz-accepted-attempt-title" class="font-dm-sans text-xl font-semibold">Accepted learning result</h1>
    <p class="mt-3 text-sm">This displays the same accepted attempt; it does not score another response.</p>
    <template v-if="projection.status === 'accepted'">
      <p class="mt-3 text-lg">Score: {{ projection.scorePercent }}%</p>
      <ul v-if="projection.feedback?.criterionResults.length" class="mt-3 space-y-2" aria-label="Accepted criterion feedback">
        <li v-for="(criterion, index) in projection.feedback.criterionResults" :key="criterion.key" class="text-sm">Criterion {{ index + 1 }}: {{ criterion.awarded ? 'met' : 'not met yet' }}.</li>
      </ul>
      <button
v-if="projection.handoffAllowed && projection.threadRevision !== null" type="button"
        data-testid="quiz-accepted-attempt-chat" :aria-disabled="busy" class="mt-4 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        @click="discuss">{{ busy ? 'Opening discussion…' : pending ? 'Retry discussion' : 'Discuss in Chat' }}</button>
      <p v-else class="mt-3 text-sm" role="status">Discussion is unavailable. Your accepted learning attempt remains unchanged.</p>
    </template>
    <p v-else class="mt-3 text-sm" role="status">This result is unavailable for handoff. Review your saved learning thread for a safe next step.</p>
    <NuxtLink :to="{ name: 'app-learn-thread-threadId', params: { threadId: projection.threadId } }" class="mt-3 inline-flex min-h-11 items-center text-sm underline">Review learning thread</NuxtLink>
    <p v-if="error" role="status" aria-live="polite" class="mt-3 text-sm">{{ error }}</p>
  </section>
</template>
