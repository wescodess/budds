<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Auth Setup (JWKS Bootstrap)

Convex auth requires a one-time JWKS bootstrap after first Google login:

1. Start dev servers: `pnpm dev` and `npx convex dev`
2. Log in with Google once (generates JWKS keys in SQLite)
3. Run `./scripts/bootstrap-jwks.sh`
4. Restart `npx convex dev`

## Testing

- `pnpm test` — Convex integration + server tests (edge-runtime/node)
- `pnpm test:component` — Vue component tests (nuxt environment + happy-dom)
- Component tests use `@nuxt/test-utils` with `mountSuspended`
- Convex tests use `convex-test` with `convexTest(schema, modules)`
