import { CONVEX_INJECTION_KEY } from '@convex-vue/core'
import { makeFunctionReference } from 'convex/server'
import { inject } from 'vue'

const upsertUserRef = makeFunctionReference<'mutation'>('users:upsertUser')

export default defineNuxtPlugin({
  name: 'convex-auth',
  enforce: 'post',
  setup(nuxtApp) {
    const convexClient = nuxtApp.vueApp.runWithContext(
      () => inject(CONVEX_INJECTION_KEY, null),
    )
    const { loggedIn, ready } = useUserSession()
    const convexAuthReady = ref(false)
    const convexAuthenticated = ref(false)

    if (!convexClient) {
      console.warn('[convex-auth] Convex client injection is unavailable')
      convexAuthReady.value = true
      return { provide: { convexAuthReady, convexAuthenticated } }
    }

    let upsertDone = false
    let upsertPending = false
    let queuedBootstrapEpoch: number | null = null
    let authEpoch = 0

    const fetchToken = async (_opts: { forceRefreshToken: boolean }) => {
      try {
        const response = await $fetch<{ token: string }>('/api/auth/convex/token')
        return response.token
      } catch {
        return null
      }
    }

    const bootstrapProfile = (epoch: number) => {
      if (upsertDone) return
      if (upsertPending) {
        queuedBootstrapEpoch = epoch
        return
      }
      upsertPending = true
      void (async () => {
        try {
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              await convexClient.mutation(upsertUserRef, {})
              if (epoch !== authEpoch) return
              upsertDone = true
              convexAuthReady.value = true
              return
            }
            catch {
              if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
            }
          }
          if (epoch === authEpoch) {
            convexAuthenticated.value = false
            convexAuthReady.value = true
          }
        }
        finally {
          upsertPending = false
          const queuedEpoch = queuedBootstrapEpoch
          queuedBootstrapEpoch = null
          if (queuedEpoch === authEpoch && loggedIn.value && ready.value && !upsertDone) bootstrapProfile(queuedEpoch)
        }
      })()
    }

    watch([loggedIn, ready], ([isLoggedIn, isReady]) => {
      if (!isReady) return
      const epoch = ++authEpoch

      if (isLoggedIn) {
        convexAuthReady.value = false
        convexAuthenticated.value = false
        convexClient.client.setAuth(fetchToken, (isAuthenticated: boolean) => {
          convexAuthenticated.value = isAuthenticated
          if (isAuthenticated && !upsertDone) bootstrapProfile(epoch)
          else if (!upsertPending) convexAuthReady.value = true
        })
      } else {
        upsertDone = false
        queuedBootstrapEpoch = null
        convexAuthenticated.value = false
        convexAuthReady.value = true
        convexClient.client.clearAuth()
      }
    }, { immediate: true })

    return { provide: { convexAuthReady, convexAuthenticated } }
  },
})
