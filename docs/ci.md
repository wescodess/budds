# Continuous integration

Budds defines its repository-owned merge gate for `main` and `dev` in [`.github/workflows/test.yml`](../.github/workflows/test.yml). GitHub-hosted execution is currently blocked by the account billing or spending restriction, so the same gate must be run locally and recorded until hosted execution is restored.

## Required checks

The workflow runs these stages:

1. `security`: a full-history Gitleaks scan that blocks committed credentials.
2. `quality`: a zero-warning ESLint gate, application and Convex-native
   typechecks, and the root dependency audit.
3. `test`: four parallel suites for Convex/Nitro unit tests, Nuxt mounted components, the dedicated Audio Overview component harness, and the Audio Workflow Worker. The Worker shard also runs its own typecheck, environment-contract validation, and dependency audit.
4. `build`: strict configuration validation and a Cloudflare Pages production build.
5. `burn-in`: ten repetitions of every test suite on the weekly schedule or manual dispatch.
6. `report`: a single summary check that fails unless the required jobs pass.

The workflow uploads per-suite logs and retains the compiled Pages output for seven days. GitHub provides failed-check notifications; no Slack or email destination is configured.

## Configuration boundary

CI uses visibly synthetic values so configuration and compilation can be tested without contacting providers or exposing deployment secrets. Those values must never be replaced with production credentials in the workflow file.

No GitHub Actions secrets are required for the current validation-only pipeline in this personal-account repository. Production deployment remains a separately authorized operation and uses the Cloudflare Pages, Convex, and Worker secrets documented in the [development guide](./development-guide.md). A passing CI build is not evidence that those production secrets, provider quotas, service bindings, or external integrations work.

If Gitleaks reports a committed credential, revoke or rotate it before treating deletion as remediation. Removing a value from the latest tree does not remove it from Git history; history rewriting is a separate, coordinated operation.

## Local parity

Run the non-deployment gate locally with:

```bash
pnpm verify
```

`pnpm verify` runs lint, the application and `convex/tsconfig.json` typechecks,
all test suites, and both dependency audits. To validate only the Worker lockfile, run:

```bash
pnpm --dir workers/audio-overview audit
```

`pnpm build` intentionally requires every blocking Pages runtime value described
by `scripts/validate-env.mjs`, then strips secret-bearing environment variables
before compilation so private values cannot become bundled runtime defaults.
The generated artifact still requires its Cloudflare Pages secrets at runtime.

## Current-plan merge controls

The repository is private, and protected branches for private repositories are not available on its current GitHub plan. The owner has declined a paid upgrade. Squash merging is the only enabled pull-request merge method, and merged branches are deleted automatically.

Until server-enforced protection is available, maintainers must use a pull request, avoid direct pushes to `main` and `dev`, run `pnpm verify` plus the strict production build from the exact proposed SHA, and record the results. This is an explicit procedural control, not equivalent to branch protection. If the repository later becomes public or its plan changes, require the `CI gate` check and pull-request review on `main` and `dev` after the first successful remote run.

## Troubleshooting

- Install failure during `postinstall`: confirm the synthetic global workflow environment is present; CI mode makes validation strict.
- Lint failure: fix the reported error or warning. The baseline is zero and must not be raised to merge new debt.
- Worker-only failure: reproduce with `node scripts/validate-env.mjs audio-workflow --strict`, `pnpm audio:workflow:typecheck`, and `pnpm audio:workflow:test` using non-production values.
- Build succeeds locally but fails remotely: compare Node 24, pnpm 9.12.3, lockfile state, and the strict environment-validation output.
