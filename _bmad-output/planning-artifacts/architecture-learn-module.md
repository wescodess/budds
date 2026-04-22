---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-22'
inputDocuments:
  - prd-learn-module.md
  - product-brief-learn-module.md
  - product-brief-learn-module-distillate.md
  - architecture.md
  - project-context.md
  - docs/architecture.md
  - docs/data-models.md
  - docs/api-contracts.md
workflowType: 'architecture'
project_name: 'budds-learn-module'
user_name: 'palmwine'
date: '2026-04-22'
---

# Architecture Decision Document — Budds Learn Module

_Architecture decisions for the Learn module, extending the base Budds architecture. All existing architectural decisions from the base architecture document remain in effect unless explicitly overridden here._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

48 functional requirements organized across 7 capability areas:

| Area | FRs | Architectural Weight |
|---|---|---|
| Course Management | FR1-FR13 | High — course creation pipeline, outline generation, web search integration, JIT orchestration, pre-fetch |
| Section Learning | FR14-FR21 | High — content-type classification, multi-engine orchestration, audio primer generation, adaptive pacing |
| Progress & Mastery | FR22-FR27 | Medium — progress tracking, mastery state machine, streak system |
| Spaced Repetition (fast-follow) | FR28-FR34 | High — SM-2 algorithm, review scheduling, cross-course budgeting, priority queue |
| Content Quality | FR35-FR38 | Low — flagging/correction CRUD, flag rate tracking |
| Calendar Integration (fast-follow) | FR39-FR44 | Medium — Google Calendar OAuth, event CRUD, adaptive composition, rescheduling |
| Offline Access (fast-follow) | FR45-FR48 | Medium — browser storage, offline retakes, queued sync |

Course Management and Section Learning carry the heaviest architectural load. The JIT section generation pipeline — coordinating outline context, content-type classification, and 4 existing generation engines (quiz, flashcard, audio, RAG chat) into a single section — is the core architectural challenge.

**Non-Functional Requirements:**

29 NFRs across 6 categories. Key architectural drivers:

- **Performance:** Outline generation <15-20s, section generation <30s (text+quiz+flashcard) + 30s (audio), pre-fetched sections <500ms, review session load <2s
- **Security:** Per-user course isolation at Convex query level, calendar OAuth tokens server-only, offline content encrypted at rest
- **Scalability:** 100+ concurrent section generations, 1000+ review items per user, cost tracking per course
- **Integration:** Reuse existing quiz/flashcard/audio APIs with orchestration wrappers — no parallel implementations. Graceful degradation if individual engine fails.

**Scale & Complexity:**

- Complexity level: High — multi-engine orchestration, spaced repetition scheduling, calendar API integration, offline sync, knowledge-type classification
- New architectural components: ~6 (course engine, section orchestrator, SR scheduler, calendar connector, offline sync, web search)
- Integration surface: 4 existing generation engines + 2 new external APIs (Google Calendar, web search provider)

### Technical Constraints & Dependencies

**Existing Stack (inherited from base architecture):**
- Nuxt 4 + Vue 3 + Tailwind CSS 4 + shadcn-nuxt (Reka UI) — frontend
- Convex 1.34.1 — application data (18 tables, real-time subscriptions)
- Cloudflare AI Search + AI Gateway + OpenRouter — RAG pipeline and LLM routing
- Better Auth on Convex HTTP actions — authentication
- Cloudflare R2 — file storage
- Tasks table — generic async job runner

**Critical Constraints:**
1. **Existing API reuse is mandatory.** NFR20-22 require Learn sections to use existing `/api/quiz/generate`, `/api/flashcards/generate`, and `/api/audio-overview/generate` endpoints with orchestration wrappers. No parallel implementations.
2. **Course-scoped entities must be invisible in folder tabs.** Quizzes, flashcards, and audio generated within a course exist only in the course graph. This requires a `courseId`/`sectionId` field on existing entity tables or new course-specific tables.
3. **The tasks table is the async job backbone.** Course outline generation, section generation, and N+1 pre-fetch all run as async tasks using the existing tasks system.
4. **Web search requires a new provider.** Cloudflare AI Search indexes user documents only. Course web supplementation needs a separate search API (architecture decision below).
5. **No offline infrastructure exists.** Learn introduces offline as a new app-level capability. Service worker, IndexedDB caching, and background sync are all net-new.

### Cross-Cutting Concerns

1. **Multi-engine orchestration** — A single section generation coordinates quiz, flashcard, audio, and text content. Engine failures must degrade gracefully (serve remaining formats) rather than blocking the section.

2. **Course-scoped vs folder-scoped entity isolation** — The same quiz/flashcard/audio engines produce two kinds of entities: ad-hoc (folder-visible, user-initiated) and course-scoped (course-visible only, system-orchestrated). The data model must distinguish these without forking the generation logic.

3. **Spaced repetition across courses** — Review items from multiple courses share a single daily review session. Cross-course scheduling requires a unified priority queue with configurable capacity limits.

4. **Offline-online state reconciliation** — Offline retake attempts must sync with original timestamps. The sync mechanism must handle conflict resolution (same item reviewed online and offline in the gap).

5. **Per-user cost tracking per course** — Each course triggers multiple AI calls. Cost attribution must be granular enough to support per-course budgets and rate limiting.

## Starter Template Evaluation

**Not applicable — brownfield project.** All existing stack decisions from the base architecture document carry forward. The Learn module adds new Convex tables, server API routes, Vue pages, and composables within the established project structure.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Data model for courses, sections, and course-scoped entities
2. Section orchestration pattern (how JIT generation coordinates 4 engines)
3. Web search provider for course supplementation

**Important Decisions (Shape Architecture):**
4. Spaced repetition data model and scheduling approach
5. Content-type classification mechanism
6. Offline storage and sync strategy
7. Calendar integration approach

**Deferred Decisions (Post-MVP):**
8. Apple Calendar integration (CalDAV — V1.1)
9. Push notification infrastructure (V1.1)
10. Course sharing data model (V1.2)

### Data Architecture

**Decision: New Convex tables for Learn module entities; course-scoped flag on orchestrated content**

New tables:

```
courses
├── userId: string
├── folderId: optional(id('folders'))     // null for top-level courses
├── title: string
├── status: 'generating' | 'ready' | 'failed'
├── sourceType: 'folder' | 'cross-folder' | 'web-only'
├── sourceConfidence: object({ docCount, webPercent })
├── pace: 'intensive' | 'steady' | 'relaxed'
├── outlineSections: array(object({ title, description, knowledgeType, order }))
├── completedSectionCount: number
├── totalSectionCount: number
├── taskId: optional(id('tasks'))
├── webSearchEnabled: boolean
├── createdAt: number
├── updatedAt: number
indexes: by_userId, by_userId_and_folderId, by_folderId

courseSections
├── courseId: id('courses')
├── userId: string
├── order: number
├── title: string
├── knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'mixed'
├── status: 'locked' | 'generating' | 'ready' | 'completed' | 'failed'
├── contentBlocks: array(object({
│     type: 'text' | 'quiz' | 'flashcard' | 'audio',
│     entityId: optional(string),   // references course-scoped entity
│     content: optional(string),    // for text blocks
│     order: number
│   }))
├── practiceScore: optional(number)        // 0-100 accuracy
├── masteryLevel: 'new' | 'learning' | 'reviewing' | 'mastered'
├── completedAt: optional(number)
├── offlineAvailable: boolean
├── taskId: optional(id('tasks'))
indexes: by_courseId, by_courseId_and_order, by_userId

courseSourceDocs
├── courseId: id('courses')
├── documentId: optional(id('documents'))
├── folderId: optional(id('folders'))
├── userId: string
indexes: by_courseId

reviewItems (fast-follow)
├── userId: string
├── courseId: id('courses')
├── sectionId: id('courseSections')
├── type: 'flashcard' | 'cloze' | 'quiz-question'
├── prompt: string
├── answer: string
├── easeFactor: number              // SM-2 default 2.5
├── interval: number                // days
├── repetitions: number
├── nextReviewDate: string          // ISO date
├── lastReviewQuality: optional(number)  // 0-5 SM-2 scale
├── lastReviewedAt: optional(number)
├── flagged: boolean
├── flagReason: optional(string)
├── correctedAnswer: optional(string)
indexes: by_userId, by_userId_and_nextReviewDate, by_courseId, by_sectionId

learnProfile
├── userId: string                         // one per user
├── streakCurrent: number
├── streakLastDate: optional(string)       // ISO date
├── streakFreezeAvailable: boolean
├── streakFreezeUsedAt: optional(string)
├── dailyReviewCap: number                 // default 50
├── timezone: optional(string)
indexes: by_userId

reviewSessions (fast-follow)
├── userId: string
├── date: string                    // ISO date
├── itemsReviewed: number
├── itemsCorrect: number
├── durationMs: number
├── completedAt: optional(number)
indexes: by_userId, by_userId_and_date

calendarConnections (fast-follow)
├── userId: string
├── provider: 'google'
├── accessToken: string             // encrypted
├── refreshToken: string            // encrypted
├── expiresAt: number
├── timezone: string
├── preferences: object({
│     morningStart: string,         // "08:00"
│     eveningEnd: string,           // "21:00"
│     sessionMinutes: number,
│     preferredDays: array(string)
│   })
indexes: by_userId

calendarEvents (fast-follow)
├── userId: string
├── courseId: id('courses')
├── calendarEventId: string         // Google Calendar event ID
├── scheduledAt: number
├── sessionType: 'new-content' | 'review' | 'audio'
├── status: 'scheduled' | 'completed' | 'missed' | 'rescheduled'
indexes: by_userId, by_courseId, by_status
```

**Course-scoped entity strategy:** Rather than adding a `courseId` column to existing quiz/flashcard/audio tables (which would pollute the existing data model), course sections reference entities by ID in `contentBlocks[].entityId`. The entities are created through existing generation endpoints but with a `courseScoped: true` flag that prevents them from appearing in folder tab queries. Existing folder-tab queries filter on `courseScoped !== true`.

**Rationale:** This keeps the existing data model clean while enabling course orchestration. The `courseScoped` flag is a minimal schema change to existing tables. Convex's real-time subscriptions on `courseSections` drive the section UI.

### Section Orchestration Pattern

**Decision: Task-based pipeline with parallel engine dispatch**

Section generation flow:

```
User opens section N
  → Check if section N is ready (status: 'ready')
    → If ready: render immediately
    → If locked/generating: show skeleton, section was not pre-fetched in time
  → Trigger pre-fetch for section N+1 (if not already running)

Section generation pipeline (runs as a task):
  1. Classify content type from outline + source documents
  2. Dispatch engines in parallel:
     - Text explanation → LLM call via AI Gateway
     - Quiz questions → POST /api/quiz/generate (with courseScoped flag)
     - Flashcards → POST /api/flashcards/generate (with courseScoped flag)
     - Audio primer → POST /api/audio-overview/generate (short-form, courseScoped)
  3. Assemble contentBlocks from engine responses
  4. Update section status to 'ready'
  5. Auto-trigger N+1 pre-fetch
```

**Adaptive pacing integration:** After section completion, the orchestrator reads `practiceScore`. If <60%, it adjusts the next section's generation parameters (more foundational quiz questions, simpler flashcards). If >90%, it reduces practice block size.

**Engine failure handling:** Each engine dispatch is independent. If audio TTS fails, the section is still marked `ready` with the audio block omitted and a notification shown. The section is never blocked by a single engine failure.

**Rationale:** The tasks table already handles async job management with progress tracking and error reporting. Parallel engine dispatch minimizes section generation latency. The existing generation endpoints are reused with minimal modification (adding `courseScoped` and `courseId/sectionId` context parameters).

### Web Search Provider

**Decision: Use Cloudflare AI Gateway to route web search queries through a search-augmented LLM call**

Rather than integrating a dedicated web search API (which adds cost and complexity), web supplementation uses the existing AI Gateway + OpenRouter infrastructure. The LLM (with web search enabled via OpenRouter's `web-search` parameter where supported, or via a search-capable model like Perplexity) generates supplementary content based on the topic and outline.

**Fallback:** If the primary model doesn't support web search natively, use a two-step approach:
1. Generate search queries from the outline section description
2. Use a search-capable model to retrieve and synthesize web content
3. Feed synthesized content back to the section generation pipeline

**Rationale:** Minimizes new external dependencies. Leverages existing AI Gateway infrastructure and cost tracking. The quality of web-supplemented content is bounded by LLM capability, which is acceptable for the MVP.

### Content-Type Classification

**Decision: LLM-based classification during outline generation**

During course outline generation, the LLM classifies each section as `factual`, `conceptual`, `procedural`, or `mixed` based on the section title, description, and source document analysis. The classification is stored in `outlineSections[].knowledgeType` and `courseSections.knowledgeType`.

Users can override the classification via the outline editor (FR5) or per-section format override (FR16). Override rate is tracked as a quality metric.

**Rationale:** LLM classification is good enough for MVP. The user override valve prevents bad classifications from producing poor sections. Tracking override rate provides signal for improving classification prompts.

### Spaced Repetition Scheduling (Fast-Follow)

**Decision: Modified SM-2 with invisible UX**

SM-2 parameters per review item:
- `easeFactor`: starts at 2.5, adjusted by quality rating
- `interval`: days until next review (starts at 1)
- `repetitions`: count of successful reviews

Quality mapping from user input:
- "Again" → quality 0 (reset interval to 1, repetitions to 0)
- "Hard" → quality 3 (interval × 1.2)
- "Good" → quality 4 (interval × easeFactor)
- "Easy" → quality 5 (interval × easeFactor × 1.3)

**Cross-course budgeting:** Daily review session queries `reviewItems` where `nextReviewDate <= today`, ordered by `nextReviewDate ASC` (most overdue first). A user-level daily cap (default 50 items, configurable) limits session size. If backlog exceeds 2× cap, a warning is shown during course creation.

**Rationale:** SM-2 is proven and simple to implement. The invisible UX (no interval numbers, no algorithm settings) matches the product philosophy. Cross-course budgeting via a single query with ordering prevents Anki-style review debt.

### Offline Storage & Sync (Fast-Follow)

**Decision: Service Worker + IndexedDB with background sync**

**Storage:** Completed sections cached in IndexedDB keyed by `sectionId`. Content includes text blocks, quiz questions/answers, flashcard terms/definitions. Audio files cached in Cache API (larger binary data).

**Offline retakes:** Quiz and flashcard interactions while offline write to an IndexedDB `offlineAttempts` queue with original timestamps.

**Sync:** On reconnect, a background sync task reads `offlineAttempts`, sends them to Convex mutations, and clears the queue. Conflict resolution: if the same review item was reviewed both online and offline, the most recent attempt wins (by timestamp).

**Offline indicator:** Each section has an `offlineAvailable` boolean. Sections are cached on completion. A "Download for offline" action is available for not-yet-completed sections the user wants to cache proactively.

**Rationale:** Service Worker + IndexedDB is the standard browser offline pattern. Keeping sync simple (last-write-wins by timestamp) avoids complex conflict resolution for an edge case (simultaneous online/offline review of same item). The Cache API handles audio binary data more efficiently than IndexedDB.

### Calendar Integration (Fast-Follow)

**Decision: Google Calendar API v3 with server-side OAuth and Convex-stored tokens**

**OAuth flow:** User connects calendar from Learn settings. OAuth consent screen requests `calendar.events` scope with `offline_access` for refresh tokens. Tokens stored encrypted in `calendarConnections` table.

**Event creation:** Server-side Nitro API route (`/api/calendar/sync.post`) creates/updates calendar events. Events include:
- Title: `[Budds] {course_name} - {session_type}`
- Description: Session composition (e.g., "15 min: Section 5 + 8 review items")
- Deep link to app in event description
- Color-coded by session type

**Adaptive composition:** Morning events (before 12:00 user timezone) favor new content. Evening events favor review. Commute-length slots (≤15 min) get audio-only sessions.

**Rescheduling:** A Convex scheduled function runs hourly, checks for missed sessions (`scheduledAt < now AND status = 'scheduled'`), and auto-reschedules to the next available slot based on user preferences.

**Rationale:** Server-side OAuth keeps tokens secure. Convex scheduled functions handle the rescheduling cron. The adaptive composition rules are simple time-based heuristics that can be refined with usage data.

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Course-related Convex tables:** `courses`, `courseSections`, `courseSourceDocs`, `reviewItems`, `reviewSessions`, `calendarConnections`, `calendarEvents` — snake_case for compound table names consistent with existing schema.

**Course-related Convex functions:** `convex/courses.ts`, `convex/courseSections.ts`, `convex/reviewItems.ts`, `convex/calendarConnections.ts` — one file per table, matching existing pattern.

**Server API routes:**
- `/api/course/generate-outline.post.ts` — outline generation
- `/api/course/generate-section.post.ts` — section content generation
- `/api/course/classify-content.post.ts` — knowledge type classification
- `/api/calendar/sync.post.ts` — calendar event sync
- `/api/calendar/connect.post.ts` — OAuth initiation
- `/api/calendar/callback.get.ts` — OAuth callback

**Vue pages:**
- `app/pages/app/learn/index.vue` — top-level Learn home
- `app/pages/app/learn/[courseId].vue` — course view
- `app/pages/app/learn/[courseId]/[sectionId].vue` — section view
- `app/pages/app/learn/review.vue` — daily review session
- `app/pages/app/folders/[id]/learn/index.vue` — folder-scoped Learn
- `app/pages/app/folders/[id]/learn/[courseId].vue` — folder-scoped course

**Composables:**
- `useCourses.ts` — course CRUD, outline editing
- `useSections.ts` — section state, navigation, completion
- `useLearnProgress.ts` — mastery indicators, streaks, pace
- `useReview.ts` — review session management, SR ratings
- `useCalendarConnection.ts` — calendar OAuth, preferences
- `useOfflineSync.ts` — IndexedDB cache, offline detection, sync queue

### Structure Patterns

**Course-scoped entity flag:** All existing generation endpoints accept an optional `courseScoped: true` parameter. Existing folder-tab queries add `.filter(q => q.neq(q.field('courseScoped'), true))` to exclude course entities.

**Section content blocks:** A section's `contentBlocks` array is ordered and typed. The section renderer dispatches to the appropriate component based on `type`:
- `text` → `SectionTextBlock` (new component)
- `quiz` → `QuizTakingView` (existing, adapted for embedded use)
- `flashcard` → `FlashcardPractice` (existing, adapted for embedded use)
- `audio` → `AudioPlayer` (existing)

**Task-based generation:** All long-running operations (outline generation, section generation, pre-fetch) create a task in the `tasks` table with `type: 'course-outline' | 'section-generate' | 'section-prefetch'`. The existing `useTasks` composable polls for completion. The section UI shows a skeleton state while tasks are in progress.

### Format Patterns

**Course outline format (stored in `courses.outlineSections`):**
```json
[
  { "title": "Reaction Mechanisms", "description": "SN1, SN2, E1, E2...", "knowledgeType": "conceptual", "order": 0 },
  { "title": "Stereochemistry", "description": "...", "knowledgeType": "factual", "order": 1 }
]
```

**Section content blocks format (stored in `courseSections.contentBlocks`):**
```json
[
  { "type": "audio", "entityId": "audio_abc123", "order": 0 },
  { "type": "text", "content": "Markdown explanation...", "order": 1 },
  { "type": "quiz", "entityId": "quiz_def456", "order": 2 },
  { "type": "flashcard", "entityId": "room_ghi789", "order": 3 }
]
```

**Mastery level transitions:**
```
new → learning (section completed with any score)
learning → reviewing (section reviewed with ≥70% accuracy)
reviewing → mastered (3 consecutive successful reviews at ≥80%)
mastered → reviewing (review item failed)
Any → learning (section retaken)
```

### Process Patterns

**Section generation error handling:**
- Individual engine failure → omit that content block, log error, notify user inline ("Audio unavailable for this section")
- All engines fail → section status = 'failed', show retry button, user can skip to next section
- Outline generation failure → show error with retry, suggest adding more source documents

**Pre-fetch strategy:**
- When user opens section N, check if section N+1 task exists
- If not, create a task for N+1 generation
- If task exists and failed, retry once
- Pre-fetch only 1 section ahead (not N+2) to limit cost

**Streak rules:**
- Streak is user-level (stored in `learnProfile`), not per-course. Completing any section in any course OR any review session in a calendar day (user's timezone) counts.
- Streak freeze: one free per week (resets Monday). Consuming a freeze prevents streak break for one missed day.
- Streak counter resets to 0 if a day is missed without freeze available.
- `learnProfile.streakLastDate` stores ISO date string; streak logic compares against current date in user's timezone.

## Project Structure & Boundaries

### New Files and Directories

```
convex/
├── courses.ts                    // Course CRUD, outline management
├── courseSections.ts             // Section CRUD, status transitions, contentBlocks
├── courseSourceDocs.ts            // Source document associations
├── learnProfile.ts               // User-level streak, review cap, timezone
├── reviewItems.ts                // SR item CRUD, scheduling queries (fast-follow)
├── reviewSessions.ts             // Review session tracking (fast-follow)
├── calendarConnections.ts        // Calendar OAuth storage (fast-follow)
├── calendarEvents.ts             // Calendar event tracking (fast-follow)

server/api/
├── course/
│   ├── generate-outline.post.ts  // Course outline generation (LLM)
│   ├── generate-section.post.ts  // Section content orchestration (multi-engine)
│   └── classify-content.post.ts  // Knowledge type classification (LLM)
├── calendar/
│   ├── connect.post.ts           // Google Calendar OAuth initiation (fast-follow)
│   ├── callback.get.ts           // OAuth callback handler (fast-follow)
│   └── sync.post.ts              // Calendar event creation/update (fast-follow)

server/utils/
├── course-outline-prompt.ts      // LLM prompt for outline generation
├── section-orchestrator.ts       // Multi-engine section generation coordination
├── content-classifier.ts         // Knowledge type classification logic
├── web-supplement.ts             // Web search supplementation logic
├── sr-scheduler.ts               // SM-2 scheduling calculations (fast-follow)

app/pages/app/
├── learn/
│   ├── index.vue                 // Learn home (all courses, daily review CTA)
│   ├── [courseId].vue             // Course view (outline, progress, sections)
│   ├── [courseId]/
│   │   └── [sectionId].vue       // Section learning view
│   └── review.vue                // Daily review session (fast-follow)

app/pages/app/folders/[id]/
├── learn/
│   ├── index.vue                 // Folder-scoped Learn (folder courses)
│   └── [courseId].vue             // Folder-scoped course view

app/components/learn/
├── CourseCard.vue                 // Course card for list views
├── CourseCreator.vue              // Course creation wizard
├── OutlineEditor.vue              // Drag-to-reorder outline editor
├── SectionShell.vue               // Section container with content block dispatch
├── SectionTextBlock.vue           // Text/explanation content block
├── SectionPractice.vue            // Embedded quiz/flashcard practice wrapper
├── ProgressDashboard.vue          // Mastery indicators, completion %, streak
├── PaceSelector.vue               // Intensive/steady/relaxed selector
├── SourceConfidence.vue           // "Draws from 14 notes" indicator
├── StreakDisplay.vue              // Streak counter with freeze indicator
├── MasteryBadge.vue               // Per-section mastery level indicator
├── ReviewSession.vue              // Daily review session UI (fast-follow)
├── ReviewCard.vue                 // Single review item with rating (fast-follow)
├── CalendarConnect.vue            // Calendar OAuth flow (fast-follow)

app/composables/
├── useCourses.ts                  // Course CRUD, outline editing
├── useSections.ts                 // Section state, navigation, completion
├── useLearnProgress.ts            // Mastery, streaks, pace
├── useReview.ts                   // Review session management (fast-follow)
├── useCalendarConnection.ts       // Calendar OAuth, preferences (fast-follow)
├── useOfflineSync.ts              // IndexedDB, offline detection, sync (fast-follow)
```

### Architectural Boundaries

**Course Engine Boundary:**
- `convex/courses.ts` + `convex/courseSections.ts` + `convex/courseSourceDocs.ts` own all course data
- Server API routes under `/api/course/` handle generation orchestration
- Composables `useCourses` and `useSections` are the frontend interface
- The course engine calls existing generation endpoints — it never directly generates quiz/flashcard/audio content

**Existing Engine Boundary (unchanged):**
- `/api/quiz/generate`, `/api/flashcards/generate`, `/api/audio-overview/generate` continue to work as-is
- They accept a new optional `courseScoped` flag and `courseId`/`sectionId` context
- No changes to their core generation logic

**Review Engine Boundary (fast-follow):**
- `convex/reviewItems.ts` + `convex/reviewSessions.ts` own all SR data
- `server/utils/sr-scheduler.ts` contains SM-2 calculations (pure functions, no side effects)
- `useReview` composable manages the review session lifecycle

**Calendar Boundary (fast-follow):**
- `convex/calendarConnections.ts` + `convex/calendarEvents.ts` own calendar data
- Server API routes under `/api/calendar/` handle OAuth and event management
- Calendar tokens never leave server context

**Offline Boundary (fast-follow):**
- `useOfflineSync` composable owns all IndexedDB interaction
- Service worker handles caching strategy
- Offline state is fully client-side — Convex mutations only fire on reconnect

### Requirements to Structure Mapping

| FR Category | Convex | Server API | Pages | Components | Composables |
|---|---|---|---|---|---|
| Course Management (FR1-13) | courses, courseSections, courseSourceDocs | course/* | learn/index, learn/[courseId] | CourseCreator, OutlineEditor, CourseCard, SourceConfidence | useCourses |
| Section Learning (FR14-21) | courseSections | course/generate-section | learn/[courseId]/[sectionId] | SectionShell, SectionTextBlock, SectionPractice | useSections |
| Progress & Mastery (FR22-27) | courses (streak fields), courseSections (mastery) | — | learn/[courseId] | ProgressDashboard, StreakDisplay, MasteryBadge, PaceSelector | useLearnProgress |
| Spaced Repetition (FR28-34) | reviewItems, reviewSessions | — | learn/review | ReviewSession, ReviewCard | useReview |
| Content Quality (FR35-38) | reviewItems (flagged fields) | — | (inline in section view) | (inline flag button) | useSections |
| Calendar (FR39-44) | calendarConnections, calendarEvents | calendar/* | (settings panel) | CalendarConnect | useCalendarConnection |
| Offline (FR45-48) | — (client-side only) | — | — | — | useOfflineSync |

### Data Flow

**Course creation flow:**
```
User selects sources → CourseCreator → POST /api/course/generate-outline
  → LLM generates outline with classification
  → Convex mutation creates course + courseSections (status: locked)
  → User edits outline in OutlineEditor
  → User confirms → first section unlocked (status: generating)
  → POST /api/course/generate-section dispatches engines in parallel
  → Section ready → user begins learning
  → On section complete → N+1 pre-fetch triggered
```

**Daily review flow (fast-follow):**
```
User opens /app/learn/review
  → Convex query: reviewItems where nextReviewDate <= today, limit dailyCap
  → Items displayed one at a time (ReviewCard)
  → User rates recall → Convex mutation updates SM-2 fields
  → Session ends → reviewSession record created
  → Streak updated if applicable
```

**Offline sync flow (fast-follow):**
```
Section completed → IndexedDB cache (content + quiz/flashcard data)
User goes offline → offline indicator shown
User retakes quiz offline → attempt stored in IndexedDB offlineAttempts queue
User reconnects → background sync reads queue → Convex mutations with original timestamps
Queue cleared on successful sync
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All decisions build on the existing Budds stack. Course-scoped entities use a flag on existing tables rather than forked schemas. The tasks system is reused for async generation. AI Gateway is reused for web supplementation. No technology conflicts.

**Pattern Consistency:** Naming follows existing conventions (snake_case tables, camelCase code, kebab-case routes). File organization follows established Nuxt 4 patterns. Composables follow the `use` prefix convention.

**Structure Alignment:** New files live in predictable locations within the existing project structure. No new top-level directories needed. The Learn module is self-contained in its pages/components/composables while sharing existing infrastructure.

### Requirements Coverage

**All 48 FRs are architecturally supported:**
- FR1-13 (Course Management): courses + courseSections + courseSourceDocs tables, course/* API routes, outline generation pipeline
- FR14-21 (Section Learning): section orchestrator, content classifier, contentBlocks rendering, adaptive pacing via practiceScore
- FR22-27 (Progress & Mastery): course-level streak fields, section-level mastery state machine, pace presets
- FR28-34 (Spaced Repetition): reviewItems table with SM-2 fields, cross-course query with daily cap, priority ordering
- FR35-38 (Content Quality): flagged/correctedAnswer fields on reviewItems, flag propagation via Convex mutations
- FR39-44 (Calendar): calendarConnections for OAuth, calendarEvents for event tracking, server-side sync route, scheduled rescheduling
- FR45-48 (Offline): IndexedDB + Cache API + Service Worker, offlineAttempts queue, background sync

**All 29 NFRs are architecturally addressed:**
- Performance NFRs met via task-based async generation, N+1 pre-fetch, Convex real-time subscriptions
- Security NFRs met via per-user Convex query isolation, server-only calendar tokens, Web Crypto API for offline encryption
- Scalability NFRs met via independent task-based generation, review query with indexed ordering
- Integration NFRs met via existing API reuse with orchestration wrappers, graceful engine failure handling

### Implementation Readiness

**Confidence Level:** High

**Key Strengths:**
- Builds entirely on proven infrastructure (Convex, AI Gateway, existing generation engines)
- Course-scoped entity model is a minimal schema change (one flag) to existing tables
- Task-based orchestration reuses a battle-tested async pattern
- Phased delivery (MVP → fast-follow) isolates the most complex features (SR, calendar, offline)

**Areas for Future Enhancement:**
- Content-type classification accuracy can be improved with user feedback data post-launch
- Web supplementation quality may need a dedicated search API if LLM-based approach proves insufficient
- Offline storage limits need monitoring — heavy audio caching could exceed browser quotas
- Calendar rescheduling heuristics will benefit from real usage patterns
