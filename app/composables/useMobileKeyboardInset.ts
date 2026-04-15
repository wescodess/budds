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

  function applyViewportVars() {
    if (!import.meta.client) return

    const root = document.documentElement
    const viewport = window.visualViewport
    const baseHeight = viewport?.height ?? window.innerHeight
    const offsetTop = viewport?.offsetTop ?? 0
    const keyboardHeight = isTouchLike.value
      ? Math.max(0, Math.round(window.innerHeight - baseHeight - offsetTop))
      : 0

    keyboardOpen.value = keyboardHeight > 0
    root.style.setProperty('--mobile-vh', `${Math.round(baseHeight)}px`)
    root.style.setProperty('--vk-height', `${keyboardHeight}px`)
    root.style.setProperty(
      '--vk-safe-bottom',
      keyboardHeight > 0
        ? `calc(${keyboardHeight}px + env(safe-area-inset-bottom, 0px))`
        : 'env(safe-area-inset-bottom, 0px)',
    )
    root.dataset.keyboardOpen = keyboardOpen.value ? 'true' : 'false'
  }

  function scrollActiveFieldIntoView() {
    if (!import.meta.client || !isTouchLike.value) return
    const target = document.activeElement
    if (!isEditableElement(target)) return
    window.setTimeout(() => {
      if (!isEditableElement(document.activeElement)) return
      ;(document.activeElement as HTMLElement).scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      })
    }, 220)
  }

  if (import.meta.client) {
    const updateViewport = () => {
      applyViewportVars()
      if (keyboardOpen.value) scrollActiveFieldIntoView()
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

