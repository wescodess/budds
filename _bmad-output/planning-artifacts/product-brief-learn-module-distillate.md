---
title: "Product Brief Distillate: Budds Learn Module"
type: llm-distillate
source: "product-brief-learn-module.md"
created: "2026-04-22"
purpose: "Token-efficient context for downstream PRD creation"
---

## Existing Infrastructure to Leverage

- RAG pipeline (Cloudflare AI Search + AI Gateway) already powers chat, quizzes, flashcards, audio — Learn sections tap the same pipeline with zero new search infrastructure
- Tasks table (`userId, folderId, type, status, progress, metadata, result, error`) is a generic async job runner already used for audio generation — reusable for course outline generation, section building, N+1 pre-fetch
- Folder schema already has `referenceScope` (folderIds + fileIds arrays) enabling cross-folder document scoping — Learn courses can use this directly for source material selection
- Documents schema supports `sourceType: 'file' | 'website' | 'youtube'` with `sourceUrl` — web-sourced supplementary content can be ingested as website-type documents through existing pipeline
- Audio overview pipeline is proven: LLM generates multi-turn script → per-turn TTS → audio stored in Convex file storage with speaker/duration/sourceIndex metadata — reusable for section audio primers
- Quiz system already has 4 question types (`multiple-choice`, `free-response`, `true_false`, `fill_in_the_blank`), attempt lifecycle (`in_progress/completed/abandoned`), difficulty field (`easy/medium/hard/mixed`), and per-question explanations
- Flashcard room model uses `term/definition` with `displayOrder`, `metadata.source`, version history, and clean separation between mutable current cards and immutable archived versions
- `pendingCleanup` table handles eventual consistency for AI Search and R2 deletions with retry/attempt counting — pattern reusable for course cleanup cascades
- No offline infrastructure exists currently — PRD explicitly stated "No offline mode." Learn module introduces offline as a new architectural capability for the app

## Data Model Considerations

- Course-scoped entities are a key architectural decision: quizzes, flashcards, and audio generated within a course are NOT visible in folder tabs — they exist only in the course graph
- New tables needed (at minimum): `courses`, `courseSections`, `sectionContent` (or polymorphic content items), `reviewItems` (for SR queue), `reviewAttempts`
- Spaced repetition state needs: item, next review date, interval, ease factor, review count, last review quality rating
- Cross-course review budgeting requires a user-level daily review cap and priority queue (closest to forgetting threshold first)
- Offline sync requires local storage of completed section content + a queue for offline attempts that syncs with original timestamps on reconnect
- Calendar integration requires storing: connected calendar provider, OAuth tokens, event IDs (for updates/deletes), user timezone, preferred session times

## Competitive Intelligence

- **NotebookLM** (Google): Strong RAG chat + audio overviews from user docs. No structured courses, no active recall, no SR, no calendar. Could extend at any time — Google has the infrastructure. Estimated 12-18 month window before they might close the gap.
- **Quizlet**: AI flashcards from notes (~85% accuracy), Q-Chat AI tutor (~13% error rate). SR algorithm weak for long-term retention (biased toward sub-2-day intervals). Aggressive paywalling at $35.99/yr alienating free users. No document ingestion, no course structure.
- **Anki**: Gold-standard SM-2, massive med-school user base. Dated UI, steep learning curve, manual card creation is the primary pain point. No AI features built-in, no multi-format content.
- **StudyFetch** (Spark.E): Closest to all-in-one — has calendar integration, syllabus extraction, flashcard generation. But calendar is basic (reminders not time-blocks), no JIT generation, no audio, no offline.
- **Boterview**: Generates interactive courses from prompts — but prompt-driven only, doesn't ingest user documents as primary source.
- **BeFreed**: Turns topics/PDFs into personalized audio learning plans — but audio-only, no quizzes/flashcards/SR.
- **Key gap confirmed by research**: No product combines all five pillars (AI course gen from user docs + adaptive JIT + multi-format + SM-2 + calendar scheduling)

## Market Data

- Global AI tutors market: $2.11B (2025) → $17.72B by 2033, 30.5% CAGR
- E-learning sector: ~$400B by 2026; online learning platforms $60.39B (2025) → $90.81B by 2030, 8.53% CAGR
- Students in AI-powered learning: 54% higher test scores, 30% better outcomes, 10x more engagement vs traditional
- Spaced repetition: ~20% retention boost. Gamified features: up to 60% engagement increase.
- Gartner (2025): personalized AI learning companions will replace >30% of traditional note-taking apps by 2026
- 70-85% of college students use AI tools regularly
- LLM inference costs dropped 80-90% in 18 months making consumer RAG viable at $5-15/mo
- Reddit sentiment: high skepticism toward AI subscriptions ("what does this do that Claude can't?") — value prop must be concrete, not just "AI generates stuff"

## User Scenarios (Detailed)

- **Exam crammer**: Has 3 weeks until finals. Uploads all lecture slides for Molecular Biology. Creates course, sets pace to Intensive. Does 2 sections/day during morning commute (audio primers) and evening study blocks (practice + review). Calendar blocks 30min morning, 45min evening. SR keeps cumulative material fresh as new sections advance.
- **Certification learner**: Studying for AWS Solutions Architect over 3 months. No existing docs — creates web-sourced course. Pace: Steady. 2 sections/week, review 4x/week during lunch break. Calendar blocks 15min review at 12:30pm, 25min new content on Tuesday/Thursday evenings.
- **Knowledge base power user**: Has 50+ documents across multiple folders on Machine Learning. Creates folder-scoped course from their ML folder. AI identifies that their notes are strong on supervised learning but thin on reinforcement learning — supplements from web. User edits outline to reorder sections. Pace: Relaxed.
- **Cold-start evaluator**: New to Budds. Types "teach me React hooks" on the Learn page. Gets a structured course in seconds from web sources. Completes first section in 8 minutes. This is the primary conversion funnel — zero friction to first value.

## Rejected / Deferred Ideas (with rationale)

- **Course sharing / collaboration**: Deferred post-MVP. User explicitly said "after this MVP." Natural V1.2 feature.
- **Leaderboards, XP, badges, social features**: Out. User wants "streaks and mastery for now." Budds philosophy is "calm over excitement" — heavy gamification contradicts brand identity.
- **Syllabus ingestion / auto-folder-creation**: Out. Reviewer suggestion from original product brief. Powerful onboarding moment but adds scope. Consider for V1.1+.
- **Anki/Quizlet export**: Out for MVP. Reviewer suggested as viral distribution mechanism. Deferred to V1.2 alongside sharing.
- **Difficulty branching (injecting remedial sections)**: Explicitly V1.1. MVP uses simpler adaptive pacing (success rate thresholds adjusting practice density in next section).
- **AI-suggested courses based on knowledge gaps**: V1.1. Requires analyzing user's full knowledge base to find gaps — meaningful but not core loop.
- **Push notifications**: V1.1. Calendar events serve as the notification mechanism in MVP.
- **Learning analytics dashboard**: Out for now. Opportunity reviewer flagged this as high-value daily engagement surface. Consider V1.2 alongside sharing.
- **Instructor/tutor marketplace**: V2 vision. Same pipeline could let educators distribute courses — shifts to platform economics.
- **LMS integration (Canvas, Blackboard, Moodle)**: V2. LTI protocol integration for institutional adoption.
- **Rigid four-beat section template**: Skeptic reviewer challenged the universal prime→explain→practice→reinforce rhythm. Decision: keep as default but allow AI to select from 2-3 section templates based on content type, with user format override.
- **Full SM-2 parameter exposure**: Rejected. Algorithm must be invisible. Users rate recall quality (again/hard/good/easy), system handles intervals. No settings, no interval numbers.

## Technical Risks & Mitigations

- **AI generation latency**: JIT section generation likely takes 15-60s (especially with audio). Mitigation: pre-fetch N+1 section in background using existing tasks system while user works on section N.
- **AI content accuracy**: Quizlet's Q-Chat shows ~13% error rate as a benchmark. Wrong answers in SR get reinforced over weeks. Mitigation: inline flagging/correction per item, corrections propagate to SR queue immediately. Track flag rate as quality metric (<5% target).
- **Knowledge type classification**: Automatically classifying content as factual/conceptual/procedural from arbitrary docs is non-trivial. Mitigation: AI selects format with user override available. Fallback to mixed-format blend for ambiguous content.
- **Source material quality variance**: Poorly organized notes produce worse courses than clean textbook chapters. Mitigation: source confidence indicator ("draws from 14 of your notes" vs "built primarily from web sources"). Transparency over false precision.
- **SR review debt across multiple courses**: University students with 3-5 courses could accumulate overwhelming review queues (the Anki burnout problem). Mitigation: configurable daily review cap, priority by forgetting threshold, minimum viable review option (2-3 min) for busy days.
- **Offline sync complexity**: Conflict resolution, storage limits, background sync are common sources of bugs. Mitigation: offline is read-only + retakes only (no new section generation). Attempts queue locally with original timestamps, sync on reconnect. Clear "available offline" indicator per section.
- **Calendar API maintenance**: Google Calendar and Apple CalDAV have different auth flows, event models, rate limits. Apple CalDAV is notoriously fragile. Mitigation: ship Google Calendar only in fast-follow, Apple Calendar in V1.1.
- **Cost scaling**: Each course generates multiple AI calls (outline, per-section content, flashcards, quizzes, audio TTS). Mitigation: define cost budget per course (max AI calls, max audio minutes), generation queuing, consider caching common web-sourced course outlines.
- **Cold-start course quality**: Web-only courses have higher quality variance than document-based. Mitigation: source confidence signals, quality thresholds on web sources, curated fallback for popular topics.

## UX Principles (from existing design system)

- Budds design philosophy: "calm over excitement, trust over flash, content over chrome" — a coffee shop at midnight, not a clinical tool
- Dark-mode-first with warm amber/gold accents on dark stone backgrounds
- The "Void" is the core UX concept: dedicated full-screen workspace per learning interaction
- Course sections should feel like entering a void — focused, distraction-free, single-purpose
- Review sessions should be accessible from home screen, completable in 2-3 minutes, with minimum viable review option
- Progress visualization: concept mastery indicators (new → learning → reviewing → mastered) with strength meters, not points/XP
- Streaks: low bar to maintain (any review OR any section = streak kept), streak freeze (one free/week), visual prominence without oppressiveness

## Open Questions for PRD Phase

- What web search provider/API for supplementary content? (Cloudflare AI Search is for user docs; web search needs a separate provider)
- How granular should content type classification be? Binary (factual vs conceptual) or spectrum?
- Should web-sourced content be permanently saved as documents in the user's knowledge base, or ephemeral to the course?
- What's the maximum course length before the AI should suggest splitting into multiple courses?
- How should courses handle source document updates? (User re-uploads a newer version of lecture slides — should existing course sections regenerate?)
- What's the audio budget per section? Full TTS primer for every section, or only for conceptual sections?
- Should the daily review session live inside Learn or be a top-level app surface accessible from home?

## Positioning Notes

- Best competitive frame: "NotebookLM that actually makes you learn, not just listen"
- Best reframe for premium positioning: "Your second brain that quizzes you" rather than "AI course generator"
- Cold-start ("type a topic, get a course") should be landing page hero, not a footnote — it's the zero-friction path to first value and the primary onboarding funnel
- Offline access is a genuine differentiator for the university segment (commutes, poor wifi, flights) — worth emphasizing in mobile-first positioning
