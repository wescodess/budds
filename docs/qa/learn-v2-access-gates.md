# Learn Anything V2 access and rollback gates

**Status:** LA2-02 executable gate

**Global authority:** Convex `LEARN_V2_ENABLED`

**Cohort authority:** `users.learnV2Entitlement`

Learn Anything V2 is hidden unless both authorities allow the current owner.
The global value is enabled only when it is exactly `true`; missing, empty,
case-varied, padded, and other values fail closed. Convex reads it on every gate
decision, so rollback does not depend on a warm-runtime cache expiring.

## Decision contract

| Global flag | Authenticated user row | Entitlement | Public result |
| --- | --- | --- | --- |
| any value | missing identity | any | denied |
| anything except exact `true` | present | any | denied |
| `true` | missing | any | denied |
| `true` | present | missing or `enabled: false` | denied |
| `true` | deletion tombstone present | any | denied |
| `true` | present | `enabled: true` | allowed |

The public
`learnV2Access.status({})` query derives `tokenIdentifier` from Convex auth and
returns a non-throwing discriminated decision for navigation. It accepts no
identity argument and exposes no rollout, cohort, or account-deletion reason.
Its capability fields are visibility information, not a client-side
authorization preflight.

Every real V2 Convex query and mutation must call the corresponding exported
guard in `convex/lib/learnV2Access.ts` inside its own transaction. The guard
derives and returns the authenticated `tokenIdentifier`; callers never supply
an owner identity. Internal `learnV2Access.setCohortEntitlement` is the only
grant/revoke command; it changes the optional entitlement on an existing user
row, records the server update time, and rejects permanent account-deletion
tombstones.

LA2-03 user-triggered job admission must call the mutation guard in the same
transaction that creates the job. Internal continuations must load the
authoritative job by ID and derive its owner in-transaction once `learnJobs`
exists. This ticket intentionally adds no job table or arbitrary-owner access
interface.

Every production Nitro file below `server/api/learn-v2/` must be declared with
`defineLearnV2Handler`. The wrapper requires the JWT and asks authenticated
Convex for the same decision before the route handler can read a body, reserve
work, or call a provider. A missing JWT returns `401`; an authenticated denial
returns a hidden-beta `404`; and a failed Convex decision returns a sanitized
`503`. Each future route must use the wrapper and add route behavior tests that
prove denial occurs before its body and provider side effects.

## Rollback and maintenance

Rollback is the single `LEARN_V2_ENABLED: true -> false` change in Convex. It
immediately blocks V2 entry, reads, writes, Nitro routes, and new job admission.
It does not erase cohort entitlements or V2 data, so restoring exact `true`
resumes access for the same cohort.

Account deletion and data export deliberately do not use the normal V2 gate.
They remain available during rollback. V1 routes and tables also do not import
the V2 gate and keep their characterized behavior.

## Retention boundary

Every currently creatable V2 aggregate rechecks that its owner folder still
exists before it is read or mutated. Folder deletion therefore makes a Void
and its Blueprint revisions inaccessible in the deleting transaction, then
schedules bounded, child-before-parent cleanup of lifecycle receipts, Blueprint
revisions, Blueprints, and the Void. This continuation is owner-scoped and
idempotent; it does not alter the established V1 folder cascade.

`calendarProjections` is intentionally local-only and restricted to
`pending_projection` with no provider/event identifier. LA2-15 must widen that
schema and add provider-first cleanup atomically with its first producer. No
Google cleanup exists for V2 projections today; account deletion can only remove
their local pending rows.

Future source writers must call `internal.learnV2Retention.purgeSourceEvidence`
in the same workflow that deletes source access. The bounded seam removes
protected excerpts and private locators, marks snapshots unavailable and claim
supports `evidence_unavailable`, and deliberately preserves mastery attempts.
It is a source-deletion seam, not a fetch, manifest, or source-acceptance API.

## Executable evidence

```bash
pnpm exec vitest run \
  convex/learnV2Access.test.ts \
  server/utils/learn-v2-access.test.ts
```

The suite covers exact parsing/default deny, unauthenticated and unentitled
callers, user isolation, grant/revoke, all capability decisions, rollback and
re-enable, authenticated mutation admission, maintenance exceptions,
denied-route side effects, tombstone rejection, malformed status rejection, and
failed Convex decisions.
