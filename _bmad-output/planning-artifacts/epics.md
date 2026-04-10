---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
status: complete
completedAt: '2026-04-09'
inputDocuments:
  - prd.md
  - architecture.md
  - ux-design-specification.md
---

# Budds - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Budds, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: User can upload one or more files (PDF) to a specific folder
FR2: User can view upload status for each file (processing, success, failed) with actionable error messages for failures
FR3: User can view a list of all uploaded documents within a folder
FR4: User can delete an uploaded document, removing it from both storage and the semantic search index
FR5: User can view document metadata (filename, upload date, processing status, size)
FR6: System ingests uploaded documents by chunking, embedding, and indexing them into the semantic search index
FR7: System enforces per-user document isolation — a user's documents are never visible to or searchable by other users
FR8: User can create folders up to 3 levels of nesting depth
FR9: User can rename folders
FR10: User can delete folders (with confirmation, cascading to contained documents and subfolders)
FR11: User can move documents between folders
FR12: User can navigate the folder hierarchy to view contents at any level
FR13: User can view their complete folder structure as a navigable tree
FR14: User can send a natural language query and receive an AI-generated response grounded in their uploaded documents
FR15: User can view source citations alongside each AI response, showing the exact passages used
FR16: User can click a source citation to navigate to the relevant document and passage
FR17: User can select which AI model to use for chat responses
FR18: System defaults to a recommended model when user has not explicitly selected one
FR19: User can view chat responses as they stream in real-time (token-by-token)
FR20: User can scope chat queries to documents within a specific folder
FR21: User can view and continue previous chat conversations
FR22: User can start a new chat conversation
FR23: User can clear/delete a chat conversation
FR24: System persists chat history across sessions (survives page refresh and re-login)
FR25: User can generate a quiz from documents within a selected folder (V1.1)
FR26: User can take a generated quiz (multiple choice and free response questions) (V1.1)
FR27: User can view quiz results with scoring (V1.1)
FR28: User can view source citations for each quiz question (linking back to the passage that informed the question) (V1.1)
FR29: User can edit AI-generated quiz questions before or after taking the quiz (V1.1)
FR30: User can view previously generated quizzes (V1.1)
FR31: User can generate flash cards from documents within a selected folder (V1.1)
FR32: User can review flash cards in a card-by-card study interface (V1.1)
FR33: User can view the source citation for each flash card (linking back to the originating passage) (V1.1)
FR34: User can edit AI-generated flash cards (front and back content) (V1.1)
FR35: User can delete individual flash cards from a set (V1.1)
FR36: User can view previously generated flash card sets (V1.1)
FR37: User can sign in using Google OAuth
FR38: User can sign out, ending their session
FR39: User can delete their account and all associated data (documents, folders, chat history, quizzes, flash cards)
FR40: System redirects unauthenticated users to the login page when accessing protected routes
FR41: System redirects authenticated users away from the login page
FR42: User can export their data (documents, chat history, quizzes, flash cards)
FR43: System removes all associated search index entries when a user deletes a document
FR44: System removes all user data from all storage systems when a user deletes their account
FR45: System displays terms of service and privacy policy to users

### NonFunctional Requirements

NFR1: Chat responses (non-streaming) complete end-to-end in under 5 seconds for 95th percentile of queries
NFR2: Streaming chat responses deliver first token within 1 second
NFR3: File upload acknowledgment (UI feedback that processing has started) within 2 seconds of submission
NFR4: Document ingestion completes within 60 seconds per PDF (up to 50 pages)
NFR5: Folder tree navigation and document listing renders within 500ms
NFR6: Flash card and quiz generation completes within 10 seconds per request
NFR7: Page transitions within the authenticated app shell complete within 300ms
NFR8: All data transmitted over HTTPS (TLS 1.2+)
NFR9: Per-user document isolation enforced at the search index level — no query from User A can return documents belonging to User B under any circumstances
NFR10: API keys and secrets stored server-side only; never exposed to client-side code or browser network requests
NFR11: OAuth sessions expire after 30 days of inactivity; active sessions refresh automatically
NFR12: File uploads validated server-side for file type, size limits, and content before ingestion processing begins
NFR13: Account deletion permanently removes all user data from all storage systems (Convex, Cloudflare AI Search index, file storage) within 24 hours
NFR14: System supports 500 concurrent users with no degradation beyond stated performance targets
NFR15: Per-user document storage supports at least 500 documents per account without search quality degradation
NFR16: System handles semester traffic spikes (3-5x normal volume during midterms/finals) without downtime
NFR17: LLM cost per query remains trackable per model and per user to enable future rate limiting and pricing decisions
NFR18: Architecture supports horizontal scaling of the ingestion pipeline independent of the chat serving path
NFR19: WCAG 2.1 AA compliance for all user-facing pages and interactive elements
NFR20: Full keyboard navigation support — all features accessible without a mouse
NFR21: Screen reader compatibility for chat messages, source citations, folder navigation, and study materials
NFR22: Minimum 4.5:1 contrast ratio for all text in both dark and light mode
NFR23: Focus indicators visible on all interactive elements during keyboard navigation
NFR24: Cloudflare AI Search dependency: system degrades gracefully if AI Search is temporarily unavailable
NFR25: Cloudflare AI Gateway dependency: if gateway is unavailable, chat returns a clear error rather than hanging
NFR26: Convex dependency: if Convex is temporarily unavailable, the system queues writes and retries rather than losing user data
NFR27: OpenRouter model availability: if a selected model is unavailable, system falls back to the default model with notification
NFR28: 99.5% uptime during academic semester periods (September–December, January–May)
NFR29: Zero data loss for successfully uploaded and ingested documents
NFR30: Chat history persistence survives server restarts, deployments, and browser refreshes
NFR31: Graceful error recovery — any transient failure presents a user-actionable message, never a blank screen or unresponsive UI

### Additional Requirements

- Brownfield project — no starter template or project initialization story needed. First implementation stories address critical architectural gaps.
- Keep Better Auth + SQLite for V1 — deployment constrained to persistent-filesystem hosts (Railway, Render, Fly.io). Post-V1 migration path to Convex as Better Auth database adapter.
- Per-user document isolation via metadata filtering in Cloudflare AI Search — every chunk indexed with userId metadata, every search query includes mandatory userId filter, enforced server-side in a single searchDocuments() utility function.
- Convex as primary data store — tables: users, folders, documents, conversations, messages, quizzes, quizQuestions, flashCardSets, flashCards. All tables include userId field as mandatory index.
- Document ingestion pipeline: Client → POST /api/upload (Nitro) → validate file → store in Convex file storage → create document record (status: "processing") → trigger Convex action → extract text (pdf-parse or similar) → upsert into Cloudflare AI Search with metadata (userId, documentId, folderId, filename) → update document status.
- Streaming chat via Server-Sent Events (SSE) — wire existing generateCompletionStream utility to frontend via streaming Nitro endpoint.
- Cascading deletion sequences defined: document deletion removes AI Search chunks + file storage + Convex record; folder deletion cascades to all contained documents and subfolders bottom-up; account deletion cascades across all storage systems.
- File storage via Convex file storage for uploaded PDF binary data.
- Deployment target: Node.js server (Railway, Render, or Fly.io) — simple git-push auto-deploy. Migrate to Cloudflare Pages post-V1 if auth migrates off SQLite.
- CI/CD: GitHub Actions — lint check, TypeScript type check, build verification, auto-deploy on main branch push.
- Implementation sequence: Convex schema → folder management → file upload + storage → ingestion pipeline → per-user search isolation → chat persistence → streaming chat → component extraction → deployment pipeline → quiz generation (V1.1) → flash card generation (V1.1).
- PDF text extraction library: pdf-parse suggested, to be evaluated against pdf.js-extract at implementation time within Convex action.
- Recommended file size limit: 50MB per file, configurable via runtime config.
- Convex schema validators to be designed at implementation time following the data architecture guidelines.
- Document status state machine: uploading → processing → success | failed (with reason).
- All Convex queries/mutations must include userId filtering — no exceptions.
- Never call Cloudflare APIs from client-side code — always proxy through Nitro server routes.
- Never trust userId from request body — always extract from Better Auth session.

### UX Design Requirements

UX-DR1: Implement hybrid layout — D4 Study Mode Tabs as primary structure (Chat, Flash Cards, Quiz, Documents as horizontal tabs within each folder context), D1 collapsible Source Panel within Chat tab, D5 Dashboard Home at /app as entry view, D3 full-width mobile layout.
UX-DR2: Build Dashboard Home view at /app — card-based course overview showing folder name, document count, last activity timestamp, and quick action buttons (Chat, Cards). Include "Add Course" card variant for new folder creation. Empty state with guided prompt for first-time users.
UX-DR3: Implement ChatMessage component — role-based styling (user: muted bg right-aligned, assistant: bordered left-aligned with citations), streaming state with animated cursor, error state with retry action. role="log" on container, aria-label per message.
UX-DR4: Implement CitationBadge component — inline numbered references ([1], [2]) within chat responses. Click opens/scrolls source panel to matching passage. Hover shows tooltip preview. role="button", aria-label="Source [n] from [filename]", keyboard focusable.
UX-DR5: Implement SourceCard component — displays source passage in monospace font in the collapsible right panel (w-72 on desktop). Shows citation number, filename, relevance score badge, passage text. Highlighted state when corresponding citation badge is active.
UX-DR6: Implement FolderTree component — hierarchical folder navigation in sidebar (max 3 levels). Click to expand/collapse, click leaf to navigate. Right-click context menu for rename/delete. Drag files onto folders. role="tree" with role="treeitem", aria-expanded, arrow key navigation.
UX-DR7: Implement FileUploadZone component — drag-and-drop area for uploading PDFs. States: default (dashed border), drag-over (highlighted), uploading (progress), success, error. Click to open file picker. Multiple files supported. role="button", keyboard activatable.
UX-DR8: Implement FileStatusItem component — per-file processing status display. Processing (amber spinner), Indexed (green checkmark), Failed (red X + specific error message + actionable guidance). ARIA live region for status changes.
UX-DR9: Implement ModelSelector component — hidden by default, shows only recommended model label in chat footer. Click to expand full dropdown. Shows "(recommended)" badge on default model. Standard dropdown semantics, keyboard navigable.
UX-DR10: Implement FlashCard component (V1.1) — flip animation (tap/click to reveal back), swipe to advance on mobile. Source link per card. Editing mode. Progress indicator (12/24 cards). prefers-reduced-motion degrades to instant flip.
UX-DR11: Implement QuizQuestion component (V1.1) — multiple choice (role="radiogroup") and free-response types. States: unanswered, answered, correct (green), incorrect (red with source link). Keyboard selectable.
UX-DR12: Scaffold shadcn-nuxt primitives on-demand: Button, Input, Card, Dialog, DropdownMenu, ScrollArea, Tooltip, Sheet, Separator, Badge, Tabs, Progress, Alert, Skeleton, Collapsible, Toggle.
UX-DR13: Add Budds-specific semantic color tokens — citation badge (blue/teal accent), success state (muted green), warning/processing state (muted amber), source highlight (low-opacity primary tint). Extend existing oklch token system.
UX-DR14: Implement dark mode as default with light mode toggle. Both modes must meet 4.5:1 contrast ratio for all text.
UX-DR15: Implement typography scale — 14px base body, 24px page headings (700), 18px section headings (600), 14px body (400/500), 12px captions (400), 13px monospace for source citations.
UX-DR16: Implement responsive layout — mobile-first CSS. Desktop (>1024px): three-panel with sidebar + content + source panel. Tablet (768-1024px): two-panel, source panel collapses to inline citations. Mobile (<768px): single column, sidebar as Sheet overlay, tabs scroll horizontally.
UX-DR17: Implement breadcrumb navigation — full hierarchy path (Semester > Course > Topic) on desktop/tablet, truncated to current folder + back arrow on mobile. Each segment clickable.
UX-DR18: Implement button hierarchy — one primary button per context area. Destructive actions require Dialog confirmation with explicit cascade description. Icon-only buttons always have Tooltip labels.
UX-DR19: Implement inline feedback pattern (no toasts) — success (green checkmark, persistent), processing (amber spinner, until complete), error (red icon + specific message + action, persistent), info (muted text).
UX-DR20: Implement empty states for all containers — no folders ("Start by creating a course folder" + inline input), no files ("Drag PDFs here" + upload zone), no chat ("Ask a question about your materials" + focused input), no cards/quizzes ("Generate..." + button).
UX-DR21: Chat input behavior — single-line with Enter to send, Shift+Enter for newline, auto-grows to max 4 lines. / keyboard shortcut to focus from anywhere.
UX-DR22: Implement keyboard shortcuts — / (focus chat), Escape (close panel/sheet/cancel), Ctrl/Cmd+N (new chat), Arrow keys (folder tree/flash cards), Space (flip card).
UX-DR23: Implement accessibility foundations — skip-to-content link, semantic HTML landmarks (<nav>, <main>, <aside>), aria-live="polite" regions for file status and new chat messages, minimum 44x44px touch targets, prefers-reduced-motion support for all animations.
UX-DR24: Implement progressive availability — features appear when prerequisites are met. Chat activates when files are indexed. Quiz/cards activate when documents exist. No disabled buttons with tooltips.
UX-DR25: Implement loading patterns — skeleton components matching layout for initial loads, streaming text with cursor for chat, per-file progress for uploads, shimmer placeholder cards for study material generation.

### FR Coverage Map

FR1: Epic 3 — Upload files to folder
FR2: Epic 3 — View upload/processing status
FR3: Epic 3 — List documents in folder
FR4: Epic 3 — Delete document (storage + search index)
FR5: Epic 3 — View document metadata
FR6: Epic 3 — Ingestion pipeline (chunk, embed, index)
FR7: Epic 3 — Per-user document isolation
FR8: Epic 2 — Create folders (3-level hierarchy)
FR9: Epic 2 — Rename folders
FR10: Epic 2 — Delete folders (cascading)
FR11: Epic 3 — Move documents between folders
FR12: Epic 2 — Navigate folder hierarchy
FR13: Epic 2 — View folder tree
FR14: Epic 4 — RAG chat query with grounded response
FR15: Epic 4 — Source citations on responses
FR16: Epic 4 — Click-through to source passage
FR17: Epic 4 — Select AI model
FR18: Epic 4 — Default model selection
FR19: Epic 4 — Streaming chat responses
FR20: Epic 4 — Folder-scoped chat queries
FR21: Epic 4 — View/continue previous conversations
FR22: Epic 4 — Start new conversation
FR23: Epic 4 — Delete conversation
FR24: Epic 4 — Persist chat history across sessions
FR25: Epic 6 — Generate quiz from folder documents
FR26: Epic 6 — Take quiz (MC + free response)
FR27: Epic 6 — View quiz results with scoring
FR28: Epic 6 — Source citations on quiz questions
FR29: Epic 6 — Edit quiz questions
FR30: Epic 6 — View previous quizzes
FR31: Epic 7 — Generate flash cards from folder documents
FR32: Epic 7 — Card-by-card study interface
FR33: Epic 7 — Source citation per flash card
FR34: Epic 7 — Edit flash cards
FR35: Epic 7 — Delete individual flash cards
FR36: Epic 7 — View previous flash card sets
FR37: Epic 1 — Google OAuth sign in
FR38: Epic 1 — Sign out
FR39: Epic 5 — Delete account and all data
FR40: Epic 1 — Redirect unauth to login
FR41: Epic 1 — Redirect auth from login
FR42: Epic 5 — Export user data
FR43: Epic 5 — Remove search index entries on document delete
FR44: Epic 5 — Remove all user data on account delete
FR45: Epic 5 — Display terms of service and privacy policy

## Epic List

### Epic 1: App Foundation & Dashboard
Users can sign in with Google, navigate the app shell (sidebar, study mode tabs, breadcrumbs), and see a dashboard home view of their courses.
**FRs covered:** FR37, FR38, FR40, FR41

### Epic 2: Knowledge Organization
Users can create, rename, delete, and navigate folders in a 3-level hierarchy, and view their complete folder structure as a navigable tree.
**FRs covered:** FR8, FR9, FR10, FR12, FR13

### Epic 3: Document Upload & Processing
Users can upload PDFs to folders, see per-file processing status, view document metadata, delete documents, move documents between folders, and trust that their documents are isolated from other users.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR11

### Epic 4: AI Chat with Sources & History
Users can chat with their documents scoped to a folder, see streaming responses with inline source citations, click through to verify source passages, select AI models, and have conversations persist across sessions.
**FRs covered:** FR14, FR15, FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24

### Epic 5: Data Privacy & Account Management
Users can delete their account with all associated data cascading across all storage systems, export their data, and view terms of service and privacy policy.
**FRs covered:** FR39, FR42, FR43, FR44, FR45

### Epic 6: Quiz Generation (V1.1)
Users can generate quizzes from folder-scoped documents, take multiple choice and free response questions, view scores with source-linked explanations, and edit/revisit quizzes.
**FRs covered:** FR25, FR26, FR27, FR28, FR29, FR30

### Epic 7: Flash Card Generation (V1.1)
Users can generate flash cards from folder-scoped documents, study them in a card-by-card interface with flip/swipe, view source citations per card, edit or delete individual cards, and revisit previous sets.
**FRs covered:** FR31, FR32, FR33, FR34, FR35, FR36

## Epic 1: App Foundation & Dashboard

Users can sign in with Google, navigate the app shell (sidebar, study mode tabs, breadcrumbs), and see a dashboard home view of their courses.

### Story 1.1: Verify & Harden Authentication Flow

As a student,
I want to sign in with my Google account and be securely routed to the app,
So that I can access my personal learning workspace without friction.

**Acceptance Criteria:**

**Given** a user is not authenticated
**When** they visit any `/app/**` route
**Then** they are redirected to the `/login` page
**And** no protected content is flashed before redirect

**Given** an authenticated user
**When** they visit `/login`
**Then** they are redirected to `/app`

**Given** a user on the login page
**When** they click "Sign in with Google" and complete the OAuth flow
**Then** they are signed in and redirected to `/app`
**And** a user record is created or updated in the Convex `users` table (userId, name, email, avatarUrl from Google profile)

**Given** an authenticated user
**When** they click "Sign out"
**Then** their session is ended and they are redirected to `/login`
**And** the Better Auth session is invalidated

**Given** a user with an active session
**When** they return after less than 30 days of inactivity
**Then** their session is still valid and they can access `/app` without re-authenticating

### Story 1.2: App Shell Layout with Responsive Navigation

As a student,
I want a clean, navigable app shell with sidebar and study mode tabs,
So that I can move between my folders, chats, and study modes without confusion.

**Acceptance Criteria:**

**Given** an authenticated user on any `/app/**` route on desktop (>1024px)
**When** the page loads
**Then** a persistent sidebar (w-64) is visible on the left with sections for Folders and Recent Chats (empty state placeholders for now)
**And** the main content area shows a horizontal tab bar with Chat, Flash Cards, Quiz, and Documents tabs (placeholder content)
**And** a breadcrumb navigation is visible in the header area showing the current location
**And** a skip-to-content link is the first focusable element for keyboard users

**Given** a user on mobile (<768px)
**When** they view the app
**Then** the sidebar is hidden by default
**And** a menu button opens the sidebar as a Sheet overlay (slide-in from left)
**And** the study mode tabs scroll horizontally
**And** the breadcrumb shows the current folder name with a back arrow

**Given** a user on tablet (768-1024px)
**When** they view the app
**Then** the sidebar is visible and the main content fills the remaining width
**And** no source panel is shown (inline citations only at this breakpoint)

**Given** any viewport
**When** the user views the app
**Then** the design token foundations are applied: Inter font with the defined type scale (14px body, 24px headings), semantic color tokens including Budds-specific additions (citation blue/teal, success green, warning amber, source highlight)
**And** dark mode is the default theme
**And** a light/dark mode toggle is accessible
**And** all text meets 4.5:1 contrast ratio in both modes
**And** semantic HTML landmarks are used (<nav>, <main>, <aside>)

**Given** the app shell is rendered
**When** shadcn-nuxt primitives are needed
**Then** Button, Tabs, Sheet, Separator, ScrollArea, and Skeleton components are scaffolded and available

### Story 1.3: Dashboard Home View

As a student,
I want to see a home dashboard showing my courses at a glance,
So that I can quickly navigate to any course and see my overall knowledge base.

**Acceptance Criteria:**

**Given** an authenticated user with existing folders
**When** they navigate to `/app`
**Then** they see a card grid of their top-level folders (DashboardCourseCard) showing folder name, document count, and last activity timestamp
**And** cards are displayed in a responsive grid (1 column mobile, 2 tablet, 3 desktop)
**And** clicking a course card navigates to that folder's view

**Given** a first-time user with no folders
**When** they navigate to `/app`
**Then** they see an empty state with a guided prompt: "Start by creating a course folder"
**And** an inline folder name input with a create button is displayed
**And** an "Add Course" card with a dashed border variant is visible

**Given** a user with existing folders
**When** they view the dashboard
**Then** an "Add Course" card is visible alongside their existing course cards
**And** clicking it opens an inline folder creation input

**Given** the dashboard view
**When** Card and Badge shadcn components are needed
**Then** they are scaffolded and available for the DashboardCourseCard component

## Epic 2: Knowledge Organization

Users can create, rename, delete, and navigate folders in a 3-level hierarchy, and view their complete folder structure as a navigable tree.

### Story 2.1: Create and Navigate Folder Hierarchy

As a student,
I want to create course folders up to 3 levels deep and navigate them in a tree,
So that I can organize my materials by semester, course, and topic.

**Acceptance Criteria:**

**Given** an authenticated user
**When** they create a new folder at the root level
**Then** a folder record is created in the Convex `folders` table with `userId`, `name`, `parentId: null`, and the folder appears in the sidebar FolderTree
**And** the `folders` Convex table is created with fields: `userId`, `name`, `parentId` (optional), with indexes on `userId` and `parentId`

**Given** a user viewing a folder
**When** they create a subfolder inside it
**Then** the subfolder is created with `parentId` referencing the parent folder
**And** the FolderTree updates in real-time via Convex subscription

**Given** a user attempts to create a folder at depth 4 (great-grandchild)
**When** they try to add a subfolder inside a 3rd-level folder
**Then** the creation is prevented with a clear message: "Maximum folder depth (3 levels) reached"

**Given** the sidebar FolderTree component
**When** a user clicks a folder
**Then** it expands/collapses to show or hide child folders
**And** clicking a leaf folder navigates to that folder's view at `/app/folders/[id]`
**And** the active folder is visually highlighted with `bg-muted`
**And** the breadcrumb updates to show the full hierarchy path

**Given** a user navigating with keyboard
**When** they focus the folder tree
**Then** arrow keys navigate between items, Enter expands/collapses or selects
**And** the tree uses `role="tree"` with `role="treeitem"` and `aria-expanded` attributes

**Given** the FolderTree component is rendered
**When** Collapsible shadcn component is needed
**Then** it is scaffolded and available

### Story 2.2: Rename and Delete Folders

As a student,
I want to rename and delete folders,
So that I can keep my knowledge base organized as my courses evolve.

**Acceptance Criteria:**

**Given** a user viewing a folder in the sidebar
**When** they right-click (or tap the context menu button on mobile)
**Then** a DropdownMenu appears with "Rename" and "Delete" options

**Given** a user selects "Rename" from the context menu
**When** the folder name becomes an inline editable input
**Then** they can type a new name, press Enter to confirm, or Escape to cancel
**And** empty names and whitespace-only names are rejected
**And** the name is trimmed and limited to 100 characters
**And** the Convex folder record updates in real-time

**Given** a user selects "Delete" on a folder with no children or documents
**When** the confirmation Dialog appears
**Then** it shows the folder name and a "Delete" button
**And** confirming deletes the folder from Convex
**And** the FolderTree updates in real-time

**Given** a user selects "Delete" on a folder with subfolders and/or documents
**When** the confirmation Dialog appears
**Then** it explicitly describes the cascade: "Delete [folder name] and all [N] subfolders and [M] documents inside?"
**And** the delete button uses destructive styling
**And** confirming triggers recursive deletion of all child folders and their documents (bottom-up)

**Given** the DropdownMenu and Dialog shadcn components are needed
**When** this story is implemented
**Then** they are scaffolded and available

## Epic 3: Document Upload & Processing

Users can upload PDFs to folders, see per-file processing status, view document metadata, delete documents, move documents between folders, and trust that their documents are isolated from other users.

### Story 3.1: Upload Files and Track Processing Status

As a student,
I want to drag and drop PDFs into a folder and see their processing status,
So that I know which materials are ready for AI-powered study.

**Acceptance Criteria:**

**Given** a user viewing a folder at `/app/folders/[id]`
**When** they drag PDF files onto the FileUploadZone (or click to browse)
**Then** each file is immediately acknowledged in a file list with "Processing" status (amber spinner)
**And** the files are validated server-side for type (PDF only) and size (max 50MB)
**And** invalid files are rejected with a specific error message (e.g., "Only PDF files are supported", "File exceeds 50MB limit")

**Given** files are accepted
**When** the upload completes
**Then** each file is stored in Convex file storage
**And** a document record is created in the Convex `documents` table with fields: `userId`, `folderId`, `filename`, `fileId` (Convex storage reference), `status` ("processing"), `size`, and Convex's `_creationTime` is used for upload date
**And** the `documents` table has indexes on `userId`, `folderId`, and `status`

**Given** the upload API route `POST /api/upload`
**When** a request is received
**Then** the authenticated userId is extracted from the Better Auth session (never from request body)
**And** the file is validated and stored before returning a response

**Given** a user viewing a folder with documents
**When** the document list renders
**Then** each document shows filename, upload date, processing status, and file size via the FileStatusItem component
**And** the list updates in real-time via Convex subscription as status changes

**Given** the FileUploadZone component
**When** rendered on desktop
**Then** it shows a dashed-border drop zone with "Drag PDFs here or browse" text
**And** the border changes to solid with a subtle background tint on drag-over
**And** it is keyboard activatable with `role="button"`

**Given** the FileUploadZone on mobile
**When** rendered
**Then** it shows a tap-to-browse button (no drag-and-drop)

**Given** the Progress and Alert shadcn components are needed
**When** this story is implemented
**Then** they are scaffolded and available

### Story 3.2: Document Ingestion Pipeline with Per-User Isolation

As a student,
I want my uploaded documents to be automatically processed and indexed for AI search,
So that I can ask questions about my materials and get accurate, source-cited answers.

**Acceptance Criteria:**

**Given** a document record with status "processing"
**When** the Convex action is triggered
**Then** the PDF binary is retrieved from Convex file storage
**And** text is extracted using a server-side PDF parsing library
**And** the extracted text is upserted into Cloudflare AI Search with mandatory metadata: `userId`, `documentId`, `folderId`, `filename`
**And** the document status is updated to "success" via Convex mutation

**Given** a PDF with no extractable text (scanned/image-only)
**When** the ingestion action runs
**Then** the document status is updated to "failed" with reason: "No extractable text detected — scanned or image-only PDF"
**And** the UI shows the failure via FileStatusItem (red X + error message)

**Given** any other ingestion failure (AI Search error, timeout, etc.)
**When** the error occurs
**Then** the document status is updated to "failed" with a specific reason
**And** the user sees an actionable error message

**Given** the `searchDocuments()` server utility in `server/utils/ai-search.ts`
**When** any code path queries Cloudflare AI Search
**Then** a `userId` filter is always injected into the query — this filter cannot be omitted
**And** this single function is the only gateway to AI Search for all features (chat, quiz, flash cards)

**Given** User A has uploaded documents
**When** User B performs a search
**Then** User B's results never include any of User A's documents under any circumstances

**Given** a document finishes ingestion successfully
**When** the status changes to "success"
**Then** the UI updates in real-time via Convex subscription
**And** the document is immediately available for AI chat queries in that folder

### Story 3.3: Delete Documents and Move Between Folders

As a student,
I want to delete documents I no longer need and reorganize them between folders,
So that my knowledge base stays clean and well-organized.

**Acceptance Criteria:**

**Given** a user viewing a document in the document list
**When** they click the delete action on a document
**Then** a confirmation Dialog appears showing the document filename
**And** confirming triggers the cascading deletion sequence:
1. Remove all chunks from Cloudflare AI Search (by documentId metadata filter)
2. Delete the file from Convex file storage
3. Delete the document record from Convex
**And** the document list updates in real-time

**Given** a user viewing the document list
**When** they select "Move to folder" on a document
**Then** they can choose a destination folder from their folder tree
**And** the document's `folderId` is updated in Convex
**And** the document's metadata in Cloudflare AI Search is updated with the new `folderId`
**And** the document appears in the destination folder and is removed from the source folder

**Given** a deleted document that was referenced in chat messages
**When** the deletion completes
**Then** source citations referencing that document are marked as "document deleted" in the chat UI

## Epic 4: AI Chat with Sources & History

Users can chat with their documents scoped to a folder, see streaming responses with inline source citations, click through to verify source passages, select AI models, and have conversations persist across sessions.

### Story 4.1: Folder-Scoped RAG Chat with Source Citations

As a student,
I want to ask questions about my uploaded materials and see answers with clickable source citations,
So that I can understand my course content and trust the AI's responses.

**Acceptance Criteria:**

**Given** a user in a folder with indexed documents
**When** they type a question in the chat input and press Enter
**Then** the query is sent to `POST /api/rag/chat` with the folder's `folderId`
**And** the server calls `searchDocuments()` with both `userId` and `folderId` filters to retrieve relevant chunks
**And** the retrieved chunks are assembled into a system prompt and sent to the LLM via AI Gateway
**And** the response is displayed as a ChatMessage (assistant variant: bordered, left-aligned)

**Given** the AI response includes source passages
**When** the response renders
**Then** inline CitationBadge components appear as numbered references ([1], [2], etc.) within the response text
**And** each badge is keyboard focusable with `role="button"` and `aria-label="Source [n] from [filename]"`

**Given** a user clicks or taps a CitationBadge
**When** on desktop (>1024px)
**Then** the collapsible source panel (w-72) opens on the right showing SourceCard components
**And** the panel scrolls to the matching source passage
**And** the matching SourceCard is highlighted

**Given** a user clicks a CitationBadge on mobile or tablet (<1024px)
**When** the citation is tapped
**Then** the source passage expands inline below the message as an expandable chip

**Given** a SourceCard component
**When** rendered
**Then** it displays the citation number, filename, relevance score badge, and passage text in monospace font
**And** it has `aria-label="Source passage from [filename]"`

**Given** the user's chat input
**When** rendered
**Then** it supports Enter to send, Shift+Enter for newline, auto-grows to max 4 lines
**And** the `/` keyboard shortcut focuses the input from anywhere in the app
**And** empty submissions are prevented

**Given** a folder with no indexed documents
**When** the user views the chat tab
**Then** the chat shows an empty state: "Upload documents to start chatting"
**And** the chat input is not active until documents are indexed (progressive availability)

### Story 4.2: Streaming Chat Responses

As a student,
I want to see the AI's response appear in real-time as it's generated,
So that I feel the tool is responsive and can start reading immediately.

**Acceptance Criteria:**

**Given** a user sends a chat query
**When** the server processes it via `POST /api/rag/chat-stream`
**Then** the response is delivered via Server-Sent Events (SSE) using the existing `generateCompletionStream` utility
**And** the ChatMessage component renders tokens progressively with a subtle blinking cursor

**Given** streaming is in progress
**When** tokens are being received
**Then** the first token appears within 1 second of the query being sent
**And** CitationBadge components render as their positions are identified in the stream

**Given** a user with `prefers-reduced-motion` enabled
**When** a streaming response arrives
**Then** the text renders in larger blocks instead of token-by-token (no animated cursor)

**Given** SSE is not supported or the connection fails
**When** the streaming endpoint errors
**Then** the system falls back to the non-streaming `POST /api/rag/chat` endpoint
**And** the user sees the complete response after generation finishes with no loss of content

**Given** the chat container
**When** new messages arrive (user or assistant)
**Then** `aria-live="polite"` announces the new content to screen readers in meaningful chunks, not per-token

### Story 4.3: Model Selection

As a power user,
I want to choose which AI model generates my answers,
So that I can balance response quality and speed for my needs.

**Acceptance Criteria:**

**Given** the chat interface
**When** a user has not explicitly selected a model
**Then** the system uses the recommended default model
**And** the chat footer shows only the model name label (e.g., "GPT-4o") — no dropdown visible by default

**Given** a user clicks the model name label in the chat footer
**When** the ModelSelector dropdown opens
**Then** all available models are listed with the default marked "(recommended)"
**And** the dropdown uses standard DropdownMenu semantics and is keyboard navigable

**Given** a user selects a different model
**When** they send their next query
**Then** the selected model is used for that query and all subsequent queries in the conversation
**And** the model label in the footer updates to reflect the selection

**Given** the selected model becomes unavailable via OpenRouter
**When** a query is sent
**Then** the system falls back to the default model
**And** the user sees a notification: "Selected model unavailable, using [default model]"

### Story 4.4: Chat History & Conversation Management

As a student,
I want my chat conversations to be saved and accessible across sessions,
So that I can pick up where I left off and review previous study discussions.

**Acceptance Criteria:**

**Given** an authenticated user
**When** they send their first message in a folder's chat
**Then** a new conversation record is created in the Convex `conversations` table with `userId`, `folderId`, `title` (auto-generated from the first message), and each message is stored in the Convex `messages` table with `conversationId`, `role` ("user" or "assistant"), `content`, `sources` (array of source references), and `model`

**Given** a user returns to the app after closing the browser
**When** they navigate to a folder's chat tab
**Then** their most recent conversation loads with full message history
**And** they can continue the conversation seamlessly

**Given** the sidebar "Recent Chats" section
**When** rendered
**Then** it shows a flat list of the user's conversations ordered by last activity
**And** each entry shows the conversation title and folder name
**And** clicking an entry navigates to that folder's chat with the conversation loaded

**Given** a user clicks "New Chat" (or presses Ctrl/Cmd+N)
**When** in a folder's chat tab
**Then** a new empty conversation starts
**And** the previous conversation remains saved and accessible

**Given** a user wants to delete a conversation
**When** they select delete from the conversation's context menu
**Then** a confirmation Dialog appears
**And** confirming deletes the conversation and all its messages from Convex
**And** the sidebar updates in real-time

**Given** the Convex `conversations` and `messages` tables
**When** created
**Then** `conversations` has indexes on `userId` and `folderId`
**And** `messages` has an index on `conversationId` for efficient pagination
**And** all queries filter by `userId` — no exceptions

## Epic 5: Data Privacy & Account Management

Users can delete their account with all associated data cascading across all storage systems, export their data, and view terms of service and privacy policy.

### Story 5.1: Account Deletion with Cascading Data Cleanup

As a student,
I want to delete my account and know that all my data is permanently removed,
So that I maintain control over my personal information.

**Acceptance Criteria:**

**Given** an authenticated user in account settings
**When** they click "Delete Account"
**Then** a confirmation Dialog appears with destructive styling explaining: "This will permanently delete your account, all folders, documents, chat history, quizzes, and flash cards. This action cannot be undone."
**And** the user must type their email or "DELETE" to confirm

**Given** the user confirms account deletion
**When** the `POST /api/account/delete` endpoint is called
**Then** the following cascading deletion sequence executes:
1. List all user's documents and remove their chunks from Cloudflare AI Search (by userId metadata filter)
2. Delete all files from Convex file storage
3. Delete all messages, conversations, quiz questions, quizzes, flash cards, flash card sets from Convex
4. Delete all documents and folders from Convex
5. Delete the user record from Convex
6. Delete the user from Better Auth (SQLite)
**And** the user's session is invalidated
**And** the user is redirected to the landing page

**Given** the deletion process encounters a partial failure
**When** one step fails (e.g., AI Search is temporarily unavailable)
**Then** the failure is logged and the process retries that step
**And** all user data is removed from all systems within 24 hours (NFR13)

**Given** an account has been deleted
**When** any query attempts to access that user's data
**Then** no records are returned from any storage system (Convex, AI Search, file storage)

### Story 5.2: Document Deletion Index Cleanup Validation

As a student,
I want to be confident that deleting a document fully removes it from search,
So that deleted materials never appear in my AI chat responses.

**Acceptance Criteria:**

**Given** a document has been deleted via Story 3.3's deletion flow
**When** the user subsequently asks a chat question
**Then** no search results reference the deleted document's chunks
**And** no source citations point to the deleted document

**Given** a document deletion where AI Search is temporarily unavailable
**When** the chunk removal step fails
**Then** the system retries the AI Search cleanup
**And** the document record in Convex is marked with a "pending_cleanup" flag
**And** a background process ensures cleanup completes

**Given** a folder deletion that cascades to multiple documents
**When** the cascade completes
**Then** all chunks from all deleted documents are removed from AI Search
**And** no orphaned chunks remain in the index for any deleted document

### Story 5.3: Data Export and Legal Pages

As a student,
I want to export all my data and review the platform's terms and privacy policy,
So that I understand how my data is handled and can take it with me if I leave.

**Acceptance Criteria:**

**Given** an authenticated user in account settings
**When** they click "Export My Data"
**Then** the system generates a downloadable package containing:
- All uploaded documents (original PDFs from Convex file storage)
- Chat history (conversations and messages as JSON)
- Quiz results and questions (as JSON) if any exist
- Flash card sets and cards (as JSON) if any exist
- Folder structure metadata (as JSON)
**And** the download begins automatically

**Given** a user with a large data set
**When** export is initiated
**Then** a processing indicator is shown while the export is assembled
**And** the export completes without timeout for accounts with up to 500 documents

**Given** any visitor (authenticated or not)
**When** they navigate to `/terms` or `/privacy`
**Then** the terms of service and privacy policy pages are displayed
**And** the pages are server-side rendered for SEO
**And** the content covers: what data is stored, where, for how long, how to delete it, and user responsibility for uploaded content

## Epic 6: Quiz Generation (V1.1)

Users can generate quizzes from folder-scoped documents, take multiple choice and free response questions, view scores with source-linked explanations, and edit/revisit quizzes.

### Story 6.1: Generate Quiz from Folder Documents

As a student,
I want to generate a quiz from my uploaded materials in a folder,
So that I can test my understanding of the course content.

**Acceptance Criteria:**

**Given** a user in a folder with indexed documents
**When** they navigate to the Quiz tab and click "Generate Quiz"
**Then** the system uses `searchDocuments()` (with userId and folderId filters) to retrieve relevant chunks
**And** the chunks are sent to the LLM via AI Gateway with a quiz generation prompt
**And** the LLM returns a set of questions (mix of multiple choice and free response)
**And** quiz generation completes within 10 seconds (NFR6)

**Given** the quiz is generated
**When** saved to Convex
**Then** a `quizzes` record is created with `userId`, `folderId`, `title` (auto-generated from folder/topic), `createdAt`
**And** each question is stored in `quizQuestions` with `quizId`, `question`, `type` ("multiple-choice" or "free-response"), `options` (for MC), `correctAnswer`, `sourceDocumentId`, `sourceChunkContent`, and `sourceFilename`
**And** the `quizzes` table has indexes on `userId` and `folderId`
**And** the `quizQuestions` table has an index on `quizId`

**Given** the quiz is generated successfully
**When** the UI renders
**Then** shimmer placeholder cards are shown during generation (loading pattern)
**And** the quiz appears with all questions listed, each showing its source citation via CitationBadge

**Given** a folder with no indexed documents
**When** the user views the Quiz tab
**Then** an empty state is shown: "Upload and index documents to generate quizzes"
**And** the Generate button is not shown (progressive availability)

### Story 6.2: Take Quiz and View Results

As a student,
I want to take a generated quiz and see my score with explanations,
So that I can identify knowledge gaps and review the source material I missed.

**Acceptance Criteria:**

**Given** a generated quiz with questions
**When** the user starts taking the quiz
**Then** each QuizQuestion component renders according to type:
- Multiple choice: radio group (`role="radiogroup"`) with labeled options, keyboard selectable
- Free response: text input area
**And** questions are shown in sequence

**Given** the user answers all questions
**When** they click "Submit Quiz"
**Then** answers are evaluated against correct answers
**And** the results view shows: total score (e.g., "6/8"), per-question result

**Given** a correctly answered question
**When** results are displayed
**Then** the question shows a green "Correct" state

**Given** an incorrectly answered question
**When** results are displayed
**Then** the question shows a red "Incorrect" state
**And** the correct answer is revealed
**And** a source citation link shows the passage that informed the correct answer
**And** clicking the source citation shows the SourceCard with the relevant passage

**Given** quiz results
**When** the quiz is completed
**Then** the score is saved to the Convex `quizzes` record (`score`, `completedAt`)
**And** individual answers are saved for review

### Story 6.3: Edit Questions and View Previous Quizzes

As a student,
I want to edit quiz questions and revisit previous quizzes,
So that I can refine AI-generated content and track my progress over time.

**Acceptance Criteria:**

**Given** a generated quiz (before or after taking)
**When** the user clicks "Edit" on a question
**Then** the question text, options (for MC), and correct answer become editable inline
**And** changes are saved to the Convex `quizQuestions` record on confirmation
**And** the source citation is preserved (not editable)

**Given** the Quiz tab in a folder
**When** the user views it
**Then** a list of previously generated quizzes is shown, ordered by creation date
**And** each entry shows the quiz title, date, and score (if taken)

**Given** a user clicks on a previous quiz
**When** it loads
**Then** they can review their previous answers and results
**And** they can retake the quiz (answers reset, new attempt)

**Given** a user has not yet generated any quizzes in a folder
**When** they view the quiz list
**Then** only the "Generate Quiz" action is shown (no empty list clutter)

## Epic 7: Flash Card Generation (V1.1)

Users can generate flash cards from folder-scoped documents, study them in a card-by-card interface with flip/swipe, view source citations per card, edit or delete individual cards, and revisit previous sets.

### Story 7.1: Generate Flash Cards from Folder Documents

As a student,
I want to generate flash cards from my uploaded materials in a folder,
So that I can create study aids for memorization without manually writing each card.

**Acceptance Criteria:**

**Given** a user in a folder with indexed documents
**When** they navigate to the Flash Cards tab and click "Generate Flash Cards"
**Then** the system uses `searchDocuments()` (with userId and folderId filters) to retrieve relevant chunks
**And** the chunks are sent to the LLM via AI Gateway with a flash card generation prompt
**And** the LLM returns a set of front/back card pairs
**And** generation completes within 10 seconds (NFR6)

**Given** flash cards are generated
**When** saved to Convex
**Then** a `flashCardSets` record is created with `userId`, `folderId`, `title` (auto-generated from folder/topic), `cardCount`
**And** each card is stored in `flashCards` with `setId`, `front`, `back`, `sourceDocumentId`, `sourceChunkContent`, `sourceFilename`
**And** the `flashCardSets` table has indexes on `userId` and `folderId`
**And** the `flashCards` table has an index on `setId`

**Given** each generated flash card
**When** rendered
**Then** it displays a source citation linking back to the exact passage that informed the card content

**Given** a folder with no indexed documents
**When** the user views the Flash Cards tab
**Then** an empty state is shown: "Upload and index documents to generate flash cards"
**And** the Generate button is not shown (progressive availability)

**Given** generation is in progress
**When** waiting for the LLM response
**Then** shimmer placeholder cards are shown as the loading pattern

### Story 7.2: Study Flash Cards

As a student,
I want to flip through flash cards one by one and track my progress,
So that I can actively recall course material and reinforce my learning.

**Acceptance Criteria:**

**Given** a flash card set is loaded
**When** the study interface renders
**Then** the FlashCard component shows the front (question/prompt) of the first card
**And** a progress indicator displays current position (e.g., "1/24")

**Given** the user is viewing the front of a card
**When** they click/tap the card or press Space
**Then** the card flips with a smooth animation to reveal the back (answer)
**And** the source citation for the card is accessible via a link on the back

**Given** the user is viewing the back of a card
**When** they click/tap "Next" or press the right arrow key
**Then** the next card in the set is shown (front facing)
**And** the progress indicator updates

**Given** the user is on mobile
**When** they swipe left
**Then** the next card advances
**And** swiping right goes to the previous card
**And** swipe gestures have equivalent button alternatives

**Given** a user with `prefers-reduced-motion` enabled
**When** a card flips or advances
**Then** the animation degrades to an instant show/hide transition (no flip animation)

**Given** the user reaches the last card
**When** they advance past it
**Then** a completion summary is shown with total cards reviewed
**And** an option to restart the set or return to the folder

**Given** the flash card study interface
**When** navigating with keyboard
**Then** Space flips the current card, left/right arrows navigate between cards
**And** all controls are keyboard accessible

### Story 7.3: Edit, Delete, and Manage Flash Card Sets

As a student,
I want to edit card content, remove bad cards, and revisit previous sets,
So that I can curate high-quality study materials tailored to my needs.

**Acceptance Criteria:**

**Given** a user viewing a flash card (front or back)
**When** they click "Edit"
**Then** the front and back content become editable text fields
**And** changes are saved to the Convex `flashCards` record on confirmation
**And** the source citation is preserved (not editable)

**Given** a user viewing a flash card
**When** they click "Delete" on the card
**Then** a confirmation appears
**And** confirming removes the card from the Convex `flashCards` table
**And** the set's `cardCount` updates and the progress indicator adjusts
**And** the next card is shown automatically

**Given** the Flash Cards tab in a folder
**When** the user views it
**Then** a list of previously generated flash card sets is shown, ordered by creation date
**And** each entry shows the set title, card count, and creation date

**Given** a user clicks on a previous flash card set
**When** it loads
**Then** they can resume studying from the beginning of the set

**Given** a user has not yet generated any flash cards in a folder
**When** they view the flash card list
**Then** only the "Generate Flash Cards" action is shown
