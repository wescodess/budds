import { createSharedComposable, useMediaQuery } from '@vueuse/core'

export const EDGE_GUARD_PX = 24
export const LONG_PRESS_MS = 450
export const LONG_PRESS_MOVE_PX = 10
export const TAB_SWITCH_THRESHOLD_PX = 64
export const PANEL_DISMISS_THRESHOLD_PX = 72
export const ROW_ACTION_WIDTH_PX = 120
export const ROW_OPEN_THRESHOLD_PX = 56
export const ROW_CLOSE_THRESHOLD_PX = 32

const INTERACTIVE_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  '[contenteditable]',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[data-mobile-gesture-ignore]',
].join(', ')

const GESTURE_OWNER_SELECTOR = [
  '[data-gesture-owner]',
  '[data-swipe-reveal-actions]',
].join(', ')

export interface GestureGuardOptions {
  allowGestureOwners?: boolean
  allowInteractiveTargets?: boolean
  extraInteractiveSelectors?: string[]
  edgeGuardPx?: number
}

function resolveTargetElement(input: Event | Element | null | undefined) {
  if (!input) return null
  if (input instanceof Element) return input
  return input.target instanceof Element ? input.target : null
}

function hasClientX(input: unknown): input is Pick<PointerEvent, 'clientX'> {
  return typeof input === 'object' && input !== null && typeof (input as { clientX?: unknown }).clientX === 'number'
}

function resolveGesturePoint(input: Event | Touch | Pick<PointerEvent, 'clientX'> | null | undefined) {
  if (!input) return null
  if (hasClientX(input)) return input

  const touchEvent = input as Partial<TouchEvent>
  return touchEvent.changedTouches?.[0] ?? touchEvent.touches?.[0] ?? touchEvent.targetTouches?.[0] ?? null
}

export const useGestureGuards = createSharedComposable(() => {
  const isTouchLike = useMediaQuery('(hover: none), (pointer: coarse)')
  const isMobileViewport = useMediaQuery('(max-width: 1023px)')

  function isWithinEdgeGuard(
    input: Event | Touch | Pick<PointerEvent, 'clientX'> | null | undefined,
    edgeGuardPx = EDGE_GUARD_PX,
  ) {
    if (!import.meta.client) return false
    const point = resolveGesturePoint(input)
    if (!point) return false
    return point.clientX <= edgeGuardPx || point.clientX >= window.innerWidth - edgeGuardPx
  }

  function isInteractiveTarget(
    input: Event | Element | null | undefined,
    extraSelectors: string[] = [],
  ) {
    const target = resolveTargetElement(input)
    if (!target) return false
    const selector = extraSelectors.length > 0
      ? `${INTERACTIVE_TARGET_SELECTOR}, ${extraSelectors.join(', ')}`
      : INTERACTIVE_TARGET_SELECTOR
    return Boolean(target.closest(selector))
  }

  function hasGestureOwner(input: Event | Element | null | undefined) {
    const target = resolveTargetElement(input)
    if (!target) return false
    return Boolean(target.closest(GESTURE_OWNER_SELECTOR))
  }

  function shouldStartHorizontalGesture(event: PointerEvent | TouchEvent, options: GestureGuardOptions = {}) {
    if (!isTouchLike.value || !isMobileViewport.value) return false
    if (isWithinEdgeGuard(event, options.edgeGuardPx)) return false
    if (!options.allowInteractiveTargets && isInteractiveTarget(event, options.extraInteractiveSelectors)) {
      return false
    }
    if (!options.allowGestureOwners && hasGestureOwner(event)) return false
    return true
  }

  return {
    isTouchLike,
    isMobileViewport,
    isWithinEdgeGuard,
    isInteractiveTarget,
    hasGestureOwner,
    shouldStartHorizontalGesture,
  }
})
