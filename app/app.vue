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
    { name: 'theme-color', content: '#1c1917' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-title', content: 'Budds' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
  ],
  link: [
    { rel: 'manifest', href: '/manifest.webmanifest' },
    { rel: 'icon', type: 'image/svg+xml', href: '/icons/icon.svg' },
    { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
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
  <InstallAppPrompt />
  <Sonner rich-colors position="top-right" />
</template>
