<script setup lang="ts">
import PublicAudioShell from '~/components/audio-overview/PublicAudioShell.vue'

definePageMeta({
  layout: false,
  auth: false,
})

const route = useRoute()
const token = computed(() => {
  const raw = route.params.token
  return typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw[0] ?? '') : ''
})

useHead({
  title: 'Shared audio overview · Budds',
  meta: [
    { name: 'description', content: 'Listen to a shared audio overview on Budds.' },
    { name: 'robots', content: 'noindex' },
  ],
})
</script>

<template>
  <div class="min-h-[var(--mobile-vh,100dvh)] bg-background text-foreground">
    <PublicAudioShell :token="token" />
  </div>
</template>
