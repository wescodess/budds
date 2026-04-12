<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { MODELS, getModelLabel } from '~/constants/models'

const props = defineProps<{
  modelValue: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const currentLabel = computed(() => getModelLabel(props.modelValue))
</script>

<template>
  <UiDropdownMenu>
    <UiDropdownMenuTrigger as-child>
      <button
        :disabled="disabled"
        class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {{ currentLabel }}
      </button>
    </UiDropdownMenuTrigger>
    <UiDropdownMenuContent align="start" class="w-56">
      <UiDropdownMenuItem
        v-for="model in MODELS"
        :key="model.value"
        class="flex items-center justify-between"
        @select="emit('update:modelValue', model.value)"
      >
        <span>
          {{ model.label }}
          <span v-if="model.recommended" class="text-muted-foreground"> (recommended)</span>
        </span>
        <Check v-if="model.value === modelValue" class="h-4 w-4 shrink-0" />
      </UiDropdownMenuItem>
    </UiDropdownMenuContent>
  </UiDropdownMenu>
</template>
