# Budds - Development Guide

**Date:** 2026-04-08

## Prerequisites

- **Node.js** - LTS version recommended (v20+)
- **pnpm** - Package manager (project uses pnpm lockfile)
- **Google Cloud Console** - OAuth 2.0 credentials for authentication
- **Cloudflare Account** - With AI Gateway and AI Search instances configured
- **OpenRouter Account** - API key for LLM access
- **Convex Account** - Backend-as-a-service project

## Environment Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd budds
pnpm install
```

### 2. Configure Environment Variables

Create a `.env` file at the project root with:

```bash
# Authentication
BETTER_AUTH_SECRET=<random-secret-string>
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<your-google-oauth-client-secret>

# Convex
CONVEX_URL=<your-convex-deployment-url>

# Cloudflare AI Gateway
CF_ACCOUNT_ID=<your-cloudflare-account-id>
CLOUDFLARE_AI_GATEWAY_ID=<your-ai-gateway-name>
CLOUDFLARE_AI_GATEWAY_API_KEY=<your-ai-gateway-key>

# Cloudflare AI Search
CLOUDFLARE_AI_SEARCH_INSTANCE=<your-ai-search-instance>
CLOUDFLARE_AI_SEARCH_TOKEN=<your-ai-search-token>

# OpenRouter
OPENROUTER_API_KEY=<your-openrouter-api-key>
```

For local Convex development, create `.env.local`:

```bash
CONVEX_DEPLOYMENT=<local-convex-deployment-id>
CONVEX_URL=<local-convex-url>
CONVEX_SITE_URL=<local-convex-site-url>
```

### 3. Prepare Nuxt

```bash
npx nuxt prepare
```

This generates TypeScript types in `.nuxt/`.

### 4. Start Convex (if using locally)

```bash
npx convex dev
```

This starts the Convex development server and syncs schema/functions.

## Development Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server on port 3002 |
| `pnpm build` | Production build |
| `pnpm preview` | Preview production build locally |
| `pnpm generate` | Static site generation |
| `npx nuxt prepare` | Regenerate TypeScript types |
| `npx convex dev` | Start Convex development server |
| `npx convex deploy` | Deploy Convex to production |

## Local Development

```bash
pnpm dev
```

The dev server runs at `http://localhost:3002` (configured in `nuxt.config.ts`).

### Auto-Imports

Nuxt 4 auto-imports the following:

- **Composables** in `app/composables/` - Available globally in Vue components
- **Utilities** in `server/utils/` - Available globally in server routes
- **Vue APIs** - `ref`, `reactive`, `computed`, `watch`, etc.
- **Nuxt APIs** - `useRuntimeConfig`, `useFetch`, `navigateTo`, etc.

### Adding UI Components

shadcn-nuxt components are added on-demand:

```bash
npx shadcn-vue@latest add <component-name>
```

Components are generated in `app/components/ui/` with the `Ui` prefix.

### Adding Server Routes

Create files in `server/api/` following Nitro conventions:

```
server/api/example.get.ts    → GET  /api/example
server/api/example.post.ts   → POST /api/example
server/api/example/[id].ts   → ALL  /api/example/:id
```

### Adding Pages

Create files in `app/pages/` following Nuxt file-based routing:

```
app/pages/about.vue           → /about
app/pages/app/settings.vue    → /app/settings (requires auth)
app/pages/app/[id].vue        → /app/:id (dynamic route, requires auth)
```

### Adding Convex Functions

1. Define tables in `convex/schema.ts`
2. Create query/mutation/action files in `convex/`
3. Run `npx convex dev` to sync and generate types

## Build Process

```bash
pnpm build
```

Nuxt uses Vite to build the application. The output goes to `.output/` directory. The build includes:

- Server bundle (Nitro)
- Client bundle (Vue app)
- Static assets

## Project Conventions

### File Naming

- Vue pages: `kebab-case.vue`
- Composables: `useCamelCase.ts`
- Server routes: `route-name.method.ts`
- Utilities: `kebab-case.ts`

### Code Style

- TypeScript throughout (strict mode via Nuxt)
- Vue 3 Composition API with `<script setup>` syntax
- Tailwind CSS for all styling (no scoped styles)
- No test framework configured

### Authentication

Protected routes are configured in `nuxt.config.ts`:

```typescript
routeRules: {
  '/app/**': { auth: 'user' },
  '/login': { auth: 'guest' },
}
```

Any new page under `app/pages/app/` is automatically protected.

### Environment Variables

Server-only variables are accessed via `useRuntimeConfig()`:

```typescript
const config = useRuntimeConfig()
config.cloudflareAccountId  // server-only
config.public.siteUrl       // available on client
```

## Troubleshooting

### SQLite Build Issues

better-sqlite3 requires native compilation. If `pnpm install` fails:

```bash
pnpm rebuild better-sqlite3
```

### Auth Database Reset

Delete `data/auth.db` to reset all users and sessions. It will be recreated on next server start.

### Convex Type Errors

If Convex types are stale:

```bash
npx convex dev  # regenerates _generated/ types
```

### Port Already in Use

Dev server defaults to port 3002. If occupied, change in `nuxt.config.ts`:

```typescript
devServer: {
  port: 3003,  // or any available port
}
```

---

_Generated using BMAD Method `document-project` workflow_
