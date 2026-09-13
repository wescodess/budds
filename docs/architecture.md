# Budds - Architecture Document

## Executive Summary

Budds is a knowledge management and learning platform built on Nuxt 4 with Convex as its real-time backend. Users upload documents into folders, then interact with their content through RAG-powered chat, AI-generated quizzes, flashcards, audio overviews (podcast-style), and structured courses with spaced repetition. The frontend deploys to Cloudflare Pages; AI operations run through Cloudflare AI Gateway and OpenRouter; document indexing and search use Cloudflare AI Search; audio files are stored on Cloudflare R2; and authentication is handled by Better Auth running as Convex HTTP actions.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Cloudflare Pages                         │
│                  (Nuxt 4 SSR + Static)                       │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Vue 3 SPA  │  │ Nitro Server │  │ Service Worker (PWA) │ │
│  │ (app/)     │  │ (server/)    │  │                      │ │
│  └─────┬──────┘  └──────┬───────┘  └──────────────────────┘ │
└────────┼────────────────┼────────────────────────────────────┘
         │                │
         │  WebSocket     │  HTTP
         ▼                ▼
┌─────────────────┐  ┌─────────────────────────────────────────┐
│  Convex Cloud   │  │         External Services               │
│                 │  │                                          │
│  - Document DB  │  │  Cloudflare AI Gateway → OpenRouter     │
│  - Realtime     │  │  Cloudflare AI Search (RAG indexing)    │
│  - Auth (HTTP)  │  │  Cloudflare R2 (file storage)           │
│  - Cron jobs    │  │  Cloudflare Workers AI (embeddings)     │
│  - File storage │  │  Gemini two-speaker TTS                 │
│                 │  │  Audio Overview Workflow + Workers AI  │
│                 │  │  Google Calendar API                     │
└─────────────────┘  └─────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3 (Composition API), Nuxt 4, Tailwind CSS, shadcn-vue (Reka UI) |
| Backend | Convex (queries, mutations, actions, cron jobs) |
| Server middleware | Nitro (Cloudflare Pages runtime) |
| Auth | Better Auth + `@convex-dev/better-auth` component |
| AI/LLM | OpenRouter (via Cloudflare AI Gateway) |
| Search/RAG | Cloudflare AI Search |
| Storage | Cloudflare R2, Convex file storage |
| Audio generation | Cloudflare Workflow + Gemini 3.1 Flash TTS Preview through the Interactions API |
| Deployment | Cloudflare Pages (frontend + Nitro), Convex Cloud (backend) |

---

## Authentication Architecture

Authentication uses Better Auth running inside Convex HTTP actions, with the Nuxt server acting as a reverse proxy.

### Flow

1. **Google OAuth initiation** - User clicks login, browser redirects to `/api/auth/signin/google`
2. **Auth proxy** (`server/middleware/auth-proxy.ts`) - Intercepts all `/api/auth/*` requests and forwards them to the Convex HTTP endpoint (`CONVEX_SITE_URL`), rewriting headers, cookies, and redirect locations for localhost compatibility
3. **Convex HTTP handler** (`convex/http.ts`) - Routes auth requests through `@convex-dev/better-auth`, which manages sessions, accounts, and users in Convex tables
4. **Session established** - Better Auth sets session cookies, browser receives redirect back to app

### Convex JWT Provisioning (SSR)

`server/middleware/convex-token.ts` runs on every SSR request:
- Reads the session cookie from the incoming request
- Calls `${CONVEX_SITE_URL}/api/auth/convex/token` to exchange the cookie for a Convex JWT
- Stores the token in `event.context.convexToken` so SSR-rendered pages can run authenticated Convex queries

### Client-Side Auth Sync

`app/plugins/convex-auth.client.ts` runs after hydration:
- Watches `useUserSession()` for login state changes
- When logged in, calls `convexClient.client.setAuth()` with a token fetcher that hits `/api/auth/convex/token`
- On first authentication, calls the `users:upsertUser` mutation to ensure the user record exists in the `users` table
- When logged out, clears Convex auth state

### Route Protection

- **SSR level**: `nuxt.config.ts` route rules mark `/`, `/app`, `/app/**` as `auth: 'user'` and `/login` as `auth: 'guest'`
- **Client level**: `app/plugins/auth-redirect.client.ts` watches auth state and redirects unauthenticated users on protected paths to `/login`

### Configuration

Better Auth is configured in `convex/auth.ts`:
- Session lifetime: 30 days, refresh every 24 hours
- Social provider: Google OAuth
- Trusted origins: production domain, Convex site URL, localhost variants
- Account deletion support with a durable tombstone, bounded phase jobs, and provider-first external cleanup
- Course deletion uses a durable `courseDeletionJobs` state machine: it fences the course as `deleting`, settles in-flight calendar compensation, removes Google events in idempotent bounded batches, then drains local dependencies in eight-row transactions. Each transition schedules its successor, and a 15-minute recovery cron resumes stale jobs.
- Convex component: `@convex-dev/better-auth` (registered in `convex/convex.config.ts`)

---

## Data Architecture

### Convex Document Database

All application data lives in Convex's document database. The schema is defined in `convex/schema.ts` with 25+ tables organized by domain (see `docs/data-models.md`).

Key characteristics:
- **Reactive queries**: Client subscriptions automatically update when underlying data changes
- **Transactional mutations**: All writes are ACID within a single mutation
- **Optimistic updates**: Client-side state updates immediately, rolled back on server rejection
- **File storage**: Convex `_storage` table for audio files; R2 for uploaded documents

### Convex Functions

Located in `convex/*.ts`, organized by domain:
- **Queries**: Read-only, reactive subscriptions (e.g., `folders.ts`, `conversations.ts`)
- **Mutations**: Transactional writes (e.g., `users.ts`, `quizzes.ts`)
- **Actions**: Side-effect-capable functions for external API calls
- **Internal functions**: Server-only functions called by cron jobs or other functions

### Cron Jobs

Defined in `convex/crons.ts`:
- `cleanup terminal tasks` - Hourly cleanup of completed/failed tasks
- `check missed calendar sessions` - Hourly check for overdue study sessions

---

## API Design

### Nitro Server Routes (`server/api/`)

Server routes handle AI-intensive operations that require external API calls. These run on Cloudflare Pages Workers.

| Route | Purpose |
|-------|---------|
| `rag/chat.post.ts` | RAG-powered chat with document context |
| `rag/search.post.ts` | Document search via AI Search |
| `chat/general.post.ts` | General chat without RAG context |
| `quiz/generate.post.ts` | AI quiz generation |
| `quiz/topics.post.ts` | Topic extraction for quiz generation |
| `flashcards/generate.post.ts` | AI flashcard generation |
| `audio-overview/generate.post.ts` | Audio overview generation pipeline |
| `audio-overview/interject.post.ts` | Audio interjection generation |
| `course/generate-outline.post.ts` | Course outline generation |
| `course/generate-section.post.ts` | Course section content generation |
| `learn/section-cache-payload.get.ts` | Offline section data payload |
| `calendar/connect.get.ts` | Google Calendar OAuth initiation |
| `calendar/callback.get.ts` | Google Calendar OAuth callback |
| `calendar/sync.post.ts` | Calendar event sync |
| `calendar/disconnect.post.ts` | Calendar disconnection |
| `export/me.get.ts` | User data export (GDPR) |

### Convex Functions

CRUD and business logic for all domain entities. Each domain module (e.g., `convex/folders.ts`, `convex/courses.ts`) exposes queries and mutations consumed directly by the Vue frontend via `nuxt-convex` composables.

---

## Frontend Architecture

### Framework

Nuxt 4 with Vue 3 Composition API. Key modules:
- `nuxt-convex` - Convex client integration with SSR support
- `@onmax/nuxt-better-auth` - Better Auth session management
- `shadcn-nuxt` - UI component library (prefix: `Ui`)
- `@nuxtjs/mdc` - Markdown rendering with syntax highlighting

### Page Structure

File-based routing under `app/pages/`:

```
/                           → Landing / dashboard
/login                      → Authentication
/app                        → Main app shell
/app/folders/[id]           → Folder view
/app/folders/[id]/chat      → RAG chat
/app/folders/[id]/documents → Document management
/app/folders/[id]/flashcards → Flashcard rooms
/app/folders/[id]/quiz      → Quizzes
/app/folders/[id]/learn     → Course learning
/app/learn/review           → Spaced repetition review
/audio/[token]              → Public shared audio overview
/privacy, /terms            → Legal pages
```

### Component Organization

- `app/components/ui/` - shadcn-vue primitives (auto-imported with `Ui` prefix)
- `app/components/global/` - Globally registered components
- `app/components/` - Feature-specific components organized by domain (e.g., `learn/`, `chat/`)

### Plugins

| Plugin | Type | Purpose |
|--------|------|---------|
| `convex-auth.client.ts` | Client | Syncs Better Auth session with Convex auth state |
| `auth-redirect.client.ts` | Client | Client-side route protection |
| `motion.client.ts` / `motion.server.ts` | Universal | Motion animation library |
| `pwa.client.ts` | Client | Service worker registration for PWA support |

### Markdown Rendering

`@nuxtjs/mdc` is configured with GitHub Dark theme, custom component mapping (`Citation`, `ProsePre`), and support for 15+ programming languages.

---

## External Integrations

### Cloudflare AI Gateway

Routes all LLM requests through a Cloudflare AI Gateway for logging, rate limiting, and provider abstraction. The gateway proxies to OpenRouter which provides access to multiple LLM models.

**Config**: `cloudflareAccountId`, `cloudflareAiGatewayId`, `cloudflareAiGatewayApiKey`

### Cloudflare AI Search

Provides RAG indexing and retrieval for uploaded documents. Documents are indexed after upload; search queries retrieve relevant chunks with relevance scores.

**Config**: `cloudflareAiSearchInstance`, `cloudflareAiSearchToken`

### Cloudflare R2

Object storage for uploaded document files. Documents are stored with generated keys and cleaned up via `pendingCleanup` when deleted.

**Config**: `r2Endpoint`, `r2AccessKeyId`, `r2SecretAccessKey`, `r2BucketName`

### Cloudflare Workers AI

Used for embeddings and other AI inference tasks.

**Config**: `cloudflareWorkersAiToken`

### OpenRouter

LLM provider accessed through Cloudflare AI Gateway. Supports model selection per operation.

**Config**: `openrouterApiKey`

### Audio Overview generation plane

The Pages route reserves an authoritative Convex job and invokes the standalone Cloudflare Workflow. The Workflow freezes an exact source manifest, creates a grounded outline and claim ledger, jointly renders bounded scenes with the fixed Gemini Audio Profile, records quality evidence, and streams homogeneous mono 24 kHz 16-bit PCM into one private R2 WAV. Publication is atomic; alignment continues asynchronously after playback becomes ready.

Dia and Aura are legacy/evaluation providers only. They are not production fallbacks and may not create new Audio Overview media.

**Worker config**: `AUDIO_OVERVIEW_WORKER_TOKEN`, `GEMINI_API_KEY`, `PAGES_BASE_URL`, `AI`, `AUDIO_ARTIFACTS`, `AUDIO_OVERVIEW_WORKFLOW`

### Google Calendar API

OAuth 2.0 integration for scheduling study sessions. Managed via `calendarConnections` table with token refresh support.

---

## Testing Strategy

### Convex Integration Tests

- Framework: Vitest + `convex-test`
- Pattern: `convex/*.test.ts` files alongside source
- Setup: `convexTest(schema, modules)` creates an isolated test environment
- Coverage: Users, folders, documents, conversations, messages, quizzes, flashcard rooms, audio overviews, courses, course sections, calendar, learn profile, review items, content flags, account deletion, data export, migrations

### Server Route Tests

- Framework: Vitest with edge-runtime/node environments
- Pattern: `server/api/**/*.test.ts` alongside route handlers
- Coverage: RAG chat, quiz generation, flashcard generation, course generation, data export

### Component Tests

- Framework: Vitest + `@nuxt/test-utils` with `mountSuspended`
- Environment: Nuxt + happy-dom
- Commands: `pnpm test:component`

### Test Commands

- `pnpm test` - Convex integration + server tests
- `pnpm test:component` - Vue component tests

---

## Deployment

### Frontend: Cloudflare Pages

Nuxt is configured with the `cloudflare_pages` Nitro preset. The build produces:
- Static assets served from Cloudflare's edge CDN
- Server routes run as Cloudflare Pages Functions (Workers runtime)
- SSR pages rendered at the edge

Route rules:
- `/audio/**` - SWR cache with 300s TTL (public shared audio pages)
- Protected routes enforce auth at both SSR and client levels

### Backend: Convex Cloud

- Real-time document database with WebSocket subscriptions
- HTTP actions for auth endpoints
- Cron jobs for background maintenance
- File storage for audio files
- Schema migrations via `convex/migrations.ts`

### Environment Variables

Server-side (Nitro runtime config):
- Auth: `authProxyTargetUrl`, `siteUrl`
- Cloudflare: `cloudflareAccountId`, `cloudflareAiGatewayId`, `cloudflareAiGatewayApiKey`, `cloudflareAiSearchInstance`, `cloudflareAiSearchToken`, `cloudflareWorkersAiToken`
- Storage: `r2Endpoint`, `r2AccessKeyId`, `r2SecretAccessKey`, `r2BucketName`
- AI: `openrouterApiKey`
- TTS: `diaServerUrl`, `diaServerApiKey`, `diaStartFunctionUrl`

Public (client-accessible):
- `NUXT_PUBLIC_CONVEX_URL` - Convex deployment URL
- `NUXT_PUBLIC_SITE_URL` - Application origin

Convex env vars (set via `npx convex env set`):
- `NUXT_BETTER_AUTH_SECRET`, `SITE_URL`, `CONVEX_SITE_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `LEARN_V2_ENABLED` - Convex-only internal-beta switch; only exact `true` enables it, and all other values fail closed

### Dev Server

Runs on port 3002 (`nuxt dev`). Convex dev server runs separately (`npx convex dev`).
