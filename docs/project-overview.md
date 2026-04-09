# Budds - Project Overview

**Date:** 2026-04-08
**Type:** Web Application
**Architecture:** Full-Stack Nuxt 4 with RAG Chat System

## Executive Summary

Budds is a full-stack web application built on Nuxt 4 (Vue 3) that provides a Retrieval-Augmented Generation (RAG) chat interface. Users authenticate via Google OAuth (managed by Better Auth with SQLite storage), then interact with an AI chat system that searches indexed documents using Cloudflare AI Search and generates responses through multiple LLM providers via Cloudflare AI Gateway and OpenRouter. Convex serves as the application's backend-as-a-service for future data needs.

## Project Classification

- **Repository Type:** Monolith
- **Project Type(s):** Web (Full-Stack)
- **Primary Language(s):** TypeScript, Vue 3
- **Architecture Pattern:** Nuxt 4 layered architecture (pages → composables → server API routes → external services)

## Technology Stack Summary

| Category | Technology | Version | Purpose |
|---|---|---|---|
| Framework | Nuxt | 4.0+ | Full-stack Vue framework |
| UI Framework | Vue | 3.5.13+ | Reactive component framework |
| Language | TypeScript | 5.7.2+ | Type-safe development |
| Styling | Tailwind CSS | 4.0+ | Utility-first CSS |
| UI Components | shadcn-nuxt + Reka UI | 2.5.1 / 2.9.5 | Headless component library |
| Icons | lucide-vue-next | 1.0+ | Icon library |
| Auth | Better Auth | 1.6.0 | Authentication framework |
| Auth Integration | @onmax/nuxt-better-auth | 0.0.2-alpha.31 | Nuxt module for Better Auth |
| Auth DB | better-sqlite3 | 12.8.0 | SQLite for session/user storage |
| Backend | Convex | 1.34.1 | Backend-as-a-service (BaaS) |
| Convex Integration | nuxt-convex | 0.0.6 | Nuxt module for Convex |
| AI Gateway | Cloudflare AI Gateway | - | LLM request routing and observability |
| AI Search | Cloudflare AI Search | - | Semantic document retrieval |
| LLM Router | OpenRouter | - | Multi-model LLM access |
| Utilities | @vueuse/core | 14.2.1+ | Vue composition utilities |
| Class Utils | clsx + tailwind-merge + CVA | 2.1.1 / 3.5.0 / 0.7.1 | Class name management |
| Package Manager | pnpm | - | Fast, disk-efficient package manager |
| Build Tool | Vite | 7.x (via Nuxt) | Fast dev server and bundler |

## Key Features

1. **RAG Chat System** - AI-powered chat that searches indexed documents and generates contextual answers with source attributions
2. **Multi-Model LLM Support** - Users choose from 8 models: Claude Sonnet 4.5, Claude Haiku 3.5, GPT-4o, Gemini 2.5 Flash, Llama 3.1 70B, DeepSeek V3, Mistral Small 3.1, Qwen3 30B A3B
3. **Document Search** - Standalone semantic search with relevance scoring via Cloudflare AI Search
4. **Google OAuth Authentication** - Secure login with session management stored in SQLite
5. **Protected Routes** - `/app/**` routes require authentication, `/login` is guest-only

## Architecture Highlights

- **Frontend Layer**: Nuxt 4 pages with Vue 3 composition API, Tailwind CSS dark theme, shadcn-nuxt components
- **Composable Layer**: `useRag()` manages chat state, message history, and API communication
- **Server API Layer**: Nitro server routes (`/api/rag/chat`, `/api/rag/search`) handle business logic
- **External Services**: Cloudflare AI Gateway (LLM completion via OpenRouter), Cloudflare AI Search (document retrieval)
- **Auth Layer**: Better Auth with SQLite backend, Google OAuth provider, route-level access control
- **Data Layer**: Convex backend (schema defined but empty, ready for application data), SQLite for auth

## Development Overview

### Prerequisites

- Node.js (LTS recommended)
- pnpm package manager
- Google OAuth credentials (client ID + secret)
- Cloudflare account with AI Gateway and AI Search configured
- OpenRouter API key
- Convex account and project

### Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in all required credentials
3. Install dependencies with `pnpm install`
4. Run `npx nuxt prepare` to generate TypeScript types
5. Start the dev server with `pnpm dev`

### Key Commands

- **Install:** `pnpm install`
- **Dev:** `pnpm dev` (runs on port 3002)
- **Build:** `pnpm build`
- **Preview:** `pnpm preview`
- **Generate:** `pnpm generate`

## Repository Structure

Single monolith with Nuxt 4 conventions: `app/` for frontend (pages, composables, components), `server/` for API routes and utilities, `convex/` for backend-as-a-service schema and functions.

## Documentation Map

For detailed information, see:

- [index.md](./index.md) - Master documentation index
- [architecture.md](./architecture.md) - Detailed architecture
- [source-tree-analysis.md](./source-tree-analysis.md) - Directory structure
- [development-guide.md](./development-guide.md) - Development workflow
- [api-contracts.md](./api-contracts.md) - API endpoints and schemas
- [data-models.md](./data-models.md) - Database schema and models

---

_Generated using BMAD Method `document-project` workflow_
