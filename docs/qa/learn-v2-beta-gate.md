# Learn Anything V2 Phase 0-4 beta gate

This gate admits only the non-Calendar Learn V2 beta surface. Calendar remains
outside the cohort until the Phase 5 tickets pass their own activation gate.

Calendar admission is separately defined in
[the Learn V2 Calendar admission gate](./learn-v2-calendar-gate.md).

Run the production-like automated contract with:

```sh
pnpm verify:learn-v2-beta
```

The GitHub `Learn V2 beta gate` job runs the same command on Node 24 after a
frozen-lockfile install. The repository-wide `Production build`, secret-history
scan, dependency audit, and full test matrix remain required alongside it.

## Required evidence

| Boundary | Automated evidence | Passing contract |
| --- | --- | --- |
| Access and rollback | `learnV2Access.test.ts` and component route states | Both server and UI deny users outside the cohort; rollback hides V2 without changing V1. |
| Explicit V1 upgrade | `learnV2Upgrade.test.ts` and the upgrade component test | One owner-authorized command creates one draft, copies only title and current source identities, replays safely, and leaves V1 unchanged. |
| Abuse and quota | Learn V2 source, search, generation, and mastery tests | Owner/window limits are bounded; exhausted or unavailable providers fail closed with actionable UI. |
| Privacy, export, deletion | `dataExport.test.ts`, `accountDeletion.test.ts`, and upgrade tests | Private locators and operational secrets stay redacted; every additive V2 row is exported or deleted through bounded owner indexes. |
| Accessibility and offline | Learn V2 component tests | Loading, denied, pending, blocked, ready, error, offline, keyboard, live-region, reduced-motion, and forced-colors contracts remain operable. No V2 attempt enters the V1 offline queue. |
| Latency and bounded work | Learn V2 query and orchestration tests | Today reads only bounded active-session indexes; evidence, source, and job fan-out is capped; external calls retain timeouts. |
| Recovery | Learn V2 blueprint, content, and mastery job tests | Pre-dispatch work can be recovered; ambiguous post-dispatch work blocks for reconciliation and is never silently repeated. |

## Production-like boundary

CI uses synthetic identities, local Convex execution, deterministic provider
responses, and non-routable configuration values. A passing gate proves code,
schema, policy, build, and recovery behavior; it does not prove a live provider
account, real spend/quota, production credentials, or human assistive-technology
review. Those remain deployment evidence and must not be inferred from CI.

Before enabling the cohort in a production environment, record the tested Git
SHA, successful hosted checks, configured provider/account quota, rollback
owner, and a keyboard plus screen-reader smoke test. Never place credentials,
private source text, or private locators in that record.
