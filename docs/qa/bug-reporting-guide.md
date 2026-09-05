# Budds Bug Reporting Guide

## Severity Levels

### P0 -- Critical

Complete loss of core functionality or data integrity issue. Blocks all users.

Examples:
- Login/authentication completely broken
- Data loss or corruption (documents, folders, user accounts)
- Application crashes on load (white screen)
- Security vulnerability (unauthorized data access)

**Response**: Immediate. Stop current work and fix.

### P1 -- High

Major feature is broken or severely degraded. Workaround may exist but is impractical.

Examples:
- Chat AI responses fail consistently
- File upload does not process documents
- Quiz/flashcard generation returns errors
- Audio overview generation fails
- Real-time updates (Convex subscriptions) stop working

**Response**: Fix within 24 hours.

### P2 -- Medium

Feature works but behaves incorrectly in specific scenarios. Workaround exists.

Examples:
- Citation links point to wrong document sections
- Dark mode renders certain components with wrong colors
- Mobile layout overlaps on specific screen sizes
- Flashcard spaced-repetition scheduling calculates wrong dates
- Search returns irrelevant results

**Response**: Fix within the current sprint.

### P3 -- Low

Minor visual or UX issues. Does not affect functionality.

Examples:
- Typo in UI text
- Animation jank on transitions
- Tooltip positioning slightly off
- Inconsistent spacing between elements

**Response**: Backlog. Fix when convenient.

## Required Fields for Bug Reports

| Field | Required | Description |
|---|---|---|
| Title | Yes | Short, specific description of the issue |
| Severity | Yes | P0, P1, P2, or P3 |
| Steps to Reproduce | Yes | Numbered steps from a clean starting state |
| Expected Behavior | Yes | What should happen |
| Actual Behavior | Yes | What actually happens, including error messages |
| Environment | Yes | Browser, OS, screen size, account email |
| Screenshots/Video | When applicable | Screen recordings for UI bugs, console screenshots for errors |
| Reproducibility | Yes | Always, intermittent (include frequency), or one-time |

## Good Bug Report Examples

### Example 1: P1 -- Functional Bug

**Title**: Quiz generation returns 502 error for folders with more than 20 documents

**Severity**: P1

**Steps to Reproduce**:
1. Log in with Google OAuth
2. Create a new folder
3. Upload 25 PDF documents to the folder
4. Navigate to the Quiz tab
5. Click "Generate Quiz"
6. Select "All documents" as the source

**Expected**: A quiz is generated from the folder content within 30 seconds.

**Actual**: After ~15 seconds, a toast notification appears: "Failed to generate quiz." Browser console shows `POST /api/quiz/generate 502 Bad Gateway`.

**Environment**: Chrome 126, macOS 15.4, 1440x900

**Reproducibility**: Always (tested 3 times)

---

### Example 2: P2 -- UI Bug

**Title**: Breadcrumb truncation hides folder name on mobile when inside a course section

**Severity**: P2

**Steps to Reproduce**:
1. Log in on a mobile device (iPhone 15, Safari)
2. Navigate to a folder with a long name (e.g., "Advanced Molecular Biology 301")
3. Open a course within that folder
4. Open a section within that course

**Expected**: The breadcrumb shows a truncated but readable path, with the current section name visible.

**Actual**: The entire breadcrumb shows "..." with no readable text. Tapping the breadcrumb does nothing.

**Environment**: Safari 18, iOS 18.4, iPhone 15 (390x844)

**Reproducibility**: Always

## Where to Report

File all bugs as GitHub Issues in the Budds repository.

URL: `https://github.com/wescodess/budds/issues/new`

Use the **Bug Report** issue template when available.

## Labels/Tags Convention

| Label | Usage |
|---|---|
| `bug` | All bug reports |
| `P0-critical` | Severity P0 |
| `P1-high` | Severity P1 |
| `P2-medium` | Severity P2 |
| `P3-low` | Severity P3 |
| `area:chat` | Chat/AI response issues |
| `area:documents` | File upload, processing, display |
| `area:quiz` | Quiz generation and taking |
| `area:flashcards` | Flashcard rooms and practice |
| `area:learn` | Courses, sections, review |
| `area:audio` | Audio overview generation/playback |
| `area:auth` | Login, sessions, permissions |
| `area:ui` | Visual/layout issues |
| `area:mobile` | Mobile-specific issues |
| `needs-reproduction` | Cannot reproduce; needs more info |
| `confirmed` | Reproduced by a team member |
