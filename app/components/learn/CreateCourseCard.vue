<script setup lang="ts">
</script>

<template>
  <NuxtLink
    to="/app/learn/create"
    class="flex min-h-[140px] items-center justify-center rounded-xl border-2 border-dashed border-stone-700 bg-stone-900/50 p-5 transition-colors hover:border-stone-600 hover:bg-stone-900"
    data-testid="create-course-card"
  >
    <div class="text-center">
      <div class="mb-1 text-2xl text-stone-500">+</div>
      <span class="text-sm font-medium text-stone-400">Create Course</span>
    </div>
  </NuxtLink>
</template>
