export default defineNuxtPlugin(() => {
  if (!import.meta.client || !('serviceWorker' in navigator)) {
    return
  }

  const register = async () => {
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      return
    }

    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    } catch (error) {
      console.error('Failed to register service worker', error)
    }
  }

  window.addEventListener('load', () => {
    void register()
  }, { once: true })
})
