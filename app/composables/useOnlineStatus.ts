import { ref, onMounted, onUnmounted } from 'vue'

export function useOnlineStatus() {
  const isOnline = ref(true)

  let onOnline: (() => void) | null = null
  let onOffline: (() => void) | null = null

  onMounted(() => {
    isOnline.value = navigator.onLine

    onOnline = () => { isOnline.value = true }
    onOffline = () => { isOnline.value = false }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  })

  onUnmounted(() => {
    if (onOnline) window.removeEventListener('online', onOnline)
    if (onOffline) window.removeEventListener('offline', onOffline)
  })

  return { isOnline }
}
