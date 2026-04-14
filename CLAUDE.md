<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Auth Setup

Auth uses Better Auth running on Convex HTTP actions (`convex/auth.ts` + `convex/http.ts`).
`@onmax/nuxt-better-auth` runs in SSR mode (`clientOnly: false`) — the Nuxt server validates sessions via the auth proxy (`server/api/auth/[...].ts`) which forwards to Convex. A server middleware (`server/middleware/convex-token.ts`) fetches Convex JWT tokens during SSR so authenticated queries can run server-side.

Required Convex env vars (set via `npx convex env set`):
- `BETTER_AUTH_SECRET`
- `SITE_URL` (Nuxt app origin, e.g. `http://localhost:3002`)
- `CONVEX_SITE_URL` (Convex HTTP URL)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Google OAuth redirect URI must point to `${CONVEX_SITE_URL}/api/auth/callback/google`.

## Testing

- `pnpm test` — Convex integration + server tests (edge-runtime/node)
- `pnpm test:component` — Vue component tests (nuxt environment + happy-dom)
- Component tests use `@nuxt/test-utils` with `mountSuspended`
- Convex tests use `convex-test` with `convexTest(schema, modules)`
