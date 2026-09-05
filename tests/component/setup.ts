// Better Auth exposes these flags specifically so component tests can avoid
// bootstrapping a real client/server session transport before the test app is
// mounted. Without them its async Nuxt plugin waits on the configured site URL.
Object.assign(globalThis, {
  __NUXT_BETTER_AUTH_TEST_FLAGS__: {
    client: false,
    server: false,
  },
})
