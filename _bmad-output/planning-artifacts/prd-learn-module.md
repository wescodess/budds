---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
classification:
  projectType: web_app
  domain: edtech
  complexity: medium
  projectContext: brownfield
inputDocuments:
  - product-brief-learn-module.md
  - product-brief-learn-module-distillate.md
  - product-brief-budds.md
  - product-brief-budds-distillate.md
  - prd.md
  - project-context.md
  - docs/index.md
  - docs/architecture.md
  - docs/api-contracts.md
  - docs/data-models.md
documentCounts:
  briefs: 4
  research: 0
  brainstorming: 0
  projectDocs: 5
  projectContext: 1
workflowType: 'prd'
---

# Product Requirements Document - Budds Learn Module

**Author:** palmwine
**Date:** 2026-04-22

## Executive Summary

Budds turns raw study materials into AI-powered learning outputs — chat answers with source citations, quizzes, flashcards, and podcast-style audio overviews. Each feature works well independently. What's missing is the orchestration layer that connects them into a structured, adaptive learning journey.

The Learn module is that layer. Users select materials from their knowledge base — or type a topic from scratch — and the system generates a structured course of 5-15 sections. Only the next section is generated, adapting to the learner's performance. Each section curates the optimal content format for its knowledge type: flashcards for factual recall, audio primers plus application quizzes for conceptual understanding, walkthroughs for procedural knowledge. Completed concepts feed a spaced repetition system. Calendar integration creates time-blocked study slots.

This is not a new product. It's wiring together four content engines (RAG chat, quiz generation, flashcard generation, audio overview generation) that are already battle-tested in production. Competitors would need to build all four before attempting orchestration.

### What Makes This Special

No existing product combines all five pillars: (1) AI course generation from the user's own documents, (2) adaptive just-in-time section delivery, (3) multi-format curation per section, (4) hidden spaced repetition with SM-2 quality, and (5) calendar-native time-blocked scheduling. NotebookLM does passive synthesis. Quizlet can't ingest raw documents. Anki has gold-standard SR but brutal UX. The gap between "I have materials" and "I learned them" is a workflow problem — Learn solves it by orchestrating existing primitives into a curriculum engine.

The zero-friction entry point is the most powerful onboarding moment: a user types "teach me TypeScript generics" and gets a structured course in seconds with no uploads required.

## Project Classification

- **Project Type:** Web application (Nuxt 4 full-stack, SSR/SPA)
- **Domain:** EdTech (learning, student knowledge management, AI-assisted study)
- **Complexity:** Medium (FERPA awareness, accessibility, AI content accuracy, multi-subsystem orchestration)
- **Project Context:** Brownfield — adding to an existing production app with 18 Convex tables, mature RAG pipeline (Cloudflare AI Search), quiz engine (4 question types, attempt lifecycle), flashcard room system (versioned, editor/practice modes), and audio overview generation (two-host TTS with interjections)

## Success Criteria

### User Success

- **First-value speed:** User creates a course and completes first section within 10 minutes of first interaction with Learn
- **Engagement depth:** 40% of started courses reach section 3+ (proving JIT model sustains engagement beyond novelty)
- **Learning habit:** 25% of Learn users complete daily review sessions 3+ days per week within first month
- **Content trust:** <5% of AI-generated quiz/flashcard items flagged as incorrect by users
- **Pace satisfaction:** 80%+ of users who set a pace preset do not change it within the first week (indicating presets match expectations)

### Business Success

- **Adoption:** 20% of active users (defined as users with at least one generation action in trailing 30 days) create at least one course within 30 days of Learn launch
- **Retention lift:** Users with active courses show 40% higher week-4 retention vs non-Learn users
- **Calendar adoption:** 15% of Learn users connect Google Calendar and maintain scheduled sessions for 2+ weeks
- **Feature pull-through:** 30% of Learn users who previously only used one feature (chat OR quiz OR flashcards) begin using multiple features through course sections

### Technical Success

- **Section generation latency:** JIT section generation completes within 30 seconds; N+1 pre-fetch ensures zero wait between sections during normal flow
- **Offline reliability:** Completed sections load offline within 2 seconds; offline retake attempts sync with <1% data loss on reconnect
- **SR algorithm accuracy:** Review items surface within 10% of optimal SM-2 intervals; no review debt accumulation beyond 2x daily cap
- **Cost efficiency:** Average AI generation cost per course (outline + all sections) sustainable at target pricing; tracked from launch

### Measurable Outcomes

| Metric | Target | Timeframe |
|---|---|---|
| Active users creating a course | 20% | 30 days post-launch |
| Courses reaching section 3+ | 40% | Ongoing |
| Week-4 retention lift (Learn vs non-Learn) | 40% higher | Rolling |
| Daily review habit (3+ days/week) | 25% of Learn users | 30 days post-launch |
| Calendar connection + 2-week maintenance | 15% of Learn users | 60 days post-launch |
| Content items flagged incorrect | <5% | Ongoing |
| Section generation time | <30 seconds | Ongoing |
| Offline sync data loss | <1% | Ongoing |

## Product Scope & Phased Development

### MVP Strategy

**Approach:** Problem-solving MVP — deliver the minimum feature set that turns "I have materials" into "I'm learning them systematically." If a user can create a course from their documents (or a topic), work through JIT sections with multi-format content, and track mastery progress, the core value proposition is validated.

**Resource Requirements:** Solo developer (palmwine) with existing Nuxt/Vue/Convex/Cloudflare expertise. The brownfield codebase eliminates infrastructure setup. Existing quiz, flashcard, and audio generation APIs can be reused with orchestration wrappers.

### Phase 1 — MVP: Core Learning Loop

**Core User Journeys Supported:**
- Journey 1 (Priya): Exam prep — folder materials into intensive course with daily sections
- Journey 2 (David): Self-directed — web-sourced course with steady pace
- Journey 3 (Maya): Cold-start — topic-only course as onboarding funnel

**Capabilities:**

| Capability | Status | Complexity |
|---|---|---|
| Course creation (folder-scoped, cross-folder, web-only) | Net-new | Medium |
| AI-generated course outlines (5-15 sections) | Net-new | High |
| User-editable outlines (reorder, remove, add sections) | Net-new | Low |
| Source confidence indicator | Net-new | Low |
| JIT section generation with content-type classification | Net-new | High |
| N+1 section pre-fetch via tasks system | Net-new | Medium |
| Multi-format section content (quiz, flashcard, audio, text) | Orchestration of existing | Medium |
| Section rhythm (prime → explain → practice → reinforce) | Net-new | Medium |
| Adaptive pacing (success rate thresholds) | Net-new | Medium |
| Section-level progress tracking | Net-new | Low |
| Concept mastery indicators (new → learning → reviewing → mastered) | Net-new | Medium |
| Streaks with streak freeze | Net-new | Low |
| Inline content flagging and correction | Net-new | Low |
| Pace control (intensive / steady / relaxed presets) | Net-new | Low |
| User format override per section | Net-new | Low |
| Top-level Learn route (`/app/learn/`) | Net-new | Low |
| Folder-scoped Learn (`/app/folders/[id]/learn/`) | Net-new | Low |
| Course-scoped entities (not visible in folder sidebar) | Net-new | Medium |
| Web search supplementation for course content | Net-new | High |

**Explicitly deferred from MVP:**
- Spaced repetition (fast-follow)
- Calendar integration (fast-follow)
- Offline access (fast-follow)
- Apple Calendar (V1.1)
- Difficulty branching (V1.1)
- AI-suggested courses (V1.1)
- Push notifications (V1.1)
- Course sharing (V1.2)

### Phase 2 — Fast-Follow: Retention & Scheduling

- SM-2-based spaced repetition with daily review sessions
- Cross-course review budgeting with configurable daily cap
- Priority queue (closest to forgetting threshold first)
- Minimum viable review option (2-3 min quick review)
- Google Calendar integration with OAuth
- Time-blocked calendar events with deep links
- Adaptive session composition by time of day
- Missed session auto-rescheduling
- Offline access to completed sections
- Local storage of section content with offline indicator
- Offline quiz/flashcard retakes with queued sync
- Original timestamp preservation on reconnect

### Phase 3 — V1.1: Intelligence & Reach

- Apple Calendar integration via CalDAV
- Difficulty branching (remedial sections auto-inserted when performance drops below threshold)
- AI-suggested courses based on knowledge base gap analysis
- Push notifications for review reminders and session starts

### Phase 4 — V1.2+: Growth & Social

- Course sharing with classmates
- Learning analytics dashboard (knowledge maps, study time, retention rates)
- Anki/Quizlet export
- LMS integration (Canvas, Blackboard) via LTI protocol
- Collaborative learning (study groups with shared progress)

### Risk Mitigation Strategy

**Technical Risks:**
- *AI generation latency* is the highest-impact UX risk. JIT sections may take 15-60s especially with audio TTS. Mitigation: N+1 pre-fetch via existing tasks system while user works on current section; skeleton loading states for section transitions.
- *Knowledge type classification* accuracy determines whether sections use optimal content formats. Misclassification produces shallow learning (flashcards for conceptual material). Mitigation: AI selects format with user override available; fallback to mixed-format for ambiguous content.
- *AI content accuracy* — wrong quiz answers or flashcards compound through spaced repetition. Mitigation: inline flagging/correction per item; track flag rate (<5% target); corrections propagate immediately.
- *Cost scaling* — each course triggers multiple AI calls (outline, per-section content, quiz generation, flashcard generation, audio TTS). Mitigation: define cost budget per course; generation queuing; cache common web-sourced outlines.

**Market Risks:**
- *Google NotebookLM could extend into structured learning.* Mitigation: speed to market. Ship core loop, validate engagement, then layer retention mechanics. Estimated 12-18 month window.
- *Users may not create courses if ad-hoc generation feels sufficient.* Mitigation: surface Learn prominently alongside existing CTAs; cold-start "type a topic" entry point lowers commitment barrier.

**Resource Risks:**
- *Solo developer scope.* Mitigation: phased delivery (MVP → fast-follow → V1.1). Absolute minimum launch: course creation + outline + JIT sections + progress tracking. SR, calendar, and offline ship as fast-follow.

## User Journeys

### Journey 1: Priya — The Exam Crammer (Primary, Success Path)

Priya is a second-year biology major with her Organic Chemistry midterm in 10 days. She has 18 lecture PDFs already uploaded to her Budds folder from earlier in the semester. She's been using Budds for chat and one-off quizzes, but her study sessions feel scattered — a quiz here, some flashcards there, no structure.

She opens her Organic Chemistry folder and sees courses listed in the sidebar alongside her chats, quizzes, and flashcard sets. She taps "New Void" and selects "Course" to create one. The system already knows her folder contents — 18 documents covering reaction mechanisms, stereochemistry, spectroscopy, and thermodynamics. She sees a source confidence indicator: "This course draws from 18 of your documents."

Within 15 seconds, an AI-generated outline appears: 12 sections, ordered by dependency (functional groups → reaction mechanisms → stereochemistry → spectroscopy → synthesis problems). Priya notices stereochemistry is listed after spectroscopy — she knows her professor tests them in the opposite order. She drags stereochemistry above spectroscopy. She also removes the intro section on functional groups — she's solid on that. 11 sections remain.

She sets her pace to Intensive: 5-7 sections/week, daily review. The system suggests morning and evening calendar blocks but she hasn't connected her calendar yet — she'll do that later.

She opens Section 1: Reaction Mechanisms. The section starts with a 2-minute audio primer — two voices discussing the key concepts, referencing her own lecture slides: "In your Lecture 7 notes, you have a diagram comparing SN1 and SN2 mechanisms..." She listens while walking to the library.

At the library, the section transitions to an interactive explanation of nucleophilic substitution with worked examples pulled from her materials. Then practice: 5 quiz questions escalating in difficulty. She gets 4/5 — the system notes 80% accuracy (in the optimal zone) and marks Section 1 as complete with a "Strong" mastery indicator.

She opens Section 2 immediately — it's already loaded (pre-fetched while she was doing practice). No wait. Over the next 10 days, she completes all 11 sections. Her mastery dashboard shows green across reaction mechanisms and thermodynamics, yellow on stereochemistry. She reviews her flagged weak items the night before the exam. She scores an 88.

**Capabilities revealed:** Folder-scoped course creation, source confidence indicator, AI-generated outline with user editing (reorder, remove), pace presets (intensive), audio primers referencing user notes, multi-format sections (audio + explanation + quiz), mastery indicators, N+1 pre-fetch, section progress tracking.

### Journey 2: David — The Certification Learner (Primary, Alternate Path)

David is a 34-year-old project manager studying for AWS Solutions Architect. He has no documents in Budds — he's a new user evaluating the app.

He opens the Learn page and sees the CTA: "What do you want to learn?" He types "AWS Solutions Architect Associate" and selects "Create Course." No documents needed. The system searches the web, finds authoritative sources, and generates a course outline: 15 sections covering compute, storage, networking, security, databases, and cost optimization.

David reviews the outline. It looks comprehensive. He sets pace to Steady (2-3 sections/week) and starts Section 1: Cloud Fundamentals. The section notes "Built primarily from web sources" in a subtle indicator. The content is a text-and-quiz format — the system classified this as primarily factual content, so flashcards and fill-in-the-blank exercises dominate.

Over six weeks, David works through sections during his lunch break. His mastery dashboard shows strong conceptual understanding of compute and storage, but networking is flagged yellow. He spends extra time on the networking review items. After completing all 15 sections, his cumulative mastery score gives him confidence to book the exam.

**Capabilities revealed:** Cold-start web-sourced course (no upload required), topic-based course creation CTA, web search supplementation, source confidence indicator for web courses, pace presets (steady), factual content → flashcard-heavy sections, long-term mastery tracking across weeks.

### Journey 3: Maya — The Cold-Start Evaluator (Edge Case, Onboarding)

Maya is a computer science student who heard about Budds from a friend. She opens the app for the first time and sees Learn on the home screen. Without uploading anything, she types "React hooks" and creates a course.

A 7-section outline appears in 10 seconds. She opens Section 1: useState and useEffect. The section is interactive — short explanation, then a code-based quiz asking her to predict what a snippet will render. She gets 3/5.

The system adjusts: Section 2's practice portion has more foundational items and clearer explanations. Maya completes 3 sections in her first 20-minute session. She's impressed enough to upload her course materials for her data structures class and creates a second, document-based course.

**Capabilities revealed:** Zero-friction onboarding (no upload required), first-session engagement, adaptive pacing (adjusting difficulty based on <60% threshold), conversion from cold-start to document-based user, multi-course support.

### Journey 4: Priya — The Failed Generation (Edge Case, Error)

Priya creates a new course from a folder containing only 2 short documents. The system generates an outline, but it's only 3 sections — the material is too thin for a comprehensive course. The source confidence indicator shows: "Limited coverage — this course draws from 2 documents. Consider adding more materials or allowing web supplementation."

Priya enables web supplementation. The system regenerates the outline: now 8 sections, with indicators showing which sections rely on her documents vs web sources. Some web-sourced sections feel generic compared to her document-based ones — she flags two flashcards as inaccurate. The corrections apply immediately and the items are removed from her review queue.

**Capabilities revealed:** Thin-material handling, web supplementation toggle, source attribution per section, inline content flagging and correction, correction propagation to review queue, graceful degradation for insufficient source material.

### Journey 5: palmwine — The Solo Operator (Admin/Operations)

palmwine monitors Learn module adoption after launch. The Convex dashboard shows 45 courses created in the first week, with an average outline length of 9 sections. Course completion rate (section 3+) is at 38% — close to the 40% target.

Cost monitoring reveals that audio TTS generation is the most expensive per-section operation. Courses with audio primers cost 3x more than text-only sections. palmwine considers making audio primers opt-in per section rather than default, or limiting them to conceptual sections only.

One user created 8 courses simultaneously and accumulated a review backlog of 200+ items. The daily review cap prevented overwhelming sessions, but the user's mastery indicators are all declining because reviews can't keep pace with new content. palmwine notes this as a design consideration: should the system warn users when they're creating courses faster than they can review?

**Capabilities revealed:** Course analytics (creation rate, completion rate, section counts), cost monitoring per content type (audio vs text), review cap behavior under load, multi-course backlog detection, operational cost insights.

### Journey Requirements Summary

| Capability Area | Revealed By Journeys |
|---|---|
| Course creation (folder-scoped, web-only, topic-based) | Priya, David, Maya |
| AI-generated outlines with user editing | Priya, David |
| Source confidence indicators | Priya, David, Priya (error) |
| JIT section generation with N+1 pre-fetch | Priya |
| Multi-format content (quiz, flashcard, audio, text) | Priya, David |
| Adaptive pacing (success rate thresholds) | Maya |
| Pace presets (intensive, steady, relaxed) | Priya, David |
| Mastery indicators and progress tracking | Priya, David |
| Inline content flagging and correction | Priya (error) |
| Web search supplementation | David, Priya (error), Maya |
| Cold-start course creation (no documents) | David, Maya |
| Streaks | Priya, David |
| Multi-course support and review budgeting | palmwine |
| Course analytics and cost monitoring | palmwine |
| Audio primers from user notes | Priya |
| Content-type classification (factual vs conceptual) | David, Priya |
| Error handling for thin source material | Priya (error) |

## Domain-Specific Requirements

### Compliance & Regulatory

- **FERPA awareness:** Learn module inherits Budds' existing per-user document isolation. Course-scoped entities (quizzes, flashcards, audio) are user-private — never exposed to other users. Terms of service place responsibility for uploaded content on the user.
- **AI content accuracy disclaimer:** All AI-generated course content (quiz answers, flashcard definitions, explanations) carries an implicit accuracy disclaimer. Users can flag incorrect items. System does not guarantee factual accuracy of generated learning materials.
- **Data privacy:** Course data, progress, review history, and calendar connections are user-owned. Full account deletion removes all course data, review items, and calendar event references.

### Accessibility

- **WCAG 2.1 AA baseline:** All Learn module interfaces — course creation, section views, review sessions, progress dashboards — must meet keyboard navigation, screen reader compatibility, and contrast requirements.
- **Audio content accessibility:** Audio primers include text transcripts accessible alongside playback. Quiz and flashcard content is always available as text regardless of section format.
- **Review session accessibility:** Daily review sessions support keyboard-only navigation. Recall rating (again/hard/good/easy) accessible via keyboard shortcuts.

### Technical Constraints

- **Per-user isolation:** All course data, section content, and review items are user-scoped. The existing Convex per-user isolation pattern extends to all Learn module tables.
- **Existing API reuse:** Learn sections must generate content through existing server API endpoints (`/api/quiz/generate`, `/api/flashcards/generate`, `/api/audio-overview/generate`) with orchestration wrappers — not parallel implementations.
- **Web search provider:** Supplementary web content requires a search API separate from Cloudflare AI Search (which indexes user documents only). Provider selection is an architecture decision.

### Risk Mitigations

- **AI content compounding errors:** Wrong answers in spaced repetition get reinforced over weeks. Mitigation: inline flagging propagates corrections immediately; flagged items are excluded from review until corrected; flag rate tracked as quality metric.
- **Review debt across courses:** Students with 3-5 concurrent courses can accumulate review backlogs. Mitigation: configurable daily review cap; priority by forgetting threshold; minimum viable review session (2-3 min); system warns when course creation outpaces review capacity.
- **Source material quality variance:** Poorly organized notes produce worse courses than clean textbook chapters. Mitigation: source confidence indicators; web supplementation suggestions for thin material; transparency over false precision.

## Innovation & Novel Patterns

### Detected Innovation Areas

**Just-in-time adaptive section generation:** No learning platform generates course sections on-demand from a user's own knowledge base. Traditional courseware is pre-built and static. Duolingo adapts difficulty but from a fixed content pool. Learn generates fresh content for each section, informed by performance on previous sections. This enables true personalization — not just difficulty adjustment, but content format selection and source material weighting based on what works for each learner.

**Multi-engine orchestration from single RAG source:** A single semantic search index (Cloudflare AI Search) powers four distinct content generation engines (chat, quiz, flashcard, audio) through one pipeline. Learn orchestrates all four into a unified learning experience per section. This is architecturally distinct from combining separate tools — the integration is at the data layer, not the UI layer.

**Course-scoped entity model:** Quizzes, flashcards, and audio generated within a course are course-scoped — they exist in the course graph, not in the folder sidebar void list. This is a novel data architecture that separates ad-hoc generation (user-initiated, folder-visible) from orchestrated generation (system-curated, course-scoped). Both use the same underlying engines but serve different user intents.

### Market Context & Competitive Landscape

NotebookLM validated "learn from your docs" but stopped at passive consumption (summaries, audio). Quizlet has study tools but can't ingest raw documents and is alienating users with $36/yr paywalling. Anki has gold-standard SM-2 but dated UX and painful manual card creation. StudyFetch has basic calendar reminders but not intelligent time-blocked scheduling. No product combines all five pillars.

The AI tutors market is $2.1B (2025) growing to $17.7B by 2033 (30.5% CAGR). Students in AI-powered learning achieve 54% higher test scores. LLM inference costs dropped 80-90% in 18 months making consumer RAG viable.

### Validation Approach

- **Core loop validation:** Do users who complete 3+ sections retain better than users who do ad-hoc quizzes? A/B comparison of week-4 retention between Learn users and non-Learn active users.
- **Format selection validation:** Does AI content-type classification produce the right format for each section? Track user format override rate — high override rate indicates poor classification.
- **JIT vs pre-built validation:** Does JIT section generation produce better engagement than pre-generating all sections? Compare section 3+ completion rates between JIT and a hypothetical pre-built control.

### Innovation Risk Mitigation

- **Classification accuracy risk:** Content type classification determines section format. If classification is poor, all sections feel mediocre. Mitigation: user format override; fallback to mixed-format; track override rate as quality signal.
- **Orchestration complexity risk:** Coordinating four generation engines per section adds latency and failure modes. Mitigation: degrade gracefully (text-only section if audio TTS fails); N+1 pre-fetch absorbs latency; individual engine failures don't block section delivery.
- **Cold-start quality risk:** Web-sourced courses have higher quality variance than document-based. Mitigation: source confidence signals; quality thresholds on web results; curated fallback content for popular topics.

## Web Application Specific Requirements

### Project-Type Overview

The Learn module extends Budds' Nuxt 4 full-stack architecture. All Learn features live within the existing authenticated `/app/**` route space. The module adds new pages, composables, server API routes, and Convex tables while reusing the existing UI component library (shadcn-nuxt, Reka UI), design system (warm amber/gold, dark-mode-first), and infrastructure (Cloudflare AI Search, AI Gateway, Convex BaaS).

### Technical Architecture Considerations

**Rendering strategy:** Learn module pages use SPA-like navigation within the authenticated shell, consistent with existing app behavior. Course sections are the primary interaction surface — they must feel responsive with instant transitions (N+1 pre-fetch).

**Browser support:** Inherits existing browser matrix (Chrome, Safari, Firefox, Edge — last 2 versions). Mobile Chrome/Safari are high priority — students study on phones between classes.

**Responsive design priorities:**
- **Must work well on mobile:** Section views (reading, quizzes, flashcard review), daily review sessions, progress dashboard, course list
- **Desktop-optimized (functional on mobile):** Course creation, outline editing, mastery analytics
- **Desktop-only acceptable:** Operational monitoring (palmwine)

**Performance targets:** See NFR section for specific measurable requirements.

**Offline architecture:** Completed sections cached in browser storage (IndexedDB or Cache API). Offline retake attempts queued with original timestamps. Sync on reconnect via background service worker. Clear "available offline" indicator per section. New section generation always requires connectivity.

### Implementation Considerations

**State management:** Course state (current section, mastery indicators, review queue) managed via Convex real-time subscriptions. Offline state managed via browser storage with sync composable.

**Existing API reuse:** Learn sections invoke existing generation endpoints with additional parameters (course context, section position, performance history). New endpoints needed for: course CRUD, outline generation, section orchestration, review session management, calendar integration.

**Component reuse:** Existing quiz components (QuizShell, TakingView, Question), flashcard components (RoomPractice, FlashcardCard), and audio components (Player, AudioVisualizer) are reusable within course sections. New components needed for: course shell, section view, outline editor, mastery dashboard, review session, streak display, pace selector.

## Functional Requirements

### Course Management

- FR1: User can create a course from a specific folder's documents
- FR2: User can create a course by selecting documents across multiple folders
- FR3: User can create a course from a topic with no documents (web-sourced)
- FR4: User can view an AI-generated course outline of 5-15 sections ordered by dependency
- FR5: User can edit the course outline (reorder, remove, and add sections) before any content is generated
- FR6: User can view a source confidence indicator showing how much of the course draws from their documents vs web sources
- FR7: User can set a learning pace for a course (intensive, steady, or relaxed)
- FR8: User can change the learning pace at any time
- FR9: User can view all their courses from the top-level Learn route
- FR10: User can view folder-scoped courses from within a folder's sidebar and dedicated learn page
- FR11: User can delete a course and all associated course-scoped entities
- FR12: System supplements course content from web search when user documents provide insufficient coverage
- FR13: System pre-fetches the next section (N+1) while the user works on the current section

### Section Learning

- FR14: User can open the next available section in a course
- FR15: User can view section content in the format selected by the AI (quiz, flashcard, audio, text, or blend)
- FR16: User can override the AI-selected content format for a section
- FR17: User can complete a section by finishing all content blocks (prime, explain, practice, reinforce)
- FR18: User can view their accuracy score for each section's practice component
- FR19: System classifies section content by knowledge type (factual, conceptual, procedural, mixed) and selects the optimal format
- FR20: System generates audio primers that reference the user's own notes and documents
- FR21: System adjusts the next section's practice density based on previous section performance (below 60%: more foundational; above 90%: reduced practice)

### Progress & Mastery

- FR22: User can view section-level completion status for each course
- FR23: User can view concept mastery indicators (new, learning, reviewing, mastered) per section
- FR24: User can view an overall course progress percentage
- FR25: User can view a daily streak counter
- FR26: User can use a streak freeze (one free per week) to protect their streak
- FR27: System tracks quiz and flashcard success rates per section to inform adaptive pacing

### Spaced Repetition (Fast-Follow)

- FR28: System extracts key concepts from completed sections and creates review items
- FR29: User can complete a daily review session surfacing items from all courses based on SM-2 scheduling
- FR30: User can rate recall quality for each review item (again, hard, good, easy)
- FR31: System schedules review items at increasing intervals based on recall quality ratings
- FR32: System enforces a configurable daily review cap to prevent review debt
- FR33: System prioritizes review items closest to their forgetting threshold
- FR34: User can complete a minimum viable review session (2-3 minutes, highest-priority items only)

### Content Quality

- FR35: User can flag a quiz question, flashcard, or explanation as incorrect
- FR36: User can edit a flagged item inline
- FR37: System removes flagged items from the review queue until corrected
- FR38: System tracks content flag rates per course as a quality metric

### Calendar Integration (Fast-Follow)

- FR39: User can connect their Google Calendar via OAuth
- FR40: User can set preferred learning times and session durations
- FR41: System creates time-blocked calendar events with deep links to the next session
- FR42: System composes sessions by time of day (new content in morning, review in evening, audio for commute-length slots)
- FR43: System auto-reschedules missed sessions to the next available slot
- FR44: User can disconnect their calendar and remove all created events

### Offline Access (Fast-Follow)

- FR45: User can access completed sections offline including all section content
- FR46: User can retake quizzes and practice flashcards within completed sections while offline
- FR47: System queues offline attempt data with original timestamps and syncs on reconnect
- FR48: User can see a clear "available offline" indicator per section

## Non-Functional Requirements

### Performance

- NFR1: Course outline generation completes within 15 seconds for document-based courses and 20 seconds for web-sourced courses
- NFR2: JIT section generation completes within 30 seconds (text + quiz + flashcards); audio primer adds up to 30 additional seconds
- NFR3: N+1 pre-fetched sections load instantly (<500ms) when the user advances
- NFR4: Daily review session loads within 2 seconds with up to 50 queued items
- NFR5: Course list and progress dashboard render within 500ms
- NFR6: Offline sections load within 2 seconds from browser storage
- NFR7: Page transitions within Learn module complete within 300ms

### Security

- NFR8: Per-user course isolation enforced at the Convex query level — no query from User A can access User B's courses, sections, or review data
- NFR9: Calendar OAuth tokens stored server-side only; never exposed to client code
- NFR10: Web search supplementation does not persist raw web content in user-accessible storage; only processed/generated content is stored
- NFR11: Offline cached content encrypted at rest using browser-native encryption (Web Crypto API)

### Scalability

- NFR12: System supports concurrent section generation for 100+ active users without degradation beyond stated latency targets
- NFR13: Review queue scales to 1000+ items per user without performance degradation on session load or scheduling calculations
- NFR14: Course generation cost tracked per-user and per-course from launch to enable rate limiting and pricing decisions
- NFR15: Audio TTS generation queued to prevent cost spikes during high-usage periods

### Accessibility

- NFR16: All Learn module interfaces meet WCAG 2.1 AA compliance (keyboard navigation, screen reader, contrast, focus indicators)
- NFR17: Audio content accompanied by text transcripts
- NFR18: Review session recall rating accessible via keyboard shortcuts
- NFR19: Progress visualizations (mastery indicators, streak counter) have text alternatives for screen readers

### Integration

- NFR20: Learn module reuses existing quiz generation API (`/api/quiz/generate`) with additional orchestration parameters — no parallel quiz implementation
- NFR21: Learn module reuses existing flashcard generation API (`/api/flashcards/generate`) with additional orchestration parameters — no parallel flashcard implementation
- NFR22: Learn module reuses existing audio overview API (`/api/audio-overview/generate`) adapted for section-length primers — no parallel TTS implementation
- NFR23: Google Calendar integration uses Calendar API v3 with offline_access scope for persistent event management
- NFR24: Cloudflare AI Search dependency: if search is unavailable during section generation, system degrades to web-sourced content with clear notification
- NFR25: If individual content engine fails during section generation (e.g., TTS unavailable), section delivers remaining formats with notification — never blocks section delivery entirely

### Reliability

- NFR26: Zero data loss for course progress — once a section is marked complete, completion persists across server restarts and deployments
- NFR27: Offline attempt data survives app close and device restart; syncs on next connectivity
- NFR28: Calendar events maintain consistency — if a course is deleted, associated calendar events are removed within 1 hour
- NFR29: Review scheduling maintains SM-2 interval accuracy within 10% — timezone changes, device switches, and offline periods do not corrupt scheduling state
