<script setup lang="ts">
const route = useRoute()
const folderId = computed(() => {
  const q = route.query.folderId
  if (!q || Array.isArray(q)) return undefined
  return q
})
</script>

<template>
  <div class="min-h-screen bg-stone-950">
    <LearnCourseCreator :initial-folder-id="folderId" />
  </div>
</template>
