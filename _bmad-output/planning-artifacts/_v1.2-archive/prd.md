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
  - product-brief-budds.md
  - product-brief-budds-distillate.md
  - project-context.md
  - docs/index.md
  - docs/project-overview.md
  - docs/architecture.md
  - docs/api-contracts.md
  - docs/data-models.md
  - docs/component-inventory.md
  - docs/source-tree-analysis.md
  - docs/development-guide.md
documentCounts:
  briefs: 2
  research: 0
  brainstorming: 0
  projectDocs: 8
  projectContext: 1
workflowType: 'prd'
---

# Product Requirements Document - Budds

**Author:** palmwine
**Date:** 2026-04-08

## Executive Summary

Budds is a learning platform that unifies document understanding and active recall into a single workflow. Students upload course materials — lecture PDFs, research papers, notes — organize them into a hierarchical knowledge base (Semester > Course > Topic), and immediately interact through AI-powered chat with source-cited answers, auto-generated quizzes, and flash cards. Every AI output traces back to the exact passage in the student's uploaded material.

The product targets the gap between document comprehension tools (NotebookLM) and study material generators (Quizlet, Anki). Today, students bridge this gap manually — uploading to one tool to understand, then copy-pasting into another to memorize. Budds eliminates this fragmentation by ingesting documents into a semantic search index once and powering all learning outputs from that single source of truth.

Primary users are university and college students managing multiple courses. Secondary users are self-directed learners (certification prep, research synthesis, professional development). The common thread: people who learn from documents and need both comprehension and retention without the tooling tax.

### What Makes This Special

Source-grounded trust is the architectural differentiator. Every chat response, quiz question, and flash card is generated through a RAG pipeline anchored to the student's own materials — not general-purpose AI generation. Students can verify. Professors can endorse. In a market where AI hallucination erodes trust in educational tools, traceable outputs are a structural advantage, not a feature checkbox.

The hierarchical folder system (up to 3 levels) addresses NotebookLM's most-complained-about limitation: flat organization. Over semesters, a student builds a personal, searchable, AI-indexed knowledge base spanning their entire education — a compounding asset no competitor offers.

Timing is favorable: LLM inference costs dropped 80-90% in 18 months, making consumer RAG viable at student-friendly pricing. NotebookLM validated the demand. Quizlet is alienating students with aggressive paywalling. A 12-18 month window exists before larger players could close the gap.

## Project Classification

- **Project Type:** Web application (Nuxt 4 full-stack, SSR/SPA)
- **Domain:** EdTech (learning, student knowledge management, AI-assisted study)
- **Complexity:** Medium (FERPA considerations for student data, accessibility requirements, content trust/verification — no heavy regulatory certification burden)
- **Project Context:** Brownfield — working RAG chat system with multi-model LLM support, Google OAuth authentication, and Nuxt 4 + Convex stack already in place. File upload, folder management, quizzes, and flash cards are net-new development.

## Success Criteria

### User Success

- **Activation:** Average time from first file upload to first chat query under 2 minutes
- **Workflow completion:** 40%+ of weekly active users who chat with documents also generate at least one quiz or flash card set within their first two weeks (V1.1)
- **Source trust:** Users click through to source citations on 30%+ of AI responses, confirming the traceability value proposition is landing
- **Organization adoption:** 70%+ of users with 5+ documents create at least one nested folder structure (validating the hierarchy differentiator)

### Business Success

- **60-day adoption:** 500 registered users with 3+ documents uploaded
- **Engagement:** 60% of active users return at least 2x/week during active semester
- **Retention:** Week-1 to week-4 retention rate above 30%
- **6-month validation:** 2,000+ registered users, 40%+ semester-over-semester return rate among previously active users
- **Workflow replacement:** Qualitative confirmation via onboarding survey that users chose Budds over the NotebookLM + Quizlet/Anki multi-tool workflow

### Technical Success

- **Search relevance:** RAG retrieval surfaces contextually relevant source chunks — measured via user feedback signals (thumbs up/down, source click-through rate)
- **Response latency:** Chat responses under 5 seconds end-to-end (non-streaming), under 1 second to first token (streaming)
- **Ingestion reliability:** 99%+ of uploaded files successfully processed and indexed without manual intervention
- **Cost efficiency:** Per-query LLM and search costs tracked from launch; average cost per active user sustainable at eventual $5-6/mo price point
- **Uptime:** 99.5%+ availability during semester peak periods (midterms, finals)

### Measurable Outcomes

| Metric | Target | Timeframe |
|---|---|---|
| Users with 3+ documents | 500 | 60 days post-launch |
| Upload-to-first-chat time | < 2 minutes | Ongoing |
| Weekly return rate (active semester) | 60% at 2x/week | Ongoing |
| Week-1 to week-4 retention | > 30% | Rolling |
| Chat-to-study-material conversion | > 40% | V1.1 launch + 14 days |
| Semester-over-semester return | > 40% | 6 months |
| Response latency (non-streaming) | < 5 seconds | Ongoing |
| File ingestion success rate | > 99% | Ongoing |

## Product Scope & Phased Development

### MVP Strategy

**Approach:** Problem-solving MVP — deliver the minimum feature set that replaces the NotebookLM + Quizlet multi-tool workflow for a single course. If a student can upload one course's materials, chat with them, and get source-cited answers in one place, the core value proposition is validated.

**Resource Requirements:** Solo developer (palmwine) with existing Nuxt/Vue/Cloudflare expertise. The brownfield codebase eliminates framework setup — development effort focuses on net-new features.

### Phase 1 — V1: Upload, Organize, Understand

**Core User Journeys Supported:**
- Journey 1 (Priya success path): Upload → organize → chat → source verification
- Journey 2 (Priya edge case): Upload error handling, graceful degradation
- Journey 3 (David): Flexible folder hierarchy, cross-document synthesis
- Journey 4 (palmwine): Cost visibility via existing Cloudflare/Convex dashboards

**Capabilities:**

| Capability | Status | Complexity |
|---|---|---|
| Google OAuth authentication | Done | — |
| RAG chat with source citations | Done | — |
| Multi-model LLM selection | Done | — |
| Document search | Done | — |
| File upload endpoint + UI | Net-new | Medium |
| Document ingestion pipeline (chunk → embed → index) | Net-new | High |
| Per-user document isolation in AI Search | Net-new | High |
| Folder management (3-level hierarchy) | Net-new | Medium |
| Chat history persistence (Convex) | Net-new | Medium |
| Streaming chat responses (wire existing backend to UI) | Net-new | Low |
| File status reporting (processing, success, failed) | Net-new | Low |
| Source click-through navigation | Net-new | Low |
| Account deletion (data privacy requirement) | Net-new | Medium |

**Explicitly deferred from V1:**
- Quiz generation (V1.1)
- Flash card generation (V1.1)
- Rate limiting / usage metering (manual monitoring initially)
- Admin dashboard (use Cloudflare + Convex dashboards directly)

### Phase 2 — V1.1: Active Learning

- AI-generated quizzes (multiple choice + free response) from folder-scoped documents
- AI-generated flash cards (front/back) from folder-scoped documents
- Source traceability on all generated study materials
- User editing of AI-generated cards and quiz questions
- Per-user rate limiting on LLM queries
- Basic usage analytics (Convex-side)

### Phase 3 — Expansion (Future)

- Audio summaries / podcast-style overviews
- Spaced repetition algorithms for flash card scheduling
- Collaborative folders and study group sharing
- Anki/Quizlet export for viral distribution
- Syllabus ingestion (auto-generate folder hierarchy from syllabus PDF)
- Adaptive quiz difficulty
- Cross-folder search
- Lightweight admin dashboard
- Mobile-optimized PWA experience

### Risk Mitigation Strategy

**Technical Risks:**
- *Document ingestion pipeline* is the highest-complexity V1 feature. Cloudflare AI Search's multi-tenant scoping model must be validated before building upload UI. Mitigation: spike the ingestion pipeline first; if per-user isolation isn't feasible with AI Search's current API, evaluate alternatives (namespace-based scoping, metadata filtering) early.
- *Auth migration uncertainty:* SQLite auth DB requires persistent filesystem, incompatible with Cloudflare Workers/Pages serverless deployment. Mitigation: resolve deployment target before V1 launch — either migrate auth to Convex/D1 or deploy on a long-running Node.js server.

**Market Risks:**
- *NotebookLM could add folders and study materials.* Mitigation: speed to market. V1 validates the workflow before incumbents respond. The 12-18 month window is the operating assumption.
- *Students may not pay for a study tool.* Mitigation: V1 launches free. Monetization deferred. Focus on proving the workflow replacement thesis, not revenue.

**Resource Risks:**
- *Solo developer bottleneck.* Mitigation: brownfield codebase reduces build time. Absolute minimum launch: file upload + folder management + existing RAG chat (no streaming, no chat persistence). That's the "upload and chat" MVP — smaller than V1 but validates the core.
- *Cloudflare service costs at scale.* Mitigation: smart model defaults (cheaper models first), per-query cost monitoring from day one, manual cost controls until automated rate limiting ships in V1.1.

## User Journeys

### Journey 1: Priya — The Overwhelmed Pre-Med Student (Primary, Success Path)

Priya is a second-year biology major juggling five courses this semester. It's week 6 and her Organic Chemistry midterm is in 10 days. She has 18 lecture PDFs, a professor's study guide, and three chapters of supplementary reading she hasn't touched. Her current workflow: upload everything to NotebookLM to ask questions, then spend two hours manually creating Quizlet flash cards from her own notes. Last semester she ran out of time and skipped the flash cards entirely — she passed, but barely.

A classmate mentions Budds. Priya signs in with Google, creates a folder structure: *Fall 2026 > Organic Chemistry > Midterm 1*. She drags in all 18 PDFs. Within 30 seconds, the files are processing. She types her first question while they're still indexing: "What are the key differences between SN1 and SN2 reactions?"

The response comes back with a clear explanation — and underneath, she sees the exact passages from her lecture slides that support the answer. She clicks one. It's from Lecture 7, slide 14. She recognizes the professor's diagram. This isn't generic AI — it's *her* material, organized and searchable.

Over the next hour, Priya works through her weakest topics conversationally. When she feels confident on reaction mechanisms, she hits "Generate Flash Cards" on that topic. Budds produces 24 cards, each tied to a specific source passage. She scans through — two feel redundant, one is oddly worded. She edits those three and saves the set. The whole process that used to take her an evening takes 15 minutes.

Over the next 10 days, she reviews the cards between classes, generates a practice quiz the night before the exam, and scores an 88. She immediately creates folders for her other four courses.

**Capabilities revealed:** File upload + batch ingestion, folder creation (3-level hierarchy), RAG chat with source citations, flash card generation from documents, flash card editing, quiz generation, source click-through navigation.

### Journey 2: Priya — The Failed Upload (Primary, Edge Case)

It's finals week. Priya is uploading her Biochemistry materials — 12 PDFs and one file her professor distributed as a scanned image-heavy PDF with no selectable text. She uploads everything at once.

11 files process successfully. The scanned PDF fails ingestion — there's no extractable text for the RAG pipeline to index. Budds shows a clear status: 11/12 files indexed, 1 failed with the reason "No extractable text detected — scanned or image-only PDF."

Priya is frustrated but not stuck. She still has 11 documents indexed and can chat with those immediately. She makes a mental note to run the scanned PDF through an OCR tool later, or just skip it — it was supplementary anyway.

She also notices that one of her successfully uploaded files seems to return irrelevant results when she asks about enzyme kinetics. The source chunks being surfaced are from a different topic in the same PDF. She tries rephrasing her question with more specific terminology and gets better results. The issue was query specificity, not ingestion quality.

**Capabilities revealed:** Batch upload status reporting, individual file error handling with actionable error messages, graceful degradation (partial upload success), search quality dependent on query specificity, file format validation.

### Journey 3: David — The Career Switcher Studying for AWS Certification (Secondary)

David is a 34-year-old project manager pivoting into cloud engineering. He's studying for the AWS Solutions Architect Associate exam using three official study guides (PDFs), a collection of notes he took from video courses, and two practice exam explanation documents he found online.

He doesn't have semesters or courses — his mental model is different. He creates a single top-level folder: *AWS SAA-C03*, with subfolders for each exam domain: *Compute*, *Storage*, *Networking*, *Security*, *Cost Optimization*.

David's study pattern is different from a student's. He doesn't binge — he studies 30-45 minutes each morning before work. He opens Budds, picks a domain folder, and asks targeted questions: "When should I use an Application Load Balancer vs a Network Load Balancer?" The source-cited response pulls from two of his study guides simultaneously, synthesizing across documents.

After a week of chat-based study, he generates a quiz for the Networking domain. Eight questions, multiple choice. He gets 5/8. The three he missed link back to the source passages he needs to review. He bookmarks those topics for tomorrow's session.

Over six weeks, David works through all domains. His quiz scores trend upward. He passes the certification on his first attempt and immediately starts uploading materials for the next cert.

**Capabilities revealed:** Flexible folder hierarchy (not locked to Semester > Course > Topic), cross-document synthesis in chat, quiz generation scoped to specific folders/topics, quiz scoring with source-linked review, incremental study session patterns.

### Journey 4: palmwine — The Solo Operator (Admin/Operations)

palmwine is running Budds solo in early launch. It's week 3 post-launch, and 120 users have signed up. Things are working, but palmwine needs to keep an eye on costs and system health.

Every morning, palmwine checks the Cloudflare AI Gateway dashboard — it shows request volume, latency percentiles, and cost accumulation by model. Yesterday's spend spiked — a handful of users discovered they could switch to Claude Sonnet 4.5 (the most expensive model) and were running long multi-turn conversations. The average cost per query for those users is 8x higher than the default model users.

palmwine checks Convex for user activity patterns — how many documents are being uploaded, which users are most active, and whether chat history storage is growing as expected. One user uploaded 47 files in a single folder. The ingestion worked, but the semantic search results for that folder are noisy because the documents overlap significantly.

palmwine also notices through Cloudflare AI Search metrics that certain document types (dense academic papers) produce better RAG results than others (slide decks with minimal text). This insight will inform future guidance for users on optimal upload formats.

There's no admin dashboard yet — palmwine is checking Cloudflare dashboards, Convex dashboard, and server logs directly. It works at 120 users, but won't scale. A lightweight admin view is on the mental roadmap.

**Capabilities revealed:** Cost monitoring per model, usage analytics (uploads, active users, chat volume), document ingestion quality variance by format, need for future admin dashboard, rate limiting / cost controls per user, storage growth monitoring.

### Journey 5: Priya — The Returning Student (Edge Case, Retention)

It's January. Priya is back for spring semester with four new courses. She opens Budds and sees her fall folders still intact — Organic Chemistry, Biology, Statistics, all with their documents, chat histories, and flash card sets.

She creates a new top-level folder: *Spring 2027*. For her Biochemistry course, she realizes some of her Organic Chemistry knowledge is foundational. She starts a chat in her new Biochemistry folder but references an Orgo concept. The chat only searches within the current folder's documents.

She wishes she could cross-reference — ask a question that pulls from both her old Orgo materials and new Biochem materials. For now, she opens her Orgo folder in another tab and manually cross-checks. It's a minor friction, but it highlights the compounding value of her knowledge base: the more semesters she uses Budds, the more valuable the archive becomes.

By mid-semester, Priya has 6 months of materials in Budds spanning two semesters. When a friend asks how she studies, she shows them Budds. The friend signs up that evening.

**Capabilities revealed:** Persistent knowledge base across semesters, folder-scoped vs cross-folder search (limitation to address later), organic referral / viral growth pattern, long-term data retention, chat history as a study log.

### Journey Requirements Summary

| Capability Area | Revealed By Journeys |
|---|---|
| File upload + batch ingestion | Priya (success), Priya (edge case) |
| Ingestion error handling + status reporting | Priya (edge case) |
| Folder hierarchy (3-level, flexible naming) | Priya (success), David |
| RAG chat with source citations | Priya (success), David |
| Source click-through navigation | Priya (success) |
| Cross-document synthesis | David |
| Flash card generation + editing | Priya (success) |
| Quiz generation + scoring | David, Priya (success) |
| Quiz/card source traceability | David |
| Chat history persistence | Priya (returning), palmwine |
| File format validation + error messages | Priya (edge case) |
| Cost monitoring + per-model tracking | palmwine |
| Usage analytics | palmwine |
| Rate limiting / cost controls | palmwine |
| Persistent cross-semester knowledge base | Priya (returning) |
| Folder-scoped search | David, Priya (returning) |
| Organic referral patterns | Priya (returning) |

## Domain-Specific Requirements

### Compliance & Regulatory

- **FERPA awareness:** Budds does not target institutional integration or store student records on behalf of educational institutions. However, users may upload materials containing other students' information. Terms of service must place responsibility for uploaded content on the user. System must not expose one user's documents to another.
- **Data privacy:** Users own their uploaded content. Clear privacy policy covering: what data is stored, where, for how long, and how to delete it. Full account and data deletion capability required for V1.
- **GDPR consideration:** If users outside the US access the platform, basic GDPR compliance is needed — consent for data processing, right to deletion, data export capability.

### Accessibility

- **WCAG 2.1 AA baseline:** Keyboard navigation, screen reader compatibility, sufficient color contrast, focus indicators. Critical for EdTech credibility and future institutional adoption.
- **Dark/light mode:** Already supported via Tailwind CSS theme tokens. Ensure both modes meet contrast requirements.

### Technical Constraints

- **Per-user document isolation:** Multi-tenant scoping in Cloudflare AI Search is the highest-priority technical constraint. One user must never see another user's documents in search results or chat responses.
- **Data retention:** Users expect their knowledge base to persist across semesters. Long-term storage strategy must account for growing per-user document volume.
- **Content deletion:** When a user deletes a file, the corresponding chunks must be removed from the semantic search index — not just the file metadata.

### Risk Mitigations

- **Uploaded content liability:** Terms of service must disclaim responsibility for copyrighted materials students upload (lecture slides, textbook excerpts). Budds stores for personal use, not redistribution.
- **AI output accuracy:** Source citations mitigate hallucination risk, but a disclaimer that AI-generated study materials should be verified against source documents is prudent.
- **Cost runaway:** Per-user rate limiting on LLM queries prevents individual users from generating disproportionate costs. Smart model defaults (cheaper models first) reduce average cost per query.

## Innovation & Novel Patterns

### Detected Innovation Areas

**Dual-purpose RAG pipeline:** A single semantic search index powers both document comprehension (chat) and active recall generation (quizzes, flash cards). This is architecturally distinct from combining two separate tools — the integration is at the data layer, not the UI layer. The same indexed chunks that answer a chat question also generate the flash card that helps you remember the answer.

**Source-traceable study materials:** Every AI-generated quiz question and flash card links back to the exact source passage in the student's uploaded material. This is a structural trust mechanism — not a citation bolted onto a generative output, but a constraint enforced by the RAG pipeline itself. The AI cannot generate content that isn't grounded in the student's documents.

**Compounding knowledge architecture:** The 3-level folder hierarchy transforms document uploads from ephemeral study sessions into a persistent, searchable knowledge base. Each semester of use increases the value of the archive. This creates a switching cost and long-term retention moat that no competitor currently replicates.

### Market Context & Competitive Landscape

No existing product combines document-level RAG chat with study material generation from the same indexed content. NotebookLM has the strongest RAG chat but produces no structured learning outputs. Quizlet has the strongest study material tooling but cannot ingest raw documents. The gap is well-documented by user behavior — students manually bridge it by copying between tools.

The "learning compiler" framing positions Budds not as a feature bundle but as a new category: raw materials in, structured learning out.

### Validation Approach

- **Pipeline validation:** Does generating flash cards from RAG-retrieved chunks produce higher-quality cards than generating from raw document text? A/B test with user ratings on card quality.
- **Trust validation:** Do users actually click source citations? Source click-through rate as a proxy for whether traceability matters to users in practice.
- **Compounding value validation:** Do users who persist across semesters upload more, engage more, and retain better than single-semester users? Cohort analysis at 6-month mark.

### Innovation Risk Mitigation

- **RAG quality risk:** If semantic search returns poor chunks, both chat and study materials suffer. Mitigation: score thresholds on retrieval, user feedback signals, and iterative tuning of chunking strategy.
- **Dual-purpose complexity:** Optimizing the index for chat queries may not optimize it for flash card generation. Mitigation: monitor quality metrics separately for each output type; consider query reformulation for study material generation.
- **Compounding assumption risk:** Users may not return across semesters if the core experience isn't compelling enough in a single semester. Mitigation: V1 must deliver standalone value within one course before betting on cross-semester retention.

## Web Application Specific Requirements

### Project-Type Overview

Budds is a Nuxt 4 full-stack web application using SSR for public pages and SPA behavior for the authenticated application shell. The UI is built with Vue 3 Composition API, Tailwind CSS 4, and shadcn-nuxt (Reka UI) headless components. Targets modern evergreen browsers.

### Technical Architecture

**Rendering strategy:** Nuxt 4 hybrid rendering — SSR for public-facing pages (landing, login) for SEO and fast initial load; SPA-like navigation within the authenticated `/app/**` shell for responsive study sessions.

**Browser support:**

| Browser | Minimum Version | Priority |
|---|---|---|
| Chrome | Last 2 versions | Primary (dominant in student demographic) |
| Safari | Last 2 versions | Primary (macOS/iOS student devices) |
| Firefox | Last 2 versions | Secondary |
| Edge | Last 2 versions | Secondary |
| Mobile Chrome/Safari | Last 2 versions | High (students on phones between classes) |

**Responsive design:** Mobile-responsive required for V1. Chat and flash card review must be usable on mobile viewports. File upload and folder management can be desktop-optimized with mobile as functional but not primary.

**Performance targets:** See NFR1-NFR7 for specific measurable performance requirements.

**SEO strategy:** SSR for public pages only. All `/app/**` routes behind authentication and excluded from indexing via `robots.txt` and `noindex` meta tags.

**Streaming:** The server-side `generateCompletionStream` utility exists but is not wired to the UI. V1 must implement streaming chat responses — students expect responsive AI interactions, not loading spinners.

### Implementation Considerations

**State management:** Vue 3 reactive state via composables (no Pinia/Vuex). Chat history persistence to Convex is a V1 requirement — currently messages are lost on refresh.

**Component architecture:** shadcn-nuxt is configured but no components scaffolded. V1 should scaffold common components early: message bubbles, source citation cards, model selector, folder tree, file upload zone, flash card viewer, quiz interface.

**Mobile responsiveness priorities:**
- **Must work well on mobile:** Chat interface, flash card review, quiz taking
- **Desktop-optimized (functional on mobile):** File upload, folder management, source panel
- **Desktop-only acceptable:** Admin/operator views (future)

## Functional Requirements

### Document Management

- FR1: User can upload one or more files (PDF) to a specific folder
- FR2: User can view upload status for each file (processing, success, failed) with actionable error messages for failures
- FR3: User can view a list of all uploaded documents within a folder
- FR4: User can delete an uploaded document, removing it from both storage and the semantic search index
- FR5: User can view document metadata (filename, upload date, processing status, size)
- FR6: System ingests uploaded documents by chunking, embedding, and indexing them into the semantic search index
- FR7: System enforces per-user document isolation — a user's documents are never visible to or searchable by other users

### Knowledge Organization

- FR8: User can create folders up to 3 levels of nesting depth
- FR9: User can rename folders
- FR10: User can delete folders (with confirmation, cascading to contained documents and subfolders)
- FR11: User can move documents between folders
- FR12: User can navigate the folder hierarchy to view contents at any level
- FR13: User can view their complete folder structure as a navigable tree

### AI Chat

- FR14: User can send a natural language query and receive an AI-generated response grounded in their uploaded documents
- FR15: User can view source citations alongside each AI response, showing the exact passages used
- FR16: User can click a source citation to navigate to the relevant document and passage
- FR17: User can select which AI model to use for chat responses
- FR18: System defaults to a recommended model when user has not explicitly selected one
- FR19: User can view chat responses as they stream in real-time (token-by-token)
- FR20: User can scope chat queries to documents within a specific folder
- FR21: User can view and continue previous chat conversations
- FR22: User can start a new chat conversation
- FR23: User can clear/delete a chat conversation
- FR24: System persists chat history across sessions (survives page refresh and re-login)

### Quiz Generation (V1.1)

- FR25: User can generate a quiz from documents within a selected folder
- FR26: User can take a generated quiz (multiple choice and free response questions)
- FR27: User can view quiz results with scoring
- FR28: User can view source citations for each quiz question (linking back to the passage that informed the question)
- FR29: User can edit AI-generated quiz questions before or after taking the quiz
- FR30: User can view previously generated quizzes

### Flash Card Generation (V1.1)

- FR31: User can generate flash cards from documents within a selected folder
- FR32: User can review flash cards in a card-by-card study interface
- FR33: User can view the source citation for each flash card (linking back to the originating passage)
- FR34: User can edit AI-generated flash cards (front and back content)
- FR35: User can delete individual flash cards from a set
- FR36: User can view previously generated flash card sets

### Authentication & Account

- FR37: User can sign in using Google OAuth
- FR38: User can sign out, ending their session
- FR39: User can delete their account and all associated data (documents, folders, chat history, quizzes, flash cards)
- FR40: System redirects unauthenticated users to the login page when accessing protected routes
- FR41: System redirects authenticated users away from the login page

### Data Privacy & Compliance

- FR42: User can export their data (documents, chat history, quizzes, flash cards)
- FR43: System removes all associated search index entries when a user deletes a document
- FR44: System removes all user data from all storage systems when a user deletes their account
- FR45: System displays terms of service and privacy policy to users

## Non-Functional Requirements

### Performance

- NFR1: Chat responses (non-streaming) complete end-to-end in under 5 seconds for 95th percentile of queries
- NFR2: Streaming chat responses deliver first token within 1 second
- NFR3: File upload acknowledgment (UI feedback that processing has started) within 2 seconds of submission
- NFR4: Document ingestion completes within 60 seconds per PDF (up to 50 pages)
- NFR5: Folder tree navigation and document listing renders within 500ms
- NFR6: Flash card and quiz generation completes within 10 seconds per request
- NFR7: Page transitions within the authenticated app shell complete within 300ms

### Security

- NFR8: All data transmitted over HTTPS (TLS 1.2+)
- NFR9: Per-user document isolation enforced at the search index level — no query from User A can return documents belonging to User B under any circumstances
- NFR10: API keys and secrets stored server-side only; never exposed to client-side code or browser network requests
- NFR11: OAuth sessions expire after 30 days of inactivity; active sessions refresh automatically
- NFR12: File uploads validated server-side for file type, size limits, and content before ingestion processing begins
- NFR13: Account deletion permanently removes all user data from all storage systems (Convex, Cloudflare AI Search index, file storage) within 24 hours

### Scalability

- NFR14: System supports 500 concurrent users with no degradation beyond stated performance targets
- NFR15: Per-user document storage supports at least 500 documents per account without search quality degradation
- NFR16: System handles semester traffic spikes (3-5x normal volume during midterms/finals) without downtime
- NFR17: LLM cost per query remains trackable per model and per user to enable future rate limiting and pricing decisions
- NFR18: Architecture supports horizontal scaling of the ingestion pipeline independent of the chat serving path

### Accessibility

- NFR19: WCAG 2.1 AA compliance for all user-facing pages and interactive elements
- NFR20: Full keyboard navigation support — all features accessible without a mouse
- NFR21: Screen reader compatibility for chat messages, source citations, folder navigation, and study materials
- NFR22: Minimum 4.5:1 contrast ratio for all text in both dark and light mode
- NFR23: Focus indicators visible on all interactive elements during keyboard navigation

### Integration

- NFR24: Cloudflare AI Search dependency: system degrades gracefully if AI Search is temporarily unavailable (user sees clear error, no data loss)
- NFR25: Cloudflare AI Gateway dependency: if gateway is unavailable, chat returns a clear error rather than hanging or producing partial responses
- NFR26: Convex dependency: if Convex is temporarily unavailable, the system queues writes and retries rather than losing user data
- NFR27: OpenRouter model availability: if a selected model is unavailable, system falls back to the default model with a notification to the user

### Reliability

- NFR28: 99.5% uptime during academic semester periods (September–December, January–May)
- NFR29: Zero data loss for successfully uploaded and ingested documents — once a file shows "success" status, it is persisted durably
- NFR30: Chat history persistence survives server restarts, deployments, and browser refreshes
- NFR31: Graceful error recovery — any transient failure presents a user-actionable message, never a blank screen or unresponsive UI
