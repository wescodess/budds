import { makeFunctionReference } from 'convex/server'

const upsertUserRef = makeFunctionReference<'mutation'>('users:upsertUser')

export default defineNuxtPlugin(() => {
  const convexClient = useConvex()
  const { loggedIn, ready } = useUserSession()
  const convexAuthReady = ref(false)

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
      convexClient.setAuth(fetchToken, (isAuthenticated: boolean) => {
        convexAuthReady.value = true
        if (isAuthenticated && !upsertDone) {
          convexClient.mutation(upsertUserRef, {})
            .then(() => { upsertDone = true })
            .catch(() => { upsertDone = false })
        }
      })
    } else {
      upsertDone = false
      convexAuthReady.value = true
      convexClient.client.clearAuth()
    }
  }, { immediate: true })

  return { provide: { convexAuthReady } }
})
