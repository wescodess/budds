import { getConvexSiteUrl } from '../../utils/convex-site-url'
import { isAuthorizedE2eRequest } from '../../utils/e2e-mode'

type SessionBootstrap = { email?: unknown, password?: unknown, name?: unknown }

function validText(value: unknown, maximum: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
}

/**
 * This route exists only in the isolated local browser-test stack. It delegates
 * account/session creation to Better Auth's supported public endpoint; it never
 * writes Convex rows or manufactures a session cookie itself.
 */
export default defineEventHandler(async (event) => {
  const token = getRequestHeader(event, 'x-budds-e2e-token')
  if (!isAuthorizedE2eRequest(token)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const body = await readBody<SessionBootstrap>(event)
  if (!validText(body?.email, 254) || !validText(body?.password, 128) || !validText(body?.name, 100)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid disposable test identity' })
  }
  const target = getConvexSiteUrl(useRuntimeConfig(event))
  if (!target) throw createError({ statusCode: 503, statusMessage: 'Isolated auth backend unavailable' })
  const response = await fetch(new URL('/api/auth/sign-up/email', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: getRequestURL(event).origin },
    body: JSON.stringify({ email: body.email, password: body.password, name: body.name }),
  })
  if (!response.ok) throw createError({ statusCode: 503, statusMessage: 'Disposable auth bootstrap failed' })
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const cookie of cookies) appendResponseHeader(event, 'set-cookie', cookie.replace(/;\s*Domain=[^;]+/ig, '').replace(/;\s*Secure/ig, '').replace(/SameSite=None/ig, 'SameSite=Lax'))
  return { authenticated: true }
})
