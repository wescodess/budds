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
| Generated screens ignore competitor patterns | Include competitor pattern descriptions from research report in every generation prompt. | N/A (prompt discipline) |

---

## Competitive References Strategy

Competitor research feeds into Stitch generation as **textual descriptions in prompts**, not as image inputs. Stitch is a text-to-design tool — it cannot accept screenshots as visual references. The enforcement mechanism is:

### How It Works

1. **Research report as source of truth** — `_bmad-output/research/product-research-report.md` contains detailed UX pattern descriptions, feature matrices, and design recommendations extracted from competitor products (NotebookLM, Atlas, etc.)

2. **Screenshots as human review aids** — `_bmad-output/research/screenshots/` contains UI screenshots organized by competitor. These are for the **user** to visually reference during direction selection, not for Stitch consumption.

3. **Textual pattern injection into prompts** — When crafting Stitch generation prompts, the skill extracts relevant patterns from the research report and describes them explicitly. Examples:
   - "3-panel persistent layout with sources on left, chat in center, output tools on right (inspired by NotebookLM's workspace)"
   - "Multi-step wizard for quiz creation: select resources → customize questions → configure settings (inspired by Atlas's progressive disclosure pattern)"
   - "Source checkboxes for selective AI context inclusion (NotebookLM pattern)"

4. **Per-direction attribution** — Each generated direction explicitly names which competitor pattern it draws from or improves upon, so the user can evaluate directions against known references.

### Enforcement Points

| Tier | Step | What Gets Injected |
|------|------|--------------------|
| Tier 1 | Step 1 (Context) | Load research report alongside PRD/UX spec. Extract competitive patterns. |
| Tier 1 | Step 2 (Design System) | Include competitive context in design system prompts (dark mode, design aesthetic influences). |
| Tier 1 | Step 4 (Core Layouts) | Each layout direction references a specific competitor pattern in its prompt. |
| Tier 2 | Step 1 (Assess) | Load research report. Identify which competitor patterns apply to this story's feature area. |
| Tier 2 | Step 2 (Generate) | Describe the relevant competitor pattern in the generation prompt. |

### Feature-to-Competitor Pattern Map

| Budds Feature Area | Competitor Reference | Pattern to Borrow/Improve |
|--------------------|---------------------|---------------------------|
| Main workspace | NotebookLM | 3-panel persistent layout (Sources \| Chat \| Studio) |
| Course organization | Atlas | Folder > Space hierarchy |
| Source management | NotebookLM | Per-source checkboxes for context selection |
| Chat interface | NotebookLM | Chat configuration modes (Default/Learning Guide/Custom) |
| Quiz creation | Atlas | Multi-step wizard with progressive disclosure |
| Flashcards | Both (validated) | Dedicated flashcard interface |
| Global search | Atlas | "Ask Atlas anything..." home page input |
| Inline references | Atlas | "Type / to reference resources" command pattern |
| Note-taking | NotebookLM | Rich text editor + "Convert to source" upgrade path |
| Sharing | Atlas | Public/Private toggle per artifact |

---

## Key Files

| File | Location | Purpose |
|------|----------|---------|
| `DESIGN.md` | Project root | Source of truth for visual design system. Fed to every Stitch generation call. |
| `stitch.json` | Project root | Persists Stitch project ID for workspace association. |
| `style-guide.json` | `app/assets/` | Extracted design tokens synced with Tailwind config. |
| `product-research-report.md` | `_bmad-output/research/` | Competitive research with UX patterns, feature matrices, and design recommendations. |
| `screenshots/` | `_bmad-output/research/screenshots/` | Competitor UI screenshots for human reference during design reviews. |

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
| Competitor patterns via text, not images | Stitch is text-to-design. Screenshots are for human review; prompts carry the pattern descriptions. |
