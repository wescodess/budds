<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'

const route = useRoute()
const courseId = computed(() => route.params.courseId as Id<'courses'>)

const courseQuery = import.meta.client
  ? useConvexQuery(api.courses.get, computed(() => ({ id: courseId.value })))
  : { data: ref(null) }

const course = computed(() => courseQuery.data?.value ?? null)
</script>

<template>
  <div class="flex min-h-full flex-col items-center justify-center bg-background px-4">
    <div class="w-full max-w-lg text-center">
      <h1 class="mb-2 text-2xl font-bold text-foreground">
        {{ course?.title ?? 'Loading...' }}
      </h1>
      <p class="mb-6 text-sm text-muted-foreground">Course view coming soon</p>
      <NuxtLink
        :to="`/app/folders/${route.params.id}/learn/`"
        class="text-sm text-primary hover:text-primary/80"
      >
        &larr; Back to folder courses
      </NuxtLink>
    </div>
  </div>
</template>
