# C4.2 help and replay consumers

This implementation consumes the server-derived admission contract from #539.
Every application capability remains off. This document records backend behavior;
it does not authorize activation or a new help-denial interaction.

`learnV2Assistance.admitHelp` accepts the versioned kind, idempotency key and scope
that the consumer uses. Authentication supplies the owner. Its result is
`ordinary`, `authorized` with opportunity/exposure IDs, or `denied` with
`test_open`, `disclosure_unknown` or `unavailable`. The decision and exposure
writes share one mutation and the same opportunities used by response acceptance.
A previous authorization receipt is never an independent grant.

Teaching generators set the additive `ordinaryOnly: true` request option. The
shared mutation denies matching open opportunities before committing any granted
assistance. Course references resolve their owned folder and bounded source links
on the server. These restrictions do not enable any capability.

| Consumer | Server scope and enforcement |
| --- | --- |
| `chat/general` | Context-free, including client-supplied history. Admission precedes completion, fallback and return. |
| `rag/chat` | Owned selected folders/documents, resolved through Convex with a 64-folder and 64-document expansion budget. Unbound history makes scope unknown. Every search and R2 fallback receives an admitted teaching scope. Current lineage, folder and revision pins are revalidated before dispatch, source events, every forwarded chunk and final return. Denial cancels upstream delivery. |
| `rag/search` | Owned folder, or unknown help scope for an owner-wide search. The teaching scope admits at most 64 owned documents and rejects overflow. Current lineage and indexed source pins are checked before returning results. |
| `learnV2SearchActions.searchPublicWeb` | Owned Void. Admission precedes quota/usage work, provider dispatch and returned results. A later denial releases a pre-dispatch reservation; completed provider work remains settled while its content is withheld. |
| Both `learnV2SourceActions` fetch aliases | Owned source snapshot. Admission precedes lease acquisition/replay and fetch. A later denial releases an acquired lease before retrieval. A denied fetch never continues to source evaluation. |
| `audio-overview/interject` | Owned overview, its documents and managed job/manifest. Admission precedes overview content, interjection replay, search, both completion calls, rendering and returned content. |
| `messages.replayByConversation` | Stored content provenance, independently of the owned conversation's folder. Unknown provenance produces unknown help scope. Admission and any exposure commit with the unchanged replay projection in one mutation. |
| `quiz/topics`, `quiz/generate`, `flashcards/generate` | Owned folder and selected teaching documents. Ordinary-only admission precedes each source read, fallback, provider call, publication and content return. |
| `course/generate-outline`, `course/generate-section` | Owned course, folder and bounded course source links. Ordinary-only admission precedes retrieval, every generation engine and publication. |
| `audio-overview/generate` | Owned folder followed by the frozen job scope before launching the Workflow. Source-repair reads also recheck admission. A legacy task without resolvable request scope fails closed while a check is open. |
| `audio-overview/jobs/step` | The verified job capability derives its owner and frozen source scope. `audioOverviewJobs.admitTeachingHelp` admits ordinary work only and revalidates current source lineage/pins. Checks precede retrieval, dialogue/verification/alignment dispatch, scene delivery and publication. Cleanup remains available. |

Before a response starts, Nitro denials are HTTP 403 with the typed admission in
`data`; they contain no answer/source content. After streaming has started, the
same denial error terminates the stream and cancels its upstream reader. Convex
action denials include `ok: false` and the typed admission; public search also
returns an empty `results` array.

Message replay takes `{ conversationId, idempotencyKey }` and returns
`{ admission, messages }`. Denied replay retains message IDs, timestamps, roles,
model metadata and learner-authored text. It withholds assistant text, expanded
sources and quoted audio/source context. Repeating a key re-evaluates current
checks and ownership before looking up an exposure receipt. Provenance is never
inferred from the conversation's folder, filenames or a caller's unrelated flag.

The additive `messages.helpScope` field stores a version and at most 64 document
and historical folder references. New sourced answers carry a server-signed
provenance receipt through the nonstream response or a final streaming metadata
event. Message persistence verifies that receipt against the owner, exact answer,
expanded sources and references before storing scope. Citation normalization is
shared with the existing persistence path. Signatures use a separate message
provenance domain under the existing auth secret; matching server/Convex secret
configuration is required. Missing secret configuration, unbound history,
unparseable streamed content or missing source identity leaves scope unknown.
An invalid receipt cannot establish scope. The message retains its ordinary
history behavior with unknown provenance. Legacy messages are not backfilled.
Conversation message projections retain their existing fields and omit `helpScope`.
The client changes transport this metadata without changing presentation.

Streaming uses backpressure and rechecks after reading each upstream chunk and
before enqueueing it. Each such check costs one bounded teaching-scope query and
one admission mutation. There is no cached authorization interval. The stream is
bounded to 512,000 upstream bytes and 2,048 chunks. This adds latency and Convex
work per chunk; it allows a newly opened check or changed source lineage to stop
the next delivery. Admission reuses its idempotency key, so previously authorized
delivery remains recorded once and a later denial records only requested-denied
exposure. No denied chunk records delivered assistance.

`messages.listByConversation` remains a query for compatibility. A query cannot
commit assistance, so with the capability active it provides only the safe
metadata/learner-text projection. Substantive replay uses the mutation. With the
capability off the query preserves its existing content behavior. Adoption of
authorized content replay belongs to the separate
UI/activation gate before enabling these capabilities.

Focused controls exercise registered admission through Nitro streaming and
nonstreaming handlers, registered message/source aliases, and response acceptance.
They cover unknown/forged context, unrelated work, receipt replay, open/sealed
checks, source loss, owner/issuer isolation, bounded reads, mixed matching
opportunities and seal/help ordering. Mutation controls killed all tested consumer
bypasses in that earlier implementation. The explicit Void-overlap-only deletion survived: the same Void always
resolves to a shared folder and sources, which independently keep it relevant.
The isolated thread, source and folder relevance deletions were killed.

The generation audit also inspected `chat/general`, `audio-overview/interject`
and `quiz/assess-attempt`. General chat and interjection retain their contextual
admission; semantic attempt assessment is a separate grading path with guarded
legacy inputs and no teaching publication. Calendar OAuth, media reads, export,
deletion and the test-session route do not generate teaching. No capability,
entitlement, deployment, migration or map editor change is included here.
