<script setup lang="ts">
import { api } from '#convex/api'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

// Loaded only by the guarded disposable authority layer. This fixture invokes
// public APIs with the signed-in learner; it cannot stamp or seed authority.
const route = useRoute()
const sessionId = computed(() => String(route.query.session ?? ''))
const content = import.meta.client ? useConvexQuery(api.learnV2Journey.getSessionCandidate,
  computed(() => ({ studySessionId: sessionId.value as never, learningVoidId: String(route.query.mission ?? '') as never }))) : { data: ref(null) }
const attach = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.attachReadySession)
  : createSsrMutationStub<typeof api.learnAdaptiveCanvas.attachReadySession>()
const busy = ref(false)
const error = ref('')
async function openSession() {
  const session = content.data.value
  if (!session || busy.value) return
  busy.value = true
  try {
    const result = await attach.mutate({ studySessionId: sessionId.value as never,
      expectedSessionRevision: session.sessionRevision, idempotencyKey: `browser-attach-${crypto.randomUUID()}` })
    if (result) await navigateTo(`/app/learn/thread/${encodeURIComponent(result.threadId)}`)
  }
  catch { error.value = 'Public session attachment failed.' }
  finally { busy.value = false }
}
</script>

<template>
  <section aria-label="Disposable public session entry">
    <button type="button" data-testid="adaptive-session-attach" :disabled="!content.data.value || busy" @click="openSession">Open ready session in Adaptive Learn</button>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
