<script setup lang="ts">
import { Sonner } from '@/components/ui/sonner'
import { getAppThemeBootstrapScript } from '~/composables/useAppTheme'
import { useMobileKeyboardInset } from '~/composables/useMobileKeyboardInset'

useHead({
  meta: [
    {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
    },
    { name: 'color-scheme', content: 'dark light' },
  ],
  script: [
    {
      key: 'theme-bootstrap',
      innerHTML: getAppThemeBootstrapScript(),
    },
  ],
})

useMobileKeyboardInset()
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Sonner rich-colors position="top-right" />
</template>
