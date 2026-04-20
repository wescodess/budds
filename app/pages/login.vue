<script setup lang="ts">
definePageMeta({ layout: false, auth: 'guest' })

const { signIn } = useUserSession()
const { springGentle } = useMotionPresets()

async function loginWithGoogle() {
  await signIn.social({ provider: 'google', callbackURL: '/app' })
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
        @click="loginWithGoogle"
      >
        Continue with Google
      </Motion>
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
