# Learn V2 browser E2E

Run `pnpm test:e2e:learn-v2`. The runner starts a local Convex deployment and Nuxt on port 3102, with `BUDDS_E2E_MODE` held only in the server process. It refuses production, deploy-key, and preselected-deployment environments.

The disposable session route delegates to Better Auth's normal email/password endpoint; it does not insert database rows or mint a cookie. Deterministic AI/source fixtures are server-side and activate only after the same non-production guard.

The browser spec intentionally marks only the route-specific selectors pending until the journey UI lands: `learn-v2-create-mission`, `learn-v2-outcome`, `learn-v2-save-outcome`, `learn-v2-accept-sources`, `learn-v2-accept-map`, `learn-v2-complete-calibration`, and `learn-v2-accept-plan`. No state is seeded or bypassed while those integration points are absent.
