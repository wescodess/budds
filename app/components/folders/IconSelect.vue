<script setup lang="ts">
import * as lucide from '@lucide/vue'
import { ChevronDown, Search } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { FOLDER_ICON_GROUPS, DEFAULT_ICON_KEY } from '~~/convex/folderIcons'
import { useGestureGuards } from '~/composables/useGestureGuards'

const props = withDefaults(
  defineProps<{
    modelValue: string
    colorHex: string
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const search = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const { isTouchLike } = useGestureGuards()

watch(open, (v) => {
  if (!v) search.value = ''
})

watch(open, (next) => {
  if (!next || isTouchLike.value) return
  nextTick(() => searchInputRef.value?.focus())
})

function toPascalCase(input: string): string {
  return input
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function resolveIcon(key: string) {
  const registry = lucide as Record<string, unknown>
  return (registry[toPascalCase(key)] ?? registry.Folder) as unknown
}

const selectedIconKey = computed(() => props.modelValue || DEFAULT_ICON_KEY)
const SelectedIcon = computed(() => resolveIcon(selectedIconKey.value))

const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return FOLDER_ICON_GROUPS
  return FOLDER_ICON_GROUPS.map((g) => ({
    ...g,
    icons: g.icons.filter((k) => k.toLowerCase().includes(q)),
  })).filter((g) => g.icons.length > 0)
})

const triggerStyle = computed(() => ({
  backgroundColor: `${props.colorHex}26`,
}))

const iconTintStyle = computed(() => ({ color: props.colorHex }))

function selectIcon(key: string) {
  emit('update:modelValue', key)
  open.value = false
  search.value = ''
}
</script>

<template>
  <template v-if="isTouchLike">
    <UiDrawer v-model:open="open">
      <UiDrawerTrigger as-child>
        <button
          type="button"
          :disabled="props.disabled"
          data-testid="folder-icon-select"
          class="flex h-10 w-full items-center justify-between gap-2 rounded-xl border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span class="flex min-w-0 items-center gap-2 overflow-hidden">
            <span
              class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px]"
              :style="triggerStyle"
            >
              <component :is="SelectedIcon" :style="iconTintStyle" class="h-4 w-4" />
            </span>
            <span class="truncate capitalize">{{ selectedIconKey.replace(/-/g, ' ') }}</span>
          </span>
          <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </UiDrawerTrigger>
      <UiDrawerContent data-testid="folder-icon-drawer" class="gap-0 p-0">
        <div class="flex items-center gap-2 border-b px-4 py-3">
          <Search class="h-4 w-4 text-muted-foreground" />
          <input
            ref="searchInputRef"
            v-model="search"
            data-testid="folder-icon-search"
            type="search"
            inputmode="search"
            enterkeyhint="search"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            autocomplete="off"
            placeholder="Search icons"
            class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          >
        </div>
        <div class="keyboard-scroll-area max-h-[calc(var(--mobile-vh,100dvh)-10rem)] overflow-y-auto p-4">
          <div v-if="filteredGroups.length === 0" class="py-6 text-center text-sm text-muted-foreground">
            No icons match "{{ search }}"
          </div>
          <div
            v-for="group in filteredGroups"
            :key="group.key"
            class="mb-3 last:mb-0"
          >
            <div class="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {{ group.label }}
            </div>
            <div class="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
              <button
                v-for="iconKey in group.icons"
                :key="iconKey"
                type="button"
                :data-icon-key="iconKey"
                :aria-label="iconKey"
                class="flex h-9 w-9 items-center justify-center rounded-[10px] transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring"
                :class="{ 'ring-2 ring-ring': iconKey === selectedIconKey }"
                :style="triggerStyle"
                @click="selectIcon(iconKey)"
              >
                <component :is="resolveIcon(iconKey)" :style="iconTintStyle" class="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </UiDrawerContent>
    </UiDrawer>
  </template>

  <UiPopover v-else v-model:open="open">
    <UiPopoverTrigger as-child>
      <button
        type="button"
        :disabled="props.disabled"
        data-testid="folder-icon-select"
        class="flex h-10 w-full items-center justify-between gap-2 rounded-xl border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
      >
        <span class="flex min-w-0 items-center gap-2 overflow-hidden">
          <span
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px]"
            :style="triggerStyle"
          >
            <component :is="SelectedIcon" :style="iconTintStyle" class="h-4 w-4" />
          </span>
          <span class="truncate capitalize">{{ selectedIconKey.replace(/-/g, ' ') }}</span>
        </span>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
      </button>
    </UiPopoverTrigger>
    <UiPopoverContent class="w-[min(20rem,calc(100vw-1.5rem))] p-0" align="start">
      <div class="flex items-center gap-2 border-b px-3 py-2">
        <Search class="h-4 w-4 text-muted-foreground" />
        <input
          ref="searchInputRef"
          v-model="search"
          data-testid="folder-icon-search"
          type="search"
          inputmode="search"
          enterkeyhint="search"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          autocomplete="off"
          placeholder="Search icons"
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        >
      </div>
      <div class="max-h-72 overflow-y-auto p-3">
        <div v-if="filteredGroups.length === 0" class="py-6 text-center text-sm text-muted-foreground">
          No icons match "{{ search }}"
        </div>
        <div
          v-for="group in filteredGroups"
          :key="group.key"
          class="mb-3 last:mb-0"
        >
          <div class="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {{ group.label }}
          </div>
          <div class="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
            <button
              v-for="iconKey in group.icons"
              :key="iconKey"
              type="button"
              :data-icon-key="iconKey"
              :aria-label="iconKey"
              class="flex h-9 w-9 items-center justify-center rounded-[10px] transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring"
              :class="{ 'ring-2 ring-ring': iconKey === selectedIconKey }"
              :style="triggerStyle"
              @click="selectIcon(iconKey)"
            >
              <component :is="resolveIcon(iconKey)" :style="iconTintStyle" class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </UiPopoverContent>
  </UiPopover>
</template>
