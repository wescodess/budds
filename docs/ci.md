# Continuous integration

Budds uses [`.github/workflows/test.yml`](../.github/workflows/test.yml) as its repository-owned merge gate for `main` and `dev`.

## Required checks

The workflow runs these stages:

1. `quality`: the 1,089-warning ESLint ratchet, application and Convex-native
   typechecks, and the root dependency audit.
2. `test`: four parallel suites for Convex/Nitro unit tests, Nuxt mounted components, the dedicated Audio Overview component harness, and the Audio Workflow Worker. The Worker shard also runs its own typecheck, environment-contract validation, and dependency audit.
3. `build`: strict configuration validation and a Cloudflare Pages production build.
4. `burn-in`: ten repetitions of every test suite on the weekly schedule or manual dispatch.
5. `report`: a single summary check that fails unless the required jobs pass.

The workflow uploads per-suite logs and retains the compiled Pages output for seven days. GitHub provides failed-check notifications; no Slack or email destination is configured.

## Configuration boundary

CI uses visibly synthetic values so configuration and compilation can be tested without contacting providers or exposing deployment secrets. Those values must never be replaced with production credentials in the workflow file.

No GitHub Actions secrets are required for the current validation-only pipeline. Production deployment remains a separately authorized operation and uses the Cloudflare Pages, Convex, and Worker secrets documented in the [development guide](./development-guide.md). A passing CI build is not evidence that those production secrets, provider quotas, service bindings, or external integrations work.

## Local parity

Run the non-deployment gate locally with:

```bash
pnpm verify
```

`pnpm verify` runs lint, the application and `convex/tsconfig.json` typechecks,
all test suites, and the root audit. Validate the Worker lockfile separately with:

```bash
pnpm --dir workers/audio-overview audit
```

`pnpm build` intentionally requires every blocking Pages runtime value described
by `scripts/validate-env.mjs`. Use disposable validation-only values for a local
compile; never put real secrets in shell history or source files.

## Branch protection

After the workflow has completed successfully on GitHub, require the `CI gate` check on `main` and `dev`. Do not enable the required check before its first successful remote run, because the workflow has only been validated locally until then.

## Troubleshooting

- Install failure during `postinstall`: confirm the synthetic global workflow environment is present; CI mode makes validation strict.
- Lint failure with no errors: the warning count exceeded the 1,089 baseline. Reduce the new warnings or deliberately lower the baseline after cleanup; do not raise it casually.
- Worker-only failure: reproduce with `node scripts/validate-env.mjs audio-workflow --strict`, `pnpm audio:workflow:typecheck`, and `pnpm audio:workflow:test` using non-production values.
- Build succeeds locally but fails remotely: compare Node 24, pnpm 9.12.3, lockfile state, and the strict environment-validation output.
