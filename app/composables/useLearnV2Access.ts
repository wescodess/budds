import { api } from '#convex/api'

type LearnV2AccessStatus = { kind: 'allowed' | 'denied' }

export function useLearnV2Access() {
  const nuxtApp = import.meta.client ? useNuxtApp() : null
  const convexAuthReady = import.meta.client
    ? ((nuxtApp!.$convexAuthReady as Ref<boolean> | undefined) ?? ref(false))
    : ref(false)
  const convexAuthenticated = import.meta.client
    ? ((nuxtApp!.$convexAuthenticated as Ref<boolean> | undefined) ?? ref(false))
    : ref(false)
  const convexAuthUsable = computed(
    () => convexAuthReady.value && convexAuthenticated.value,
  )

  const access = import.meta.client
    ? useConvexQuery(api.learnV2Access.status, {}, { enabled: convexAuthUsable, ssr: false })
    : { data: ref<LearnV2AccessStatus>(), pending: ref(false) }

  const allowed = computed(
    () => convexAuthUsable.value
      && (access.data.value as LearnV2AccessStatus | undefined)?.kind === 'allowed',
  )
  const checkingAccess = computed(
    () => !convexAuthReady.value
      || (convexAuthenticated.value && access.pending.value),
  )

  return { allowed, checkingAccess }
}
