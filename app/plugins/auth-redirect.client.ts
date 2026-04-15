function isProtectedPath(path: string) {
  return path === '/'
    || path === '/chat'
    || path === '/app'
    || path.startsWith('/app/')
}

export default defineNuxtPlugin(() => {
  const route = useRoute()
  const { loggedIn, ready } = useUserSession()

  watch(
    [loggedIn, ready, () => route.path],
    async ([isLoggedIn, isReady, path]) => {
      if (!isReady || isLoggedIn || !isProtectedPath(path)) return
      await navigateTo('/login', { replace: true })
    },
    { immediate: true },
  )
})
