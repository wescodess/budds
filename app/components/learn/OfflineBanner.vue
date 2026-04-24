<script setup lang="ts">
import { WifiOff } from 'lucide-vue-next'
import { useOnlineStatus } from '~/composables/useOnlineStatus'

const { isOnline } = useOnlineStatus()
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 -translate-y-full"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-500 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-full"
  >
    <div
      v-if="!isOnline"
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
      class="flex items-center justify-center gap-2 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-200"
    >
      <WifiOff class="h-4 w-4 shrink-0" />
      <span>You're offline. Completed sections are available.</span>
    </div>
  </Transition>
</template>
