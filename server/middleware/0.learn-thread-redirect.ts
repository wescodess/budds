const LEGACY_PREFIX = '/app/learn/thread/'
const LEGACY_PREFIX_RE = /^\/app\/learn\/thread\//i
const LEGACY_ENTRY_RE = /^\/app\/learn\/thread\/[^/]+\/?$/i

export default defineEventHandler((event) => {
  if ((event.method !== 'GET' && event.method !== 'HEAD') || !LEGACY_PREFIX_RE.test(event.path)) return
  const { pathname, search } = new URL(event.path, 'http://localhost')
  if (!LEGACY_ENTRY_RE.test(pathname)) return
  setResponseHeader(event, 'cache-control', 'no-store')
  return sendRedirect(event, `/app/learn/void/${pathname.slice(LEGACY_PREFIX.length)}${search}`, 302)
})
