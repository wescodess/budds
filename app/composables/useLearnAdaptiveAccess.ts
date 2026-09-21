import { api } from '#convex/api'

type AdaptiveStatus = { kind: 'allowed' | 'denied' }

export function useLearnAdaptiveAccess() {
  const nuxtApp = import.meta.client ? useNuxtApp() : null
  const authReady = import.meta.client ? ((nuxtApp!.$convexAuthReady as Ref<boolean> | undefined) ?? ref(false)) : ref(false)
  const authenticated = import.meta.client ? ((nuxtApp!.$convexAuthenticated as Ref<boolean> | undefined) ?? ref(false)) : ref(false)
  const authUsable = computed(() => authReady.value && authenticated.value)
  const access = import.meta.client
    ? useConvexQuery(api.learnAdaptiveAccess.adaptiveStatus, {}, { enabled: authUsable, ssr: false })
    : { data: ref<AdaptiveStatus>(), pending: ref(false) }
  return {
    allowed: computed(() => authUsable.value && (access.data.value as AdaptiveStatus | undefined)?.kind === 'allowed'),
    checkingAccess: computed(() => !authReady.value || (authenticated.value && access.pending.value)),
  }
}
