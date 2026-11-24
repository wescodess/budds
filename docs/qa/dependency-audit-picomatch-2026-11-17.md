# Temporary picomatch audit exception, 2026-11-17

Tracking: [remove the exception when a fix ships](https://github.com/wescodess/budds/issues/555).
Baseline: `origin/dev` at `e82b94b0eb12d08b8b31716de356631c3ae3f1cf`.

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
affects picomatch through 4.0.7. The advisory lists no patched release, and npm's
latest official version is 4.0.7. The root and both worker manifests temporarily
ignore this advisory ID using the existing `pnpm.auditConfig.ignoreGhsas`
convention. This does not repair picomatch or lower the audit severity threshold.

## Reachability

Frozen installs and `pnpm why picomatch --depth 100` resolve root versions 2.3.2,
4.0.4 and 4.0.7. Both workers resolve only 4.0.7 through Vitest 4.1.12, Vite 8.3.6,
tinyglobby 0.2.17 and fdir 6.5.0. The tracking issue records every versioned
lockfile path, including peer and optional paths abbreviated by `pnpm why`.

Root consumers are framework build/dev tooling, Rollup filters, filesystem
watching, linting, typechecking and tests. Inspected call sites include Nuxt page
and component scanning (`options.pattern`/`dir.pattern`), Vue Router's `unplugin`
file filters, tinyglobby match/ignore compilation, and unstorage's filesystem
driver ignore options. Their patterns come from framework defaults and repository
configuration. The application does not configure that filesystem driver or pass
user, network or database patterns to a glob API. Better Auth's Vitest edge is an
optional test peer, not an authentication request-handler import.

`pnpm build` passed with the process-local CI placeholders from
`.github/workflows/test.yml`, including its secret scan. The configured
`cloudflare_pages` preset emits the deployable server under `dist/_worker.js/`.
Inspection of all 266 server JS files and 266 source maps (2,333 source entries)
found no picomatch, micromatch, anymatch or tinyglobby source entries or picomatch
parser markers in the JS output.

Wrangler dry-runs also emitted both worker bundles: Audio has nine source entries
and Laya has six. Neither includes picomatch or its wrapper/tooling paths. Laya's
dry-run used `--containers-rollout=none` because Docker was unavailable; its
container image was not built. No deployment occurred.

No attacker-controlled runtime pattern path was found in these server and worker
bundles. Reassess this conclusion if imports, glob configuration or the deployment
preset change.

## Alternatives and removal

Current Nuxt 4.6.4/Nitro 2.13.6 and the latest checked Vite, Vitest, tinyglobby,
micromatch, anymatch, unplugin, fdir, Stylistic, Rollup pluginutils and Vue language
core releases still declare affected picomatch ranges. There is no unaffected
official major to override to.

The published `@ryotsu/picomatch@4.0.7-a` fork claims a fix but also changes bracket
negation and globstar behavior; direct parser comparisons confirmed different
matches from official 4.0.7. `zeromatch@1.0.0` documents incompatible `makeRe`
return values and missing callbacks used by micromatch. Neither was selected as a
behavior-preserving override. Source links and comparison evidence are in the
tracking issue.

Remove all three `GHSA-fc5q-39xc-vjpf` ignores and upgrade once a patched picomatch
ships. Re-run all three audits, `pnpm verify`, and the production bundle checks.
Keep the unrelated deepmerge exception unchanged.
