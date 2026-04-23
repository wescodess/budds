# Story 3.5: Audio Primer Generation — User Note References

## Status: in-progress

## Story

As a user, I want audio primers that reference my own notes, so that the learning feels personalized and grounded in my materials.

## Acceptance Criteria

1. **Given** a section is being generated with an audio content block, **When** the audio primer is generated, **Then** the LLM script references the user's specific documents and passages (e.g., "In your Lecture 7 notes, you have a diagram comparing...").
2. The audio is generated as a short-form (2-3 minute) single or dual-host clip using the existing audio overview pipeline with `courseScoped: true`.
3. A text transcript is displayed below the audio player.
4. The audio primer block includes source attribution.

## Tasks

- [x] 1. Add short-form audio primer script prompt builder (adapt `buildAudioScriptPrompt` for 2-3 minute primers with user-note-referencing instructions)
- [x] 2. Wire audio generation into `server/api/course/generate-section.post.ts` when `includeAudio === true`
- [x] 3. Create a `createCourseScopedOverview` mutation and `getCourseScopedOverview` query in `convex/audioOverviews.ts` for course-scoped audio
- [x] 4. Replace `AudioBlock.vue` stub with real audio player + transcript + source attribution
- [x] 5. Add Convex tests for the course-scoped audio creation path
- [x] 6. Add component tests for AudioBlock
- [x] 7. Run `pnpm test` and `pnpm test:component` to verify no regressions

## Dev Agent Record

### Decisions

- TEA ATDD skipped: This story is primarily backend audio generation + component replacement. ACs are about integration behavior (audio wired in, transcript shown, source attribution) best tested via Convex unit tests and component tests, not E2E acceptance tests.
- Used `getCourseScopedOverview` query that returns turnUrls + sourceFilenames in one query (vs split `getWithTurns` + `getTurnUrls` used by full AudioOverviewPlayer). Simpler for the embedded compact player. Deferred the performance concern about URL resolution on each subscription tick.
- Audio primer uses `google/gemini-2.5-flash` for script generation (same model as full audio overview) and `aura-1` or `dia` for TTS (same resolution as full audio overview).
- Compact player design: minimal play/pause + progress bar + collapsible transcript + source pills. No speed control, download, or sharing — those belong to the full AudioOverviewPlayer.

## File List

- `server/utils/audio-primer-prompt.ts` — new short-form primer prompt builder
- `server/api/course/generate-section.post.ts` — wired audio generation for conceptual sections
- `convex/audioOverviews.ts` — added `createCourseScopedOverview` mutation and `getCourseScopedOverview` query
- `app/components/learn/AudioBlock.vue` — replaced stub with real player + transcript + sources
- `convex/audioOverviews.test.ts` — added 7 tests for course-scoped mutations/queries
- `server/api/course/generate-section.post.test.ts` — added 5 tests for audio primer path
- `tests/component/learn/audio-block.test.ts` — new 11 component tests

## Change Log

- Created `buildAudioPrimerPrompt` for 2-minute short-form primers that reference user documents by filename
- Wired audio generation into section pipeline: conceptual sections dispatch audio in parallel with text/quiz/flashcard
- Added `createCourseScopedOverview` mutation with `courseScoped: true` flag for course-scoped audio
- Added `getCourseScopedOverview` query returning overview + turnUrls + sourceFilenames in one call
- Replaced AudioBlock stub with functional compact player: play/pause, progress bar, collapsible transcript, source attribution pills
- Code review: 2 blockers fixed (orphan blob cleanup on audio failure, redundant watch double-play), 3 deferred (URL resolution per tick, conditional composable, no ttsEngine hint)
