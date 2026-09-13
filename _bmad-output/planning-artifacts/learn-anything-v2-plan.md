# Learn Anything v2 — Mastery Missions, Web Research, and Calendar Study Plans

## Summary

Learn Anything should retain web sourcing. The problem is not the web—it is that the current “web” flow uses model memory and reports it as web evidence. The replacement will distinguish folder material, retrieved web evidence, and unsupported model knowledge.

Cloudflare AI Gateway’s Web Search delegates to upstream providers and is not inherently free. Cloudflare AI Search has a free beta allowance, but searches connected or Budds-controlled content rather than the unrestricted web. A newer experimental Cloudflare Web Search binding appears to search a shared public-web corpus, but it has no published pricing, eligibility, retention terms, limits, or SLA and remains disabled until Cloudflare confirms those conditions. The documented zero-spend beta path is therefore free-first sourcing plus a no-card Tavily Free adapter with hard fail-closed quotas. [Cloudflare AI Gateway Web Search](https://developers.cloudflare.com/ai-gateway/usage/web-search/), [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/), [Cloudflare Web Search binding PR](https://github.com/cloudflare/workers-sdk/pull/13955), [Tavily credits](https://docs.tavily.com/documentation/api-credits)

Detailed provider, terms, quota, and failure-mode research: [True zero-cost web search for Budds Learn Anything](research/true-zero-cost-web-search-options-2026-09-13.md).

The complete journey becomes:

`Folder-linked Learning Void → goal and sources → verified source review → editable learning map → calibration → study-plan preview → calendar blocks → adaptive mastery sessions → retained mastery`

Content generation follows a hybrid model:

- Generate the complete learning map, prerequisite graph, source evidence, assessment contracts, and study schedule up front.
- Generate each session just in time, including its explanation, examples, hints, practice, transfer challenge, and optional audio.
- Keep the current session and one following session ready to prevent loading delays.
- Reuse scheduled review items rather than regenerating them.
- Pin completed learning to its source revision. Source changes create a new revision instead of rewriting completed history.

## Experience and Learning Model

- Replace “Create a Course” with “Create a Learning Void.” Each void remains permanently tied to its originating folder and has a concrete outcome such as “Explain cellular respiration” or “Pass my exam on October 20.”
- Setup captures outcome, `understand | prepare | apply`, desired depth, optional target date, session duration, weekly availability, and source policy.
- When folder documents exist, default to `folder_plus_web`; users can select `folder_only`. Empty folders use `web_only`, but generation cannot continue until real sources are retrieved or added.
- Present folder and web sources in separate groups. Show coverage, provenance, retrieval date, authority, and which objectives each source supports. Users can remove sources, add URLs, or regenerate the search before accepting the map.
- Generate an editable learning map of 3–6 milestones and 6–15 capability objectives, including prerequisites, estimated effort, assessment type, cited sources, and `strong | partial | gap` coverage.
- Run a 3–7-item calibration challenge with confidence ratings. Calibration may mark objectives as provisionally known, but cannot award retained mastery.
- After map approval, generate a study-plan preview before the first session. Show weekly workload, target-date feasibility, proposed blocks, reviews, rest and buffer time, and any capacity problem.
- The primary screen becomes “Today”: next scheduled session, overdue review, upcoming calendar block, current capability, and one obvious Start action.

Each session follows a bounded mastery loop:

1. Due retrieval from earlier objectives.
2. One explicit session objective.
3. Cold attempt or prediction before teaching.
4. Concise, cited explanation.
5. Worked example.
6. Faded example or progressive hints.
7. Independent application or transfer challenge.
8. Confidence and teach-back check.
9. Misconception-specific feedback and next review scheduling.

The loop implements retrieval practice, spacing, interleaving, and adaptive support fading rather than passive reading. [Retrieval-practice evidence](https://pubmed.ncbi.nlm.nih.gov/16507066/), [spacing evidence](https://pubmed.ncbi.nlm.nih.gov/16719566/), [interleaving evidence](https://onlinelibrary.wiley.com/doi/10.1002/acp.1598)

Mastery uses evidence states:

`unseen → learning → guided → independent → retained`

A failed delayed check moves the objective to `needs_review`. Hints and “show answer” can help learning but cannot award independent mastery. Section completion without an assessment must never default to 100%.

## Source and Generation Architecture

- Introduce `SourcePolicy = folder_only | folder_plus_web | web_only` and `SourceOrigin = folder_document | user_url | open_web_api | general_web_search`.
- Build an immutable source snapshot per blueprint revision. Each entry stores its origin, normalized URL or document revision, title, publisher or domain, retrieved excerpt, retrieval time, content hash, licensing and access metadata where known, and the objectives it supports.
- Fix folder selection so selecting a descendant folder expands to its documents and preserves each document’s real folder identity.
- Never silently fall back to model-authored content when retrieval returns no evidence. Mark the objective as a source gap and let the user add material, broaden web research, or remove it.

Use a free-first web-source router:

1. User-provided URLs.
2. Wikimedia for general reference material.
3. Crossref, OpenAlex, and PubMed adapters for research discovery and openly accessible metadata or content.
4. Cloudflare AI Search for folder documents and Budds-controlled reference corpora.
5. Cloudflare's experimental `WebSearch` binding only after Cloudflare confirms zero-charge eligibility, hard limits, privacy, and result-use rights; keep it behind a default-off provider adapter.
6. Until then, Tavily Free for sanitized broad-web discovery: no card, at most two basic searches per Void, 25 per day, and 800 per month so the product remains below the recurring 1,000-credit allowance.
7. OpenRouter’s `openrouter:web_search` server tool through AI Gateway only in a separate administrator-funded mode; the zero-spend route can never call it.

Wikimedia has a free allowance, Crossref offers unauthenticated public access, and OpenAlex provides a daily free API budget, but these sources do not constitute unrestricted whole-web search. [Wikimedia limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits), [Crossref access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/), [OpenAlex pricing](https://help.openalex.org/access/pricing/)

- Default general-search spend is zero. Every workflow has hard limits for queries, results, fetched bytes, and cost. There is no silent paid fallback.
- Treat provider search results as transient discovery data. Persist evidence only after fetching the selected original page, recording its canonical URL, publisher, retrieval time, content hash, access status, rights note, and the minimum supporting excerpt.
- If free sources cannot cover an objective, show “Broader web search required” with the expected ceiling. The learning map may continue with a visible gap, but unsupported material cannot be presented as sourced.
- Web queries use the user’s goal and sanitized objective terms, never private folder passages.
- Prefer primary and official sources, deduplicate mirrors, reject unusable or paywalled evidence, respect crawl restrictions, and avoid storing or redistributing full copyrighted pages.
- Add a provider-neutral search response contract for standardized URLs, usage, engine, allowance, and cost. Disable request and response payload logging at every search/provider/application layer while retaining privacy-safe operational metrics.
- Use durable `LearnBlueprintWorkflow` and `LearnMissionWorkflow` orchestration with retries, idempotency, source-hash checks, validation, and explicit failure states.
- Generate the validated blueprint first. Generate only the next session and one prefetched session just in time. Source or map changes create a new revision without rewriting completed learning history.
- Each objective package contains explanation atoms, misconceptions, worked examples, hint ladders, retrieval prompts, transfer tasks, answer rubrics, and exact evidence references.

## Study Plans, Calendar, and Interfaces

Create a provider-neutral study-plan domain:

- `studyPlans`: void, blueprint revision, timezone, target date, weekly availability windows, default duration, desired cadence, reminder policy, rolling horizon, revision, and status.
- `studyPlanSessions`: objective IDs, composition, planned minutes, UTC start and end, IANA timezone, status, reschedule history, and whether Budds or the learner selected the time.
- `calendarEvents`: extend the existing table with `studyPlanSessionId`, calendar ID, provider event ID, ETag, last-synced values, sync status, and provider timestamps. Keep `courseId` temporarily for legacy records.
- Preserve existing calendar preferences as migration seeds. Valid durations become `5 | 10 | 15 | 25 | 45 | 60`; new plans default to 25 minutes, while five-minute blocks are review-only.

The scheduling engine will:

- Estimate required new-learning and review time from the accepted map, then report whether the deadline fits the learner’s availability.
- Query Google FreeBusy across user-selected blocking calendars before proposing slots. Use a ten-minute default buffer between sessions. [Google FreeBusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- Schedule individual events rather than recurring series because objectives, review load, duration, and recovery change over time.
- Maintain a confirmed 14-day rolling horizon and extend it daily rather than flooding the calendar with months of brittle events.
- Mix due review, new learning, and application according to learner evidence rather than time of day alone.
- Reflow only future incomplete sessions when performance, availability, sources, or target dates change.

Google Calendar remains a projection of the Budds study plan:

- Before the first write, show a calendar preview and require confirmation. Later approved plan revisions can sync automatically.
- Add private extended properties for `buddsPlanId`, `buddsSessionId`, and `scheduleRevision`. [Google extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties)
- Events contain a privacy-safe objective summary, duration, and deep link—never private source excerpts.
- Default to one Calendar popup ten minutes before the session. Users may use calendar defaults or add an optional day-before reminder. The Today screen supplies in-app upcoming and overdue reminders.
- Add least-privilege OAuth scopes for owned-calendar event management, free and busy access, timezone settings, and calendar-list selection. Existing connections must re-consent before smart scheduling activates. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- Use initial plus incremental synchronization with persisted sync tokens. Webhooks trigger incremental sync; app-open and scheduled fallback syncs cover dropped notifications, expired channels, and HTTP 410 full-resync cases. [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), [push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- Adopt a learner’s external time edit into the plan. If they delete an event, leave the session unscheduled and offer Restore rather than silently recreating it.
- A session becomes missed only after its end plus a 30-minute grace period and only when no learning attempt started. Default recovery moves it to the next free slot, reflows dependent future blocks, notifies the learner, and offers “I completed it elsewhere.”
- Google accepting an event or reminder is provider evidence, not proof that the learner received the reminder or attended.

Public interfaces include:

- `LearnVoidStage = draft | sourcing | blueprint_review | calibration | planning | active | paused | completed | failed`
- `GoalMode = understand | prepare | apply`
- `ObjectiveMastery = unseen | learning | guided | independent | retained | needs_review`
- `StudyPlanStatus = draft | active | paused | completed`
- `StudySessionStatus = planned | started | completed | missed | cancelled`
- `CalendarProjectionStatus = unsynced | pending | synced | conflict | removed | failed`

Client-owned changes use authenticated Convex mutations. External AI and Calendar work goes through authenticated server routes and durable workflows; OAuth tokens remain server-only and encrypted.

## Validation, Rollout, and Assumptions

Tests must cover:

- Folder subtree expansion, source removal, URL ingestion, free-source routing, zero-spend blocking, citation completeness, unsupported-source refusal, outbound-query privacy, deduplication, and source-revision isolation.
- Calibration, progressive hints, attempt-before-answer, misconception feedback, no automatic perfect scores, mastery downgrades, delayed retention, review interleaving, and session recomposition.
- Deadline feasibility, overlapping availability, multiple blocking calendars, buffers, daylight-saving transitions, timezone changes, rolling-horizon extension, missed-session grace periods, and deterministic reflow.
- OAuth re-consent, FreeBusy failures, reminder payloads, duplicate webhooks, ETag conflicts, learner-edited or deleted events, expired sync tokens, token refresh, idempotent retries, compensation, disconnect, and void deletion.
- The complete journey: create from a folder, supplement from real web sources, review evidence, edit the map, accept a study plan, sync calendar blocks, receive reminder configuration, complete and miss sessions, and observe the correct reflow.
- Accessibility, mobile layouts, offline session-completion reconciliation, and failure recovery.

Roll out behind a Learn v2 flag:

1. Add the v2 domain records, source snapshots, and genuine free-first web retrieval.
2. Ship the mastery-session loop and evidence model.
3. Ship in-app study plans and feasibility previews.
4. Add FreeBusy-aware Calendar projection and reconciliation.
5. Offer legacy-course upgrades that copy title and sources but never manufacture mastery.
6. Compare v2 against the existing course flow using delayed unassisted transfer per objective as the north-star metric. Also track citation support, plan acceptance, session attendance, rescheduling, hint dependence, retention, latency, failure rate, and cost.

Assumptions:

- Google Calendar is the first synchronized provider; the study-plan model remains provider-neutral.
- Study plans work without a connected calendar, but outside-app reminders require Calendar synchronization.
- General whole-web search remains available within a shared free allowance, not as an unlimited promise. The route fails closed when the allowance is exhausted and continues with folder sources, open databases, or user-supplied URLs without spending money.
- Collaboration, instructors, leaderboards, public plans, and native push or email infrastructure are outside v2.
- Audio is an optional session activity, not the core learning path.
- Implementation starts in an isolated branch or worktree because the current repository contains unrelated in-progress Audio Overview changes.
