# C2 response source authority

Snapshot-backed response bodies require the live document to match the snapshot's revision, content hash and object key, using the same predicate as artifact lineage; ownership, successful status, aggregate liveness, evidence retention and rights remain independent checks.

Direct document dependencies and standalone scopes use a consistent hash-derived revision (and any pinned revision), preserve live legacy documents with both identity fields absent, and treat an object-key-only change as storage relocation; no production flow replaces successful document content in place because [ingestion starts with new document IDs](../../convex/documents.ts#L75), [uploads hash the new bytes](../../convex/documentActions.ts#L584), and [repair hashes the existing object](../../server/api/audio-overview/generate.post.ts#L161) before [replacing metadata on that same object](../../convex/documentActions.ts#L1055).
