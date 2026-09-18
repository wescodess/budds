# Learn V2 browser E2E

Run `pnpm test:e2e:learn-v2` after starting an isolated local Convex deployment. The runner refuses production, deploy-key, and preselected-deployment environments; it requires an explicit localhost-only `BUDDS_E2E_CONVEX_URL` rather than guessing or modifying a deployment selector.

One-time local setup uses Convex's documented local deployment mode: run `pnpm exec convex deployment select local`, set the E2E function environment values (`BUDDS_E2E_MODE=true`, a 32+ character `BUDDS_E2E_AUTH_TOKEN`, `LEARN_V2_ENABLED=true`, `LEARN_V2_BLUEPRINT_PROVIDER_ENABLED=true`, `LEARN_V2_BLUEPRINT_MODEL=budds-e2e-fixture.v1`, `LEARN_V2_SESSION_CONTENT_PROVIDER_ENABLED=true`, `LEARN_V2_SESSION_CONTENT_MODEL=budds-e2e-fixture.v1`, and `LEARN_V2_MASTERY_MODEL=budds-e2e-fixture.v1`), then leave `pnpm exec convex dev --tail-logs disable` running. Pass its local URL as `BUDDS_E2E_CONVEX_URL`. CI deliberately fails with this instruction until an isolated local Convex service is provisioned.

The disposable session route delegates to Better Auth's normal email/password endpoint; it does not insert database rows or mint a cookie. Deterministic AI/source fixtures are server-side and activate only after the same non-production guard.

The browser spec intentionally marks only the route-specific selectors pending until the journey UI lands: `learn-v2-create-mission`, `learn-v2-outcome`, `learn-v2-save-outcome`, `learn-v2-accept-sources`, `learn-v2-accept-map`, `learn-v2-complete-calibration`, and `learn-v2-accept-plan`. No state is seeded or bypassed while those integration points are absent.
