# Learn Anything V2 Calendar admission gate

This is an independent synthetic admission gate for the optional Learn V2
Calendar surface. It does not enable a cohort and is not evidence of live
Google OAuth, Calendar watch delivery, quota, provider reachability, spend, or
production credentials.

Run it locally with:

```sh
pnpm verify:learn-v2-calendar
```

The `Learn V2 calendar admission gate` CI job runs the exact command with a
non-routable `.invalid` webhook URL and synthetic encryption configuration.
The gate executes the bounded calendar reconciliation, connection, event
cleanup, account-deletion, export, OAuth-route, and calendar component suites.
Its synthetic evidence covers:

- ledger-idempotent event creation with private titles, filenames, excerpts,
  and URLs excluded from provider event fields, plus provider identifiers,
  credentials, and watch metadata redacted from public/exported records;
- paged incremental pull, dropped-notification polling, final cursor commit,
  webhook replay rejection, and HTTP 410 full-resync recovery;
- replacement-before-stop watch renewal, terminal 404/410 stops, and retry of
  failed stops;
- authorization and network failure without mutation of the accepted plan or
  session; and
- provider-first disconnect across all watch and projection rows, followed by
  OAuth revocation, while the in-app plan remains intact.

## Admission boundary

Passing demonstrates deterministic local behavior only. Before enabling the
Calendar cohort, attach a deployment record containing:

- the tested commit SHA and successful hosted `Learn V2 calendar admission
  gate` check;
- the deployed Convex and Pages environments and the exact webhook origin
  (without credentials, tokens, provider IDs, or event data);
- the feature-flag owner, rollback owner, and rollback procedure;
- a current review of requested Google scopes, provider terms, and quota/account
  ownership;
- a live consent, connect, watch, renewal/stop, disconnect, and OAuth-revocation
  smoke test against the deployed callback and webhook; and
- a keyboard and screen-reader smoke test of the Calendar connection,
  attention/re-consent, and disconnect states.

The deployment record is live-provider evidence; this repository gate is not.
Never place real credentials or private event/source data in CI or its logs.
