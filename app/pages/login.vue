<script setup lang="ts">
definePageMeta({ layout: false })

const socialSignIn = useSignIn('social')
const { springGentle } = useMotionPresets()
const loginPending = computed(() => socialSignIn.status.value === 'pending')
const loginError = computed(() => socialSignIn.error.value?.message ?? '')

type GoogleSocialSignIn = (options: {
  provider: 'google'
  callbackURL: string
}) => Promise<void>

async function loginWithGoogle() {
  await (socialSignIn.execute as GoogleSocialSignIn)({ provider: 'google', callbackURL: '/app' })
}
</script>

<template>
  <div class="flex min-h-[var(--mobile-vh,100dvh)] items-center justify-center px-4 pb-[env(safe-area-inset-bottom)]">
    <div class="w-full max-w-sm space-y-6 p-4 sm:p-8">
      <Motion
        :initial="{ opacity: 0, y: 12 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="springGentle"
        as="h1"
        class="text-center text-2xl font-bold"
      >
        Sign in
      </Motion>
      <Motion
        :initial="{ opacity: 0, y: 12 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ ...springGentle, delay: 0.08 }"
        as="button"
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 font-medium transition-colors hover:bg-accent/10"
        :disabled="loginPending"
        :aria-busy="loginPending"
        @click="loginWithGoogle"
      >
        {{ loginPending ? 'Connecting…' : 'Continue with Google' }}
      </Motion>
      <p v-if="loginError" role="alert" class="text-center text-sm text-destructive">
        {{ loginError }}
      </p>
      <Motion
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :transition="{ duration: 0.3, delay: 0.18 }"
        class="flex items-center justify-center gap-4 text-xs text-muted-foreground"
      >
        <NuxtLink to="/terms" class="hover:text-foreground">Terms of Service</NuxtLink>
        <span aria-hidden="true">·</span>
        <NuxtLink to="/privacy" class="hover:text-foreground">Privacy Policy</NuxtLink>
      </Motion>
    </div>
  </div>
</template>
