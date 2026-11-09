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

| Consumer | Server scope and enforcement |
| --- | --- |
| `chat/general` | Context-free, including client-supplied history. Admission precedes completion, fallback and return. |
| `rag/chat` | Owned selected folders/documents, resolved through Convex. Unbound history makes scope unknown. Search receives the resolved document filter before retrieval. Admission precedes initial and fallback retrieval, provider/fallback dispatch, source events and final nonstream return. A denial before streaming cancels the upstream stream. |
| `rag/search` | Owned folder, or unknown scope for an owner-wide search. Admission precedes retrieval and return. |
| `learnV2SearchActions.searchPublicWeb` | Owned Void. Admission precedes quota/usage work, provider dispatch and returned results. A later denial releases a pre-dispatch reservation; completed provider work remains settled while its content is withheld. |
| Both `learnV2SourceActions` fetch aliases | Owned source snapshot. Admission precedes lease acquisition/replay and fetch. A later denial releases an acquired lease before retrieval. A denied fetch never continues to source evaluation. |
| `audio-overview/interject` | Owned overview, its documents and managed job/manifest. Admission precedes overview content, interjection replay, search, both completion calls, rendering and returned content. |
| `messages.replayByConversation` | Owned conversation. Admission and any exposure commit with the replay projection in one mutation. |

Nitro denials are HTTP 403 with the typed admission in `data`; they contain no
answer/source content. Convex action denials include `ok: false` and the typed
admission; public search also returns an empty `results` array.

Message replay takes `{ conversationId, idempotencyKey }` and returns
`{ admission, messages }`. Denied replay retains message IDs, timestamps, roles,
model metadata and learner-authored text. It withholds assistant text, expanded
sources and quoted audio/source context. Repeating a key re-evaluates current
checks and ownership before looking up an exposure receipt.

`messages.listByConversation` remains a query for compatibility. A query cannot
commit assistance, so with the capability active it provides only the safe
metadata/learner-text projection. Substantive replay uses the mutation. With the
capability off the query preserves its existing content behavior. No client call
or UI was changed; adoption of authorized content replay belongs to the separate
UI/activation gate before enabling these capabilities.

Focused controls exercise registered admission through Nitro streaming and
nonstreaming handlers, registered message/source aliases, and response acceptance.
They cover unknown/forged context, unrelated work, receipt replay, open/sealed
checks, source loss, owner/issuer isolation, bounded reads, mixed matching
opportunities and seal/help ordering. Mutation controls killed all tested consumer
bypasses. The explicit Void-overlap-only deletion survived: the same Void always
resolves to a shared folder and sources, which independently keep it relevant.
The isolated thread, source and folder relevance deletions were killed.
