# Budds - Component Inventory

**Date:** 2026-04-08

## Overview

Budds has a minimal component structure with 3 page components, 1 composable, and a shadcn-nuxt UI framework configured but with no custom UI components yet created.

## Pages

### `app/pages/index.vue`

- **Route:** `/`
- **Purpose:** Home/welcome landing page
- **Auth:** Public
- **Complexity:** Minimal - static welcome message
- **Dependencies:** None

### `app/pages/login.vue`

- **Route:** `/login`
- **Purpose:** Google OAuth login page
- **Auth:** Guest-only (authenticated users redirected away)
- **Complexity:** Simple - single OAuth button
- **Dependencies:** `useUserSession()` from `@onmax/nuxt-better-auth`
- **Key Behavior:**
  - Checks if user is already authenticated via `useUserSession()`
  - Redirects authenticated users to home
  - Triggers Google OAuth via `signIn.social({ provider: 'google' })`

### `app/pages/app/chat.vue`

- **Route:** `/app/chat`
- **Purpose:** Main RAG chat interface
- **Auth:** Requires authentication (`/app/**` route rule)
- **Complexity:** Most complex page in the application
- **Dependencies:** `useRag()` composable
- **Key Features:**
  - Model selection dropdown with 8 LLM options
  - Message input with send functionality
  - Message history display with role-based styling (user vs assistant)
  - Source document display panel with relevance scores
  - Loading state indicators
  - Dark theme UI (zinc color palette)
- **State:** Uses `useRag()` for reactive messages, loading, and error state

## Composables

### `app/composables/useRag.ts`

- **Purpose:** Core RAG functionality composable
- **Auto-imported:** Yes (Nuxt convention)
- **Exports:**
  - `useRag()` function returning:
    - `messages: Ref<RagMessage[]>` - Conversation message array
    - `loading: Ref<boolean>` - Async loading state
    - `error: Ref<string | null>` - Error message state
    - `chat(query, options): Promise<void>` - Send chat query
    - `search(query, options): Promise<AISearchResponse>` - Search documents
    - `clearMessages(): void` - Reset conversation
- **Interfaces Defined:**
  - `RagSource` - Document search result (content, score, filename, metadata)
  - `RagMessage` - Chat message (role, content, sources?)
  - `ChatOptions` - Chat parameters (model, temperature, max_tokens, etc.)

## UI Framework (shadcn-nuxt)

### Configuration

From `components.json`:

| Setting | Value |
|---|---|
| Style | maia |
| Base Library | reka (Reka UI) |
| Component Prefix | `Ui` |
| Component Directory | `@/components/ui` |
| Base Color | zinc |
| CSS Variables | enabled |
| Icon Library | remixicon |
| Font | inter |

### Available Component System

shadcn-nuxt provides a CLI to add components on-demand:

```bash
npx shadcn-vue@latest add button
npx shadcn-vue@latest add input
npx shadcn-vue@latest add dialog
```

No custom shadcn components have been added yet. The `components/ui/` directory does not exist, indicating all UI in `chat.vue` is built with native HTML + Tailwind CSS classes.

## Utility Libraries

### `app/lib/utils.ts`

- **Export:** `cn(...inputs: ClassValue[]): string`
- **Purpose:** Merges Tailwind CSS class names intelligently
- **Dependencies:** `clsx` (conditional classes), `tailwind-merge` (deduplication)
- **Usage:** Standard shadcn-vue utility for composing component styles

## Styling System

### `app/assets/css/tailwind.css`

Global CSS theme configuration:

- **Fonts:** Inter (400, 500, 600, 700 weights) via Google Fonts
- **Color System:** oklch color space with semantic tokens
- **Themes:** Light and dark mode support via CSS variables
- **Design Tokens:**
  - `--background`, `--foreground` - Base colors
  - `--primary`, `--secondary`, `--accent`, `--destructive` - Semantic colors
  - `--muted`, `--card`, `--popover` - Surface colors
  - `--border`, `--input`, `--ring` - Interactive element colors
  - `--sidebar-*` - Sidebar-specific tokens
  - `--chart-1` through `--chart-5` - Data visualization colors
  - `--radius` - Border radius token

## Component Dependencies Graph

```
app/chat.vue
  └── useRag() composable
        └── $fetch → /api/rag/chat
        └── $fetch → /api/rag/search

login.vue
  └── useUserSession() (from nuxt-better-auth)
        └── /api/_better-auth/* endpoints

index.vue
  └── (no dependencies)
```

## Notes

- The project is in early stage with no custom reusable UI components
- All UI is built directly in page components using Tailwind CSS utilities
- shadcn-nuxt is configured and ready but no components have been scaffolded
- As the project grows, common UI patterns from `chat.vue` (message bubbles, model selector, source cards) should be extracted into reusable components

---

_Generated using BMAD Method `document-project` workflow_
