# Story 7.1: Service Worker & Offline Detection

## Status: review

## Story

As a user, I want to know when I'm offline and still access my content, so that I can study anywhere.

## Acceptance Criteria

1. App has a registered service worker.
2. When device loses connectivity, a subtle top banner appears: "You're offline. Completed sections are available." (warm amber at 10% opacity).
3. When connectivity restores, the banner fades without notification.
4. Service worker intercepts navigation to cached section routes.

## Tasks

- [x] 1. Verify existing service worker registration and app shell caching are working correctly
- [x] 2. Create `useOnlineStatus` composable — reactive `isOnline` ref using `navigator.onLine` + `online`/`offline` events
- [x] 3. Create `OfflineBanner.vue` — subtle amber top banner shown when offline, fades when back online
- [x] 4. Wire OfflineBanner into `app.vue` so it renders across all layouts
- [x] 5. Enhance service worker to cache navigation routes for learn section paths
- [x] 6. Add component tests for OfflineBanner and useOnlineStatus

## File List

- `app/composables/useOnlineStatus.ts` — reactive online/offline detection composable
- `app/components/learn/OfflineBanner.vue` — subtle offline indicator banner
- `app/app.vue` — updated to include OfflineBanner
- `public/sw.js` — enhanced with learn section route caching
- `tests/component/learn/offline-banner.test.ts` — component tests

## Dev Agent Record

### Decisions

- **Leveraged existing SW infrastructure**: The project already had `public/sw.js` with app shell caching, `app/plugins/pwa.client.ts` for registration, `public/manifest.webmanifest`, and `public/offline.html`. Rather than replacing this with `@vite-pwa/nuxt` (which adds build-time complexity for Cloudflare Pages), the existing SW was enhanced with learn section route caching.

- **Network-first caching for learn sections**: The SW now uses a network-first strategy specifically for learn section navigation routes (`/app/learn/[courseId]/[sectionId]` and `/app/folders/[id]/learn/[courseId]/[sectionId]`). When online, the page is fetched and cached; when offline, the cached version is served. This prepares for Story 7-2 (content caching in IndexedDB) by ensuring the page shell is available offline.

- **Separate cache namespace**: Learn section navigation responses are stored in a `budds-learn-sections-v1` cache, separate from `budds-shell-v1`, so section caches can be managed independently without affecting app shell caching.

- **Banner in app.vue**: The OfflineBanner is rendered in `app.vue` (above `<NuxtLayout>`) rather than in a specific layout, ensuring it appears across all layouts (default + folder).

- **No ATDD step**: This story focuses on client-side service worker behavior and offline detection UI, which cannot be meaningfully tested in automated E2E (offline simulation requires service worker mocking). Component tests cover the banner behavior including online/offline transitions.

## Change Log

- Created `app/composables/useOnlineStatus.ts`: reactive `isOnline` ref that initializes from `navigator.onLine` on mount, listens to `online`/`offline` window events, and cleans up on unmount
- Created `app/components/learn/OfflineBanner.vue`: subtle amber banner with `WifiOff` icon, shown when offline via `v-if="!isOnline"`, uses Vue `Transition` for slide-down enter and fade-up leave animations, warm amber at 10% opacity (`bg-amber-500/10`), `role="status"` + `aria-live="polite"` for accessibility
- Updated `app/app.vue`: added `OfflineBanner` import and placed it inside `<ClientOnly>` above `<NuxtLayout>`
- Enhanced `public/sw.js`: added `SECTION_CACHE` namespace, `LEARN_SECTION_PATTERN` regex matching both top-level and folder-scoped section routes, network-first caching for matched navigation requests, fallback to cached section page when offline
- Created `tests/component/learn/offline-banner.test.ts`: 5 tests covering online (hidden), offline (visible), message content, accessibility attributes, and online/offline event transitions
