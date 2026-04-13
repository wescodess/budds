<script setup lang="ts">
import { computed } from 'vue'
import { FOLDER_COLORS, getColor, DEFAULT_COLOR_KEY } from '~~/convex/folderPalette'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selected = computed(() => getColor(props.modelValue || DEFAULT_COLOR_KEY))

function handleUpdate(value: string) {
  emit('update:modelValue', value)
}
</script>

<template>
  <UiSelect
    :model-value="props.modelValue"
    :disabled="props.disabled"
    @update:model-value="handleUpdate"
  >
    <UiSelectTrigger class="h-10 w-full justify-between" data-testid="folder-color-select">
      <span class="flex items-center gap-2">
        <span
          class="inline-block h-4 w-4 rounded-full border border-black/10"
          :style="{ backgroundColor: selected.hex }"
        />
        <span class="text-sm">{{ selected.name }}</span>
        <span class="text-xs text-muted-foreground">{{ selected.hex }}</span>
      </span>
    </UiSelectTrigger>
    <UiSelectContent>
      <UiSelectItem
        v-for="color in FOLDER_COLORS"
        :key="color.key"
        :value="color.key"
        :data-color-key="color.key"
      >
        <span class="flex items-center gap-2">
          <span
            class="inline-block h-4 w-4 rounded-full border border-black/10"
            :style="{ backgroundColor: color.hex }"
          />
          <span class="text-sm">{{ color.name }}</span>
          <span class="ml-auto text-xs text-muted-foreground">{{ color.hex }}</span>
        </span>
      </UiSelectItem>
    </UiSelectContent>
  </UiSelect>
</template>
