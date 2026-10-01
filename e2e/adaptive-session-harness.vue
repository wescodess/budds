<script setup lang="ts">
import { api } from '#convex/api'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

// Loaded only by the guarded disposable authority layer. This fixture invokes
// public APIs with the signed-in learner; it cannot stamp or seed authority.
const route = useRoute()
const sessionId = computed(() => String(route.query.session ?? ''))
const auth = useNuxtApp()
const authReady = (auth.$convexAuthReady as Ref<boolean> | undefined) ?? ref(false)
const authenticated = (auth.$convexAuthenticated as Ref<boolean> | undefined) ?? ref(false)
const ready = computed(() => authReady.value && authenticated.value)
const content = import.meta.client ? useConvexQuery(api.learnV2Journey.getSessionCandidate,
  computed(() => ({ studySessionId: sessionId.value as never, learningVoidId: String(route.query.mission ?? '') as never })),
  { enabled: computed(() => ready.value && Boolean(sessionId.value)), ssr: false }) : { data: ref(null) }
const attach = import.meta.client ? useConvexMutation(api.learnAdaptiveCanvas.attachReadySession)
  : createSsrMutationStub<typeof api.learnAdaptiveCanvas.attachReadySession>()
const busy = ref(false)
const error = ref('')
const client = import.meta.client ? useConvex() : null
const report = ref('')
async function captureAuthority() {
  if (!client || !ready.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const collections = ['masteryAttempts', 'masteryRecords', 'learnJobs', 'learnActivityEvents', 'learningThreadContributions'] as const
    const rows = await Promise.all(collections.map(async collection => {
      const records: Array<Record<string, unknown>> = []
      let cursor: string | null = null
      for (let pageNumber = 0; pageNumber < 32; pageNumber++) {
        const page = await client.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor, numItems: 8 } })
        records.push(...page.page as Array<Record<string, unknown>>)
        if (page.isDone) return records
        cursor = page.continueCursor
      }
      throw new Error('Fixture export exceeds its bounded pages')
    }))
    report.value = JSON.stringify({
      attempts: rows[0], mastery: rows[1],
      scoringJobs: rows[2]!.filter(row => row.type === 'mastery_scoring').map(row => ({ id: row._id, status: row.status, revision: row.revision })),
      authorityEvents: rows[3]!.filter(row => ['activity_started', 'meaningful_activity_started', 'meaningful_response', 'activity_completed'].includes(String(row.eventType))),
      lineage: rows[4]!.filter(row => row.attemptLineage).map(row => ({ feature: row.sourceFeature, ...row.attemptLineage as Record<string, unknown> })),
    })
  }
  catch { error.value = 'Public authority export failed.' }
  finally { busy.value = false }
}
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
    <button v-if="sessionId" type="button" data-testid="adaptive-session-attach" :disabled="!content.data.value || busy" @click="openSession">Open ready session in Adaptive Learn</button>
    <button type="button" data-testid="adaptive-authority-capture" :disabled="!ready || busy" @click="captureAuthority">Read owner-visible authority export</button>
    <pre v-if="report" data-testid="adaptive-authority-report">{{ report }}</pre>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
