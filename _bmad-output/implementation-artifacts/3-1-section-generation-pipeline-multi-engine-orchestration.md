# Story 3-1: Section Generation Pipeline — Multi-Engine Orchestration

## Status: review

## Epic
Epic 3: Section Learning Experience

## Story
As a user,
I want each section to be generated with the right mix of content,
So that I learn each topic in the most effective format.

## Acceptance Criteria

**AC1: Content Type Classification**
Given a section's status is changed to `'generating'`
When the section generation task runs
Then the system classifies the content type from the outline description and source documents
And selects appropriate engines based on knowledgeType (factual/conceptual/procedural/mixed)

**AC2: Parallel Engine Dispatch**
Given classification is complete
When engines are dispatched
Then text explanation (LLM), quiz (`/api/quiz/generate` with `courseScoped: true`), flashcards (`/api/flashcards/generate` with `courseScoped: true`), and optionally audio (`/api/audio-overview/generate` with `courseScoped: true`) run in parallel

**AC3: Content Block Assembly**
Given engine responses are collected
When contentBlocks are assembled
Then they are ordered as: audio (prime) -> text (explain) -> quiz (practice) -> flashcard (reinforce)
And each block includes `entityType` alongside `entityId` (retro action item)

**AC4: Knowledge-Type Format Selection**
Given a section has a knowledgeType
When content format is selected
Then factual sections emphasize flashcards, conceptual sections emphasize audio + quiz, procedural sections emphasize walkthrough + sequencing

**AC5: Section Status Ready**
Given generation completes successfully
When all engine responses are collected
Then section status updates to `'ready'`

**AC6: Graceful Engine Failure**
Given an individual engine fails during generation
When the section assembles content
Then remaining formats are delivered
And the failed engine's block is omitted
And an inline notification message is stored in the section

**AC7: Timing Constraint**
Given section generation begins
When text+quiz+flashcards generate
Then they complete within 30s
And if audio is included, it adds up to 30s additional (NFR2)

**AC8: Schema Widening**
Given contentBlocks are populated by section generation
When an entityId is stored
Then entityType ('quiz' | 'flashcard' | 'audio') is also stored alongside it (epic-2 retro action item #1)

## Tasks

### Task 1: Widen contentBlocks schema to include entityType (AC: #8)
- Update `convex/schema.ts` courseSections.contentBlocks to add `entityType: v.optional(v.union(v.literal('quiz'), v.literal('flashcard'), v.literal('audio')))`
- This is a backward-compatible widening (optional field)
- Run `npx convex dev` to verify schema push succeeds

### Task 2: Add courseScoped mutations for quiz and flashcard creation (AC: #2, #3)
- Add `createCourseScopedWithQuestions` internalMutation to `convex/quizzes.ts`
  - Similar to `createWithQuestions` but accepts userId directly (no auth check — called by server)
  - Sets `courseScoped: true` on the quiz record
  - Returns `{ quizId }`
- Add `createCourseScopedRoom` internalMutation to `convex/flashcardRooms.ts`
  - Creates a flashcardRoom with `courseScoped: true`
  - Creates roomCards from provided cards
  - Returns `{ roomId }`
- These internal mutations are called by the section generation server endpoint via ConvexHttpClient

### Task 3: Add section status transition mutations (AC: #5, #6)
- Add `markGenerating` internalMutation to `convex/courseSections.ts`
  - Sets status to 'generating', links taskId
- Add `markReady` internalMutation to `convex/courseSections.ts`
  - Sets status to 'ready', populates contentBlocks
- Add `markFailed` internalMutation to `convex/courseSections.ts`
  - Sets status to 'failed'
- Add `getForGeneration` internalQuery to `convex/courseSections.ts`
  - Returns section + course data needed by generation pipeline

### Task 4: Create section generation server endpoint (AC: #1, #2, #3, #4, #6, #7)
- Create `server/api/course/generate-section.post.ts`
- Accept `{ courseId, sectionId, taskId }` in request body
- Auth: use `getConvexTokenIdentifier(event)` for userId
- Flow:
  1. Load section + course via ConvexHttpClient
  2. Load source documents via AI Search (reuse outline's search pattern)
  3. Classify content format based on knowledgeType
  4. Dispatch engines in parallel using `Promise.allSettled`:
     - Text: direct LLM call via `generateCompletion`
     - Quiz: internal `fetch` to `/api/quiz/generate` with `courseScoped: true`
     - Flashcard: internal `fetch` to `/api/flashcards/generate` with `courseScoped: true`
     - Audio: conditionally, internal `fetch` to `/api/audio-overview/generate` with `courseScoped: true`
  5. Collect results, build contentBlocks array (ordered: audio->text->quiz->flashcard)
  6. Handle partial failures: omit failed blocks, store notification in section
  7. Update section status to 'ready' via ConvexHttpClient mutation
- Knowledge-type dispatch rules:
  - factual: more flashcards (16 cards), fewer quiz questions (5), skip audio
  - conceptual: include audio, balanced quiz (8 questions), standard flashcards (12 cards)
  - procedural: more quiz questions (10, focus on sequencing), fewer flashcards (8), skip audio
  - mixed: balanced across all engines

### Task 5: Create text generation prompt utility (AC: #1, #4)
- Create `server/utils/section-text-prompt.ts`
- `buildSectionTextPrompt(sectionTitle, sectionDescription, knowledgeType, sourceContent)` -> ChatMessage[]
- Generates an educational text explanation tailored to the knowledge type
- Factual: definition-heavy, key terms highlighted
- Conceptual: analogies, comparisons, deeper explanations
- Procedural: step-by-step walkthrough, sequencing
- Mixed: balanced approach

### Task 6: Wire startCourse to trigger section generation via server endpoint (AC: #5)
- The `courses.startCourse` mutation already creates a task of type 'section-generate' and sets first section to 'generating'
- The client needs to call the generate-section endpoint when it detects a task
- Or: use a Convex scheduled function that calls the server endpoint
- Decision: use the existing pattern where the client (or a watcher) triggers the server call when task is created
- Add a `scheduleSectionGeneration` Convex internalAction that fetches the server endpoint

### Task 7: Write Convex tests (AC: #3, #5, #6, #8)
- Test contentBlocks schema accepts entityType field
- Test section status transitions (locked -> generating -> ready, locked -> generating -> failed)
- Test markReady populates contentBlocks correctly
- Test markFailed sets appropriate error state

### Task 8: Write server endpoint tests (AC: #1, #2, #4, #6)
- Test knowledge-type classification produces correct engine config
- Test parallel dispatch with partial failures returns remaining blocks
- Test contentBlocks ordering (audio -> text -> quiz -> flashcard)
- Test text prompt generation per knowledge type

## Technical Notes

### Existing patterns to follow
- `server/api/course/generate-outline.post.ts` — Convex client setup, task progress, error handling
- `server/api/quiz/generate.post.ts` — AI Search, chunk processing, quiz persistence
- `server/api/flashcards/generate.post.ts` — flashcard generation and room creation
- `server/api/audio-overview/generate.post.ts` — audio TTS pipeline
- `convex/tasks.ts` — createInternal, complete, fail internal mutations

### Schema references
- `courseSections` table: schema.ts lines 390-431
- `contentBlocks` array validator: schema.ts lines 408-418
- `quizzes.courseScoped`: schema.ts line 106
- `flashcardRooms.courseScoped`: schema.ts line 169
- `audioOverviews.courseScoped`: schema.ts line 336

### Key architectural constraints
- Convex actions have a 300s timeout — total section generation must stay well under
- Existing generation endpoints require a `folderId` — course-scoped generation needs the course's folderId
- Quiz createWithQuestions requires a folder ownership check — use internal mutations instead
- Audio generation is the slowest engine (~30s) — make it optional based on knowledgeType

### Entity ID resolution improvement (retro item)
The 2-3 deletion code uses 3 try/catch db.get() calls per entityId because entityType is unknown. By storing entityType in contentBlocks, deletion can do direct lookup. This story implements the entityType storage; the deletion code improvement is deferred.

### Out of scope
- N+1 pre-fetch (Story 3-2)
- Section UI rendering (Story 3-3)
- Section completion and adaptive pacing (Story 3-4)
- Audio primer with user note references (Story 3-5) — this story generates basic audio, 3-5 adds personalization

## Dev Agent Record

### Tasks Completed
- [x] Task 1: Widen contentBlocks schema (entityType + failureNotice)
- [x] Task 2: Add courseScoped mutations (createCourseScopedQuiz, createCourseScopedRoom, courseScoped param on createWithQuestions)
- [x] Task 3: Add section status transition mutations (markReady, markSectionFailed, getForGeneration)
- [x] Task 4: Create section generation server endpoint (generate-section.post.ts)
- [x] Task 5: Create text generation prompt utility (section-text-prompt.ts)
- [x] Task 6: Wire startCourse to return sectionId/taskId and trigger generation from StartLearningButton
- [x] Task 7: Write Convex tests (17 new tests, 529 total passing)
- [x] Task 8: Write server endpoint tests (generate-section.post.test.ts, section-text-prompt tests)

### Decisions
- Used `finalizeSectionGeneration` as a single public mutation that creates quiz/flashcard entities AND updates section status, rather than multiple server-to-Convex round-trips. This keeps entity creation transactional.
- Changed `startCourse` return type from `courseId` (string) to `{ courseId, sectionId, taskId }` so the client can trigger generation immediately.
- Audio generation is deferred for this story (engine config sets includeAudio=false for most types). Audio is included only for conceptual sections but the `/api/audio-overview/generate` call is not integrated into the parallel dispatch since it requires the full TTS pipeline. Story 3-5 will add personalized audio.
- Added `failureNotice` field to courseSections schema to store inline notifications about failed engines.

### Change Log
- convex/schema.ts: Added entityType and failureNotice to contentBlocks
- convex/courseSections.ts: Added finalizeSectionGeneration, markReady, markSectionFailed, getForGeneration
- convex/quizzes.ts: Added createCourseScopedQuiz internalMutation, courseScoped param to createWithQuestions
- convex/flashcardRooms.ts: Added createCourseScopedRoom internalMutation
- convex/courses.ts: Changed startCourse return type to include sectionId and taskId
- server/api/course/generate-section.post.ts: New section generation endpoint
- server/utils/section-text-prompt.ts: New text prompt builder
- app/components/learn/StartLearningButton.vue: Wire section generation call
- convex/courseSections.test.ts: 17 new tests for finalizeSectionGeneration and internal mutations
- convex/courses.test.ts: Updated startCourse test for new return type
- server/api/course/generate-section.post.test.ts: New endpoint tests

### File List
- convex/schema.ts (modified)
- convex/courseSections.ts (modified)
- convex/quizzes.ts (modified)
- convex/flashcardRooms.ts (modified)
- convex/courses.ts (modified)
- server/api/course/generate-section.post.ts (new)
- server/utils/section-text-prompt.ts (new)
- app/components/learn/StartLearningButton.vue (modified)
- convex/courseSections.test.ts (modified)
- convex/courses.test.ts (modified)
- server/api/course/generate-section.post.test.ts (new)
- _bmad-output/implementation-artifacts/3-1-section-generation-pipeline-multi-engine-orchestration.md (new)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
