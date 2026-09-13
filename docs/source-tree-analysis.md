# Budds - Source Tree Analysis

**Date:** 2026-04-24

## Directory Structure

```
budds/
├── app/                                # Nuxt 4 frontend application
│   ├── app.vue                         # Root Vue component
│   ├── assets/
│   │   └── css/
│   │       └── tailwind.css            # Global styles, theme tokens, CSS variables
│   ├── components/
│   │   ├── audio-overview/             # Audio overview player and generation UI
│   │   ├── chat/                       # Chat message list, input, model selector
│   │   ├── dashboard/                  # Dashboard widgets and layout
│   │   ├── documents/                  # Document list, import, viewer
│   │   ├── flashcards/                 # Flashcard room, card flip, mastery UI
│   │   ├── folder-shell/               # Folder page shell and navigation
│   │   ├── folders/                    # Folder grid, create/edit dialogs
│   │   ├── global/                     # Globally registered components
│   │   ├── learn/                      # Course viewer, section navigation
│   │   ├── mobile/                     # Mobile-specific layout components
│   │   ├── quiz/                       # Quiz flow, questions, results
│   │   ├── sidebar/                    # App sidebar navigation
│   │   ├── ui/                         # 60+ shadcn-vue primitives (button, dialog, card, etc.)
│   │   └── voids/                      # Empty state / void section components
│   ├── composables/
│   │   ├── useAppTheme.ts              # Theme management
│   │   ├── useAudioOverviewDownload.ts # Audio file download logic
│   │   ├── useAudioOverviewStore.ts    # Audio overview state management
│   │   ├── useChat.ts                  # Folder-scoped RAG chat
│   │   ├── useDocuments.ts             # Document CRUD operations
│   │   ├── useFlashcardRooms.ts        # Flashcard room management
│   │   ├── useFolderLayout.ts          # Folder page layout state
│   │   ├── useFolderPageContext.ts     # Current folder context provider
│   │   ├── useFolderReferenceScope.ts  # Folder-scoped reference context
│   │   ├── useFolders.ts              # Folder CRUD operations
│   │   ├── useGeneralChat.ts           # General (non-folder) chat
│   │   ├── useGestureGuards.ts         # Touch gesture conflict resolution
│   │   ├── useHelperPane.ts            # Helper side pane state
│   │   ├── useHorizontalSwipeGesture.ts # Swipe gesture handler
│   │   ├── useMobileKeyboardInset.ts   # Mobile keyboard offset
│   │   ├── useMotionPresets.ts         # Animation preset definitions
│   │   ├── useOfflineAttempts.ts       # Offline quiz attempt storage
│   │   ├── useOfflineCache.ts          # Offline data caching
│   │   ├── useOfflineSync.ts           # Offline-to-online sync
│   │   ├── useOnlineStatus.ts          # Network status detection
│   │   ├── usePreFetchSection.ts       # Course section pre-fetching
│   │   ├── useQuizAttempt.ts           # Active quiz attempt state
│   │   ├── useQuizFlow.ts             # Quiz navigation flow
│   │   ├── useQuizGeneration.ts        # Quiz AI generation
│   │   ├── useQuizHistory.ts           # Quiz attempt history
│   │   ├── useQuizzes.ts              # Quiz CRUD operations
│   │   ├── useRag.ts                   # RAG search and retrieval
│   │   ├── useReferenceScope.ts        # Reference scope management
│   │   ├── useSwipeReveal.ts           # Swipe-to-reveal gesture
│   │   ├── useTasks.ts                # Task management
│   │   └── useTimezoneSync.ts          # Timezone synchronization
│   ├── constants/
│   │   └── models.ts                   # LLM model definitions
│   ├── layouts/
│   │   ├── default.vue                 # Default app layout
│   │   └── folder.vue                  # Folder page layout with sidebar
│   ├── lib/
│   │   └── utils.ts                    # cn() class name merger (clsx + twMerge)
│   ├── pages/
│   │   ├── index.vue                   # Landing / home page
│   │   ├── login.vue                   # Google OAuth login (guest-only)
│   │   ├── chat.vue                    # General chat page
│   │   ├── privacy.vue                 # Privacy policy
│   │   ├── terms.vue                   # Terms of service
│   │   ├── audio/
│   │   │   └── [token].vue             # Public audio overview player
│   │   └── app/
│   │       ├── index.vue               # App dashboard
│   │       ├── chat.vue                # General chat (authenticated)
│   │       ├── folders/
│   │       │   ├── [id].vue            # Folder detail page
│   │       │   └── [id]/               # Nested folder routes
│   │       └── learn/
│   │           └── review.vue          # Learn course review page
│   └── plugins/
│       ├── auth-redirect.client.ts     # Auth redirect handler
│       ├── convex-auth.client.ts       # Convex auth token sync
│       ├── motion.client.ts            # Motion animation setup (client)
│       ├── motion.server.ts            # Motion animation setup (server)
│       └── pwa.client.ts              # PWA service worker registration
├── server/                             # Nitro server
│   ├── auth.config.ts                  # Better Auth server config
│   ├── tsconfig.json                   # Server TypeScript config
│   ├── api/
│   │   ├── audio-overview/             # Audio generation and retrieval endpoints
│   │   ├── calendar/                   # Google Calendar sync endpoints
│   │   ├── chat/                       # Chat streaming endpoints
│   │   ├── course/                     # Course generation endpoints
│   │   ├── debug/                      # Debug/diagnostic endpoints
│   │   ├── export/                     # Data export endpoints
│   │   ├── flashcards/                 # Flashcard generation endpoints
│   │   ├── learn/                      # Learn section generation endpoints
│   │   ├── quiz/                       # Quiz generation endpoints
│   │   └── rag/                        # RAG search endpoints
│   ├── middleware/
│   │   ├── auth-proxy.ts               # Auth request proxy to Convex
│   │   └── convex-token.ts             # SSR Convex JWT token fetcher
│   └── utils/
│       ├── ai-gateway.ts               # Cloudflare AI Gateway wrapper
│       ├── ai-search.ts                # Cloudflare AI Search wrapper
│       ├── audio-primer-prompt.ts      # Audio overview primer prompt
│       ├── audio-script-prompt.ts      # Audio dialogue script prompt
│       ├── calendar-tokens.ts          # Calendar OAuth token management
│       ├── convex-client.ts            # Server-side Convex client
│       ├── convex-identity.ts          # Convex identity helpers
│       ├── convex-site-url.ts          # Convex site URL resolver
│       ├── flashcard-prompt.ts         # Flashcard generation prompt
│       ├── google-calendar.ts          # Google Calendar API client
│       ├── google-constants.ts         # Google API constants
│       ├── interjection-prompt.ts      # Audio interjection prompt
│       ├── models.ts                   # Server-side model config
│       ├── normalize-assistant-citations.ts # Citation normalization
│       ├── outline-prompt.ts           # Course outline prompt
│       ├── quiz-prompt.ts             # Quiz generation prompt
│       ├── r2-folder.ts               # R2 folder path helpers
│       ├── rate-limit.ts              # Request rate limiting
│       ├── runtime-config.ts           # Runtime config helpers
│       ├── section-text-prompt.ts      # Course section text prompt
│       ├── session-composition.ts      # Auth session composition
│       ├── tts-dia.ts                 # Dia TTS integration
│       ├── tts-provider.ts            # TTS provider abstraction
│       └── tts-workers-ai.ts          # Workers AI TTS integration
├── convex/                             # Convex backend
│   ├── schema.ts                       # Database schema (all tables)
│   ├── convex.config.ts                # Convex app config
│   ├── auth.ts                         # Better Auth Convex integration
│   ├── auth.config.ts                  # Auth provider config
│   ├── http.ts                         # Convex HTTP action routes
│   ├── crons.ts                        # Scheduled background jobs
│   ├── migrations.ts                   # Data migration functions
│   ├── folders.ts                      # Folder queries/mutations
│   ├── documents.ts                    # Document queries/mutations
│   ├── documentActions.ts              # Document import/processing actions
│   ├── documentImports.ts              # Document import mutations
│   ├── conversations.ts               # Chat conversation queries/mutations
│   ├── messages.ts                     # Chat message queries/mutations
│   ├── flashcardRooms.ts              # Flashcard room queries/mutations
│   ├── quizzes.ts                     # Quiz queries/mutations
│   ├── audioOverviews.ts              # Audio overview queries/mutations
│   ├── audioOverviewInterjections.ts  # Audio interjection queries/mutations
│   ├── courses.ts                     # Course queries/mutations
│   ├── courseSections.ts             # Course section queries/mutations
│   ├── courseSourceDocs.ts            # Course source document linking
│   ├── calendarConnections.ts         # Calendar connection management
│   ├── calendarEvents.ts             # Calendar event queries/mutations
│   ├── contentFlags.ts               # Content flagging system
│   ├── reviewItems.ts                # Spaced repetition review items
│   ├── tasks.ts                      # Task management
│   ├── users.ts                      # User queries/mutations
│   ├── learnProfile.ts              # Learning profile data
│   ├── sourceExtractors.ts          # URL content extraction
│   ├── dataExport.ts                # Data export functions
│   ├── accountDeletion.ts           # Account deletion logic
│   ├── archiveMultiChat.ts          # Multi-chat archive
│   ├── folderIcons.ts               # Folder icon definitions
│   ├── folderPalette.ts             # Folder color palette definitions
│   ├── lib/
│   │   ├── auth.ts                  # Auth helper utilities
│   │   ├── dates.ts                 # Date utilities
│   │   ├── masteryStateMachine.ts   # Flashcard mastery state machine
│   │   ├── sm2.ts                   # SM-2 spaced repetition algorithm
│   │   └── streak.ts               # Learning streak tracking
│   └── _generated/                  # Auto-generated Convex types and client
├── infra/                           # Infrastructure
│   ├── cloud-functions/
│   │   ├── start-dia/               # Cloud function to start Dia TTS server
│   │   └── stop-dia-idle/           # Cloud function to stop idle Dia server
│   └── dia-server/                  # Dia TTS server configuration
├── tests/                           # Test suites
│   ├── component/                   # Vue component tests
│   │   ├── app-shell/
│   │   ├── audio-overview/
│   │   ├── chat/
│   │   ├── composables/
│   │   ├── dashboard/
│   │   ├── documents/
│   │   ├── flashcards/
│   │   ├── folder-shell/
│   │   ├── folders/
│   │   ├── learn/
│   │   ├── quiz/
│   │   ├── sidebar/
│   │   └── voids/
│   └── support/
│       └── factories/               # Test data factories
├── scripts/
│   └── validate-env.mjs             # Build-time environment validation
├── public/
│   ├── icons/                       # App icons
│   ├── manifest.webmanifest         # PWA manifest
│   ├── offline.html                 # Offline fallback page
│   └── sw.js                        # Service worker
├── docs/                            # Project documentation
├── data/                            # Runtime data (gitignored)
├── patches/
│   └── nuxt-convex@0.0.6.patch     # Patched nuxt-convex module
├── nuxt.config.ts                   # Main Nuxt configuration
├── package.json                     # Dependencies and scripts
├── tsconfig.json                    # Root TypeScript config
├── components.json                  # shadcn-vue component config
└── CLAUDE.md                        # AI assistant project instructions
```

## Entry Points

| Entry Point | Path | Purpose |
|---|---|---|
| Root Component | `app/app.vue` | Vue application root |
| Nuxt Config | `nuxt.config.ts` | Application configuration, modules, runtime config |
| Convex Schema | `convex/schema.ts` | Database table definitions |
| Convex HTTP | `convex/http.ts` | HTTP action routes (auth endpoints) |
| Auth Config | `server/auth.config.ts` | Better Auth server setup |
| Service Worker | `public/sw.js` | PWA offline support |

## Key Patterns

- Pages in `app/pages/` map to routes via file-based routing
- Composables in `app/composables/` are auto-imported globally in Vue components
- Server utilities in `server/utils/` are auto-imported in server routes
- Components in `app/components/global/` are registered globally
- UI components use the `Ui` prefix (configured in shadcn config)
- Convex functions co-locate with their test files (`*.test.ts` alongside `*.ts`)
- Server API routes are organized by feature domain (chat, quiz, flashcards, etc.)
