---
title: 'Multi-source ingestion pipeline'
type: 'feature'
created: '2026-04-17'
status: 'in-progress'
baseline_commit: '8f03d7b'
context: ['.claude/plans/starry-leaping-church.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ingestion is PDF-only because `unpdf` handles only PDFs and every layer hardcodes `application/pdf`. Cloudflare AI Search already natively indexes PDF/DOCX/HTML/TXT/MD/CSV/XLSX/images from R2 — the current `unpdf` extraction is redundant work.

**Approach:** Upload original files directly to R2 (drop `unpdf`), let AI Search index natively. Add server-side extraction for YouTube transcripts (`youtube-transcript`) and websites (`linkedom` + `@mozilla/readability`), store as `.md` in R2. Widen schema with `sourceType`/`sourceUrl`/`mimeType`, make `fileId` optional.

## Boundaries & Constraints

**Always:** Keep R2 key backward-compat (old `.txt` keys still work via `r2Key` field). Guard all `storage.delete(fileId)` with `if (doc.fileId)`. All new schema fields optional (widen, no backfill). Target `dev` branch. 4MB AI Search file limit — truncate extracted content if needed.

**Ask First:** Adding any new npm dependency not listed (youtube-transcript, linkedom, @mozilla/readability). Changing the R2 bucket structure.

**Never:** Break existing PDF documents. Use headless browsers for scraping. Add paid APIs or services. Skip Convex guidelines. Commit secrets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload DOCX | .docx file via FileUploadZone | Stored in R2 with .docx ext, AI Search indexes natively | Fail with descriptive message if R2/AI Search errors |
| YouTube URL | youtube.com/watch?v=xxx | Transcript extracted, stored as .md in R2, indexed | "No transcript available" if captions missing |
| Website URL | https://example.com/article | Readable content extracted via Readability, stored as .md | "Could not extract content" if non-HTML or empty |
| Legacy PDF | Existing doc with .txt r2Key | Still works — r2Key field unchanged | N/A |
| Oversized content | Extracted text >4MB | Truncated to 4MB before R2 upload | Log warning |
| Invalid YouTube URL | youtube.com/watch (no ID) | Rejected with "Invalid YouTube URL" | Validation error |

</frozen-after-approval>

## Code Map

- `convex/schema.ts` -- Add sourceType, sourceUrl, mimeType; make fileId optional
- `convex/documents.ts` -- Widen createDocument args, MIME whitelist, guard fileId deletes
- `convex/documentActions.ts` -- Rewrite ingestDocument: drop unpdf, branch by sourceType, direct R2 upload for files
- `convex/sourceExtractors.ts` -- NEW: extractWebsiteContent + extractYouTubeTranscript
- `convex/documentImports.ts` -- URL classification (youtube/website/file), generalized import
- `app/components/documents/FileUploadZone.vue` -- Accept all file types, update validation
- `app/composables/useDocuments.ts` -- MIME whitelist, update messages
- `app/components/chat/Input.vue` -- Update accept attr, link dialog text
- `server/utils/r2-folder.ts` -- Remove .txt-only filter, support multi-extension keys
- `package.json` -- Add youtube-transcript, linkedom, @mozilla/readability; remove unpdf

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- Add youtube-transcript, linkedom, @mozilla/readability deps; remove unpdf
- [ ] `convex/schema.ts` -- Add optional sourceType, sourceUrl, mimeType fields; make fileId optional
- [ ] `convex/documents.ts` -- Widen createDocument with MIME whitelist + new args; add createDocumentFromSource for URL-based sources; guard fileId in deleteDocument
- [ ] `convex/sourceExtractors.ts` -- Create website + YouTube extraction functions
- [ ] `convex/documentActions.ts` -- Rewrite ingestDocument to branch by sourceType; remove unpdf; direct R2 upload for files; call extractors for website/youtube
- [ ] `convex/documentImports.ts` -- Classify URLs (youtube/website/file); generalize importDocumentFromUrl
- [ ] `app/components/documents/FileUploadZone.vue` -- Accept all MIME types, update validation + UI text
- [ ] `app/composables/useDocuments.ts` -- Replace PDF-only validation with MIME whitelist
- [ ] `app/components/chat/Input.vue` -- Update accept attr + link dialog text
- [ ] `server/utils/r2-folder.ts` -- Remove .txt filter; support multi-extension R2 keys; skip binary files in fallback reader

**Acceptance Criteria:**
- Given a DOCX/TXT/image upload, when ingested, then document reaches 'success' status and is searchable via AI Search
- Given a YouTube URL, when imported, then transcript is extracted, stored in R2, and searchable
- Given a website URL, when imported, then readable content is extracted and searchable
- Given an existing PDF document with .txt r2Key, when queried, then it still works unchanged
- Given a file with unsupported MIME type, when uploaded, then rejected with clear error message

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no type errors
- `pnpm test` -- expected: existing tests pass
- `pnpm build` -- expected: clean build

**Manual checks:**
- Upload a DOCX file — verify it reaches 'success' status
- Import a YouTube URL — verify transcript appears in R2
- Import a website URL — verify extracted content in R2
- Verify existing PDF documents still work
