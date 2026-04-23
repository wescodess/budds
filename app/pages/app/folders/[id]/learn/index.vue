<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'

const route = useRoute()
const folderId = computed(() => route.params.id as Id<'folders'>)

const coursesQuery = import.meta.client
  ? useConvexQuery(api.courses.listByFolder, computed(() => ({ folderId: folderId.value })))
  : { data: ref([]) }

const courses = computed(() => coursesQuery.data?.value ?? [])
const hasCourses = computed(() => courses.value.length > 0)
</script>

<template>
  <div class="min-h-full bg-background px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-5xl">
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-foreground">Learn</h1>
        <p class="mt-1 text-sm text-muted-foreground">Courses in this folder</p>
      </div>

      <div v-if="!hasCourses" class="flex min-h-[40vh] items-center justify-center" data-testid="folder-learn-empty">
        <div class="text-center">
          <p class="mb-4 text-lg text-muted-foreground">No courses in this folder yet.</p>
          <NuxtLink
            :to="`/app/learn/create?folderId=${folderId}`"
            class="text-sm text-primary hover:text-primary/80"
            data-testid="folder-learn-create-link"
          >
            Create a course from this folder
          </NuxtLink>
        </div>
      </div>

      <div v-else data-testid="folder-learn-grid">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LearnCourseCard
            v-for="course in courses"
            :key="course._id"
            :course="course"
            :folder-id="folderId"
          />
          <LearnCreateCourseCard :folder-id="folderId" />
        </div>
      </div>
    </div>
  </div>
</template>
