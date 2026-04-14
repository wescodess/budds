export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/auth/')) return

  const { convexSiteUrl } = useRuntimeConfig(event)
  if (!convexSiteUrl) return

  const target = new URL(event.path, convexSiteUrl)

  const headers = new Headers()
  for (const [key, value] of Object.entries(getRequestHeaders(event))) {
    if (key === 'host') continue
    if (value) headers.set(key, String(value))
  }
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

  const skipHeaders = new Set(['transfer-encoding', 'content-encoding', 'content-length'])
  for (const [key, value] of response.headers.entries()) {
    if (skipHeaders.has(key)) continue
    appendResponseHeader(event, key, value)
  }

  setResponseStatus(event, response.status, response.statusText)

  if (response.status >= 300 && response.status < 400) {
    return ''
  }

  const resBody = await response.arrayBuffer()
  return Buffer.from(resBody)
})
