import { onClickOutside, usePointerSwipe } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'
import { useGestureGuards, ROW_ACTION_WIDTH_PX, ROW_CLOSE_THRESHOLD_PX, ROW_OPEN_THRESHOLD_PX } from './useGestureGuards'

interface UseSwipeRevealOptions {
  open: MaybeRefOrGetter<boolean>
  disabled?: MaybeRefOrGetter<boolean>
  actionWidth?: MaybeRefOrGetter<number>
  openThreshold?: MaybeRefOrGetter<number>
  closeThreshold?: MaybeRefOrGetter<number>
  onOpen: () => void
  onClose: () => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function useSwipeReveal(options: UseSwipeRevealOptions) {
  const { isTouchLike, shouldStartHorizontalGesture } = useGestureGuards()
  const rootRef = ref<HTMLElement | null>(null)
  const isDragging = ref(false)
  const dragOffset = ref(0)
  const swipeActive = ref(false)
  const disabled = computed(() => Boolean(toValue(options.disabled)))
  const actionWidth = computed(() => toValue(options.actionWidth) ?? ROW_ACTION_WIDTH_PX)
  const openThreshold = computed(() => toValue(options.openThreshold) ?? ROW_OPEN_THRESHOLD_PX)
  const closeThreshold = computed(() => toValue(options.closeThreshold) ?? ROW_CLOSE_THRESHOLD_PX)
  const isOpen = computed(() => Boolean(toValue(options.open)))

  function syncOffset() {
    dragOffset.value = isOpen.value ? -actionWidth.value : 0
  }

  function open() {
    options.onOpen()
  }

  function close() {
    options.onClose()
  }

  watch([isOpen, actionWidth], syncOffset, { immediate: true })

  let swipe: ReturnType<typeof usePointerSwipe>
  swipe = usePointerSwipe(rootRef, {
    threshold: 12,
    pointerTypes: ['touch', 'pen'],
    disableTextSelect: true,
    onSwipeStart(event) {
      swipeActive.value = isTouchLike.value
        && !disabled.value
        && shouldStartHorizontalGesture(event, {
          allowGestureOwners: true,
          extraInteractiveSelectors: ['[data-swipe-reveal-action]'],
        })
      isDragging.value = swipeActive.value
    },
    onSwipe() {
      if (!swipeActive.value) return

      const deltaX = swipe.posEnd.x - swipe.posStart.x
      const nextOffset = isOpen.value
        ? clamp(-actionWidth.value + Math.max(deltaX, 0), -actionWidth.value, 0)
        : clamp(Math.min(deltaX, 0), -actionWidth.value, 0)

      dragOffset.value = nextOffset
    },
    onSwipeEnd() {
      if (!swipeActive.value) {
        isDragging.value = false
        syncOffset()
        return
      }

      const deltaX = swipe.posEnd.x - swipe.posStart.x

      if (isOpen.value) {
        if (deltaX >= closeThreshold.value) close()
        else open()
      } else if (Math.abs(deltaX) >= openThreshold.value && deltaX < 0) {
        open()
      } else {
        close()
      }

      swipeActive.value = false
      isDragging.value = false
    },
  })

  onClickOutside(rootRef, () => {
    if (!isOpen.value) return
    close()
  })

  const contentStyle = computed(() => ({
    transform: `translateX(${dragOffset.value}px)`,
  }))
  const actionsVisible = computed(() => isDragging.value || isOpen.value || dragOffset.value < 0)
  const actionsStyle = computed(() => ({
    opacity: actionsVisible.value ? '1' : '0',
    pointerEvents: actionsVisible.value ? 'auto' : 'none',
  }))

  return {
    rootRef,
    actionsStyle,
    contentStyle,
    isDragging: readonly(isDragging),
    close,
    open,
    syncOffset,
  }
}
