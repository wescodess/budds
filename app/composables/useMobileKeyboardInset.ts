import { createSharedComposable, useEventListener, useMediaQuery } from '@vueuse/core'

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export const useMobileKeyboardInset = createSharedComposable(() => {
  const isTouchLike = useMediaQuery('(hover: none), (pointer: coarse)')
  const keyboardOpen = ref(false)
  const FOCUS_SCROLL_MARGIN_PX = 16

  function applyViewportVars() {
    if (!import.meta.client) return

    const root = document.documentElement
    const viewport = window.visualViewport
    const viewportHeight = viewport?.height ?? window.innerHeight
    const offsetTop = viewport?.offsetTop ?? 0
    const visibleHeight = viewportHeight + offsetTop
    const keyboardHeight = isTouchLike.value
      ? Math.max(0, Math.round(window.innerHeight - viewportHeight - offsetTop))
      : 0

    keyboardOpen.value = keyboardHeight > 0
    root.style.setProperty('--mobile-vh', `${Math.round(visibleHeight)}px`)
    root.style.setProperty('--vk-height', `${keyboardHeight}px`)
    root.style.setProperty('--vk-safe-bottom', 'env(safe-area-inset-bottom, 0px)')
    root.dataset.keyboardOpen = keyboardOpen.value ? 'true' : 'false'
  }

  function scrollActiveFieldIntoView() {
    if (!import.meta.client || !isTouchLike.value) return
    const target = document.activeElement
    if (!isEditableElement(target)) return
    window.setTimeout(() => {
      if (!isEditableElement(document.activeElement)) return
      const activeField = document.activeElement as HTMLElement
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const rect = activeField.getBoundingClientRect()
      const fieldIsVisible =
        rect.top >= FOCUS_SCROLL_MARGIN_PX
        && rect.bottom <= viewportHeight - FOCUS_SCROLL_MARGIN_PX

      if (fieldIsVisible) return

      activeField.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'auto',
      })
    }, 180)
  }

  if (import.meta.client) {
    const updateViewport = () => {
      const wasKeyboardOpen = keyboardOpen.value
      applyViewportVars()
      if (!wasKeyboardOpen && keyboardOpen.value) scrollActiveFieldIntoView()
    }

    applyViewportVars()
    useEventListener(window, 'resize', updateViewport, { passive: true })
    useEventListener(window.visualViewport, 'resize', updateViewport, { passive: true })
    useEventListener(window.visualViewport, 'scroll', updateViewport, { passive: true })
    useEventListener(document, 'focusin', (event) => {
      if (!isEditableElement(event.target)) return
      scrollActiveFieldIntoView()
    })

    watch(isTouchLike, () => {
      applyViewportVars()
    }, { immediate: true })
  }

  return {
    isTouchLike,
    keyboardOpen: readonly(keyboardOpen),
    applyViewportVars,
  }
})
