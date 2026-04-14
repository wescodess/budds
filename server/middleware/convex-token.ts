import { getConvexSiteUrl } from '../utils/convex-site-url'

export default defineEventHandler(async (event) => {
  const cookie = getRequestHeader(event, 'cookie')
  if (!cookie) return

  const config = useRuntimeConfig(event)
  const convexSiteUrl = getConvexSiteUrl(config)
  if (!convexSiteUrl) return

  try {
    const res = await $fetch<{ token: string }>(
      `${convexSiteUrl}/api/auth/convex/token`,
      { headers: { cookie } },
    )
    event.context.convexToken = res.token
  } catch {
    // Not authenticated — SSR queries will run without auth,
    // client-side auth takes over after hydration
  }
})
