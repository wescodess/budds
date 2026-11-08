# C2 response source authority

Snapshot-backed response bodies require the live document to match the snapshot's revision, content hash and object key, using the same predicate as artifact lineage; ownership, successful status, aggregate liveness, evidence retention and rights remain independent checks.

Direct document dependencies and standalone scopes use a consistent hash-derived revision (and any pinned revision), preserve live legacy documents with both identity fields absent, and treat an object-key-only change as storage relocation; no production flow replaces successful document content in place because [ingestion starts with new document IDs](../../convex/documents.ts#L75), [uploads hash the new bytes](../../convex/documentActions.ts#L584), and [repair hashes the existing object](../../server/api/audio-overview/generate.post.ts#L161) before [replacing metadata on that same object](../../convex/documentActions.ts#L1055).

Body disclosure permits at most 64 response targets per activity, counting standalone slots, Canvas slots and Canvas opportunities together, including terminal targets; owner/activity indexes exclude unrelated thread or session history before applying the bound, and overflow withholds canonical and alias bodies across export, ZIP, Canvas and recovery while preserving safe metadata.

The 64-target limit is a read bound with no writer-enforced maximum yet because this slice does not create slots or opportunities.

Legacy answers linked by a session-content ID depend on every activity sharing that ID: one activity failing authority or its target bound withholds the legacy alias, even when a different activity's canonical answer remains available.

Response reads share an owner-keyed memo within one handler call, never across transactions. The request range budget is 3,072, including sixteen reserved ranges for authentication; body checks stop before issuing a read beyond that allowance. Export ends a page early and resumes its remaining row IDs before the native continuation, retrying a partially checked row with a fresh budget and rechecking current owner and source authority; an oversized row or non-paginated history withholds bodies and retains safe metadata. Continuations contain identifiers and pagination state, never response text.
