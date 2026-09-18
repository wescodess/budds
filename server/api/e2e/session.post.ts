import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import { getConvexSiteUrl } from '../../utils/convex-site-url'
import { isAuthorizedE2eRequest } from '../../utils/e2e-mode'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'

type SessionBootstrap = { email?: unknown, password?: unknown, name?: unknown }

function validText(value: unknown, maximum: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
}

/**
 * This route exists only in the isolated local browser-test stack. It delegates
 * account/session creation to Better Auth's supported public endpoint, then
 * invokes the ordinary authenticated profile upsert. It never writes Convex
 * rows directly or manufactures a session cookie itself.
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
  const cookiePairs = cookies.map(value => value.split(';', 1)[0]).filter((value): value is string => Boolean(value))
  const cookie = cookiePairs.join('; ')
  const convexCookie = cookiePairs.find(value => value.startsWith('better-auth.convex_jwt='))
  let convexToken = convexCookie ? decodeURIComponent(convexCookie.slice('better-auth.convex_jwt='.length)) : null
  if (!convexToken) {
    const tokenResponse = await fetch(new URL('/api/auth/convex/token', target), {
      headers: { cookie, origin: getRequestURL(event).origin },
    })
    const tokenPayload = tokenResponse.ok ? await tokenResponse.json() as { token?: unknown } : null
    convexToken = typeof tokenPayload?.token === 'string' ? tokenPayload.token : null
  }
  const convexUrl = readConfiguredRuntimeValue(process.env.CONVEX_URL, 'NUXT_PUBLIC_CONVEX_URL')
  let parsedConvexUrl: URL
  try { parsedConvexUrl = new URL(convexUrl) }
  catch { throw createError({ statusCode: 503, statusMessage: 'Isolated profile backend unavailable' }) }
  if (parsedConvexUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsedConvexUrl.hostname) || !convexToken) {
    throw createError({ statusCode: 503, statusMessage: 'Isolated profile backend unavailable' })
  }
  const client = new ConvexHttpClient(parsedConvexUrl.toString())
  client.setAuth(convexToken)
  // The anonymous local Convex backend can briefly reject a newly-issued JWT
  // while its auth state settles. Retry only inside this loopback-only seam.
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      await client.mutation(api.users.upsertUser, {})
      break
    }
    catch (error) {
      if (attempt === 89) throw error
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }
  for (const cookie of cookies) appendResponseHeader(event, 'set-cookie', cookie.replace(/;\s*Domain=[^;]+/ig, '').replace(/;\s*Secure/ig, '').replace(/SameSite=None/ig, 'SameSite=Lax'))
  return { authenticated: true }
})
