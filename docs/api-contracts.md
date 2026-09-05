# API Contracts

## 1. Nitro API Endpoints

All endpoints require an authenticated Convex token (via SSR middleware) unless noted otherwise.

---

### RAG

#### POST /api/rag/chat

RAG-augmented chat over folder documents.

**Request body:**

```ts
{
  query: string           // required
  model: string           // required
  folderId: string        // required
  history?: ChatMessage[]
  max_num_results?: number   // default 50
  score_threshold?: number   // default 0.05
  temperature?: number
  max_tokens?: number
  stream?: boolean
  scope?: {
    folderIds?: string[]
    fileIds?: string[]
  }
}
```

**Response (non-streaming):**

```ts
{
  answer: string
  model: string
  usage: object
  sources: Array<{ content: string; score: number; attributes: object }>
  modelFallback?: { requested: string; actual: string }
}
```

**Response (streaming):** SSE stream with `model-fallback`, `sources`, and text chunk events.

**Errors:** 400 (missing query/model/folderId)

**Rate limit:** 20 req/window

---

#### POST /api/rag/search

Vector search over indexed documents.

**Request body:**

```ts
{
  query: string              // required
  folderId?: string
  max_num_results?: number
  score_threshold?: number
}
```

**Response:** AI Search result object with `data` array of scored chunks.

**Errors:** 400 (missing query)

---

### Chat

#### POST /api/chat/general

General-purpose chat without RAG context (Budds study companion persona).

**Request body:**

```ts
{
  query: string           // required
  model: string           // required
  history?: ChatMessage[]
  temperature?: number
  max_tokens?: number
}
```

**Response:**

```ts
{
  answer: string
  model: string
  usage: object
  modelFallback?: { requested: string; actual: string }
}
```

**Errors:** 400 (missing query/model)

---

### Course

#### POST /api/course/generate-outline

Generates a course outline from source documents.

**Request body:**

```ts
{
  courseId: string   // required (Id<'courses'>)
  taskId?: string
}
```

**Response:**

```ts
{
  courseId: string
  sectionCount: number
  sections: Array<{ title: string; knowledgeType: string }>
}
```

**Errors:** 400 (missing courseId), 404 (course not found), 502 (no valid sections produced)

**Rate limit:** 3 req/window

---

#### POST /api/course/generate-section

Generates full section content (text, quiz, flashcards, optional audio primer).

**Request body:**

```ts
{
  courseId: string    // required
  sectionId: string  // required
  taskId?: string
}
```

**Response:**

```ts
{
  sectionId: string
  status: string
  blockCount: number
  failedEngines: string[]
}
```

**Errors:** 400 (missing courseId/sectionId), 404 (course/section not found)

**Rate limit:** 5 req/window

---

### Flashcards

#### POST /api/flashcards/generate

Generates flashcards from folder documents.

**Request body:**

```ts
{
  folderId: string     // required
  model?: string
  cardCount?: number   // 6-16, default 12
  taskId?: string
  roomId?: string
}
```

**Response:**

```ts
{
  title: string
  model: string
  cards: Array<{
    order: number
    front: string
    back: string
    sourceDocumentId?: string
    sourceChunkContent: string
    sourceFilename: string
  }>
  cardCount: number
  taskId?: string
  roomId?: string
  versionId?: string
}
```

**Errors:** 400 (missing folderId), 422 (insufficient content), 502 (no cards generated)

**Rate limit:** 5 req/window

---

### Quiz

#### POST /api/quiz/generate

Generates a quiz from folder documents.

**Request body:**

```ts
{
  folderId: string         // required
  model?: string
  questionCount?: number   // 3-50, default 8
  topics?: string[]
  questionTypes?: string[]
  difficulty?: string
  resourceIds?: string[]
  taskId?: string
}
```

**Response:**

```ts
{
  title: string
  model: string
  questions: Array<{
    order: number
    question: string
    type: string
    options: string[]
    correctAnswer: string
    explanation: string
    sourceDocumentId?: string
    sourceChunkContent: string
    sourceFilename: string
  }>
  questionCount: number
  taskId?: string
  quizId?: string
}
```

**Errors:** 400 (missing folderId), 422 (insufficient content), 502 (no questions generated)

**Rate limit:** 5 req/window

---

#### POST /api/quiz/topics

Extracts topic suggestions from folder documents for quiz generation.

**Request body:**

```ts
{
  folderId: string       // required
  resourceIds?: string[]
}
```

**Response:**

```ts
{ topics: string[] }
```

**Errors:** 400 (missing folderId)

---

### Audio Overview

#### POST /api/audio-overview/generate

Accepts an Audio Overview generation job. The request returns after the durable
Workflow is created; progress and completion arrive through the existing Convex
task and overview subscriptions.

**Request body:**

```ts
{
  folderId: string
  scope:
    | { mode: 'folder' }
    | { mode: 'explicit'; documentIds: string[] }
  preferences: {
    lengthMinutes: 5 | 10 | 20
    complexity: 'beginner' | 'expert'
  }
  voiceProfile: {
    hostA: string
    hostB: string
  }
  idempotencyKey: string // 16-128 URL-safe characters
}
```

**Response:**

```ts
{
  accepted: true
  duplicate: boolean
  taskId: string
  jobId: string
  quota: { used: number; cap: number; date: string }
}
```

**Status:** 202 Accepted

**Errors:** 400 (invalid command), 401 (unauthenticated), 503 (job system or Workflow unavailable)

Individual Workflow steps call the internal application bridge at
`POST /api/audio-overview/jobs/step` with a per-job capability. This is not a
browser API and must not be called with a user token.

**Rate limit:** 5 req/window

---

#### POST /api/audio-overview/interject

Inserts a Q&A interjection into an existing audio overview.

**Request body:**

```ts
{
  overviewId: string              // required
  insertedAfterTurnIndex: number
  question: string                // required, max 500 chars
  model?: string
}
```

**Response:**

```ts
{
  interjectionId: string
  insertedAfterTurnIndex: number
  answerTurnCount: number
  turns: Array<{
    speaker: 'host_a' | 'host_b'
    text: string
    durationMs: number
    sourceIndex?: number
    audioFileId: string
    audioUrl: string | null
  }>
  totalDurationMs: number
  model: string
}
```

**Errors:** 400 (missing overviewId/question), 404 (overview not found), 409 (overview not ready), 422 (no context), 502 (synthesis failure)

**Rate limit:** 10 req/window

---

### Calendar

#### GET /api/calendar/connect

Initiates Google Calendar OAuth flow. Sets a CSRF state cookie and redirects to Google consent screen.

**Response:** 302 redirect to Google OAuth URL.

**Errors:** 500 (not configured)

---

#### GET /api/calendar/callback

Google OAuth callback. Exchanges code for tokens, stores connection in Convex, redirects to app.

**Query params:** `code`, `state`, `error` (from Google)

**Response:** 302 redirect to `/app/learn?calendar_connected=true` or `?calendar_error=...`

---

#### POST /api/calendar/disconnect

Disconnects Google Calendar, deletes synced events from Google, removes connection record.

**Response:**

```ts
{
  disconnected: true
  googleEventsDeleted: number
  googleEventsFailed: number
}
```

**Errors:** 401 (unauthenticated), 400 (no active connection)

**Rate limit:** 3 req/window

---

#### POST /api/calendar/sync

Creates Google Calendar events for active courses based on user preferences.

**Response:**

```ts
{
  created: number
  events?: Array<{ courseId: string; eventId: string; sessionType: string }>
  message?: string
}
```

**Errors:** 401 (unauthenticated), 400 (no connection/preferences)

**Rate limit:** 3 req/window

---

### Learn

#### GET /api/learn/section-cache-payload

Returns offline cache payload for a course section.

**Query params:** `sectionId` (required)

**Response:** Section cache payload object from Convex.

**Errors:** 400 (missing sectionId), 401 (unauthenticated)

---

### Export

#### GET /api/export/me

Exports supported user-owned records as a streamed ZIP archive, including folders, documents, chat, quizzes and attempts, flashcards, Learn/review/calendar metadata, Audio Overview metadata, tasks, and original document files. OAuth credentials and public share tokens are deliberately excluded. Convex records are fetched through authenticated pages of at most 8 rows and written incrementally, so no user-owned table is collected into one Convex transaction or one in-memory JSON array.

**Infrastructure requirement:** this synchronous endpoint requires the Cloudflare Workers Paid plan. Its bounded per-dataset pagination can exceed the Workers Free plan's 50 outbound subrequests in a single request.

**Response:** `application/zip` stream containing JSON files for all entities plus file-backed documents. Document entries retain a safe, normalized version of their original extension and fall back to `.bin` when the filename has no safe extension. The schema-version 8 `manifest.json` includes counts, `unresolvedDocuments` for expected file-backed documents whose blob cannot be opened, and `nonFileBackedDocuments` for website and YouTube records that intentionally have no stored blob. If an upstream blob stream fails after its ZIP entry begins, the response stream is aborted and no valid completed archive is returned.

**Errors:** 401 (unauthenticated), 500 (Convex URL missing / data fetch failure)

---

### Debug

#### POST /api/debug/testR2

Tests R2 storage connectivity in non-production environments only. The route is disabled unless `ENABLE_R2_DEBUG_ROUTE=true` and requires an authenticated Convex identity.

**Request body:** `{ folderId: string }`

**Response:** `{ configStatus: object; success?: boolean; count?: number; docs?: string[]; error?: string }`

---

## 2. Convex Functions

### folders

| Function | Type | Description |
|---|---|---|
| `listAllFolders` | query | List all folders for authenticated user |
| `listTopLevelFolders` | query | List root-level folders |
| `listChildFolders` | query | List child folders of a parent |
| `getFolder` | query | Get folder by ID |
| `listSubtree` | query | Get full subtree from a folder |
| `searchScopeItems` | query | Search scope items for reference filtering |
| `resolveScope` | query | Resolve folder/file scope to document IDs |
| `getFolderDescendantCounts` | query | Get document/subfolder counts |
| `createFolder` | mutation | Create a new top-level folder |
| `createSubfolder` | mutation | Create a nested folder |
| `renameFolder` | mutation | Rename a folder |
| `updateFolder` | mutation | Update folder properties (name, icon, color) |
| `setPreferredMainPane` | mutation | Set default pane for folder view |
| `setReferenceScope` | mutation | Set reference scope for folder |
| `deleteFolder` | mutation | Delete folder and cascade contents |

### documents

| Function | Type | Description |
|---|---|---|
| `generateUploadUrl` | mutation | Generate a file upload URL |
| `createDocument` | mutation | Create a document record from upload |
| `createDocumentFromSource` | mutation | Create document from external source |
| `createDocumentFromText` | mutation | Create document from raw text |
| `listDocumentsByFolder` | query | List documents in a folder |
| `countsByFolder` | query | Get document counts per folder |
| `deleteDocument` | mutation | Delete a document |
| `moveDocument` | mutation | Move document to a different folder |

### conversations

| Function | Type | Description |
|---|---|---|
| `listRecentForUser` | query | List recent conversations |
| `getMostRecentForFolder` | query | Get most recent conversation in folder |
| `getConversation` | query | Get conversation by ID |
| `createConversation` | mutation | Create a new conversation |
| `deleteConversation` | mutation | Delete a conversation |

### messages

| Function | Type | Description |
|---|---|---|
| `listByConversation` | query | List messages in a conversation |
| `appendMessage` | mutation | Append a message to a conversation |

### quizzes

| Function | Type | Description |
|---|---|---|
| `listByFolder` | query | List quizzes in a folder |
| `getWithQuestions` | query | Get quiz with all questions |
| `getAttemptResults` | query | Get results for a quiz attempt |
| `getQuizHistory` | query | Get quiz attempt history |
| `listAttempts` | query | List attempts for a quiz |
| `createWithQuestions` | mutation | Create quiz with questions |
| `updateQuiz` | mutation | Update quiz metadata |
| `addQuestion` | mutation | Add a question to a quiz |
| `updateQuestion` | mutation | Update a question |
| `deleteQuestion` | mutation | Delete a question |
| `startAttempt` | mutation | Start a quiz attempt |
| `submitAnswer` | mutation | Submit answer for a single question |
| `submitAllAnswers` | mutation | Submit all answers at once |
| `completeAttempt` | mutation | Complete a quiz attempt |
| `abandonAttempt` | mutation | Abandon an in-progress attempt |
| `submitAttempt` | mutation | Submit and complete an attempt |
| `deleteQuiz` | mutation | Delete a quiz |

### flashcardRooms

| Function | Type | Description |
|---|---|---|
| `listRoomsByFolder` | query | List flashcard rooms in a folder |
| `getRoom` | query | Get room with current cards |
| `listRoomVersions` | query | List version history for a room |
| `getRoomVersion` | query | Get a specific room version |
| `createRoom` | mutation | Create a new flashcard room |
| `renameRoom` | mutation | Rename a room |
| `createCard` | mutation | Add a card to a room |
| `updateCard` | mutation | Update a card |
| `deleteCard` | mutation | Delete a card |
| `reorderCards` | mutation | Reorder cards in a room |
| `generateRoomCards` | mutation | Replace cards with AI-generated set |
| `restoreRoomVersion` | mutation | Restore a previous version |
| `deleteRoom` | mutation | Delete a room |

### courses

| Function | Type | Description |
|---|---|---|
| `listByUser` | query | List all courses for the user |
| `listByFolder` | query | List courses in a folder |
| `get` | query | Get course by ID |
| `create` | mutation | Create a new course |
| `finalizeOutline` | mutation | Finalize course outline with sections |
| `updateOutline` | mutation | Update outline section metadata |
| `updatePace` | mutation | Update course learning pace |
| `startCourse` | mutation | Start a course |
| `deleteCourse` | action | Start or resume provider-first course deletion. Returns `{ deleted, pending }`; large or retrying cascades continue durably in bounded batches. |
| `markFailed` | mutation | Mark course as failed |

### courseSections

| Function | Type | Description |
|---|---|---|
| `get` | query | Get section by ID |
| `listByCourse` | query | List sections for a course |
| `getNextSection` | query | Get next incomplete section |
| `checkPreFetchStatus` | query | Check pre-fetch readiness |
| `getOfflineCachePayload` | query | Get offline cache data |
| `updateTitle` | mutation | Update section title |
| `updateKnowledgeType` | mutation | Update section knowledge type |
| `remove` | mutation | Remove a section |
| `create` | mutation | Create a new section |
| `updateOrder` | mutation | Reorder sections |
| `finalizeSectionGeneration` | mutation | Finalize generated content blocks |
| `triggerPreFetch` | mutation | Trigger pre-fetch for next section |
| `completeSection` | mutation | Mark section as completed |
| `setOfflineAvailable` | mutation | Toggle offline availability |
| `reviewSection` | mutation | Mark section for review |

### courseSourceDocs

| Function | Type | Description |
|---|---|---|
| `listByCourse` | query | List source documents for a course |

### users

| Function | Type | Description |
|---|---|---|
| `getUser` | query | Get current user profile |
| `getDailyQuota` | query | Get daily audio overview quota |
| `upsertUser` | mutation | Create or update user record |
| `incrementDailyQuota` | mutation | Increment daily quota counter |

### tasks

| Function | Type | Description |
|---|---|---|
| `listByFolder` | query | List tasks for a folder |
| `get` | query | Get task by ID |
| `create` | mutation | Create a new task |
| `setProgress` | mutation | Update task progress message |
| `markComplete` | mutation | Mark task as complete |
| `markFailed` | mutation | Mark task as failed |
| `cancel` | mutation | Cancel a task |
| `dismiss` | mutation | Dismiss a completed/failed task |
| `retry` | mutation | Retry a failed task |

### audioOverviews

| Function | Type | Description |
|---|---|---|
| `listByFolder` | query | List audio overviews in a folder |
| `getWithTurns` | query | Get overview with all turns |
| `getTurnUrls` | query | Get signed URLs for turn audio |
| `getCourseScopedOverview` | query | Get overview scoped to a course section |
| `getByShareToken` | query | Get published overview by share token |
| `getTurnUrlsByShareToken` | query | Get turn URLs for shared overview |
| `generateTurnUploadUrl` | mutation | Generate upload URL for audio turn |
| `createWithTurns` | mutation | Create overview with pre-uploaded turns |
| `createCourseScopedOverview` | mutation | Create course-scoped overview |
| `deleteOverview` | mutation | Delete an overview and its audio |
| `deleteOrphanTurnBlob` | mutation | Clean up orphaned audio blobs |
| `publishOverview` | mutation | Publish overview with share token |
| `unpublishOverview` | mutation | Unpublish a shared overview |

### audioOverviewInterjections

| Function | Type | Description |
|---|---|---|
| `listByOverview` | query | List interjections for an overview |
| `getTurnUrls` | query | Get signed URLs for interjection turns |
| `create` | mutation | Create a new interjection |
| `deleteInterjection` | mutation | Delete an interjection |

### calendarConnections

| Function | Type | Description |
|---|---|---|
| `getByUser` | query | Get calendar connection for user |
| `upsertConnection` | mutation | Create or update calendar connection |
| `updatePreferences` | mutation | Update scheduling preferences |
| `getTokens` | internal query | Read encrypted OAuth envelopes for server-side actions |
| `updateTokens` | internal mutation | Persist refreshed encrypted token envelopes |

### calendarEvents

| Function | Type | Description |
|---|---|---|
| `listByUser` | query | List all calendar events for user |
| `listByCourse` | query | List events for a course |
| `listScheduled` | query | List upcoming scheduled events |
| `createEvent` | mutation | Create a calendar event record |
| `updateStatus` | mutation | Update event status |

### contentFlags

| Function | Type | Description |
|---|---|---|
| `getFlagRateForCourse` | query | Get content flag rate for a course |
| `flagQuizQuestion` | mutation | Flag a quiz question |
| `unflagQuizQuestion` | mutation | Unflag a quiz question |
| `flagFlashcard` | mutation | Flag a flashcard |
| `unflagFlashcard` | mutation | Unflag a flashcard |

### learnProfile

| Function | Type | Description |
|---|---|---|
| `getProfile` | query | Get learn profile for current user |
| `setTimezone` | mutation | Set user timezone |
| `updateDailyReviewCap` | mutation | Update daily review cap |

### reviewItems

| Function | Type | Description |
|---|---|---|
| `listDueForUser` | query | List review items due for user |
| `getReviewBacklogCount` | query | Get count of due review items |
| `listDueWithContext` | query | List due items with course/section context |
| `listBySection` | query | List review items for a section |
| `completeReviewSession` | mutation | Complete a review session |
| `submitReview` | mutation | Submit a single review rating |

### dataExport

| Function | Type | Description |
|---|---|---|
| `getExportMetadata` | query | Return authenticated export metadata and schema version |
| `getUserDataPage` | query | Return one capped, owner-filtered page for an export dataset |
| `getAttemptAnswersPage` | query | Return a capped answer page scoped through an owned quiz attempt |
| `getCourseSourceDocsPage` | query | Return a capped source-document page scoped through an owned course |
| `getDocumentDownloadUrl` | query | Get download URL for a document |

### documentImports

| Function | Type | Description |
|---|---|---|
| `importDocumentFromUrl` | action | Import a document from a URL |

---

## 3. Auth Routes

Auth is handled by Better Auth running on Convex HTTP actions. The `convex/http.ts` router registers all Better Auth routes via `authComponent.registerRoutes(http, createAuth)`.

**Provider:** Google OAuth

**Key routes (registered under Convex HTTP):**

| Route | Description |
|---|---|
| `/api/auth/callback/google` | Google OAuth callback (redirect URI) |
| `/api/auth/session` | Session validation |
| `/api/auth/sign-in/social` | Initiate social sign-in |
| `/api/auth/sign-out` | Sign out |

**Nuxt proxy:** All `/api/auth/*` requests are proxied from the Nuxt server to Convex via `server/api/auth/[...].ts`.

**Session flow:** Server middleware (`server/middleware/convex-token.ts`) fetches Convex JWT tokens during SSR for authenticated server-side queries.

**Account deletion:** Enabled via Better Auth's `deleteUser` option. Its
`beforeDelete` hook derives the canonical Convex token identifier, persists an
idempotent deletion tombstone/job, and starts the bounded asynchronous cascade
before the auth record is removed.
