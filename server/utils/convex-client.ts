import { ConvexHttpClient } from 'convex/browser'
import { readConfiguredRuntimeValue } from './runtime-config'
import type { H3Event } from 'h3'

export function makeConvexClient(event: H3Event): ConvexHttpClient | null {
  const token = (event.context as Record<string, unknown>).convexToken as string | undefined
  const runtimeConfig = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(
    runtimeConfig.public?.convex?.url,
    'NUXT_PUBLIC_CONVEX_URL',
    'CONVEX_URL',
  )
  if (!token || !convexUrl) return null
  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(token)
  return client
}
