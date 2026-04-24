# Story 1.4: Outline Generation Pipeline

Status: done

## Story

As a user,
I want the AI to generate a structured course outline from my sources,
So that I have a clear learning path before starting.

## Acceptance Criteria

1. **Given** a course with `sourceType: 'folder'` or `'cross-folder'` has been created
   **When** the outline generation endpoint is called
   **Then** the server retrieves source documents via `searchDocuments` (AI Search) using the course's linked `courseSourceDocs`
   **And** builds a prompt with the document content asking the LLM to generate 5-15 course sections ordered by dependency
   **And** each section includes `title`, `description`, and `knowledgeType` classification (`factual`|`conceptual`|`procedural`|`mixed`)

2. **Given** a course with `sourceType: 'web-only'`
   **When** the outline generation endpoint is called
   **Then** the server uses AI Gateway with a web-search-capable model to generate the outline from the course title/topic
   **And** the `sourceConfidence.webPercent` remains `100`

3. **Given** the outline LLM response is parsed successfully
   **When** sections are extracted
   **Then** `courses.outlineSections` is updated with the parsed sections array
   **And** `courses.totalSectionCount` is set to the number of sections
   **And** `courses.sourceConfidence` is updated (docCount from actual docs retrieved, webPercent calculated)
   **And** `courses.status` transitions from `'generating'` to `'ready'`

4. **Given** the outline is stored on the course
   **When** `courseSections` records are created
   **Then** one `courseSections` record is created per outline section with: `courseId`, `userId`, `order`, `title`, `knowledgeType`, `status: 'locked'`, `contentBlocks: []`, `masteryLevel: 'new'`, `practiceScore: undefined`, `completedAt: undefined`

5. **Given** task progress tracking
   **When** the pipeline runs
   **Then** task progress is updated via `tasks.setProgress` at key stages: `'Retrieving documents...'`, `'Generating outline...'`, `'Creating sections...'`
   **And** on success: `tasks.markComplete` is called with the outline result
   **And** on failure: `tasks.markFailed` is called with the error and `courses.status` is set to `'failed'`

6. **Given** the server endpoint `POST /api/course/generate-outline`
   **When** it receives a request
   **Then** it accepts `{ courseId: string, taskId?: string }` in the body
   **And** it authenticates the user via `getConvexTokenIdentifier`
   **And** it verifies course ownership via Convex
   **And** it follows the same ConvexHttpClient pattern as `server/api/quiz/generate.post.ts`

7. **Given** the prompt utility
   **When** `buildOutlinePrompt` is called
   **Then** it produces a system + user prompt that instructs the LLM to: analyze the provided content, generate 5-15 sections ordered by dependency, classify each section's knowledge type, return structured JSON
   **And** the response is validated with zod (array of `{ title, description, knowledgeType, order }`)
   **And** a tolerant JSON parser handles markdown fences and trailing commas (same pattern as `server/utils/flashcard-prompt.ts`)

8. **Given** a Convex internal mutation `courses.finalizeOutline`
   **When** called with the parsed outline data
   **Then** it updates the course record (outlineSections, totalSectionCount, sourceConfidence, status → 'ready')
   **And** creates all `courseSections` records in a single transaction
   **And** is an `internalMutation` (called from server API, not exposed to client)

9. **Given** performance requirements
   **When** outline generation runs
   **Then** document-based courses complete within 15 seconds
   **And** web-sourced courses complete within 20 seconds

10. **Given** the Convex and server tests
    **When** tests run (`pnpm test`)
    **Then** all existing tests pass with zero regressions
    **And** new server tests cover: happy path (doc-based outline generation), web-only outline generation, auth rejection, course ownership rejection, invalid courseId, LLM error handling (task marked failed, course status failed), prompt building, zod response validation
    **And** new Convex tests cover: `courses.finalizeOutline` internal mutation (creates sections, updates course), ownership guard

## Tasks / Subtasks

- [x] **Task 1: Create `server/utils/outline-prompt.ts`** (AC: #7)
  - [x] `buildOutlinePrompt(content: string, topic: string, sourceType: string)` — returns system + user prompt strings
  - [x] Zod schema for outline response: array of `{ title: string, description: string, knowledgeType: enum, order: number }`
  - [x] `parseOutlineResponse(raw: string)` — tolerant JSON parse (strip fences, patch trailing commas), zod validate, clamp to 5-15 sections
  - [x] Unit tests for prompt building and response parsing

- [x] **Task 2: Create `POST /api/course/generate-outline` endpoint** (AC: #1, #2, #5, #6, #9)
  - [x] Follow `server/api/quiz/generate.post.ts` pattern: ConvexHttpClient, auth, task progress
  - [x] Accept `{ courseId, taskId? }` body
  - [x] Fetch course via Convex to get sourceType, courseSourceDocs, title
  - [x] For folder/cross-folder: retrieve docs via `searchDocuments` with folderId filter per source doc
  - [x] For web-only: use AI Gateway with web-search-capable model, pass topic as query
  - [x] Call `generateCompletion` with outline prompt
  - [x] Parse response, call `courses.finalizeOutline` mutation
  - [x] Update task progress at each stage, mark complete/failed

- [x] **Task 3: Create `courses.finalizeOutline` mutation** (AC: #3, #4, #8)
  - [x] `mutation` in `convex/courses.ts` (public with auth guard; see Dev Agent Record)
  - [x] Args: `courseId`, `outlineSections` array, `sourceConfidence`, `totalSectionCount`
  - [x] Verify course exists, owned by user, and is in `'generating'` state
  - [x] Patch course: outlineSections, totalSectionCount, sourceConfidence, status → 'ready', updatedAt
  - [x] Create `courseSections` records for each section (locked, empty contentBlocks, masteryLevel 'new')

- [x] **Task 4: Create `courses.markFailed` mutation** (AC: #5)
  - [x] `mutation` to set course status to 'failed' (public with auth guard; see Dev Agent Record)
  - [x] Used by server endpoint on LLM/parse errors

- [x] **Task 5: Write tests** (AC: #10)
  - [x] Server tests: happy path, web-only path, auth guard, LLM error → task failed, empty outline → 502
  - [x] Prompt tests: buildOutlinePrompt output, parseOutlineResponse with valid/invalid/fenced JSON
  - [x] Convex tests: finalizeOutline creates sections + updates course, state guard, ownership guard, markFailed sets status

## Dev Agent Record

### Decisions
- **finalizeOutline and markFailed as public mutations instead of internalMutation**: The story specified `internalMutation`, but `ConvexHttpClient` (used by Nuxt server endpoints) cannot call internal Convex functions — only public `query`/`mutation`/`action` are accessible via HTTP. All existing server-to-Convex patterns (quiz, flashcard generators) use public mutations. Added auth ownership guards to both mutations to prevent unauthorized access. This matches the existing `tasks.markComplete` / `tasks.markFailed` pattern.
- **ATDD step skipped**: This story has no UI-testable acceptance criteria — it is a purely server-side pipeline. All ACs are covered by unit and integration tests.

## File List
- `server/utils/outline-prompt.ts` — prompt builder and tolerant JSON parser
- `server/api/course/generate-outline.post.ts` — POST endpoint for outline generation
- `server/api/course/generate-outline.post.test.ts` — server endpoint + prompt unit tests
- `convex/courses.ts` — added `finalizeOutline` and `markFailed` mutations
- `convex/courses.test.ts` — added tests for finalizeOutline and markFailed

## Change Log
- Added `buildOutlinePrompt()` and `parseOutlineResponse()` in `server/utils/outline-prompt.ts`
- Added `POST /api/course/generate-outline` endpoint following quiz generate pattern
- Added `courses.finalizeOutline` mutation: updates course to ready, creates courseSections records
- Added `courses.markFailed` mutation: sets course status to failed
- 22 new test assertions across server and Convex test suites (485 total, 0 regressions)

## Dev Notes

- Follow the exact ConvexHttpClient + task progress pattern from `server/api/quiz/generate.post.ts`
- Prompt utility follows `server/utils/flashcard-prompt.ts` pattern (zod schema, tolerant JSON parse)
- `searchDocuments` is in `server/utils/ai-search.ts` — use it for document-based courses
- `generateCompletion` is in `server/utils/ai-gateway.ts` — use it for LLM calls
- For web-only: the AI Gateway call may use a search-augmented model or a two-step approach (generate search queries → synthesize). Architecture says to use AI Gateway routing, not a separate search API.
- The `finalizeOutline` mutation must be `internalMutation` so the server can call it but clients cannot
- Performance: keep the pipeline lean — single LLM call for outline + classification, no chaining
