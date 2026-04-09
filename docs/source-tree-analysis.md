# Budds - Source Tree Analysis

**Date:** 2026-04-08

## Overview

Budds follows Nuxt 4 conventions with a clear separation between frontend (`app/`), server-side logic (`server/`), and backend-as-a-service (`convex/`). The project is a single monolith with no workspace or monorepo structure.

## Complete Directory Structure

```
budds/
├── app/                        # Frontend application (Nuxt 4 app directory)
│   ├── app.vue                 # Root Vue component (renders NuxtPage)
│   ├── auth.config.ts          # Client-side auth configuration
│   ├── assets/
│   │   └── css/
│   │       └── tailwind.css    # Global styles, CSS variables, dark/light theme tokens
│   ├── composables/
│   │   └── useRag.ts           # RAG chat composable (messages, search, chat methods)
│   ├── lib/
│   │   └── utils.ts            # Utility: cn() class name merger (clsx + twMerge)
│   └── pages/
│       ├── index.vue           # Home/welcome page
│       ├── login.vue           # Google OAuth login page (guest-only)
│       └── app/
│           └── chat.vue        # RAG chat interface (authenticated)
├── server/                     # Server-side (Nitro)
│   ├── tsconfig.json           # Server TypeScript config
│   ├── auth.config.ts          # Better Auth config (SQLite + Google OAuth)
│   ├── api/
│   │   └── rag/
│   │       ├── chat.post.ts    # POST /api/rag/chat - RAG chat endpoint
│   │       └── search.post.ts  # POST /api/rag/search - Document search endpoint
│   └── utils/
│       ├── ai-gateway.ts       # Cloudflare AI Gateway wrapper (LLM completions)
│       └── ai-search.ts        # Cloudflare AI Search wrapper (document retrieval)
├── convex/                     # Convex backend-as-a-service
│   ├── convex.config.ts        # Convex app configuration
│   ├── schema.ts               # Database schema (currently empty)
│   └── _generated/             # Auto-generated Convex types and client
├── data/
│   └── auth.db                 # SQLite database for auth sessions/users
├── nuxt.config.ts              # Main Nuxt configuration
├── package.json                # Dependencies and scripts
├── pnpm-lock.yaml              # Lockfile
├── tsconfig.json               # Root TypeScript config (extends .nuxt/tsconfig)
├── components.json             # shadcn-vue component configuration
├── .env                        # Environment variables (secrets, API keys)
├── .env.local                  # Local Convex deployment overrides
├── .gitignore                  # Git ignore rules
├── .nuxtrc                     # Nuxt runtime configuration
├── CLAUDE.md                   # AI assistant project instructions
└── AGENTS.md                   # AI agent instructions
```

## Critical Directories

### `app/`

Nuxt 4 application directory containing all frontend code.

**Purpose:** Houses Vue pages, composables, styling, and client-side utilities
**Contains:** 3 pages, 1 composable, 1 utility library, global CSS
**Entry Points:** `app.vue` (root component)

### `app/pages/`

File-based routing following Nuxt conventions.

**Purpose:** Define application routes and their corresponding Vue components
**Contains:** 3 page components (index, login, app/chat)
**Entry Points:** Each file maps to a route automatically

### `app/composables/`

Vue 3 composition API composables auto-imported by Nuxt.

**Purpose:** Encapsulate reusable reactive logic
**Contains:** `useRag.ts` - core RAG chat state and API methods

### `server/api/rag/`

Nitro server API routes for RAG functionality.

**Purpose:** Handle AI chat and document search requests
**Contains:** 2 POST endpoints (chat, search)
**Integration:** Calls Cloudflare AI Gateway and AI Search via server utilities

### `server/utils/`

Server-side utility modules auto-imported by Nitro.

**Purpose:** Wrapper functions for external AI services
**Contains:** `ai-gateway.ts` (LLM completions), `ai-search.ts` (document search)
**Integration:** Cloudflare AI Gateway, OpenRouter, Cloudflare AI Search

### `convex/`

Convex backend-as-a-service directory.

**Purpose:** Define database schema, server functions, and backend logic
**Contains:** Empty schema (ready for application data), auto-generated types

## Entry Points

- **Main Entry:** `app/app.vue` (root Vue component)
- **Additional:**
  - `server/auth.config.ts`: Auth system bootstrap (Better Auth + SQLite)
  - `nuxt.config.ts`: Application configuration and module registration
  - `convex/convex.config.ts`: Convex backend configuration

## File Organization Patterns

Budds follows standard Nuxt 4 file-based conventions:
- **Pages** in `app/pages/` map directly to routes (`app/chat.vue` → `/app/chat`)
- **Composables** in `app/composables/` are auto-imported globally
- **Server routes** in `server/api/` follow `[method].ts` naming (`chat.post.ts` → `POST /api/rag/chat`)
- **Server utilities** in `server/utils/` are auto-imported in server context
- **Shared utilities** in `app/lib/` require explicit imports

## Key File Types

### Vue Single-File Components (`.vue`)

- **Pattern:** `app/pages/**/*.vue`
- **Purpose:** UI pages with template, script, and style sections
- **Examples:** `login.vue`, `app/chat.vue`

### TypeScript Server Routes (`.ts`)

- **Pattern:** `server/api/**/*.{get,post,put,delete}.ts`
- **Purpose:** Nitro API endpoints with HTTP method suffix
- **Examples:** `chat.post.ts`, `search.post.ts`

### TypeScript Composables (`.ts`)

- **Pattern:** `app/composables/use*.ts`
- **Purpose:** Reusable reactive logic following Vue 3 composition API
- **Examples:** `useRag.ts`

### Configuration Files (`.ts`, `.json`)

- **Pattern:** `*.config.ts`, `*.json`
- **Purpose:** Framework and tool configuration
- **Examples:** `nuxt.config.ts`, `components.json`, `convex.config.ts`

## Asset Locations

- **CSS**: `app/assets/css/` (1 file - Tailwind CSS theme)
- **Database**: `data/auth.db` (SQLite auth database, gitignored)

## Configuration Files

- **`nuxt.config.ts`**: Main app config - modules, runtime config, route rules, dev server port
- **`package.json`**: Dependencies, scripts, pnpm config
- **`tsconfig.json`**: TypeScript config (extends Nuxt-generated config)
- **`components.json`**: shadcn-vue component style and path configuration
- **`.nuxtrc`**: Nuxt runtime configuration overrides
- **`server/tsconfig.json`**: Server-specific TypeScript settings
- **`convex/tsconfig.json`**: Convex-specific TypeScript settings
- **`convex/convex.config.ts`**: Convex application definition
- **`server/auth.config.ts`**: Better Auth configuration (database, providers)
- **`app/auth.config.ts`**: Client-side auth configuration

## Notes for Development

- The `data/` directory is gitignored and contains the SQLite auth database - it will be created automatically on first run
- The `.nuxt/` directory is auto-generated by Nuxt and should not be edited manually
- Convex `_generated/` directory is auto-generated by `npx convex dev` and should not be edited
- All server utilities in `server/utils/` are auto-imported - no explicit import statements needed in API routes
- All composables in `app/composables/` are auto-imported globally in Vue components

---

_Generated using BMAD Method `document-project` workflow_
