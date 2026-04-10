# DESIGN.md — Budds Visual Design System

**Direction:** Warm Focus
**Last Updated:** 2026-04-09
**Stitch Design System ID:** `assets/11175050301981891392`

---

## Overview

Budds uses a warm, inviting dark-mode-first design language built around amber/gold accents on dark stone surfaces. The atmosphere is a coffee shop at midnight — cozy, focused, student-friendly. The interface feels like a study companion, not a clinical tool.

The design prioritizes calm over excitement, trust over flash, and content over chrome. Every surface, color, and interaction decision serves the same goal: let students focus on learning without the tool getting in the way.

---

## Core Concept — The Void

A **Void** is a dedicated, full-screen workspace for a single learning interaction. Inspired by Atlas's "Spaces" model, a Void is an endless empty canvas where only the interaction content exists.

**Void types:** Chat, Flash Cards, Quiz, Study Guide

**Design principle:** The main content area IS the active Void. No tabs, no persistent panels, no surrounding chrome. The UI disappears so learning takes center stage. Each Void is self-contained — it knows its folder context and has access to the knowledge base, but visually it's just content and input.

---

## Colors

### Semantic Palette

| Token | Hex | oklch | Role |
|-------|-----|-------|------|
| `--background` | `#1c1917` | `oklch(0.168 0.008 49.0)` | Page background, warm near-black |
| `--foreground` | `#fafaf9` | `oklch(0.985 0.001 106.4)` | Primary text, warm white |
| `--card` | `#292524` | `oklch(0.216 0.008 49.0)` | Elevated surfaces, cards, drawer |
| `--card-foreground` | `#fafaf9` | `oklch(0.985 0.001 106.4)` | Text on cards |
| `--primary` | `#f59e0b` | `oklch(0.769 0.163 75.8)` | Primary accent, CTAs, active states |
| `--primary-foreground` | `#1c1917` | `oklch(0.168 0.008 49.0)` | Text on primary buttons |
| `--secondary` | `#292524` | `oklch(0.216 0.008 49.0)` | Secondary surfaces, subtle backgrounds |
| `--secondary-foreground` | `#fafaf9` | `oklch(0.985 0.001 106.4)` | Text on secondary |
| `--muted` | `#292524` | `oklch(0.216 0.008 49.0)` | Subdued backgrounds, disabled states |
| `--muted-foreground` | `#a8a29e` | `oklch(0.706 0.011 73.6)` | Secondary text, placeholders, timestamps |
| `--accent` | `#fcd34d` | `oklch(0.879 0.156 86.1)` | Highlights, hover states, light gold |
| `--accent-foreground` | `#1c1917` | `oklch(0.168 0.008 49.0)` | Text on accent |
| `--destructive` | `#fb7185` | `oklch(0.704 0.165 11.2)` | Delete actions, error states |
| `--border` | `rgba(250, 250, 249, 0.12)` | `oklch(1 0 0 / 12%)` | Dividers, component borders |
| `--input` | `rgba(250, 250, 249, 0.15)` | `oklch(1 0 0 / 15%)` | Input field borders |
| `--ring` | `#f59e0b` | `oklch(0.769 0.163 75.8)` | Focus ring, amber |

### Functional Colors (not in CSS tokens — use directly)

| Purpose | Hex | Usage |
|---------|-----|-------|
| Success | `#6ee7b7` | File indexed, upload complete, quiz passed |
| Warning | `#fb923c` | Processing states, ingestion in progress |
| Citation badge | `#f59e0b` | Inline citation pills [1] [2] |
| Source highlight | `rgba(245, 158, 11, 0.1)` | Background tint on highlighted source passages |

### Sidebar Tokens

| Token | Value | Role |
|-------|-------|------|
| `--sidebar` | `#1c1917` | Sidebar background, matches page |
| `--sidebar-foreground` | `#fafaf9` | Sidebar text |
| `--sidebar-primary` | `#f59e0b` | Active item amber accent |
| `--sidebar-primary-foreground` | `#fafaf9` | Active item text |
| `--sidebar-accent` | `rgba(245, 158, 11, 0.08)` | Active item background tint |
| `--sidebar-accent-foreground` | `#fafaf9` | Active item text |
| `--sidebar-border` | `rgba(250, 250, 249, 0.12)` | Sidebar dividers |

### Dark Mode is Default

Dark mode is the primary experience. Light mode values should use the same warm stone hue family shifted to light equivalents (stone-50 through stone-200 for backgrounds, stone-700 through stone-900 for text).

---

## Typography

### Fonts

| Role | Family | Weights |
|------|--------|---------|
| Headlines | DM Sans | 600, 700 |
| Body | DM Sans | 400, 500 |
| Labels & Meta | Inter | 500 |
| Source citations | System monospace | 400 |

### Type Scale

| Element | Size | Weight | Line Height | Usage |
|---------|------|--------|-------------|-------|
| Page heading | 24px (1.5rem) | DM Sans 700 | 1.33 | Page titles, empty void headings |
| Section heading | 18px (1.125rem) | DM Sans 600 | 1.44 | Drawer headers, section dividers |
| Body | 14px (0.875rem) | DM Sans 400 | 1.6 | Chat messages, card content |
| Body emphasis | 14px (0.875rem) | DM Sans 500 | 1.6 | Folder names, file names, void titles |
| Caption | 12px (0.75rem) | Inter 500 | 1.5 | Timestamps, metadata, type badges, file sizes |
| Source passage | 13px (0.8125rem) | Monospace 400 | 1.54 | Citation text, source excerpts |

---

## Spacing & Layout

### Spacing Scale

Uses Tailwind's 4px base unit. Key application:

| Context | Value | Class |
|---------|-------|-------|
| Between sections | 24px | `gap-6` |
| Between related items | 12px | `gap-3` |
| Inside cards/panels | 16px | `p-4` |
| Between list items | 8px | `gap-2` |
| Chat message spacing | 16px | `gap-4` |
| Sidebar item padding | 8px vert, 12px horiz | `py-2 px-3` |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `0.75rem` (12px) | Default component radius |
| `--radius-sm` | `0.5rem` (8px) | Small elements, badges, chips |
| `--radius-md` | `0.625rem` (10px) | Medium components |
| `--radius-lg` | `0.75rem` (12px) | Cards, drawers, modals |
| `--radius-xl` | `1rem` (16px) | Large containers, buttons |

### Layout Architecture

```
Desktop (>1024px):
┌──────────┬────────────────────────────────────────┐
│ Sidebar  │ Active Void (full-width)               │
│ w-64     │                                        │
│          │ Breadcrumb + Void title                 │
│ Members  │                                        │
│ Knowledge│ [Void content — chat, cards, quiz...]   │
│          │                                        │
│ ──────── │                                        │
│ VOIDS    │                                        │
│ · Chat A │                                        │
│ · Quiz B │                                        │
│ · Cards C│                                        │
│          │                                        │
│ + New    ├────────────────────────────────────────┤
│          │ Input area (fixed bottom)               │
│ Settings │                                        │
└──────────┴────────────────────────────────────────┘

Knowledge Drawer (when open):
┌──────────┬───────────────────┬────────────────────┐
│ Sidebar  │ Drawer (~40% vw)  │ Void (dimmed)      │
│          │ Folder tree       │                    │
│          │ + files list      │                    │
└──────────┴───────────────────┴────────────────────┘

Mobile (<768px):
- Sidebar collapses to Sheet overlay
- Void is full-screen
- Drawer becomes full-screen sheet
```

---

## Component Patterns

### Sidebar Navigation

- Nav items: icon + label, stacked vertically
- **Active state:** 2px left border in `--primary` amber + `rgba(245, 158, 11, 0.08)` background tint. No pills or boxes.
- **Inactive state:** Muted text (`--muted-foreground`) + icon, no background
- **Hover:** Slight warm background tint `rgba(250, 250, 249, 0.05)`

### Void List (in sidebar)

- Each void shows: type icon + title + type badge below
- Type badges: small caption text in `--muted-foreground` ("Chat", "Flash Cards", "Quiz")
- Active void: same left amber border as nav items
- `+ New Void` text button at bottom, muted until hovered

### Knowledge Drawer

- Slides from sidebar right edge, overlays main content at ~40% viewport width
- Surface: `--card` (#292524) with subtle right-edge shadow
- Header: section title + close X button
- **Folder tree:** expandable nodes with three-dot menu per row
  - Menu options: Add Files (upload icon), Rename Folder (pencil), Delete Folder (trash, destructive color)
  - `+ New Folder` text button at tree bottom
- **Files section:** below divider, lists files with status dot + filename + size
  - Green dot = indexed, amber spinner = processing, red dot = failed

### Chat Void

- Messages: clean layout, no bubble borders, generous spacing
- User messages: aligned right or left with subtle differentiation
- AI messages: full-width, `--card` background subtle, generous padding
- Citation badges: inline amber rounded pills `[1]` `[2]` using `--primary` background with `--primary-foreground` text, `--radius-sm` rounding
- Chat input: fixed bottom, `--card` background, amber focus ring, model selector dropdown on left

### Flash Card Void

- Single card centered in the Void, large format
- `--card` surface, `--radius-lg` rounding
- Tap/click to flip (front/back)
- Swipe or arrow keys to advance
- Progress indicator: "12/24" in `--muted-foreground`
- Source citation link below card in caption text

### Quiz Void

- Questions displayed one at a time, centered
- Multiple choice options as selectable cards
- Correct/incorrect feedback with source citation link
- Progress bar at top using `--primary` fill

### Buttons

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| Primary | `--primary` (#f59e0b) | `--primary-foreground` (#1c1917) | none |
| Secondary | `--secondary` (#292524) | `--secondary-foreground` (#fafaf9) | `--border` |
| Ghost | transparent | `--foreground` | none |
| Destructive | `--destructive` (#fb7185) | white | none |

All buttons use `--radius-lg` (12px). Hover states darken/lighten by ~10%.

### Cards

- Background: `--card`
- Border: 1px `--border`
- Radius: `--radius-lg` (12px)
- Padding: 16px (`p-4`)
- No drop shadows — use border for elevation

### Inputs

- Background: `--card`
- Border: 1px `--input`
- Focus: 2px ring in `--ring` (amber)
- Radius: `--radius-lg`
- Placeholder text: `--muted-foreground`

---

## Elevation & Shadow

- **Minimal shadows.** Prefer border-based elevation.
- Drawer right edge: `shadow-lg` with warm-tinted shadow (`0 0 24px rgba(28, 25, 23, 0.5)`)
- Popover/dropdown menus: `shadow-md`
- Cards and surfaces: no shadow, use `--border` for definition
- Focus states: amber ring, no shadow

---

## Accessibility

- All text meets WCAG 2.1 AA minimum 4.5:1 contrast ratio
- Amber (#f59e0b) on dark backgrounds (#1c1917) = ~8.5:1 contrast
- Warm white (#fafaf9) on dark backgrounds = ~16:1 contrast
- Focus indicators use visible amber ring on all interactive elements
- Keyboard navigation: all features accessible without mouse
- Screen reader: ARIA labels on voids, drawers, folder tree
- `prefers-reduced-motion`: disable transitions, render streaming text instantly

---

## Do's and Don'ts

### Do

- Use generous whitespace — let the Void breathe
- Keep amber for accents and key actions only — never as a background fill on large surfaces
- Make source citations visually prominent — they are the trust mechanism
- Use consistent 12px radius on all interactive components
- Let the Void be truly empty — only the interaction content belongs there
- Show progress quietly (files indexed, cards created) without pressure

### Don't

- No gamification mechanics (streaks, points, leaderboards, guilt loops)
- No persistent panels competing with the Void for attention
- No configuration overload — hide model settings behind smart defaults
- No pulsing animations, countdown timers, or aggressive CTAs
- No feature tours, "what's new" modals, or onboarding interruptions
- No bright saturated colors beyond the defined palette
- No `<style>` blocks — use Tailwind utility classes exclusively
