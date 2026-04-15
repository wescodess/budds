import { getConvexSiteUrl } from '../utils/convex-site-url'

export default defineEventHandler(async (event) => {
  const cookie = getRequestHeader(event, 'cookie')
  if (!cookie) return

  const config = useRuntimeConfig(event)
  const convexSiteUrl = getConvexSiteUrl(config)
  if (!convexSiteUrl) return

  const headers: Record<string, string> = { cookie }
  const userAgent = getRequestHeader(event, 'user-agent')
  if (userAgent) headers['user-agent'] = userAgent
  const origin = getRequestHeader(event, 'origin')
  if (origin) headers['origin'] = origin

  try {
    const res = await $fetch<{ token: string }>(
      `${convexSiteUrl}/api/auth/convex/token`,
      { headers },
    )
    event.context.convexToken = res.token
  } catch (err) {
    console.error('[convex-token] Failed to exchange token:', err)
    // Not authenticated — SSR queries will run without auth,
    // client-side auth takes over after hydration
  }
})
