<script setup lang="ts">
import { MessageSquare, ChevronRight } from 'lucide-vue-next'
</script>

<template>
  <NuxtLink
    to="/chat"
    data-testid="dashboard-chat-hero"
    class="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <span class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary overflow-hidden">
      <span class="absolute inset-0 bg-primary opacity-10" />
      <MessageSquare class="relative z-10 h-5 w-5" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-dm-sans text-base font-semibold text-foreground">Chat with AI</p>
      <p class="mt-0.5 text-sm text-muted-foreground">
        Ask anything — general study help, no course needed.
      </p>
    </div>
    <ChevronRight class="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
  </NuxtLink>
</template>
