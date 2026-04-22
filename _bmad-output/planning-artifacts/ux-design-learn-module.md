---
status: complete
created: "2026-04-22"
extends: ux-design-specification.md
designSystem: DESIGN.md
inputDocuments:
  - prd-learn-module.md
  - architecture-learn-module.md
  - product-brief-learn-module.md
  - ux-design-specification.md
  - DESIGN.md
---

# UX Design Specification — Budds Learn Module

**Author:** palmwine
**Date:** 2026-04-22
**Extends:** Base Budds UX Specification (2026-04-09)

_This addendum defines screens, flows, and interaction patterns specific to the Learn module. All base design system decisions (colors, typography, spacing, components, accessibility, responsive strategy) carry forward from the base UX spec and DESIGN.md._

---

## Learn Module Design Philosophy

The Learn module introduces a new concept to Budds: **structured progression**. Existing features (chat, quiz, flashcards, audio) are ad-hoc — the user decides what to generate and when. Learn adds an orchestrated path through material with the system curating what comes next.

**Design tension to resolve:** Budds' DESIGN.md explicitly says "No gamification mechanics (streaks, points, leaderboards, guilt loops)." But the PRD includes streaks and mastery indicators. The resolution: **streaks and mastery are progress signals, not pressure mechanics.** They show what you've done, not what you haven't. No guilt, no "you missed a day!" messaging. The streak freeze exists specifically to remove anxiety. Mastery indicators show strength, not deficiency.

**The Learn Void:** Course sections are Voids. When a user enters a section, it's a full-screen, distraction-free workspace — consistent with every other Void in Budds. The section content (audio primer, explanation, practice, reinforcement) fills the Void. Navigation between sections happens through explicit user action, never auto-advance.

---

## New Screens

### 1. Learn Home (`/app/learn/`)

**Purpose:** Entry point for all courses. Shows course list, daily review CTA, and streak status. Also the cold-start onboarding surface for new users.

**Layout:**

```
┌──────────┬──────────────────────────────────────────┐
│ Sidebar  │ Learn                                     │
│          │                                           │
│ Home     │ ┌─────────────┐  Streak: 7 days 🔥       │
│ ▸ Learn  │ │ Daily Review │  Pace: Steady            │
│   Folders│ │ 12 items due │                          │
│   ...    │ │ ~5 min       │                          │
│          │ └─────────────┘                           │
│          │                                           │
│          │ Your Courses                              │
│          │ ┌────────────┐ ┌────────────┐             │
│          │ │ Orgo Chem  │ │ React Hooks│             │
│          │ │ ████░░ 65% │ │ ██░░░░ 28% │             │
│          │ │ 8/12 sects │ │ 2/7 sects  │             │
│          │ │ Intensive  │ │ Steady     │             │
│          │ └────────────┘ └────────────┘             │
│          │                                           │
│          │ ┌ ─ ─ ─ ─ ─ ┐                            │
│          │ │ + Create   │                            │
│          │ │   Course   │                            │
│          │ └ ─ ─ ─ ─ ─ ┘                            │
└──────────┴──────────────────────────────────────────┘
```

**States:**

| State | Content |
|---|---|
| Empty (no courses) | "What do you want to learn?" — topic input + "Or create from your folders" link. This is the cold-start hero. |
| Has courses, no review due | Course grid only, no review CTA |
| Has courses + review due | Review CTA card at top, course grid below |
| Streak active | Streak counter with flame icon in warm amber, subtle — not a modal or banner |
| Streak frozen | Frost icon replacing flame, muted text "Freeze used" |

**Interactions:**
- Click course card → navigate to course view
- Click "Daily Review" card → navigate to review session
- Click "+ Create Course" → open course creator
- Topic input (empty state) → initiate web-sourced course creation

### 2. Folder-Scoped Learn (`/app/folders/[id]/learn/`)

**Purpose:** Learn tab within a folder. Shows courses scoped to this folder's documents.

**Layout:** Same grid as Learn Home, but filtered to folder-scoped courses. The "+ Create Course" action pre-selects the current folder's documents as source material. No daily review CTA here — that lives at the top-level Learn home only.

**How it fits the existing folder shell:** Learn appears as a new tab alongside Chat, Flashcards, Quiz, and Documents in the folder tab bar. Same tab styling, same position logic.

### 3. Course Creator

**Purpose:** Multi-step flow to create a course from sources or a topic.

**Flow:**

```
Step 1: Source Selection
┌──────────────────────────────────────────────┐
│ Create a Course                              │
│                                              │
│ What do you want to learn?                   │
│ ┌──────────────────────────────────────────┐ │
│ │ Type a topic...                          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ — or select from your knowledge base —       │
│                                              │
│ ☑ Organic Chemistry (folder, 18 docs)       │
│ ☐ Biology 101 (folder, 12 docs)             │
│ ☑ reaction-mechanisms.pdf (file)             │
│                                              │
│ ☐ Supplement from web                        │
│                                              │
│         [Generate Outline →]                 │
└──────────────────────────────────────────────┘

Step 2: Outline Editor (appears after generation)
┌──────────────────────────────────────────────┐
│ Course Outline                    12 sections │
│ ┌──────────────────────────────────────────┐ │
│ │ Draws from 18 of your documents          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ⠿ 1. Functional Groups         [factual] ✕  │
│ ⠿ 2. Reaction Mechanisms    [conceptual] ✕  │
│ ⠿ 3. Nucleophilic Sub.      [conceptual] ✕  │
│ ⠿ 4. Stereochemistry           [factual] ✕  │
│ ...                                          │
│                                              │
│ [+ Add Section]                              │
│                                              │
│ Pace: [Intensive ▾]                          │
│                                              │
│         [Start Learning →]                   │
└──────────────────────────────────────────────┘
```

**Interactions:**
- Topic input OR folder/file selection (not mutually exclusive — topic + docs works)
- "Supplement from web" checkbox enables web search augmentation
- "Generate Outline" triggers async outline generation (skeleton loading, 15-20s)
- Outline editor: drag handle (⠿) to reorder, ✕ to remove, click section title to edit
- Knowledge type badges (`[factual]`, `[conceptual]`, `[procedural]`, `[mixed]`) are clickable to override
- Pace selector dropdown
- Source confidence indicator (muted card at top)
- "Start Learning" creates the course and opens Section 1

**Loading state during outline generation:** Skeleton with 8-10 shimmer lines representing section rows. Caption: "Analyzing your materials..."

### 4. Course View (`/app/learn/[courseId]`)

**Purpose:** Shows course progress, section list, and mastery dashboard.

**Layout:**

```
┌──────────┬──────────────────────────────────────────┐
│ Sidebar  │ ← Back to Learn                          │
│          │                                           │
│          │ Organic Chemistry                         │
│          │ ████████░░░░ 65%        Streak: 7 🔥     │
│          │ Pace: Intensive                           │
│          │                                           │
│          │ Sections                                  │
│          │ ┌──────────────────────────────────────┐  │
│          │ │ ✓ 1. Functional Groups    [Mastered] │  │
│          │ │ ✓ 2. Reaction Mechanisms   [Strong]  │  │
│          │ │ ▸ 3. Nucleophilic Sub.    [Current]  │  │
│          │ │ 🔒 4. Stereochemistry      [Locked]  │  │
│          │ │ 🔒 5. Spectroscopy         [Locked]  │  │
│          │ └──────────────────────────────────────┘  │
│          │                                           │
│          │ [Edit Outline]  [Change Pace ▾]  [Delete] │
└──────────┴──────────────────────────────────────────┘
```

**Section states:**

| State | Visual | Interaction |
|---|---|---|
| Locked | Muted text, lock icon, no mastery badge | Not clickable |
| Generating | Skeleton shimmer, spinner icon | Not clickable, shows "Preparing..." |
| Current (ready) | Full contrast, amber left border, mastery badge | Click to enter section Void |
| Completed | Checkmark icon, mastery badge colored by level | Click to revisit |

**Mastery badge colors:**

| Level | Color | Badge |
|---|---|---|
| New | `--muted-foreground` | gray dot |
| Learning | `--warning` (amber) | amber dot |
| Reviewing | `--primary` (gold) | gold dot |
| Mastered | `--success` (green) | green checkmark |

### 5. Section Void (`/app/learn/[courseId]/[sectionId]`)

**Purpose:** The learning experience. A Void containing the section's content blocks in sequence.

**Layout:** Full Void — no chrome beyond a minimal top bar with section title, progress, and back navigation.

```
┌──────────────────────────────────────────────────┐
│ ← Organic Chemistry    Section 3 of 12    [4/5]  │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ 🔊 Audio Primer                    2:30    │  │
│  │ ▶ ━━━━━━━━━░░░░░░░░░░░░░░░░░░░░           │  │
│  │                                            │  │
│  │ "In your Lecture 7 notes, you have a       │  │
│  │  diagram comparing SN1 and SN2..."         │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Nucleophilic Substitution                       │
│                                                  │
│  The key difference between SN1 and SN2          │
│  reactions is the mechanism by which the          │
│  nucleophile attacks the substrate...             │
│                                                  │
│  [From your notes: reaction-mechanisms.pdf, p.14] │
│                                                  │
│  ─────────── Practice ───────────                │
│                                                  │
│  Which mechanism proceeds through a              │
│  carbocation intermediate?                       │
│                                                  │
│  ○ SN1                                           │
│  ○ SN2                                           │
│  ○ E1                                            │
│  ○ E2                                            │
│                                                  │
│                          [Next →]                │
└──────────────────────────────────────────────────┘
```

**Content block types and their rendering:**

| Block Type | Rendering |
|---|---|
| Audio primer | Compact audio player (waveform, play/pause, duration). Below: transcript text referencing user's notes in italic. |
| Text explanation | Markdown rendered body text. Source references shown as muted caption links. |
| Quiz practice | Embedded quiz questions (multiple choice, true/false, fill-in-blank). Immediate feedback per question. No separate "submit quiz" — each answer resolves inline. |
| Flashcard reinforcement | Horizontal scrollable card strip at section end. Tap to flip, swipe to advance. Caption: "Key concepts for review" |

**Progress indicator:** `[4/5]` in top bar — current content block / total blocks in this section. Thin amber progress bar below the top bar.

**Section completion:** After finishing the last content block, a completion card appears:

```
┌────────────────────────────────────────────┐
│ Section Complete ✓                         │
│                                            │
│ Accuracy: 80%        Mastery: Strong       │
│                                            │
│ 4 concepts added to your review queue      │
│                                            │
│ [Continue to Section 4 →]                  │
│ [Back to Course Overview]                  │
└────────────────────────────────────────────┘
```

**Adaptive feedback:** If accuracy <60%, the completion card adds: "The next section will include more foundational practice to strengthen your understanding." No negative framing — it's guidance, not judgment.

### 6. Daily Review Session (`/app/learn/review`) — Fast-Follow

**Purpose:** Spaced repetition review across all courses. A focused Void.

**Layout:**

```
┌──────────────────────────────────────────────────┐
│ Daily Review                    8 items · ~5 min  │
│ ━━━━━━░░░░░░░░░░░░ 3/8                          │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │                                            │  │
│  │  What is the primary function of           │  │
│  │  a nucleophile in SN2 reactions?           │  │
│  │                                            │  │
│  │            [Tap to reveal]                 │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  From: Organic Chemistry · Section 3             │
│                                                  │
│                                                  │
│  After reveal:                                   │
│  ┌────────┬────────┬────────┬────────┐          │
│  │ Again  │  Hard  │  Good  │  Easy  │          │
│  │ (red)  │(amber) │(green) │(blue)  │          │
│  └────────┴────────┴────────┴────────┘          │
│                                                  │
│  [⚑ Flag as incorrect]                          │
└──────────────────────────────────────────────────┘
```

**Recall rating buttons:** Four buttons at the bottom after answer reveal. Color-coded for instant recognition:
- Again: `--destructive` (muted)
- Hard: `--warning` (amber)
- Good: `--success` (green)
- Easy: muted blue-teal

**Flag action:** Small text link below the card. Opens an inline editor to correct the item. Flagged items show a strikethrough on the incorrect part with the correction below.

**Session complete:**

```
┌────────────────────────────────────────────┐
│ Review Complete ✓                          │
│                                            │
│ 8 items reviewed                           │
│ 6 correct · 2 need more practice           │
│                                            │
│ Streak: 8 days 🔥                          │
│                                            │
│ [Back to Learn Home]                       │
└────────────────────────────────────────────┘
```

### 7. Streak & Progress Display

**Streak counter:** Appears in Learn Home header and course view. Small, muted text + flame icon in `--primary` amber. Not a modal, not a banner, not a notification.

**Streak freeze indicator:** When freeze is available, a small frost/shield icon appears next to the streak. When used, the flame icon dims for that day and shows "Freeze used" in `--muted-foreground`.

**Streak break:** No guilt message. The counter simply resets to 0. No "you lost your streak!" notification. The user sees "0 days" and can start fresh.

---

## Interaction Patterns

### Course Creation Flow

```
[Topic input / Source selection] → [Generate Outline] → [Edit Outline] → [Set Pace] → [Start Learning]
```

- Outline generation is async (15-20s). Show skeleton loading with "Analyzing your materials..." caption.
- Outline editor supports drag-to-reorder (using existing drag patterns from flashcard room editor).
- Pace selector is a dropdown with three options: Intensive, Steady, Relaxed. Each shows a brief description on selection.

### Section Navigation Flow

```
[Course View] → [Click current section] → [Section Void] → [Complete blocks] → [Section Complete card] → [Continue to next / Back to course]
```

- N+1 pre-fetch is invisible to the user. If the next section is ready, "Continue" navigates instantly. If still generating, show a brief skeleton with "Preparing next section..." (should be rare with pre-fetch).
- Users can revisit completed sections from the course view. Content is read-only except for retaking practice questions.

### Content Flag Flow

```
[See incorrect item] → [Tap "Flag as incorrect"] → [Inline editor opens] → [Edit answer/explanation] → [Save correction] → [Item removed from review queue until corrected]
```

### Offline Indicator Pattern (Fast-Follow)

- Each completed section shows a small download icon in `--muted-foreground` on the course view.
- Sections cached for offline have a filled icon. Not cached: outlined icon.
- When offline, a subtle top banner appears: "You're offline. Completed sections are available." — warm amber background at 10% opacity, not alarming.
- Online status restores silently — banner fades without notification.

---

## Component Specifications

### New Components

**CourseCard**
- Surface: `--card`, border `--border`, radius `--radius-lg`
- Content: Course title (body emphasis), progress bar (`--primary` fill on `--muted` track), section count caption, pace badge
- States: Default, hover (subtle border brighten), active course indicator (amber left border)

**OutlineEditor**
- Renders outline sections as a draggable list
- Each row: drag handle + order number + title (editable on click) + knowledge type badge + remove button
- Knowledge type badge: small pill using muted background, clickable to cycle through types
- "+ Add Section" text button at bottom in `--muted-foreground`

**SectionShell**
- Minimal top bar: back arrow + course title + section title + block progress `[n/m]`
- Thin progress bar below top bar in `--primary`
- Content area: scrollable, renders content blocks sequentially
- No sidebar, no footer — pure Void

**MasteryBadge**
- Small circle (8px) color-coded by mastery level + text label
- Inline with section title in course view

**StreakDisplay**
- Flame icon + number + "days" — all in `--muted-foreground` except the flame which uses `--primary` when active
- Compact enough to sit in a header or card without dominating

**PaceSelector**
- Dropdown (uses `UiDropdownMenu`) with three items
- Each item: pace name (bold) + one-line description (muted)
- Selected pace shows as a badge on the course card

**ReviewCard**
- Large centered card (`--card` surface, `--radius-lg`)
- Prompt text centered, generous padding
- "Tap to reveal" action area
- After reveal: answer text + four rating buttons row
- Course/section attribution in caption below card

**SourceConfidenceIndicator**
- Muted card or inline text showing "Draws from N of your documents" or "Built primarily from web sources"
- Uses muted background, caption text, no icon

**SectionCompletionCard**
- Centered card showing accuracy %, mastery level, review items added
- Two action buttons: Continue (primary) and Back (ghost)

---

## Responsive Behavior

### Mobile Learn Home
- Course cards stack single column
- Daily review CTA card spans full width at top
- Streak display in header, compact

### Mobile Course View
- Section list spans full width
- Mastery badges shift to right-aligned dots (no text labels)
- Actions (Edit Outline, Change Pace, Delete) move to a three-dot menu

### Mobile Section Void
- Full screen, no sidebar
- Audio player spans full width
- Quiz options stack vertically with full-width tap targets (44px min height)
- Flashcard reinforcement strip becomes a full-width swipeable card
- Section progress moves to thin bar only (no text counter)

### Mobile Review Session
- Review card spans full width with generous padding
- Rating buttons span full width as a 4-column row
- Flag action moves below rating buttons

### Mobile Course Creator
- Source selection: folder/file list scrolls vertically, checkboxes on left
- Outline editor: drag handles become swipe-to-reorder on mobile
- Full-width topic input and action buttons

---

## Accessibility Additions

### Learn-Specific ARIA

- Course list: `role="list"` with `role="listitem"` per course card
- Section list: ordered list semantics, locked sections have `aria-disabled="true"`
- Review card: `aria-live="polite"` for answer reveal
- Rating buttons: `role="group"` with `aria-label="Rate your recall"`
- Progress bar: `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Streak display: `aria-label="Learning streak: N days"`

### Keyboard Shortcuts (Learn-Specific)

| Shortcut | Action | Context |
|---|---|---|
| `Space` | Reveal answer | Review session |
| `1-4` | Rate recall (Again/Hard/Good/Easy) | Review session, after reveal |
| `→` / `Enter` | Continue to next block/section | Section Void |
| `←` | Go back to previous block | Section Void |
| `f` | Flag current item | Review session |

### Screen Reader Announcements

- Section completion: "Section complete. Accuracy: 80%. Mastery level: Strong. 4 concepts added to review queue."
- Review item reveal: announces the answer text
- Streak update: "Learning streak: 8 days"
- Course creation: "Course outline generated. 12 sections." 

---

## Design Principles Summary (Learn-Specific)

1. **Progress, not pressure.** Streaks show what you've done. Mastery shows how strong you are. Neither punishes you for skipping a day.

2. **Sections are Voids.** Full-screen, distraction-free. The content IS the interface. Consistent with every other Void in Budds.

3. **The cold-start is the hero.** "What do you want to learn?" with a topic input — zero friction to first value. This is the most important screen in the module.

4. **Orchestration is invisible.** The user never sees "generating quiz" + "generating flashcards" + "generating audio" separately. They see a section loading, then content appears. The multi-engine pipeline is hidden behind a single skeleton state.

5. **Calm mastery.** Green for mastered, gold for reviewing, amber for learning, gray for new. Warm colors that feel like progress, not traffic lights.
