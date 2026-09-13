# Contributing to Budds

Budds uses short-lived branches, reviewable commits, and an evidence-based merge gate. Keep each change small enough to understand, test, and revert independently.

## Branches

Create branches from the latest `main` using one of these prefixes:

- `feat/` for product behavior.
- `fix/` for defects.
- `refactor/` for behavior-preserving design improvements.
- `test/` for test-only changes.
- `docs/` for documentation-only changes.
- `chore/`, `build/`, or `ci/` for repository and delivery work.

Use lowercase, hyphenated names such as `feat/audio-overview-room`. Delete the branch after its pull request merges.

## Commits

Use Conventional Commit subjects:

```text
type(optional-scope): imperative summary
```

Examples:

```text
feat(audio-overview): persist room-scoped generation history
fix(auth): preserve the session across SSR refresh
ci(security): scan repository history for secrets
```

Each commit must represent one concern, include its tests, and leave the relevant workspace buildable. Keep automated formatting separate from behavioral work. Explain migrations, security consequences, compatibility constraints, or non-obvious tradeoffs in the commit body.

Do not add follow-up `mark done` or `write verdict` commits to `main`. Include issue state and evidence updates in the owning pull request.

## Development workflow

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Read `convex/_generated/ai/guidelines.md` before changing Convex code.
3. Add or update tests with the implementation.
4. Run the focused suite while developing.
5. Run `pnpm verify` before requesting review.
6. Run `pnpm build` for changes to configuration, dependencies, server code, or deployment behavior.
7. Open a pull request using the repository template.

Never use production credentials for local or CI validation. Keep demo, fixture, and synthetic evidence explicitly identified.

## Pull requests

Pull-request titles must follow the same Conventional Commit format. A pull request must describe:

- The user or operational outcome.
- The important implementation decisions.
- The tests and evidence produced.
- Security, privacy, schema, configuration, and deployment effects.
- A rollback path for changes that affect persistent state or production infrastructure.

Use squash merge after all required checks pass. The pull-request title becomes the commit subject on `main`.

## Generated and historical files

Commit generated Convex types when their owning schema or function interface changes. Do not commit `.env*`, `.nuxt/`, `.output/`, `dist/`, provider responses containing user data, local screenshots, or scratch scripts.

Keep active documentation current. Move completed or superseded plans to `docs/archive/` and label them historical. Treat `_bmad-output/` as project evidence, not as the current runtime contract.
