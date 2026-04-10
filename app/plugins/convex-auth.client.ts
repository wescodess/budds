import { makeFunctionReference } from 'convex/server'

const upsertUserRef = makeFunctionReference<'mutation'>('users:upsertUser')

export default defineNuxtPlugin((nuxtApp) => {
  const provides = nuxtApp.vueApp._context.provides
  let convexClient: any = null
  for (const key of Object.getOwnPropertySymbols(provides)) {
    if (key.description === 'convex-client') {
      convexClient = provides[key]
      break
    }
  }
  if (!convexClient) return

  const { loggedIn, ready } = useUserSession()

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
      convexClient.setAuth(fetchToken, (isAuthenticated: boolean) => {
        if (isAuthenticated && !upsertDone) {
          convexClient.mutation(upsertUserRef, {})
            .then(() => { upsertDone = true })
            .catch(() => { upsertDone = false })
        }
      })
    } else {
      upsertDone = false
      convexClient.client.clearAuth()
    }
  }, { immediate: true })
})
