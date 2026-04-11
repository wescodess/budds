import type { H3Event } from 'h3'

export function getConvexTokenIdentifier(event: H3Event): string {
  const token = event.context.convexToken as string | undefined
  if (!token) {
    throw createError({ statusCode: 401, message: 'Convex authentication token not available' })
  }

  const base64Url = token.split('.')[1]
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const payload = JSON.parse(atob(base64))
  return `${payload.iss}|${payload.sub}`
}
