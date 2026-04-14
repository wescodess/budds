<script setup lang="ts">
import { Sonner } from '@/components/ui/sonner'
import { getAppThemeBootstrapScript } from '~/composables/useAppTheme'

useHead({
  meta: [
    { name: 'color-scheme', content: 'dark light' },
  ],
  script: [
    {
      key: 'theme-bootstrap',
      innerHTML: getAppThemeBootstrapScript(),
    },
  ],
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Sonner rich-colors position="top-right" />
</template>
