<script setup lang="ts">
definePageMeta({ layout: false, auth: 'guest' })

const { signIn } = useUserSession()

async function loginWithGoogle() {
  await signIn.social({ provider: 'google', callbackURL: '/app' })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center">
    <div class="w-full max-w-sm space-y-6 p-8">
      <h1 class="text-center text-2xl font-bold">Sign in</h1>
      <button
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 font-medium transition-colors hover:bg-gray-50"
        @click="loginWithGoogle"
      >
        Continue with Google
      </button>
    </div>
  </div>
</template>
