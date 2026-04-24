---
title: "Product Brief Distillate: Budds"
type: llm-distillate
source: "product-brief-budds.md"
created: "2026-04-08"
purpose: "Token-efficient context for downstream PRD creation"
---

## Existing Codebase State

- RAG chat system is operational: Cloudflare AI Search (semantic retrieval) + Cloudflare AI Gateway (LLM routing via OpenRouter)
- 8 LLM models configured: Claude Sonnet 4.5, Claude Haiku 3.5, GPT-4o, Gemini 2.5 Flash, Llama 3.1 70B, DeepSeek V3, Mistral Small 3.1, Qwen 3 30B
- Auth works: Google OAuth via Better Auth, session-based, stored in SQLite (data/auth.db)
- Convex is wired up (client library loaded, nuxt.config configured) but schema is empty — intended for application data
- Chat messages are client-side only (Vue reactive state via useRag composable) — lost on refresh, no persistence
- No file upload endpoint, no folder data model, no quiz/flashcard system exists
- No test framework, no CI/CD, no deployment pipeline configured
- UI: Nuxt 4 + Vue 3 + Tailwind CSS 4 + shadcn-nuxt (Reka UI), dark mode default, remixicon icons
- Dev server runs on port 3002

## Technical Constraints & Architecture Decisions Needed

- SQLite auth DB requires persistent filesystem — incompatible with serverless deployment (Cloudflare Workers/Pages). Must resolve: migrate auth to Convex/managed DB, use Cloudflare D1, or deploy to long-running Node.js server
- Cloudflare AI Search is currently a single global index — no per-user document isolation. Multi-tenant scoping must be designed before file upload ships
- Document ingestion pipeline is unspecified: how do user-uploaded files get chunked, embedded, and indexed into Cloudflare AI Search? This is the most technically complex V1 feature
- No rate limiting or usage metering on API endpoints — runaway cost risk on public deployment
- Convex role needs commitment: is it the persistence layer for folders, chat history, quiz results, flash cards? Or reconsider?
- 9 env vars required: BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CONVEX_URL, CF_ACCOUNT_ID, CLOUDFLARE_AI_GATEWAY_ID, CLOUDFLARE_AI_GATEWAY_API_KEY, CLOUDFLARE_AI_SEARCH_INSTANCE, CLOUDFLARE_AI_SEARCH_TOKEN, OPENROUTER_API_KEY

## Competitive Intelligence

- **NotebookLM**: Free (Google-subsidized). Supports PDF, Docs, URLs, YouTube. Strong RAG chat. Flat notebooks only (no hierarchy) — #1 user complaint. No quizzes, no flash cards, no spaced repetition. Users report manually copying answers into Quizlet/Anki
- **Quizlet**: Free tier + $8/mo Plus. Core flash card + quiz platform with AI generation. Cannot ingest raw documents/PDFs — requires text paste. Aggressively paywalling features, alienating student base
- **Remnote**: Free tier + ~$8/mo Pro. Note-taking with integrated spaced repetition. Steep learning curve. No file upload + RAG pipeline
- **Knowt**: Free tier + ~$5/mo Premium. AI flash cards/quizzes from notes and YouTube. No PDF upload, no RAG chat. Targets high school students
- **Anki**: Free, open-source. Gold standard for spaced repetition. Interface dated. Card creation is manual and time-consuming. No AI, no document chat
- **Notion AI**: $10/mo AI add-on. Generalist workspace, not learning-focused. No study features
- **Mem.ai**: ~$15/mo. AI note-taking for professionals. No file upload pipeline, no learning features
- **Key market gap**: Document chat tools (NotebookLM, Paperpal) produce no study materials. Study tools (Quizlet, Anki, Knowt) can't ingest raw documents. No product bridges both

## Market Data

- Global AI in Education market: ~$5.8-6.2B (2025), projected ~$47-50B by 2030 (36-45% CAGR)
- 70-85% of college students use AI tools regularly for studying (2025)
- LLM inference costs dropped 80-90% in past 18 months — consumer RAG products now viable at $5-15/mo
- 230M+ enrolled higher education students globally
- Student adoption window: ~12-18 months before larger players could close the gap

## Rejected / Deferred Ideas

- **Audio summaries (NotebookLM-style podcasts)**: Deferred post-V1.1. User wants this as a future feature, not V1. High build complexity
- **Collaboration / sharing**: Explicitly excluded from V1. Reviewer suggested lightweight "publish as read-only" or "share a quiz link" as low-cost viral mechanics worth considering for V1.1
- **Mobile native app**: Excluded. Responsive web is sufficient for V1. Flash card review on mobile is high priority for post-V1.1
- **Spaced repetition algorithms**: Excluded from V1/V1.1. Important for long-term retention and daily habit loop — strong candidate for V1.2
- **Adaptive quiz difficulty**: Excluded. High complexity, medium user value at this stage
- **Monetization / pricing**: Too early per user. Market research suggests $5-6/mo student pricing when ready, with a genuinely useful free tier. Students are extremely price-sensitive
- **Anki/Quizlet export**: Reviewer suggested allowing flash card export to .apkg (Anki) and Quizlet as a retention hook and viral distribution mechanism. Not discussed with user — worth considering
- **Syllabus ingestion**: Reviewer idea — upload a syllabus PDF, auto-generate folder hierarchy. Powerful onboarding moment. Not discussed with user — worth considering for V1

## Scope Signals

- **V1**: File upload + RAG ingestion, folder management (3 levels), chat with documents (source-cited, smart model defaults), Google OAuth
- **V1.1**: AI-generated quizzes, AI-generated flash cards
- **Future**: Audio summaries, spaced repetition, collaboration, adaptive difficulty, mobile app
- Multi-model stays under the hood — smart defaults, power users can switch manually
- 3-level folder hierarchy: Semester > Course > Topic (user-defined, not rigid)

## User Scenarios

- Student downloads 15 lecture PDFs for a semester, uploads them into a "Fall 2026 > Organic Chemistry > Lectures" folder, immediately chats to understand reaction mechanisms, then (V1.1) generates flash cards for exam prep
- Self-directed learner studying for AWS certification dumps all study guides into a folder, chats to clarify concepts, generates practice quizzes
- Researcher uploads 20 papers on a topic, uses chat to synthesize findings across documents, organizes by research theme

## Success Metrics

- 500 users with 3+ documents uploaded within 60 days of launch
- Average time from first upload to first chat query under 2 minutes
- Week-1 to week-4 retention rate above 30%
- 60% of active users return at least 2x/week during active semester

## Open Questions

- Deployment target: Cloudflare Pages/Workers (requires auth migration) vs long-running server?
- Convex as primary persistence layer — confirmed or reconsidered?
- Document format support scope for V1: PDF only? PDF + DOCX + TXT? Slides?
- Max file size and per-user storage limits?
- How does the ingestion pipeline work end-to-end? (upload → chunk → embed → index in Cloudflare AI Search with per-user isolation)
- Quiz format specifics: multiple choice? free response? both?
- Flash card format: simple front/back? cloze deletion?
- Can users edit AI-generated cards and quiz questions?
- FERPA considerations if students upload materials containing other students' information?
