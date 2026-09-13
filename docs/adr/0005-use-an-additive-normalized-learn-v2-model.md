---
status: accepted
---

# Use an additive normalized model for Learn Anything V2

Learn Anything V2 will use new owner-scoped aggregates, immutable revision records, and normalized child tables rather than extending the mutable V1 course, section, review, or calendar-event records. The existing `calendarConnections` credential, consent, and provider-first disconnect boundary may be reused only after explicit V2 re-consent; V2 session projections never reuse course-owned `calendarEvents`. The executable proposal is `shared/learn-v2-contract.ts`; every new table has a bounded `by_userId` deletion/export path plus explicit parent query indexes. A legacy upgrade may copy only title, source identities, and compatible preferences into a new draft Learning Void. It never dual-writes, changes the original course, or infers accepted evidence, blueprint approval, attempts, mastery, or scheduled sessions from V1 history.
