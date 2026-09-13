---
title: "Product Brief: Budds Learn Module"
status: "complete"
created: "2026-04-22"
updated: "2026-04-22"
inputs:
  - product-brief-budds.md
  - product-brief-budds-distillate.md
  - architecture.md
  - prd.md
  - epics.md
  - ux-design-specification.md
  - docs/archive/plans/quiz-feature-revamp-implementation-plan.md
  - docs/archive/plans/flashcard-room-refactor-phase-1.md
  - docs/archive/plans/audio-overview-v1-prd.md
  - convex/schema.ts
  - DESIGN.md
---

# Product Brief: Budds Learn Module

## Executive Summary

Budds already turns raw materials into study outputs — chat answers, flashcards, quizzes, audio overviews. Each works well in isolation. What's missing is the thread that connects them into a coherent learning journey.

The Learn module is that thread. Users select materials from their knowledge base — or just type a topic — and the system generates a structured course broken into sections, each composed of the right mix of content formats for that material. Only the next section is generated, adapting to how the learner is performing. Completed concepts enter a spaced repetition system that surfaces them at optimal intervals. Calendar integration creates time-blocked study slots so learning actually happens instead of being perpetually "planned."

This is not a new product. It's the orchestration layer over battle-tested primitives — the RAG pipeline, quiz engine, flashcard system, and audio generation that are already in production. Competitors would need to build all four content engines before they could attempt orchestration. We're wiring together systems that already work.

## The Problem

Students and self-directed learners face a fragmented landscape:

- **Quizlet** generates flashcards but can't ingest your actual documents. You re-type everything. And they're paywalling features at $36/yr, alienating their base.
- **Anki** has gold-standard spaced repetition but brutal UX and manual card creation. Students spend more time making cards than studying them.
- **NotebookLM** understands your documents but only generates passive content — summaries and podcasts you listen to but never actively engage with.
- **No platform** creates a structured, adaptive course from your own knowledge base that combines active recall, spaced repetition, and calendar scheduling.

The result: learners either cobble together 3-4 tools and manage the workflow themselves, or they default to re-reading notes — the least effective study method that exists.

Budds users already have their materials uploaded. They already generate quizzes and flashcards from those materials. But each generation is ad hoc — a one-off quiz here, a flashcard set there. There's no progression, no retention tracking, no schedule. The pieces exist; the orchestration doesn't.

## The Solution

**Course Creation:** From any folder or the top-level Learn section, users create a course. They select source materials (documents, folders, or nothing — web-only courses work too). The AI analyzes the material, supplements from web search, and generates a course outline of 5-15 sections ordered by dependency. The user reviews and edits the outline — reordering, removing, or adding sections — before any content is generated. Source confidence is shown: "This course draws from 14 of your notes" vs "Built primarily from web sources."

**Just-in-Time Sections:** Only the next section is fully generated when the user opens it. The next section (N+1) is pre-fetched in the background while the user works on section N, eliminating loading walls between sections. Each section curates the optimal content mix based on its knowledge type:
- Factual content (definitions, terminology) → flashcards + cloze deletions
- Conceptual content (systems, relationships) → audio primer + interactive explanation + application quiz
- Procedural content (workflows, processes) → walkthroughs + sequencing exercises
- Mixed content → multi-format blend selected by the AI, with user override available

Every section follows a rhythm: prime (audio/narrative intro referencing the user's own notes) → explain → practice → reinforce (key concepts extracted into review items).

**Adaptive Pacing:** The system tracks quiz and flashcard success rates per section. Below 60% accuracy, the next section's practice portion increases foundational items and explanations. Above 90%, practice is reduced and progression accelerates. Full difficulty branching (injecting remedial sections) is deferred to V1.1.

**Spaced Repetition:** Completed sections feed review items into an SM-2-based system. Daily review sessions surface the right items at the right time. The algorithm is invisible — users see "Daily Review: 8 items, ~5 min" and rate their recall quality. Review sessions are budgeted across courses: a configurable daily cap prevents Anki-style review debt, with priority given to items closest to their forgetting threshold. Users can flag incorrect items inline; corrections propagate to their review queue immediately.

**Calendar Integration:** Google Calendar (MVP), Apple Calendar (fast-follow). Users set preferred learning times and session lengths. The system creates time-blocked events with deep links. Session composition adapts to time of day: morning sessions favor new content (highest cognitive load), evening sessions favor review (lower load), commute-length slots get audio content. Missed sessions auto-reschedule to the next available slot.

**Offline Access:** Completed sections are available offline including quiz and flashcard retakes. All attempts queue locally and sync on reconnect with original timestamps so spaced repetition tracking stays accurate. New section generation requires connectivity — users see a clear "available offline" indicator per section.

**Pace Control:** Users choose a learning pace that shapes the entire experience:
- **Intensive** (exam prep): 5-7 new sections/week, daily review, shorter intervals between sessions
- **Steady** (semester learning): 2-3 new sections/week, review 3-5x/week
- **Relaxed** (professional development): 1-2 new sections/week, review 2-3x/week

Pace can be changed at any time. The system adjusts calendar suggestions, review frequency, and section generation accordingly.

## What Makes This Different

**No one else has all five pillars together:**

1. **AI course generation from your own documents** — NotebookLM does passive synthesis. We do structured active learning.
2. **Adaptive just-in-time section delivery** — Content adapts based on your performance. Not pre-built courseware.
3. **Multi-format curation per section** — The same source material becomes flashcards, quizzes, audio, and exercises based on what works best for that knowledge type.
4. **Hidden spaced repetition** — SM-2 quality without Anki complexity. Zero card-creation friction.
5. **Calendar-native scheduling** — Not reminders. Actual time-blocked learning slots with intelligent session composition.

The zero-friction entry point: a user can type "teach me TypeScript generics" and have a structured course in seconds — no uploads, no setup. This is the most powerful onboarding moment in the product and the most direct path to first value.

## Who This Serves

**University students** managing 3-5 courses per semester. They upload lecture notes, readings, and slides to Budds. Learn turns those materials into a structured study plan with daily review sessions and calendar-blocked study time. Pace: intensive during exam prep, steady during regular weeks.

**Self-directed learners** studying for certifications, learning new domains, or doing ongoing professional development. They build knowledge bases over months. Learn provides the structure and retention mechanics that self-study typically lacks. Pace: steady to relaxed, long-term.

Both share the same core need: "I have materials. Help me actually learn them — systematically, not randomly."

**Cold-start users** with no existing documents can create web-sourced courses on any topic. The knowledge base grows as they learn — course materials become reference documents. This is the primary onboarding funnel for new users evaluating the product.

## Success Criteria

Active user is defined as a user who has performed at least one generation action (quiz, flashcard, audio, or course) in the trailing 30 days.

- **Adoption:** 20% of active users create at least one course within 30 days of Learn launch
- **Completion:** 40% of started courses reach section 3+ (proving the JIT model sustains engagement beyond novelty)
- **Retention lift:** Users with active courses show 40% higher week-4 retention vs non-Learn users
- **Review habit:** 25% of Learn users complete daily review sessions 3+ days per week
- **Calendar:** 15% of Learn users connect Google Calendar and maintain scheduled sessions for 2+ weeks
- **Content quality:** <5% of quiz/flashcard items flagged as incorrect by users

## Scope

**MVP (Core Learning Loop):**
- Course creation from folder materials, cross-folder selection, or web-only
- User-editable AI-generated course outlines (5-15 sections) with source confidence indicator
- Just-in-time section generation with N+1 pre-fetch
- Multi-format section content (quiz, flashcard, audio, text) with user format override
- Adaptive pacing based on section performance (success rate thresholds)
- Section-level progress tracking and concept mastery indicators
- Streaks and mastery visualization
- Inline content flagging and correction
- Top-level Learn route (`/app/learn/`) and folder-scoped Learn (`/app/folders/[id]/learn/`)
- Course-scoped entities (quizzes, flashcards, audio not visible in folder tabs)
- Pace control (intensive / steady / relaxed presets)

**Fast-follow:**
- SM-2-based spaced repetition with daily review sessions and cross-course budgeting
- Google Calendar integration with time-blocked slots and adaptive session composition
- Offline access to completed sections with retake sync

**V1.1:**
- Apple Calendar integration
- Difficulty branching (remedial sections auto-inserted when performance drops)
- AI-suggested courses based on knowledge base gaps
- Push notifications for review reminders

**Out:**
- Course sharing or collaboration
- Leaderboards, XP, badges, or social features
- Syllabus ingestion / auto-folder-creation
- Anki/Quizlet export
- Learning analytics dashboard

## Vision

If Learn succeeds, Budds becomes the place where knowledge goes from "stored" to "learned." The long-term trajectory:

**V1.2:** Course sharing — users share generated courses with classmates. Shared courses create viral distribution. Anki/Quizlet export extends reach. Learning analytics dashboard exposes mastery data back to users as a daily engagement surface.

**V2:** Collaborative learning — study groups take courses together with shared progress. Instructor mode — educators create courses from their materials and distribute to students. LMS integration (Canvas, Blackboard) via LTI protocol for institutional adoption.

**The end state:** Budds as a personal learning OS. Every document you add makes you smarter — not because you stored it, but because the system turned it into structured knowledge, tested your understanding, scheduled your reviews, and tracked your mastery over time.
