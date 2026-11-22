<script setup lang="ts">
import { useTeachingQuery } from '~/composables/useTeachingQuery'

import { CircleAlert } from '@lucide/vue'
import { api } from '#convex/api'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const ctx = injectFolderContext()
const { folderId } = ctx

const coursesQuery = import.meta.client
  ? useTeachingQuery(api.courses.listByFolder, computed(() => ({ folderId: folderId.value })))
  : { data: ref([]), failure: computed(() => null), refresh: async () => {} }

const backlogQuery = import.meta.client
  ? useConvexQuery(api.reviewItems.getReviewBacklogCount, {})
  : { data: ref(null) }

const courses = computed(() => coursesQuery.data?.value ?? [])
const hasCourses = computed(() => courses.value.length > 0)
const coursesFailure = computed(() => coursesQuery.failure.value)

const backlog = computed(() => backlogQuery.data?.value as { dueCount: number; dailyCap: number } | null)
const showReviewCTA = computed(() => backlog.value && backlog.value.dueCount > 0)

function goToCreate() {
  navigateTo(`/app/folders/${folderId.value}/learn/create`)
}
</script>

<template>
  <div class="min-h-full w-full bg-background px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-5xl">
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-foreground">Learn</h1>
        <p class="mt-1 text-sm text-muted-foreground">Courses in this folder</p>
      </div>

      <LearnDailyReviewCTA
        v-if="showReviewCTA"
        :due-count="backlog!.dueCount"
        :daily-cap="backlog!.dailyCap"
        class="mb-6"
      />

      <template v-if="coursesFailure">
        <p v-if="!coursesFailure.retryable" role="status" data-testid="folder-learn-read-paused" class="flex items-start gap-2 rounded-lg border border-border px-4 py-3 text-sm leading-6 text-foreground"><CircleAlert class="mt-1 size-4 shrink-0 text-[var(--learn-attention)]" aria-hidden="true" /><span class="min-w-0">{{ coursesFailure.message }}</span></p>
        <div v-else role="alert" data-testid="folder-learn-read-error" class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive"><p>Could not load courses.</p><button type="button" data-testid="folder-learn-read-retry" class="mt-2 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="coursesQuery.refresh?.()">Try again</button></div>
      </template>

      <div v-else-if="!hasCourses" class="flex min-h-[40vh] items-center justify-center" data-testid="folder-learn-empty">
        <div class="text-center">
          <p class="mb-4 text-lg text-muted-foreground">No courses in this folder yet.</p>
          <button
            type="button"
            class="text-sm text-primary hover:text-primary/80"
            data-testid="folder-learn-create-link"
            @click="goToCreate"
          >
            Create a course from this folder
          </button>
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
          <LearnCreateCourseCard @create="goToCreate" />
        </div>
      </div>
    </div>
  </div>
</template>
