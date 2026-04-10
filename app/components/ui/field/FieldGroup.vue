<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="field-group"
    :class="cn(
      'group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-4 [&>[data-slot=field-group]]:gap-6',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
