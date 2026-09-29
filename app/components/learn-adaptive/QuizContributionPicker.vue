<script setup lang="ts">
import { api } from '#convex/api'

const props = defineProps<{
  threadId: string
  ownerId: string
  folderId: string
  expectedRevision: number
  lifecycle: string
}>()

type QuizChoice = { _id: string, folderId: string, title: string, status: string }
type RecordCommand = { threadId: string, ownerId: string, folderId: string, quizId: string, revision: string, expectedRevision: number, idempotencyKey: string }
const quizQuery = import.meta.client
  ? useConvexQuery(api.quizzes.listByFolder, computed(() => ({ folderId: props.folderId as never })), { enabled: computed(() => Boolean(props.folderId)) })
  : { data: ref<QuizChoice[]>([]), pending: ref(false) }
const choices = computed(() => ((quizQuery.data.value ?? []) as QuizChoice[])
  .filter(quiz => quiz.folderId === props.folderId && quiz.status === 'ready'))
const selectedQuizId = ref('')
const selectedQuiz = computed(() => choices.value.find(quiz => quiz._id === selectedQuizId.value) ?? null)
const sourceInspector = import.meta.client ? useConvex() : null
const recordMutation = import.meta.client ? useConvexMutation(api.learnAdaptive.recordContribution) : { mutate: async (_: unknown) => ({ kind: 'rejected' }) }
const pendingRecord = ref<RecordCommand | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
let scopeEpoch = 0
watch([() => props.ownerId, () => props.threadId, () => props.folderId], () => {
  scopeEpoch += 1
  selectedQuizId.value = ''
  pendingRecord.value = null
  busy.value = false
  error.value = ''
  notice.value = ''
})
function commandKey() { return `quiz-contribution:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
function canRecord() {
  return selectedQuiz.value && !['ended', 'rollback'].includes(props.lifecycle) && !busy.value && !pendingRecord.value
}
async function runRecord(command: RecordCommand) {
  if (busy.value) return
  if (props.threadId !== command.threadId || props.ownerId !== command.ownerId || props.folderId !== command.folderId
    || selectedQuiz.value?._id !== command.quizId) {
    pendingRecord.value = null
    error.value = 'This quiz is no longer selected for your thread. Review the source before trying again.'
    return
  }
  const epoch = scopeEpoch
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await recordMutation.mutate({ threadId: command.threadId as never,
      source: { feature: 'quiz', id: command.quizId, revision: command.revision },
      contributionKind: 'question', classification: 'non_factual', metadata: { role: 'practice' },
      expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey }) as { kind: string, code?: string }
    if (epoch !== scopeEpoch) return
    pendingRecord.value = null
    if (result.kind === 'recorded') notice.value = 'Quiz practice context recorded. Choose it below for an unscored planning activity; no answer, score, or mastery was imported.'
    else if (result.kind === 'conflict') error.value = 'The thread changed in another tab. Review the refreshed thread and select the quiz again.'
    else error.value = result.code === 'source_revision_changed' || result.code === 'source_unavailable'
      ? 'The quiz changed or is unavailable. Review it before trying again.'
      : 'This quiz could not be recorded. Review the thread and quiz before trying again.'
  }
  catch {
    if (epoch === scopeEpoch) error.value = 'The outcome could not be confirmed. Retry the same record to check its result.'
  }
  finally { if (epoch === scopeEpoch) busy.value = false }
}
async function requestRecord() {
  const quiz = selectedQuiz.value
  if (!sourceInspector || !canRecord() || !quiz) return
  const epoch = scopeEpoch
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const inspected = await sourceInspector.query(api.learnAdaptive.inspectContributionSource,
      { source: { feature: 'quiz', id: quiz._id as never } })
    if (epoch !== scopeEpoch) return
    if (inspected.status !== 'available' || !inspected.revision) {
      error.value = 'This quiz is unavailable. Review it before trying again.'
      return
    }
    pendingRecord.value = { threadId: props.threadId, ownerId: props.ownerId, folderId: props.folderId,
      quizId: quiz._id, revision: inspected.revision, expectedRevision: props.expectedRevision, idempotencyKey: commandKey() }
  }
  catch {
    if (epoch === scopeEpoch) error.value = 'Could not check the quiz. Try again when it is available.'
    return
  }
  finally { if (epoch === scopeEpoch) busy.value = false }
  if (pendingRecord.value) void runRecord(pendingRecord.value)
}
function retryRecord() { if (pendingRecord.value) void runRecord(pendingRecord.value) }
</script>

<template>
  <div class="mt-4 rounded-lg border border-border p-3" data-testid="learn-thread-quiz-producer">
    <p class="text-sm font-medium">Add quiz practice context</p>
    <p class="mt-1 text-sm text-muted-foreground">Choose a ready quiz from this thread’s folder. Its questions are not shown in the next activity; no answer, score, or mastery is transferred.</p>
    <label for="learn-quiz-select" class="mt-2 block text-sm">Quiz in this thread’s folder</label>
    <select
      id="learn-quiz-select" v-model="selectedQuizId" data-testid="learn-quiz-select" :disabled="busy || Boolean(pendingRecord)"
      class="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm">
      <option value="">Choose a ready quiz</option>
      <option v-for="quiz in choices" :key="quiz._id" :value="quiz._id">{{ quiz.title }}</option>
    </select>
    <p v-if="quizQuery.pending.value" class="mt-1 text-xs" role="status">Loading quizzes…</p>
    <p v-else-if="choices.length === 0" class="mt-1 text-xs text-muted-foreground">No ready quizzes are available in this folder.</p>
    <button
      type="button" data-testid="learn-record-quiz" :disabled="!canRecord()"
      class="mt-2 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      @click="requestRecord">{{ busy ? 'Checking quiz…' : 'Record quiz practice context' }}</button>
    <p v-if="error" data-testid="learn-quiz-record-error" class="mt-2 text-sm text-destructive" role="alert">{{ error }}</p>
    <button
      v-if="pendingRecord && error" type="button" data-testid="learn-quiz-record-retry" :disabled="busy"
      class="mt-2 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm underline" @click="retryRecord">Retry same record</button>
    <p v-if="notice" data-testid="learn-quiz-record-notice" class="mt-2 text-sm" role="status">{{ notice }}</p>
  </div>
</template>
