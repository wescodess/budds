# Known Limitations

## 1. Known Bugs / TODOs

| Location                                             | Description                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/components/ui/chart/ChartTooltipContent.vue:25` | Uses `createElement` and `render` as a workaround for chart tooltip rendering. Not a user-facing bug but indicates non-standard rendering. |

The codebase is clean of TODO/FIXME/HACK comments in `convex/`, `server/`, and `app/` directories (with the single exception above).

---

## 2. Deliberate Limitations

### Document Upload

- **Maximum file size:** 50 MB per file.
- **Supported formats:** PDF, DOCX, XLSX, TXT, MD, CSV, HTML, PNG, JPG, JPEG, WEBP, GIF. All other formats are rejected client-side.
- **Content extraction limit:** Source content is truncated at 4 MB (`MAX_CONTENT_BYTES`) for both web/YouTube extraction and AI Search indexing.
- **Legacy source upgrade:** Documents indexed before immutable source fingerprints were introduced are upgraded on the first Audio Overview request. Budds hashes the existing owned R2 object, records its SHA-256 revision in Convex, replaces its searchable R2 metadata, and re-indexes it. Generation can be retried after the document returns to `success`; the original file does not need to be uploaded again.

### Audio Overview

- **Daily generation cap:** 10 audio overviews per user per day (UTC-based reset). Tracked in `users.audioOverviewQuota`.
- **Economy mode is not implemented:** Google's model page and pricing table list Batch support for Gemini 2.5 Flash Preview TTS. Budds currently exposes only standard rendering because its durable Batch submission, status, completion, and cancellation lifecycle has not yet been implemented and validated.
- **Cost is conservatively estimated:** Budds reserves and debits bounded micro-USD estimates before provider work. Exact billed-token reconciliation remains a release gate.
- **Acoustic Host identity is not automated yet:** Transcript fidelity, duration, silence, clipping, framing, and spoken-direction checks are automated. Speaker count and cross-scene identity remain `not_measured` until a reliable low-cost acoustic verifier is added, so the G11 listening bake-off remains mandatory.
- **No feature flags or toggles** exist in the codebase; all features are always enabled.

### Course Generation

- **Maximum source documents:** 100 per course (`MAX_SOURCE_DOCS`). When creating a folder-based course without specifying document IDs, the system takes the first 100 documents.

### Review System

- **Default daily review cap:** 50 items. User-configurable via the review page header.
- **SM-2 algorithm** drives spaced repetition intervals. Review quality ratings: 0 (forgot), 3 (hard), 4 (good), 5 (easy).

### YouTube Import

- YouTube transcript extraction may be rate-limited. When rate-limited, the error "YouTube is rate-limiting requests -- try again later" is surfaced.

---

## 3. Error States

### User-Facing Errors

| Error                                                   | Where                                                        | Expected?                                       |
| ------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| "Unauthenticated"                                       | Any protected route when session expires                     | Yes. User should re-login.                      |
| "Folder not found"                                      | Accessing a deleted or non-owned folder                      | Yes.                                            |
| "File exceeds 50MB limit"                               | Document upload                                              | Yes.                                            |
| "Not enough content"                                    | Quiz/flashcard generation with insufficient indexed material | Yes.                                            |
| "YouTube is rate-limiting requests"                     | URL import of YouTube videos                                 | Yes. Transient.                                 |
| "Missing R2 credentials"                                | Document upload (server misconfiguration)                    | Unexpected. Indicates env vars are missing.     |
| "Failed to create void"                                 | Creating chat/flashcard/quiz/course                          | Unexpected. Generic fallback for Convex errors. |
| "Failed to delete document" / "Failed to move document" | Document operations                                          | Unexpected. Network or backend issue.           |
| "Failed to save correction"                             | Flagging a review item or quiz question                      | Unexpected.                                     |

### Silent Failures

- **SM-2 review submission:** If the `submitReview` mutation fails, the error is swallowed; the rating is still tracked locally for the session but won't persist.
- **Session completion recording:** If `completeReviewSession` fails, the completion screen still shows but the streak may not update server-side.
- **Audio overview generation errors:** The AudioOverviewShell component surfaces its own error toasts internally.

### Convex Error Unwrapping

Convex errors are displayed to users after stripping the `[CONVEX ...]` prefix and `ConvexError:` prefix. This happens via `unwrapConvexError()` in the folder page.

---

## 4. Browser Compatibility

- The app uses `100dvh` for viewport height, which requires Safari 15.4+, Chrome 108+, Firefox 108+.
- `env(safe-area-inset-bottom)` is used for mobile safe areas (requires iOS Safari).
- `supports-[backdrop-filter]` CSS is used for blur effects; older browsers will see a solid background instead.
- Touch gestures (horizontal swipe for sidebar) use `touch-action: pan-y` and custom gesture detection; these only activate on non-desktop viewports.
- Keyboard shortcuts (`/` to focus, Ctrl/Cmd+N for new chat, Space/1-4 for review) are only active when focus is not in an input/textarea.
- `localStorage` is used for UI preferences (helper pane side). Access failures are silently caught.

---

## 5. Performance Considerations

### Data Export

Exports page each dataset through owner-checked Convex queries and serialize one
page at a time into a streaming ZIP. Very large exports still depend on the
Cloudflare request remaining open; if that operational ceiling becomes common,
move export assembly to a resumable background job with private object storage.
The synchronous route is a production contract for the Cloudflare Workers Paid
plan: even an empty export uses 50 outbound subrequests, while populated exports
use more. Do not deploy this route on the Workers Free plan's 50-subrequest
request limit; use a resumable background export before downgrading the account.

### Document Indexing

Documents go through processing -> indexing -> success pipeline. Large files (up to 50 MB) are uploaded to Convex storage, then transferred to Cloudflare R2, then indexed via Cloudflare AI Search. Each step is asynchronous.

### Folder with Many Documents

The folder view loads all documents for a folder via a Convex subscription. Folders with hundreds of documents will result in larger subscription payloads.

### Course Section Generation

Course sections are generated JIT (just-in-time). They can generate text, quiz, and flashcard blocks. Conceptual-course audio primers currently fail closed with `requires-audio-overview-v2`; the old Dia/Aura and nested-v1 path was removed, and primers remain unavailable until they can launch and attach the same durable v2 Workflow used by normal Audio Overviews.

### Review Session Loading

The `listDueWithContext` query loads all due review items with course/section metadata. Users with many courses and accumulated review items may see slower initial load.

### Account Deletion

Account deletion is a durable, bounded phase workflow. A permanent tombstone
immediately rejects stale authenticated reads and writes while eight-row
database batches, provider-first Google Calendar disconnect, Convex storage,
R2, and paginated AI Search item cleanup complete. Failed external cleanup is
retained with bounded exponential backoff; scheduled work and the stale-job
rescue cron resume interrupted deletions.

---

## 6. External Service Dependencies

### Convex (Backend)

- **Role:** Database, real-time subscriptions, mutations, file storage, cron jobs.
- **Impact if down:** Entire app is non-functional. All data operations, auth token verification, and real-time updates depend on Convex.

### Google OAuth (Authentication)

- **Role:** User authentication via Better Auth.
- **Impact if down:** New logins fail. Existing sessions with valid JWTs may continue working until token expiry.
- **Env vars:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### Google Calendar API

- **Role:** Scheduling study sessions, checking for missed sessions.
- **Impact if down:** Calendar connection fails. Scheduled events cannot be created or rescheduled. The cron job for missed session detection will log errors but not crash.
- **Token refresh:** Access tokens are refreshed via Google's OAuth token endpoint. If refresh fails, the connection is effectively broken until the user reconnects.

### Cloudflare R2 (Object Storage)

- **Role:** Persistent document file storage.
- **Impact if down:** Document uploads fail at the R2 upload step. Existing documents remain accessible if already indexed. Document deletion cleanup may fail (retried by cron).
- **Env vars:** `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.

### Cloudflare AI Search

- **Role:** Document indexing and RAG retrieval for chat, quiz generation, flashcard generation, and audio overview generation.
- **Impact if down:** New document indexing fails (documents stuck at "indexing" status). Chat responses will lack source citations or fail entirely. Quiz/flashcard/audio generation that depends on indexed content will fail.
- **Env vars:** `CLOUDFLARE_AI_SEARCH_INSTANCE`, `CLOUDFLARE_AI_SEARCH_TOKEN`.

### OpenRouter (AI Gateway)

- **Role:** Routes chat completions to various AI models (Claude, GPT-4o, Gemini, Llama, DeepSeek, Mistral).
- **Impact if down:** All AI-powered features fail: chat responses, quiz generation, flashcard generation, audio overview script generation, course section content generation.
- **Models available:** Claude Sonnet 4.5, Claude Haiku 3.5, GPT-4o, GPT-4o Mini, Gemini 2.5 Flash, Llama 3.1 70B, DeepSeek V3, Mistral Large.

### TTS Service (Audio Synthesis)

- **Role:** Gemini 3.1 Flash TTS Preview jointly renders the two managed Hosts through the Interactions API for each Audio Overview scene; a Cloudflare Workflow owns retries and publication.
- **Impact if down:** New Audio Overview generation terminal-fails without falling back to Dia or Aura. Existing published WAV artifacts remain playable.
- **Current release gate:** Production remains blocked until the owner-triggered real-provider run and blind listening bake-off pass. Acoustic speaker count/identity must not be claimed unless measured; configuration evidence alone is recorded separately.
