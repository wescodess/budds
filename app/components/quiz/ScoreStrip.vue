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
const strip = useTemplateRef<HTMLElement>('strip')

async function changePage(page: number) {
  const focused = document.activeElement
  const hadFocus = strip.value?.contains(focused)
  emit('update:page', page - 1)
  await nextTick()
  if (hadFocus && focused instanceof HTMLButtonElement && focused.disabled
    && (document.activeElement === focused || document.activeElement === document.body)) {
    strip.value?.querySelector<HTMLElement>('button[data-slot^="pagination-"]:not(:disabled)')?.focus()
  }
}

const long = computed(() => props.results.length > QUIZ_STRIP_TILE_LIMIT)
const paged = computed(() => props.results.length > QUIZ_STRIP_PAGE_SIZE)
const columns = computed(() => {
  if (!long.value) return 'grid-cols-[repeat(auto-fit,minmax(2.25rem,1fr))]'
  return props.results.length > 99
    ? 'grid-cols-4 @[20rem]:grid-cols-6 @[40rem]:grid-cols-12'
    : 'grid-cols-4 @[17rem]:grid-cols-6 @[40rem]:grid-cols-12'
})
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
    label: `${long.value ? 'Question ' : 'Q'}${index + 1}, ${QUIZ_RESULT_LABELS[state].toLowerCase()}`,
  }
}))
</script>

<template>
  <div ref="strip" class="space-y-3" data-testid="quiz-score-strip">
    <div class="grid gap-1.5" :class="columns">
      <UiButton
        v-for="cell in cells"
        :key="cell.index"
        type="button"
        variant="outline"
        class="relative gap-1 overflow-hidden px-0 text-xs hover:text-foreground focus-visible:border-solid focus-visible:border-foreground has-[>svg]:px-0 dark:focus-visible:border-foreground"
        :class="[
          cell.state === 'checking' && 'border-dashed text-muted-foreground',
          cell.state === 'your_call' && 'border-primary dark:border-primary',
          cell.index === selectedIndex && 'border-ring ring-[3px] ring-ring/50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring dark:border-ring',
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
      @update:page="changePage"
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
