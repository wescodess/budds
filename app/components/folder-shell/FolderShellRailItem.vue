<script setup lang="ts">
import { onLongPress, useMediaQuery } from '@vueuse/core'
import type { FunctionalComponent } from 'vue'
import { LONG_PRESS_MOVE_PX, LONG_PRESS_MS } from '~/composables/useGestureGuards'

defineOptions({
  name: 'FolderShellRailItem',
  inheritAttrs: false,
})

const props = defineProps<{
  label: string
  icon: FunctionalComponent
  active?: boolean
  compact?: boolean
  count?: number | null
}>()

const attrs = useAttrs()
const slots = useSlots()
const isTouchDevice = useMediaQuery('(hover: none), (pointer: coarse)')
const popoverOpen = ref(false)
const usesCompactHint = computed(() => Boolean(props.compact))
const hasCompactTouchContent = computed(() => Boolean(slots['compact-touch-content']))
const buttonRef = ref<HTMLElement | null>(null)

const suppressNextClick = ref(false)

function handleMobileClick(event: MouseEvent) {
  if (suppressNextClick.value) {
    suppressNextClick.value = false
    event.preventDefault()
    event.stopPropagation()
    return
  }

  popoverOpen.value = false
}

function closeCompactTouchContent() {
  popoverOpen.value = false
}

onBeforeUnmount(() => {
  longPressStop()
})

const longPressStop = onLongPress(
  buttonRef,
  (event) => {
    if (!usesCompactHint.value || !isTouchDevice.value || event.pointerType === 'mouse') return
    suppressNextClick.value = true
    popoverOpen.value = true
  },
  {
    delay: LONG_PRESS_MS,
    distanceThreshold: LONG_PRESS_MOVE_PX,
    onMouseUp(_duration, _distance, isLongPress) {
      suppressNextClick.value = isLongPress
    },
  },
)
</script>

<template>
  <UiTooltip v-if="usesCompactHint && !isTouchDevice">
    <UiTooltipTrigger as-child>
      <button
        type="button"
        :class="[
          'group relative flex w-full overflow-hidden items-center rounded-md py-1.5 text-sm transition-[color,padding,gap] duration-200 ease-out',
          active
            ? 'text-primary'
            : 'text-muted-foreground hover:text-foreground',
          compact ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2',
        ]"
        :data-active="active ? 'true' : 'false'"
        :data-testid="`rail-item-${label.toLowerCase()}`"
        :aria-label="label"
        v-bind="attrs"
      >
        <span
          :class="[
            'absolute inset-0 transition-opacity duration-200 ease-out',
            active ? 'bg-primary/8' : 'bg-muted opacity-0 group-hover:opacity-[0.6]',
          ]"
        />
        <span
          v-if="active"
          class="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-0.5 rounded-r bg-primary z-10"
        />
        <component :is="icon" class="relative z-10 h-4 w-4 shrink-0" />
        <span
          :class="[
            'relative z-10 min-w-0 overflow-hidden whitespace-nowrap text-left transition-[max-width,opacity,transform] duration-200 ease-out',
            compact ? 'max-w-0 flex-none translate-x-1 opacity-0' : 'max-w-[11rem] flex-1 translate-x-0 opacity-100',
          ]"
        >
          {{ label }}
        </span>
        <span
          v-if="count !== undefined && count !== null"
          :class="[
            'relative z-10 shrink-0 overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground transition-[max-width,opacity,transform,padding] duration-200 ease-out',
            compact ? 'max-w-0 translate-x-1 px-0 py-0 opacity-0' : 'max-w-12 translate-x-0 px-1.5 py-px opacity-100',
          ]"
        >
          {{ count }}
        </span>
      </button>
    </UiTooltipTrigger>
    <UiTooltipContent side="right">
      {{ label }}
    </UiTooltipContent>
  </UiTooltip>

  <UiPopover v-else-if="usesCompactHint" v-model:open="popoverOpen">
    <UiPopoverTrigger as-child>
      <button
        ref="buttonRef"
        type="button"
        :class="[
          'group relative flex w-full overflow-hidden items-center rounded-md py-1.5 text-sm transition-[color,padding,gap] duration-200 ease-out',
          active
            ? 'text-primary'
            : 'text-muted-foreground hover:text-foreground',
          compact ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2',
        ]"
        :data-active="active ? 'true' : 'false'"
        :data-testid="`rail-item-${label.toLowerCase()}`"
        :aria-label="label"
        v-bind="attrs"
        @contextmenu.prevent
        @click="handleMobileClick"
      >
        <span
          :class="[
            'absolute inset-0 transition-opacity duration-200 ease-out',
            active ? 'bg-primary/8' : 'bg-muted opacity-0 group-hover:opacity-[0.6]',
          ]"
        />
        <span
          v-if="active"
          class="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-0.5 rounded-r bg-primary z-10"
        />
        <component :is="icon" class="relative z-10 h-4 w-4 shrink-0" />
        <span
          :class="[
            'relative z-10 min-w-0 overflow-hidden whitespace-nowrap text-left transition-[max-width,opacity,transform] duration-200 ease-out',
            compact ? 'max-w-0 flex-none translate-x-1 opacity-0' : 'max-w-[11rem] flex-1 translate-x-0 opacity-100',
          ]"
        >
          {{ label }}
        </span>
        <span
          v-if="count !== undefined && count !== null"
          :class="[
            'relative z-10 shrink-0 overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground transition-[max-width,opacity,transform,padding] duration-200 ease-out',
            compact ? 'max-w-0 translate-x-1 px-0 py-0 opacity-0' : 'max-w-12 translate-x-0 px-1.5 py-px opacity-100',
          ]"
        >
          {{ count }}
        </span>
      </button>
    </UiPopoverTrigger>
    <UiPopoverContent
      side="right"
      align="center"
      :class="[
        'rounded-xl',
        hasCompactTouchContent
          ? 'w-[min(14rem,calc(100vw-2rem))] p-1.5'
          : 'w-auto max-w-[min(14rem,calc(100vw-2rem))] px-3 py-2 text-sm font-medium',
      ]"
    >
      <slot
        v-if="hasCompactTouchContent"
        name="compact-touch-content"
        :close="closeCompactTouchContent"
      />
      <template v-else>
        {{ label }}
      </template>
    </UiPopoverContent>
  </UiPopover>

  <button
    v-else
    type="button"
    :class="[
      'group relative flex w-full overflow-hidden items-center rounded-md py-1.5 text-sm transition-[color,padding,gap] duration-200 ease-out',
      active
        ? 'text-primary'
        : 'text-muted-foreground hover:text-foreground',
      compact ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2',
    ]"
    :data-active="active ? 'true' : 'false'"
    :data-testid="`rail-item-${label.toLowerCase()}`"
    :aria-label="compact ? label : undefined"
    v-bind="attrs"
  >
    <span
      :class="[
        'absolute inset-0 transition-opacity duration-200 ease-out',
        active ? 'bg-primary/8' : 'bg-muted opacity-0 group-hover:opacity-[0.6]',
      ]"
    />
    <span
      v-if="active"
      class="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-0.5 rounded-r bg-primary z-10"
    />
    <component :is="icon" class="relative z-10 h-4 w-4 shrink-0" />
    <span
      :class="[
        'relative z-10 min-w-0 overflow-hidden whitespace-nowrap text-left transition-[max-width,opacity,transform] duration-200 ease-out',
        compact ? 'max-w-0 flex-none translate-x-1 opacity-0' : 'max-w-[11rem] flex-1 translate-x-0 opacity-100',
      ]"
    >
      {{ label }}
    </span>
    <span
      v-if="count !== undefined && count !== null"
      :class="[
        'relative z-10 shrink-0 overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground transition-[max-width,opacity,transform,padding] duration-200 ease-out',
        compact ? 'max-w-0 translate-x-1 px-0 py-0 opacity-0' : 'max-w-12 translate-x-0 px-1.5 py-px opacity-100',
      ]"
    >
      {{ count }}
    </span>
  </button>
</template>
