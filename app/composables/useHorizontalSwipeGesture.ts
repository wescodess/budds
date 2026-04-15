import { tryOnMounted, tryOnScopeDispose, useEventListener, unrefElement } from '@vueuse/core'
import { computed, reactive, toValue } from 'vue'
import type { ComponentPublicInstance, MaybeRefOrGetter } from 'vue'

type SwipeTarget = HTMLElement | SVGElement | ComponentPublicInstance | null | undefined

interface HorizontalSwipeGestureOptions {
  target: MaybeRefOrGetter<SwipeTarget>
  threshold?: number
  directionLockThreshold?: number
  shouldStart?: (event: TouchEvent | PointerEvent) => boolean
  onSwipeEnd: (payload: {
    deltaX: number
    deltaY: number
    event: TouchEvent | PointerEvent
  }) => void
}

interface SwipeState {
  active: boolean
  horizontalLocked: boolean
  startX: number
  startY: number
  lastX: number
  lastY: number
  touchId: number | null
  pointerId: number | null
}

function createSwipeState(): SwipeState {
  return {
    active: false,
    horizontalLocked: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    touchId: null,
    pointerId: null,
  }
}

function findTouchById(touches: TouchList, touchId: number | null) {
  if (touchId === null) return touches[0] ?? null
  for (const touch of Array.from(touches)) {
    if (touch.identifier === touchId) return touch
  }
  return null
}

export function useHorizontalSwipeGesture(options: HorizontalSwipeGestureOptions) {
  const target = computed<HTMLElement | SVGElement | null>(() => {
    const resolved = unrefElement(toValue(options.target) as SwipeTarget)
    if (resolved instanceof HTMLElement || resolved instanceof SVGElement) return resolved
    return null
  })
  const threshold = computed(() => options.threshold ?? 24)
  const directionLockThreshold = computed(() => options.directionLockThreshold ?? 10)
  const state = reactive(createSwipeState())

  let previousUserSelect = ''
  let previousWebkitUserSelect = ''
  let previousWebkitTouchCallout = ''
  let selectionLocked = false

  function lockSelection() {
    if (!import.meta.client || selectionLocked) return
    const root = document.documentElement
    if (!root?.style) return
    previousUserSelect = root.style.userSelect
    previousWebkitUserSelect = root.style.getPropertyValue('-webkit-user-select')
    previousWebkitTouchCallout = root.style.getPropertyValue('-webkit-touch-callout')
    root.style.userSelect = 'none'
    root.style.setProperty('-webkit-user-select', 'none')
    root.style.setProperty('-webkit-touch-callout', 'none')
    selectionLocked = true
  }

  function unlockSelection() {
    if (!import.meta.client || !selectionLocked) return
    const root = document.documentElement
    if (!root?.style) return
    root.style.userSelect = previousUserSelect
    root.style.setProperty('-webkit-user-select', previousWebkitUserSelect)
    root.style.setProperty('-webkit-touch-callout', previousWebkitTouchCallout)
    selectionLocked = false
  }

  function resetState() {
    state.active = false
    state.horizontalLocked = false
    state.startX = 0
    state.startY = 0
    state.lastX = 0
    state.lastY = 0
    state.touchId = null
    state.pointerId = null
    unlockSelection()
  }

  function beginGesture(x: number, y: number, ids: { touchId?: number | null; pointerId?: number | null } = {}) {
    state.active = true
    state.horizontalLocked = false
    state.startX = x
    state.startY = y
    state.lastX = x
    state.lastY = y
    state.touchId = ids.touchId ?? null
    state.pointerId = ids.pointerId ?? null
  }

  function updateGesture(x: number, y: number, event: TouchEvent | PointerEvent) {
    if (!state.active) return

    state.lastX = x
    state.lastY = y

    const deltaX = state.lastX - state.startX
    const deltaY = state.lastY - state.startY

    if (!state.horizontalLocked) {
      if (
        Math.abs(deltaX) < directionLockThreshold.value
        && Math.abs(deltaY) < directionLockThreshold.value
      ) {
        return
      }

      if (Math.abs(deltaX) <= Math.abs(deltaY)) {
        resetState()
        return
      }

      state.horizontalLocked = true
      lockSelection()
    }

    if (event.cancelable) event.preventDefault()
  }

  function finishGesture(event: TouchEvent | PointerEvent) {
    if (!state.active) {
      resetState()
      return
    }

    const deltaX = state.lastX - state.startX
    const deltaY = state.lastY - state.startY
    const shouldEmit = state.horizontalLocked && Math.abs(deltaX) >= threshold.value

    if (shouldEmit) {
      options.onSwipeEnd({ deltaX, deltaY, event })
    }

    resetState()
  }

  tryOnMounted(() => {
    target.value?.style?.setProperty('touch-action', 'pan-y')
  })

  const stops = [
    useEventListener(target, 'touchstart', (event) => {
      const touch = event.changedTouches[0]
      if (!touch) return
      if (options.shouldStart && !options.shouldStart(event)) return
      beginGesture(touch.clientX, touch.clientY, { touchId: touch.identifier })
    }, { passive: true }),
    useEventListener(target, 'touchmove', (event) => {
      const touch = findTouchById(event.touches, state.touchId)
      if (!touch) return
      updateGesture(touch.clientX, touch.clientY, event)
    }, { passive: false }),
    useEventListener(target, 'touchend', (event) => {
      const touch = findTouchById(event.changedTouches, state.touchId)
      if (touch) {
        state.lastX = touch.clientX
        state.lastY = touch.clientY
      }
      finishGesture(event)
    }, { passive: true }),
    useEventListener(target, 'touchcancel', () => {
      resetState()
    }, { passive: true }),
    useEventListener(target, 'pointerdown', (event) => {
      if (event.pointerType === 'touch') return
      if (options.shouldStart && !options.shouldStart(event)) return
      beginGesture(event.clientX, event.clientY, { pointerId: event.pointerId })
    }),
    useEventListener(target, 'pointermove', (event) => {
      if (event.pointerType === 'touch') return
      if (!state.active || state.pointerId !== event.pointerId) return
      updateGesture(event.clientX, event.clientY, event)
    }),
    useEventListener(target, 'pointerup', (event) => {
      if (event.pointerType === 'touch') return
      if (state.pointerId !== event.pointerId) return
      state.lastX = event.clientX
      state.lastY = event.clientY
      finishGesture(event)
    }),
    useEventListener(target, 'pointercancel', () => {
      resetState()
    }),
  ]

  const stop = () => {
    resetState()
    stops.forEach(stopListener => stopListener())
  }

  tryOnScopeDispose(stop)

  return {
    stop,
  }
}
