---
slug: quiz-feature-revamp
status: ready-for-dev
created: 2026-04-17
source: docs/archive/plans/quiz-feature-spec.md + docs/archive/plans/quiz-feature-revamp-implementation-plan.md
design_approved: true
stitch_project: "526950061036357227"
---

# Spec: Quiz Feature Revamp

## Frozen Intent

Revamp the existing basic quiz system into a full-featured quiz engine with 4 question types, configurable attempt settings (shuffle, show-all, immediate feedback), attempt lifecycle (start/resume/complete/abandon), sequential + show-all taking modes, detailed results with per-question review, and a 3-step AI generation wizard with topic customization.

## I/O Matrix

### Backend (Convex)

| Endpoint | Type | Input | Output |
|---|---|---|---|
| `updateQuiz` | mutation | quizId, title?, description?, difficulty?, language? | updated quiz |
| `addQuestion` | mutation | quizId, type, questionText, options?, correctAnswer, explanation? | questionId |
| `deleteQuestion` | mutation | questionId | void |
| `startAttempt` | mutation | quizId, settings{shuffle,showAll,immediateFeedback}, restart? | attempt + questions (ordered) |
| `submitAnswer` | mutation | attemptId, questionId, userAnswer | {isCorrect, correctAnswer, explanation, feedback?} |
| `submitAllAnswers` | mutation | attemptId, answers[{questionId, userAnswer}] | {score, total, results[]} |
| `completeAttempt` | mutation | attemptId | {score, total} |
| `abandonAttempt` | mutation | attemptId | void |
| `getAttemptResults` | query | attemptId | {score, total, startedAt, completedAt, answers[{question, userAnswer, isCorrect, correctAnswer, explanation}]} |
| `getQuizHistory` | query | quizId, limit?, cursor? | attempts[] |
| `generateTopics` | server API | folderId, resourceIds[] | {topics: string[]} |

### Frontend (Composables)

| Composable | Reactives | Methods |
|---|---|---|
| `useQuizzes(folderId)` | quizzes, generating | generate(), createQuiz(), updateQuiz(), deleteQuiz() |
| `useQuizAttempt(quizId)` | activeAttempt, attemptResults, submitting | startAttempt(), submitAnswer(), submitAllAnswers(), completeAttempt(), abandonAttempt() |
| `useQuizHistory(quizId)` | attempts, loading | loadMore() |
| `useQuizGeneration(folderId)` | wizardStep, topics, generating | generateTopics(), generate() |
| `useQuizFlow(quizId?)` | state: initial/overview/taking/results | transition methods |

## Code Map

### Schema Changes (convex/schema.ts)

**quizzes table — add fields:**
- `description: v.optional(v.string())`
- `creationMethod: v.optional(v.union(v.literal('manual'), v.literal('auto_generated')))`
- `difficulty: v.optional(v.string())`
- `language: v.optional(v.string())`
- `questionCount: v.optional(v.number())`
- `latestAttemptStatus: v.optional(v.union(v.literal('in_progress'), v.literal('completed'), v.literal('abandoned')))`

**quizQuestions table — modify:**
- Expand `type` union: add `v.literal('true_false')`, `v.literal('fill_in_the_blank')`
- Add `explanation: v.optional(v.string())`

**quizAttempts table — modify:**
- Make `answers` optional (migration compat): `v.optional(v.array(...))`
- Add `status: v.union(v.literal('in_progress'), v.literal('completed'), v.literal('abandoned'))`
- Add `settingsSnapshot: v.optional(v.object({shuffleQuestions: v.boolean(), showAllQuestions: v.boolean(), immediateFeedback: v.boolean()}))`
- Add `currentQuestionIndex: v.optional(v.number())`
- Add `startedAt: v.optional(v.number())`
- Add `questionOrder: v.optional(v.array(v.id('quizQuestions')))` (for shuffle resume)
- Add index `by_quizId_and_status`

**New attemptAnswers table:**
- `attemptId: v.id('quizAttempts')`
- `questionId: v.id('quizQuestions')`
- `userAnswer: v.string()`
- `isCorrect: v.boolean()`
- `feedback: v.optional(v.string())`
- `answeredAt: v.number()`
- Indexes: `by_attemptId`, `by_attemptId_and_questionId`

### Backend (convex/quizzes.ts)

**Modify existing:**
- `createWithQuestions` — accept `description`, `difficulty`, `language`, `creationMethod`, `explanation` per question, new question types
- `updateQuestion` — support changing type, adding explanation
- `listByFolder` — include `latestAttemptStatus` in summary

**New mutations:**
- `updateQuiz({quizId, title?, description?, difficulty?, language?})`
- `addQuestion({quizId, type, questionText, options?, correctAnswer, explanation?})` — auto-set order
- `deleteQuestion({questionId})` — reorder remaining
- `startAttempt({quizId, settings, restart?})` — find/create attempt, shuffle if needed, store questionOrder, return attempt + questions
- `submitAnswer({attemptId, questionId, userAnswer})` — score, insert attemptAnswer, advance index, return feedback if immediate
- `submitAllAnswers({attemptId, answers[]})` — batch score, insert attemptAnswers, complete attempt
- `completeAttempt({attemptId})` — calculate final score, update quiz latestAttemptStatus
- `abandonAttempt({attemptId})` — mark abandoned

**New queries:**
- `getAttemptResults({attemptId})` — detailed results with per-question breakdown
- `getQuizHistory({quizId, limit?})` — paginated attempt history

### Server API

**New: `server/api/quiz/topics.post.ts`**
- Input: `{folderId, resourceIds[]}`
- Search document chunks for selected resources → LLM topic extraction → return `{topics: string[]}`

**Modify: `server/api/quiz/generate.post.ts`**
- Accept: `topics[]`, `questionTypes[]`, `difficulty`, expanded `questionCount` (1-50), `resourceIds[]`

**Modify: `server/utils/quiz-prompt.ts`**
- Add `true_false` and `fill_in_the_blank` to schema
- Add `explanation` to output format
- Respect difficulty, topics, type distribution in prompt

### Frontend Composables

**New: `app/composables/useQuizAttempt.ts`**
**New: `app/composables/useQuizHistory.ts`**
**New: `app/composables/useQuizGeneration.ts`**
**New: `app/composables/useQuizFlow.ts`**
**Modify: `app/composables/useQuizzes.ts`** — add createQuiz, updateQuiz

### Frontend Components

**New:**
- `quiz/Shell.vue` — state machine orchestrator (replaces Tab.vue delegation)
- `quiz/InitialView.vue` — no quiz exists, create options
- `quiz/OverviewView.vue` — question list, editable title, history, control center
- `quiz/QuestionCard.vue` — read-only question preview with type badge
- `quiz/HistoryDropdown.vue` — reusable history dropdown with color-coded scores
- `quiz/ControlCenter.vue` — sticky bottom dock
- `quiz/QuestionModal.vue` — add/edit question with type selector
- `quiz/ResumeDialog.vue` — resume vs restart
- `quiz/SettingsModal.vue` — pre-attempt settings
- `quiz/TakingView.vue` — orchestrates sequential vs show-all
- `quiz/SequentialMode.vue` — single question with feedback + progress
- `quiz/ShowAllMode.vue` — all questions with sticky progress
- `quiz/inputs/MultipleChoice.vue`
- `quiz/inputs/TrueFalse.vue`
- `quiz/inputs/FillInBlank.vue`
- `quiz/inputs/ShortResponse.vue`
- `quiz/ResultsView.vue` — score cards + actions
- `quiz/ReviewPanel.vue` — tabbed per-question review
- `quiz/GenerationWizard.vue` — 3-step modal wizard
- `quiz/wizard/ResourceStep.vue`
- `quiz/wizard/TopicStep.vue`
- `quiz/wizard/SettingsStep.vue`

**Modify:**
- `quiz/Tab.vue` — delegate to Shell.vue
- `quiz/Question.vue` — extend for new types or extract to inputs/

## Tasks

- [ ] 1. Schema: extend quizzes, quizQuestions, quizAttempts tables + add attemptAnswers
- [ ] 2. Backend: updateQuiz, addQuestion, deleteQuestion mutations
- [ ] 3. Backend: startAttempt, submitAnswer, submitAllAnswers, completeAttempt, abandonAttempt
- [ ] 4. Backend: getAttemptResults, getQuizHistory queries
- [ ] 5. Server: topics.post.ts endpoint
- [ ] 6. Server: extend generate.post.ts + quiz-prompt.ts for new types/topics/difficulty
- [ ] 7. Composables: useQuizAttempt, useQuizHistory, useQuizGeneration, useQuizFlow
- [ ] 8. Composable: extend useQuizzes with createQuiz, updateQuiz
- [ ] 9. UI: Shell.vue state machine + InitialView
- [ ] 10. UI: OverviewView + QuestionCard + HistoryDropdown + ControlCenter
- [ ] 11. UI: QuestionModal (add/edit with type selector)
- [ ] 12. UI: ResumeDialog + SettingsModal
- [ ] 13. UI: TakingView + SequentialMode + feedback states
- [ ] 14. UI: ShowAllMode
- [ ] 15. UI: Input components (MultipleChoice, TrueFalse, FillInBlank, ShortResponse)
- [ ] 16. UI: ResultsView + ReviewPanel
- [ ] 17. UI: GenerationWizard + 3 step components
- [ ] 18. Wire Tab.vue to delegate to Shell.vue
- [ ] 19. Extend createWithQuestions for new fields

## Spec Change Log

(empty — initial version)
