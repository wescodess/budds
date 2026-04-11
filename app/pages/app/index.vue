<script setup lang="ts">
import { FolderOpen } from 'lucide-vue-next'

const { folders, isLoading, createFolder, isCreating } = useFolders()

const hydrated = ref(false)
onMounted(() => { hydrated.value = true })

const showLoading = computed(() => !hydrated.value || isLoading.value)
</script>

<template>
  <div class="flex-1 overflow-auto p-6">
    <h1 class="mb-6 font-dm-sans text-2xl font-bold text-foreground">Your Courses</h1>

    <div v-if="showLoading" class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      <UiSkeleton v-for="i in 3" :key="i" data-testid="skeleton-card" class="h-[140px] rounded-xl" />
    </div>

    <div v-else-if="!folders?.length" data-testid="dashboard-empty-state" class="flex flex-col items-center justify-center py-20">
      <FolderOpen data-testid="empty-state-icon" class="mb-4 h-16 w-16 text-muted-foreground opacity-40" />
      <h2 class="mb-4 font-dm-sans text-lg font-semibold text-foreground">
        Start by creating a course folder
      </h2>
      <DashboardAddCourseCard :create-folder="createFolder" :is-creating="isCreating" inline />
    </div>

    <div v-else data-testid="courses-grid" class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      <DashboardCourseCard
        v-for="folder in folders"
        :key="folder._id"
        :folder="folder"
      />
      <DashboardAddCourseCard :create-folder="createFolder" :is-creating="isCreating" />
    </div>
  </div>
</template>
