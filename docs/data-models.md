# Budds - Data Models

**Source of truth:** `convex/schema.ts`

Budds uses Convex as its document database. All tables are defined in a single schema file. Authentication tables are managed separately by the `@convex-dev/better-auth` component.

---

## 1. Auth & Users

### `users`

Application user profile, created/updated on first login via the `upsertUser` mutation.

| Field | Type | Notes |
|-------|------|-------|
| `tokenIdentifier` | `string` | Unique auth identity key |
| `name` | `string` | Display name |
| `email` | `string?` | Email address |
| `avatarUrl` | `string?` | Profile image URL |
| `audioOverviewQuota` | `object?` | Daily audio generation quota (`date: string`, `count: number`) |
| `learnV2Entitlement` | `object?` | Internal Learn V2 beta entitlement (`enabled: boolean`, `updatedAt: number`); omitted from the public `users.getUser` projection |

**Indexes:** `by_tokenIdentifier` (`tokenIdentifier`)

Better Auth manages its own tables (`user`, `session`, `account`, `verification`) through the `@convex-dev/better-auth` Convex component. These are not defined in `schema.ts`.

---

## 2. Folders & Documents

### `folders`

Top-level organizational container. Supports nesting via `parentId`.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `name` | `string` | Folder name |
| `parentId` | `Id<folders>?` | Self-referencing FK for nesting |
| `documentCount` | `number` | Cached count of contained documents |
| `updatedAt` | `number?` | Last modification timestamp |
| `description` | `string?` | User-provided description |
| `color` | `string?` | Display color |
| `icon` | `string?` | Display icon |
| `preferredMainPane` | `"chat" \| "podcast"?` | Default view when opening folder |
| `referenceScope` | `object?` | Scoped references: `folderIds: Id<folders>[]?`, `fileIds: Id<documents>[]?` |

**Indexes:** `by_userId`, `by_userId_and_parentId`

### `documents`

Files uploaded or imported into a folder. Supports file uploads, website imports, and YouTube sources.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>` | Parent folder FK |
| `filename` | `string` | Display name |
| `fileId` | `Id<_storage>?` | Convex storage reference |
| `status` | `"processing" \| "indexing" \| "success" \| "failed"` | Processing pipeline status |
| `fileSize` | `number` | Size in bytes |
| `failureReason` | `string?` | Error message on failure |
| `indexJobId` | `string?` | External indexing job identifier |
| `r2Key` | `string?` | Cloudflare R2 object key |
| `sourceType` | `"file" \| "website" \| "youtube"?` | Import source type |
| `sourceUrl` | `string?` | Original URL for web/YouTube sources |
| `mimeType` | `string?` | File MIME type |
| `taskId` | `Id<tasks>?` | Associated background task FK |

**Indexes:** `by_userId`, `by_folderId`, `by_userId_and_folderId`, `by_status`

---

## 3. Conversations & Messages

### `conversations`

Chat conversation threads scoped to a folder.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>` | Parent folder FK |
| `title` | `string` | Conversation title |
| `archivedAt` | `number?` | Archive timestamp (soft delete) |

**Indexes:** `by_userId`, `by_userId_and_folderId`

### `messages`

Individual messages within a conversation. Supports RAG source citations and audio overview interjection context.

| Field | Type | Notes |
|-------|------|-------|
| `conversationId` | `Id<conversations>` | Parent conversation FK |
| `userId` | `string` | Owner |
| `role` | `"user" \| "assistant"` | Message author role |
| `content` | `string` | Message text (markdown) |
| `sources` | `array?` | RAG citations: `{ content, score, filename }[]` |
| `model` | `string?` | AI model used for assistant messages |
| `interjectionContext` | `object?` | Audio overview context: `overviewId`, `turnIndex`, `timeMs`, `quotedText`, `sourceFilename?`, `interjectionId?` |

**Indexes:** `by_conversationId`, `by_userId`

---

## 4. Learning (Courses, Sections, Learn Profile)

### `courses`

AI-generated courses derived from folder documents and/or web search.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>` | Parent folder FK |
| `title` | `string` | Course title |
| `status` | `"generating" \| "ready" \| "failed"` | Generation status |
| `sourceType` | `"folder" \| "web-only"` | Content source type |
| `sourceConfidence` | `object` | `{ docCount: number, webPercent: number }` |
| `pace` | `"intensive" \| "steady" \| "relaxed"` | Learning pace |
| `outlineSections` | `array` | Section outline: `{ title, description, knowledgeType, order }[]` |
| `completedSectionCount` | `number` | Progress tracker |
| `totalSectionCount` | `number` | Total sections |
| `taskId` | `Id<tasks>?` | Background generation task FK |
| `webSearchEnabled` | `boolean` | Whether web search was used |
| `createdAt` | `number` | Creation timestamp |
| `updatedAt` | `number` | Last update timestamp |

**Indexes:** `by_userId`, `by_userId_and_folderId`, `by_folderId`

### `courseSections`

Individual sections within a course. Each section contains content blocks that reference quizzes, flashcards, or audio overviews.

| Field | Type | Notes |
|-------|------|-------|
| `courseId` | `Id<courses>` | Parent course FK |
| `userId` | `string` | Owner |
| `order` | `number` | Display order |
| `title` | `string` | Section title |
| `knowledgeType` | `"factual" \| "conceptual" \| "procedural" \| "mixed"` | Content classification |
| `status` | `"locked" \| "generating" \| "ready" \| "completed" \| "failed"` | Section lifecycle status |
| `contentBlocks` | `array` | Ordered blocks: `{ type, entityId?, entityType?, content?, order }[]` |
| `failureNotice` | `string?` | Error details on failure |
| `practiceScore` | `number?` | Latest practice score |
| `masteryLevel` | `"new" \| "learning" \| "reviewing" \| "mastered"` | Spaced repetition mastery |
| `consecutiveReviewPasses` | `number?` | Consecutive successful reviews |
| `reviewHistory` | `array?` | Past reviews: `{ score, quizCorrect, quizTotal, at }[]` |
| `completedAt` | `number?` | Completion timestamp |
| `offlineAvailable` | `boolean?` | Cached for offline use |
| `taskId` | `Id<tasks>?` | Background generation task FK |

**Indexes:** `by_courseId`, `by_courseId_and_order`, `by_userId`

### `courseSourceDocs`

Junction table linking courses to their source documents and folders.

| Field | Type | Notes |
|-------|------|-------|
| `courseId` | `Id<courses>` | Course FK |
| `documentId` | `Id<documents>?` | Source document FK |
| `folderId` | `Id<folders>?` | Source folder FK |
| `userId` | `string` | Owner |

**Indexes:** `by_courseId`

### `learnProfile`

Per-user learning preferences and streak tracking.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner (unique per user) |
| `streakCurrent` | `number` | Current daily streak count |
| `streakLastDate` | `string?` | Last activity date (YYYY-MM-DD) |
| `streakFreezeAvailable` | `boolean` | Whether a streak freeze is available |
| `streakFreezeUsedAt` | `string?` | Date streak freeze was last used |
| `dailyReviewCap` | `number` | Maximum daily review items |
| `timezone` | `string?` | User timezone |

**Indexes:** `by_userId`

---

## 5. Flashcards & Review

### `flashcardSets` (legacy)

Original flashcard set model. Superseded by `flashcardRooms`.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>` | Parent folder FK |
| `title` | `string` | Set title |
| `status` | `"generating" \| "ready" \| "failed"` | Generation status |
| `failureReason` | `string?` | Error on failure |
| `model` | `string?` | AI model used |
| `cardCount` | `number` | Number of cards |

**Indexes:** `by_userId`, `by_folderId`, `by_userId_and_folderId`

### `flashcards` (legacy)

Cards belonging to a legacy `flashcardSets`.

| Field | Type | Notes |
|-------|------|-------|
| `setId` | `Id<flashcardSets>` | Parent set FK |
| `userId` | `string` | Owner |
| `order` | `number` | Display order |
| `front` | `string` | Card front (term/question) |
| `back` | `string` | Card back (answer) |
| `sourceDocumentId` | `Id<documents>?` | Source document FK |
| `sourceChunkContent` | `string` | RAG chunk used to generate card |
| `sourceFilename` | `string` | Source filename |

**Indexes:** `by_setId`, `by_userId`

### `flashcardRooms`

Current flashcard container with version history and course integration.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>` | Parent folder FK |
| `title` | `string` | Room title |
| `updatedAt` | `number` | Last update timestamp |
| `cardCount` | `number?` | Total cards ever generated |
| `currentCardCount` | `number?` | Active card count |
| `activeVersionId` | `Id<flashcardRoomVersions>?` | Current active version FK |
| `migratedFromSetId` | `Id<flashcardSets>?` | Legacy set this was migrated from |
| `legacySetId` | `Id<flashcardSets>?` | Associated legacy set |
| `legacyCreatedAt` | `number?` | Original creation time |
| `courseScoped` | `boolean?` | Whether this room belongs to a course |

**Indexes:** `by_userId`, `by_userId_and_folderId`, `by_migratedFromSetId`

### `flashcardRoomCards`

Active cards within a flashcard room. Supports content flagging for corrections.

| Field | Type | Notes |
|-------|------|-------|
| `roomId` | `Id<flashcardRooms>` | Parent room FK |
| `userId` | `string` | Owner |
| `displayOrder` | `number` | Display order |
| `term` | `string` | Card front |
| `definition` | `string` | Card back |
| `metadata` | `object?` | Source info and generation metadata |
| `sourceDocumentId` | `Id<documents>?` | Source document FK |
| `sourceChunkContent` | `string?` | RAG chunk content |
| `sourceFilename` | `string?` | Source filename |
| `updatedAt` | `number?` | Last update timestamp |
| `flagged` | `boolean?` | User-flagged as incorrect |
| `correctedDefinition` | `string?` | User-provided correction |
| `flaggedAt` | `number?` | When flagged |

**Indexes:** `by_roomId`, `by_roomId_and_displayOrder`, `by_userId`

### `flashcardRoomVersions`

Version snapshots for flashcard rooms, tracking generation history.

| Field | Type | Notes |
|-------|------|-------|
| `roomId` | `Id<flashcardRooms>` | Parent room FK |
| `userId` | `string` | Owner |
| `title` | `string` | Version title |
| `origin` | `string` | How created (e.g. "manual", "ai") |
| `prompt` | `string?` | Generation prompt |
| `requestedCardCount` | `number?` | Requested number of cards |
| `cardCount` | `number?` | Actual cards generated |
| `model` | `string?` | AI model used |
| `createdAt` | `number?` | Creation timestamp |

**Indexes:** `by_roomId`, `by_userId`

### `flashcardVersionCards`

Cards belonging to a specific version snapshot.

| Field | Type | Notes |
|-------|------|-------|
| `versionId` | `Id<flashcardRoomVersions>` | Parent version FK |
| `roomId` | `Id<flashcardRooms>` | Room FK |
| `userId` | `string` | Owner |
| `displayOrder` | `number` | Display order |
| `term` | `string` | Card front |
| `definition` | `string` | Card back |
| `metadata` | `object?` | Source and generation metadata |
| `sourceDocumentId` | `Id<documents>?` | Source document FK |
| `sourceChunkContent` | `string?` | RAG chunk content |
| `sourceFilename` | `string?` | Source filename |
| `updatedAt` | `number?` | Last update timestamp |

**Indexes:** `by_versionId`, `by_roomId`, `by_userId`

### `reviewItems`

Spaced repetition items derived from course flashcards, using SM-2 algorithm fields.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `courseId` | `Id<courses>` | Course FK |
| `sectionId` | `Id<courseSections>` | Section FK |
| `flashcardRoomCardId` | `Id<flashcardRoomCards>?` | Source flashcard FK |
| `prompt` | `string` | Review prompt (term) |
| `answer` | `string` | Expected answer |
| `easeFactor` | `number` | SM-2 ease factor |
| `interval` | `number` | Days until next review |
| `repetitions` | `number` | Successful repetition count |
| `nextReviewDate` | `string` | Next review date (YYYY-MM-DD) |
| `lastReviewQuality` | `number?` | Last review quality score (0-5) |
| `lastReviewedAt` | `number?` | Timestamp of last review |
| `flagged` | `boolean` | User-flagged as incorrect |
| `correctedAnswer` | `string?` | User-provided correction |
| `createdAt` | `number` | Creation timestamp |

**Indexes:** `by_userId`, `by_userId_and_nextReviewDate`, `by_courseId`, `by_sectionId`, `by_flashcardRoomCardId`

### `reviewSessions`

Aggregated records of completed review sessions.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `date` | `string` | Session date (YYYY-MM-DD) |
| `itemsReviewed` | `number` | Total items reviewed |
| `itemsCorrect` | `number` | Correct answers |
| `durationMs` | `number` | Session duration |
| `mode` | `"full" \| "quick"?` | Review mode |
| `completedAt` | `number` | Completion timestamp |

**Indexes:** `by_userId`, `by_userId_and_date`

---

## 6. Quizzes

### `quizzes`

AI-generated quizzes scoped to a folder.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>` | Parent folder FK |
| `title` | `string` | Quiz title |
| `status` | `"generating" \| "ready" \| "failed"` | Generation status |
| `failureReason` | `string?` | Error on failure |
| `model` | `string?` | AI model used |
| `score` | `number?` | Best score |
| `completedAt` | `number?` | First completion timestamp |
| `description` | `string?` | Quiz description |
| `creationMethod` | `"manual" \| "auto_generated"?` | How the quiz was created |
| `difficulty` | `string?` | Difficulty level |
| `language` | `string?` | Quiz language |
| `questionCount` | `number?` | Number of questions |
| `latestAttemptStatus` | `"in_progress" \| "completed" \| "abandoned"?` | Current attempt state |
| `courseScoped` | `boolean?` | Whether this quiz belongs to a course |

**Indexes:** `by_userId`, `by_folderId`, `by_userId_and_folderId`

### `quizQuestions`

Individual questions within a quiz. Supports content flagging.

| Field | Type | Notes |
|-------|------|-------|
| `quizId` | `Id<quizzes>` | Parent quiz FK |
| `userId` | `string` | Owner |
| `order` | `number` | Display order |
| `question` | `string` | Question text |
| `type` | `"multiple-choice" \| "free-response" \| "true_false" \| "fill_in_the_blank"` | Question type |
| `options` | `string[]?` | Answer options (for multiple-choice) |
| `correctAnswer` | `string` | Correct answer |
| `explanation` | `string?` | Answer explanation |
| `sourceDocumentId` | `Id<documents>?` | Source document FK |
| `sourceChunkContent` | `string?` | RAG chunk used |
| `sourceFilename` | `string?` | Source filename |
| `flagged` | `boolean?` | User-flagged as incorrect |
| `correctedAnswer` | `string?` | User correction |
| `correctedExplanation` | `string?` | User explanation correction |
| `flaggedAt` | `number?` | When flagged |

**Indexes:** `by_quizId`, `by_userId`

### `quizAttempts`

Records of quiz attempt sessions with progress tracking.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `quizId` | `Id<quizzes>` | Quiz FK |
| `answers` | `array?` | Inline answers: `{ questionId, response, isCorrect }[]` |
| `score` | `number` | Current score |
| `total` | `number` | Total questions |
| `completedAt` | `number?` | Completion timestamp |
| `status` | `"in_progress" \| "completed" \| "abandoned"?` | Attempt status |
| `settingsSnapshot` | `object?` | Quiz settings at start: `{ shuffleQuestions, showAllQuestions, immediateFeedback }` |
| `currentQuestionIndex` | `number?` | Resume position |
| `startedAt` | `number?` | Start timestamp |
| `questionOrder` | `Id<quizQuestions>[]?` | Shuffled question order |

**Indexes:** `by_userId`, `by_quizId`, `by_userId_and_quizId`, `by_quizId_and_status`

### `attemptAnswers`

Individual answers within a quiz attempt (normalized form).

| Field | Type | Notes |
|-------|------|-------|
| `attemptId` | `Id<quizAttempts>` | Parent attempt FK |
| `questionId` | `Id<quizQuestions>` | Question FK |
| `userAnswer` | `string` | User's answer |
| `isCorrect` | `boolean` | Whether answer was correct |
| `feedback` | `string?` | AI-generated feedback |
| `answeredAt` | `number` | Answer timestamp |

**Indexes:** `by_attemptId`, `by_attemptId_and_questionId`

---

## 7. Audio Overviews

### `audioOverviews`

AI-generated podcast-style audio overviews of folder content.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>` | Parent folder FK |
| `taskId` | `Id<tasks>?` | Background generation task FK |
| `title` | `string` | Overview title |
| `status` | `"generating" \| "ready" \| "failed"` | Generation status |
| `failureReason` | `string?` | Error on failure |
| `model` | `string?` | AI model used |
| `turns` | `array` | Audio turns: `{ speaker, text, audioFileId, durationMs, sourceIndex? }[]` |
| `voiceProfile` | `object` | Voice config: `{ hostA: string, hostB: string }` |
| `preferences` | `object?` | User prefs: `{ lengthMinutes, complexity }` |
| `totalDurationMs` | `number` | Total audio duration |
| `sourceDocumentIds` | `Id<documents>[]?` | Source documents |
| `shareToken` | `string?` | Public share token |
| `publishedAt` | `number?` | When published/shared |
| `scopeDocIds` | `Id<documents>[]?` | Scoped document subset |
| `courseScoped` | `boolean?` | Whether this belongs to a course |

**Indexes:** `by_userId`, `by_folderId`, `by_userId_and_folderId`, `by_shareToken`

### `audioOverviewInterjections`

User questions injected into an audio overview timeline, with AI-generated answer turns.

| Field | Type | Notes |
|-------|------|-------|
| `audioOverviewId` | `Id<audioOverviews>` | Parent overview FK |
| `userId` | `string` | Owner |
| `insertedAfterTurnIndex` | `number` | Position in turn sequence |
| `question` | `string` | User's question |
| `model` | `string?` | AI model used |
| `chatMessageId` | `Id<messages>?` | Linked chat message FK |
| `answerTurns` | `array` | Response turns: `{ speaker, text, audioFileId, durationMs, sourceIndex? }[]` |

**Indexes:** `by_audioOverview`, `by_userId`

---

## 8. Calendar

### `calendarConnections`

Google Calendar OAuth connections for scheduling study sessions.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `provider` | `"google"` | Calendar provider |
| `accessToken` | `string` | OAuth access token |
| `refreshToken` | `string` | OAuth refresh token |
| `expiresAt` | `number` | Token expiration |
| `timezone` | `string` | User timezone |
| `status` | `"connected" \| "disconnected"` | Connection status |
| `connectedAt` | `number` | Connection timestamp |
| `preferences` | `object?` | Scheduling prefs: `{ morningStart, eveningEnd, sessionMinutes, preferredDays }` |

**Indexes:** `by_userId`

### `calendarEvents`

Scheduled study sessions linked to courses.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `calendarConnectionId` | `Id<calendarConnections>` | Connection FK |
| `calendarEventId` | `string` | External Google Calendar event ID |
| `courseId` | `Id<courses>` | Course FK |
| `scheduledAt` | `number` | Scheduled timestamp |
| `sessionType` | `"new-content" \| "review" \| "audio-only"` | Session type |
| `status` | `"scheduled" \| "completed" \| "missed" \| "rescheduled"` | Event status |
| `description` | `string?` | Event description |

**Indexes:** `by_userId`, `by_courseId`, `by_userId_and_status`

---

## 9. Tasks

### `tasks`

Background task tracking for long-running operations (document processing, AI generation).

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `folderId` | `Id<folders>?` | Associated folder FK |
| `type` | `string` | Task type identifier |
| `status` | `string` | Current status |
| `title` | `string` | Display title |
| `progress` | `string?` | Progress description |
| `metadata` | `any?` | Task-specific data |
| `result` | `any?` | Task output |
| `error` | `string?` | Error message |
| `createdAt` | `number` | Creation timestamp |
| `updatedAt` | `number` | Last update timestamp |
| `completedAt` | `number?` | Completion timestamp |

**Indexes:** `by_userId_and_folderId`, `by_userId`, `by_status`

---

## 10. Content Flags

Content flagging is not a separate table. Instead, flagging fields (`flagged`, `correctedAnswer`, `correctedDefinition`, `correctedExplanation`, `flaggedAt`) are embedded directly on `quizQuestions`, `flashcardRoomCards`, and `reviewItems`. The `convex/contentFlags.ts` module provides mutations (`flagQuizQuestion`, `unflagQuizQuestion`, `flagFlashcard`, `unflagFlashcard`) and a query (`getFlagRateForCourse`) that operate across these tables.

---

## 11. Cleanup

### `pendingCleanup`

Queue for deferred resource cleanup (external index entries, R2 objects).

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `string` | Owner |
| `documentId` | `string` | Document identifier |
| `r2Key` | `string?` | R2 object key to delete |
| `kind` | `"ai-search" \| "r2"` | Cleanup type |
| `attempts` | `number` | Retry count |
| `lastAttemptAt` | `number?` | Last attempt timestamp |
| `lastError` | `string?` | Last error message |

**Indexes:** `by_userId`, `by_kind_and_attempts`

---

## Relationship Diagram

```
users
  └─ folders (userId)
       ├─ folders (parentId) [self-ref nesting]
       ├─ documents (folderId)
       ├─ conversations (folderId)
       │    └─ messages (conversationId)
       ├─ quizzes (folderId)
       │    ├─ quizQuestions (quizId)
       │    └─ quizAttempts (quizId)
       │         └─ attemptAnswers (attemptId)
       ├─ flashcardSets (folderId) [legacy]
       │    └─ flashcards (setId)
       ├─ flashcardRooms (folderId)
       │    ├─ flashcardRoomCards (roomId)
       │    └─ flashcardRoomVersions (roomId)
       │         └─ flashcardVersionCards (versionId)
       ├─ audioOverviews (folderId)
       │    └─ audioOverviewInterjections (audioOverviewId)
       ├─ courses (folderId)
       │    ├─ courseSections (courseId)
       │    ├─ courseSourceDocs (courseId)
       │    ├─ reviewItems (courseId, sectionId)
       │    └─ calendarEvents (courseId)
       └─ tasks (folderId)

learnProfile (userId) [1:1 per user]
reviewSessions (userId)
calendarConnections (userId)
pendingCleanup (userId)
```
