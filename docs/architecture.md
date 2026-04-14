# Budds - Architecture Document

**Date:** 2026-04-08
**Project Type:** Web Application (Full-Stack)
**Architecture Pattern:** Nuxt 4 Layered Architecture

## Executive Summary

Budds is a Nuxt 4 full-stack web application implementing a RAG (Retrieval-Augmented Generation) chat system. The architecture follows Nuxt's layered conventions: Vue 3 pages communicate through composables to Nitro server API routes, which orchestrate calls to external AI services (Cloudflare AI Gateway, AI Search, OpenRouter). Authentication is handled by Better Auth with a local SQLite database, while Convex provides a backend-as-a-service layer for future application data.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ index.vue│  │login.vue │  │  app/chat.vue        │   │
│  └──────────┘  └──────────┘  └─────────┬────────────┘   │
│                                        │                 │
│                               ┌────────▼────────┐       │
│                               │   useRag()      │       │
│                               │   composable    │       │
│                               └────────┬────────┘       │
│                                        │ $fetch          │
├────────────────────────────────────────┼─────────────────┤
│                    SERVER (Nitro)       │                 │
│                                        │                 │
│  ┌─────────────┐        ┌──────────────▼──────────────┐  │
│  │ Better Auth │        │      /api/rag/chat.post     │  │
│  │  (SQLite)   │        │      /api/rag/search.post   │  │
│  └──────┬──────┘        └──────┬──────────────┬───────┘  │
│         │                      │              │          │
│         ▼                      ▼              ▼          │
│   ┌──────────┐        ┌──────────┐   ┌──────────────┐   │
│   │ data/    │        │ai-gateway│   │  ai-search   │   │
│   │ auth.db  │        │  .ts     │   │    .ts       │   │
│   └──────────┘        └────┬─────┘   └──────┬───────┘   │
│                            │                │            │
├────────────────────────────┼────────────────┼────────────┤
│              EXTERNAL SERVICES             │            │
│                            │                │            │
│                 ┌──────────▼──────┐  ┌──────▼────────┐   │
│                 │ Cloudflare AI   │  │ Cloudflare    │   │
│                 │ Gateway         │  │ AI Search     │   │
│                 │ (→ OpenRouter)  │  │               │   │
│                 └────────┬────────┘  └───────────────┘   │
│                          │                               │
│              ┌───────────▼──────────────┐                │
│              │       LLM Providers      │                │
│              │  Claude │ GPT │ Gemini   │                │
│              │  Llama  │ DeepSeek │ ... │                │
│              └──────────────────────────┘                │
│                                                          │
│  ┌──────────────────────────────────────────────┐        │
│  │              Convex (BaaS)                   │        │
│  │         (schema ready, no tables yet)         │        │
│  └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend Framework | Nuxt 4 + Vue 3 | SSR/SPA framework |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| UI Components | shadcn-nuxt + Reka UI | Headless accessible components |
| State Management | Vue 3 Composition API (`ref`, `reactive`) | Reactive state in composables |
| Server | Nitro (built into Nuxt) | API routes, server utilities |
| Authentication | Better Auth + SQLite | User auth, session management |
| Backend | Convex | Backend-as-a-service (future data) |
| AI Completions | Cloudflare AI Gateway → OpenRouter | Multi-model LLM access |
| AI Search | Cloudflare AI Search | Semantic document retrieval |
| Build | Vite 7 | Dev server, HMR, bundling |

## Data Architecture

### Authentication Database (SQLite)

Better Auth manages its own SQLite database at `data/auth.db` with auto-created tables for:
- Users (profile data from OAuth)
- Sessions (active login sessions)
- Accounts (linked OAuth providers)

### Convex Backend

Schema defined in `convex/schema.ts` but currently empty. Ready for application-specific tables (e.g., chat history, user preferences, document metadata).

### Runtime State

The `useRag()` composable manages client-side state:
- `messages: Ref<RagMessage[]>` - Chat conversation history
- `loading: Ref<boolean>` - Async operation state
- `error: Ref<string | null>` - Error state

No persistent client-side state management library (no Pinia/Vuex). State is component-scoped via composables.

## API Design

### Server Routes

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/api/rag/chat` | POST | RAG chat (search + LLM completion) | Route-level (`/app/**`) |
| `/api/rag/search` | POST | Standalone document search | Route-level (`/app/**`) |
| `/api/_better-auth/**` | ALL | Auth endpoints (auto-generated) | Public |

### External API Integrations

1. **Cloudflare AI Gateway** (`https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openrouter/...`)
   - Routes LLM requests through Cloudflare for observability and caching
   - Proxies to OpenRouter's chat completions API
   - Supports streaming and non-streaming responses

2. **Cloudflare AI Search** (`https://api.cloudflare.com/client/v4/accounts/{account}/ai-search/...`)
   - Semantic search over indexed documents
   - Returns ranked results with relevance scores
   - Supports filtering, reranking, and score thresholds

3. **OpenRouter** (via AI Gateway)
   - Multi-model access: Claude, GPT-4o, Gemini, Llama, DeepSeek, Mistral, Qwen
   - Standard OpenAI-compatible chat completions API

## Component Structure

### Pages (3)

- `app/pages/index.vue` - Welcome/landing page
- `app/pages/login.vue` - Google OAuth login (uses `useUserSession()` from nuxt-better-auth)
- `app/pages/app/chat.vue` - Main RAG chat interface with model selection, message history, source display

### Composables (1)

- `app/composables/useRag.ts` - Core chat logic (state, API calls, message management)

### UI Framework

shadcn-nuxt components with `Ui` prefix, powered by Reka UI headless primitives. Configuration in `components.json`:
- Style: maia
- Color: zinc
- CSS variables enabled
- Icon library: remixicon

## Authentication Flow

1. Unauthenticated user visits any `/app/**` route → redirected to `/login`
2. User clicks "Sign in with Google" → Better Auth initiates OAuth flow
3. Google returns OAuth tokens → Better Auth creates user + session in SQLite
4. Session cookie set → user redirected to `/` (home)
5. Subsequent requests: Better Auth middleware validates session cookie
6. Route rules in `nuxt.config.ts` enforce: `/app/**` = authenticated, `/login` = guest-only

## Request Flow (RAG Chat)

1. User types message in `app/chat.vue` → calls `useRag().chat(query, { model })`
2. Composable sends POST to `/api/rag/chat` with query, model, and conversation history
3. Server route calls `searchDocuments()` → Cloudflare AI Search returns relevant chunks
4. Server constructs system prompt with document context
5. Server calls `generateCompletion()` → Cloudflare AI Gateway → OpenRouter → LLM provider
6. LLM response returned with source attributions
7. Composable updates reactive `messages` array → UI re-renders

## Security Considerations

- All API keys stored server-side in runtime config (never exposed to client)
- Route-level authentication enforced via `nuxt.config.ts` route rules
- OAuth credentials managed by Better Auth (industry-standard library)
- SQLite database stored in gitignored `data/` directory
- `.env` files gitignored to prevent credential leakage

## Deployment Considerations

- No CI/CD pipeline configured
- No Dockerfile or deployment scripts found
- Nuxt supports multiple deployment targets (Node, Cloudflare Workers, Vercel, etc.)
- Cloudflare-specific runtime config suggests potential Cloudflare Pages/Workers deployment
- Convex deployment managed via `npx convex deploy`
- SQLite auth database requires persistent filesystem (not compatible with serverless without migration)

## Testing Strategy

No test files, test framework, or test configuration detected in the project. No test scripts in `package.json`.

---

_Generated using BMAD Method `document-project` workflow_
