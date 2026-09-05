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

    const fetchToken = async (_opts: { forceRefreshToken: boolean }) => {
      try {
        const response = await $fetch<{ token: string }>('/api/auth/convex/token')
        return response.token
      } catch {
        return null
      }
    }

    watch([loggedIn, ready], ([isLoggedIn, isReady]) => {
      if (!isReady) return

      if (isLoggedIn) {
        convexAuthReady.value = false
        convexAuthenticated.value = false
        convexClient.client.setAuth(fetchToken, (isAuthenticated: boolean) => {
          convexAuthenticated.value = isAuthenticated
          convexAuthReady.value = true
          if (isAuthenticated && !upsertDone) {
            convexClient.mutation(upsertUserRef, {})
              .then(() => { upsertDone = true })
              .catch(() => { upsertDone = false })
          }
        })
      } else {
        upsertDone = false
        convexAuthenticated.value = false
        convexAuthReady.value = true
        convexClient.client.clearAuth()
      }
    }, { immediate: true })

    return { provide: { convexAuthReady, convexAuthenticated } }
  },
})
