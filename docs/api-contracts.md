# Budds - API Contracts

**Date:** 2026-04-08

## API Overview

Budds exposes 2 custom API endpoints via Nitro server routes, plus auto-generated auth endpoints from Better Auth. All custom endpoints are under `/api/rag/` and handle RAG (Retrieval-Augmented Generation) functionality.

## Endpoints

### POST `/api/rag/chat`

RAG chat endpoint that combines document search with LLM completion to generate contextual answers.

**File:** `server/api/rag/chat.post.ts`

**Request Body:**

```typescript
{
  query: string              // User's question (required)
  model: string              // LLM model identifier (required)
  history?: {                // Previous conversation messages
    role: 'user' | 'assistant'
    content: string
  }[]
  max_num_results?: number   // Max search results (default: 5)
  score_threshold?: number   // Minimum relevance score (default: 0.5)
  filters?: Record<string, any>  // Search filters
  temperature?: number       // LLM temperature (default: 0.7)
  max_tokens?: number        // Max response tokens (default: 1024)
  stream?: boolean           // Enable streaming response (default: false)
}
```

**Response (non-streaming):**

```typescript
{
  answer: string             // LLM-generated response
  model: string              // Model used
  usage?: {                  // Token usage stats
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  sources: {                 // Source documents referenced
    content: string          // Document chunk text
    score: number            // Relevance score
    filename?: string
    metadata?: Record<string, any>
  }[]
}
```

**Supported Models:**

| Display Name | Model ID |
|---|---|
| Claude Sonnet 4.5 | `anthropic/claude-sonnet-4-5` |
| Claude Haiku 3.5 | `anthropic/claude-3.5-haiku` |
| GPT-4o | `openai/gpt-4o` |
| Gemini 2.5 Flash | `google/gemini-2.5-flash-preview` |
| Llama 3.1 70B | `meta-llama/llama-3.1-70b-instruct` |
| DeepSeek V3 | `deepseek/deepseek-chat-v3-0324` |
| Mistral Small 3.1 | `mistralai/mistral-small-3.1-24b-instruct` |
| Qwen3 30B A3B | `qwen/qwen3-30b-a3b` |

**Error Responses:**

- `400` - Missing required fields (query, model)
- `500` - AI Gateway or AI Search service failure

---

### POST `/api/rag/search`

Standalone document search endpoint for semantic retrieval without LLM completion.

**File:** `server/api/rag/search.post.ts`

**Request Body:**

```typescript
{
  query: string              // Search query (required)
  max_num_results?: number   // Max results to return
  score_threshold?: number   // Minimum relevance score
  filters?: Record<string, any>  // Search filters
}
```

**Response:**

```typescript
{
  results: {
    content: string          // Document chunk text
    score: number            // Relevance score (0-1)
    filename?: string        // Source document name
    metadata?: Record<string, any>
  }[]
}
```

**Error Responses:**

- `400` - Missing required query field
- `500` - AI Search service failure

---

### Better Auth Endpoints (Auto-Generated)

Better Auth automatically registers endpoints under `/api/_better-auth/`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/_better-auth/sign-in/social` | POST | Initiate OAuth flow (Google) |
| `/api/_better-auth/callback/*` | GET | OAuth callback handler |
| `/api/_better-auth/session` | GET | Get current session |
| `/api/_better-auth/sign-out` | POST | End session |

These endpoints are managed entirely by the `@onmax/nuxt-better-auth` module and require no custom implementation.

## Server Utilities (Internal)

### `ai-gateway.ts`

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface GenerateParams {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
}

interface GenerateResponse {
  content: string
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

generateCompletion(params: GenerateParams): Promise<GenerateResponse>
generateCompletionStream(params: GenerateParams): AsyncGenerator<string>
```

### `ai-search.ts`

```typescript
interface AISearchParams {
  query: string
  max_num_results?: number
  score_threshold?: number
  filters?: Record<string, any>
  rerank?: boolean
}

interface AISearchChunk {
  content: string
  score: number
  filename?: string
  metadata?: Record<string, any>
}

interface AISearchResponse {
  results: AISearchChunk[]
}

searchDocuments(params: AISearchParams): Promise<AISearchResponse>
```

## Authentication

All `/app/**` routes (and by extension their API calls) are protected by Better Auth session validation. The auth middleware is configured via `nuxt.config.ts` route rules:

```typescript
routeRules: {
  '/app/**': { auth: 'user' as const },
  '/login': { auth: 'guest' as const },
}
```

API routes under `/api/rag/` are called from authenticated pages but do not independently verify authentication tokens - they rely on the Nuxt route-level middleware.

## Environment Variables Required

| Variable | Purpose | Used By |
|---|---|---|
| `CF_ACCOUNT_ID` | Cloudflare account ID | ai-search.ts |
| `CLOUDFLARE_AI_GATEWAY_ID` | AI Gateway instance name | ai-gateway.ts |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | AI Gateway auth key | ai-gateway.ts |
| `CLOUDFLARE_AI_SEARCH_INSTANCE` | AI Search instance name | ai-search.ts |
| `CLOUDFLARE_AI_SEARCH_TOKEN` | AI Search auth token | ai-search.ts |
| `OPENROUTER_API_KEY` | OpenRouter API key | ai-gateway.ts |
| `BETTER_AUTH_SECRET` | Auth encryption key | auth.config.ts |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | auth.config.ts |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | auth.config.ts |

---

_Generated using BMAD Method `document-project` workflow_
