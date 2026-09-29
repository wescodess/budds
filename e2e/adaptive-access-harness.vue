<script setup lang="ts">
import { api } from '#convex/api'

const nuxtApp = useNuxtApp()
const authReady = (nuxtApp.$convexAuthReady as Ref<boolean> | undefined) ?? ref(false)
const authenticated = (nuxtApp.$convexAuthenticated as Ref<boolean> | undefined) ?? ref(false)
const toggle = import.meta.client
  ? useConvexMutation(api.learnAdaptiveAccess.setLocalE2eEntitlement)
  : { mutate: async (_args: { enabled: boolean }) => ({ enabled: false }) }
const access = import.meta.client
  ? useConvexQuery(api.learnAdaptiveAccess.adaptiveStatus, {}, { ssr: false })
  : { data: ref<{ kind: string } | undefined>() }
const busy = ref(false)
const result = ref('')
const error = ref('')

async function setEnabled(enabled: boolean) {
  busy.value = true
  result.value = ''
  error.value = ''
  try {
    await toggle.mutate({ enabled })
    result.value = enabled ? 'Adaptive access restored.' : 'Adaptive access rolled back.'
  }
  catch {
    error.value = 'Local entitlement change failed.'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <main data-testid="adaptive-access-harness">
    <p data-testid="adaptive-access-status">{{ access.data.value?.kind ?? 'checking' }}</p>
    <button type="button" data-testid="adaptive-access-disable" :disabled="!authReady || !authenticated || busy" @click="setEnabled(false)">Roll back access</button>
    <button type="button" data-testid="adaptive-access-enable" :disabled="!authReady || !authenticated || busy" @click="setEnabled(true)">Restore access</button>
    <p v-if="result" role="status">{{ result }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>
