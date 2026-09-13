# Budds - Project Overview

**Date:** 2026-04-24
**Type:** Web Application
**Architecture:** Full-Stack Nuxt 4 Monolith

## Executive Summary

Budds is an AI-powered learning platform built on Nuxt 4 (Vue 3) with Convex as its real-time backend. Users organize knowledge into folders containing documents, then interact with that content through RAG-powered chat, AI-generated flashcards, quizzes, audio overviews, and structured learn courses. Authentication runs through Better Auth with Google OAuth, proxied through Convex HTTP actions. The application deploys to Cloudflare Pages with Nitro as the server runtime.

## Technology Stack

| Category | Technology | Version | Purpose |
|---|---|---|---|
| Framework | Nuxt | 4.0+ | Full-stack Vue framework |
| UI Framework | Vue | 3.5.13+ | Reactive component framework |
| Language | TypeScript | 5.7.2+ | Type-safe development |
| Backend | Convex | 1.45.0 | Real-time backend-as-a-service |
| Auth | Better Auth | 1.6.30 | Authentication (Google OAuth) |
| Auth Integration | @onmax/nuxt-better-auth | 0.1.1 | Nuxt SSR auth module |
| Convex Integration | nuxt-convex | 0.0.6 (patched) | Nuxt module for Convex |
| Styling | Tailwind CSS | 4.0+ | Utility-first CSS |
| UI Components | shadcn-nuxt + Reka UI | 2.5.1 / 2.9.5 | Headless component library (60+ components) |
| Icons | @lucide/vue | 1.45+ | Icon library |
| Animation | motion-v | 2.2.1+ | Motion animation library |
| AI Gateway | Cloudflare AI Gateway | - | LLM request routing and observability |
| AI Search | Cloudflare AI Search | - | Semantic document retrieval (RAG) |
| AI Inference | Cloudflare Workers AI | - | Audio transcription and quality evidence |
| LLM Router | OpenRouter | - | Multi-model LLM access |
| Audio Renderer | Gemini 3.1 Flash TTS Preview | Preview | Interactions API two-speaker scene rendering |
| Durable Jobs | Cloudflare Workflows | - | Resumable Audio Overview orchestration |
| Object Storage | Cloudflare R2 | - | Audio file storage |
| Markdown | @nuxtjs/mdc | 0.21.1 | Markdown rendering with components |
| Tables | @tanstack/vue-table | 8.21.3 | Headless table logic |
| Forms | vee-validate + zod | 4.15.1 / 4.5.4 | Form validation |
| Utilities | @vueuse/core | 14.2.1+ | Vue composition utilities |
| Carousel | embla-carousel-vue | 8.6.0 | Carousel component |
| Diagrams | mermaid | 11.14.0 | Diagram rendering |
| Deploy Target | Cloudflare Pages | - | Edge deployment |
| Package Manager | pnpm | 9.12.3 | Disk-efficient package manager |
| Testing | Vitest + convex-test | 4.1.11 / 0.0.47 | Unit, integration, and component tests |
| Component Testing | @nuxt/test-utils + happy-dom | 4.0.2 / 20.8.9 | Vue component test environment |

## Key Features

1. **Folders** - Organize content into themed folders with custom icons and color palettes
2. **Documents** - Import and manage source documents within folders; web page extraction via Readability
3. **RAG Chat** - AI-powered conversational interface that retrieves relevant document context and generates cited answers across multiple LLM models
4. **General Chat** - Standalone AI chat without folder-scoped context
5. **Flashcards** - AI-generated spaced-repetition flashcard rooms with SM-2 algorithm and mastery state machine
6. **Quizzes** - AI-generated quizzes with offline attempt support and history tracking
7. **Audio Overviews** - Grounded two-speaker dialogue rendered in bounded Gemini scenes, assembled as a private R2 WAV, with synchronized transcript and separate interjections
8. **Learn Courses** - AI-generated structured courses from folder documents with section-by-section content
9. **Calendar Sync** - Google Calendar integration for scheduling learning sessions with timezone sync
10. **Content Flags** - Flag and manage content across the platform
11. **Data Export** - Export user data
12. **Offline Support** - Offline caching for quiz attempts with sync on reconnect

## Architecture Highlights

- **Frontend**: Nuxt 4 app directory with Vue 3 Composition API, 30+ composables, Tailwind CSS dark theme, 60+ shadcn-vue UI components
- **Backend**: Convex handles all persistent data (folders, documents, conversations, flashcards, quizzes, courses, calendar events, users) with real-time subscriptions
- **Auth**: Better Auth running on Convex HTTP actions; SSR session validation via auth proxy; Convex JWT tokens fetched server-side
- **Server API**: Nitro routes handle AI-intensive operations (chat streaming, flashcard/quiz/course generation, audio overview creation, calendar sync, RAG search)
- **AI Pipeline**: Cloudflare AI Gateway routes to OpenRouter; Cloudflare AI Search provides revision-bound semantic retrieval; Gemini renders joint two-speaker scenes; Workers AI supplies pre-publication transcription evidence
- **Audio Orchestration**: A standalone Cloudflare Workflow reserves finite budget, freezes the source manifest, renders and evaluates scenes, assembles WAV media, publishes atomically, and aligns asynchronously
- **Storage**: Cloudflare R2 stores uploaded documents and private Audio Overview artifacts
- **Deploy**: Cloudflare Pages with `nitro.preset = 'cloudflare_pages'`

## Repository Structure

Single monolith following Nuxt 4 conventions:

- `app/` - Frontend (pages, components, composables, layouts, plugins, constants)
- `server/` - Nitro server (API routes, middleware, utilities)
- `convex/` - Convex backend (schema, queries, mutations, actions, crons)
- `workers/audio-overview/` - Production Audio Overview Workflow, Gemini adapter, quality gate, WAV assembly, and private R2 artifact handling
- `infra/` - Legacy/evaluation infrastructure; it is not the production Audio Overview renderer
- `tests/` - Component and integration tests
- `scripts/` - Build and validation scripts
- `docs/` - Project documentation
