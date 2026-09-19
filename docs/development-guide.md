# Budds - Development Guide

**Date:** 2026-09-03

## Prerequisites

- **Node.js** 22.19+ or 24.11+ as declared in `package.json` (`.node-version` selects 24.11.0)
- **pnpm** 9.12.3+
- **Convex CLI** (`npx convex`)
- **Google Cloud Console** OAuth 2.0 credentials
- **Google AI Studio** Gemini API key with paid API access for private Audio Overview rendering
- **Cloudflare account** with AI Gateway, AI Search, Workers AI, and R2 configured
- **OpenRouter account** with API key

## Installation

```bash
git clone <repository-url>
cd budds
pnpm install
```

The `postinstall` script runs `validate-env.mjs` and `nuxt prepare` automatically.

## Environment Variables

### Nuxt Server Runtime Config (`.env`)

| Variable | Alt Name | Purpose |
|---|---|---|
| `NUXT_PUBLIC_CONVEX_URL` | `CONVEX_URL` | Convex deployment URL |
| `SITE_URL` | `NUXT_PUBLIC_SITE_URL` | Application origin (e.g. `http://localhost:3002`) |
| `AUTH_PROXY_TARGET_URL` | `NUXT_AUTH_PROXY_TARGET_URL` | Auth proxy target (defaults to Convex site URL) |
| `NUXT_CLOUDFLARE_ACCOUNT_ID` | `CF_ACCOUNT_ID` | Cloudflare account ID |
| `NUXT_CLOUDFLARE_AI_GATEWAY_ID` | `CLOUDFLARE_AI_GATEWAY_ID` | AI Gateway instance ID |
| `NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY` | `CLOUDFLARE_AI_GATEWAY_API_KEY` | AI Gateway API key |
| `NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE` | `CLOUDFLARE_AI_SEARCH_INSTANCE` | AI Search instance name |
| `NUXT_CLOUDFLARE_AI_SEARCH_TOKEN` | `CLOUDFLARE_AI_SEARCH_TOKEN` | AI Search auth token |
| `NUXT_OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` | OpenRouter API key for LLM access |
| `NUXT_CLOUDFLARE_WORKERS_AI_TOKEN` | `CLOUDFLARE_WORKERS_AI_TOKEN` | Workers AI auth token |
| `NUXT_R2_ENDPOINT` | `R2_ENDPOINT` | R2 S3-compatible endpoint |
| `NUXT_R2_ACCESS_KEY_ID` | `R2_ACCESS_KEY_ID` | R2 access key |
| `NUXT_R2_SECRET_ACCESS_KEY` | `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `NUXT_R2_BUCKET_NAME` | `R2_BUCKET_NAME` | R2 bucket name |
| `NUXT_AUDIO_OVERVIEW_JOB_SECRET` | `AUDIO_OVERVIEW_JOB_SECRET` | HMAC secret used to derive per-job capabilities |
| `NUXT_AUDIO_OVERVIEW_WORKER_TOKEN` | `AUDIO_OVERVIEW_WORKER_TOKEN` | Shared 32+ character launch/orchestration credential for the Workflow Worker and Convex lifecycle mutations |
| `NUXT_AUDIO_OVERVIEW_WORKER_URL` | `AUDIO_OVERVIEW_WORKER_URL` | Local Worker URL; production uses the service binding instead |
| `NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY` | `CALENDAR_TOKEN_ENCRYPTION_KEY` | Server-only Base64 AES key; use the `NUXT_` name in Pages and the unprefixed name in Convex |

Dia variables are legacy evaluation settings. They do not configure the production Audio Renderer, and production generation must never fall back to Dia or Aura.

### Laya decision-evaluator pilot (private, opt-in)

Quiz generation can send a bounded, advisory-only shadow request to the private
`budds-laya-evaluator` Worker. It never changes generated questions, quiz
publication, persistence, or learner scoring. Set `NUXT_LEARNING_DECISION_MODE=shadow`,
`NUXT_LEARNING_DECISION_PROVIDER=laya`, and the 32+ character
`NUXT_LAYA_EVALUATOR_TOKEN` as Pages secrets. In production,
bind the Worker as `LAYA_EVALUATOR`; the local-only `NUXT_LAYA_EVALUATOR_URL` is an
HTTP(S) fallback for development. Keep all three server-only and never expose the
Worker to browsers or Convex.

Deploy the evaluator separately after setting its `LAYA_EVALUATOR_TOKEN` secret and
choosing a conservative `LAYA_DAILY_ALLOWANCE` (default 50 UTC requests):

```bash
pnpm --dir workers/laya-evaluator install --frozen-lockfile
pnpm --dir workers/laya-evaluator test
pnpm --dir workers/laya-evaluator typecheck
python -m unittest discover -s workers/laya-evaluator/service/tests -p 'test_*.py'
pnpm --dir workers/laya-evaluator deploy:dry
```

The image pins `laya==0.3.3` and the `convaiinnovations/laya-typed-decisions` revision
`f9ab0b228f0fc0f14d873dbc99038f135c2da1b2` (including a checked model.safetensors SHA256), downloaded while building and run
offline thereafter. Torch is installed from the CPU-only wheel index and the
top-level inference dependencies are exact-pinned. The upstream model card currently declares Apache-2.0; review
the model card and package provenance before a production deployment. The container
uses one named `budds-shadow-v1` instance, `max_instances: 1`, serialized CPU
inference, a five-minute sleep timeout, and a daily UTC cap. A cold request polls
the private readiness endpoint for roughly 20 seconds before consuming allowance;
hosted quiz generation keeps this advisory work alive with Cloudflare `waitUntil`
while returning the user-facing quiz without waiting for Laya. Its storage is only a
daily counter: prompts, sources, learner state, and raw model output are not
persisted or logged. Logs contain only sanitized status, count, timing, model,
and aggregate-confidence fields.

The authenticated private `POST /v1/lifecycle/stop` operation is the deterministic
scale-to-zero control for staging smoke tests and incident response. It is reachable
only through an explicit service binding and uses the same bearer secret as
evaluation; it force-destroys the current Container instance and never changes the
daily evaluation allowance.
A non-2xx, malformed response, cold start, timeout, or exhausted cap is
treated as unavailable and leaves quiz behavior unchanged.

### Audio Overview Workflow Worker

| Secret, variable, or binding | Kind | Purpose |
|---|---|---|
| `AUDIO_OVERVIEW_WORKER_TOKEN` | Secret | Authenticates launch requests from Pages |
| `GEMINI_API_KEY` | Secret | Server-side Google AI Studio key for Gemini 3.1 Flash TTS through the Interactions API; never expose it through Nuxt public config or Workflow parameters |
| `PAGES_BASE_URL` | Variable | Origin used for the current capability-authenticated Pages callback |
| `AUDIO_ARTIFACTS` | Private R2 binding | Stores deterministic Scene PCM and final WAV Audio Artifacts |

The checked-in Worker config binds `AUDIO_ARTIFACTS` to the local/development bucket. Bind the same name to a separate private production bucket before deployment. Keep public development URLs, custom domains, and anonymous object access disabled for both buckets.

### Convex Environment Variables (set via `npx convex env set`)

| Variable | Purpose |
|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Better Auth session signing secret in deployed environments (`BETTER_AUTH_SECRET` remains a local-development fallback) |
| `SITE_URL` | Application origin |
| `CONVEX_SITE_URL` | Convex HTTP URL |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `CALENDAR_TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key; set the same secret in Nuxt/Pages and Convex |
| `AUDIO_OVERVIEW_JOB_SECRET` | Must exactly match the Pages/Nuxt Audio Overview job secret so Convex can verify server-derived capabilities |
| `AUDIO_OVERVIEW_WORKER_TOKEN` | Must exactly match the 32+ character Pages/Nuxt and Worker token; seals Interjection scripting, rendering, failure, and publication mutations from browser callers |
| `LEARN_V2_ENABLED` | Convex-only internal-beta gate; enabled only by the exact string `true` and otherwise defaults off |

`LEARN_V2_ENABLED` belongs only to the Convex environment. Do not duplicate it
in Nuxt runtime config, Cloudflare Pages variables, or any public/client-visible
variable. Per-user cohort entitlement remains a separate server-authoritative
check, so the global flag alone never grants access.

Rollback disables `LEARN_V2_ENABLED` (or removes the entitlement), immediately
blocking ordinary V2 lifecycle access without deleting additive records.
Account deletion and redacted export remain available during rollback.

### Local Convex Overrides (`.env.local`)

```bash
CONVEX_DEPLOYMENT=<local-deployment-id>
CONVEX_URL=<local-convex-url>
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server on port 3002 |
| `pnpm dev:stack` | Start Nuxt, Convex dev, and the Audio Overview Workflow Worker together; stop all three with Ctrl-C |
| `pnpm build` | Validate env vars and build for production |
| `pnpm deploy` | Build and deploy to Cloudflare Pages via Wrangler |
| `pnpm preview` | Preview production build locally |
| `pnpm test` | Run Convex integration and server tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:component` | Run Vue component tests |
| `pnpm test:component:watch` | Run component tests in watch mode |
| `pnpm typecheck` | TypeScript type checking via vue-tsc |
| `pnpm lint` | Lint with ESLint |
| `pnpm audio:workflow:dev` | Start the local Audio Overview Workflow Worker on port 8787 |
| `pnpm audio:workflow:test` | Run the standalone Workflow tests |
| `pnpm audio:workflow:typecheck` | Type-check the standalone Workflow Worker |
| `node scripts/validate-env.mjs audio-workflow --strict` | Validate Worker secrets, callback origin, and the private R2 binding |
| `npx convex dev` | Start Convex dev server (syncs schema and functions) |
| `npx convex deploy` | Deploy Convex to production |

## Local Development Workflow

### 1. Start Convex

```bash
npx convex dev
```

This watches `convex/` for changes, syncs schema and functions, and regenerates `convex/_generated/` types.

### 2. Start the Audio Overview Workflow

Use the same local launch token for Nuxt and the Worker. Add a server-side Gemini key to the ignored Worker secrets file, and keep both values out of source control.

```bash
cp workers/audio-overview/.dev.vars.example workers/audio-overview/.dev.vars
# Set AUDIO_OVERVIEW_WORKER_TOKEN and a Google AI Studio API key in .dev.vars.
# Do not use an OAuth access token (for example, ya29.*) as GEMINI_API_KEY.
# Set the same launch token as NUXT_AUDIO_OVERVIEW_WORKER_TOKEN in .env.local.
# Mirror that exact launch token into the active Convex deployment:
# pnpm exec convex env set AUDIO_OVERVIEW_WORKER_TOKEN '<same-32+-character-token>'
# The Worker dev script binds PAGES_BASE_URL to http://localhost:3002.
node scripts/validate-env.mjs audio-workflow --strict
pnpm audio:workflow:dev
```

The development binding connects to the private remote `budds-dev` R2 bucket so
the local Nuxt S3 proxy and the Workflow see the same artifacts. Do not point
this binding at a production bucket. R2 remains private; browser playback goes
through the owner/share-authorized media endpoints.

For local Nuxt, also set `NUXT_AUDIO_OVERVIEW_WORKER_URL=http://localhost:8787`,
`NUXT_AUDIO_OVERVIEW_WORKER_TOKEN`, and a strong
`NUXT_AUDIO_OVERVIEW_JOB_SECRET` in `.env.local`. Set that exact job secret in
the active Convex development deployment as `AUDIO_OVERVIEW_JOB_SECRET`, and
set the exact worker token there as `AUDIO_OVERVIEW_WORKER_TOKEN`.

### 3. Start Nuxt

```bash
pnpm dev
```

The dev launcher automatically reads the ignored `.env.audio-workflow.local`
file before starting Nuxt, while Nuxt continues to read the normal `.env`
file. It prints an explicit warning when any Audio Overview job variable is
missing. The dev server runs at `http://localhost:3002`.

### 4. All Three Together

Run `pnpm dev:stack` to start Convex, the Workflow Worker, and Nuxt under one
supervised command, or use the three commands above in separate terminals.
Convex owns realtime job state; the Worker continues generation after the
browser request has returned. The stack can boot without `GEMINI_API_KEY` for
non-audio development, but production audio rendering fails closed until that
key is set in `workers/audio-overview/.dev.vars`.

For production, the Wrangler `production` environment binds the existing
private `budds` bucket, while local development uses only `budds-dev`. Set
`GEMINI_API_KEY` and
`AUDIO_OVERVIEW_WORKER_TOKEN` with `wrangler secret put`, set the Worker's
`PAGES_BASE_URL` variable to the public Pages origin, validate the Worker, then
deploy it with `pnpm --dir workers/audio-overview exec wrangler deploy --env production --keep-vars`. The checked-in production configuration pins `PAGES_BASE_URL` to `https://budds.pages.dev`; keep `--keep-vars` during release so an older checkout cannot remove remotely managed variables. Add a Cloudflare Pages service binding named
`AUDIO_OVERVIEW_WORKFLOW` targeting that Worker. Set the job secret and launch
token as Pages secrets, and set the same job secret in the production Convex
deployment. Also set the exact worker token in production Convex as
`AUDIO_OVERVIEW_WORKER_TOKEN`. Never place either credential or the Gemini key
in Pages client-visible variables. Keep the Pages compatibility date at
`2025-04-14` or later and enable the `nodejs_compat` compatibility flag in the
Cloudflare dashboard. Nitro compiles with native Node compatibility enabled,
but this repository intentionally has no root `wrangler.toml`, so the dashboard
remains the deployment authority for that flag.

## Convex Development

Schema is defined in `convex/schema.ts`. Queries, mutations, and actions are in individual files per domain (e.g. `convex/folders.ts`, `convex/documents.ts`).

Before writing Convex code, read `convex/_generated/ai/guidelines.md` for API patterns and rules.

Convex test files live alongside their source files (e.g. `convex/folders.test.ts`) and use the `convex-test` library.

## Auth Flow

1. Google OAuth redirects to `${CONVEX_SITE_URL}/api/auth/callback/google`
2. Better Auth runs on Convex HTTP actions (`convex/auth.ts` + `convex/http.ts`)
3. Nuxt server middleware (`server/middleware/auth-proxy.ts`) proxies auth requests to Convex
4. SSR middleware (`server/middleware/convex-token.ts`) fetches Convex JWT tokens for server-side authenticated queries
5. Client plugin (`app/plugins/convex-auth.client.ts`) syncs auth state

## Route Protection

Protected routes are declared in `nuxt.config.ts`:

```typescript
routeRules: {
  '/': { auth: 'user' },
  '/app': { auth: 'user' },
  '/app/**': { auth: 'user' },
  '/login': { auth: 'guest' },
}
```

Any new page under `app/pages/app/` is automatically protected.

## Adding UI Components

```bash
npx shadcn-vue@latest add <component-name>
```

Components install to `app/components/ui/` with the `Ui` prefix.

## Testing

### Convex Integration Tests

```bash
pnpm test
```

Uses `convex-test` with `convexTest(schema, modules)`. Tests run in edge-runtime/node.

### Vue Component Tests

```bash
pnpm test:component
```

Uses `@nuxt/test-utils` with `mountSuspended` in a happy-dom environment. Test files are in `tests/component/` organized by feature.

## Build and Deploy

```bash
pnpm build
```

Runs `validate-env.mjs` in strict mode before building. Builds for `cloudflare_pages` preset. Output goes to `dist/`.

```bash
pnpm deploy
```

Builds and deploys to Cloudflare Pages via Wrangler.

## Troubleshooting

### Convex Type Errors

Regenerate types by restarting the Convex dev server:

```bash
npx convex dev
```

### Port Conflict

Dev server defaults to port 3002. Change in `nuxt.config.ts` under `devServer.port`.

### Build Fails on Missing Env

The `validate-env.mjs` script checks required variables before building. Ensure all variables in the table above are set.

### Audio Overview Stops Before Rendering

Run the Worker-specific validation from the repository root:

```bash
node scripts/validate-env.mjs audio-workflow --strict
```

The command checks `workers/audio-overview/.dev.vars` without printing secret values. It fails when the launch token, Gemini key, callback origin, or `AUDIO_ARTIFACTS` binding is missing. A configured Dia or Aura value does not satisfy this check.

### Audio Overview Interjection Cost Controls

Version 2 interjections are server-reserved before any provider work. A user may reserve at most 10 per UTC day and an episode may contain at most 20. Each new reservation records a 40,000 micro-USD budget allowance; an idempotent retry returns the original reservation before evaluating or consuming quota.

At publication, `estimatedCostMicrousd` is reconciled from the actual WAV duration using a planning estimate of 1,000 micro-USD for script generation plus 250 micro-USD per synthesized second. This value is an operating estimate, not a provider invoice or billing record.
