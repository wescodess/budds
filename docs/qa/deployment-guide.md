# Budds Deployment Guide

## Environments

| Environment | Frontend | Backend | URL |
|---|---|---|---|
| Local dev | `nuxt dev` (port 3002) | `npx convex dev` | `http://localhost:3002` |
| Staging | Cloudflare Pages (preview branch) | Convex preview deployment | Per-branch preview URL |
| Production | Cloudflare Pages | Convex production deployment | Production `SITE_URL` |

## Build Process

```bash
pnpm build
```

This runs `node scripts/validate-env.mjs build --strict` to verify required environment variables, then `nuxt build` which produces a Cloudflare Pages-compatible output in `dist/` using the `cloudflare_pages` Nitro preset.

The build output includes:
- Server-side rendered pages via Cloudflare Workers
- Client-side Vue SPA assets
- Nitro server routes (API endpoints)

## Frontend Deployment

### Cloudflare Pages

```bash
pnpm deploy
```

This runs the full build and then the pinned Wrangler 4.128.0 CLI with an
explicit `budds` project target. Production releases should additionally pass
the release branch and commit metadata from a clean checkout.

For local Wrangler configuration, copy `wrangler.local.toml.example` to `wrangler.local.toml`. The example configures:
- `nodejs_compat` compatibility flag
- D1 database binding (`budds-auth-db`)
- R2 bucket binding (`budds`)

Production deployment is managed through the Cloudflare Pages dashboard or Wrangler CLI. Environment variables and secrets are set in the Cloudflare Pages dashboard.

### Nuxt Configuration

Key deployment settings in `nuxt.config.ts`:
- Nitro preset: `cloudflare_pages`
- Auth proxy forwards to Convex HTTP actions
- Route rules enforce auth on `/app/**` routes
- Audio routes use stale-while-revalidate caching (300s)

## Backend Deployment (Convex)

### Development

```bash
npx convex dev
```

Starts a development server that syncs schema and functions on file change.

### Production

```bash
npx convex deploy
```

Deploys all Convex functions, schema, and cron jobs to the production deployment.

## Production Release Order

Release only from a clean, pushed commit after `pnpm verify` and the hosted CI
gate pass. Record the current Pages deployment ID and Worker version before
changing production.

Confirm the Cloudflare account remains on the Workers Paid `standard` usage
model. `GET /api/export/me` intentionally streams the full export in one Pages
Function invocation and can exceed the Workers Free plan's 50 outbound
subrequests. A plan downgrade requires moving export assembly to a resumable
background job first.

1. Deploy Convex first with type checking enabled. Schema changes must be
   backward-compatible with the currently served frontend.
2. Deploy the Workflow Worker and preserve remotely managed variables:

   ```bash
   pnpm --dir workers/audio-overview exec wrangler deploy --env production --keep-vars
   ```

3. Promote the tested commit to `main` and let the existing Cloudflare Pages
   Git integration perform the single production frontend deployment. Do not
   also run a manual Pages deployment for the same release.
4. Run the public and authenticated smoke gates below. A successful HTML
   response alone is not release proof.

For an intentionally manual Pages release, pause automatic production deploys
first and pass explicit project, branch, commit, and clean-tree metadata to the
pinned Wrangler version.

## Environment Variables

### Convex (set via `npx convex env set`)

| Variable | Required | Description |
|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | Secret for Better Auth session signing |
| `SITE_URL` | Yes | Nuxt app origin (e.g., `https://budds.app`) |
| `CONVEX_SITE_URL` | Yes | Convex HTTP actions URL |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `CALENDAR_TOKEN_ENCRYPTION_KEY` | Yes | Base64-encoded 32-byte AES key; must exactly match the Pages secret |

### Cloudflare Pages / Nuxt Runtime

| Variable | Required | Description |
|---|---|---|
| `NUXT_PUBLIC_CONVEX_URL` | Yes | Convex deployment URL |
| `SITE_URL` | Yes | App origin |
| `AUTH_PROXY_TARGET_URL` | No | Override Convex site URL for auth proxy |
| `NUXT_CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `NUXT_CLOUDFLARE_AI_GATEWAY_ID` | Yes | AI Gateway identifier |
| `NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY` | Yes | AI Gateway API key |
| `NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE` | No | AI Search instance name |
| `NUXT_CLOUDFLARE_AI_SEARCH_TOKEN` | No | AI Search auth token |
| `NUXT_OPENROUTER_API_KEY` | Yes | OpenRouter API key for LLM routing |
| `NUXT_CLOUDFLARE_WORKERS_AI_TOKEN` | No | Workers AI auth token |
| `NUXT_R2_ENDPOINT` | Yes | R2 storage endpoint |
| `NUXT_R2_ACCESS_KEY_ID` | Yes | R2 access key |
| `NUXT_R2_SECRET_ACCESS_KEY` | Yes | R2 secret key |
| `NUXT_R2_BUCKET_NAME` | Yes | R2 bucket name |
| `NUXT_AUDIO_OVERVIEW_JOB_SECRET` | Yes | Capability-signing secret for authoritative Audio Overview jobs |
| `NUXT_AUDIO_OVERVIEW_WORKER_TOKEN` | Yes | Shared 32+ character launch/orchestration credential; must also be set in Convex |
| `NUXT_AUDIO_OVERVIEW_WORKER_URL` | Local only | Local Worker URL; production uses the service binding |
| `NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY` | Yes | Server-only calendar token encryption key; must exactly match `CALENDAR_TOKEN_ENCRYPTION_KEY` in Convex |

### Audio Overview Workflow Worker

| Variable or binding | Required | Description |
|---|---|---|
| `AUDIO_OVERVIEW_WORKER_TOKEN` | Yes | Must match the Pages launch token and the Convex deployment secret |
| `GEMINI_API_KEY` | Yes | Server-only Gemini renderer key; never expose through Nuxt public config or Workflow parameters |
| `PAGES_BASE_URL` | Yes | Pages callback origin used by durable stages |
| `AUDIO_OVERVIEW_WORKFLOW` | Yes | Cloudflare Workflow binding |
| `AUDIO_ARTIFACTS` | Yes | Private R2 binding (`budds-dev` locally, `budds` in production) |
| `AI` | Yes | Workers AI binding for transcript quality evidence and alignment |

Dia variables are retained only for legacy evaluation and do not configure production Audio Overviews.

### Local Development

Create `.env` and/or `.env.local` in the project root. The Nuxt config reads from both files. Google OAuth redirect URI must point to `${CONVEX_SITE_URL}/api/auth/callback/google`.

## Post-deployment Verification

1. **Frontend health**: Load the production URL, confirm the login page renders without console errors.
2. **Auth flow**: Complete a Google OAuth login. Verify redirect back to the app and session cookie creation.
3. **Convex connectivity**: After login, verify the dashboard loads and folder data appears (real-time subscription is active).
4. **API routes**: Create a folder, upload a document, start a chat. Verify the AI response streams correctly.
5. **Audio overview**: Run an owner-triggered generation from indexed sources. Verify durable progress, grounded scene evidence, private WAV range playback, transcript speaker changes, realtime alignment, interjection pause/resume, cost telemetry, and cleanup/cancellation.
6. **Cron jobs**: Check the Convex dashboard to confirm scheduled functions are registered and running.

## Rollback Procedures

### Frontend (Cloudflare Pages)

Cloudflare Pages maintains deployment history. To rollback:

1. Go to the Cloudflare Pages dashboard for the project.
2. Navigate to **Deployments**.
3. Find the last known-good deployment.
4. Click **Rollback to this deployment**.

List deployments via CLI, then perform the rollback in the Cloudflare
dashboard. Wrangler 4.128.0 does not expose a Pages rollback command:
```bash
pnpm dlx wrangler@4.128.0 pages deployment list --project-name budds
```

### Backend (Convex)

Convex does not natively support instant rollback. To revert:

1. Check out the last known-good commit in git.
2. Run `npx convex deploy` from that commit to push the previous function versions.
3. If a schema migration was involved, a data migration may be required -- follow the widen-migrate-narrow pattern documented in Convex guidelines.

### Coordinated Rollback

If both frontend and backend changes are coupled:

1. Rollback the frontend first (stops users from hitting new API paths).
2. Rollback the backend (redeploy previous Convex functions).
3. Verify the application works end-to-end.
