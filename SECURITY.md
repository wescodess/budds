# Security policy

Budds processes private source material and uses credentials for authentication, storage, AI providers, and deployment infrastructure. Security reports must remain private until remediation is complete.

## Reporting a vulnerability

Create a private repository security advisory from the GitHub **Security** tab. Do not open a public issue or include credentials, access tokens, private documents, session data, or provider responses in a pull request.

Include the affected surface, reproduction conditions, expected impact, and the smallest safe proof of concept. Redact account identifiers and use synthetic data whenever possible.

## Supported versions

Budds is currently pre-release. The latest commit on `main` is the only supported code line. Older branches and local deployments do not receive security fixes.

## Credential incidents

When a credential enters source control or build output:

1. Revoke or rotate it before relying on code deletion.
2. Update every authorized runtime without printing the replacement value.
3. Verify that the old credential can no longer authenticate.
4. Remove the value from the current tree and generated artifacts.
5. Scan every Git ref and release artifact.
6. Coordinate history removal when required.
7. Record sanitized evidence and prevention controls.

History rewriting does not invalidate a credential and cannot remove copies from third-party clones. Follow [`docs/operations/history-rewrite.md`](./docs/operations/history-rewrite.md) for repository-specific cleanup.

## Security expectations

- Derive authorization from trusted server identity, never caller-supplied ownership fields.
- Keep private configuration out of Nuxt public runtime config and client bundles.
- Store Audio Overview artifacts in private R2 buckets and authorize every read.
- Use bounded retries, budgets, and fail-closed provider behavior.
- Keep CI values synthetic and prohibit silent fallback to paid inference.
