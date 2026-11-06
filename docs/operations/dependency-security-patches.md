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

Minimatch 10.2.5 remains affected through ESLint config-array and import-x.
Minimatch 11 removes `makeRe`; adapting the real import-x rule to `.match()`
changes observable legacy glob behavior for direct dot paths, package roots,
and multiple globstars. A minimal compatibility patch did not preserve those
outcomes, so no minimatch upgrade or import-x patch is included. The real ESLint
contracts preserve those cases to expose the blocker in future upgrade work.

Raw `pnpm audit` continues to flag minimatch and KaTeX 0.16.47. The backport does
not produce a clean audit, waive any finding, or pass the release gate.
Independent patch review, compatible minimatch remediation, the parent's full
checks, and owner adjudication remain required. Remove these patches when
reviewed upstream consumers provide the same fixes and compatibility contracts
pass.
