# Budds Documentation Index

**Type:** Monolith Web Application
**Primary Language:** TypeScript / Vue 3
**Architecture:** Full-Stack Nuxt 4 + Convex Real-Time Backend + Cloudflare AI Services
**Last Updated:** 2026-09-13

## Project Overview

Budds is an AI-powered learning and productivity platform. Users organize content into folders and documents, then leverage AI to generate flashcards, quizzes, audio overviews, and structured courses from their materials. The platform includes RAG-powered chat, spaced repetition review, calendar integration, and offline-capable course sections.

## Quick Reference

- **Tech Stack:** Nuxt 4 + Vue 3 + Tailwind CSS 4 + shadcn-vue + Convex + Better Auth + Cloudflare AI
- **Entry Point:** `app/app.vue`
- **Architecture Pattern:** Nuxt 4 SSR + Convex reactive backend + Nitro AI API routes
- **Database:** Convex (25+ tables) + Better Auth session management
- **Deployment:** Cloudflare Pages (frontend) + Convex Cloud (backend)
- **Testing:** Vitest + convex-test + @nuxt/test-utils, split across unit, component, Audio Overview, and Worker suites

## Generated Documentation

### Core

- [Project Overview](./project-overview.md) — Executive summary, tech stack, key features
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory structure
- [Architecture](./architecture.md) — System design, auth flow, data architecture, integrations

### Technical Reference

- [API Contracts](./api-contracts.md) — 15+ Nitro endpoints, 120+ Convex functions, auth routes
- [Data Models](./data-models.md) — 25+ Convex tables with fields, indexes, relationships
- [Component Inventory](./component-inventory.md) — 453 Vue components, 31 composables, 25 pages
- [Development Guide](./development-guide.md) — Local setup, env vars, commands, testing
- [Continuous Integration](./ci.md) — GitHub Actions gates, local parity, and configuration boundary

### QA Handoff

- [Auth Flows](./qa/auth-flows.md) — OAuth flow, session lifecycle, token provisioning, edge cases
- [User Flows](./qa/user-flows.md) — Step-by-step user journeys for manual testing
- [Test Plan](./qa/test-plan.md) — Test architecture, coverage report, gaps
- [Learn V1 Isolation Matrix](./qa/learn-v1-isolation-matrix.md) — Executable legacy baseline and additive V2 boundaries
- [Known Limitations](./qa/known-limitations.md) — Error states, edge cases, deliberate omissions
- [Deployment Guide](./qa/deployment-guide.md) — Environments, deploy process, verification
- [Bug Reporting Guide](./qa/bug-reporting-guide.md) — Severity levels, required fields, templates

### Operations

- [Production Release Checklist](./operations/release-checklist.md) — Promotion, deployment, verification, and release evidence
- [Repository History Rewrite](./operations/history-rewrite.md) — Credential-removal scope, preconditions, verification, and recovery

### API Testing

- [Postman Collection](./budds.postman_collection.json) — Importable collection for all API endpoints

## Existing Documentation

- [CLAUDE.md](../CLAUDE.md) — AI assistant project instructions
- [AGENTS.md](../AGENTS.md) — AI agent instructions
- [CONTEXT.md](../CONTEXT.md) — Canonical product and domain vocabulary
- [DESIGN.md](../DESIGN.md) — Canonical visual design system
- [README.md](../README.md) — Repository entry point and validation overview
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Branch, commit, testing, and pull-request rules
- [SECURITY.md](../SECURITY.md) — Private reporting and credential-incident policy

### Historical plans

Completed and superseded feature plans are retained under [`docs/archive/plans`](./archive/plans/) for decision traceability. They are not current implementation contracts.

## Getting Started

```bash
git clone <repository-url>
cd budds
pnpm install
npx nuxt prepare
npx convex dev   # Start Convex backend
pnpm dev         # Start Nuxt dev server at http://localhost:3002
```

See [Development Guide](./development-guide.md) for full env var list and setup steps.

## For AI-Assisted Development

**UI features:** → `architecture.md`, `component-inventory.md`
**API/Backend:** → `architecture.md`, `api-contracts.md`, `data-models.md`
**Full-stack:** → All architecture docs
**QA context:** → `qa/` directory
