---
project_name: 'budds'
user_name: 'palmwine'
date: '2026-04-08'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 42
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Nuxt** ^4.0.0 (full-stack framework, `app/` directory)
- **Vue** ^3.5.13 (Composition API, `<script setup>`)
- **TypeScript** ^5.7.2
- **Tailwind CSS** ^4.0.0 (Vite plugin, NOT PostCSS)
- **pnpm** (package manager)
- **Convex** 1.34.1 + nuxt-convex 0.0.6 (application data)
- **Better Auth** 1.6.0 + @onmax/nuxt-better-auth 0.0.2-alpha.31 (Google OAuth)
- **better-sqlite3** 12.8.0 (auth DB at `./data/auth.db`)
- **shadcn-nuxt** ^2.5.1 + Reka UI ^2.9.5 (UI components, prefix: `Ui`)
- **VueUse** ^14.2.1, **Lucide Vue Next** ^1.0.0, **tw-animate-css** ^1.4.0
- **Cloudflare AI Gateway** (LLM routing via OpenRouter)
- **Cloudflare AI Search** (RAG document retrieval)
- **Dev server** port: 3002

## Critical Implementation Rules

### Language-Specific Rules

- Nuxt auto-imports are active — do NOT manually import Vue APIs (`ref`, `computed`, `watch`, `nextTick`), Nuxt utilities (`definePageMeta`, `useRuntimeConfig`, `navigateTo`, `createError`, `readBody`, `$fetch`), or composables/server utils
- Composables in `app/composables/` are auto-imported by export name
- Server utils in `server/utils/` are auto-imported within server context
- TypeScript config is Nuxt-managed — do NOT add a custom tsconfig; extend `.nuxt/tsconfig.json`
- Server errors must use `createError({ statusCode, message })` — not `throw new Error()`
- Interfaces are co-located in the files that use them, not in a shared `types/` directory
- Use `$fetch` for internal API calls from client code, not `fetch` or `axios`

### Framework-Specific Rules

- Nuxt 4 `app/` directory structure — all frontend code lives under `app/`
- Vue SFCs: `<script setup lang="ts">` + `<template>` only — use Tailwind classes, no `<style>` blocks
- shadcn-nuxt components use `Ui` prefix (e.g., `<UiButton>`, `<UiInput>`) — component dir: `@/components/ui`
- Route protection via `routeRules` in nuxt.config — `/app/**` = authenticated, `/login` = guest only
- Auth composable: `useUserSession()` from `@onmax/nuxt-better-auth` — do NOT build custom auth state
- API routes: `server/api/` with `defineEventHandler` — parse body with `readBody<Type>(event)`
- All secrets go in `runtimeConfig` (server-only) — NEVER put secrets in `runtimeConfig.public`
- Server utils export reusable functions + interfaces from `server/utils/` — auto-imported in API handlers
- Convex: read `convex/_generated/ai/guidelines.md` before writing ANY Convex code
- No custom layouts, middleware, or plugins — add only when needed

### Testing Rules

- No test framework is currently configured — do NOT add test dependencies or test files unless explicitly requested
- When testing is introduced, prefer Vitest (aligned with Vite-based Nuxt toolchain)
- Do NOT create mock implementations of Cloudflare services or Convex without explicit direction

### Code Quality & Style Rules

- No ESLint or Prettier configured — maintain consistency by following existing code patterns
- Minimal comments — only add comments when absolutely critical (per project rules)
- Do NOT add JSDoc, inline documentation, or type annotations to code you didn't change
- API route files: `kebab-case.method.ts` (e.g., `chat.post.ts`)
- Composables: `camelCase` with `use` prefix (e.g., `useRag.ts`)
- Vue pages: `kebab-case.vue`
- Interfaces: `PascalCase` — co-located in the file that uses them
- Variables/functions: `camelCase`
- No `<style>` blocks in Vue SFCs — use Tailwind utility classes exclusively

### Development Workflow Rules

- Package manager: **pnpm only** — never use npm or yarn
- Branch naming: `feat/`, `fix/`, `refactor/` prefixes
- Commit messages: conventional format with type prefix (`feat:`, `fix:`, `refactor:`)
- No CI/CD or pre-commit hooks — manual quality checks
- Environment variables are required for all external services — never hardcode API keys or secrets
- `NUXT_PUBLIC_SITE_URL` is the only client-exposed env var — all others are server-only
- Local auth DB at `./data/auth.db` — do NOT commit this file

### Critical Don't-Miss Rules

- Tailwind CSS uses **Vite plugin** (`@tailwindcss/vite`), NOT PostCSS — do not add PostCSS config
- `@onmax/nuxt-better-auth` is alpha (0.0.2-alpha.31) — verify API usage against current module docs
- `nuxt-convex` is early (0.0.6) — check module docs before assuming Convex integration patterns
- Convex schema is empty — all data modeling is greenfield, not existing
- NEVER expose runtime config secrets to the client — only `runtimeConfig.public` is client-accessible
- Auth route protection is in `routeRules` (nuxt.config) — new protected pages under `/app/**` get auth automatically
- New public pages outside `/app/` are unprotected by default — add explicit route rules if auth needed
- RAG pipeline: search → context assembly → LLM call — maintain this sequence in any extensions
- Streaming endpoint exists but is unused in UI — when implementing streaming, use `generateCompletionStream`

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-04-08
