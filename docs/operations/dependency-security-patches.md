# Maintained dependency security patches

These patches are installed through `pnpm.patchedDependencies`; `pnpm-lock.yaml`
records their hashes. Use the normal `pnpm patch` / `pnpm patch-commit` workflow
when maintaining them. Do not change package versions to suppress advisories.

- `@rollup/plugin-node-resolve@16.0.3`: both shipped module formats clone the
  trusted static defaults with `structuredClone`, then retain upstream's deep
  freeze. The scoped override removes its sole `deepmerge` dependency. No caller
  input enters this clone, and application merge behavior is unchanged. This
  uses Budds' Node engine requirement; it does not retain the plugin's Node 14
  support outside this application.
- `katex@0.16.47`: a backport of upstream
  [0adf7e77db6915d991803b29699f82b1ccf8d4f4](https://github.com/KaTeX/KaTeX/commit/0adf7e77db6915d991803b29699f82b1ccf8d4f4).
  The five own-property checks cover renderer options, default/processor
  metadata, builtin namespace lookup, and group restoration. Matching source
  changes and the shipped `dist/katex.mjs` and `dist/katex.js` are patched.
  Package import/require exports select those files; the latter is also the UMD
  browser entry. Mermaid 11's dynamic `import('katex')` selects the ESM file.
  Licenses, CSS, fonts, assets, and benign output bytes are unchanged.

KaTeX's standalone `dist/katex.min.js` remains unpatched and affected. Budds does
not import it or use Mermaid's standalone bundles that embed KaTeX. The wildcard
package export still permits consumers outside this application to select that
file; this is an application backport, not a claim that every distributed KaTeX
artifact is fixed. Review this boundary if imports, bundler resolution, or
Mermaid distribution entrypoints change. This patch does not remediate a
separate source of prototype pollution.

Run `pnpm test:dependency-security` for native Node ESM/CJS and browser-UMD VM
contracts. `server/utils/dependency-security.test.ts` runs that same probe inside
the existing required `pnpm test` suite, so `pnpm verify` includes it. It exercises
actual Rollup bundles and ESLint rules, renderer security regressions, eight
pristine render hashes per format, and the complete CSS/font/asset byte digest.
The VM check exercises browser-selected JavaScript without a browser or visual
acceptance claim.

`@eslint/config-array@0.23.5` and `eslint-plugin-import-x@4.17.1` use minimatch
11.0.4 through scoped overrides. Import-x's maintained ESM/CJS patch replaces
the removed `makeRe` API with matcher predicates and keeps empty patterns
inactive. The repository does not enable its `no-internal-modules` rule.
Consumers that enable it now receive the fixed matcher's glob semantics:
implicit dot paths are excluded, a package root is outside `package/**`, and
multiple globstars match nested private paths. The actual ESLint contracts
cover these deliberate changes as well as the other supported rule branches.
Remove the adapter when compatible upstream consumers support the fixed engine.

The audit policy excludes only `GHSA-238p-pmpm-9mq7`: the registry identifies
KaTeX by version and does not recognize this upstream security backport. This
is an application-entrypoint exception, not a claim that the unselected
minified artifact is fixed. The required security probe pins the sole KaTeX
snapshot to the reviewed patch hash, verifies the exception's exact scope,
tests inherited-property attacks in four selected formats, and checks the
actual Mermaid browser import. It also prevents minimatch versions below the
fixed engine from returning to the resolved graph. A missing or changed patch
must fail these checks even if the version-based advisory is excluded.

Reassess the exception whenever imports, bundler selection, package versions,
or patches change. Remove it and the backport when compatible upstream
consumers provide the fix. Keep raw audit observations distinct from configured
audit-policy results; the independent release review and full checks still
determine release readiness.

With the pinned pnpm 9.12.3, ordinary `pnpm audit` applies the advisory filter
when choosing its exit code, but its summary retains the registry's original
counts. JSON audit mode also retains the original counts and exit code. Thus
the configured command can pass while reporting one low version advisory;
JSON output must not be described as a clean raw audit. The required security
tests remain the evidence that the selected KaTeX code has the upstream fix.
