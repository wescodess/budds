---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
status: complete
completedAt: "2026-04-22"
inputDocuments:
  - prd-learn-module.md
  - architecture-learn-module.md
  - ux-design-learn-module.md
  - product-brief-learn-module.md
---

# Budds Learn Module - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the Budds Learn Module, decomposing the requirements from the PRD, Architecture, and UX Design into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: User can create a course from a specific folder's documents
- FR2: User can create a course by selecting documents across multiple folders
- FR3: User can create a course from a topic with no documents (web-sourced)
- FR4: User can view an AI-generated course outline of 5-15 sections ordered by dependency
- FR5: User can edit the course outline (reorder, remove, and add sections) before any content is generated
- FR6: User can view a source confidence indicator showing how much of the course draws from their documents vs web sources
- FR7: User can set a learning pace for a course (intensive, steady, or relaxed)
- FR8: User can change the learning pace at any time
- FR9: User can view all their courses from the top-level Learn route
- FR10: User can view folder-scoped courses from within a folder's Learn tab
- FR11: User can delete a course and all associated course-scoped entities
- FR12: System supplements course content from web search when user documents provide insufficient coverage
- FR13: System pre-fetches the next section (N+1) while the user works on the current section
- FR14: User can open the next available section in a course
- FR15: User can view section content in the format selected by the AI (quiz, flashcard, audio, text, or blend)
- FR16: User can override the AI-selected content format for a section
- FR17: User can complete a section by finishing all content blocks (prime, explain, practice, reinforce)
- FR18: User can view their accuracy score for each section's practice component
- FR19: System classifies section content by knowledge type and selects the optimal format
- FR20: System generates audio primers that reference the user's own notes and documents
- FR21: System adjusts the next section's practice density based on previous section performance
- FR22: User can view section-level completion status for each course
- FR23: User can view concept mastery indicators per section
- FR24: User can view an overall course progress percentage
- FR25: User can view a daily streak counter
- FR26: User can use a streak freeze to protect their streak
- FR27: System tracks quiz and flashcard success rates per section to inform adaptive pacing
- FR28: System extracts key concepts from completed sections and creates review items (fast-follow)
- FR29: User can complete a daily review session surfacing items from all courses based on SM-2 scheduling (fast-follow)
- FR30: User can rate recall quality for each review item (fast-follow)
- FR31: System schedules review items at increasing intervals based on recall quality ratings (fast-follow)
- FR32: System enforces a configurable daily review cap to prevent review debt (fast-follow)
- FR33: System prioritizes review items closest to their forgetting threshold (fast-follow)
- FR34: User can complete a minimum viable review session (fast-follow)
- FR35: User can flag a quiz question, flashcard, or explanation as incorrect
- FR36: User can edit a flagged item inline
- FR37: System removes flagged items from the review queue until corrected
- FR38: System tracks content flag rates per course as a quality metric
- FR39: User can connect their Google Calendar via OAuth (fast-follow)
- FR40: User can set preferred learning times and session durations (fast-follow)
- FR41: System creates time-blocked calendar events with deep links to the next session (fast-follow)
- FR42: System composes sessions by time of day (fast-follow)
- FR43: System auto-reschedules missed sessions to the next available slot (fast-follow)
- FR44: User can disconnect their calendar and remove all created events (fast-follow)
- FR45: User can access completed sections offline including all section content (fast-follow)
- FR46: User can retake quizzes and practice flashcards within completed sections while offline (fast-follow)
- FR47: System queues offline attempt data with original timestamps and syncs on reconnect (fast-follow)
- FR48: User can see a clear "available offline" indicator per section (fast-follow)

### Non-Functional Requirements

- NFR1: Course outline generation completes within 15 seconds (document-based) / 20 seconds (web-sourced)
- NFR2: JIT section generation completes within 30 seconds (text+quiz+flashcards) + 30s (audio)
- NFR3: Pre-fetched sections load instantly (<500ms)
- NFR4: Daily review session loads within 2 seconds
- NFR5: Course list and progress dashboard render within 500ms
- NFR6: Offline sections load within 2 seconds
- NFR7: Page transitions within Learn module within 300ms
- NFR8: Per-user course isolation at Convex query level
- NFR9: Calendar OAuth tokens server-side only
- NFR10: Web search supplementation does not persist raw web content
- NFR11: Offline cached content encrypted at rest
- NFR12-15: Scalability (100+ concurrent generations, 1000+ review items, cost tracking, TTS queuing)
- NFR16-19: Accessibility (WCAG 2.1 AA, transcripts, keyboard shortcuts, text alternatives)
- NFR20-25: Integration (reuse existing APIs, Calendar API v3, graceful engine degradation)
- NFR26-29: Reliability (zero data loss, offline survival, calendar consistency, SR accuracy)

### Additional Requirements (Architecture)

- Course-scoped entities use `courseScoped` flag on existing quiz/flashcard/audio tables — not new parallel tables
- Section orchestration dispatches 4 engines in parallel via tasks system
- N+1 pre-fetch triggers automatically on section completion
- Web supplementation uses AI Gateway + search-capable LLM, not a dedicated search API
- Content-type classification happens during outline generation via LLM
- SM-2 algorithm uses modified parameters: easeFactor default 2.5, quality mapping Again=0, Hard=3, Good=4, Easy=5
- Offline uses Service Worker + IndexedDB + Cache API with last-write-wins sync
- Calendar uses Google Calendar API v3 with server-side OAuth and Convex-stored encrypted tokens

### UX Design Requirements

- UX-DR1: Learn Home empty state with "What do you want to learn?" hero input — zero-friction cold-start
- UX-DR2: Learn Home active state with Daily Review CTA card, course grid, streak display
- UX-DR3: Course Creator with source selection step and outline editor with drag-to-reorder
- UX-DR4: Course View with section list, mastery badges (new/learning/reviewing/mastered), progress bar
- UX-DR5: Section Void — distraction-free content blocks (audio primer, text, quiz practice, flashcard reinforcement)
- UX-DR6: Section completion card with accuracy, mastery level, and navigation
- UX-DR7: Daily Review session — large centered card, tap-to-reveal, 4-button recall rating (Again/Hard/Good/Easy)
- UX-DR8: Streak display (flame icon, counter, freeze indicator) — progress signal, not pressure
- UX-DR9: Mastery badge system — color-coded dots (gray=new, amber=learning, gold=reviewing, green=mastered)
- UX-DR10: Source confidence indicator — "Draws from N documents" vs "Built from web sources"
- UX-DR11: Pace selector dropdown with 3 presets (Intensive/Steady/Relaxed) and descriptions
- UX-DR12: Content flag flow — inline "Flag as incorrect" with correction editor
- UX-DR13: Mobile responsive variants for Learn Home, Section Void, Daily Review
- UX-DR14: Learn-specific keyboard shortcuts (Space=reveal, 1-4=rate, arrows=navigate, f=flag)
- UX-DR15: Learn tab in folder shell tab bar alongside Chat, Flashcards, Quiz, Documents

### FR Coverage Map

- FR1, FR2, FR3, FR12: Epic 1 — Course Creation
- FR4, FR5, FR6, FR7, FR8: Epic 1 — Course Creation
- FR9, FR10, FR11: Epic 2 — Learn Navigation & Management
- FR13, FR14, FR15, FR16, FR17, FR19, FR20, FR21: Epic 3 — Section Learning
- FR18, FR22, FR23, FR24, FR25, FR26, FR27: Epic 4 — Progress & Mastery
- FR35, FR36, FR37, FR38: Epic 4 — Progress & Mastery
- FR28, FR29, FR30, FR31, FR32, FR33, FR34: Epic 5 — Spaced Repetition (fast-follow)
- FR39, FR40, FR41, FR42, FR43, FR44: Epic 6 — Calendar Integration (fast-follow)
- FR45, FR46, FR47, FR48: Epic 7 — Offline Access (fast-follow)

## Epic List

### Epic 1: Course Creation & Outline Generation
Users can create structured courses from their knowledge base documents, cross-folder selections, or topics — and customize the AI-generated outline before starting to learn.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR12
**UX-DRs covered:** UX-DR1, UX-DR3, UX-DR10, UX-DR11

### Epic 2: Learn Navigation & Course Management
Users can browse, access, and manage their courses from both the top-level Learn section and within folders.
**FRs covered:** FR9, FR10, FR11
**UX-DRs covered:** UX-DR2, UX-DR15

### Epic 3: Section Learning Experience
Users can work through course sections with multi-format content (audio, text, quizzes, flashcards) that adapts based on knowledge type and performance.
**FRs covered:** FR13, FR14, FR15, FR16, FR17, FR19, FR20, FR21
**UX-DRs covered:** UX-DR5, UX-DR6

### Epic 4: Progress Tracking, Mastery & Content Quality
Users can track their learning progress with mastery indicators, streaks, and accuracy scores — and flag incorrect content for correction.
**FRs covered:** FR18, FR22, FR23, FR24, FR25, FR26, FR27, FR35, FR36, FR37, FR38
**UX-DRs covered:** UX-DR4, UX-DR8, UX-DR9, UX-DR12

### Epic 5: Spaced Repetition (Fast-Follow)
Users can complete daily review sessions with SM-2-scheduled items drawn from all courses, with configurable limits and priority ordering.
**FRs covered:** FR28, FR29, FR30, FR31, FR32, FR33, FR34
**UX-DRs covered:** UX-DR7, UX-DR14

### Epic 6: Calendar Integration (Fast-Follow)
Users can connect Google Calendar to schedule time-blocked learning sessions with adaptive composition and auto-rescheduling.
**FRs covered:** FR39, FR40, FR41, FR42, FR43, FR44

### Epic 7: Offline Access (Fast-Follow)
Users can access completed sections offline, retake quizzes and flashcards, and sync attempts on reconnect.
**FRs covered:** FR45, FR46, FR47, FR48
**UX-DRs covered:** UX-DR13

---

## Epic 1: Course Creation & Outline Generation

Users can create structured courses from their knowledge base documents, cross-folder selections, or topics — and customize the AI-generated outline before starting to learn.

### Story 1.1: Convex Schema — Course Tables

As a developer,
I want the course data model created in Convex,
So that all course features have a data foundation.

**Acceptance Criteria:**

**Given** the Convex schema exists
**When** the migration runs
**Then** `courses`, `courseSections`, `courseSourceDocs`, and `learnProfile` tables are created with all fields, indexes, and validators as specified in the architecture document
**And** the `courseScoped` optional boolean field is added to `quizzes`, `flashcardRooms`, and `audioOverviews` tables
**And** existing folder-tab queries for quizzes, flashcards, and audio overviews filter out `courseScoped === true` entities

### Story 1.2: Course Creation API — Folder & Cross-Folder Sources

As a user,
I want to create a course by selecting documents from my folders,
So that I can learn from my existing knowledge base materials.

**Acceptance Criteria:**

**Given** the user has documents in one or more folders
**When** the user selects source folders/documents and submits course creation
**Then** a `courses` record is created with `sourceType: 'folder'` or `'cross-folder'`
**And** `courseSourceDocs` records link the course to selected documents
**And** the course status is `'generating'`
**And** a task is created for outline generation

### Story 1.3: Course Creation API — Web-Only (Cold Start)

As a user,
I want to create a course from a topic with no documents,
So that I can start learning immediately without uploading anything.

**Acceptance Criteria:**

**Given** the user has no documents or wants a web-sourced course
**When** the user enters a topic (e.g., "React hooks") and submits
**Then** a `courses` record is created with `sourceType: 'web-only'`
**And** the web supplementation pipeline generates content from web sources via AI Gateway
**And** the course proceeds to outline generation

### Story 1.4: Outline Generation Pipeline

As a user,
I want the AI to generate a structured course outline from my sources,
So that I have a clear learning path before starting.

**Acceptance Criteria:**

**Given** a course has been created with sources selected
**When** the outline generation task runs
**Then** the LLM analyzes source documents (via RAG) and/or web content
**And** generates 5-15 sections ordered by dependency
**And** each section has a title, description, and knowledgeType classification (factual/conceptual/procedural/mixed)
**And** the outline is stored in `courses.outlineSections`
**And** corresponding `courseSections` records are created with status `'locked'`
**And** the source confidence indicator is calculated (docCount, webPercent)
**And** outline generation completes within 15s (document-based) or 20s (web-sourced)

### Story 1.5: Outline Editor UI

As a user,
I want to review and edit the AI-generated outline before starting,
So that I can customize my learning path.

**Acceptance Criteria:**

**Given** an outline has been generated for a course
**When** the user views the outline editor
**Then** sections are displayed as a draggable list with drag handles, titles, knowledge type badges, and remove buttons
**And** the user can drag sections to reorder them
**And** the user can click a section title to edit it inline
**And** the user can click a knowledge type badge to cycle through types (factual/conceptual/procedural/mixed)
**And** the user can remove a section with the X button
**And** the user can add a new section with "+ Add Section"
**And** the source confidence indicator is displayed at the top
**And** reorder/remove/add operations update the `courseSections` and `courses.outlineSections` in Convex

### Story 1.6: Pace Selector & Course Start

As a user,
I want to set my learning pace and start the course,
So that the system adapts to my schedule.

**Acceptance Criteria:**

**Given** the user has reviewed and optionally edited the outline
**When** the user selects a pace (Intensive/Steady/Relaxed) and clicks "Start Learning"
**Then** the pace is stored in `courses.pace`
**And** the first section's status changes from `'locked'` to `'generating'`
**And** section generation is triggered for Section 1
**And** the user is navigated to the course view
**And** the user can change pace at any time from the course view, updating `courses.pace`

### Story 1.7: Course Creator UI — Full Flow

As a user,
I want a polished course creation experience,
So that creating a course feels simple and inviting.

**Acceptance Criteria:**

**Given** the user clicks "Create Course" or enters a topic on the Learn Home empty state
**When** the course creator opens
**Then** Step 1 shows a topic input field AND folder/document selector with checkboxes
**And** a "Supplement from web" toggle is available
**And** clicking "Generate Outline" shows a skeleton loading state with "Analyzing your materials..." caption
**And** Step 2 shows the outline editor (Story 1.5) with pace selector (Story 1.6)
**And** the full flow works on mobile with full-width stacked layout

---

## Epic 2: Learn Navigation & Course Management

Users can browse, access, and manage their courses from both the top-level Learn section and within folders.

### Story 2.1: Learn Home Page — Empty & Active States

As a user,
I want a Learn home page showing all my courses,
So that I can quickly access any course or start a new one.

**Acceptance Criteria:**

**Given** the user navigates to `/app/learn/`
**When** the page loads
**Then** if no courses exist: the empty state hero is shown with "What do you want to learn?" topic input and "Create from your folders" link
**And** if courses exist: a grid of course cards is displayed with title, progress bar, section count, and pace badge
**And** a dashed "+ Create Course" card appears at the end of the grid
**And** the streak display shows in the header area (if streak > 0)
**And** on mobile: cards stack single-column with bottom tab navigation

### Story 2.2: Folder-Scoped Learn Tab

As a user,
I want to access courses scoped to a folder from within that folder,
So that my learning stays organized by subject.

**Acceptance Criteria:**

**Given** the user is in a folder view (e.g., `/app/folders/[id]/`)
**When** the Learn tab is visible in the folder tab bar
**Then** clicking Learn shows courses created from that folder's documents
**And** the "+ Create Course" action pre-selects the current folder's documents
**And** the Learn tab appears alongside Chat, Flashcards, Quiz, and Documents tabs

### Story 2.3: Course Deletion

As a user,
I want to delete a course and all its associated content,
So that I can clean up courses I no longer need.

**Acceptance Criteria:**

**Given** the user is on a course view
**When** the user clicks "Delete Course"
**Then** a confirmation dialog appears warning that all sections, course-scoped quizzes, flashcards, and audio will be deleted
**And** on confirmation: the course, all courseSections, courseSourceDocs, and all course-scoped entities (quizzes, flashcards, audio with `courseScoped: true`) are deleted
**And** associated review items (if SR is active) are deleted
**And** associated calendar events (if calendar is connected) are removed
**And** the user is navigated back to Learn Home

---

## Epic 3: Section Learning Experience

Users can work through course sections with multi-format content that adapts based on knowledge type and performance.

### Story 3.1: Section Generation Pipeline — Multi-Engine Orchestration

As a user,
I want each section to be generated with the right mix of content,
So that I learn each topic in the most effective format.

**Acceptance Criteria:**

**Given** a section's status is changed to `'generating'`
**When** the section generation task runs
**Then** the system classifies the content type from the outline and source documents
**And** dispatches engines in parallel: text explanation (LLM), quiz questions (`/api/quiz/generate` with `courseScoped: true`), flashcards (`/api/flashcards/generate` with `courseScoped: true`), audio primer (`/api/audio-overview/generate` adapted for short-form with `courseScoped: true`)
**And** assembles `contentBlocks` array from engine responses ordered as: audio (prime) → text (explain) → quiz (practice) → flashcard (reinforce)
**And** content format selection follows knowledge type: factual → more flashcards, conceptual → audio + quiz, procedural → walkthrough + sequencing
**And** section status updates to `'ready'` when generation completes
**And** if an individual engine fails, the section still delivers remaining formats with an inline notification
**And** section generation completes within 30s (text+quiz+flashcards) + 30s additional if audio is included (NFR2)
**And** all generated UI meets WCAG 2.1 AA compliance (NFR16)

### Story 3.2: N+1 Section Pre-Fetch

As a user,
I want the next section ready when I finish the current one,
So that I never wait between sections.

**Acceptance Criteria:**

**Given** the user is working on section N
**When** section N is opened or being completed
**Then** the system checks if section N+1 has a generation task
**And** if not, creates a task for N+1 generation
**And** if a previous N+1 task failed, retries once
**And** pre-fetches only 1 section ahead (not N+2) to limit cost
**And** when the user advances to N+1 and it's ready, it loads instantly (<500ms)

### Story 3.3: Section Void UI — Content Block Rendering

As a user,
I want to view and interact with section content in a focused void,
So that I can learn without distractions.

**Acceptance Criteria:**

**Given** the user opens a ready section
**When** the section void renders
**Then** a minimal top bar shows: back arrow, course title (muted), section title (centered), block progress [n/m], thin amber progress bar
**And** content blocks render sequentially: audio primer (compact player with waveform + transcript), text (markdown body with source references), quiz (embedded questions with immediate per-question feedback), flashcard (horizontal scrollable strip)
**And** each content block type dispatches to the appropriate component (existing QuizTakingView, FlashcardPractice, AudioPlayer adapted for embedded use)
**And** the user can advance through blocks and a "Next" button appears after the last block
**And** on mobile: audio player spans full width, quiz options stack vertically with 48px min touch targets, flashcards become full-width swipeable
**And** all section UI meets WCAG 2.1 AA compliance — keyboard navigation, screen reader support, 4.5:1 contrast (NFR16)

### Story 3.4: Section Completion & Adaptive Pacing

As a user,
I want feedback when I complete a section and adaptive difficulty going forward,
So that I know how I'm doing and the course adjusts to my level.

**Acceptance Criteria:**

**Given** the user finishes the last content block in a section
**When** the section completion card appears
**Then** it shows: accuracy percentage, mastery level, and count of concepts added to review queue
**And** two action buttons: "Continue to Section N+1" (primary) and "Back to Course Overview" (ghost)
**And** section status updates to `'completed'` with `practiceScore` and `masteryLevel` saved
**And** if accuracy < 60%: the completion card shows adaptive feedback text and the next section's generation parameters increase foundational practice items
**And** if accuracy > 90%: the next section reduces practice block size
**And** the user can override the AI content format for the next section (FR16)

### Story 3.5: Audio Primer Generation — User Note References

As a user,
I want audio primers that reference my own notes,
So that the learning feels personalized and grounded in my materials.

**Acceptance Criteria:**

**Given** a section is being generated with an audio content block
**When** the audio primer is generated
**Then** the LLM script references the user's specific documents and passages (e.g., "In your Lecture 7 notes, you have a diagram comparing...")
**And** the audio is generated as a short-form (2-3 minute) single or dual-host clip using the existing audio overview pipeline with `courseScoped: true`
**And** a text transcript is displayed below the audio player
**And** the audio primer block includes source attribution

---

## Epic 4: Progress Tracking, Mastery & Content Quality

Users can track their learning progress with mastery indicators, streaks, and accuracy scores — and flag incorrect content.

### Story 4.1: Course View with Progress & Mastery Dashboard

As a user,
I want to see my progress through a course with mastery indicators per section,
So that I know what I've learned and what's next.

**Acceptance Criteria:**

**Given** the user navigates to a course view
**When** the page loads
**Then** a progress bar shows overall course completion percentage
**And** the section list shows each section with its status: completed (checkmark + mastery badge), current (amber left border + arrow), locked (lock icon + muted text)
**And** mastery badges are color-coded: gray dot = new, amber dot = learning, gold dot = reviewing, green checkmark = mastered
**And** the user can click a completed section to revisit it
**And** action buttons appear at bottom: "Edit Outline" (ghost), "Change Pace" (ghost), "Delete Course" (destructive)
**And** on mobile: mastery badges show as right-aligned dots without text labels, actions move to a three-dot menu

### Story 4.2: Mastery Level State Machine

As a user,
I want my mastery level per section to reflect my actual understanding,
So that I can trust the progress indicators.

**Acceptance Criteria:**

**Given** a section has been completed
**When** the mastery level is calculated
**Then** transitions follow: new → learning (section completed with any score), learning → reviewing (reviewed at ≥70%), reviewing → mastered (3 consecutive reviews at ≥80%), mastered → reviewing (review item failed), any → learning (section retaken)
**And** the system tracks quiz and flashcard success rates per section to drive these transitions

### Story 4.3: Streak System

As a user,
I want to see my daily learning streak,
So that I can build a consistent study habit.

**Acceptance Criteria:**

**Given** the user completes any section in any course OR any review session in a calendar day (user's timezone)
**When** the streak is evaluated
**Then** the user-level streak counter (in `learnProfile`) increments if the last streak date was yesterday, or stays the same if it was today
**And** the streak resets to 1 if more than 1 day has passed (unless a freeze was used)
**And** the streak display shows: flame icon (amber when active, dim when frozen) + counter + "days"
**And** the streak freeze: one free per week (resets Monday), consuming a freeze prevents streak break for one missed day
**And** when a streak breaks: no guilt message, counter simply resets to 0
**And** streak data is stored in `learnProfile` table fields: `streakCurrent`, `streakLastDate`, `streakFreezeAvailable`, `streakFreezeUsedAt`
**And** if the `learnProfile` record doesn't exist for this user, it is created on first section completion or review

### Story 4.4: Content Flagging & Correction

As a user,
I want to flag incorrect quiz answers or flashcards and correct them,
So that my learning materials stay accurate.

**Acceptance Criteria:**

**Given** the user sees an incorrect item in a section or review session
**When** the user taps "Flag as incorrect"
**Then** an inline editor opens allowing the user to correct the answer/explanation
**And** on save: the correction is stored, the item's `flagged` field is set to `true`, and the `correctedAnswer` is saved
**And** flagged items are excluded from the review queue until corrected
**And** the system tracks flag rates per course as a quality metric
**And** corrections propagate immediately — the user sees the corrected version on next encounter

---

## Epic 5: Spaced Repetition (Fast-Follow)

Users can complete daily review sessions with SM-2-scheduled items drawn from all courses.

### Story 5.1: Review Item Extraction & SM-2 Data Model

As a user,
I want key concepts from completed sections to enter my review queue,
So that I retain what I've learned over time.

**Acceptance Criteria:**

**Given** a section is marked completed
**When** the reinforcement block (flashcards) from that section is processed
**Then** review items are created in the `reviewItems` table with: prompt, answer, initial SM-2 parameters (easeFactor: 2.5, interval: 1, repetitions: 0), nextReviewDate set to tomorrow
**And** each review item links to its courseId and sectionId
**And** flagged items have `flagged: true` and are excluded from review scheduling

### Story 5.2: Daily Review Session UI

As a user,
I want a focused daily review session,
So that I can reinforce my learning in a few minutes.

**Acceptance Criteria:**

**Given** the user navigates to `/app/learn/review` or clicks the Daily Review CTA
**When** the review session loads
**Then** items are queried where `nextReviewDate <= today`, ordered by nextReviewDate ASC (most overdue first), limited by daily cap (default 50)
**And** items are presented one at a time as large centered cards with the prompt
**And** "Tap to reveal" shows the answer
**And** after reveal: 4 rating buttons appear (Again/Hard/Good/Easy) color-coded (red/amber/green/teal)
**And** source attribution shows below the card ("From: Course Name, Section N")
**And** "Flag as incorrect" link appears below rating buttons
**And** progress bar and item count (n/m) update as the user progresses
**And** keyboard shortcuts: Space=reveal, 1=Again, 2=Hard, 3=Good, 4=Easy, f=flag
**And** on mobile: card spans full width, rating buttons span full width at 48px height

### Story 5.3: SM-2 Scheduling Engine

As a user,
I want the review system to show me items at optimal intervals,
So that I remember what I've learned without wasting time on easy items.

**Acceptance Criteria:**

**Given** the user rates a review item
**When** the rating is submitted
**Then** SM-2 parameters update: Again (quality 0) resets interval to 1 and repetitions to 0; Hard (quality 3) multiplies interval by 1.2; Good (quality 4) multiplies interval by easeFactor; Easy (quality 5) multiplies interval by easeFactor × 1.3
**And** easeFactor adjusts based on quality: max(1.3, easeFactor + 0.1 - (5-quality) × (0.08 + (5-quality) × 0.02))
**And** nextReviewDate is set to today + new interval (in days)
**And** the scheduling calculation runs in `server/utils/sr-scheduler.ts` as pure functions

### Story 5.4: Cross-Course Review Budgeting

As a user,
I want my daily review to be manageable even with multiple courses,
So that I don't get overwhelmed by review debt.

**Acceptance Criteria:**

**Given** the user has review items from multiple courses
**When** the daily review session loads
**Then** items are drawn from all courses in a single priority queue (most overdue first)
**And** a configurable daily cap (default 50) limits the session size
**And** a "minimum viable review" option allows completing just the top 5-10 highest-priority items (~2-3 min)
**And** if the review backlog exceeds 2× the daily cap, a warning appears during course creation: "You have a growing review backlog. Consider completing reviews before starting new courses."

### Story 5.5: Review Session Completion & Daily Review CTA

As a user,
I want to see my review results and have easy access to daily review,
So that review becomes part of my routine.

**Acceptance Criteria:**

**Given** the user completes a review session
**When** the session ends
**Then** a completion card shows: items reviewed, correct count, streak update
**And** a `reviewSessions` record is created with date, itemsReviewed, itemsCorrect, durationMs
**And** the streak is updated if this is the first review of the day
**And** the Daily Review CTA card on Learn Home shows item count and estimated duration
**And** the CTA disappears when no items are due

---

## Epic 6: Calendar Integration (Fast-Follow)

Users can connect Google Calendar to schedule time-blocked learning sessions.

### Story 6.1: Google Calendar OAuth Connection

As a user,
I want to connect my Google Calendar,
So that the system can schedule learning sessions for me.

**Acceptance Criteria:**

**Given** the user is on Learn settings or calendar connection screen
**When** the user clicks "Connect Google Calendar"
**Then** the OAuth consent screen requests `calendar.events` scope with `offline_access`
**And** on successful auth: access token and refresh token are stored encrypted in `calendarConnections` table
**And** the user's timezone is detected and stored
**And** the connection status is shown as "Connected" with a "Disconnect" option

### Story 6.2: Learning Session Preferences

As a user,
I want to set my preferred learning times and session lengths,
So that calendar events fit my schedule.

**Acceptance Criteria:**

**Given** the user has connected their calendar
**When** they set preferences
**Then** they can configure: morning start time, evening end time, preferred session length (5/10/15/25 min), preferred days of week
**And** preferences are stored in `calendarConnections.preferences`

### Story 6.3: Calendar Event Creation & Adaptive Composition

As a user,
I want time-blocked events created in my calendar with the right session type,
So that I show up and the session is ready.

**Acceptance Criteria:**

**Given** the user has a connected calendar and active courses
**When** the calendar sync runs (via `/api/calendar/sync.post`)
**Then** events are created in Google Calendar with title `[Budds] {course_name} - {session_type}`, description including session composition and deep link
**And** morning events (before 12:00 user timezone) favor new content, evening events favor review, commute-length slots (≤15 min) get audio-only
**And** `calendarEvents` records track each event's calendarEventId, scheduledAt, sessionType, status

### Story 6.4: Missed Session Rescheduling

As a user,
I want missed sessions to be automatically rescheduled,
So that I don't fall behind.

**Acceptance Criteria:**

**Given** a scheduled session was missed (scheduledAt < now AND status = 'scheduled')
**When** the hourly Convex scheduled function runs
**Then** the missed event is marked `'missed'`
**And** a new event is created at the next available slot based on user preferences
**And** the new event is marked `'rescheduled'`

### Story 6.5: Calendar Disconnection & Cleanup

As a user,
I want to disconnect my calendar and remove all events,
So that I can stop calendar integration cleanly.

**Acceptance Criteria:**

**Given** the user clicks "Disconnect" on their calendar connection
**When** disconnection is confirmed
**Then** all `calendarEvents` for this user are deleted from Google Calendar via the API
**And** the `calendarConnections` record is deleted (tokens removed)
**And** the connection UI resets to the "Connect" state

---

## Epic 7: Offline Access (Fast-Follow)

Users can access completed sections offline and retake quizzes and flashcards.

### Story 7.1: Service Worker & Offline Detection

As a user,
I want to know when I'm offline and still access my content,
So that I can study anywhere.

**Acceptance Criteria:**

**Given** the app has a registered service worker
**When** the device loses connectivity
**Then** a subtle top banner appears: "You're offline. Completed sections are available." (warm amber at 10% opacity)
**And** when connectivity restores, the banner fades without notification
**And** the service worker intercepts navigation to cached section routes

### Story 7.2: Section Content Caching

As a user,
I want completed sections automatically cached for offline access,
So that I can review them without internet.

**Acceptance Criteria:**

**Given** a section is marked completed
**When** completion is recorded
**Then** section content (text blocks, quiz questions/answers, flashcard terms/definitions) is stored in IndexedDB keyed by sectionId
**And** audio files are cached in Cache API
**And** the section's `offlineAvailable` field is set to true
**And** in the course view, a download icon indicates cached (filled) vs not cached (outlined) for each section
**And** cached content loads within 2 seconds from browser storage

### Story 7.3: Offline Retakes & Sync

As a user,
I want to retake quizzes and practice flashcards offline and have my progress sync when I reconnect,
So that my learning isn't interrupted by connectivity.

**Acceptance Criteria:**

**Given** the user is offline and opens a cached completed section
**When** the user retakes a quiz or practices flashcards
**Then** attempt data is written to an IndexedDB `offlineAttempts` queue with original timestamps
**And** when connectivity restores, a background sync task reads the queue, sends attempts to Convex mutations, and clears the queue
**And** if the same review item was reviewed online and offline, the most recent attempt (by timestamp) wins
**And** sync data loss is < 1%
**And** offline attempt data survives app close and device restart
