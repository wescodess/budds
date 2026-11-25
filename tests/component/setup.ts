import { beforeEach } from 'vitest'

// Better Auth exposes these flags specifically so component tests can avoid
// bootstrapping a real client/server session transport before the test app is
// mounted. Without them its async Nuxt plugin waits on the configured site URL.
Object.assign(globalThis, {
  __NUXT_BETTER_AUTH_TEST_FLAGS__: {
    client: false,
    server: false,
  },
})

let startup: Promise<void> | undefined

async function warmStartup() {
  const { mountSuspended } = await import('@nuxt/test-utils/runtime')
  const initialRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const warmup = await mountSuspended({ render: () => null })
  const router = warmup.vm.$router
  warmup.unmount()
  await router.replace(initialRoute)
}

beforeEach(() => {
  startup ??= warmStartup()
  return startup
})
