# Offline scorer corpus

Part of [spec #415](https://github.com/wescodess/budds/issues/415), implemented by [ticket #426](https://github.com/wescodess/budds/issues/426). The accepted [scorer research](../../../docs/research/learn-anything-scorer-harness.md) and [resolution](https://github.com/wescodess/budds/issues/365#issuecomment-6651691079) define the contract.

Run from the repository root with Node 24 (frozen reproduction runtime: 24.20.0):

```sh
node scripts/learn-v2-scorer-corpus.mjs generate
node scripts/learn-v2-scorer-corpus.mjs verify
node --test tests/fixtures/learn-v2-scorer/corpus.test.mjs
```

Both commands accept `--inputs DIRECTORY` and `--output DIRECTORY`. Generation writes only `corpus.v1.json` and `manifest.v1.json` into the output directory. Verification re-executes every proof, checks isolation/accounting, then compares both complete artifacts byte-for-byte against regeneration. No dependencies, environment values, keys, provider access or application writes are needed.

## Inputs and proofs

`sources.v1.json` contains sixteen original, public synthetic source packets: two per domain across arithmetic/algebra, probability/statistics, programming/data, physical science, biology, history, reading/argument and practical procedures. They are closed cases, not external factual reference material. In particular, archive events and reading passages are fictional, and biological models are stipulated toy cases. Their public-use/retention permission and source acceptance apply to these test fixtures only. They confer no T0 acceptance on a real learner's sources.

Each source snapshot supplies records and formal claims. The extracted key must match the source claim exactly. A small executable language supports keyed fields, numeric arithmetic with exact unit checks, finite relations, order constraints and closed propositions. Proofs record the source pointers, expected and parsed values, and satisfied/missing/contradicted/unsupported outcomes. This is source-key checking, not a grader's judgment.

Two surface forms and seven classes produce 224 original core responses. Paraphrases use a closed grammar with clause reversal, equivalent ordering/Boolean terms and declared unit aliases; they round-trip through the same semantic checker. Negative seeds cover omissions, sign/unit/order/relation substitutions, nearby numeric errors, unsupported claims, checked distractors and inert instruction attacks. Unrecognized prose and ambiguous repeated atoms are rejected as unprovable; they cannot enter gold.

`expected.criteria` is the proved criterion vector. `expected.referencePass` requires the predeclared essential atoms; it never uses an AI verdict or the 80 comparator. For example, the partial linear-balance answer earns weights 79 + 20 while omitting the essential one-point criterion: its reference label is still false. All thresholds remain provisional. Agreement between graders cannot establish truth; unresolved divergence remains quarantined without human grading or voting.

## Splits and accounting

`splits.v1.json` assigns source families before generation, one fit and one untouched held-out packet per domain. All sibling forms and transformations stay together. Deterministic SHA-256 sorting uses the pinned seed. Verification rejects cross-split source snapshots, answer keys and claim families, as well as normalized core duplicates. Numeric signs and decimal points remain significant during normalization.

| Group | Dispatches per model/configuration | Core error support |
| --- | ---: | --- |
| Fit core | 112 | 32 reference-positive, 80 reference-negative |
| Held-out core | 112 | 32 reference-positive, 80 reference-negative |
| Correct-answer injection controls | 8 | Separate |
| Repeats | 20 | Separate, linked by `repeatOf` |
| Canary/diagnostic slots | 4 | Separate, linked by `repeatOf` |
| Total | 256 | 224 original responses only |

Controls and probes use fit packets, preserving held-out families for evaluation. `summarizeCorpus` computes `coreDenominators` exclusively from `core`; duplicating controls or repeats cannot increase that support. Full verification also rejects dispatch-count inflation. Synthetic variants are correlated; these counts are not independent learners.

The manifest seals source/key/rubric/form/response hashes, source acceptance and rights, generator/checker/grammar/seed/lockfile hashes, the accepted research revision, isolation checks and core denominators. It labels all output `offline_contract_only`; real delayed validity remains `pending_real_delayed_evidence`.

## Handoff to #427 and #428

Keep these fixtures and keys in repository tooling and server-only consumers. They must never be imported by client code. There are no runtime, shared-contract, package-script or mastery changes here.

The corpus is a local join artifact: it deliberately contains expected labels, classes, splits, source locators and proof details. **Do not send a row directly to a grader.** Ticket #428 must construct fresh single-item requests containing only an opaque shuffled ID and the source-bound question/key/rubric/response, and join expected labels only after verdicts are sealed. Fit-only threshold exploration and held-out evaluation must remain separate. The immutable scorer service and observed receipts from #427 supply execution identity; this corpus makes no identity claim.

The four diagnostic slots are scheduled cases, not extra retries. Nothing here dispatches models, validates scorer accuracy, promotes a threshold, establishes Verified Learning Gain or authorizes external learner replay. Two synthetic forms test scorer consistency only; a real cold/day-7/day-30 Measurement Item sequence still requires three distinct counterbalanced cases.

The Node exit tests are a separate command because this ticket owns no package-script or workflow changes. Include them with the subsequent harness feature checks and the orchestrator's final review gate. The PR remains draft until the remaining spec tickets and required reviews/checks are complete.
