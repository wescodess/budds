# Story 7.2: Section Content Caching

## Status: review

## Story

As a user, I want completed sections automatically cached for offline access, so that I can review them without internet.

## Acceptance Criteria

1. When a section is marked completed, section content (text blocks, quiz questions/answers, flashcard terms/definitions) is stored in IndexedDB keyed by sectionId.
2. Audio files are cached in Cache API.
3. The section's `offlineAvailable` field is set to true.
4. In the course view, a download icon indicates cached (filled) vs not cached (outlined) for each section.
5. Cached content loads within 2 seconds from browser storage.

## Tasks

- [x] 1. Add `offlineAvailable` optional boolean field to `courseSections` schema
- [x] 2. Create `useOfflineCache` composable with IndexedDB operations (store, retrieve, check, delete)
- [x] 3. Add audio file caching via Cache API in `useOfflineCache`
- [x] 4. Wire caching into section completion flow — cache after completeSection succeeds
- [x] 5. Add `setOfflineAvailable` mutation and `getOfflineCachePayload` query to `courseSections.ts`
- [x] 6. Update `CourseViewBody.vue` with download/cached indicator per section
- [x] 7. Add offline section loading — fallback to IndexedDB when offline
- [x] 8. Add component tests (6 new component tests + 5 new Convex integration tests)

## File List

- `convex/schema.ts` — add `offlineAvailable` optional boolean field to `courseSections`
- `convex/courseSections.ts` — add `setOfflineAvailable` mutation + `getOfflineCachePayload` query
- `convex/courseSections.test.ts` — 5 new integration tests for setOfflineAvailable + getOfflineCachePayload
- `app/composables/useOfflineCache.ts` — IndexedDB + Cache API operations composable
- `app/components/learn/CourseViewBody.vue` — download/cached indicator per section
- `app/pages/app/folders/[id]/learn/[courseId]/[sectionId].vue` — wire caching on completion + offline loading
- `server/api/learn/section-cache-payload.get.ts` — server endpoint for fetching cache payload
- `public/sw.js` — preserve audio cache namespace during cleanup
- `tests/component/learn/offline-cache.test.ts` — 6 component tests for offline indicators

## Dev Agent Record

### Decisions

- **No ATDD step**: This story involves browser-only APIs (IndexedDB, Cache API, Service Worker) that cannot be meaningfully tested in automated E2E acceptance tests. Component tests and Convex integration tests cover the functionality.

- **Server endpoint for cache payload**: Used a Nitro server route (`/api/learn/section-cache-payload.get.ts`) to fetch the full section content payload for caching. This avoids needing a one-shot Convex client call from the browser (the existing `useConvexQuery` is subscription-based). The endpoint uses the existing `makeConvexClient` utility.

- **Fire-and-forget caching**: After `completeSection` succeeds, the caching operation runs asynchronously without blocking the user. If caching fails, it silently falls back — offline availability is a nice-to-have, not a critical path.

- **Separate audio cache namespace**: Audio files are cached in `budds-learn-audio-v1` Cache API namespace (separate from section navigation cache `budds-learn-sections-v1`), following the pattern established in 7-1. The service worker's activate handler preserves this cache.

- **Icons for offline indicator**: `HardDriveDownload` (filled appearance) for cached sections, `Download` (outlined) for completed-but-not-cached sections. Both in muted foreground color per UX spec.

## Change Log

- Added `offlineAvailable: v.optional(v.boolean())` field to `courseSections` schema
- Created `useOfflineCache` composable with IndexedDB CRUD operations (`openDB`, `storeSection`, `getSection`, `isSectionCached`, `deleteSection`) and Cache API audio caching (`cacheAudioUrls`, `getAudioFromCache`)
- Added `getOfflineCachePayload` query that bundles section content (text blocks, quiz questions, flashcard cards, audio URLs) into a single cacheable payload
- Added `setOfflineAvailable` mutation to mark sections as cached
- Created `/api/learn/section-cache-payload.get.ts` server endpoint
- Updated section void page to: (a) cache content after completion via fire-and-forget, (b) detect offline state and load from IndexedDB when offline, (c) show "Viewing cached offline version" banner when using cached data
- Updated `CourseViewBody.vue` to show `HardDriveDownload` icon for cached sections and `Download` icon for completed-but-not-cached sections
- Updated `public/sw.js` to preserve `budds-learn-audio-v1` cache namespace during activation
- Added 5 Convex integration tests (setOfflineAvailable: set true, set false, reject non-owner; getOfflineCachePayload: returns null for non-completed, returns payload for completed text block, returns null for non-owner)
- Added 6 component tests for offline indicators in CourseViewBody (filled icon, outlined icon, no icon for non-completed, no icon for locked, cached aria-label, not-cached aria-label)
