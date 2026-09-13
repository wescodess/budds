import type { H3Event } from 'h3'
import { getConvexSiteUrl } from '../utils/convex-site-url'

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

function getRequestOrigin(event: H3Event) {
  const forwardedProto = normalizeString(getRequestHeader(event, 'x-forwarded-proto'))
  const forwardedHost = normalizeString(getRequestHeader(event, 'x-forwarded-host'))
  const host = forwardedHost || normalizeString(getRequestHeader(event, 'host'))
  if (!host) return ''
  return `${forwardedProto || 'http'}://${host}`
}

function isLocalOrigin(origin: string) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function shouldRewriteRedirectPathname(pathname: string) {
  return pathname === '/'
    || pathname.startsWith('/app')
    || pathname.startsWith('/login')
    || pathname.startsWith('/terms')
    || pathname.startsWith('/privacy')
}

function maybeRewriteLocation(location: string, {
  convexSiteUrl,
  requestOrigin,
  configuredSiteUrl,
}: {
  convexSiteUrl: string
  requestOrigin: string
  configuredSiteUrl: string
}) {
  if (!location || !requestOrigin) return location

  try {
    const target = new URL(location, convexSiteUrl)
    const convexOrigin = new URL(convexSiteUrl).origin
    const requestOriginUrl = new URL(requestOrigin).origin
    const configuredOrigin = configuredSiteUrl ? new URL(configuredSiteUrl).origin : ''
    const requestHost = new URL(requestOriginUrl).hostname
    const isLocalRequest = requestHost === 'localhost' || requestHost === '127.0.0.1'

    if (target.origin === requestOriginUrl || target.origin === convexOrigin) {
      return location
    }

    if (configuredOrigin && target.origin === configuredOrigin && shouldRewriteRedirectPathname(target.pathname)) {
      return `${requestOriginUrl}${target.pathname}${target.search}${target.hash}`
    }

    if (isLocalRequest && shouldRewriteRedirectPathname(target.pathname)) {
      return `${requestOriginUrl}${target.pathname}${target.search}${target.hash}`
    }

    return location
  } catch {
    return location
  }
}

function rewriteSetCookieForLocalhost(cookie: string, requestOrigin: string) {
  if (!cookie || !isLocalOrigin(requestOrigin)) return cookie

  return cookie
    .replace(/;\s*Domain=[^;]+/ig, '')
    .replace(/;\s*Secure/ig, '')
    .replace(/SameSite=None/ig, 'SameSite=Lax')
  // Browsers reject `SameSite=None` cookies without `Secure`, and hosted auth
  // often sets a non-local Domain attribute that prevents localhost storage.
}

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/auth/')) return

  const config = useRuntimeConfig(event)
  const convexSiteUrl = getConvexSiteUrl(config)
  const requestOrigin = getRequestOrigin(event)
  const configuredSiteUrl = normalizeString((config as { siteUrl?: unknown }).siteUrl)
  if (!convexSiteUrl) {
    return
  }

  const target = new URL(event.path, convexSiteUrl)

  const headers = new Headers()
  for (const [key, value] of Object.entries(getRequestHeaders(event))) {
    if (key === 'host') continue
    if (value) headers.set(key, String(value))
  }
  const requestUrl = getRequestURL(event)
  headers.set('x-forwarded-host', requestUrl.host)
  headers.set('x-forwarded-proto', requestUrl.protocol.replace(/:$/, ''))
  headers.set('x-forwarded-port', requestUrl.port || (requestUrl.protocol === 'https:' ? '443' : '80'))
  if (!headers.has('origin') && requestOrigin) headers.set('origin', requestOrigin)
  headers.set('host', new URL(convexSiteUrl).host)

  const body = event.method !== 'GET' && event.method !== 'HEAD'
    ? await readRawBody(event, false)
    : undefined

  const response = await fetch(target.toString(), {
    method: event.method,
    headers,
    body,
    redirect: 'manual',
  })

  const skipHeaders = new Set(['transfer-encoding', 'content-encoding', 'content-length', 'set-cookie'])
  for (const [key, value] of response.headers.entries()) {
    if (skipHeaders.has(key)) continue
    const nextValue = key.toLowerCase() === 'location'
      ? maybeRewriteLocation(value, { convexSiteUrl, requestOrigin, configuredSiteUrl })
      : value
    appendResponseHeader(event, key, nextValue)
  }

  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : []
  for (const cookie of setCookies) {
    appendResponseHeader(event, 'set-cookie', rewriteSetCookieForLocalhost(cookie, requestOrigin))
  }

  setResponseStatus(event, response.status, response.statusText)

  if (response.status >= 300 && response.status < 400) {
    return ''
  }

  const resBody = await response.arrayBuffer()
  return Buffer.from(resBody)
})
