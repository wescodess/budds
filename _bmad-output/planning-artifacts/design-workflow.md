# Stitch Design Workflow — Budds

**Author:** palmwine
**Date:** 2026-04-09

## Overview

This document defines the two-tier design workflow that integrates Stitch AI design generation into the BMAD development process. The workflow ensures visual consistency across all screens through a centralized `DESIGN.md` design system and progressive refinement at each stage.

**Core principle:** Stitch is for exploration, not production. Once designs are selected, they are converted to real Vue/Nuxt components with locked Tailwind tokens. From that point, consistency is enforced by code.

---

## Architecture

### Tier 1: Foundation Design System (one-time, before stories)

Establishes the visual identity and core page structures for the entire application.

| Step | Action | Output |
|------|--------|--------|
| 1. Design System Exploration | Generate 3 design system directions informed by PRD, UX spec, and target users. Generate 1 sample screen per system. User selects 1. | Chosen design system |
| 2. Core Layout Exploration | Using locked design system, generate 3 layout directions per core page type (landing, auth, dashboard, chat). Use `batch_generate_screens`. User selects best per page type. 1 round of refinement. | Approved core layouts |
| 3. Design System Finalization | Extract design context, generate DESIGN.md, export Tailwind tokens, convert to Vue components. | DESIGN.md + tokens + base components |
| 4. Cleanup | Delete rejected screens from Stitch project. Remove local artifacts for rejected directions. | Clean project state |

### Tier 2: Per-Story Design (for each story with UI work)

Generates specific screens/components within the established system.

| Step | Action | Output |
|------|--------|--------|
| 1. Assess Need | Does story need new UI? Can existing components cover it? | Go/no-go decision |
| 2. Generate | Use `stitch-enhance-prompt` with DESIGN.md. Generate 3 directions. User selects 1 (or 2 if complex → refine → pick 1). | Approved screen(s) |
| 3. Convert & Integrate | Convert to Vue components. Run consistency + accessibility checks. | Production components |
| 4. Cleanup | Delete rejected screens from Stitch. | Clean state |

---

## Consistency Strategy

| Risk | Mitigation | Stitch Tool |
|------|-----------|-------------|
| Screens generated at different times look different | DESIGN.md passed to every generation call. `apply_design_system` run on new screens. | `apply_design_system` |
| Component styling drifts across pages | Extract design DNA from approved screens, use as input for new ones. | `extract_design_context` |
| Colors/spacing subtly diverge | Automated QA after every generation round. | `compare_designs` |
| Stitch can't perfectly match across sessions | Lock Tailwind tokens in code. Once in code, real components are source of truth. | `generate_design_tokens` |
| Late-added screens don't match early ones | Batch-generate related screens. Reference existing screens in prompts. | `batch_generate_screens` |

---

## Key Files

| File | Location | Purpose |
|------|----------|---------|
| `DESIGN.md` | Project root | Source of truth for visual design system. Fed to every Stitch generation call. |
| `stitch.json` | Project root | Persists Stitch project ID for workspace association. |
| `style-guide.json` | `app/assets/` | Extracted design tokens synced with Tailwind config. |

---

## Stitch Tools Used

### Generation
- `create_design_system` — Create design system directions
- `generate_screen_from_text` — Generate individual screens
- `batch_generate_screens` — Generate related screens (better consistency)
- `edit_screens` — Refine existing screens
- `generate_variants` — Create variations for comparison
- `generate_responsive_variant` — Mobile/tablet variants

### Design System Management
- `apply_design_system` — Apply system to screens (enforces consistency)
- `update_design_system` — Update system properties
- `export_design_system` — Export for developer handoff

### Quality Assurance
- `compare_designs` — Compare screens for consistency
- `analyze_accessibility` — WCAG 2.1 compliance check
- `extract_design_context` — Extract design DNA for replication

### Token Export
- `generate_design_tokens` — Export CSS variables / Tailwind tokens

### Prompt Quality
- `stitch-enhance-prompt` skill — Enhance prompts before generation

### Code Conversion
- `stitch-vue-components` skill — Convert Stitch HTML to Vue 3/Nuxt SFCs

---

## Integration Points

### BMAD Workflows Updated

| Workflow | Change |
|----------|--------|
| `create-story` | Added Step 4b: UI Design Assessment. Checks if story needs new UI, triggers Tier 2 if DESIGN.md exists. Warns if foundation not established. |
| `dev-dispatcher` | Awareness that UI-heavy stories include design asset references in story files. |

### Skills Created

| Skill | Purpose |
|-------|---------|
| `stitch-design-foundation` | Executes Tier 1: full foundation design system establishment. |
| `stitch-ui-story-design` | Executes Tier 2: lightweight per-story design generation. |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| 3 options instead of 5 | Fewer options = more focused evaluation. 5 creates decision fatigue. |
| Design system before layouts | Separates visual language from spatial organization. Evaluate one variable at a time. |
| DESIGN.md as linchpin | Stitch's primary mechanism for cross-screen consistency. Plain markdown, dual representation (human-editable + structured tokens). |
| Lighter funnel for per-story (3→1) | Full funnel (5→3→2→1) too heavy for individual stories. Foundation absorbs the exploration cost. |
| Code is final source of truth | Stitch generates exploration mockups. Real Vue components with locked tokens enforce production consistency. |
| Cleanup after each session | Prevents Stitch project bloat. Rejected screens don't pollute future `extract_design_context` calls. |
