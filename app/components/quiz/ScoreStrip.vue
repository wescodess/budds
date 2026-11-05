<script setup lang="ts">
import { QUIZ_RESULT_LABELS, QUIZ_STRIP_PAGE_SIZE, QUIZ_STRIP_TILE_LIMIT, quizResultCredit, quizResultState, type QuizGradedResult } from '~/utils/quiz-results'

const props = defineProps<{
  results: QuizGradedResult[]
  selectedIndex: number
  page: number
}>()

const emit = defineEmits<{
  select: [index: number]
  'update:page': [page: number]
}>()

const long = computed(() => props.results.length > QUIZ_STRIP_TILE_LIMIT)
const paged = computed(() => props.results.length > QUIZ_STRIP_PAGE_SIZE)
const firstIndex = computed(() => paged.value ? props.page * QUIZ_STRIP_PAGE_SIZE : 0)
const lastNumber = computed(() => Math.min(firstIndex.value + QUIZ_STRIP_PAGE_SIZE, props.results.length))

const cells = computed(() => props.results.slice(firstIndex.value, lastNumber.value).map((result, offset) => {
  const index = firstIndex.value + offset
  const state = quizResultState(result)
  return {
    index,
    state,
    fill: Math.round(quizResultCredit(result) * 100),
    showIcon: !long.value || state !== 'correct',
    label: `Question ${index + 1}, ${QUIZ_RESULT_LABELS[state].toLowerCase()}`,
  }
}))
</script>

<template>
  <div class="space-y-3" data-testid="quiz-score-strip">
    <div :class="long ? 'grid grid-cols-6 gap-1.5 sm:grid-cols-12' : 'flex gap-1.5'">
      <UiButton
        v-for="cell in cells"
        :key="cell.index"
        type="button"
        variant="outline"
        class="relative flex-1 gap-1 overflow-hidden px-0 text-xs hover:text-foreground has-[>svg]:px-0"
        :class="[
          cell.state === 'checking' && 'border-dashed text-muted-foreground',
          cell.state === 'your_call' && 'border-primary dark:border-primary',
          cell.index === selectedIndex && 'border-ring ring-[3px] ring-ring/50 dark:border-ring',
        ]"
        :aria-label="cell.label"
        :aria-current="cell.index === selectedIndex ? 'true' : undefined"
        data-testid="quiz-score-cell"
        @click="emit('select', cell.index)"
      >
        <span
          v-if="cell.fill > 0"
          class="absolute inset-y-0 left-0 bg-green-500/20"
          :style="{ width: `${cell.fill}%` }"
          data-testid="quiz-score-cell-fill"
        />
        <QuizResultIcon v-if="cell.showIcon" :state="cell.state" class="size-3" />
        {{ long ? cell.index + 1 : `Q${cell.index + 1}` }}
      </UiButton>
    </div>

    <UiPagination
      v-if="paged"
      :page="page + 1"
      :total="results.length"
      :items-per-page="QUIZ_STRIP_PAGE_SIZE"
      @update:page="emit('update:page', $event - 1)"
    >
      <UiPaginationContent as="ul">
        <li><UiPaginationPrevious /></li>
        <li class="px-2 text-xs font-medium text-muted-foreground">
          Questions {{ firstIndex + 1 }}–{{ lastNumber }} of {{ results.length }}
        </li>
        <li><UiPaginationNext /></li>
      </UiPaginationContent>
    </UiPagination>
  </div>
</template>
