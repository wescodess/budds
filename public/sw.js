const CACHE_VERSION = 'budds-shell-v1'
const SECTION_CACHE = 'budds-learn-sections-v1'
const APP_SHELL_ASSETS = [
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
]

const LEARN_SECTION_PATTERN = /^\/app\/(?:learn\/[^/]+\/[^/]+|folders\/[^/]+\/learn\/[^/]+\/[^/]+)/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL_ASSETS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.map(key =>
        key === CACHE_VERSION || key === SECTION_CACHE
          ? undefined
          : caches.delete(key),
      ),
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    const isLearnSection = LEARN_SECTION_PATTERN.test(url.pathname)

    event.respondWith((async () => {
      try {
        const response = await fetch(request)

        if (isLearnSection && response.ok) {
          const cache = await caches.open(SECTION_CACHE)
          cache.put(request, response.clone())
        }

        return response
      } catch {
        if (isLearnSection) {
          const cached = await caches.match(request, { cacheName: SECTION_CACHE })
          if (cached) return cached
        }

        const offlinePage = await caches.match('/offline.html')
        return offlinePage || Response.error()
      }
    })())
    return
  }

  const isStaticAsset = ['style', 'script', 'worker', 'image', 'font'].includes(request.destination)
  if (!isStaticAsset) return

  event.respondWith((async () => {
    const cached = await caches.match(request)
    if (cached) return cached

    const response = await fetch(request)
    const cache = await caches.open(CACHE_VERSION)
    cache.put(request, response.clone())
    return response
  })())
})
