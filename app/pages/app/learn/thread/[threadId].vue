<script setup lang="ts">
import { api } from '#convex/api'

const route = useRoute()
const router = useRouter()
const threadId = computed(() => String(route.params.threadId))
const { allowed, checkingAccess } = useLearnAdaptiveAccess()
const canvasQuery = import.meta.client
  ? useConvexQuery(api.learnAdaptiveCanvas.getCanvas, computed(() => ({ threadId: threadId.value as never })), { enabled: allowed })
  : { data: ref(null), pending: ref(false) }
const userQuery = import.meta.client
  ? useConvexQuery(api.users.getUser, {}, { enabled: allowed })
  : { data: ref(null), pending: ref(false) }
const ownerId = computed(() => userQuery.data.value?._id)
const canvas = computed(() => {
  const projection = canvasQuery.data.value
  return allowed.value && projection?.thread.id === threadId.value && projection.ownerId === ownerId.value ? projection : null
})
const canvasPending = computed(() => Boolean(canvasQuery.pending.value))
</script>

<template>
  <main data-testid="learn-adaptive-thread-route">
    <section v-if="checkingAccess" class="mx-auto max-w-3xl p-6" aria-live="polite">Checking learning access…</section>
    <section v-else-if="!allowed" class="mx-auto max-w-3xl p-6" data-testid="learn-adaptive-thread-denied">This learning thread is not available for this account.</section>
    <section v-else-if="(canvasPending || userQuery.pending.value) && !canvas" class="mx-auto max-w-3xl p-6" aria-live="polite">Loading your learning thread…</section>
    <section v-else-if="!canvas" class="mx-auto max-w-3xl p-6" data-testid="learn-adaptive-thread-unavailable">This learning thread is unavailable.</section>
    <template v-else>
      <LearnAdaptiveReadySessionCanvas :key="`${ownerId}:${canvas.thread.id}:${canvas.activity.id}`" :canvas="canvas as never" @leave="router.push('/app/learn')" />
      <div class="mx-auto max-w-3xl px-4 pb-8 sm:px-6"><button type="button" class="min-h-11 text-sm text-muted-foreground underline" @click="router.push('/app/learn')">Back to Learn</button></div>
    </template>
  </main>
</template>
