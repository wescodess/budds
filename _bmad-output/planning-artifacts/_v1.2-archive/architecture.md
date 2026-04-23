---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
lastStep: 8
status: 'complete'
completedAt: '2026-04-09'
inputDocuments:
  - prd.md
  - product-brief-budds.md
  - product-brief-budds-distillate.md
  - project-context.md
  - docs/index.md
  - docs/project-overview.md
  - docs/architecture.md
  - docs/api-contracts.md
  - docs/data-models.md
  - docs/component-inventory.md
  - docs/source-tree-analysis.md
  - docs/development-guide.md
workflowType: 'architecture'
project_name: 'budds'
user_name: 'palmwine'
date: '2026-04-08'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

45 functional requirements organized across 7 capability areas:

| Area | FRs | Architectural Weight |
|---|---|---|
| Document Management | FR1-FR7 | High — ingestion pipeline, storage, index isolation |
| Knowledge Organization | FR8-FR13 | Medium — hierarchical data model, cascading operations |
| AI Chat | FR14-FR24 | High — RAG pipeline, streaming, persistence, scoped queries |
| Quiz Generation (V1.1) | FR25-FR30 | Medium — generation pipeline, scoring, source linking |
| Flash Card Generation (V1.1) | FR31-FR36 | Medium — generation pipeline, CRUD, source linking |
| Auth & Account | FR37-FR41 | Medium — OAuth, session management, route protection |
| Data Privacy | FR42-FR45 | High — cascading deletion across all storage systems |

The document management and AI chat areas carry the heaviest architectural load. Per-user document isolation (FR7) is the single most critical requirement — it's a hard security boundary that must be enforced at the search index level, not just the application layer.

**Non-Functional Requirements:**

31 NFRs across 6 categories:

- **Performance (NFR1-7):** Chat < 5s end-to-end, streaming first token < 1s, ingestion < 60s per PDF, folder navigation < 500ms, page transitions < 300ms. These are achievable with the current Cloudflare + Convex stack.
- **Security (NFR8-13):** HTTPS, per-user isolation at index level, server-only secrets, 30-day session expiry, server-side file validation, complete data deletion within 24h.
- **Scalability (NFR14-18):** 500 concurrent users, 500 docs/user, 3-5x semester spikes, per-user cost tracking, independent ingestion scaling.
- **Accessibility (NFR19-23):** WCAG 2.1 AA, keyboard navigation, screen reader support, 4.5:1 contrast, focus indicators.
- **Integration (NFR24-27):** Graceful degradation for Cloudflare AI Search, AI Gateway, Convex, and OpenRouter model availability.
- **Reliability (NFR28-31):** 99.5% uptime during semesters, zero data loss post-ingestion, persistent chat history, actionable error messages.

**Scale & Complexity:**

- Primary domain: Full-stack web application (EdTech)
- Complexity level: Medium — multi-service integration, per-user data isolation, RAG pipeline, but no real-time collaboration, no complex transaction patterns
- Estimated architectural components: ~8-10 distinct subsystems (auth, folder management, file upload/storage, ingestion pipeline, search index, chat engine, study material generation, data privacy/deletion)

### Technical Constraints & Dependencies

**Existing Stack (Brownfield):**
- Nuxt 4 + Vue 3 + Tailwind CSS 4 + shadcn-nuxt — frontend is established
- Cloudflare AI Gateway + OpenRouter — LLM routing works, 8 models configured
- Cloudflare AI Search — semantic retrieval works for global index
- Better Auth + SQLite — Google OAuth works but requires persistent filesystem
- Convex — wired up but schema is empty, all data modeling is greenfield

**Critical Constraints:**
1. **Auth storage incompatibility:** SQLite (`data/auth.db`) requires persistent filesystem. Cloudflare Workers/Pages is serverless — no persistent FS. Must migrate auth before serverless deployment.
2. **Per-user isolation gap:** Cloudflare AI Search currently operates as a single global index. Multi-tenant scoping (metadata filtering, namespace-based, or separate indexes) must be designed and validated before file upload ships.
3. **No ingestion pipeline:** The path from user-uploaded PDF → chunked → embedded → indexed in AI Search with per-user metadata does not exist. This is the highest-complexity V1 feature.
4. **Chat state is ephemeral:** Messages live in Vue reactive state only. Convex must become the persistence layer for chat history.
5. **No file storage:** No mechanism to store uploaded PDFs. Need a storage solution (Convex file storage, Cloudflare R2, or similar).
6. **Solo developer:** Architecture must optimize for implementation speed and operational simplicity. No room for over-engineering.

**External Service Dependencies:**
- Cloudflare AI Search (retrieval)
- Cloudflare AI Gateway (LLM routing)
- OpenRouter (model access)
- Convex (application data persistence)
- Google OAuth (authentication)

### Cross-Cutting Concerns Identified

1. **Per-user data isolation** — Touches search index, file storage, folder data, chat history, study materials. Every data path must enforce user scoping. This is the single architectural invariant that cannot be violated.

2. **Source traceability** — Chat responses, quiz questions, and flash cards must all link back to exact source passages. The RAG pipeline's chunk metadata must carry sufficient context (document ID, chunk position, passage text) to enable click-through navigation across all output types.

3. **Cascading deletion** — Deleting a document must remove chunks from the search index + file from storage + references from chat history. Deleting a folder must cascade to all contained documents and subfolders. Deleting an account must cascade across all storage systems (Convex, AI Search index, file storage). This requires coordinated multi-system operations.

4. **Graceful degradation** — Five external services can fail independently. Each failure mode needs a defined user-facing response rather than a blank screen or hang. Architecture must handle partial system availability.

5. **Cost observability** — Per-model, per-user LLM cost tracking from day one. The AI Gateway provides request-level metrics, but per-user attribution requires application-level logging.

6. **Auth migration path** — The deployment strategy (serverless vs long-running server) is blocked on resolving the SQLite dependency. This decision cascades to hosting, CI/CD, and operational model.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application — Nuxt 4 (Vue 3) with server-side API routes (Nitro) and external service integrations.

### Starter Options Considered

**Not applicable — brownfield project.** Budds has an established, working codebase. The technology stack, project structure, and foundational patterns are already in production use. Evaluating starter templates would be counterproductive.

### Established Foundation: Existing Budds Codebase

**Rationale:** The project already has a running Nuxt 4 application with functional authentication, RAG chat, and multi-model LLM support. All new development extends this existing foundation rather than starting from a template.

**Architectural Decisions Already Established:**

**Language & Runtime:**
- TypeScript 5.7.2+ with Nuxt-managed tsconfig
- Node.js LTS (v20+) runtime
- `<script setup lang="ts">` for all Vue SFCs

**Styling Solution:**
- Tailwind CSS 4 via Vite plugin (not PostCSS)
- shadcn-nuxt (Reka UI) with `Ui` prefix for headless components
- oklch color space with semantic design tokens (light/dark mode)
- No `<style>` blocks — Tailwind utility classes exclusively

**Build Tooling:**
- Vite 7 (via Nuxt) for dev server and production bundling
- pnpm as package manager
- Nitro for server-side bundling

**Testing Framework:**
- Not configured — Vitest is the intended choice when testing is introduced

**Code Organization:**
- Nuxt 4 `app/` directory convention
- File-based routing (`app/pages/`)
- Auto-imported composables (`app/composables/`)
- Auto-imported server utilities (`server/utils/`)
- Nitro API routes with method suffix (`server/api/*.method.ts`)
- Convex for backend functions (`convex/`)

**Development Experience:**
- HMR via Vite dev server on port 3002
- Nuxt auto-imports for Vue APIs, composables, and utilities
- shadcn CLI for on-demand component scaffolding
- Convex dev server for real-time schema sync and type generation

**Note:** No project initialization story is needed. The first implementation stories should address the critical architectural gaps: auth migration, document ingestion pipeline, and Convex schema design.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Authentication storage migration strategy
2. Per-user document isolation mechanism in Cloudflare AI Search
3. Document ingestion pipeline architecture
4. File storage solution for uploaded PDFs
5. Convex data model design (folders, documents, chat, study materials)
6. Deployment target

**Important Decisions (Shape Architecture):**
7. Streaming chat implementation approach
8. Cascading deletion coordination strategy
9. Component architecture for the app shell
10. Error handling and graceful degradation patterns

**Deferred Decisions (Post-MVP):**
- Rate limiting implementation (manual monitoring for V1)
- Admin dashboard architecture
- Spaced repetition algorithm design
- Cross-folder search strategy
- Collaborative features architecture

### Data Architecture

**Primary Data Store: Convex**
- Convex serves as the single persistence layer for all application data
- Tables: users (profile cache), folders, documents (metadata), conversations, messages, quizzes, quiz_questions, flash_card_sets, flash_cards
- All tables include a `userId` field as a mandatory index for per-user isolation
- Convex's real-time subscriptions power live UI updates (folder tree, document status, chat history)
- Convex server functions (queries/mutations/actions) handle all data operations with built-in type safety

**Data Modeling Approach: Document-relational hybrid**
- Folders use adjacency list pattern with `parentId` for the 3-level hierarchy
- Documents store metadata in Convex; actual file bytes in Convex file storage; indexed chunks in Cloudflare AI Search
- Chat messages are stored individually (not embedded in conversations) for efficient pagination and real-time append
- Study materials (quizzes, flash cards) reference source document chunks via `documentId` + `chunkId` for traceability

**Data Validation: Convex schema validators**
- Convex's built-in schema validation enforces types at the database level
- Server functions validate business rules (folder depth limits, file type checks) before mutations
- Client-side validation is cosmetic only — never trusted for security

**Caching Strategy: Minimal**
- Convex handles caching through its reactive query system (queries re-run automatically when data changes)
- Cloudflare AI Gateway provides transparent caching of LLM responses for identical prompts
- No application-level cache layer needed for V1

### Authentication & Security

**Authentication: Keep Better Auth + SQLite for V1**
- Better Auth with Google OAuth works today. Migrating auth is a V1 risk with no user-facing benefit.
- SQLite dependency constrains deployment to persistent-filesystem hosts — accepted trade-off for V1.
- Post-V1 migration path: replace SQLite with Convex as Better Auth's database adapter, enabling serverless deployment.

**Per-User Document Isolation: Metadata filtering in Cloudflare AI Search**
- Every document chunk indexed into AI Search carries `userId` metadata
- Every search query includes a mandatory `userId` filter — no query can omit this filter
- This is enforced server-side in the `searchDocuments()` utility — the client cannot bypass it
- The search utility function is the single enforcement point. All code paths (chat, quiz generation, flash card generation) go through this function.

**Authorization Pattern: User-scoped server functions**
- All Convex queries and mutations accept the authenticated user's ID and scope data access to that user
- No role-based access control needed for V1 — every user sees only their own data
- Nitro API routes extract the authenticated user from the Better Auth session before calling Convex or Cloudflare services

**API Security:**
- All secrets in `runtimeConfig` (server-only) — enforced by Nuxt's runtime config split
- API routes validate request bodies server-side with typed schemas
- File uploads validated for type (PDF only for V1), size (configurable limit), and content before processing
- No API keys or tokens exposed to the browser

### API & Communication Patterns

**API Design: Nitro server routes (REST-like)**
- Existing pattern: `server/api/rag/*.method.ts` — extend with new resource routes
- New routes: `server/api/upload.post.ts`, `server/api/documents/*.ts`, `server/api/folders/*.ts`
- Convex functions called from Nitro routes via the Convex Node.js client (server-side)
- Client uses `$fetch` for all API calls (Nuxt convention)

**Document Ingestion Pipeline: Convex action → Cloudflare AI Search**
- Upload flow: Client → `POST /api/upload` (Nitro) → validate file → store in Convex file storage → create document record (status: "processing") → trigger Convex action
- Convex action: retrieve file → extract text (PDF parsing) → upsert into Cloudflare AI Search with metadata (`userId`, `documentId`, `folderId`, `filename`) → update document status to "success" or "failed"
- PDF text extraction: server-side using a lightweight library (pdf-parse or similar) within the Convex action
- Chunking and embedding: delegated to Cloudflare AI Search's built-in processing — AI Search handles chunking, embedding, and indexing automatically when documents are added

**Streaming Chat: Server-Sent Events (SSE)**
- The `generateCompletionStream` utility already exists and returns an `AsyncGenerator<string>`
- Wire to client via a streaming Nitro endpoint that writes SSE chunks
- Client consumes via `EventSource` or `fetch` with `ReadableStream`
- Non-streaming fallback remains available for environments that don't support SSE

**Error Handling Standards:**
- Server errors use `createError({ statusCode, message })` (Nuxt convention)
- External service failures return user-actionable messages, not raw error details
- Convex action failures update document status with failure reason
- Client displays error states with retry options where applicable

### Frontend Architecture

**State Management: Vue composables (no external library)**
- `useRag()` — chat state, message history, streaming (refactor to use Convex persistence)
- `useFolders()` — folder tree state, CRUD operations (new)
- `useDocuments()` — document list, upload status, metadata (new)
- `useStudyMaterials()` — quiz and flash card state (new, V1.1)
- Convex's `useQuery` and `useMutation` (from nuxt-convex) for real-time data binding

**Component Architecture: Extract from monolithic pages**
- Extract reusable components from `chat.vue` into `app/components/`:
  - `ChatMessage.vue` — message bubble with role-based styling
  - `SourceCitation.vue` — source passage card with click-through
  - `ModelSelector.vue` — LLM model dropdown
  - `FolderTree.vue` — hierarchical folder navigation
  - `FileUploadZone.vue` — drag-and-drop upload area with status
  - `DocumentList.vue` — file list within a folder
- Use shadcn-nuxt for base UI primitives (Button, Input, Dialog, DropdownMenu, etc.)
- Scaffold shadcn components on-demand as needed

**Routing Strategy: Nuxt file-based routing**
- `/` — landing page (public)
- `/login` — auth page (guest-only)
- `/app/chat` — chat interface (existing, refactor for folder-scoping)
- `/app/folders/[id]` — folder view with documents (new)
- `/app/quiz/[id]` — quiz interface (V1.1)
- `/app/flashcards/[id]` — flash card review (V1.1)
- All `/app/**` routes protected by existing route rules

**Performance Optimization:**
- Lazy-load heavy components (PDF viewer, quiz interface) via `defineAsyncComponent` or Nuxt's built-in lazy loading
- Convex real-time queries avoid polling — UI updates pushed automatically
- Streaming chat reduces perceived latency
- Tailwind CSS tree-shaking eliminates unused styles at build time

### Infrastructure & Deployment

**Deployment Target: Node.js server (Railway, Render, or Fly.io)**
- Nuxt 4 runs as a Node.js server with Nitro
- Persistent filesystem available for SQLite auth database
- Simple deployment: push to git → auto-deploy
- Railway or Render both offer free/hobby tiers suitable for early launch (500 users)
- Migrate to Cloudflare Pages post-V1 if/when auth migrates off SQLite

**CI/CD: GitHub Actions (lightweight)**
- Lint check (when ESLint is added)
- TypeScript type check (`nuxt typecheck`)
- Build verification (`pnpm build`)
- Auto-deploy to hosting provider on main branch push
- No complex pipeline needed for V1 — solo developer, manual QA

**Environment Configuration:**
- `.env` for local development (gitignored)
- Hosting provider's environment variable UI for production secrets
- 10 env vars required (9 existing + CONVEX_DEPLOYMENT)
- No environment-specific config files beyond `.env`

**Monitoring & Logging:**
- Cloudflare AI Gateway dashboard for LLM request volume, latency, and cost
- Convex dashboard for database operations, function execution, and storage
- Hosting provider's built-in logging for server errors
- No custom monitoring stack for V1 — rely on service dashboards

**Scaling Strategy:**
- Convex scales automatically (managed BaaS)
- Cloudflare AI Search and AI Gateway scale automatically (managed services)
- Node.js server is the only component that needs manual scaling — Railway/Render handle this with horizontal scaling when needed
- Ingestion pipeline runs as async Convex actions — naturally decoupled from the request path, can scale independently

### Decision Impact Analysis

**Implementation Sequence:**
1. Convex schema design (unblocks all data features)
2. Folder management (foundation for document organization)
3. File upload + Convex file storage (unblocks ingestion)
4. Document ingestion pipeline (unblocks scoped search)
5. Per-user search isolation (security requirement for all features)
6. Chat history persistence (refactor useRag to use Convex)
7. Streaming chat (wire existing backend utility to frontend)
8. Component extraction from chat.vue
9. Deployment pipeline setup
10. Quiz generation (V1.1)
11. Flash card generation (V1.1)

**Cross-Component Dependencies:**
- Per-user isolation depends on ingestion metadata → search filter chain being complete
- Chat persistence depends on Convex schema + conversation/message tables
- Folder-scoped search depends on folder metadata being indexed with document chunks
- Study material generation (V1.1) depends on the same RAG pipeline as chat — same search, same source traceability
- Cascading deletion depends on document metadata tracking which chunks exist in AI Search (to know what to delete)

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

12 conflict areas identified where AI agents could make inconsistent choices. The project-context.md already covers language-level conventions (auto-imports, naming, file structure). These patterns cover the remaining gaps specific to net-new features.

### Naming Patterns

**Convex Table & Field Naming:**
- Table names: `camelCase`, plural — `folders`, `documents`, `conversations`, `messages`, `quizzes`, `quizQuestions`, `flashCardSets`, `flashCards`
- Field names: `camelCase` — `userId`, `folderId`, `parentId`, `createdAt`, `updatedAt`
- Foreign key fields: `{referencedTable}Id` singular — `userId`, `folderId`, `documentId`, `conversationId`
- System fields: Convex auto-generates `_id` and `_creationTime` — never create custom `id` or `createdAt` that duplicates these

**API Route Naming:**
- Resource routes: `server/api/{resource}/{action-or-param}.method.ts`
- Examples: `server/api/folders/create.post.ts`, `server/api/folders/[id].get.ts`, `server/api/folders/[id].delete.ts`
- Upload route: `server/api/upload.post.ts`
- Keep existing RAG routes: `server/api/rag/chat.post.ts`, `server/api/rag/search.post.ts`
- Query params: `camelCase` — `?folderId=xxx&includeChildren=true`

**Composable Naming:**
- Follow existing pattern: `use{Feature}.ts` returning a function `use{Feature}()`
- New composables: `useFolders.ts`, `useDocuments.ts`, `useStudyMaterials.ts`
- Each composable owns its domain — no cross-composable imports between feature composables

**Component Naming:**
- Feature components: `PascalCase.vue` — `ChatMessage.vue`, `FolderTree.vue`, `FileUploadZone.vue`
- Located in `app/components/` (auto-imported by Nuxt)
- shadcn-nuxt components: `Ui` prefix — `UiButton`, `UiDialog`, `UiDropdownMenu`
- No barrel files (index.ts) for components — Nuxt auto-imports handle this

### Structure Patterns

**Project Organization (extending existing structure):**
```
app/
  components/           # Reusable Vue components (auto-imported)
    chat/               # Chat-related components
    folders/            # Folder management components
    documents/          # Document-related components
    ui/                 # shadcn-nuxt generated components
  composables/          # Feature composables (auto-imported)
  pages/
    app/                # Authenticated routes
server/
  api/
    rag/                # Existing RAG endpoints
    folders/            # Folder CRUD endpoints
    documents/          # Document management endpoints
    upload.post.ts      # File upload endpoint
  utils/                # Shared server utilities (auto-imported)
convex/
  schema.ts             # Data model definition
  folders.ts            # Folder queries/mutations
  documents.ts          # Document queries/mutations/actions
  conversations.ts      # Chat persistence
  messages.ts           # Message queries/mutations
  quizzes.ts            # Quiz queries/mutations (V1.1)
  flashCards.ts         # Flash card queries/mutations (V1.1)
```

**Convex Function File Organization:**
- One file per table/domain — `folders.ts` contains all folder queries, mutations, and actions
- Export naming: `{action}{Resource}` — `createFolder`, `getFolder`, `listFolders`, `deleteFolder`
- Internal helpers are unexported functions in the same file

### Format Patterns

**API Response Formats:**

Success responses return data directly (no wrapper):
```typescript
// GET /api/folders/[id] → returns folder object
{ _id: "...", name: "Organic Chemistry", parentId: "...", userId: "..." }

// GET /api/documents?folderId=xxx → returns array
[{ _id: "...", filename: "lecture-7.pdf", status: "success", ... }]
```

Error responses use Nuxt's `createError`:
```typescript
// All errors
{ statusCode: 400, message: "Folder name is required" }
{ statusCode: 404, message: "Folder not found" }
{ statusCode: 500, message: "Document ingestion failed: no extractable text" }
```

**Date/Time Handling:**
- Convex stores `_creationTime` as Unix timestamp (milliseconds) automatically
- Custom date fields (e.g., `updatedAt`) stored as Unix timestamps (milliseconds)
- Client formats dates using `Intl.DateTimeFormat` or a lightweight utility — no date libraries

**Metadata Schema for AI Search Documents:**
Every chunk indexed into Cloudflare AI Search must include:
```json
{
  "userId": "user_abc123",
  "documentId": "doc_xyz789",
  "folderId": "folder_def456",
  "filename": "lecture-7.pdf"
}
```
These fields are mandatory. Omitting any field breaks isolation or traceability.

### Communication Patterns

**Convex Real-Time Data Flow:**
- UI binds to Convex queries via `useQuery` — data updates push automatically
- Mutations trigger query re-evaluation — no manual cache invalidation needed
- Optimistic updates: Convex handles this natively for mutations
- Actions (async work like ingestion) update status via internal mutations that trigger UI updates

**Client-Server Communication:**
- `$fetch` for all Nitro API calls (upload, RAG chat, search)
- `useQuery`/`useMutation` for all Convex data (folders, documents, conversations, study materials)
- Never call Convex directly from Nitro routes — use the Convex Node.js client (`ConvexHttpClient`)
- Never call Cloudflare APIs from the client — always proxy through Nitro server routes

### Process Patterns

**Per-User Isolation Enforcement:**
Every data access path must include user scoping. The enforcement points are:
1. **Convex queries/mutations:** Every function that reads/writes data takes `userId` as argument and filters by it. No query returns data without a userId filter.
2. **Cloudflare AI Search:** The `searchDocuments()` server utility always injects `userId` into the filters object. This function is the single gateway — all search paths go through it.
3. **Nitro API routes:** Extract authenticated userId from Better Auth session before any data operation. Never trust a userId from the request body.

**Document Status State Machine:**
```
uploading → processing → success
                       → failed (with reason)
```
- `uploading`: file received, stored in Convex file storage
- `processing`: ingestion action triggered, text extraction and indexing in progress
- `success`: chunks indexed in AI Search, document ready for queries
- `failed`: ingestion failed — reason stored (e.g., "no extractable text", "file too large", "AI Search error")
- Status is a Convex field — UI subscribes via `useQuery` for live updates

**Loading State Pattern:**
- Each composable manages its own `loading` ref — `useFolders().loading`, `useDocuments().loading`
- Loading states are granular: `uploading`, `deleting`, `generating` — not a single boolean
- UI shows contextual loading indicators (skeleton screens for lists, spinners for actions, progress for uploads)

**Error Recovery Pattern:**
- External service errors (Cloudflare, OpenRouter) → show user-actionable message + retry button
- Validation errors (bad file type, empty folder name) → inline field-level error messages
- Convex errors → display message from mutation/action, no automatic retry
- Network errors → toast notification with retry option

**Cascading Deletion Sequence:**
When deleting a document:
1. Remove all chunks from Cloudflare AI Search (by documentId metadata filter)
2. Delete file from Convex file storage
3. Delete document record from Convex
4. Remove references in chat messages (mark source as "document deleted")

When deleting a folder:
1. Recursively collect all child folders and documents
2. Delete each document using the document deletion sequence above
3. Delete child folders bottom-up
4. Delete the target folder

When deleting an account:
1. List all user's folders and documents
2. Delete each document (including AI Search chunks and file storage)
3. Delete all conversations and messages
4. Delete all study materials (quizzes, flash cards)
5. Delete all folders
6. Delete user record from Convex
7. Delete user from Better Auth (SQLite)

### Enforcement Guidelines

**All AI Agents MUST:**
- Include `userId` filtering in every Convex query and mutation
- Include `userId` in every Cloudflare AI Search query via the `searchDocuments()` utility
- Use `createError({ statusCode, message })` for all server errors
- Follow the file/function naming conventions above — no deviations
- Use Convex's `_creationTime` instead of custom creation timestamps
- Read `convex/_generated/ai/guidelines.md` before writing any Convex code

**Anti-Patterns (Never Do This):**
- Never query Convex without a userId filter (data leak risk)
- Never call Cloudflare APIs from client-side code (exposes API keys)
- Never trust userId from request body — always extract from auth session
- Never create a `types/` directory — co-locate interfaces in the files that use them
- Never add Pinia, Vuex, or any state management library — use composables
- Never create barrel files (index.ts) for re-exports
- Never add `<style>` blocks in Vue SFCs

## Project Structure & Boundaries

### Complete Project Directory Structure

```
budds/
├── .env                            # Local dev secrets (gitignored)
├── .env.example                    # Template for required env vars
├── .env.local                      # Convex local overrides (gitignored)
├── .github/
│   └── workflows/
│       └── ci.yml                  # Build + typecheck on push
├── .gitignore
├── .nuxtrc                         # Nuxt runtime overrides
├── CLAUDE.md                       # AI agent instructions
├── components.json                 # shadcn-nuxt config
├── nuxt.config.ts                  # App config, modules, route rules
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json                   # Extends .nuxt/tsconfig.json
│
├── app/                            # Frontend (Nuxt 4 app directory)
│   ├── app.vue                     # Root component
│   ├── auth.config.ts              # Client-side auth config
│   ├── assets/
│   │   └── css/
│   │       └── tailwind.css        # Theme tokens, dark/light mode
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatMessage.vue     # Message bubble (user/assistant)
│   │   │   ├── ChatInput.vue       # Message input + send
│   │   │   ├── SourceCitation.vue  # Source passage card
│   │   │   └── ModelSelector.vue   # LLM model dropdown
│   │   ├── documents/
│   │   │   ├── DocumentList.vue    # File list in a folder
│   │   │   ├── DocumentCard.vue    # Single document with status
│   │   │   └── FileUploadZone.vue  # Drag-and-drop upload area
│   │   ├── folders/
│   │   │   ├── FolderTree.vue      # Hierarchical folder nav
│   │   │   ├── FolderItem.vue      # Single folder in tree
│   │   │   └── CreateFolderDialog.vue
│   │   ├── study/                  # V1.1
│   │   │   ├── QuizView.vue
│   │   │   ├── QuizQuestion.vue
│   │   │   ├── FlashCardReview.vue
│   │   │   └── FlashCard.vue
│   │   └── ui/                     # shadcn-nuxt generated (on-demand)
│   │       ├── button/
│   │       ├── dialog/
│   │       ├── dropdown-menu/
│   │       ├── input/
│   │       ├── toast/
│   │       └── ...
│   ├── composables/
│   │   ├── useRag.ts               # Chat state + RAG API (refactored)
│   │   ├── useFolders.ts           # Folder CRUD + tree state
│   │   ├── useDocuments.ts         # Document list, upload, status
│   │   └── useStudyMaterials.ts    # Quiz + flash card state (V1.1)
│   ├── lib/
│   │   └── utils.ts                # cn() class merger
│   └── pages/
│       ├── index.vue               # Landing page (public)
│       ├── login.vue               # Google OAuth (guest-only)
│       └── app/
│           ├── chat.vue            # Chat interface (folder-scoped)
│           ├── folders/
│           │   └── [id].vue        # Folder view with documents
│           ├── quiz/               # V1.1
│           │   └── [id].vue
│           └── flashcards/         # V1.1
│               └── [id].vue
│
├── server/                         # Backend (Nitro)
│   ├── tsconfig.json
│   ├── auth.config.ts              # Better Auth config (SQLite + Google)
│   ├── api/
│   │   ├── rag/
│   │   │   ├── chat.post.ts        # RAG chat (search + LLM)
│   │   │   ├── chat-stream.post.ts # Streaming chat (SSE)
│   │   │   └── search.post.ts      # Document search
│   │   ├── folders/
│   │   │   ├── index.get.ts        # List user's root folders
│   │   │   ├── [id].get.ts         # Get folder with children
│   │   │   ├── create.post.ts      # Create folder
│   │   │   ├── [id].patch.ts       # Rename folder
│   │   │   ├── [id].delete.ts      # Delete folder (cascade)
│   │   │   └── [id]/
│   │   │       └── documents.get.ts # List documents in folder
│   │   ├── documents/
│   │   │   ├── [id].get.ts         # Get document metadata
│   │   │   ├── [id].delete.ts      # Delete document (cascade)
│   │   │   └── [id]/
│   │   │       └── move.post.ts    # Move document to folder
│   │   ├── upload.post.ts          # File upload endpoint
│   │   ├── conversations/
│   │   │   ├── index.get.ts        # List conversations
│   │   │   ├── [id].get.ts         # Get conversation + messages
│   │   │   ├── create.post.ts      # Start new conversation
│   │   │   └── [id].delete.ts      # Delete conversation
│   │   ├── quizzes/                # V1.1
│   │   │   ├── generate.post.ts
│   │   │   ├── [id].get.ts
│   │   │   └── [id]/
│   │   │       └── submit.post.ts
│   │   ├── flashcards/             # V1.1
│   │   │   ├── generate.post.ts
│   │   │   ├── [id].get.ts
│   │   │   └── [id].patch.ts
│   │   └── account/
│   │       └── delete.post.ts      # Account + data deletion
│   └── utils/
│       ├── ai-gateway.ts           # Cloudflare AI Gateway wrapper
│       ├── ai-search.ts            # Cloudflare AI Search wrapper
│       └── auth.ts                 # Auth session extraction helper
│
├── convex/                         # Convex backend
│   ├── convex.config.ts
│   ├── schema.ts                   # All table definitions
│   ├── folders.ts                  # Folder queries/mutations
│   ├── documents.ts                # Document queries/mutations/actions
│   ├── conversations.ts            # Conversation queries/mutations
│   ├── messages.ts                 # Message queries/mutations
│   ├── quizzes.ts                  # V1.1
│   ├── flashCards.ts               # V1.1
│   └── _generated/                 # Auto-generated (do not edit)
│
├── data/                           # Local data (gitignored)
│   └── auth.db                     # SQLite auth database
│
├── docs/                           # Project documentation
│   ├── index.md
│   ├── project-overview.md
│   ├── architecture.md
│   ├── api-contracts.md
│   ├── data-models.md
│   ├── component-inventory.md
│   ├── development-guide.md
│   └── source-tree-analysis.md
│
└── public/                         # Static assets (served as-is)
    └── favicon.ico
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | Entry Point | Responsibility |
|---|---|---|
| Auth | `/api/_better-auth/**` | OAuth flow, sessions (managed by Better Auth) |
| RAG | `/api/rag/**` | Search + LLM completion (Cloudflare services) |
| Folders | `/api/folders/**` | Folder CRUD (Convex) |
| Documents | `/api/documents/**` + `/api/upload` | Document metadata + file upload (Convex + AI Search) |
| Conversations | `/api/conversations/**` | Chat persistence (Convex) |
| Study Materials | `/api/quizzes/**` + `/api/flashcards/**` | Quiz/flashcard CRUD + generation (V1.1) |
| Account | `/api/account/**` | Account deletion (cascading) |

**Component Boundaries:**
- Chat components (`app/components/chat/`) only communicate with `useRag()` composable
- Folder components (`app/components/folders/`) only communicate with `useFolders()` composable
- Document components (`app/components/documents/`) only communicate with `useDocuments()` composable
- Study components (`app/components/study/`) only communicate with `useStudyMaterials()` composable
- Components never call `$fetch` directly — all API calls go through composables

**Data Boundaries:**
- Convex owns all application data (folders, documents, conversations, study materials)
- SQLite owns auth data only (users, sessions, accounts)
- Cloudflare AI Search owns indexed document chunks (the search index is a derived data store, not source of truth)
- Convex file storage owns uploaded PDF binary data
- If AI Search data is lost, it can be rebuilt from Convex file storage + document metadata

### Requirements to Structure Mapping

| FR Category | Pages | Components | Composable | API Routes | Convex Functions |
|---|---|---|---|---|---|
| Document Management (FR1-7) | `folders/[id].vue` | `documents/*`, `FileUploadZone` | `useDocuments` | `upload`, `documents/*` | `documents.ts` |
| Knowledge Org (FR8-13) | `folders/[id].vue` | `folders/*` | `useFolders` | `folders/*` | `folders.ts` |
| AI Chat (FR14-24) | `chat.vue` | `chat/*` | `useRag` | `rag/*`, `conversations/*` | `conversations.ts`, `messages.ts` |
| Quiz Gen (FR25-30) | `quiz/[id].vue` | `study/Quiz*` | `useStudyMaterials` | `quizzes/*` | `quizzes.ts` |
| Flash Cards (FR31-36) | `flashcards/[id].vue` | `study/FlashCard*` | `useStudyMaterials` | `flashcards/*` | `flashCards.ts` |
| Auth (FR37-41) | `login.vue` | — | `useUserSession` | `_better-auth/*` | — |
| Data Privacy (FR42-45) | — | — | — | `account/delete` | All (cascading) |

### Integration Points

**External Service Integration Map:**

```
Client (Browser)
  ├── $fetch → Nitro API Routes
  │     ├── ai-gateway.ts → Cloudflare AI Gateway → OpenRouter → LLM Providers
  │     ├── ai-search.ts → Cloudflare AI Search
  │     ├── ConvexHttpClient → Convex Cloud
  │     └── Better Auth → SQLite (data/auth.db)
  └── useQuery/useMutation → Convex Cloud (real-time, via nuxt-convex)
```

**Data Flow — Document Upload:**
```
Client upload → POST /api/upload → validate → Convex file storage
  → create document record (status: "uploading") → trigger Convex action
  → action: extract text → upsert to AI Search (with userId metadata)
  → update document status → UI auto-updates via Convex subscription
```

**Data Flow — Chat Query:**
```
Client query → POST /api/rag/chat → extract userId from session
  → searchDocuments(query, userId filter) → AI Search returns chunks
  → assemble system prompt with chunks → generateCompletion(model, messages)
  → AI Gateway → OpenRouter → LLM → response with sources
  → save message to Convex → return response to client
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices are compatible:
- Nuxt 4 + Nitro + Convex + Cloudflare services form a coherent stack with clear boundaries
- Better Auth + SQLite constrains deployment to Node.js servers — this is intentional and accepted for V1
- Convex's real-time subscriptions complement Vue composables naturally (both reactive)
- Cloudflare AI Search's metadata filtering supports the per-user isolation pattern
- No version conflicts detected between any dependencies

**Pattern Consistency:**
- Naming conventions (camelCase for Convex fields, kebab-case for API routes, PascalCase for components) align with Nuxt/Vue/Convex ecosystem conventions
- The composable-per-domain pattern (useRag, useFolders, useDocuments) matches the API boundary structure
- Error handling uses `createError()` consistently across all server routes

**Structure Alignment:**
- The project structure directly maps to the Nuxt 4 convention — no custom deviations
- Each FR category maps to a distinct directory/file set with clear ownership
- The Convex function files mirror the API route organization (one file per domain)

### Requirements Coverage Validation

**Functional Requirements Coverage:**

| FR Group | Coverage | Notes |
|---|---|---|
| Document Management (FR1-7) | Fully covered | Upload route, Convex storage, AI Search isolation |
| Knowledge Org (FR8-13) | Fully covered | Convex folder model with adjacency list, cascade delete |
| AI Chat (FR14-24) | Fully covered | Existing RAG + new persistence via Convex, streaming via SSE |
| Quiz Gen (FR25-30) | Fully covered (V1.1) | Generation pipeline reuses RAG search, Convex for storage |
| Flash Cards (FR31-36) | Fully covered (V1.1) | Same pattern as quizzes |
| Auth (FR37-41) | Fully covered | Better Auth handles all auth flows, route rules for protection |
| Data Privacy (FR42-45) | Fully covered | Cascading deletion sequence defined across all storage systems |

**Non-Functional Requirements Coverage:**

| NFR Category | Coverage | Architectural Support |
|---|---|---|
| Performance (NFR1-7) | Covered | Streaming reduces latency, Convex reactive queries avoid polling, lazy-loaded components |
| Security (NFR8-13) | Covered | Server-only secrets, per-user isolation enforcement pattern, file validation |
| Scalability (NFR14-18) | Covered | Convex/Cloudflare auto-scale, ingestion decoupled via async actions |
| Accessibility (NFR19-23) | Partially covered | shadcn-nuxt (Reka UI) provides accessible primitives; WCAG compliance is an implementation concern, not an architectural gap |
| Integration (NFR24-27) | Covered | Error handling patterns define graceful degradation for each external service |
| Reliability (NFR28-31) | Covered | Convex guarantees data durability, document status state machine ensures no silent failures |

### Implementation Readiness Validation

**Decision Completeness:** All critical and important decisions are documented with specific technology choices, rationale, and enforcement guidelines. No blocking decisions remain open.

**Structure Completeness:** The project tree specifies every file and directory needed for V1 and V1.1. The requirements-to-structure mapping provides explicit guidance for where each feature lives.

**Pattern Completeness:** Naming, structure, format, communication, and process patterns are defined with concrete examples and anti-patterns. The per-user isolation enforcement pattern is specified at every boundary.

### Gap Analysis Results

**No Critical Gaps.** All blocking decisions are made.

**Important Gaps (acceptable for V1, address later):**
1. **PDF text extraction library not specified** — pdf-parse is suggested but not committed. The Convex action that performs extraction should evaluate pdf-parse vs pdf.js-extract at implementation time.
2. **File size limits not specified** — the PRD mentions server-side validation but doesn't define the maximum file size. Recommend 50MB per file initially, configurable via runtime config.
3. **Convex schema not fully specified** — table structure is described conceptually but the exact Convex schema validators are an implementation-time decision. The architecture provides sufficient guidance for schema design.

**Deferred Gaps (post-V1):**
1. **Rate limiting architecture** — deferred to V1.1. Manual monitoring via Cloudflare AI Gateway dashboard for V1.
2. **CI/CD pipeline details** — GitHub Actions workflow file structure defined but specific job configuration is implementation-time.
3. **Cross-folder search** — architectural pattern not defined because it's a future feature. Current architecture supports adding it later via multi-folder metadata filter in AI Search queries.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed (42 rules from project-context.md integrated)
- [x] Scale and complexity assessed (medium complexity, 8-10 subsystems)
- [x] Technical constraints identified (6 critical constraints documented)
- [x] Cross-cutting concerns mapped (6 concerns with enforcement patterns)

**Architectural Decisions**
- [x] Critical decisions documented (6 critical, 4 important)
- [x] Technology stack fully specified with versions
- [x] Integration patterns defined for all 5 external services
- [x] Performance, security, and scalability considerations addressed

**Implementation Patterns**
- [x] Naming conventions established (Convex, API, composables, components)
- [x] Structure patterns defined (project organization, file conventions)
- [x] Communication patterns specified (Convex real-time, client-server)
- [x] Process patterns documented (isolation, status machine, error handling, deletion)

**Project Structure**
- [x] Complete directory structure defined with all files
- [x] Component boundaries established (composable-per-domain)
- [x] Integration points mapped (external service diagram, data flow diagrams)
- [x] Requirements to structure mapping complete (FR category → file mapping table)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Clear per-user isolation enforcement at every boundary
- Well-defined data flow for the two most complex paths (document upload, chat query)
- Brownfield advantage — existing working code validates core technology choices
- Convex + Cloudflare services minimize infrastructure management for solo developer
- Implementation sequence clearly prioritized

**Areas for Future Enhancement:**
- Auth migration to Convex (unblocks serverless deployment)
- Rate limiting and cost controls (needed before monetization)
- Cross-folder search (user-requested feature)
- Admin dashboard (operator tooling beyond service dashboards)

### Implementation Handoff

**AI Agent Guidelines:**
- Read `convex/_generated/ai/guidelines.md` before writing any Convex code
- Read `_bmad-output/project-context.md` for all coding rules
- Follow this architecture document for all structural and pattern decisions
- Every data access must include userId filtering — no exceptions
- Use the implementation sequence from "Decision Impact Analysis" to prioritize work

**First Implementation Priority:**
1. Design and implement the Convex schema (`convex/schema.ts`) based on the data architecture decisions
2. Implement folder CRUD (Convex functions + API routes + composable + UI)
3. Implement file upload and document ingestion pipeline
