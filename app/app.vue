<script setup lang="ts">
import { Sonner } from '@/components/ui/sonner'
import { useMediaQuery } from '@vueuse/core'
import { getAppThemeBootstrapScript } from '~/composables/useAppTheme'
import { useMobileKeyboardInset } from '~/composables/useMobileKeyboardInset'
import StickyMiniPlayer from '~/components/audio-overview/StickyMiniPlayer.vue'
import OfflineBanner from '~/components/learn/OfflineBanner.vue'

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

const isMobile = useMediaQuery('(max-width: 767px)')
const toastPosition = computed(() => isMobile.value ? 'bottom-center' as const : 'top-right' as const)

const pageTransition = {
  name: 'page-fade',
  mode: 'out-in' as const,
}

const globalAudioEl = ref<HTMLAudioElement | null>(null)
const globalPreloadEl = ref<HTMLAudioElement | null>(null)
const audioOverviewStore = useAudioOverviewStore()
watch(
  [globalAudioEl, globalPreloadEl],
  ([el, preloadEl]) => {
    if (el) audioOverviewStore.attachAudio(el, preloadEl)
  },
  { immediate: true },
)
</script>

<template>
  <MotionConfig reduced-motion="user">
    <ClientOnly>
      <OfflineBanner />
    </ClientOnly>
    <NuxtLayout>
      <NuxtPage :transition="pageTransition" />
    </NuxtLayout>
  <InstallAppPrompt />
  <Sonner rich-colors :position="toastPosition" />
  <ClientOnly>
    <audio ref="globalAudioEl" preload="metadata" class="hidden" />
    <audio ref="globalPreloadEl" preload="auto" class="hidden" />
    <StickyMiniPlayer />
  </ClientOnly>
  </MotionConfig>
</template>
