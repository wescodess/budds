---
title: "Product Brief: Budds"
status: "complete"
created: "2026-04-08"
updated: "2026-04-08T23:45:00Z"
inputs:
  - docs/index.md
  - docs/project-overview.md
  - docs/architecture.md
  - docs/component-inventory.md
  - docs/api-contracts.md
  - docs/data-models.md
---

# Product Brief: Budds

## Executive Summary

Every student knows the drill: download lecture slides, open NotebookLM to make sense of them, then hop over to Quizlet to manually create flash cards from what you just learned. Understanding and retention live in separate tools, separated by tedious copy-paste. The knowledge goes in, but the learning workflow is fragmented.

Budds is a learning compiler — raw materials go in, structured learning comes out. Upload your course materials, organize them by semester, course, and topic, then interact with everything through AI-powered chat, auto-generated quizzes, and flash cards — all from the same place. Every AI response traces back to your exact source material. No app-switching. No manual transcription. No hallucinated answers you can't verify. Drop a PDF, and you're studying in under a minute.

The market is ready. Google NotebookLM validated that millions of students want to chat with their documents. Quizlet proved millions want AI-generated study materials. But these capabilities remain siloed. Budds is the first tool purpose-built to bridge document understanding and active learning in a single, organized workspace.

## The Problem

Students and self-directed learners accumulate massive amounts of material — lecture PDFs, research papers, notes, slides — and face two distinct challenges:

**Understanding:** "What does this material actually mean?" Current tools like NotebookLM let you chat with documents, but offer flat organization (no folders, no hierarchy) and produce no structured learning outputs. You understand the content, but retention is your problem.

**Retention:** "How do I remember what I learned?" Tools like Quizlet and Anki generate flash cards and quizzes, but can't ingest raw documents. You have to manually type or paste content before you can study it. The creation friction kills the workflow.

Today, students bridge this gap themselves — uploading to NotebookLM, chatting to understand, then manually creating cards in Quizlet or Anki. It works, but it's slow, fragmented, and lossy. Context gets dropped between tools. The "upload to studying" pipeline that should take seconds takes an hour.

## The Solution

Budds gives learners a single workspace where knowledge goes in and learning comes out:

1. **Organize** — Upload files into folders up to 3 levels deep (Semester → Course → Topic). Your knowledge base, structured how you think.
2. **Understand** — Chat with your documents. Every response cites the exact source passage so you can verify and go deeper.
3. **Retain** — Generate quizzes and flash cards directly from your uploaded materials. The AI has already read everything — one click turns understanding into active recall.

The core experience: drop in your materials, immediately start learning. No setup, no manual card creation, no switching between apps.

## What Makes This Different

**Source-grounded answers you can trust.** Every chat response, every quiz question, every flash card traces back to the exact passage in your uploaded materials. In a world where AI hallucination erodes trust in educational tools, Budds anchors everything to your source material. Students can verify. Professors can endorse.

**A learning compiler, not a combined tool.** Budds isn't "NotebookLM + Quizlet in one app." It's a pipeline: raw materials go in, structured learning comes out. Documents are ingested into a semantic search index from the moment they're uploaded. Chat, quizzes, and flash cards all draw from the same rich index. The integration isn't cosmetic — it's architectural.

**Folder organization that matches how students think.** NotebookLM's flat notebook structure is its most-complained-about limitation. Budds provides hierarchical organization (up to 3 levels) that maps naturally to how students organize coursework. Over semesters, this becomes a personal, searchable knowledge base spanning an entire education — a compounding asset no competitor offers.

**Smart AI under the hood.** Budds selects the best model for the task by default — no configuration required. Under the hood, it supports 8 models across Claude, GPT, Gemini, and more, with power users able to switch manually. Students get great answers without needing to understand the AI landscape.

## Who This Serves

**Primary: Students** — University and college students managing multiple courses, juggling lecture materials, and preparing for exams. They have the content. They need a faster path from "I have these PDFs" to "I'm ready for the test."

**Secondary: Self-directed learners** — Professionals studying for certifications, hobbyists deep-diving into new domains, researchers synthesizing literature. Anyone who accumulates knowledge and wants to extract structured learning from it.

The common thread: people who learn from documents and want both understanding and retention without the tooling tax.

## Success Criteria

- **Adoption:** 500 users with 3+ documents uploaded within 60 days of launch
- **Activation:** Average time from first upload to first chat query under 2 minutes
- **Retention:** Week-1 to week-4 retention rate above 30%
- **Engagement:** 60% of active users return at least twice per week during active semester
- **Workflow replacement:** Users choose Budds over the NotebookLM + Quizlet/Anki multi-tool workflow (measured via onboarding survey and qualitative feedback)

## Scope

**V1 — Foundation (upload, organize, understand):**

- File upload and RAG ingestion
- Folder management with 3-level hierarchy
- Chat with documents (source-cited, smart model defaults with power-user model switching)
- Google OAuth authentication

**V1.1 — Active learning (retain):**

- AI-generated quizzes from uploaded materials
- AI-generated flash cards from uploaded materials

**Explicitly excluded (future consideration):**

- Audio summaries / podcast-style overviews
- Collaboration and sharing features
- Mobile native app
- Spaced repetition algorithms
- Adaptive quiz difficulty

## Vision

Budds starts as a personal knowledge workspace for learners. If it succeeds, it becomes the place where people bring everything they want to learn — and the platform handles the rest.

Near-term evolution includes audio summaries (the NotebookLM feature students love most), spaced repetition for flash cards to optimize long-term retention, and collaborative folders for study groups. Longer-term, Budds becomes an adaptive learning engine — one that knows what you've uploaded, what you understand, and what you still need to study, and meets you exactly where you are.

A student who uses Budds across four years of university builds a personal, searchable, AI-indexed knowledge base spanning their entire education. That's not just a study tool — it's a professional asset. The folder structure isn't organizational convenience; it's the foundation for a longitudinal knowledge graph that appreciates in value over time.

The foundation is the RAG pipeline and organized knowledge base. Every future feature — audio, collaboration, adaptive difficulty — builds on that same indexed, structured content. V1 lays the foundation right.
