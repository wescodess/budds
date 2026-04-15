<script setup lang="ts">
import * as lucide from 'lucide-vue-next'
import { computed } from 'vue'
import { getColor, DEFAULT_COLOR_KEY } from '~~/convex/folderPalette'
import { DEFAULT_ICON_KEY } from '~~/convex/folderIcons'

const props = withDefaults(
  defineProps<{
    color?: string | null
    icon?: string | null
    size?: 'sm' | 'md'
  }>(),
  { color: DEFAULT_COLOR_KEY, icon: DEFAULT_ICON_KEY, size: 'md' },
)

function toPascalCase(input: string): string {
  return input
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

const colorEntry = computed(() => getColor(props.color || DEFAULT_COLOR_KEY))

const IconComponent = computed(() => {
  const key = props.icon || DEFAULT_ICON_KEY
  const name = toPascalCase(key)
  const registry = lucide as Record<string, unknown>
  return (registry[name] ?? registry.Folder) as unknown
})

const dims = computed(() => {
  return props.size === 'sm'
    ? { tile: 20, icon: 12 }
    : { tile: 28, icon: 16 }
})

const tileStyle = computed(() => ({
  width: `${dims.value.tile}px`,
  height: `${dims.value.tile}px`,
}))

const iconStyle = computed(() => ({
  width: `${dims.value.icon}px`,
  height: `${dims.value.icon}px`,
  color: colorEntry.value.hex,
}))
</script>

<template>
  <div
    class="relative inline-flex shrink-0 items-center justify-center rounded-[10px] overflow-hidden"
    :style="tileStyle"
    :data-folder-color="colorEntry.key"
    :data-folder-icon="icon || DEFAULT_ICON_KEY"
  >
    <div class="absolute inset-0 opacity-[0.15]" :style="{ backgroundColor: colorEntry.hex }" />
    <component :is="IconComponent" :style="iconStyle" class="relative z-10" aria-hidden="true" />
  </div>
</template>
