<script setup lang="ts">
import { Flag, ArrowLeft, CheckCircle, Zap, Flame } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../../convex/_generated/dataModel'

const router = useRouter()
const route = useRoute()

type ReviewMode = 'full' | 'quick'

type ReviewItem = {
  _id: string
  prompt: string
  answer: string
  courseId: string
  sectionId: string
  courseTitle: string
  sectionTitle: string
  sectionOrder: number
  flashcardRoomCardId?: string
  flagged: boolean
  correctedAnswer?: string
}

const reviewMode = computed<ReviewMode>(() => {
  const q = route.query.mode
  if (q === 'quick') return 'quick'
  return 'full'
})

const queryArgs = computed(() => ({
  mode: reviewMode.value,
}))

const submitReviewMutation = import.meta.client
  ? useConvexMutation(api.reviewItems.submitReview)
  : { mutate: async () => ({}) }

const completeSessionMutation = import.meta.client
  ? useConvexMutation(api.reviewItems.completeReviewSession)
  : { mutate: async () => ({ streakCurrent: 0, streakLastDate: null }) }

const profileQuery = import.meta.client
  ? useConvexQuery(api.learnProfile.getProfile, {})
  : { data: ref(null) }

const dailyReviewCap = computed(() => {
  const p = profileQuery.data?.value as { dailyReviewCap?: number } | null | undefined
  return p?.dailyReviewCap ?? 50
})

const dueQuery = import.meta.client
  ? useConvexQuery(api.reviewItems.listDueWithContext, queryArgs)
  : { data: ref([]) }

const sessionItems = ref<ReviewItem[]>([])
const sessionStarted = ref(false)
const sessionStartTime = ref(0)

watch(
  () => dueQuery.data?.value,
  (raw) => {
    if (sessionStarted.value) return
    if (raw === undefined || raw === null) return
    const arr = raw as ReviewItem[]
    sessionItems.value = [...arr]
    sessionStarted.value = true
    sessionStartTime.value = Date.now()
  },
  { immediate: true },
)

const items = computed(() => sessionItems.value)

const currentIndex = ref(0)
const revealed = ref(false)
const sessionComplete = ref(false)
const ratings = ref<Array<{ itemId: string; quality: number }>>([])
const submitting = ref(false)
const completionStreak = ref<number | null>(null)

const currentItem = computed(() => items.value[currentIndex.value] ?? null)
const totalItems = computed(() => items.value.length)
const reviewedCount = computed(() => currentIndex.value)
const isLoading = computed(() => !sessionStarted.value && (dueQuery.data?.value as any[] | undefined)?.length === undefined)
const isEmpty = computed(() => sessionStarted.value && items.value.length === 0)

const hasRated = computed(() => ratings.value.length > 0)

function switchMode(mode: ReviewMode) {
  if (hasRated.value) return
  sessionStarted.value = false
  sessionItems.value = []
  currentIndex.value = 0
  revealed.value = false
  sessionComplete.value = false
  completionStreak.value = null
  router.replace({ query: { ...route.query, mode } })
}

function revealAnswer() {
  if (revealed.value || !currentItem.value) return
  revealed.value = true
}

async function finishSession() {
  const durationMs = Date.now() - sessionStartTime.value
  const correct = ratings.value.filter((r) => r.quality >= 3).length

  try {
    const result = await completeSessionMutation.mutate({
      itemsReviewed: ratings.value.length,
      itemsCorrect: correct,
      durationMs,
      mode: reviewMode.value,
    })
    completionStreak.value = (result as { streakCurrent: number }).streakCurrent
  } catch {
    // Session record failed; completion still shown locally
  }
}

async function rateItem(quality: number) {
  if (!revealed.value || !currentItem.value || submitting.value) return

  submitting.value = true
  const itemId = currentItem.value._id

  ratings.value.push({ itemId, quality })

  try {
    await submitReviewMutation.mutate({
      reviewItemId: itemId as Id<'reviewItems'>,
      quality,
    })
  } catch {
    // SM-2 update failed silently; rating still tracked locally
  }

  if (currentIndex.value >= totalItems.value - 1) {
    sessionComplete.value = true
    await finishSession()
  } else {
    currentIndex.value++
    revealed.value = false
  }

  submitting.value = false
}

const correctCount = computed(() =>
  ratings.value.filter((r) => r.quality >= 3).length,
)

const needsPracticeCount = computed(() =>
  ratings.value.filter((r) => r.quality < 3).length,
)

const flaggingOpen = ref(false)
const flagCorrectedDef = ref('')
const flagSaving = ref(false)
const flagError = ref('')

const flagMutation = import.meta.client
  ? useConvexMutation(api.contentFlags.flagFlashcard)
  : { mutate: async () => ({ success: true }) }

function openFlagEditor() {
  if (!currentItem.value) return
  flagCorrectedDef.value = currentItem.value.correctedAnswer || currentItem.value.answer
  flaggingOpen.value = true
  flagError.value = ''
}

function closeFlagEditor() {
  flaggingOpen.value = false
}

async function saveFlag() {
  if (!currentItem.value?.flashcardRoomCardId) return
  const trimmed = flagCorrectedDef.value.trim()
  if (!trimmed) return

  flagSaving.value = true
  flagError.value = ''
  try {
    await flagMutation.mutate({
      cardId: currentItem.value.flashcardRoomCardId as Id<'flashcardRoomCards'>,
      correctedDefinition: trimmed,
    })
    closeFlagEditor()
  } catch {
    flagError.value = 'Failed to save correction.'
  } finally {
    flagSaving.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (flaggingOpen.value) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  if (e.key === ' ') {
    e.preventDefault()
    revealAnswer()
  } else if (e.key === '1' && revealed.value) {
    rateItem(0)
  } else if (e.key === '2' && revealed.value) {
    rateItem(3)
  } else if (e.key === '3' && revealed.value) {
    rateItem(4)
  } else if (e.key === '4' && revealed.value) {
    rateItem(5)
  } else if ((e.key === 'f' || e.key === 'F') && revealed.value) {
    openFlagEditor()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

function navigateBack() {
  router.push('/')
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-stone-950">
    <header class="border-b border-stone-800 px-4 py-3">
      <div class="mx-auto flex max-w-xl items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-1.5 text-sm text-stone-400 transition-colors hover:text-stone-200"
          data-testid="back-button"
          @click="navigateBack"
        >
          <ArrowLeft class="h-4 w-4" />
          Learn
        </button>
        <div class="flex items-center gap-3">
          <div
            v-if="!isEmpty && !sessionComplete && sessionStarted && !hasRated"
            class="flex items-center gap-1 rounded-full border border-stone-700 p-0.5"
            data-testid="mode-toggle"
          >
            <button
              type="button"
              class="rounded-full px-2.5 py-1 text-xs transition-colors"
              :class="reviewMode === 'full' ? 'bg-stone-700 text-stone-100' : 'text-stone-500 hover:text-stone-300'"
              data-testid="mode-full"
              @click="switchMode('full')"
            >
              Full
            </button>
            <button
              type="button"
              class="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors"
              :class="reviewMode === 'quick' ? 'bg-amber-500/20 text-amber-400' : 'text-stone-500 hover:text-stone-300'"
              data-testid="mode-quick"
              @click="switchMode('quick')"
            >
              <Zap class="h-3 w-3" />
              Quick
            </button>
          </div>
          <span v-if="!isEmpty && !sessionComplete" class="text-xs text-stone-500">
            {{ totalItems }} items
          </span>
          <LearnReviewCapSetting :current-cap="dailyReviewCap" />
        </div>
      </div>
    </header>

    <div v-if="!sessionStarted && !sessionComplete" class="flex flex-1 items-center justify-center px-4">
      <div class="space-y-3 text-center">
        <div class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p class="text-sm text-stone-400">Loading review items...</p>
      </div>
    </div>

    <div v-else-if="isEmpty && !sessionComplete" class="flex flex-1 items-center justify-center px-4" data-testid="empty-state">
      <div class="text-center">
        <CheckCircle class="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h2 class="mb-2 text-xl font-semibold text-stone-100">All caught up</h2>
        <p class="text-sm text-stone-400">No items due for review today.</p>
        <button
          type="button"
          class="mt-6 rounded-lg bg-stone-800 px-4 py-2 text-sm text-stone-300 transition-colors hover:bg-stone-700"
          @click="navigateBack"
        >
          Back to Learn
        </button>
      </div>
    </div>

    <template v-else-if="sessionComplete">
      <div class="flex flex-1 items-center justify-center px-4" data-testid="session-complete">
        <div class="w-full max-w-md rounded-2xl border border-stone-800 bg-stone-900 p-8 text-center">
          <CheckCircle class="mx-auto mb-4 h-10 w-10 text-green-500" />
          <h2 class="mb-4 text-xl font-semibold text-stone-100">Review Complete</h2>
          <div class="space-y-1 text-sm text-stone-300">
            <p>{{ ratings.length }} items reviewed</p>
            <p>{{ correctCount }} correct · {{ needsPracticeCount }} need more practice</p>
          </div>
          <div
            v-if="completionStreak !== null && completionStreak > 0"
            class="mt-4 flex items-center justify-center gap-1.5"
            :aria-label="`Learning streak: ${completionStreak} days`"
            aria-live="polite"
            data-testid="completion-streak"
          >
            <Flame class="h-4 w-4 text-amber-500" />
            <span class="text-sm font-medium text-stone-300">{{ completionStreak }}</span>
            <span class="text-xs text-stone-500">{{ completionStreak === 1 ? 'day' : 'days' }}</span>
          </div>
          <button
            type="button"
            class="mt-6 rounded-lg bg-amber-500 px-6 py-3 text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400"
            data-testid="back-to-learn"
            @click="navigateBack"
          >
            Back to Learn
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="mx-auto w-full max-w-xl px-4 pt-4">
        <div v-if="reviewMode === 'quick'" class="mb-2 flex items-center gap-1.5 text-xs text-amber-400" data-testid="quick-mode-badge">
          <Zap class="h-3 w-3" />
          Quick review — top priority items only
        </div>
        <LearnReviewSessionProgress
          :current="reviewedCount"
          :total="totalItems"
        />
      </div>

      <main class="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <LearnReviewCard
          v-if="currentItem"
          :prompt="currentItem.prompt"
          :answer="currentItem.answer"
          :course-title="currentItem.courseTitle"
          :section-order="currentItem.sectionOrder"
          :revealed="revealed"
          :flagged="currentItem.flagged"
          :corrected-answer="currentItem.correctedAnswer"
          @reveal="revealAnswer"
        />

        <div v-if="revealed" class="mt-6 w-full max-w-xl space-y-4">
          <LearnReviewRatingButtons @rate="rateItem" />

          <div class="flex justify-center">
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs text-stone-500 transition-colors hover:text-amber-400"
              data-testid="flag-button"
              @click="openFlagEditor"
            >
              <Flag class="h-3 w-3" />
              Flag as incorrect
            </button>
          </div>
        </div>

        <div
          v-if="flaggingOpen"
          class="mt-4 w-full max-w-xl space-y-2 rounded-lg border border-stone-700 bg-stone-900 p-3"
          data-testid="flag-editor"
        >
          <label class="block text-xs text-stone-400">
            Corrected answer
            <textarea
              aria-label="Corrected answer"
              class="mt-1 w-full rounded border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
              rows="2"
              :value="flagCorrectedDef"
              @input="flagCorrectedDef = ($event.target as HTMLTextAreaElement).value"
            />
          </label>
          <p v-if="flagError" class="text-xs text-red-400" data-testid="flag-error">
            {{ flagError }}
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
              :disabled="flagSaving"
              data-testid="flag-save"
              @click="saveFlag"
            >
              {{ flagSaving ? 'Saving...' : 'Save' }}
            </button>
            <button
              type="button"
              class="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:text-stone-200"
              @click="closeFlagEditor"
            >
              Cancel
            </button>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>
