<script setup lang="ts">
import { api } from '#convex/api'
import { Search } from 'lucide-vue-next'

const coursesQuery = import.meta.client
  ? useConvexQuery(api.courses.listByUser, {})
  : { data: ref([]) }

const profileQuery = import.meta.client
  ? useConvexQuery(api.learnProfile.getProfile, {})
  : { data: ref(null) }

const courses = computed(() => coursesQuery.data?.value ?? [])
const profile = computed(() => profileQuery.data?.value ?? null)
const hasCourses = computed(() => courses.value.length > 0)

useTimezoneSync(profile)

const topicInput = ref('')

function handleTopicSubmit() {
  const topic = topicInput.value.trim()
  if (!topic) return
  navigateTo(`/app/learn/create?topic=${encodeURIComponent(topic)}`)
}
</script>

<template>
  <div class="min-h-screen bg-stone-950 px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-5xl">
      <div class="mb-8 flex items-center justify-between">
        <h1 class="text-2xl font-bold text-stone-100">Learn</h1>
        <LearnStreakDisplay
          v-if="profile"
          :streak-current="profile.streakCurrent"
          :streak-freeze-available="profile.streakFreezeAvailable"
          :streak-freeze-used-at="profile.streakFreezeUsedAt"
        />
      </div>

      <div v-if="!hasCourses" class="flex min-h-[60vh] items-center justify-center" data-testid="empty-state">
        <div class="w-full max-w-md text-center">
          <h2 class="mb-6 text-3xl font-bold text-stone-100">
            What do you want to learn?
          </h2>
          <form @submit.prevent="handleTopicSubmit" class="mb-4">
            <div class="relative">
              <Search class="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-500" />
              <input
                v-model="topicInput"
                type="text"
                placeholder="e.g. React hooks, Organic Chemistry..."
                class="w-full rounded-xl border border-stone-700 bg-stone-900 py-3.5 pl-12 pr-4 text-stone-100 placeholder-stone-500 transition-colors focus:border-amber-500 focus:outline-none"
                data-testid="topic-input"
              />
            </div>
          </form>
          <NuxtLink
            to="/app/learn/create"
            class="text-sm text-amber-500 hover:text-amber-400"
            data-testid="create-from-folders-link"
          >
            Create from your folders
          </NuxtLink>
        </div>
      </div>

      <div v-else data-testid="active-state">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LearnCourseCard
            v-for="course in courses"
            :key="course._id"
            :course="course"
          />
          <LearnCreateCourseCard />
        </div>
      </div>
    </div>
  </div>
</template>
