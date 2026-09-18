# Learn V2 browser E2E

Run `pnpm test:e2e:learn-v2`. It creates a disposable, anonymous Convex local deployment in a temporary Git worktree, configures guarded deterministic providers there, starts Nuxt against it, then removes the worktree and stops both services when Playwright exits. It never selects, writes to, or queries the caller's configured Convex deployment.

The runner uses Convex CLI's non-interactive anonymous-local mode (`CONVEX_AGENT_MODE=anonymous`), which is supported by the installed CLI without a Convex account. It needs Git, the checked-out repository's installed `node_modules`, and Chromium (CI installs Chromium; locally run `pnpm exec playwright install chromium` once). It refuses production mode, deploy keys, and `BUDDS_E2E_CONVEX_URL`; supplying an external deployment is deliberately unsupported.

The disposable session route delegates to Better Auth's normal email/password endpoint; it does not insert database rows or mint a cookie. Deterministic AI/source fixtures are server-side and activate only after the same non-production guard.

The browser journey creates its disposable account through Better Auth's normal email/password endpoint. It does not seed database rows, mint cookies, or bypass Learn V2 state transitions. Deterministic AI/source responses activate only in the temporary local backend under the same non-production guard.
