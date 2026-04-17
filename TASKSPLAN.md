# Quiz Feature Revamp — Implementation Plan

## Gap Analysis

The current quiz system is a simplified version. Here's what exists vs what the spec requires:

### What Exists
- **Schema:** `quizzes` (basic metadata + folder-scoped), `quizQuestions` (multiple-choice + free-response), `quizAttempts` (flat answer array with score)
- **Backend:** `createWithQuestions`, `listByFolder`, `getWithQuestions`, `submitAttempt` (batch-only, no per-question flow), `listAttempts`, `updateQuestion`, `deleteQuiz`
- **Server API:** Single `/api/quiz/generate` endpoint — searches docs, calls LLM, returns questions. No topic selection, no difficulty, no configurable question types
- **Frontend:** `Tab.vue` (list + generate button), `Taker.vue` (show-all-at-once only, no sequential mode, no settings), `Editor.vue` (edit existing questions, no add/delete individual questions), `Question.vue` (MC + free-response rendering), `CardPreview.vue`
- **Composable:** `useQuizzes` — generate + list, no attempt management

### What the Spec Requires (Delta)
1. **Two new question types:** `true_false` and `fill_in_the_blank` (currently only `multiple-choice` and `free-response`)
2. **Question explanations** — stored per question, shown in feedback
3. **Per-attempt settings** — shuffle, show-all, immediate feedback (frozen per attempt)
4. **Sequential mode** — one question at a time with progress bar and navigation
5. **Immediate feedback mode** — correct/incorrect banner after each answer
6. **Attempt lifecycle** — `in_progress` → `completed`/`abandoned`, with resume support
7. **Per-question answer records** — `attemptAnswers` table instead of embedded array
8. **Quiz state machine** — `initial` → `overview` → `taking` → `results`
9. **Quiz overview screen** — editable title, question list with type badges, history dropdown, control center dock
10. **Resume dialog** — detect in-progress attempt, offer resume vs restart
11. **Settings modal** — pre-attempt configuration
12. **Results screen** — tabbed per-question review with sidebar, score cards, history
13. **AI generation wizard** — 3-step: resource selection → topic customization → settings
14. **Manual question management** — add/delete individual questions (not just edit)
15. **Question type selector** in add/edit modal
16. **Quiz title inline editing**
17. **History with pagination** — per-quiz, per-conversation, color-coded scores

---

## Implementation Phases

### Phase 1: Schema & Backend Foundation

Extend the Convex schema and backend to support the full data model before touching any UI.

#### 1A. Schema Changes (`convex/schema.ts`)

**Modify `quizzes` table:**
- Add `description` (optional string)
- Add `creationMethod` (`manual` | `auto_generated`)
- Add `difficulty` (optional string)
- Add `language` (optional string)
- Add `privacy` (optional: `private` | `public`, default private)
- Add `questionCount` (number)
- Add `conversationId` (optional `Id<'conversations'>`) for room association
- Add `latestAttemptStatus` (optional: `in_progress` | `completed` | `abandoned`)
- Add index `by_conversationId`

**Modify `quizQuestions` table:**
- Expand `type` union: add `true_false`, `fill_in_the_blank`
- Add `explanation` (optional string)
- Change `options` to array of `{ text: string, isCorrect: boolean }` (or keep string array and derive from correctAnswer — evaluate tradeoff)
- Keep `options` as `v.optional(v.array(v.string()))` for simplicity — correctness is determined by `correctAnswer` field. Add `explanation` field only.

**Modify `quizAttempts` table:**
- Remove embedded `answers` array
- Add `status`: `in_progress` | `completed` | `abandoned`
- Add `settingsSnapshot`: object with `shuffleQuestions`, `showAllQuestions`, `immediateFeedback`
- Add `currentQuestionIndex` (number, for resume)
- Add `startedAt` (number)
- Rename/keep `completedAt`
- Add index `by_userId_and_quizId_and_status` for finding in-progress attempts

**New `attemptAnswers` table:**
- `attemptId`: `Id<'quizAttempts'>`
- `questionId`: `Id<'quizQuestions'>`
- `userAnswer`: string
- `isCorrect`: boolean
- `feedback`: optional string (AI-generated feedback for short response)
- `answeredAt`: number
- Indexes: `by_attemptId`, `by_attemptId_and_questionId`

#### 1B. Backend Mutations & Queries (`convex/quizzes.ts`)

**New/modified endpoints:**

| Endpoint | Type | Description |
|---|---|---|
| `updateQuiz` | mutation | Edit title, description, difficulty, language |
| `addQuestion` | mutation | Add a single question to existing quiz (type, text, options, correctAnswer, explanation) |
| `deleteQuestion` | mutation | Remove a question, reorder remaining |
| `startAttempt` | mutation | Create or resume attempt. Args: quizId, settings, restart flag. Returns attempt with questions (shuffled if setting enabled) |
| `submitAnswer` | mutation | Submit one answer. Args: attemptId, questionId, userAnswer. Scores it, inserts attemptAnswer, returns feedback if immediate mode. Advances currentQuestionIndex |
| `submitAllAnswers` | mutation | Batch submit for show-all mode. Scores all, inserts attemptAnswers, completes attempt. Returns full results |
| `completeAttempt` | mutation | Mark attempt completed, calculate final score |
| `abandonAttempt` | mutation | Mark attempt abandoned |
| `getAttemptResults` | query | Fetch detailed results for a completed attempt (score, per-question breakdown with correct answers + explanations) |
| `getQuizHistory` | query | Paginated attempt history for a quiz |
| `getHistoryByConversation` | query | Attempt history filtered by conversation |
| `getQuizzesByConversation` | query | List quizzes for a conversation/room |

**Modify existing:**
- `updateQuestion` — add support for changing type, adding explanation
- `createWithQuestions` — accept new fields (description, difficulty, language, creationMethod, explanation per question)
- `submitAttempt` — deprecate or redirect to new `submitAllAnswers`

#### 1C. Migration Strategy

The existing `quizAttempts` rows have an embedded `answers` array. Options:
1. **Widen schema** — make `answers` optional on `quizAttempts`, new attempts use `attemptAnswers` table. Old results still render from embedded array. This is the safest approach.
2. Write a migration to backfill `attemptAnswers` from existing embedded data — do this as a separate step after the schema change.

**Decision:** Option 1 (widen first, migrate later). Add `answers` as `v.optional()` and handle both paths in the results query.

---

### Phase 2: AI Generation Upgrade

Upgrade the server-side generation to support the full wizard flow.

#### 2A. Topics API (`server/api/quiz/topics.post.ts`)

New endpoint that accepts selected resource IDs, searches their content, and asks the LLM to suggest quiz topics.

- Input: `{ folderId, resourceIds: string[] }`
- Flow: fetch document chunks for selected resources → LLM call with topic-extraction prompt → return `{ topics: string[] }`

#### 2B. Enhanced Generation (`server/api/quiz/generate.post.ts`)

Extend existing endpoint to accept:
- `topics`: string[] (selected + custom topics to focus on)
- `questionTypes`: array of allowed types
- `difficulty`: easy | medium | hard | mixed
- `questionCount`: 1-50 (currently capped at 8)
- `resourceIds`: specific documents to use (instead of searching all)

Update `server/utils/quiz-prompt.ts`:
- Add `true_false` and `fill_in_the_blank` to the prompt schema
- Include `explanation` field in the LLM output schema
- Adjust prompt to respect difficulty, topics, and question type distribution
- Update Zod validation schemas

---

### Phase 3: Frontend Composable Layer

#### 3A. Refactor `useQuizzes` composable

Split into focused composables:

**`useQuizzes(folderId)`** — list & CRUD (keep existing, extend)
- Add: `createQuiz` (manual), `updateQuiz`, `deleteQuiz` (already exists via mutation)

**`useQuizAttempt(quizId)`** — attempt lifecycle
- `startAttempt(settings, restart?)` → returns attempt data
- `submitAnswer(questionId, answer)` → returns feedback
- `submitAllAnswers(answers[])` → returns results
- `completeAttempt()`
- `abandonAttempt()`
- `activeAttempt` — reactive ref to current in-progress attempt
- `attemptResults` — reactive query for results

**`useQuizHistory(quizId)`** — paginated history
- `attempts` — reactive list
- `loadMore()` — pagination

**`useQuizGeneration(folderId)`** — generation wizard state
- `generateTopics(resourceIds)` → topics
- `generate(fullConfig)` → quiz
- `wizardStep` — reactive (1/2/3)
- `selectedResources`, `selectedTopics`, `customTopics`, `settings`

#### 3B. Quiz State Machine

Implement as a composable `useQuizFlow(quizId?)`:
```
state: 'initial' | 'overview' | 'taking' | 'results'
```
Transitions driven by data + user actions. Exposed to the main quiz shell component.

---

### Phase 4: Frontend UI — Core Flow

#### 4A. Quiz Shell (`quiz/Shell.vue`)

Replace `Tab.vue` as the main orchestrator. Manages the state machine and delegates to sub-views:
- `initial` → shows `InitialView` (create options)
- `overview` → shows `OverviewView` (question list, settings, history)
- `taking` → shows `TakingView` (sequential or show-all)
- `results` → shows `ResultsView` (score, per-question review)

#### 4B. Initial View (`quiz/InitialView.vue`)

When no quiz exists:
- "New quiz" heading
- Two action cards: "Add question" (opens add modal) + "Generate questions" (opens wizard)

#### 4C. Overview View (`quiz/OverviewView.vue`)

**Header:** Inline-editable title + history dropdown
**Body:** Question list with type badges, per-question edit/delete actions
**Footer (Control Center):** Sticky dock with "Take quiz" + "Generate questions" buttons

Sub-components:
- `quiz/QuestionCard.vue` — read-only question preview with type badge and actions
- `quiz/HistoryDropdown.vue` — reusable history dropdown with color-coded scores
- `quiz/ControlCenter.vue` — sticky bottom bar

#### 4D. Add/Edit Question Modal (`quiz/QuestionModal.vue`)

Shared modal for creating and editing questions:
- Question type selector (dropdown)
- Question text (textarea)
- Dynamic fields based on type:
  - MC: option list with add/remove, radio for correct
  - True/False: two fixed options, radio for correct
  - Short Response: correct answer textarea
  - Fill in the Blank: correct answer input
- Explanation textarea
- Create / Save button

#### 4E. Resume Dialog (`quiz/ResumeDialog.vue`)

Shown when "Take quiz" clicked and in-progress attempt exists:
- Progress info (X of Y answered)
- Resume button / Start new button

#### 4F. Settings Modal (`quiz/SettingsModal.vue`)

Pre-attempt settings:
- Shuffle questions toggle
- Show all questions toggle
- Immediate feedback toggle
- Start button

---

### Phase 5: Frontend UI — Quiz Taking

#### 5A. Taking View (`quiz/TakingView.vue`)

Orchestrates sequential vs show-all based on attempt settings.

#### 5B. Sequential Mode (`quiz/SequentialMode.vue`)

- Single question display
- Type-specific input component
- Feedback banner (if immediate mode)
- Bottom navigation: progress dropdown, progress bar, Next/Submit button
- "Explain why" expandable for correct answers

#### 5C. Show All Mode (`quiz/ShowAllMode.vue`)

- Scrollable question list
- Per-question inline feedback (if immediate mode)
- Sticky bottom bar: progress counter, progress bar, Next (scroll to unanswered), Submit
- Auto-scroll to current question on mount/resume

#### 5D. Question Input Components

Refactor `Question.vue` into type-specific inputs:
- `quiz/inputs/MultipleChoice.vue` — option buttons with feedback highlighting
- `quiz/inputs/TrueFalse.vue` — True/False buttons
- `quiz/inputs/FillInBlank.vue` — text input
- `quiz/inputs/ShortResponse.vue` — textarea with AI evaluation support

---

### Phase 6: Frontend UI — Results

#### 6A. Results View (`quiz/ResultsView.vue`)

**Header:** "Quiz results" title + timestamps + history dropdown
**Stats Cards:** 2-column grid — score percentage (color-coded circular indicator) + correct count
**Per-Question Review:** Tabbed interface

#### 6B. Question Review Panel (`quiz/ReviewPanel.vue`)

- Left sidebar: scrollable question tabs (number, truncated text, correct/incorrect icon)
- Right content: full question detail with user answer, correct answer, explanation, option highlighting

---

### Phase 7: AI Generation Wizard

#### 7A. Generation Wizard (`quiz/GenerationWizard.vue`)

3-step wizard with back/next navigation:

**Step 1 — Resources** (`quiz/wizard/ResourceStep.vue`)
- File/folder selector from current collection
- Selected resources list with remove buttons
- Next button (disabled until >= 1 selected)

**Step 2 — Topics** (`quiz/wizard/TopicStep.vue`)
- AI-suggested topic pills (from topics API)
- Toggle selection (filled = selected, outline = not)
- Custom topic input + Add button
- Loading state during generation

**Step 3 — Settings** (`quiz/wizard/SettingsStep.vue`)
- Max questions: number input (1-50)
- Question types: checkboxes (MC, T/F, short response, fill-in-blank)
- Difficulty: select (easy, medium, hard, mixed)
- Generate button

---

### Phase 8: Polish & Integration

#### 8A. Quiz Room Route

If the spec's room concept (`/:collectionId/rooms/practice-quiz/:roomId`) needs a dedicated page vs the current tab-in-folder approach — evaluate whether to add a new page or keep the tab approach. The current tab approach works well for the folder context.

**Decision:** Keep as folder tab for now. The `conversationId` field on quizzes enables room-like grouping without a separate route. Can add dedicated room page later if needed.

#### 8B. Study Guide Integration

Deferred — depends on study guide system existing. The quiz components should be built modularly enough to embed in study guide sections.

#### 8C. Content Loading Optimization

Add after core features work:
- LRU cache for quiz questions
- Preload upcoming questions in sequential mode
- Progressive loading for large quizzes

---

## Execution Order & Dependencies

```
Phase 1A (Schema) ──→ Phase 1B (Backend) ──→ Phase 1C (Migration)
                                │
Phase 2A (Topics API) ──────────┤
Phase 2B (Generation upgrade) ──┤
                                │
                                ▼
Phase 3A (Composables) ──→ Phase 3B (State machine)
                                │
                                ▼
Phase 4A-F (Core UI) ──→ Phase 5A-D (Taking UI) ──→ Phase 6A-B (Results UI)
                                │
                                ▼
                        Phase 7A (Wizard UI)
                                │
                                ▼
                        Phase 8 (Polish)
```

**Critical path:** Schema → Backend → Composables → Shell + Overview → Taking → Results

**Parallelizable:**
- Phase 2 (generation upgrade) can run alongside Phase 3-4 frontend work
- Phase 7 (wizard) can be built independently once composable layer exists
- Question input components (5D) can be built in parallel with taking views

---

## File Inventory

### New Files
| File | Phase |
|---|---|
| `convex/attemptAnswers.ts` (or inline in quizzes.ts) | 1B |
| `server/api/quiz/topics.post.ts` | 2A |
| `app/composables/useQuizAttempt.ts` | 3A |
| `app/composables/useQuizHistory.ts` | 3A |
| `app/composables/useQuizGeneration.ts` | 3A |
| `app/composables/useQuizFlow.ts` | 3B |
| `app/components/quiz/Shell.vue` | 4A |
| `app/components/quiz/InitialView.vue` | 4B |
| `app/components/quiz/OverviewView.vue` | 4C |
| `app/components/quiz/QuestionCard.vue` | 4C |
| `app/components/quiz/HistoryDropdown.vue` | 4C |
| `app/components/quiz/ControlCenter.vue` | 4C |
| `app/components/quiz/QuestionModal.vue` | 4D |
| `app/components/quiz/ResumeDialog.vue` | 4E |
| `app/components/quiz/SettingsModal.vue` | 4F |
| `app/components/quiz/TakingView.vue` | 5A |
| `app/components/quiz/SequentialMode.vue` | 5B |
| `app/components/quiz/ShowAllMode.vue` | 5C |
| `app/components/quiz/inputs/MultipleChoice.vue` | 5D |
| `app/components/quiz/inputs/TrueFalse.vue` | 5D |
| `app/components/quiz/inputs/FillInBlank.vue` | 5D |
| `app/components/quiz/inputs/ShortResponse.vue` | 5D |
| `app/components/quiz/ResultsView.vue` | 6A |
| `app/components/quiz/ReviewPanel.vue` | 6B |
| `app/components/quiz/GenerationWizard.vue` | 7A |
| `app/components/quiz/wizard/ResourceStep.vue` | 7A |
| `app/components/quiz/wizard/TopicStep.vue` | 7A |
| `app/components/quiz/wizard/SettingsStep.vue` | 7A |

### Modified Files
| File | Phase | Changes |
|---|---|---|
| `convex/schema.ts` | 1A | Extend quizzes, quizQuestions, quizAttempts; add attemptAnswers table |
| `convex/quizzes.ts` | 1B | Add new mutations/queries, modify existing |
| `server/api/quiz/generate.post.ts` | 2B | Accept topics, types, difficulty, expanded count |
| `server/utils/quiz-prompt.ts` | 2B | New question types, explanation, difficulty support |
| `app/composables/useQuizzes.ts` | 3A | Extend with CRUD, simplify (extract attempt logic) |
| `app/components/quiz/Tab.vue` | 4A | Delegate to Shell.vue or replace entirely |
| `app/components/quiz/Question.vue` | 5D | Refactor into type-specific inputs or extend |
| `app/components/quiz/Editor.vue` | 4D | Replace with QuestionModal approach or extend |

---

## Risk Notes

1. **Schema migration** — existing `quizAttempts` with embedded `answers` array. Must handle both old and new format in results queries during transition.
2. **Short response AI evaluation** — the spec calls for AI-evaluated short responses. This requires an API call per answer in immediate-feedback mode, adding latency. Consider: evaluate on `submitAnswer` server-side, or batch on `completeAttempt`.
3. **Question count expansion** (1-50) — current LLM prompt caps at 8. Larger counts may need chunked generation or longer context windows.
4. **Shuffle + resume** — shuffled order must be stored on the attempt so resume restores the same order. Store as `questionOrder: Id[]` on the attempt.
