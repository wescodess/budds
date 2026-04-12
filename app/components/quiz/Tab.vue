<script setup lang="ts">
import { ClipboardList, Plus, ChevronDown } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  folderId: Id<'folders'>
}>()

const {
  quizzes,
  hasIndexedDocuments,
  generating,
  lastError,
  generate,
} = useQuizzes(toRef(props, 'folderId'))

const expandedQuizPreview = ref<string | null>(null)

async function handleGenerate() {
  try {
    await generate()
    const { toast } = await import('vue-sonner')
    toast.success('Quiz generated')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(lastError.value || e?.message || 'Failed to generate quiz')
  }
}

function togglePreview(id: string) {
  expandedQuizPreview.value = expandedQuizPreview.value === id ? null : id
}

function handleCardSelect(_quizId: string) {
  // TODO(story 6.2): navigate to take-quiz view
}
</script>

<template>
  <div data-testid="quiz-tab-content">
    <template v-if="!hasIndexedDocuments">
      <div
        data-testid="quiz-empty-no-docs"
        class="flex flex-1 items-center justify-center py-12 text-muted-foreground"
      >
        <div class="text-center">
          <ClipboardList class="mx-auto mb-3 h-12 w-12 opacity-40" />
          <p class="text-lg font-medium">Upload and index documents to generate quizzes</p>
        </div>
      </div>
    </template>

    <template v-else-if="generating">
      <div data-testid="quiz-shimmer" class="space-y-3">
        <UiSkeleton v-for="i in 3" :key="i" class="h-30 w-full rounded-md" />
      </div>
    </template>

    <template v-else-if="quizzes.length === 0">
      <div
        data-testid="quiz-empty-ready"
        class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-muted-foreground"
      >
        <ClipboardList class="h-12 w-12 opacity-40" />
        <p class="text-lg font-medium">No quizzes yet</p>
        <UiButton data-testid="quiz-generate-button" @click="handleGenerate">
          <Plus class="mr-1.5 h-4 w-4" />
          Generate Quiz
        </UiButton>
      </div>
    </template>

    <template v-else>
      <div class="space-y-3">
        <div class="flex items-center justify-end">
          <UiButton data-testid="quiz-generate-button" size="sm" @click="handleGenerate">
            <Plus class="mr-1.5 h-4 w-4" />
            Generate Quiz
          </UiButton>
        </div>
        <div
          v-for="quiz in quizzes"
          :key="quiz._id"
          class="rounded-md border"
          data-testid="quiz-card"
        >
          <div
            role="button"
            tabindex="0"
            class="flex cursor-pointer items-center justify-between p-4 hover:bg-accent/50"
            @click="handleCardSelect(quiz._id)"
            @keydown.enter="handleCardSelect(quiz._id)"
            @keydown.space.prevent="handleCardSelect(quiz._id)"
          >
            <div class="flex flex-col gap-1">
              <p class="font-medium">{{ quiz.title }}</p>
              <p class="text-xs text-muted-foreground">
                {{ new Date(quiz._creationTime).toLocaleDateString() }}
                &middot;
                {{ quiz.questionCount }} questions
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span
                v-if="quiz.score !== undefined"
                class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                data-testid="quiz-score-badge"
              >
                {{ quiz.score }}%
              </span>
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="quiz-preview-toggle"
                @click.stop="togglePreview(quiz._id)"
              >
                Preview questions
                <ChevronDown
                  class="h-3 w-3 transition-transform"
                  :class="{ 'rotate-180': expandedQuizPreview === quiz._id }"
                />
              </button>
            </div>
          </div>
          <QuizCardPreview
            v-if="expandedQuizPreview === quiz._id"
            :quiz-id="quiz._id"
          />
        </div>
      </div>
    </template>
  </div>
</template>
