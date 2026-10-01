<script setup lang="ts">
import { injectFolderContext } from '~/composables/useFolderPageContext'
import { api } from '#convex/api'

const route = useRoute()
const ctx = injectFolderContext()
const { folderId, helperPane } = ctx

const quizId = computed(() => (route.params.quizId as string) ?? null)
const projectionQuery = import.meta.client
  ? useConvexQuery(api.quizzes.getAcceptedAttemptProjection, computed(() => ({ quizId: quizId.value as never })))
  : { data: ref(null), pending: ref(true) }
const userQuery = import.meta.client ? useConvexQuery(api.users.getUser, {}) : { data: ref(null) }
const projection = computed(() => {
  const value = projectionQuery.data.value
  return value && value.quizId === quizId.value && value.folderId === folderId.value
    && value.ownerId === userQuery.data.value?._id ? value : null
})

function onGenerationStarted() {
  helperPane.open('tasks')
}
</script>

<template>
  <QuizAcceptedAttempt
v-if="projection && userQuery.data.value" :key="`${userQuery.data.value._id}:${quizId}`"
    :projection="projection" :owner-id="userQuery.data.value._id" />
  <p v-else-if="projectionQuery.pending.value || projectionQuery.data.value" role="status" aria-live="polite" class="p-5">Loading your Quiz result…</p>
  <QuizTab
v-else
    :folder-id="folderId"
    :selected-quiz-id="quizId"
    @generation-started="onGenerationStarted"
  />
</template>
