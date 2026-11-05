# Dependency audit remediation, 2026-11-05

Status: audit gate green, with two advisories accepted by ID. Remove each from `pnpm.auditConfig.ignoreGhsas` once a parent releases a fix.
Baseline: `origin/dev` at `7eaaf411481a32aec62d21752f4b991f7b65d836`.

## Audit evidence

Counts come from fresh `pnpm audit --json` runs, including development dependencies.

| Lockfile | Before (critical / high / moderate / low) | After | Exit after |
| --- | --- | --- | --- |
| Root | 5 / 33 / 36 / 18 = 92 | 0 / 0 / 1 / 1 = 2, both accepted by ID below | 0 |
| Audio Overview | 0 / 7 / 10 / 1 = 18 | 0 | 0 |
| Laya evaluator | 0 / 7 / 10 / 1 = 18 | 0 | 0 |

Accepted findings. Both are reached only at build or lint time and take input from this repository, not from learners. Ignoring them by ID keeps every other advisory, at every severity, blocking:

- [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low: `deepmerge@4.3.1`. No patched release exists. Current Nuxt 4.6.4 → Nitro 2.13.6 → `@rollup/plugin-node-resolve@16.0.3` still requires it.
- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate: `minimatch@10.2.5` remains through `@eslint/config-array@0.23.5` and `eslint-plugin-import-x@4.17.1`. The fixed major is 11. A trial override for the import plugin failed `pnpm lint:ci` with `SyntaxError: The requested module 'minimatch' does not provide an export named 'makeRe'`. The [current plugin source](https://github.com/un-ts/eslint-plugin-import-x/blob/v4.17.1/src/rules/no-internal-modules.ts) still imports that removed API. That incompatible override was removed.

No audit severity threshold, workflow, or test gate was changed.

## Upgrade scope

The root lockfile resolves Nuxt 4.6.4, Better Auth 1.7.16, Convex auth adapter 0.13.0, Nuxt auth wrapper 0.1.2, Convex 1.46.0, Zod 4.6.6, Mermaid 12.3.0, Vite 8.3.6, Vitest/coverage 4.1.12, Happy DOM 21.0.4 and Vue Test Utils 2.5.1.

Mermaid 11's latest release still requires KaTeX 0.16; Mermaid 12 permits the patched 0.18 line. Happy DOM 21 is required by its advisory. Convex 1.46 satisfies the updated adapter helper's peer range. TypeScript, Vitest, VueUse and TanStack keep their existing majors.

Both workers use Wrangler 4.157.0 and Vitest 4.1.12, with Vite 8.3.6. Wrangler supplies patched sharp and undici dependencies, replacing the workers' obsolete undici overrides. Laya's Workers types match Wrangler's peer requirement.

New overrides are limited to transitive parents whose current releases still declare old dependencies:

| Parent | Dependency | Reason |
| --- | --- | --- |
| `@onmax/nuxt-better-auth@0.1.2` | `auth@1.7.16` | Its published CLI pin is 1.7.0-rc.5 and brings its own vulnerable Better Auth. Align all official auth packages at 1.7.16. |
| TypeScript ESLint's estree, editorconfig, readdir-glob, ESLint | affected minimatch ranges → 11.0.1 | Their current manifests still require affected majors; lint, build and test checks cover these compatible paths. |
| js-beautify, `@vercel/nft` | affected glob ranges → 14.0.2 | Current parent manifests still require glob 13. |

Existing brace-expansion override targets advance to 2.1.7 and 5.0.12. Existing unrelated overrides remain unchanged; the obsolete Hono server override is removed. The Convex auth patch carries forward only its existing local-test component environment declarations.

## Better Auth compatibility and breaking changes

Reviewed the [1.6.30–1.7.16 changelog](https://github.com/better-auth/better-auth/blob/v1.7.16/packages/better-auth/CHANGELOG.md), [Convex adapter changelog](https://github.com/convex/better-auth/blob/v0.13.0/CHANGELOG.md), and [0.12 upgrade guide](https://labs.convex.dev/better-auth/upgrading/from-0-12).

- **Version alignment:** adapter 0.12.5 requires Better Auth `<1.7.0`; adapter 0.13.0 requires `>=1.7.16 <1.8.0`. Wrapper 0.1.2 accepts `>=1.7.0-rc.5 <2`. Exact runtime and CLI versions are 1.7.16. The built-in Convex component supplies 1.7's atomic verification operations and schema additions.
- **Forwarded origins:** 1.7 stops trusting ordinary forwarded headers by default. The upgraded Convex adapter checks its dedicated `x-better-auth-forwarded-host` and `-proto` headers against exact trusted origins. The Nuxt proxy now sets these from the request URL and replaces caller-supplied values. No broad proxy trust option was enabled.
- **OAuth state cutover:** 1.7.7 separates state encryption keys and verification namespaces. In-flight Google sign-ins must restart, and servers sharing auth state must upgrade together. This app has no Magic Link, SAML, OAuth Proxy plugin, or custom identifier overrides. No deployment was performed.
- **Account identity:** 1.7.0's required issuer migration was reverted in 1.7.3. The selected 1.7.16 continues to use provider/account identity; no account backfill is required for this upgrade.
- **Convex endpoint keys and OIDC:** adapter 0.13 renames server API keys and replaces the removed internal OIDC plugin. This app uses the unchanged `/api/auth/convex/token`, JWKS and discovery HTTP paths, with `getAuthConfigProvider()`. It does not act as an OIDC provider. No call-site rename is needed.
- **Rollback:** once the upgraded backend creates a signing key, its JWKS row carries an `alg` field the previous adapter schema rejects (`Unexpected field alg`), and Convex validates existing documents when a schema deploys. A plain dependency revert can then fail. Roll back with a build that keeps a schema accepting these fields; removing the data instead needs owner approval.
- **Other adapter constraints:** cookie-cache support is disabled by the new adapter; this app does not enable it. It does not configure `generateId: 'uuid'`, compound unique plugin indexes, unindexed auth sorting, cross-domain one-time tokens, or verbose adapter logs. Their changed behavior needs no application migration.
- **Other 1.7 migrations:** generic OAuth, experimental joins, custom OAuth providers, Electron, One Tap, device authorization, two-factor, organization, phone, SCIM and MCP plugins are absent from this auth setup. Their API/schema migrations do not apply.

Production still uses SSR (`clientOnly: false`); development's existing client-only setting is preserved. `server/api/auth/[...].ts` does not exist on this branch: `server/middleware/auth-proxy.ts` owns forwarding, ahead of the module's generated auth route. `convex/auth.ts`, `convex/http.ts`, and `server/middleware/convex-token.ts` need no runtime changes.

## Validation and limits

Node 24.20.0, pnpm 9.12.3. `.node-version` and `engines` now match the range Nuxt 4.6.4 requires. Validation uses the CI-only placeholder block from `.github/workflows/test.yml` in the local process; no deployment environment values were written.

- Frozen root and worker installations succeed.
- `pnpm verify` passes lint, app/Convex typechecks, 2,051 unit/server tests, 737 component tests, 38 audio component tests, 62 audio worker tests, nine Laya worker tests, worker typechecks and 13 Python tests. It then passes all three audits.
- `pnpm verify:learn-v2-beta` passes both typechecks, 319 unit tests and 74 component tests.
- `pnpm build` passes, including its built-output secret scan. This builds locally and does not deploy.
- Eleven new auth tests exercise the real Better Auth/Convex component and mocked Nuxt request boundaries: Google authorization URL, PKCE/state, trusted callbacks, local session issuance/readback, RSA JWT signature/issuer/audience, forged and tampered-signature cookies, session revocation, proxy cookies/redirects and SSR token exchange/failure. Origin checks are explicitly enabled in the test environment; Better Auth otherwise disables them under Vitest.

Live Google consent, code/token exchange, existing hosted sessions across the upgrade and cross-origin browser cookie behavior are unverified without live OAuth credentials. The authorization URL test preserves the current static `SITE_URL` callback through the Nuxt proxy; the live Google redirect allowlist has not been inspected or changed.

The last dev push run, [36616879189](https://github.com/wescodess/budds/actions/runs/36616879189), failed browser journeys at `page.reload` with `net::ERR_ABORTED` / `Not attached to an active page`. That browser failure was not reproduced or changed here. Feature code and workflows remain unchanged.
