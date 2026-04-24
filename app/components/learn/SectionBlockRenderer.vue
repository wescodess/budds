<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'

interface ContentBlock {
  type: 'text' | 'quiz' | 'flashcard' | 'audio'
  entityId?: string
  entityType?: string
  content?: string
  order: number
  quizData?: {
    questions: Array<{
      question: string
      type: string
      options?: string[]
      correctAnswer: string
      explanation?: string
      order: number
    }>
  }
  flashcardData?: {
    cards: Array<{
      term: string
      definition: string
    }>
  }
}

const props = defineProps<{
  contentBlocks: ContentBlock[]
  courseId: Id<'courses'>
  isOffline?: boolean
  sectionId?: string
}>()

const emit = defineEmits<{
  blockViewed: [index: number]
  quizCompleted: [data: { correct: number; total: number }]
}>()

const blockRefs = ref<HTMLElement[]>([])

function onBlockVisible(index: number) {
  emit('blockViewed', index)
}

onMounted(() => {
  if (!import.meta.client || !('IntersectionObserver' in window)) return

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const idx = Number(entry.target.getAttribute('data-block-index'))
          if (!isNaN(idx)) onBlockVisible(idx)
        }
      }
    },
    { threshold: 0.5 },
  )

  nextTick(() => {
    for (const el of blockRefs.value) {
      if (el) observer.observe(el)
    }
  })

  onUnmounted(() => observer.disconnect())
})
</script>

<template>
  <div class="space-y-6" role="list" aria-label="Section content blocks">
    <div
      v-for="(block, index) in contentBlocks"
      :key="block.order"
      :ref="(el) => { if (el) blockRefs[index] = el as HTMLElement }"
      :data-block-index="index"
      role="listitem"
      class="rounded-xl border border-stone-800 bg-stone-900"
    >
      <LearnTextBlock
        v-if="block.type === 'text'"
        :content="block.content ?? ''"
      />

      <LearnQuizBlock
        v-else-if="block.type === 'quiz' && (block.entityId || (isOffline && block.quizData))"
        :quiz-id="block.entityId ?? ''"
        :offline-data="isOffline ? block.quizData : undefined"
        :is-offline="isOffline ?? false"
        :section-id="sectionId"
        :course-id="courseId"
        @quiz-completed="emit('quizCompleted', $event)"
      />

      <LearnFlashcardBlock
        v-else-if="block.type === 'flashcard' && (block.entityId || (isOffline && block.flashcardData))"
        :room-id="block.entityId ?? ''"
        :offline-data="isOffline ? block.flashcardData : undefined"
        :is-offline="isOffline ?? false"
        :section-id="sectionId"
        :course-id="courseId"
      />

      <LearnAudioBlock
        v-else-if="block.type === 'audio'"
        :entity-id="block.entityId"
      />
    </div>

    <div
      v-if="contentBlocks.length === 0"
      class="rounded-xl border border-dashed border-stone-800 bg-stone-900/50 p-12 text-center"
    >
      <p class="text-sm text-stone-400">No content blocks available for this section.</p>
    </div>
  </div>
</template>
